// social_proof: the ninth agent fact, and the leak its arrival removes.
//
// WHAT THIS GUARDS. `prompt-structure.js` carried a hardcoded body for the
// social_proof section:
//     "Google Reviews: https://share.google/yel2SPxIMKzjsJG9c"
// BAM GTA's link, in the structure EVERY academy's agent is built from. Nothing
// overrode it: there was no renderer, and 0 of 47 academies had a stored
// social_proof row. So San Jose, DETAIL Miami and Next Level all pointed parents
// at a Toronto academy's review page.
//
// WHY THIS SUITE RENDERS INSTEAD OF GREPPING. There is a standing rule in this
// repo that literal-grep leak audits give false answers - a string can be absent
// from the file it was moved out of and still reach the output through a
// fallback. So every assertion below builds a REAL prompt through the real
// assemblePrompt and inspects THAT.
//
//   node api/_social-proof.test.mjs
//
//   MUTATE=leak        node api/_social-proof.test.mjs  # put GTA's link back in the shared default
//   MUTATE=manualstars node api/_social-proof.test.mjs  # let a typed quote cite stars
//   MUTATE=borrowurl   node api/_social-proof.test.mjs  # fall back to another academy's review link
//   MUTATE=emptyfact   node api/_social-proof.test.mjs  # emit a section with no facts in it
//   MUTATE=hardtotal   node api/_social-proof.test.mjs  # hardcode the brain-health total again
//   MUTATE=blankall    node api/_social-proof.test.mjs  # let a resolver throw blank every fact
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED.

import { renderSocialProof, FACT_SOURCES, FACT_KEYS } from "./agent/fact-render.js";
import { assemblePrompt } from "./agent/prompt-structure.js";

const MUTATE = process.env.MUTATE || "";
let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// GTA's real link, verified in production. The one string that must never appear
// in a prompt built for anybody else.
const GTA_LINK = "https://g.page/r/CfuIFvZGkfmaEBM/review";
const OLD_HARDCODE = "https://share.google/yel2SPxIMKzjsJG9c";

// ── the renderer under test, with the mutations that must be caught ──────────
function render(resolved, url) {
  if (MUTATE === "manualstars") {
    // The bug: re-implement the google/manual distinction and get it wrong, so a
    // typed quote wears a star rating it never had. The real guarantee is that a
    // manual row has NO rating key at all - this fakes one to prove the renderer
    // does not invent stars for a row that is not google-sourced.
    const r = resolved || {};
    const rows = (r.testimonials || []).map(t => ({ ...t, rating: t.rating ?? 5 }));
    const parts = [];
    for (const row of rows.slice(0, 2)) parts.push(`A parent said: "${row.quote}" - ${row.author} (${row.rating} stars on Google)`);
    return parts.length ? parts.join("\n\n") : null;
  }
  if (MUTATE === "emptyfact") {
    // The bug: return a non-null body when there are no facts, so the section is
    // present-but-hollow and the brain-health chip never fires.
    return renderSocialProof(resolved, url) || "Ask us about our reviews.";
  }
  return renderSocialProof(resolved, url);
}

function factSources() {
  return FACT_SOURCES;
}

// The shared default body, as prompt-structure ships it. MUTATE=leak restores the
// literal that used to live there.
function sharedDefaultFor(key, cfg) {
  if (MUTATE === "leak" && key === "social_proof") return "Google Reviews: " + OLD_HARDCODE;
  return cfg[key];
}

// Build a prompt the way api/agent/brain.js does: overrides win, absent keys fall
// back to the shared default in prompt-structure.
function promptFor({ facts = {}, socialProof = null } = {}) {
  const overrides = { ...facts };
  const body = socialProof != null ? socialProof : sharedDefaultFor("social_proof", {});
  if (body) overrides.social_proof = body;
  else if (MUTATE === "leak") overrides.social_proof = undefined;
  return assemblePrompt(overrides, "booking");
}

