import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
import { stripeFetch as transportStripeFetch } from "../_stripe-transport.js";
export const maxDuration = 60; // AI call + Stripe write — avoid the short default timeout
// Vercel Serverless Function — The Pricing Sorter, STEP 1 "create a missing price".
//
// When an offer-price slot (plan × term the academy typed into Offers → Pricing)
// has NO close match among the academy's live Stripe prices, this endpoint fills
// the gap. Two modes — REVIEW-FIRST, nothing is written until the owner approves:
//
//   POST /api/offers/create-price   (mode=propose, default)
//     body: { client_id, targets:[{ key, offering, term, base_cents, allin_cents, label }] }
//     → asks Claude (claude-sonnet-4-6, raw fetch) for, per target, a plain-language
//       price recommendation { key, recurring:{interval,interval_count}, unit_amount_cents,
//       currency, plain_explanation, matches_offer, offer_impact_note }. Writes NOTHING.
//       → { recommendations:[...] }
//
//   POST /api/offers/create-price   (mode=apply)
//     body: { client_id, creations:[{ key, offer_id, unit_amount_cents, currency, recurring, product_name }] }
//     → for each, creates a recurring Stripe price (INLINE product) on the academy's
//       CONNECTED account (platform key + Stripe-Account header, mirroring checkout.js
//       stripeFetch POST /prices; idempotent per (client,key,amount)), then UPSERTS a
//       pricing_catalog row (tier 'canonical', is_routable true) + demotes any other
//       canonical row on that key to legacy (mirrors match-prices.js apply behavior).
//       → { created:[{ key, stripe_price_id }] }
//
// Auth: resolveUser() — staff (any academy) or a client_users member of client_id
// (same Supabase-JWT pattern as offers/match-prices.js).
// Stripe write is REAL money: idempotent per (client, key, amount) so a double
// click can't mint duplicate prices, and only ever happens on explicit apply.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const MODEL = "claude-sonnet-4-6";
const FALLBACK_CURRENCY = "usd"; // only if the connected account can't be read

function nowIso() { return new Date().toISOString(); }

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Auth: staff (any client) or active client_users membership of client_id.
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

function stripeKey() {
  return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
// The form encoding, pulled OUT of stripeFetch so it can be run without a Stripe
// account. A key whose value is null or undefined is DROPPED, and that dropping is
// what makes a one-time price a price with no `recurring` block at all rather than
// one with an empty one - i.e. it is on the money path, not a formatting detail.
// api/_billing-cadence.test.mjs renders a real sign-up fee body through this.
function stripeForm(body) {
  return new URLSearchParams(
    Object.entries(body).reduce((acc, [k, v]) => {
      if (v !== undefined && v !== null) acc[k] = String(v);
      return acc;
    }, {})
  ).toString();
}
async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  // Delegates to THE seam (api/_stripe-transport.js). The body is STILL encoded
  // by stripeForm here - api/_billing-cadence.test.mjs pins the next line, because
  // the null-dropping IS money behavior (it is what makes a one-time price carry
  // no `recurring` block at all) - and the pre-encoded string passes through the
  // transport AS-IS.
  const encoded = body ? stripeForm(body) : undefined;
  return transportStripeFetch(path, { method, body: encoded, stripeAccount, idempotencyKey });
}

// The academy's Stripe account default_currency is the source of truth for what
// we price in - USD for a US academy (e.g. DETAIL Miami), CAD for a Canadian one.
// Never hardcode it. Falls back only if the account can't be read.
async function accountCurrency(clientId) {
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = Array.isArray(rows) && rows[0] && rows[0].stripe_connect_account_id;
    if (!acct || !stripeKey()) return FALLBACK_CURRENCY;
    const a = await stripeFetch(`/accounts/${encodeURIComponent(acct)}`);
    return String(a.default_currency || FALLBACK_CURRENCY).toLowerCase();
  } catch (_) { return FALLBACK_CURRENCY; }
}

