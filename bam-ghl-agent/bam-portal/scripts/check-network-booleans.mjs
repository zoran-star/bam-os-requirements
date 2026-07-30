// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-network-booleans.mjs - a yes/no answer that crossed a network
// boundary must have THREE outcomes, not two.
//
//     yes  ·  no, and here is why  ·  we could not ask
//
// Never let "no" and "could not ask" collapse into the same value.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS GATE EXISTS, AND WHY IT IS A GATE AND NOT A RULE.
//
// The rule already existed. It was written down as the testimonials resolver
// contract - "can a caller tell 'this academy has no testimonials' apart from
// 'the resolver could not answer'?" - because collapsing those two turns an
// approved product decision into an outage that presents as a feature. Nobody
// connected it to the next place the shape appeared, which is the entire
// problem: a rule written in one file does not travel to the next file.
//
// The next place it appeared was api/stripe/connect.js. canCharge() fetched the
// whole Stripe account and returned `a.charges_enabled === true`, with
// `if (!r.ok) return false` and a catch returning false. A network blip, an
// expired platform key and a genuinely unfinished Stripe account all produced
// the same `false`, the same stored stripe_connect_status, and the same sentence
// shown to an academy owner: "finish the remaining steps in Stripe". A function
// that had just discarded WHICH steps told a human to go finish them.
//
// This repo's own recorded lesson from the hour12 and testimonial work is that a
// comment is not a gate, and an enforced inventory beats a comment. So: convert
// "this is the only one" into a check that FAILS when a new one appears.
//
// ── WHAT IT LOOKS FOR ────────────────────────────────────────────────────────
//
// A function that (a) crosses a network boundary and (b) can return a bare
// boolean literal. Both halves matter:
//
//   (a) "crosses a network boundary" is NOT just a literal `fetch(` in the body.
//       Most of api/ reaches the network through a wrapper - sb(), sbRest(),
//       ghl(), stripeGet(). A `fetch`-only scan found 6 functions; following the
//       call graph found 29, and the 23 it had missed included every single
//       Supabase-backed predicate in the agent stack. So this builds a call
//       graph over api/, seeds it with the functions that so much as NAME fetch,
//       and propagates through module-local calls and relative imports until it
//       stops growing. Naming rather than calling matters: see TOUCHES_FETCH,
//       where a seed of `fetch(` left an injected-fetch collapse invisible.
//
//   (b) "a bare boolean literal" - `return false;` / `return true;` - is the
//       collapse itself. It is what the ERROR path returns. A function whose only
//       boolean is a genuine data answer (`return rows.length > 0`) and whose
//       transport failure THROWS has three outcomes already: yes, no, and an
//       exception the caller must handle. api/website/checkout.js's
//       signupFeeAppliesTo is in the inventory as exactly that: NO-COLLAPSE.
//
// The strongest tell in practice is a function whose NAME asks a question -
// canCharge, isStaff, hasActiveMailbox, isAutomationLive - whose body reaches the
// network. The name promises an answer about the world; the body can only ever
// promise an answer about our ability to reach it. Question-named hits are
// tagged "<- question-named" when reported, but the NAME IS NOT THE TRIGGER: a
// question-named function that returns a three-outcome object is already
// obeying the rule, and leadRepliedLiveGHL collapses just as hard without ever
// asking a question in its name.
//
// ── WHAT IT DOES WITH THEM ───────────────────────────────────────────────────
//
// Every hit must appear in scripts/network-boolean-inventory.txt with a VERDICT
// and a reason. The check fails when:
//
//   * a hit is not in the inventory        -> a new unaudited collapse shipped
//   * an inventory entry matches no hit    -> stale; delete the line
//   * an entry has no reason, or a stub    -> a rubber stamp, which is worse
//                                             than no entry at all
//
// Stale entries FAIL on purpose. When somebody fixes an instance - gives it the
// third outcome - its line must be deleted in the SAME pull request. That is the
// only thing that keeps the printed counts honest; an inventory that keeps lines
// for code that no longer exists is the "trusted because it exists" failure this
// repo has already paid for twice.
//
// The counts print on EVERY run, green or not. A green run carrying HARMFUL
// entries is not the same green as one carrying none, and a check that hides
// that difference is telling a comfortable lie. The numbers are deliberately not
// repeated in this comment: a count maintained by hand in prose is wrong the
// first time somebody forgets, and then quoted for a year. Run it to see them.
//
// ── WHAT THIS DOES NOT CATCH (stated so nobody quotes it as more than it is) ──
//
//   * Scope is api/ only. The browser half (src/) fetches too and is not scanned.
//   * A collapse into a non-literal - `return !!x`, or a `let ok = false` that a
//     swallowed catch leaves false - is invisible here. api/website/availability
//     .js's setCors is in the inventory only because it ALSO returns a literal.
//   * The call graph follows named module-level functions through relative
//     imports. It does not follow values through objects, arrays or re-exports,
//     so a network call reached only that way is not seen.
//   * It cannot tell a good verdict from a lazy one. That is review's job. What
//     it CAN do is refuse an empty one, and force a new instance to be argued.
//   * The blank() self-test below proves the scanner is not DESYNCED. It does not
//     prove the scanner is not OVER-blanking, and those are different: erasing a
//     brace-balanced region leaves the balance intact. This is measured, not
//     assumed. Diffing blank() before and after the two fixes over all 251 files,
//     236 changed and only 6 of them were brace-unbalanced; the other 230 were the
//     old version wrongly erasing `${...}` interpolation CODE, which the balance
//     check is structurally incapable of seeing. The hit count did not move, so
//     nothing was hiding in an interpolation on this tree - today.
//     The obvious stronger invariant, "every line-anchored `function NAME` must
//     survive blanking", was built and measured before being rejected: 1874
//     declarations, one violation, and that violation is CORRECT - api/ghl/
//     all-pipelines.js:131 declares a browser-side saveNote inside an HTML
//     template literal, so blanking it is right. An invariant that needs an
//     exemption on its first run is a gate that gets switched off, which this
//     repo has already paid for. Left out deliberately, recorded here instead.
//
// ── RUN IT ───────────────────────────────────────────────────────────────────
//
//   node scripts/check-network-booleans.mjs        (from bam-ghl-agent/bam-portal)
//
// The negative controls. Each plants a REAL mutation and requires this check to
// notice; a control counts as caught ONLY when the run PRINTS the banner, because
// a non-zero exit also happens when a mutation matches nothing at all. One per
// line. scripts/verify-live-pages.mjs and verify-testimonial-seed-drift.mjs each
// declare their controls as one pipe-separated MUTATE= line, so a grep that stops
// at the first token finds only the first control and the rest have never run.
// Neither prints the banner either. Both routes to this file's list agree; the
// workflow uses the MUT map because prose is the half that rots:
//
//   MUTATE=newoffender   plants a new unaudited direct-fetch collapse
//   MUTATE=indirect      plants one that reaches the network ONLY via an import
//   MUTATE=compliant     plants a three-outcome function; must stay SILENT
//   MUTATE=stale         plants an inventory line for a function that is gone
//   MUTATE=stub          plants a rubber-stamp entry with no real reason
//   MUTATE=injected      plants one reached through an INJECTED fetch impl
//   MUTATE=nestedtemplate  hides a collapse behind the two constructs that
//                          really did desync this scanner
//
// Each was checked against a real weakening of THIS FILE before it was wired
// into CI, because a control that cannot fail is decoration. Killing the call
// graph fails `indirect` (and turns 23 live entries stale); breaking the boolean
// regex fails `newoffender`; deleting the stale rule fails `stale`; setting
// MIN_REASON to 0 fails `stub`; narrowing the seed back to `fetch(` fails
// `injected`, which is not hypothetical - that WAS the seed, and it was blind.
// Flattening template scanning, or reverting regex detection to the last
// character, fails the blank() self-test on the REAL tree (5 and 1 files
// respectively) before `nestedtemplate` even runs - both were real bugs here.
//
// The MUT map below is the source of truth for that list. CI reads the map, not
// this prose, for exactly the reason above.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const PORTAL = path.resolve(path.dirname(SELF), "..");
const API = path.join(PORTAL, "api");
const INVENTORY = path.join(PORTAL, "scripts", "network-boolean-inventory.txt");