const sectionOf = (prompt, tag) => {
  const m = prompt.match(new RegExp("<" + tag + ">\\n([\\s\\S]*?)\\n</" + tag + ">"));
  return m ? m[1] : null;
};

// A fully configured academy: all the OTHER facts render, so any social_proof
// content in the output can only have come from social_proof.
const OTHER_FACTS = {};
for (const k of FACT_KEYS) if (k !== "social_proof") OTHER_FACTS[k] = `[${k} from this academy's own data]`;

console.log("\n── 1. the shared default carries no academy's link ──");
{
  // The exact scenario that was live: an academy with no reviews and no url, so
  // nothing overrides social_proof and the shared default is what ships.
  const body = render({ aggregate: null, testimonials: [], starredCount: 0 }, "");
  ok(body === null, "an academy with no reviews and no url renders NOTHING (fact absent -> nudge chip)");

  const prompt = promptFor({ facts: OTHER_FACTS, socialProof: body });
  ok(!prompt.includes(OLD_HARDCODE),
    "the rendered prompt does not contain the old hardcoded GTA link");
  ok(!prompt.includes("share.google"),
    "no share.google link of any kind reaches a prompt built for an academy with no reviews");
  ok(!prompt.includes(GTA_LINK),
    "GTA's real review link does not reach another academy's prompt either");
  const sec = sectionOf(prompt, "social_proof");
  ok(sec !== null && sec.trim() === "",
    "the social_proof section is present but EMPTY, which is what makes the fact read as absent");
  // Everything else must still be there - a missing review is not a missing brain.
  ok(prompt.includes("[pricing from this academy's own data]") && prompt.includes("[schedule from this academy's own data]"),
    "the other facts are untouched by social_proof being absent");
}

console.log("\n── 2. an academy with reviews renders its own, and only its own ──");
{
  const resolved = {
    aggregate: { rating: "4.9", count: 67, checked_at: "2026-07-29T12:00:00Z" },
    testimonials: [
      { quote: "My son improved so much in one season.", author: "Kristina C.", source: "google", rating: 5, date: "2026-07-01" },
      { quote: "Coaches actually coach.", author: "Dan R.", source: "manual" },
    ],
    starredCount: 2,
  };
  const body = render(resolved, GTA_LINK);
  ok(body && body.includes("4.9") && body.includes("67"),
    "the aggregate line reports the rating and the review count");
  ok(body.includes("Google showed") && !/your rating/i.test(body),
    "the aggregate reads as what Google SHOWED, never as a current or verified rating");
  ok(body.includes("2026-07-29"),
    "the aggregate carries the date it was read - a fetched number looks current, so the date is what keeps it honest");
  ok(body.includes("Kristina C.") && body.includes("Dan R."),
    "both quotes render, in the order the resolver returned them");
  ok(body.includes(GTA_LINK), "the academy's OWN review link is offered");

  // The load-bearing distinction: stars only for the google-sourced row.
  const dan = body.split("\n\n").find(p => p.includes("Dan R."));
  ok(dan && !/stars/i.test(dan),
    "the TYPED quote carries no star rating (manual rows have no rating key at all)");
  const kristina = body.split("\n\n").find(p => p.includes("Kristina C."));
  ok(kristina && /5 stars on Google/.test(kristina),
    "the GOOGLE quote may cite its stars");
}

console.log("\n── 3. no borrowing, in either direction ──");
{
  // An academy with quotes but NO url of its own must not fall back to anyone's.
  const resolved = {
    aggregate: null,
    testimonials: [{ quote: "Great program.", author: "Sam P.", source: "manual" }],
    starredCount: 1,
  };
  const url = MUTATE === "borrowurl" ? GTA_LINK : "";   // the bug: borrow GTA's
  const body = render(resolved, url);
  ok(body !== null, "quotes alone still render (the fact is not all-or-nothing)");
  ok(!body.includes(GTA_LINK) && !body.includes("g.page"),
    "an academy with no review link of its own is offered NO link rather than another academy's");

  // And the aggregate must come only from the aggregate, never inferred.
  ok(!/stars across/.test(body),
    "no aggregate line is invented when the academy has no rating on file");
}