// Map an offer term ("monthly"/"4_weeks"/"<n>_months") → the catalog
// interval label we store, plus the Stripe recurring shape (checkout.js intervalFor).
//
// OPENED ADDITIVELY (Zoran, 2026-08-06): any bounded <n>_months term mints
// calendar months. The 3/6 branches stay byte-identical on purpose - they are
// what GTA's live prices were minted from. An out-of-range <n>_months REFUSES
// LOUDLY (throws a message a human can act on) rather than falling to the
// 4_weeks default, because minting a "27_months" commitment as a week x4
// subscription is a silent wrong charge on a real card.
const TERM_MAX_MONTHS = 24;
function termToInterval(term) {
  const t = String(term || "").toLowerCase();
  if (t === "3_months") return { interval: "3_months", recurring: { interval: "month", interval_count: 3 } };
  if (t === "6_months") return { interval: "6_months", recurring: { interval: "month", interval_count: 6 } };
  // Build S: a sign-up fee is a ONE-TIME price (no recurring block at all), so
  // it can only ever be billed as an invoice line, never as a subscription.
  if (t === "one_time" || t === "signup_fee") return { interval: "one_time", recurring: null };
  const m = /^(\d+)_months$/.exec(t);
  if (m) {
    const n = +m[1];
    if (n >= 1 && n <= TERM_MAX_MONTHS) return { interval: `${n}_months`, recurring: { interval: "month", interval_count: n } };
    throw Object.assign(new Error(`term "${term}" is ${n} months, outside the 1-${TERM_MAX_MONTHS} month range this build can mint - fix the commitment length on the offer`), { status: 400 });
  }
  return { interval: "4_weeks", recurring: { interval: "week", interval_count: 4 } }; // monthly / 4_weeks
}

// Term from a free-text commitment length. Mirror of _termFromLength in
// offers/match-prices.js (see the vocabulary comment there); needed here so the
// label lookup below can find the commitment a key was built from.
function _termFromLength(s) {
  const t = String(s || "").toLowerCase();
  const m = t.match(/(\d+)\s*month/);
  if (m) { const n = +m[1]; return (n >= 1 && n <= TERM_MAX_MONTHS) ? `${n}_months` : null; }
  const w = t.match(/(\d+)\s*week/);
  if (w) { const n = +w[1]; return (n % 4 === 0 && n / 4 >= 1 && n / 4 <= TERM_MAX_MONTHS) ? `${n / 4}_months` : null; }
  const y = t.match(/(\d+)\s*(?:year|yr)/);
  if (y || /\bannual(?:ly)?\b|\byearly\b/.test(t)) {
    const n = (y ? +y[1] : 1) * 12;
    return (n >= 1 && n <= TERM_MAX_MONTHS) ? `${n}_months` : null;
  }
  return null;
}

// The academy's length label as a declaration of billing RHYTHM (Zoran's ruling,
// 2026-08-06). "3 Months (12 Weeks)" carries an explicit week count, and San
// Jose's real members bill every 12 weeks - a new price minted on 3 calendar
// months would put new signups on a different clock than existing members,
// forever, invisibly. So a label with an explicit week count mints on weeks,
// PROVIDED that rhythm is in the cadence vocabulary (CADENCES below) - checkout
// bills and anchors from that vocabulary, so minting a rhythm it cannot name
// would recreate the exact minted-on-one-clock-billed-on-another failure the
// cadence build closed. A week count outside it warns loudly and mints the
// term's calendar shape. A months-only label stays calendar months.
function cadenceFromLength(len) {
  const w = String(len || "").toLowerCase().match(/(\d+)\s*week/);
  if (!w) return null;
  const cad = `${+w[1]}_weeks`;
  if (Object.prototype.hasOwnProperty.call(CADENCES, cad)) return cad;
  console.warn(`[create-price] length "${len}" declares a ${+w[1]}-week billing rhythm, which is not in the cadence vocabulary (${Object.keys(CADENCES).join(", ")}) - minting the term's calendar shape instead. Set billing_cadence on the price row once the vocabulary supports it.`);
  return null;
}

// ── Billing CADENCE ─────────────────────────────────────────────────────────
// How a price actually re-bills, held as an explicit nullable field on the
// offer_prices row (billing_cadence) rather than inferred from the term key or
// from commitment free text, which cannot express it: prod carries both
// "12 Weeks (3 Months)" and "3 Months (12 Weeks)" for different academies.
//
// This map MUST stay identical to CADENCES in api/website/checkout.js, which is
// the code that actually charges. A price minted on one shape and billed on
// another is the worst outcome available here, so api/_billing-cadence.test.mjs
// reads both files and fails if they ever drift.
const CADENCES = {
  "4_weeks": { interval: "week", interval_count: 4 },
  monthly: { interval: "month", interval_count: 1 },
  "12_weeks": { interval: "week", interval_count: 12 },
  "24_weeks": { interval: "week", interval_count: 24 },
  "3_calendar_months": { interval: "month", interval_count: 3 },
  "6_calendar_months": { interval: "month", interval_count: 6 },
};
function normCadence(v) {
  const raw = v == null ? "" : String(v).trim().toLowerCase();
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(CADENCES, raw)) return raw;
  console.warn(`[create-price] billing_cadence "${raw}" is not a cadence this build knows - minting the term's standard shape instead`);
  return null;
}

