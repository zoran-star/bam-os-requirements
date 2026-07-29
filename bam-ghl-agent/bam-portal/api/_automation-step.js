// THE one place the automation_steps row for `upsert-step` is built
// (api/automations.js). Pure + dependency-free so it can be asserted directly.
//
// The rule that matters: an UPDATE is a PATCH of the WHOLE row, so any key we
// put in the body overwrites whatever is in the database. The portal's step
// editor saves wording only - it never sends `enabled` - so defaulting
// `enabled` to true on update silently switched a step a human had
// deliberately turned OFF back ON. Real case: BAM San Jose's Lead Nurture
// step at position 2 is disabled because that email carries BAM GTA's real
// parent testimonials; re-enabling it would send another academy's customers'
// words as San Jose's own.
//
// So: on UPDATE, `enabled` is OMITTED unless the caller explicitly supplies it
// (omitting the key beats guessing a value). On INSERT there is no existing
// value to preserve, so a brand-new step still defaults to enabled.

export function buildStepRow(b = {}, { nowIso = new Date().toISOString() } = {}) {
  const isUpdate = !!b.id;
  const row = {
    automation_id: b.automation_id,
    position: Number(b.position) || 0,
    wait_amount: Number(b.wait_amount) || 0,
    wait_unit: b.wait_unit || "days",
    channel: b.channel,
    subject: b.subject ?? null,
    body: String(b.body),
    updated_at: nowIso,
  };
  if (b.enabled !== undefined) row.enabled = !!b.enabled;   // caller was explicit - honour it
  else if (!isUpdate) row.enabled = true;                   // brand-new step starts on
  return row;                                               // update + silent caller -> key absent, DB value preserved
}
