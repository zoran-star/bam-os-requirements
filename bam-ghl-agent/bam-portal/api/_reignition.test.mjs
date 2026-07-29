// REIGNITION: the station, the rails, the pacing, and the order of the exits.
//
//   node api/_reignition.test.mjs        # exits non-zero on any failure
//
// Plain node, no deps, no network, no database - the same house style as
// api/_sync-class.test.mjs and api/_gta-step-lock.test.mjs (vitest.config.ts only
// includes api/_runtime, api/runtime, api/parent, api/client; these api/*.test.mjs
// files are run directly).
//
// WHAT THIS COVERS, AND WHY EACH ONE IS HERE RATHER THAN ASSUMED
//
//   1. THE ATTACHMENT REFUSES A BAD SALES SYSTEM. The whole safety argument for
//      reignition rests on one claim: a reply always lands somewhere that can
//      answer it. That claim is only worth anything if a preset declaring
//      otherwise actually fails. So a hand-built preset whose `replied` exit
//      points at a drip must throw, loudly, at attach time.
//
//   2. THE RAILS EXCLUDE EACH CATEGORY, AND FAIL CLOSED. Not "the rails run" -
//      each category individually, plus the unknown-data cases. A rail that reads
//      "we could not tell, so send it" is not a rail, and the only way to know
//      which way an unknown falls is to check.
//
//   3. A REPLY CANCELS BEFORE IT MOVES. Between cancel and move there is a window.
//      Get the order wrong and a queued campaign step fires into it and lands
//      "just checking in!" on top of someone who already answered. The test
//      records what actually happened, in sequence, and asserts the sequence.
//
//   4. ADMISSION RESPECTS per_day. Pacing is the door, not the messages, so the
//      only thing that enforces it is planAdmissions.
//
//   5. HALT NEVER REACHES THE UNREACHED. Halting must admit nobody. Nothing has to
//      be cancelled to achieve that, which is exactly why it is worth proving.
//
//   6. consent_basis IS REQUIRED. It is the only thing standing in for consent
//      (nothing in this system records who opted IN), so a campaign without one
//      must be unapprovable, not merely discouraged.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. A suite that only ever passes proves nothing. Each of these
// breaks one real guarantee and MUST be caught:
//
//   MUTATE=exit-order    node api/_reignition.test.mjs  # move the card BEFORE cancelling
//   MUTATE=rails         node api/_reignition.test.mjs  # let an unknown dnd through
//   MUTATE=pace          node api/_reignition.test.mjs  # ignore per_day, admit everyone
//   MUTATE=consent       node api/_reignition.test.mjs  # accept a blank consent basis
//   MUTATE=attach        node api/_reignition.test.mjs  # accept a drip as a reply target
//   MUTATE=no-card        node api/_reignition.test.mjs # admit without a pipeline card
//   MUTATE=no-enrol       node api/_reignition.test.mjs # admit without an enrolment
//   MUTATE=own-card       node api/_reignition.test.mjs # let our own orphan card exclude
//   MUTATE=day            node api/_reignition.test.mjs # pace on a rolling 24h window
//   MUTATE=dst            node api/_reignition.test.mjs # the pre-DST-fix day boundary
//   MUTATE=cancel-verify  node api/_reignition.test.mjs # cancel without checking it worked
//   MUTATE=bounce-roles   node api/_reignition.test.mjs # drift the webhook role list
//   MUTATE=bounce-negate  node api/_reignition.test.mjs # invert the reply-bounce guard
//   MUTATE=bounce-and     node api/_reignition.test.mjs # || becomes && (nobody bounces)
//   MUTATE=bounce-disable node api/_reignition.test.mjs # if (false && ...)
//   MUTATE=bounce-dest    node api/_reignition.test.mjs # repoint ONLY the guarded move
//   MUTATE=reply-rail     node api/_reignition.test.mjs # re-admit somebody who replied
//   MUTATE=replied-catch  node api/_reignition.test.mjs # swallow the reply read again
//
// Each must report NEGATIVE CONTROL PASSED. If one reports FAILED, the check it
// targets is decorative and must not be quoted as evidence that reignition is safe.
//
// Everything from `no-card` down exists because a tester found the check it guards
// missing or weak, and every one of them was a defect that shipped green:
//   no-card / no-enrol  admission trusted a downstream step instead of verifying
//                       it. no-card made the feature silently inert; no-enrol
//                       marked people admitted who were never enrolled or messaged
//                       and could never be reached again.
//   own-card            a card THIS campaign created excluded the person from
//                       their own retry, and told staff they were already in the
//                       pipeline.
//   day / dst           the pacing window skipped a day every day, then skipped or
//                       double-counted one on each DST change, in both academies.
//   cancel-verify       "a failed cancel aborts the move" was a comment.
//   bounce-*            the reply-bounce guard could be negated, ANDed, disabled,
//                       or have a role added or dropped, and the suite stayed
//                       green - on the one code path every reply of every academy
//                       goes through.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateReignitionAttachment, buildReignitionStation, attachReignition,
  REIGNITION_ROLE,
} from "./agent/reignition-station.js";
import {
  screenCandidate, buildDryRun, planAdmissions, validateCampaignDraft,
  runReplyExit, runRanOutExit, runAdmission, automationKeyFor, isRosterState,
  DEFAULT_PER_DAY, EXCLUSION, startOfDayIso, rosterProgress, assertStepsCancelled,
} from "./agent/reignition.js";
import { PRESETS, buildPresetRows, presetContents } from "./agent/presets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MUTATE = process.env.MUTATE || "";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, m) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { fail++; failures.push(m); console.log("  ❌ " + m); }
};

// ── the mutations ────────────────────────────────────────────────────────────
// Applied to COPIES of the real behaviour, never to the files on disk. Each one
// models a plausible mistake a future edit could make, not a random breakage.

// #1 order of operations: the classic "move it, then tidy up" refactor.
async function replyExitUnderTest(args, deps) {
  if (MUTATE !== "exit-order") return runReplyExit(args, deps);
  const order = [];
  const moved = await deps.moveCard({ clientId: args.clientId, contactId: args.contactId, fromRole: REIGNITION_ROLE, trigger: "replied" });
  order.push("move_card");
  await deps.cancelUnsentSteps(args);
  order.push("cancel_unsent_steps");
  return { ok: true, order, moved };
}

// #2 the rails: "dnd is truthy? then exclude" - reads fine, waves through every
//    person whose dnd column could not be read at all.
function screenUnderTest(candidate, campaign) {
  if (MUTATE !== "rails") return screenCandidate(candidate, campaign);
  const c = { ...candidate };
  if (c.dnd !== true) c.dnd = false;
  if (c.email_suppressed !== true) c.email_suppressed = false;
  return screenCandidate(c, campaign);
}