// ⚠️ THE ONE DECISION: what Stripe recurring shape (if any) does this price mint
// on? Propose and apply BOTH call this, so the sentence an owner approves on the
// review screen and the price that is actually minted cannot disagree.
//
// The order is deliberate and the first rule is load-bearing:
//   1. THE TERM DECIDES ONE-TIME, AND NOTHING MAY OVERRIDE IT. A sign-up fee
//      rides an enrollment's first invoice as a single line; it must never become
//      a subscription. `proposed` comes from the AI response - whose schema
//      REQUIRES a `recurring` object on every item, so the model returns one for a
//      one_time target too - and then round-trips through the browser, which
//      stashes the recommendation and posts it straight back to apply. Without
//      this line a $75 sign-up fee is minted as a $75 MONTHLY SUBSCRIPTION against
//      a real parent's card. It was fail-closed only by accident once
//      (cadenceLabel(null) threw and 500'd the propose call), and accidental
//      safety is not safety.
//   2. A cadence on the ROW is the academy's explicit instruction and outranks
//      anything proposed. An unknown cadence is not a cadence (normCadence has
//      already warned about it), so it falls through to the term's legacy shape
//      rather than minting on a guess.
//   3. Otherwise the proposed shape, and failing that the term's standard shape -
//      byte-identically what this endpoint minted before cadence existed.
function recurringFor(term, cadence, proposed) {
  const termIv = termToInterval(term);
  if (termIv.recurring === null) return null;
  if (cadence && Object.prototype.hasOwnProperty.call(CADENCES, cadence)) return CADENCES[cadence];
  return (proposed && proposed.interval) ? proposed : termIv.recurring;
}

// The body of the Stripe /prices POST, as a pure value. Extracted for the same
// reason as stripeForm: this is the last point at which a one-time price could be
// handed a recurring block, and a test that cannot render it can only ever assert
// that a line of source still looks the way somebody remembers it looking.
function priceBody(key, amount, currency, recurring, priceName) {
  return {
    currency,
    unit_amount: amount,
    // One-time prices carry NO recurring block (stripeForm drops nulls).
    "recurring[interval]": recurring ? recurring.interval : null,
    "recurring[interval_count]": recurring ? recurring.interval_count : null,
    "product_data[name]": priceName,
    "metadata[source]": "fullcontrol-sorter",
    "metadata[offer_price_key]": key || undefined,
  };
}

// Does the price about to be minted have a cadence? Two sources, in order:
//   1. an explicit billing_cadence on the creation request, and
//   2. the typed runtime row for this key, which is where cadence LIVES.
// (2) is the one that matters in practice: a row whose cadence was set after its
// Stripe price was minted needs a NEW price on the new clock, and re-minting
// through the sorter is how that happens. No answer, an unreadable row, or a
// column that has not been migrated yet all mean null, which mints exactly the
// shape this endpoint minted before cadence existed.
//
// ⚠️ THE ROW THIS READS DECIDES WHAT A REAL STRIPE PRICE CHARGES, so it is scoped
// exactly the way api/website/checkout.js scopes the row it BILLS - anything
// looser and the two can disagree:
//   • source_offer_id, because offer_price_key is only unique WITHIN an offer.
//     A tenant running two offers that both sell "Steady|3_months" would
//     otherwise mint one offer's price on the other offer's clock. No offer_id
//     on the request means no cadence, rather than a guess across offers.
//   • is_active AND is_routable, because offers-sync DEACTIVATES superseded rows
//     instead of deleting them. Without this, a re-mint reads the DEAD row's
//     cadence and mints week x12 while checkout bills the live row on months.
//   • order=sort_order.asc, so limit=1 returns the same row every time. An
//     unordered limit=1 is whatever Postgres felt like, which on the money path
//     means the clock can change between two identical requests.
async function cadenceForCreation(clientId, c) {
  const explicit = normCadence(c && c.billing_cadence);
  if (explicit) return explicit;
  const key = c && c.key;
  const offerId = c && c.offer_id;
  if (!key || !offerId) return null;
  let rowCadence = null;
  try {
    const rows = await sb(
      `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}` +
      `&source_offer_id=eq.${encodeURIComponent(offerId)}` +
      `&source_offer_price_key=eq.${encodeURIComponent(key)}` +
      `&is_active=eq.true&is_routable=eq.true&billing_cadence=not.is.null` +
      `&order=sort_order.asc&select=billing_cadence&limit=1`
    );
    rowCadence = normCadence(Array.isArray(rows) && rows[0] && rows[0].billing_cadence);
  } catch (_) {
    // column not migrated yet, or the row is unreadable - not a cadence, and
    // not fatal: fall through to the LABEL, which is read-only and still the
    // academy's own declaration of how this commitment bills
  }
  if (rowCadence) return rowCadence;
  return await cadenceFromOfferLabel(clientId, offerId, key);
}

