// LOCAL DAY BOUNDARIES: every helper that turns an instant into an academy's own
// calendar day, and the one platform fact all of them rest on.
//
//   node api/_local-day.test.mjs        # exits non-zero on any failure
//
// Plain node, no deps, no network, no database - the same house style as
// api/_reignition.test.mjs. It imports the REAL modules and calls the REAL
// functions; nothing here is a re-implementation.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE BUG THIS SUITE EXISTS FOR
//
// `hour12: false` is not a cycle you choose. It is a HINT the engine RESOLVES,
// and it does not resolve the same way on every runtime:
//
//     Node 20 (ICU 78.2) resolves hour12:false to h24 -> midnight renders "24"
//     Node 24 (ICU 78.2) resolves hour12:false to h23 -> midnight renders "00"
//
// Same ICU, different V8. Ask any of these helpers what day it is on Node 20 and
// you can get a different answer than on Node 24. CI runs Node 20.
//
// `todayBoundsMs` in api/ghl/calendars-v15.js read `+p.hour` with no repair, so
// on an h24 runtime it read midnight as hour 24, computed the zone's UTC offset
// as +24h instead of 0, and returned THE WRONG DAY - off by exactly 24 hours.
//
// THIS WAS NOT LATENT. It fires whenever the offset in force at local midnight
// is exactly UTC+0, and Europe/London (Elite Smart Athletes) is UTC+0 from late
// October to late March. For roughly five months a year that academy's Home
// dashboard - "trials today" and "today's schedule" - would show YESTERDAY.
// It reads correctly in July only because London is UTC+1 then.
//
// The load-bearing platform fact, established by execution rather than assumed:
// when ICU renders the hour as 24 it still renders the CORRECT year, month, day
// and weekday. ONLY the hour is wrong. That is why the `% 24` and `=== "24" ? 0`
// repairs scattered through the other helpers are complete rather than partial,
// and case 1 below pins that fact so a future ICU that also rolls the date back
// cannot quietly invalidate all of them at once.
//
// THE WHOLE CLASS IS NOW CLOSED, NOT JUST THE INSTANCE. `hour12` bit three times
// in one day - it killed CI, it put Europe/London's dashboard a day behind for the
// five months a year London is UTC+0, and it would have silently stopped the trial
// summary for any academy that chose a midnight send hour. Each was fixed where it
// was found while the pattern stayed in the codebase, which is why it kept coming
// back. Every `hour12` in portal source is now an explicit `hourCycle`, DISPLAY
// SITES INCLUDED (Zoran's call: no allowlist, no "display is fine" carve-out, so a
// user can never be shown "24:00" either), and scripts/check-no-hour12.mjs fails CI
// if one returns.
//
// WHAT EACH CASE COVERS
//
//   1. THE PLATFORM FACT. h24 moves the hour and nothing else. Every `% 24`
//      repair in this codebase is only correct because of this.
//   2. todayBoundsMs RETURNS THE ACADEMY'S OWN DAY. The fixed function, across
//      the zones that actually exist in clients.time_zone, plus UTC and both
//      London DST edges. This is the assertion that was red before the fix.
//   3. THE NULL-TIMEZONE FALLBACK IS REAL. One academy has time_zone NULL. Both
//      call sites coalesce to America/Toronto, so NULL never reaches Intl. If a
//      refactor drops the `||`, `undefined` reaches todayBoundsMs and it throws.
//   4. hour12 DOES NOT COME BACK, at any of the nine converted sites. A text pin,
//      not a behaviour check, and deliberately so: on an h23 runtime the
//      regression is INVISIBLE to any behavioural assertion, so the only guard
//      that works on every runtime is one that reads the source.
//   5-9. THE OTHER HELPERS, BY EXECUTION. cron localHour + dayWindow, reignition
//      startOfDayIso, quiet hours, weeklySchedule, localIsoParts - each asked for
//      the London-midnight instant that triggers h24.
//   10. THE SURVIVING `% 24` REPAIRS ARE BELT AND BRACES, AND THEY STILL BITE.
//      Converting to hourCycle made every one of them unreachable, which is
//      exactly how a repair rots into a lie. So each is re-run with the cycle
//      forced BACK to h24 and required to produce the correct answer anyway.
//      That is what earns them the word "defensive" in their comments.
//   11. THE CONVERSION CHANGED NOTHING EXCEPT AT MIDNIGHT. Proven by sweeping a
//      year of instants across every zone in clients.time_zone rather than
//      asserted: h23 and h24 agree at all 23 other local hours.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. A suite that only ever passes proves nothing.
//
//   MUTATE=hint       node api/_local-day.test.mjs # put hour12:false back in todayBoundsMs
//   MUTATE=h24        node api/_local-day.test.mjs # pin todayBoundsMs to hourCycle h24
//   MUTATE=cronhint   node api/_local-day.test.mjs # put hour12:false back in localHour
//   MUTATE=cronh24    node api/_local-day.test.mjs # pin localHour to hourCycle h24
//   MUTATE=hintback   node api/_local-day.test.mjs # put hour12:false back in ALL converted sites
//   MUTATE=daywindow  node api/_local-day.test.mjs # strip dayWindow's 24->0 repair
//   MUTATE=isoguard   node api/_local-day.test.mjs # strip localIsoParts' 24->00 repair
//   MUTATE=quietguard node api/_local-day.test.mjs # strip _quiet's % 24 repair
//   MUTATE=factsguard node api/_local-day.test.mjs # strip _academy-facts' % 24 repair
//   MUTATE=reignguard node api/_local-day.test.mjs # strip reignition's 24->0 repair
//   MUTATE=availwiring node api/_local-day.test.mjs # give availability.js its own copy back
//
// Each must report NEGATIVE CONTROL PASSED. If one reports FAILED, the check it
// targets is decorative and must not be quoted as evidence.
//
// THE `availtext` CONTROL IS GONE, and its absence is not a weakened suite. Its
// name is written without the MUTATE= prefix on purpose: CI discovers controls by
// grepping this file for that prefix, so a retired control mentioned in full would
// be re-discovered, run, match nothing and fail the build. It pinned
// availability.js's DUPLICATE of the local-ISO builder by text, because the copy
// lived inline in a Supabase-backed handler and could not be executed. There is no
// duplicate any more: both callers import api/_local-iso.js, so case 9 EXECUTES
// the code availability.js actually runs instead of comparing two strings.
// MUTATE=availwiring replaces it and guards the thing still worth guarding - that
// availability.js keeps calling the shared helper rather than growing a copy back.
//
// EVERY *guard CONTROL FORCES hourCycle h24 AS PART OF THE MUTATION, on purpose.
// Removing a `% 24` repair on its own changes NOTHING on an h23 runtime, so a
// control that only removed the repair would look "caught" on Node 20 and inert
// on Node 24 - the same class of false result the CI comments warn about. Pinning
// h24 in the mutation makes each control fire identically on every runtime, and
// it is a faithful reproduction: h24 is exactly what Node 20 already does.
//
// The two `*hint` controls are text-caught rather than behaviour-caught for the
// same reason, and case 4 exists to catch them on any runtime.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