// #3 pacing: an "optimisation" that admits the whole queue in one pass.
function planUnderTest(args) {
  if (MUTATE !== "pace") return planAdmissions(args);
  const queued = (args.roster || []).filter((r) => r.state === "queued");
  return { admit: queued, reason: null, remaining_today: 0, still_queued: 0 };
}

// #4 consent: dropping the "is it actually written" half of the check.
function draftProblemsUnderTest(draft) {
  if (MUTATE !== "consent") return validateCampaignDraft(draft);
  return validateCampaignDraft(draft).filter((p) => !/consent_basis/.test(p));
}

// #5 attachment: the "an automation can answer too" mistake.
function attachProblemsUnderTest(preset, exits) {
  if (MUTATE !== "attach") return validateReignitionAttachment(preset, exits);
  return validateReignitionAttachment(preset, exits).filter((p) => !/'replied' exit/.test(p));
}

// #6/#6b admission trusting a downstream step instead of verifying it. Two
//    mutations, the same shape one stage apart: `no-card` trusts placement,
//    `no-enrol` trusts the enrolment (which never throws for its own refusals, it
//    returns them - so this is the exact code that stranded people).
async function admitUnderTest(args, deps) {
  if (MUTATE !== "no-card" && MUTATE !== "no-enrol") return runAdmission(args, deps);
  const verdict = screenCandidate(args.candidate || {}, args.campaign || {});
  if (!verdict.ok) return { admitted: false, code: verdict.code, reason: verdict.reason, rail: true };
  const card = await deps.placeCard({ clientId: args.clientId, contactId: args.contactId, toRole: REIGNITION_ROLE });
  if (MUTATE === "no-enrol" && (!card || card.ok !== true)) return { admitted: false, rail: false, code: "no_card", reason: EXCLUSION.no_card };
  const enrolled = await deps.enrol({ clientId: args.clientId, contactId: args.contactId, automationKey: "ignition:x" });
  // The mutation is "trust the enrolment": no id check, and no scheduled-step check.
  return { admitted: true, enrollment: enrolled || null, enrollment_id: enrolled && enrolled.enrollment_id };
}

// #6c the rails counting a card this campaign created against its own retry.
function screenOwnCardUnderTest(candidate, campaign_) {
  if (MUTATE !== "own-card") return screenCandidate(candidate, campaign_);
  const c = { ...candidate, open_entry_point: "something-else" };
  return screenCandidate(c, campaign_);
}

// #7 the pacing day: `day` is the rolling 24-hour window, `dst` is the pre-fix
//    "subtract the elapsed local wall clock" version that was correct except on
//    the two days a year the offset moves - in both academies we run.
function dayStartUnderTest(now, tz) {
  if (MUTATE === "day") return new Date(now.getTime() - 86400000).toISOString();
  if (MUTATE === "dst") {
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
        .formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});
    } catch (_) { return startOfDayIso(now, "UTC"); }
    const h = Number(parts.hour === "24" ? "0" : parts.hour), m = Number(parts.minute), s = Number(parts.second);
    return new Date(now.getTime() - ((h * 3600 + m * 60 + s) * 1000) - now.getMilliseconds()).toISOString();
  }
  return startOfDayIso(now, tz);
}

// #8 a cancel that reports success without checking anything came back cancelled.
function assertCancelledUnderTest(remaining) {
  if (MUTATE !== "cancel-verify") return assertStepsCancelled(remaining);
  return true;
}

// #9 the reply-bounce guard drifting. Applied to the string the assertion LOOKS
//    FOR, which models the live file changing without editing the live file. Each
//    of these shipped green against the previous set-of-roles version:
//      roles       one role added, one dropped
//      negate      the whole condition inverted
//      and         `||` becomes `&&` - nobody ever bounces
//      disable     `if (false && ...)`
//    (repointing the destination and dropping the provider guard are caught by the
//    two assertions beside the condition check, not by this string.)
// #10 the reply rail removed - re-admitting somebody who already answered, which
//     is the one thing the design promises flatly never happens.
function replyRailUnderTest(candidate, campaign_) {
  if (MUTATE !== "reply-rail") return screenCandidate(candidate, campaign_);
  return screenCandidate({ ...candidate, replied_on_campaign: false }, campaign_);
}

// #9b the DESTINATION of the guarded move being repointed - applied to the
//     extracted block, which models that one move changing while its sibling in
//     the same file (the GHL-provider branch) stays correct. That asymmetry is
//     exactly what the previous whole-file check could not see.
function blockUnderTest(block) {
  if (MUTATE !== "bounce-dest" || !block) return block;
  return block.replace('stage: rs, role: "responded"', 'stage: ns, role: "nurture"');
}

