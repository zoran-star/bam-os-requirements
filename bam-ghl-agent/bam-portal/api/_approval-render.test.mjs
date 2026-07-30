// THE OWNER'S SALES-MESSAGE APPROVAL: PREVIEW EQUALS SEND.
//
//   node api/_approval-render.test.mjs      # exits non-zero on any difference
//
// An academy owner presses three approvals in onboarding (see OWNER_APPROVALS below,
// which is the enforced list rather than this sentence). This one covers the five
// sales automations, and what it approves has to be provably what parents receive.
// The approval surface (the `approval-queue` action in api/automations.js, rendered
// by the wizard's "Approve your sales messages" step) therefore renders through
// renderStepMessage in api/email-shells.js - the SAME call api/_send.js makes at
// send time, with the same clientVars + academyFacts vars.
//
// WHY THIS FILE EXISTS RATHER THAN A COMMENT SAYING SO. A preview that quietly
// disagreed with the send was found and fixed this month: it rendered the welcome
// email without the academy's venue, weekly schedule and coaches, which is most of
// what an owner is actually checking. A second renderer is easy to reintroduce by
// accident and impossible to notice by eye. So this suite does not compare the
// surface against another copy of the render - it drives the REAL sendOn() against a
// stubbed transport and compares the surface against the bytes that would have gone
// to Resend and to GHL.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES, AND WHAT IT DOES NOT
//
// PROVES: for every step of the five sales automations, at two real academies, the
// message the approval surface shows is byte-identical to the message the send path
// puts on the wire - subject and HTML for email, the exact text for SMS - and the
// surface says "nothing to send yet" exactly when the send path would skip the step.
// It also proves the approval STATE fails closed, and that the wizard step is wired
// into all three places a step needs to be visible.
//
// DOES NOT PROVE that an owner has approved everything that can reach a lead. The
// surface covers the five automations in api/_sales-approval.js and nothing else.
// Two other lanes put scripted copy in front of a lead and neither is rendered here:
// the confirm agent's booking confirmation and same-day check-in, and the booking
// agent's scripted opener. Both live in clients.ghl_kpi_config rather than in the
// automations table. The opener is now owner-GATED (arming it takes an owner) but it
// is still not owner-READ - nobody has to look at the words. The full accounting is
// in the header of api/_sales-approval.js. Do not quote this file as evidence for a
// broader claim than the one above.
//
// DOES NOT PROVE that the arming gates refuse anybody, either. Every check in this
// file reads source as TEXT, and in round 5 three behaviour-reversing edits kept the
// pinned text intact and left this suite green. Refusals are asserted by invoking the
// real handlers in api/_arming-gate.test.mjs; the two files are a pair.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. A suite that only ever passes tells you nothing. Each of these
// breaks ONE thing and must report NEGATIVE CONTROL PASSED, meaning it was caught:
//
//   MUTATE=facts    node api/_approval-render.test.mjs  # surface drops academyFacts
//   MUTATE=vars     node api/_approval-render.test.mjs  # surface drops clientVars
//   MUTATE=shell    node api/_approval-render.test.mjs  # surface shows the raw body
//   MUTATE=subject  node api/_approval-render.test.mjs  # surface skips subject merge
//   MUTATE=failopen node api/_approval-render.test.mjs  # approval state fails OPEN
//   MUTATE=coverage node api/_approval-render.test.mjs  # a preset grows an
//                                                       # automation nobody approves
//   MUTATE=renderer node api/_approval-render.test.mjs  # a new surface renders itself
//   MUTATE=tokens   node api/_approval-render.test.mjs  # the {{token}} carve-outs are
//                                                       # dropped, so the two files
//                                                       # that DO hand-roll a
//                                                       # substitution must trip the
//                                                       # shape matcher for real
//   MUTATE=approvals node api/_approval-render.test.mjs # a 4th owner approval appears
//   MUTATE=wiring   node api/_approval-render.test.mjs  # step missing from a section
//   MUTATE=writesite node api/_approval-render.test.mjs # a new, undeclared write to
//                                                       # the automations table
//   MUTATE=writestale node api/_approval-render.test.mjs # a declared write site that
//                                                        # is no longer there
//
// `failopen` covers BOTH detectors - salesApprovalState() and the wizard's own copy
// in client-portal.html, which is the one the owner actually sees.
//
// AND NOTE WHAT THIS SUITE STRUCTURALLY CANNOT CATCH: both sides of the render
// comparison call renderStepMessage, so a bug INSIDE that function moves both
// together and reads as agreement. api/_gta-step-lock.test.mjs holds the absolute
// anchor for it (committed goldens of its subject / empty flag / body). Do not
// treat this file as covering that; the two are a pair.
//
// `facts` is the exact bug that shipped once, so it is the one that matters most: if
// it ever reports FAILED, this lock is decorative and the fix has come undone.
//
// Fixtures are scripts/snapshots/bam-gta.json and bam-san-jose.json - the same
// snapshots the GTA locks read. Two academies on purpose: GTA is the ONE academy
// with a hardcoded LOCATIONS entry in email-shells.js, so a bug that only shows up
// when identity resolves from the client row would hide behind it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The transport has to be stubbed BEFORE api/_send.js is imported: it reads its
// Supabase / Resend config at module load. Everything downstream (Resend, GHL,
// Supabase REST) goes through global fetch, so one stub covers the whole path and
// no network, database or dependency is involved.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.resolve(HERE, "../../../scripts/snapshots");
const PORTAL_HTML = path.join(HERE, "../public/client-portal.html");
const MUTATE = process.env.MUTATE || "";