const MUTATE = process.env.MUTATE || "";

// ── The negative controls. THIS MAP IS THE SOURCE OF TRUTH for what exists. ──
// Keyed exactly like verify-bb-hydration.mjs's MUT map so the workflow can read
// the keys out of the file instead of trusting a prose line to stay in sync.
const MUT = {
  newoffender: "plant a brand-new unaudited collapse that calls fetch directly",
  indirect: "plant one whose only network reach is an imported helper",
  compliant: "plant a three-outcome function - the check must NOT flag it",
  stale: "plant an inventory line whose function does not exist",
  stub: "plant a rubber-stamp entry - a verdict with no real reason",
  injected: "plant one that reaches the network through an INJECTED fetch",
  nestedtemplate: "hide a collapse BEHIND a nested template literal and a keyword-regex",
};

// ─────────────────────────────────────────────────────────────────────────────
// Source reading
// ─────────────────────────────────────────────────────────────────────────────

const EXTS = new Set([".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".vercel", ".git", "coverage",
  "__fixtures__", "__goldens__", "snapshots",
]);
// Test files are not scanned. Not an exemption: a test's whole job can be to
// WRITE the offending shape (that is how the controls below work), and a scanner
// that cannot tell a fixture from production would be red forever and then off.
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

function* walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(full); }
    else if (EXTS.has(path.extname(e.name)) && !isTest(e.name)) yield full;
  }
}

