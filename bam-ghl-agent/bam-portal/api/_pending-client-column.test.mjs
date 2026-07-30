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
// ⚠️ WHY THIS SUITE NOW INJECTS A SYNTHETIC PENDING COLUMN (30 Jul 2026)
//
// All three migrations are applied. business_email, tagline and instagram_url have
// moved up into the MAIN select lists, and both `*_COLS_PENDING` arrays plus
// `SENDER_COLS_PENDING` are EMPTY - intentionally empty, and intentionally not
// deleted, because that list plus its retry is how the NEXT column ships ahead of its
// migration.
//
// A suite that proved the retry works BY POINTING AT business_email would now be
// proving nothing: with the list empty there is no column to drop and every path it
// used to exercise is dead. Deleting the suite instead would leave the mechanism live
// and unproven until the day somebody needs it under pressure - which is exactly when
// the version that peels off only the column PostgREST NAMED gets written back in.
//
// So the pending list is INJECTED. Sections 2, 3b and 5 run against copies of the real
// files whose pending array holds one (or two) columns that exist in NO schema:
// SYNTH_A / SYNTH_B below. Everything else about those copies is the shipped code -
// the shipped select list and the shipped retry, byte for byte. What is under test is
// the MECHANISM, which is what it always was; only the column it is aimed at is now
// this suite's own rather than a real one that happens to be unapplied.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. The three columns that regressed are in the MAIN lists now, on the real
//      modules, with no retry involved - one read, and the values land on the row.
//      And both pending arrays are EMPTY, so nothing is paying the wasted-400 cost.
//   2. With a column in the pending list that production does NOT have, the select
//      does not go down: the row still comes back with every other column, and the
//      pending column is ABSENT from it rather than faked as null.
//   3. The retry is NARROW. A transient 5xx, and a 42703 blaming a column that is NOT
//      pending, both still THROW. With the pending list EMPTY that means every 42703
//      throws, which is the correct answer now: a 42703 today is a typo or a column
//      added ahead of its own migration, not a state to degrade past.
//   4. The send path's guarantees, which are the ones with a parent on the other end:
//      a readable business_email SENDS and the address is on the wire; an EMPTY one
//      HOLDS, stamps the hold and texts the owner; and a pending column that is NOT
//      business_email holds nothing at all.
//   5. TWO pending columns do not take the select down. Postgres reports only the
//      FIRST unknown column in a select, so peeling off just the blamed one leaves the
//      retry asking for a column that still does not exist - and the retry's read is
//      the last statement in the catch, so that throw ESCAPES loadClient, whose worker
//      callers have no catch. Every automation stops, SMS included: the exact incident
//      this mechanism prevents, through the mechanism itself. Safe at one and lethal
//      at two, which is the worst possible number to be safe up to.
//
// WHAT IT DOES NOT PROVE
//   - That the REST of either loadClient list matches the real schema. A typo in
//     `google_review_url` would 400 identically and nothing here or elsewhere would
//     say so: api/_arming-gate.test.mjs owns the schema-accurate clients stub, but
//     the loadClient callers it drives swallow the failure. That gap is older than
//     this change and is not closed by it.
//   - That the main lists COVER what the email layer reads. That is the bug that
//     actually shipped, and it has its own suite:
//     api/_email-select-coverage.test.mjs derives the required set from clientVars()'s
//     source and renders the result. Section 1 here only checks the three columns by
//     name, which is the instance, not the class.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=nocolumn   node api/_pending-client-column.test.mjs  # the three columns
//                                                              # leave the MAIN lists -
//                                                              # the live regression of
//                                                              # 29 Jul, restored
//   MUTATE=noinject   node api/_pending-client-column.test.mjs  # the pending list stays
//                                                              # empty while production
//                                                              # still lacks the column,
//                                                              # i.e. the mechanism is
//                                                              # not used at all
//   MUTATE=noretry    node api/_pending-client-column.test.mjs  # the retry removed, so a
//                                                              # 400 kills the select
//   MUTATE=peelone    node api/_pending-client-column.test.mjs  # retry drops only the
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