// ─── the stubbed wire ────────────────────────────────────────────────────────
// Captures what the send path hands to Resend / GHL. Anything the send path asks
// for that is not stubbed here THROWS rather than silently returning empty, so the
// day sendOn grows a new dependency this test says so instead of drifting.
let WIRE = null;
const VERIFIED_DOMAINS = ["byanymeanstoronto.ca", "byanymeanssanjose.com"];
let SENDING_DOMAIN = VERIFIED_DOMAINS[0];
// The academy's PUBLIC email (clients.business_email), which the send path resolves
// for itself: it is the footer contact line, the {{SUPPORT_EMAIL}} link and the
// unsubscribe destination, and an email that cannot carry one is HELD rather than
// sent. Set per academy in sendSide() from the same snapshot the surface renders
// from, so the two sides are comparing the same academy's address. If it disagreed
// with the snapshot, the compare below would report it as a difference - which is
// the correct alarm, not a nuisance.
let SENDING_BUSINESS_EMAIL = "";

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const body = init.body ? JSON.parse(init.body) : null;

  if (u === "https://api.resend.com/emails" && method === "POST") { WIRE = { channel: "email", subject: body.subject, html: body.html, from: body.from }; return json({ id: "stub-email" }); }
  if (u.includes("/conversations/messages") && method === "POST") { WIRE = { channel: "sms", text: body.message }; return json({ messageId: "stub-sms" }); }
  if (u === "https://api.resend.com/domains") return json({ data: VERIFIED_DOMAINS.map((name) => ({ name, status: "verified" })) });
  // The send path's ONE sender read: sending domain, academy name and public email in
  // a single select. PROJECTED, deliberately - a column the select does not ask for is
  // not in the answer, so business_email dropping out of _send.js's list would make
  // every send here HOLD rather than pass quietly.
  if (u.includes("/rest/v1/clients?") && u.includes("email_domain")) {
    const sel = new URL(u).searchParams.get("select") || "";
    const row = { email_domain: SENDING_DOMAIN, business_name: "stub" };
    if (sel.split(",").includes("business_email")) row.business_email = SENDING_BUSINESS_EMAIL;
    return json([row]);
  }
  if (u.includes("/rest/v1/clients?") && u.includes("messaging_provider")) return json([{ messaging_provider: "ghl" }]);
  if (u.includes("/rest/v1/email_suppressions")) return json([]);      // nobody is suppressed
  if (u.includes("/rest/v1/email_events")) return json([]);            // send logging
  throw new Error(`UNSTUBBED CALL from the send path: ${method} ${u}`);
};

const { sendOn } = await import("./_send.js");
const { renderStepMessage, clientVars } = await import("./email-shells.js");
const { SALES_AUTOMATION_KEYS, salesApprovalState, ARMING_LANES, AUTOMATION_WRITE_SITES } = await import("./_sales-approval.js");

// ─── fixtures ────────────────────────────────────────────────────────────────
// A fixed sample family so merge fields resolve to something readable instead of the
// "there" / "your athlete" fallbacks - the same shape the approval-queue action
// sends. {{next_session}} is empty in both, because a preview cannot know the
// academy's next open slot and a send with no slot known renders it the same way.
const FAMILY = { first_name: "Alex", full_name: "Alex Rivera", athlete: "Jordan Rivera", athlete_first: "Jordan", next_session: "" };

// ─── the token probe ─────────────────────────────────────────────────────────
// Two SYNTHETIC steps, compared through both paths alongside the real ones. They
// are not copy anybody sends and never touch the database - they exist because the
// real sales copy does not currently use every merge token, and a comparison only
// covers the tokens the fixture happens to contain.
//
// This was not a guess. The first run of this suite reported MUTATE=facts as a
// FAILED control: dropping academyFacts from the surface's vars changed nothing,
// because no sales step today references the venue, the schedule or the coaches
// (they belong to the onboarding welcome sequence, which this surface does not
// cover). MUTATE=subject was vacuous for the same reason - no sales subject carries
// a token. Rather than delete two controls, the probe makes them real: it exercises
// every token resolveMergeVars knows, so the lock keeps proving the whole render
// path and does not go quiet the day copy changes shape.
//
// It also covers the drop-when-empty behaviour in both directions: {{location.
// schedule}} sits alone on its line (a BARE mention - it must take its "SCHEDULE:"
// lead-in with it when empty) and the venue sits inside prose (only that sentence
// goes). San Jose has a venue and no schedule, so one academy renders the half-state.
const TOKEN_PROBE = [
  {
    ref: "probe-sms", channel: "sms", subject: "", probe: true,
    body: [
      "Hey {{contact.first_name}}, it's {{location_owner.first_name}} from {{location.name}} in {{location.city}}.",
      "{{contact.athletes_first_name}} is booked in. {{next_session}}Any questions, call {{location.phone}}.",
      "LOCATION: {{location.venue}}",
      "SCHEDULE:",
      "{{location.schedule}}",
      "Join the {{location.community_platform}} group: {{location.community_link}}",
      "Leave us a review: {{location.review_link}}",
      "{{location.website}}/free-trial",
    ].join("\n"),
  },
  {
    ref: "probe-email", channel: "email", probe: true,
    subject: "{{contact.first_name}}, {{location.name}} has a spot for {{contact.athlete_first_name}}",
    body: [
      "Hi {{contact.first_name}},",
      "",
      "{{contact.athletes_full_name}} trains with us at {{location.venue}}, in {{location.city}}.",
      "",
      "{{location.website}}/free-trial",
      "",
      "- {{location_owner.first_name}}, {{location.domain}}",
    ].join("\n"),
  },
];

function academy(file) {
  const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, file), "utf8"));
  const client = snap.client;
  const facts = snap.facts || {};
  return {
    // The INTERNAL name, deliberately: GTA and San Jose now share a public_name
    // ("By Any Means Basketball" - the name is the brand, the city lives in the
    // domain), so labelling by that would print the same academy twice.
    label: client.business_name || file,
    client, facts,
    // EXACTLY the spread api/automations.js uses at send time and on the approval
    // surface: sample contact tokens, then the client row, then the facts that live
    // in other tables.
    vars: { ...FAMILY, ...clientVars(client), ...facts },
    domain: (client.website_setup || {}).domain || "",
    steps: SALES_AUTOMATION_KEYS
      .map((key) => (snap.automations || []).find((a) => a.automation_key === key))
      .filter(Boolean)
      .flatMap((a) => [...(a.steps || [])].sort((x, y) => x.position - y.position)
        .map((s) => ({ ...s, ref: `${a.automation_key}-${s.position}` })))
      .concat(TOKEN_PROBE),
  };
}

// ─── the two sides ───────────────────────────────────────────────────────────

// What the approval surface shows. This is the `approval-queue` action's render,
// verbatim - and it must stay that way. The MUTATE branches are forks a future
// change could plausibly introduce; the point of the file is that each one fails.
function approvalSide(step, ac) {
  let vars = ac.vars;
  if (MUTATE === "facts") vars = { ...FAMILY, ...clientVars(ac.client) };            // the fork that actually shipped
  if (MUTATE === "vars") vars = { ...FAMILY, ...ac.facts };
  if (MUTATE === "shell") return { channel: step.channel, subject: step.subject || "", html: String(step.body || ""), text: String(step.body || ""), empty: false };
  const m = renderStepMessage({ channel: step.channel, clientId: ac.client.id, subject: step.subject, body: step.body, vars });
  if (MUTATE === "subject" && m.channel === "email") return { ...m, subject: String(step.subject || "") };
  return m;
}

