// THE MEMBER RECEIPT SYSTEM.
//
//     node api/_member-receipts.test.mjs        # exits non-zero on any failure
//
// Plain node. No network, no database, no dependencies beyond the repo's own
// modules. Everything the send path touches (Resend, Supabase REST) goes through
// global fetch, which is stubbed below, so the REAL api/_member-receipts.js and the
// REAL api/_send.js run end to end against an in-memory database.
//
// Discovered by the CI glob (`for t in api/_*.test.mjs`) in
// .github/workflows/portal-ci.yml, and its negative controls are discovered from
// the MUTATE= lines in this header.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//
//   1. SEND-ONCE. Stripe fires invoice.payment_succeeded AND invoice.paid for one
//      payment; both reach the same handler. Two calls with the same invoice leave
//      ONE row and send ONE email. And the guard being proved is the REAL one: the
//      stub database enforces exactly the unique index it parses out of
//      supabase/migrations/20260731T190000_member_receipts.sql, so deleting that
//      index from the schema makes this section fail (MUTATE=dupindex).
//   2. OFF BY DEFAULT. receipt_mode NULL sends nothing and writes nothing. That is
//      every academy in production the day this ships.
//   3. V1 IS UNTOUCHED. v2_access false sends nothing even with receipt_mode set.
//   4. THE MODES. 'recurring' receipts every payment; 'first_only' receipts the
//      first and skips the second.
//   5. RECONCILE, NEVER DIVIDE. The owner's typed base run back through the SAME
//      api/_fees.js call that minted the Stripe price. Parts printed only on an
//      exact match; any drift prints the TOTAL ALONE and flags the row.
//   6. NO-TAX ACADEMY. No tax line, no registration line, and never the words
//      "no tax" - which would be a claim about somebody's tax position.
//   7. THE PORTAL LINE drops entirely for an academy with no stripe_portal_url,
//      and carries THAT ACADEMY'S OWN url when it has one.
//   8. REFUNDS reference the payment they reverse, by receipt number and by
//      refund_of, and go under BOTH modes.
//   9. A HELD SEND STILL WRITES THE ROW (and a failed one keeps it). The record of
//      money moving does not depend on the academy having finished its email setup.
//  9d. THE FOOTER A MEMBER READS. A receipt says the parent JOINED (the shell's own
//      FOOTER_REASON.joined, not new copy) and never that they enquired, and it
//      carries NO unsubscribe: no anchor, no empty href, no orphan "Unsubscribe"
//      word, no dangling separator. All THREE send paths - a paid invoice, a refund
//      confirmation and a staff resend - and the two params are pinned at both real
//      call sites, so a site that quietly stops passing them fails. In the same
//      section: BYTE IDENTITY. All ten BAM GTA templates are rendered through the
//      real renderEmail with none of the new params and compared to the committed
//      markup goldens - the same goldens api/_gta-message-lock.test.mjs holds, which
//      were generated from origin/main. A change to the shared shell that moved a
//      sales drip, a confirmation or the welcome email by one byte fails HERE too,
//      not only in that lock.
//  10. THE WIRE. api/stripe/webhook.js actually CALLS the module from inside
//      handleInvoiceSucceeded, awaited, with no conditional return in front of it;
//      api/members.js actionRefund calls it after the audit write; the resend
//      action is dispatched; and the names they call are names the module really
//      exports. A module that is defined and never called FAILS here.
//
// WHAT IT DOES NOT PROVE
//   - That the migrations have been applied to production. Nothing in this process
//     can see the real schema. The suite reads the migration FILE.
//   - That api/stripe/webhook.js or api/members.js behave correctly when executed.
//     Neither can be imported by a plain-node suite at all: both pull in
//     api/_runtime/*.ts through .js specifiers, which only Vercel's resolver
//     rewrites. So section 10 is a SOURCE-level proof of the wiring, pinned to the
//     real text of both files, and its two controls delete the real call sites.
//   - Anything about Stripe's actual invoice shape beyond the fields used here.
//   - That a parent's mail client renders the HTML well.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in a throwaway copy of the REAL source
// and must print NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it. A control
// whose pin no longer applies is reported as NEGATIVE CONTROL FAILED, never as a
// pass - a pin that fails to apply looks exactly like a check that passed.
//
//   MUTATE=dupindex   the unique partial index is deleted from the MIGRATION. The
//                     stub stops enforcing it (it reads the constraint from that
//                     file), so Stripe's double-fire writes two rows and sends the
//                     parent two receipts for one payment. This is the control that
//                     keeps section 1 a claim about the schema, not about my stub.
//   MUTATE=divide     the honesty gate stops gating: the parts are printed even
//                     when the owner's typed base does not add up to what was
//                     charged. A receipt then states a plan price and a tax figure
//                     that are simply not what the parent paid.
//   MUTATE=notaxwords an academy with no registration number prints "No tax" instead
//                     of printing nothing - a statement about somebody's tax position
//                     on a document they may hand to an accountant.
//   MUTATE=hardcode   the manage-membership line stops reading the academy's own
//                     fact and carries a literal URL, so every academy's parents are
//                     sent to one academy's billing portal.
//   MUTATE=v1         receiptModeFor drops the v2_access gate, so a V1 academy - one
//                     this system is supposed to be invisible to - starts emailing
//                     its parents.
//   MUTATE=firstonly  'first_only' stops meaning first only, and an academy that
//                     asked for one receipt per member gets one per payment.
//   MUTATE=rowgone    a send that does not succeed DELETES the receipt row instead
//                     of labelling it, so the record of the payment disappears
//                     exactly when the parent did not get their copy.
//   MUTATE=nowire     the receipt call is removed from handleInvoiceSucceeded in
//                     api/stripe/webhook.js. The module is perfect and nothing ever
//                     calls it - the failure this whole section exists for.
//   MUTATE=norefund   the refund confirmation call is removed from actionRefund in
//                     api/members.js. Same failure, other lane.
//   MUTATE=norls      the table ships with no RLS and no policies. Every row here is
//                     one academy's parent data - athlete name, amount paid, card
//                     last4 - and the portal ships a browser anon key, so on default
//                     grants any academy's login could read every other academy's.
//   MUTATE=alwaysok   a resend reports success whatever happened to the email, so a
//                     HELD send reads as "Done." and staff believe a parent has a
//                     receipt nobody sent. This is the bug as it shipped.
//   MUTATE=enquired   RECEIPT_FOOTER stops passing footerReason, so the shell falls
//                     back to its lead-nurture default and every receipt tells a
//                     paying member they "enquired about" the academy. This is the
//                     defect exactly as it shipped on 31 Jul 2026.
//   MUTATE=unsubback  RECEIPT_FOOTER stops passing noUnsubscribe, so the unsubscribe
//                     anchor comes back and a parent is offered an opt-out from the
//                     record of their own payment.
//   MUTATE=resendfoot only the RESEND site drops the pair. A new receipt is correct
//                     and the copy staff send when a parent says "I never got it" is
//                     the old broken one - the per-site failure that a single
//                     end-to-end check on the payment path would never see.
//   MUTATE=noagent    the list_receipts dispatcher branch is deleted from
//                     api/members-agent.js. The tool is still declared, the prompt
//                     still describes it, and it silently returns "unknown tool" -
//                     a feature that is present in every artifact except behaviour.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
let controlBroken = null;

// ─── copying real source, with at most one pinned edit ───────────────────────
// Same contract as api/_manage-membership-link.test.mjs: the file that runs is the
// real file byte for byte, plus the mutation under test. A pin that no longer
// matches is a BROKEN CONTROL, reported as such, never as a pass.
let copyCount = 0;
const tmpFiles = [];
function mutatedSource(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\n`
        + "Re-point it at the current code or delete it - a pin that fails to apply looks exactly like a check that passed.";
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}
// Mutant copies are named `.mutant-*` on purpose: api/_confirm-email-lock.test.mjs
// walks api/ counting sendOn() call sites and skips exactly that prefix, so a
// crashed run of this suite cannot leave a file behind that fails that one.
function copyModule(rel, edits) {
  const abs = path.join(HERE, rel);
  const tmp = path.join(path.dirname(abs), `.mutant-mr${++copyCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, mutatedSource(rel, edits));
  tmpFiles.push(tmp);
  return tmp;
}
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

