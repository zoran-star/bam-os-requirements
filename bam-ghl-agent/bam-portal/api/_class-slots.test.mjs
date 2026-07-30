// WHICH TIMES A PARENT IS OFFERED, AND WHICH SLOT GETS BOOKED.
//
//   node api/_class-slots.test.mjs                 # exits non-zero on any failure
//   MUTATE=<name> node api/_class-slots.test.mjs   # a negative control
//
// api/_class-routing.test.mjs already proves the RESOLVER: given an age and a
// list of classes, which classes fit. This file proves the WIRING: given real
// slots, real calendars and a real academy, which times a parent actually sees
// and which row actually gets written.
//
// ── Why the wiring needs its own suite ──────────────────────────────────────
// The defect this build closes lives entirely in the wiring. Every booking path
// resolved its slot with an exact `start_time=eq.<iso>` match, so the WRITE was
// already precise: with classes at different start times only one row comes back
// and it is the right one. A 9 year old ended up in the 6pm class because 6pm was
// on the list they were shown. Nothing filtered the OFFER by age.
//
// So the load-bearing assertions here are about `routeSlots`, not about
// `chooseSlotToBook`, and MUTATE=offer is the control that matters most: it
// fixes only the write, which is the shape of build that passes its own tests,
// looks finished, and leaves the misbooking exactly where it was.
//
// ── The fixtures are production, read 2026-07-30 ────────────────────────────
// Not invented. BAM GTA, BAM San Jose and DETAIL Miami below are their real
// offer rows, and the GTA and Miami slot shapes are their real schedule_slots.
// Nothing here needs a database: every input is passed in.
//
// ── Both outcomes are correct ───────────────────────────────────────────────
// ONE class fitting and MORE THAN ONE class fitting are both ordinary results.
// San Jose's Beginner Academy (6-12) and Elementary Academy (9-12) overlap
// almost entirely because they differ by SKILL, so `multiple` is that academy's
// answer for every athlete aged 9 to 12 - the normal path, not an edge case.
// The `multiple` assertions below are therefore as detailed as the `single` ones,
// and MUTATE=collapse and MUTATE=agequestion exist to keep them that way.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classIndex, classForCalendar, classByName, identifySlotClass, slotClassKey,
  ageRoutingReadiness, routeSlots, chooseSlotToBook, buildQuestion,
  distinguishingFields, agesOverlap, parentFacingClassName, classesOf, loadClassesFor,
  pickTrainingOffer,
} from "./agent/_class-slots.js";
import { classKey } from "./agent/_class-routing.js";
import { summarizeSlots } from "./agent/booking.js";
import { renderBookingGroup } from "./agent/fact-render.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(HERE, "agent", "_class-slots.js");
const MUTATE = process.env.MUTATE || "";

let pass = 0, fail = 0;
const failed = [];
function ok(cond, label) {
  if (cond) { pass += 1; console.log("  ✅ " + label); }
  else { fail += 1; failed.push(label); console.log("  ❌ " + label); }
}
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

// ── production fixtures ─────────────────────────────────────────────────────

// BAM GTA. Two classes, no overlap, both configured. Group 2 has NO upper limit,
// which is load-bearing: if a missing max ever meant "matches nobody", GTA's
// older group would go dark for every athlete.
const GTA = [
  { title: "Group 1", age: "Elementary School", skill_level: "All", age_min: "9",  age_max: "13", age_max_mode: "Set an oldest age" },
  { title: "Group 2", age: "High School",       skill_level: "All", age_min: "14", age_max: null, age_max_mode: "No upper limit" },
];

// BAM San Jose. Beginner and Elementary overlap on age almost completely and
// differ on SKILL. Their `age` text is even the same string, so the age band
// could never have told them apart either.
const SJ = [
  { title: "Beginner Academy",   age: "Elementary School",    skill_level: "Beginner", age_min: "6",  age_max: "12", age_max_mode: "Set an oldest age" },
  { title: "Elementary Academy", age: "Elementary School",    skill_level: "All",      age_min: "9",  age_max: "12", age_max_mode: "Set an oldest age" },
  { title: "Pre-Season Academy", age: "Middle / High School", skill_level: "All",      age_min: "12", age_max: "18", age_max_mode: "Set an oldest age" },
];

// DETAIL Miami. One class, and NO age numbers on it - the live academy the
// arming gate protects. 157 slots, every source_offer_class_key NULL.
const MIAMI = [{ title: "DETAIL Academy", age: "Grades 5-12", skill_level: null }];

const slot = (id, name, key, at) => ({ id, name, source_offer_class_key: key, start_time: at, capacity: 10 });

// GTA after the backfill: every slot carries its class key.
const GTA_SLOTS = [
  slot("g1-mon", "Group 1 (Elementary)",  "group-1", "2026-08-03T23:00:00Z"),
  slot("g2-mon", "Group 2 (High School)", "group-2", "2026-08-04T00:00:00Z"),
];
// GTA before the backfill: identical rows, class key NULL. The build must give
// the same answer for both, because a build that only works after a human
// remembers to run some SQL has a human in its critical path.
const GTA_SLOTS_NO_KEY = GTA_SLOTS.map((s) => ({ ...s, source_offer_class_key: null }));

