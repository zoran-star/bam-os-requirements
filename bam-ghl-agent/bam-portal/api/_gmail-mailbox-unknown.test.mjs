// Test for the GHL history cron's Gmail guard
// (api/ghl/cron-import-history.js: gmailMailboxState + importForAcademy).
//
//   node api/_gmail-mailbox-unknown.test.mjs      # exits non-zero on any failure
//
// Plain node, same style as api/_public-ticket-submit.test.mjs: no dependencies,
// no network, no database. globalThis.fetch is replaced by a fake wire, and any
// URL this file did not expect is a hard error rather than a real request.
//
// ─── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
//
// A connected Gmail mailbox IS the academy's email history, and it writes the
// same email_threads/email_messages store the GHL email import writes. Running
// both doubles every email thread, and nothing downstream can tell that it
// happened or which threads are the copies.
//
// The guard that stops that asked Supabase whether a Gmail mailbox is connected
// and answered `true` or `false`. Its catch returned `false`. So a transient
// Supabase error read as "no Gmail connected" and the GHL email import ran on
// top of the live 2-way sync.
//
// That is house rule 10: a yes/no answer that crossed a network boundary must
// have THREE outcomes, not two. Here the third outcome is load-bearing in BOTH
// directions, and this suite pins both:
//
//   1. WE COULD NOT ASK MUST NOT RUN THE IMPORT. Skipping is recoverable by
//      re-running. Duplicating an academy's email history is not recoverable
//      at all, so uncertainty has to fall on the skip side.
//
//   2. WE COULD NOT ASK MUST NOT STAMP THE MARKER. The batch query only ever
//      considers academies whose clients.ghl_history_imported_at IS NULL, so
//      stamping on an unknown would convert one blip into a PERMANENT skip of
//      that academy's email history. That is the same bug pointing the other
//      way, and it is why "treat unknown like yes" is only half the fix.
//
//   3. THE TWO SKIPS MUST BE TELLABLE APART. "skipped because Gmail is
//      connected" means there is nothing to import. "skipped because we could
//      not read the mailbox state" means an import is still owed. An operator
//      who cannot separate those cannot tell a healthy run from a stalled one.
//
// Why this matters right now rather than in the abstract, verified in
// production 2026-07-30: exactly ONE academy has an active Gmail mailbox
// (DETAIL Miami), its ghl_history_imported_at is NULL, and the cron's candidate
// filter is ghl_history_imported_at=is.null. So the only academy this guard
// protects is also one the cron is still targeting, and the exposure is
// one-shot: the next run either skips correctly or duplicates the lot and then
// stamps the marker, removing it from the pool so it never retries.
//
// ─── NEGATIVE CONTROLS ──────────────────────────────────────────────────────
//
// Each writes a mutated copy of the real route next to it, imports that, and
// the suite must NOTICE. A control pinned to text that no longer exists reports
// NEGATIVE CONTROL FAILED rather than passing quietly, because a control that
// cannot find its target is not "caught".
//
//   MUTATE=collapse       node api/_gmail-mailbox-unknown.test.mjs  # the catch goes back to "no" (the original bug)
//   MUTATE=unreadable     node api/_gmail-mailbox-unknown.test.mjs  # an unreadable answer counts as "no"
//   MUTATE=runanyway      node api/_gmail-mailbox-unknown.test.mjs  # unknown runs the email import anyway
//   MUTATE=stamponunknown node api/_gmail-mailbox-unknown.test.mjs  # unknown stamps the marker (permanent skip)
//   MUTATE=samelabel      node api/_gmail-mailbox-unknown.test.mjs  # both skips report the same reason
//   MUTATE=nowarn         node api/_gmail-mailbox-unknown.test.mjs  # the deferral is silent in the logs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = path.join(HERE, "ghl", "cron-import-history.js");
const MUTATE = process.env.MUTATE || "";

// Read at module load by the route, so they have to be set before the import.
process.env.SUPABASE_URL = "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.CRON_SECRET = "stub-cron-secret";
// The allowlist changes which query the batch path builds. Section 6 asserts on
// the plain queue query, so make sure no stray env var is steering it.
delete process.env.IMPORT_PILOT_CLIENT_IDS;

