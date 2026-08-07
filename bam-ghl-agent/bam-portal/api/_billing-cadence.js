// THE ONE PLACE A BILLING INTERVAL IS DECIDED.
//
// This file is not new logic. It is api/website/checkout.js:109-211 MOVED here
// verbatim, because a second consumer arrived and copying it would have made
// three copies of the arithmetic that decides when a parent is charged.
//
// WHO IMPORTS IT
//   api/website/checkout.js   - the enrollment path. Charges the card.
//   api/_off-card.js          - the off-Stripe collections engine. Decides when
//                               an owner is reminded to collect cash.
//
// WHY THAT MATTERS. Zoran, 2026-08-07, on the off-card build: "i just want to
// make sure its adaptable to any commitment that is created in the pricing
// stage". The term vocabulary was CLOSED to monthly/3_months/6_months until
// 2026-08-06; a 9-month or 18-month commitment produced no key at all. It is
// open now, and intervalFor below is where that openness lives. An off-card
// arrangement that carried its own 3/6-month list would silently re-close it for
// cash payers only, and nobody would find out until a 9-month parent was
// reminded on the wrong day for nine months.
//
// api/offers/create-price.js still carries its own copy of CADENCES on purpose -
// it mints the Stripe price and is compared entry-by-entry against this map by
// api/_billing-cadence.test.mjs, which is the gate that makes a price minted on
// one clock and billed on another impossible.
//
// NOTHING HERE TOUCHES THE NETWORK OR THE DATABASE. Pure functions, importable
// from a test with no stub.

function intervalFor(term) {
  if (term === "3_months") return { interval: "month", interval_count: 3 };
  if (term === "6_months") return { interval: "month", interval_count: 6 };
  // Adjustable prepay lengths (Zoran, 2026-08-06): any bounded <n>_months term
  // bills calendar months. The two branches above stay byte-identical - they are
  // the shapes every live academy bills on today. An out-of-range <n>_months
  // REFUSES LOUDLY: billing a "27_months" key as week x4 (the old default)
  // would be a silent wrong charge, and no such key can be minted, so reaching
  // this throw means the data is broken and a human must look.
  const nm = /^(\d+)_months$/.exec(String(term || ""));
  if (nm) {
    const n = +nm[1];
    if (n >= 1 && n <= 24) return { interval: "month", interval_count: n };
    throw new Error(`term "${term}" is ${n} months, outside the 1-24 month range this build can bill - fix the commitment length on the offer`);
  }
  return { interval: "week", interval_count: 4 };
}

// ── Billing CADENCE: how a price actually re-bills ──────────────────────────
//
// The term key (4_weeks / 3_months / 6_months) is the COMMITMENT'S IDENTITY and
// nothing here changes what it means: it is what offer_price_key joins on, what
// the agreement PDF's term noun reads, and what the revert logic gates on.
// Cadence is a second, explicit, NULLABLE field on the offer_prices row that
// says how the money actually recurs, because one 3-month commitment can
// legitimately bill per calendar quarter (BAM GTA, live today) and another can
// bill per 12 weeks (San Jose, ruled 2026-07-30) while both are "3 months" to
// the parent.
//
// WHY IT CANNOT COME FROM THE COMMITMENT TEXT. Prod carries both notations for
// the same thing: GTA's archived tiers say "12 Weeks (3 Months)" and San Jose
// says "3 Months (12 Weeks)". Both match /(\d+)\s*month/ AND /12\s*week/, so
// free text cannot express the distinction at all. termFromLength and
// lengthMatchesTerm are deliberately left alone; the cadence is DATA, not prose.
//
// NULL, absent, or unrecognized cadence resolves to intervalFor(term) - byte for
// byte the behavior every live academy has today.
const CADENCES = {
  "4_weeks": { interval: "week", interval_count: 4 },
  monthly: { interval: "month", interval_count: 1 },
  "12_weeks": { interval: "week", interval_count: 12 },
  "24_weeks": { interval: "week", interval_count: 24 },
  "3_calendar_months": { interval: "month", interval_count: 3 },
  "6_calendar_months": { interval: "month", interval_count: 6 },
};

// The ONE place a billing interval is decided. Every caller goes through here so
// a cadence cannot be honored on one code path and ignored on another.
// Returns the Stripe recurring shape plus:
//   cadence          - the recognized cadence that shaped it, else null (legacy)
//   unknown_cadence  - a value the row carried that this build does not know.
//                      We bill the LEGACY shape and report it, the same non-fatal
//                      posture as the sign-up fee lookup: an enrollment is never
//                      blocked over it, and it never silently invents a cadence.
function resolveInterval(row, term) {
  const raw = row && typeof row === "object" && row.billing_cadence != null
    ? String(row.billing_cadence).trim().toLowerCase()
    : "";
  if (raw && Object.prototype.hasOwnProperty.call(CADENCES, raw)) {
    return { ...CADENCES[raw], cadence: raw, unknown_cadence: null };
  }
  return { ...intervalFor(term), cadence: null, unknown_cadence: raw || null };
}

// The admin-facing note for a cadence this build does not know. Non-fatal by
// construction: it rides the 200 alongside coupon_error rather than turning a
// paid enrollment into an error the parent has to read.
function cadenceWarning(iv) {
  if (!iv || !iv.unknown_cadence) return null;
  return `This price is set to bill "${iv.unknown_cadence}", which this build does not recognize. It was billed on the standard schedule for its term instead. Check the price row in the portal.`;
}

// Add one billing interval to a date (UTC). Used to place the recurring anchor one
// full period AFTER a chosen future start date (they pay the first period today).
function addInterval(date, iv) {
  const d = new Date(date.getTime());
  const n = iv.interval_count || 1;
  if (iv.interval === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (iv.interval === "month") d.setUTCMonth(d.getUTCMonth() + n);
  else if (iv.interval === "year") d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCDate(d.getUTCDate() + n); // day
  return d;
}

export { CADENCES, intervalFor, resolveInterval, addInterval, cadenceWarning };