// ─── the synthetic pending columns ───────────────────────────────────────────
// Deliberately not real column names, and deliberately not plausible ones. Whatever
// ships next goes in the real pending list with its migration file on a comment line;
// these two exist ONLY so the mechanism has something to be aimed at that no schema
// will ever quietly start having. If either ever becomes a real column, this suite
// stops testing anything and section 2 will say so by passing for the wrong reason -
// so pick another name rather than adding one of these to `clients`.
const SYNTH_A = "not_a_real_column_a";
const SYNTH_B = "not_a_real_column_b";

// The three columns that regressed on 29 Jul 2026: read by clientVars(), named in no
// select list, so they arrived undefined and rendered as nothing.
const MOVED_UP = ["business_email", "tagline", "instagram_url"];

// ─── the stubbed wire ────────────────────────────────────────────────────────
let CLIENT_SELECTS = [];        // every clients select the code under test issued
let FORCE_ERROR = null;         // { status, body } - stands in for an outage
let MISSING_IN_PROD = [];       // columns the stub schema does NOT have
let WIRE = null;                // what reached Resend
let SMS = [];                   // owner notifications that went out
let EVENTS = [];                // email_events rows written

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
  // The three that moved up into the main lists on 30 Jul 2026. Present in the fixture
  // so section 1 can say they LAND, not merely that they were asked for.
  business_email: "info@northside.example",
  tagline: "Skills training for Northside athletes.",
  instagram_url: "https://instagram.com/northsidehoops",
};
// The same academy with NO public email on file, which is the real-world shape of the
// hold: an owner who has not typed the address into their portal yet. Nothing to do
// with schema state, which is the point - this guarantee has to survive the pending
// list being empty.
const NO_PUBLIC_EMAIL_ID = "acad-no-public-email";

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
    // Postgres names only the FIRST unknown column in a select. `find` walks the
    // select in order, which is what makes section 5's claim faithful rather than
    // convenient: a stub that listed all of them would let `peelone` pass.
    const missing = cols.find((c) => MISSING_IN_PROD.includes(c));
    if (missing) return pgUndefinedColumn(missing);
    const row = u.includes(`id=eq.${NO_PUBLIC_EMAIL_ID}`) ? { ...ACADEMY, business_email: "" } : ACADEMY;
    return json([Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]))]);
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

// ─── the edits ───────────────────────────────────────────────────────────────
// INJECT is not a mutation - it is the harness. It puts a column that exists in no
// schema into the (intentionally empty) pending list, so the mechanism has something
// to be aimed at. ONE for sections 2-4, TWO for section 5.
//
// ⚠️ THE PINS ARE DERIVED, NOT `= [];` (31 Jul 2026). Every pin in this file used to
// assume the pending arrays were EMPTY, which held for exactly as long as the mechanism
// went unused. The first time a column actually had to ship ahead of its migration
// (stripe_portal_url, for the welcome email's manage-membership link) all of them broke
// at once - i.e. this suite was pinned to the mechanism being idle, and went down the
// moment it was needed, which is the worst possible time for a safety net's test to
// stop running. So the pin is now whatever the file DECLARES today, read out of the
// source, and the injection APPENDS to it. A declaration this cannot read is reported
// as NEGATIVE CONTROL FAILED, never as a pass.
function pendingDecl(rel, name) {
  const src = fs.readFileSync(path.join(HERE, rel), "utf8");
  const m = new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(src);
  if (!m) return null;
  try { return { rel, name, text: m[0], list: JSON.parse(m[1]) }; } catch (_) { return null; }
}
const fmtList = (arr) => `[${arr.map((c) => JSON.stringify(c)).join(", ")}]`;
function inject(rel, name, extra) {
  const d = pendingDecl(rel, name);
  if (!d) {
    controlBroken = `this suite cannot read the pending list ${name} out of api/${rel}. It must stay a `
      + `plain single-line array literal (const ${name} = ["a_column"];) because the injection below `
      + "rewrites that exact line - and an injection that silently fails to apply looks precisely like "
      + "a mechanism that worked.";
    throw new Error(controlBroken);
  }
  return [[d.text, `const ${name} = ${fmtList([...d.list, ...extra])};`]];
}
// The MAIN list's text, for the both-lists check in section 1. Multi-line, so it is
// matched as text rather than parsed.
function mainListText(src, name) {
  const i = src.indexOf(`const ${name} = [`);
  return i < 0 ? "" : src.slice(i, src.indexOf("];", i));
}
const INJECT_ONE = (rel, c) => inject(rel, c, [SYNTH_A]);
const INJECT_TWO = (rel, c) => inject(rel, c, [SYNTH_A, SYNTH_B]);

