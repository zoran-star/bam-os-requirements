// Route a kid to a class by their ACTUAL AGE, not by the name of a calendar.
//
//   node api/_class-routing.test.mjs        # exits non-zero on any failure
//
// Plain node, no dependencies, no network, no database - the same style as
// api/_offer-schedule.test.mjs and api/_sync-class.test.mjs. Discovered and run
// by .github/workflows/portal-ci.yml's api/_*.test.mjs glob.
//
// WHAT THIS SUITE IS FOR. Two things that look similar and are opposites:
//
//   "no class fits this child"   -> they are NOT QUALIFIED. Say so.
//   "I could not read this age"  -> ASK THE PARENT. Never turn them away.
//
// A form field called athlete_age is a plain text box, so "9", "nine",
// "9 turning 10" and "" all really arrive. Collapsing the second case into the
// first turns a typo into a lost customer, silently, with every step behaving
// correctly. That is the failure this file exists to make impossible.
//
// The other half is BAM GTA, which must not move a millimetre. GTA's live
// second group is "ages 14 AND UP" - an open top. If a missing age_max ever
// came to mean "matches nobody" instead of "no upper limit", GTA's older group
// would go dark and every assertion about younger kids would still pass. That
// is MUTATE=nomax below, and it is the reason it is in here.
//
// ── NEGATIVE CONTROLS ───────────────────────────────────────────────────────
// Each one reverts a real fix in the real source file (read from disk, mutated
// in memory, re-imported), and the run counts as caught ONLY if it prints
// NEGATIVE CONTROL PASSED. A non-zero exit is not accepted as proof: a control
// whose target text has moved also exits non-zero, and that is a control
// proving nothing while looking like it works.
//
//   MUTATE=nomax        api/agent/_class-routing.js: a missing age_max stops
//     meaning "no upper limit" and starts meaning "matches nobody". This is the
//     mutation that would have shipped BAM GTA's 14-and-up group as a dead band.
//   MUTATE=exclusivemax api/agent/_class-routing.js: the top bound becomes
//     exclusive. Off by one, invisible except to a 13 year old, who quietly
//     stops fitting GTA's Group 1.
//   MUTATE=readunknownasno api/agent/_class-routing.js: an unreadable age
//     ("nine") is reported as an ordinary age instead of unknown, so the caller
//     sees "no class fits" and turns the family away. THE bug this file is for.
//   MUTATE=strandedmax  api/agent/_class-routing.js: a number left behind in the
//     hidden age_max box outranks the owner's explicit "no upper limit". An owner
//     who types 18 and then switches the toggle really does leave that 18 in the
//     row, so this is a state that can still arise, not a hypothetical.
//   MUTATE=nokey        api/_offer-schedule.js: stop putting
//     source_offer_class_key in the template payload. This is the first of the
//     two breaks that left the column NULL on all 86 BAM GTA slots.
//   MUTATE=noofferid    api/_offer-schedule.js: stop putting source_offer_id in
//     the payload, so a slot knows which class it is but not whose offer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log("  ✅ " + m); } else { fails.push(m); console.log("  ❌ " + m); } };

// A THROW IS A FAILURE, NOT A CRASH. Under a negative control the code is
// deliberately wrong, so an assertion can hit undefined and blow up. If that
// killed the process the run would never reach the banner, and the control
// would be judged on its exit code - the exact false positive portal-ci.yml
// documents. Every section runs inside this, so the banner always prints.
function section(label, fn) {
  console.log("\n── " + label + " ──");
  try { fn(); }
  catch (e) { fails.push(`${label}: threw ${e && e.message}`); console.log(`  ❌ threw: ${e && e.message}`); }
}

// ── mutant loading, the same contract as api/_arming-gate.test.mjs ──────────
// A control that cannot find its target is NOT "caught": the suite would throw,
// report a failure, and a runner keying on "did it fail?" would call that a
// working control. So a missing target sets controlBroken and the banner says
// NEGATIVE CONTROL FAILED with the reason.
let controlBroken = null;
let mutantCount = 0;
async function mutantModule(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
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
  } finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

