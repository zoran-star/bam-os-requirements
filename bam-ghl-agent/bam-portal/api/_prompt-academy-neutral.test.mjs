// The shared prompt structure names NO academy - proved by rendering, in the
// real source.
//
// WHAT THIS GUARDS. `api/agent/prompt-structure.js` holds the static SECTION
// bodies every academy's agent falls back to. EIGHT of them were BAM GTA's, and
// they came out in two rounds that failed in two genuinely different ways.
//
// ROUND 1 - the defaults that NAMED an academy:
//   business_info        "Name: By Any Means Basketball (BAM GTA)
//                         Location: 1079 Linbrook Rd, Oakville, ON L6J 2L2
//                         Directions: ...  Trial booking link: byanymeanstoronto.ca/..."
//   qualification_config "- Location proximity: Are they in or near Oakville/GTA?"
//   coaches              "All coaches are certified by By Any Means and have
//                         played at the college or professional level."
//   social_proof         "Google Reviews: https://share.google/yel2SPxIMKzjsJG9c"
//
// ROUND 2 - the defaults that named NOBODY, and were left behind for exactly
// that reason:
//   schedule             GTA's whole operating week, 7-8pm / 8-9pm weeknights,
//                        11:30 and 12:30 Saturdays, plus "We run on holidays"
//   program              "Ages: 9 and up", "Group sizes: 6-12 players",
//                        "Adult classes: Group 2 (older group) only"
//   policies             "Pause and cancel anytime", "Athletes can be dropped off"
//   selling_points       GTA's five differentiators - AND a stale copy of them,
//                        since Build 3 moved the real ones into its offer `value`
//
// Round 2 is the more dangerous half, which is the thing worth internalising. A
// leak that names an academy gets CAUGHT - a parent reads "Oakville" and knows
// something is wrong. A leak that names nobody gets BELIEVED: a plausible class
// time, a plausible minimum age, a plausible cancellation term, all unmarked and
// all wrong, so a parent turns up on a Tuesday the academy does not run or is
// told they can cancel anytime by an academy that requires 30 days notice.
// Section 2 hunts identifiers and structurally cannot see any of it; section 8
// is what covers round 2, and the two are not interchangeable.
//
// All eight DO derive per academy now (renderBusinessInfo / renderQualification /
// renderCoaches / renderSocialProof / renderSchedule / renderProgram /
// renderPolicies / renderSellingPoints in api/agent/fact-render.js, all in
// FACT_KEYS). That is not enough, and the gap is the whole reason this file
// exists. `derivedFactOverrides` returns {} for an academy with no training
// offer, and assemblePrompt's pick() then falls through to the static body.
// Measured 2026-07-30: 32 of 47 academies have no training offer AND no stored
// override row, so the fallback path is the MAJORITY path, not an edge case.
// renderQualification's own comment says it exists to kill "the hardcoded near
// Oakville/GTA default leaking to other academies, the exact bug that would have
// had San Jose's agent qualifying Bay Area parents by Ontario geography". The
// renderer landed; the default it replaced stayed underneath it as the fallback.
//
// WHY THIS SUITE RENDERS INSTEAD OF GREPPING. Standing rule in this repo:
// literal-grep leak audits give false answers in both directions. A string can be
// absent from the file it was moved out of and still reach the output through a
// fallback, and a string can be PRESENT in a file purely inside a comment
// explaining why it was removed. So every assertion below builds a REAL prompt
// through the real assemblePrompt and inspects THAT. The one source-side check
// (section 6) strips comments first, for exactly that reason.
//
//   node api/_prompt-academy-neutral.test.mjs
//
// ELEVEN negative controls. Each was run and watched go RED before this list was
// written; none is a claim about a check nobody exercised.
//
//   round 1 - re-plant a default that NAMES an academy (caught by section 2)
//   MUTATE=biz    node api/_prompt-academy-neutral.test.mjs  # GTA's business_info
//   MUTATE=qual   node api/_prompt-academy-neutral.test.mjs  # "near Oakville/GTA"
//   MUTATE=coach  node api/_prompt-academy-neutral.test.mjs  # the "By Any Means" credential
//
//   round 2 - re-plant a default that names NOBODY (caught by section 8 only)
//   MUTATE=sched  node api/_prompt-academy-neutral.test.mjs  # GTA's operating week + "We run on holidays"
//   MUTATE=prog   node api/_prompt-academy-neutral.test.mjs  # "Ages: 9 and up", "6-12 players"
//   MUTATE=pol    node api/_prompt-academy-neutral.test.mjs  # "Pause and cancel anytime", drop-off rule
//   MUTATE=sell   node api/_prompt-academy-neutral.test.mjs  # GTA's five differentiators
//
//   the shapes that are not literal leaks at all
//   MUTATE=hollow node api/_prompt-academy-neutral.test.mjs  # emptied section filled with a neutral-sounding placeholder
//   MUTATE=deaf   node api/_prompt-academy-neutral.test.mjs  # pick() ignores overrides, so a configured academy loses its own facts
//   MUTATE=count  node api/_prompt-academy-neutral.test.mjs  # brain-health total written down again instead of derived
//   MUTATE=group  node api/_prompt-academy-neutral.test.mjs  # booking_group EMPTIED - the regression that looks like a fix
//
// `group` is the only control that mutates by DELETING, and it is the one most
// worth understanding. Emptying `booking_group` is what a future session will
// reach for while "finishing the job" of clearing GTA data out of this file. It
// is a regression: "Group 1"/"Group 2" are the argument values check_availability
// and book_group take, so an agent that never learns the vocabulary cannot route
// to a calendar at all. Section 9 exists to fail on it. See that section and the
// section's own comment in prompt-structure.js for the derivation gap.
//
// Every MUTATE except `count` rewrites `api/agent/prompt-structure.js` ON DISK,
// imports the mutated module, and restores the file through exit/signal handlers
// registered before the first write. A control that mutates a hand-written copy
// of the default proves only that the copy is wrong; this one proves the suite
// catches the real file regressing, through the real assemblePrompt.
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED.
// And a control must change what assemblePrompt EMITS, not merely what the file
// says: an earlier version of `refill` inserted a second "body" key above the
// empty one, JS kept the LAST duplicate, the module went on exporting "", and
// the control "passed" while proving nothing. Same trap, same day, in the
// GTA_VALUES map below - which is why its length is asserted rather than trusted.
//
// WHAT THIS STILL DOES NOT GUARD, and do not read a green run as covering it:
//   `booking_group` knowingly still carries GTA's age bands (9-13 / 14+). Left
//   on purpose - it routes, it has no renderer, and the same bands are restated
//   in three tool schemas in api/agent-approvals.js, so emptying it deletes one
//   of four copies and takes routing with it. Section 9 pins the decision.
//   The RECEIPT constant in PRICING_DISCLOSURE is GTA's real Summer Unlimited
//   row ($279.00 + HST 13% = $315.27, verified against production). Audited
//   2026-07-30 and left as shared sales craft; the reasoning and the residual
//   risk are written out at the constant itself. Nothing here tests that a live
//   agent never speaks those numbers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  renderBusinessInfo, renderQualification, renderCoaches,
  renderSchedule, renderProgram, renderPolicies, renderSellingPoints,
  FACT_SOURCES, FACT_KEYS, PRICING_NOT_CONFIGURED,
} from "./agent/fact-render.js";
import * as REAL from "./agent/prompt-structure.js";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "agent", "prompt-structure.js");
const ORIGINAL = fs.readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ── the literals that must never reach another academy's agent ───────────────
// GTA's own identity, verified against the production clients row + locations.
const GTA = {
  name:    "By Any Means Basketball",
  brand:   "By Any Means",
  street:  "1079 Linbrook Rd",
  city:    "Oakville",
  region:  "GTA",
  domain:  "byanymeanstoronto.ca",
  reviews: "share.google",
};
const BANNED = Object.values(GTA);

