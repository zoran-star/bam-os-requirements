// ── REIGNITION campaigns: the core ───────────────────────────────────────────
// Design (approved): docs/plans/ignition-template.html
// The stage itself lives in api/agent/reignition-station.js. This file is the
// CAMPAIGN: the roster, the rails, the pacing, and the two ways out.
//
// THE ONE CONSTRAINT EVERYTHING ELSE BENDS AROUND: a campaign's messages are a
// NORMAL AUTOMATION (`ignition:<slug>`), so they ride the existing worker, the
// existing renderer, the existing quiet hours, time zones, empty-after-merge skip,
// dedupe, retries and reply handling, all of it UNCHANGED. There is no second send
// path in this file and there must never be one. Search it for `fetch`, for
// `sendOn`, for anything that talks to a provider: there is nothing, on purpose.
// A message that goes out through a path other than api/_send.js is a message no
// guard in this system has ever seen.
//
// PACING IS ADMISSION, NOT SENDING. The cron admits up to `per_day` people INTO
// the stage + the automation each day. Once someone is in, their later steps follow
// the sequence's own waits, on the ordinary worker. Pacing therefore never touches
// the send path, which is why every send guard still applies untouched. 60 people
// at 15 a day is a campaign that takes four days to fully launch, not a campaign
// that sends 60 messages slowly.
//
// ON CONSENT, READ THIS BEFORE ADDING A CHECK. Positive consent DOES NOT EXIST as
// data anywhere in this system. The only column is `dnd boolean not null default
// false` on contacts / ghl_contacts, plus email_suppressions - both of which record
// opt-OUT and nothing else. A "no consent recorded -> exclude" rail would therefore
// wave through every single imported lead who had simply never opted out, which is
// exactly the population it would exist to protect. So there is deliberately NO
// automated consent check. Instead `consent_basis` is a REQUIRED, human-written
// field on the campaign - where these leads came from and why we may message them -
// and the dry run puts it next to the roster where the approver has to read it.
//
// Everything above the "── live paths ──" divider is PURE (no I/O, no imports that
// touch the network) so api/_reignition.test.mjs can prove it with plain node.

import { REIGNITION_ROLE } from "./reignition-station.js";

// ── campaign shape ───────────────────────────────────────────────────────────
export const CAMPAIGN_STATES = ["draft", "approved", "running", "done", "halted"];
export const DEFAULT_PER_DAY = 15;
export const MAX_PER_DAY = 200;

// A consent basis is a sentence a person wrote, not a checkbox. Ten characters is
// not a quality bar, it is a "somebody actually typed something" bar; the real
// review is a human reading it at the dry run.
export const MIN_CONSENT_BASIS_CHARS = 10;

export const CHANNELS = ["sms", "email"];

// Roster states.
//
// THERE IS DELIBERATELY NO `sent_step_N` STATE. An earlier draft had one, and it
// was a second copy of a fact the automation engine already owns: which step a
// person is on is `automation_enrollments.current_position`, and when the next one
// fires is the earliest pending `automation_jobs.run_after`. A denormalised column
// would have to be written from the send path (which must not know about
// campaigns) and would silently disagree with the engine the moment a step was
// skipped, disabled, deferred for quiet hours or retried. So the roster view reads
// it live instead - see rosterProgress() below, which is the same join
// api/automations.js `active-enrollments` does.
export const ROSTER_STATES = ["queued", "admitted", "replied", "ran_out", "halted", "excluded"];
export const isRosterState = (s) => ROSTER_STATES.includes(String(s || ""));

