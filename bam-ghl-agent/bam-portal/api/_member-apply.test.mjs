// THE MEMBER APPLY ENGINE of api/workbook.js: staff review, per-card approval,
// and the ordered, mostly-real member apply (branched on workbook kind='member').
// No network, no database, no Stripe - Supabase is an in-memory PostgREST stub.
//
//   node --test api/_member-apply.test.mjs
//   MUTATE=<name> node api/_member-apply.test.mjs   (a negative control)
//
// (Like _workbook-apply.test.mjs this needs @sentry/node for the real import; if
// it is absent the copy under test has that one import swapped for an identity
// wrapper and nothing else changes. Member apply never loads match-prices.js, so
// the price machinery is not needed here.)
//
// WHAT THIS PROVES
//   1. THE STAFF DOOR. review / approve-card / apply on a member workbook answer
//      401 to a caller with no staff bearer; the owner token opens nothing.
//   2. REVIEW GROUPS BY BLAST RADIUS. Stop-billing members come FIRST (a parent
//      charged after they left), then the coverage panel, then member cards,
//      then the three action items, then additions/notes.
//   3. COVERAGE IS IDENTITY, AND A HARD GATE. A member is covered only when a
//      portal price carries their exact Stripe price id - never by amount. An
//      uncovered member with no plan family named makes members_with_no_price > 0
//      and apply throws 409 having written NOTHING.
//   4. THE MEMBER WRITE IS REAL. Name / plan / contact land on the members row,
//      age lands in member_field_values (not a members column), outcome drives
//      status, and every landed answer stamps applied_at so a rerun is safe.
//   5. THE THREE ACTION ITEMS. takeover (foreign sub), missing-phone (blank
//      phone), stop-billing (not-a-member) are created through the shared
//      creator with typed system_keys, idempotent on re-apply.
//   6. OFF-CARD AT APPLY. An alternate payer gets a member_billing_arrangement
//      (amount from the resolved price, anchor = next payment) and billing_mode
//      flips to 'alternate' ONLY when that arrangement lands - never a bare flag.
//   7. REFUSE-FIRST. An unknown field, or an alternate member with no method,
//      refuses the whole apply and writes nothing, recording apply_error per row.
//   8. THE STRIPE SEAM DOES NOT FIRE. No archived-price mint, no takeover sub;
//      the report says db_writes:"real", stripe_seam:"deferred".
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE guarantee; the run must print
// "NEGATIVE CONTROL PASSED". A pin that no longer matches api/workbook.js reports
// NEGATIVE CONTROL FAILED rather than passing quietly.
//
//   MUTATE=coveragegateoff   the members_with_no_price 409 is deleted, so an
//       uncovered member with no family slips through and is seeded onto a price
//       nobody could confirm exists. (measured 2026-08-07: 3 assertions)
//   MUTATE=amountmatch       coverage consults AMOUNT as well as identity, so a
//       member on an old $218.75 price files under the live $218.75 plan -
//       Salvador under Elementary. (measured 2026-08-07: 5 assertions)
//   MUTATE=stopbillingnotfirst  stop-billing members are no longer separated, so
//       a parent still being charged after they left is buried in the member
//       list instead of surfaced first. (measured 2026-08-07: 2 assertions)
//   MUTATE=takeoveritemmissing  the takeover item is never created, so a foreign
//       subscription the portal cannot bill or cancel has nothing pointing a
//       human at it. (measured 2026-08-07: 2 assertions)
//   MUTATE=offcardnotcreated  the arrangement is never inserted, so an off-card
//       member is left with no collection obligation - the decorative-flag
//       failure. (measured 2026-08-07: 3 assertions)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SB_BASE = "https://stub.supabase.test";
process.env.SUPABASE_URL = SB_BASE;
process.env.VITE_SUPABASE_URL = SB_BASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.SUPABASE_SERVICE_KEY;

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

let consoleBuffer = "";
for (const m of ["log", "info", "warn", "error", "debug"]) {
  const real = console[m].bind(console);
  console[m] = (...args) => { consoleBuffer += args.map(String).join(" ") + "\n"; real(...args); };
}

const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

let sentryOk = true;
try { await import("@sentry/node"); } catch (_) { sentryOk = false; }
const SENTRY_IMPORT = 'import { withSentryApiRoute } from "./_sentry.js";';
const SENTRY_STUB = 'const withSentryApiRoute = (h) => h; // (suite) @sentry/node is not installed here';