// ── round 2: the values that name NOBODY ─────────────────────────────────────
// The list above is what a leak looks like when it is easy. These are what one
// academy's operating data looks like when it is NOT - GTA's real week, ages,
// terms and differentiators, carrying no name, no city and no link. They were
// left behind by the round that removed the ones above precisely because they
// read as generic, and that is what made them the more dangerous half: a parent
// who is told the wrong address checks it, and a parent who is told the wrong
// class time turns up on a Tuesday the academy does not run.
//
// Each entry is a fragment that only BAM GTA's data produces. They are asserted
// against the RENDERED prompt, never the source, for the reason in the header.
const GTA_VALUES = {
  "schedule (weeknight class times)":   "Younger group: 7-8pm",
  "schedule (saturday class times)":    "11:30-12:30pm",
  "schedule (holiday commitment)":      "We run on holidays",
  "program (minimum age)":              "Ages: 9 and up",
  "program (group size)":               "6-12 players",
  "program (adult classes bucket)":     "Adult classes: Group 2",
  "policies (cancellation terms)":      "Pause and cancel anytime",
  "policies (under-18 drop-off)":       "Athletes can be dropped off",
  "selling_points (science-based)":     "Science-based approach",
  "selling_points (time-on-task)":      "time-on-task",
};
// Duplicate keys here would be silently swallowed (JS keeps the last), quietly
// dropping an assertion while the suite still went green - the same shape of
// fake pass that a duplicate "body" key produced in an earlier control. So the
// count is checked rather than trusted.
if (Object.keys(GTA_VALUES).length !== 10) {
  console.error("GTA_VALUES lost an entry to a duplicate key - fix the key names."); process.exit(1);
}

