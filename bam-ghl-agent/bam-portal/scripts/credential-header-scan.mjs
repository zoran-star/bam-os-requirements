// EVERY CREDENTIAL-BEARING FETCH SITE IN api/**, ENUMERATED AND CLASSIFIED.
//
//   node scripts/credential-header-scan.mjs            report + enforce
//   node scripts/credential-header-scan.mjs --write    re-baseline the manifest
//
// WHY THIS EXISTS AND WHY IT IS NOT A LIST OF FILENAMES. The leak this guards is
// mechanical: a secret is interpolated into an auth header, undici refuses the
// header, and the TypeError QUOTES THE WHOLE VALUE with no .status - so any
// route doing `e.status || 500` + `e.message` returns a live credential.
//
// The first fix for it pinned spellings: "this file still contains the leaky
// catch", "this file no longer says e.message". Every one of those pins is
// defeatable by ADDING code. Appending a brand-new unguarded raw-key fetch to a
// guarded file fails zero of them, because nothing was counting fetch sites. A
// pin that only inspects what is already there cannot survive an addition.
//
// So this counts. It enumerates every place a credential becomes a header, marks
// each GUARDED (the value came through api/_header-safe-credential.js) or RAW,
// and compares the RAW population against a committed manifest. A new RAW site -
// anywhere, in any file, guarded or not - changes a count and fails the run. The
// author then either routes it through the guard or argues it into the manifest
// deliberately. That is the only shape that survives an addition.
//
// WHAT IT DOES NOT DO, said plainly. It does not prove a RAW site actually
// reaches a response body; that needs sink analysis this does not attempt. It
// treats every RAW site as a hazard, which over-reports and is the right
// direction for a leak gate. It reads source text, so a credential assembled
// through indirection it cannot follow reads as no site at all rather than as a
// RAW one - the manifest counts are a floor, not a ceiling.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PORTAL = path.resolve(HERE, "..");
export const MANIFEST = path.join(PORTAL, "scripts", "credential-header-inventory.txt");

// ── tokenizer: blank COMMENTS, keep STRINGS ─────────────────────────────────
// Header names and `Bearer ${...}` values live inside string and template
// literals, so blanking strings would blind the scan to exactly what it hunts.
// Comments must go, though: a header name quoted in prose is not a call site,
// and a pin that fires on prose gets switched off.
export function blankComments(src) {
  const out = src.split("");
  const n = src.length;
  const kill = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; kill(i, j); i = j; continue; }
    if (c === "/" && d === "*") { let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; kill(i, j); i = j; continue; }
    if (c === "`" || c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
      i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".vercel", ".git", "coverage", "__fixtures__", "__goldens__", "snapshots", "__mutation__"]);
const IS_TEST = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const EXTS = new Set([".js", ".mjs", ".cjs", ".ts"]);

function* walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(full); }
    else if (EXTS.has(path.extname(e.name)) && !IS_TEST(e.name) && !e.name.startsWith(".")) yield full;
  }
}

// A secret is an env var whose NAME says so. Deliberately name-based: the value
// is not available at scan time, and a variable called ANTHROPIC_API_KEY is a
// credential whatever it happens to hold.
// THE CODEBASE'S OWN INDIRECTION COUNTS AS AN ENV READ. api/_env.js exists
// precisely so callers stop writing process.env directly, so a scan that only
// matched process.env was blind to the files that followed the house style -
// api/parent/_supabase.ts (the parent app's ENTIRE Supabase layer, three
// apikey + Bearer service-role pairs) and api/coachiq.js reported ZERO sites and
// never reached the manifest. A bound with the tidiest files outside it is not a
// bound. Matched on the ARGUMENT NAME, same rule as everywhere else here.
const ENV_HELPER = '(?:requireEnv|firstEnv|envPresent)\\s*\\(\\s*["\'`][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PAT|CREDENTIAL)[A-Z0-9_]*["\'`]';
const SECRET_ENV = new RegExp(`process\\.env\\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PAT|CREDENTIAL)[A-Z0-9_]*|${ENV_HELPER}`);
const SECRET_ENV_G = new RegExp(SECRET_ENV.source, "g");

