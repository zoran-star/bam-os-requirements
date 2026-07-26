// ── Preset MASTER reader (Phase 1 of the shared sales-preset entity) ─────────
// The tier-1 STRUCTURE of a sales system (stages + edges) is BAM's master,
// authored in api/agent/presets.js and shared by every academy on the preset
// (control-dial model, Zoran 2026-07-23). This module answers structure
// questions straight FROM that master, keyed by the preset stamped on the
// academy's offer (offers.data.sales.preset_key) - no per-academy edge rows.
//
// Rollout (memories/project_sales_systems_plug_and_play.md):
//   SHADOW   shipped 2026-07-23 - proved master == DB (GTA + San Jose 23/23).
//   FLIP     LIVE since 2026-07-23 (Zoran: "flip now, Elijah is the guardrail
//            through Hawkeye"): resolveEdge serves the MASTER first; the DB row
//            only wins as a tier-2 pause (enabled=false) or as the fallback when
//            there's no stamp / no master edge. shadowCompareEdge now runs in
//            reverse - it logs when the DB has drifted from the master.
//            Emergency off: env PRESET_EDGE_SOURCE=db (+ redeploy), or revert.
//   CLEANUP  stage_transitions retired (Phase 3).
//
// Academy PAUSE state (an edge toggled off in focus mode) is tier-2 operational
// control, NOT structure - it stays per-academy and wins over the master at
// flip time. Shadow treats enabled=false rows as expected, not divergence.

import { PRESETS, buildPresetRows, templateForRuntime, disclosureForTemplate, breakdownForTemplate } from "./presets.js";
import { pricingDisclosureBody } from "./prompt-structure.js";
import { sbRest } from "./_store.js";

// ── which preset does this academy run? ──────────────────────────────────────
// Read the offer stamp, cached (the stamp changes ~never; 5 min TTL keeps the
// hot routing path free of a per-call DB read after first touch).
const KEY_TTL_MS = 5 * 60 * 1000;
const keyCache = new Map(); // clientId -> { key, at }