// Priority 3 of the cadence decision (after an explicit request cadence and the
// typed row): the offer's own commitment LENGTH LABEL. See cadenceFromLength for
// the ruling. Scoped like everything else on this path: the offer named by the
// request, non-archived offerings only (an archived GTA tier's "12 Weeks
// (3 Months)" label must never lend its rhythm to anything), and the commitment
// whose parsed term matches the key's term. Any failure to answer is null,
// which mints exactly the term's standard shape.
async function cadenceFromOfferLabel(clientId, offerId, key) {
  const title = String(key || "").split("|")[0];
  const term = String(key || "").split("|")[1] || "";
  if (!title || !term) return null;
  try {
    const rows = await sb(
      `offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=data&limit=1`
    );
    const data = Array.isArray(rows) && rows[0] && rows[0].data;
    const offerings = (data && data.pricing && data.pricing.pricing_offerings) || [];
    const off = offerings.find(o => o && !o.archived && String(o.title || "").trim() === title);
    if (!off) return null;
    const cm = (off.commitments || []).find(x => x && _termFromLength(x.length) === term);
    return cm ? cadenceFromLength(cm.length) : null;
  } catch (_) {
    return null;   // an unreadable offer is no declaration at all
  }
}

function money(cents, currency) {
  const c = String(currency || FALLBACK_CURRENCY).toUpperCase();
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
}
function cadenceLabel(recurring) {
  const n = recurring.interval_count, u = recurring.interval;
  if (u === "week" && n === 4) return "every 4 weeks";
  return `every ${n > 1 ? n + " " : ""}${u}${n > 1 ? "s" : ""}`;
}

// ── PROPOSE: ask Claude for a plain-language recommendation per unmatched target ──
async function aiRecommend(targets, currency) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const cur = String(currency || FALLBACK_CURRENCY).toUpperCase();
  const system =
    "A sports academy typed offer prices (plan × term) into their Offers, but some have NO matching " +
    "Stripe price yet. For EACH target, recommend the Stripe price to create. `base_cents` is the " +
    "pre-tax price the academy typed; `allin_cents` is base plus the academy's OWN configured added " +
    "fees (it equals base when no fee was set); `fee_label` describes that fee (e.g. '13% HST') or is " +
    "null. CHARGE THE ALL-IN: pick unit_amount_cents = allin_cents. Never invent tax - the fee is only " +
    "whatever the academy configured, which may be nothing. " +
    // This used to say the shape "is fixed by the term", which stopped being true
    // when billing_cadence landed: a row with a cadence overrides whatever comes
    // back from here. The prompt now says so, because a model told a falsehood
    // about the money path will confidently explain the wrong number to an owner.
    "Unless the price row carries an explicit billing cadence (in which case the server overrides you), " +
    "the recurring shape follows the term: monthly/4_weeks → {interval:'week',interval_count:4}; " +
    "any <n>_months term → {interval:'month',interval_count:n} (3_months → month x3, 9_months → month x9). " +
    // The schema below requires a `recurring` key on every item, so the model
    // returns one for a sign-up fee too. The server refuses it either way, but a
    // prompt that never asks for the wrong answer is better than one that does.
    "A one_time or signup_fee term is a SINGLE charge, never a subscription: set recurring to null for it. " +
    "plain_explanation: if allin_cents > base_cents, write e.g. '$563.87 every 3 months = your $499.00 " +
    "+ 13% HST' using fee_label; otherwise just '$499.00 every 3 months'. " +
    "Set matches_offer=true when unit_amount_cents equals the target's base or all-in; offer_impact_note = " +
    "one short line on what creating this does (e.g. 'new signups on the Steady plan will be billed this'). " +
    `Currency is ${cur} (the academy's Stripe account currency) - use it for every recommendation. ` +
    "Respond with ONLY a JSON array, one object per input target, same order, no prose:\n" +
    '[{"key","recurring":{"interval","interval_count"},"unit_amount_cents","currency","plain_explanation","matches_offer"(bool),"offer_impact_note"}]';

  const payload = {
    targets: targets.map(t => ({
      key: t.key, offering: t.offering, term: t.term,
      base_cents: t.base_cents, allin_cents: t.allin_cents, fee_label: t.fee_label || null, label: t.label,
    })),
  };

  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 4096 });
}