const M_ROUTING = {
  nomax: [[
    "  if (r.max !== null && age > r.max) return false;",
    "  if (r.max === null || age > r.max) return false;",
  ]],
  exclusivemax: [[
    "  if (r.max !== null && age > r.max) return false;",
    "  if (r.max !== null && age >= r.max) return false;",
  ]],
  readunknownasno: [[
    `  if (!m) return { ok: false, reason: "no_number", text };`,
    `  if (!m) return { ok: true, age: 0, text };`,
  ]],
  strandedmax: [[
    "  const max = openTop ? null : intOrNull(c.age_max);",
    "  const max = intOrNull(c.age_max);",
  ]],
};
const M_OFFER = {
  nokey: [["        source_offer_class_key: sourceClassKey,\n", ""]],
  noofferid: [["      if (sourceOfferId) payload.source_offer_id = sourceOfferId;\n", ""]],
};

let routing, offerSchedule;
try {
  routing = M_ROUTING[MUTATE]
    ? await mutantModule("agent/_class-routing.js", M_ROUTING[MUTATE])
    : await import("./agent/_class-routing.js");
  offerSchedule = M_OFFER[MUTATE]
    ? await mutantModule("_offer-schedule.js", M_OFFER[MUTATE])
    : await import("./_offer-schedule.js");
} catch (e) {
  // A control that cannot be applied must SAY so. Left to throw, it would exit
  // non-zero and print no banner, which reads as "the suite noticed" to anyone
  // judging by exit code.
  console.log(`\n❌ ${MUTATE ? "NEGATIVE CONTROL FAILED" : "SUITE COULD NOT LOAD"}: ${controlBroken || (e && e.message)}`);
  process.exit(1);
}

const {
  resolveClassesForAge, parseAthleteAge, classFitsAge, classAgeRange,
  classKey, ageCoverageGaps,
} = routing;
const { offerToTemplatePayloads } = offerSchedule;

// ── fixtures ────────────────────────────────────────────────────────────────

// BAM GTA. REAL, AND LIVE. The two classes and the two age bands are
// transcribed verbatim from the booking instructions the agent runs on today,
// api/agent/prompt-structure.js ("Group 1 (Elementary / younger): ages 9 to 13"
// / "Group 2 (High School / older): ages 14 and up"), and the titles are its
// two real calendar labels.
//
// ONE HONEST CAVEAT: the age_min / age_max FIELDS do not exist on GTA's offer
// row yet - nobody has typed them, because the input that collects them has not
// shipped. So this fixture is GTA's real, live, currently-in-production age
// policy expressed in the new fields, not a dump of GTA's current offer data.
// What it pins is that the new mechanism reproduces the old policy exactly.
const GTA = [
  { title: "Group 1 (Elementary)",  age: "9 to 13",   age_min: 9,  age_max_mode: "Set an oldest age", age_max: 13 },
  { title: "Group 2 (High School)", age: "14 and up", age_min: 14, age_max_mode: "No upper limit" },
];

// San Jose. INVENTED FIXTURE - NOT SAN JOSE'S REAL CONFIGURATION.
//
// The three class TITLES are real (they are the classes in San Jose's offer).
// The three age RANGES below are made up. Lij has not supplied San Jose's age
// bands and nobody has asked him yet. They are here because they are the
// shapes the rules have to handle - an overlap at 11, a straddle at 12 - not
// because anyone believes them. Do not quote these numbers at San Jose, do not
// seed them, and do not treat a passing run here as evidence San Jose is
// configured. Replace them with Lij's real answers when they arrive.
const SJ_INVENTED = [
  { title: "Beginner",           age: "8-11",  age_min: 8,  age_max: 11 },
  { title: "Elementary",         age: "11-14", age_min: 11, age_max: 14 },
  { title: "Pre-Season Academy", age: "12-18", age_min: 12, age_max: 18 },
];

const titles = (r) => r.matches.map((m) => m.title);