// ─── the in-memory database ──────────────────────────────────────────────────
const DB = { clients: [], members: [], offers: [], offer_prices: [], member_receipts: [] };
let SENT = [];              // every email that reached the Resend stub
let RESEND_FAILS = false;   // flip to make the transport throw
const UNSTUBBED = new Set();

// ⛔ THE UNIQUE INDEX, READ OUT OF THE MIGRATION.
//
// This is the load-bearing line of the whole suite. The double-fire guarantee is a
// claim about the DATABASE, and a stub that enforces uniqueness because I decided
// it should would prove only that I decided it should. So the stub asks the real
// migration file whether the index exists, and enforces it only if it does. Delete
// the index from the SQL and section 1 fails - which is MUTATE=dupindex.
const MIGRATION_REL = "../supabase/migrations/20260731T190000_member_receipts.sql";
let MIGRATION_SQL = fs.readFileSync(path.join(HERE, MIGRATION_REL), "utf8");
if (MUTATE === "dupindex") {
  const idx = /CREATE UNIQUE INDEX[\s\S]*?;\n/.exec(MIGRATION_SQL);
  if (!idx) {
    controlBroken = "MUTATE=dupindex is pinned to a CREATE UNIQUE INDEX statement that is no longer in "
      + MIGRATION_REL + " - re-point it or delete it.";
    throw new Error(controlBroken);
  }
  MIGRATION_SQL = MIGRATION_SQL.replace(idx[0], "");
}
// The table ships without RLS - the state 78 sibling migrations do not leave their
// tables in, and the one that would make every academy's parent data readable by
// every other academy's login through the browser anon key.
// Surgical on purpose: it removes the RLS block and NOTHING else, so the
// assertions it trips are the RLS ones rather than half the schema section. A
// control that breaks five unrelated things tells you nothing about which check
// was watching.
if (MUTATE === "norls") {
  const rls = /ALTER TABLE public\.member_receipts ENABLE ROW LEVEL SECURITY;[\s\S]*?(?=\n-- ─── clients\.receipt_mode)/.exec(MIGRATION_SQL);
  if (!rls) {
    controlBroken = "MUTATE=norls is pinned to the ENABLE ROW LEVEL SECURITY block that is no longer in "
      + MIGRATION_REL + " - re-point it or delete it.";
    throw new Error(controlBroken);
  }
  MIGRATION_SQL = MIGRATION_SQL.replace(rls[0], "");
}
const norm = (s) => String(s).replace(/\s+/g, " ").toLowerCase();
const PAYMENT_INVOICE_UNIQUE =
  norm(MIGRATION_SQL).includes("create unique index if not exists member_receipts_payment_invoice_uniq on public.member_receipts (client_id, stripe_invoice_id) where kind = 'payment'");

// PostgREST-ish query engine: enough of eq. / like. / select / order / limit to run
// every query api/_member-receipts.js actually issues, and nothing more.
function runQuery(table, qs) {
  const p = new URLSearchParams(qs);
  let rows = DB[table] || [];
  for (const [k, v] of p.entries()) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const [op, ...rest] = String(v).split(".");
    const val = rest.join(".");
    if (op === "eq") rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val);
    else if (op === "is") rows = rows.filter((r) => (val === "null" ? r[k] == null : true));
    else if (op === "like") {
      const re = new RegExp("^" + val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%|\\\*/g, ".*") + "$");
      rows = rows.filter((r) => re.test(String(r[k] || "")));
    }
  }
  const order = p.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    rows = [...rows].sort((a, b) => String(a[col] || "").localeCompare(String(b[col] || "")) * (dir === "desc" ? -1 : 1));
  }
  const sel = p.get("select");
  if (sel && sel !== "*") {
    const cols = sel.split(",").map((c) => c.trim());
    rows = rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
  }
  const lim = parseInt(p.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}

let uid = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u === "https://api.resend.com/domains") {
    return json({ data: [{ name: "byanymeanstoronto.ca", status: "verified" }, { name: "byanymeanssanjose.com", status: "verified" }] });
  }
  if (u === "https://api.resend.com/emails" && method === "POST") {
    if (RESEND_FAILS) return json({ message: "stub transport down" }, 500);
    SENT.push({ to: body.to, subject: body.subject, html: body.html, from: body.from });
    return json({ id: `stub-${++uid}` });
  }
  if (u.startsWith("https://stub.supabase.test/rest/v1/")) {
    const [pathPart, qs = ""] = u.slice("https://stub.supabase.test/rest/v1/".length).split("?");
    const table = pathPart;
    if (!(table in DB)) {
      // Tables this suite does not model (email_suppressions, email_events, the
      // hold-notice bookkeeping). Recorded and reported rather than silently empty.
      UNSTUBBED.add(`${method} ${table}`);
      return json(method === "POST" ? [{ id: `x${++uid}` }] : []);
    }
    if (method === "POST") {
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: `r${++uid}`, created_at: new Date().toISOString(), sent_at: null, ...r }));
      if (table === "member_receipts" && PAYMENT_INVOICE_UNIQUE) {
        for (const r of rows) {
          if (r.kind !== "payment" || !r.stripe_invoice_id) continue;
          const clash = DB.member_receipts.some((e) => e.kind === "payment" && e.client_id === r.client_id && e.stripe_invoice_id === r.stripe_invoice_id);
          if (clash) {
            return json({ code: "23505", message: `duplicate key value violates unique constraint "member_receipts_payment_invoice_uniq"` }, 409);
          }
        }
      }
      DB[table].push(...rows);
      return json(rows);
    }
    if (method === "PATCH") {
      const hits = runQuery(table, qs);
      const ids = new Set(hits.map((h) => h.id));
      for (const r of DB[table]) if (ids.has(r.id)) Object.assign(r, body);
      return json([]);
    }
    if (method === "DELETE") {
      const ids = new Set(runQuery(table, qs).map((h) => h.id));
      DB[table] = DB[table].filter((r) => !ids.has(r.id));
      return json([]);
    }
    return json(runQuery(table, qs));
  }
  throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
};

// ─── the module under test ───────────────────────────────────────────────────
const MODULE_EDITS = {
  divide: [["if (allIn !== planCharged || (planCharged + feeTotal) !== total) {", "if (false) {"]],
  notaxwords: [[`  if (!num) return null;   // no number = no line. NEVER the words "no tax".`, `  if (!num) return "No tax";`]],
  hardcode: [["Manage your membership or update your card any time: {{location.portal_link}}", "Manage your membership or update your card any time: https://billing.stripe.com/p/login/bam_one_portal_for_everyone"]],
  v1: [["  if (c.v2_access !== true) return null;", "  // gate removed by the control"]],
  firstonly: [[`    if (mode === "first_only") {`, `    if (false) {`]],
  // Every resend reports success, whatever happened to the email. This is the bug
  // as it actually shipped: a 200 read as "Done." over a send that was HELD.
  alwaysok: [[`    return { ok: status === "sent", receipt_id: receipt.id`, `    return { ok: true, receipt_id: receipt.id`]],
  // The two halves of the receipt footer, broken one at a time. Both are pinned to
  // the ONE object every send site spreads, so each control changes exactly one of
  // the two claims and leaves the other true.
  enquired: [[`const RECEIPT_FOOTER = { footerReason: FOOTER_REASON.joined, noUnsubscribe: true };`,
    `const RECEIPT_FOOTER = { noUnsubscribe: true };`]],
  unsubback: [[`const RECEIPT_FOOTER = { footerReason: FOOTER_REASON.joined, noUnsubscribe: true };`,
    `const RECEIPT_FOOTER = { footerReason: FOOTER_REASON.joined };`]],
  // Per-SITE, not per-object: the resend stops spreading it and nothing else changes.
  resendfoot: [[`subject: msg.subject, body: msg.body, vars: varsFor(member), ...RECEIPT_FOOTER,`,
    `subject: msg.subject, body: msg.body, vars: varsFor(member),`]],
  rowgone: [[`      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ email_status: status, sent_at: sentAt }),`, `      method: status === "sent" ? "PATCH" : "DELETE", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ email_status: status, sent_at: sentAt }),`]],
};
const RECEIPTS = await import(pathToFileURL(
  MODULE_EDITS[MUTATE] ? copyModule("_member-receipts.js", MODULE_EDITS[MUTATE]) : path.join(HERE, "_member-receipts.js")
).href);
const { sendOn } = await import("./_send.js");

