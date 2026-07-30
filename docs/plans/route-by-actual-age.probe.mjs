// REPLICATION HARNESS, not the module under test.
//
// api/agent/booking.js cannot be imported and exercised without Supabase, so the
// three decision lines are copied here VERBATIM from main @ de39e25 and run
// against real-shaped data. Any divergence between these lines and the source is
// a defect in this harness, so they are quoted with their line numbers.
//
//   booking.js:101-106  groupOf()
//   booking.js:142-143  the LIST path filter
//   booking.js:222-223  the WRITE path filter + fallback

// ---- verbatim from booking.js:101-106 ----
function groupOf(label) {
  const s = String(label || "").toLowerCase();
  if (/group\s*1|elementary|younger/.test(s)) return "Group 1";
  if (/group\s*2|high\s*school|older/.test(s)) return "Group 2";
  return null;
}

// ---- verbatim from booking.js:142-143 ----
function listPath(slots, groupLabel) {
  const g = String(groupOf(groupLabel) || groupLabel || "").toLowerCase();
  const list = slots.filter(s => !g || (s.name || "").toLowerCase().includes(g));
  return { g, list };
}

// ---- verbatim from booking.js:222-223 ----
function writePath(rows, group, calLabel) {
  const g = String(group || groupOf(calLabel) || "").toLowerCase().trim();
  const slot = rows.find(s => !g || (s.name || "").toLowerCase().includes(g)) || rows[0];
  return { g, slot };
}

// Slot names are built by offerToTemplatePayloads (api/_offer-schedule.js:144-147):
//   `${offer.title} - ${class.title} (${dayLabel(tokens)})`
const GTA_SLOTS = [
  { id: "g1", name: "Training - Group 1 (Mon, Tue, Wed, Thu)" },
  { id: "g2", name: "Training - Group 2 (Mon, Tue, Wed, Thu)" },
];
// San Jose's real classes, per TEMPLATING II's handover:
// Beginner Tue 5-6pm, Elementary Tue 6-7pm (same venue, back to back),
// Pre-Season Academy Wed + Fri 7-8pm.
const SJ_SLOTS = [
  { id: "s1", name: "Free Trial - Beginner (Tue)" },
  { id: "s2", name: "Free Trial - Elementary (Tue)" },
  { id: "s3", name: "Free Trial - Pre-Season Academy (Wed, Fri)" },
];

let failures = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${desc}`);
  if (!ok) console.log(`         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
}

console.log("\n=== 1. groupOf() on each academy's calendar labels ===");
const GTA_LABEL_1 = "Booking Calendar: Group 1 (Elementary)";
const GTA_LABEL_2 = "Booking Calendar: Group 2 (High School)";
const SJ_LABEL_BEG = "Booking Calendar: Beginner";
const SJ_LABEL_PRE = "Booking Calendar: Pre-Season Academy";
console.log(`  GTA "${GTA_LABEL_1}" -> ${JSON.stringify(groupOf(GTA_LABEL_1))}`);
console.log(`  GTA "${GTA_LABEL_2}" -> ${JSON.stringify(groupOf(GTA_LABEL_2))}`);
console.log(`  SJ  "${SJ_LABEL_BEG}" -> ${JSON.stringify(groupOf(SJ_LABEL_BEG))}`);
console.log(`  SJ  "${SJ_LABEL_PRE}" -> ${JSON.stringify(groupOf(SJ_LABEL_PRE))}`);
check("GTA group 1 label resolves", groupOf(GTA_LABEL_1), "Group 1");
check("GTA group 2 label resolves", groupOf(GTA_LABEL_2), "Group 2");
check("SJ Beginner label resolves to NOTHING", groupOf(SJ_LABEL_BEG), null);
check("SJ Pre-Season label resolves to NOTHING", groupOf(SJ_LABEL_PRE), null);

console.log("\n=== 2. LIST path: how many times does the agent OFFER? ===");
const gtaList = listPath(GTA_SLOTS, GTA_LABEL_1);
console.log(`  GTA  filter string = ${JSON.stringify(gtaList.g)}`);
console.log(`  GTA  slots offered = ${gtaList.list.length} -> ${gtaList.list.map(s => s.name).join(" | ") || "(none)"}`);
const sjList = listPath(SJ_SLOTS, SJ_LABEL_BEG);
console.log(`  SJ   filter string = ${JSON.stringify(sjList.g)}`);
console.log(`  SJ   slots offered = ${sjList.list.length} -> ${sjList.list.map(s => s.name).join(" | ") || "(none)"}`);
check("GTA is offered its 1 matching class", gtaList.list.map(s => s.id), ["g1"]);
check("SJ is offered ZERO classes (fails CLOSED)", sjList.list.map(s => s.id), []);