// DETAIL Miami, exactly as production has it: the generated composite name, no key.
const MIAMI_SLOTS = [
  slot("m1", "Training - DETAIL Academy (Mon, Wed, Fri)", null, "2026-08-03T23:00:00Z"),
  slot("m2", "Training - DETAIL Academy (Mon, Wed, Fri)", null, "2026-08-05T23:00:00Z"),
];

// San Jose once its schedule is generated: keys present, names from the generator.
const SJ_SLOTS = [
  slot("sj-beg", "Free Trial - Beginner Academy (Tue)",     "beginner-academy",    "2026-08-04T00:00:00Z"),
  slot("sj-ele", "Free Trial - Elementary Academy (Tue)",   "elementary-academy",  "2026-08-04T01:00:00Z"),
  slot("sj-pre", "Free Trial - Pre-Season Academy (Wed, Fri)", "pre-season-academy", "2026-08-05T02:00:00Z"),
];

const GTA_CALS = [
  { key: "cal-1", label: "Booking Calendar: Group 1 (Elementary)" },
  { key: "cal-2", label: "Booking Calendar: Group 2 (High School)" },
];
const idsOf = (rows) => rows.map((s) => s.id);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. the keys match the ones production actually stores ──");
// If these drift, every slot in the database points at a class that no longer
// exists, so the fixtures are tied to reality here rather than assumed.
eq(GTA.map((c, i) => classKey(c, i, GTA)), ["group-1", "group-2"], "BAM GTA's class keys");
eq(SJ.map((c, i) => classKey(c, i, SJ)), ["beginner-academy", "elementary-academy", "pre-season-academy"], "BAM San Jose's class keys");
eq(classesOf({ schedule: { classes: GTA } }).length, 2, "classes are read from offer.data.schedule.classes");
eq(classesOf({ classes: GTA }).length, 2, "and from the older top-level shape");
eq(classesOf(null), [], "a missing offer is no classes, not a throw");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. the arming gate ──");
{
  ok(ageRoutingReadiness(GTA).armed, "BAM GTA is ARMED: every class has ages set");
  ok(ageRoutingReadiness(SJ).armed, "BAM San Jose is ARMED");
  const m = ageRoutingReadiness(MIAMI);
  ok(!m.armed, "DETAIL Miami is NOT armed: its one class has no age numbers");
  ok(/DETAIL Academy/.test(m.reason), "and the refusal names the class the owner has to fix");
  ok(!ageRoutingReadiness([]).armed, "an academy with no classes is not armed");
  // The specific failure the gate exists to prevent: an unconfigured class
  // matches EVERY age by design, so one blank class turns every athlete into a
  // `multiple` and makes the agent ask a question where it used to route.
  const halfSet = [GTA[0], { title: "New class" }];
  ok(!ageRoutingReadiness(halfSet).armed,
    "ONE unconfigured class disarms the whole academy (an unconfigured class matches everyone)");
  ok(!ageRoutingReadiness([{ title: "Backwards", age_min: 14, age_max: 9, age_max_mode: "Set an oldest age" }]).armed,
    "a range that fits nobody disarms it too, rather than silently matching nobody");
  ok(!ageRoutingReadiness([{ title: "Half typed", age_min: 9, age_max_mode: "Set an oldest age" }]).armed,
    "and so does an oldest age the owner said existed and never typed");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. BAM GTA: the times a parent is OFFERED, after the backfill ──");
{
  const nine = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "9" });
  eq(nine.decision, "single", "a 9 year old fits exactly one class");
  eq(nine.matches.map((m) => m.title), ["Group 1"], "and it is Group 1");
  eq(idsOf(nine.slots), ["g1-mon"], "so ONLY Group 1's time is offered - the 8pm class is never shown");
  eq(idsOf(nine.excluded), ["g2-mon"], "Group 2's time is excluded, and the caller can see that it was");
  eq(nine.unidentified, [], "nothing is unidentified once the keys are on the slots");

  const fourteen = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 14 });
  eq(idsOf(fourteen.slots), ["g2-mon"], "a 14 year old is offered only Group 2");
  const forty = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 40 });
  eq(idsOf(forty.slots), ["g2-mon"], "and so is a 40 year old: 'no upper limit' really means no upper limit");
  eq(routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 13 }).matches.map((m) => m.title), ["Group 1"], "13 is inside Group 1, both ends inclusive");

  const eight = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 8 });
  eq(eight.decision, "unqualified", "an 8 year old fits nothing and is UNQUALIFIED");
  eq(idsOf(eight.slots), [], "so they are offered no time at all rather than the nearest one");

  const unknown = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "dunno" });
  eq(unknown.decision, "unknown_age", "an unreadable age is UNKNOWN, which is not the same as unqualified");
  eq(idsOf(unknown.slots), ["g1-mon", "g2-mon"], "and nothing is hidden - an unreadable age must never turn a customer away");
  eq(routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "Grade 5" }).decision, "unknown_age", "a grade is not an age, in Ontario or California");
  eq(routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "u12s" }).decision, "unknown_age", "and neither is an age band");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. BAM GTA BEFORE the backfill: same answers, from the names ──");
{
  // The backfill has run. This proves the build never needed it to be correct,
  // which matters because every academy after GTA arrives with slots generated
  // from scratch and NULL is the state a fresh slot is in until the generator
  // stamps it.
  const nine = routeSlots({ slots: GTA_SLOTS_NO_KEY, classes: GTA, rawAge: 9 });
  eq(idsOf(nine.slots), ["g1-mon"], "a 9 year old is still offered only Group 1's time");
  eq(nine.unidentified, [], "because the slot NAME contains exactly one of the academy's own class titles");
  eq(identifySlotClass(GTA_SLOTS_NO_KEY[0], classIndex(GTA)).via, "name", "identified by name, not by key");
  eq(identifySlotClass(GTA_SLOTS[0], classIndex(GTA)).via, "key", "and by key once the key is there");
  eq(slotClassKey({ source_offer_class_key: "  " }), null, "a blank key is no key");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. a slot whose class nobody can name ──");
{
  // The rule: never hidden, never counted as a match, never silent.
  const mystery = [slot("x", "Weeknight session", null, "2026-08-03T23:00:00Z"), ...GTA_SLOTS];
  const nine = routeSlots({ slots: mystery, classes: GTA, rawAge: 9 });
  ok(nine.slots.some((s) => s.id === "x"), "an unidentifiable slot is still OFFERED - it must not vanish from a parent's options");
  eq(idsOf(nine.unidentified), ["x"], "and it is reported separately, so it is never silent");
  ok(!nine.matches.some((m) => m.key === null), "it is never counted as a positive age match");

  // Ambiguity is treated as not knowing, which is the conservative answer.
  const twoTitles = [{ title: "Beginner" }, { title: "Beginner Academy" }];
  eq(identifySlotClass({ name: "Free Trial - Beginner Academy (Tue)" }, classIndex(twoTitles)).key, null,
    "a name matching TWO class titles identifies neither, rather than picking one");
  eq(identifySlotClass({ source_offer_class_key: "deleted-class" }, classIndex(GTA)).known, false,
    "a key pointing at a class the offer no longer has is identified but not known");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. BAM San Jose: MORE THAN ONE fitting is the ordinary path ──");
{
  const nine = routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 9 });
  eq(nine.decision, "multiple", "a 9 year old in San Jose fits TWO classes - every time, for every athlete 9 to 12");
  eq(nine.matches.map((m) => m.title), ["Beginner Academy", "Elementary Academy"], "Beginner and Elementary");
  eq(idsOf(nine.slots), ["sj-beg", "sj-ele"], "both classes' times are offered; Pre-Season's is not");

  const q = nine.question;
  ok(!!q, "the multiple answer carries a QUESTION, and is not a thinner 'could not decide'");
  eq(q.dimension, "skill_level", "and the question is about SKILL, because that is what actually differs");
  ok(q.ages_overlap, "it says outright that age cannot separate these two, so the agent does not re-ask it");
  eq(q.options.map((o) => o.value), ["Beginner", "All"], "with the two answers the parent is choosing between");
  eq(q.options.map((o) => o.title), ["Beginner Academy", "Elementary Academy"], "named by their real class names");
  // The age TEXT on both classes is the same string, so a question built from it
  // would have offered the parent the same answer twice.
  ok(!distinguishingFields(["beginner-academy", "elementary-academy"], classIndex(SJ)).some((f) => f.field === "age"),
    "the free-text age band is NOT offered as a distinguisher - both classes say 'Elementary School'");

  const six = routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 6 });
  eq(six.decision, "single", "a 6 year old fits only Beginner");
  eq(six.question, null, "and is asked nothing");
  eq(routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 15 }).matches.map((m) => m.title), ["Pre-Season Academy"], "a 15 year old fits only Pre-Season");
  eq(routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 5 }).decision, "unqualified", "a 5 year old fits nothing");

  const twelve = routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 12 });
  eq(twelve.matches.length, 3, "a 12 year old fits ALL THREE - the age boundaries really do all include 12");
  eq(twelve.question.options.length, 3, "and the question offers all three, not the first two");
  ok(agesOverlap(twelve.matches.map((m) => m.key), classIndex(SJ)), "all three overlap on age at 12");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. DETAIL Miami: not armed, so nothing about it changes ──");
{
  const r = routeSlots({ slots: MIAMI_SLOTS, classes: MIAMI, rawAge: 9, calendarLabel: "Free Trial - MS / HS Academy" });
  ok(!r.armed, "Miami is not armed");
  eq(r.decision, "not_armed", "and the decision says so plainly rather than pretending to have routed");
  eq(idsOf(r.slots), ["m1", "m2"], "every time is offered, exactly as before this build");
  const grown = routeSlots({ slots: MIAMI_SLOTS, classes: MIAMI, rawAge: 40, calendarLabel: "Free Trial - MS / HS Academy" });
  eq(idsOf(grown.slots), ["m1", "m2"], "and an out-of-range age changes nothing, because no age range was ever set");
  // The old code read /group\s*\d+/ off this label and got null, so it filtered
  // by nothing. classForCalendar gets null too, for a better reason.
  eq(classForCalendar("Free Trial - MS / HS Academy", classIndex(MIAMI)), null,
    "Miami's calendar label names no class, so it narrows nothing - same result as the regex it replaced");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. the calendar, resolved from the academy's own class names ──");
{
  const idx = classIndex(GTA);
  eq(classForCalendar(GTA_CALS[0].label, idx), "group-1", "GTA's first calendar resolves to Group 1 - from GTA's own class title, not a hardcoded token");
  eq(classForCalendar(GTA_CALS[1].label, idx), "group-2", "and its second to Group 2");
  eq(classByName("Group 1", idx).key, "group-1", "the agent naming a class by its real name resolves it");
  eq(classByName("group-1", idx).key, "group-1", "and so does the key, for anything that stored one");
  eq(classByName("the younger group", idx), null, "a vague label resolves to nothing rather than to a guess");

  // A calendar narrows the offer even further than the age does.
  const r = routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "dunno", calendarLabel: GTA_CALS[0].label });
  eq(idsOf(r.slots), ["g1-mon"], "reading Group 1's calendar shows only Group 1's times, even with the age unknown");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 9. the write: what actually gets booked ──");
{
  const one = chooseSlotToBook({ rows: [GTA_SLOTS[0]], classes: GTA, rawAge: 9 });
  eq(one.slot.id, "g1-mon", "the ordinary case: one row at that instant, and it fits");
  eq(one.via, "age", "chosen by age");

  const named = chooseSlotToBook({ rows: GTA_SLOTS, classes: GTA, className: "Group 1" });
  eq(named.slot.id, "g1-mon", "a named class wins, which is how a staff override reaches the right row");

  const wrong = chooseSlotToBook({ rows: [GTA_SLOTS[1]], classes: GTA, rawAge: 9 });
  eq(wrong.slot, null, "a 9 year old cannot be written into the 14+ class even if that is the only row");
  ok(/9 year old/.test(wrong.reason), `and the refusal names the age, so a human can act on it ("${wrong.reason}")`);

  // Armed + genuinely ambiguous: refuse. At the write step there is nobody left
  // to ask, so guessing here is the failure the whole build removes.
  const twoAtOnce = [
    slot("a", "Free Trial - Beginner Academy (Tue)", "beginner-academy", "2026-08-04T00:00:00Z"),
    slot("b", "Free Trial - Elementary Academy (Tue)", "elementary-academy", "2026-08-04T00:00:00Z"),
  ];
  const amb = chooseSlotToBook({ rows: twoAtOnce, classes: SJ, rawAge: 9 });
  eq(amb.slot, null, "two classes at the same instant that BOTH fit: refuse rather than pick one");
  eq(amb.via, "ambiguous", "and say it was ambiguous, not that nothing was available");

  // Not armed: keep doing exactly what this did before age routing existed.
  const notArmed = chooseSlotToBook({ rows: MIAMI_SLOTS, classes: MIAMI, rawAge: 9 });
  eq(notArmed.slot.id, "m1", "an unarmed academy still books the first row, which is today's behaviour");
  eq(notArmed.via, "not-armed-first-row", "and the record says that is what happened");

  eq(chooseSlotToBook({ rows: [], classes: GTA, rawAge: 9 }).reason, "no portal slot at that time",
    "no rows at all keeps the message callers already surface to staff");
  const mystery = chooseSlotToBook({ rows: [slot("x", "Weeknight session", null, "t")], classes: GTA, rawAge: 9 });
  eq(mystery.slot.id, "x", "a lone unidentifiable row is still bookable - that is every academy's state before slots carried a class");
  eq(mystery.via, "unidentified", "and it is recorded as unidentified rather than as an age match");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 10. what a PARENT is told the class is called (decision 3) ──");
{
  eq(parentFacingClassName(MIAMI_SLOTS[0], MIAMI), "DETAIL Academy",
    "the parent gets the real class name, not 'Training - DETAIL Academy (Mon, Wed, Fri)'");
  eq(parentFacingClassName(GTA_SLOTS[0], GTA), "Group 1", "BAM GTA's is 'Group 1', which is what BAM GTA calls it");
  eq(parentFacingClassName(slot("x", "Weeknight session", null, "t"), GTA), "Weeknight session",
    "a slot whose class cannot be named falls back to its own name - a clumsy label beats nothing");
  eq(parentFacingClassName({ name: null }, GTA), null, "and nothing at all stays nothing");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 11. the loader survives a bad day ──");
{
  const rows = await loadClassesFor(async () => [{ data: { schedule: { classes: GTA } } }], "c1");
  eq(rows.length, 2, "the training offer's classes are read off the offers row");
  eq(await loadClassesFor(async () => { throw new Error("supabase 500"); }, "c1"), [],
    "a lookup that throws is NO CLASSES, which disarms the academy rather than arming it wrongly");
  eq(await loadClassesFor(null, "c1"), [], "and so is a missing fetch function");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 12. narrowing by NOTHING is not the same as narrowing to NOTHING ──");
{
  // The regression an independent tester found in the Hawkeye Book-it picker.
  // "No narrowing" was spelled as "the set of every key this academy has", which
  // is EMPTY when the classes failed to load or were never passed - so every
  // keyed slot was excluded and the picker offered nothing. Measured on GTA's
  // real slots as offered=0, excluded=2.
  for (const [label, classes] of [["never passed", undefined], ["failed to load", []]]) {
    const r = routeSlots({ slots: GTA_SLOTS, classes, rawAge: 9 });
    eq(idsOf(r.slots), ["g1-mon", "g2-mon"], `classes ${label}: every time is still offered, not none`);
    eq(r.excluded, [], `classes ${label}: nothing is excluded on the strength of a list we do not have`);
    ok(!r.armed, `classes ${label}: and the academy is correctly NOT armed`);
  }
  // Only a READ age that matched no class may empty the list.
  eq(routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 8 }).slots, [],
    "an age we DID read that fits nothing is the one case that offers nothing");
  // The calendar still narrows on its own, with or without an age.
  eq(idsOf(routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: "?", calendarLabel: GTA_CALS[1].label }).slots),
    ["g2-mon"], "a calendar narrows to its class even when nothing else does");
}

