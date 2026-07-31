// MEMBER RECEIPTS - the parent-facing receipt for money that moved.
//
// ONE implementation, two callers: the Stripe webhook (a paid invoice) and
// api/members.js actionRefund (a staff-issued refund). Both import THIS file. There
// is deliberately no second copy of the money math, the number, the guards or the
// copy - the whole point of the module is that a receipt cannot mean two things.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR RULES THIS FILE IS BUILT AROUND
//
// 1. SHARED SYSTEM, NO ACADEMY BRANCH. Nothing here reads a client id, a business
//    name or a slug to decide BEHAVIOUR. Every academy-specific answer comes off
//    the academy's own row: `receipt_mode` (off / every payment / first only),
//    `tax_config` (the tax template), `tax_registration_number` (the number a tax
//    academy must print), `time_zone` (the date a parent reads),
//    `stripe_portal_url` (where they manage the membership). An academy with none
//    of them set sends nothing, which is the correct behaviour for an academy that
//    has not been set up rather than a gap to paper over.
//
// 2. V1 IS UNTOUCHED. `clients.v2_access` false = this file does nothing at all,
//    checked before any work and before any write. On top of that, receipt_mode
//    NULL is OFF, and every academy is NULL until somebody sets it. So the day
//    this ships, the number of academies that send a receipt is zero, and it stays
//    zero until the data migration or an owner turns one on.
//
// 3. IT DEGRADES, IT NEVER 500s. This code runs inside the Stripe webhook. A
//    missing column, a missing table, a Supabase blip, a Resend outage, a bad tax
//    template - none of them may break invoice handling, because a member who does
//    not get a receipt is an inconvenience and a member who does not get ACTIVATED
//    is a broken signup. Every exported entry point catches everything and returns
//    a result object. It has no throw path by construction.
//
// 4. RECONCILE, NEVER DIVIDE. See buildReceiptLines below. We never compute tax by
//    dividing a charged total by 1.13. The owner's typed base is re-run through the
//    SAME api/_fees.js call that minted the Stripe price, and the parts are printed
//    only when they add up to the charged total EXACTLY. Anything else prints the
//    total alone and flags the row for staff.
//
// ─────────────────────────────────────────────────────────────────────────────
// SEND-ONCE IS A DATABASE FACT, NOT A CODE FACT.
//
// Stripe fires BOTH `invoice.payment_succeeded` AND `invoice.paid` for one payment,
// milliseconds apart, and both land on the same handler. A code-level "have we sent
// this already" read loses that race roughly as often as it wins it. So the guard is
// the UNIQUE PARTIAL INDEX on (client_id, stripe_invoice_id) WHERE kind='payment':
// the second insert is rejected by Postgres, this file reads the 23505, and reports
// "already receipted" without sending. That is the whole mechanism. Nothing in here
// tries to be clever about ordering, because it does not have to be.
//
// See supabase/migrations/20260731T190000_member_receipts.sql.

import { resolveFee, applyFee, taxFee } from "./_fees.js";
import { FOOTER_REASON } from "./email-templates/_shell.js";

// ── WHAT EVERY RECEIPT'S FOOTER SAYS, AND WHAT IT DOES NOT OFFER ─────────────
//
// Spread onto every sendOn() call in this file - all three of them (a payment, a
// refund, a staff resend) - so no receipt can leave here with the shell's DEFAULT
// footer. That default is written for lead nurture and it says two things that are
// false on a receipt:
//
//   "You're receiving this because you enquired about <academy>."
//     A member did not enquire. They paid. FOOTER_REASON.joined is the sentence the
//     shell has always carried for somebody who has joined, and it is used verbatim
//     rather than reworded - the shell owns that copy, not this file.
//
//   [Unsubscribe]
//     Offered on the record of the parent's own payment. A receipt is transactional,
//     so it carries no opt-out at all (CAN-SPAM exempts transactional and
//     relationship messages; CASL does not treat a receipt for a completed
//     transaction as a commercial electronic message). The anchor is removed whole,
//     not blanked - see stripUnsubscribe in api/email-templates/_shell.js.
//
// ONE object, spread at every site, because the failure this fixes is per-site: the
// system went live on 31 Jul 2026 with all three sites passing neither, and a resend
// that re-rendered with the wrong footer would be the same defect issued twice.
const RECEIPT_FOOTER = { footerReason: FOOTER_REASON.joined, noUnsubscribe: true };

export const RECEIPT_KINDS = ["payment", "refund"];
export const RECEIPT_MODES = ["recurring", "first_only"];
export const EMAIL_STATUSES = ["sent", "held", "failed"];