let failures = 0;
let controlBroken = null;

function check(name, got, want) {
  const g = typeof got === "string" ? got : JSON.stringify(got);
  const w = typeof want === "string" ? want : JSON.stringify(want);
  if (g === w) return true;
  failures++;
  console.log(`  FAIL  ${name}\n          got  ${g}\n          want ${w}`);
  return false;
}
function ok(name) { console.log(`  ok    ${name}`); }
function expect(name, got, want) { if (check(name, got, want)) ok(name); }

// ─── mutated copies of real modules, for the negative controls ───────────────
// Same shape as api/_ghl-migration.test.mjs: the temp copy is written NEXT TO the
// original so its own relative imports still resolve, and a pin that no longer
// matches the source throws rather than silently mutating nothing.
//
// `who` names whoever asked for the mutation. It used to be hardwired to
// `MUTATE=...`, which was true while only the negative controls used this. Case 10
// now builds mutants during an ORDINARY run - forcing h24 to prove the surviving
// repairs still bite - so a stale pin there must not report itself as a broken
// MUTATE= control that nobody ran.
let mutantCount = 0;
async function mutantModule(rel, edits, who = `MUTATE=${MUTATE}`) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `${who} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `${who} produced a copy of api/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

// The pre-fix text, exactly as it stood in calendars-v15.js.
const V15_FIXED = 'const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })';
const V15_HINT  = 'const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })';
const V15_H24   = V15_FIXED.replace('hourCycle: "h23"', 'hourCycle: "h24"');