console.log("\n── 13. summarizeSlots takes either shape, and nonsense from neither ──");
{
  const days = { "2026-08-03": ["2026-08-03T19:00:00-04:00"], "2026-08-04": ["2026-08-04T19:00:00-04:00"] };
  eq(summarizeSlots(days, 24).length, 2, "the bare day map, as three callers pass it");
  eq(summarizeSlots({ timezone: "America/Toronto", days, routing: null }, 24).length, 2,
    "and freeSlots' whole envelope, as the Book-it picker passed it - it used to throw into a bare catch");
  eq(summarizeSlots({ timezone: "America/Toronto", days, routing: null }, 24), summarizeSlots(days, 24),
    "both shapes give the SAME answer, which is what makes accepting both safe");
  eq(summarizeSlots({ "2026-08-03": "not-a-list" }, 24), [],
    "a day whose value is not a list yields nothing - a string must never be iterated into characters");
  eq(summarizeSlots(null), [], "and nothing at all is an empty list, not a throw");
}

console.log("\n── 14. a class name that matches two classes matches neither ──");
{
  // classKey() gives colliding titles distinct keys by POSITION, so the two are
  // real and separate rows - but their TITLE cannot tell them apart, and .find
  // silently returned the first.
  const twins = [
    { title: "Skills", age_min: 8, age_max: 11, age_max_mode: "Set an oldest age" },
    { title: "Skills", age_min: 12, age_max: 15, age_max_mode: "Set an oldest age" },
  ];
  const idx = classIndex(twins);
  eq(idx.map((c) => c.key), ["skills", "skills-2"], "the two rows do get distinct keys");
  eq(classByName("Skills", idx), null, "but the shared TITLE resolves to neither, rather than to whichever came first");
  eq(classByName("skills-2", idx).key, "skills-2", "the KEY still resolves, because keys are unambiguous by construction");
  eq(classByName("Group 1", classIndex(GTA)).key, "group-1", "and a title only one class has is unaffected");
}