function conditionUnderTest(cond) {
  switch (MUTATE) {
    case "bounce-roles":
      return cond.replace(' || opp.stage_role === "nurture"', "").replace('(opp.stage_role === "ghosted"', '(opp.stage_role === "responded" || opp.stage_role === "ghosted"');
    case "bounce-negate":
      return cond.replace("if (opp && (", "if (opp && !(");
    case "bounce-and":
      return cond.replace(/ \|\| /g, " && ");
    case "bounce-disable":
      return cond.replace("if (opp && (", "if (false && (");
    default:
      return cond;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const agentStage = (role) => ({ role, label: role, position: 0, entry: {}, engine: { kind: "agent", template: "trial_booking" }, exits: [] });
const dripStage  = (role) => ({ role, label: role, position: 1, entry: {}, engine: { kind: "automation", key: role }, exits: [] });
const humanStage = (role) => ({ role, label: role, position: 2, entry: {}, engine: { kind: "human" }, exits: [] });

const goodPreset = () => ({ key: "test_good", stages: [agentStage("responded"), dripStage("nurture")] });
const humanPreset = () => ({ key: "test_human", stages: [humanStage("responded"), dripStage("nurture")] });
// The pipeline this whole check exists to stop: a reply answered by a drip.
const dripAnswersReplies = () => ({ key: "test_bad", stages: [dripStage("responded"), dripStage("nurture")] });
// The mirror-image mistake: a full ghost handed to an agent as if they had spoken.
const agentCatchesSilence = () => ({ key: "test_bad2", stages: [agentStage("responded"), agentStage("nurture")] });

const campaign = (over = {}) => ({
  slug: "summer-restart", name: "Summer restart", state: "draft",
  consent_basis: "Leads imported from the academy's own GHL account, all enquired about training in the last 18 months.",
  per_day: 15, channels: ["sms"], ...over,
});
// Admission deps that all succeed, so a test only has to state the one it is
// exercising. `hasScheduledStep` answering true is the healthy case.
const okDeps = (over = {}) => ({
  placeCard: async () => ({ ok: true, role: "reignition", created: true }),
  enrol: async () => ({ ok: true, enrollment_id: "e1" }),
  hasScheduledStep: async () => true,
  retireStalledEnrolment: async () => {},
  ...over,
});

const person = (over = {}) => ({
  contact_id: "c1", name: "Maya A.", phone: "+14085550114", email: "maya@example.com",
  dnd: false, is_member: false, open_stage_role: null, email_suppressed: false, already_on_campaign: false, ...over,
});

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. THE ATTACHMENT: refuse a sales system that would answer a human with a drip ──");

ok(attachProblemsUnderTest(goodPreset()).length === 0,
  "an agent `responded` + an automation `nurture` attaches cleanly");
ok(validateReignitionAttachment(humanPreset()).length === 0,
  "a HUMAN-worked `responded` attaches too (a person can answer a reply)");

const bad = attachProblemsUnderTest(dripAnswersReplies());
ok(bad.length > 0, "REFUSED: `replied` pointing at an automation stage");
ok(bad.some((p) => /agent or a human/.test(p)),
  "...and the refusal says why: a reply must land on an agent or a human");

const bad2 = validateReignitionAttachment(agentCatchesSilence());
ok(bad2.length > 0, "REFUSED: `ran_out` pointing at an agent stage");
ok(bad2.some((p) => /never onto a talker/.test(p)),
  "...and the refusal says why: silence rolls into an automation or out, never onto a talker");

ok(validateReignitionAttachment(goodPreset(), { replied: "does_not_exist", ran_out: "nurture" }).length > 0,
  "REFUSED: `replied` pointing at a role the sales system does not have");
ok(validateReignitionAttachment(goodPreset(), { replied: "responded", ran_out: null }).length > 0,
  "REFUSED: no `ran_out` exit at all");
ok(validateReignitionAttachment(goodPreset(), { replied: "responded", ran_out: { terminal: "unqualified" } }).length === 0,
  "ALLOWED: `ran_out` straight to a terminal (a sales system with no long game)");

// The refusal has to be a THROW, not a return value somebody can ignore.
let threw = false;
try { buildReignitionStation(dripAnswersReplies()); } catch (e) { threw = /REIGNITION ATTACHMENT REFUSED/.test(e.message); }
ok(MUTATE === "attach" ? true : threw, "buildReignitionStation THROWS on a refused preset (not a soft return)");

let attachThrew = false;
try { attachReignition(dripAnswersReplies()); } catch (_) { attachThrew = true; }
ok(MUTATE === "attach" ? true : attachThrew, "attachReignition THROWS too - a bad sales system fails at import, not at runtime");

console.log("\n── 1b. The station itself: MANUAL ONLY, exits by role ──");
const station = buildReignitionStation(goodPreset());
ok(station.role === REIGNITION_ROLE && station.label === "Reignition", "the station is role 'reignition', label 'Reignition'");
ok(!station.entry.trigger, "NO entry trigger - reignition is never a pipeline front door for new leads");
ok(!station.entry.sources || !station.entry.sources.length, "NO entry sources - no form feeds it, no calendar feeds it");
ok(station.exits.length === 4, "four exits: replied, ran_out, marked_unqualified, complaint_offtopic");
const byTrigger = Object.fromEntries(station.exits.map((e) => [e.trigger, e]));
ok(byTrigger.replied.toKind === "stage" && byTrigger.replied.toRole === "responded", "replied -> the responded ROLE (not a named stage)");
ok(byTrigger.ran_out.toKind === "stage" && byTrigger.ran_out.toRole === "nurture", "ran_out -> the nurture ROLE");
ok(byTrigger.marked_unqualified.toKind === "terminal" && byTrigger.marked_unqualified.terminal === "unqualified", "marked_unqualified -> @unqualified (terminal)");
ok(byTrigger.complaint_offtopic.toKind === "terminal" && byTrigger.complaint_offtopic.terminal === "human", "complaint_offtopic -> @human (terminal)");
ok(station.attachOnUse === true, "flagged attachOnUse: stamped on first campaign, not on every preset apply");

console.log("\n── 1c. THIS IS WHERE THE RULE IS ENFORCED, not at module load ──");
// api/agent/presets.js attaches the station inside a try/catch that LOGS instead
// of throwing, on purpose: that module is imported by the automation worker, all
// four inbound webhooks, the router, the agent brain, the board and apply-preset,
// so a throw there would take the portal down over a mis-declared exit. The rule
// is design-time, so THIS is the check that must fail a build. A preset whose
// exits are wrong has no station, and the assertion below is what catches it.
for (const key of Object.keys(PRESETS)) {
  const problems = validateReignitionAttachment({ ...PRESETS[key], stages: (PRESETS[key].stages || []).filter((s) => s.role !== REIGNITION_ROLE) });
  ok(problems.length === 0,
    `preset '${key}' declares reignition-safe exits${problems.length ? `: ${problems.join(" / ")}` : ""}`);
  const s = (PRESETS[key].stages || []).find((x) => x.role === REIGNITION_ROLE);
  ok(!!s, `preset '${key}' carries the reignition station (absent = attachment was refused at load; read the [presets] error in the log)`);
  if (!s) continue;
  const rows = buildPresetRows(key, "test-client", null);
  ok(!rows.stageRows.some((r) => r.role === REIGNITION_ROLE),
    `preset '${key}' applyPreset still stamps NO reignition stage row (first use stamps it)`);
  ok(rows.transitionRows.some((r) => r.from_stage_role === REIGNITION_ROLE && r.trigger === "replied"),
    `preset '${key}' compiles the reignition edges (the router reads them from the master)`);
}
{
  // And the flip side of that: presets.js must NOT throw at import. It is imported
  // by the automation worker, all four inbound webhooks, the router, the agent
  // brain, the board and apply-preset - a throw there turns a mis-declared exit
  // into a portal-wide outage. Pinned as text because the only way to observe it
  // otherwise is to break a preset and watch production fall over.
  const src = fs.readFileSync(path.join(HERE, "agent", "presets.js"), "utf8");
  const loop = src.slice(src.indexOf("for (const key of Object.keys(PRESETS))"));
  ok(/try\s*{[\s\S]{0,200}attachReignition/.test(loop) && /catch/.test(loop.slice(0, 600)),
    "presets.js attaches inside try/catch - a refused station degrades reignition, never the portal");
}
ok(buildPresetRows("free_trial", "c", null).stageRows.length === 5,
  "free_trial still stamps exactly its 5 stage anchors - attaching the station changed nothing an academy gets");
ok((presetContents("free_trial").stages.find((s) => s.role === REIGNITION_ROLE) || {}).engine === "campaign",
  "the station reads as engine 'campaign', never 'human' (which would satisfy the reply check by accident)");
console.log("\n── 1d. The reply-bounce guard in the four inbound webhooks, pinned VERBATIM ──");
// This is the one file set where a mistake reaches every lead of every academy on
// every reply, so it is pinned as an exact string rather than parsed.
//
// A set-of-roles check is not enough, and a tester proved it: extracting the role
// names and comparing the SET shipped green while the condition was negated (every
// booked, won and scheduled lead yanked to Responded on any reply), while `||`
// became `&&` (nobody ever bounces, every academy), while it was disabled outright
// with `if (false && ...)`, while the destination was repointed from Responded to
// Nurture, and while the portal-provider guard was deleted.
//
// The destination check has to be ANCHORED, which is the trap the previous version
// fell into: every one of these files contains TWO `stage: rs, role: "responded"`
// moves - the portal-store one this condition guards, and the GHL-provider one
// below it - so an existence check over the whole file stayed green while the
// guarded move alone was repointed. So: extract the guarded block by brace
// matching from the condition, assert INSIDE it, and assert the file-wide COUNT of
// those moves separately so repointing the sibling is caught too.
//
// Whitespace is normalised first so a prettier-style line break is not a failure -
// the earlier one-physical-line rule would have reddened the build for reformatting.
{
  const EXPECTED_COND =
    'if (opp && (opp.stage_role === "ghosted" || opp.stage_role === "interested" ' +
    '|| opp.stage_role === "nurture" || opp.stage_role === "reignition")) {';
  const WEBHOOKS = [
    "ghl/inbound-webhook.js",
    "email/sync-gmail.js",
    "resend/inbound-webhook.js",
    "twilio/inbound-webhook.js",
  ];
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  const wanted = conditionUnderTest(squash(EXPECTED_COND));

  // The body between the condition's `{` and its matching `}`.
  const guardedBlock = (src, at) => {
    let depth = 0;
    for (let i = at; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
    }
    return null;
  };

  for (const rel of WEBHOOKS) {
    const src = squash(fs.readFileSync(path.join(HERE, rel), "utf8"));
    const hits = src.split(wanted).length - 1;
    ok(hits === 1, `${rel}: the reply-bounce condition appears VERBATIM, exactly once${hits === 1 ? "" : ` (found ${hits})`}`);

    // ANCHORED: the move INSIDE the block this condition guards.
    const at = src.indexOf(wanted);
    const block = at === -1 ? null : blockUnderTest(guardedBlock(src, at + wanted.length - 1));
    ok(!!block && /moveStage\(\{[^;]*?stage: rs, role: "responded"/.test(block),
      `${rel}: the move INSIDE the guarded block lands on role "responded"`);

    // And the sibling: both moves in the file still go to Responded, so repointing
    // the GHL-provider branch instead is caught as well.
    ok((src.match(/stage: rs, role: "responded"/g) || []).length === 2,
      `${rel}: both reply-bounce moves (portal + GHL branch) still land on "responded"`);

    ok(src.includes('provider === "portal"'),
      `${rel}: the portal-provider guard is still in place`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. THE RAILS: each category, no override, fail closed ──");

ok(screenUnderTest(person(), campaign()).ok === true, "a reachable, opted-in-by-omission, not-a-member lead passes");

const cases = [
  ["current members", { is_member: true }, "current_member"],
  ["anyone already live in a pipeline stage", { open_stage_role: "responded" }, "in_pipeline"],
  ["...including someone already in reignition", { open_stage_role: "reignition" }, "in_pipeline"],
  ["do-not-disturb", { dnd: true }, "dnd"],
  ["unsubscribed / complained / bounced", { email_suppressed: true }, "suppressed"],
  ["no working phone for an sms campaign", { phone: "555" }, "no_channel"],
  ["already on this campaign", { already_on_campaign: true }, "already_on_campaign"],
];
for (const [what, over, code] of cases) {
  const v = screenUnderTest(person(over), campaign());
  ok(v.ok === false && v.code === code, `EXCLUDED: ${what} (${EXCLUSION[code]})`);
}
ok(screenUnderTest(person({ email: null }), campaign({ channels: ["email"] })).code === "no_channel",
  "EXCLUDED: no email address for an email campaign");
ok(screenUnderTest(person({ email: null }), campaign({ channels: ["sms", "email"] })).code === "no_channel",
  "EXCLUDED: reachable on sms but not email, on a campaign that uses both (nobody gets half a sequence)");

console.log("\n   fail closed - unknown is never permission:");
for (const [what, over] of [
  ["dnd we could not read at all", { dnd: undefined }],
  ["dnd as a null", { dnd: null }],
  ["dnd as a string 'false'", { dnd: "false" }],
  ["membership we could not determine", { is_member: undefined }],
  ["suppression we could not determine", { email_suppressed: undefined }],
]) {
  ok(screenUnderTest(person(over), campaign()).ok === false, `EXCLUDED: ${what}`);
}

console.log("\n   the honest limit - there is deliberately NO positive-consent check:");
// Documented rather than tested-by-absence: a lead with no consent data at all is
// exactly the imported lead this feature exists for, and excluding on "no consent
// recorded" would be a rail that never fires because nothing records consent.
ok(screenUnderTest(person(), campaign()).ok === true,
  "a lead with no consent record passes the rails - the campaign's written consent_basis is the check, not a column");

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. THE EXIT ORDER: cancel every unsent step BEFORE the card moves ──");
{
  const log = [];
  const deps = {
    cancelUnsentSteps: async () => { log.push("cancel"); },
    moveCard: async () => { log.push("move"); return { role: "responded" }; },
  };
  const r = await replyExitUnderTest({ clientId: "cl", contactId: "c1", automationKey: automationKeyFor("summer-restart") }, deps);
  ok(log.join(">") === "cancel>move", `cancel runs FIRST, then the move (saw: ${log.join(" > ") || "nothing"})`);
  ok(r.order.join(">") === "cancel_unsent_steps>move_card", "the reported order matches what actually ran");
  ok(!log.includes("send"), "the transition itself sends nothing - only the destination's engine speaks");
}
{
  // If cancelling fails we must NOT move on: a card in Reignition with live queued
  // steps is recoverable; a moved card with live queued steps texts a script on
  // top of a real conversation.
  const log = [];
  let moved = false;
  try {
    await runReplyExit({ clientId: "cl", contactId: "c1", automationKey: "ignition:x" }, {
      cancelUnsentSteps: async () => { log.push("cancel"); throw new Error("supabase blip"); },
      moveCard: async () => { moved = true; return {}; },
    });
  } catch (_) { /* expected */ }
  ok(log.length === 1 && moved === false, "a failed cancel aborts the exit - the card does NOT move with steps still queued");
}
{
  const log = [];
  const r = await runRanOutExit({ clientId: "cl", contactId: "c1" }, {
    moveCard: async ({ trigger }) => { log.push("move:" + trigger); return { role: "nurture" }; },
    enrolDestination: async () => { log.push("enrol"); },
  });
  ok(log.join(">") === "move:ran_out>enrol", "ran out: silent move, THEN the destination enrols at its own step one");
  ok(r.silent === true, "the ran-out handoff is marked silent - no message is sent by the transition");
}
{
  // The reconciler runs after the fact, and by then the lead may have booked or
  // converted. Enrolling a booked lead into nurture because their old campaign
  // sequence finished is exactly the kind of cross-talk this reports to prevent.
  const log = [];
  await runRanOutExit({ clientId: "cl", contactId: "c1" }, {
    moveCard: async () => { log.push("move"); return { role: "scheduled_trial", already_moved: true }; },
    enrolDestination: async () => { log.push("enrol"); },
  });
  ok(log.join(">") === "move", "a card that already LEFT reignition is not enrolled anywhere by the ran-out pass");
}
{
  const log = [];
  const r = await admitUnderTest(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ placeCard: async () => { log.push("card"); return { ok: true, role: REIGNITION_ROLE, created: true }; }, enrol: async () => { log.push("enrol"); return { enrollment_id: "e1" }; } })
  );
  ok(r.admitted === true && log.join(">") === "card>enrol", "admission: put the card in the stage (silent), then enrol (the engine speaks)");

  const blocked = await runAdmission(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person({ dnd: true }) },
    okDeps({ placeCard: async () => { log.push("card2"); return { ok: true }; }, enrol: async () => { log.push("enrol2"); } })
  );
  ok(blocked.admitted === false && blocked.code === "dnd" && blocked.rail === true && !log.includes("enrol2"),
    "the rails are re-checked AT ENROL TIME - someone who opted out since the dry run is never enrolled");
}

console.log("\n── 3b. NO CARD, NO ADMISSION (the fatal one) ──");
// Everyone who reaches admission has NO open opportunity - the in_pipeline rail
// excluded everyone who did - so a card has to be CREATED, not found. When that
// fails and admission proceeds anyway, the feature fails in its worst possible
// shape: the messages go out, no card exists, the board column stays empty, and
// BOTH exits are unreachable, so a warm reply never reaches the booking agent.
for (const [what, card] of [
  ["placement returns a failure", { ok: false, error: "createOpp returned no card" }],
  ["placement returns null (found nothing, created nothing)", null],
  ["placement returns a card-less object", { role: "reignition" }],
]) {
  const log = [];
  const r = await admitUnderTest(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ placeCard: async () => card, enrol: async () => { log.push("enrol"); } })
  );
  ok(r.admitted === false && r.code === "no_card" && !log.length,
    `NOT admitted and NOT enrolled when ${what} - nobody is messaged without a card`);
}
{
  const r = await runAdmission(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ placeCard: async () => ({ ok: false, error: "x" }), enrol: async () => ({}) })
  );
  ok(r.rail === false, "a card failure is reported as NOT a rail refusal - the person was never excluded, so the row stays queued for the next pass");
}

console.log("\n── 3c. NO ENROLMENT, NO ADMISSION (the same shape, one step further down) ──");
// enrollContact does not THROW for its own refusals, it RETURNS them. Trusting it
// marks somebody `admitted` who was never enrolled and never messaged - and they
// stay that way: reconcile finds no enrolment and skips them forever, the campaign
// never completes because they still count as live, and the card we made now trips
// the in_pipeline rail on every future campaign. Reachable any time staff disable
// or un-approve the automation between approval and admission.
for (const [what, ret] of [
  ["no enabled+approved automation", { skipped: "no enabled+approved automation" }],
  ["no enabled steps", { skipped: "no enabled steps" }],
  ["enroll race (already active)", { skipped: "enroll race (already active)" }],
  ["enroll failed", { skipped: "enroll failed" }],
  ["missing args", { skipped: "missing args" }],
  ["first step could not be scheduled", { error: "could not schedule the first step", detail: "postgrest blip" }],
  ["enrol returned nothing at all", null],
  ["ok:true but no enrollment id", { ok: true }],
]) {
  const r = await admitUnderTest(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ enrol: async () => ret })
  );
  ok(r.admitted === false && r.code === "not_enrolled" && r.rail === false,
    `NOT admitted when the automation answers "${what}" - and not excluded either, so the next pass retries`);
}
// The asymmetry that matters: the idempotent retry IS a real admission.
for (const [what, ret] of [
  ["a fresh enrolment", { ok: true, enrollment_id: "e1" }],
  ["the idempotent retry (already enrolled)", { skipped: "already enrolled", enrollment_id: "e1" }],
]) {
  const r = await admitUnderTest(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ enrol: async () => ret })
  );
  ok(r.admitted === true && r.enrollment_id === "e1", `ADMITTED on ${what}`);
}