// The academy columns a receipt renders from. `receipt_mode` and
// `tax_registration_number` ship WITH this build's migration;
// `stripe_portal_url` shipped ahead of it (20260731T090000). If any of them is not
// in the schema yet the select 400s with a 42703, which readClientRow turns into
// "receipts are OFF for everybody" rather than an exception - see loadReceiptClient.
const RECEIPT_CLIENT_COLS = [
  "id", "business_name", "public_name", "v2_access", "time_zone",
  "tax_config", "receipt_mode", "tax_registration_number", "stripe_portal_url",
];

// ── small pure helpers ───────────────────────────────────────────────────────

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function money(cents, currency) {
  const n = Math.round(Number(cents) || 0);
  const cur = String(currency || "").toUpperCase();
  const amt = `$${(n / 100).toFixed(2)}`;
  return cur ? `${amt} ${cur}` : amt;
}

// The academy's own prefix for its receipt numbers, derived from the name on its
// row. NOT a lookup table and not a per-client constant: a new academy gets a
// prefix the moment it has a name, with nothing to configure and nothing to forget.
//
// Collision posture: two academies whose names normalise the same way share a
// prefix. That is cosmetic and harmless - numbers are counted PER CLIENT, and a
// parent only ever sees their own academy's, so a shared prefix cannot make two
// receipts ambiguous to anybody who can see both (staff, who also see the academy).
export function receiptPrefix(name) {
  const s = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s ? s.slice(0, 6) : "RCPT";
}

// "BAMGTA-2026-0007". The sequence is per academy per year, read as "the highest
// one already issued, plus one".
//
// ⚠️ RACE POSTURE, WRITTEN DOWN ON PURPOSE. This read-then-insert is NOT atomic.
// Two payments landing at one academy in the same instant can both read seq 6 and
// both write 0007. What the unique index guarantees is that no INVOICE is receipted
// twice; it does not guarantee that two DIFFERENT invoices get different numbers.
// That is the accepted trade today (an academy's payments are minutes apart, not
// milliseconds), and the fix if it ever bites is a per-client sequence table or a
// unique index on (client_id, receipt_number) with a retry - not a lock in here.
// It is a numbering blemish, never a missing or duplicated receipt.
export function receiptNumber(prefix, year, seq) {
  return `${prefix}-${year}-${String(Math.max(1, Math.round(Number(seq) || 1))).padStart(4, "0")}`;
}

export function seqFromNumber(num) {
  const m = /-(\d+)$/.exec(String(num || ""));
  return m ? parseInt(m[1], 10) : 0;
}

// The date a PARENT reads, in the academy's own time zone (clients.time_zone).
// A receipt dated a day early because the server is on UTC is the kind of small
// wrongness that makes somebody distrust the whole document. An unusable zone
// falls back to UTC rather than throwing - a receipt with a slightly-off date
// still beats no receipt.
export function receiptDate(iso, timeZone) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return "";
  const fmt = (tz) => new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "long", day: "numeric",
  }).format(d);
  try { return fmt(String(timeZone || "UTC")); }
  catch (_) { try { return fmt("UTC"); } catch (_e) { return d.toISOString().slice(0, 10); } }
}

