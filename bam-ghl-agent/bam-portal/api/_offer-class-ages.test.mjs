// Does the PUBLIC offer payload carry a class's numeric age range?
//
//   node api/_offer-class-ages.test.mjs
//   MUTATE=<name> node api/_offer-class-ages.test.mjs   # a negative control
//
// WHY THIS EXISTS. api/website/offer.js is what a client site fetches, and
// until this change it exposed only the free-text `age` an owner typed
// ("Elementary School"). So every site that needed to know which class a child
// belongs in had to hardcode the boundary. BAM GTA's free-trial page does
// exactly that, with `>= 14` written into it, and that page is the reference
// implementation the next academy's page gets cloned from. The hardcode was
// harmless only while its number happened to agree with the portal.
//
// This suite pins the CONTRACT, not the implementation: the three raw fields
// plus `age_configured`. It cannot call the endpoint (Supabase, an origin
// allowlist and a request), so it exercises the mapper's shape against the same
// resolver the endpoint imports, and asserts the endpoint really does import it.
//
// MUTATE=raw           the mapper drops the numeric fields, as it did before
// MUTATE=noconfigured  age_configured stops crossing the wire
// MUTATE=inline        age_configured is recomputed locally instead of read
//                      from classAgeRange, i.e. a second definition of it
// MUTATE=interpret     the mapper "helpfully" resolves the open top to a number

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classAgeRange } from "./agent/_class-routing.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFFER = path.join(HERE, "website", "offer.js");
const MUTATE = process.env.MUTATE || "";

let pass = 0, fail = 0; const failed = [];
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failed.push(label); console.log("  ❌ " + label); }
}
const eq = (a, b, label) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

// The two academies' REAL stored classes, queried from production 2026-07-30.
// GTA's second group is the one that matters most: "No upper limit" with no
// number, because a mandatory top would silently retire its 14-and-up group.
const GTA = [
  { title: "Group 1", age: "Elementary School", age_min: "9", age_max: "13", age_max_mode: "Set an oldest age" },
  { title: "Group 2", age: "High School", age_min: "14", age_max: null, age_max_mode: "No upper limit" },
];
// An academy that has NOT typed any ages yet. On day one this is every academy
// except BAM GTA, which is why it is a first-class case and not an edge one.
const UNSET = [{ title: "All Ages", age: "Elementary School" }];

// The mapper under test, kept in step with offer.js by the source assertions
// at the end rather than by anyone remembering.
function mapGroup(cls) {
  const raw = {
    title: cls && cls.title ? String(cls.title) : null,
    age: cls && cls.age ? String(cls.age) : null,
    age_min: cls && cls.age_min != null ? String(cls.age_min) : null,
    age_max: cls && cls.age_max != null ? String(cls.age_max) : null,
    age_max_mode: cls && cls.age_max_mode != null ? String(cls.age_max_mode) : null,
    age_configured: classAgeRange(cls).configured,
  };
  if (MUTATE === "raw") { delete raw.age_min; delete raw.age_max; delete raw.age_max_mode; }
  if (MUTATE === "noconfigured") delete raw.age_configured;
  if (MUTATE === "inline") raw.age_configured = !!(cls && (cls.age_min != null || cls.age_max != null));
  if (MUTATE === "interpret" && String(cls && cls.age_max_mode || "").toLowerCase() === "no upper limit") {
    raw.age_max = "99";
  }
  return raw;
}

console.log("\n── 1. the numeric range reaches a client site ──");
const g = GTA.map(mapGroup);
eq(g[0].age_min, "9", "Group 1 min");
eq(g[0].age_max, "13", "Group 1 max");
eq(g[1].age_min, "14", "Group 2 min");
eq(g[1].age_max, null, "Group 2 has NO max, and it is not invented");
eq(g[1].age_max_mode, "No upper limit", "the open top crosses the wire as the owner set it");

console.log("\n── 2. the free-text age is untouched ──");
// It is what parent-facing copy shows. A grade means different ages in Ontario
// than in California, so nothing may machine-convert it, and nothing here does.
eq(g[0].age, "Elementary School", "Group 1 keeps its free text");
eq(g[1].age, "High School", "Group 2 keeps its free text");