// ── mutating the REAL source ─────────────────────────────────────────────────
// Restore is registered before the first write, so a crash, a Ctrl-C, or a failed
// assertion all leave prompt-structure.js byte-identical to how it started.
let dirty = false;
const restore = () => { if (dirty) { fs.writeFileSync(SRC, ORIGINAL); dirty = false; } };
process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(130); });
process.on("SIGTERM", () => { restore(); process.exit(143); });
process.on("uncaughtException", (e) => { restore(); console.error(e); process.exit(1); });

// Refill the emptied `"body": ""` that belongs to one section entry. Anchoring on
// the label and then taking the NEXT empty body is what makes the mutation land
// on the real body the module exports. An earlier version of this control
// inserted a second "body" key above the empty one; JS takes the LAST duplicate
// key, so the module still exported "" and only the source-side check fired. A
// control has to change what assemblePrompt actually emits, or it is testing the
// grep and calling it a render.
const bail = (msg) => { console.log("  ⚠️  MUTATE=" + MUTATE + ": " + msg + " - the control is stale."); restore(); process.exit(1); };
function refill(src, label, body) {
  const at = src.indexOf(`"label": "${label}",`);
  if (at < 0) bail(`no section labelled "${label}"`);
  const b = src.indexOf(`"body": ""`, at);
  if (b < 0) bail(`the "${label}" entry has no empty body to refill`);
  return src.slice(0, b) + `"body": ${JSON.stringify(body)}` + src.slice(b + `"body": ""`.length);
}