// Which step is each admitted person on, and when does the next one fire? Pure:
// the caller supplies the enrollment rows, the campaign's ordered steps, and the
// earliest pending job per enrollment. This is the ONLY source for "on step N".
//
// A PERSON WHO HAS LEFT IS NOT ON A STEP. Enrollment status has to be read, not
// just current_position: a lead who replied has an EXITED enrollment frozen at
// whatever step they were on, and reporting "step 2 of 3" for them contradicts the
// design (replies show as handed to the sales system) and reads as though the
// campaign is still messaging somebody it stopped messaging.
//
// A contact can also hold more than one enrollment on the same automation - an old
// exited one plus a live one, from a re-admission. The ACTIVE one always wins;
// without that it was last-wins over an unordered query, and the stale exited row
// won often enough for a tester to catch it.
export function rosterProgress({ roster = [], enrollments = [], steps = [], nextJobByEnrollment = {} } = {}) {
  const ordinal = new Map();
  [...steps].sort((a, b) => a.position - b.position).forEach((s, i) => ordinal.set(s.position, i + 1));

  const byContact = new Map();
  for (const e of enrollments) {
    const k = String(e.contact_id);
    const cur = byContact.get(k);
    // Prefer active; among equals keep the FIRST, which the caller ordered newest
    // first. Never let a later row silently replace an active one.
    if (!cur || (cur.status !== "active" && e.status === "active")) byContact.set(k, e);
  }

  return roster.map((r) => {
    const e = byContact.get(String(r.contact_id)) || null;
    const live = !!e && e.status === "active";
    return {
      ...r,
      // Only a live enrolment has a current step.
      step: live ? (ordinal.get(e.current_position) || null) : null,
      steps_total: steps.length || null,
      next_run_after: live && nextJobByEnrollment[e.id] ? nextJobByEnrollment[e.id] : null,
      enrollment_status: e ? e.status : null,
    };
  });
}

// ── the pacing day ───────────────────────────────────────────────────────────
// "Up to per_day a day" needs a DAY, and a rolling 24-hour window is not one: a
// cron that fires at 14:10 sees yesterday's 14:10 admissions still inside the
// window, admits nobody, and the campaign silently skips a day - every day. The
// boundary is midnight in the ACADEMY's own timezone, which is also the day the
// academy means when it says fifteen a day.
// The zone's UTC offset AT a given instant, in ms. Derived by formatting the
// instant into the zone's wall clock and reading that clock back as if it were
// UTC; the gap between the two IS the offset in force at that instant, which is
// what makes the DST arithmetic below work.
function offsetMsAt(instant, tz) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .formatToParts(instant).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour === "24" ? "0" : p.hour), Number(p.minute), Number(p.second));
  return asUtc - instant.getTime();
}

export function startOfDayIso(now = new Date(), tz = "UTC") {
  // The whole computation is guarded, not just the first Intl call. An earlier
  // version caught only the date lookup while the two offset lookups below used
  // the raw value, so "", null, 0 and false threw RangeError out of a function
  // whose own comment promises an unknown timezone will not stop admissions. Not
  // reachable from the cron (academyTz coerces falsy to "UTC") but this is an
  // exported pure function and its contract should hold for anyone who calls it.
  const zone = (typeof tz === "string" && tz.trim()) || "UTC";
  try {
    return startOfDay(now, zone);
  } catch (_) {
    return zone === "UTC" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString() : startOfDayIso(now, "UTC");
  }
}

function startOfDay(now, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});

  // WHY NOT "subtract the elapsed wall clock from now". Because that is only
  // midnight when the offset has not changed since midnight, and it changes twice
  // a year in both academies we run (GTA is America/New_York, San Jose is
  // America/Los_Angeles). On spring-forward it landed at 23:00 the PREVIOUS day -
  // so the window swallowed yesterday's admissions and the campaign paused - and
  // on fall-back at 01:00, so an hour of today's admissions were not counted and
  // the pace could overshoot.
  //
  // Instead: take the LOCAL CALENDAR DATE, then resolve that date's midnight back
  // to an instant. The first guess uses the offset in force now; if midnight sits
  // on the other side of a transition the offset there differs, so re-resolve once
  // with the offset at the guess. One correction is sufficient for every real
  // zone (transitions are hours apart, never minutes).
  const y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day);
  const localMidnightAsUtc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const off1 = offsetMsAt(now, tz);
  let t = localMidnightAsUtc - off1;
  const off2 = offsetMsAt(new Date(t), tz);
  if (off2 !== off1) t = localMidnightAsUtc - off2;
  return new Date(t).toISOString();
}