function copyWith(edits, name = ".mutant-member-apply.js") {
  let src = fs.readFileSync(path.join(HERE, "workbook.js"), "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/workbook.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const copy = path.join(HERE, name);
  fs.writeFileSync(copy, src);
  tmpFiles.push(copy);
  return copy;
}

// ── the mutations ────────────────────────────────────────────────────────────
const COVERAGEGATEOFF = [[
  `  if (blockerCount > 0) {
    // 409, and nothing has been written`,
  `  if (false && blockerCount > 0) {   // (control coveragegateoff) the hard gate is gone
    // 409, and nothing has been written`]];

const AMOUNTMATCH = [[
  `  return !!priceId && coverage.covered.has(String(priceId));`,
  `  return (!!priceId && coverage.covered.has(String(priceId))) || (_amountCents != null && coverage.amountSet.has(Number(_amountCents)));   // (control amountmatch)`]];

const STOPBILLINGNOTFIRST = [[
  `    if (outcome === "stop_billing") stopBilling.push(g); else memberGroups.push(g);`,
  `    memberGroups.push(g);   // (control stopbillingnotfirst) stop-billing no longer surfaced first`]];

const TAKEOVERITEMMISSING = [[
  `    if (seed.billing_portal_owned !== true) {`,
  `    if (false && seed.billing_portal_owned !== true) {   // (control takeoveritemmissing)`]];

const OFFCARDNOTCREATED = [[
  `    const created = await sb(\`member_billing_arrangements\`, {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
    }).catch((e) => { console.error("member apply: arrangement insert failed -", String((e && e.message) || e)); return null; });`,
  `    const created = null;   // (control offcardnotcreated) the arrangement is never inserted`]];

const EDITS = {
  coveragegateoff: COVERAGEGATEOFF,
  amountmatch: AMOUNTMATCH,
  stopbillingnotfirst: STOPBILLINGNOTFIRST,
  takeoveritemmissing: TAKEOVERITEMMISSING,
  offcardnotcreated: OFFCARDNOTCREATED,
};

const edits = MUTATE
  ? (EDITS[MUTATE] || (() => { controlBroken = `unknown control MUTATE=${MUTATE}`; throw new Error(controlBroken); })())
  : [];

// ── the in-memory world ──────────────────────────────────────────────────────
const TOKEN = "wbk_" + "tok_" + "memberSanJose";
const STAFF_BEARER = "staff-session-" + "bearer-Mem9";

const COLUMNS = {
  clients: ["id", "public_name", "business_name"],
  staff: ["id", "user_id", "name", "email"],
  workbooks: ["id", "client_id", "kind", "token", "status", "submitted_at", "reviewed_at", "snapshot", "created_at", "updated_at"],
  workbook_cards: ["id", "workbook_id", "card_key", "title", "sort_order", "state", "confirmed_at", "approved_at", "approved_by", "meta", "created_at", "updated_at"],
  workbook_answers: ["id", "workbook_id", "card_id", "client_id", "target_kind", "target_table", "target_id", "target_field", "current_value", "proposed", "answered", "applied_at", "apply_error", "created_at", "updated_at"],
  members: ["id", "client_id", "athlete_name", "parent_name", "parent_phone", "plan", "status", "stripe_price_id", "offer_id", "stripe_subscription_id", "stripe_customer_id", "billing_portal_owned", "billing_mode", "updated_at"],
  member_field_values: ["id", "member_id", "field_id", "value", "updated_at"],
  member_billing_arrangements: ["id", "client_id", "member_id", "athlete_name", "parent_name", "method", "method_note", "amount_cents", "currency", "offer_id", "anchor_date", "grace_days", "lead_days", "status", "source", "created_by", "created_by_name", "created_at"],
  action_items: ["id", "client_id", "system_key", "title", "description", "due_date", "assignee_id", "assignee_name", "created_by", "created_by_name", "created_by_role", "created_at"],
  pricing_catalog: ["id", "client_id", "stripe_price_id", "amount_cents", "currency"],
  offer_prices: ["id", "tenant_id", "stripe_price_id"],
  custom_field_defs: ["id", "client_id", "key", "label", "archived"],
};

let DB;
let seq = 0;
function reset() {
  seq = 0;
  DB = {
    clients: [{ id: "sj", public_name: "By Any Means San Jose", business_name: "BAM San Jose" }],
    staff: [{ id: "staff-1", user_id: "user-1", name: "Zoran", email: "zoran@byanymeansbball.com" }],
    // Two live portal prices. price_ele_m and price_two_m; both amounts real.
    // price_ele_m 21875 collides in AMOUNT with the uncovered member's old price.
    pricing_catalog: [
      { id: "pc1", client_id: "sj", stripe_price_id: "price_ele_m", amount_cents: 21875, currency: "usd" },
      { id: "pc2", client_id: "sj", stripe_price_id: "price_two_m", amount_cents: 27344, currency: "usd" },
    ],
    offer_prices: [],
    custom_field_defs: [{ id: "def-age", client_id: "sj", key: "athlete_age", label: "Athlete age", archived: false }],
    member_field_values: [],
    member_billing_arrangements: [],
    action_items: [],
    // Pre-seeded shells (decision A). Names/phones from the contacts join.
    members: [
      { id: "m-cov", client_id: "sj", athlete_name: "Jenny Chung", parent_name: "May Chung", parent_phone: "408-555-0100", plan: "Elementary Academy", status: "live", stripe_price_id: "price_ele_m", offer_id: "off-ele", stripe_subscription_id: "sub_cov", stripe_customer_id: "cus_cov", billing_portal_owned: false, billing_mode: null },
      { id: "m-unc", client_id: "sj", athlete_name: "Salvador Esparza", parent_name: "Rosa Esparza", parent_phone: "408-555-0101", plan: null, status: "live", stripe_price_id: "price_preseason_1x", offer_id: null, stripe_subscription_id: "sub_unc", stripe_customer_id: "cus_unc", billing_portal_owned: false, billing_mode: null },
      { id: "m-stop", client_id: "sj", athlete_name: "Leo Park", parent_name: "Anna Park", parent_phone: "408-555-0102", plan: "Elementary Academy", status: "live", stripe_price_id: "price_ele_m", offer_id: "off-ele", stripe_subscription_id: "sub_stop", stripe_customer_id: "cus_stop", billing_portal_owned: false, billing_mode: null },
      { id: "m-phone", client_id: "sj", athlete_name: "Mia Reyes", parent_name: "Tom Reyes", parent_phone: null, plan: "Elementary Academy", status: "live", stripe_price_id: "price_ele_m", offer_id: "off-ele", stripe_subscription_id: null, stripe_customer_id: null, billing_portal_owned: true, billing_mode: null },
      { id: "m-alt", client_id: "sj", athlete_name: "Ken Ito", parent_name: "Sue Ito", parent_phone: "408-555-0104", plan: "Academy 2x/week", status: "live", stripe_price_id: "price_two_m", offer_id: "off-two", stripe_subscription_id: null, stripe_customer_id: null, billing_portal_owned: true, billing_mode: null },
      // the blocker: uncovered price + no family. Lives on its own workbook.
      { id: "m-block", client_id: "sj", athlete_name: "Ivy Cho", parent_name: "Deb Cho", parent_phone: "408-555-0105", plan: null, status: "live", stripe_price_id: "price_ghost", offer_id: null, stripe_subscription_id: "sub_block", stripe_customer_id: "cus_block", billing_portal_owned: false, billing_mode: null },
    ],
    workbooks: [
      { id: "wbm", client_id: "sj", kind: "member", token: TOKEN, status: "submitted", submitted_at: "2026-08-07T01:00:00Z", reviewed_at: null, snapshot: null, created_at: "2026-08-07T00:00:00Z", updated_at: "2026-08-07T00:00:00Z" },
      { id: "wbb", client_id: "sj", kind: "member", token: TOKEN + "b", status: "submitted", submitted_at: "2026-08-07T01:00:00Z", reviewed_at: null, snapshot: null, created_at: "2026-08-07T00:00:00Z", updated_at: "2026-08-07T00:00:00Z" },
    ],
    workbook_cards: [
      { id: "c-cov", workbook_id: "wbm", card_key: "member:sub_cov", title: "Jenny Chung", sort_order: 0, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-unc", workbook_id: "wbm", card_key: "member:sub_unc", title: "Salvador Esparza", sort_order: 1, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-stop", workbook_id: "wbm", card_key: "member:sub_stop", title: "Leo Park", sort_order: 2, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-phone", workbook_id: "wbm", card_key: "member:m-phone", title: "Mia Reyes", sort_order: 3, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-alt", workbook_id: "wbm", card_key: "member:m-alt", title: "Ken Ito", sort_order: 4, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-notes", workbook_id: "wbm", card_key: "notes", title: "Anything else", sort_order: 5, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-block", workbook_id: "wbb", card_key: "member:sub_block", title: "Ivy Cho", sort_order: 0, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
    ],
    workbook_answers: [
      // m-cov: confirmed, foreign sub, covered, age 9.
      mAns("a-cov-name", "c-cov", "m-cov", "athlete_name", "Jenny Chung", "Jenny Chung"),
      mAns("a-cov-age", "c-cov", "m-cov", "athlete_age", null, "9"),
      mAns("a-cov-price", "c-cov", "m-cov", "stripe_price_id", "price_ele_m", "price_ele_m"),
      mAns("a-cov-plan", "c-cov", "m-cov", "plan", "Elementary Academy", "Elementary Academy"),
      mAns("a-cov-out", "c-cov", "m-cov", "outcome", null, "confirmed"),
      mAns("a-cov-next", "c-cov", "m-cov", "next_payment", null, "2026-09-15"),
      // m-unc: uncovered price, family NAMED (1x/week), amount COLLIDES with Elementary.
      mAns("a-unc-price", "c-unc", "m-unc", "stripe_price_id", "price_preseason_1x", "price_preseason_1x"),
      mAns("a-unc-plan", "c-unc", "m-unc", "plan", null, "Academy 1x/week"),
      mAns("a-unc-amt", "c-unc", "m-unc", "amount_cents", null, 21875),
      mAns("a-unc-out", "c-unc", "m-unc", "outcome", null, "confirmed"),
      // m-stop: not a member -> stop billing (has a live sub).
      mAns("a-stop-price", "c-stop", "m-stop", "stripe_price_id", "price_ele_m", "price_ele_m"),
      mAns("a-stop-out", "c-stop", "m-stop", "outcome", null, "not a member"),
      // m-phone: covered, portal-owned (no takeover), no phone anywhere.
      mAns("a-ph-price", "c-phone", "m-phone", "stripe_price_id", "price_ele_m", "price_ele_m"),
      mAns("a-ph-out", "c-phone", "m-phone", "outcome", null, "confirmed"),
      // m-alt: off-card, covered, portal-owned. cash, anchored to next payment.
      mAns("a-alt-price", "c-alt", "m-alt", "stripe_price_id", "price_two_m", "price_two_m"),
      mAns("a-alt-mode", "c-alt", "m-alt", "billing_mode", null, "cash"),
      mAns("a-alt-method", "c-alt", "m-alt", "off_card_method", null, "cash"),
      mAns("a-alt-next", "c-alt", "m-alt", "next_payment", null, "2026-09-01"),
      mAns("a-alt-out", "c-alt", "m-alt", "outcome", null, "confirmed"),
      // free text for staff, never written.
      { id: "a-notes", workbook_id: "wbm", card_id: "c-notes", client_id: "sj", target_kind: "member_row", target_table: "members", target_id: null, target_field: "notes", current_value: null, proposed: null, answered: "Leo moved away in July.", applied_at: null, apply_error: null, created_at: "2026-08-07T00:00:30Z" },
      // wbb blocker: uncovered price, NO family.
      mAns("a-blk-price", "c-block", "m-block", "stripe_price_id", "price_ghost", "price_ghost", "wbb"),
      mAns("a-blk-out", "c-block", "m-block", "outcome", null, "confirmed", "wbb"),
    ],
  };
}
let ansSeq = 0;
function mAns(id, cardId, memberId, field, current, answered, wbId = "wbm") {
  return {
    id, workbook_id: wbId, card_id: cardId, client_id: "sj",
    target_kind: "member_row", target_table: "members", target_id: memberId,
    target_field: field, current_value: current === undefined ? null : current,
    proposed: null, answered, applied_at: null, apply_error: null,
    created_at: `2026-08-07T00:00:${String(++ansSeq).padStart(2, "0")}Z`,
  };
}
reset();

const httpErr = (code, message, status = 400) => ({ status, body: { code, message, details: null, hint: null } });

function applyFilters(table, params) {
  let rows = (DB[table] || []).slice();
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const s = String(v);
    if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val); }
    else if (s.startsWith("neq.")) { const val = s.slice(4); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) !== val); }
    else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter((r) => vals.includes(String(r[k]))); }
    else if (s === "not.is.null") rows = rows.filter((r) => r[k] != null);
    else if (s.startsWith("is.null")) rows = rows.filter((r) => r[k] == null);
  }
  const lim = parseInt(params.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}