// Blank out comments and string/template/regex literals, preserving offsets and
// newlines so line numbers and brace matching stay true. Without this, a `fetch(`
// inside a doc comment or an error message makes a pure function look networky.
//
// A template literal's ${...} holds CODE, and that code can hold another
// template literal. That is not a hypothetical: api/contacts.js:250 is
//
//     path += `&tags=cs.${encodeURIComponent(`{"${tag.replace(/"/g, "")}"}`)}`;
//
// A flat scanner that ends a backtick string at "the next backtick" ends this
// one INSIDE the interpolation, then reads the remaining `{"` as live code. The
// brace never closes, every scope after it in the file is off by one, and
// functions below get mis-attributed or dropped - a SILENT under-report, which
// is the same failure this whole gate exists to catch. Six of 251 api/ files
// were desynced this way. Found by asserting brace balance over the real tree,
// not by reading the code, and the assertion is now a permanent control
// (MUTATE=nestedtemplate).
//
// So code and template scanning are mutually recursive: a template blanks its
// literal chunks and hands each ${...} back to the code scanner, which blanks
// comments and strings inside it and returns at the matching brace.
export function blank(src) {
  const out = src.split("");
  const n = src.length;
  const kill = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " "; };

  // Is the `/` at idx the start of a regex literal, or a division sign? Deciding
  // this on the last non-space CHARACTER is not enough, and that cost a whole
  // file: api/store/inventory.js:88 is
  //
  //     return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
  //
  // where the last character before the slash is `n`, so the regex went
  // undetected, the `"` inside its character class opened a phantom string, and
  // everything from there to the next quote LATER IN THE FILE was blanked away -
  // functions and all. A regex is legal after these keywords, so look back at the
  // whole word, not one letter.
  const REGEX_OK_AFTER = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
  ]);
  function regexAllowedAt(idx) {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;                                   // start of file
    const ch = src[j];
    if (/[=(,:[!&|?{};+\-*%<>~^]/.test(ch)) return true;      // after an operator
    if (/[A-Za-z0-9_$]/.test(ch)) {                           // after a word
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
      return REGEX_OK_AFTER.has(src.slice(k + 1, j + 1));
    }
    return false;   // after ) ] ` or a quote: division, not a regex
  }

  // src[start] is the opening backtick. Returns the index just past the close.
  function scanTemplate(start) {
    let j = start + 1;
    let chunk = j;                       // start of the current literal run
    while (j < n) {
      const ch = src[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === "`") { kill(chunk, j); return j + 1; }
      if (ch === "$" && src[j + 1] === "{") {
        kill(chunk, j);                  // blank the literal text before the hole
        j = scanCode(j + 2, true);       // the hole is code, so scan it as code
        chunk = j;
        continue;
      }
      j++;
    }
    kill(chunk, n);                      // unterminated template; blank the rest
    return n;
  }

  // Scans code from `start`. When `untilCloseBrace`, stops after the brace that
  // closes the interpolation it was called for, and returns that index.
  function scanCode(start, untilCloseBrace) {
    let i = start, depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      // Braces are counted BEFORE anything else, but only ever on a brace
      // character - comments, strings and templates are consumed whole below, so
      // a `}` inside one is never seen here.
      if (untilCloseBrace) {
        if (c === "{") depth++;
        else if (c === "}") { if (depth === 0) return i + 1; depth--; }
      }
      if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; kill(i, j); i = j; continue; }
      if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; kill(i, j); i = j; continue; }
      if (c === "`") { i = scanTemplate(i); continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
        kill(i + 1, j); i = j + 1; continue;
      }
      if (c === "/" && regexAllowedAt(i)) {
        let j = i + 1, closed = false, inClass = false;
        while (j < n) {
          const ch = src[j];
          if (ch === "\\") { j += 2; continue; }
          if (ch === "\n") break;
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) { kill(i + 1, j); i = j + 1; continue; }
      }
      i++;
    }
    return n;
  }

  scanCode(0, false);
  return out.join("");
}

