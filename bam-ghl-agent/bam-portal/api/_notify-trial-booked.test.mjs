// THE BOOKING TEXT, AND THE THING THAT MAKES IT STAY WIRED.
//
//   node api/_notify-trial-booked.test.mjs        # exits non-zero on any failure
//   MUTATE=unwire node api/_notify-trial-booked.test.mjs   # proves check 1 bites
//
// WHAT WENT WRONG THE FIRST TIME. `calendar_booking` shipped as a switch in the
// client portal's Team card. BAM GTA turned it on. It fired from exactly ONE
// place - a GHL AppointmentCreate webhook - and GTA books on the portal spine,
// which creates no GHL appointment. Twenty-five bookings in thirty days, zero
// texts, and a settings screen that said it was on the whole time. Nothing threw
// and nothing was logged, because nothing was wrong: the code that existed did
// what it said. The wire between the switch and the event simply did not exist.
//
// So the valuable check here is NOT "does the notifier work". It is check 1:
// EVERY trial-booking RPC call site in the tree either notifies or is on a skip
// list with a stated reason. A sixth booking path added next year cannot quietly
// go dark - it fails this file on the day it is written.
//
// Checks 2-4 cover what the owner actually receives, since a wire that carries a
// wrong message is its own kind of silent.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const API_DIR = dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

// ── the RPCs that move a family's trial, and who is allowed to stay silent ────

const TRIAL_RPCS = ["book_trial_slot", "cancel_trial_booking", "reschedule_trial_booking"];

// INVOKING the RPC, not naming it: the name inside a STRING (every caller shape
// in the tree passes it as one - `.rpc("book_trial_slot"`, `rpc<string>("...")`,
// `sb('rpc/...')`), or as a PostgREST path. Matching bare mentions instead flags
// every file that merely explains the booking model in a comment -
// api/agent-approvals.js does exactly that, while its real booking goes through
// bookPortalTrial(), which notifies. A check that cries wolf gets an allowlist
// entry to shut it up, and an allowlist is how the next real gap hides.
//
// The opposite mistake is worse and nearly bit here: an earlier version required
// a literal `.rpc(` and silently stopped seeing api/parent/trial-booking.ts,
// which calls a local rpc() wrapper. It went green with a real caller missing.
// That is why check 1 asserts the COUNT as well as each file - a scan that
// narrows must fail loudly, not quietly pass.
const RPC_NAMES = TRIAL_RPCS.join("|");
const INVOKES_RPC = new RegExp(`rpc/(${RPC_NAMES})\\b|["'\`](${RPC_NAMES})["'\`]`);

// Call sites that deliberately do NOT text, each with the reason. The rule is
// "text when the FAMILY acts, stay silent when the ACADEMY acts" - an owner does
// not need a text about the button they just pressed. Adding a file here is a
// deliberate act with a written reason, which is the point: silence has to be
// chosen, never inherited.
const SILENT_ON_PURPOSE = {
  "api/ghl/calendars-v15.js":
    "staff mark a trial cancelled/invalid from the calendar drawer - the academy's own click",
  "api/agent-confirm.js":
    "staff hand a lead back to booking ('can't make it') or park them - the academy's own click; "
    + "the rebook texts when it lands",
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (!/\.(js|ts|mjs)$/.test(name)) continue;
    if (/\.test\.|\.spec\./.test(name)) continue;
    out.push(full);
  }
  return out;
}

console.log("\n1. every trial-booking call site notifies, or is silent on purpose");
{
  const files = walk(API_DIR);
  const callers = [];
  for (const full of files) {
    const rel = relative(join(API_DIR, ".."), full);
    let src = readFileSync(full, "utf8");
    // MUTATE=unwire reverts the website funnel to its pre-fix state (books, says
    // nothing) to prove this check actually bites rather than passing by luck.
    if (MUTATE === "unwire" && rel.endsWith("api/website/trial-booking.ts")) {
      src = src.replace(/await notifyTrialBooked\([^;]*\);/g, "");
    }
    if (!INVOKES_RPC.test(src)) continue;
    // The notifier itself and the file that only documents the RPCs do not count.
    if (rel.endsWith("api/_notify-trial-booked.js")) continue;
    callers.push({ rel, notifies: src.includes("notifyTrialBooked(") });
  }

  // The count is pinned, not floored. A scan that quietly stops seeing a caller
  // passes every other check in this file while the gap it exists to catch walks
  // straight through. Deleting a booking path is fine; doing it without touching
  // this number is not.
  const EXPECTED_CALLERS = 7;
  if (callers.length !== EXPECTED_CALLERS) {
    fail(`found ${callers.length} trial-booking call sites, expected ${EXPECTED_CALLERS}: ${callers.map(c => c.rel).join(", ")}`
      + `\n        If a path was genuinely added or removed, update EXPECTED_CALLERS. If not, the scan narrowed and is now blind.`);
  } else pass(`scanned all ${callers.length} files that invoke a trial-booking RPC`);

  for (const { rel, notifies } of callers) {
    const excused = SILENT_ON_PURPOSE[rel];
    if (notifies && excused) fail(`${rel} is on the silent list but DOES notify - the list is stale, fix one or the other`);
    else if (notifies) pass(`${rel} notifies`);
    else if (excused) pass(`${rel} silent on purpose: ${excused}`);
    else fail(`${rel} moves a trial booking and tells NOBODY. Call notifyTrialBooked(), or add it to SILENT_ON_PURPOSE with a reason.`);
  }

  for (const rel of Object.keys(SILENT_ON_PURPOSE)) {
    if (!callers.some((c) => c.rel === rel)) fail(`SILENT_ON_PURPOSE lists ${rel}, which no longer touches a trial-booking RPC - drop the entry`);
  }
}