console.log("\n── 15. which training offer the classes come from ──");
{
  // DETAIL Miami, as production has it: nine training offers, exactly one with
  // classes, and it wins today only because it happens to sit at sort_order -1.
  // The populated offer is given the LAST id on purpose. With it first, "chosen
  // for having classes" and "chosen for sorting first" produce the same answer
  // and the assertion cannot tell them apart.
  const miami = [
    { id: "z9", sort_order: -1, data: { schedule: { classes: MIAMI } } },
    ...["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].map((id) => ({ id, sort_order: 0, data: {} })),
  ];
  eq(pickTrainingOffer(miami).id, "z9", "Miami's one populated offer is chosen");
  const flattened = miami.map((o) => ({ ...o, sort_order: 0 }));
  eq(pickTrainingOffer(flattened).id, "z9",
    "and it is STILL chosen when sort_order is normalised to 0, though it now sorts LAST - it wins for having classes, not for sorting first");
  eq(pickTrainingOffer([...flattened].reverse()).id, "z9", "regardless of the order the database returns them in");

  // GAME Winner: four offers, ALL populated. Nothing in the data can say which,
  // so the requirement is only that the answer never moves.
  const gw = [
    { id: "w4", sort_order: 0, data: { schedule: { classes: [{ title: "D" }] } } },
    { id: "w1", sort_order: 0, data: { schedule: { classes: [{ title: "A" }] } } },
    { id: "w3", sort_order: 0, data: { schedule: { classes: [{ title: "C" }] } } },
  ];
  eq(pickTrainingOffer(gw).id, "w1", "an all-populated tie breaks on id, deterministically");
  eq(pickTrainingOffer([...gw].reverse()).id, "w1", "and gives the same answer whatever order they arrive in");
  eq(pickTrainingOffer([]), null, "no training offers is no offer");
  eq(pickTrainingOffer([{ id: "x", sort_order: 0, data: {} }]).id, "x",
    "one offer with no classes is still returned - the caller then correctly reads zero classes");

  const loaded = await loadClassesFor(async () => flattened, "c1");
  eq(loaded.length, 1, "loadClassesFor lands on the populated offer end to end");
}

console.log("\n── 16. the fact and the routing read the classes the SAME way ──");
{
  // Two readers of one fact disagreeing is the divergence this build exists to
  // remove, so the legacy top-level shape is asserted through BOTH of them.
  const legacy = { classes: GTA };
  eq(classesOf(legacy).length, 2, "the resolver reads the older top-level data.classes shape");
  ok(ageRoutingReadiness(classesOf(legacy)).armed, "and arms that academy");
  const rendered = renderBookingGroup(legacy);
  ok(!!rendered && rendered.includes("Group 1: ages 9 to 13"),
    "and the agent's own booking fact renders the same classes, rather than saying none are set up");
  const modern = renderBookingGroup({ schedule: { classes: GTA } });
  eq(rendered, modern, "both offer shapes render byte-identically, which is what one reader buys");
}

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
// A control writes a MUTATED COPY of the real module beside it, imports that,
// and asserts the mutation is CAUGHT. Every one below was run against the real
// module first and watched to fail before its comment was written. Each models a
// state that can genuinely arise: four of the six are the shortcuts a future
// session would reach for, and two are the shape this build's own predecessor
// had.
//
// Most mutate api/agent/_class-slots.js. Three do not, and say so with `src`,
// because the bug they model does not live there: two readers of one fact can
// only diverge if they are two different files.
const CONTROLS = {
  // MUTATE=offer. THE ONE THAT MATTERS MOST. Fix only the write path and leave
  // the offer unfiltered. Every write-side test still passes, the build looks
  // finished, and a 9 year old is still shown the 8pm class, picks it, and is
  // booked into it correctly and precisely.
  //
  // RE-ANCHORED after the eligible-is-null fix, which deleted the line this used
  // to edit. It went STALE rather than passing, which is the mechanism working:
  // the most consequential control in this file was silently disarmed by an
  // unrelated bug fix, and the harness said so instead of printing a banner.
  // Anchor it on the assignment that means "no narrowing" so any future change to
  // that idea trips this again.
  offer: (s) => s.replace(
    "  let eligible = null;",
    "  let eligible = null;\n  const _unfiltered = true;",
  ).replace(
    "    if (eligible === null || eligible.has(id.key)) offered.push(s);",
    "    if (_unfiltered || eligible === null || eligible.has(id.key)) offered.push(s);",
  ),
  // MUTATE=gate. The arming gate deleted: every academy routes by age whether or
  // not its owner has set any. DETAIL Miami's one class is unconfigured, so it
  // matches everyone and nothing looks wrong - until an academy with two classes
  // has one blank and every athlete starts getting asked a question.
  gate: (s) => s.replace(
    "  if (unconfigured.length) {",
    "  if (false && unconfigured.length) {",
  ),
  // MUTATE=hide. A slot with no class key treated as matching nobody. The
  // tidy-looking reading of NULL, and it takes an academy's whole schedule dark
  // the moment a generator forgets to stamp the column.
  hide: (s) => s.replace(
    "    if (!id.key) { unidentified.push(s); offered.push(s); continue; }",
    "    if (!id.key) { unidentified.push(s); excluded.push(s); continue; }",
  ),
  // MUTATE=passthru. The opposite reading of NULL: it matches everybody, so it
  // counts as a real age match and the write path books it without a word.
  passthru: (s) => s.replace(
    "  const eligible = route.slots.filter((s) => !route.unidentified.includes(s));",
    "  const eligible = route.slots;",
  ),
  // `multiple` quietly collapsed to the first match. This is the shortcut that
  // reads as a tidy-up ("just book the best fit") and silently puts every San
  // Jose beginner into the Elementary class without anyone being asked anything.
  collapse: (s) => s.replace(
    "    eligible = new Set(resolved.matches.map((m) => m.key));",
    "    eligible = new Set(resolved.matches.slice(0, 1).map((m) => m.key));",
  ),
  // The one question hardcoded to be about age. It is the intuitive assumption -
  // "more than one class fits, so ask about their age" - and it is wrong for the
  // academy this build was written for. San Jose's two classes overlap on age and
  // differ on SKILL, so an age question asks the parent something they have
  // already answered and cannot separate anything. This is the one control here
  // that models a mistake in a CALLER rather than a shortcut in this module,
  // which is why it mutates the answer buildQuestion gives rather than the field
  // list it reads.
  agequestion: (s) => s.replace(
    "    dimension: top ? top.field : null,",
    "    dimension: \"age\",",
  ),
  // MUTATE=nonarrow. The Book-it picker regression, at its root: "narrow by
  // nothing" spelled as the set of all known keys, which is empty when the
  // classes did not load, so every keyed slot was excluded.
  nonarrow: (s) => s.replace(
    "  let eligible = null;",
    "  let eligible = new Set(idx.map((c) => c.key));",
  ),
  // MUTATE=namedupe. classByName back to .find, so two classes sharing a title
  // resolve to whichever the array happens to hold first.
  namedupe: (s) => s.replace(
    "  const exact = index.filter((c) => norm(c.title) === n);\n  if (exact.length === 1) return exact[0];\n  if (exact.length > 1) return null;",
    "  const exact = index.find((c) => norm(c.title) === n);\n  if (exact) return exact;",
  ),
  // MUTATE=offerpick. The offer choice back to "first in order", dropping the
  // prefer-classes rule. Miami then answers with one of its eight empty offers
  // the moment anybody normalises sort_order, and the academy silently has no
  // classes.
  offerpick: (s) => s.replace(
    "  return ordered.find((o) => classesOf(o.data).length > 0) || ordered[0];",
    "  return ordered[0];",
  ),
  // MUTATE=envelope. summarizeSlots back to accepting only the bare day map. The
  // envelope then throws "slots is not iterable" into a bare catch, which is
  // exactly how the picker stayed empty without anyone noticing.
  envelope: {
    src: "booking",
    // BOTH halves revert, and the first attempt at this control reverted only
    // the first. The `Array.isArray` guard on its own turned the envelope into an
    // empty list instead of a throw, so the control reported nothing wrong while
    // the picker would still have been silently empty. A control has to restore
    // the whole original shape or it measures the half it happened to pick.
    edit: (s) => s.replace(
      `  const src = (slotsByDay && typeof slotsByDay === "object" && slotsByDay.days && typeof slotsByDay.days === "object")\n    ? slotsByDay.days : slotsByDay;`,
      "  const src = slotsByDay;",
    ).replace(
      "  for (const [, slots] of Object.entries(src || {})) { if (!Array.isArray(slots)) continue; for (const iso of slots) flat.push(iso); }",
      "  for (const [, slots] of Object.entries(src || {})) for (const iso of slots) flat.push(iso);",
    ),
  },
  // MUTATE=tworeaders. renderBookingGroup back to reading data.schedule.classes
  // itself. The routing and the agent's own fact then disagree about the same
  // academy.
  tworeaders: {
    src: "fact-render",
    edit: (s) => s.replace(
      "  const classes = classesOf(data);",
      "  const classes = arr(data && data.schedule && data.schedule.classes);",
    ),
  },
};

// Each control's proof: run these against the mutant and at least one must throw.
function checkCaught(M) {
  const checks = {
    offer: () => {
      const r = M.routeSlots({ slots: GTA_SLOTS, classes: GTA, rawAge: 9 });
      if (r.slots.length !== 1) throw new Error(`a 9 year old is offered ${r.slots.length} times, including the 14+ class`);
    },
    gate: () => {
      const r = M.routeSlots({ slots: MIAMI_SLOTS, classes: MIAMI, rawAge: 40 });
      if (r.armed) throw new Error("DETAIL Miami, whose class has no ages, is being routed by age");
    },
    hide: () => {
      const r = M.routeSlots({ slots: [slot("x", "Weeknight session", null, "t")], classes: GTA, rawAge: 9 });
      if (r.slots.length !== 1) throw new Error("a slot with no class key vanished from the parent's options");
    },
    passthru: () => {
      const c = M.chooseSlotToBook({ rows: [slot("x", "Weeknight session", null, "t")], classes: GTA, rawAge: 9 });
      if (c.via !== "unidentified") throw new Error(`a slot with no class key was booked as a confirmed age match (via=${c.via}), so nothing records that its class was never known`);
    },
    collapse: () => {
      const r = M.routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 9 });
      if (r.decision !== "multiple" || r.slots.length !== 2) {
        throw new Error(`a 9 year old in San Jose got ${r.slots.length} option(s) and decision=${r.decision} - one class was chosen for them`);
      }
    },
    nonarrow: () => {
      const r = M.routeSlots({ slots: GTA_SLOTS, classes: [], rawAge: 9 });
      if (r.slots.length !== 2) {
        throw new Error(`with the classes unavailable the parent is offered ${r.slots.length} of 2 times - an empty list of classes excluded every slot instead of narrowing by nothing`);
      }
    },
    namedupe: () => {
      const twins = [{ title: "Skills" }, { title: "Skills" }];
      const hit = M.classByName("Skills", M.classIndex(twins));
      if (hit !== null) throw new Error(`a title two classes share resolved to "${hit.key}" instead of to nothing`);
    },
    offerpick: () => {
      // The populated offer sorts LAST by id, which is the whole point: a fixture
      // where it also sorts first cannot tell "chosen for having classes" apart
      // from "chosen for sorting first", and the first version of this control
      // could not.
      const flattened = [
        { id: "z9", sort_order: 0, data: { schedule: { classes: MIAMI } } },
        ...["a1", "a2"].map((id) => ({ id, sort_order: 0, data: {} })),
      ];
      const picked = M.pickTrainingOffer(flattened);
      if (M.classesOf(picked.data).length === 0) {
        throw new Error(`an offer with NO classes was chosen (${picked.id}) while a populated one was available, so the academy reads as having none`);
      }
    },
    envelope: () => {
      const days = { "2026-08-03": ["x"] };
      let threw = null;
      try { M.summarizeSlots({ timezone: "America/Toronto", days, routing: null }, 24); }
      catch (e) { threw = e.message; }
      if (threw) throw new Error(`freeSlots' own return value throws "${threw}" - straight into a bare catch, which is how the picker stayed empty`);
    },
    tworeaders: () => {
      const legacy = { classes: GTA };
      if (M.renderBookingGroup(legacy) === null) {
        throw new Error("the agent is told no classes are set up for an academy the resolver arms and routes - two readers of one fact, disagreeing");
      }
    },
    agequestion: () => {
      const r = M.routeSlots({ slots: SJ_SLOTS, classes: SJ, rawAge: 9 });
      if (r.question.dimension !== "skill_level") {
        throw new Error(`the one question is about "${r.question.dimension}", which cannot separate two classes that overlap on age`);
      }
    },
  };
  checks[MUTATE]();
}