// What the send path actually puts on the wire, captured from the REAL sendOn.
async function sendSide(step, ac) {
  WIRE = null;
  SENDING_DOMAIN = ac.domain || VERIFIED_DOMAINS[0];
  SENDING_BUSINESS_EMAIL = ac.client.business_email || "";
  const common = { clientId: ac.client.id, subject: step.subject, body: step.body, vars: ac.vars };
  const r = String(step.channel).toLowerCase() === "email"
    ? await sendOn({ channel: "email", toEmail: "parent@example.test", ...common })
    : await sendOn({ channel: "sms", contactId: "stub-contact", ghlToken: "stub-token", ...common });
  if (r && r.skipped) return { skipped: r.skipped };
  if (r && r.held) return { held: r.held };
  if (!WIRE) throw new Error(`sendOn reported ${JSON.stringify(r)} but put nothing on the wire`);
  return WIRE;
}

// ─── checks ──────────────────────────────────────────────────────────────────
const fails = [];
const notes = [];
const fail = (what, detail) => fails.push({ what, detail });

function diffLine(a, b) {
  const A = String(a).split("\n"), B = String(b).split("\n");
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return `    - approval: ${JSON.stringify(A[i])}\n    + send:     ${JSON.stringify(B[i])}`;
  }
  return "    (identical line by line but not as a whole - trailing whitespace)";
}

async function checkRenderEquality(ac) {
  // The probe alone would keep this suite green over an empty fixture. Count the
  // REAL steps: an academy whose snapshot has lost its sales automations is locking
  // nothing, and should say so rather than pass on synthetic copy.
  if (!ac.steps.some((s) => !s.probe)) { fail(`${ac.label}: fixture`, `no steps for any of ${SALES_AUTOMATION_KEYS.join(", ")} - this academy is locking nothing but the token probe. Re-capture the snapshot.`); return; }
  for (const step of ac.steps) {
    const shown = approvalSide(step, ac);
    const sent = await sendSide(step, ac);
    const where = `${ac.label} ${step.ref} (${step.channel})`;

    // A step that renders to nothing is a no-op the engine skips. The surface has to
    // agree, or an owner approves a message that never goes - or worse, sees nothing
    // where a message will go.
    if (sent.skipped || shown.empty) {
      if (!!sent.skipped !== !!shown.empty) {
        fail(where, `the surface says empty=${!!shown.empty} but the send path ${sent.skipped ? `SKIPPED it (${sent.skipped})` : "SENT it"}. The owner is being shown something other than what happens.`);
      }
      continue;
    }
    if (sent.held) { fail(where, `the send path HELD this (${sent.held}); the stubbed sending domain should have prevented that.`); continue; }

    if (String(step.channel).toLowerCase() === "email") {
      if (shown.subject !== sent.subject) fail(`${where} subject`, `    - approval: ${JSON.stringify(shown.subject)}\n    + send:     ${JSON.stringify(sent.subject)}`);
      if (shown.html !== sent.html) fail(`${where} body`, diffLine(shown.html, sent.html));
    } else if (shown.text !== sent.text) {
      fail(`${where} body`, diffLine(shown.text, sent.text));
    }
  }
  // A fixture whose merge tokens all happen to be empty would make every render
  // trivially equal. Prove the academy's own identity is actually reaching output.
  // REAL steps only: the probe names the domain by construction, so including it
  // would make this check pass for a fixture whose real copy had lost its identity
  // tokens entirely - which is the exact thing it is here to notice.
  const all = [];
  for (const step of ac.steps.filter((s) => !s.probe)) { const m = approvalSide(step, ac); all.push(m.text || "", m.html || ""); }
  const joined = all.join("\n");
  if (ac.domain && !MUTATE && !joined.includes(ac.domain)) {
    notes.push(`STALE FIXTURE: nothing rendered for ${ac.label} contains its own domain (${ac.domain}). Either the identity tokens left these bodies or the snapshot is not feeding them - either way this comparison is weaker than it looks.`);
  }
}

// The approval state must fail CLOSED. `[].every()` is true, and an academy with no
// sales automations at all would otherwise read as fully approved.
//
// `enabled` is on every fixture because the engine requires it: api/automations.js
// will not enrol, report live or send unless a row is enabled AND approved, so a row
// at approved:true / enabled:false is silent and must not read as done. The dedicated
// behavioural coverage for that is in api/_arming-gate.test.mjs; here it is only
// carried so these fixtures describe rows that could actually send.
function checkFailsClosed() {
  const state = MUTATE === "failopen"
    // The naive version somebody would write without thinking about the empty case.
    ? (rows) => { const r = (rows || []).filter((a) => SALES_AUTOMATION_KEYS.includes(a.automation_key || a.key)); return { total: r.length, approved: r.filter((a) => a.approved).length, done: r.every((a) => a.approved) }; }
    : salesApprovalState;
  const row = (key, approved) => ({ automation_key: key, approved, enabled: true });
  const all = SALES_AUTOMATION_KEYS.map((k) => row(k, true));

  const cases = [
    ["no automations at all (preset never applied)", [], false],
    ["undefined input", undefined, false],
    ["all five approved", all, true],
    ["four of five approved", SALES_AUTOMATION_KEYS.map((k, i) => row(k, i > 0)), false],
    ["none approved", SALES_AUTOMATION_KEYS.map((k) => row(k, false)), false],
    // The welcome sequence is not a sales message and must not be able to satisfy
    // this on its own, nor to block it once the five are in.
    ["only the onboarding welcome sequence, approved", [row("onboarding", true)], false],
    ["all five approved plus an unapproved onboarding", [...all, row("onboarding", false)], true],
    // setup-status.js serves these rows as {key, approved, enabled}; the wizard's
    // detector reads that shape, so it has to count the same.
    ["setup-status {key} shape, all approved", SALES_AUTOMATION_KEYS.map((k) => ({ key: k, approved: true, enabled: true })), true],
    // Approved but DISABLED cannot send, so it is not done. The panel's own seed list
    // creates rows in exactly this state, which is how BAM NY got there.
    ["all five approved but one disabled", [...all.slice(1), { ...all[0], enabled: false }], false],
  ];
  for (const [what, rows, want] of cases) {
    const got = state(rows);
    if (got.done !== want) fail(`approval state: ${what}`, `    expected done=${want}, got done=${got.done} (total=${got.total}, approved=${got.approved})`);
  }
}