// Deterministic fallback recommendation (also used to harden/normalize the AI output).
// Charges the ALL-IN = base + the academy's configured added fee (equals base
// when no fee was set - no automatic HST/markup).
// `rowCadence` is the cadence the price row already carries, when it carries one.
// It is passed in rather than looked up here so this stays a pure function, and it
// is honored so the sentence the OWNER READS on the review screen describes the
// price that will actually be minted. Without it the proposal says "every 3
// months" and apply mints a 12-week clock, which is the wrong way round to be
// wrong: the money is right and the screen lies about it.
function fallbackRecommend(t, currency, rowCadence) {
  const recurring = recurringFor(t.term, rowCadence, null);
  const base = t.base_cents || 0;
  const amount = t.allin_cents || base || 0;
  const cadence = recurring ? cadenceLabel(recurring) : "one time";
  const planLabel = (t.offering || String(t.key || "").split("|")[0] || "this plan").trim();
  const plain = (t.fee_label && amount > base && base > 0)
    ? `${money(amount, currency)} ${cadence} = your ${money(base, currency)} + ${t.fee_label}`
    : `${money(amount, currency)} ${cadence}`;
  return {
    key: t.key,
    recurring,
    unit_amount_cents: amount,
    currency,
    plain_explanation: plain,
    matches_offer: true,
    offer_impact_note: `New signups on ${planLabel} (${String(t.term || "").replace("_", " ")}) will be billed this.`,
  };
}

async function runPropose(req, res, ctx, body, clientId) {
  const targets = Array.isArray(body.targets) ? body.targets : [];
  if (!targets.length) return res.status(400).json({ error: "targets[] required" });

  const currency = await accountCurrency(clientId); // USD for DETAIL Miami, CAD for a CA academy

  let aiOut = [];
  try { aiOut = await aiRecommend(targets, currency); } catch (_) { aiOut = []; }
  const byKey = Object.fromEntries((Array.isArray(aiOut) ? aiOut : []).map(r => [String(r.key), r]));

  // The cadence each target's row already carries, resolved through the SAME
  // function apply uses, so the review screen and the mint cannot disagree.
  // Nothing here writes; an unreadable row or an unmigrated column is simply no
  // cadence, and the proposal reads exactly as it did before cadence existed.
  const cadenceByKey = new Map();
  for (const t of targets) {
    const c = { key: t.key, offer_id: t.offer_id || body.offer_id, billing_cadence: t.billing_cadence };
    cadenceByKey.set(t.key, await cadenceForCreation(clientId, c));
  }

  const recommendations = targets.map(t => {
    // An out-of-range <n>_months term cannot be minted. Refuse THIS target with
    // the human-readable reason instead of recommending a shape apply would
    // refuse anyway (or worse, defaulting it to week x4).
    try { termToInterval(t.term); }
    catch (e) { return { key: t.key, error: e.message || String(e) }; }
    const rowCadence = cadenceByKey.get(t.key) || null;
    const fb = fallbackRecommend(t, currency, rowCadence);
    const a = byKey[t.key];
    if (!a) return fb;
    // The model's answer enters the system HERE, and it goes through the same one
    // decision apply uses. The response schema REQUIRES a recurring object, so the
    // model returns one for a sign-up fee too; passing that on would make the
    // review screen offer a subscription and hand the UI a payload that asks apply
    // to mint one. Apply refuses it, but a proposal nobody can act on should never
    // be shown in the first place.
    const oneTime = termToInterval(t.term).recurring === null;
    const recurring = recurringFor(t.term, rowCadence, a.recurring);
    const amount = Number.isFinite(Number(a.unit_amount_cents)) && Number(a.unit_amount_cents) > 0
      ? Math.round(Number(a.unit_amount_cents)) : fb.unit_amount_cents;
    return {
      key: t.key,
      offering: t.offering || null,
      term: t.term || null,
      label: t.label || null,
      recurring,
      unit_amount_cents: amount,
      currency, // forced to the account currency - can't create a price in one the account doesn't support
      // Same reason: the model's sentence describes the shape it proposed, which
      // a cadence has just overridden. Use the deterministic one, which describes
      // what will actually be minted.
      plain_explanation: (rowCadence || oneTime) ? fb.plain_explanation : (a.plain_explanation || fb.plain_explanation),
      matches_offer: a.matches_offer != null ? !!a.matches_offer : fb.matches_offer,
      offer_impact_note: a.offer_impact_note || fb.offer_impact_note,
    };
  });

  return res.status(200).json({ ok: true, mode: "propose", recommendations });
}