// Every control must be DISCOVERABLE, not merely present. portal-ci.yml finds a
// suite's controls by grepping the suite for the literal `MUTATE=<name>`
// (`grep -ohE 'MUTATE=[A-Za-z][A-Za-z0-9_-]*'`), so a control whose name appears
// only as a JS object key is real, passes when run by hand, and is NEVER RUN BY
// CI. Three of the six here were in exactly that state when this suite was first
// written: gate, hide and passthru - the arming gate and both readings of a NULL
// class key, which are the three most consequential of the six.
//
// That is this project's named failure shape pointed at itself: a control whose
// whole purpose is confidence, trusted because it exists, never wired to the
// thing that runs it. The workflow already carries a comment about being bitten
// by this on 2026-07-29 and it happened again here, which is why the fix is this
// assertion rather than three more comment lines someone must remember to write.
{
  const selfSrc = fs.readFileSync(new URL(import.meta.url), "utf8");
  const undiscoverable = Object.keys(CONTROLS)
    .filter((name) => !new RegExp(`MUTATE=${name}(?![A-Za-z0-9_-])`).test(selfSrc));
  ok(
    undiscoverable.length === 0,
    `every negative control names itself as MUTATE=<name>, so CI can find it${
      undiscoverable.length ? ` (CI would silently skip: ${undiscoverable.join(", ")})` : ""
    }`,
  );
}

