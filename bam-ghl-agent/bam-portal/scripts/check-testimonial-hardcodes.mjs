#!/usr/bin/env node
// Fails when a hardcoded testimonial reappears anywhere testimonial content
// could ship from source instead of the store.
//
// WHY THIS EXISTS (2026-07-29): the failure mode of "every consumer pulls from
// the store" is a consumer that LOOKS converted - a page that renders from the
// resolver but quietly falls back to a hardcoded array, or a seed step that
// resolves to nothing and emits the old literal. Both pass a visual check.
// So the finish condition is THIS CHECK FAILING on regression, not a list a
// person ticks off. A claim that maintains itself, not one that was true when
// written.
//
// What it scans (source IS what ships for both):
//   - bam-client-sites client + template pages (in-browser Babel compiles
//     source directly, so a literal in source is a literal in production)
//   - bam-portal/api/email-templates + api/agent (prompt defaults)
//
// What fails the check, in either place:
//   A. Any KNOWN-FABRICATED string: the invented reviewer corpus (Marcus T. /
//      Priya S. / Dwayne R. cards and their quote text) and the fabricated
//      aggregate line "Average across Google reviews" as a source literal.
//   B. Any quote CURRENTLY IN THE STORE appearing verbatim in source: real
//      quotes reach output through the resolver at runtime, never by paste.
//
// Usage:
//   node scripts/check-testimonial-hardcodes.mjs [path-to-bam-client-sites]
// Store quotes are fetched live when SUPABASE env is present; without it the
// check still runs the fabricated-corpus half and says so (a degraded pass is
// reported as degraded, never as full).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// A. The fabricated corpus. Distinctive fragments, not full quotes, so a
// partial resurrection still trips it.
const FABRICATED = [
  "My son has grown so much in just a few months",
  "The CLA approach is the real deal",
  "Best basketball decision we made",
  "Marcus T.",
  "Priya S.",
  "Dwayne R.",
  "Average across Google reviews",
  // Miami's rewrites of the same three cards:
  "improved his footwork more in two months at DETAIL",
  "Left booking right away",
  "Carlos M.",
  "Denise W.",
  "Raymond T.",
];

// Files ALLOWED to carry these strings: this check itself, plus the academies
// Zoran explicitly ruled stay-as-is until their own real reviews connect
// (Miami and Supreme Hoops, both ruled 2026-07-29). Each exemption dies the
// day that academy's reviews are pulled through the skill.
const EXEMPT = [
  /scripts\/check-testimonial-hardcodes\.mjs$/,
  /clients\/detail-miami\//,
  /clients\/supreme-hoops-training\//,
];

const SCAN_EXT = new Set([".jsx", ".js", ".mjs", ".html", ".css", ".md", ".json"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".claude") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (SCAN_EXT.has(p.slice(p.lastIndexOf(".")))) yield p;
  }
}

async function storeQuotes() {
  if (!SB_URL || !SB_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/testimonials?select=quote,author`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} - cannot fetch store; failing rather than passing blind`);
  const rows = await r.json();
  // First 60 chars of each quote is distinctive enough and survives reflowing.
  return rows.map((row) => ({ frag: row.quote.slice(0, 60), author: row.author }));
}

const siteRepo = process.argv[2] || `${process.env.HOME}/bam-client-sites`;
const roots = [
  ...(existsSync(siteRepo) ? [join(siteRepo, "clients"), join(siteRepo, "templates")] : []),
  new URL("../api/email-templates", import.meta.url).pathname,
  new URL("../api/agent", import.meta.url).pathname,
].filter(existsSync);

if (!roots.length) { console.error("nothing to scan - bad path?"); process.exit(2); }

const store = await storeQuotes();
const failures = [];

// Every exemption silently removes real coverage: a green with five exemptions
// is not the same green as one with none, so the count is printed on EVERY
// run, pass or fail. Two are ruled (Miami, Supreme Hoops); a third+ should be
// read as an alarm, not an entry.
const namedExemptions = EXEMPT.filter((re) => !re.test("scripts/check-testimonial-hardcodes.mjs"));
const exemptionNote = `${namedExemptions.length} active exemption(s): ${namedExemptions.map((re) => re.source.replace(/\\\//g, "/").replace(/^clients\//, "").replace(/\/$/, "")).join(", ") || "none"}`;
if (namedExemptions.length > 2) {
  console.error(`⚠️ ALARM: ${exemptionNote} - more than the two Zoran ruled. Every entry removes coverage; justify or delete.`);
}