console.log("\n=== 3. WRITE path: the SAME miss, opposite direction ===");
// The agent is told by prompt-structure.js:358 to pass "Group 1" or "Group 2".
const sjWrite = writePath(SJ_SLOTS, "Group 1", SJ_LABEL_BEG);
console.log(`  SJ   filter string = ${JSON.stringify(sjWrite.g)}`);
console.log(`  SJ   slot booked   = ${sjWrite.slot ? sjWrite.slot.name : "(none)"}`);
check("SJ books the arbitrary first row (fails OPEN)", sjWrite.slot.id, "s1");

console.log("\n=== 4. The claim I would NOT assert: does rows[0] misbook San Jose? ===");
// All three paths query `start_time=eq.<iso>`, an EXACT match. Beginner is 5pm
// and Elementary is 6pm, so a single start time returns a single row.
const at6pm = SJ_SLOTS.filter(s => s.id === "s2");   // only Elementary starts at 6pm
const sixWrite = writePath(at6pm, "Group 1", SJ_LABEL_BEG);
console.log(`  rows at 18:00 = ${at6pm.length}; booked = ${sixWrite.slot.name}`);
check("with 1 row at that time, rows[0] IS the right class", sixWrite.slot.id, "s2");
console.log("  => rows[0] needs two classes at the SAME start time. SJ has none.");
console.log("  => the misbooking is that 6pm was OFFERED to a 9-year-old at all.");

console.log("\n=== 5. FOUND BY A BROKEN NEGATIVE CONTROL, and it is the root cause ===");
// My first control taught groupOf() San Jose's vocabulary and expected section 2
// to flip. It did not, and the reason is the actual defect:
//
//   groupOf() returns a GROUP KEY ("Group 1").
//   The filter tests that key against the SLOT NAME.
//
// Those are two different namespaces. GTA works ONLY because its slot names
// literally contain the string "Group 1". Teaching the regex more vocabulary
// cannot fix any academy, because the key it produces still has to appear
// verbatim in the class name.
const taughtGroupOf = (label) =>
  /group\s*1|elementary|younger|beginner/.test(String(label).toLowerCase()) ? "Group 1" : null;
const taught = listPath(SJ_SLOTS, SJ_LABEL_BEG);
const taughtG = String(taughtGroupOf(SJ_LABEL_BEG) || SJ_LABEL_BEG).toLowerCase();
const taughtOffered = SJ_SLOTS.filter(s => s.name.toLowerCase().includes(taughtG));
console.log(`  teaching groupOf "beginner" yields key ${JSON.stringify(taughtGroupOf(SJ_LABEL_BEG))}`);
console.log(`  SJ slots containing that key = ${taughtOffered.length}`);
check("a smarter regex STILL offers San Jose zero classes", taughtOffered.length, 0);
console.log("  => the fix cannot be a better label parser. The slot must carry the class.");
void taught;

console.log("\n=== NEGATIVE CONTROL ===");
// The control must model a change that is actually reachable: routing on the
// CLASS the slot came from, which is what source_offer_class_key exists for.
// If that is wired, San Jose starts being offered its own classes.
const SJ_SLOTS_WITH_CLASS = SJ_SLOTS.map((s, i) => ({
  ...s, source_offer_class_key: ["beginner", "elementary", "pre-season"][i],
}));
const routed = SJ_SLOTS_WITH_CLASS.filter(s => s.source_offer_class_key === "beginner");
if (routed.length === 0) {
  console.log("  NEGATIVE CONTROL BROKEN: the mutation changed nothing.");
  failures++;
} else if (listPath(SJ_SLOTS, SJ_LABEL_BEG).list.length !== 0) {
  console.log("  NEGATIVE CONTROL BROKEN: the real code no longer offers zero, so there is nothing to contrast.");
  failures++;
} else {
  console.log(`  routing on the class key offers ${routed.length} class (${routed[0].name}); today's code offers 0.`);
  console.log("  NEGATIVE CONTROL PASSED");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