// ── APPLY: create each Stripe price + upsert pricing_catalog ──
async function runApply(req, res, ctx, body, clientId) {
  const creations = Array.isArray(body.creations) ? body.creations : [];
  if (!creations.length) return res.status(400).json({ error: "creations[] required" });
  if (!stripeKey()) throw new Error("Stripe secret key not configured");

  // Three-outcome money gate (house rule 10): a clients read that THREW is
  // "could not ask", never "not connected" - retryable 503; the 409 below stays
  // reserved for a row that actually answered without an account.
  let clientRows;
  try {
    clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
  } catch {
    return res.status(503).json({ error: "could not verify billing setup, try again" });
  }
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.stripe_connect_account_id) return res.status(409).json({ error: "academy not connected to Stripe" });
  const stripeAccount = client.stripe_connect_account_id;
  const acctCurrency = await accountCurrency(clientId); // default to the academy's account currency, not CAD

  const created = [];
  for (const c of creations) {
    const key = c.key || null;
    const amount = Math.round(Number(c.unit_amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) { created.push({ key, error: "invalid unit_amount_cents" }); continue; }
    const currency = String(c.currency || acctCurrency).toLowerCase();
    // ⚠️ THE TERM HAS TO BE RECOVERED FROM THE KEY, because the sorter's apply
    // payload does not always carry it: public/client-portal.html stashes
    // { key, offer_id, unit_amount_cents, currency, recurring, product_name } and
    // posts that back. With no term, termToInterval() returns the 4_weeks default
    // and the one-time gate below never fires - so a `<plan>|signup_fee` creation
    // would sail through as a recurring price on the strength of the client's own
    // `recurring`. The key's term is the same truth match-prices.js and
    // offers-sync.ts both derive from, so derive it the same way here.
    const term = c.term || String(c.key || "").split("|")[1] || "";
    // An out-of-range <n>_months term throws (see termToInterval): surface it as
    // THIS creation's error and keep going, so one bad rung cannot take down a
    // batch that also contains mintable ones.
    let termIv;
    try { termIv = termToInterval(term); }
    catch (e) { created.push({ key, error: e.message || String(e) }); continue; }
    // ⚠️ THE ONE-TIME GATE, and the cadence, in one call. See recurringFor: the
    // term decides one-time and NOTHING the client sends may promote it, which is
    // what stops the sorter UI posting back the model's `recurring` and minting a
    // $75 sign-up fee as a $75 MONTHLY SUBSCRIPTION.
    //
    // A cadence cannot apply to a one-time price either, so it is not even looked
    // up: that is what stops a cadence on the wrong row doing the same thing, and
    // it saves a query per sign-up fee.
    const oneTime = termIv.recurring === null;
    const cadence = oneTime ? null : await cadenceForCreation(clientId, c);
    const recurring = recurringFor(term, cadence, c.recurring);
    // Best-effort catalog interval label from the recurring shape.
    let interval = "4_weeks";
    if (!recurring) interval = "one_time";
    // With a cadence, the shape no longer identifies the term (12_weeks and
    // 4_weeks are both "week"), so the label comes from the term the sorter was
    // asked for. Cadence changes HOW it bills, never WHICH commitment it is.
    else if (cadence) interval = termIv.interval;
    else if (recurring.interval === "month" && recurring.interval_count === 3) interval = "3_months";
    else if (recurring.interval === "month" && recurring.interval_count === 6) interval = "6_months";
    // Adjustable prepay lengths (2026-08-06): any other multi-month shape labels
    // as its own <n>_months. month x1 deliberately keeps falling to "4_weeks",
    // byte-identical to what this wrote before the vocabulary opened.
    else if (recurring.interval === "month" && recurring.interval_count > 1 && recurring.interval_count <= TERM_MAX_MONTHS) interval = `${recurring.interval_count}_months`;
    const priceName = (c.product_name || (key ? String(key).replace("|", " · ") : "FullControl price")).toString();

    // Create the recurring price with an INLINE product on the connected account.
    // Idempotent per (client, key, amount) so a double-click can't mint duplicates.
    const price = await stripeFetch(`/prices`, {
      method: "POST", stripeAccount,
      // The cadence joins the idempotency key ONLY when there is one. Without
      // that, re-minting a key whose cadence changed would hand back Stripe's
      // CACHED price on the old clock, with no error anywhere - the catalog would
      // say 12 weeks and Stripe would keep charging every 3 months. A price with
      // no cadence keeps a byte-identical key to today.
      idempotencyKey: `sorter-price-${clientId}-${key || "nokey"}-${amount}${cadence ? `-${cadence}` : ""}`.slice(0, 200),
      body: priceBody(key, amount, currency, recurring, priceName),
    });

    // Upsert the pricing_catalog row — tier canonical, routable.
    // stripe_product_id is NOT NULL: Stripe auto-creates a product from
    // product_data and returns its id on price.product — store it.
    const row = {
      client_id: clientId,
      stripe_price_id: price.id,
      stripe_product_id: price.product || null,
      stripe_account_id: stripeAccount || null,
      display_name: priceName,
      offer_id: c.offer_id || null,
      offer_price_key: key,
      tier: "canonical",
      amount_cents: amount,
      currency,
      interval,
      is_routable: true,
      match_status: "confirmed",
      match_source: "sorter-create",
      matched_at: nowIso(),
      updated_at: nowIso(),
    };
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
    await sb(`pricing_catalog?on_conflict=client_id,stripe_price_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ ...row, created_at: nowIso() }]),
    });

    // ENFORCE one canonical price per offer_price_key: demote OTHER canonical rows.
    if (key) {
      await sb(
        `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
        `&offer_price_key=eq.${encodeURIComponent(key)}` +
        `&tier=eq.canonical&stripe_price_id=neq.${encodeURIComponent(price.id)}`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tier: "legacy_unknown", updated_at: nowIso() }) }
      ).catch(() => {});
    }

    created.push({
      key, stripe_price_id: price.id, stripe_product_id: price.product || null,
      livemode: price.livemode === true, account: stripeAccount || null,
      // ⚠️ NOTHING READS THESE TWO FIELDS YET. They are here so the clock a price
      // was minted on is at least RECOVERABLE from the response, but no consumer
      // exists: the sorter UI in public/client-portal.html renders the cadence
      // from the TERM, so a price minted on a 12-week clock is presented to the
      // owner as "every 3 months". The mint is correct and the screen is wrong,
      // which is the more dangerous way round. Wiring the UI to these fields is
      // a separate, tracked build - until it lands, the sorter mis-states the
      // cadence of any price whose row carries one.
      billing_cadence: cadence,
      recurring: recurring ? { interval: recurring.interval, interval_count: recurring.interval_count } : null,
    });
  }

  return res.status(200).json({ ok: true, mode: "apply", created });
}