for (const root of roots) {
  for (const file of walk(root)) {
    if (EXEMPT.some((re) => re.test(file))) continue;
    const text = readFileSync(file, "utf8");
    for (const frag of FABRICATED) {
      if (text.includes(frag)) failures.push({ file, kind: "fabricated", frag });
    }
    for (const q of store || []) {
      if (text.includes(q.frag)) failures.push({ file, kind: "store-quote-in-source", frag: `${q.author}: ${q.frag}…` });
    }
  }
}

// ── CHECK 2: THE BYPASS RATCHET ────────────────────────────────────────────
// The corpus half only catches strings we already know. This half catches the
// shape: a surface that renders testimonial content WITHOUT going through the
// resolver. That is what makes a fifth consumer safe by construction - a new
// page with freshly invented quotes fails here even though no corpus could
// know its text. (Supreme Hoops was exactly that: novel invention, invisible
// to a corpus.)
//
// Baseline may only SHRINK. A file not in it must reference the seam.
const SHAPE = [/tstcard/i, /testimonial/i, /ft-tst/i, /tst__/i, /review-card/i, /reviewcard/i];
const SEAM = [/api\/website\/testimonials/, /resolveTestimonials/];
const BASELINE_FILE = new URL("./testimonial-bypass-baseline.txt", import.meta.url).pathname;

const baseline = new Set(
  existsSync(BASELINE_FILE)
    ? readFileSync(BASELINE_FILE, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : []
);

// Only files that can RENDER content can bypass the seam. A .css defining
// .tstcard styles, a NOTES.md, or a vercel.json mentioning the word cannot
// hardcode a quote into output - including them produced 11 false positives on
// the first run. The fix is scoping the detector, NOT padding the baseline:
// a baseline entry added to silence a check is how a check becomes decorative.
const RENDER_EXT = new Set([".jsx", ".js", ".html"]);

const newBypasses = [];
const nowConverted = [];
if (existsSync(siteRepo)) {
  for (const root of [join(siteRepo, "clients"), join(siteRepo, "templates"), join(siteRepo, "brands")].filter(existsSync)) {
    for (const file of walk(root)) {
      if (!RENDER_EXT.has(file.slice(file.lastIndexOf(".")))) continue;
      const rel = file.slice(siteRepo.length + 1);
      const text = readFileSync(file, "utf8");
      if (!SHAPE.some((re) => re.test(text))) continue;
      const usesSeam = SEAM.some((re) => re.test(text));
      if (usesSeam && baseline.has(rel)) nowConverted.push(rel);
      if (!usesSeam && !baseline.has(rel)) newBypasses.push(rel);
    }
  }
}

if (nowConverted.length) {
  console.log(
    `↓ ${nowConverted.length} baseline entr(y/ies) now use the resolver - delete them from ` +
    `scripts/testimonial-bypass-baseline.txt:\n${nowConverted.map((f) => "    " + f).join("\n")}`
  );
}

if (failures.length || newBypasses.length) {
  console.error(`(${exemptionNote})`);
}
if (failures.length) {
  console.error(`FAIL - ${failures.length} hardcoded testimonial string(s) in source:\n`);
  for (const f of failures) {
    console.error(`  [${f.kind}] ${relative(process.cwd(), f.file)}\n      "${f.frag}"`);
  }
}
if (newBypasses.length) {
  console.error(
    `\nFAIL - ${newBypasses.length} surface(s) render testimonial content WITHOUT the resolver ` +
    `and are not in the baseline:\n${newBypasses.map((f) => "    " + f).join("\n")}\n\n` +
    `  Read testimonials from /api/website/testimonials (outside the monorepo) or\n` +
    `  resolveTestimonials() (inside it). Do NOT add a baseline entry to silence this:\n` +
    `  the baseline is a record of legacy debt and may only shrink.`
  );
}
if (failures.length || newBypasses.length) process.exit(1);

const corpusLine = store
  ? `fabricated corpus (${FABRICATED.length} fragments) + ${store.length} store quotes: none in source`
  : `fabricated corpus clean (DEGRADED - no Supabase env, store-quote half NOT checked)`;
console.log(
  `PASS - ${corpusLine}; no new resolver bypasses ` +
  `(${baseline.size} legacy surface(s) still in the baseline). ` +
  `(${exemptionNote})`
);
