// Can the portal actually store the statuses it writes?
//
//   node api/_dismiss-status.test.mjs        # exits non-zero on any failure
//
// THE BUG THIS LOCKS DOWN. "Send nothing" on a Hawkeye reply card PATCHes the
// row to status='dismissed'. Four tables carry a status CHECK that never listed
// it, so PostgREST answered 400 (23514) every single time. Production had ZERO
// rows with status='dismissed' anywhere - the feature had never worked, on any
// academy, since the day it shipped. Nothing in the repo could see that: the
// writer is one line of JSON, the constraint is one line of SQL, and no test
// ever put the two in the same room.
//
// That is what this suite is. It parses the REAL migration SQL, derives what
// each constraint will permit after it is applied, then scans the REAL api/
// source for every status literal written to those tables, and requires each
// one to be permitted. It is a paper check by design - plain node, no database,
// no network, per the CI rule for api/_*.test.mjs.
//
// THE TRAP IT EXISTS TO CATCH. The four value lists are NOT identical.
// agent_closing_replies gained 'paused' in 20260723213000_closing_pause_on_reply
// and the other three never had it. The obvious way to write this migration -
// paste one list into all four stanzas - silently drops 'paused' and starts
// rejecting live paused rows. So the assertion is not "contains dismissed", it
// is set equality against a PRODUCTION-CAPTURED baseline: each constraint must
// end up as exactly its own old values plus 'dismissed'. Nothing dropped,
// nothing else added.
//
// NEGATIVE CONTROLS (a check nobody has watched go red is decorative). Each
// rewrites the migration text in memory and re-runs everything; the run passes
// ONLY if it prints NEGATIVE CONTROL PASSED. If a control can no longer be
// applied to the current SQL it exits 2 and says so, rather than proving
// nothing quietly.
//   MUTATE=dropPaused    node api/_dismiss-status.test.mjs
//     Drops 'paused' from the closing list - the copy-paste hazard above.
//   MUTATE=noDismissed   node api/_dismiss-status.test.mjs
//     Drops 'dismissed' from one table - the original bug, un-fixed.
//   MUTATE=dropClosing   node api/_dismiss-status.test.mjs
//     Deletes the whole agent_closing_replies stanza - proves "all four are
//     covered" is a real assertion and not a formality.
//   MUTATE=extraValue    node api/_dismiss-status.test.mjs
//     Sneaks an unrelated value into a list - proves the equality is two-sided
//     and a migration cannot quietly widen more than it says it does.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE      = path.dirname(fileURLToPath(import.meta.url));
const API_DIR   = HERE;
const MIGRATION = path.join(HERE, "..", "supabase", "migrations",
                            "20260730120000_agent_reply_status_dismissed.sql");
const MUTATE    = process.env.MUTATE || "";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✅ " : "  ❌ ") + m); };
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const show  = (s) => "{" + [...s].sort().join(", ") + "}";

// ── the baseline: what production ACTUALLY had before this migration ─────────
// Read off the live database 2026-07-30 via pg_constraint, not reconstructed
// from this repo's migration history (a hand-applied hotfix would not be in
// here). If you change a constraint by any route other than a migration, this
// map is what has to be updated with it.
const BASELINE = {
  agent_ready_replies:   ["pending", "approved", "sent", "skipped", "canceled", "failed"],
  agent_confirm_replies: ["pending", "approved", "sent", "skipped", "canceled", "failed"],
  agent_followups:       ["pending", "approved", "sent", "skipped", "canceled", "failed"],
  agent_closing_replies: ["pending", "approved", "sent", "skipped", "canceled", "failed", "paused"],
};
const TABLES = Object.keys(BASELINE);

