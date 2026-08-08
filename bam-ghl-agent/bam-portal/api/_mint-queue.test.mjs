// THE DEFERRED-MINT QUEUE of the member apply engine (api/workbook.js phase 6):
// for each uncovered member whose coverage resolved to "mint an archived price
// under family X", apply queues ONE BAM systems-lane v2_ticket (type
// 'billing_fix', decision E) instead of writing to Stripe. No network, no
// database, no Stripe - Supabase is an in-memory PostgREST stub whose v2_tickets
// table enforces the real unique (client_id, system_key), the same index the
// migration adds, so idempotency is proven against the guard that ships.
//
//   node --test api/_mint-queue.test.mjs
//   MUTATE=<name> node api/_mint-queue.test.mjs   (a negative control)
//
// (Like _member-apply.test.mjs this needs @sentry/node for the real import;
// api/workbook.js and api/v2-tickets.js both import ./_sentry.js. This env has
// it. If it is ever absent, only the MUTATE=mintkeypermember path - which copies
// workbook.js - is affected, and it swaps workbook's own _sentry import for an
// identity wrapper; v2-tickets.js still needs the real module, so run the
// controls where @sentry/node is installed.)
//
// WHAT THIS PROVES
//   1. AN UNCOVERED MEMBER WITH A NAMED FAMILY QUEUES EXACTLY ONE TICKET, and it
//      carries the actionable payload: client_id, offer_id, plan family, exact
//      amount_cents, currency, the member(s) waiting and their current Stripe
//      price ids. Two uncovered members sharing (offer, family, amount) collapse
//      into ONE ticket - one ticket per (client, offer, family, amount).
//   2. IT ROUTES TO A SURFACE THAT RENDERS. type='billing_fix' ->
//      assignee_role='systems', and WebsiteV2View's QUEUE_TYPES (the systems
//      lane filter) admits 'billing_fix'. The ticket does not land where nobody
//      looks - the exact failure docs/plans/v2-action-item-map.md warns about.
//   3. IT IS IDEMPOTENT. A rerun of apply creates ZERO more tickets: the second
//      insert 23505s on the unique (client_id, system_key) and returns the
//      existing row (created:false).
//   4. A COVERED MEMBER QUEUES NOTHING. A workbook of only covered members writes
//      no ticket at all, and no ticket ever references a covered member.
//   5. THE STRIPE SEAM STAYS SHUT. Queuing the mint touches no Stripe endpoint;
//      the report still says stripe_seam:"deferred".
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE guarantee; the run must print
// "NEGATIVE CONTROL PASSED".
//
//   MUTATE=mintkeypermember  the dedupe key gains the member id, so it is unique
//       PER MEMBER instead of per (offer, family, amount). Two members that
//       should share one ticket now mint two, and a rerun mints more. The "one
//       ticket / idempotent" assertions catch it. (workbook.js one-liner)
//   MUTATE=filternarrowed    the systems-lane filter is narrowed back to its
//       pre-fix set (no billing_fix), so the mint ticket routes to a page that
//       filters it out - lands nowhere. The renders-somewhere assertion catches
//       it. (a one-line simulation of WebsiteV2View's QUEUE_TYPES)

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

const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

let sentryOk = true;
try { await import("@sentry/node"); } catch (_) { sentryOk = false; }
const SENTRY_IMPORT = 'import { withSentryApiRoute } from "./_sentry.js";';
const SENTRY_STUB = 'const withSentryApiRoute = (h) => h; // (suite) @sentry/node is not installed here';