// ── the reconciliation ───────────────────────────────────────────────────────
//
// THE HONESTY GATE, in the same words api/agent/fact-render.js uses for the same
// question (componentsFor, ~line 296): re-run the identical api/_fees.js call that
// api/offers/match-prices.js used to BUILD the Stripe price, and print the parts
// only when applyFee(base, resolveFee(...)) equals the charged total to the cent.
//
// WE NEVER DIVIDE. total / 1.13 would produce a plausible number for every academy
// on earth, including the ones whose price was typed wrong, whose taxable flag is
// backwards, or who are not taxed at all. A receipt is a document a parent may hand
// to somebody else; a plausible number is worse than no number.
//
// A mismatch is NOT an error and not a hold. The receipt still goes, carrying the
// TOTAL ALONE - the one figure that is true no matter how the row drifted - and the
// stored row records reconciled:false with a reason, so staff can see which member
// and which invoice to look at.
//
// Pure. No I/O, no clock, no client id.
//
//   invoice   - the Stripe invoice ({ amount_paid, currency, lines })
//   priceRows - this tenant's offer_prices rows (stripe_price_id -> the typed key)
//   offerings - offer.data.pricing.pricing_offerings, the owner's TYPED prices
//   taxConfig - clients.tax_config, the academy's tax template ({ label, pct })
export function buildReceiptLines({ invoice, priceRows, offerings, taxConfig } = {}) {
  const inv = invoice || {};
  const total = Math.round(Number(inv.amount_paid != null ? inv.amount_paid : inv.total) || 0);
  const currency = String(inv.currency || "").toLowerCase();
  const out = { total_cents: total, currency, items: [], reconciled: false, reason: null };

  const lines = (inv.lines && Array.isArray(inv.lines.data)) ? inv.lines.data : [];
  const byPrice = new Map();
  for (const p of (Array.isArray(priceRows) ? priceRows : [])) {
    if (p && p.stripe_price_id) byPrice.set(String(p.stripe_price_id), p);
  }
  const offers = Array.isArray(offerings) ? offerings : [];

  // Split the invoice into the RECURRING plan line and any one-time riders. A
  // signup fee is charged once per athlete and is its own line on the receipt: a
  // parent whose first payment is 40 dollars bigger than the plan they were quoted
  // must be able to see WHY on the document, not have it folded into a total.
  const priced = lines.map((l) => {
    const pid = (l && l.price && l.price.id) || (l && l.pricing && l.pricing.price_details && l.pricing.price_details.price) || null;
    const row = pid ? byPrice.get(String(pid)) : null;
    const key = String((row && row.source_offer_price_key) || "");
    const [title, term] = key.split("|");
    return {
      amount: Math.round(Number(l && l.amount) || 0),
      label: (row && row.title) || (l && l.description) || "",
      title: (title || "").trim(),
      term: (term || "").trim(),
    };
  });

  const feeLines = priced.filter((l) => l.term === "signup_fee");
  const planLines = priced.filter((l) => l.term && l.term !== "signup_fee");
  const plan = planLines.length === 1 ? planLines[0] : null;

  // The owner's TYPED base for this plan + term, read exactly the way
  // baseSourceFor() in api/agent/fact-render.js reads it: the non-archived
  // membership offering whose title matches, then monthly / signup_fee / the
  // commitment matched by term, with a commitment's own taxable flag winning over
  // the offering's. No base = no parts, which is a total-only receipt WITHOUT a
  // flag: a catalog row can legitimately outlive the offering that minted it.
  const src = plan ? baseSourceFor(offers, plan.title, plan.term) : null;

  const feeTotal = feeLines.reduce((a, l) => a + l.amount, 0);
  if (!src || !(src.base > 0)) {
    out.reason = plan ? "no typed base for this plan" : "could not identify the plan line";
    out.items = [{ kind: "total_only", label: "Payment", amount_cents: total }];
    return out;
  }

  const fee = resolveFee({ taxConfig, taxable: src.taxable, legacyText: src.legacyText });
  const allIn = applyFee(src.base, fee);
  // The plan line's own charged amount, so a partial/prorated invoice does not get
  // measured against the full-price expectation. Falls back to the invoice total
  // minus the riders when the line carries no amount.
  const planCharged = plan.amount > 0 ? plan.amount : (total - feeTotal);
  if (allIn !== planCharged || (planCharged + feeTotal) !== total) {
    out.reason = `typed ${src.base} + fee = ${allIn}, charged ${planCharged} (riders ${feeTotal}, invoice ${total})`;
    out.items = [{ kind: "total_only", label: "Payment", amount_cents: total }];
    return out;
  }

  const tax = planCharged - src.base;
  out.items.push({ kind: "plan", label: plan.label || plan.title || "Plan", amount_cents: src.base });
  // A zero difference prints NO tax line rather than "$0.00", for the reason
  // fact-render gives: a row marked taxable "No" IS its own base, and a $0.00 tax
  // line reads as a claim about the law we do not own.
  if (tax > 0) out.items.push({ kind: "tax", label: taxLineLabel(fee, taxConfig), amount_cents: tax });
  for (const f of feeLines) out.items.push({ kind: "signup_fee", label: f.label || "One-time fee", amount_cents: f.amount });
  out.reconciled = true;
  return out;
}