// (b) A CREDENTIAL IS NOT ONLY AN ENV VAR. A decrypted row secret or a stored
// per-academy token in an auth header is the same hazard - the transport's own
// leak was decryptSecret(row.secret_key_enc), which no env pattern would ever
// see. Any identifier or property path whose NAME says credential counts.
const SECRET_NAMEY = /\b[A-Za-z_$][\w$]*(?:[Kk]ey|KEY|[Ss]ecret|SECRET|[Tt]oken|TOKEN|[Pp]assword|PASSWORD|[Cc]redential|CREDENTIAL)\b/;
// ...and the same test against a PROPERTY READ, so `const token = client.ghl_access_token`
// counts even though the local name ("token") is too short to match on its own.
// This is the per-academy stored-credential shape, which has no env var anywhere.
const SECRET_PROP = /\.[A-Za-z_$][\w$]*(?:[Kk]ey|KEY|[Ss]ecret|SECRET|[Tt]oken|TOKEN|[Pp]assword|PASSWORD|[Cc]redential|CREDENTIAL)\b/;
const DECRYPT_CALL = /\bdecrypt[A-Za-z]*\s*\(/;

// THE HEADER NAMES, case-insensitively: HTTP headers are case-insensitive and
// `AUTHORIZATION:` was invisible to the first version of this.
// CASE-SENSITIVE ON PURPOSE, unlike the rest of this matching. HTTP header names
// are case-insensitive so the realistic casings are enumerated - but a blanket /i
// also matches the camelCase JS field `apiKey:`, and api/coachiq.js line 26 is a
// CONFIG OBJECT (`apiKey: cfg.apiKey || firstEnv(...)`), not a header. Reporting
// it would put a non-hazard on the manifest and teach people the list is noise.
const HEADER_NAMES = [
  "Authorization", "authorization", "AUTHORIZATION",
  "apikey", "APIKEY", "Apikey", "ApiKey",
  "api-key", "API-KEY", "Api-Key", "api_key", "API_KEY",
  "x-api-key", "X-API-KEY", "X-Api-Key", "x-api-Key",
  "Private-Token", "PRIVATE-TOKEN",
  "Proxy-Authorization", "proxy-authorization",
].join("|");
// Every shape a header actually gets written in, not just object-literal keys:
//   { Authorization: v }        object literal (v may be on the NEXT line)
//   h.Authorization = v         property assignment
//   h["Authorization"] = v      computed assignment
//   headers.set("Authorization", v)   Headers.set / append
//   new Headers([["Authorization", v]])   entry-pair arrays
// Matched against the WHOLE FILE with /s so a wrapped value (what prettier
// produces) is still attached to its header name.
const CRED_HEADER_G = new RegExp(
  "(?:" +
  `["'\`]?(?:${HEADER_NAMES})["'\`]?\\s*:` +               // literal key
  `|\\.(?:${HEADER_NAMES})\\s*=` +                        // h.Authorization =
  `|\\[\\s*["'\`](?:${HEADER_NAMES})["'\`]\\s*\\]\\s*=` +   // h["Authorization"] =
  `|(?:set|append)\\s*\\(\\s*["'\`](?:${HEADER_NAMES})["'\`]\\s*,` + // .set("Authorization",
  `|\\[\\s*["'\`](?:${HEADER_NAMES})["'\`]\\s*,` +        // [["Authorization", v]]
  ")",
  "gs"
);
// How far past the header name the VALUE may sit. One wrapped line plus a bit;
// long enough for prettier, short enough not to swallow the next property.
const VALUE_WINDOW = 160;

const GUARD_CALL = /assertHeaderSafeCredential\s*\(/;

const ident = (s) => s.replace(/\$/g, "\\$");

// Every name in a file that carries credential material, and which of them got
// there THROUGH THE GUARD. Resolved one hop through local helper functions,
// because the shape the fix uses is `const key = sbKey()` where sbKey() returns
// assertHeaderSafeCredential(...) - a scan that cannot follow that hop would
// report a correctly guarded file as having no sites at all, which is worse than
// reporting it as raw.
function credentialNames(code) {
  const all = new Set();
  const guarded = new Set();
  const guardFns = new Set();
  const secretFns = new Set();

  // const { SUPABASE_SERVICE_KEY, X } = process.env  - the destructured form,
  // which carries no `process.env.NAME` text at all and so was fully invisible.
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(",")) {
      const name = (part.split(":").pop() || "").trim().replace(/=.*$/, "").trim();
      if (name && SECRET_NAMEY.test(name)) all.add(name);
    }
  }

  // function bodies, brace-matched
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    const open = code.indexOf("{", m.index + m[0].length);
    if (open < 0) continue;
    let depth = 1, i = open + 1;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
    }
    const body = code.slice(open, i);
    if (GUARD_CALL.test(body)) guardFns.add(name);
    else if (SECRET_ENV.test(body)) secretFns.add(name);
  }

  // Declarations AND bare assignments, repeated so a chain like
  // `const k = sbKey()` resolves whatever order the file declares things in.
  // The bare-assignment half is load-bearing: `let credential; try { credential =
  // assertHeaderSafeCredential(...) }` is the shape a guard needs when its
  // refusal has to be caught and turned into a value, and a scan that only reads
  // declarations calls that file siteless instead of guarded.
  const DECL = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*([^;\n]*)/g;
  for (let pass = 0; pass < 3; pass++) {
    for (const m of code.matchAll(DECL)) {
      const [, name, expr] = m;
      const viaGuard = GUARD_CALL.test(expr) || [...guardFns].some((f) => new RegExp(`\\b${ident(f)}\\s*\\(`).test(expr));
      const viaSecret = SECRET_ENV.test(expr)
        || DECRYPT_CALL.test(expr)
        || SECRET_PROP.test(expr)                            // const token = client.ghl_access_token
        || (SECRET_NAMEY.test(name) && /[.[(]/.test(expr))
        || [...secretFns].some((f) => new RegExp(`\\b${ident(f)}\\s*\\(`).test(expr))
        || [...all].some((v) => !guarded.has(v) && new RegExp(`\\b${ident(v)}\\b`).test(expr));
      if (viaGuard) { all.add(name); guarded.add(name); }
      else if (viaSecret) { all.add(name); }
    }
  }
  return { all, guarded, secretCalls: secretFns, guardCalls: guardFns };
}

// One credential header site per HEADER NAME OCCURRENCE, with its value read
// from a WINDOW that runs past the end of the line. Per-line matching was the
// scan's worst property, and not only because it missed wrapped code: it made
// the manifest count depend on FORMATTING. Running prettier over
// `apikey: SB_KEY,` / `Authorization: \`Bearer ${SB_KEY}\`,` could merge or split
// lines, the count would move, the credential would reach fetch entirely
// unchanged - and the gate would print "lower the number" as the remedy. A
// formatter could launder a live hazard into a green fix.
export function scanFile(rel, raw) {
  const code = blankComments(raw);
  const { all, guarded, secretCalls, guardCalls } = credentialNames(code);
  const rawLines = raw.split("\n");
  const sites = [];
  const seen = new Set();
  CRED_HEADER_G.lastIndex = 0;
  for (const m of code.matchAll(CRED_HEADER_G)) {
    const start = m.index + m[0].length;
    const window = code.slice(start, start + VALUE_WINDOW);
    const inlineSecrets = window.match(SECRET_ENV_G) || [];
    const named = [...all].filter((v) => new RegExp(`\\b${ident(v)}\\b`).test(window));
    const decrypted = DECRYPT_CALL.test(window);
    // `apikey: serviceKey()` - the value is a CALL to a helper that reads a
    // secret, with no variable in sight. This is the parent app's whole shape.
    const rawCalls = [...secretCalls].filter((fn) => new RegExp(`\\b${ident(fn)}\\s*\\(`).test(window));
    const safeCalls = [...guardCalls].filter((fn) => new RegExp(`\\b${ident(fn)}\\s*\\(`).test(window));
    // `Bearer ${c.apiKey}` - the value is a property read off a config object.
    const propSecret = SECRET_PROP.test(window);
    if (!inlineSecrets.length && !named.length && !decrypted && !rawCalls.length && !safeCalls.length && !propSecret) continue;
    const line = code.slice(0, m.index).split("\n").length;
    if (seen.has(line)) continue;          // one site per line, however it wrapped
    seen.add(line);
    // GUARDED means: nothing raw in the value, and every credential name it uses
    // came through assertHeaderSafeCredential. One raw token is enough to make
    // the whole site raw - a header built from two credentials is only as safe
    // as its worse half, which is how commissions.js leaked while looking fixed.
    const isGuarded = inlineSecrets.length === 0 && !decrypted && !propSecret && rawCalls.length === 0
      && (named.length > 0 || safeCalls.length > 0) && named.every((v) => guarded.has(v));
    sites.push({ rel, line, guarded: isGuarded, text: (rawLines[line - 1] || "").trim().slice(0, 110) });
  }
  sites.sort((a, b) => a.line - b.line);
  return sites;
}

// ── THE OTHER HALF: a guard that THROWS from outside a handler's try ────────
//
// Adding a credential guard converts a silent bad-credential path into a throw.
// That is the point - but a throw raised where nothing catches it does not fail
// closed, it CRASHES: withSentryApiRoute captures and rethrows, Vercel answers
// FUNCTION_INVOCATION_FAILED with no body, and Sentry takes an event per
// request. A route that used to answer 401 cleanly now returns nothing at all.
//
// This shipped three times in one change (the onboarding key, the empty-value
// refusal, and verifyStaffForImport/requireStaff), which is what makes it a
// CLASS rather than three mistakes. So it is checked rather than remembered.
//
// The analysis: find every function whose body can PROPAGATE a guard throw (it
// calls a guard, or another propagating function, from outside its own try),
// then report any call to one of those made by a handler OUTSIDE the handler's
// try. Deliberately conservative - it models lexical try blocks only, so it
// cannot see a caller's try in another file, and it is limited to api/**.
const GUARD_THROWERS = /assertHeaderSafeCredential\s*\(|onboardingStripeKey\s*\(|isOnboardingTestMode\s*\(|onboardingKeyOverride\s*\(/;

function tryMask(code) {
  const mask = new Array(code.length).fill(false);
  for (const m of code.matchAll(/\btry\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) { if (code[i] === "{") depth++; else if (code[i] === "}") depth--; }
    for (let k = m.index; k < i; k++) mask[k] = true;
  }
  return mask;
}
function functionBodies(code) {
  const out = new Map();
  for (const m of code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = code.indexOf("{", m.index + m[0].length);
    if (open < 0) continue;
    let depth = 1, i = open + 1;
    for (; i < code.length && depth > 0; i++) { if (code[i] === "{") depth++; else if (code[i] === "}") depth--; }
    out.set(m[1], { start: open, body: code.slice(open, i) });
  }
  return out;
}
export function handlerEscapes(rel, raw) {
  const code = blankComments(raw);
  const bodies = functionBodies(code);
  if (!GUARD_THROWERS.test(code)) return [];
  const propagating = new Set();
  for (let pass = 0; pass < 5; pass++) {
    for (const [name, { body }] of bodies) {
      if (propagating.has(name)) continue;
      const bm = tryMask(body);
      const alts = [GUARD_THROWERS.source, ...[...propagating].map((n) => `\\b${ident(n)}\\s*\\(`)].join("|");
      for (const c of body.matchAll(new RegExp(alts, "g"))) {
        if (c[0] && !bm[c.index]) { propagating.add(name); break; }
      }
    }
  }
  const rawLines = raw.split("\n");
  const escapes = [];
  for (const [entry, { start, body }] of bodies) {
    if (!/handler/i.test(entry)) continue;
    const bm = tryMask(body);
    const others = [...propagating].filter((n) => n !== entry);
    const alts = [GUARD_THROWERS.source, ...others.map((n) => `\\b${ident(n)}\\s*\\(`)].join("|");
    for (const c of body.matchAll(new RegExp(alts, "g"))) {
      if (!c[0] || bm[c.index]) continue;
      const line = code.slice(0, start + c.index).split("\n").length;
      escapes.push({ rel, entry, line, text: (rawLines[line - 1] || "").trim().slice(0, 100) });
    }
  }
  return escapes;
}

export function scanPortalEscapes(portal = PORTAL) {
  const out = [];
  for (const f of walk(path.join(portal, "api"))) {
    const rel = path.relative(portal, f).split(path.sep).join("/");
    out.push(...handlerEscapes(rel, fs.readFileSync(f, "utf8")));
  }
  return out;
}

export function scanPortal(portal = PORTAL) {
  const byFile = new Map();
  for (const f of walk(path.join(portal, "api"))) {
    const rel = path.relative(portal, f).split(path.sep).join("/");
    const sites = scanFile(rel, fs.readFileSync(f, "utf8"));
    if (sites.length) byFile.set(rel, sites);
  }
  return byFile;
}

// ── the manifest ────────────────────────────────────────────────────────────
// "<rawCount> <path>" for every file with at least one RAW site. A file with
// zero raw sites must NOT appear: that way guarding a file is also a manifest
// edit, and a manifest line that stops matching fails as stale.
export function parseManifest(text) {
  const counts = new Map();
  const notes = new Map();   // "#drop <path> <reason>" - a human witness for a decrease
  const errors = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    const drop = t.match(/^#drop\s+(\S+)\s+(.+)$/);
    if (drop) { notes.set(drop[1], drop[2]); return; }
    if (!t || t.startsWith("#")) return;
    const m = t.match(/^(\d+)\s+(\S+)$/);
    if (!m) { errors.push(`line ${i + 1}: expected "<count> <path>", got "${t.slice(0, 60)}"`); return; }
    counts.set(m[2], Number(m[1]));
  });
  return { counts, notes, errors };
}

export function renderManifest(byFile) {
  const lines = [];
  for (const [rel, sites] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const raw = sites.filter((s) => !s.guarded).length;
    if (raw) lines.push(`${raw} ${rel}`);
  }
  return lines;
}

export function checkAgainstManifest(byFile, manifestText) {
  const { counts, notes, errors } = parseManifest(manifestText);
  const problems = [...errors.map((e) => `manifest ${e}`)];
  // A WITNESS FOR A FILE NOBODY EVER LISTED IS A PRE-AUTHORISATION, not a record.
  // Both decrease paths `continue` on a #drop note, so a note landed in one PR
  // silently excuses a hazard landed in a later one - the manifest showing no
  // change at all. A witness may only vouch for something that exists: a file
  // with a manifest line, or one the scan can currently see.
  for (const [rel] of notes) {
    if (!counts.has(rel) && !byFile.has(rel)) {
      problems.push(`ORPHAN #drop WITNESS: scripts/credential-header-inventory.txt vouches for ${rel}, which has no manifest line and no credential header site the scan can find. A #drop explains a count that WENT DOWN; it cannot be pre-seeded for a file that was never listed, or it becomes standing permission for a hazard added later. Delete the note, or add the file with its real count first.`);
    }
  }
  const current = new Map();
  for (const [rel, sites] of byFile) {
    const raw = sites.filter((s) => !s.guarded).length;
    if (raw) current.set(rel, raw);
  }
  for (const [rel, n] of [...current].sort()) {
    const known = counts.get(rel);
    if (known === undefined) {
      const where = byFile.get(rel).filter((s) => !s.guarded).map((s) => `${rel}:${s.line}`).slice(0, 3).join(", ");
      problems.push(`NEW UNGUARDED CREDENTIAL HEADER: ${rel} has ${n} raw credential header site(s) and no manifest line (${where}). Route the credential through api/_header-safe-credential.js, or add "${n} ${rel}" to scripts/credential-header-inventory.txt on purpose.`);
    } else if (n > known) {
      problems.push(`CREDENTIAL HEADER SITES GREW: ${rel} now has ${n} raw site(s), the manifest says ${known}. A new unguarded auth header was added to an already-known file - that is exactly the addition a spelling pin cannot see.`);
    } else if (n < known) {
      // NEVER "just lower the number". A count can drop for two completely
      // different reasons and the scan cannot tell them apart: the credential
      // was routed through the guard (a real fix), or the site merely MOVED OUT
      // OF VIEW - reformatted, wrapped, extracted into a helper the scan does
      // not follow - with the credential still reaching fetch untouched. The
      // attacker demonstrated the second by line-wrapping one header in
      // api/_contacts.js; the old message cheerfully instructed them to lower
      // the count. So a decrease demands a WITNESS: the file must show guarded
      // sites, or carry an explicit "#drop" note saying who checked and why.
      const guardedNow = (byFile.get(rel) || []).filter((s) => s.guarded).length;
      const witnessed = notes.get(rel);
      if (witnessed) continue;
      problems.push(guardedNow > 0
        ? `MANIFEST COUNT DROPPED: ${rel} now has ${n} raw site(s) (manifest says ${known}) and ${guardedNow} guarded site(s). If the drop is because those credentials now route through api/_header-safe-credential.js, lower the number AND record it as "#drop ${rel} <who/why>" so the reason is on the record.`
        : `MANIFEST COUNT DROPPED WITH NO GUARDED SITE TO EXPLAIN IT: ${rel} now has ${n} raw site(s), the manifest says ${known}, and NOTHING in that file is guarded. A credential header did not become safe by disappearing from this scan - reformatting, wrapping or extracting a call moves a site out of view while it still reaches fetch. Verify by hand, then either guard it or record "#drop ${rel} <who/why>". Do NOT simply lower the number.`);
    }
  }
  // DROPPING TO ZERO IS THE SAME LAUNDERING HOLE AT ITS EXTREME. The decrease
  // branch above demands a witness, but a file whose raw count reaches 0 leaves
  // `current` entirely and lands here - where "delete its line" is exactly the
  // "lower the number" instruction the decrease branch exists to refuse. So the
  // same witness rule applies: guarded sites in the file are evidence the
  // credentials were routed through the guard; nothing at all is evidence only
  // that the scan stopped seeing them.
  for (const rel of [...counts.keys()].sort()) {
    if (current.has(rel)) continue;
    const sites = byFile.get(rel) || [];
    const guardedNow = sites.filter((s) => s.guarded).length;
    if (notes.has(rel)) continue;
    problems.push(guardedNow > 0
      ? `STALE MANIFEST LINE: ${rel} has no raw credential header site any more and ${guardedNow} guarded one(s). Delete its line in the same change, and record "#drop ${rel} <who/why>" so the reason survives.`
      : `MANIFEST LINE VANISHED WITH NOTHING GUARDED TO EXPLAIN IT: ${rel} was listed with ${counts.get(rel)} raw site(s) and now shows NO credential header site at all - not guarded, just gone. A call that was extracted, reformatted or moved behind an indirection this scan cannot follow looks identical to one that was fixed, and the credential still reaches fetch. Verify by hand, then record "#drop ${rel} <who/why>". Do NOT just delete the line.`);
  }
  return problems;
}

export function summarize(byFile) {
  let sites = 0, guarded = 0, rawSites = 0, guardedFiles = 0, rawFiles = 0;
  for (const [, s] of byFile) {
    sites += s.length;
    const g = s.filter((x) => x.guarded).length;
    guarded += g; rawSites += s.length - g;
    if (g === s.length) guardedFiles++; else rawFiles++;
  }
  return { files: byFile.size, sites, guarded, rawSites, guardedFiles, rawFiles };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const byFile = scanPortal();
  if (process.argv.includes("--write")) {
    const header = fs.existsSync(MANIFEST)
      ? fs.readFileSync(MANIFEST, "utf8").split("\n").filter((l) => l.startsWith("#") || l.trim() === "").join("\n").replace(/\n+$/, "\n")
      : "";
    fs.writeFileSync(MANIFEST, `${header}\n${renderManifest(byFile).join("\n")}\n`);
    console.log(`wrote ${renderManifest(byFile).length} manifest line(s) to ${path.relative(PORTAL, MANIFEST)}`);
    process.exit(0);
  }
  const s = summarize(byFile);
  console.log(`credential header sites: ${s.sites} across ${s.files} file(s) - ${s.guarded} guarded, ${s.rawSites} raw`);
  const escapes = scanPortalEscapes();
  for (const e of escapes) console.log(`  \u274c GUARD THROW ESCAPES A HANDLER: ${e.rel}:${e.line} in ${e.entry}() - "${e.text}" is outside any try, so an absent or broken credential crashes the function instead of answering JSON.`);
  const problems = checkAgainstManifest(byFile, fs.readFileSync(MANIFEST, "utf8")).concat(escapes.map((e) => `guard throw escapes ${e.rel}:${e.line}`));
  for (const p of problems) console.log(`  ❌ ${p}`);
  console.log(problems.length ? `\n❌ ${problems.length} problem(s).` : "\n✅ manifest matches.");
  process.exit(problems.length ? 1 : 0);
}