// The automation key a campaign's messages live under. `ignition:` prefixed so the
// worker's roll-forward branches (which match `ghosted` / `nurture` / the form
// intros by exact key) never mistake a campaign for one of the standing sequences.
export const automationKeyFor = (slug) => `ignition:${String(slug || "").trim()}`;
export const isIgnitionKey = (key) => /^ignition:/.test(String(key || ""));
export const slugFromKey = (key) => (isIgnitionKey(key) ? String(key).slice("ignition:".length) : null);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

// Draft validation. Returns a list of problems; empty means the draft is sound.
// NOTHING here is skippable at approval: approve() re-runs it.
export function validateCampaignDraft(draft = {}) {
  const problems = [];
  const slug = String(draft.slug || "").trim();
  if (!slug) problems.push("slug is required.");
  else if (!SLUG_RE.test(slug)) problems.push(`slug '${slug}' must be lowercase letters, numbers and hyphens (3-50 chars).`);

  if (!String(draft.name || "").trim()) problems.push("name is required.");

  const basis = String(draft.consent_basis == null ? "" : draft.consent_basis).trim();
  if (!basis) {
    problems.push(
      "consent_basis is required. Nothing in this system records who OPTED IN - only who opted out - " +
      "so no automated check can prove we may message these people. Write where the leads came from and why we may message them."
    );
  } else if (basis.length < MIN_CONSENT_BASIS_CHARS) {
    problems.push(`consent_basis is ${basis.length} characters. Write an actual sentence: where these leads came from and why we may message them.`);
  }

  const perDay = draft.per_day == null ? DEFAULT_PER_DAY : Number(draft.per_day);
  if (!Number.isFinite(perDay) || !Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) {
    problems.push(`per_day must be a whole number between 1 and ${MAX_PER_DAY} (default ${DEFAULT_PER_DAY}).`);
  }

  const channels = Array.isArray(draft.channels) ? draft.channels : [];
  if (!channels.length) problems.push("channels is required: which of sms / email this campaign's steps use.");
  for (const c of channels) if (!CHANNELS.includes(c)) problems.push(`unknown channel '${c}' (sms | email).`);

  if (draft.state && !CAMPAIGN_STATES.includes(draft.state)) problems.push(`unknown state '${draft.state}'.`);
  return problems;
}

// ── the rails ────────────────────────────────────────────────────────────────
// None of these is optional and none of them has an override, at any level, for
// anyone. They are re-checked at ADMISSION as well as at the dry run, because days
// pass between the two and a person can become a member, get into the pipeline, or
// opt out in that gap.
export const EXCLUSION = {
  current_member: "already a member",
  in_pipeline: "already live in a pipeline stage",
  dnd: "marked do-not-disturb",
  suppressed: "unsubscribed, complained, or bounced",
  no_channel: "no working phone or email for this campaign's channels",
  already_on_campaign: "already on this campaign",
  // NOT rails - FAILURES. The person is fine; something on our side did not work.
  // Kept distinct so the roster never tells staff somebody was refused when they
  // were not, and so the row stays queued for the next pass instead of being
  // written off.
  no_card: "could not create a pipeline card for them - not admitted, will retry",
  not_enrolled: "the campaign's automation would not enrol them - not admitted, nothing sent, will retry",
  // A rail, and a hard one. See the note in screenCandidate.
  already_replied: "they already replied to this campaign",
};

const has10Digits = (raw) => String(raw || "").replace(/\D/g, "").length >= 10;
const looksLikeEmail = (raw) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || "").trim());