// The mutations, as edits to the real file. Each re-plants the exact literal that
// was removed, in the exact entry it used to live in.
const REPLANT = {
  biz:   (s) => refill(s, "Business info", "Name: By Any Means Basketball (BAM GTA)\nLocation: 1079 Linbrook Rd, Oakville, ON L6J 2L2\nDirections: The doors are on the front of the building to the left.\nTrial booking link: byanymeanstoronto.ca/free-trial"),
  qual:  (s) => refill(s, "Who qualifies", "Qualify leads on these dimensions:\n- Location proximity: Are they in or near Oakville/GTA?"),
  coach: (s) => refill(s, "Coaches", "All coaches are certified by By Any Means and have played at the college or professional level."),
  // Not a leak - a well-meaning placeholder. It names nobody and reads harmless,
  // and it is still wrong: the section is present-but-hollow, so the fact stops
  // reading as absent and the brain-health nudge never tells the owner to fill it.
  hollow: (s) => refill(s, "Business info", "Ask us for the address and we will send it over."),
  // ── round 2 replants: one academy's VALUES, naming nobody ──────────────────
  // Each puts back the exact literal that was removed, in the entry it lived in.
  // None of these contains a name, a city, a link or a credential, so none of
  // them can be caught by the BANNED list above - they are what section 8 is for.
  sched: (s) => refill(s, "Schedule", "MONDAYS\nYounger group: 7-8pm\nOlder group: 8-9pm\n\nTUESDAYS\nYounger group: 7-8pm\nOlder group: 8-9pm\n\nSATURDAYS\nYounger group: 11:30-12:30pm\nOlder group: 12:30-1:30pm\n\nHoliday schedule: We run on holidays."),
  prog:  (s) => refill(s, "Program", "Ages: 9 and up\nSkill levels: All skill levels\nGroup sizes: 6-12 players\nCoach ratio: At least 2 coaches per session\nAdult classes: Group 2 (older group) only"),
  pol:   (s) => refill(s, "Policies", "Cancel/pause: Pause and cancel anytime\nMakeup/reschedule: Reschedule through the booking app\nUnder-18 policy: Parent must book the trial. Athletes can be dropped off (parent does not need to stay)."),
  sell:  (s) => refill(s, "Selling points", "These are the key differentiators for this academy.\n\n- Science-based approach to basketball training\n- Drills maximize time-on-task, so athletes spend more time training"),

  // The INVERSE control, and the only one here that mutates by DELETING. It
  // empties `booking_group`, which is the thing a future session is most likely
  // to do while "finishing the job" of clearing GTA data out of this file.
  // Emptying it is a regression, not a fix: "Group 1"/"Group 2" are the argument
  // values check_availability and book_group take, so an agent that never learns
  // the vocabulary cannot route to a calendar at all. Section 9 must go red here.
  group: (s) => {
    const at = s.indexOf(`"label": "Booking - which group / calendar",`);
    if (at < 0) bail("no booking_group section");
    const b = s.indexOf(`"body": "Pick the group by the athlete's age`, at);
    if (b < 0) bail("booking_group's body no longer matches the anchor");
    const end = s.indexOf(`"\n  }`, b);
    if (end < 0) bail("could not find the end of booking_group's body");
    return s.slice(0, b) + `"body": ""` + s.slice(end + 1);
  },

  // pick() stops honouring overrides, so a configured academy silently falls back
  // to the shared defaults for every fact.
  deaf: (s) => {
    const from = `  const pick = (k) => (overrides[k] != null && String(overrides[k]).trim() !== "") ? overrides[k] : (SECTIONS.find(s => s.key === k)?.body || "");`;
    if (!s.includes(from)) bail("assemblePrompt's pick() no longer matches the anchor");
    return s.replace(from, `  const pick = (k) => (SECTIONS.find(s => s.key === k)?.body || "");`);
  },
};

async function loadStructure() {
  const edit = REPLANT[MUTATE];
  if (!edit) return REAL;
  fs.writeFileSync(SRC, edit(ORIGINAL));
  dirty = true;
  // Cache-buster: the unmutated module is already in the ESM registry.
  return await import(pathToFileURL(SRC).href + "?mutate=" + Date.now());
}

const S = await loadStructure();
const { assemblePrompt, SECTIONS, sectionKeysForAgent, ACADEMY_INTRO } = S;

const AGENTS = ["booking", "confirm", "closing"];
const sectionOf = (prompt, tag) => {
  const m = prompt.match(new RegExp("<" + tag + ">\\n([\\s\\S]*?)\\n</" + tag + ">"));
  return m ? m[1] : null;
};
const configBlock = (prompt) => {
  const m = prompt.match(/<academy_config>([\s\S]*?)<\/academy_config>/);
  return m ? m[1] : "";
};
const hits = (text) => BANNED.filter((b) => text.includes(b));

// ── the two academies ────────────────────────────────────────────────────────
// SPARSE: no training offer, so derivedFactOverrides returns {} and NOTHING
// overrides the static bodies. This is the exact live case the leak shipped
// through - it is not a hypothetical, it is every academy mid-onboarding.
const SPARSE = {};