const CRON_FIXED = 'new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" })';
const CRON_HINT  = 'new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })';
const CRON_H24   = CRON_FIXED.replace('hourCycle: "h23"', 'hourCycle: "h24"');

async function v15Module() {
  if (MUTATE === "hint") return mutantModule("ghl/calendars-v15.js", [[V15_FIXED, V15_HINT]]);
  if (MUTATE === "h24")  return mutantModule("ghl/calendars-v15.js", [[V15_FIXED, V15_H24]]);
  return import("./ghl/calendars-v15.js");
}

async function cronModule() {
  if (MUTATE === "cronhint") return mutantModule("ghl/cron-trial-summary.js", [[CRON_FIXED, CRON_HINT]]);
  if (MUTATE === "cronh24")  return mutantModule("ghl/cron-trial-summary.js", [[CRON_FIXED, CRON_H24]]);
  if (MUTATE === "daywindow") return mutantModule("ghl/cron-trial-summary.js", [
    // Force the h24 rendering AND remove the repair, so the control fires on any
    // runtime rather than only on the one that already renders 24.
    toH24("day"),
    ['g("hour") === 24 ? 0 : g("hour")', 'g("hour")'],
  ]);
  return import("./ghl/cron-trial-summary.js");
}

// ── the h24 pins, one per converted site ────────────────────────────────────
// Each entry is [file, the EXACT code text that asks for h23]. Used twice: the
// *guard controls force h24 and ALSO strip the site's repair (so the control
// fires on every runtime, not only the one that already renders 24), and case 10
// forces h24 and strips NOTHING, which is what proves the repair is real.
const H24 = {
  iso:   ["_local-iso.js",
          'second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });'],
  quietA:["agent/_quiet.js",
          '{ timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);'],
  quietB:["agent/_quiet.js",
          'second: "2-digit", hourCycle: "h23" }).formatToParts(date)) m[p.type] = p.value;'],
  facts: ["_academy-facts.js",
          'timeZone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",'],
  reign: ["agent/reignition.js",
          'minute: "2-digit", second: "2-digit", hourCycle: "h23" })\n    .formatToParts(instant)'],
  day:   ["ghl/cron-trial-summary.js",
          'hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",'],
};
const toH24 = (k) => [H24[k][1], H24[k][1].split('hourCycle: "h23"').join('hourCycle: "h24"')];

// localIsoParts moved OUT of agent/booking.js into api/_local-iso.js, so that
// api/website/availability.js could stop carrying a second, unexecutable copy.
// booking.js re-exports it; the mutation has to target the module that owns it.
async function isoModule() {
  if (MUTATE !== "isoguard") return import("./_local-iso.js");
  return mutantModule(H24.iso[0], [
    toH24("iso"),
    ['${parts.hour === "24" ? "00" : parts.hour}', '${parts.hour}'],
  ]);
}

async function quietModule() {
  if (MUTATE !== "quietguard") return import("./agent/_quiet.js");
  return mutantModule(H24.quietA[0], [
    toH24("quietA"),
    ['const h = Number(parts.find(p => p.type === "hour").value) % 24;',
     'const h = Number(parts.find(p => p.type === "hour").value);'],
  ]);
}

async function factsModule() {
  if (MUTATE !== "factsguard") return import("./_academy-facts.js");
  return mutantModule(H24.facts[0], [
    toH24("facts"),
    ['const hour = Number(parts.hour) % 24;', 'const hour = Number(parts.hour);'],
  ]);
}

async function reignModule() {
  if (MUTATE !== "reignguard") return import("./agent/reignition.js");
  return mutantModule(H24.reign[0], [
    toH24("reign"),
    ['Number(p.hour === "24" ? "0" : p.hour)', 'Number(p.hour)'],
  ]);
}