function project(table, rows, params) {
  const sel = params.get("select");
  if (!sel || sel === "*") return rows.map((r) => ({ ...r }));
  const cols = sel.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!COLUMNS[table].includes(c)) {
      const e = new Error("undefined column");
      e.pgrst = httpErr("42703", `column ${table}.${c} does not exist`);
      throw e;
    }
  }
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
}

const FAIL_READS = new Set();   // table -> GET answers 503 (a real read failure)

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.stripe.com/")) throw new Error(`STRIPE WAS TOUCHED: ${method} ${u} - member apply defers the Stripe seam`);
  if (u.startsWith(`${SB_BASE}/auth/v1/`)) {
    const bearer = String((init.headers || {}).Authorization || "");
    if (bearer !== `Bearer ${STAFF_BEARER}`) return json({ msg: "invalid" }, 401);
    return json({ id: "user-1", email: "zoran@byanymeansbball.com" });
  }
  if (!u.startsWith(`${SB_BASE}/rest/v1/`)) throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
  const [table, qs = ""] = u.slice(`${SB_BASE}/rest/v1/`.length).split("?");
  const params = new URLSearchParams(qs);
  const prefer = String((init.headers || {}).Prefer || "");
  try {
    if (method === "GET" && FAIL_READS.has(table)) return json({ code: "57P01", message: "the database went away mid-read" }, 503);
    if (method === "GET") return json(project(table, applyFilters(table, params), params));
    if (method === "PATCH") {
      const patch = init.body ? JSON.parse(init.body) : {};
      const hit = applyFilters(table, params);
      for (const r of hit) Object.assign(r, patch);
      return json(prefer.includes("return=representation") ? project(table, hit, params) : []);
    }
    if (method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      const list = Array.isArray(rows) ? rows : [rows];
      // action_items carry a real unique (client_id, system_key): a second
      // insert 23505s, which is how createSystemActionItem stays idempotent.
      if (table === "action_items") {
        for (const r of list) {
          if ((DB.action_items || []).some((x) => x.client_id === r.client_id && x.system_key === r.system_key)) {
            return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
          }
        }
      }
      const made = list.map((r) => { const row = { id: `new-${++seq}`, created_at: "2026-08-07T12:00:00Z", ...r }; (DB[table] = DB[table] || []).push(row); return row; });
      return json(prefer.includes("return=representation") ? project(table, made, params) : []);
    }
    if (method === "DELETE") {
      const hit = applyFilters(table, params);
      const idset = new Set(hit.map((r) => r.id));
      DB[table] = (DB[table] || []).filter((r) => !idset.has(r.id));
      return json([]);
    }
  } catch (e) {
    if (e.pgrst) return json(e.pgrst.body, e.pgrst.status);
    throw e;
  }
  return json([]);
};