// CONFIGURED: a fully set-up academy, 4000km from Oakville. Its overrides are
// built by calling the REAL renderers on its own rows rather than by typing
// expected strings, so section 3 proves the working path, not a mock of it.
const FIXTURE = {
  client: {
    business_name: "Northside Hoops",
    address: "2201 Monterey Hwy, San Jose, CA 95112",
    website_setup: { domain: "northsidehoops.example" },
  },
  data: {
    general_info: { age_range: "8 to 17", skill_level: "All", gender: ["Boys", "Girls"], coach_ratio: "1 coach per 5 athletes" },
    sales: { signup_url: "https://northsidehoops.example/enroll" },
    // Deliberately UNLIKE GTA on every axis a parent would act on: a different
    // night, a different hour, a different group size, and - the two that matter
    // most - the OPPOSITE cancellation term and the OPPOSITE drop-off rule. If
    // the defaults ever leak back in, this academy does not merely get extra
    // text, it gets text that contradicts its own contract.
    schedule: {
      classes: [
        { title: "Skills Group", age: "8 to 12", group_size: "4-5", weekly_times: [{ days: ["Wed"], start: "17:30", end: "18:30", location: "loc-1" }] },
      ],
      year_round: "Seasonal",
    },
    policy: {
      cancellation: "Notice required", cancel_notice_amount: 30, cancel_notice_unit: "days",
      pause_allowed: "No",
      parent_watching: "A parent must stay for the whole session",
      under_18: "A parent must remain on site and cannot drop off",
    },
    value: {
      what_makes_different: "Every athlete leaves with a filmed rep breakdown the same night.",
      program_structure: "Two skill blocks then live play.",
    },
  },
  locations: [
    { id: "loc-1", title: "Northside Court", address: "2201 Monterey Hwy, San Jose, CA 95112", notes: "Enter by the side door" },
  ],
  staff: [{ name: "Marisol Vega", role: "owner", title: "Head Coach", bio: "Coached high school ball for nine years." }],
};
const CONFIGURED = {
  business_info: renderBusinessInfo(FIXTURE.client, FIXTURE.data, FIXTURE.locations),
  qualification_config: renderQualification(FIXTURE.data, FIXTURE.client, FIXTURE.locations),
  coaches: renderCoaches(FIXTURE.staff),
  schedule: renderSchedule(FIXTURE.data, FIXTURE.locations),
  program: renderProgram(FIXTURE.data),
  policies: renderPolicies(FIXTURE.data),
  selling_points: renderSellingPoints(FIXTURE.data),
};

// The eight fact bodies that must render EMPTY for an academy with no offer.
// `pricing` is deliberately not here: its default is PRICING_NOT_CONFIGURED, an
// instruction to quote nothing, which is the correct non-empty fact-absent body.
const EMPTIED = [
  "business_info", "qualification_config", "coaches", "social_proof",
  "schedule", "program", "policies", "selling_points",
];

console.log("\n── 1. the emptied sections are present and EMPTY, for every agent ──");
for (const agent of AGENTS) {
  const prompt = assemblePrompt(SPARSE, agent);
  for (const key of EMPTIED) {
    const sec = sectionOf(prompt, key);
    ok(sec !== null && sec.trim() === "",
      `${agent}: <${key}> is present but empty, which is what makes the fact read as absent`);
  }
}

console.log("\n── 2. an academy with no offer names NO academy, anywhere in the prompt ──");
for (const agent of AGENTS) {
  const prompt = assemblePrompt(SPARSE, agent);
  const found = hits(prompt);
  ok(found.length === 0,
    `${agent}: no academy identifier anywhere in the prompt${found.length ? " (found: " + found.join(", ") + ")" : ""}`);
  // Whole-prompt, not just the fact sections: a leak in an example or a behaviour
  // body reaches the model exactly as hard as one in business_info.
  ok(!/\bOakville\b|\bGTA\b|Linbrook/i.test(prompt),
    `${agent}: no Ontario geography survives anywhere, including the examples`);
  ok(!/https?:\/\/|\.ca\b|\.com\b/.test(configBlock(prompt)),
    `${agent}: no link or domain of any kind is in the academy config of an academy that has none`);
}

