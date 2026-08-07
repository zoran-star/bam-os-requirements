// Can a lead actually be moved from any sales agent to any other one, and can
// that move ever text a parent?
//
//   node api/_agent-move.test.mjs        # exits non-zero on any failure
//
// WHAT THIS FEATURE IS. A Hawkeye card's "Move the lead" section now offers the
// two agents that do not hold this lead (Zoran 2026-08-07, from Ala Babiker at
// BAM GTA: closed lost weeks earlier, sitting in the Booking agent, and the staff
// who could see that had no button to say it). Pressing one moves the
// opportunity, leaves the receiving agent a note, and drafts that agent's first
// card inline.
//
// Plain node, no database, no network, per the CI rule for api/_*.test.mjs. It is
// a paper check, and it checks the three things that would be silent if wrong:
//
//   1. NOTHING ON THIS PATH SENDS. Every card a move produces is `pending` and
//      waits for a human ✓. The hazard is not theoretical: draftForContact's
//      callers in both detectors sit two lines away from a shouldAutoSend branch
//      that texts the parent, and copying one of those branches into a drafter
//      would be invisible in review. So the drafters are read for send verbs and
//      for any status literal other than "pending".
//   2. ALL SIX DIRECTED PAIRS EXIST, EXACTLY ONCE. _hk2Moves is EXECUTED here
//      (extracted from the real client-portal.html and run against stubs), for
//      every agent and every card kind, and the destinations it offers are
//      compared against the three agents. A regex would pass on a button that
//      renders and a filter that removes it; running the function cannot.
//   3. THE KINDS THE DRAFTERS WRITE ARE PERMITTED. agent_confirm_replies and
//      agent_closing_replies both carry an evolving `kind` CHECK. A kind the
//      constraint does not list is a 400 from PostgREST on every single move, on
//      every academy, forever, and nothing else in the repo puts the writer and
//      the constraint in the same room (see api/_dismiss-status.test.mjs, which
//      exists because exactly that shipped once).
//
// NEGATIVE CONTROLS (a check nobody has watched go red is decorative). Each
// rewrites a real file in memory and re-runs everything; the run passes ONLY if
// it prints NEGATIVE CONTROL PASSED. If a control can no longer be applied to the
// current source it exits 2 and says so, rather than proving nothing quietly.
//   MUTATE=autosend   node api/_agent-move.test.mjs
//     Puts a shouldAutoSend branch in the confirm drafter - the "it quietly
//     started texting parents" regression.
//   MUTATE=sentstatus node api/_agent-move.test.mjs
//     Flips one drafted card to status 'sent' - the same failure by another door.
//   MUTATE=dropmove   node api/_agent-move.test.mjs
//     Removes Closing from the front end's destination list - the Ala Babiker
//     dead end, reintroduced.
//   MUTATE=badkind    node api/_agent-move.test.mjs
//     Writes a kind no CHECK constraint permits.
//   MUTATE=selfmove   node api/_agent-move.test.mjs
//     Lets an agent offer a move to itself.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MUTATE = process.env.MUTATE || "";

const AGENTS = ["booking", "confirm", "closing"];
const fail = [];
const note = (ok, msg) => { console.log(`  ${ok ? "✅" : "❌"} ${msg}`); if (!ok) fail.push(msg); };

// ── sources ──────────────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let SRC = {
  move: read("api/agent/_agent-move.js"),
  confirm: read("api/agent-confirm.js"),
  closing: read("api/agent-closing.js"),
  approvals: read("api/agent-approvals.js"),
  portal: read("public/client-portal.html"),
};