// The mutations, expressed against the real source text.
//   nocolumn   - the three columns leave the MAIN lists. The select stops asking for
//                them, they never reach the row, and the footer of every automation
//                email loses its tagline, its Instagram link and its contact address.
//                This is the bug that shipped, restored. One pin covers both files:
//                they share the line the three were added on.
//   noinject   - the pending list is left EMPTY while production still lacks the
//                column, i.e. the mechanism exists and is not used. The 400 is
//                unhandled and the whole select dies. This is the control that says the
//                injection below is load-bearing and not decoration.
//   noretry    - the retry is removed and the original error rethrown. This is the
//                shipped-without-a-net version.
//   blindretry - the retry fires on ANY error. Looks strictly safer. It is not: an
//                outage now silently returns a row with no business_email, which holds
//                the academy's email and texts its owner about a field that is fine.
const NOCOLUMN = [[`"business_email", "tagline", "instagram_url",`, ``]];
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

// The mutation that applies to a copy whose pending list is being injected.
function mutFor(constName) {
  if (MUTATE === "noretry") return NORETRY;
  if (MUTATE === "blindretry") return BLINDRETRY(constName);
  if (MUTATE === "peelone") return PEELONE(constName);
  return [];
}
// Injection is SKIPPED under noinject (that is the whole control) and under nocolumn,
// whose claim is about the real main lists and which has nothing to say about pending.
const injectOne = (rel, c) => (MUTATE === "noinject" ? [] : INJECT_ONE(rel, c)).concat(mutFor(c));
const injectTwo = (rel, c) => (MUTATE === "noinject" ? [] : INJECT_TWO(rel, c)).concat(mutFor(c));

// The REAL modules, unmutated except by `nocolumn`. Section 1 and section 3a use these.
const realEdits = MUTATE === "nocolumn" ? NOCOLUMN : [];
const REAL_A = await moduleWithLoadClient("automations.js", realEdits);
const REAL_C = await moduleWithLoadClient("agent-confirm.js", realEdits);
// Copies with ONE synthetic pending column.
const INJ_A = await moduleWithLoadClient("automations.js", injectOne("automations.js", "CLIENT_COLS_PENDING"));
const INJ_C = await moduleWithLoadClient("agent-confirm.js", injectOne("agent-confirm.js", "CLIENT_COLS_PENDING"));

// _send.js is reached through its public door (sendOn), so no export is appended.
async function sendModule(edits) {
  if (!edits.length) return import("./_send.js");
  const abs = path.join(HERE, "_send.js");
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `${MUTATE ? `MUTATE=${MUTATE}` : "This suite"} is pinned to text that is no longer in api/_send.js:\n\n${find}\n\nRe-point it or delete it.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.pendingcol-${++copyCount}-_send.js`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}
// nocolumn also drops business_email out of SENDER_COLS, because that is the same
// regression on the send path: the address the footer and the unsubscribe are built
// from stops arriving.
// (SENDER_COLS grew on 30 Jul 2026 to cover every column clientVars reads, because the
// send path now RENDERS from that row - see api/_email-select-coverage.test.mjs section
// 6. This pin still takes out exactly one column, business_email, which is the one with
// a hold attached and the one this suite is about.)
const NOSENDER = [[
  `  "business_email", "public_name", "owner_name",`,
  `  "public_name", "owner_name",`]];