// ── SEARCH: list the academy's existing Stripe prices to match against ──
async function runSearch(req, res, ctx, body, clientId) {
  if (!stripeKey()) throw new Error("Stripe secret key not configured");
  // Three-outcome money gate (house rule 10): clients read THREW = 503, never the 409.
  let clientRows;
  try {
    clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id&limit=1`);
  } catch {
    return res.status(503).json({ error: "could not verify billing setup, try again" });
  }
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  if (!client.stripe_connect_account_id) return res.status(409).json({ error: "academy not connected to Stripe" });
  const stripeAccount = client.stripe_connect_account_id;
  const q = (body.q || "").toString().trim().toLowerCase();

  // Pull active prices (recurring focus) with product expanded, paginated.
  const out = [];
  let starting_after = null;
  for (let page = 0; page < 6; page++) {
    const params = new URLSearchParams({ limit: "100", active: "true" });
    params.append("expand[]", "data.product");
    if (starting_after) params.set("starting_after", starting_after);
    const r = await stripeFetch(`/prices?${params.toString()}`, { stripeAccount });
    const data = r.data || [];
    for (const p of data) {
      if (!p.recurring) continue; // memberships are recurring
      const prod = p.product && typeof p.product === "object" ? p.product : null;
      const name = (prod && prod.name) || p.nickname || "Untitled price";
      out.push({
        price_id: p.id,
        product_id: typeof p.product === "string" ? p.product : (prod && prod.id) || null,
        product_name: name,
        nickname: p.nickname || null,
        amount_cents: p.unit_amount,
        currency: p.currency,
        interval: p.recurring.interval,
        interval_count: p.recurring.interval_count,
      });
    }
    if (!r.has_more || !data.length) break;
    starting_after = data[data.length - 1].id;
  }
  const filtered = q
    ? out.filter(p => `${p.product_name} ${p.nickname || ""} ${(p.amount_cents / 100).toFixed(2)}`.toLowerCase().includes(q))
    : out;
  filtered.sort((a, b) => (a.product_name || "").localeCompare(b.product_name || ""));
  return res.status(200).json({ ok: true, mode: "search", prices: filtered });
}

// ── LINK: attach an EXISTING Stripe price to an offer-price slot (no new price) ──
async function runLink(req, res, ctx, body, clientId) {
  const key = body.key || null;
  const priceId = body.stripe_price_id || null;
  if (!key || !priceId) return res.status(400).json({ error: "key and stripe_price_id required" });
  const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id&limit=1`);
  const client = Array.isArray(clientRows) && clientRows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });
  const stripeAccount = client.stripe_connect_account_id || null;

  // Read the price so the catalog row is accurate.
  let price = null;
  try {
    const params = new URLSearchParams(); params.append("expand[]", "product");
    price = await stripeFetch(`/prices/${encodeURIComponent(priceId)}?${params.toString()}`, { stripeAccount });
  } catch (e) { return res.status(e.stripeStatus || 502).json({ error: `Stripe price lookup: ${e.message}` }); }

  const prod = price.product && typeof price.product === "object" ? price.product : null;
  const rc = price.recurring || {};
  let interval = "4_weeks";
  if (rc.interval === "month" && rc.interval_count === 3) interval = "3_months";
  else if (rc.interval === "month" && rc.interval_count === 6) interval = "6_months";
  // Adjustable prepay lengths (2026-08-06): same rule as apply's label above.
  else if (rc.interval === "month" && rc.interval_count > 1 && rc.interval_count <= TERM_MAX_MONTHS) interval = `${rc.interval_count}_months`;
  const row = {
    client_id: clientId, stripe_price_id: price.id,
    stripe_product_id: (typeof price.product === "string" ? price.product : prod && prod.id) || null,
    stripe_account_id: stripeAccount,
    display_name: (prod && prod.name) || price.nickname || body.product_name || key,
    offer_id: body.offer_id || null, offer_price_key: key, tier: "canonical",
    amount_cents: price.unit_amount, currency: price.currency, interval,
    is_routable: true, match_status: "confirmed", match_source: "sorter-link-existing",
    matched_at: nowIso(), updated_at: nowIso(),
  };
  Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
  await sb(`pricing_catalog?on_conflict=client_id,stripe_price_id`, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ ...row, created_at: nowIso() }]),
  });
  await sb(
    `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&offer_price_key=eq.${encodeURIComponent(key)}&tier=eq.canonical&stripe_price_id=neq.${encodeURIComponent(price.id)}`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tier: "legacy_unknown", updated_at: nowIso() }) }
  ).catch(() => {});
  return res.status(200).json({ ok: true, mode: "link", key, stripe_price_id: price.id });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const mode = body.mode || (Array.isArray(body.creations) ? "apply" : "propose");
    if (mode === "apply") return await runApply(req, res, ctx, body, clientId);
    if (mode === "propose") return await runPropose(req, res, ctx, body, clientId);
    if (mode === "search") return await runSearch(req, res, ctx, body, clientId);
    if (mode === "link") return await runLink(req, res, ctx, body, clientId);
    return res.status(400).json({ error: "unknown mode (expected 'propose', 'apply', 'search' or 'link')" });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