// Words that can sit in front of `(...) {` without it being a function.
const NOT_A_FUNCTION = new Set(["if", "for", "while", "switch", "catch", "with", "do", "else", "return", "typeof", "await", "case"]);

function matchBack(code, closeIdx) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function identBefore(code, openParen) {
  let j = openParen - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(code[j])) j--;
  return code.slice(j + 1, end) || null;
}

// `const foo = async () => {`, `const foo = (async () => {`, `foo: async () => {`,
// `const foo = async function () {`. Named so an inventory entry can point at it;
// an entry keyed on a line number would churn on every unrelated edit above it.
function nameFromAssignment(code, brace) {
  const before = code.slice(Math.max(0, brace - 300), brace);
  const pats = [
    /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*\(?\s*(?:async\s*)?(?:function\s*[A-Za-z0-9_$]*\s*)?\([^()]*\)\s*(?:=>\s*)?$/,
    /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s+)?[A-Za-z0-9_$]+\s*=>\s*$/,
    /([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?(?:function\s*)?\([^()]*\)\s*(?:=>\s*)?$/,
  ];
  for (const p of pats) { const m = before.match(p); if (m) return m[1]; }
  return null;
}

function functionsIn(code) {
  const found = [];
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") {
      stack.push(headerAt(code, i));
      const top = stack[stack.length - 1];
      if (top) top.start = i;
    } else if (c === "}") {
      const f = stack.pop();
      if (f) found.push({ ...f, end: i });
    }
  }
  return found
    .map((f) => ({ ...f, name: f.name || nameFromAssignment(code, f.start) || "<anonymous>" }))
    .sort((a, b) => a.start - b.start);

  function headerAt(src, brace) {
    let j = brace - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return null;
    if (src[j] === ">" && src[j - 1] === "=") return { name: null };       // arrow
    if (src[j] !== ")") return null;
    const open = matchBack(src, j);
    if (open < 0) return null;
    const id = identBefore(src, open);
    if (!id || NOT_A_FUNCTION.has(id)) return null;
    return { name: id === "function" ? null : id };                        // fn / method
  }
}

// A function's OWN text: its body minus the bodies of the functions nested in it.
// This is what makes attribution correct - a `return false` inside a .filter()
// callback belongs to the callback, not to the fetching function around it.
function ownText(code, fn, all) {
  const inside = all.filter((o) => o !== fn && o.start > fn.start && o.end < fn.end);
  const direct = inside.filter((c) => !inside.some((p) => p !== c && p.start < c.start && p.end > c.end));
  let out = "", cur = fn.start;
  for (const c of direct.sort((a, b) => a.start - b.start)) { out += code.slice(cur, c.start); cur = c.end + 1; }
  return out + code.slice(cur, fn.end + 1);
}

function parseImports(raw, file, resolveFrom) {
  const imports = new Map();
  for (const m of raw.matchAll(/import\s+\{([^}]*)\}\s+from\s+["'](\.[^"']+)["']/g)) {
    const target = resolveFrom(file, m[2]);
    if (!target) continue;
    for (const piece of m[1].split(",")) {
      const p = piece.trim();
      if (!p) continue;
      const [orig, alias] = p.split(/\s+as\s+/).map((x) => x.trim());
      imports.set(alias || orig, { file: target, name: orig });
    }
  }
  for (const m of raw.matchAll(/import\s+([A-Za-z0-9_$]+)\s+from\s+["'](\.[^"']+)["']/g)) {
    const target = resolveFrom(file, m[2]);
    if (target) imports.set(m[1], { file: target, name: "default" });
  }
  return imports;
}

function resolveRelative(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, "index.js")]) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep looking */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DETECTOR. One function, used on the real tree and on every planted
// mutation, so a control cannot pass by exercising something the real scan does
// not. `extra` is a map of absolute path -> source, which is how the controls
// plant a file without writing to disk.
// ─────────────────────────────────────────────────────────────────────────────

const QUESTION_NAME = /^(can|is|has|have|should|does|do|are|was|were|check|must|will|may)([A-Z_]|$)/;
const BOOL_RETURN = /\breturn\s+(?:true|false)\s*(?=[;}\n]|$)/g;
// The word `fetch`, NOT `fetch(`. That distinction is the whole of a real hole
// this gate had on its first day. api/stripe/_requirements.js does
//
//     const doFetch = opts.fetchImpl || globalThis.fetch;
//     r = await doFetch(url, ...)
//
// which is the ordinary way to make a network call injectable for tests. A seed
// of /\bfetch\s*\(/ never matches it: `globalThis.fetch` has no paren after it,
// and `doFetch(` fails the word boundary. So a canCharge-shaped collapse written
// in that style was scanned and passed in SILENCE - the exact bug this gate
// exists to catch, invisible to the gate. Found by planting one, not by reading
// the regex; MUTATE=injected keeps it found. Widening to the bare word costs
// nothing: it is matched against comment- and string-blanked source, and it
// added zero hits on the real tree. `fetchImpl`, `doFetch` and `prefetch` do not
// match, which is correct - naming a variable after fetch is not making a call.
const TOUCHES_FETCH = /\bfetch\b/;