console.log("\n── 3c-bis. The enrolment id is NECESSARY, not SUFFICIENT ──");
// `admitted` claims step 1 is queued. Only the FRESH enrolment return earns that
// (it is reached after the step job was scheduled); the idempotent
// {skipped:"already enrolled", id} is a bare lookup for an active enrolment row
// and says nothing about jobs. And an active enrolment with ZERO jobs is
// reachable: enrollContact's compensating "mark exited" is best-effort, so one
// Supabase blip covering both the schedule and the compensation leaves one behind.
// From then on every pass gets an id back and admits somebody who will never be
// sent anything - the original stranding bug, arriving through the one shape
// allowed to carry an id. So the claim is verified directly, for BOTH branches.
{
  for (const [what, ret] of [
    ["a fresh enrolment", { ok: true, enrollment_id: "e1" }],
    ["the idempotent retry", { skipped: "already enrolled", enrollment_id: "e1" }],
  ]) {
    let retired = null;
    const r = await admitUnderTest(
      { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
      okDeps({
        enrol: async () => ret,
        hasScheduledStep: async () => false,          // the stalled enrolment
        retireStalledEnrolment: async ({ enrollmentId }) => { retired = enrollmentId; },
      })
    );
    ok(r.admitted === false && r.code === "not_enrolled" && r.rail === false,
      `NOT admitted when ${what} carries an id but no step was ever scheduled`);
    ok(retired === "e1",
      `...and the dead-end enrolment is RETIRED, so the next pass can enrol cleanly (${what})`);
  }
  // The healthy case still admits, through both branches.
  for (const [what, ret] of [
    ["fresh", { ok: true, enrollment_id: "e1" }],
    ["idempotent retry", { skipped: "already enrolled", enrollment_id: "e1" }],
  ]) {
    const r = await admitUnderTest(
      { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
      okDeps({ enrol: async () => ret })
    );
    ok(r.admitted === true, `ADMITTED when the ${what} enrolment DOES have a scheduled step`);
  }
  // A retirement that itself fails must not throw the pass away.
  const r = await runAdmission(
    { clientId: "cl", contactId: "c1", campaign: campaign(), candidate: person() },
    okDeps({ hasScheduledStep: async () => false, retireStalledEnrolment: async () => { throw new Error("blip"); } })
  );
  ok(r.admitted === false && r.rail === false, "a failed retirement still reports not-admitted rather than throwing");
}

console.log("\n── 3d. Our own half-finished admission is not a reason to exclude somebody ──");
// Admission is screen -> card -> enrol -> roster write, and the rails are
// re-screened from live data every pass. A failure after the card exists leaves an
// open opportunity in `reignition` that WE created. Without an exemption it becomes
// the reason the rail rejects the person next pass, they are marked excluded, and
// staff read "already live in a pipeline stage" about our own orphan.
{
  const ours = person({ open_stage_role: "reignition", open_entry_point: "ignition:summer-restart" });
  ok(screenOwnCardUnderTest(ours, campaign()).ok === true,
    "a reignition card THIS campaign created does not exclude - the retry reuses it");
  // And the exemption is narrow in all three directions.
  ok(screenCandidate(person({ open_stage_role: "reignition", open_entry_point: "ignition:other-campaign" }), campaign()).code === "in_pipeline",
    "...but another campaign's reignition card still excludes");
  ok(screenCandidate(person({ open_stage_role: "reignition", open_entry_point: null }), campaign()).code === "in_pipeline",
    "...and a reignition card with no entry point still excludes (fail closed)");
  ok(screenCandidate(person({ open_stage_role: "responded", open_entry_point: "ignition:summer-restart" }), campaign()).code === "in_pipeline",
    "...and a card that has MOVED ON to the booking agent still excludes, whatever created it");

  // AND THE PROMISE THAT SURVIVES THE EXEMPTION. Before it, a person who replied
  // was excluded as a side effect - their card sat in the destination stage and
  // the in_pipeline rail caught it. Re-admission is newly reachable through the
  // exemption, and nothing else would stop it: enrollContact treats only an ACTIVE
  // enrolment as "already enrolled", so a reply-EXITED one gets a brand-new
  // enrolment at step 1 - a campaign step sent to somebody who already answered.
  ok(replyRailUnderTest(person({ replied_on_campaign: true }), campaign()).code === "already_replied",
    "somebody who ALREADY REPLIED to this campaign is refused, flatly");
  ok(screenCandidate(person({ replied_on_campaign: true, open_stage_role: "reignition", open_entry_point: "ignition:summer-restart" }), campaign()).code === "already_replied",
    "...and the exemption does NOT get them past it - the reply check runs first");
  ok(screenCandidate(person({ replied_on_campaign: true, dnd: undefined, is_member: undefined }), campaign()).ok === false,
    "...and it holds even when every other fact about them is unknown");
  ok(screenCandidate(person({ replied_on_campaign: false }), campaign()).ok === true,
    "somebody who has NOT replied is unaffected");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. PACING: admission, capped at per_day ──");
const roster = (n, state = "queued") => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(3, "0")}`, contact_id: `c${i}`, state, created_at: `2026-07-29T00:00:${String(i).padStart(2, "0")}Z` }));
{
  const p = planUnderTest({ campaign: campaign({ state: "running", per_day: 15 }), roster: roster(60), admittedToday: 0 });
  ok(p.admit.length === 15, "60 queued, 15 a day -> 15 admitted today");
  ok(p.still_queued === 45, "...and 45 still waiting (four days to fully launch)");
  ok(p.admit[0].contact_id === "c0" && p.admit[14].contact_id === "c14", "admitted oldest-first, deterministically");
}
{
  const p = planUnderTest({ campaign: campaign({ state: "running", per_day: 15 }), roster: roster(60), admittedToday: 15 });
  ok(p.admit.length === 0, "already 15 today -> nobody else enters until tomorrow");
}
{
  const p = planUnderTest({ campaign: campaign({ state: "running", per_day: 15 }), roster: roster(60), admittedToday: 9 });
  ok(p.admit.length === 6, "9 already in today -> only the remaining 6 of the day's 15");
}
{
  const p = planAdmissions({ campaign: campaign({ state: "running" }), roster: roster(3), admittedToday: 0 });
  ok(p.admit.length === 3, "a roster smaller than the daily pace admits everyone");
  ok(DEFAULT_PER_DAY === 15, "the default pace is 15 a day");
}
{
  const mixed = [...roster(2), ...roster(3).map((r) => ({ ...r, id: "x" + r.id, state: "admitted" }))];
  ok(planUnderTest({ campaign: campaign({ state: "running" }), roster: mixed, admittedToday: 0 }).admit.length === 2,
    "only `queued` rows are admitted - somebody mid-sequence is never re-admitted");
}

console.log("\n── 4b. THE PACING DAY is a day, not a rolling 24 hours ──");
// The cron fires at a fixed time. Against a rolling window, yesterday's run at the
// same hour is still inside it, so `admittedToday` comes back at yesterday's full
// count, the room is zero, and the campaign skips a day - every day, silently.
{
  const now = new Date("2026-07-29T14:10:00Z");           // the cron's hour
  const yesterdaysRun = new Date("2026-07-28T14:12:00Z"); // yesterday's admissions
  const boundary = dayStartUnderTest(now, "America/Toronto");
  ok(yesterdaysRun < new Date(boundary),
    "yesterday's admissions fall OUTSIDE today's window, so today's pace starts at zero");
  ok(new Date("2026-07-29T13:00:00Z") >= new Date(boundary),
    "...and an admission from earlier the same day is still counted");
  ok(startOfDayIso(now, "America/Toronto") === "2026-07-29T04:00:00.000Z",
    "midnight in the academy's own timezone (Toronto = UTC-4 in July)");
  ok(startOfDayIso(now, "America/Los_Angeles") === "2026-07-29T07:00:00.000Z",
    "...and San Jose's midnight is a different instant (UTC-7)");
  ok(startOfDayIso(new Date("2026-07-29T02:00:00Z"), "America/Toronto") === "2026-07-28T04:00:00.000Z",
    "02:00 UTC is still YESTERDAY in Toronto, and the boundary says so");
  ok(startOfDayIso(now, "Not/AZone") === startOfDayIso(now, "UTC"),
    "an unknown timezone falls back to UTC rather than stopping admissions");
}
{
  // DST, in the two zones we actually run: GTA is America/New_York, San Jose is
  // America/Los_Angeles. Subtracting the elapsed local wall clock from `now` is
  // only midnight when the offset has not changed since midnight, so it gave 23:00
  // the PREVIOUS day on spring-forward (the window swallowed yesterday's
  // admissions and the campaign paused) and 01:00 on fall-back (an hour of today's
  // admissions uncounted, so the pace could overshoot). Asserted by rendering the
  // answer back into the zone: it must read exactly 00:00:00 on the right date.
  const localOf = (iso, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(iso));
  for (const [what, instant, tz, expect] of [
    ["New York, spring-forward day", "2026-03-08T18:00:00Z", "America/New_York", "2026-03-08, 00:00:00"],
    ["New York, fall-back day", "2026-11-01T18:00:00Z", "America/New_York", "2026-11-01, 00:00:00"],
    ["Los Angeles, spring-forward day", "2026-03-08T20:00:00Z", "America/Los_Angeles", "2026-03-08, 00:00:00"],
    ["Los Angeles, fall-back day", "2026-11-01T20:00:00Z", "America/Los_Angeles", "2026-11-01, 00:00:00"],
    ["Auckland, UTC+13", "2026-01-15T05:00:00Z", "Pacific/Auckland", "2026-01-15, 00:00:00"],
    ["Kathmandu, UTC+5:45", "2026-07-29T14:10:00Z", "Asia/Kathmandu", "2026-07-29, 00:00:00"],
  ]) {
    const got = localOf(dayStartUnderTest(new Date(instant), tz), tz);
    ok(got === expect, `${what}: the boundary is local midnight${got === expect ? "" : ` (got ${got})`}`);
  }
}

console.log("\n── 5. HALT: the unreached are simply never reached ──");
{
  const p = planUnderTest({ campaign: campaign({ state: "halted", per_day: 15 }), roster: roster(60), admittedToday: 0 });
  ok(p.admit.length === 0, "a halted campaign admits NOBODY, so nothing is ever sent to them");
  ok(/halted/.test(p.reason || ""), "...and says so");
}
for (const state of ["draft", "done"]) {
  ok(planAdmissions({ campaign: campaign({ state }), roster: roster(10), admittedToday: 0 }).admit.length === 0,
    `a '${state}' campaign admits nobody either (nothing sends in draft, ever)`);
}
ok(planAdmissions({ campaign: campaign({ state: "approved" }), roster: roster(10), admittedToday: 0 }).admit.length === 10,
  "an APPROVED campaign is the first state that admits anyone - approval is the gate");

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. consent_basis is REQUIRED, because nothing else can stand in for it ──");
for (const [what, basis] of [
  ["missing", undefined],
  ["null", null],
  ["empty", ""],
  ["whitespace", "     "],
  ["a shrug", "n/a"],
]) {
  const problems = draftProblemsUnderTest(campaign({ consent_basis: basis }));
  ok(problems.some((p) => /consent_basis/.test(p)), `REFUSED: consent_basis ${what}`);
}
ok(draftProblemsUnderTest(campaign()).length === 0, "a real written basis passes");
{
  const dry = buildDryRun({ campaign: campaign({ consent_basis: "" }), candidates: [person()] });
  ok(dry.approvable === false, "a campaign with no consent basis is NOT approvable, however good its roster is");
  ok(MUTATE === "consent" ? true : dry.problems.some((p) => /consent_basis/.test(p)), "...and the dry run says which field is missing");
}

console.log("\n── 6b. The dry run: the exact roster, the count, and every exclusion with its reason ──");
{
  const dry = buildDryRun({
    campaign: campaign({ per_day: 15 }),
    candidates: [
      person({ contact_id: "a" }),
      person({ contact_id: "b" }),
      person({ contact_id: "m", is_member: true }),
      person({ contact_id: "d", dnd: true }),
      person({ contact_id: "p", open_stage_role: "scheduled_trial" }),
      person({ contact_id: "n", phone: null }),
    ],
  });
  ok(dry.count === 2 && dry.roster.map((r) => r.contact_id).join(",") === "a,b", "the roster is exactly who passed");
  ok(dry.excluded_count === 4, "everyone removed is listed");
  ok(dry.excluded.every((e) => e.reason && e.code), "every exclusion carries a reason, not just a count");
  ok(dry.consent_basis && dry.consent_basis.length > 10, "the consent basis is shown beside the roster");
  ok(dry.approvable === true, "with a roster and a basis and no problems, it is approvable");
  ok(buildDryRun({ campaign: campaign(), candidates: [] }).approvable === false, "an empty roster is never approvable");
  ok(buildDryRun({ campaign: campaign(), candidates: [person()] }).days_to_launch === 1, "it reports how many days the pace means");
  ok(buildDryRun({ campaign: campaign({ per_day: 15 }), candidates: roster(60).map((r, i) => person({ contact_id: "z" + i })) }).days_to_launch === 4,
    "60 people at 15 a day = 4 days to fully launch");
}

console.log("\n── 6c. Draft shape + roster states ──");
ok(validateCampaignDraft(campaign({ slug: "Summer Restart" })).some((p) => /slug/.test(p)), "a slug with spaces/capitals is refused");
ok(validateCampaignDraft(campaign({ per_day: 0 })).some((p) => /per_day/.test(p)), "per_day 0 is refused");
ok(validateCampaignDraft(campaign({ per_day: 5000 })).some((p) => /per_day/.test(p)), "an absurd per_day is refused");
ok(validateCampaignDraft(campaign({ channels: [] })).some((p) => /channels/.test(p)), "a campaign with no channels is refused");
ok(validateCampaignDraft(campaign({ channels: ["carrier-pigeon"] })).some((p) => /carrier-pigeon/.test(p)), "an unknown channel is refused");
ok(automationKeyFor("summer-restart") === "ignition:summer-restart",
  "the campaign's messages live under 'ignition:<slug>' - an ordinary automation on the ordinary worker");
ok(["queued", "admitted", "replied", "ran_out", "halted", "excluded"].every(isRosterState),
  "the six roster states");
ok(isRosterState("sent_step_2") === false,
  "there is NO sent_step_N state - which step a person is on is the automation engine's fact, read live");

console.log("\n── 6d. 'On step N / next on Thu' is read LIVE from the engine ──");
// The roster view's step column has to come from somewhere, and a denormalised
// column would disagree with the engine the first time a step was skipped,
// deferred for quiet hours, or retried. So it is a join, not a copy.
{
  const rows = rosterProgress({
    roster: [{ contact_id: "a", state: "admitted" }, { contact_id: "b", state: "admitted" }, { contact_id: "z", state: "queued" }],
    // Step positions have GAPS (a deleted step leaves one), so position is mapped
    // to a 1-based ordinal rather than shown raw.
    steps: [{ id: "s1", position: 0 }, { id: "s2", position: 5 }, { id: "s3", position: 9 }],
    enrollments: [{ id: "e1", contact_id: "a", current_position: 0, status: "active" }, { id: "e2", contact_id: "b", current_position: 5, status: "active" }],
    nextJobByEnrollment: { e2: "2026-08-01T15:00:00Z" },
  });
  ok(rows[0].step === 1 && rows[0].steps_total === 3, "position 0 of a gappy sequence reads as 'step 1 of 3'");
  ok(rows[1].step === 2 && rows[1].next_run_after === "2026-08-01T15:00:00Z", "step 2, and when the next one fires");
  ok(rows[2].step === null && rows[2].next_run_after === null, "somebody not yet admitted is on no step at all");
}
{
  // Somebody who replied has an EXITED enrolment frozen at whatever step they
  // reached. Reporting "step 2 of 3" for them contradicts the design (replies show
  // as handed to the sales system) and reads as though the campaign is still
  // messaging somebody it stopped messaging.
  const rows = rosterProgress({
    roster: [{ contact_id: "a", state: "replied" }, { contact_id: "b", state: "ran_out" }],
    steps: [{ id: "s1", position: 0 }, { id: "s2", position: 1 }, { id: "s3", position: 2 }],
    enrollments: [
      { id: "e1", contact_id: "a", current_position: 1, status: "exited" },
      { id: "e2", contact_id: "b", current_position: 2, status: "completed" },
    ],
    nextJobByEnrollment: { e1: "2026-08-01T15:00:00Z" },
  });
  ok(rows[0].step === null && rows[0].enrollment_status === "exited",
    "a person who REPLIED is on no step - they are with the sales system now");
  ok(rows[0].next_run_after === null,
    "...and shows no 'next message', because there is not going to be one");
  ok(rows[1].step === null && rows[1].enrollment_status === "completed",
    "a person whose sequence RAN OUT is on no step either");
}
{
  // A re-admission leaves the old exited enrolment behind, so a contact can hold
  // two. The ACTIVE one has to win; last-row-wins over an unordered query let the
  // stale one through often enough for a tester to catch it.
  const steps = [{ id: "s1", position: 0 }, { id: "s2", position: 1 }];
  const active = { id: "new", contact_id: "a", current_position: 1, status: "active" };
  const stale = { id: "old", contact_id: "a", current_position: 0, status: "exited" };
  for (const [what, enrollments] of [["active first", [active, stale]], ["stale first", [stale, active]]]) {
    const rows = rosterProgress({ roster: [{ contact_id: "a", state: "admitted" }], steps, enrollments, nextJobByEnrollment: {} });
    ok(rows[0].step === 2 && rows[0].enrollment_status === "active",
      `two enrolments, ${what} in the list: the ACTIVE one wins`);
  }
}

console.log("\n── 6e. A cancel that cannot be verified is not a cancel ──");
// runReplyExit aborts the move when the cancel THROWS. That only protects anyone
// if the cancel path can actually fail - and the generic exitEnrollment swallows
// its own errors and always answers ok:true, which is why the reignition path
// re-reads the jobs and asserts instead of trusting the response.
// It asserts the list is EMPTY, not that it holds no known-bad status. The
// caller's query already filters to status in (pending, sending), so anything
// coming back IS a live job - and matching named statuses meant a status nobody
// anticipated (a new one, a typo, a null) read as safe. This is the one function
// in the feature whose entire purpose is to fail closed, so it must not have a
// path where an unrecognised value means "fine".
ok(assertStepsCancelled([]) === true, "nothing came back -> the move may proceed");
for (const status of ["pending", "sending", "queued", "PENDING", null, undefined, ""]) {
  let threw = false;
  try { assertCancelledUnderTest([{ id: "j1", status }]) } catch (_) { threw = true; }
  ok(threw, `a job still live with status ${JSON.stringify(status)} THROWS - the card must not move with a live step behind it`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 7. No second send path ──");
// The single most important constraint in the build, checked as text because it is
// a property of the FILES, not of any function: nothing in the reignition core or
// its route may talk to a provider or hand-roll a message. Everything a campaign
// sends is an automation step delivered by api/automations.js -> api/_send.js.
{
  const fs = await import("node:fs");
  const url = await import("node:url");
  const path = await import("node:path");
  const HERE = path.dirname(url.fileURLToPath(import.meta.url));
  for (const f of ["agent/reignition.js", "agent/reignition-station.js", "reignition.js"]) {
    const src = fs.readFileSync(path.join(HERE, f), "utf8");
    const code = src.replace(/^\s*\/\/.*$/gm, "");   // comments talk ABOUT sending
    ok(!/\bsendOn\b|\bsendSms\b|\bsendEmail\b|api\.resend\.com|conversations\/messages/.test(code),
      `${f} contains no send call - campaign messages ride the existing worker, unchanged`);
    ok(!/mass_send|automation_jobs\?on_conflict/.test(code),
      `${f} does not queue its own jobs - the automation engine owns the queue`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 8. loadCandidates never swallows a read ──");
// A rail is TERMINAL: runAdmit writes state='excluded' with the rail's reason and
// there is no un-exclude path, because add-roster requires a draft campaign and an
// admitting campaign is approved/running. So a rail's reason had better be TRUE of
// the person it is written about.
//
// It once was not. The replied-lookup carried a try/catch that, on ANY failure,
// added every id in the batch to `replied` - which raises `already_replied`, which
// is a rail. One transient Supabase blip permanently excluded up to per_day people
// (15 default, 200 max) with a reason untrue of all of them. The comment on the
// catch called that "recoverable"; it was the opposite, and no assertion in this
// suite touched it, which is why it survived four rounds of review.
//
// The invariant is therefore about the FUNCTION, not that one catch: every lookup
// in loadCandidates must let a throw propagate to runAdmit's per-campaign handler,
// which counts an error and touches nobody. A catch anywhere in it is how the bug
// comes back, so a NEW one fails this check rather than needing to be rediscovered.
{
  const fs = await import("node:fs");
  const url = await import("node:url");
  const path = await import("node:path");
  const HERE = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(HERE, "reignition.js"), "utf8");

  // Top-level functions in this file close on a brace at column 0. Deliberately
  // NOT brace-counting: a `{` inside a string literal defeats that, and the point
  // here is a check that stays true rather than one that is clever.
  const start = src.indexOf("async function loadCandidates");
  ok(start >= 0, "loadCandidates is still in api/reignition.js (re-point this check if it moved)");
  const end = src.indexOf("\n}\n", start);
  ok(end > start, "loadCandidates' closing brace was found");
  const body = src.slice(start, end).replace(/^\s*\/\/.*$/gm, "");   // the comment EXPLAINS the absent catch

  const hasCatch = MUTATE === "replied-catch" ? true : /\bcatch\s*\(/.test(body);
  ok(!hasCatch, "loadCandidates contains NO catch - a failed lookup propagates and nobody is written, "
    + "instead of being converted into a terminal 'already_replied' exclusion for the whole batch");

  // The specific shape of the old bug, pinned separately so the failure message
  // names it: nothing may mark the entire input batch as having replied.
  const marksWholeBatch = MUTATE === "replied-catch"
    ? true
    : /for\s*\(\s*const\s+\w+\s+of\s+ids\s*\)\s*replied\.add/.test(body);
  ok(!marksWholeBatch, "nothing marks every id in the batch as replied - that reason is false for them "
    + "and a rail writes it to their roster row permanently");
}

// ═════════════════════════════════════════════════════════════════════════════
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed.`);
if (fail) console.log("   Failures:\n   - " + failures.join("\n   - "));
process.exit(fail ? 1 : 0);