// screenCandidate(candidate, campaign) -> { ok:true } | { ok:false, code, reason }
//
// FAILS CLOSED on every field. `dnd` must be explicitly false: undefined, null, a
// string, a failed lookup - anything that is not the boolean false excludes the
// person. A rail that reads "we could not tell, so send it" is not a rail.
export function screenCandidate(candidate = {}, campaign = {}) {
  const no = (code) => ({ ok: false, code, reason: EXCLUSION[code] || code });

  if (candidate.already_on_campaign === true) return no("already_on_campaign");

  // NOBODY GETS A CAMPAIGN STEP AFTER THEY HAVE ANSWERED. That promise is flat,
  // and until the in_pipeline exemption existed the rail enforced it as a side
  // effect: a person who replied had a card in the destination stage, so the rail
  // excluded them. The exemption made re-admission reachable, and nothing else in
  // the system would have stopped it - `enrollContact` treats only an ACTIVE
  // enrolment as "already enrolled", so a reply-EXITED one gets a brand-new
  // enrolment at step 1. The promise now has its own check instead of relying on a
  // side effect of a different one.
  if (candidate.replied_on_campaign === true) return no("already_replied");

  if (candidate.is_member !== false) return no("current_member");

  // Any OPEN opportunity, in any stage, means somebody is already working them -
  // EXCEPT a card THIS campaign created itself.
  //
  // Admission is: screen, create the card, enrol, write the roster row. A failure
  // after the card is created leaves an open opportunity sitting in `reignition`
  // that we made, and the rails are re-screened from live data every pass. Without
  // this exemption our own half-finished admission becomes the reason the rails
  // reject the person on the next pass, they get marked excluded, and staff are
  // told "already live in a pipeline stage" when the only thing in that stage is
  // our own orphan. Retrying instead reuses that card (placeCard moves an existing
  // one rather than creating a second), so the orphan becomes the real card and
  // there is nothing to clean up.
  //
  // Narrow and fail-closed by construction: it takes an EXACT match on both the
  // reignition role AND this campaign's own entry point, which only createOpp in
  // this feature ever writes. A card in any other stage, or one written by another
  // campaign or another door, still excludes.
  const ours = candidate.open_stage_role === REIGNITION_ROLE &&
    campaign.slug && candidate.open_entry_point === `ignition:${campaign.slug}`;
  if (!ours && candidate.open_stage_role != null && candidate.open_stage_role !== false) return no("in_pipeline");
  if (candidate.dnd !== false) return no("dnd");
  if (candidate.email_suppressed !== false) return no("suppressed");

  // Reachability, per channel the campaign actually uses. ALL of them, not any:
  // a person with no email on an sms+email campaign silently drops half the
  // sequence, and a half-sent campaign is worse than not adding them.
  const channels = Array.isArray(campaign.channels) && campaign.channels.length ? campaign.channels : CHANNELS;
  for (const ch of channels) {
    if (ch === "sms" && !has10Digits(candidate.phone)) return no("no_channel");
    if (ch === "email" && !looksLikeEmail(candidate.email)) return no("no_channel");
  }
  return { ok: true };
}