// ── 1. BAM GTA, the strictest block in this file ────────────────────────────
section("BAM GTA's two real bands: 9-13 and 14-and-up", () => {

  const r9 = resolveClassesForAge(9, GTA);
  ok(r9.status === "single" && titles(r9)[0] === "Group 1 (Elementary)",
    `age 9 -> Group 1 only (got ${r9.status}: ${titles(r9).join(", ") || "none"})`);

  // The top of a band is INCLUSIVE. An off-by-one here moves every 13 year old
  // in the academy into the high school group and nothing else notices.
  const r13 = resolveClassesForAge(13, GTA);
  ok(r13.status === "single" && titles(r13)[0] === "Group 1 (Elementary)",
    `age 13 -> Group 1 only, the top bound is inclusive (got ${r13.status}: ${titles(r13).join(", ") || "none"})`);

  const r14 = resolveClassesForAge(14, GTA);
  ok(r14.status === "single" && titles(r14)[0] === "Group 2 (High School)",
    `age 14 -> Group 2 only (got ${r14.status}: ${titles(r14).join(", ") || "none"})`);

  // "and up" has to actually mean and up. This is the assertion that would have
  // caught shipping GTA's older group as a band that matches nobody.
  const r40 = resolveClassesForAge(40, GTA);
  ok(r40.status === "single" && titles(r40)[0] === "Group 2 (High School)",
    `age 40 -> Group 2 only, a null age_max is NO LIMIT (got ${r40.status}: ${titles(r40).join(", ") || "none"})`);

  // Below the youngest band. Read fine, fits nothing: not qualified, and that
  // is a different answer from "I could not read that".
  const r8 = resolveClassesForAge(8, GTA);
  ok(r8.status === "unqualified" && r8.age === 8,
    `age 8 -> unqualified, NOT unknown_age (got ${r8.status})`);

  // GTA's two bands are contiguous and disjoint, and must stay that way.
  let both = [], gap = [];
  for (let a = 9; a <= 80; a += 1) {
    const r = resolveClassesForAge(a, GTA);
    if (r.matches.length > 1) both.push(a);
    if (r.matches.length === 0) gap.push(a);
  }
  ok(both.length === 0, `no age 9-80 routes to BOTH GTA classes (offenders: ${both.join(", ") || "none"})`);
  ok(gap.length === 0, `no age 9-80 falls between GTA's two classes (offenders: ${gap.join(", ") || "none"})`);
  ok(ageCoverageGaps(GTA).length === 0, "GTA's bands report zero coverage gaps");
});

// ── 2. the two answers that must never be confused ──────────────────────────
section("unqualified is not the same as unreadable", () => {

  const r30 = resolveClassesForAge(30, SJ_INVENTED);
  ok(r30.status === "unqualified" && r30.age === 30 && r30.matches.length === 0,
    `age 30 -> unqualified with the age read as 30 (got ${r30.status})`);

  const rNine = resolveClassesForAge("nine", SJ_INVENTED);
  ok(rNine.status === "unknown_age" && rNine.reason === "no_number",
    `"nine" -> unknown_age/no_number, NOT unqualified (got ${rNine.status}/${rNine.reason})`);

  const rEmpty = resolveClassesForAge("", SJ_INVENTED);
  ok(rEmpty.status === "unknown_age" && rEmpty.reason === "empty",
    `"" -> unknown_age/empty (got ${rEmpty.status}/${rEmpty.reason})`);

  ok(resolveClassesForAge(null, SJ_INVENTED).status === "unknown_age", "null -> unknown_age");
  ok(resolveClassesForAge(undefined, SJ_INVENTED).status === "unknown_age", "undefined -> unknown_age");

  // Both are "we cannot book yet", but only one of them is the family's answer.
  ok(r30.status !== rNine.status,
    "age 30 and \"nine\" never collapse to the same status");
});

section("reading a free-text age box", () => {

  ok(parseAthleteAge("9").ok && parseAthleteAge("9").age === 9, `"9" -> 9`);
  ok(parseAthleteAge(9).ok && parseAthleteAge(9).age === 9, "the number 9 -> 9");
  ok(parseAthleteAge(" 11 ").age === 11, `" 11 " -> 11`);
  ok(parseAthleteAge("9 turning 10").age === 9, `"9 turning 10" -> 9, their age TODAY`);
  ok(parseAthleteAge("10 years old").age === 10, `"10 years old" -> 10`);
  ok(parseAthleteAge("nine").ok === false, `"nine" is not parsed - no word-to-number guessing`);
  ok(parseAthleteAge("dunno").reason === "no_number", `"dunno" -> no_number`);
  // A grade is not an age, and a grade means different ages in Ontario than in
  // California, so it cannot be converted. Ask.
  ok(parseAthleteAge("Grade 5").ok === false && parseAthleteAge("Grade 5").reason === "ambiguous_grade",
    `"Grade 5" -> ambiguous_grade, never silently read as 5`);
  // "U10" is a band, not this child's age.
  ok(parseAthleteAge("U10").reason === "ambiguous_band", `"U10" -> ambiguous_band, never read as 10`);
  ok(parseAthleteAge("300").reason === "out_of_range", `"300" -> out_of_range (a typo, so ask)`);
  ok(parseAthleteAge("-4").ok === false, `"-4" is not an age`);
});

