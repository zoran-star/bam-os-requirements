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
//   4. hour12 DOES NOT COME BACK. A text pin, not a behaviour check, and
//      deliberately so: on an h23 runtime the regression is INVISIBLE to any
//      behavioural assertion, so the only guard that works on every runtime is
//      one that reads the source.
//   5-9. THE OTHER HELPERS, BY EXECUTION. cron localHour + dayWindow, reignition
//      startOfDayIso, quiet hours, weeklySchedule, booking localIsoParts - each
//      asked for the London-midnight instant that triggers h24.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. A suite that only ever passes proves nothing.
//
//   MUTATE=hint       node api/_local-day.test.mjs # put hour12:false back in todayBoundsMs
//   MUTATE=h24        node api/_local-day.test.mjs # pin todayBoundsMs to hourCycle h24
//   MUTATE=cronhint   node api/_local-day.test.mjs # put hour12:false back in localHour
//   MUTATE=cronh24    node api/_local-day.test.mjs # pin localHour to hourCycle h24
//   MUTATE=daywindow  node api/_local-day.test.mjs # strip dayWindow's 24->0 repair
//   MUTATE=isoguard   node api/_local-day.test.mjs # strip booking localIsoParts' 24->00 repair
//   MUTATE=quietguard node api/_local-day.test.mjs # strip _quiet's % 24 repair
//   MUTATE=factsguard node api/_local-day.test.mjs # strip _academy-facts' % 24 repair
//   MUTATE=reignguard node api/_local-day.test.mjs # strip reignition's 24->0 repair
//   MUTATE=availtext  node api/_local-day.test.mjs # drop availability.js's 24->00 repair
//
// Each must report NEGATIVE CONTROL PASSED. If one reports FAILED, the check it
// targets is decorative and must not be quoted as evidence.
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
let mutantCount = 0;
async function mutantModule(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of api/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
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
    ['hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,',
     'hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h24",'],
    ['g("hour") === 24 ? 0 : g("hour")', 'g("hour")'],
  ]);
  return import("./ghl/cron-trial-summary.js");
}

async function bookingModule() {
  if (MUTATE !== "isoguard") return import("./agent/booking.js");
  return mutantModule("agent/booking.js", [
    ['second: "2-digit", hour12: false, timeZoneName: "longOffset" });\n  const parts = Object.fromEntries(fmt.formatToParts(new Date(dateUtc))',
     'second: "2-digit", hourCycle: "h24", timeZoneName: "longOffset" });\n  const parts = Object.fromEntries(fmt.formatToParts(new Date(dateUtc))'],
    ['${parts.hour === "24" ? "00" : parts.hour}', '${parts.hour}'],
  ]);
}

async function quietModule() {
  if (MUTATE !== "quietguard") return import("./agent/_quiet.js");
  return mutantModule("agent/_quiet.js", [
    ['{ timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }',
     '{ timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h24" }'],
    ['const h = Number(parts.find(p => p.type === "hour").value) % 24;',
     'const h = Number(parts.find(p => p.type === "hour").value);'],
  ]);
}

async function factsModule() {
  if (MUTATE !== "factsguard") return import("./_academy-facts.js");
  return mutantModule("_academy-facts.js", [
    ['timeZone, weekday: "short", hour: "numeric", minute: "numeric", hour12: false,',
     'timeZone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h24",'],
    ['const hour = Number(parts.hour) % 24;', 'const hour = Number(parts.hour);'],
  ]);
}

async function reignModule() {
  if (MUTATE !== "reignguard") return import("./agent/reignition.js");
  return mutantModule("agent/reignition.js", [
    ['minute: "2-digit", second: "2-digit", hour12: false })\n    .formatToParts(instant)',
     'minute: "2-digit", second: "2-digit", hourCycle: "h24" })\n    .formatToParts(instant)'],
    ['Number(p.hour === "24" ? "0" : p.hour)', 'Number(p.hour)'],
  ]);
}

// availability.js's copy of the local-ISO shape lives inline inside a handler
// that needs Supabase, so it cannot be executed here. It is pinned by text
// against booking.js's copy, which IS executed below.
function availabilitySource() {
  if (MUTATE !== "availtext") return fs.readFileSync(path.join(HERE, "website/availability.js"), "utf8");
  return fs.readFileSync(path.join(HERE, "website/availability.js"), "utf8")
    .split('${parts.hour === "24" ? "00" : parts.hour}').join("${parts.hour}");
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
    const v15 = MUTATE === "hint" ? V15_HINT : body(fs.readFileSync(path.join(HERE, "ghl/calendars-v15.js"), "utf8"), "export function todayBoundsMs");
    expect("4. todayBoundsMs body was found", v15.length > 0, true);
    expect("4. todayBoundsMs asks for hourCycle h23", v15.includes('hourCycle: "h23"'), true);
    expect("4. todayBoundsMs does NOT hint with hour12", v15.includes("hour12"), false);
    const lh = MUTATE === "cronhint" ? CRON_HINT : body(fs.readFileSync(path.join(HERE, "ghl/cron-trial-summary.js"), "utf8"), "export function localHour");
    expect("4. localHour body was found", lh.length > 0, true);
    expect("4. localHour asks for hourCycle h23", lh.includes('hourCycle: "h23"'), true);
    expect("4. localHour does NOT hint with hour12", lh.includes("hour12"), false);
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

  // ── 9. booking localIsoParts, and availability.js's copy of it ────────────
  {
    const { localIsoParts } = await bookingModule();
    expect("9. localIsoParts at London midnight", localIsoParts("2026-12-15T00:00:00Z", "Europe/London"),
      { day: "2026-12-15", iso: "2026-12-15T00:00:00+00:00" });
    expect("9. localIsoParts Toronto evening", localIsoParts("2026-12-15T00:00:00Z", "America/Toronto"),
      { day: "2026-12-14", iso: "2026-12-14T19:00:00-05:00" });
    // availability.js builds the same string inline inside a Supabase-backed
    // handler, so it is pinned by text rather than executed. Said plainly here
    // so nobody quotes this line as if the code had been run.
    expect("9. availability.js keeps the same 24->00 repair (TEXT PIN, not executed)",
      availabilitySource().includes('${parts.hour === "24" ? "00" : parts.hour}'), true);
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