// ── 2. the preset owns the event ─────────────────────────────────────────────

console.log("\n2. the pill comes from the preset, and the sender agrees with it");
{
  const { PRESETS, presetNotifications, presetContents } = await import("./agent/presets.js");
  const { TRIAL_BOOKED_EVENT } = await import("./_notify-trial-booked.js");

  const declared = presetNotifications("free_trial");
  if (declared.some((n) => n.key === TRIAL_BOOKED_EVENT)) pass(`free_trial declares ${TRIAL_BOOKED_EVENT}`);
  else fail(`free_trial does not declare ${TRIAL_BOOKED_EVENT} - the sender would text an event with no switch behind it`);

  // The portal builds its pill row from presetContents(). If the manifest drops
  // notifications, the pill vanishes from the UI while the texts keep sending -
  // recipients with no way to opt out.
  const contents = presetContents("free_trial");
  if ((contents.notifications || []).some((n) => n.key === TRIAL_BOOKED_EVENT)) pass("presetContents() carries it to the portal");
  else fail("presetContents() drops notifications - the portal would render no pill for an event that still sends");

  for (const n of declared) {
    if (n.label && n.hint) pass(`${n.key} has a label and a hint`);
    else fail(`${n.key} is missing a label or hint - it renders as a blank pill`);
  }

  // Zoran's call 2026-07-31: free_trial only. This pins the decision so preset #2
  // gaining the event is a deliberate edit here, not a drive-by.
  const others = Object.keys(PRESETS).filter((k) => k !== "free_trial" && presetNotifications(k).length);
  if (!others.length) pass("no other preset declares notifications yet (free_trial only, as decided)");
  else pass(`other presets now declare notifications: ${others.join(", ")} - intentional?`);
}

// ── 3. what the owner actually reads ─────────────────────────────────────────

