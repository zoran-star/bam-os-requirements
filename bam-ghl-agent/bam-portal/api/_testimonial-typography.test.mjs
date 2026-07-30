// A real parent typed an em dash into a Google review, and that review now
// ships on a free-trial page and inside the nurture-3 email. This suite is the
// proof that the character is gone from what a parent receives while the
// parent's WORDS are untouched, and that the stored row was never edited.
//
// WHAT IT RENDERS. Nothing here is hand-written prose about the behaviour: it
// resolves BAM San Jose and BAM GTA through the REAL api/_testimonials.js, feeds
// the result through the REAL renderEmail (nurture-3 and onboarding-testimonials)
// and the REAL api/website/testimonials.js handler, and inspects THAT. The repo
// rule is that literal-grep leak audits give false answers; render the output
// and check the output.
//
// THE FIXTURE IS A PRODUCTION SNAPSHOT (api/_testimonial-typography.fixture.json,
// verified byte-exact against prod by md5 on 2026-07-30). It carries the three
// real quotes that contain an em dash. Do NOT tidy it - a cleaned fixture makes
// this suite pass for the wrong reason.
//
//   node api/_testimonial-typography.test.mjs
//
//   MUTATE=nodash     the substitution is not applied at all
//   MUTATE=tightjam   the dash becomes a bare hyphen, gluing two words together
//   MUTATE=blunt      a careless filter that also eats ASCII hyphens
//   MUTATE=dropword   a regex that swallows the word after the dash
//   MUTATE=scrubstore the render path "helpfully" cleans the stored row too
//
// Each control is a plausible WRONG implementation of the same idea, applied to
// the raw stored text in place of the real normaliser, so the assertions judge
// the same downstream output either way. A control counts as caught ONLY if this
// file prints NEGATIVE CONTROL PASSED.
import fs from "node:fs";

const MUTATE = process.env.MUTATE || "";
let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// The banned characters, as escapes: the literals must not appear in this repo's
// source, and this file is the one place that has to name them.
const EM = "\u2014", EN = "\u2013";
const LONG_DASHES = ["\u2012", EN, EM, "\u2015"];
const hasLongDash = (s) => LONG_DASHES.some((d) => String(s).includes(d));

// Env before import: both modules read Supabase config at module scope.
process.env.SUPABASE_URL = "https://fixture.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-key";

const { resolveTestimonials, normalizeTypography } = await import("./_testimonials.js");
const { renderEmail } = await import("./email-shells.js");
const websiteTestimonials = (await import("./website/testimonials.js")).default;

const FX = JSON.parse(fs.readFileSync(new URL("./_testimonial-typography.fixture.json", import.meta.url), "utf8"));
const SJ = FX.clients.bam_san_jose;
const GTA = FX.clients.bam_gta;
// STORE is what the code under test reads. ARCHIVE is a deep copy taken before
// anything ran, and is never handed to any of it - it is the only thing in this
// process that can still answer "what did the parent actually type".
const STORE = FX.testimonials;
const ARCHIVE = JSON.parse(JSON.stringify(FX.testimonials));
const rowsFor = (id) => STORE.filter((r) => r.client_id === id);
const rawQuoteByAuthor = new Map(ARCHIVE.map((r) => [r.author, r.quote]));

// ── how a wrong implementation would look ───────────────────────────────────
const BROKEN = {
  nodash: (s) => String(s),
  tightjam: (s) => String(s).replace(/[\u2012\u2013\u2014\u2015]/g, "-"),
  // "just get rid of dashes" - takes the ASCII hyphen with it.
  blunt: (s) => String(s).replace(/[\u2012\u2013\u2014\u2015-]/g, " "),
  // a greedy regex: the dash and whatever followed it.
  dropword: (s) => String(s).replace(/[ \t]*[\u2012\u2013\u2014\u2015][ \t]*\S+/g, " - "),
  scrubstore: (s) => normalizeTypography(s),
};

// Model the mutation on the resolver's OWN output: same rows, same order, but
// the display text is what the wrong normaliser would have produced from the
// stored quote. Under scrubstore the text is correct and the STORE is written to
// instead, which is the failure that control exists to model.
function mutated(resolved) {
  if (!MUTATE) return resolved;
  const broken = BROKEN[MUTATE];
  if (MUTATE === "scrubstore") {
    for (const row of STORE) row.quote = normalizeTypography(row.quote);
    return resolved;
  }
  return {
    ...resolved,
    testimonials: resolved.testimonials.map((t) => ({
      ...t,
      quote: broken(rawQuoteByAuthor.has(t.author) ? rawQuoteByAuthor.get(t.author) : t.quote),
      author: broken(t.author),
    })),
  };
}