// Every automation a sales preset seeds must be a DECIDED case: either the owner
// approves it here, or it is on the short list of sequences deliberately outside
// this approval. A new automation joining a preset would otherwise start sending to
// leads with nobody having read it, which is the exact promise this step exists to
// keep. Fails closed - an unrecognised key is a failure, not a shrug.
//
// This matters right now: presets are under active change (the reignition station
// is being attached to every preset in a parallel build). Its engine is supplied
// per campaign rather than by the preset, so it contributes no automation key
// today; the day one appears, this fires and forces the question.
async function checkPresetCoverage() {
  // The welcome sequence for people who have already PAID. Not a sales message, and
  // several of its steps seed OFF until the academy has entered its own schedule,
  // venue and coaches - approving the sales system must not arm it.
  const OUTSIDE = ["onboarding"];
  let presets;
  try { presets = await import("./agent/presets.js"); }
  catch (e) { notes.push(`could not read the preset registry to check coverage (${e.message}). The rest of this suite still ran.`); return; }
  for (const key of Object.keys(presets.PRESETS || {})) {
    // The control models the thing that would actually happen: a new sequence lands
    // in a preset and nobody thinks about who approves it.
    const keys = MUTATE === "coverage" ? [...presets.presetAutomationKeys(key), "reignition"] : presets.presetAutomationKeys(key);
    for (const auto of keys) {
      if (SALES_AUTOMATION_KEYS.includes(auto) || OUTSIDE.includes(auto)) continue;
      fail("preset coverage", `preset '${key}' seeds automation '${auto}', which is neither approved by the owner (SALES_AUTOMATION_KEYS) nor on the deliberate exclusion list in this test.\n    Decide which it is: add it to api/_sales-approval.js AND to _OBF_SALES_KEYS in client-portal.html, or add it to OUTSIDE here with the reason. Until then it can send to leads nobody has approved.`);
    }
  }
}

// ONE RENDER PATH, enforced rather than asserted in a comment. Nothing under api/
// may render an AUTOMATION STEP's message except renderStepMessage - no direct
// renderEmail / templateBody / resolveMergeVars call. That is what stops a fourth
// surface quietly growing its own renderer, which is how the preview and the send
// drifted apart the first time.
//
// THE EXCEPTIONS BELOW ARE THE INVENTORY OF WHAT IS OUTSIDE THAT PATH, and writing
// them down here rather than in a comment is the point: a NEW file that starts
// rendering fails this check and has to be argued for. The list is also the honest
// answer to "is everything an academy sends covered by the owner's approval" - it
// is not, and this is what is not.
// Keyed by path RELATIVE TO api/, never by basename: a basename key excuses a new
// file of the same name anywhere in the tree. `calls` PINS which render functions the
// excepted file may call and how many times each - so the exception cannot quietly
// widen, and a file that stops rendering reports itself as stale.
//
// BY NAME, not a total. A bare count of 2 was satisfied by swapping one
// resolveMergeVars for a renderEmail: same number, materially different render (a
// full branded email shell instead of token substitution) appearing inside the
// carve-out, which is the exact thing the pin exists to stop.
const RENDER_EXCEPTIONS = {
  // The confirm agent's SCRIPTED initial messages (booking confirmation, same-day
  // check-in). A different lane end to end: the copy lives in
  // api/agent/confirm-automations.js rather than in automation_steps, it resolves
  // appointment tokens (resolveApptTokens) that renderStepMessage knows nothing
  // about, and it is gated by confirm_agent_mode, not by `approved`. It is
  // therefore NOT shown on the owner's approval surface and NOT covered by that
  // yes. Bringing it in is a real build, not a refactor - it needs the appointment
  // tokens and a decision about who approves it. Until then this line is the
  // record that it stands outside.
  "agent-confirm.js": { calls: { resolveMergeVars: 2 }, why: "confirm agent scripted messages - appointment tokens, gated by confirm_agent_mode not `approved`" },
};

// Blank out comments and import lines while PRESERVING length and newlines, so a
// function named in prose does not read as a call and reported line numbers stay
// true. (Every file in this repo names these functions in comments constantly.)
function codeOnly(src) {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
  out = out.split("\n").map((l) => (/^\s*import\b/.test(l) ? " ".repeat(l.length) : l)).join("\n");
  return out;
}