export function scan(sources) {
  const mods = new Map();
  for (const [file, raw] of sources) {
    const code = blank(raw);
    const fns = functionsIn(code);
    for (const fn of fns) {
      fn.own = ownText(code, fn, fns);
      fn.topLevel = !fns.some((o) => o !== fn && o.start < fn.start && o.end > fn.end);
    }
    const top = new Map();
    for (const fn of fns) if (fn.topLevel && fn.name !== "<anonymous>" && !top.has(fn.name)) top.set(fn.name, fn);
    mods.set(file, { code, fns, top, imports: parseImports(raw, file, resolveRelative) });
  }

  const key = (f, n) => `${f}::${n}`;

  // Callees of a body: bare identifier calls only. `x.has(y)` must NOT count as
  // a call to a module function named `has` - that alone made a pure Set-membership
  // predicate look networky on the first run of this detector.
  const calleesOf = (file, body) => {
    const m = mods.get(file);
    const out = [];
    for (const c of body.matchAll(/(^|[^.\w$])([A-Za-z0-9_$]+)\s*\(/g)) {
      const n = c[2];
      if (NOT_A_FUNCTION.has(n) || n === "function") continue;
      if (m.top.has(n)) out.push(key(file, n));
      else if (m.imports.has(n)) { const im = m.imports.get(n); out.push(key(im.file, im.name)); }
    }
    return out;
  };

  // Seed with literal fetch, then close over the call graph.
  const networky = new Set();
  for (const [file, m] of mods) for (const [n, fn] of m.top) if (TOUCHES_FETCH.test(fn.own)) networky.add(key(file, n));
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (const [file, m] of mods) for (const [n, fn] of m.top) {
      if (networky.has(key(file, n))) continue;
      if (calleesOf(file, fn.own).some((k) => networky.has(k))) { networky.add(key(file, n)); changed = true; }
    }
  }

  const hits = [];
  for (const [file, m] of mods) {
    for (const fn of m.fns) {
      const reaches = TOUCHES_FETCH.test(fn.own) || calleesOf(file, fn.own).some((k) => networky.has(k));
      if (!reaches) continue;
      const bools = fn.own.match(BOOL_RETURN);
      if (!bools) continue;
      hits.push({
        file,
        name: fn.name,
        line: m.code.slice(0, fn.start).split("\n").length,
        bools: bools.length,
        question: QUESTION_NAME.test(fn.name),
      });
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────────────────────

const VERDICTS = new Set(["HARMFUL", "BOUNDED", "NO-COLLAPSE"]);
const MIN_REASON = 40;   // long enough that "ok", "fine", "n/a" cannot pass

export function parseInventory(text) {
  const entries = [];
  const errors = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length !== 3) { errors.push(`line ${i + 1}: expected "VERDICT | file::function | reason", got ${parts.length} field(s)`); return; }
    const [verdict, id, reason] = parts;
    if (!VERDICTS.has(verdict)) { errors.push(`line ${i + 1}: unknown verdict "${verdict}" (use ${[...VERDICTS].join(", ")})`); return; }
    if (!id.includes("::")) { errors.push(`line ${i + 1}: "${id}" is not file::function`); return; }
    if (reason.length < MIN_REASON) { errors.push(`line ${i + 1}: ${id} has a ${reason.length}-character reason. Say WHY the two states may collapse here, in at least ${MIN_REASON} characters, or fix the code instead.`); return; }
    entries.push({ verdict, id, reason, line: i + 1 });
  });
  return { entries, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

const sources = new Map();
for (const f of walk(API)) sources.set(f, fs.readFileSync(f, "utf8"));
const realFileCount = sources.size;

// ── Self-test: can this scanner still SEE the files it is scanning? ──────────
//
// blank() is the foundation. Every downstream decision - where a function starts
// and ends, what its own text is, whether it names fetch - is made against its
// output. So when blank() desyncs, the scan does not error, it goes QUIET: whole
// regions stop being code as far as this gate is concerned, and it reports fewer
// hits with total confidence. A gate that under-reports in silence is the exact
// failure it was built to catch.
//
// That is not a worry, it is a finding. Six of 251 files were desynced on the day
// this shipped, by two separate bugs (a nested template literal, and a regex
// literal after `return` whose character class held a quote - which blanked
// everything from there to the next quote LATER IN THE FILE). Neither was
// visible from reading the code, and both produced a confident green.
//
// The invariant that caught them, kept: blanking replaces characters in place and
// never touches a real brace, so blanked source MUST stay brace-balanced. It is
// cheap - the files are already in memory - and it is checked on every run.
const desynced = [];
for (const [file, raw] of sources) {
  const b = blank(raw);
  let depth = 0, min = 0;
  for (const ch of b) {
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth < min) min = depth; }
  }
  if (depth !== 0 || min < 0) desynced.push({ file, depth, min });
}
if (desynced.length) {
  console.error(`\nSELF-TEST FAILED: blank() desynced on ${desynced.length} file(s). Brace depth does not return to zero, so function boundaries after the bad spot are wrong and this scan is UNDER-REPORTING. Do not trust a green run until this is fixed:\n`);
  for (const d of desynced) console.error(`  ${path.relative(PORTAL, d.file)}  final depth ${d.depth}, minimum ${d.min}`);
  console.error(`\nUsual causes: a template literal nested inside another template's \${...}, or a regex literal this scanner read as division (see regexAllowedAt) whose contents then opened a phantom string.`);
  process.exit(1);
}