function reader(id) {
  return (path) => {
    if (path.startsWith("clients?")) return Promise.resolve([{ google_rating: "4.9", google_review_count: 67, google_rating_checked_at: "2026-07-29" }]);
    if (path.startsWith("testimonials?")) return Promise.resolve(rowsFor(id));
    return Promise.resolve([]);
  };
}

async function resolved(id) {
  return mutated(await resolveTestimonials(id, reader(id)));
}

// ── words, not characters ───────────────────────────────────────────────────
// The whole defence of editing a customer's sentence is that the edit CANNOT
// touch a word. So every check below compares WORD SEQUENCES: runs of letters,
// digits and apostrophes, in order. A dash - long or short - is not a word
// character, so it drops out of both sides and only a real change shows up.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', middot: "\u00b7", nbsp: " ", "#39": "'" };
const decode = (s) => String(s).replace(/&(#?\w+);/g, (m, k) => (k in ENTITIES ? ENTITIES[k] : m));
const plain = (html) => decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const words = (s) => String(s).match(/[A-Za-z0-9']+/g) || [];
const sameWords = (a, b) => {
  const x = words(a), y = words(b);
  return x.length === y.length && x.every((w, i) => w === y[i]);
};
// Is the stored quote's word sequence present, in order and unbroken, in the
// rendered page? Contiguity is the point: a dropped or reordered word breaks it.
function containsWordRun(haystack, needle) {
  const H = words(haystack), N = words(needle);
  if (!N.length) return false;
  outer: for (let i = 0; i + N.length <= H.length; i++) {
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) continue outer;
    return true;
  }
  return false;
}

// ═══ 1. the substitution itself ═════════════════════════════════════════════
console.log("\n── 1. typography only, never words ──");
{
  ok(normalizeTypography("a trainer" + EM + "he's a mentor") === "a trainer - he's a mentor",
    "a closed-up em dash becomes a spaced hyphen, so two words do not glue together");
  ok(normalizeTypography("a trainer " + EM + " he's") === "a trainer - he's",
    "an already-spaced em dash does not double its spaces");
  ok(normalizeTypography("ages 6" + EN + "8") === "ages 6-8",
    "an en dash between digits is a range, so it keeps the tight hyphen");
  for (const untouched of ["game-changer", "10-15 minutes", "son's", "one-size-fits-all", "energy & happiness", "high schoolers"]) {
    ok(normalizeTypography(untouched) === untouched, `left exactly alone: "${untouched}"`);
  }
  ok(normalizeTypography(null) === "" && normalizeTypography(undefined) === "",
    "a missing value is still the empty string, so the author fallback still fires");

  let allWordsKept = true, changed = 0;
  for (const row of ARCHIVE) {
    if (!sameWords(normalizeTypography(row.quote), row.quote)) allWordsKept = false;
    if (normalizeTypography(row.quote) !== row.quote) changed++;
  }
  ok(allWordsKept, `every one of the ${ARCHIVE.length} stored quotes keeps its exact word sequence`);
  ok(changed === 3, `exactly the 3 quotes that contain a long dash are changed at all (saw ${changed})`);
}

// ═══ 2. the emails a parent receives ════════════════════════════════════════
console.log("\n── 2. nurture-3 and onboarding-testimonials, rendered ──");
{
  for (const [label, id] of [["San Jose", SJ], ["BAM GTA", GTA]]) {
    const r = await resolved(id);
    for (const key of ["nurture-3", "onboarding-testimonials"]) {
      const html = renderEmail({
        clientId: id,
        subject: key,
        body: `template:${key}`,
        vars: { first_name: "Alex", athlete: "Jordan", location_testimonials: r.testimonials },
      });
      const text = plain(html);
      ok(!hasLongDash(html), `${label} ${key}: no em/en dash anywhere in the rendered email`);
      const stored = rowsFor(id).length;
      ok((html.match(/font-style:italic;">"/g) || []).length === stored,
        `${label} ${key}: all ${stored} quotes rendered`);
      let intact = 0;
      for (const row of ARCHIVE.filter((x) => x.client_id === id)) {
        if (containsWordRun(text, row.quote)) intact++;
      }
      ok(intact === stored,
        `${label} ${key}: every quote's words survive in order, unbroken (${intact}/${stored})`);
    }
  }
}

// ═══ 3. it reads naturally, not jammed together ═════════════════════════════
console.log("\n── 3. the seam where the dash was ──");
{
  // Written out by hand from the four real occurrences, NOT derived from the
  // function, so the expectation is independent of the implementation.
  const EXPECTED = [
    [SJ, "more than a trainer - he's a mentor"],
    [GTA, "shoutout to Adrian - my kid always enjoyed"],
    [GTA, "full of ideas - and what really impressed"],
    [GTA, "so energized - but honestly"],
  ];
  for (const [id, phrase] of EXPECTED) {
    const r = await resolved(id);
    const text = plain(renderEmail({
      clientId: id, subject: "nurture-3", body: "template:nurture-3",
      vars: { first_name: "Alex", location_testimonials: r.testimonials },
    }));
    ok(text.includes(phrase), `reads as written: "${phrase}"`);
  }
}

// ═══ 4. the website payload ═════════════════════════════════════════════════
console.log("\n── 4. GET /api/website/testimonials ──");
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const s = String(u);
    const id = s.includes(SJ) ? SJ : GTA;
    const data = s.includes("allowed_domains")
      ? [{ allowed_domains: ["byanymeanssanjose.com"] }]
      : s.includes("/testimonials?") ? rowsFor(id)
      : [{ google_rating: "4.9", google_review_count: 67, google_rating_checked_at: "2026-07-29" }];
    return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
  };
  for (const [label, id] of [["San Jose", SJ], ["BAM GTA", GTA]]) {
    let payload = null, status = 0;
    const res = {
      setHeader() {}, status(c) { status = c; return this; },
      json(v) { payload = v; return this; }, end() { return this; },
    };
    await websiteTestimonials(
      { method: "GET", url: "/api/website/testimonials", headers: { origin: "http://localhost:3000" }, query: { client_id: id } },
      res
    );
    const rows = mutated({ testimonials: (payload && payload.testimonials) || [] }).testimonials;
    ok(status === 200 && rows.length === rowsFor(id).length, `${label}: 200 with ${rowsFor(id).length} rows`);
    ok(!hasLongDash(JSON.stringify(rows)), `${label}: no em/en dash in the payload the website renders`);
    let exact = 0;
    for (const row of rows) {
      const stored = rawQuoteByAuthor.get(row.author);
      if (stored && sameWords(row.quote, stored)) exact++;
    }
    ok(exact === rows.length, `${label}: every payload quote is word-for-word the stored quote (${exact}/${rows.length})`);
  }
  globalThis.fetch = realFetch;
}

// ═══ 5. not a blunt filter ══════════════════════════════════════════════════
console.log("\n── 5. hyphens, apostrophes and ranges come through unharmed ──");
{
  const r = await resolved(SJ);
  const joined = r.testimonials.map((t) => t.quote).join("\n");
  for (const keep of ["10-15 minutes", "game-changer", "college-level", "son's", "it's", "players'"]) {
    ok(joined.includes(keep), `San Jose's quotes still contain "${keep}"`);
  }
  const authors = r.testimonials.map((t) => t.author);
  ok(authors.includes("Christy Hang-Munoz"), "a hyphenated surname is not rewritten");
}

// ═══ 6. the stored row is never touched ═════════════════════════════════════
console.log("\n── 6. the record stays faithful ──");
{
  let drifted = [];
  for (let i = 0; i < ARCHIVE.length; i++) {
    if (STORE[i].quote !== ARCHIVE[i].quote) drifted.push(ARCHIVE[i].author);
    if (STORE[i].author !== ARCHIVE[i].author) drifted.push(ARCHIVE[i].author + " (author)");
  }
  ok(drifted.length === 0,
    `nothing in the render path wrote back to a stored row${drifted.length ? ": " + drifted.join(", ") : ""}`);
  ok(STORE.filter((r) => r.quote.includes(EM)).length === 3,
    "the store still holds all 3 em dashes the parents typed");
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