// Mirrors baseSourceFor() in api/agent/fact-render.js. Kept in step by
// api/_member-receipts.test.mjs, which pins the rule against that file's source -
// the two are one decision about what an owner typed, and a receipt that disagrees
// with what the sales agent quotes is the drift this whole workstream exists to end.
function baseSourceFor(offerings, title, term) {
  const want = String(title || "").trim().toLowerCase();
  if (!want) return null;
  const off = (offerings || []).find((o) => o && !o.archived
    && String(o.type || "").toLowerCase() === "membership"
    && String(o.title || "").trim().toLowerCase() === want);
  if (!off) return null;
  const centsOf = (v) => { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) : null; };
  if (term === "monthly")    return { base: centsOf(off.price), taxable: off.taxable, legacyText: off.added_fees };
  if (term === "signup_fee") return { base: centsOf(off.signup_fee), taxable: off.signup_fee_taxable, legacyText: null };
  const c = (Array.isArray(off.commitments) ? off.commitments : []).find((x) => x && termFromLength(x.length) === term);
  if (!c) return null;
  return { base: centsOf(c.price), taxable: c.taxable != null ? c.taxable : off.taxable, legacyText: c.added_fees };
}

// "3 months" -> "3_months". Same normalisation offer_prices' source_offer_price_key
// carries, so a commitment matches the catalog row that was minted from it.
function termFromLength(len) {
  const s = String(len || "").trim().toLowerCase();
  if (!s) return "";
  const m = /^(\d+)\s*(week|month|year)s?$/.exec(s);
  return m ? `${m[1]}_${m[2]}s` : s.replace(/\s+/g, "_");
}

// What the tax line is CALLED. The academy's template names it ("HST 13%") when the
// row reconciled through the template; a row that reconciled through a legacy
// free-text string keeps that string's own parsed label, so an academy that never
// migrated still itemises with its own words.
function taxLineLabel(fee, taxConfig) {
  if (!fee) return "Tax";
  const tf = taxFee(taxConfig);
  if (tf && fee.label === tf.label) {
    const label = String((taxConfig && taxConfig.label) || "").trim();
    return label ? `${label} ${taxConfig.pct}%` : `${taxConfig.pct}%`;
  }
  return fee.label || "Tax";
}