// Every mutant is written into api/agent/ whatever it is a copy of, so its own
// relative imports still resolve, and is removed through handlers registered
// before the write.
const SOURCES = {
  "class-slots": "_class-slots.js",
  "booking": "booking.js",
  "fact-render": "fact-render.js",
};

if (MUTATE) {
  const control = CONTROLS[MUTATE];
  if (!control) { console.error(`unknown MUTATE=${MUTATE}. Known: ${Object.keys(CONTROLS).join(", ")}`); process.exit(1); }
  const edit = typeof control === "function" ? control : control.edit;
  const srcKey = typeof control === "function" ? "class-slots" : control.src;
  const srcFile = path.join(HERE, "agent", SOURCES[srcKey]);
  const src = fs.readFileSync(srcFile, "utf8");
  const mutated = edit(src);
  if (mutated === src) {
    console.log(`  ⚠️  MUTATE=${MUTATE}: the anchor it edits is gone from ${SOURCES[srcKey]} - the control is stale.`);
    process.exit(1);
  }
  const tmpName = `__mutant_${MUTATE}__.js`;
  const tmp = path.join(HERE, "agent", tmpName);
  const clean = () => { try { fs.unlinkSync(tmp); } catch (_) {} };
  process.on("exit", clean);
  process.on("SIGINT", () => { clean(); process.exit(130); });
  process.on("uncaughtException", (e) => { clean(); console.error(e); process.exit(1); });
  fs.writeFileSync(tmp, mutated);
  const M = await import(`./agent/${tmpName}`);
  let caught = null;
  try { checkCaught(M); } catch (e) { caught = e.message; }
  clean();
  if (!caught) {
    console.log(`\n❌ MUTATE=${MUTATE} was NOT caught. The check it is supposed to trip did not trip, so that check proves nothing.`);
    process.exit(1);
  }
  console.log(`\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught - ${caught}`);
  process.exit(0);
}