const REST = `${process.env.SUPABASE_URL}/rest/v1/`;
const PROD = "https://portal.byanymeansbusiness.com";
const SMS_IMPORT = `${PROD}/api/messaging/import-ghl-history`;
const EMAIL_IMPORT = `${PROD}/api/messaging/email-import-ghl-history`;

let pass = 0;
const fails = [];
const ok = (c, m) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { fails.push(m); console.log("  ❌ " + m); }
};

// A section that THROWS is a section that noticed something, not a suite that
// died. Without this, a mutation that makes the real code blow up takes the run
// down before the report prints, and CI (which requires the NEGATIVE CONTROL
// PASSED banner and deliberately does not accept a non-zero exit as proof)
// would then call a working control decorative.
async function section(label, fn) {
  console.log(`\n── ${label} ──`);
  try { await fn(); }
  catch (e) { ok(false, `${label}: threw instead of returning a result - ${(e && e.message) || e}`); }
}

// ─── mutated copy, for the negative controls ────────────────────────────────
let controlBroken = null;

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

// Each edit is pinned to the real line it reverts, so it breaks loudly if that
// line is rewritten rather than silently testing nothing. Written as ordinary
// double-quoted strings because the source they match contains backticks.
const EDITS = {
  // The original defect, exactly: a transport failure becomes "no mailbox".
  collapse: [[
    "  } catch (e) {\n    console.warn(`[cron-import-history] client_mailboxes lookup failed for ${clientId}: ${(e && e.message) || e}`);\n    return GMAIL_UNKNOWN;\n  }",
    "  } catch (e) {\n    return GMAIL_NO;\n  }",
  ]],
  // The quieter half of the same defect: a 200 whose body is not a row array
  // (an empty body, a PostgREST error object) counts as proof of absence.
  unreadable: [[
    "    console.warn(`[cron-import-history] client_mailboxes returned an unreadable answer for ${clientId}`);\n    return GMAIL_UNKNOWN;",
    "    return GMAIL_NO;",
  ]],
  // Uncertainty falls on the wrong side: the import runs while we cannot tell
  // whether a Gmail sync is already writing the same store.
  runanyway: [[
    "    email = { done: false, skipped: \"gmail-unknown\" };",
    "    email = await runImportToDone(\"/api/messaging/email-import-ghl-history\", client.id, deadline);",
  ]],
  // The opposite-direction bug: a deferral is recorded as a completed import,
  // which removes the academy from a candidate pool it never comes back to.
  stamponunknown: [[
    "    email = { done: false, skipped: \"gmail-unknown\" };",
    "    email = { done: true, skipped: \"gmail-unknown\" };",
  ]],
  // Both skips report the same reason, so the run says "handled" for an
  // academy whose email history was never imported.
  samelabel: [[
    "skipped: \"gmail-unknown\" };",
    "skipped: \"gmail-connected\" };",
  ]],
  // The deferral happens correctly and tells nobody.
  nowarn: [[
    "    console.warn(`[cron-import-history] ${client.business_name}: Gmail mailbox state UNKNOWN - GHL email import deferred, marker not stamped, will re-ask next run`);",
    "",
  ]],
};

