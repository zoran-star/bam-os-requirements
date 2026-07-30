// ONE local-offset ISO builder, shared by every surface that hands slot times to
// a website or a booking payload.
//
// "2026-07-07T19:00:00-04:00"-style local-offset ISO + local day key, matching
// what the GHL free-slots API emitted so downstream consumers are unchanged.
//
// WHY THIS FILE EXISTS. api/agent/booking.js and api/website/availability.js each
// carried their own byte-similar copy of this. When the hour12 bug class was found
// only booking.js's copy could be executed by api/_local-day.test.mjs, because
// availability.js's copy lived inline inside a Supabase-backed handler - so the
// second copy was guarded by a TEXT COMPARISON against the first and never run.
// A test that only compares two strings cannot tell you either of them is right.
// One function, imported by both, is executable by definition.
//
// This module imports NOTHING. That is deliberate: it keeps it loadable by the
// plain-node suites, which have no dependencies, no network and no database.
//
// hourCycle: "h23", NOT hour12: false. `hour12` is a HINT the engine RESOLVES to
// a cycle, and it does not resolve the same way everywhere: on the same ICU 78.2,
// Node 20 resolves it to h24 and renders local midnight as hour "24", while Node
// 24 resolves it to h23 and renders "00". Do not put `hour12` back: per ECMA-402
// `hour12` OVERRIDES `hourCycle`, so the two cannot coexist and the hint wins.
//
// The `parts.hour === "24" ? "00"` below is now BELT AND BRACES, not the fix.
// Before the hourCycle conversion it was the only thing standing between an h24
// runtime and a midnight slot serialised as "T24:00:00", and its comment said so.
// It is kept because it costs nothing (under h23 the hour is always 00-23, so the
// branch is never taken - proven by execution over a year-long sweep) and because
// it still catches the value if the cycle is ever wrong again, whether by an edit
// here or by an engine that ignores hourCycle. Case 10 of api/_local-day.test.mjs
// PROVES it still bites, by running this function with the cycle forced to h24 and
// requiring the correct answer anyway. MUTATE=isoguard proves it is not decorative.
export function localIsoParts(dateUtc, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(dateUtc)).map(p => [p.type, p.value]));
  const off = (parts.timeZoneName || "GMT+00:00").replace("GMT", "") || "+00:00";
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, iso: `${day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}${off}` };
}