const { sendOn: sendReal } = await sendModule(MUTATE === "nocolumn" ? NOSENDER : []);
const { sendOn: sendInj } = await sendModule(injectOne("_send.js", "SENDER_COLS_PENDING"));

const reset = () => { CLIENT_SELECTS = []; FORCE_ERROR = null; MISSING_IN_PROD = []; WIRE = null; SMS = []; EVENTS = []; };
const REAL_LOADERS = [["api/automations.js", REAL_A.__loadClient], ["api/agent-confirm.js", REAL_C.__loadClient]];
const INJ_LOADERS = [["api/automations.js", INJ_A.__loadClient], ["api/agent-confirm.js", INJ_C.__loadClient]];

// ─── 1. the three columns are in the MAIN lists, and nothing is pending ──────
console.log("\n── 1. business_email / tagline / instagram_url are in the MAIN select lists ──");
for (const [label, loadClient] of REAL_LOADERS) {
  reset();
  let row = null, threw = null;
  try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!threw, `${label}: the select succeeds${threw ? ` (threw ${threw.message})` : ""}`);
  const asked = String(CLIENT_SELECTS[0] || "").split(",").map((s) => s.trim());
  for (const c of MOVED_UP) {
    ok(asked.includes(c), `${label}: the select list NAMES ${c}`);
    ok(!!row && row[c] === ACADEMY[c], `${label}: and ${c} lands on the returned row`);
  }
  // The point of business_email: it must not be the owner's inbox, in any state.
  ok(!!row && row.business_email !== ACADEMY.email, `${label}: business_email is not clients.email`);
  ok(CLIENT_SELECTS.length === 1, `${label}: ONE read, no retry, when the schema has everything the list asks for (saw ${CLIENT_SELECTS.length})`);
  // The rest of the list still has to be there. A "safe" change that quietly dropped
  // the parent-facing facts would hold nothing and break every message's identity.
  ok(!!row && row.public_name === ACADEMY.public_name && row.business_name === ACADEMY.business_name,
    `${label}: the parent-facing identity columns came back too`);
}
{
  // The pending arrays are PRESENT, READABLE and AGREED.
  //
  // "EMPTY" was the assertion until 31 Jul 2026, and it was never the real requirement -
  // it was a description of a quiet week. The requirement is that the mechanism is
  // intact and that the three lists say the same thing, and that survives the mechanism
  // being used. (What "empty" was really guarding, a column left parked after its
  // migration lands, is not visible from here at all: nothing in this process knows the
  // schema. What IS visible is a column in the main list AND the pending list, which is
  // the same mistake one step further along - and that is checked below.)
  //
  // AGREED matters on its own. clientVars() turns ONE row into the merge vars every
  // message renders from, and all three of these paths render from their own read of
  // that row. A column pending in the worker's list and absent from the send path's is
  // a fact that renders on one surface and blank on the other, which is the 29 Jul
  // regression wearing different clothes.
  const files = [["automations.js", "CLIENT_COLS_PENDING", "CLIENT_COLS"], ["agent-confirm.js", "CLIENT_COLS_PENDING", "CLIENT_COLS"], ["_send.js", "SENDER_COLS_PENDING", "SENDER_COLS"]];
  const lists = [];
  for (const [f, c, mainName] of files) {
    const src = fs.readFileSync(path.join(HERE, f), "utf8");
    const d = pendingDecl(f, c);
    ok(!!d, `api/${f}: ${c} is present and is a single-line array literal (${d ? fmtList(d.list) : "unreadable"})`);
    ok(new RegExp(`function pendingColsBlamedBy`).test(src), `api/${f}: the retry's gate function is still there`);
    if (!d) continue;
    lists.push(d.list);
    // A column in BOTH lists reads as handled and is not: the retry drops the pending
    // copy, the main copy asks for it anyway, and the select dies on the second read.
    const main = mainListText(src, mainName);
    const both = d.list.filter((x) => main.includes(JSON.stringify(x)));
    ok(both.length === 0, both.length
      ? `api/${f}: ${both.join(", ")} is in BOTH ${mainName} and ${c} - the retry cannot save a column the main list also asks for`
      : `api/${f}: nothing sits in both ${mainName} and ${c}`);
  }
  const distinct = new Set(lists.map((l) => JSON.stringify(l)));
  ok(lists.length === files.length && distinct.size === 1,
    `all three pending lists agree on what is pending (${[...distinct].join("  vs  ")})`);
}