async function loadRoute() {
  const edits = EDITS[MUTATE];
  if (!edits) return import(pathToFileURL(ROUTE).href);
  const src = mutateText(fs.readFileSync(ROUTE, "utf8"), "api/ghl/cron-import-history.js", edits);
  const tmp = path.join(path.dirname(ROUTE), ".mutant-cron-import-history.js");
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of api/ghl/cron-import-history.js that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

// ─── the fake wire ──────────────────────────────────────────────────────────
//
// Every scenario below is a real thing Supabase does. The mailbox lookup is the
// only call whose answer varies; everything else is healthy, so any behaviour
// change this suite sees is attributable to the mailbox state alone.

const MAILBOX_ROW = [{ client_id: "11111111-2222-4333-8444-555555555555" }];

const MAILBOX = {
  // 200 with a row: an active Gmail mailbox exists.
  connected:  () => resp(200, JSON.stringify(MAILBOX_ROW)),
  // 200 with an empty array: we asked, and there is none. The only "no".
  none:       () => resp(200, "[]"),
  // PostgREST/PgBouncer under load. sb() throws on a non-ok response.
  http500:    () => resp(500, '{"message":"canceling statement due to statement timeout","code":"57014"}'),
  // A gateway between us and Supabase.
  http503:    () => resp(503, "upstream connect error or disconnect/reset before headers"),
  // fetch itself rejects: DNS, TLS, connection reset. No response object at all.
  networkdown: () => { throw new TypeError("fetch failed"); },
  // A 200 whose body is empty. sb() returns null for this, which is not a list
  // of zero mailboxes - it is no answer.
  emptybody:  () => resp(200, ""),
  // A 200 carrying a JSON object rather than a row array. Not readable as an
  // answer to "how many mailboxes", and specifically not readable as zero.
  nonarray:   () => resp(200, '{"message":"JWT expired","code":"PGRST301"}'),
};

function resp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

let wire = [];
let mailboxMode = "none";
let clientsList = [];
let logs = [];

const realFetch = globalThis.fetch;
const realLog = console.log;
const realWarn = console.warn;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();
  wire.push({ url: u, method, body: init.body });

  if (u.startsWith(`${REST}client_mailboxes`)) return MAILBOX[mailboxMode]();
  if (u.startsWith(`${REST}clients`)) {
    return method === "GET" ? resp(200, JSON.stringify(clientsList)) : resp(204, "");
  }
  if (u === SMS_IMPORT) return resp(200, JSON.stringify({ done: true, pages: 1, messages_imported: 4 }));
  if (u === EMAIL_IMPORT) return resp(200, JSON.stringify({ done: true, pages: 1, messages_imported: 7 }));
  // Anything else would be a real request leaving this test.
  throw new Error(`unexpected fetch in a no-network suite: ${method} ${u}`);
};

// The route's operator-visible output is part of what is being tested, so it is
// captured rather than printed into the middle of the report.
function captureConsole() {
  logs = [];
  const sink = (...a) => logs.push(a.map(String).join(" "));
  console.log = sink;
  console.warn = sink;
}
function releaseConsole() { console.log = realLog; console.warn = realWarn; }

// DETAIL Miami's shape as read from production on 2026-07-30: an active Gmail
// mailbox and a NULL ghl_history_imported_at at the same time.
const MIAMI = { id: "11111111-2222-4333-8444-555555555555", business_name: "DETAIL Miami" };
const DEADLINE = () => Date.now() + 60_000;

async function runOne(mod, mode, client = MIAMI) {
  wire = [];
  mailboxMode = mode;
  captureConsole();
  try { return { out: await mod.importForAcademy(client, DEADLINE()), wire, logs: logs.slice() }; }
  finally { releaseConsole(); }
}

const calledEmailImport = (w) => w.some((c) => c.url === EMAIL_IMPORT);
const calledSmsImport = (w) => w.some((c) => c.url === SMS_IMPORT);
const stampWrites = (w) => w.filter((c) => c.method === "PATCH" && c.url.startsWith(`${REST}clients`));

// The states where we genuinely could not get an answer. Every one is a thing
// that happens to a healthy system on a bad afternoon.
const OUTAGES = [
  ["Supabase 500 (statement timeout)", "http500"],
  ["a 503 from a gateway in front of Supabase", "http503"],
  ["fetch rejecting outright (DNS/TLS/reset)", "networkdown"],
  ["a 200 with an empty body", "emptybody"],
  ["a 200 carrying an error object instead of rows", "nonarray"],
];

