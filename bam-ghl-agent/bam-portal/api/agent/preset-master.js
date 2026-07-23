// ── Preset MASTER reader (Phase 1 of the shared sales-preset entity) ─────────
// The tier-1 STRUCTURE of a sales system (stages + edges) is BAM's master,
// authored in api/agent/presets.js and shared by every academy on the preset
// (control-dial model, Zoran 2026-07-23). This module answers structure
// questions straight FROM that master, keyed by the preset stamped on the
// academy's offer (offers.data.sales.preset_key) - no per-academy edge rows.
//
// Rollout is staged (memories/project_sales_systems_plug_and_play.md):
//   SHADOW (now)  resolveEdge still serves the DB row, but also asks the master
//                 and logs any difference ([preset-shadow] lines). Zero behavior
//                 change - the logs prove the flip is safe / catch live drift.
//   FLIP (next)   resolveEdge serves the master first, DB only as fallback.
//   CLEANUP       stage_transitions retired (Phase 3).
//
// Academy PAUSE state (an edge toggled off in focus mode) is tier-2 operational
// control, NOT structure - it stays per-academy and wins over the master at
// flip time. Shadow treats enabled=false rows as expected, not divergence.

import { PRESETS, buildPresetRows } from "./presets.js";
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