console.log("\n── 3. a configured academy still renders its OWN values ──");
{
  // Every emptied section must have a renderer that actually produced something
  // for this fixture. Checked as a set rather than by name: a section emptied in
  // future without a working renderer behind it fails here instead of silently
  // becoming a fact no academy can ever have.
  const unrendered = EMPTIED.filter((k) => k !== "social_proof" && !CONFIGURED[k]);
  ok(unrendered.length === 0,
    `every emptied section has a renderer that fills it for a configured academy${unrendered.length ? " (empty: " + unrendered.join(", ") + ")" : ""}`);
  for (const agent of AGENTS) {
    const prompt = assemblePrompt(CONFIGURED, agent);
    const biz = sectionOf(prompt, "business_info") || "";
    ok(biz.includes("Northside Hoops") && biz.includes("2201 Monterey Hwy") && biz.includes("Enter by the side door"),
      `${agent}: business_info carries this academy's own name, address and directions note`);
    ok(biz.includes("northsidehoops.example/free-trial") && biz.includes("northsidehoops.example/enroll"),
      `${agent}: its own booking link and sign-up link, not a default one`);
    const qual = sectionOf(prompt, "qualification_config") || "";
    ok(qual.includes("Northside Court") && qual.includes("8 to 17"),
      `${agent}: qualification is scoped to ITS location and ITS age range`);
    const coach = sectionOf(prompt, "coaches") || "";
    ok(coach.includes("Marisol Vega") && coach.includes("Head Coach"),
      `${agent}: coaches names its own staff`);

    // The four emptied in round 2, proved through their REAL renderers. Emptying
    // a default is only half a guarantee: it stops the wrong answer, and these
    // assert the right one still arrives.
    const sched = sectionOf(prompt, "schedule") || "";
    ok(sched.includes("Wed 5:30pm-6:30pm") && sched.includes("Northside Court") && sched.includes("Runs seasonally"),
      `${agent}: schedule is ITS night, ITS hour, at ITS location, on ITS season`);
    const prog = sectionOf(prompt, "program") || "";
    ok(prog.includes("8 to 17") && prog.includes("4-5"),
      `${agent}: program carries its own age range and its own group size`);
    const pol = sectionOf(prompt, "policies") || "";
    ok(pol.includes("30 days written notice") && pol.includes("cannot drop off"),
      `${agent}: policies carry its own terms, which CONTRADICT the removed defaults`);
    const sell = sectionOf(prompt, "selling_points") || "";
    ok(sell.includes("filmed rep breakdown"),
      `${agent}: selling points are its own differentiator, not the shared five`);

    ok(hits(prompt).length === 0,
      `${agent}: and still nothing from another academy`);
    // The configured academy must not pick up the OTHER academy's values either.
    const leaked = Object.entries(GTA_VALUES).filter(([, v]) => prompt.includes(v));
    ok(leaked.length === 0,
      `${agent}: a configured academy carries none of the removed values${leaked.length ? " (found: " + leaked.map(([k]) => k).join(", ") + ")" : ""}`);
  }
}

console.log("\n── 4. a stored per-academy override still wins over the empty default ──");
{
  // An academy with no offer that TYPED its business info by hand: emptying the
  // default must not have made the section unfillable.
  const typed = { business_info: "Riverside Ball Club\nLocation: 88 Riverside Dr" };
  const prompt = assemblePrompt(typed, "booking");
  ok((sectionOf(prompt, "business_info") || "").includes("Riverside Ball Club"),
    "a stored body still fills the section (empty default, not a locked section)");
}

console.log("\n── 5. the section ENTRIES survive, so the training UI keeps its rows ──");
for (const key of EMPTIED) {
  const entry = SECTIONS.find((s) => s.key === key);
  ok(!!entry && !!entry.label && !!entry.tag && !!entry.layer,
    `${key} still has its entry, label, tag and layer (api/agent-train.js maps over SECTIONS)`);
  ok(AGENTS.every((a) => sectionKeysForAgent(a).includes(key)),
    `${key} is still in every agent's section list`);
  ok(Object.prototype.hasOwnProperty.call(FACT_SOURCES, key) && !!FACT_SOURCES[key].jump,
    `${key} is still in FACT_SOURCES with a jump target, so the nudge chip goes somewhere`);
  ok(FACT_KEYS.includes(key), `${key} still counts toward the brain-health strip`);
}

console.log("\n── 6. the literals are gone from the CODE, not just hidden by a comment ──");
{
  // The complement to rendering: prove the strings are not sitting in some other
  // body. Comments are stripped FIRST - three of them deliberately quote the
  // removed literal to record what must never come back, and a naive grep would
  // read those as the leak.
  const stripped = fs.readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
  for (const b of BANNED) {
    ok(!stripped.includes(b), `no executable line in prompt-structure.js contains "${b}"`);
  }
  ok(ORIGINAL.includes("Oakville") && ORIGINAL.includes("Linbrook"),
    "the file DOES still say Oakville and Linbrook - in the comments that record why they were removed (this is why the check strips comments)");
}