// ── the copy ─────────────────────────────────────────────────────────────────
//
// Plain text with a little inline markup, handed to sendOn() -> renderStepMessage
// -> renderEmail, which wraps it in the ACADEMY'S OWN branded shell (wordmark,
// tagline, footer). So there is no second email design here and no way for a receipt
// to go out looking like a different academy's mail. The one thing a receipt does NOT
// inherit from the shell's defaults is its footer - see RECEIPT_FOOTER above.
//
// {{location.portal_link}} is the manage-membership line and it is deliberately a
// TOKEN rather than a value we paste in: the token is in DROP_WHEN_EMPTY in
// api/email-shells.js, so an academy with no stripe_portal_url on file has the whole
// sentence removed by the renderer - not a dead link, not a trailing colon. That
// behaviour is already proved by api/_manage-membership-link.test.mjs section 6, and
// re-using the token is what lets this file inherit it instead of re-deciding it.
//
// Pure. Takes a stored receipt row shape, returns { subject, body }. THIS is what
// makes "resend re-renders from the stored row" true rather than aspirational: the
// resend path calls this function with the row and nothing else.
export function renderReceipt(receipt) {
  const r = receipt || {};
  const d = (r.lines && typeof r.lines === "object") ? r.lines : {};
  const cur = r.currency || d.currency || "";
  const isRefund = r.kind === "refund";
  const items = Array.isArray(d.items) ? d.items : [];

  const L = [];
  L.push(`Hi {{contact.first_name}}, ${isRefund ? "this confirms a refund from" : "here is your receipt from"} {{location.name}}.`);
  L.push("");
  L.push(isRefund ? "REFUND CONFIRMATION" : "PAYMENT RECEIPT");
  if (d.athlete_name) L.push(`Athlete: ${esc(d.athlete_name)}`);
  if (!isRefund && d.plan_label) L.push(`Plan: ${esc(d.plan_label)}`);
  L.push("");

  if (isRefund) {
    L.push(`<b>Refunded: ${money(r.amount_cents, cur)}</b>`);
  } else {
    for (const it of items) {
      if (it && it.kind === "total_only") continue;
      L.push(`${esc(it && it.label)}: ${money(it && it.amount_cents, cur)}`);
    }
    L.push(`<b>Total paid: ${money(r.amount_cents, cur)}</b>`);
  }
  L.push("");

  if (d.date_label) L.push(`${isRefund ? "Refunded on" : "Paid"}: ${esc(d.date_label)}`);
  if (d.card_last4) L.push(`${isRefund ? "Back to" : "Card"}: ${esc(cardLabel(d))}`);
  L.push(`${isRefund ? "Refund number" : "Receipt number"}: ${esc(r.receipt_number)}`);
  if (isRefund && d.original_receipt_number) L.push(`Original receipt: ${esc(d.original_receipt_number)}`);
  // The academy's own registration number, printed only when it HAS one. An academy
  // with no number prints no line - never the words "no tax", which would be a claim
  // about somebody's tax position that we are in no position to make.
  if (d.tax_registration_label) L.push(esc(d.tax_registration_label));
  L.push("");

  if (isRefund) {
    L.push("Refunds usually take 5 to 10 business days to show up on the statement.");
  } else {
    // Ends in the token, no full stop after it: the renderer's drop rule takes the
    // whole sentence when the academy has no portal on file.
    L.push("Manage your membership or update your card any time: {{location.portal_link}}");
  }
  L.push("");
  L.push("Thanks for being part of {{location.name}}.");

  const subject = isRefund
    ? `Refund confirmation ${r.receipt_number || ""}`.trim()
    : `Payment receipt ${r.receipt_number || ""}`.trim();
  return { subject, body: L.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

function cardLabel(d) {
  const brand = String((d && d.card_brand) || "").trim();
  const last4 = String((d && d.card_last4) || "").trim();
  if (!last4) return "";
  const nice = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
  return `${nice} ending ${last4}`;
}

// ── the guard ────────────────────────────────────────────────────────────────
//
// Which academies send anything at all. THREE conditions, all read off the row:
//   v2_access !== true          -> V1 academy, this system does not exist for it
//   receipt_mode NULL / unknown -> OFF (the state every academy is in on day one)
//   receipt_mode 'first_only'   -> only the first payment (checked at send time)
// An absent COLUMN is the same answer as a NULL - see loadReceiptClient, which
// treats a 42703 as "off everywhere" rather than an exception.
export function receiptModeFor(client) {
  const c = client || {};
  if (c.v2_access !== true) return null;
  const m = String(c.receipt_mode || "").trim();
  return RECEIPT_MODES.includes(m) ? m : null;
}

// ── I/O ──────────────────────────────────────────────────────────────────────
// Every function below takes `sb` (the caller's own Supabase REST helper, which
// throws on a non-2xx) and `sendOn` (api/_send.js) by injection. Nothing here
// imports either, which is what keeps this file loadable by a plain-node suite with
// no network, no database and no environment.

const isMissingSchema = (e) => /42703|42P01|does not exist|could not find/i.test(String((e && e.message) || e));
const isUniqueViolation = (e) => /23505|duplicate key|409/i.test(String((e && e.message) || e));

async function loadReceiptClient(sb, clientId) {
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=${RECEIPT_CLIENT_COLS.join(",")}&limit=1`);
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (e) {
    // The migration has not been applied yet. That is not an outage and not an
    // error worth a Sentry event: it is the pre-migration state, in which the
    // feature is simply off for everybody. Returning null makes every caller a
    // no-op through the SAME path a NULL receipt_mode takes.
    if (isMissingSchema(e)) return null;
    throw e;
  }
}

// Next number for this academy this year. Reads the highest already issued rather
// than counting rows, so a deleted row cannot make two receipts share a number.
async function nextReceiptNumber(sb, clientId, prefix, year) {
  const like = `${prefix}-${year}-%`;
  let seq = 0;
  try {
    const rows = await sb(
      `member_receipts?client_id=eq.${encodeURIComponent(clientId)}` +
      `&receipt_number=like.${encodeURIComponent(like)}` +
      `&select=receipt_number&order=receipt_number.desc&limit=1`
    );
    if (Array.isArray(rows) && rows[0]) seq = seqFromNumber(rows[0].receipt_number);
  } catch (_) { /* a read blip must not stop the receipt; worst case we reuse a number */ }
  return receiptNumber(prefix, year, seq + 1);
}

// Insert the row, then send. IN THAT ORDER, and it matters: the row is the record
// that money moved and the email is a copy of it. If the send fails the row stays
// (email_status 'failed') and staff can resend from the portal; if the row failed
// to write we must not send an email nobody can ever reproduce.
async function writeAndSend({ sb, sendOn, client, member, row, vars }) {
  let inserted = null;
  try {
    const res = await sb(`member_receipts`, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ ...row, email_status: "held" }]),
    });
    inserted = (Array.isArray(res) && res[0]) || null;
  } catch (e) {
    // THE DOUBLE-FIRE LANDS HERE, and this is the entire send-once guard.
    // invoice.payment_succeeded and invoice.paid both reach the handler for one
    // payment; the first insert wins, the second is rejected by the unique partial
    // index on (client_id, stripe_invoice_id) WHERE kind='payment', and we stop.
    // No read, no lock, no ordering assumption.
    if (isUniqueViolation(e)) return { skipped: "already receipted", receipted: true };
    if (isMissingSchema(e)) return { skipped: "member_receipts table not migrated yet" };
    console.error("[receipts] insert failed:", (e && e.message) || e);
    return { error: "insert failed" };
  }
  if (!inserted) return { error: "insert returned nothing" };

  const msg = renderReceipt(inserted);
  let status = "failed", sentAt = null, note = null;
  try {
    // SEND SITE 1 AND 2. Both the paid invoice and the refund confirmation reach the
    // wire here, so RECEIPT_FOOTER covers both from one place.
    const r = await sendOn({
      channel: "email", clientId: client.id, toEmail: member.parent_email,
      subject: msg.subject, body: msg.body, vars, ...RECEIPT_FOOTER,
    });
    if (r && r.sent) { status = "sent"; sentAt = new Date().toISOString(); }
    // A HELD send is the academy-identity guardrail in api/_send.js doing its job
    // (no verified sending domain, or no public email to carry the unsubscribe).
    // The receipt ROW still exists, which is the point: the record of the payment
    // does not depend on the academy having finished its email setup, and staff can
    // resend the moment it does.
    else if (r && r.held) { status = "held"; note = r.held; }
    else if (r && r.skipped) { status = "held"; note = r.skipped; }
  } catch (e) {
    status = "failed";
    note = String((e && e.message) || e).slice(0, 300);
    console.error("[receipts] send failed:", note);
  }
  try {
    await sb(`member_receipts?id=eq.${encodeURIComponent(inserted.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ email_status: status, sent_at: sentAt }),
    });
  } catch (_) { /* the row exists and that is what matters; the status is a label */ }
  return { ok: true, receipt_id: inserted.id, receipt_number: inserted.receipt_number, email_status: status, note };
}