// ── 3. San Jose's shapes, on invented numbers ───────────────────────────────
section("overlap and ask-one-question (INVENTED San Jose ranges)", () => {

  const r9 = resolveClassesForAge(9, SJ_INVENTED);
  ok(r9.status === "single" && titles(r9).join() === "Beginner",
    `age 9 -> Beginner only (got ${r9.status}: ${titles(r9).join(", ") || "none"})`);
  ok(r9.askOneQuestion === false, "one class fits -> no question asked");

  // 11 sits in Beginner (8-11) and Elementary (11-14) at once, because skill
  // level is never asked on the form. Zoran's rule: ask ONE question.
  const r11 = resolveClassesForAge(11, SJ_INVENTED);
  ok(r11.status === "multiple" && r11.matches.length === 2,
    `age 11 -> two classes fit (got ${r11.status}: ${titles(r11).join(", ") || "none"})`);
  ok(r11.askOneQuestion === true, "two classes fit -> askOneQuestion is true");
  ok(titles(r11).join() === "Beginner,Elementary", `and they are Beginner + Elementary (got ${titles(r11).join(", ")})`);
  ok(r11.matches.every((m) => m.key && m.title && m.index >= 0),
    "each match carries key + title + index, enough to book without re-deriving anything");

  const r12 = resolveClassesForAge(12, SJ_INVENTED);
  ok(r12.matches.length === 2, `age 12 -> Elementary + Pre-Season (got ${titles(r12).join(", ") || "none"})`);
});

section("a class with no upper limit", () => {

  const adults = [{ title: "Adult Run", age_min: 18, age_max: null }];
  const r40 = resolveClassesForAge(40, adults);
  ok(r40.status === "single" && titles(r40)[0] === "Adult Run",
    `age 40 fits an 18-and-up class (got ${r40.status})`);
  ok(resolveClassesForAge(17, adults).status === "unqualified", "age 17 does not");
  ok(classFitsAge({ age_min: null, age_max: null }, 40) && classFitsAge({ age_min: null, age_max: null }, 4),
    "a class with NEITHER bound set fits everyone (an unconfigured academy keeps working)");
  ok(resolveClassesForAge(9, [{ title: "Skills" }]).matches[0].configured === false,
    "...and the match says configured:false, so a caller can tell that apart from a real age decision");
  ok(classFitsAge({ age_min: 5, age_max: null }, 5) && classFitsAge({ age_min: null, age_max: 5 }, 5),
    "both ends inclusive when only one is set");
});

// ── 4. gaps: the hazard an owner has to be shown ────────────────────────────
section("a gap between classes is detectable", () => {

  const GAPPY = [
    { title: "Beginner",   age_min: 8,  age_max: 11 },
    { title: "Pre-Season", age_min: 13, age_max: 18 },
  ];
  const gaps = ageCoverageGaps(GAPPY);
  ok(gaps.length === 1 && gaps[0].from === 12 && gaps[0].to === 12,
    `8-11 next to 13-18 reports a gap at 12 (got ${JSON.stringify(gaps)})`);
  ok(resolveClassesForAge(12, GAPPY).status === "unqualified",
    "and a 12 year old really does fit nothing - the gap is not cosmetic");

  ok(ageCoverageGaps(SJ_INVENTED).length === 0, "overlapping ranges are legal and report no gap");
  ok(ageCoverageGaps([{ age_min: 8, age_max: 11 }]).length === 0,
    "a single class cannot have an interior gap");
  ok(ageCoverageGaps([{ age_min: 8, age_max: 11 }, { age_min: 14, age_max: null }]).length === 1,
    "8-11 next to 14-and-up reports the 12-13 hole");
  // Below the youngest and above the oldest are the edges of who the academy
  // serves, not gaps. A 4 year old is SUPPOSED to fit nothing.
  ok(ageCoverageGaps([{ age_min: 8, age_max: 11 }, { age_min: 12, age_max: 18 }]).length === 0,
    "contiguous classes report nothing (no phantom gap below 8 or above 18)");

  const r = resolveClassesForAge(9, [{ title: "Backwards", age_min: 14, age_max: 9 }]);
  ok(r.status === "unqualified" && r.problems.length === 1,
    "a min above the max fits nobody and is reported in problems, not swallowed");
});