async function main() {
  console.log("\n── The GHL history cron's Gmail guard ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const mod = await loadRoute();

  // ── 1. THE THREE OUTCOMES EXIST AND ARE DISTINCT ──────────────────────────
  await section("Yes, no, and we could not ask are three different answers", async () => {
    ok(typeof mod.gmailMailboxState === "function",
      "the mailbox question is asked by an exported gmailMailboxState, so it can be executed here rather than pattern-matched");
    ok(mod.GMAIL_YES !== mod.GMAIL_NO && mod.GMAIL_NO !== mod.GMAIL_UNKNOWN && mod.GMAIL_YES !== mod.GMAIL_UNKNOWN,
      "the three outcomes are three distinct values, not two with a synonym");

    for (const [label, mode] of [["an active mailbox row", "connected"], ["an empty result", "none"]]) {
      wire = []; mailboxMode = mode;
      captureConsole();
      const state = await mod.gmailMailboxState(MIAMI.id);
      releaseConsole();
      ok(state === (mode === "connected" ? mod.GMAIL_YES : mod.GMAIL_NO),
        `${label} -> ${mode === "connected" ? "yes" : "no"}`);
    }

    for (const [label, mode] of OUTAGES) {
      wire = []; mailboxMode = mode;
      captureConsole();
      const state = await mod.gmailMailboxState(MIAMI.id);
      releaseConsole();
      ok(state === mod.GMAIL_UNKNOWN, `${label} -> unknown`);
      // The whole point. This is the assertion the old code failed.
      ok(state !== mod.GMAIL_NO, `${label} -> is NOT reported as "no mailbox"`);
    }

    // The query itself has to still be the right question, or the three
    // outcomes are three answers to something else.
    wire = []; mailboxMode = "none";
    captureConsole(); await mod.gmailMailboxState(MIAMI.id); releaseConsole();
    const q = wire.find((c) => c.url.startsWith(`${REST}client_mailboxes`));
    ok(!!q, "it asks client_mailboxes");
    ok(q.url.includes("provider=eq.gmail") && q.url.includes("status=eq.active") && q.url.includes(`client_id=eq.${MIAMI.id}`),
      "...for THIS client's active gmail mailbox");
  });

  // ── 2. AN OUTAGE NEVER RUNS THE EMAIL IMPORT ──────────────────────────────
  // The unrecoverable direction. Everything else in this file is secondary.
  await section("We do not import email history we cannot prove is missing", async () => {
    for (const [label, mode] of OUTAGES) {
      const { out, wire: w } = await runOne(mod, mode);
      ok(!calledEmailImport(w), `${label} -> the GHL email import is NOT called`);
      ok(out.email && out.email.done === false, `${label} -> the email step is not reported done`);
      // SMS lives only in GHL and no Gmail sync writes it, so it is unaffected
      // by this question and must keep working. A fix that quietly stopped the
      // SMS import too would pass every assertion above.
      ok(calledSmsImport(w), `${label} -> the SMS import still runs, since a Gmail mailbox has no bearing on it`);
    }
  });

  // ── 3. AN OUTAGE NEVER STAMPS THE MARKER ──────────────────────────────────
  // The opposite-direction bug. A deferral that stamps is a permanent skip.
  await section("A deferral stays a deferral and not a permanent skip", async () => {
    for (const [label, mode] of OUTAGES) {
      const { out, wire: w } = await runOne(mod, mode);
      ok(out.stamped === false, `${label} -> stamped:false`);
      ok(stampWrites(w).length === 0, `${label} -> ghl_history_imported_at is NOT written`);
    }
    // And the thing that makes an unstamped academy actually come back: the
    // batch query filters on the marker being NULL. If that ever changes, "we
    // just re-run next cycle" stops being true and section 2's skip becomes a
    // silent permanent loss instead.
    const src = fs.readFileSync(ROUTE, "utf8");
    ok(src.includes("ghl_history_imported_at=is.null"),
      "the batch candidate query still selects on ghl_history_imported_at IS NULL, so an unstamped academy is re-asked next run");
  });

  // ── 4. THE HEALTHY PATHS ARE UNCHANGED ────────────────────────────────────
  // A guard that skips everything is not a fix, it is an outage of its own.
  await section("A real yes still skips and a real no still imports", async () => {
    {
      const { out, wire: w } = await runOne(mod, "connected");
      ok(!calledEmailImport(w), "Gmail connected -> the GHL email import is skipped (this is the duplication guard doing its job)");
      ok(out.email.skipped === "gmail-connected", "...reported as `gmail-connected`");
      ok(out.stamped === true, "...and the marker IS stamped, because there is nothing left to import");
      const patch = stampWrites(w);
      ok(patch.length === 1 && String(patch[0].body).includes("ghl_history_imported_at"),
        "...by exactly one PATCH carrying ghl_history_imported_at");
    }
    {
      const { out, wire: w } = await runOne(mod, "none");
      ok(calledEmailImport(w), "no Gmail mailbox -> the GHL email history IS imported, which is the whole reason this cron exists");
      ok(out.stamped === true && stampWrites(w).length === 1, "...and the marker is stamped once both imports report done");
    }
  });

  // ── 5. THE SKIP IS VISIBLE, AND VISIBLY DIFFERENT ─────────────────────────
  await section("An operator can tell the two skips apart", async () => {
    const connected = await runOne(mod, "connected");
    const unknown = await runOne(mod, "http500");

    ok(connected.out.email.skipped !== unknown.out.email.skipped,
      "the two skips do not share a reason string: nothing-to-import and could-not-ask are different facts");
    ok(unknown.out.email.skipped === "gmail-unknown", "the uncertain one is reported as `gmail-unknown`");
    ok(unknown.out.gmail === mod.GMAIL_UNKNOWN && connected.out.gmail === mod.GMAIL_YES,
      "the per-academy result carries the mailbox state it acted on");
    ok(unknown.logs.some((l) => /unknown/i.test(l) && /defer/i.test(l)),
      "a deferral writes a log line saying it deferred, so a stalled academy is not silent");
    ok(!unknown.logs.some((l) => /—/.test(l)), "...with no em dash in it");
    ok(!connected.logs.some((l) => /defer/i.test(l)),
      "...and a genuine skip does NOT write that line, so the log separates the two states too");
  });

  // ── 6. END TO END THROUGH THE CRON'S OWN HANDLER ──────────────────────────
  // Sections 2 and 3 test the function. This tests the run: an operator hitting
  // the endpoint during a Supabase blip, against a DETAIL Miami shaped queue.
  await section("A whole run during a mailbox outage", async () => {
    const call = async (mode) => {
      wire = []; mailboxMode = mode; clientsList = [MIAMI];
      const req = { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} };
      let body = null, code = 0;
      const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
      captureConsole();
      try { await mod.default(req, res); } finally { releaseConsole(); }
      return { code, body, wire, logs: logs.slice() };
    };

    const bad = await call("http500");
    ok(bad.code === 200, "the run still completes and reports (a mailbox outage is not a cron failure)");
    ok(!calledEmailImport(bad.wire), "no email import was issued for DETAIL Miami");
    ok(stampWrites(bad.wire).length === 0, "no academy was stamped");
    ok(bad.body.stamped === 0, "...and the run says so: stamped 0");
    ok(bad.body.gmail_unknown_deferred === 1,
      "the run reports 1 academy deferred for an unknown mailbox, distinctly from the stamped count");
    ok(bad.logs.some((l) => /gmail_unknown_deferred=1/.test(l)),
      "...and the summary log line carries it too, for whoever is reading Vercel logs rather than the response");
    const listQ = bad.wire.find((c) => c.method === "GET" && c.url.startsWith(`${REST}clients?`));
    ok(!!listQ && listQ.url.includes("ghl_history_imported_at=is.null"),
      "the candidate query is unchanged, so the deferred academy is still in the pool next run");

    // The recovery. Same academy, same unstamped marker, Supabase healthy: the
    // deferral cost one cycle and nothing else. This is what makes skipping the
    // safe direction rather than merely the cautious one.
    const good = await call("connected");
    ok(good.body.gmail_unknown_deferred === 0, "next run, Supabase healthy -> nothing deferred");
    ok(good.body.stamped === 1 && stampWrites(good.wire).length === 1,
      "...the academy is processed and stamped, so the deferral cost one cycle and no data");
    ok(!calledEmailImport(good.wire),
      "...and it STILL did not run the email import, because the answer was yes all along");
  });

  // ── report ────────────────────────────────────────────────────────────────
  globalThis.fetch = realFetch;

  if (MUTATE) {
    if (controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }

  for (const f of fails) console.log(`\n── FAILED: ${f}`);
  console.log(`\n${fails.length ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fails.length} failed`);
  if (!fails.length) console.log("A Supabase blip cannot duplicate an academy's email history, and cannot permanently skip it either.\n");
  process.exit(fails.length ? 1 : 0);
}

try { await main(); }
catch (e) {
  releaseConsole();
  if (MUTATE && controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  console.log(`\n❌ suite threw: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