// ─── 1b. the SHIPPED pending column, against a schema that does not have it ──
// Section 2 injects a SYNTHETIC column, because for most of this suite's life there was
// no real one to aim at. There is one now, and it deserves its own pass: the shipped
// list, on the shipped modules, against a stub schema that does NOT carry it - which is
// production today, until the member-management build's migration for
// clients.stripe_portal_url lands. The synthetic run proves the mechanism; this one
// proves the mechanism is aimed at the right column and is load-bearing right now. If
// it goes red, every automation email is failing at its first select.
const SHIPPED_PENDING = (pendingDecl("automations.js", "CLIENT_COLS_PENDING") || { list: [] }).list;
if (SHIPPED_PENDING.length) {
  console.log(`\n── 1b. the SHIPPED pending column(s) [${SHIPPED_PENDING.join(", ")}], absent from the schema ──`);
  for (const [label, loadClient] of REAL_LOADERS) {
    reset();
    MISSING_IN_PROD = [...SHIPPED_PENDING];
    let row = null, threw = null;
    try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
    ok(!threw, `${label}: the REAL select survives production as it stands today${threw ? ` (threw ${threw.message})` : ""}`);
    ok(!!row && SHIPPED_PENDING.every((c) => !(c in row)), `${label}: the pending column is ABSENT from the row, not faked as null`);
    ok(!!row && MOVED_UP.every((c) => row[c] === ACADEMY[c]), `${label}: and every applied column still arrives through the retry`);
    ok(CLIENT_SELECTS.length === 2, `${label}: one read plus exactly one retry (saw ${CLIENT_SELECTS.length})`);
  }
  // The send path, where the same 400 would be silent: clientSender throwing holds the
  // email WITHOUT texting the owner, so an unhandled 400 here stops every academy's
  // automation email and tells nobody.
  //
  // A DISTINCT client id, because clientSender caches its row per id for CLIENT_TTL and
  // the stub answers any id with the same academy. Reusing ACADEMY.id here would warm
  // that cache and leave section 4 measuring ZERO reads, which would look like a select
  // that stopped naming business_email.
  reset();
  MISSING_IN_PROD = [...SHIPPED_PENDING];
  const r = await sendReal({ channel: "email", clientId: `${ACADEMY.id}-pending-probe`, toEmail: "parent@example.test",
    subject: "Your spot this week", body: "Hi {{contact.first_name}}, see you at training.", vars: {} });
  ok(!!r.sent, `api/_send.js: the send still goes out with the pending column missing (${JSON.stringify(r)})`);
  ok(WIRE && WIRE.html.includes(`href="mailto:${ACADEMY.business_email}?subject=Unsubscribe"`),
    "api/_send.js: and the wire still carries the academy's own unsubscribe");
  const sends = CLIENT_SELECTS.filter((s) => s.includes("email_domain"));
  ok(sends.length === 2, `api/_send.js: one sender read plus one retry (saw ${sends.length})`);
  reset();
}

