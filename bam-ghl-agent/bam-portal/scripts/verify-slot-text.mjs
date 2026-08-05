// Does slotTextConflict catch a message that disagrees with its own slot?
//
// Case 0 is the one that started it: a real BAM GTA card (Julie Boulton,
// 2026-08-04) that offered "Monday the 18th at 7:00 PM" while carrying a slot
// that is Tuesday the 18th in Toronto. It shipped as a VERIFIED proposal because
// the only check we had confirmed the timestamp was an open slot and never read
// the sentence.
//
// The rest of the suite is mostly about the OTHER failure: false positives block
// a send, so a rule that fires on "your 1st session" or on a legitimate two-day
// offer is worse than no rule. Most cases below assert "no conflict".
//
//   node scripts/verify-slot-text.mjs

import { slotTextConflict, slotLocalParts } from "../api/agent/_slot-text.js";

const TZ = "America/New_York";
const TUE_AUG_18 = "2026-08-18T23:00:00Z";   // Tue Aug 18, 7:00 PM in Toronto
const MON_AUG_17 = "2026-08-17T23:00:00Z";   // Mon Aug 17, 7:00 PM
const SAT_AUG_22 = "2026-08-22T15:30:00Z";   // Sat Aug 22, 11:30 AM

const CASES = [
  ["THE REAL ONE: says Monday, books Tuesday", true,
    "No worries at all, hope Ashton feels better soon! The first open spot the week of Aug 18 is Monday the 18th at 7:00 PM at Linbrook (1079 Linbrook Rd, Oakville). Want me to book that in?", TUE_AUG_18],

  ["same text against the slot it actually describes", false,
    "The first open spot is Monday the 17th at 7:00 PM at Linbrook. Want me to book that in?", MON_AUG_17],

  ["weekday agrees, no date named", false,
    "I've got Tuesday at 7pm open for Ashton, want me to lock it in?", TUE_AUG_18],

  ["abbreviated weekday agrees", false, "Tues at 7 works if you do!", TUE_AUG_18],
  ["abbreviated weekday disagrees", true, "Thurs at 7 works if you do!", TUE_AUG_18],

  ["offers a CHOICE including the stamped day", false,
    "I could do Monday or Tuesday that week, which suits you?", TUE_AUG_18],
  ["offers a choice that excludes the stamped day", true,
    "I could do Monday or Wednesday that week, which suits you?", TUE_AUG_18],

  ["date named via month agrees", false, "How does Aug 18 at 7pm sound?", TUE_AUG_18],
  ["date named via month disagrees", true, "How does Aug 19 at 7pm sound?", TUE_AUG_18],

  ["bare ordinal that is NOT a date is ignored", false,
    "Ashton's 1st session is free, no strings at all. Want me to book you in?", TUE_AUG_18],
  ["street number is not a date", false,
    "We're at 1079 Linbrook Rd - want me to grab you that spot?", TUE_AUG_18],
  ["a clock time is never read as a date", false,
    "We run 7:00 PM to 8:00 PM, want me to book it?", TUE_AUG_18],

  ["no time reference at all", false,
    "Totally understand, hope Ashton feels better. Want me to find you a new spot?", TUE_AUG_18],

  ["weekend slot, weekday agrees", false, "Saturday morning at 11:30 work?", SAT_AUG_22],
  ["weekend slot, weekday wrong", true, "Sunday morning at 11:30 work?", SAT_AUG_22],

  ["plural weekday agrees (recurring phrasing)", false,
    "We run Tuesdays at 7 - want me to put Ashton in?", TUE_AUG_18],

  ["empty message stands down", false, "", TUE_AUG_18],
  ["no slot stamped stands down", false, "Monday the 18th at 7pm?", null],
  ["unparseable slot stands down", false, "Monday the 18th at 7pm?", "not-a-date"],
];

let failed = 0;
console.log("\n━━━ slotTextConflict ━━━\n");
for (const [name, shouldConflict, text, iso] of CASES) {
  const got = slotTextConflict(text, iso, TZ);
  const ok = shouldConflict ? !!got : !got;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  if (!ok) console.log(`       expected ${shouldConflict ? "a conflict" : "no conflict"}, got: ${got || "null"}`);
  else if (got) console.log(`       → ${got}`);
}

console.log("\n━━━ slotLocalParts renders in the ACADEMY's timezone ━━━\n");
const toronto = slotLocalParts(TUE_AUG_18, "America/New_York");
const vancouver = slotLocalParts(TUE_AUG_18, "America/Los_Angeles");
const checks = [
  ["Toronto reads Tuesday the 18th", toronto && toronto.weekday === "tuesday" && toronto.day === 18],
  ["same instant in LA reads Tuesday the 18th at 4pm", vancouver && vancouver.label.includes("4:00")],
  ["a bad timezone does not throw", slotLocalParts(TUE_AUG_18, "Not/AZone") === null || !!slotLocalParts(TUE_AUG_18, "Not/AZone")],
];
for (const [name, ok] of checks) { if (!ok) failed++; console.log(`  ${ok ? "✅" : "❌"} ${name}`); }

console.log(failed ? `\n❌ ${failed} failing\n` : "\n✅ All checks passed.\n");
process.exit(failed ? 1 : 0);