// ── Planted mutations. These are REAL files fed to the REAL scan, at a real path
// so relative-import resolution behaves exactly as it does in production.
const PLANT_DIR = path.join(API, "__mutation__");
const PLANTED_DIRECT = path.join(PLANT_DIR, "planted-direct.js");
const PLANTED_INDIRECT = path.join(PLANT_DIR, "planted-indirect.js");
const PLANTED_COMPLIANT = path.join(PLANT_DIR, "planted-compliant.js");
const PLANTED_INJECTED = path.join(PLANT_DIR, "planted-injected.js");
const PLANTED_NESTED = path.join(PLANT_DIR, "planted-nested-template.js");

if (MUTATE === "newoffender") {
  sources.set(PLANTED_DIRECT, `
async function isAcademyPaid(id) {
  try {
    const r = await fetch("https://example.invalid/accounts/" + id);
    if (!r.ok) return false;
    const a = await r.json();
    return a.paid === true;
  } catch (_) {
    return false;
  }
}
export default isAcademyPaid;
`);
}

if (MUTATE === "indirect") {
  // Not one `fetch` in this file. It reaches the network only by importing a
  // real, networky helper from a real file - which is the shape 23 of the 29
  // live entries have, and the shape a fetch-only scan is blind to.
  sources.set(PLANTED_INDIRECT, `
import { isMuted } from "../agent/_mutes.js";
export async function hasQuietHours(clientId, contactId) {
  try {
    return await isMuted(clientId, contactId, "booking");
  } catch (_) {
    return false;
  }
}
`);
}

// The shape that was ACTUALLY invisible on day one, kept as a control so it
// cannot go invisible again. Not one `fetch(` in it: the call goes through a
// variable holding an injected impl, which is the normal way to make a network
// call testable and is now live in api/stripe/_requirements.js.
if (MUTATE === "injected") {
  sources.set(PLANTED_INJECTED, `
export async function isAccountReady(acctId, opts = {}) {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  try {
    const r = await doFetch("https://example.invalid/accounts/" + acctId);
    if (!r.ok) return false;
    const a = await r.json();
    return a.charges_enabled === true;
  } catch (_) {
    return false;
  }
}
`);
}

// A collapse hiding BEHIND the two constructs that actually desynced this
// scanner: a template literal nested in another template's ${...} (as at
// api/contacts.js:250) and a regex after `return` whose character class contains
// a quote (as at api/store/inventory.js:88). Both are copied from real lines. If
// blank() mishandles either, the scanner loses its place and never sees the
// offender below them - silently, which is the whole point.
if (MUTATE === "nestedtemplate") {
  sources.set(PLANTED_NESTED, [
    'export function tagPath(tag) {',
    '  return `&tags=cs.${encodeURIComponent(`{"${String(tag)}"}`)}`;',
    '}',
    'export function cleanImage(v) {',
    '  const s = String(v || "").trim();',
    '  return /^https:\\/\\/[^\\s"\'<>]+$/i.test(s) ? s : null;',
    '}',
    'export async function isStoreLive(clientId) {',
    '  try {',
    '    const r = await fetch("https://example.invalid/store/" + clientId);',
    '    if (!r.ok) return false;',
    '    return (await r.json()).live === true;',
    '  } catch (_) {',
    '    return false;',
    '  }',
    '}',
  ].join('\n'));
}