const modulePath = (!MUTATE && sentryOk)
  ? path.join(HERE, "workbook.js")
  : copyWith(sentryOk ? edits : [...edits, [SENTRY_IMPORT, SENTRY_STUB]]);
if (!sentryOk) console.log("  (note) @sentry/node absent; the copy under test has its _sentry import swapped for an identity wrapper. Nothing else changes.");

const WB = await import(pathToFileURL(modulePath).href);

async function callOn(mod, req) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await mod.default({ headers: {}, ...req }, res);
  return { status, body, text: JSON.stringify(body) };
}
const call = (req) => callOn(WB, req);
const post = (body, headers) => call({ method: "POST", url: "/api/workbook", headers: headers || {}, body });
const AUTH = { authorization: `Bearer ${STAFF_BEARER}` };
const staffPost = (body) => post(body, AUTH);
const rowOf = (table, id) => (DB[table] || []).find((r) => r.id === id);
const answersOf = (wbId) => DB.workbook_answers.filter((a) => a.workbook_id === wbId);
const approveAll = (wbId) => { for (const c of DB.workbook_cards) if (c.workbook_id === wbId) { c.approved_at = "2026-08-07T02:00:00Z"; c.approved_by = "user-1"; } };
const worldState = () => JSON.stringify(DB.members) + JSON.stringify(DB.member_field_values) + JSON.stringify(DB.member_billing_arrangements) + JSON.stringify(DB.action_items);
const items = () => DB.action_items;
const hasItem = (key) => items().some((i) => i.system_key === key);

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the staff-only door ──");
{
  const before = JSON.stringify(DB);
  for (const action of ["review", "approve-card", "apply"]) {
    const r = await post({ action, token: TOKEN, workbook_id: "wbm", card_key: "member:sub_cov" });
    ok(r.status === 401 && r.body.ok === false, `${action} with the owner token and no staff bearer is 401`);
  }
  ok(JSON.stringify(DB) === before, "and none of the attempts wrote a thing");
}