// Read a source file for the text pins in case 4. MUTATE=hintback puts the
// `hour12: false` hint back at every converted site AT ONCE, which is the shape
// the regression would actually take: someone copies an old snippet, or a revert
// lands. It mutates only the string this suite READS, exactly like the retired
// availtext control did, and case 4 is what has to notice.
function sourceOf(rel) {
  const src = fs.readFileSync(path.join(HERE, rel), "utf8");
  return MUTATE === "hintback" ? src.split('hourCycle: "h23"').join("hour12: false") : src;
}

// availability.js is checked for WIRING now, not for a duplicated repair: the
// duplicate is gone, and case 9 executes the shared helper it calls. The
// availwiring control gives it its own inline copy back.
function availabilitySource() {
  const src = fs.readFileSync(path.join(HERE, "website/availability.js"), "utf8");
  if (MUTATE !== "availwiring") return src;
  return src.split("const { day, iso } = localIsoParts(s.start_time, timezone);").join(
    'const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", second: "2-digit", timeZoneName: "longOffset" });\n' +
    "        const parts = Object.fromEntries(fmt.formatToParts(new Date(s.start_time)).map(p => [p.type, p.value]));\n" +
    "        const day = `${parts.year}-${parts.month}-${parts.day}`, iso = day;");
}

