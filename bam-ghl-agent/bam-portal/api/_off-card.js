// OFF-STRIPE PAYMENTS: the engine behind members.billing_mode='alternate'.
//
// Design + rulings: docs/plans/off-stripe-payments-design.md (Zoran, 2026-08-07).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS FOR. The flag already existed and was already DECORATIVE: setting
// a member to 'alternate' made the drawer say "not billed via Stripe", made the
// next-payment column say "pays another way" with no date, and stopped the
// Sorter complaining. No due date, no reminder, no ledger. A parent could train
// for a year and nobody would ever be told to collect. This file is the
// consequence the flag never had.
//
// THREE FACTS ABOUT WHAT THE PORTAL CAN AND CANNOT DO, stated up front because
// every function below is shaped by them:
//   1. The portal has no charge loop. Stripe subscriptions charge. "Excluded
//      from auto-charge" concretely means no subscription exists, and any that
//      does must be explicitly cancelled - which is the double-billing guard.
//   2. The portal cannot verify cash. Everything here is OWNER-ATTESTED. It is a
//      record of what a human said happened, never a truth claim about money.
//   3. Nothing here sends anything to a parent. v1 notifies the academy only.
//
// RULINGS THAT ARE LOAD-BEARING HERE:
//   D2 - the OWNER is the default assignee, delegation is the exception.
//   D4 - two missed periods does NOTHING automatic. Generation continues so the
//        debt stays visible; there is no auto-cancel and no decision item.
//   D5 - the due-date engine must follow ANY commitment the academy priced. That
//        is why nothing in this file contains the number 3 or 6 as a period
//        length; see resolveArrangementInterval.
//   D6 - off-card money does NOT feed commissions. Nothing here writes to or is
//        read by api/commissions.js.

import { resolveInterval, addInterval } from "./_billing-cadence.js";