console.log("\n── 2. member review: grouped by blast radius ──");
{
  const r = await staffPost({ action: "review", workbook_id: "wbm" });
  ok(r.status === 200 && r.body.ok === true, "staff review answers");
  const rv = r.body.review;
  ok(Object.keys(rv).join(",") === "stop_billing,coverage,members,action_items,additions,notes",
    "grouped stop_billing FIRST, then coverage, members, action_items, additions, notes");
  ok(rv.stop_billing.length === 1 && rv.stop_billing[0].member_id === "m-stop",
    "the not-a-member surfaces in stop_billing, not in the member list");
  ok(!rv.members.some((m) => m.member_id === "m-stop"), "and is NOT also in the ordinary member cards");
  ok(rv.coverage.total === 5, `coverage counts all 5 members (saw ${rv.coverage.total})`);
  ok(rv.coverage.covered === 4, `four are covered by identity (saw ${rv.coverage.covered})`);
  ok(rv.coverage.members_with_no_price === 0, "no blocker on this workbook - the one uncovered member has a family named");
  const unc = rv.coverage.uncovered.find((u) => u.member_id === "m-unc");
  ok(!!unc && unc.blocker === false && unc.stripe_price_id === "price_preseason_1x" && unc.amount_cents === 21875,
    "the uncovered member is listed with amount + stripe price id and marked pending-mint, not a blocker");
  const it = rv.action_items;
  ok(it.takeover.some((t) => t.member_id === "m-cov") && it.takeover.some((t) => t.member_id === "m-unc"),
    "takeover previews for the foreign-sub members");
  ok(it.missing_phone.some((t) => t.member_id === "m-phone"), "missing-phone previews for the member with no phone");
  ok(it.stop_billing.some((t) => t.member_id === "m-stop"), "stop-billing previews for the not-a-member");
  ok(rv.notes.length === 1 && /moved away/.test(String(rv.notes[0].effective)), "free text is parked in notes, never a write");
  ok(r.body.gate.ready_to_apply === false, "not ready until every card is approved");
}