// ── mutations, applied to the migration TEXT ────────────────────────────────
function mutate(sql) {
  if (MUTATE === "dropPaused") {
    if (!sql.includes("'failed','paused','dismissed'")) return null;
    return sql.replace("'failed','paused','dismissed'", "'failed','dismissed'");
  }
  if (MUTATE === "noDismissed") {
    const stanza = /(agent_confirm_replies\s*\n\s*add constraint[\s\S]*?check \(status in \()([^)]*)\)/;
    const m = sql.match(stanza);
    if (!m || !m[2].includes("'dismissed'")) return null;
    return sql.replace(stanza, (_, head, list) => head + list.replace(/,\s*'dismissed'/, "") + ")");
  }
  if (MUTATE === "dropClosing") {
    const stanza = /alter table public\.agent_closing_replies\b[\s\S]*?check \(status in \([^)]*\)\);/g;
    if (!stanza.test(sql)) return null;
    return sql.replace(/alter table public\.agent_closing_replies\b[\s\S]*?;/g, "");
  }
  if (MUTATE === "extraValue") {
    if (!sql.includes("'failed','dismissed'")) return null;
    return sql.replace("'failed','dismissed'", "'failed','dismissed','archived'");
  }
  return null;
}

let sql = readFileSync(MIGRATION, "utf8");
if (MUTATE) {
  const m = mutate(sql);
  if (m === null || m === sql) {
    console.error(`\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} could not be applied to ${path.basename(MIGRATION)}.`);
    console.error("   The SQL moved out from under this control, so it is proving nothing. Fix the control.\n");
    process.exit(2);
  }
  sql = m;
}

// ── parse the migration: table -> the values its new constraint permits ──────
// Deliberately reads the ADD side only. A `drop constraint if exists` says
// nothing about what is allowed afterwards.
function parseMigration(text) {
  const out = new Map();
  const re = /alter table\s+public\.(\w+)\s+add constraint\s+\w+\s+check\s*\(\s*status\s+in\s*\(([^)]*)\)\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const vals = [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]);
    out.set(m[1], new Set(vals));
  }
  return out;
}
const parsed = parseMigration(sql);

console.log("\n── THE MIGRATION: each table keeps its OWN values and gains exactly 'dismissed' ──");
ok(parsed.size >= 1, `the migration parses at all (found ${parsed.size} status constraint(s))`);
for (const t of TABLES) {
  const got = parsed.get(t);
  if (!got) { ok(false, `${t}: the migration widens it (no status constraint found for this table)`); continue; }
  const want = new Set([...BASELINE[t], "dismissed"]);
  ok(setEq(got, want), `${t}: permits exactly ${show(want)}${setEq(got, want) ? "" : ` - got ${show(got)}`}`);
  // Called out separately so a failure names the actual harm, not just a diff.
  const lost = BASELINE[t].filter(v => !got.has(v));
  ok(lost.length === 0, `${t}: loses none of its existing values${lost.length ? ` - DROPPED ${lost.join(", ")}, live rows would start failing` : ""}`);
  ok(got.has("dismissed"), `${t}: 'dismissed' is now storable`);
}

console.log("\n── THE VALUE THAT IS NOT SHARED: 'paused' belongs to closing alone ──");
// The specific thing a pasted list destroys. agent_closing_replies parks a
// follow-up plan at 'paused' when a lead replies; the other three never had it,
// and giving it to them would be a different (unreviewed) change.
{
  const closing = parsed.get("agent_closing_replies");
  ok(!!closing && closing.has("paused"), "agent_closing_replies still permits 'paused'");
  for (const t of ["agent_ready_replies", "agent_confirm_replies", "agent_followups"]) {
    const got = parsed.get(t);
    ok(!!got && !got.has("paused"), `${t} did not silently inherit 'paused'`);
  }
}

console.log("\n── THE BUG WAS REAL: the OLD constraint rejected what the code writes ──");
// If this ever stops failing, the baseline above has drifted and every
// assertion in this file is being measured against the wrong ruler.
for (const t of TABLES) {
  ok(!BASELINE[t].includes("dismissed"), `${t}: the pre-migration constraint rejected 'dismissed' (that was the outage)`);
}

// ── scan the REAL api/ source for status writes to these tables ──────────────
// Extracts each `sb(...)` call with a balanced-paren walk that respects string
// and template literals, so a multi-line PATCH body is covered, not just the
// one-liners the writers happen to be today.
function jsFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) jsFiles(p, acc);
    else if (/\.(js|mjs|ts)$/.test(e) && !/\.test\.(mjs|ts)$/.test(e)) acc.push(p);
  }
  return acc;
}

function sbCalls(src) {
  const calls = [];
  const re = /\bsb\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length, depth = 1, q = null;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    calls.push({ text: src.slice(m.index, i), at: src.slice(0, m.index).split("\n").length });
  }
  return calls;
}

