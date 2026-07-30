// The shared prompt structure names NO academy - proved by rendering, in the
// real source.
//
// WHAT THIS GUARDS. `api/agent/prompt-structure.js` holds the static SECTION
// bodies every academy's agent falls back to. Three of them were BAM GTA's:
//
//   business_info        "Name: By Any Means Basketball (BAM GTA)
//                         Location: 1079 Linbrook Rd, Oakville, ON L6J 2L2
//                         Directions: ...  Trial booking link: byanymeanstoronto.ca/..."
//   qualification_config "- Location proximity: Are they in or near Oakville/GTA?"
//   coaches              "All coaches are certified by By Any Means and have
//                         played at the college or professional level."
//
// All three DO derive per academy now (renderBusinessInfo / renderQualification /
// renderCoaches in api/agent/fact-render.js, all three in FACT_KEYS). That is not
// enough. `derivedFactOverrides` returns {} for an academy with no training
// offer, and assemblePrompt's pick() then falls through to the static body - so
// an academy mid-onboarding shipped a Toronto gym address, an Ontario service
// area, and a certification claim from a company it has no relationship with.
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
//   MUTATE=biz    node api/_prompt-academy-neutral.test.mjs  # re-plant GTA's business_info in the REAL source
//   MUTATE=qual   node api/_prompt-academy-neutral.test.mjs  # re-plant "near Oakville/GTA" in the REAL source
//   MUTATE=coach  node api/_prompt-academy-neutral.test.mjs  # re-plant the "By Any Means" credential in the REAL source
//   MUTATE=hollow node api/_prompt-academy-neutral.test.mjs  # emptied section filled with a neutral-sounding placeholder
//   MUTATE=deaf   node api/_prompt-academy-neutral.test.mjs  # pick() ignores overrides, so a configured academy loses its own facts
//   MUTATE=count  node api/_prompt-academy-neutral.test.mjs  # brain-health total written down again instead of derived
//
// Every MUTATE except `count` rewrites `api/agent/prompt-structure.js` ON DISK,
// imports the mutated module, and restores the file through exit/signal handlers
// registered before the first write. A control that mutates a hand-written copy
// of the default proves only that the copy is wrong; this one proves the suite
// catches the real file regressing, through the real assemblePrompt.
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED.
//
// WHAT THIS DOES NOT GUARD. Other static bodies still carry one academy's VALUES
// even though they name nobody: `schedule` (a full week of GTA's class times),
// `program` (its ages and group sizes), `policies`, `selling_points`,
// `booking_group` (ages 9-13 / 14+), and the receipt shape in PRICING_DISCLOSURE
// (GTA's real $279.00 plan and Ontario's HST 13%). Those are a separate call and
// are deliberately not asserted on here - do not read a green run as "the
// defaults are academy-free", only as "the defaults name no academy".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  renderBusinessInfo, renderQualification, renderCoaches,
  FACT_SOURCES, FACT_KEYS,
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
const { assemblePrompt, SECTIONS, sectionKeysForAgent } = S;

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
    general_info: { age_range: "8 to 17", skill_level: "All" },
    sales: { signup_url: "https://northsidehoops.example/enroll" },
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
};

console.log("\n── 1. the emptied sections are present and EMPTY, for every agent ──");
for (const agent of AGENTS) {
  const prompt = assemblePrompt(SPARSE, agent);
  for (const key of ["business_info", "qualification_config", "coaches"]) {
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
  ok(CONFIGURED.business_info && CONFIGURED.qualification_config && CONFIGURED.coaches,
    "the three renderers all produce a body for a fully configured academy");
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
    ok(hits(prompt).length === 0,
      `${agent}: and still nothing from another academy`);
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
for (const key of ["business_info", "qualification_config", "coaches"]) {
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