section("the academy has no classes at all", () => {

  const r = resolveClassesForAge(9, []);
  ok(r.status === "no_classes", "zero classes -> no_classes, never 'unqualified' (that is our fault, not theirs)");
});

// ── 5. the class key ────────────────────────────────────────────────────────
section("the per-class key, derived from the title", () => {

  const cs = [{ title: "Beginner" }, { title: "Pre-Season Academy" }, { title: "Group 1 (Elementary)" }];
  ok(classKey(cs[0], 0, cs) === "beginner", `"Beginner" -> beginner`);
  ok(classKey(cs[1], 1, cs) === "pre-season-academy", `"Pre-Season Academy" -> pre-season-academy`);
  ok(classKey(cs[2], 2, cs) === "group-1-elementary", `"Group 1 (Elementary)" -> group-1-elementary`);

  // Same offer in, same keys out, every time. The payload builder re-runs on
  // every sync, so anything time- or random-derived would mint a new key a day.
  ok(classKey(cs[0], 0, cs) === classKey(cs[0], 0, cs.slice()), "deterministic across calls");

  const dup = [{ title: "Beginner" }, { title: "Beginner" }, { title: "beginner " }];
  ok(classKey(dup[0], 0, dup) === "beginner", "first of a duplicate title keeps the bare key");
  ok(classKey(dup[1], 1, dup) === "beginner-2", "second gets -2");
  ok(classKey(dup[2], 2, dup) === "beginner-3", "and case/whitespace variants collide rather than pretending to differ");

  const blank = [{}, { title: "   " }];
  ok(classKey(blank[0], 0, blank) === "class-1", "an untitled class still gets a key");
  ok(classKey(blank[1], 1, blank) === "class-2", "as does a whitespace-only title");
});