// Every module this build rewired must actually LOAD.
//
// ⚠️ READ THIS BEFORE TRUSTING IT. I added this block believing it would have
// caught the bug that prompted it: build B shipped `loadClassesFor is not
// defined` into api/website/miami-book.js, which would have thrown on every
// DETAIL Miami booking. Then I broke it to check, which is the house rule, and
// IT DID NOT CATCH IT. The suite stayed green with the import deleted.
//
// The reason, verified rather than reasoned: an undefined identifier inside a
// handler is a RUNTIME ReferenceError, not an import-time one. The module
// imports perfectly happily and only throws when the line executes. So:
//
//   THIS CHECK DOES catch  - an unresolvable import path, a renamed or deleted
//                            module, and anything that throws at module top
//                            level. Verified by breaking each.
//   THIS CHECK DOES NOT    - undefined identifiers. That is `npm run
//        catch               lint:api-no-undef`, which DID catch the real bug,
//                            in CI, having been built for exactly this after it
//                            took the enrollment funnel down for TEN academies
//                            on 2026-07-25.
//
// The block stays because the class it does cover is real and nothing else here
// covers it. But it is NOT the guard against the miami-book bug, and writing it
// up as one would have been this project's own named failure mode - something
// whose whole purpose is confidence, trusted because it exists, never wired to
// the outcome it claims. I nearly shipped exactly that, in the commit fixing an
// instance of it. Do not quote this block as protection against a ReferenceError.
console.log("\n── every rewired endpoint still loads ──");
for (const mod of [
  "./agent/_class-slots.js",
  "./agent/_class-routing.js",
  "./agent/booking.js",
  "./agent-approvals.js",
  "./agent/fact-render.js",
  "./ghl/calendars-v15.js",
  "./website/availability.js",
  "./website/leads.js",
  "./website/miami-book.js",
]) {
  let err = null;
  try { await import(mod); } catch (e) { err = e && e.message ? e.message : String(e); }
  ok(err === null, `${mod} imports${err ? ` (${err.split("\n")[0]})` : ""}`);
}

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failed) console.log("   - " + f); process.exit(1); }