// ─── 2. a pending column production does not have takes NOTHING down ─────────
console.log(`\n── 2. with ${SYNTH_A} in the pending list and absent from the schema, the select survives ──`);
for (const [label, loadClient] of INJ_LOADERS) {
  reset();
  MISSING_IN_PROD = [SYNTH_A];
  let row = null, threw = null;
  try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!threw, `${label}: the 400 does NOT propagate${threw ? ` (threw ${threw.message})` : ""}`);
  ok(!!row, `${label}: a row still comes back (this is the SMS path staying up)`);
  ok(!!row && !(SYNTH_A in row), `${label}: ${SYNTH_A} is ABSENT from the row, not faked as null`);
  ok(!!row && row.public_name === ACADEMY.public_name && row.ghl_access_token === ACADEMY.ghl_access_token,
    `${label}: every other column is intact, so nothing else degraded`);
  // And the columns that DID move up are unaffected by a retry happening around them.
  ok(!!row && MOVED_UP.every((c) => row[c] === ACADEMY[c]),
    `${label}: business_email, tagline and instagram_url still arrive through the retry`);
  ok(CLIENT_SELECTS.length === 2,
    `${label}: exactly one retry, not a per-column crawl (saw ${CLIENT_SELECTS.length} reads)`);
  const second = String(CLIENT_SELECTS[1] || "").split(",").map((s) => s.trim());
  ok(!second.includes(SYNTH_A), `${label}: the retry drops the pending column`);
  ok(second.includes("public_name") && second.includes("ghl_kpi_config") && second.includes("tagline"),
    `${label}: and keeps everything else it was already asking for`);
}