console.log("\n── 3. approve gates apply; an unapproved card refuses ──");
{
  const before = worldState();
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.status === 409 && r.body.code === "unapproved_cards", "apply refuses while any card is unapproved");
  ok(worldState() === before, "and wrote nothing");
  reset();
}

console.log("\n── 4. apply: the real member write + age + status + items + off-card ──");
{
  approveAll("wbm");
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.status === 200 && r.body.ok === true, "apply answers ok");
  ok(r.body.db_writes === "real" && /deferred/.test(r.body.stripe_seam), "and says db writes are real, the Stripe seam deferred");

  // the members row really changed
  ok(rowOf("members", "m-cov").status === "live", "a confirmed member is live");
  ok(rowOf("members", "m-stop").status === "cancelling", "a not-a-member goes to cancelling (the item does the Stripe cancel)");

  // age landed in member_field_values, NOT a members column
  const age = DB.member_field_values.find((v) => v.member_id === "m-cov" && v.field_id === "def-age");
  ok(!!age && age.value === 9, `age 9 landed in member_field_values (saw ${JSON.stringify(age && age.value)})`);
  ok(!("athlete_age" in rowOf("members", "m-cov")), "and never as a members column");

  // the three action items, by typed key
  ok(hasItem("takeover:m-cov") && hasItem("takeover:m-unc"), "takeover items for the foreign subs");
  ok(!hasItem("takeover:m-phone") && !hasItem("takeover:m-alt"), "and none for the portal-owned members");
  ok(hasItem("missing-phone:m-phone"), "a missing-phone item for the member with no phone");
  ok(!hasItem("missing-phone:m-cov"), "and none for a member who has one");
  ok(hasItem("stop-billing:m-stop"), "a stop-billing item for the not-a-member with a live sub");

  // off-card arrangement created + billing_mode flipped
  const arr = DB.member_billing_arrangements.find((a) => a.member_id === "m-alt");
  ok(!!arr && arr.method === "cash" && arr.anchor_date === "2026-09-01" && arr.amount_cents === 27344,
    "an arrangement for the alternate payer: cash, anchored to next payment, amount from the resolved price");
  ok(rowOf("members", "m-alt").billing_mode === "alternate", "and billing_mode flips to alternate ONLY with the arrangement behind it");
  ok(DB.member_billing_arrangements.every((a) => a.member_id !== "m-cov"), "no arrangement for a card payer");

  // stamps: every landed answer is applied_at, so a rerun is safe
  ok(answersOf("wbm").find((a) => a.id === "a-cov-age").applied_at != null, "the age answer is stamped applied");
  ok(answersOf("wbm").find((a) => a.id === "a-notes").applied_at == null, "the free-text note is never applied");

  // the Stripe seam did not fire: no arranged mint, and the uncovered member
  // seeded with a deferral note.
  const uncReport = r.body.members.find((m) => m.member_id === "m-unc");
  ok(!!uncReport && uncReport.covered === false && /deferred/.test(uncReport.deferred_mint || ""),
    "the uncovered member is seeded with the mint deferred to the BAM queue");
  ok(rowOf("workbooks", "wbm").status !== "applied", "apply does not move the workbook to 'applied' - reruns stay possible");

  // rerun is idempotent
  const again = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(again.status === 200 && again.body.ok === true, "a second apply still answers ok");
  ok(DB.member_billing_arrangements.filter((a) => a.member_id === "m-alt").length === 1, "and does not create a second arrangement");
  ok(DB.action_items.filter((i) => i.system_key === "takeover:m-cov").length === 1, "nor a duplicate takeover item (idempotent on system_key)");
  reset();
}