// ── 6. the payload builder actually emits it ────────────────────────────────
section("offerToTemplatePayloads carries the class onto the template", () => {

  const OFFER_ID = "52a6285c-7832-44e1-b531-ab7ef9d8fc21";
  const offer = {
    id: OFFER_ID,
    title: "Free Trial",
    data: {
      general_info: { capacity: 20 },
      schedule: { classes: [
        { title: "Beginner", consistent: "Yes", weekly_times: [{ days: ["Tue"], start: "17:00", end: "18:00" }] },
        { title: "Pre-Season Academy", consistent: "Yes", weekly_times: [
          { days: ["Wed"], start: "19:00", end: "20:00" },
          { days: ["Fri"], start: "19:00", end: "20:00" },
        ] },
      ] },
    },
  };
  const { templates } = offerToTemplatePayloads(offer, { clientId: "c-1", bookableProgramId: "p-1" });
  ok(templates.length === 3, `three templates (got ${templates.length})`);

  const keys = templates.map((t) => t.payload.source_offer_class_key);
  ok(keys[0] === "beginner", `first template carries source_offer_class_key "beginner" (got ${JSON.stringify(keys[0])})`);
  ok(keys[1] === "pre-season-academy" && keys[2] === "pre-season-academy",
    "both rows of one class carry the SAME key - a class is not its weekly time");
  ok(templates.every((t) => t.payload.source_offer_id === OFFER_ID),
    "every template carries source_offer_id");

  // The break this replaces: before today the only trace of the class was its
  // title inside the display name, which is why seven places pattern-matched it.
  ok(templates[0].payload.name === "Free Trial - Beginner (Tue)",
    `the display name is untouched (got ${JSON.stringify(templates[0].payload.name)})`);
  ok(templates[0].matchKey === "WEEKLY:TU|17:00|18:00",
    "and the dedupe matchKey is untouched, so no academy re-syncs into duplicate templates");

  // GTA's two classes get two distinct keys, which is the whole point.
  const gtaOffer = { id: OFFER_ID, title: "Training", data: { schedule: { classes: [
    { title: "Group 1 (Elementary)",  consistent: "Yes", weekly_times: [{ days: ["Mon"], start: "18:00", end: "19:00" }] },
    { title: "Group 2 (High School)", consistent: "Yes", weekly_times: [{ days: ["Mon"], start: "19:00", end: "20:00" }] },
  ] } } };
  const g = offerToTemplatePayloads(gtaOffer, { clientId: "c-1", bookableProgramId: "p-1" });
  ok(g.templates[0].payload.source_offer_class_key === "group-1-elementary"
    && g.templates[1].payload.source_offer_class_key === "group-2-high-school",
    "GTA's two classes get two distinct keys");

  // A non-uuid offer id must not 400 the whole re-sync at the endpoint.
  const bad = offerToTemplatePayloads({ id: "off-1", title: "T", data: { schedule: { classes: [
    { title: "A", consistent: "Yes", weekly_times: [{ days: ["Sat"], start: "10:00", end: "11:00" }] },
  ] } } }, { clientId: "c-1" });
  ok(bad.templates[0].payload.source_offer_id === undefined,
    "a non-uuid offer id is omitted rather than sent and rejected");
  ok(bad.templates[0].payload.source_offer_class_key === "a",
    "...and the class key still ships - the two are independent");
  ok(bad.warnings.some((w) => /not a uuid/i.test(w)), "...and it warns rather than going quiet");
});

section("classAgeRange normalizes what an owner typed", () => {

  ok(classAgeRange({ age_min: "8", age_max: "11" }).min === 8, "string numbers from a text input are coerced");
  ok(classAgeRange({ age_min: 8, age_max: "" }).max === null, "an empty age_max is NO LIMIT, not zero");
  ok(classAgeRange({ age_min: 8, age_max: "  " }).max === null, "whitespace-only age_max is NO LIMIT");
  ok(classAgeRange({}).configured === false, "nothing set -> configured:false");
  ok(classAgeRange({ age_max: 11 }).configured === true, "one end set -> configured:true");
  ok(classAgeRange({ age_min: 14, age_max: 9 }).invalid === true, "min above max -> invalid");

  // The owner picks "no upper limit" explicitly, so a blank box is never
  // silently read as "and up" - "Beginner, 8 to blank" would accept a 40 year old.
  const openTop = { age_min: 14, age_max_mode: "No upper limit" };
  ok(classAgeRange(openTop).max === null && classAgeRange(openTop).configured === true,
    `age_max_mode "No upper limit" -> open top, and the class counts as configured`);
  ok(classAgeRange({ age_min: 14, age_max_mode: "no upper limit" }).max === null,
    "the mode is matched case-insensitively");
  // Switching the toggle to "no upper limit" leaves the old number in the row.
  ok(classAgeRange({ age_min: 14, age_max_mode: "No upper limit", age_max: 18 }).max === null,
    "an explicit no-upper-limit beats a number stranded in the hidden box");
  ok(classFitsAge({ age_min: 14, age_max_mode: "No upper limit", age_max: 18 }, 40) === true,
    "...and a 40 year old really does fit it");
  const halfDone = classAgeRange({ age_min: 8, age_max_mode: "Set an oldest age" });
  ok(halfDone.incomplete === true && halfDone.max === null,
    `"there is an oldest age" with no number -> incomplete, and reported rather than assumed`);
  ok(resolveClassesForAge(9, [{ title: "Half done", age_min: 8, age_max_mode: "Set an oldest age" }]).problems.length === 1,
    "...and resolveClassesForAge surfaces it in problems");
});

// ── banner ──────────────────────────────────────────────────────────────────
if (MUTATE) {
  if (controlBroken) {
    console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fails.length > 0;
  console.log(caught
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)): ${fails.slice(0, 3).join(" | ")}`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
  process.exit(caught ? 0 : 1);
}

console.log(`\n${fails.length === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