// The caller's own Supabase helper, byte-equivalent to the one in
// api/stripe/webhook.js and api/members.js (throws on a non-2xx, which is how the
// module sees the 23505).
async function sb(p, init = {}) {
  const res = await fetch(`https://stub.supabase.test/rest/v1/${p}`, {
    ...init,
    headers: { apikey: "k", Authorization: "Bearer k", "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
const stripeFetch = async (p) => {
  if (/^\/charges\//.test(p)) return { id: p.split("/").pop(), payment_method_details: { card: { brand: "visa", last4: "4242" } } };
  throw new Error(`unexpected stripe call ${p}`);
};

// ─── fixtures ────────────────────────────────────────────────────────────────
// Shaped like the real rows: a tax academy (GTA-style, HST inside the price) and a
// no-tax academy (San Jose-style). Every academy-specific answer is a VALUE on the
// row, which is the point - the code below never learns which is which.
const TAX_CFG = { label: "HST", pct: 13 };

function academy(over = {}) {
  return {
    id: `client-${over.tag || "x"}`,
    business_name: "BAM GTA", public_name: "By Any Means Toronto",
    v2_access: true, time_zone: "America/New_York",
    tax_config: TAX_CFG, receipt_mode: "recurring", tax_registration_number: "123456789 RT0001",
    stripe_portal_url: "https://billing.stripe.com/p/login/gta_fixture",
    email_domain: "byanymeanstoronto.ca", business_email: "info@byanymeanstoronto.ca",
    website_setup: { domain: "byanymeanstoronto.ca" }, address: "1079 Linbrook Rd, Oakville, ON",
    owner_name: "Zoran Savic", phone: "", tagline: "", instagram_url: "",
    community_group_url: "", community_group_platform: "", google_review_url: "",
    online_programs_url: "", referral_offer: null, notification_prefs: {},
    ...over,
  };
}
function member(clientId, over = {}) {
  return {
    id: `member-${over.tag || "a"}`, client_id: clientId,
    athlete_name: "Jordan Alvarez", parent_name: "Maya Alvarez",
    parent_email: "maya@example.com", plan: "1/wk", status: "live",
    ...over,
  };
}
const GTA_OFFERINGS = [{
  type: "membership", title: "Steady", archived: false,
  price: "200", taxable: "Yes", added_fees: "",
  signup_fee: "40", signup_fee_taxable: "No",
  commitments: [{ length: "3 months", price: "540", taxable: "Yes" }],
}];
const GTA_PRICES = [
  { stripe_price_id: "price_steady_monthly", source_offer_price_key: "Steady|monthly", title: "1/Wk - Monthly", amount_cents: 22600, currency: "cad" },
  { stripe_price_id: "price_steady_signup", source_offer_price_key: "Steady|signup_fee", title: "One-time signup fee", amount_cents: 4000, currency: "cad" },
];

function invoice(id, lines, amountPaid, over = {}) {
  return {
    id, currency: "cad", amount_paid: amountPaid, charge: over.charge || `ch_${id}`,
    status_transitions: { paid_at: Math.floor(Date.parse("2026-07-31T14:00:00Z") / 1000) },
    lines: { data: lines },
    ...over,
  };
}
const MONTHLY = () => [{ amount: 22600, price: { id: "price_steady_monthly" } }];
const FIRST = () => [{ amount: 22600, price: { id: "price_steady_monthly" } }, { amount: 4000, price: { id: "price_steady_signup" } }];

// Seeds one academy + one member and returns both. Fresh ids per section so
// api/_send.js's 30s per-client sender cache cannot leak one academy's identity
// into another's assertions.
function seed({ tag, clientOver = {}, memberOver = {}, offerings = GTA_OFFERINGS, prices = GTA_PRICES }) {
  const c = academy({ tag, ...clientOver });
  const m = member(c.id, { tag, ...memberOver });
  DB.clients.push(c);
  DB.members.push(m);
  DB.offers.push({ client_id: c.id, type: "training", sort_order: 0, data: { pricing: { pricing_offerings: offerings } } });
  for (const p of prices) DB.offer_prices.push({ tenant_id: c.id, ...p });
  return { client: c, member: m };
}
const receiptsFor = (clientId) => DB.member_receipts.filter((r) => r.client_id === clientId);
const lastEmail = () => SENT[SENT.length - 1] || null;
// The words a parent reads. Block ends become newlines BEFORE tags are stripped -
// without that, the end of one paragraph runs into the start of the next
// ("No taxThanks for being part of...") and a \b-anchored search for a forbidden
// phrase silently stops matching. That is not a hypothetical: it is how the first
// run of MUTATE=notaxwords reported itself as a failed control.
const textOf = (html) => String(html || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|td|tr|table|h[1-6]|li)>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");

const payFor = (m, inv) => RECEIPTS.maybeSendPaymentReceipt({ sb, sendOn, member: m, invoice: inv, stripeFetch });

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the double-fire: one payment, one row, one email ──");
{
  const { client, member: m } = seed({ tag: "dbl" });
  const inv = invoice("in_dbl", MONTHLY(), 22600);
  // Exactly what Stripe does: invoice.payment_succeeded, then invoice.paid, both
  // routed to the same handler milliseconds apart.
  const a = await payFor(m, inv);
  const b = await payFor(m, inv);

  ok(PAYMENT_INVOICE_UNIQUE, "the migration declares the unique partial index the guard depends on");
  ok(receiptsFor(client.id).length === 1, `two events left ONE receipt row (saw ${receiptsFor(client.id).length})`);
  ok(SENT.length === 1, `and ONE email reached the transport (saw ${SENT.length})`);
  ok(a.ok === true && a.email_status === "sent", "the first event issued and sent it");
  ok(b.skipped === "already receipted" && b.receipted === true,
    `the second reported "already receipted" rather than sending (saw ${JSON.stringify(b)})`);
}

console.log("\n── 2. off by default: receipt_mode NULL, and V1 ──");
{
  SENT = [];
  const off = seed({ tag: "off", clientOver: { receipt_mode: null } });
  const r1 = await payFor(off.member, invoice("in_off", MONTHLY(), 22600));
  ok(receiptsFor(off.client.id).length === 0 && SENT.length === 0,
    "receipt_mode NULL wrote nothing and sent nothing - the state of every academy on day one");
  ok(/off for this academy/.test(String(r1.skipped)), `and said so plainly (saw ${JSON.stringify(r1)})`);

  // A V1 academy with receipt_mode somehow set (a mis-typed row, a bad backfill).
  // v2_access is checked FIRST and independently, so it still sends nothing.
  const v1 = seed({ tag: "v1", clientOver: { v2_access: false, receipt_mode: "recurring" } });
  const r2 = await payFor(v1.member, invoice("in_v1", MONTHLY(), 22600));
  ok(receiptsFor(v1.client.id).length === 0 && SENT.length === 0,
    "a V1 academy is untouched even with receipt_mode set");
  ok(r2.skipped === "not a V2 academy", `and is refused on v2_access, before any write (saw ${JSON.stringify(r2)})`);
}

console.log("\n── 3. the two modes ──");
{
  SENT = [];
  const rec = seed({ tag: "rec" });
  await payFor(rec.member, invoice("in_rec1", MONTHLY(), 22600));
  await payFor(rec.member, invoice("in_rec2", MONTHLY(), 22600));
  ok(receiptsFor(rec.client.id).length === 2, "'recurring' receipts EVERY payment");
  ok(SENT.length === 2, "and emails each one");
  const nums = receiptsFor(rec.client.id).map((r) => r.receipt_number);
  ok(nums[0] === "BAMGTA-2026-0001" && nums[1] === "BAMGTA-2026-0002",
    `numbered per academy per year from the academy's own name (saw ${nums.join(", ")})`);

  SENT = [];
  const fo = seed({ tag: "fo", clientOver: { receipt_mode: "first_only" } });
  const first = await payFor(fo.member, invoice("in_fo1", FIRST(), 26600));
  const second = await payFor(fo.member, invoice("in_fo2", MONTHLY(), 22600));
  ok(receiptsFor(fo.client.id).length === 1 && SENT.length === 1,
    `'first_only' receipted the first payment and skipped the second (saw ${receiptsFor(fo.client.id).length} rows)`);
  ok(first.ok === true && /already has a payment receipt/.test(String(second.skipped)),
    `and named the reason (saw ${JSON.stringify(second)})`);
}

console.log("\n── 4. reconcile, never divide ──");
{
  SENT = [];
  const { client, member: m } = seed({ tag: "rc" });
  await payFor(m, invoice("in_rc", FIRST(), 26600));
  const row = receiptsFor(client.id)[0];
  const items = row.lines.items;
  ok(row.lines.reconciled === true, "the owner's typed base reconciled to the cent against what Stripe charged");
  ok(items.some((i) => i.kind === "plan" && i.amount_cents === 20000), "the plan line is the TYPED price (200.00), not a division of the total");
  ok(items.some((i) => i.kind === "tax" && i.amount_cents === 2600 && i.label === "HST 13%"), "the tax line is the DIFFERENCE, named by the academy's own template");
  ok(items.some((i) => i.kind === "signup_fee" && i.amount_cents === 4000), "the one-time signup fee is its own line, not folded into the total");
  ok(row.amount_cents === 26600, "and the total is what was charged");
  const body = textOf(lastEmail().html);
  ok(/HST 13%: \$26\.00 CAD/.test(body) && /Total paid: \$266\.00 CAD/.test(body), "all of which a parent can read on the receipt");

  // The drift this gate exists for: the owner edits the typed base and does not
  // re-price, so the parts no longer add up to the charge.
  SENT = [];
  const drift = seed({
    tag: "drift",
    offerings: [{ ...GTA_OFFERINGS[0], price: "210" }],
  });
  await payFor(drift.member, invoice("in_drift", MONTHLY(), 22600));
  const d = receiptsFor(drift.client.id)[0];
  ok(d.lines.reconciled === false, "a base that does not add up flags the row instead of guessing");
  ok(!!d.lines.reason && /23730/.test(d.lines.reason), `and records the drift for staff (saw ${d.lines.reason})`);
  ok(d.amount_cents === 22600, "the receipt still carries the true total");
  const dbody = textOf(lastEmail().html);
  ok(/Total paid: \$226\.00 CAD/.test(dbody), "which is what the parent sees");
  // The registration line still prints (the academy has a number, and that is true
  // whatever the row drift is). What must NOT appear is a breakdown: no tax line,
  // and neither the typed base nor the wrong all-in figure.
  ok(!/HST 13%:/.test(dbody) && !/\$210\.00/.test(dbody) && !/\$200\.00/.test(dbody) && !/\$237\.30/.test(dbody),
    "and NO plan or tax breakdown at all - the total states itself alone");
}

console.log("\n── 5. a no-tax academy ──");
{
  SENT = [];
  const sj = seed({
    tag: "sj",
    clientOver: {
      business_name: "BAM San Jose", public_name: "By Any Means San Jose",
      tax_config: null, tax_registration_number: null, time_zone: "America/Los_Angeles",
      email_domain: "byanymeanssanjose.com", business_email: "info@byanymeanssanjose.com",
      website_setup: { domain: "byanymeanssanjose.com" }, address: "1051 W San Fernando St, San Jose, CA 95126",
      stripe_portal_url: "",
    },
    offerings: [{ type: "membership", title: "Steady", archived: false, price: "150", added_fees: "", commitments: [] }],
    prices: [{ stripe_price_id: "price_sj", source_offer_price_key: "Steady|monthly", title: "1/Wk - Monthly", amount_cents: 15000, currency: "usd" }],
  });
  await payFor(sj.member, invoice("in_sj", [{ amount: 15000, price: { id: "price_sj" } }], 15000, { currency: "usd" }));
  const row = receiptsFor(sj.client.id)[0];
  ok(row.lines.reconciled === true && row.lines.items.length === 1, "a no-tax academy reconciles with a plan line and nothing else");
  ok(!row.lines.items.some((i) => i.kind === "tax"), "no tax line is produced");
  const body = textOf(lastEmail().html);
  ok(!/\bno tax\b/i.test(body), "and the receipt NEVER says 'no tax' - that is a claim about a tax position we do not own");
  ok(!/HST|GST|registration/i.test(body), "no registration line either, because the academy has no number on file");
  ok(/Total paid: \$150\.00 USD/.test(body), "the total is stated in the academy's own currency");
  ok(row.receipt_number.startsWith("BAMSAN-"), `and the number carries ITS OWN prefix, not the other academy's (saw ${row.receipt_number})`);

  // Same section, the portal line: this academy has no stripe_portal_url.
  ok(!/Manage your membership/i.test(body), "with no billing portal on file the manage-membership line is GONE, not a dead link");
  ok(!/billing\.stripe\.com/.test(lastEmail().html), "and no billing portal URL of any kind appears - never another academy's");
}

console.log("\n── 6. the portal line, for an academy that HAS one ──");
{
  SENT = [];
  const { member: m } = seed({ tag: "portal" });
  await payFor(m, invoice("in_portal", MONTHLY(), 22600));
  const html = lastEmail().html;
  ok(/Manage your membership or update your card any time/.test(textOf(html)), "the manage-membership line renders");
  ok(html.includes("https://billing.stripe.com/p/login/gta_fixture"), "pointing at THIS academy's own portal, off its own row");
}

console.log("\n── 7. the receipt a parent actually reads ──");
{
  SENT = [];
  const { member: m } = seed({ tag: "copy" });
  await payFor(m, invoice("in_copy", MONTHLY(), 22600));
  const e = lastEmail();
  const body = textOf(e.html);
  ok(/^Payment receipt BAMGTA-2026-\d{4}$/.test(e.subject), `the subject names the document and its number (saw "${e.subject}")`);
  ok(/Hi Maya,/.test(body), "it greets the PARENT by name");
  ok(/Athlete: Jordan Alvarez/.test(body), "and names the athlete, so a household with two of them can tell the receipts apart");
  ok(/Plan: 1\/Wk - Monthly/.test(body), "and the plan");
  // 31 Jul 14:00 UTC is still 31 Jul in New York, and this is the academy's zone,
  // not the server's.
  ok(/Paid: July 31, 2026/.test(body), `the paid date is in the ACADEMY'S time zone (saw ${/Paid: [^\n]*/.exec(body)})`);
  ok(/Card: Visa ending 4242/.test(body), "the card is named when Stripe gave us one");
  ok(/HST registration: 123456789 RT0001/.test(body), "and a tax academy prints its registration number");
  // "BAM Toronto", not "By Any Means Toronto", and that is CORRECT: fromFor() in
  // api/_send.js keeps the legacy From string byte-identical for the one academy
  // that already owns info@byanymeanstoronto.ca, so its parents see zero header
  // drift. The receipt inherits that rule rather than inventing a sender.
  ok(e.from === "BAM Toronto <info@byanymeanstoronto.ca>", `it goes out AS the academy, through the shared sender rule (saw ${e.from})`);
  ok(/By Any Means Toronto/.test(body), "in the academy's own branded shell");
  ok(!/[—–]/.test(body), "and carries no em dash anywhere in it");
}

console.log("\n── 8. refunds ──");
{
  SENT = [];
  const { client, member: m } = seed({ tag: "ref" });
  await payFor(m, invoice("in_ref", MONTHLY(), 22600, { charge: "ch_ref" }));
  const original = receiptsFor(client.id)[0];
  SENT = [];
  const out = await RECEIPTS.sendRefundReceipt({
    sb, sendOn, member: m, chargeId: "ch_ref",
    refund: { id: "re_1", amount: 22600, currency: "cad" },
  });
  const refund = receiptsFor(client.id).find((r) => r.kind === "refund");
  ok(!!refund && out.ok === true, "a refund writes its own row and sends its own confirmation");
  ok(refund.refund_of === original.id, "the row points at the payment receipt it reverses");
  ok(refund.stripe_refund_id === "re_1" && refund.amount_cents === 22600, "carrying the Stripe refund id and the amount");
  const body = textOf(lastEmail().html);
  ok(new RegExp(`Original receipt: ${original.receipt_number}`).test(body), "and the parent's copy names the original receipt number");
  ok(/Refunded: \$226\.00 CAD/.test(body), "the amount");
  ok(/Back to: Visa ending 4242/.test(body), "and the card it goes back to, read off the original rather than guessed");

  // A refund under 'first_only', for a member who already had their one receipt.
  SENT = [];
  const fo = seed({ tag: "refo", clientOver: { receipt_mode: "first_only" } });
  await payFor(fo.member, invoice("in_refo", MONTHLY(), 22600, { charge: "ch_refo" }));
  SENT = [];
  await RECEIPTS.sendRefundReceipt({ sb, sendOn, member: fo.member, chargeId: "ch_refo", refund: { id: "re_2", amount: 5000, currency: "cad" } });
  ok(SENT.length === 1 && receiptsFor(fo.client.id).some((r) => r.kind === "refund"),
    "refunds send under BOTH modes - money coming back is not routine billing mail");
}

console.log("\n── 9. a held send, and a failed one, still leave the row ──");
{
  SENT = [];
  // No sending domain on the row: api/_send.js HOLDS rather than sending as
  // somebody else. The academy's email setup is unfinished; the payment is not.
  const held = seed({ tag: "held", clientOver: { email_domain: "" } });
  const r = await payFor(held.member, invoice("in_held", MONTHLY(), 22600));
  const row = receiptsFor(held.client.id)[0];
  ok(!!row, "an academy that cannot send email still gets the receipt ROW");
  ok(!!row && row.email_status === "held", `labelled held, not deleted (saw ${row ? row.email_status : "the row is GONE"})`);
  ok(SENT.length === 0, "and nothing generic went out in the academy's place");
  ok(r.ok === true && /domain/.test(String(r.note)), `the caller is told why (saw ${JSON.stringify(r.note)})`);

  // The transport itself failing, after the row is already written.
  RESEND_FAILS = true;
  const bad = seed({ tag: "fail" });
  await payFor(bad.member, invoice("in_fail", MONTHLY(), 22600));
  RESEND_FAILS = false;
  const frow = receiptsFor(bad.client.id)[0];
  ok(!!frow && frow.email_status === "failed", `a transport failure marks the row failed and KEEPS it (saw ${frow ? frow.email_status : "the row is GONE"})`);

  // ...which is what makes resend meaningful. It re-renders from the STORED row.
  // A row that did not survive its own failure cannot be resent at all, so the rest
  // of this section is skipped rather than crashed - it is already reported above.
  SENT = [];
  const again = frow ? await RECEIPTS.resendReceipt({ sb, sendOn, member: bad.member, receiptId: frow.id }) : {};
  ok(again.ok === true && SENT.length === 1, "and staff can resend it once the transport is back");
  ok(!!frow && textOf((lastEmail() || {}).html).includes(frow.receipt_number), "the resend carries the SAME receipt number - the original document, not a new one");
  ok(receiptsFor(bad.client.id).length === 1, "and no second row is minted by a resend");
  const foreign = await RECEIPTS.resendReceipt({ sb, sendOn, member: member("client-nobody", { tag: "z" }), receiptId: (frow && frow.id) || "nope" });
  ok(foreign.skipped === "receipt not found for this member", "a receipt id from another academy is simply not found");
}

console.log("\n── 9b. a resend that did not reach anybody must not read as success ──");
// The API returns 200 for sent, held AND not-found: in all three the request
// worked and the row was found-or-not, which is a different question from whether
// a parent got an email. Both agent confirm lanes used to push "Done." on any 200,
// so the bot told staff a receipt had been sent when nothing left the building.
{
  const held = seed({ tag: "resend-held", clientOver: { email_domain: "" } });
  await payFor(held.member, invoice("in_rsh", MONTHLY(), 22600));
  // Null-safe: a mutation that deletes the row instead of labelling it (MUTATE=
  // rowgone) is already reported by section 9, and must not crash this one on the
  // way past - a suite that throws prints no NEGATIVE CONTROL banner at all, which
  // reads to CI as a control that was not caught.
  const hrow = receiptsFor(held.client.id)[0];
  SENT = [];
  const out = hrow ? await RECEIPTS.resendReceipt({ sb, sendOn, member: held.member, receiptId: hrow.id }) : {};
  ok(out.email_status === "held" && SENT.length === 0, "a resend for an academy with no sending domain HOLDS, and nothing goes out");
  ok(out.ok === false, `and the module reports ok:false, not a bare 200 (saw ${JSON.stringify(out.ok)})`);

  // The API layer's contract, read off the real source: `...out` then `ok` last, so
  // a SKIPPED result (receipt not found, no email on file) carries ok === false
  // rather than undefined. Undefined is falsy and would look fine; it is not the
  // same claim, and it is not what a caller asserting ok === false would get.
  const members = fs.readFileSync(path.join(HERE, "members.js"), "utf8");
  ok(members.includes(`return res.status(200).json({ ...out, ok: (out && out.email_status) === "sent" });`),
    "the API sets ok from email_status alone, with the spread FIRST so nothing can overwrite it");

  // The three outcomes, decided in ONE place in the portal, read by all three
  // surfaces: the drawer's Resend button, the command bar and the Members-tab agent.
  const portal = fs.readFileSync(path.join(HERE, "../public/client-portal.html"), "utf8");
  const outcome = /function _resendOutcome\(result\) \{([\s\S]*?)\n\}/.exec(portal);
  ok(!!outcome, "the portal has a single _resendOutcome() the surfaces share");
  const fn = outcome ? outcome[1] : "";
  ok(/status === 'sent'\) return \{ ok: true/.test(fn), "only email_status 'sent' is a success");
  ok(/status === 'held'\) return \{ ok: false/.test(fn) && /Not sent\./.test(fn), "held is reported as NOT SENT, in those words");
  ok((fn.match(/ok: false/g) || []).length === 2, "and so is every other outcome - there is no optimistic default");
  ok(/nothing left the building/.test(fn), "the held sentence tells staff nothing reached the parent");
  ok(/still on file/.test(fn), "and that the receipt survives, so resending later is the fix");

  // The two agent confirm lanes. Both used to push "Done." unconditionally; both
  // must now route a resend through the shared function. A lane that stops calling
  // it goes back to claiming a held send succeeded.
  const lanes = (portal.match(/if \(p\.action === 'resend-receipt'\)[^\n]*_resendOutcome\(result\)/g) || []).length;
  const laneAlt = (portal.match(/p\.action === 'resend-receipt'\) \{\n\s*\/\/[\s\S]{0,400}?_resendOutcome\(result\)/g) || []).length;
  ok(lanes + laneAlt >= 2, `both agent confirm lanes route a resend through it (saw ${lanes + laneAlt})`);
  ok(/_plToast\(_resendOutcome\(j\)\.text\)/.test(portal), "and so does the drawer's Resend button - one decision, three surfaces");
}

console.log("\n── 9c. the Members agent, EXECUTED ──");
// api/members-agent.js imports cleanly on plain node (unlike webhook.js and
// members.js, which reach api/_runtime/*.ts through .js specifiers), so this lane
// gets the real instrument: the actual handler, driven end to end with Claude
// stubbed at the wire. Source pins would let a renamed tool or a deleted dispatcher
// branch ship green - the agent would simply stop being able to do the thing, and
// nothing would say so.
//
// TWO things are proved by running it, and neither is visible to a grep:
//   the READ tool actually reaches execListReceipts and returns this member's rows
//   the WRITE tool returns a PROPOSAL and executes nothing
{
  const ag = seed({ tag: "agent" });
  await payFor(ag.member, invoice("in_ag", MONTHLY(), 22600));
  const issued = receiptsFor(ag.client.id)[0];
  const before = receiptsFor(ag.client.id).length;
  SENT = [];

  // Claude, stubbed: turn 1 calls list_receipts, turn 2 proposes resend-receipt
  // with what the first turn returned. The tool RESULT the handler feeds back is
  // captured, which is how the dispatcher branch is measured.
  let turn = 0, toolResult = null;
  const CLAUDE = async (init) => {
    const body = JSON.parse(init.body);
    const last = body.messages[body.messages.length - 1];
    if (Array.isArray(last.content) && last.content[0] && last.content[0].type === "tool_result") {
      toolResult = JSON.parse(last.content[0].content);
    }
    turn++;
    if (turn === 1) {
      return { content: [{ type: "text", text: "Checking what has been issued." }, { type: "tool_use", id: "t1", name: "list_receipts", input: { member_id: ag.member.id } }] };
    }
    const r = (toolResult && toolResult.receipts && toolResult.receipts[0]) || {};
    return { content: [{ type: "text", text: "Proposing a resend." }, { type: "tool_use", id: "t2", name: "resend-receipt", input: { member_id: ag.member.id, receipt_id: r.receipt_id, receipt_number: r.receipt_number } }] };
  };

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (u === "https://api.anthropic.com/v1/messages") return json(await CLAUDE(init));
    if (u.endsWith("/auth/v1/user")) return json({ id: "user-1", email: "staff@bam.test" });
    if (u.includes("/rest/v1/staff?")) return json([{ id: "staff-1", name: "Cole", role: "admin" }]);
    return prevFetch(url, init);
  };
  process.env.ANTHROPIC_API_KEY = "stub-anthropic-key";

  const AGENT_EDITS = {
    noagent: [[`        } else if (t.name === "list_receipts") {
          result = await execListReceipts(clientId, t.input?.member_id);`, `        } else if (false) {`]],
  };
  const agentPath = MUTATE === "noagent" ? copyModule("members-agent.js", AGENT_EDITS.noagent) : path.join(HERE, "members-agent.js");
  const handler = (await import(pathToFileURL(agentPath).href)).default;

  let out = null;
  const res = { status() { return this; }, json(v) { out = v; return this; } };
  await handler(
    { method: "POST", headers: { authorization: "Bearer stub" }, body: { client_id: ag.client.id, message: "send Maya her receipt again" } },
    res
  );

  ok(!!toolResult && Array.isArray(toolResult.receipts) && toolResult.receipts.length === 1,
    `the list_receipts dispatcher branch RAN and returned this member's receipts (saw ${JSON.stringify(toolResult && (toolResult.receipts || toolResult.error))})`);
  ok(!!toolResult && toolResult.receipts && toolResult.receipts[0].receipt_number === issued.receipt_number,
    "with the real receipt number off the row, not a placeholder");
  ok(!!out && !!out.proposal, `the write tool came back as a PROPOSAL (saw ${JSON.stringify(out && Object.keys(out))})`);
  ok(!!out && out.proposal && out.proposal.action === "resend-receipt",
    `named exactly like the api/members.js action, so the confirm maps 1:1 (saw ${out && out.proposal && out.proposal.action})`);
  ok(!!out && out.proposal && out.proposal.body && out.proposal.body.receipt_id === issued.id,
    "carrying the receipt id the read tool supplied");
  ok(!!out && out.proposal && new RegExp(`another copy of receipt ${issued.receipt_number}`).test(out.proposal.summary),
    `and a confirm line naming the receipt by NUMBER, not uuid (saw "${out && out.proposal && out.proposal.summary}")`);
  ok(receiptsFor(ag.client.id).length === before && SENT.length === 0,
    "and NOTHING was executed - no row, no email, until a human confirms");

  globalThis.fetch = prevFetch;
}

console.log("\n── 9d. the footer a MEMBER reads ──");
// THE LIVE DEFECT, 31 Jul 2026. Receipts went on for BAM GTA's 35 paying members and
// every one ended "You're receiving this because you enquired about By Any Means
// Toronto." with an Unsubscribe link under it. Both halves are wrong and they are
// wrong differently: the first is a false statement about how somebody came to be a
// member, the second offers to opt a parent out of the record of their own payment.
//
// The copy is NOT retyped here. Both the sentence and the anchor are read out of
// api/email-templates/_shell.js, so this section cannot drift from the shell it is
// making a claim about, and re-wording the shell's sentence does not silently make
// this pass against the old words.
{
  const { FOOTER_REASON, SHELL_FOOT } = await import("./email-templates/_shell.js");
  const { renderEmail, renderStepMessage, clientVars } = await import("./email-shells.js");
  const ACADEMY = "By Any Means Toronto";              // the fixture's public_name
  const JOINED = FOOTER_REASON.joined.replace("{{ACADEMY_FULL}}", ACADEMY);
  const ENQUIRED = FOOTER_REASON.enquired.replace("{{ACADEMY_FULL}}", ACADEMY);

  // The footer's reason paragraph, whole. Taken by locating the sentence and walking
  // out to its own <p>, so the assertion below is about EVERYTHING in that paragraph
  // - which is how "no orphan word, no dangling separator" is checked rather than
  // asserted. A `<a href="">` or a stranded "&middot;" left behind by a sloppy strip
  // would still be inside these bounds.
  function reasonParagraph(html) {
    const s = String(html || "");
    const i = s.indexOf("You're receiving this because");
    if (i < 0) return "";
    const start = s.lastIndexOf("<p ", i);
    const end = s.indexOf("</p>", i);
    return start < 0 || end < 0 ? "" : s.slice(start, end + 4);
  }
  const innerOf = (p) => String(p).replace(/^<p\b[^>]*>/, "").replace(/<\/p>$/, "");

  // Everything a receipt's footer must be, checked the same way for all three send
  // paths. `where` names the path so a failure says WHICH one regressed.
  function assertReceiptFooter(html, where) {
    const para = reasonParagraph(html);
    const inner = innerOf(para).trim();
    ok(inner === JOINED,
      `${where}: the footer is the shell's JOINED sentence and nothing else (saw ${JSON.stringify(inner.slice(0, 120))})`);
    ok(!String(html).includes(ENQUIRED), `${where}: and never tells a paying member they enquired`);
    // The unsubscribe, refused four ways - the four shapes a half-done removal leaves.
    ok(!/>\s*Unsubscribe\s*</i.test(html), `${where}: no unsubscribe anchor`);
    ok(!/href=""/.test(html), `${where}: and no empty href where one used to be`);
    ok(!/Unsubscribe/i.test(textOf(html)), `${where}: no orphan "Unsubscribe" word anywhere a parent can read`);
    ok(!/&middot;|·/.test(inner) && !/<a\b/i.test(inner),
      `${where}: and nothing dangling in the paragraph the anchor came out of`);
  }

  // ── the three send paths, driven end to end ────────────────────────────────
  SENT = [];
  const { member: pm } = seed({ tag: "foot-pay" });
  await payFor(pm, invoice("in_foot", MONTHLY(), 22600, { charge: "ch_foot" }));
  ok(SENT.length === 1, `a payment receipt reached the transport (saw ${SENT.length})`);
  assertReceiptFooter((lastEmail() || {}).html, "payment receipt");

  SENT = [];
  await RECEIPTS.sendRefundReceipt({ sb, sendOn, member: pm, chargeId: "ch_foot", refund: { id: "re_foot", amount: 22600, currency: "cad" } });
  ok(SENT.length === 1, `a refund confirmation reached the transport (saw ${SENT.length})`);
  assertReceiptFooter((lastEmail() || {}).html, "refund confirmation");

  // The resend re-RENDERS, which is why it is a third path and not a repeat: it goes
  // back through renderReceipt and the shell, so it can carry the old footer even
  // when the two sends above are fixed. That is MUTATE=resendfoot.
  SENT = [];
  const issued = DB.member_receipts.filter((r) => r.client_id === pm.client_id && r.kind === "payment")[0];
  const rs = issued ? await RECEIPTS.resendReceipt({ sb, sendOn, member: pm, receiptId: issued.id }) : {};
  ok(rs.ok === true && SENT.length === 1, `a staff resend reached the transport (saw ${JSON.stringify(rs.email_status)})`);
  assertReceiptFooter((lastEmail() || {}).html, "staff resend");

  // ── the wiring, structurally ───────────────────────────────────────────────
  // Reading the rendered footer proves the CURRENT three paths are right. It cannot
  // prove a FOURTH send site added later carries the pair, and the module's own
  // source is where that is visible. Comments stripped first: this file's own header
  // and the module's both name RECEIPT_FOOTER in prose.
  const codeOnly = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
  const modSrc = codeOnly(fs.readFileSync(path.join(HERE, "_member-receipts.js"), "utf8"));
  ok(/const RECEIPT_FOOTER = \{ footerReason: FOOTER_REASON\.joined, noUnsubscribe: true \};/.test(modSrc),
    "the module declares ONE footer object, taking the sentence from the shell rather than retyping it");
  ok(/import \{ FOOTER_REASON \} from "\.\/email-templates\/_shell\.js";/.test(modSrc),
    "imported from the shell, so re-wording there reaches the receipt");
  const calls = modSrc.match(/\bsendOn\(\{[\s\S]*?\}\);/g) || [];
  ok(calls.length === 2, `every sendOn() site in the module is accounted for (saw ${calls.length}, expected the 2 that serve all 3 paths)`);
  ok(calls.every((c) => c.includes("...RECEIPT_FOOTER")),
    `and every one of them spreads it (saw ${calls.filter((c) => !c.includes("...RECEIPT_FOOTER")).length} that do not)`);

  // ── the suppression is a suppression, not a deletion ───────────────────────
  // If somebody "fixed" this by deleting the anchor from the shared shell, every
  // assertion above would still pass and every sales drip would silently lose its
  // unsubscribe link. So the shell must STILL carry it.
  ok(/<a href="\{\{UNSUBSCRIBE\}\}"[^>]*>Unsubscribe<\/a>/.test(SHELL_FOOT),
    "the shared shell still HAS an unsubscribe anchor - receipts suppress it, they do not delete it for everybody");

  // ── BYTE IDENTITY: nothing that is not a receipt moved ─────────────────────
  // A plain body through the untouched path: still the lead-nurture sentence, still
  // the link. This is the default every existing caller of sendOn gets.
  const plain = renderStepMessage({
    channel: "email", clientId: pm.client_id, subject: "Still coming?",
    body: "Hi {{contact.first_name}}, still keen to come down?",
    vars: clientVars(DB.clients.find((c) => c.id === pm.client_id)),
  });
  ok(plain.html.includes(ENQUIRED), "a NON-receipt email still carries the enquired sentence - the default did not move");
  ok(/>Unsubscribe</.test(plain.html) && plain.html.includes("mailto:info@byanymeanstoronto.ca?subject=Unsubscribe"),
    "and still carries its unsubscribe link, pointed at the academy's own address");

  // The real thing: all ten BAM GTA templates against the committed markup goldens.
  // Those files were generated from origin/main, so this is a literal before/after
  // byte comparison of production's own emails - the sales drips, the confirmations
  // and the welcome email - across this change. Rendered through the SAME fixture
  // api/_gta-message-lock.test.mjs uses, imported from it rather than copied, so
  // there is one answer to "what does GTA's row look like".
  const LOCK = await import("./_gta-message-lock.test.mjs");
  const moved = [];
  for (const key of LOCK.KEYS) {
    const goldenPath = path.join(HERE, "__goldens__", "bam-gta", "markup", `${key}.html`);
    if (!fs.existsSync(goldenPath)) { moved.push(`${key} (no golden)`); continue; }
    if (fs.readFileSync(goldenPath, "utf8") !== LOCK.renderWith(renderEmail, key)) moved.push(key);
  }
  ok(LOCK.KEYS.length === 10, `all ten GTA templates are in the set being compared (saw ${LOCK.KEYS.length})`);
  ok(moved.length === 0, `and every one is BYTE-IDENTICAL to its committed golden (moved: ${moved.join(", ") || "none"})`);
}

console.log("\n── 10. THE WIRE ──");
// Neither api/stripe/webhook.js nor api/members.js can be imported by a plain-node
// suite (both reach api/_runtime/*.ts through .js specifiers that only Vercel's
// resolver rewrites), so this section is pinned to their SOURCE. That is a weaker
// instrument than execution and it is used deliberately for the one thing it is
// strong at: proving the call EXISTS, in the right function, awaited, unconditional,
// and naming an export that is really there. The two controls delete the real call
// sites, so a module that is perfect and never called fails here.
{
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

  const WEBHOOK_EDITS = { nowire: [["  await sendPaymentReceipt(member, inv, connectedAccount);", "  // call removed by the control"]] };
  const MEMBERS_EDITS = { norefund: [[`  const receipt = await receiptsCall("sendRefundReceipt", {`, `  const receipt = null && ((`]] };
  const webhook = strip(MUTATE === "nowire" ? mutatedSource("stripe/webhook.js", WEBHOOK_EDITS.nowire) : fs.readFileSync(path.join(HERE, "stripe/webhook.js"), "utf8"));
  const members = strip(MUTATE === "norefund" ? mutatedSource("members.js", MEMBERS_EDITS.norefund) : fs.readFileSync(path.join(HERE, "members.js"), "utf8"));

  // The body of handleInvoiceSucceeded, from its declaration to the next top-level
  // `async function` / `function` at column 0.
  function bodyOf(src, decl) {
    const start = src.indexOf(decl);
    if (start < 0) return null;
    const rest = src.slice(start + decl.length);
    const end = rest.search(/\n(?:async function|function|export async function|export function)\s/);
    return rest.slice(0, end < 0 ? rest.length : end);
  }
  const invBody = bodyOf(webhook, "async function handleInvoiceSucceeded(");
  const refBody = bodyOf(members, "async function actionRefund(");
  ok(!!invBody && !!refBody, "both handlers are still where this section expects them");

  const CALL = "await sendPaymentReceipt(member, inv, connectedAccount);";
  ok(invBody.includes(CALL), "handleInvoiceSucceeded CALLS the receipt path, awaited");
  // What this actually measures, stated honestly: every `return` above the call is
  // a ONE-LINE `if (...) return ...` guard. It does NOT prove those guards are the
  // right ones - a new `if (somethingElse) return ...` inserted above the call would
  // satisfy it - and it cannot, from source. What it does catch is the shape that
  // has actually gone wrong here before: the call drifting DOWN past a multi-line
  // branch, or below one of the six terminal `return res.status(...)` paths. The
  // guards it permits are enumerated by name in the next two assertions, which is
  // where "the right ones" is checked.
  const before = invBody.slice(0, invBody.indexOf(CALL));
  const returnsBefore = (before.match(/^\s*[^\n]*\breturn\b[^\n]*$/gm) || []).filter((l) => !/^\s*if\s*\(.*\breturn\b/.test(l));
  ok(returnsBefore.length === 0,
    `every return above the call is a single-line inline guard, so the call has not drifted below a branch (saw ${returnsBefore.length} that are not)`);
  // The guards themselves, named. Both mean "there is nobody to send a receipt to",
  // which is the only reason a payment may reach no receipt. A THIRD guard appearing
  // above the call fails this count and has to be justified deliberately.
  const guardLines = (before.match(/^\s*if\s*\(.*\breturn\b.*$/gm) || []);
  ok(guardLines.length === 2 && guardLines.every((l) => /!inv|!member/.test(l)),
    `and the only two are "no invoice" and "no member" (saw ${guardLines.length}: ${guardLines.map((l) => l.trim().slice(0, 40)).join(" | ")})`);
  ok(before.includes(`if (!member) return res.status(200).json({ skipped: "no member match for invoice" });`),
    "and it sits after the member is resolved, so there is somebody to send to");
  // Before any response is written on a path that CONTINUES. On Vercel the
  // invocation can be frozen once the response is sent, so a receipt awaited after a
  // res.json() is a receipt that may never be issued. The only res.status() calls
  // above the receipt are the same inline guards counted above, which terminate.
  const respondsBefore = (before.match(/^\s*[^\n]*res\.status\([^\n]*$/gm) || []).filter((l) => !/\bif\s*\(/.test(l));
  ok(respondsBefore.length === 0,
    `and before any response is written on a path that continues, so the invocation cannot be frozen mid-send (saw ${respondsBefore.length})`);

  ok(/const receipt = await receiptsCall\("sendRefundReceipt"/.test(refBody), "actionRefund CALLS the refund confirmation, awaited");
  const refBefore = refBody.slice(0, refBody.indexOf("sendRefundReceipt"));
  ok(/await writeAudit\(/.test(refBefore), "after the audit row, so what staff did is recorded before the parent is told");
  ok(/await stripeFetch\(`\/refunds`/.test(refBefore), "and after Stripe accepted the refund");

  // The names being called are names the module really exports. A rename on either
  // side is a silent no-op at runtime (`typeof mod[fn] !== "function"` -> skipped),
  // which is exactly the failure that looks like everything working.
  const called = ["maybeSendPaymentReceipt", "sendRefundReceipt", "resendReceipt", "listReceipts"];
  for (const fn of called) ok(typeof RECEIPTS[fn] === "function", `the module really exports ${fn}()`);
  ok(webhook.includes("mod.maybeSendPaymentReceipt"), "webhook.js calls it by that exact name");
  for (const fn of ["sendRefundReceipt", "resendReceipt", "listReceipts"]) {
    ok(members.includes(`receiptsCall("${fn}"`), `members.js calls ${fn}() by that exact name`);
  }
  ok(/case "resend-receipt"|action === "resend-receipt"/.test(members), "the resend action is dispatched in members.js");

  // The defensive load. A STATIC import of the receipts module would let a load
  // error in it take the whole Stripe webhook down; this is the shape that cannot.
  ok(!/^import .*_member-receipts/m.test(webhook) && /await import\("\.\.\/_member-receipts\.js"\)/.test(webhook),
    "webhook.js loads the module DYNAMICALLY, so a load failure cannot 500 the webhook");
  ok(!/^import .*_member-receipts/m.test(members) && /await import\("\.\/_member-receipts\.js"\)/.test(members),
    "members.js loads it the same way, so a load failure cannot break a refund");

  // The two ruled-absent messages, at the handlers where somebody would add them.
  ok(/DELIBERATELY NO PARENT-FACING EMAIL HERE[\s\S]{0,200}2026-07-30/.test(fs.readFileSync(path.join(HERE, "stripe/webhook.js"), "utf8")),
    "the failed-payment handler records that its silence is a decision");
  ok(/DELIBERATELY NO GOODBYE EMAIL HERE[\s\S]{0,200}2026-07-30/.test(fs.readFileSync(path.join(HERE, "stripe/webhook.js"), "utf8")),
    "and so does the subscription-cancelled handler");
}

console.log("\n── 11. the schema this all rests on ──");
{
  ok(/CREATE TABLE IF NOT EXISTS public\.member_receipts/.test(MIGRATION_SQL) || MUTATE === "dupindex", "the table is declared");
  ok(/kind\s+text NOT NULL CHECK \(kind IN \('payment','refund'\)\)/.test(MIGRATION_SQL), "kind is constrained to payment / refund");
  ok(/email_status\s+text CHECK \(email_status IN \('sent','held','failed'\)\)/.test(MIGRATION_SQL), "email_status is constrained to sent / held / failed");
  ok(/receipt_mode IS NULL OR receipt_mode IN \('recurring','first_only'\)/.test(MIGRATION_SQL), "receipt_mode is constrained, and NULL is allowed - which is OFF");
  ok(!/receipt_mode\s+text\s+(NOT NULL|DEFAULT)/.test(MIGRATION_SQL), "with no default, so applying the schema turns nothing on");
  ok(/ADD COLUMN IF NOT EXISTS tax_registration_number text/.test(MIGRATION_SQL), "the tax registration column ships with it");
  ok(/ADD COLUMN IF NOT EXISTS stripe_portal_url text/.test(MIGRATION_SQL), "and stripe_portal_url is re-declared IF NOT EXISTS, so replaying after 20260731T090000 is a no-op");

  // ── RLS. Not a nice-to-have on this table. ─────────────────────────────────
  // Every row is per-family data belonging to ONE academy - athlete name, amount
  // paid, card last4 - and the portal ships a browser Supabase client holding the
  // anon key. A table with RLS off is readable by any authenticated session on
  // default grants, which means any academy's login could read every other
  // academy's parents. The policies mirror member_agreements
  // (20260726022703_signed_agreements.sql), because it is the same question about
  // the same shape of data and two tables of parent PII must not answer it twice.
  ok(/ALTER TABLE public\.member_receipts ENABLE ROW LEVEL SECURITY;/.test(MIGRATION_SQL),
    "RLS is ENABLED on member_receipts - without it the anon key reads every academy's parents");
  ok(/CREATE POLICY member_receipts_staff_rw ON public\.member_receipts[\s\S]*?USING \(public\.is_staff\(\)\)[\s\S]*?WITH CHECK \(public\.is_staff\(\)\)/.test(MIGRATION_SQL),
    "staff read/write, guarded both ways");
  ok(/CREATE POLICY member_receipts_client_read ON public\.member_receipts[\s\S]*?FOR SELECT TO authenticated[\s\S]*?USING \(client_id IN \(SELECT public\.my_client_ids\(\)\)\)/.test(MIGRATION_SQL),
    "an academy reads its OWN rows and no others");
  ok(!/CREATE POLICY member_receipts_client_[a-z_]*(?:write|rw|all)/i.test(MIGRATION_SQL),
    "and an academy gets no write policy - every write goes through the service-role API");
  // Same shape as the table this is modelled on, checked against that file rather
  // than against my memory of it.
  const AGREEMENTS = fs.readFileSync(path.join(HERE, "../supabase/migrations/20260726022703_signed_agreements.sql"), "utf8");
  ok(/enable row level security/i.test(AGREEMENTS) && /my_client_ids\(\)/.test(AGREEMENTS),
    "and the template it mirrors is still the template (member_agreements RLS)");

  const ledger = fs.readFileSync(path.join(HERE, "../supabase/PENDING_SQL.md"), "utf8");
  for (const f of ["20260731T190000_member_receipts.sql", "20260731T190100_seed_receipt_mode.sql"]) {
    ok(ledger.includes(f), `${f} has its row in the PENDING_SQL ledger`);
  }
  const seedSql = fs.readFileSync(path.join(HERE, "../supabase/migrations/20260731T190100_seed_receipt_mode.sql"), "utf8");
  ok(/v2_access IS TRUE/.test(seedSql), "the data migration cannot switch on a V1 academy");
  // The switch FAILS on a wrong match rather than narrating one. An earlier draft
  // printed "EXPECT 2" as a NOTICE and committed whatever it did, which is a check
  // sitting where a guard should be: a migration that narrates a wrong outcome has
  // still applied it.
  ok(/IF touched <> 2 THEN[\s\S]*?RAISE EXCEPTION/.test(seedSql),
    "and it RAISES on anything other than exactly 2 rows, rolling the whole block back");
  // Comments stripped first: this file's own header EXPLAINS why it does not use
  // ILIKE, and a check that reads prose reads the wrong thing.
  const seedCode = seedSql.replace(/^\s*--[^\n]*$/gm, "");
  ok(!/ILIKE/i.test(seedCode) && /business_name IN \('BAM GTA', 'BAM San Jose'\)/.test(seedCode),
    "matching on exact names, so a future 'BAM GTA West' cannot be swept in by a prefix");
  // The two names are not guesses: they are the repo's own production snapshots,
  // the same fixtures the GTA byte-for-byte email locks render from. If a snapshot
  // is ever re-pulled and the name has changed, this fails instead of the migration
  // silently matching nothing at 2am.
  const SNAPS = path.resolve(HERE, "../../../scripts/snapshots");
  for (const f of ["bam-gta.json", "bam-san-jose.json"]) {
    const name = (JSON.parse(fs.readFileSync(path.join(SNAPS, f), "utf8")).client || {}).business_name;
    ok(!!name && seedCode.includes(`'${name}'`), `the seed matches ${f}'s real business_name ("${name}")`);
  }
  ok(!/UPDATE\s+public\.clients/i.test(MIGRATION_SQL) && /UPDATE public\.clients/.test(seedSql),
    "and the schema migration seeds nobody - turning academies on is its own reviewable file");
}

// ─── report ──────────────────────────────────────────────────────────────────
if (UNSTUBBED.size) console.log(`\n  (tables answered generically, not modelled: ${[...UNSTUBBED].join(", ")})`);
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