if (MUTATE === "compliant") {
  // The three outcomes, done properly: yes, no-with-a-reason, and could-not-ask.
  // No bare boolean literal anywhere, and the transport failure is its own state.
  sources.set(PLANTED_COMPLIANT, `
import { isMuted } from "../agent/_mutes.js";
export async function quietHoursState(clientId, contactId) {
  try {
    const muted = await isMuted(clientId, contactId, "booking");
    return { known: true, quiet: muted, reason: muted ? "agent muted" : "no mute row" };
  } catch (e) {
    return { known: false, quiet: null, reason: "could not ask: " + e.message };
  }
}
`);
}

const hits = scan(sources);
const hitIds = new Map(hits.map((h) => [`${path.relative(PORTAL, h.file)}::${h.name}`, h]));

let inventoryText = "";
try { inventoryText = fs.readFileSync(INVENTORY, "utf8"); }
catch { console.error(`Cannot read ${path.relative(PORTAL, INVENTORY)}. The inventory IS the gate; without it this check proves nothing.`); process.exit(1); }

if (MUTATE === "stale") {
  inventoryText += "\nBOUNDED | api/stripe/connect.js::thisFunctionWasDeletedLastTuesday | Planted by MUTATE=stale: an entry for code that no longer exists, which is how an inventory quietly stops describing the tree.\n";
}

// A rubber stamp is the cheapest way to defeat this gate: keep the line, drop the
// argument. So plant one against a REAL hit and require the run to reject it.
if (MUTATE === "stub") {
  inventoryText = inventoryText.replace(/^BOUNDED \| api\/_email\.js::isSuppressed \|.*$/m, "BOUNDED | api/_email.js::isSuppressed | fine");
}

const { entries, errors: inventoryErrors } = parseInventory(inventoryText);

// ── Judge ────────────────────────────────────────────────────────────────────
const known = new Map(entries.map((e) => [e.id, e]));
const unaudited = [...hitIds.keys()].filter((id) => !known.has(id)).sort();
const stale = entries.filter((e) => !hitIds.has(e.id));

const byVerdict = { HARMFUL: [], BOUNDED: [], "NO-COLLAPSE": [] };
for (const e of entries) if (hitIds.has(e.id)) byVerdict[e.verdict].push(e);

// ── Report. Prints on EVERY run, green or red. ───────────────────────────────
console.log(`\nNetwork-boolean inventory - ${hits.length} function(s) in api/ turn a network answer into a bare boolean (${realFileCount} files scanned).`);
console.log(`  HARMFUL      ${String(byVerdict.HARMFUL.length).padStart(3)}  the collapse produces a wrong outcome someone sees or a wrong write`);
console.log(`  BOUNDED      ${String(byVerdict.BOUNDED.length).padStart(3)}  the collapse is real; a stated mechanism keeps it off a person`);
console.log(`  NO-COLLAPSE  ${String(byVerdict["NO-COLLAPSE"].length).padStart(3)}  the transport failure never becomes the boolean`);
console.log(`  deliberate   ${String(byVerdict.BOUNDED.length + byVerdict["NO-COLLAPSE"].length).padStart(3)}  signed off in scripts/network-boolean-inventory.txt`);

if (byVerdict.HARMFUL.length) {
  console.log(`\n  Still HARMFUL, every run, until the line is deleted because the code got a third outcome:`);
  for (const e of byVerdict.HARMFUL) {
    const h = hitIds.get(e.id);
    console.log(`    ${e.id}  (${path.relative(PORTAL, h.file)}:${h.line})`);
  }
}

let failed = false;

if (inventoryErrors.length) {
  failed = true;
  console.error(`\n${inventoryErrors.length} malformed inventory line(s):`);
  for (const e of inventoryErrors) console.error(`  ${e}`);
}

if (unaudited.length) {
  failed = true;
  console.error(`\n${unaudited.length} UNAUDITED network boolean(s). Each one is a function where "no" and "we could not ask" are the same value:\n`);
  for (const id of unaudited) {
    const h = hitIds.get(id);
    const rel = path.relative(PORTAL, h.file);
    const q = h.question ? " Its NAME asks a question, so the wrong answer travels as a fact." : "";
    console.error(`::error file=bam-ghl-agent/bam-portal/${rel},line=${h.line}::${h.name}() reaches the network and returns a bare boolean.${q} Give it three outcomes (yes / no-and-why / could-not-ask), or add a line to scripts/network-boolean-inventory.txt saying why collapsing them is safe HERE.`);
    console.error(`  ${rel}:${h.line}  ${h.name}()${h.question ? "  <- question-named" : ""}`);
  }
  console.error(`\nTo record one instead of fixing it, add to scripts/network-boolean-inventory.txt:`);
  console.error(`  BOUNDED | ${unaudited[0]} | why the wrong answer cannot reach a person or a write, in at least ${MIN_REASON} characters`);
}