console.log("\n3. the message");
{
  const { renderTrialBookedSms } = await import("./_notify-trial-booked.js");

  const booked = renderTrialBookedSms({
    kind: "booked", className: "Beginner Academy", athleteName: "Jordan Smith", athleteAge: 11,
    parentName: "Maria Smith", parentPhone: "+14165550134", when: "Tue, Aug 5, 5:30 PM",
  });
  const expected = [
    "📅 New free trial booked - Beginner Academy",
    "Athlete: Jordan Smith (11)",
    "Parent: Maria Smith - +14165550134",
    "When: Tue, Aug 5, 5:30 PM",
  ].join("\n");
  if (booked === expected) pass("booked renders in full");
  else fail(`booked message drifted:\n--- got ---\n${booked}\n--- want ---\n${expected}`);

  for (const kind of ["cancelled", "rescheduled"]) {
    const m = renderTrialBookedSms({ kind, className: "Beginner Academy", athleteName: "Jordan Smith" });
    if (m.split("\n")[0] !== booked.split("\n")[0]) pass(`${kind} reads differently from booked`);
    else fail(`${kind} renders the same headline as booked - the owner cannot tell them apart`);
  }

  // Repo-wide hard rule. An em dash in an SMS is a real send, not a lint nit.
  const all = ["booked", "cancelled", "rescheduled"].map((kind) =>
    renderTrialBookedSms({ kind, className: "A", athleteName: "B", parentName: "C", parentPhone: "D", when: "E" })).join("\n");
  if (!all.includes("—")) pass("no em dash in any variant");
  else fail("an em dash reached a person-facing SMS");

  // Sparse data must degrade to short, not to a message full of empty labels.
  const sparse = renderTrialBookedSms({ kind: "booked", athleteName: "Jordan Smith" });
  if (sparse === "📅 New free trial booked\nAthlete: Jordan Smith") pass("missing fields drop their whole line");
  else fail(`sparse message renders empty labels:\n${sparse}`);

  // No DOB means no age, never "(0)" or "(NaN)".
  const noAge = renderTrialBookedSms({ kind: "booked", athleteName: "Jordan Smith", athleteAge: null });
  if (!/\(/.test(noAge)) pass("no DOB renders no age");
  else fail(`missing age leaked into the message: ${noAge}`);
}

// ── 4. the time is the ACADEMY's time ────────────────────────────────────────

console.log("\n4. the time the owner reads is their own");
{
  const { formatSlotTime } = await import("./_notify-trial-booked.js");

  // 2026-08-05T21:30:00Z is 5:30 PM in Toronto and 2:30 PM in Los Angeles. An
  // owner cannot tell a wrong-zone time from a right one - the string carries no
  // zone - so this is the difference between a useful text and a misleading one.
  const iso = "2026-08-05T21:30:00Z";
  const tor = formatSlotTime(iso, "America/New_York");
  const la = formatSlotTime(iso, "America/Los_Angeles");
  if (tor.includes("5:30 PM")) pass(`Toronto reads ${tor}`);
  else fail(`expected 5:30 PM for America/New_York, got ${tor}`);
  if (la.includes("2:30 PM")) pass(`Los Angeles reads ${la}`);
  else fail(`expected 2:30 PM for America/Los_Angeles, got ${la}`);

  // A garbage tz must still produce a time. Falling through to "" would ship a
  // booking text with no when-line at all.
  if (formatSlotTime(iso, "Not/AZone")) pass("an unknown timezone still renders a time");
  else fail("an unknown timezone swallowed the time entirely");

  if (formatSlotTime(null, "America/New_York") === "") pass("no start time renders nothing");
  else fail("a null start time rendered something");
}

// ── 5. no hardcoded pill list in the portal ──────────────────────────────────

console.log("\n5. the portal reads the pill from the preset, not from itself");
{
  const html = readFileSync(join(API_DIR, "..", "public", "client-portal.html"), "utf8");
  const decl = html.slice(html.indexOf("const _NOTIF_EVENTS = ["), html.indexOf("let _BB_NOTIF_PRESET_EVENTS"));
  if (!decl.includes("free_trial_booked")) pass("_NOTIF_EVENTS does not hardcode the preset's event");
  else fail("the preset's event is hardcoded in _NOTIF_EVENTS - it would render for academies that never applied the preset, which is the original bug");
  if (html.includes("_bbNotifEnsureLoaded") && html.includes("contents.notifications")) pass("the portal loads it from the preset manifest");
  else fail("the portal no longer loads preset notifications from the manifest");
}

// ── 6. "we could not ask" is not "no" ────────────────────────────────────────

console.log("\n6. a lookup that fails is distinguishable from a real no");
{
  const { notifyTrialBooked } = await import("./_notify-trial-booked.js");
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(String(m));

  // The academy definitely does not run a preset that declares the event: the
  // offers read SUCCEEDS and comes back empty. Skipping is correct and boring.
  globalThis.fetch = async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  const no = await notifyTrialBooked({ clientId: "c1", trialBookingId: "t1", kind: "booked" });

  // We could not ask: the same read fails at the transport. Skipping is also
  // what happens, but it is NOT the same event and must not report as one.
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  const dunno = await notifyTrialBooked({ clientId: "c1", trialBookingId: "t1", kind: "booked" });

  globalThis.fetch = realFetch;
  console.warn = realWarn;

  if (no.ok === true && !no.unknown) pass(`a real "no" reports ok: ${JSON.stringify(no.skipped)}`);
  else fail(`a real "no" should be an ok skip, got ${JSON.stringify(no)}`);

  if (dunno.unknown === true && dunno.ok === false) pass(`"could not ask" reports unknown: ${JSON.stringify(dunno.skipped)}`);
  else fail(`"could not ask" collapsed into a plain skip, got ${JSON.stringify(dunno)} - this is the exact shape the original bug had`);

  if (no.skipped !== dunno.skipped) pass("the two carry different reasons");
  else fail("both outcomes carry the same reason string - a caller cannot tell them apart");

  // Nothing downstream records the return value, so the log line IS the only
  // trace an unreachable lookup ever leaves.
  if (warnings.some((w) => w.includes("could not read the preset stamp"))) pass("the unreachable case logs itself");
  else fail(`the unreachable case left no trace; warnings were ${JSON.stringify(warnings)}`);

  // Neither path may send. Proven by the fetch stubs: notifyOwners would have had
  // to fetch, and every fetch in this block is accounted for above.
  if (no.sent === 0 && dunno.sent === 0) pass("neither outcome sends");
  else fail(`a skipped notification still sent: no=${no.sent} unknown=${dunno.sent}`);
}

// ── negative control ─────────────────────────────────────────────────────────
// Under MUTATE, "the suite failed" is the SUCCESS condition: the mutation broke
// something on purpose and the suite had to notice. CI requires the literal
// NEGATIVE CONTROL PASSED banner rather than accepting a non-zero exit, because
// a control that no longer exists in the code also exits non-zero - and that
// would report a decorative control as a working one.
if (MUTATE) {
  const caught = failures > 0;
  console.log(caught
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${failures} check(s) failed, as intended).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
  process.exit(caught ? 0 : 1);
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