// ─────────────────────────────────────────────────────────────────────────────
// DATES. Collections are DATES, not instants: "due Aug 20" is the same day in
// every timezone, and a UTC-noon anchor keeps a date-only string from sliding a
// day when it round-trips through a Date.
export function todayIso() { return new Date().toISOString().slice(0, 10); }
export function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
export function dateToUtc(iso) { return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); }
export function utcToDate(d) { return d.toISOString().slice(0, 10); }
export function addDays(iso, n) {
  const d = dateToUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToDate(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INTERVAL. Ruling D5, in Zoran's words: "i just want to make sure its
// adaptable to any commitment that is created in the pricing stage".
//
// This function contains NO list of commitment lengths. It hands the
// arrangement's stored term and cadence to resolveInterval() - the one place in
// this codebase a billing interval is decided, shared byte for byte with the
// path that charges a card (api/_billing-cadence.js). A 9-month commitment
// resolves to month x9 because intervalFor parses any 1-24 month term; a
// commitment declared in weeks resolves to week x12 or week x24 because that is
// what its cadence says. Neither needs a line of code here.
//
// A hardcoded 3/6-month assumption anywhere in this file would be invisible
// until a 9-month cash payer was reminded on the wrong day for nine months, so
// api/_off-card.test.mjs asserts both cases and MUTATE=hardcodedterms proves the
// assertion is alive.
export function resolveArrangementInterval(arrangement) {
  const a = arrangement || {};
  // The row shape resolveInterval reads is { billing_cadence }. The arrangement
  // photographed that value at activation precisely so an ARCHIVED plan cannot
  // take a live parent's rhythm with it.
  return resolveInterval({ billing_cadence: a.cadence ?? null }, a.term ?? null);
}

// THE DUE DATE FOR PERIOD n, always measured from the anchor.
//
// Period 1 IS the anchor. Period n is anchor + (interval x (n-1)).
//
// Measuring from the anchor rather than stepping from the previous due date is
// not a style preference. JS month arithmetic CLAMPS: a Jan-31 monthly anchor
// stepped one period at a time gives Feb 31 -> Mar 3, then Apr 3, then May 3,
// and the parent's pay day walks away from the pay day forever. Multiplying the
// interval count and measuring from the anchor cannot drift, and it does it
// through the SAME addInterval the card path uses rather than new arithmetic.
export function dueDateForPeriod(arrangement, periodIndex) {
  const n = Math.max(1, Math.floor(Number(periodIndex) || 1));
  const iv = resolveArrangementInterval(arrangement);
  if (n === 1) return String(arrangement.anchor_date).slice(0, 10);
  const stepped = addInterval(dateToUtc(arrangement.anchor_date), {
    interval: iv.interval,
    interval_count: (iv.interval_count || 1) * (n - 1),
  });
  return utcToDate(stepped);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHICH PERIODS SHOULD EXIST RIGHT NOW.
//
// A collection row is generated when its REMINDER comes due, not when its money
// does: the action item is created at due_date - lead_days, so a row that only
// appeared on the due date could never be reminded about in time. That is the
// whole horizon rule, and it is one rule rather than two so a lead_days edit
// cannot leave the generator and the notifier disagreeing.
//
// Bounded by design:
//   - never past commitment_end_date. An off-card member is NEVER silently
//     auto-renewed; generation just stops and a human decides.
//   - never for a paused arrangement (a pause is a skip, not a forgiveness -
//     collections already due stay due).
//   - MAX_CATCH_UP caps a single run. An arrangement anchored years ago by a
//     typo must not mint hundreds of rows and hundreds of Slack pings; it mints
//     a few per run and the wrongness stays visible instead of exploding.
//
// D4: an UNPAID earlier period does not stop any of this. Generation continues
// so the debt is visible. The failure this build exists to prevent is a queue
// that quietly empties itself.
export const MAX_CATCH_UP = 6;

export function periodsDueAsOf(arrangement, { today = todayIso(), highestExisting = 0 } = {}) {
  const out = [];
  if (!arrangement || arrangement.status !== "active") return out;
  if (!isDateStr(arrangement.anchor_date)) return out;
  const lead = Number.isFinite(+arrangement.lead_days) ? +arrangement.lead_days : 3;
  const end = isDateStr(arrangement.commitment_end_date) ? arrangement.commitment_end_date : null;
  let n = Math.max(0, Math.floor(Number(highestExisting) || 0)) + 1;
  for (let guard = 0; guard < MAX_CATCH_UP; guard++) {
    const due = dueDateForPeriod(arrangement, n);
    if (end && due > end) break;
    // The reminder for this period has not come round yet - stop, do not peek
    // further ahead. Everything after it is later still.
    if (addDays(due, -lead) > today) break;
    out.push({ period_index: n, due_date: due });
    n += 1;
  }
  return out;
}

// Has this collection crossed from 'due' into 'overdue'? Late is due_date +
// grace_days, per arrangement. The status flip is the only thing lateness does
// automatically (ruling D4): it re-pings, it never cancels and never decides.
export function isOverdue(collection, arrangement, today = todayIso()) {
  if (!collection || !["due"].includes(collection.status)) return false;
  const grace = Number.isFinite(+arrangement?.grace_days) ? +arrangement.grace_days : 3;
  return today > addDays(collection.due_date, grace);
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY IN, STATE OUT. The one function that decides what marking a collection
// does, kept pure so it can be tested without a database.
//
// 'partial' is the rule that matters. amount_collected < amount_expected leaves
// the collection OPEN with the remainder owed, and the action item stays open
// with the remainder in its title. It must never auto-close: a parent who handed
// over $100 of $199 has not paid, and a ledger that rounds that up to paid is
// worse than no ledger, because someone trusts it.
//
// Zero is not a payment. It is refused rather than recorded as a partial of
// nothing, which would close nothing and mean nothing.
export function settleCollection({ expected_cents, collected_cents, waive = false }) {
  const expected = Math.max(0, Math.floor(Number(expected_cents) || 0));
  const collected = Math.floor(Number(collected_cents));
  if (waive) return { ok: true, status: "waived", remainder_cents: 0, closes_item: true };
  if (!Number.isFinite(collected) || collected <= 0) {
    return { ok: false, error: "Enter the amount that was actually collected." };
  }
  if (collected >= expected) {
    return { ok: true, status: "paid", remainder_cents: 0, closes_item: true };
  }
  return { ok: true, status: "partial", remainder_cents: expected - collected, closes_item: false };
}

export const COLLECTION_METHODS = ["cash", "e_transfer", "bank_transfer", "cheque", "other"];
export const METHOD_LABELS = {
  cash: "cash",
  e_transfer: "e-transfer",
  bank_transfer: "bank transfer",
  cheque: "cheque",
  other: "other",
};

// The workbook's "other" chip requires a follow-up box, and so does this. Without
// it an academy ends up with "$85 other." on a row and nobody can collect it.
// The database carries the same rule as a CHECK, so a direct POST cannot skip it
// either; this is the half that can say something useful to a human.
export function validateMethod(method, note) {
  if (!COLLECTION_METHODS.includes(method)) {
    return { ok: false, error: `Pick how they pay: ${COLLECTION_METHODS.join(", ")}.` };
  }
  if (method === "other" && !String(note || "").trim()) {
    return { ok: false, error: "Tell us what \"other\" means here, or nobody will know how to collect it." };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY. Owner-facing, so: no em dash, no emoji, and nothing that could be read
// as "we charged them". We did not. Somebody has to go and collect it.
export function money(cents, currency = "cad") {
  const n = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return currency && currency.toLowerCase() !== "cad" ? `$${n} ${currency.toUpperCase()}` : `$${n}`;
}

export function collectItemTitle({ amount_cents, currency, athlete_name, parent_name, due_date, remainder_cents }) {
  const who = parent_name && athlete_name ? `${parent_name} (${athlete_name})`
    : (parent_name || athlete_name || "this member");
  if (remainder_cents > 0) {
    return `Collect the remaining ${money(remainder_cents, currency)} from ${who} - was due ${due_date}`;
  }
  return `Collect ${money(amount_cents, currency)} from ${who} - due ${due_date}`;
}

export function collectItemDescription({ method, method_note, collector_name, cadence_label, reference_hint }) {
  const lines = [
    `How they pay: ${METHOD_LABELS[method] || method}${method_note ? ` (${method_note})` : ""}.`,
    cadence_label ? `Rhythm: ${cadence_label}.` : null,
    `Who collects: ${collector_name || "the academy owner"}.`,
    "This member is not billed through Stripe, so nothing is charged automatically. Somebody has to collect it.",
    reference_hint || "Open the member in the portal and use Mark collected to record the amount, the date it actually arrived, and how it came in.",
  ];
  return lines.filter(Boolean).join("\n");
}

// A plain-English rhythm from the resolved interval. Derived, never stored, so it
// cannot disagree with the dates.
export function cadenceLabel(arrangement) {
  const iv = resolveArrangementInterval(arrangement);
  const n = iv.interval_count || 1;
  if (iv.interval === "week") return n === 1 ? "every week" : `every ${n} weeks`;
  if (iv.interval === "month") return n === 1 ? "every month" : `every ${n} months`;
  if (iv.interval === "year") return n === 1 ? "every year" : `every ${n} years`;
  return n === 1 ? "every day" : `every ${n} days`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM KEYS. The machine's name for WHY an item exists, independent of what it
// says. Before action_items.system_key the only way to find a system-created
// item again was to match its title text (api/members.js:711,
// title=ilike.*Cancel old Stripe sub*) - a banner count driven by prose, which a
// copy edit silently zeroes.
export const systemKeyForCollection = (collectionId) => `collect:${collectionId}`;
export const systemKeyForStopBilling = (memberId) => `stop-billing:${memberId}`;

// THE DOUBLE-BILLING GUARD, as a decision.
//
// Flagging a member off-card while a Stripe subscription is still live is a
// setup for taking the money twice: the parent hands over cash AND Stripe keeps
// charging. For San Jose every subscription is FOREIGN (billing_portal_owned =
// false), so the portal cannot cancel it - which is exactly why this raises an
// item for a human instead of pretending to handle it.
//
// It RAISES rather than REFUSES. The flag itself is not the error; the live
// subscription is. Refusing would leave the owner with a member he knows pays
// cash and a portal that will not let him say so, and he would go around it.
export function stopBillingItem(member) {
  const sub = (member && member.stripe_subscription_id) || null;
  if (!sub) return null;
  const who = member.parent_name && member.athlete_name
    ? `${member.parent_name} (${member.athlete_name})`
    : (member.athlete_name || member.parent_name || "this member");
  return {
    system_key: systemKeyForStopBilling(member.id),
    title: `Stop the Stripe subscription for ${who} - they now pay another way`,
    description: [
      `${who} is now marked as paying outside Stripe, but subscription ${sub} is still live.`,
      "Until it is cancelled they are being charged AND asked for cash, which is the parent paying twice.",
      "If the subscription was created outside the portal, it has to be cancelled in Stripe directly - the portal cannot touch it.",
    ].join("\n"),
  };
}