console.log("\n── 5. coverage HARD gate: a member with no price and no family ──");
{
  approveAll("wbb");
  const before = worldState();
  const r = await staffPost({ action: "apply", workbook_id: "wbb" });
  ok(r.status === 409 && r.body.code === "members_with_no_price", "apply throws 409 members_with_no_price");
  ok(worldState() === before, "and wrote NOTHING - not the member, not an item, not an arrangement");
  ok(rowOf("workbooks", "wbb").snapshot == null, "no snapshot was taken either");
  reset();
}

console.log("\n── 6. coverage is IDENTITY, never amount ──");
{
  const r = await staffPost({ action: "review", workbook_id: "wbm" });
  const unc = r.body.review.coverage.uncovered.find((u) => u.member_id === "m-unc");
  ok(!!unc, "Salvador (old $218.75 price) is in the uncovered list");
  ok(r.body.review.coverage.covered === 4,
    "he is NOT counted covered even though a live $218.75 plan exists - amount does not decide coverage");
  reset();
}

console.log("\n── 7. refuse-first: an alternate member with no method writes nothing ──");
{
  approveAll("wbm");
  // strip the method answer off the alternate member
  DB.workbook_answers = DB.workbook_answers.filter((a) => a.id !== "a-alt-method");
  const before = worldState();
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.body.ok === false && /nothing was applied/.test(r.body.error || ""), "the whole apply refuses");
  ok(worldState() === before, "and nothing was written");
  ok(DB.workbook_answers.some((a) => a.apply_error && /payment method/.test(a.apply_error)), "with a per-row apply_error naming the missing method");
  reset();
}

console.log("\n── 8. refuse-first: an unknown member field fails closed ──");
{
  approveAll("wbm");
  DB.workbook_answers.push(mAns("a-cov-bad", "c-cov", "m-cov", "secret_column", null, "x"));
  const before = worldState();
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.body.ok === false, "an unlisted field refuses the apply rather than writing a guessed column");
  ok(worldState() === before, "and writes nothing");
  reset();
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