function checkNoSecondRenderer() {
  const OWNER = path.join(HERE, "email-shells.js");   // the module that defines them
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    // .js AND .mjs - a non-test .mjs under api/ ships exactly like a .js and was
    // invisible here. Test files are excluded: the locks render directly on purpose.
    return e.isFile() && /\.(js|mjs)$/.test(p) && !/\.test\.mjs$/.test(p) ? [p] : [];
  });
  // \s* spans newlines, so a formatter splitting `renderEmail` from its `(` cannot
  // slip past. Known remaining gaps, judged not worth a parser: an aliased import
  // (`import { renderEmail as r }`) and a variable indirection (`const f =
  // renderEmail; f(...)`). Both are deliberate acts, not accidents, and both would
  // still have to get past review.
  const banned = /\b(renderEmail|templateBody|resolveMergeVars)\s*\(/g;
  const counted = new Map();   // relative path -> how many real calls it makes

  for (const file of walk(HERE)) {
    if (file === OWNER) continue;
    const rel = path.relative(HERE, file);
    const src = codeOnly(fs.readFileSync(file, "utf8"));
    const hits = [...src.matchAll(banned)].map((m) => ({
      fn: m[1],
      n: src.slice(0, m.index).split("\n").length,
      line: src.split("\n")[src.slice(0, m.index).split("\n").length - 1],
    }));
    // READ EVERY FILE, INCLUDING EXCEPTED ONES. The previous version skipped
    // excepted files before opening them, so `used` meant "a file with this name
    // exists" - neutralising both render calls in agent-confirm.js produced no
    // complaint at all. The whole point of the stale half was to notice exactly
    // that, and it could not.
    if (hits.length) {
      const byName = {};
      for (const h of hits) byName[h.fn] = (byName[h.fn] || 0) + 1;
      counted.set(rel, byName);
    }
    const exc = RENDER_EXCEPTIONS[rel];
    if (exc && MUTATE !== "renderer") continue;   // counted above, judged below
    for (const { line, n } of hits) {
      fail("one render path", `api/${rel}:${n} renders a message itself instead of calling renderStepMessage:\n    ${String(line).trim()}\n    Route it through renderStepMessage, or this surface can disagree with what actually sends.`);
    }
  }

  // A STALE EXCEPTION FAILS THE RUN. It is the same shape this whole check exists to
  // kill: a written claim that was true once and is not checked. A note would not do
  // it - CI keys on exit code, so a note that exits 0 is invisible.
  for (const [rel, exc] of Object.entries(RENDER_EXCEPTIONS)) {
    if (MUTATE === "renderer") continue;
    const found = counted.get(rel) || {};
    const shape = (o) => Object.keys(o).sort().map((k) => `${k} x${o[k]}`).join(", ") || "nothing";
    if (shape(found) === shape(exc.calls)) continue;
    fail("one render path", !Object.keys(found).length
      ? `STALE EXCEPTION: RENDER_EXCEPTIONS lists api/${rel} ("${exc.why}") but that file no longer exists or no longer renders anything itself. Delete the entry - it is claiming a gap that is not there.`
      : `RENDER_EXCEPTIONS pins api/${rel} at [${shape(exc.calls)}]; it now calls [${shape(found)}].\n    A DIFFERENT render function inside the carve-out is a new renderer, not a bookkeeping change - renderEmail wraps a full branded shell where resolveMergeVars only substitutes tokens. Justify it or route it through renderStepMessage; do not just re-pin.`);
  }
  // The control models a new surface growing its own renderer.
  if (MUTATE === "renderer") fail("one render path", "api/somewhere-new.js:1 renders a message itself instead of calling renderStepMessage (simulated).");
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME RULE, CAUGHT BY SHAPE INSTEAD OF BY NAME.
//
// checkNoSecondRenderer above bans three FUNCTION NAMES: renderEmail, templateBody,
// resolveMergeVars. That list cannot see a file that does the substitution itself,
// and two files already do:
//
//   api/agent-approvals.js       scriptedBookingOpener - swaps {{contact.first_name}}
//                                into the booking agent's scripted opener, which is
//                                the FIRST message a new lead receives.
//   api/agent/confirm-automations.js  resolveApptTokens - swaps {{appointment.*}}
//                                into the booking confirmation and the check-in.
//
// Both produce lead-facing copy, both walked straight past the ban list, and the fix
// for that is not two more names. A name list only ever describes the renderers that
// existed when it was written; the SHAPE - a regex substitution against a {{...}}
// token - is what a new one will also have.
//
// WHAT THIS CANNOT SEE, stated rather than implied: a substitution written with a
// string argument instead of a regex literal (`.replace("{{name}}", v)`), a regex
// built with `new RegExp`, and a token in some other syntax. All three are
// deliberate acts rather than the accident this is hunting, and all three still have
// to get past review. If one shows up, widen this, do not add an exception.
const TOKEN_RENDER_EXCEPTIONS = {
  "agent-approvals.js": {
    count: 1,
    why: "scriptedBookingOpener resolves {{contact.first_name}} HERE on purpose: the text goes straight to the Hawkeye queue, not through the send engine's token pass, so an unresolved token would reach the lead. It is an ARMING lane, not an approval lane - owner-gated in the handler and listed in ARMING_LANES (api/_sales-approval.js). Routing it through renderStepMessage is a real build, not a refactor.",
  },
  "agent/confirm-automations.js": {
    count: 1,
    why: "resolveApptTokens resolves {{appointment.*}} - times, location, calendar links - which renderStepMessage knows nothing about. It deliberately leaves {{contact.*}} and {{location.*}} for the send engine. Same carve-out as agent-confirm.js in RENDER_EXCEPTIONS above.",
  },
};

// Read a regex literal starting at `at` (the opening slash). Returns the literal, or
// null if it is not one - which is how a division sign is told from a regex without
// parsing the whole file.
function regexLiteralAt(src, at) {
  if (src[at] !== "/") return null;
  let i = at + 1, inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return null;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return src.slice(at, i + 1);
    i++;
  }
  return null;
}