function copyWith(edits, name = ".mutant-mint-queue.js") {
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
// mintkeypermember: the dedupe key becomes unique per member, so two members
// that share (offer, family, amount) no longer share a ticket, and a rerun is no
// longer idempotent.
const MINTKEYPERMEMBER = [[
  `    const key = systemKeyForArchivedPriceMint({ offer_id: offerId, family, amount_cents: amountCents });`,
  `    const key = systemKeyForArchivedPriceMint({ offer_id: offerId, family, amount_cents: amountCents }) + ":" + u.member_id;   // (control mintkeypermember)`]];

const WORKBOOK_MUTATIONS = { mintkeypermember: MINTKEYPERMEMBER };
// filternarrowed is a control on a DIFFERENT file (WebsiteV2View.jsx), so it does
// not edit workbook.js; it is applied inline where the renders-somewhere property
// is asserted.
if (MUTATE && !WORKBOOK_MUTATIONS[MUTATE] && MUTATE !== "filternarrowed") {
  controlBroken = `unknown control MUTATE=${MUTATE}`;
  throw new Error(controlBroken);
}
const edits = WORKBOOK_MUTATIONS[MUTATE] || [];

// ── the in-memory world ──────────────────────────────────────────────────────
const TOKEN = "wbk_" + "tok_" + "mintQueue";
const STAFF_BEARER = "staff-session-" + "bearer-Mint9";

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
  v2_tickets: ["id", "client_id", "type", "status", "assignee_role", "assigned_to", "title", "source", "intake", "context", "system_key", "created_by", "created_by_staff", "created_at", "updated_at"],
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
    // ONE covered portal price. The two uncovered members ride old Stripe prices
    // that are NOT in the catalog (and NOT in offer_prices).
    pricing_catalog: [{ id: "pc1", client_id: "sj", stripe_price_id: "price_live_m", amount_cents: 20000, currency: "usd" }],
    offer_prices: [],
    custom_field_defs: [{ id: "def-age", client_id: "sj", key: "athlete_age", label: "Athlete age", archived: false }],
    member_field_values: [],
    member_billing_arrangements: [],
    action_items: [],
    v2_tickets: [],
    members: [
      // covered, portal-owned, phone present -> no ticket, no action item.
      { id: "m-cov", client_id: "sj", athlete_name: "Jenny Chung", parent_name: "May Chung", parent_phone: "408-555-0100", plan: "Live Plan", status: "live", stripe_price_id: "price_live_m", offer_id: "off-live", stripe_subscription_id: null, stripe_customer_id: null, billing_portal_owned: true, billing_mode: null },
      // TWO uncovered members, SAME offer + family + amount, DIFFERENT old price ids.
      { id: "m-unc1", client_id: "sj", athlete_name: "Christopher Diaz", parent_name: "Nadia Diaz", parent_phone: "408-555-0111", plan: null, status: "live", stripe_price_id: "price_old_a", offer_id: null, stripe_subscription_id: null, stripe_customer_id: "cus_a", billing_portal_owned: true, billing_mode: null },
      { id: "m-unc2", client_id: "sj", athlete_name: "Bianca Diaz", parent_name: "Nadia Diaz", parent_phone: "408-555-0111", plan: null, status: "live", stripe_price_id: "price_old_b", offer_id: null, stripe_subscription_id: null, stripe_customer_id: "cus_b", billing_portal_owned: true, billing_mode: null },
      // a covered member living on its OWN workbook (the "covered creates none" case).
      { id: "m-cov2", client_id: "sj", athlete_name: "Leo Park", parent_name: "Anna Park", parent_phone: "408-555-0102", plan: "Live Plan", status: "live", stripe_price_id: "price_live_m", offer_id: "off-live", stripe_subscription_id: null, stripe_customer_id: null, billing_portal_owned: true, billing_mode: null },
    ],
    workbooks: [
      { id: "wbm", client_id: "sj", kind: "member", token: TOKEN, status: "submitted", submitted_at: "2026-08-07T01:00:00Z", reviewed_at: null, snapshot: null, created_at: "2026-08-07T00:00:00Z", updated_at: "2026-08-07T00:00:00Z" },
      { id: "wbc", client_id: "sj", kind: "member", token: TOKEN + "c", status: "submitted", submitted_at: "2026-08-07T01:00:00Z", reviewed_at: null, snapshot: null, created_at: "2026-08-07T00:00:00Z", updated_at: "2026-08-07T00:00:00Z" },
    ],
    workbook_cards: [
      { id: "c-cov", workbook_id: "wbm", card_key: "member:m-cov", title: "Jenny Chung", sort_order: 0, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-unc1", workbook_id: "wbm", card_key: "member:m-unc1", title: "Christopher Diaz", sort_order: 1, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-unc2", workbook_id: "wbm", card_key: "member:m-unc2", title: "Bianca Diaz", sort_order: 2, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
      { id: "c-cov2", workbook_id: "wbc", card_key: "member:m-cov2", title: "Leo Park", sort_order: 0, state: "changed", confirmed_at: "2026-08-07T00:30:00Z", approved_at: null, approved_by: null, meta: {} },
    ],
    workbook_answers: [
      // m-cov: covered, confirmed.
      mAns("a-cov-price", "c-cov", "m-cov", "stripe_price_id", "price_live_m", "price_live_m"),
      mAns("a-cov-plan", "c-cov", "m-cov", "plan", "Live Plan", "Live Plan"),
      mAns("a-cov-out", "c-cov", "m-cov", "outcome", null, "confirmed"),
      // m-unc1: uncovered old price, family named "One Person Deal", offer + amount.
      mAns("a-unc1-price", "c-unc1", "m-unc1", "stripe_price_id", "price_old_a", "price_old_a"),
      mAns("a-unc1-offer", "c-unc1", "m-unc1", "offer_id", null, "off-oneperson"),
      mAns("a-unc1-plan", "c-unc1", "m-unc1", "plan", null, "One Person Deal"),
      mAns("a-unc1-amt", "c-unc1", "m-unc1", "amount_cents", null, 19900),
      mAns("a-unc1-out", "c-unc1", "m-unc1", "outcome", null, "confirmed"),
      // m-unc2: SAME offer + family + amount, DIFFERENT old price id.
      mAns("a-unc2-price", "c-unc2", "m-unc2", "stripe_price_id", "price_old_b", "price_old_b"),
      mAns("a-unc2-offer", "c-unc2", "m-unc2", "offer_id", null, "off-oneperson"),
      mAns("a-unc2-plan", "c-unc2", "m-unc2", "plan", null, "One Person Deal"),
      mAns("a-unc2-amt", "c-unc2", "m-unc2", "amount_cents", null, 19900),
      mAns("a-unc2-out", "c-unc2", "m-unc2", "outcome", null, "confirmed"),
      // wbc: a covered-only workbook.
      mAns("a-cov2-price", "c-cov2", "m-cov2", "stripe_price_id", "price_live_m", "price_live_m", "wbc"),
      mAns("a-cov2-plan", "c-cov2", "m-cov2", "plan", "Live Plan", "Live Plan", "wbc"),
      mAns("a-cov2-out", "c-cov2", "m-cov2", "outcome", null, "confirmed", "wbc"),
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
    // intake->>system_key: the pre-migration degrade path reads a JSON field.
    if (k === "intake->>system_key") {
      if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String((r.intake && r.intake.system_key) == null ? "" : r.intake.system_key) === val); }
      continue;
    }
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

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.stripe.com/")) throw new Error(`STRIPE WAS TOUCHED: ${method} ${u} - the mint stays deferred`);
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
      // action_items AND v2_tickets carry a real unique (client_id, system_key):
      // a second insert with the same key 23505s. That IS the idempotency guard
      // the migration ships, so the stub enforces it too (NULL keys are distinct).
      for (const uk of ["action_items", "v2_tickets"]) {
        if (table === uk) {
          for (const r of list) {
            if (r.system_key != null && (DB[uk] || []).some((x) => x.client_id === r.client_id && x.system_key === r.system_key)) {
              return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
            }
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

const needCopy = (edits.length > 0) || !sentryOk;
const modulePath = needCopy
  ? copyWith(sentryOk ? edits : [...edits, [SENTRY_IMPORT, SENTRY_STUB]])
  : path.join(HERE, "workbook.js");
if (!sentryOk) console.log("  (note) @sentry/node absent; workbook's _sentry import is stubbed. v2-tickets.js still needs the real module - run controls where it is installed.");

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
const approveAll = (wbId) => { for (const c of DB.workbook_cards) if (c.workbook_id === wbId) { c.approved_at = "2026-08-07T02:00:00Z"; c.approved_by = "user-1"; } };
const tickets = () => DB.v2_tickets;

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. an uncovered member with a named family queues ONE actionable ticket ──");
let firstTicket = null;
{
  approveAll("wbm");
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.status === 200 && r.body.ok === true, "apply answers ok");
  ok(/deferred/.test(r.body.stripe_seam), "the Stripe seam is still deferred (no live mint here)");

  // exactly one ticket, and two uncovered members collapsed into it.
  ok(tickets().length === 1, `exactly one v2_ticket was queued (saw ${tickets().length})`);
  firstTicket = tickets()[0] || {};
  ok(firstTicket.type === "billing_fix", `the ticket type is billing_fix (saw ${JSON.stringify(firstTicket.type)})`);
  ok(firstTicket.assignee_role === "systems", `it routes to the systems lane (saw ${JSON.stringify(firstTicket.assignee_role)})`);
  ok(firstTicket.source === "offer-flow", "its source is offer-flow");
  ok(firstTicket.system_key === "archived-price-mint:off-oneperson:19900",
    `its typed dedupe key is (client is implicit) offer:family:amount (saw ${JSON.stringify(firstTicket.system_key)})`);

  const intake = firstTicket.intake || {};
  ok(intake.client_id === "sj", "intake carries client_id");
  ok(intake.offer_id === "off-oneperson", "intake carries the offer_id");
  ok(intake.plan_family === "One Person Deal", "intake carries the owner-named plan family");
  ok(intake.amount_cents === 19900, `intake carries the exact amount_cents (saw ${JSON.stringify(intake.amount_cents)})`);
  ok(typeof intake.currency === "string" && intake.currency.length > 0, `intake carries a currency (saw ${JSON.stringify(intake.currency)})`);
  ok(typeof intake.stripe_price_ref === "string" && intake.stripe_price_ref.length > 0, "intake carries a reference Stripe price id");
  ok(intake.cadence === null && "cadence_source_stripe_price_id" in intake,
    "cadence is not guessed - it is null with the source Stripe price named for the human to read");
  const waiting = Array.isArray(intake.members_waiting) ? intake.members_waiting : [];
  ok(waiting.length === 2 && waiting.some((w) => w.member_id === "m-unc1") && waiting.some((w) => w.member_id === "m-unc2"),
    `both uncovered members are listed as waiting (saw ${waiting.map((w) => w.member_id).join(",")})`);
  ok(waiting.some((w) => w.stripe_price_id === "price_old_a") && waiting.some((w) => w.stripe_price_id === "price_old_b"),
    "each waiting member carries its OWN current Stripe price id");
  ok(!waiting.some((w) => w.member_id === "m-cov"), "the covered member is NOT waiting on any mint");

  // the report exposes the same, created:true.
  const dm = Array.isArray(r.body.deferred_mints) ? r.body.deferred_mints : [];
  ok(dm.length === 1 && dm[0].created === true && dm[0].ticket_id, "the apply report lists the queued mint, created:true, with a ticket id");
  ok(dm[0].members_waiting.length === 2, "and names both members waiting on it");

  console.log("  ▸ queued ticket:", JSON.stringify({ type: firstTicket.type, role: firstTicket.assignee_role, source: firstTicket.source, system_key: firstTicket.system_key, intake: firstTicket.intake }));
}

console.log("\n── 2. idempotent: a rerun of apply queues ZERO more ──");
{
  const before = tickets().length;
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  ok(r.status === 200 && r.body.ok === true, "a second apply still answers ok");
  ok(tickets().length === before && before === 1, `still exactly one ticket after the rerun (saw ${tickets().length})`);
  const dm = Array.isArray(r.body.deferred_mints) ? r.body.deferred_mints : [];
  ok(dm.length === 1 && dm[0].created === false, "the rerun reports the mint as already-queued (created:false), not a new insert");
  console.log("  ▸ rerun deferred_mints:", JSON.stringify(r.body.deferred_mints));
}

console.log("\n── 3. a covered-only workbook queues nothing ──");
{
  reset();
  approveAll("wbc");
  const r = await staffPost({ action: "apply", workbook_id: "wbc" });
  ok(r.status === 200 && r.body.ok === true, "apply of a covered-only workbook answers ok");
  ok(tickets().length === 0, `no ticket was queued (saw ${tickets().length})`);
  ok(Array.isArray(r.body.deferred_mints) && r.body.deferred_mints.length === 0, "and the report lists zero deferred mints");
  console.log("  ▸ covered-only deferred_mints:", JSON.stringify(r.body.deferred_mints));
  reset();
}

console.log("\n── 4. the type renders on the systems lane (it does not land nowhere) ──");
{
  // The producer side: the ticket carries type=billing_fix routed to systems.
  approveAll("wbm");
  const r = await staffPost({ action: "apply", workbook_id: "wbm" });
  const t = tickets()[0] || {};
  ok(r.body.ok === true && t.type === "billing_fix" && t.assignee_role === "systems",
    "apply queues a billing_fix ticket in the systems lane");

  // The consumer side: WebsiteV2View's QUEUE_TYPES (the ONLY systems-lane staff
  // page for this rail, per docs/plans/v2-action-item-map.md) must admit it.
  const viewSrc = fs.readFileSync(path.join(HERE, "..", "src", "views", "WebsiteV2View.jsx"), "utf8");
  const m = viewSrc.match(/const\s+QUEUE_TYPES\s*=\s*\[([^\]]*)\]/);
  ok(!!m, "found QUEUE_TYPES in WebsiteV2View.jsx");
  let queueTypes = (m ? m[1] : "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  // MUTATE=filternarrowed: simulate the pre-fix lane that excluded billing_fix.
  if (MUTATE === "filternarrowed") queueTypes = queueTypes.filter((x) => x !== "billing_fix");
  ok(queueTypes.includes(t.type),
    `the systems-lane filter admits '${t.type}' (QUEUE_TYPES = [${queueTypes.join(", ")}]) - it renders, it does not land nowhere`);
  console.log("  ▸ systems-lane QUEUE_TYPES:", JSON.stringify(queueTypes), "ticket.type:", t.type);
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