if (stale.length) {
  failed = true;
  console.error(`\n${stale.length} STALE inventory line(s) - the function no longer returns a bare boolean, or was renamed or deleted. Delete the line, or the counts above are fiction. If you just rebased onto a merged fix, deleting the line here IS the rest of that fix:\n`);
  for (const e of stale) console.error(`::error file=bam-ghl-agent/bam-portal/scripts/network-boolean-inventory.txt,line=${e.line}::${e.id} no longer matches anything in api/. Delete this line.`);
  for (const e of stale) console.error(`  network-boolean-inventory.txt:${e.line}  ${e.id}`);
}

// ── The controls' verdicts ───────────────────────────────────────────────────
if (MUTATE) {
  if (!MUT[MUTATE]) {
    console.error(`\nUnknown MUTATE="${MUTATE}". Known controls: ${Object.keys(MUT).join(", ")}`);
    process.exit(1);
  }
  const plantedId = {
    newoffender: "api/__mutation__/planted-direct.js::isAcademyPaid",
    indirect: "api/__mutation__/planted-indirect.js::hasQuietHours",
    injected: "api/__mutation__/planted-injected.js::isAccountReady",
    nestedtemplate: "api/__mutation__/planted-nested-template.js::isStoreLive",
  }[MUTATE];

  if (MUTATE === "newoffender" || MUTATE === "indirect" || MUTATE === "injected" || MUTATE === "nestedtemplate") {
    if (unaudited.includes(plantedId)) {
      console.log(`\nNEGATIVE CONTROL PASSED - MUTATE=${MUTATE} planted ${plantedId} and the check reported it as unaudited.`);
      process.exit(0);
    }
    console.error(`\nNEGATIVE CONTROL FAILED - MUTATE=${MUTATE} planted ${plantedId} and the check did not report it. The detector is not detecting; do not quote a green run as evidence.`);
    process.exit(1);
  }

  if (MUTATE === "compliant") {
    const flagged = unaudited.some((id) => id.startsWith("api/__mutation__/planted-compliant.js"));
    if (!flagged && !failed) {
      console.log(`\nNEGATIVE CONTROL PASSED - MUTATE=compliant planted a three-outcome function that reaches the network, and the check stayed quiet about it. The detector discriminates; it does not just fire on everything that says "await".`);
      process.exit(0);
    }
    console.error(`\nNEGATIVE CONTROL FAILED - MUTATE=compliant ${flagged ? "flagged a function that already obeys the rule, so this gate would be red on correct code and would be switched off" : "could not be judged because the run was already failing for another reason"}.`);
    process.exit(1);
  }

  if (MUTATE === "stub") {
    if (inventoryErrors.some((e) => e.includes("character reason"))) {
      console.log(`\nNEGATIVE CONTROL PASSED - MUTATE=stub replaced a real reason with the word "fine" and the check rejected it. A verdict nobody had to argue for is the cheapest way to defeat an inventory.`);
      process.exit(0);
    }
    console.error(`\nNEGATIVE CONTROL FAILED - MUTATE=stub planted a one-word reason and the check accepted it, so any hit can be silenced without anyone thinking about it.`);
    process.exit(1);
  }

  if (MUTATE === "stale") {
    if (stale.some((e) => e.id.endsWith("::thisFunctionWasDeletedLastTuesday"))) {
      console.log(`\nNEGATIVE CONTROL PASSED - MUTATE=stale planted an inventory line for code that does not exist and the check caught it. An inventory that can only grow cannot be trusted to describe the tree.`);
      process.exit(0);
    }
    console.error(`\nNEGATIVE CONTROL FAILED - MUTATE=stale planted a dead inventory line and the check accepted it, so nothing forces a fixed instance to be de-listed.`);
    process.exit(1);
  }
}

if (failed) {
  console.error(`\nA yes/no answer that crossed a network boundary must have THREE outcomes: yes, no-and-here-is-why, and we-could-not-ask.`);
  console.error(`See api/agent/_stage.js computeQueue's \`idsTrusted\` for the shape done right in this repo.`);
  process.exit(1);
}

console.log(`\nEvery network boolean in api/ is accounted for.`);