function checkNoHandRolledTokenRender() {
  const OWNER = path.join(HERE, "email-shells.js");   // the one place allowed to do this
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return e.isFile() && /\.(js|mjs)$/.test(p) && !/\.test\.mjs$/.test(p) ? [p] : [];
  });
  const counted = new Map();

  for (const file of walk(HERE)) {
    if (file === OWNER) continue;
    const rel = path.relative(HERE, file);
    const src = codeOnly(fs.readFileSync(file, "utf8"));
    const hits = [];
    for (const m of src.matchAll(/\.replace(?:All)?\(\s*\//g)) {
      const lit = regexLiteralAt(src, m.index + m[0].length - 1);
      if (!lit) continue;
      // Strip the escapes so `\{\{` and `{{` are the same shape to this check.
      if (!lit.replace(/\\/g, "").includes("{{")) continue;
      hits.push({ n: src.slice(0, m.index).split("\n").length, lit });
    }
    if (hits.length) counted.set(rel, hits.length);
    // MUTATE=tokens drops the carve-outs, so the REAL files above have to trip the
    // REAL detector. It is not a simulated failure: if the shape matcher stopped
    // seeing what is already in the tree, this control goes quiet and says so.
    if (TOKEN_RENDER_EXCEPTIONS[rel] && MUTATE !== "tokens") continue;
    for (const { n, lit } of hits) {
      fail("one render path", `api/${rel}:${n} substitutes a {{...}} token itself: ${lit}\n    That produces lead-facing copy on a path nothing in this suite renders or compares, so it can say something different from what the owner approved.\n    Route it through renderStepMessage, or add an entry to TOKEN_RENDER_EXCEPTIONS with the reason it stands outside.`);
    }
  }

  for (const [rel, exc] of Object.entries(TOKEN_RENDER_EXCEPTIONS)) {
    if (MUTATE === "tokens") continue;
    const found = counted.get(rel) || 0;
    if (found === exc.count) continue;
    fail("one render path", !found
      ? `STALE EXCEPTION: TOKEN_RENDER_EXCEPTIONS lists api/${rel} ("${exc.why}") but that file no longer substitutes any {{...}} token itself. Delete the entry - it is claiming a gap that is not there.`
      : `TOKEN_RENDER_EXCEPTIONS pins api/${rel} at ${exc.count} hand-rolled token substitution(s); it now has ${found}. A NEW one inside the carve-out is a new renderer, not a bookkeeping change. Justify it or route it through renderStepMessage; do not just re-pin the number.`);
  }
}

// HOW MANY APPROVALS DOES AN OWNER ACTUALLY GIVE - as an inventory, not a comment.
//
// This build originally described the sales-message approval as "one of only TWO
// approvals an owner ever gives, the other being their brand board", and repeated it
// in five places. It was wrong: the owner also presses "Looks good - accept the
// site" (`site_accepted`), which the spec itself calls the ONE Accept moment. The
// claim sounded true, nothing connected it to the code, and it went into owner-facing
// design docs.
//
// So it is listed here instead. A FOURTH owner approval fails this check and has to
// be added deliberately; a listed one that disappears fails it too. That keeps any
// COUNT quoted in the spec, the memory note or the wizard honest by construction,
// which a comment cannot do.
//
// SETTLED: it is THREE (Zoran, 2026-07-29). The rule used to be stated as "the owner
// approves exactly twice, their brand board and their sales messages"; the code asks
// three times, because accepting the new website is a real approval and always was.
// His ruling moved the RULE to match the code. Do not "correct" this list back to two
// - the prose in docs/onboarding-wizard-spec.md and the wizard now match it, and this
// is the thing they are checked against.
const OWNER_APPROVALS = {
  brand_ok: "Brand board - _obfBrandApprove(), the brand sign-off",
  site_accepted: "New website - _obfSiteAccept(), the ONE Accept moment before the domain flip",
  "approve-sales-messages": "Sales messages - _obfApprove(), arms the five sales automations",
};
function checkOwnerApprovals() {
  const html = fs.readFileSync(PORTAL_HTML, "utf8");
  const found = new Set();
  // The two readiness sign-offs go through /api/website/build-state owner-sign...
  for (const m of html.matchAll(/action:\s*'owner-sign',\s*key:\s*'([\w]+)'/g)) found.add(m[1]);
  // ...and the sales approval through /api/automations.
  if (/_autoApi\('approve-sales-messages'\)/.test(html)) found.add("approve-sales-messages");
  if (MUTATE === "approvals") found.add("payment_terms_ok");   // control: a 4th arrives

  for (const key of found) {
    if (OWNER_APPROVALS[key]) continue;
    fail("owner approvals", `client-portal.html asks the owner for an approval this inventory does not know about: '${key}'.\n    Add it to OWNER_APPROVALS with what it authorises, and check every place that counts the owner's approvals - the wizard step comment, docs/onboarding-wizard-spec.md and memories/project_v2_onboarding_model.md all state a NUMBER.`);
  }
  for (const [key, why] of Object.entries(OWNER_APPROVALS)) {
    if (MUTATE === "approvals") continue;
    if (!found.has(key)) notes.push(`STALE INVENTORY: OWNER_APPROVALS lists '${key}' ("${why}") but nothing in client-portal.html asks for it any more. Remove it, and re-check anything that quotes a count.`);
  }
}

// The rule that has bitten this project before: a wizard step renders ONLY if its
// key is in _OBF_STEPS AND in a section's keys AND has a detector in
// _obfFetchState. All three, or it is defined, detected and invisible.
function checkWizardWiring() {
  const html = fs.readFileSync(PORTAL_HTML, "utf8");
  const KEY = "approve";

  if (!new RegExp(`\\{\\s*key:\\s*'${KEY}'`).test(html)) fail("wizard wiring", `no _OBF_STEPS row with key '${KEY}'.`);

  // The section list, with the mutation applied to a COPY of the source only.
  const sections = MUTATE === "wiring" ? html.replace(`'preset', '${KEY}'`, "'preset'") : html;
  const inSection = /keys:\s*\[([^\]]*)\]/g;
  let found = false, m;
  while ((m = inSection.exec(sections))) if (m[1].includes(`'${KEY}'`)) found = true;
  if (!found) fail("wizard wiring", `key '${KEY}' is in _OBF_STEPS but in no _OBF_SECTIONS keys list, so the step is defined, detected and INVISIBLE. See bam-ghl-agent/CLAUDE.md.`);

  if (!new RegExp(`next\\.${KEY}\\s*=`).test(html)) fail("wizard wiring", `no detector: nothing assigns next.${KEY} in _obfFetchState().`);

  // THE DETECTOR THE OWNER ACTUALLY SEES. salesApprovalState() in api/ is locked by
  // checkFailsClosed above, but the wizard cannot import it and carries a duplicate.
  // That duplicate is the one that lights the step green, and it was unlocked:
  // deleting its `approve_total > 0` guard makes an academy with NO sales
  // automations read as fully approved, and every server-side test stayed green.
  const detector = MUTATE === "failopen"
    ? html.replace(`next.approve = next.approve_total > 0 &&`, `next.approve =`)
    : html;
  if (!/next\.approve\s*=\s*next\.approve_total\s*>\s*0\s*&&/.test(detector)) {
    fail("wizard wiring", "the wizard's own detector has lost its `approve_total > 0` guard, so zero sales automations would read as fully approved. It must fail closed the same way salesApprovalState() does.");
  }
  if (!new RegExp(`step\\.key === '${KEY}'`).test(html)) fail("wizard wiring", `_obfRender has no page for '${KEY}'.`);

  // The wizard cannot import from api/, so it carries its own copy of the key list.
  // Two lists are a fork waiting to happen; this is what stops them drifting.
  const keys = /const _OBF_SALES_KEYS = \[([^\]]*)\]/.exec(html);
  if (!keys) fail("wizard wiring", "no _OBF_SALES_KEYS literal in client-portal.html to compare against SALES_AUTOMATION_KEYS.");
  else {
    const wizard = keys[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    if (wizard.join("|") !== SALES_AUTOMATION_KEYS.join("|")) {
      fail("wizard wiring", `_OBF_SALES_KEYS [${wizard.join(", ")}] has drifted from api/_sales-approval.js SALES_AUTOMATION_KEYS [${SALES_AUTOMATION_KEYS.join(", ")}].`);
    }
  }

  // The approval writes `approved` and nothing else. Turning steps or automations ON
  // here would live-send copy the seeder deliberately left off - another academy's
  // words from this academy's number. Read the action's own source and check.
  const api = fs.readFileSync(path.join(HERE, "automations.js"), "utf8");
  const at = api.indexOf(`b.action === "approve-sales-messages"`);
  if (at < 0) fail("approval action", "no approve-sales-messages action in api/automations.js.");
  else {
    const block = api.slice(at, api.indexOf("\n    }", at));

    // ON THE WRITE ITSELF, not just somewhere in the block. Matching the string
    // anywhere was satisfied by the SELECT above it, so the PATCH could lose its
    // client_id filter - the one that stops an approval reaching another academy's
    // automations - and this suite stayed green. The same reasoning now applies to
    // `enabled`: the SELECT reads it (salesApprovalState needs it to tell an armed
    // sequence from a silent one), so the ban has to be on the PATCH BODY, which is
    // where writing it would actually live-send copy the seeder left off.
    const writes = block.split("\n").filter((l) => /method:\s*"PATCH"/.test(l));
    if (!writes.length) fail("approval action", "no PATCH found in the approve-sales-messages block. If the write moved or was reformatted onto several lines, re-point this check at it rather than deleting it.");
    for (const line of writes) {
      if (!/client_id=eq\.\$\{clientId\}/.test(line)) {
        fail("approval action", `a PATCH in approve-sales-messages is not scoped to client_id:\n    ${line.trim()}\n    Every write must carry &client_id=eq.\${clientId} so an approval can never reach another academy's automations.`);
      }
      const body = /body:\s*JSON\.stringify\(\{([^}]*)\}\)/.exec(line);
      if (body && /\benabled\s*:/.test(body[1])) {
        fail("approval action", `the approve-sales-messages PATCH writes \`enabled\`:\n    ${line.trim()}\n    It must set \`approved\` only. The seeder turns individual steps off on purpose, and flipping them on here would live-send one academy's words from another academy's number.`);
      }
    }
  }

  // BOTH DOORS, AND NOW A REGISTRY RATHER THAN A REGEX. Owner-scoping the wizard
  // action alone left a second route wide open: the Sales panel's On switch
  // (_autoSetLive) fires set-approved + set-enabled together, so THAT is also "arm
  // this sequence" and was on the weaker scope. Zoran's ruling (2026-07-29): arming
  // live messaging is an owner decision on every route.
  //
  // WHAT CHANGED IN ROUND 5, and why there is less regex here than there used to be.
  // This block used to pin the gate CONDITIONS as strings. A tester kept both strings
  // verbatim, replaced one `return res.status(403)` with a `console.warn` and
  // prefixed the other with `if (false && ...)`, and this suite stayed green with
  // both gates disabled. Pinned text says nothing about behaviour. The refusals are
  // now asserted by INVOKING the handlers in api/_arming-gate.test.mjs, and what is
  // left here is the one thing a behavioural test cannot do: an INVENTORY check that
  // every registered arming lane is actually wired into the file that claims it, so
  // a lane cannot be declared and then never called.
  for (const [lane, def] of Object.entries(ARMING_LANES)) {
    const file = path.join(HERE, "..", def.where);
    const src = fs.existsSync(file) ? codeOnly(fs.readFileSync(file, "utf8")) : "";
    if (!src.includes(`armingRefusal("${lane}"`)) {
      fail("arming gate", `ARMING_LANES registers '${lane}' as gated in ${def.where} ("${def.arms}") but that file never calls armingRefusal("${lane}", ...).\n    Either the gate was removed - in which case that route arms live messaging under canActOn - or the lane is dead and the entry should go. A registered lane nobody calls is a claim with nothing behind it.\n    The refusals themselves are asserted by api/_arming-gate.test.mjs; this only checks the lane is wired at all.`);
    }
  }

  // ...AND THE SAME SWEEP IN THE OTHER DIRECTION, which is the one that finds
  // things. The loop above runs registry -> code: it can only ever check lanes
  // somebody remembered to register, so a route that arms a sequence WITHOUT an
  // entry is invisible by construction. That is not hypothetical - two survived it:
  //
  //   api/reignition.js PATCHed { enabled: true, approved: true } onto a real
  //     automations row with no lane at all. Closed today only because that handler
  //     demands BAM staff, which is stricter than armingRefusal, so it was a
  //     COVERAGE hole rather than a live one. It is registered now.
  //   api/automations.js seed-form-intro birthed a row carrying `approved`, under
  //     plain canActOn. The field is off the insert now.
  //
  // So: sweep api/ for every WRITE to the automations table and require each one to
  // be declared in AUTOMATION_WRITE_SITES with the gate that covers it. A new write
  // fails here until its author names the gate. This is what makes the claim at the
  // top of api/_sales-approval.js ("anything that decides whether a scripted message
  // goes to a lead belongs in ARMING_LANES") enforceable rather than aspirational.
  //
  // COUNTING WRITES, NOT ARMING FIELDS, on purpose. Deciding "does this body set
  // approved?" means parsing the body, and two real sites defeat that: set-approved
  // writes a COMPUTED key (`{ [field]: ... }`) and upsert-automation writes a
  // variable (`[row]`). A count of writes needs no parsing and cannot be dodged by
  // how the body is spelled.
  {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
      return (/\.(js|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name) && !/^\.mutant-/.test(e.name)) ? [p] : [];
    });
    const found = [];
    for (const file of walk(HERE)) {
      const rel = `api/${path.relative(HERE, file).split(path.sep).join("/")}`;
      let src = codeOnly(fs.readFileSync(file, "utf8"));
      // MUTATE=writesite: a sixth route quietly starts arming automations. This is
      // the failure the sweep exists for, so it is applied to what the sweep READS.
      if (MUTATE === "writesite" && rel === "api/automations.js") {
        src += "\nawait sb(`automations?id=eq.${x}`, { method: \"PATCH\", body: JSON.stringify({ approved: true }) });\n";
      }
      // Every occurrence of the table in a request path, with THAT CALL'S OWN
      // arguments - not a fixed window. A window of N characters reads the next
      // call's `method:` and counts a plain read as a write, which is a false
      // failure and, worse, teaches the next person to raise the declared count
      // until it goes quiet.
      for (const m of src.matchAll(/`automations(\?|`)/g)) {
        // 1. walk to the end of the template literal, stepping over ${...}.
        let i = m.index + 1, depth = 0;
        while (i < src.length) {
          const ch = src[i];
          if (ch === "\\") { i += 2; continue; }
          if (ch === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
          if (ch === "}" && depth > 0) { depth--; i++; continue; }
          if (ch === "`" && depth === 0) break;
          i++;
        }
        // 2. take the rest of the enclosing call, stopping at the `)` that closes it.
        let j = i + 1, par = 0, args = "";
        while (j < src.length) {
          const ch = src[j];
          if (ch === "(" || ch === "{" || ch === "[") par++;
          else if (ch === ")" || ch === "}" || ch === "]") { if (par === 0) break; par--; }
          args += ch; j++;
        }
        const meth = /method:\s*"(POST|PATCH|DELETE)"/.exec(args);
        if (!meth) continue;                       // a read
        found.push({ where: rel, method: meth[1], snippet: src.slice(m.index, i + 1).replace(/\s+/g, " ").slice(0, 120) });
      }
    }
    // MUTATE=writestale: an entry that describes a write which is no longer there.
    // A stale entry is not harmless - the count is the whole mechanism, so it holds
    // a free slot open for a real write nobody looked at.
    const SITES = MUTATE === "writestale"
      ? [...AUTOMATION_WRITE_SITES, { where: "api/agent/seed-automations.js", what: "a write that has since moved", gate: "none" }]
      : AUTOMATION_WRITE_SITES;
    const declared = new Map();
    for (const s of SITES) declared.set(s.where, (declared.get(s.where) || 0) + 1);
    const seen = new Map();
    for (const f of found) seen.set(f.where, (seen.get(f.where) || 0) + 1);

    for (const [where, n] of seen) {
      const d = declared.get(where) || 0;
      if (n > d) {
        const list = found.filter((f) => f.where === where).map((f) => `      ${f.method} ${f.snippet}`).join("\n");
        fail("arming gate", `${where} writes to the \`automations\` table ${n} time(s); AUTOMATION_WRITE_SITES (api/_sales-approval.js) declares ${d}.\n    Every write to that table can arm a sequence - \`approved\` is the owner's yes and \`enabled\` is the operator's switch - so a new one has to be declared with the gate that covers it. If it arms, register a lane in ARMING_LANES and call armingRefusal; if it cannot (the field is off the payload, or the handler is staff-only), say which and why.\n    Writes found:\n${list}`);
      }
    }
    for (const [where, d] of declared) {
      const n = seen.get(where) || 0;
      if (d > n) {
        fail("arming gate", `AUTOMATION_WRITE_SITES declares ${d} write(s) to \`automations\` in ${where} but only ${n} are there.\n    A stale entry hides a real one: the count is what makes a NEW write fail, so an entry describing something that has moved buys a free slot for something nobody looked at. Re-point it or delete it.`);
      }
    }
  }
  const flip = api.indexOf(`b.action === "set-enabled" || b.action === "set-approved"`);
  if (flip < 0) fail("arming gate", "the set-enabled / set-approved handler has moved; re-point this check at it.");
  else {
    const block = api.slice(flip, flip + 2600);
    // The narrowing must NOT swallow the off switch or the enable flag.
    if (/b\.action === "set-enabled".{0,80}canApproveAsOwner/s.test(block)) {
      fail("arming gate", "set-enabled has been put behind the owner scope. Operators must keep the kill switch and be able to re-enable something the owner already approved - only FIRST consent is the owner's.");
    }
  }

  // THE THIRD DOOR. upsert-automation upserts (on_conflict + merge-duplicates), so
  // any arming field in its row is a write to an EXISTING automation under the plain
  // canActOn scope. The fields are dropped entirely rather than guarded.
  const up = api.indexOf(`b.action === "upsert-automation"`);
  if (up < 0) fail("arming gate", "the upsert-automation action has moved; re-point this check at it.");
  else {
    // codeOnly: the block's own comment EXPLAINS why these fields are gone, and a
    // raw match on the prose failed the check for describing the fix.
    const rowSrc = codeOnly(api.slice(up, api.indexOf("return res.status(200)", up)));
    for (const field of ["approved", "enabled"]) {
      if (new RegExp(`\\b${field}\\s*:`).test(rowSrc)) {
        fail("arming gate", `upsert-automation writes \`${field}\` again. It upserts onto an existing row, so that is a third way to arm a live sequence under canActOn - the same hole set-approved had. Leave it to the database default on insert and to the owner-scoped actions thereafter.`);
      }
    }
  }
  // The panel's seed list must not ask for armed rows either.
  if (/_AUTO_SEED[\s\S]{0,400}?approved:\s*true/.test(html)) {
    fail("arming gate", "_AUTO_SEED seeds an automation with approved:true. Opening the automations panel would then arm a sequence nobody approved.");
  }

  // ...and the switch must degrade rather than fire a request it knows will 403,
  // WITHOUT locking an operator out of a sequence the owner already approved.
  if (!/const needsFirstYes = on && a && !a\.approved;/.test(html) || !/needsFirstYes && !_autoCanArm\(\)/.test(html)) {
    fail("arming gate", "_autoSetLive does not degrade for a non-owner switching on a not-yet-approved automation. It should explain, not fire and fail.");
  }
  if (!/if \(needsFirstYes\) await _autoApi\('set-approved'/.test(html)) {
    fail("arming gate", "_autoSetLive sends set-approved outside the first-yes case. Sending it on the way OFF un-approves the sequence, so the next click reads as a first arming and an operator who switched something off can never switch it back on; sending it when already approved 403s a non-owner with \"only the owner can switch messages on for the first time\" when it is not the first time.");
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN) await main();

async function main() {
  console.log("\n── Sales-message approval: preview equals send ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const academies = [academy("bam-gta.json"), academy("bam-san-jose.json")];
  for (const ac of academies) {
    await checkRenderEquality(ac);
    const real = ac.steps.filter((s) => !s.probe).length;
    console.log(`  ${fails.length ? "…" : "✅"} ${ac.label}: ${real} sales step(s) + ${ac.steps.length - real} token probe(s) compared against the real send path`);
  }
  const afterRender = fails.length;

  checkFailsClosed();
  console.log(`  ${fails.length > afterRender ? "❌" : "✅"} approval state fails closed`);
  const afterState = fails.length;

  await checkPresetCoverage();
  console.log(`  ${fails.length > afterState ? "❌" : "✅"} every automation the presets seed is a decided case`);
  const afterCoverage = fails.length;

  checkNoSecondRenderer();
  console.log(`  ${fails.length > afterCoverage ? "❌" : "✅"} nothing under api/ renders a message except renderStepMessage`);
  const afterNames = fails.length;

  checkNoHandRolledTokenRender();
  console.log(`  ${fails.length > afterNames ? "❌" : "✅"} nothing under api/ substitutes a {{token}} into lead-facing copy by hand`);
  const afterRenderer = fails.length;

  checkOwnerApprovals();
  console.log(`  ${fails.length > afterRenderer ? "❌" : "✅"} the owner is asked for exactly the approvals we say they are`);
  const afterApprovals = fails.length;

  checkWizardWiring();
  console.log(`  ${fails.length > afterApprovals ? "❌" : "✅"} wizard step wired into all three places`);

  for (const f of fails) console.log(`\n── ${f.what} ──\n${f.detail}`);
  for (const n of notes) console.log(`\n⚠️  ${n}`);

  if (MUTATE) {
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }

  if (!fails.length && !notes.length) {
    console.log("\n✅ What the owner approves is byte-for-byte what the send path puts on the wire.");
    console.log("   (For the five sales automations. Not for the confirm agent's scripted messages - see the header.)\n");
    process.exit(0);
  }
  // NOTES FAIL TOO. CI keys on the exit code, so anything that exits 0 is invisible
  // to it - a "warning" nobody sees is the same decorative claim this suite is built
  // to reject. Every note here is a staleness signal about a fixture or an
  // inventory; if one fires, something has stopped being checked.
  console.log(`\n❌ ${fails.length} failure(s), ${notes.length} staleness note(s). Both fail the run.\n`);
  process.exit(1);
}