const writes = [];     // { file, line, table, value }
const unresolved = []; // { file, line, table, expr }
for (const f of jsFiles(API_DIR)) {
  const src = readFileSync(f, "utf8");
  if (!TABLES.some(t => src.includes(t))) continue;
  for (const call of sbCalls(src)) {
    // The table is the first path segment of the request path argument.
    const tm = call.text.match(/sb\s*\(\s*[`"']\s*(\w+)/);
    const table = tm && tm[1];
    if (!TABLES.includes(table)) continue;
    // Only writes can violate a CHECK. A GET with status=eq.x cannot.
    if (!/method:\s*["'](PATCH|POST|PUT)["']/.test(call.text)) continue;
    for (const sm of call.text.matchAll(/(?:^|[{,\s])status:\s*([^,\n}]+)/g)) {
      const expr = sm[1].trim();
      const lits = [...expr.matchAll(/["']([^"']*)["']/g)].map(x => x[1]);
      const rel = path.relative(path.join(HERE, ".."), f);
      // Every quoted string inside a computed status expression has to be a
      // legal status: a ternary yields one of them, and a comparison against
      // one is meaningless unless it is storable.
      if (lits.length) for (const v of lits) writes.push({ file: rel, line: call.at, table, value: v });
      else unresolved.push({ file: rel, line: call.at, table, expr });
    }
  }
}

console.log(`\n── THE WRITERS: every status literal api/ PATCHes into these tables (${writes.length} found) ──`);
ok(writes.length > 0, "the source scan found status writes at all (a scanner that matches nothing proves nothing)");
{
  const bad = [];
  for (const w of writes) {
    const allowed = parsed.get(w.table);
    if (!allowed || !allowed.has(w.value)) bad.push(`${w.file}:${w.line} writes ${w.table}.status='${w.value}'`);
  }
  const brief = bad.slice(0, 6).join(" | ") + (bad.length > 6 ? ` | (+${bad.length - 6} more)` : "");
  ok(bad.length === 0, `every literal written is permitted after this migration${bad.length ? " - " + brief : ""}`);
  const byTable = {};
  for (const w of writes) (byTable[w.table] ||= new Set()).add(w.value);
  for (const t of TABLES) if (byTable[t]) console.log(`     ${t}: ${show(byTable[t])}`);
}
{
  // Not a failure - a computed status with no literal in it cannot be judged
  // from source. Printed so it is a decision rather than a blind spot.
  if (unresolved.length) {
    console.log("     computed, not checkable from source:");
    for (const u of unresolved) console.log(`       ${u.file}:${u.line} ${u.table}.status = ${u.expr}`);
  }
}

console.log("\n── THE THREE 'Send nothing' WRITERS ARE STILL WHERE WE THINK ──");
// Anchors the scan to the handlers that caused the outage. If a refactor moves
// or renames one, this suite must say so out loud rather than keep passing
// while it silently covers less than it did.
for (const [file, table] of [
  ["agent-approvals.js", "agent_ready_replies"],
  ["agent-confirm.js",   "agent_confirm_replies"],
  ["agent-closing.js",   "agent_closing_replies"],
]) {
  const hit = writes.some(w => w.file.endsWith(file) && w.table === table && w.value === "dismissed");
  ok(hit, `${file} still writes ${table}.status='dismissed' (the "Send nothing" handler)`);
}

console.log("\n── THE READER THAT WAS ALREADY EXPECTING IT ──");
// api/agent-closing.js's dedupe shipped reading 'dismissed' before anything
// could write it. If that filter loses the value, dismissed cards stop counting
// as answered and come back forever - the exact thing 'dismissed' exists to
// prevent, back by a different door.
{
  const closing = readFileSync(path.join(API_DIR, "agent-closing.js"), "utf8");
  ok(/status=in\.\([^)]*dismissed[^)]*\)/.test(closing),
    "agent-closing.js still selects dismissed rows for the re-draft dedupe");
}

// ══ verdict ══
if (MUTATE) {
  console.log(fail
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fail} assertion(s) went red).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative.`);
  process.exit(fail ? 0 : 1);
}
console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
