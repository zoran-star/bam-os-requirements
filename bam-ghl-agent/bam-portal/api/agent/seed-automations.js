// Seed automations from the CANONICAL defaults (api/form-intro-automations.js) -
// the ONE implementation behind both the portal action (api/automations.js
// `seed-preset-automations`) and the preset stamp (applyPreset in presets.js,
// which calls this automatically so "preset applied but zero drips" is
// impossible - the gap San Jose sat in, 2026-07-25).
//
// Idempotent + edit-safe, the invariants every caller relies on:
//   - creates an automation only if it doesn't exist,
//   - adds the default steps ONLY when the automation has zero steps (never
//     clobbers copy an academy already edited - GTA stays untouched forever),
//   - never writes `approved` on an existing row - that is the owner's word,
//   - repairs `enabled` on an existing row ONLY when it has zero steps, i.e. when
//     it was created as a placeholder by the panel and never configured. Full
//     reasoning at the repair itself; the short version is that a step-less row
//     carries no human decision to overrule, and a row with steps is untouched.
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
      // REPAIR A ROW THAT WAS BORN DORMANT, and only that row.
      //
      // The automations panel creates placeholder rows through
      // `upsert-automation` (_AUTO_SEED in public/client-portal.html: onboarding,
      // ghosted, nurture) so every sequence is visible in the editor. That action
      // deliberately carries no `enabled` - it upserts, and accepting the field
      // was a way to arm an existing sequence - so the rows land on the database
      // default, enabled:FALSE. Seeding then found the row already present and
      // returned early, so its intended enabled:true never arrived. The owner
      // approves, the row reads approved:true / enabled:false, and the sequence
      // is silent while the wizard reads complete.
      //
      // Confirmed live 2026-07-29: BAM NY sits at exactly that - `ghosted` and
      // `nurture` at enabled:false, approved:false, zero steps.
      //
      // WHY THIS DOES NOT BREAK ZORAN'S "NEVER TOUCH AN EXISTING ROW'S enabled".
      // That rule protects an academy's own decisions - San Jose's nurture-3 is
      // off because a human turned it off, and re-seeding must never undo that.
      // The repair is therefore scoped to rows with ZERO STEPS, which is the same
      // condition that already guards the step write. A step-less row has never
      // been configured and nobody has ever switched anything off inside it: there
      // is no human decision here to overrule. The moment a row has steps, this
      // branch does not run at all.
      //
      // `approved` is NOT repaired and must never be. It is the owner's word, it
      // is the flag this whole approval surface exists to set, and a seeder that
      // could write it would make the owner's yes optional. Only enabled.
      if (def.enabled && !auto.enabled) {
        await sb(`automations?id=eq.${auto.id}&client_id=eq.${clientId}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ enabled: true, updated_at: new Date().toISOString() }),
        });
        auto = { ...auto, enabled: true };
      }
      const steps = canonicalSteps(def);
      if (steps.length) {
        await sb(`automation_steps`, {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(steps.map((s, i) => ({ automation_id: auto.id, position: s.position != null ? s.position : i, wait_amount: s.wait_amount, wait_unit: s.wait_unit, channel: s.channel, subject: s.subject ?? null, body: s.body, sync_class: resolveSyncClass(s), enabled: stepEnabled(s), updated_at: new Date().toISOString() }))),
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
// Exported for the test.
//
// PERSISTING THE CLASS, and why it is not optional (2026-07-29). The seeder now
// writes `sync_class` on the row as well as `enabled`. It could not before - the
// migration was unapplied and posting an unknown column 400s the whole insert -
// and that gap turned out to be a live hole, not a formality.
//
// resolveSyncClass takes the STRICTEST of the row's own column and the class of
// the template its body references. With nothing on the row, the template ref was
// carrying the entire answer. So editing a body to anything that is not still
// `template:<key>` silently DECLASSIFIED the step: an academy's real parent
// testimonials went from `attributed` to `shared`, which is copyable, and no test
// noticed because the row looked ordinary. Executed, all four of these resolved
// `shared` before this change: a literal body, an empty body, a null body, and
// `Template:nurture-3` with a capital T.
//
// With the class on the row, the body is only ever able to make a step STRICTER,
// never looser, which is the invariant the whole strictest-wins design assumed it
// already had. Existing rows were backfilled in the same change.
export function stepEnabled(step) {
  return resolveSyncClass(step) === "shared";
}

async function loadSteps(sb, automationId) {
  const rows = await sb(`automation_steps?automation_id=eq.${automationId}&order=position.asc&select=id`);
  return Array.isArray(rows) ? rows : [];
}
