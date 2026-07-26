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
// No import from presets.js (callers pass the key list) - keeps the dependency
// one-way, since presets.js imports THIS module for the auto-seed.

import { CANONICAL_DEFAULTS, canonicalSteps } from "../form-intro-automations.js";
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
    const existing = await loadSteps(sb, auto.id);
    if (!existing.length) {
      const steps = canonicalSteps(def);
      if (steps.length) {
        await sb(`automation_steps`, {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(steps.map((s, i) => ({ automation_id: auto.id, position: s.position != null ? s.position : i, wait_amount: s.wait_amount, wait_unit: s.wait_unit, channel: s.channel, subject: s.subject ?? null, body: s.body, enabled: true, updated_at: new Date().toISOString() }))),
        });
      }
    }
    results.push({ key, name: def.name, created, steps: (await loadSteps(sb, auto.id)).length });
  }
  return results;
}

async function loadSteps(sb, automationId) {
  const rows = await sb(`automation_steps?automation_id=eq.${automationId}&order=position.asc&select=id`);
  return Array.isArray(rows) ? rows : [];
}
