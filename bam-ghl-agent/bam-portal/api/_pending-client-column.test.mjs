// NAMING A COLUMN THAT DOES NOT EXIST YET.
//
//   node api/_pending-client-column.test.mjs
//
// WHAT WAS WRONG, AND WHY THIS SUITE HAD TO EXIST BEFORE THE CHANGE DID.
// api/automations.js:loadClient carries a rule written after a real incident: a column
// joins that select list AFTER its migration is live, never in the same commit,
// because PostgREST 400s the WHOLE select over one unknown column. That read feeds
// EVERY channel, so the blast radius is not "email is degraded" - it is the worker
// throwing on every job, SMS included. api/agent-confirm.js:loadClient and
// api/_send.js:clientSender have the same exposure, and clientSender's is the
// nastiest: it THROWS into a branch that holds the send WITHOUT texting the owner, so
// a 400 there stops every academy's automation email silently.
//
// clients.business_email (migration 20260729T210000) had to go into all three lists
// while that migration was STILL UNAPPLIED. So the lists grew a pending-column retry,
// and this suite is the thing that says the retry is real. Before it was written,
// NOTHING in the repo caught this: business_email was added to loadClient with no
// retry at all and every existing suite stayed green, because the two callers
// api/_arming-gate.test.mjs happens to drive wrap loadClient in `.catch(() => null)`
// and its schema-accurate stub's 400 was swallowed on the way past.
//
// THE SHAPE, which is the Business Basics card's (_bbHydrateClientCols in
// public/client-portal.html): ask for the column, and on the ONE error that means
// "not migrated yet" ask again without it. What comes back is a row missing the key,
// which is byte-identical to the state every consumer already handles.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES, in BOTH schema states, against the real modules
//   1. All three selects NAME business_email, and post-migration the value lands on
//      the row / on the wire.
//   2. PRE-migration (production as of 2026-07-29) the select does NOT go down: the
//      row still comes back with every other column, and business_email is ABSENT
//      from it rather than faked as null - which is what keeps the downstream hold
//      behaviour exactly what it was.
//   3. The retry is NARROW. A transient 5xx, and a 42703 blaming a column that is NOT
//      pending, both still THROW. A retry-on-anything would hold an academy's email
//      over an outage and text its owner to go fix a field they already filled in.
//   4. The downstream behaviour is unchanged in both states: pre-migration a send
//      HOLDS and the owner IS texted; post-migration it goes out carrying the address.
//
// WHAT IT DOES NOT PROVE
//   - That the REST of either loadClient list matches the real schema. A typo in
//     `google_review_url` would 400 identically and nothing here or elsewhere would
//     say so: api/_arming-gate.test.mjs owns the schema-accurate clients stub, but
//     the loadClient callers it drives swallow the failure. That gap is older than
//     this change and is not closed by it.
//   - That the migration is applied. It is not. This suite is exactly why shipping
//     ahead of it is survivable, not a claim that it landed.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=nocolumn   node api/_pending-client-column.test.mjs  # business_email out
//                                                              # of all three lists
//   MUTATE=noretry    node api/_pending-client-column.test.mjs  # the pending-column
//                                                              # retry removed, so a
//                                                              # 400 kills the select
//   MUTATE=peelone   node api/_pending-client-column.test.mjs  # retry drops only the
//                                                              # column Postgres NAMED,
//                                                              # lethal at two pending
//   MUTATE=blindretry node api/_pending-client-column.test.mjs  # retry on ANY error,
//                                                              # so an outage silently
//                                                              # degrades the row

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ─── the schema switch ───────────────────────────────────────────────────────
// "pre" is production as of 2026-07-29: migration 20260729T210000 is written, sitting
// in supabase/PENDING_SQL.md, and NOT applied. "post" is after it lands. Every claim
// below is made in both states, because a change that is only correct in one of them
// is a change that breaks on the way in or on the way out.
let SCHEMA = "post";
let CLIENT_SELECTS = [];        // every clients select the code under test issued
let FORCE_ERROR = null;         // { status, body } - stands in for an outage

// PostgREST's own 42703 body, because that exact string is what the retry reads to
// tell "this migration has not landed" apart from "the database is unwell". A
// prettier stub error would test the stub, not the code.
const pgUndefinedColumn = (col) => new Response(JSON.stringify({
  code: "42703", details: null, hint: null,
  message: `column clients.${col} does not exist`,
}), { status: 400, headers: { "content-type": "application/json" } });