// ── the dry run ──────────────────────────────────────────────────────────────
// The gate. Produces the EXACT roster, the count, and everyone excluded WITH the
// reason. Nothing sends in draft state, and this function sends nothing ever - it
// is a report. `problems` non-empty means the campaign cannot be approved.
export function buildDryRun({ campaign = {}, candidates = [] } = {}) {
  const problems = validateCampaignDraft(campaign);
  const roster = [];
  const excluded = [];
  for (const c of candidates) {
    const verdict = screenCandidate(c, campaign);
    if (verdict.ok) roster.push({ contact_id: String(c.contact_id), name: c.name || null });
    else excluded.push({ contact_id: String(c.contact_id), name: c.name || null, code: verdict.code, reason: verdict.reason });
  }
  return {
    slug: campaign.slug || null,
    name: campaign.name || null,
    state: campaign.state || "draft",
    // Shown BESIDE the roster, deliberately, because it is the only thing standing
    // in for consent and the approver is the check.
    consent_basis: String(campaign.consent_basis == null ? "" : campaign.consent_basis).trim() || null,
    per_day: campaign.per_day == null ? DEFAULT_PER_DAY : Number(campaign.per_day),
    channels: Array.isArray(campaign.channels) ? campaign.channels : [],
    count: roster.length,
    roster,
    excluded,
    excluded_count: excluded.length,
    days_to_launch: roster.length ? Math.ceil(roster.length / Math.max(1, Number(campaign.per_day) || DEFAULT_PER_DAY)) : 0,
    problems,
    approvable: problems.length === 0 && roster.length > 0,
  };
}

// ── pacing ───────────────────────────────────────────────────────────────────
// planAdmissions decides WHO enters the stage today. It is the whole of pacing.
// A campaign that is not running admits nobody, which is how halt works: the
// unreached are simply never reached, and nothing has to be cancelled to achieve
// that because nothing was ever queued for them.
export function planAdmissions({ campaign = {}, roster = [], admittedToday = 0 } = {}) {
  const state = String(campaign.state || "draft");
  if (state !== "approved" && state !== "running") {
    return { admit: [], reason: state === "halted" ? "campaign halted" : `campaign is '${state}', not running`, remaining_today: 0 };
  }
  const perDay = Number(campaign.per_day) > 0 ? Number(campaign.per_day) : DEFAULT_PER_DAY;
  const room = Math.max(0, perDay - Math.max(0, Number(admittedToday) || 0));
  const queued = roster
    .filter((r) => String(r.state) === "queued")
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  return {
    admit: queued.slice(0, room),
    reason: room === 0 ? "daily pace reached" : null,
    remaining_today: Math.max(0, room - Math.min(room, queued.length)),
    still_queued: Math.max(0, queued.length - room),
  };
}

// ── the two ways out, in order ───────────────────────────────────────────────
// THE RULE: moving stages never sends a message. Only the destination's engine
// speaks, and each kind of engine speaks in its own way.
//
// The order below is not a preference, it is the guarantee. Between "cancel the
// remaining steps" and "move the card" there is a window; if the move happens
// first, a queued step can fire into that window and land campaign step 3 on top
// of a person who already answered step 1. So: CANCEL FIRST, always.
export const REPLY_EXIT_ORDER = ["cancel_unsent_steps", "move_card", "engine_speaks"];
export const RAN_OUT_EXIT_ORDER = ["move_card", "enrol_destination"];

// runReplyExit - dependency-injected so the ORDER is testable without a database.
//   deps.cancelUnsentSteps({ clientId, contactId, automationKey })  -> cancels every
//        pending/sending job + exits the enrollment (api/automations.js exitEnrollment).
//   deps.moveCard({ clientId, contactId, fromRole, trigger })       -> the router.
// Returns { ok, order } where `order` is what actually happened, in sequence.
export async function runReplyExit({ clientId, contactId, automationKey } = {}, deps = {}) {
  const order = [];
  if (!clientId || !contactId) return { ok: false, order, error: "missing clientId/contactId" };

  // 1. Cancel FIRST. If this throws, we do NOT move: a card sitting in Reignition
  //    with live queued steps is recoverable next pass; a card moved on with live
  //    queued steps sends a script on top of a real conversation.
  await deps.cancelUnsentSteps({ clientId, contactId, automationKey });
  order.push("cancel_unsent_steps");

  // 2. Then move. The router reads the `reignition + replied` edge from the preset
  //    master, so where it lands is whatever that sales system declared.
  const moved = await deps.moveCard({ clientId, contactId, fromRole: REIGNITION_ROLE, trigger: "replied" });
  order.push("move_card");

  // 3. Nothing here calls an agent. The destination's engine picks the lead up on
  //    its own, reads the thread, and answers what they actually said. The intro
  //    message deliberately never fires: they are mid-conversation, not a new form
  //    fill, and "thanks for reaching out!" after they answered our own text reads
  //    as a bot.
  return { ok: true, order, moved: moved || null };
}