// The merge vars every receipt renders with. The parent's own name, so the greeting
// is a greeting; the athlete, because a household with two athletes gets two
// receipts and has to be able to tell them apart at a glance.
function varsFor(member) {
  const parent = String((member && member.parent_name) || "").trim();
  return {
    first_name: parent ? parent.split(/\s+/)[0] : "",
    full_name: parent,
    athlete: String((member && member.athlete_name) || "").trim(),
  };
}

function taxRegistrationLabel(client) {
  const num = String((client && client.tax_registration_number) || "").trim();
  if (!num) return null;   // no number = no line. NEVER the words "no tax".
  const label = String((client && client.tax_config && client.tax_config.label) || "").trim();
  return `${label ? `${label} registration` : "Tax registration"}: ${num}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT 1 - a paid invoice.
//
// Called from handleInvoiceSucceeded in api/stripe/webhook.js. NEVER THROWS.
//
//   sb           the caller's Supabase REST helper
//   sendOn       api/_send.js sendOn
//   member       the members row the invoice resolved to
//   invoice      the Stripe invoice object off the event
//   stripeFetch  optional; used ONLY to read the card's last4. Absent or failing
//                just means the receipt carries no card line.
export async function maybeSendPaymentReceipt({ sb, sendOn, member, invoice, stripeFetch, connectedAccount } = {}) {
  try {
    if (!sb || !sendOn || !member || !member.client_id || !invoice) return { skipped: "missing inputs" };

    const client = await loadReceiptClient(sb, member.client_id);
    if (!client) return { skipped: "no client row, or receipt columns not migrated" };
    const mode = receiptModeFor(client);
    if (!mode) return { skipped: client.v2_access === true ? "receipts off for this academy" : "not a V2 academy" };
    if (!member.parent_email) return { skipped: "no parent email on file" };

    const invoiceId = invoice.id || null;
    if (!invoiceId) return { skipped: "invoice has no id" };

    if (mode === "first_only") {
      // Only the FIRST payment. Cheap read, and it is allowed to be racy in the way
      // the number is: the unique index still stops the same invoice twice, and the
      // worst case of losing this race is a second receipt for a member whose owner
      // asked for one. A read failure sends (a receipt too many beats a receipt
      // missing, when the owner has opted into receipts at all).
      try {
        const prior = await sb(
          `member_receipts?client_id=eq.${encodeURIComponent(member.client_id)}` +
          `&member_id=eq.${encodeURIComponent(member.id)}&kind=eq.payment&select=id&limit=1`
        );
        if (Array.isArray(prior) && prior.length) return { skipped: "first_only: already has a payment receipt" };
      } catch (e) {
        if (isMissingSchema(e)) return { skipped: "member_receipts table not migrated yet" };
      }
    }

    const [priceRows, offerings] = await Promise.all([
      sb(`offer_prices?tenant_id=eq.${encodeURIComponent(member.client_id)}&select=title,amount_cents,currency,stripe_price_id,source_offer_price_key&limit=200`).catch(() => []),
      loadOfferings(sb, member.client_id),
    ]);
    const lines = buildReceiptLines({ invoice, priceRows, offerings, taxConfig: client.tax_config });

    const card = await readCard({ invoice, stripeFetch, connectedAccount });
    const paidIso = invoice.status_transitions && invoice.status_transitions.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
      : new Date().toISOString();

    const planItem = lines.items.find((i) => i.kind === "plan");
    const number = await nextReceiptNumber(sb, client.id, receiptPrefix(client.business_name || client.public_name), new Date(paidIso).getUTCFullYear());

    const row = {
      client_id: client.id,
      member_id: member.id,
      kind: "payment",
      receipt_number: number,
      stripe_invoice_id: invoiceId,
      stripe_charge_id: card.chargeId || null,
      stripe_refund_id: null,
      amount_cents: lines.total_cents,
      currency: lines.currency || "cad",
      refund_of: null,
      lines: {
        ...lines,
        athlete_name: member.athlete_name || null,
        plan_label: (planItem && planItem.label) || member.plan || null,
        date_label: receiptDate(paidIso, client.time_zone),
        card_brand: card.brand, card_last4: card.last4,
        tax_registration_label: taxRegistrationLabel(client),
        mode,
      },
    };
    return await writeAndSend({ sb, sendOn, client, member, row, vars: varsFor(member) });
  } catch (e) {
    // Rule 3. A receipt failure is never allowed to become a webhook failure.
    console.error("[receipts] payment receipt failed:", (e && e.message) || e);
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

async function loadOfferings(sb, clientId) {
  try {
    const rows = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
    const data = (Array.isArray(rows) && rows[0] && rows[0].data) || null;
    const list = data && data.pricing && data.pricing.pricing_offerings;
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}

// The card a payment came from, best effort. `last4` is a nicety on a receipt, not
// a requirement, so every failure here degrades to "no card line".
async function readCard({ invoice, stripeFetch, connectedAccount }) {
  const out = { chargeId: (invoice && invoice.charge) || null, brand: null, last4: null };
  if (!out.chargeId || typeof stripeFetch !== "function") return out;
  try {
    const ch = await stripeFetch(`/charges/${out.chargeId}`, connectedAccount);
    const d = ch && ch.payment_method_details && ch.payment_method_details.card;
    if (d) { out.brand = d.brand || null; out.last4 = d.last4 || null; }
  } catch (_) { /* no card line */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT 2 - a refund.
//
// Called from actionRefund in api/members.js AFTER Stripe accepted the refund and
// the audit row is written. NEVER THROWS.
//
// Refunds send under BOTH modes. 'first_only' is a rule about how much routine
// billing mail an academy wants its parents to get; a refund is not routine, and a
// parent whose money came back must be told either way.
export async function sendRefundReceipt({ sb, sendOn, member, refund, chargeId, client } = {}) {
  try {
    if (!sb || !sendOn || !member || !member.client_id || !refund) return { skipped: "missing inputs" };
    const c = client || await loadReceiptClient(sb, member.client_id);
    if (!c) return { skipped: "no client row, or receipt columns not migrated" };
    if (!receiptModeFor(c)) return { skipped: c.v2_access === true ? "receipts off for this academy" : "not a V2 academy" };
    if (!member.parent_email) return { skipped: "no parent email on file" };

    // The payment this refund reverses, when we can find it - matched on the CHARGE,
    // which is the one id both documents share. Not findable (the payment predates
    // receipts, or came in outside the portal) is a normal state: the refund receipt
    // simply carries no "original receipt" line.
    let original = null;
    try {
      const rows = await sb(
        `member_receipts?client_id=eq.${encodeURIComponent(member.client_id)}&kind=eq.payment` +
        `&stripe_charge_id=eq.${encodeURIComponent(chargeId || "")}&select=id,receipt_number,lines&limit=1`
      );
      original = (Array.isArray(rows) && rows[0]) || null;
    } catch (e) {
      if (isMissingSchema(e)) return { skipped: "member_receipts table not migrated yet" };
    }

    const nowIso = new Date().toISOString();
    const od = (original && original.lines) || {};
    const row = {
      client_id: member.client_id,
      member_id: member.id,
      kind: "refund",
      receipt_number: await nextReceiptNumber(sb, member.client_id, receiptPrefix(c.business_name || c.public_name), new Date(nowIso).getUTCFullYear()),
      stripe_invoice_id: null,
      stripe_charge_id: chargeId || null,
      stripe_refund_id: refund.id || null,
      amount_cents: Math.round(Number(refund.amount) || 0),
      currency: String(refund.currency || "cad").toLowerCase(),
      refund_of: (original && original.id) || null,
      lines: {
        reconciled: true, reason: null, items: [],
        athlete_name: member.athlete_name || null,
        date_label: receiptDate(nowIso, c.time_zone),
        // The card it goes BACK to is the card it came from, by definition - so it
        // is read off the original receipt rather than fetched again.
        card_brand: od.card_brand || null, card_last4: od.card_last4 || null,
        original_receipt_number: (original && original.receipt_number) || null,
        tax_registration_label: taxRegistrationLabel(c),
      },
    };
    return await writeAndSend({ sb, sendOn, client: c, member, row, vars: varsFor(member) });
  } catch (e) {
    console.error("[receipts] refund receipt failed:", (e && e.message) || e);
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT 3 - resend.
//
// RE-RENDERS FROM THE STORED ROW. It does not go back to Stripe, it does not
// recompute the tax, it does not re-read the offer. A receipt is a document that was
// issued; a resend must reproduce THAT document, not a fresh opinion about what the
// payment should have looked like. If the owner has since edited a price, the
// original receipt still says what the parent was originally sent - which is the
// only thing a resend can honestly mean.
export async function resendReceipt({ sb, sendOn, member, receiptId } = {}) {
  try {
    if (!sb || !sendOn || !member || !receiptId) return { skipped: "missing inputs" };
    let rows;
    try {
      rows = await sb(
        `member_receipts?id=eq.${encodeURIComponent(receiptId)}` +
        `&client_id=eq.${encodeURIComponent(member.client_id)}&member_id=eq.${encodeURIComponent(member.id)}&select=*&limit=1`
      );
    } catch (e) {
      if (isMissingSchema(e)) return { skipped: "member_receipts table not migrated yet" };
      throw e;
    }
    const receipt = (Array.isArray(rows) && rows[0]) || null;
    // Scoped by client_id AND member_id in the query itself, so a receipt id from
    // another academy simply is not found - the same shape members.js uses everywhere.
    if (!receipt) return { skipped: "receipt not found for this member" };
    if (!member.parent_email) return { skipped: "no parent email on file" };

    const msg = renderReceipt(receipt);
    let status = "failed", sentAt = null, note = null;
    try {
      // SEND SITE 3. A resend re-renders the stored row, so it re-renders the FOOTER
      // too - a resend that dropped RECEIPT_FOOTER would reissue the original defect
      // on a document staff believe they are simply sending again.
      const r = await sendOn({
        channel: "email", clientId: member.client_id, toEmail: member.parent_email,
        subject: msg.subject, body: msg.body, vars: varsFor(member), ...RECEIPT_FOOTER,
      });
      if (r && r.sent) { status = "sent"; sentAt = new Date().toISOString(); }
      else if (r && r.held) { status = "held"; note = r.held; }
      else if (r && r.skipped) { status = "held"; note = r.skipped; }
    } catch (e) {
      note = String((e && e.message) || e).slice(0, 300);
    }
    try {
      await sb(`member_receipts?id=eq.${encodeURIComponent(receipt.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ email_status: status, sent_at: sentAt || receipt.sent_at || null }),
      });
    } catch (_) { /* label only */ }
    return { ok: status === "sent", receipt_id: receipt.id, receipt_number: receipt.receipt_number, email_status: status, note };
  } catch (e) {
    console.error("[receipts] resend failed:", (e && e.message) || e);
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

// Staff-facing list for the member drawer. Degrades to an empty list before the
// migration, so the UI section simply does not appear rather than erroring.
export async function listReceipts({ sb, clientId, memberId } = {}) {
  try {
    if (!sb || !clientId || !memberId) return [];
    const rows = await sb(
      `member_receipts?client_id=eq.${encodeURIComponent(clientId)}&member_id=eq.${encodeURIComponent(memberId)}` +
      `&select=id,kind,receipt_number,amount_cents,currency,email_status,sent_at,created_at,refund_of&order=created_at.desc&limit=50`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