// One fixture row wide enough for every clients read on these paths - the two
// loadClient lists, clientSender's, and notifyOwners'. Answers are PROJECTED to the
// columns the select actually asked for, so a column left out of a list is absent
// from the row, and "the code asked for it" cannot be confused with "the stub handed
// it over anyway".
const ACADEMY = {
  id: "acad-0001", business_name: "Northside Basketball", public_name: "Northside Hoops",
  owner_name: "Dana Cruz", email: "dana@ownerinbox.example", phone: "+15550002222",
  address: "1 Court Way", time_zone: "America/New_York",
  website_setup: { domain: "northside.example" },
  community_group_url: "https://chat.example/northside", community_group_platform: "whatsapp",
  google_review_url: "https://g.page/northside", online_programs_url: null, referral_offer: null,
  ghl_location_id: "loc-1", ghl_access_token: "tok-1", ghl_refresh_token: "ref-1",
  ghl_token_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  ghl_kpi_config: {}, booking_provider: "ghl",
  email_domain: "northside.example",
  v2_access: true, v15_access: false, notification_prefs: {},
  onboarding_setup: { owner_phone: "+15550001111" },
  // The value under test. Present in the FIXTURE in both schema states; whether the
  // code can READ it is what SCHEMA decides.
  business_email: "info@northside.example",
};
// Which pending columns production does NOT have. `let`, because section 5 widens it
// to two to prove the retry survives a SECOND pending column - the case that was
// silently lethal before the whole-list drop landed.
let PENDING_IN_PROD = ["business_email"];