// ─── 3. the retry is narrow ──────────────────────────────────────────────────
console.log("\n── 3a. on the REAL modules, with nothing pending, EVERY 42703 throws ──");
for (const [label, loadClient] of REAL_LOADERS) {
  // With the pending list empty there is nothing to degrade past, and that is the
  // right answer: a 42703 today means a typo in the list or a column added ahead of
  // its own migration. Both are bugs to see, not states to survive.
  reset();
  FORCE_ERROR = { status: 400, body: JSON.stringify({ code: "42703", message: "column clients.tagline does not exist" }) };
  let threw = null;
  try { await loadClient(ACADEMY.id); } catch (e) { threw = e; }
  ok(!!threw, `${label}: a 42703 blaming tagline THROWS rather than silently dropping it`);
  ok(CLIENT_SELECTS.length === 1, `${label}: and is not retried (saw ${CLIENT_SELECTS.length})`);
}
console.log(`\n── 3b. with ${SYNTH_A} pending, only a 42703 NAMING it earns the retry ──`);
for (const [label, loadClient] of INJ_LOADERS) {
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

// ─── 4. the send path, where a parent is on the other end ────────────────────
console.log("\n── 4. api/_send.js: a readable public email SENDS, an empty one HOLDS ──");
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot is held for this week.\n\nSee you at training.";
const sendVia = async (send, clientId) => {
  reset();
  return send({ channel: "email", clientId, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars: {} });
};
{
  const r = await sendVia(sendReal, ACADEMY.id);
  ok(!!r.sent, `with business_email in SENDER_COLS the send goes out (${JSON.stringify(r)})`);
  const asked = String(CLIENT_SELECTS[0] || "").split(",").map((s) => s.trim());
  ok(asked.includes("business_email") && asked.includes("email_domain"),
    `the sender select names business_email alongside the sending domain (${CLIENT_SELECTS[0]})`);
  ok(CLIENT_SELECTS.length === 1, `and needs no retry to get it (saw ${CLIENT_SELECTS.length})`);
  ok(WIRE && WIRE.html.includes(`href="mailto:${ACADEMY.business_email}?subject=Unsubscribe"`),
    "and the bytes on the wire carry it as the unsubscribe");
  ok(WIRE && !WIRE.html.includes(ACADEMY.email), "and the owner's inbox is nowhere in it");
}
{
  // THE HOLD, which is the guarantee with the sharpest edge and the one least allowed
  // to move. An academy with no public email on file cannot carry an unsubscribe
  // destination, and an email with no unsubscribe path is worse than the bug this
  // replaced. So it HOLDS: nothing generic goes out, the hold is stamped, and the
  // owner is told which field to fill in. This has nothing to do with schema state,
  // which is exactly why it still has to be asserted with the pending list empty.
  const r = await sendVia(sendReal, NO_PUBLIC_EMAIL_ID);
  ok(!!r.held, `an EMPTY business_email HOLDS the send (${JSON.stringify(r)})`);
  ok(/unsubscribe/i.test(String(r.held || "")), "for the business-email reason, not the sending-domain one");
  ok(WIRE === null, "nothing reached Resend");
  ok(EVENTS.some((e) => e.type === "business_email_hold_notice"), "the hold was stamped as the business-email hold");
  ok(SMS.some((m) => /public email/i.test(m)), "and the owner WAS texted about the missing public email");
  ok(!SMS.some((m) => m.includes(ACADEMY.email)), "without being pointed at their own inbox");
}
{
  // A pending column that is NOT business_email must hold NOTHING. Before the fold,
  // business_email itself was the pending column, so "pending" and "held" were the
  // same state and the distinction could not be tested. Now it can: the retry fires,
  // the row comes back without the synthetic column, and the send goes out normally.
  reset();
  MISSING_IN_PROD = [SYNTH_A];
  const r = await sendInj({ channel: "email", clientId: ACADEMY.id, toEmail: "parent@example.test", subject: "Your spot this week", body: BODY, vars: {} });
  ok(!!r.sent, `with ${SYNTH_A} pending the send still goes out - a pending column holds nothing (${JSON.stringify(r)})`);
  ok(WIRE && WIRE.html.includes(`href="mailto:${ACADEMY.business_email}?subject=Unsubscribe"`),
    "and still carries the academy's own unsubscribe");
  const sends = CLIENT_SELECTS.filter((s) => s.includes("email_domain"));
  ok(sends.length === 2, `the sender read retried once and stopped (saw ${sends.length})`);
  ok(!String(sends[1] || "").includes(SYNTH_A), "and the retry dropped the pending column");
}

// ─── 5. TWO pending columns, which is where the first version died ───────────
console.log("\n── 5. a SECOND pending column does not take the select down ──");
{
  const A2 = await moduleWithLoadClient("automations.js", injectTwo("automations.js", "CLIENT_COLS_PENDING"));
  const C2 = await moduleWithLoadClient("agent-confirm.js", injectTwo("agent-confirm.js", "CLIENT_COLS_PENDING"));
  for (const [label, loadClient] of [["api/automations.js", A2.__loadClient], ["api/agent-confirm.js", C2.__loadClient]]) {
    reset();
    MISSING_IN_PROD = [SYNTH_A, SYNTH_B];   // the schema has NEITHER
    let row = null, threw = null;
    try { row = await loadClient(ACADEMY.id); } catch (e) { threw = e; }
    ok(!threw, `${label}: TWO missing columns still do not propagate${threw ? ` (threw ${threw.message})` : ""}`);
    ok(!!row, `${label}: a row comes back, so the worker and SMS stay up`);
    const last = String(CLIENT_SELECTS[CLIENT_SELECTS.length - 1] || "").split(",").map((s) => s.trim());
    ok(!last.includes(SYNTH_A) && !last.includes(SYNTH_B),
      `${label}: the retry drops the WHOLE pending list, not just the one Postgres named`);
    ok(last.includes("public_name") && last.includes("ghl_access_token") && last.includes("business_email"),
      `${label}: and keeps every column that does exist`);
    ok(CLIENT_SELECTS.length === 2,
      `${label}: still exactly one retry, no per-column crawl (saw ${CLIENT_SELECTS.length})`);
  }
  reset();
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