console.log("\n── 3. configured vs unconfigured, the trap ──");
// An unconfigured class matches EVERY age server-side, deliberately, so
// academies did not go dark when the field shipped. A site that cannot tell
// this state from a failed fetch must guess, and both guesses are wrong.
eq(g.map((x) => x.age_configured), [true, true], "GTA's classes report configured");
const u = UNSET.map(mapGroup);
eq(u[0].age_configured, false, "an academy with no ages typed reports UNCONFIGURED");
eq([u[0].age_min, u[0].age_max, u[0].age_max_mode], [null, null, null], "...and carries no invented bounds");
ok(u[0].age === "Elementary School", "...while still carrying its free-text age for copy");

console.log("\n── 4. an open top is configured, which is the whole point ──");
// "No upper limit" with no number is a DECISION, not an omission. If this ever
// reads as unconfigured, BAM GTA's 14-and-up group looks unset and any consumer
// treating unconfigured as "ask the server" loses the fact the owner stated.
const openTopOnly = mapGroup({ title: "Seniors", age_max_mode: "No upper limit" });
eq(openTopOnly.age_configured, true, "no-upper-limit alone counts as configured");
eq(openTopOnly.age_max, null, "and still reports no maximum");

console.log("\n── 5. the endpoint reads the shared resolver, not its own copy ──");
const src = fs.readFileSync(OFFER, "utf8");
ok(/import\s*\{[^}]*classAgeRange[^}]*\}\s*from\s*["']\.\.\/agent\/_class-routing\.js["']/.test(src),
  "offer.js imports classAgeRange from the shared resolver");
ok(/age_configured:\s*classAgeRange\(cls\)\.configured/.test(src),
  "age_configured is READ from it, not recomputed inline");
for (const f of ["age_min:", "age_max:", "age_max_mode:"]) {
  ok(src.includes(f), `offer.js emits ${f.replace(":", "")}`);
}

console.log("\n── NEGATIVE CONTROL ──");
if (MUTATE) {
  const checks = {
    raw: () => {
      if (g[0].age_min !== undefined) throw new Error("the mutation changed nothing");
      return "the numeric range never reaches the site, so it must hardcode a boundary again";
    },
    noconfigured: () => {
      if (g[0].age_configured !== undefined) throw new Error("the mutation changed nothing");
      return "a site cannot tell 'no ages typed yet' from 'the fetch failed', and both guesses break an academy";
    },
    inline: () => {
      const v = mapGroup({ title: "Seniors", age_max_mode: "No upper limit" }).age_configured;
      if (v !== false) throw new Error("the mutation changed nothing");
      return "a second definition of configured reads an explicit no-upper-limit as unset";
    },
    interpret: () => {
      if (g[1].age_max !== "99") throw new Error("the mutation changed nothing");
      return "the endpoint invented a maximum of 99 for a group the owner said has none";
    },
  };
  const run = checks[MUTATE];
  if (!run) { console.error(`  unknown MUTATE=${MUTATE}. Known: ${Object.keys(checks).join(", ")}`); process.exit(1); }
  let why = null;
  try { why = run(); } catch (e) { why = null; console.log("  ❌ " + e.message); }
  if (!why) {
    console.log(`\n❌ MUTATE=${MUTATE} was NOT caught, so the check it stands for proves nothing.`);
    process.exit(1);
  }
  console.log(`\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught - ${why}`);
  process.exit(0);
}
// Every control must be DISCOVERABLE. portal-ci.yml finds them by grepping this
// file for the literal `MUTATE=<name>`, so a control named only as an object key
// is real, passes by hand, and is never run by CI. That happened once already in
// api/_class-slots.test.mjs, to its three most consequential controls.
{
  const self = fs.readFileSync(new URL(import.meta.url), "utf8");
  const missing = ["raw", "noconfigured", "inline", "interpret"]
    .filter((n) => !new RegExp(`MUTATE=${n}(?![A-Za-z0-9_-])`).test(self));
  ok(missing.length === 0,
    `every control names itself as MUTATE=<name> so CI can find it${missing.length ? ` (CI would skip: ${missing.join(", ")})` : ""}`);
}

console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failed) console.log("   - " + f); process.exit(1); }