// ─── the instants that matter ────────────────────────────────────────────────
// 2026-12-15T00:00:00Z IS midnight in Europe/London (GMT). That is the instant
// an h24 runtime renders as hour 24, and every case below aims at it.
const LONDON_MIDNIGHT = new Date("2026-12-15T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

async function main() {
  const hc = new Intl.DateTimeFormat("en-US", { hour12: false, hour: "2-digit", timeZone: "UTC" }).resolvedOptions().hourCycle;
  console.log(`local-day suite - node ${process.version}, ICU ${process.versions.icu}, hour12:false resolves to ${hc}`);
  if (MUTATE) console.log(`MUTATE=${MUTATE}\n`); else console.log("");

  // ── 1. the platform fact every `% 24` repair rests on ─────────────────────
  // If a runtime ever renders hour 24 AND rolls the date back to the previous
  // day, every repair in this codebase becomes half a fix. Assert it directly.
  {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London", weekday: "short", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", hourCycle: "h24",
    }).formatToParts(LONDON_MIDNIGHT).map((x) => [x.type, x.value]));
    expect("1. h24 renders the hour as 24", p.hour, "24");
    expect("1. h24 leaves the DATE alone", `${p.year}-${p.month}-${p.day}`, "2026-12-15");
    expect("1. h24 leaves the WEEKDAY alone", p.weekday, "Tue");
  }

  // ── 2. todayBoundsMs returns the academy's own day ────────────────────────
  const { todayBoundsMs } = await v15Module();
  const bounds = (tz, nowIso) => todayBoundsMs(tz, new Date(nowIso));
  // The case that was RED before the fix on Node 20, and the reason this is not
  // a latent bug: Europe/London in GMT is a live academy's real winter.
  expect("2. Europe/London in GMT (Dec)", iso(bounds("Europe/London", "2026-12-15T15:00:00Z").start), "2026-12-15T00:00:00.000Z");
  // Spring-forward day. London is BST by 05:00Z, but the MIDNIGHT it is asking
  // about was still GMT, so this is the h24 case too.
  expect("2. Europe/London on the spring-forward day", iso(bounds("Europe/London", "2026-03-29T05:00:00Z").start), "2026-03-29T00:00:00.000Z");
  expect("2. UTC", iso(bounds("UTC", "2026-07-29T15:00:00Z").start), "2026-07-29T00:00:00.000Z");
  // Zones that were already correct. These are the regression half: the fix must
  // not have bought London's winter at the cost of the other 45 academies.
  expect("2. Europe/London in BST (Jul)", iso(bounds("Europe/London", "2026-07-29T15:00:00Z").start), "2026-07-28T23:00:00.000Z");
  expect("2. Europe/London on the fall-back day", iso(bounds("Europe/London", "2026-10-25T05:00:00Z").start), "2026-10-24T23:00:00.000Z");
  expect("2. America/Toronto (EST)", iso(bounds("America/Toronto", "2026-12-15T15:00:00Z").start), "2026-12-15T05:00:00.000Z");
  expect("2. America/Toronto (EDT)", iso(bounds("America/Toronto", "2026-07-29T15:00:00Z").start), "2026-07-29T04:00:00.000Z");
  expect("2. America/New_York", iso(bounds("America/New_York", "2026-07-29T15:00:00Z").start), "2026-07-29T04:00:00.000Z");
  expect("2. America/Los_Angeles", iso(bounds("America/Los_Angeles", "2026-07-29T15:00:00Z").start), "2026-07-29T07:00:00.000Z");
  expect("2. America/Phoenix (no DST)", iso(bounds("America/Phoenix", "2026-07-29T15:00:00Z").start), "2026-07-29T07:00:00.000Z");
  // The window is exactly one day wide and half-open.
  const w = bounds("Europe/London", "2026-12-15T15:00:00Z");
  expect("2. the window is exactly 24h", w.end - w.start, 24 * 3600 * 1000);

  // ── 3. the NULL-timezone fallback is real, not assumed ────────────────────
  // clients.time_zone is NULL for one academy (Next Level Training Academy), so
  // "what does NULL do here" is a live question, not a hypothetical.
  //
  // The answer is that NULL never reaches Intl: both call sites coalesce to
  // America/Toronto first. That coalesce is LOAD-BEARING and not merely tidy.
  // Intl.DateTimeFormat treats `timeZone: undefined` as "use the HOST's zone"
  // rather than throwing - checked by execution below, because the first draft
  // of this test assumed it threw and was wrong. On Vercel the host zone is UTC,
  // which is precisely the UTC+0 case that triggered this whole bug. So dropping
  // a `||` would not produce a loud 500; it would produce a silently wrong day
  // on an h24 runtime, for the one academy whose zone is unset.
  {
    const v15 = fs.readFileSync(path.join(HERE, "ghl/calendars-v15.js"), "utf8");
    const sites = (v15.match(/todayBoundsMs\((?!tz)/g) || []).length;
    expect("3. there are call sites to check at all", sites > 0, true);
    expect("3. every todayBoundsMs call site is fed a coalesced zone",
      (v15.match(/todayBoundsMs\(\s*(timezone|client\.time_zone \|\| "America\/Toronto")\s*\)/g) || []).length, sites);
    expect("3. the `timezone` local itself coalesces NULL",
      v15.includes('const timezone = client.time_zone || "America/Toronto";'), true);
    const hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect("3. an uncoalesced NULL silently becomes the HOST zone, it does not throw",
      todayBoundsMs(undefined, LONDON_MIDNIGHT).start, todayBoundsMs(hostTz, LONDON_MIDNIGHT).start);
  }

  // ── 4. hour12 does not come back ──────────────────────────────────────────
  // On an h23 runtime this regression is invisible to behaviour, so the source
  // is the only place it can be caught on every runtime.
  {
    // Slice each function's own BODY, from its signature to the first
    // column-zero `}`. Slicing a fixed character count instead let case 4 spill
    // into dayWindow's comment - which legitimately says "hour12" - and report a
    // failure that was not there.
    const body = (src, sig) => {
      const i = src.indexOf(sig);
      if (i < 0) return "";
      const end = src.indexOf("\n}", i);
      return src.slice(i, end < 0 ? src.length : end);
    };
    const v15 = MUTATE === "hint" ? V15_HINT : body(sourceOf("ghl/calendars-v15.js"), "export function todayBoundsMs");
    expect("4. todayBoundsMs body was found", v15.length > 0, true);
    expect("4. todayBoundsMs asks for hourCycle h23", v15.includes('hourCycle: "h23"'), true);
    expect("4. todayBoundsMs does NOT hint with hour12", v15.includes("hour12"), false);
    const lh = MUTATE === "cronhint" ? CRON_HINT : body(sourceOf("ghl/cron-trial-summary.js"), "export function localHour");
    expect("4. localHour body was found", lh.length > 0, true);
    expect("4. localHour asks for hourCycle h23", lh.includes('hourCycle: "h23"'), true);
    expect("4. localHour does NOT hint with hour12", lh.includes("hour12"), false);

    // The seven sites converted when the class was closed. Same pin, same reason:
    // on an h23 runtime a revert here is invisible to behaviour, so the source is
    // the only place it can be caught. Each is named so a failure says WHICH.
    const SITES = [
      ["dayWindow", "ghl/cron-trial-summary.js", "export function dayWindow"],
      ["localIsoParts", "_local-iso.js", "export function localIsoParts"],
      ["_quiet localMinutes", "agent/_quiet.js", "function localMinutes"],
      ["_quiet tzOffsetMinutes", "agent/_quiet.js", "function tzOffsetMinutes"],
      ["_academy-facts localParts", "_academy-facts.js", "function localParts"],
      ["reignition offsetMsAt", "agent/reignition.js", "function offsetMsAt"],
    ];
    for (const [name, rel, sig] of SITES) {
      const b = body(sourceOf(rel), sig);
      expect(`4. ${name} body was found`, b.length > 0, true);
      expect(`4. ${name} asks for hourCycle h23`, b.includes('hourCycle: "h23"'), true);
      expect(`4. ${name} does NOT hint with hour12`, b.includes("hour12"), false);
    }
    // fmtTime is the DISPLAY site, and it is in here on purpose. `hour12: true` is
    // the same unresolved hint pointing the other way - h11 is a legal resolution
    // and h11 renders NOON as "0:00 PM". Zoran's ruling was explicit: everywhere,
    // display included, so nobody is ever shown a 24:00 or a 0:00 PM.
    const ft = body(sourceOf("ghl/cron-trial-summary.js"), "function fmtTime");
    expect("4. fmtTime body was found", ft.length > 0, true);
    expect("4. fmtTime asks for hourCycle h12", ft.includes('hourCycle: "h12"'), true);
    expect("4. fmtTime does NOT hint with hour12 either", ft.includes("hour12"), false);
  }

  // ── 5. cron-trial-summary: localHour + dayWindow ──────────────────────────
  {
    const { localHour, dayWindow } = await cronModule();
    expect("5. localHour at London midnight is 0, not 24", localHour("Europe/London", LONDON_MIDNIGHT), 0);
    expect("5. localHour at London 15:00", localHour("Europe/London", new Date("2026-12-15T15:00:00Z")), 15);
    expect("5. localHour Toronto 8am (the send hour this cron exists for)", localHour("America/Toronto", new Date("2026-12-15T13:00:00Z")), 8);
    expect("5. dayWindow London in GMT", iso(dayWindow("Europe/London", new Date("2026-12-15T15:00:00Z")).start), "2026-12-15T00:00:00.000Z");
    expect("5. dayWindow London AT midnight (the h24 instant)", iso(dayWindow("Europe/London", LONDON_MIDNIGHT).start), "2026-12-15T00:00:00.000Z");
    expect("5. dayWindow Toronto", iso(dayWindow("America/Toronto", new Date("2026-12-15T15:00:00Z")).start), "2026-12-15T05:00:00.000Z");
  }

  // ── 6. reignition.startOfDayIso ───────────────────────────────────────────
  {
    const { startOfDayIso } = await reignModule();
    expect("6. startOfDayIso London in GMT", startOfDayIso(new Date("2026-12-15T15:00:00Z"), "Europe/London"), "2026-12-15T00:00:00.000Z");
    expect("6. startOfDayIso London AT midnight", startOfDayIso(LONDON_MIDNIGHT, "Europe/London"), "2026-12-15T00:00:00.000Z");
    expect("6. startOfDayIso UTC", startOfDayIso(new Date("2026-07-29T15:00:00Z"), "UTC"), "2026-07-29T00:00:00.000Z");
    expect("6. startOfDayIso Toronto", startOfDayIso(new Date("2026-12-15T15:00:00Z"), "America/Toronto"), "2026-12-15T05:00:00.000Z");
  }

  // ── 7. quiet hours ────────────────────────────────────────────────────────
  // Midnight is outside 08:00-21:30, and the next sendable time is 08:00 on the
  // SAME local day. Read the hour as 24 and midnight looks like hour 24, which
  // is also outside the window - so `withinQuietHours` alone would not catch it.
  // `nextSendableTime` is the assertion that does: it names a day.
  {
    const { withinQuietHours, nextSendableTime } = await quietModule();
    expect("7. London midnight is outside quiet hours", withinQuietHours(LONDON_MIDNIGHT, "Europe/London"), false);
    expect("7. next sendable is 08:00 the SAME London day", nextSendableTime(LONDON_MIDNIGHT, "Europe/London").toISOString(), "2026-12-15T08:00:00.000Z");
    expect("7. London 10:00 is inside quiet hours", withinQuietHours(new Date("2026-12-15T10:00:00Z"), "Europe/London"), true);
  }

  // ── 8. weeklySchedule (member-facing class times) ─────────────────────────
  {
    const { weeklySchedule } = await factsModule();
    const wk = weeklySchedule([{ name: "Midnight", start_time: "2026-12-15T00:00:00Z", end_time: "2026-12-15T01:00:00Z" }], "Europe/London");
    expect("8. a midnight session is on Tuesday", wk[0] && wk[0].day, "Tuesdays");
    expect("8. a midnight session reads 12-1am, not 24", wk[0] && wk[0].groups[0].time, "12-1am");
    const ev = weeklySchedule([{ name: "Evening", start_time: "2026-12-15T19:00:00Z", end_time: "2026-12-15T20:00:00Z" }], "Europe/London");
    expect("8. an evening session is unaffected", ev[0] && ev[0].groups[0].time, "7-8pm");
  }

  // ── 9. localIsoParts - the ONE builder both booking.js and availability.js use ─
  //
  // This used to say "availability.js's copy is pinned by TEXT, not executed",
  // which was honest and also the problem: the copy that served real client
  // websites was the one no test had ever run. There is no copy now. Both
  // callers import api/_local-iso.js, so the lines below EXECUTE the code path
  // /api/website/availability takes, on the instant that triggers h24.
  {
    const { localIsoParts } = await isoModule();
    expect("9. localIsoParts at London midnight", localIsoParts("2026-12-15T00:00:00Z", "Europe/London"),
      { day: "2026-12-15", iso: "2026-12-15T00:00:00+00:00" });
    expect("9. localIsoParts Toronto evening", localIsoParts("2026-12-15T00:00:00Z", "America/Toronto"),
      { day: "2026-12-14", iso: "2026-12-14T19:00:00-05:00" });
    // The GHL branch of the same endpoint emits -04:00 style offsets in summer;
    // the portal branch has to round-trip identically or the site's picker and
    // booking.start disagree.
    expect("9. localIsoParts Toronto summer keeps the DST offset", localIsoParts("2026-07-29T23:00:00Z", "America/Toronto"),
      { day: "2026-07-29", iso: "2026-07-29T19:00:00-04:00" });
    expect("9. localIsoParts UTC midnight", localIsoParts("2026-07-29T00:00:00Z", "UTC"),
      { day: "2026-07-29", iso: "2026-07-29T00:00:00+00:00" });

    // booking.js must still expose it, because that is where the agent imports it.
    const { localIsoParts: viaBooking } = await import("./agent/booking.js");
    expect("9. booking.js still exports localIsoParts", typeof viaBooking, "function");

    // WIRING. Executing the helper proves the helper; it does not prove
    // availability.js calls it. This pair does, and MUTATE=availwiring gives
    // availability.js an inline copy back to prove they are not decorative.
    const avail = availabilitySource();
    expect("9. availability.js calls the shared localIsoParts",
      avail.includes("const { day, iso } = localIsoParts(s.start_time, timezone);"), true);
    expect("9. availability.js builds no local-ISO formatter of its own",
      avail.includes('timeZoneName: "longOffset"'), false);
  }

  // ── 10. the surviving `% 24` repairs are BELT AND BRACES, and they still bite ──
  //
  // Converting every site to hourCycle h23 made each `% 24` / `=== "24" ? 0`
  // repair unreachable. That is the moment a repair quietly becomes dead code and
  // its comment becomes a lie - and this codebase has been bitten by stale
  // comments repeatedly. The repairs were KEPT, so the claim "still correct if the
  // cycle is ever wrong again" has to be executed, not asserted.
  //
  // Each site is re-run with the cycle forced BACK to h24 and NOTHING else
  // changed. Same expected values as the h23 run above. If a repair is ever
  // deleted, or is incomplete, this case goes red on any runtime.
  {
    const { dayWindow } = await mutantModule(H24.day[0], [toH24("day")], "case 10 (belt-and-braces)");
    expect("10. dayWindow under h24 still returns the right day", iso(dayWindow("Europe/London", LONDON_MIDNIGHT).start), "2026-12-15T00:00:00.000Z");

    const { localIsoParts } = await mutantModule(H24.iso[0], [toH24("iso")], "case 10 (belt-and-braces)");
    expect("10. localIsoParts under h24 still serialises 00, not 24", localIsoParts("2026-12-15T00:00:00Z", "Europe/London"),
      { day: "2026-12-15", iso: "2026-12-15T00:00:00+00:00" });

    const q = await mutantModule(H24.quietA[0], [toH24("quietA"), toH24("quietB")], "case 10 (belt-and-braces)");
    expect("10. quiet hours under h24 still names the same day", q.nextSendableTime(LONDON_MIDNIGHT, "Europe/London").toISOString(), "2026-12-15T08:00:00.000Z");

    const f = await mutantModule(H24.facts[0], [toH24("facts")], "case 10 (belt-and-braces)");
    const wk24 = f.weeklySchedule([{ name: "Midnight", start_time: "2026-12-15T00:00:00Z", end_time: "2026-12-15T01:00:00Z" }], "Europe/London");
    expect("10. weeklySchedule under h24 still reads 12-1am", wk24[0] && wk24[0].groups[0].time, "12-1am");

    const r = await mutantModule(H24.reign[0], [toH24("reign")], "case 10 (belt-and-braces)");
    expect("10. startOfDayIso under h24 still returns local midnight", r.startOfDayIso(LONDON_MIDNIGHT, "Europe/London"), "2026-12-15T00:00:00.000Z");

    // And the two sites that have NO repair, said out loud so nobody assumes they
    // are covered by the same belt: todayBoundsMs and localHour are correct
    // BECAUSE of the cycle and nothing else. That is what MUTATE=h24 and
    // MUTATE=cronh24 exist to prove, and it is why case 4's text pins are the
    // load-bearing guard for those two.
  }

  // ── 11. the conversion changed nothing except at midnight ─────────────────
  //
  // The claim behind this whole change is "same value everywhere, except local
  // midnight, where the new value is the correct one". Swept rather than asserted:
  // every zone in clients.time_zone, a full year including both DST edges.
  {
    const ZONES = ["Europe/London", "America/Toronto", "America/New_York", "America/Los_Angeles", "America/Phoenix", "UTC"];
    const SHAPE = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" };
    let compared = 0, differed = 0, differedAwayFromMidnight = 0;
    for (const tz of ZONES) {
      const h23 = new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...SHAPE, hourCycle: "h23" });
      const h24 = new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...SHAPE, hourCycle: "h24" });
      // 29 minutes is deliberately coprime with the hour, so the sweep lands on
      // every minute-of-hour rather than only on :00 and :30.
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 29 * 60 * 1000) {
        const d = new Date(t);
        const a = h23.format(d), b = h24.format(d);
        compared++;
        if (a === b) continue;
        differed++;
        if (Number(h23.formatToParts(d).find((p) => p.type === "hour").value) !== 0) differedAwayFromMidnight++;
      }
    }
    expect("11. the sweep actually ran", compared > 100000, true);
    expect("11. h23 and h24 DO differ (or this sweep proves nothing)", differed > 0, true);
    expect("11. they differ at local midnight ONLY", differedAwayFromMidnight, 0);
    console.log(`  note  swept ${compared} instants x ${ZONES.length} zones; h23 vs h24 differ ${differed} times, all of them at local midnight`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("");
  if (MUTATE) {
    if (controlBroken) { console.log(`NEGATIVE CONTROL FAILED\n${controlBroken}`); process.exit(1); }
    if (failures > 0) { console.log(`NEGATIVE CONTROL PASSED - MUTATE=${MUTATE} broke ${failures} assertion(s), as it must.`); process.exit(0); }
    console.log(`NEGATIVE CONTROL FAILED - MUTATE=${MUTATE} changed nothing this suite noticed. The check it targets is decorative.`);
    process.exit(1);
  }
  if (failures > 0) { console.log(`${failures} failure(s).`); process.exit(1); }
  console.log("All local-day assertions passed.");
}

main().catch((e) => {
  if (MUTATE && controlBroken) { console.log(`NEGATIVE CONTROL FAILED\n${controlBroken}`); process.exit(1); }
  console.error(e);
  process.exit(1);
});