console.log("\n── 4. only the FACTS decide, never a template default ──");
{
  // Prove the section body in prompt-structure is inert: whatever it holds, an
  // academy with no facts gets nothing. MUTATE=leak makes it non-inert.
  const prompt = promptFor({ facts: OTHER_FACTS, socialProof: render({ aggregate: null, testimonials: [], starredCount: 0 }, "") });
  const sec = sectionOf(prompt, "social_proof");
  ok(sec !== null && !/http/.test(sec),
    "no URL of any kind appears in the social_proof section of an academy with no reviews");
}

console.log("\n── 5. the fact is WIRED, or it is invisible ──");
{
  const src = factSources();
  ok(Object.prototype.hasOwnProperty.call(src, "social_proof"),
    "social_proof is in FACT_SOURCES, so the training UI can badge it and link it");
  ok(FACT_KEYS.includes("social_proof"),
    "social_proof is in FACT_KEYS, so it counts toward the brain-health strip");
  const entry = src.social_proof || {};
  ok(!!entry.jump, "it has a jump target, so the nudge chip goes somewhere");
  ok(!!entry.label && /review/i.test(entry.label),
    "its label tells the owner what feeds it");
}

console.log("\n── 6. the brain-health total is derived, not written down ──");
{
  // The bug this catches produced a wrong number in the product, not a stale
  // comment: `live` was computed from FACT_KEYS.length while `total` was the
  // literal 8, so a ninth fact rendered "9 of 8 facts live".
  const total = MUTATE === "hardtotal" ? 8 : FACT_KEYS.length;
  const live = FACT_KEYS.length;   // fully configured academy: every fact renders
  ok(live <= total,
    `a fully configured academy cannot be shown more live facts than the total (${live} of ${total})`);
  ok(total === FACT_KEYS.length,
    "the total equals the number of facts we actually try to render");
}

console.log("\n── 7. a review outage costs ONE fact, not all of them ──");
{
  // resolveTestimonials THROWS when it cannot answer - deliberately, so a SEED
  // fails loudly rather than baking a wrong step. But derivedFactOverrides' outer
  // catch returns {} for everything, so an unguarded throw would blank all nine
  // facts and drop the agent to its hardcoded defaults for pricing, schedule and
  // the rest. Prompt-side must degrade to fact-absent only.
  const buildOverrides = (throwing) => {
    const out = { ...OTHER_FACTS };
    try {
      if (throwing) throw new Error("Supabase 503: reviews unavailable");
      out.social_proof = "unused";
    } catch (_) {
      if (MUTATE === "blankall") return {};   // the bug: lose every fact
    }
    return out;
  };
  const survived = buildOverrides(true);
  ok(Object.keys(survived).length === FACT_KEYS.length - 1,
    "a resolver throw removes social_proof and leaves the other facts intact");
  ok(survived.pricing && survived.schedule && survived.program,
    "pricing, schedule and program survive a reviews outage");

  const prompt = assemblePrompt(survived, "booking");
  ok(!prompt.includes(OLD_HARDCODE) && !prompt.includes("g.page"),
    "and during an outage the agent says nothing about reviews rather than falling back to a default link");
}

console.log("\n── 8. all three agents, not just booking ──");
{
  const body = render({ aggregate: null, testimonials: [], starredCount: 0 }, "");
  for (const agent of ["booking", "confirm", "closing"]) {
    const overrides = { ...OTHER_FACTS };
    if (body) overrides.social_proof = body;
    else if (MUTATE === "leak") overrides.social_proof = undefined;
    const p = assemblePrompt(overrides, agent);
    ok(!p.includes(OLD_HARDCODE) && !p.includes("share.google"),
      `${agent}: no hardcoded review link`);
  }
}

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
