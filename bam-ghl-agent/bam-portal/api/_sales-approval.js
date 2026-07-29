// The owner's sales-message approval: WHICH automations it covers, and when it
// counts as given.
//
// One of the handful of things an academy owner is asked to APPROVE in onboarding.
// The authoritative list is OWNER_APPROVALS in api/_approval-render.test.mjs, which
// fails when a new one appears - this build first described it as "one of only two,
// the other being the brand board" and that was simply wrong (the owner also accepts
// their new website), which is why the count lives in a check now and not in prose.
//
// `automations.approved` is the flag it sets, and api/automations.js
// will not queue or send a step whose automation is not BOTH enabled and approved.
// The seeder deliberately writes approved:false, so an academy that has applied the
// preset is dormant until an owner reads every message and says yes.
//
// ⚠ WHAT THIS APPROVAL DOES NOT COVER. It gates these five automations and nothing
// else. TWO other lanes put scripted, lead-facing copy on the wire and neither is a
// row in the `automations` table, so neither is rendered on the approval surface and
// neither is covered by the owner's yes:
//
//   1. THE CONFIRM AGENT's scripted initial messages - the booking confirmation and
//      the same-day check-in. Defaults in api/agent/confirm-automations.js, overrides
//      in clients.ghl_kpi_config.confirm_initial_automations, gated by
//      confirm_agent_mode / shouldAutoSend rather than by `approved`.
//   2. THE BOOKING AGENT's scripted opener - api/agent/booking-automations.js, with
//      overrides in clients.ghl_kpi_config.booking_initial_automations. When that
//      sequence is live+approved for an entry point, scriptedBookingOpener() makes
//      its template THE FIRST MESSAGE A NEW LEAD RECEIVES, ahead of the AI draft.
//      Latent today - no academy has the key set - but arming it is arming a sales
//      message, so under Zoran's 2026-07-29 ruling it is owner-only. It is in
//      ARMING_LANES below and api/agent-approvals.js refuses a non-owner save.
//
// HOW LANE 2 STAYED INVISIBLE, so the next person widens the net rather than
// repeating the mistake: the audit for "what else can arm outbound" was grepped
// against the `automations` TABLE. Both lanes above live in a JSON blob on
// clients.ghl_kpi_config, so a table-scoped grep cannot see them by construction.
// Anything that decides whether a scripted message goes to a lead belongs in
// ARMING_LANES, wherever it is stored.
//
// Do not describe this approval, in code or in owner-facing copy, as "nothing sends
// until you approve" - that is broader than what is true.
//
// SHARED, NEVER FORKED. These five keys are the free-trial sales system that every
// academy runs. There is no per-academy list and there must never be one: a preset
// is shared machinery, so "this academy also needs X" means everyone gets X or X is
// a runtime fact. The wizard's copy of this list (`_OBF_SALES_KEYS` in
// public/client-portal.html, which cannot import from here) is checked against this
// one by api/_approval-render.test.mjs so the two cannot drift apart.
//
// `onboarding` is NOT here on purpose. It is the post-conversion welcome sequence
// for people who have already paid, not a sales message to a lead, and its steps
// are gated separately (several seed OFF until the academy has entered its own
// schedule, venue and coaches). Approving the sales system must not arm it.
export const SALES_AUTOMATION_KEYS = ["contact_form", "trial_form", "missed_trial", "ghosted", "nurture"];