console.log("\n── 7. the brain-health count is unchanged and still derived ──");
{
  // Mirrors api/agent-train.js: total is FACT_KEYS.length, never a literal.
  const health = (derived) => {
    const missing = FACT_KEYS.filter((k) => derived[k] == null);
    return { live: FACT_KEYS.length - missing.length, total: MUTATE === "count" ? 8 : FACT_KEYS.length, missing };
  };
  ok(FACT_KEYS.length === Object.keys(FACT_SOURCES).length,
    "FACT_KEYS is derived from FACT_SOURCES, so there is one count and not two");
  const sparse = health({});
  ok(sparse.live === 0 && sparse.total === FACT_KEYS.length,
    `an academy with no offer is shown 0 of ${FACT_KEYS.length} facts live, not a smaller total`);
  const all = {};
  for (const k of FACT_KEYS) all[k] = "rendered";
  const full = health(all);
  ok(full.live === full.total,
    `a fully configured academy is shown ${full.live} of ${full.total}, never more live than total`);
  const trainSrc = fs.readFileSync(path.join(HERE, "agent-train.js"), "utf8");
  ok(/total:\s*FACT_KEYS\.length/.test(trainSrc) && !/total:\s*\d+/.test(trainSrc),
    "agent-train.js derives the total from FACT_KEYS and writes no number down");
}

console.log("\n── 8. an academy with no offer carries none of the removed VALUES ──");
{
  // The round-2 guarantee, and the one section 2 structurally cannot make.
  // Section 2 hunts identifiers (a name, a city, a link); everything checked here
  // names nobody, so it would sail through that filter while still telling 32
  // academies' parents to show up at 7pm on a Tuesday.
  for (const agent of AGENTS) {
    const prompt = assemblePrompt(SPARSE, agent);
    const found = Object.entries(GTA_VALUES).filter(([, v]) => prompt.includes(v));
    ok(found.length === 0,
      `${agent}: no removed operating value survives anywhere in the prompt${found.length ? " (found: " + found.map(([k]) => k).join(", ") + ")" : ""}`);
  }
  // The strongest form: for an academy with nothing configured, the whole
  // academy_config block is nothing but its section tags and the intro. Any
  // future default quietly added to a fact body fails here even if nobody thinks
  // to add it to GTA_VALUES - the check does not need to know what leaked.
  for (const agent of AGENTS) {
    const body = configBlock(assemblePrompt(SPARSE, agent))
      .replace(/<\/?[a-z_]+>/g, "")
      .replace(ACADEMY_INTRO, "")
      .replace(PRICING_NOT_CONFIGURED, "")
      .trim();
    ok(body === "",
      `${agent}: a sparse academy's config is EMPTY apart from the intro and the no-pricing instruction${body ? " (leftover: " + JSON.stringify(body.slice(0, 90)) + ")" : ""}`);
  }
}

console.log("\n── 9. booking_group is deliberately NOT empty, because it routes ──");
{
  // The exception, guarded in the opposite direction from everything above.
  // booking_group does carry GTA's ages, and emptying it is a REGRESSION: the
  // "Group 1"/"Group 2" tokens are the argument values check_availability and
  // book_group take (api/agent-approvals.js -> calendarForGroup in
  // api/agent/booking.js), and this section is the only prose that teaches them.
  // An agent that never learns the vocabulary cannot verify a slot or book at
  // all, which is a worse failure than a wrong age band. Full reasoning and the
  // derivation gap are in the section's own comment.
  const entry = SECTIONS.find((s) => s.key === "booking_group");
  ok(!!entry && String(entry.body || "").trim() !== "",
    "booking_group still has a body (emptying it removes routing without removing the leak)");
  const prompt = assemblePrompt(SPARSE, "booking");
  const sec = sectionOf(prompt, "booking_group") || "";
  ok(sec.includes("Group 1") && sec.includes("Group 2"),
    "the booking agent is still taught the exact group tokens calendarForGroup matches on");
  ok(!sectionKeysForAgent("confirm").includes("booking_group")
    && !sectionKeysForAgent("closing").includes("booking_group"),
    "and only the BOOKING agent gets it - confirm and closing never route");
  // Honesty: this is the one place a GTA value knowingly survives, so the suite
  // says so out loud rather than letting a green run imply otherwise.
  ok(/ages 9 to 13|ages 14 and up/.test(sec),
    "NOTE: booking_group knowingly still carries GTA's age bands - a named gap, not a clean result");
  ok(!EMPTIED.includes("booking_group"),
    "booking_group is excluded from the emptied list on purpose, not by oversight");
}

restore();
console.log("");
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