// Slice a function body out of a source file by brace matching from its opening
// `{`. Regex cannot do this: every one of these bodies contains braces, strings
// with braces, and template literals with braces.
// The opening `{` is the one AFTER the parameter list, not the first one: these
// functions take a destructured options object, so `src.indexOf("{")` lands
// inside the params and brace-matches shut before the body starts. That mistake
// reads as an EMPTY body, which passes every "contains no send verb" check for
// free - a green test that checks nothing.
function fnBody(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  let i = src.indexOf("(", at);
  if (i < 0) return null;
  for (let p = 0; i < src.length; i++) {
    if (src[i] === "(") p++;
    else if (src[i] === ")") { p--; if (p === 0) { i++; break; } }
  }
  i = src.indexOf("{", i);
  if (i < 0) return null;
  const start = i;
  let depth = 0, inS = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inS) { if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// ── negative controls: rewrite a real source before anything reads it ────────
const CONTROLS = {
  autosend: () => {
    const from = `    } else row = { ...baseRow, kind: "confirm", draft_message: d.reply };`;
    if (!SRC.confirm.includes(from)) return false;
    SRC.confirm = SRC.confirm.replace(from,
      `    } else if (shouldAutoSend(mode, { confidence: d.confidence })) { await sendReplyViaGhl(token, contactId, d.reply, clientId); row = { ...baseRow, kind: "confirm", draft_message: d.reply, auto_sent: true }; }\n    else row = { ...baseRow, kind: "confirm", draft_message: d.reply };`);
    return true;
  },
  sentstatus: () => {
    const from = `      status: "pending", created_by: createdBy,\n    };\n    // The same dispositions the detector recognises, minus its self-drive branches.\n    // Order matches detectForClient: opt-out beats enroll`;
    if (!SRC.closing.includes(from)) return false;
    SRC.closing = SRC.closing.replace(from, from.replace(`status: "pending"`, `status: "sent"`));
    return true;
  },
  dropmove: () => {
    const from = `  const MOVES = r._origKind ? [] : ['booking', 'confirm', 'closing']`;
    if (!SRC.portal.includes(from)) return false;
    SRC.portal = SRC.portal.replace(from, `  const MOVES = r._origKind ? [] : ['booking', 'confirm']`);
    return true;
  },
  badkind: () => {
    const from = `row = { ...baseRow, kind: "confirm_unqualified"`;
    if (!SRC.confirm.includes(from)) return false;
    SRC.confirm = SRC.confirm.replace(from, `row = { ...baseRow, kind: "confirm_wrong_agent"`);
    return true;
  },
  selfmove: () => {
    const from = `    .filter(a => a !== _HK2.agent && !(_HK2.agent === 'confirm' && a === 'booking'))`;
    if (!SRC.portal.includes(from)) return false;
    SRC.portal = SRC.portal.replace(from, `    .filter(a => !(_HK2.agent === 'confirm' && a === 'booking'))`);
    return true;
  },
};
if (MUTATE) {
  if (!CONTROLS[MUTATE]) { console.error(`unknown MUTATE=${MUTATE}. Known: ${Object.keys(CONTROLS).join(", ")}`); process.exit(2); }
  if (!CONTROLS[MUTATE]()) { console.error(`MUTATE=${MUTATE} could not be applied to the current source - the control is stale, so it proves nothing. Fix the control, do not delete it.`); process.exit(2); }
  console.log(`\n(negative control ${MUTATE} applied)\n`);
}

// ── 1. nothing on the move path sends ────────────────────────────────────────
console.log("\n━━━ 1. A move can never text a parent ━━━");

const DRAFTERS = [
  ["draftAndQueueConfirm", fnBody(SRC.confirm, "export async function draftAndQueueConfirm")],
  ["draftAndQueueClosing", fnBody(SRC.closing, "export async function draftAndQueueClosing")],
  ["draftAndQueueRebook", fnBody(SRC.approvals, "export async function draftAndQueueRebook")],
  ["handleAgentMove", fnBody(SRC.move, "export async function handleAgentMove")],
  ["moveLeadToAgent", fnBody(SRC.move, "export async function moveLeadToAgent")],
];
// Every verb that puts words in front of a parent, plus the flag that records
// one having done so.
const SEND_VERBS = ["shouldAutoSend", "shouldAutoSendScripted", "sendReplyViaGhl", "maybeSendSmsViaProvider", "sendSms(", "auto_sent"];
for (const [name, body] of DRAFTERS) {
  if (!body) { note(false, `${name} not found - the test cannot check what it cannot read`); continue; }
  const hits = SEND_VERBS.filter(v => body.includes(v));
  note(hits.length === 0, `${name} contains no send verb${hits.length ? ` (found: ${hits.join(", ")})` : ""}`);
}

// Every status the drafters stamp on a card they create must be "pending". A
// "sent" here is not a send by itself, but it is the row that claims one, and it
// hides the card from the deck that was supposed to approve it.
for (const [name, body] of DRAFTERS.slice(0, 3)) {
  if (!body) continue;
  const statuses = [...body.matchAll(/status:\s*"([a-z_]+)"/g)].map(m => m[1]);
  const bad = [...new Set(statuses)].filter(s => s !== "pending");
  note(statuses.length > 0 && bad.length === 0, `${name} only ever creates pending cards${bad.length ? ` (found: ${bad.join(", ")})` : ""}`);
}

// The source card is swept, never marked sent: a move texts nobody, and a faked
// sent_at row poisons the draft-vs-sent training data (the same rule confirm-lost
// spells out in api/agent-approvals.js).
{
  const body = fnBody(SRC.move, "export async function handleAgentMove") || "";
  const sweeps = [...body.matchAll(/status:\s*"([a-z_]+)"/g)].map(m => m[1]);
  note(sweeps.length > 0 && sweeps.every(s => s === "canceled"), `the source card is canceled, never "sent" (found: ${[...new Set(sweeps)].join(", ") || "nothing"})`);
}

// ── 2. every directed pair exists, exactly once ──────────────────────────────
console.log("\n━━━ 2. Six directed pairs, from the REAL _hk2Moves ━━━");

const movesSrc = fnBody(SRC.portal, "function _hk2Moves(r)");
if (!movesSrc) {
  note(false, "_hk2Moves not found in client-portal.html");
} else {
  // Run the real function against stubs. _HK2.agent is the tab being viewed.
  const _HK2 = { agent: "booking" };
  const _HK2_META = { booking: { label: "Booking" }, confirm: { label: "Confirm" }, closing: { label: "Closing" } };
  // fnBody hands back the BODY, so the declaration is rebuilt around it. Written
  // out rather than relying on a bare block, which would silently run the body
  // against the outer scope and look like it worked.
  const call = (agent, r) => {
    _HK2.agent = agent;
    return new Function("_HK2", "_HK2_META", "_hk2MoveLabel", "r",
      `function _hk2Moves(r) ${movesSrc}\nreturn _hk2Moves(r);`)(
      _HK2, _HK2_META, (op) => `label-${op}`, r);
  };
  // Every kind a real card can carry. 'form' returns early by design (the
  // post-trial form has its own menu) and is asserted separately.
  const KINDS = ["reply", "book", "ghost", "handoff", "enroll", "plan", "lost", "unqualified", "reignite", "reignite_due"];
  const destOf = (op) => (op === "handoff" ? "booking" : (op.slice(0, 3) === "mv:" ? op.slice(3) : null));

  const pairs = new Set();
  let dupes = 0, selfMoves = 0, unknown = 0;
  for (const agent of AGENTS) {
    for (const k of KINDS) {
      const ops = call(agent, { _kind: k, draft_message: "hi" }).map(([, op]) => op);
      const dests = ops.map(destOf).filter(Boolean);
      if (new Set(dests).size !== dests.length) dupes++;
      for (const d of dests) {
        if (d === agent) selfMoves++;
        else if (!AGENTS.includes(d)) unknown++;
        else pairs.add(`${agent}->${d}`);
      }
    }
  }
  const want = AGENTS.flatMap(a => AGENTS.filter(b => b !== a).map(b => `${a}->${b}`));
  const missing = want.filter(p => !pairs.has(p));
  note(missing.length === 0, `all six directed pairs are reachable${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  note(selfMoves === 0, `no agent offers a move to itself${selfMoves ? ` (${selfMoves} found)` : ""}`);
  note(unknown === 0, `no move names an agent that does not exist${unknown ? ` (${unknown} found)` : ""}`);
  note(dupes === 0, `no card offers the same destination twice${dupes ? ` (${dupes} cards do)` : ""}`);

  // The post-trial form keeps its own separate "Other outcomes" menu.
  const formOps = call("booking", { _kind: "form" }).map(([, op]) => op);
  note(formOps.every(op => destOf(op) === null), `the post-trial form menu is untouched (${formOps.join(", ")})`);

  // A card mid-way through Book it / Reignite later offers no move.
  const transient = call("booking", { _kind: "book", _origKind: "reply" }).map(([, op]) => op);
  note(transient.every(op => destOf(op) === null), "a card in a transient local mode offers no move");

  // Confirm -> Booking must be the OLDER handoff, not a duplicate mv: button.
  const confirmOps = call("confirm", { _kind: "reply", draft_message: "hi" }).map(([, op]) => op);
  note(confirmOps.includes("handoff") && !confirmOps.includes("mv:booking"),
    "confirm -> booking reuses the existing handoff rather than duplicating it");

  // Whatever ops the buttons emit, _hk2Move must handle them.
  const moveFn = fnBody(SRC.portal, "function _hk2Move(op, btn)") || "";
  note(/op\.slice\(0,\s*3\)\s*===\s*'mv:'/.test(moveFn), "_hk2Move recognises the mv: prefix");
  note(moveFn.includes("_hk2DoAgentMove("), "_hk2Move routes a move through _hk2DoAgentMove");
}

// ── 3. every agent API registers move-agent, as itself ───────────────────────
console.log("\n━━━ 3. All three APIs accept the move ━━━");
for (const [agent, key] of [["booking", "approvals"], ["confirm", "confirm"], ["closing", "closing"]]) {
  const src = SRC[key];
  const has = src.includes(`b.action === "move-agent"`);
  const asSelf = new RegExp(`handleAgentMove\\([^)]*fromAgent:\\s*"${agent}"`).test(src);
  note(has && asSelf, `api/agent-${key === "approvals" ? "approvals" : key}.js handles move-agent as "${agent}"`);
}

// ── 4. the kinds the drafters write are permitted by the real CHECKs ─────────
console.log("\n━━━ 4. Kinds the database will actually accept ━━━");

// Replay every migration in filename (= apply) order and keep the LAST value list
// each table's kind CHECK was given.
function permittedKinds() {
  const dir = join(ROOT, "supabase/migrations");
  const out = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    // create table ... kind ... check (kind in ('a','b'))
    for (const m of sql.matchAll(/create table[^;]*?public\.(agent_\w+_replies)[\s\S]*?check\s*\(\s*kind\s+in\s*\(([^)]*)\)/gi)) {
      out[m[1]] = new Set([...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]));
    }
    // alter table ... add constraint <t>_kind_check check (kind in (...))
    for (const m of sql.matchAll(/alter table\s+public\.(agent_\w+_replies)\s+add constraint\s+\w*kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/gi)) {
      out[m[1]] = new Set([...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]));
    }
  }
  return out;
}
const KIND_CHECK = permittedKinds();
for (const [fnName, key, table] of [
  ["draftAndQueueConfirm", "confirm", "agent_confirm_replies"],
  ["draftAndQueueClosing", "closing", "agent_closing_replies"],
]) {
  const body = fnBody(SRC[key], `export async function ${fnName}`);
  const allowed = KIND_CHECK[table];
  if (!body || !allowed || !allowed.size) { note(false, `${table}: could not read the drafter or its CHECK constraint`); continue; }
  const written = [...new Set([...body.matchAll(/kind:\s*"([a-z_]+)"/g)].map(m => m[1]))];
  const rejected = written.filter(k => !allowed.has(k));
  note(written.length > 0 && rejected.length === 0,
    `${table} permits every kind the drafter writes: ${written.join(", ")}${rejected.length ? ` (REJECTED: ${rejected.join(", ")})` : ""}`);
}
// agent_ready_replies has no kind CHECK, so the booking side has nothing to fail
// on. Asserted rather than assumed, so this stays true if one is ever added.
note(!KIND_CHECK.agent_ready_replies, "agent_ready_replies still has no kind CHECK (the booking drafter is unconstrained)");

// ── result ───────────────────────────────────────────────────────────────────
if (MUTATE) {
  if (fail.length) { console.log(`\nNEGATIVE CONTROL PASSED - ${MUTATE} was caught by ${fail.length} check(s).\n`); process.exit(0); }
  console.log(`\nNEGATIVE CONTROL FAILED - ${MUTATE} slipped through every check. The suite is not testing what it claims.\n`);
  process.exit(1);
}
if (fail.length) { console.log(`\n❌ ${fail.length} failed:\n${fail.map(f => "  - " + f).join("\n")}\n`); process.exit(1); }
console.log("\n✅ All checks passed. Any agent can hand a lead to any other, and none of it sends.\n");