// runRanOutExit - the silent handoff. The campaign said its last word and got
// nothing back. No message is sent by this transition; the destination sequence
// enrols at ITS step one with ITS own clock, which is why there is a natural quiet
// gap between the campaign's last message and nurture's first.
export async function runRanOutExit({ clientId, contactId } = {}, deps = {}) {
  const order = [];
  if (!clientId || !contactId) return { ok: false, order, error: "missing clientId/contactId" };
  const moved = await deps.moveCard({ clientId, contactId, fromRole: REIGNITION_ROLE, trigger: "ran_out" });
  order.push("move_card");
  // `already_moved` means the card had left Reignition before this pass ran (the
  // lead booked, converted, or was closed). Enrolling then would drop them into a
  // sequence for a stage they are not in - the whole reason the mover reports it.
  if (moved && moved.role && !moved.already_moved && deps.enrolDestination) {
    await deps.enrolDestination({ clientId, contactId, role: moved.role });
    order.push("enrol_destination");
  }
  return { ok: true, order, moved: moved || null, silent: true };
}

// ── admission ────────────────────────────────────────────────────────────────
// Put the card in the stage, THEN enrol. The placement is silent; the enrolment is
// the engine speaking. Rails are re-screened here and nothing skips them.
//
// THE SHAPE OF THIS FUNCTION IS THE POINT. Admission is a chain of steps that can
// each fail, and EVERY step is verified against what it returned - not just the
// one that failed in review. The first version trusted placement, which made the
// whole feature inert. The second version verified placement and trusted the
// enrolment, which stranded people: `enrollContact` never throws for its own
// refusals, it RETURNS them, so five different refusals ("no enabled+approved
// automation", "no enabled steps", "enroll race", "enroll failed", "could not
// schedule the first step") all read as success. Somebody could sit marked
// `admitted`, having received nothing, forever - reconcile skips them (no
// enrollment to read), the campaign never completes (they still count as live),
// and the card we made now trips the in_pipeline rail on every future campaign.
//
// So there are exactly THREE outcomes, and every caller must handle all three:
//
//   { admitted:true  }              in the stage, enrolled, step 1 queued.
//   { admitted:false, rail:true  }  a RAIL refused them. Terminal: mark excluded.
//   { admitted:false, rail:false }  something FAILED. Not their fault, nothing was
//                                   sent, nothing is marked. Leave the row queued
//                                   and try again next pass.
//
// The rail/failure split is the difference between telling staff "we will not
// message this person" and telling them "we could not, yet". Collapsing the two
// writes people off for our own outages.
export async function runAdmission({ clientId, contactId, campaign, candidate } = {}, deps = {}) {
  const fail = (code, reason, detail) => ({ admitted: false, rail: false, code, reason, detail: detail || null });

  const verdict = screenCandidate(candidate || {}, campaign || {});
  if (!verdict.ok) return { admitted: false, rail: true, code: verdict.code, reason: verdict.reason };

  // 1. The card. MAKE it exist, do not merely look for one: everyone who reaches
  //    here has no open opportunity by definition, because the in_pipeline rail
  //    excluded everyone who did.
  const card = await deps.placeCard({ clientId, contactId, toRole: REIGNITION_ROLE, reason: `reignition campaign '${campaign.slug}'` });
  if (!card || card.ok !== true) return fail("no_card", EXCLUSION.no_card, (card && card.error) || null);

  // 2. The enrolment. THE TEST IS AN ENROLMENT ID, not the absence of a throw.
  //    Both legitimate outcomes carry one - a fresh enrolment ({ok:true, id}) and
  //    the idempotent retry ({skipped:"already enrolled", id}), which is a real
  //    admission and must not be treated as a failure. Every refusal shape lacks
  //    one. Testing for the id rather than enumerating today's refusal strings
  //    means a refusal added later is handled correctly on the day it is written,
  //    instead of silently stranding somebody.
  const enrolled = await deps.enrol({ clientId, contactId, automationKey: automationKeyFor(campaign.slug) });
  const enrollmentId = enrolled && enrolled.enrollment_id;
  if (!enrollmentId) {
    return fail("not_enrolled", EXCLUSION.not_enrolled,
      (enrolled && (enrolled.skipped || enrolled.error)) || "enrol returned no enrollment id");
  }

  // 3. THE ID IS NECESSARY, NOT SUFFICIENT. `admitted` claims step 1 is queued,
  //    and only ONE of the two id-carrying returns actually earns that: the fresh
  //    enrolment is reached after the step job was scheduled, but the idempotent
  //    one is a bare lookup for an active enrolment row and says nothing about
  //    jobs. There is a real path to an active enrolment with ZERO jobs -
  //    enrollContact's compensating "mark exited" is best-effort, so one Supabase
  //    blip covering both the schedule and the compensation leaves one behind -
  //    and from then on every pass gets {skipped:"already enrolled", id} and
  //    admits somebody who will never be sent anything. That is the original
  //    stranding bug arriving through the one shape allowed to carry an id.
  //
  //    So the claim is verified directly, for BOTH branches, rather than trusted
  //    for one of them: does this enrolment have a step job at all? ANY status
  //    counts - job rows are never deleted, so one existing proves step 1 was
  //    scheduled, and asking for `pending` specifically would race a worker that
  //    has already sent it.
  const scheduled = await deps.hasScheduledStep({ clientId, contactId, enrollmentId });
  if (scheduled !== true) {
    // Self-heal rather than retry into the same wall forever: this enrolment can
    // never produce a job, and while it exists `enrollContact` will keep answering
    // "already enrolled". Retiring it lets the NEXT pass enrol cleanly. Best-effort
    // -  if it fails we simply try again next pass, still having sent nothing.
    if (deps.retireStalledEnrolment) {
      try { await deps.retireStalledEnrolment({ clientId, enrollmentId }); } catch (_) { /* next pass retries */ }
    }
    return fail("not_enrolled", EXCLUSION.not_enrolled,
      `enrolment ${enrollmentId} exists but no step was ever scheduled for it (retired so the next pass can re-enrol)`);
  }

  return { admitted: true, enrollment: enrolled, enrollment_id: enrollmentId, card };
}

// ── cancelling has to be verifiable, not merely attempted ────────────────────
// "A failed cancel aborts the move" is only true if a failed cancel can be SEEN.
// The generic exitEnrollment swallows per-enrollment errors and always answers
// {ok:true}, so a job-cancel PATCH that silently matched nothing would let the
// move proceed and the queued step would still fire. The reignition cancel path
// therefore re-reads and calls this, which THROWS - and the throw is what stops
// runReplyExit before the card moves.
//
// It asserts the list is EMPTY rather than checking for known-bad statuses. The
// caller's query already filters to status in (pending, sending), so anything
// coming back is by definition a live job. Matching named statuses would mean a
// status nobody anticipated - a new one, a typo, a null - reads as safe, and this
// is the one function in the feature whose entire job is to fail closed.
export function assertStepsCancelled(remainingJobs = []) {
  const live = remainingJobs || [];
  if (live.length) {
    throw new Error(
      `reignition cancel FAILED: ${live.length} campaign step job(s) still live after the cancel ` +
      `(statuses: ${[...new Set(live.map((j) => (j && j.status) || "unknown"))].join(", ")}). ` +
      "Refusing to move the card - a queued step would land on top of someone who has already replied."
    );
  }
  return true;
}