// How far along the approval is, for the wizard's detector and for the API's
// response. Accepts rows in either shape the codebase serves them in: the raw
// `automations` row (automation_key) and the trimmed one api/offers/setup-status.js
// returns (key).
//
// FAILS CLOSED, TWICE.
//
// 1. Zero sales automations means the preset has not been applied yet, which is NOT
//    "everything is approved" - `[].every(...)` is true and would have marked the
//    step complete for an academy with no sales system at all, quietly green-lighting
//    a launch checklist over nothing. `done` requires at least one row.
//
// 2. `done` requires every row ENABLED as well as approved, because the send path
//    does. api/automations.js will not enrol, will not report an automation live and
//    will not send a queued step unless the row is BOTH. A row sitting at
//    approved:true, enabled:false is silent, and reporting that as a finished step
//    is the exact shape this suite exists to reject: a green light wired to nothing.
//    It is not hypothetical - the panel's _AUTO_SEED creates rows that land on the
//    database default enabled:false, and before the seeder learned to repair them
//    (see api/agent/seed-automations.js) an owner could approve a set of automations
//    that could never send. `!!a.enabled` and not `a.enabled !== false`: a caller
//    that forgets to select the column must read as not-done, never as done.
//
// The wizard carries its own copy of this logic (`next.approve` in
// public/client-portal.html, which cannot import from here) and it is the one the
// owner actually sees. api/_approval-render.test.mjs checks the two agree.
export function salesApprovalState(automations) {
  const rows = (Array.isArray(automations) ? automations : [])
    .filter((a) => a && SALES_AUTOMATION_KEYS.includes(String(a.automation_key || a.key || "")));
  const total = rows.length;
  const approved = rows.filter((a) => !!a.approved).length;
  const live = rows.filter((a) => !!a.approved && !!a.enabled).length;
  return { total, approved, live, done: total > 0 && live === total };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ARMING GATE, AS A FUNCTION RATHER THAN AS A CONDITION INSIDE A HANDLER.
//
// Zoran's ruling (2026-07-29): switching ON live scripted messaging to leads is the
// academy OWNER's decision, on every route. A teammate holding the operational
// `can_train_agent` flag can work the agent all day; they cannot be the person who
// says a sequence may start texting parents.
//
// WHY IT LIVES HERE AND NOT INLINE. Three separate handlers had the same `if` written
// out longhand, and every check on them matched TEXT: that the handler mentioned
// `canApproveAsOwner`, that the condition string was present. A tester replaced one
// `return res.status(403)` with a `console.warn`, and prefixed another with
// `if (false && ...)`, and both left the pinned text intact - every suite stayed
// green while both gates were no-ops. A shared function is not immune to that, but
// it is one thing to test BEHAVIOURALLY instead of three things to grep for, and
// api/_arming-gate.test.mjs invokes the real handlers and asserts the REFUSAL.
//
// FAILS CLOSED on an unknown lane and on an actor that does not carry the owner
// predicate, so "I forgot to register the lane" and "I passed the wrong object"
// both refuse rather than allow.
//
// ONE DIRECTION ONLY. This gates ARMING. Un-approving, disabling and re-enabling
// something the owner already approved stay on the plain `canActOn` operate scope:
// an emergency stop must never wait for the owner, and an operator who switched a
// sequence off has to be able to switch it back on.
export const ARMING_LANES = {
  "approve-sales-messages": {
    where: "api/automations.js",
    arms: "the five sales automations, in one press, from the onboarding wizard",
    refusal: "approving the sales messages is the academy owner's call - ask an owner, or BAM support",
  },
  "set-approved": {
    where: "api/automations.js",
    arms: "one automation, from the Sales panel's On switch (_autoSetLive fires set-approved + set-enabled)",
    refusal: "switching messages on for the first time is the academy owner's call - ask an owner, or BAM support",
  },
  "booking-automations-set": {
    where: "api/agent-approvals.js",
    arms: "the booking agent's scripted opener, which becomes the FIRST message a new lead receives",
    refusal: "approving the booking opener is the academy owner's call - ask an owner, or BAM support",
  },
  "reignition-approve": {
    where: "api/reignition.js",
    arms: "one reignition campaign's automation, which starts messaging a manual roster of past leads",
    refusal: "approving a reignition campaign is the academy owner's call - ask an owner, or BAM support",
  },
};

// EVERY WRITE TO THE `automations` TABLE, DECLARED. The registry above runs
// registry -> code: each lane names a file and api/_approval-render.test.mjs checks
// that file calls armingRefusal. Nothing ran the other way, so a route that arms a
// sequence WITHOUT registering a lane was invisible by construction - which is how
// api/reignition.js came to PATCH { enabled: true, approved: true } onto a real
// automations row with no entry above. It is closed today only because that handler
// requires BAM staff, a stricter gate than armingRefusal, so it was a coverage hole
// rather than a live one. A second one that was not covered at all: seed-form-intro
// birthing a row with `approved` in the insert.
//
// This list is what makes the claim at the top of this file ("anything that decides
// whether a scripted message goes to a lead belongs in ARMING_LANES") checkable in
// the direction that matters. api/_approval-render.test.mjs sweeps api/ for writes to
// the automations table and fails on any that is not declared here, so a NEW write
// site cannot be added silently - the author has to name the gate that covers it.
//
// The sweep counts WRITES (POST / PATCH / DELETE), not arming fields, deliberately.
// Deciding "is this an arming write?" from the request body means parsing it, and
// two of the sites below defeat that: set-approved writes a COMPUTED key
// (`{ [field]: ... }`) and upsert-automation writes a variable (`[row]`). Counting
// every write needs no parsing and cannot be evaded by how the body is spelled.
export const AUTOMATION_WRITE_SITES = [
  { where: "api/automations.js", what: "approve-sales-messages PATCHes approved:true",
    gate: "ARMING_LANES['approve-sales-messages'] - owner only, and it skips step-less rows" },
  { where: "api/automations.js", what: "upsert-automation upserts the row shape",
    gate: "no arming: `approved` and `enabled` are dropped from the row by construction, so an insert takes the database default false and an update leaves both alone" },
  { where: "api/automations.js", what: "seed-form-intro inserts a missing form-intro row",
    gate: "no arming: it writes `enabled` only, on INSERT only, and `approved` takes the database default false" },
  { where: "api/automations.js", what: "set-enabled / set-approved PATCHes one field",
    gate: "ARMING_LANES['set-approved'] on the arming direction; set-enabled and un-approving stay on canActOn" },
  { where: "api/agent/seed-automations.js", what: "the seeder inserts a canonical automation",
    gate: "no arming: `approved` comes from CANONICAL_DEFAULTS, which is false for every key, and the suite asserts a seeded row is never approved" },
  { where: "api/agent/seed-automations.js", what: "the seeder repairs `enabled` on a step-less row",
    gate: "no arming: `enabled` only, never `approved`, and only on a row with zero steps" },
  { where: "api/reignition.js", what: "a campaign draft inserts its own automation at approved:false",
    gate: "no arming: staff-only handler, and the row is born dormant" },
  { where: "api/reignition.js", what: "approving a campaign PATCHes enabled:true, approved:true",
    gate: "ARMING_LANES['reignition-approve'], behind the stricter staff-only check the handler already carries" },
];

// The refusal messages above deliberately do NOT say "only the academy owner". They
// used to, and it overstated who is refused: canApproveAsOwner returns true for any
// BAM staff row, including content_executor and marketing_executor, who are not
// owners of anything. A teammate reading "only the academy owner can" and then
// watching BAM support do it is being told something false about their own portal.
export function armingRefusal(lane, actor, clientId) {
  const def = ARMING_LANES[lane];
  if (!def) return { status: 500, error: `unknown arming lane: ${lane}` };
  if (!actor || typeof actor.canApproveAsOwner !== "function") return { status: 403, error: def.refusal };
  return actor.canApproveAsOwner(clientId) ? null : { status: 403, error: def.refusal };
}
