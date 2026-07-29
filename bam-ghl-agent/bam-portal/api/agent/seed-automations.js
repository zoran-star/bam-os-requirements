// Seed automations from the CANONICAL defaults (api/form-intro-automations.js) -
// the ONE implementation behind both the portal action (api/automations.js
// `seed-preset-automations`) and the preset stamp (applyPreset in presets.js,
// which calls this automatically so "preset applied but zero drips" is
// impossible - the gap San Jose sat in, 2026-07-25).
//
// Idempotent + edit-safe, the two invariants every caller relies on:
//   - creates an automation only if it doesn't exist (never resets an academy's
//     enabled/approved on an existing row),
//   - adds the default steps ONLY when the automation has zero steps (never
//     clobbers copy an academy already edited - GTA stays untouched forever).
// Dormant: seeds enabled:true + approved:false, so nothing sends until the
// academy approves (and, for form intros, portal_entry_routing is on).
//
// SYNC CLASS: a canonical step whose effective sync_class resolves to anything
// stricter than `shared` is still SEEDED, so the sequence keeps its shape and
// the portal shows the slot - but seeded enabled:FALSE, so no academy ever
// live-sends another academy's words. That covers `attributed` (real parent
// testimonials given to ONE academy, e.g. body 'template:nurture-3') AND
// `local` (academy-specific literals: a schedule, a gym address, a coach phone,
// a review link). The academy turns the step on once it carries its own
// content. Full contract at stepEnabled() below. See api/_sync-class.js.
// This is the only enforcement point behind the marking; the drift checker that
// would otherwise catch a mis-marking was cancelled.
//
// No import from presets.js (callers pass the key list) - keeps the dependency
// one-way, since presets.js imports THIS module for the auto-seed.

import { CANONICAL_DEFAULTS, canonicalSteps } from "../form-intro-automations.js";
import { resolveSyncClass } from "../_sync-class.js";
import { sbRest } from "./_store.js";

// seedAutomations({ clientId, offerId?, keys?, sb? }) -> [{ key, name, created, steps } | { key, ok:false }]
//   keys: automation keys to seed (e.g. presetAutomationKeys('free_trial')).
//         Unknown keys are skipped; null/empty seeds ALL canonical defaults.
export async function seedAutomations({ clientId, offerId = null, keys = null, sb = sbRest } = {}) {
  if (!clientId) throw new Error("seedAutomations: clientId required");
  const seedKeys = (Array.isArray(keys) && keys.length ? keys : Object.keys(CANONICAL_DEFAULTS))
    .filter((k) => CANONICAL_DEFAULTS[k]);
  const results = [];
  for (const key of seedKeys) {
    const def = CANONICAL_DEFAULTS[key];
    let autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
    let auto = Array.isArray(autos) && autos[0];
    let created = false;
    if (!auto) {
      const ins = await sb(`automations?on_conflict=client_id,automation_key`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, approved: !!def.approved, offer_id: offerId || null, updated_at: new Date().toISOString() }]),
      });
      auto = Array.isArray(ins) && ins[0];
      created = true;
    }
    if (!auto) { results.push({ key, ok: false }); continue; }
    // Unchanged edit-safety: steps are written ONLY into an automation that has
    // zero steps. An academy that already has steps (including one it
    // deliberately disabled by hand) is never touched by re-seeding.
    const existing = await loadSteps(sb, auto.id);
    if (!existing.length) {
      const steps = canonicalSteps(def);
      if (steps.length) {
        await sb(`automation_steps`, {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(steps.map((s, i) => ({ automation_id: auto.id, position: s.position != null ? s.position : i, wait_amount: s.wait_amount, wait_unit: s.wait_unit, channel: s.channel, subject: s.subject ?? null, body: s.body, enabled: stepEnabled(s), updated_at: new Date().toISOString() }))),
        });
      }
    }
    results.push({ key, name: def.name, created, steps: (await loadSteps(sb, auto.id)).length });
  }
  return results;
}

// THE SEED CONTRACT: only `shared` seeds ON. `local` and `attributed` are both
// CREATED but seeded enabled:FALSE.
//
// This is not obvious from the code, so, explicitly:
//
//   shared      generic/tokenized copy that belongs to no one. Seeds ON. It is
//               correct the moment it lands, in any academy.
//   local       the STRUCTURE copies, the WORDS do not - this slot is that
//               academy's own content and the text sitting in it right now is
//               somebody else's (GTA's, usually) or a placeholder. Seeds OFF.
//   attributed  a real, named person's words at one academy. Seeds OFF, and
//               never copies at all.
//
// WHY `local` IS STILL CREATED RATHER THAN SKIPPED. The step exists so the
// sequence keeps its shape and the slot is VISIBLE in the portal - a gap an
// academy can see and fill beats a gap nobody knows is missing. It is simply
// OFF until that academy's own content is written. That makes the downstream
// job a clean, checkable contract:
//
//   "author the content for this step, then turn it on"
//
// rather than the version we had before, which was "author the content and hope
// nobody enabled the step early". Under the old rule (`!== 'attributed'`) a
// `local` step seeded ON, so between seeding and authoring, every academy was
// live-sending another academy's literals. That window is now closed by
// construction: nothing can send from a `local` slot until a human turns it on,
// and the only reason to turn it on is that the content is now theirs.
//
// Exported for the test. NOTE: this writes only `enabled`, not a sync_class
// column. The automation_steps.sync_class migration is written but NOT yet
// applied, and posting an unknown column to PostgREST 400s the whole insert,
// which would break every seed. Once that migration is applied, persist the
// resolved class on the row here too.
export function stepEnabled(step) {
  return resolveSyncClass(step) === "shared";
}

async function loadSteps(sb, automationId) {
  const rows = await sb(`automation_steps?automation_id=eq.${automationId}&order=position.asc&select=id`);
  return Array.isArray(rows) ? rows : [];
}