export async function resolvePresetKey(clientId, { sb = sbRest } = {}) {
  if (!clientId) return null;
  const hit = keyCache.get(clientId);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.key;
  let key = null;
  try {
    const rows = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&select=data&limit=10`);
    for (const r of rows || []) {
      const k = r && r.data && r.data.sales && r.data.sales.preset_key;
      if (k && PRESETS[k]) { key = k; break; }
    }
  } catch (_) { /* fail null - master reads must never break a live caller */ }
  keyCache.set(clientId, { key, at: Date.now() });
  return key;
}

// ── Build 3: which named agent TEMPLATE is this academy running? ─────────────
// The prompt builders know only the RUNTIME ("booking" / "confirm" / "closing"),
// because that is what picks a behaviour in prompt-structure.js. This joins the
// two: academy -> its stamped preset -> the stage whose agent engine runs on that
// runtime -> the template name. Nothing could do that before, so nothing could
// look up a per-template value.
//
// Phase 4's lesson scoping needs exactly this join too (agent_lessons buckets are
// keyed by AGENT_TEMPLATES[...].lessonKey, not by runtime), so it is shared
// groundwork rather than cost carried by pricing disclosure alone.
export async function resolveAgentTemplate(clientId, runtime, { sb = sbRest } = {}) {
  if (!runtime) return null;
  const key = await resolvePresetKey(clientId, { sb });
  return templateForRuntime(key, runtime);
}

// ── Build 4: the pricing-disclosure section body for this academy's agent ─────
// Returns a partial overrides map ({} on anything unexpected) shaped like
// fact-render's derivedFactOverrides, so the prompt builders merge it the same
// way. An academy with no preset stamped resolves to no template, which lands on
// DEFAULT_DISCLOSURE ("range") - identical to the section's own default, so a
// half-onboarded academy behaves exactly as it does today.
//
// This is tier 1: the value comes from code (AGENT_TEMPLATES) and is applied LAST
// by the callers, so it beats a stored per-academy row. That is deliberate. An
// academy must not be able to widen its own agent's disclosure by editing a
// section, and BAM changing the mode must not be silently shadowed by an old
// stored override. Change the policy in presets.js, not in the database.
// The full resolved pricing POLICY for this academy's agent: which template is
// on shift, and both axes it declares. Breakdown rides alongside disclosure and
// is resolved the same way, from the same template, applied at the same point -
// so an academy can no more widen its own breakdown than its own disclosure.
// Exported because the brain views in both portals badge these two values.
export async function resolvePricingPolicy(clientId, runtime, { sb = sbRest } = {}) {
  const template = await resolveAgentTemplate(clientId, runtime, { sb });
  const disclosure = disclosureForTemplate(template);
  const breakdown = breakdownForTemplate(template);
  return { template, disclosure, breakdown, body: pricingDisclosureBody(disclosure, breakdown) };
}

export async function resolveDisclosureOverride(clientId, runtime, { sb = sbRest } = {}) {
  try {
    const { body } = await resolvePricingPolicy(clientId, runtime, { sb });
    return body ? { pricing_disclosure: body } : {};
  } catch (_) {
    return {}; // never break a prompt build over a policy lookup
  }
}

// ── the master's answer for one (fromRole, trigger) ──────────────────────────
// Same row shape resolveEdge returns from the DB, so callers can't tell the
// source apart. Compiled once per preset per process.
const graphCache = new Map(); // presetKey -> Map("from|trigger" -> edge)

export function masterEdge(presetKey, fromRole, trigger) {
  if (!presetKey || !PRESETS[presetKey] || !trigger) return null;
  let idx = graphCache.get(presetKey);
  if (!idx) {
    idx = new Map();
    const { transitionRows } = buildPresetRows(presetKey, "master", null);
    for (const t of transitionRows) idx.set(`${t.from_stage_role || ""}|${t.trigger}`, t);
    graphCache.set(presetKey, idx);
  }
  const t = idx.get(`${fromRole || ""}|${trigger}`);
  return t ? { trigger: t.trigger, to_kind: t.to_kind, to_stage_role: t.to_stage_role, to_terminal: t.to_terminal, enabled: true } : null;
}

// ── the master's DISPLAY NAME for a stage role ───────────────────────────────
// BAM's preset NAMES the stages (Booking / Ghosted / Confirm / Closing /
// Nurture) and every academy's board shows those names, whatever their own GHL
// sub-account happens to call the stage. Display only - nothing is ever renamed
// inside an academy's GHL account, and the academy's real stage name stays on
// the board payload for everything that keys off it.
// Returns null when there is no preset / no stage for that role, so the caller
// falls back to today's exact behaviour.
const ROLE_ALIASES = { interested: "ghosted" };   // legacy role key, same stage
const labelCache = new Map();                     // presetKey -> { role: label }

export function masterStageLabels(presetKey) {
  if (!presetKey || !PRESETS[presetKey]) return null;
  let idx = labelCache.get(presetKey);
  if (!idx) {
    idx = {};
    for (const s of (PRESETS[presetKey].stages || [])) {
      if (s && s.role && s.label) idx[s.role] = s.label;
    }
    for (const [alias, canon] of Object.entries(ROLE_ALIASES)) {
      if (idx[canon] && !idx[alias]) idx[alias] = idx[canon];
    }
    labelCache.set(presetKey, idx);
  }
  return idx;
}

export function masterStageLabel(presetKey, role) {
  const idx = masterStageLabels(presetKey);
  return (idx && role && idx[role]) || null;
}

// ── shadow comparison (log-only, deduped, never throws) ──────────────────────
const seen = new Set(); // one log line per (client, from, trigger) per process

export async function shadowCompareEdge({ clientId, fromRole, trigger, dbEdge }) {
  try {
    const tag = `${clientId}|${fromRole || ""}|${trigger}`;
    if (seen.has(tag)) return;
    const key = await resolvePresetKey(clientId);
    if (!key) { seen.add(tag); console.error(`[preset-shadow] NO-STAMP client=${clientId}`); return; }
    if (dbEdge && dbEdge.enabled === false) return; // academy paused this route - tier-2 override, not drift
    const m = masterEdge(key, fromRole, trigger);
    const dest = (e) => e ? `${e.to_kind}|${e.to_stage_role || ""}|${e.to_terminal || ""}` : null;
    if (dest(dbEdge) === dest(m)) return;
    seen.add(tag);
    const kind = !dbEdge ? "MISSING-IN-DB" : !m ? "EXTRA-IN-DB" : "DIVERGE";
    console.error(`[preset-shadow] ${kind} client=${clientId} preset=${key} from=${fromRole || "(entry)"} trigger=${trigger} db=${dest(dbEdge)} master=${dest(m)}`);
  } catch (_) { /* shadow must never affect routing */ }
}