// ─── the stubbed wire ────────────────────────────────────────────────────────
let WIRE = null;                 // what reached Resend
let SMS = [];                    // owner notifications that went out
let EVENTS = [];                 // email_events rows written

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const body = init.body ? JSON.parse(init.body) : null;

  if (u.includes("/rest/v1/clients?")) {
    const sel = new URL(u).searchParams.get("select") || "";
    const cols = sel.split(",").map((s) => s.trim()).filter(Boolean);
    CLIENT_SELECTS.push(sel);
    if (FORCE_ERROR) return new Response(FORCE_ERROR.body, { status: FORCE_ERROR.status, headers: { "content-type": "application/json" } });
    if (SCHEMA === "pre") {
      const missing = cols.find((c) => PENDING_IN_PROD.includes(c));
      if (missing) return pgUndefinedColumn(missing);
    }
    return json([Object.fromEntries(cols.filter((c) => c in ACADEMY).map((c) => [c, ACADEMY[c]]))]);
  }

  if (u === "https://api.resend.com/emails" && method === "POST") { WIRE = { subject: body.subject, html: body.html, from: body.from }; return json({ id: "stub-email" }); }
  if (u === "https://api.resend.com/domains") return json({ data: [{ name: ACADEMY.email_domain, status: "verified" }] });
  if (u.includes("/conversations/messages") && method === "POST") { SMS.push(body.message); return json({ messageId: "stub-sms" }); }
  if (u.includes("services.leadconnectorhq.com/contacts/")) return json({ contacts: [{ id: "stub-owner-contact" }] });
  if (u.includes("/rest/v1/email_events") && method === "POST") { EVENTS.push(body[0]); return json([{ id: "ev-" + (EVENTS.length) }]); }
  if (u.includes("/rest/v1/email_events") && method === "DELETE") return json(null);
  if (u.includes("/rest/v1/email_events")) return json([]);
  if (u.includes("/rest/v1/email_suppressions")) return json([]);
  if (u.includes("/rest/v1/client_users")) return json([{ id: "cu-1", name: "Owner", phone: "+15550001111", role: "owner" }]);
  if (u.includes("/rest/v1/messages") && method === "POST") return json([{ id: "m-1" }]);
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── the modules under test, as themselves ───────────────────────────────────
//
// A CONTROL THAT CANNOT FIND ITS TARGET IS NOT "CAUGHT" - same contract as
// api/_arming-gate.test.mjs. A mutation pinned to text that has moved makes the suite
// throw, and a run keyed on "did it fail?" would score that as a working control. So a
// missing pin sets controlBroken, and the footer turns that into NEGATIVE CONTROL
// FAILED with the reason.
//
// loadClient is module-private in both files and is not exported for a test's
// convenience. The copy imported here is the real file, byte for byte, plus one
// appended export line - so what runs below is the shipped select list and the shipped
// retry, not a paraphrase of them.
let controlBroken = null;
let copyCount = 0;
async function moduleWithLoadClient(rel, edits = []) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  const pins = [["async function loadClient(clientId) {", null], ...edits];
  for (const [find, repl] of pins) {
    if (!src.includes(find)) {
      controlBroken = `${MUTATE ? `MUTATE=${MUTATE}` : "This suite"} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so it proves nothing. Re-point it at the current code, or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    if (repl !== null) src = src.split(find).join(repl);
  }
  src += "\nexport { loadClient as __loadClient };\n";
  const tmp = path.join(path.dirname(abs), `.pendingcol-${++copyCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `the copy of api/${rel} does not import: ${e && e.message}`;
    throw e;
  } finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

// The three mutations, expressed against the real source text.
//   nocolumn   - business_email leaves the pending list. The select stops asking for
//                it, the row never carries it, and every academy's email holds forever
//                with no way to fix it. This is the "did the change even happen" check.
//   noretry    - the retry is removed and the original error rethrown. This is the
//                shipped-without-a-net version: pre-migration it 400s the whole select.
//   blindretry - the retry fires on ANY error. Looks strictly safer. It is not: an
//                outage now silently returns a row with no business_email, which holds
//                the academy's email and texts its owner about a field that is fine.
const NOCOLUMN = (constName) => [[`const ${constName} = ["business_email"];`, `const ${constName} = [];`]];
const NORETRY = [[
  "    const blamed = pendingColsBlamedBy(e);\n    if (!blamed.length) throw e;",
  "    const blamed = [];\n    if (!blamed.length) throw e;"]];
const BLINDRETRY = (constName) => [[
  `  if (!/42703|does not exist/i.test(msg)) return [];\n  return ${constName}.filter((c) => msg.includes(c));`,
  `  return ${constName};`]];

// peelone - the retry drops only the column PostgREST NAMED instead of the whole
// pending list. That is how this shipped, and it was safe for exactly one pending
// column: Postgres reports only the FIRST unknown column in a select, so a second
// pending column 400s the retry, and the retry's read is the last statement in the
// catch - so that throw escapes loadClient, whose worker callers have no catch.
// Every automation stops, SMS included. Safe at one, lethal at two, which is the
// worst number to be safe up to. Section 5 is what catches it.
const PEELONE = (constName) => [[
  `rows = await read(cols.filter((c) => !${constName}.includes(c)));`,
  `rows = await read(cols.filter((c) => !blamed.includes(c)));`]];

function editsFor(constName) {
  if (MUTATE === "nocolumn") return NOCOLUMN(constName);
  if (MUTATE === "noretry") return NORETRY;
  if (MUTATE === "blindretry") return BLINDRETRY(constName);
  if (MUTATE === "peelone") return PEELONE(constName);
  return [];
}

// Modules whose pending list holds TWO columns, for section 5.
//
// NOCOLUMN is deliberately excluded rather than composed: it rewrites the same const
// line TWO does, so applying both leaves the second pinned to text the first already
// replaced - and this suite treats a pin that cannot find its target as a FAILURE,
// not a pass, which is why the clash surfaced loudly instead of scoring green. Its
// claim ("the column is in the real lists") is about the real modules anyway, so
// section 5 has nothing to add to it.
const TWO = (constName) => [[`const ${constName} = ["business_email"];`,
                             `const ${constName} = ["business_email", "instagram_url"];`]];
const SKIP_SECTION_5 = MUTATE === "nocolumn";
function twoColEdits(constName) {
  return TWO(constName).concat(editsFor(constName));
}

const AUTOMATIONS = await moduleWithLoadClient("automations.js", editsFor("CLIENT_COLS_PENDING"));
const CONFIRM = await moduleWithLoadClient("agent-confirm.js", editsFor("CLIENT_COLS_PENDING"));

// _send.js is reached through its public door (sendOn), so no export is appended -
// only the mutations, and only when there is one to apply.
async function sendModule() {
  const edits = MUTATE === "nocolumn" ? NOCOLUMN("SENDER_COLS_PENDING") : editsFor("SENDER_COLS_PENDING");
  if (!edits.length) return import("./_send.js");
  const abs = path.join(HERE, "_send.js");
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/_send.js:\n\n${find}\n\nRe-point it or delete it.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.pendingcol-${++copyCount}-_send.js`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}
const { sendOn } = await sendModule();

const reset = () => { CLIENT_SELECTS = []; FORCE_ERROR = null; WIRE = null; SMS = []; EVENTS = []; };
const LOADERS = [
  ["api/automations.js", AUTOMATIONS.__loadClient],
  ["api/agent-confirm.js", CONFIRM.__loadClient],
];

// ─── 1. post-migration: the column is asked for, and it arrives ───────────────
console.log("\n── 1. both loadClient selects NAME business_email, and it lands on the row ──");
SCHEMA = "post";
for (const [label, loadClient] of LOADERS) {
  reset();
  let row = null, threw = null;
  try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!threw, `${label}: the select succeeds${threw ? ` (threw ${threw.message})` : ""}`);
  const asked = String(CLIENT_SELECTS[0] || "").split(",").map((s) => s.trim());
  ok(asked.includes("business_email"), `${label}: the select list NAMES business_email`);
  ok(!!row && row.business_email === ACADEMY.business_email,
    `${label}: and the academy's public email is on the returned row`);
  // The point of the column: it must not be the owner's inbox, in any state.
  ok(!!row && row.business_email !== ACADEMY.email, `${label}: which is not clients.email`);
  ok(CLIENT_SELECTS.length === 1, `${label}: one read, no retry needed (saw ${CLIENT_SELECTS.length})`);
  // The rest of the list still has to be there. A "safe" change that quietly dropped
  // the parent-facing facts would hold nothing and break every message's identity.
  ok(!!row && row.public_name === ACADEMY.public_name && row.business_name === ACADEMY.business_name,
    `${label}: the parent-facing identity columns came back too`);
}

// ─── 2. pre-migration: a 400 on the pending column takes NOTHING down ─────────
console.log("\n── 2. with the migration UNAPPLIED the select survives, minus that one key ──");
SCHEMA = "pre";
for (const [label, loadClient] of LOADERS) {
  reset();
  let row = null, threw = null;
  try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!threw, `${label}: the 400 does NOT propagate${threw ? ` (threw ${threw.message})` : ""}`);
  ok(!!row, `${label}: a row still comes back (this is the SMS path staying up)`);
  ok(!!row && !("business_email" in row),
    `${label}: business_email is ABSENT from the row, not faked as null or as clients.email`);
  ok(!!row && row.public_name === ACADEMY.public_name && row.ghl_access_token === ACADEMY.ghl_access_token,
    `${label}: every other column is intact, so nothing else degraded`);
  ok(CLIENT_SELECTS.length === 2,
    `${label}: exactly one retry, not a per-column crawl (saw ${CLIENT_SELECTS.length} reads)`);
  const second = String(CLIENT_SELECTS[1] || "").split(",").map((s) => s.trim());
  ok(!second.includes("business_email"), `${label}: the retry drops ONLY the column PostgREST named`);
  ok(second.includes("public_name") && second.includes("ghl_kpi_config"),
    `${label}: and keeps everything else it was already asking for`);
}

// ─── 3. the retry is narrow: an outage is still an outage ─────────────────────
console.log("\n── 3. only a 42703 naming a PENDING column earns the retry ──");
SCHEMA = "post";
for (const [label, loadClient] of LOADERS) {
  // A transient 5xx. Retrying here would hand back a row with no business_email and
  // hold the academy's email over a database blip - then text the owner to go fill in
  // a field that is already filled in. Fail closed and LOUD instead.
  reset();
  FORCE_ERROR = { status: 503, body: JSON.stringify({ message: "upstream unavailable" }) };
  let threw = null;
  try { await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!!threw, `${label}: a 503 still THROWS rather than degrading the row`);
  ok(CLIENT_SELECTS.length === 1, `${label}: and is not retried (saw ${CLIENT_SELECTS.length} read(s))`);

  // A 42703 blaming a column that is NOT on the pending list is a real bug - a typo,
  // or a column added to the base list ahead of its own migration. Dropping it
  // silently would be the false green this whole suite exists to refuse.
  reset();
  FORCE_ERROR = { status: 400, body: JSON.stringify({ code: "42703", message: "column clients.gogle_review_url does not exist" }) };
  threw = null;
  try { await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!!threw, `${label}: a 42703 blaming a NON-pending column also THROWS`);
  ok(CLIENT_SELECTS.length === 1, `${label}: and is not retried either`);
}
reset();

// ─── 4. the send path: same two states, unchanged behaviour ───────────────────
console.log("\n── 4. api/_send.js: pre-migration HOLDS and tells the owner, post-migration sends ──");
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot is held for this week.\n\nSee you at training.";
const sendFor = async (clientId) => {
  reset();
  return sendOn({ channel: "email", clientId, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars: {} });
};
{
  SCHEMA = "post";
  const r = await sendFor("post-migration-academy");
  ok(!!r.sent, `with the column readable the send goes out (${JSON.stringify(r)})`);
  const asked = String(CLIENT_SELECTS[0] || "").split(",").map((s) => s.trim());
  ok(asked.includes("business_email") && asked.includes("email_domain"),
    `the sender select names business_email alongside the sending domain (${CLIENT_SELECTS[0]})`);
  ok(WIRE && WIRE.html.includes(`href="mailto:${ACADEMY.business_email}?subject=Unsubscribe"`),
    "and the bytes on the wire carry it as the unsubscribe");
  ok(WIRE && !WIRE.html.includes(ACADEMY.email), "and the owner's inbox is nowhere in it");
}
{
  // Production TODAY. This is the state that must be survivable, and "survivable"
  // means EXACTLY what it meant before the fold: the email holds, nothing generic
  // goes out, and the owner is told which field to fill in. A hold that does not
  // notify - which is what an uncaught 400 in clientSender would produce - looks
  // identical from the outside and leaves the academy silent indefinitely.
  SCHEMA = "pre";
  const r = await sendFor("pre-migration-academy");
  ok(!!r.held, `with the migration unapplied the send HOLDS (${JSON.stringify(r)})`);
  ok(/unsubscribe/i.test(String(r.held || "")), "for the business-email reason, not the sending-domain one");
  ok(WIRE === null, "nothing reached Resend");
  ok(EVENTS.some((e) => e.type === "business_email_hold_notice"), "the hold was stamped as the business-email hold");
  ok(SMS.some((m) => /public email/i.test(m)), "and the owner WAS texted about the missing public email");
  ok(!SMS.some((m) => m.includes(ACADEMY.email)), "without being pointed at their own inbox");
  ok(CLIENT_SELECTS.filter((s) => s.includes("email_domain")).length === 2,
    `the sender read retried once and stopped (saw ${CLIENT_SELECTS.filter((s) => s.includes("email_domain")).length})`);
}

// ─── 5. TWO pending columns, which is where the first version died ────────────
console.log("\n── 5. a SECOND pending column does not take the select down ──");
if (SKIP_SECTION_5) console.log("  (skipped under MUTATE=nocolumn - see the note on TWO)");
else
// This is not hypothetical. A second migration adding `tagline` and `instagram_url`
// landed the same evening, and the obvious next step - park them in the pending list
// beside business_email - would have stopped every automation. Postgres names only
// the first unknown column, so peeling off just the named one leaves the retry
// asking for a column that still does not exist, and that second throw escapes.
{
  const A2 = await moduleWithLoadClient("automations.js", twoColEdits("CLIENT_COLS_PENDING"));
  const C2 = await moduleWithLoadClient("agent-confirm.js", twoColEdits("CLIENT_COLS_PENDING"));
  const prev = PENDING_IN_PROD;
  PENDING_IN_PROD = ["business_email", "instagram_url"];   // production has NEITHER
  SCHEMA = "pre";
  for (const [label, loadClient] of [["api/automations.js", A2.__loadClient], ["api/agent-confirm.js", C2.__loadClient]]) {
    reset();
    let row = null, threw = null;
    try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
    ok(!threw, `${label}: TWO missing columns still do not propagate${threw ? ` (threw ${threw.message})` : ""}`);
    ok(!!row, `${label}: a row comes back, so the worker and SMS stay up`);
    const last = String(CLIENT_SELECTS[CLIENT_SELECTS.length - 1] || "").split(",").map((s) => s.trim());
    ok(!last.includes("business_email") && !last.includes("instagram_url"),
      `${label}: the retry drops the WHOLE pending list, not just the one Postgres named`);
    ok(last.includes("public_name") && last.includes("ghl_access_token"),
      `${label}: and keeps every column that does exist`);
    ok(CLIENT_SELECTS.length === 2,
      `${label}: still exactly one retry, no per-column crawl (saw ${CLIENT_SELECTS.length})`);
  }
  PENDING_IN_PROD = prev;
  SCHEMA = "post";
}

console.log("");
if (MUTATE) {
  if (controlBroken) {
    console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
