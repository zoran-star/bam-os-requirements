import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
import { applyFee, feeLabel, resolveFee } from "../_fees.js";
import { stripeFetch as transportStripeFetch } from "../_stripe-transport.js";
// Reads ALL live Stripe subs/products/charges (paginated) + an AI call — the
// default ~10s function timeout is not enough, which surfaces as "Failed to
// fetch" on the client. Give it headroom.
export const maxDuration = 60;
// Vercel Serverless Function — AI price matcher (Offer ⇄ Stripe ⇄ CoachIQ)
//
// Phase 2 of the offer-price-mapping feature (see
// memories/project_offer_price_mapping.md). Reads an academy's LIVE Stripe subs,
// groups them by price, and uses Claude to propose which OFFER-PRICE (plan × term)
// + tier (canonical / legacy / deprecated) each price is — REVIEW-FIRST: it returns
// proposals; nothing is written until the owner approves (apply=true).
//
// It also HARVESTS the CoachIQ product id from each sub's metadata.productId
// (CoachIQ stamps it), so the CoachIQ side gets pre-filled too.
//
// POST /api/offers/match-prices
//   body: { client_id, offer_id?, apply?: false, approvals?: [...] }
//   • apply=false (default) → returns { proposals: [...] } for review
//   • apply=true            → writes the provided `approvals` to pricing_catalog
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.
// Needs STRIPE_CONNECT_SECRET_KEY (live platform key) + ANTHROPIC_API_KEY.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";
const MODEL = "claude-sonnet-4-6";

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
async function stripeGet(path, stripeAccount) {
  // Delegates to THE seam (api/_stripe-transport.js): platform key + Stripe-Account
  // header for Connect academies, the academy's own key when a direct row exists.
  return transportStripeFetch(path, { stripeAccount });
}

// Pull all subscriptions on the connected account (any status), expanded.
async function fetchLiveSubs(stripeAccount) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 20; page++) { // safety cap (20×100 = 2000 subs)
    const qs = new URLSearchParams({ status: "all", limit: "100" });
    qs.append("expand[]", "data.items.data.price"); // .product would be 5 levels (Stripe expand max is 4)
    qs.append("expand[]", "data.customer");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/subscriptions?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    out.push(...data);
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return out;
}

// Product names can't be expanded inline (depth limit), so fetch them once and
// map id → name. One or two list calls for a typical academy.
// Exported (2026-08-06) for the workbook rehearsal's live-Stripe read: reusing
// this one pass is the non-fork answer to naming the prices it finds.
export async function fetchProductNames(stripeAccount) {
  const map = {};
  let startingAfter = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/products?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    for (const p of data) map[p.id] = p.name;
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return map;
}

// One-time / prepaid purchases — succeeded charges NOT tied to a subscription
// invoice. Grouped by amount → pseudo-price entries so prepaid members (e.g. a
// 6-month paid up front via one charge) surface in the matcher too.
async function fetchOneTimeGroups(stripeAccount) {
  const NOW = Math.floor(Date.now() / 1000);
  const D90 = NOW - 90 * 86400;
  const since = NOW - 400 * 86400; // ~13 months back
  const groups = new Map();
  let startingAfter = null;
  for (let page = 0; page < 8; page++) { // cap 800 charges
    const qs = new URLSearchParams({ limit: "100" });
    qs.set("created[gte]", String(since));
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/charges?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    for (const ch of data) {
      if (ch.status !== "succeeded" || ch.refunded || ch.invoice) continue; // skip refunds + subscription charges
      const key = `onetime-${ch.amount}-${ch.currency}`;
      if (!groups.has(key)) {
        groups.set(key, {
          price_id: key, is_one_time: true,
          product_id: null, product_name: "One-time / prepaid", nickname: ch.description || null,
          unit_amount: ch.amount, currency: ch.currency, interval: "one_time", interval_count: null,
          application: ch.application || null, sub_count: 0, newest_created: 0, recent_90d: 0,
          coachiq_product_id: null,
        });
      }
      const g = groups.get(key);
      g.sub_count++;
      if (ch.created > g.newest_created) g.newest_created = ch.created;
      if (ch.created >= D90) g.recent_90d++;
    }
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return [...groups.values()];
}

const ACTIVEISH = new Set(["active", "trialing", "past_due", "paused", "unpaid"]);

// Group subs by their (first item's) price; collect signals per price.
function groupByPrice(subs) {
  const NOW = Math.floor(Date.now() / 1000);
  const D90 = NOW - 90 * 86400;
  const groups = new Map();
  for (const sub of subs) {
    if (!ACTIVEISH.has(sub.status)) continue;
    const item = sub.items && sub.items.data && sub.items.data[0];
    const price = item && item.price;
    if (!price) continue;
    const key = price.id;
    if (!groups.has(key)) {
      const product = price.product && typeof price.product === "object" ? price.product : null;
      groups.set(key, {
        price_id: price.id,
        product_id: typeof price.product === "string" ? price.product : (product && product.id) || null,
        product_name: (product && product.name) || null,
        nickname: price.nickname || null,
        unit_amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring && price.recurring.interval,
        interval_count: price.recurring && price.recurring.interval_count,
        application: sub.application || null, // creator: CoachIQ / GHL / null=manual
        sub_count: 0,
        newest_created: 0,         // recency signal
        recent_90d: 0,
        coachiq_product_ids: {},   // metadata.productId → count
        sample_emails: [],
      });
    }
    const g = groups.get(key);
    g.sub_count++;
    if (sub.created && sub.created > g.newest_created) g.newest_created = sub.created;
    if (sub.created && sub.created >= D90) g.recent_90d++;
    const md = sub.metadata || {};
    if (md.productId) g.coachiq_product_ids[md.productId] = (g.coachiq_product_ids[md.productId] || 0) + 1;
    const email = sub.customer && typeof sub.customer === "object" ? sub.customer.email : null;
    if (email && g.sample_emails.length < 3) g.sample_emails.push(email);
  }
  // pick the most common CoachIQ product id per price
  for (const g of groups.values()) {
    const entries = Object.entries(g.coachiq_product_ids);
    g.coachiq_product_id = entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : null;
    delete g.coachiq_product_ids;
  }
  return [...groups.values()];
}

// Ask Claude to map each live price → offer_price_key + tier + confidence.
async function aiMatch(targets, prices) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const system =
    "You reconcile a sports academy's messy live Stripe prices to the academy's OWN offer prices " +
    "(the plans + terms they typed into their Offers). Each target has BOTH a base_cents amount and " +
    "an allin_cents amount (base + the academy's own added fees, if any; allin equals base when no " +
    "fee was set). For EACH live price, pick the single best matching " +
    "offer_price_key (or null if none). Match the live amount_cents to EITHER the base OR the all-in " +
    "amount of a target (small rounding differences are fine), then by NAME, then by interval. " +
    "Assign a tier — ONLY two values:\n" +
    "  live   = the current standard price for that plan+term (amount matches the target closely)\n" +
    "  legacy = any older/grandfathered/odd-amount/promo variant of that plan+term (recognize old subs only)\n" +
    "RULE: for each offer_price_key, mark AT MOST ONE price as 'live' (the closest match); every other " +
    "price for that same key MUST be 'legacy'. RECENCY: prefer the price with RECENT signups " +
    "(higher recent_signups_90d / newer newest_signup) as the 'live' one when amounts are close — recent " +
    "activity means it's the current price; a price with only old signups is 'legacy'. ONE-TIME: a price " +
    "with is_one_time=true is a prepaid/up-front payment (not a recurring sub) — still match it to the " +
    "offer_price_key by amount, but ALWAYS set tier='legacy' and needs_review=true (these are prepaid " +
    "members to be aware of). If a price matches NO target BUT has members on it (sub_count>0), set " +
    "offer_price_key=null, needs_review=true, and note in reason it may be a plan missing from the offer. " +
    "Amounts are cents. Respond with ONLY a JSON array, one object per input price, no prose:\n" +
    '[{"price_id","offer_price_key"(or null),"tier":"live"|"legacy","confidence"(0-1),"needs_review"(bool),"reason"(<=18 words)}]';

  const payload = {
    offer_price_targets: targets.map(t => ({ key: t.key, label: t.label, offering: t.offering, term: t.term, base_cents: t.base_cents, allin_cents: t.allin_cents, fee_label: t.fee_label })),
    live_prices: prices.map(p => ({
      price_id: p.price_id, amount_cents: p.unit_amount, currency: p.currency,
      interval: p.interval, interval_count: p.interval_count,
      name: p.product_name || p.nickname, application: p.application,
      sub_count: p.sub_count,
      recent_signups_90d: p.recent_90d || 0,
      newest_signup: p.newest_created ? new Date(p.newest_created * 1000).toISOString().slice(0, 10) : null,
      is_one_time: p.is_one_time === true,
      prior_tier: p.prior_tier || null, prior_plan: p.prior_plan || null,
    })),
  };

  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 8192 });
}

// Term from a free-text commitment length ("12 Weeks (3 Months)" → 3_months).
//
// OPENED ADDITIVELY (Zoran's ruling, 2026-08-06): prepay lengths are adjustable,
// not locked to 3 and 6 months. Any whole month count 1-24 now yields a
// `<n>_months` key; "3 months" and "6 months" still yield the byte-identical
// keys every live academy's stored data uses, so nothing existing re-keys.
// Weeks map to whole months (12 weeks -> 3_months, exactly as before); years
// map to 12x months ("1 year" -> 12_months, which used to yield NO key and
// silently drop the rung from everything downstream). A length outside the
// range REFUSES LOUDLY instead of collapsing - the old code turned "12 months"
// into a 6_months key, which mis-billed by six months with no error anywhere.
// Mirrored in checkout.js _termKeyFromLength / offer.js termFromLength /
// fact-render.js termFromLength / client-portal.html _bbTermFromLength;
// api/_term-vocab.test.mjs fails if the copies ever disagree.
const TERM_MAX_MONTHS = 24;
function _termFromLength(s) {
  const t = String(s || "").toLowerCase();
  const m = t.match(/(\d+)\s*month/);
  if (m) {
    const n = +m[1];
    if (n >= 1 && n <= TERM_MAX_MONTHS) return `${n}_months`;
    console.warn(`[term-vocab] commitment length "${s}" reads as ${n} months, outside the 1-${TERM_MAX_MONTHS} month range this build can sell - this option gets NO price key until the length is fixed`);
    return null;
  }
  const w = t.match(/(\d+)\s*week/);
  if (w) {
    const n = +w[1];
    if (n % 4 === 0 && n / 4 >= 1 && n / 4 <= TERM_MAX_MONTHS) return `${n / 4}_months`;
    console.warn(`[term-vocab] commitment length "${s}" reads as ${n} weeks, which does not map to a whole 1-${TERM_MAX_MONTHS} month term - this option gets NO price key until the length is fixed`);
    return null;
  }
  const y = t.match(/(\d+)\s*(?:year|yr)/);
  if (y || /\bannual(?:ly)?\b|\byearly\b/.test(t)) {
    const n = (y ? +y[1] : 1) * 12;
    if (n >= 1 && n <= TERM_MAX_MONTHS) return `${n}_months`;
    console.warn(`[term-vocab] commitment length "${s}" reads as ${n} months, outside the 1-${TERM_MAX_MONTHS} month range this build can sell - this option gets NO price key until the length is fixed`);
    return null;
  }
  return null;
}

// Does ANY option of this plan actually charge the sign-up fee? Charge/waive is
// an explicit owner choice per option (Zoran: "not by default, i want to set
// it"), so an unanswered option charges nothing. Used to decide whether the fee
// is worth a catalog row at all.
// RISK 4 GATE, narrowed once Build C shipped. The danger was never "this
// academy has codes"; it was a code that could silently discount the sign-up
// fee. With applicability live, a code that declares what it applies to is
// safe: it either lists the fee key (deliberate) or it does not (excluded).
// Only an UNRESTRICTED code is still dangerous, because Stripe applies it to
// every line on the first invoice, the fee included.
//
// Answers the ARRAY of offending code strings rather than a boolean, because
// the withhold this gate produces used to live only in a console.warn - a
// server log nobody reviewing the workbook ever reads - and the report that
// replaced it (buildOfferTargetsReport) has to NAME the codes so a human can go
// fix the right one instead of hunting.
function unrestrictedCodes(offer) {
  const codes = (offer.data && offer.data.pricing && offer.data.pricing.discount_codes) || [];
  return codes
    .filter(c => c && String(c.code || "").trim() && !c.archived
      && !(Array.isArray(c.applies_to) && c.applies_to.filter(Boolean).length))
    .map(c => String(c.code).trim());
}
function hasUnrestrictedDiscountCodes(offer) {
  return unrestrictedCodes(offer).length > 0;
}

function signupFeeChargedAnywhere(off) {
  if (String(off.signup_fee_on_base || "").toLowerCase() === "charge") return true;
  return (off.commitments || []).some(c => String((c && c.signup_fee_charge) || "").toLowerCase() === "charge");
}

// Build the match TARGETS from what the academy filled out in their Offers →
// Pricing section (data.pricing.pricing_offerings). Each Membership offering →
// a monthly target + one per commitment, with base + all-in amounts.
//
// All-in = base + resolveFee (_fees.js, Build T): the academy TAX TEMPLATE
// (clients.tax_config) with per-row taxable yes/no, falling back to the legacy
// free-text "added fees" strings for academies with no template. Nothing is
// added automatically for an academy with neither.
// Exported for api/workbook.js (coordinator-relayed, 2026-08-06): its apply
// dry-run reports which targets would be minted, and importing this one
// function is the non-fork answer. Named export only; behavior unchanged.
// Target shape: { key, offer_id, offering, term, base_cents, allin_cents,
// fee_label, label } - unchanged by the term-vocabulary opening (new lengths
// just produce new `<n>_months` term values inside the same shape).
//
// buildOfferTargetsReport is the same build, answering { targets,
// withheld_signup_fees } instead of the bare array. It exists because the
// RISK 4 gate below used to withhold a plan's joining fee from the targets
// with nothing but a console.warn: the rehearsal then showed one fewer target
// than the page promised and NOTHING anywhere said why. A withhold is a
// decision about money, so it travels as DATA, named per plan and per code.
// buildOfferTargets stays as the thin wrapper so nothing downstream re-keys.
export async function buildOfferTargetsReport(clientId) {
  const [offers, taxRows] = await Promise.all([
    sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id,title,type,data`).then(r => r || []),
    sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=tax_config&limit=1`).catch(() => []),
  ]);
  const taxConfig = (Array.isArray(taxRows) && taxRows[0] && taxRows[0].tax_config) || null;
  const targets = [];
  const withheld_signup_fees = [];
  const cents = n => Math.round(n * 100);
  for (const o of offers) {
    const offerings = (o.data && o.data.pricing && o.data.pricing.pricing_offerings) || [];
    for (const off of offerings) {
      if (off.archived) continue; // archived pricing options are out of the live offer
      if (String(off.type || "").toLowerCase() !== "membership") continue; // skip Other/test junk
      const title = String(off.title || "").trim();
      if (!title) continue;
      const base = parseFloat(off.price);
      if (!isNaN(base)) {
        const fee = resolveFee({ taxConfig, taxable: off.taxable, legacyText: off.added_fees });
        targets.push({ key: `${title}|monthly`, offer_id: o.id, offering: title, term: "monthly",
          base_cents: cents(base), allin_cents: applyFee(cents(base), fee), fee_label: feeLabel(fee),
          label: `${title} · Monthly` });
      }
      for (const c of (off.commitments || [])) {
        const term = _termFromLength(c.length);
        const cb = parseFloat(c.price);
        if (term && !isNaN(cb)) {
          const fee = resolveFee({ taxConfig, taxable: c.taxable != null ? c.taxable : off.taxable, legacyText: c.added_fees });
          targets.push({ key: `${title}|${term}`, offer_id: o.id, offering: title, term,
            base_cents: cents(cb), allin_cents: applyFee(cents(cb), fee), fee_label: feeLabel(fee),
            label: `${title} · ${term.replace("_", " ")}` });
        }
      }

      // ── One-time SIGN-UP FEE (Build S) ────────────────────────────────
      // A single `<title>|signup_fee` target per plan, with its OWN taxable
      // flag. It is a real catalog row so it gets its own Stripe product,
      // which is what lets a coupon target or skip it (Build C) and what
      // checkout attaches as a one-time line at enrollment.
      //
      // It is minted only when the plan HAS a fee amount AND at least one
      // option actually charges it. Charge/waive is explicit per option
      // (nothing assumed), so a fee nobody charges never reaches Stripe -
      // that is the "dead fee" state, legal but inert.
      // RISK 4 GATE (money-model plan), narrowed by Build C. An UNRESTRICTED
      // code still discounts every line on the first invoice, the fee
      // included, so the fee stays off for those academies. A code that
      // declares its applies_to list is safe and does not block the fee.
      const feeAmt = parseFloat(off.signup_fee);
      if (!isNaN(feeAmt) && feeAmt > 0 && signupFeeChargedAnywhere(off) && hasUnrestrictedDiscountCodes(o)) {
        // The warn stays for the server log; the ENTRY below is what a human
        // actually sees, because it rides the apply response into staff review.
        console.warn(`[signup-fee] skipped for offer ${o.id} (${title}): this academy has a discount code with no "applies to" list, which would also discount the fee. Set what each code applies to first.`);
        const because = unrestrictedCodes(o);
        withheld_signup_fees.push({
          key: `${title}|signup_fee`,
          offer_id: o.id,
          offering: title,
          amount_cents: cents(feeAmt),
          because_codes: because,
          reason: `The ${title} joining fee was left out of the mint targets: discount code "${because[0]}" has no applies-to list, and an unrestricted code discounts every line on the first invoice, the fee included. Set what the code applies to, then rerun.`,
        });
      } else if (!isNaN(feeAmt) && feeAmt > 0 && signupFeeChargedAnywhere(off)) {
        const feeTax = resolveFee({ taxConfig, taxable: off.signup_fee_taxable, legacyText: null });
        targets.push({ key: `${title}|signup_fee`, offer_id: o.id, offering: title, term: "signup_fee",
          base_cents: cents(feeAmt), allin_cents: applyFee(cents(feeAmt), feeTax), fee_label: feeLabel(feeTax),
          label: `${title} · Sign-up fee (one time)` });
      }
    }
  }
  return { targets, withheld_signup_fees };
}

export async function buildOfferTargets(clientId) {
  return (await buildOfferTargetsReport(clientId)).targets;
}

async function handler(req, res) {
  // GET = light match-health read (no Stripe, no AI): the catalog's offer
  // linkage rows, used by the Offers UI to paint LIVE-on-Stripe pills.
  if (req.method === "GET") {
    try {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
      const ctx = await resolveUser(req);
      const clientId = (req.query && req.query.client_id) || ctx.clientIds[0];
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });
      const rows = await sb(
        `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
        `&offer_price_key=not.is.null&select=offer_id,offer_price_key,tier,match_status,amount_cents,interval,currency,display_name,stripe_price_id,stripe_product_id,stripe_account_id`
      ) || [];
      return res.status(200).json({ ok: true, rows });
    } catch (e) {
      return res.status((e && e.status) || 500).json({ error: (e && e.message) || String(e) });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    // ── APPLY mode: write owner-approved mappings to pricing_catalog ──
    if (body.apply === true) {
      const approvals = Array.isArray(body.approvals) ? body.approvals : [];
      if (!approvals.length) return res.status(400).json({ error: "apply=true needs approvals[]" });
      // catalog.interval speaks the term vocabulary (4_weeks/3_months/6_months,
      // same labels create-price.js writes) - the matched key's term is that
      // truth. Stripe's raw recurring unit ("week" on a billed-every-4-weeks
      // price) drops interval_count and poisons offer_prices.billing_interval
      // downstream (offers-sync -> checkout term logic), so never store it raw
      // once a key is confirmed.
      const intervalFromKey = (key) => {
        const term = String(key || "").split("|")[1];
        const t = term ? term.trim().toLowerCase() : "";
        if (t === "monthly" || t === "4_weeks") return "4_weeks";
        if (t === "3_months" || t === "6_months" || t === "one_time") return t;
        if (t === "signup_fee") return "one_time";   // Build S: the fee is a one-time price
        // Adjustable prepay lengths (2026-08-06): any bounded <n>_months term IS
        // its own interval label. 3/6 already returned above, byte-identically.
        const m = /^(\d+)_months$/.exec(t);
        if (m && +m[1] >= 1 && +m[1] <= TERM_MAX_MONTHS) return t;
        return null;
      };
      const results = [];
      for (const a of approvals) {
        if (!a.price_id) continue;
        if (String(a.price_id).startsWith("onetime-")) continue; // prepaid one-time groups aren't catalog rows
        // The UI's tier vocabulary is just Live/Legacy; the catalog's CHECK
        // constraint only allows canonical|lil_sale|legacy_match|legacy_unknown|
        // deprecated — a confirmed non-Live match is a legacy_match.
        const tier = a.tier === "legacy" ? "legacy_match" : a.tier;
        const patch = {
          offer_id: a.offer_id || body.offer_id || null,
          offer_price_key: a.offer_price_key || null,
          interval: intervalFromKey(a.offer_price_key) || undefined,
          coachiq_product_id: a.coachiq_product_id || null,
          tier: tier || undefined,
          match_status: "confirmed",
          match_source: "ai",
          match_confidence: a.confidence != null ? a.confidence : null,
          matched_at: nowIso(),
          updated_at: nowIso(),
        };
        Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
        const r = await sb(
          `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&stripe_price_id=eq.${encodeURIComponent(a.price_id)}`,
          { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }
        );
        let updated = Array.isArray(r) ? r.length : 0;
        // No catalog row for this price yet (fresh academy / sub-derived price) —
        // a PATCH alone would silently save nothing, so INSERT it. Needs the
        // price facts the client sends along (stripe_product_id NOT NULL).
        if (!updated && a.stripe_product_id && a.amount_cents != null) {
          await sb(`pricing_catalog`, {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              client_id: clientId,
              stripe_price_id: a.price_id,
              stripe_product_id: a.stripe_product_id,
              display_name: a.name || null,
              amount_cents: a.amount_cents,
              currency: a.currency || "cad",
              interval: intervalFromKey(a.offer_price_key) || a.interval || null,
              is_routable: (tier || "canonical") === "canonical",
              offer_id: a.offer_id || body.offer_id || null,
              offer_price_key: a.offer_price_key || null,
              coachiq_product_id: a.coachiq_product_id || null,
              tier: tier || "canonical",
              match_status: "confirmed",
              match_source: "ai",
              match_confidence: a.confidence != null ? a.confidence : null,
              matched_at: nowIso(),
              updated_at: nowIso(),
            }),
          });
          updated = 1;
        }
        results.push({ price_id: a.price_id, updated });
      }
      // ENFORCE one LIVE (canonical) price per offer-price: for every key we just
      // set to canonical, demote any OTHER canonical row on that key to legacy.
      const liveByKey = {};
      for (const a of approvals) { if (a.tier === "canonical" && a.offer_price_key) liveByKey[a.offer_price_key] = a.price_id; }
      for (const [key, winner] of Object.entries(liveByKey)) {
        await sb(
          `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
          `&offer_price_key=eq.${encodeURIComponent(key)}` +
          `&tier=eq.canonical&stripe_price_id=neq.${encodeURIComponent(winner)}`,
          { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tier: "legacy_unknown", updated_at: nowIso() }) }
        ).catch(() => {});
      }
      return res.status(200).json({ ok: true, applied: results });
    }

    // ── PROPOSE mode (default, review-first) ──
    // Three-outcome money gate (house rule 10): a clients read that THREW is
    // "could not ask", never "not connected" - retryable 503; the 409 below
    // stays reserved for a row that actually answered without an account.
    let clientRows;
    try {
      clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
    } catch {
      return res.status(503).json({ error: "could not verify billing setup, try again" });
    }
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    if (!client.stripe_connect_account_id) return res.status(409).json({ error: "academy not connected to Stripe" });

    // Live subs → grouped prices
    const subs = await fetchLiveSubs(client.stripe_connect_account_id);
    const prices = groupByPrice(subs);
    // Also pull one-time / prepaid purchases (not subscriptions) so prepaid members surface.
    let oneTime = [];
    try { oneTime = await fetchOneTimeGroups(client.stripe_connect_account_id); } catch (_) { oneTime = []; }
    prices.push(...oneTime);
    if (!prices.length) return res.status(200).json({ ok: true, proposals: [], note: "no active subs/prices found" });

    // Fill product names (couldn't expand them inline) from a one-shot product list.
    const productNames = await fetchProductNames(client.stripe_connect_account_id);
    for (const p of prices) { if (!p.product_name && p.product_id) p.product_name = productNames[p.product_id] || null; }

    // Existing catalog rows → prior tier/plan, SAVED matches (restored below so
    // approved work survives reopening), + so we PATCH the right rows on apply
    const catalog = await sb(`pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&select=stripe_price_id,stripe_product_id,display_name,canonical_plan,tier,interval,amount_cents,currency,offer_id,offer_price_key,coachiq_product_id,match_status`) || [];
    const byPrice = Object.fromEntries(catalog.map(c => [c.stripe_price_id, c]));
    for (const p of prices) {
      const c = byPrice[p.price_id];
      if (c) { p.prior_tier = c.tier; p.prior_plan = c.canonical_plan; }
    }

    // Saved/created prices with NO live sub yet (e.g. minted via "Create this
    // price in Stripe" before anyone subscribed) would vanish from a pool built
    // only from subs — synthesize a zero-member entry so reopening the matcher
    // still shows them on their plan.
    const inPool = new Set(prices.map(p => p.price_id));
    for (const c of catalog) {
      if (inPool.has(c.stripe_price_id)) continue;
      if (c.match_status !== "confirmed" || !c.offer_price_key) continue;
      prices.push({
        price_id: c.stripe_price_id,
        product_id: c.stripe_product_id,
        product_name: c.display_name || null,
        unit_amount: c.amount_cents,
        currency: c.currency,
        interval: c.interval,
        sub_count: 0,
        recent_90d: 0,
        newest_created: null,
        is_one_time: false,
        application: null,
        coachiq_product_id: c.coachiq_product_id || null,
        prior_tier: c.tier,
        prior_plan: c.canonical_plan,
      });
    }

    // Targets = what the academy filled out in their Offers → Pricing section.
    const targets = await buildOfferTargets(clientId);
    if (!targets.length) {
      return res.status(200).json({ ok: true, proposals: [], note: "no Membership offers filled out yet — add prices in Offers → Pricing first" });
    }
    const targetByKey = Object.fromEntries(targets.map(t => [t.key, t]));

    // A price whose catalog row is already CONFIRMED on a still-existing plan is
    // SAVED state — restore it verbatim and don't re-ask the AI about it. The AI
    // only sees genuinely undecided prices (and is skipped entirely when none).
    const isSaved = (p) => {
      const c = byPrice[p.price_id];
      return !!(c && c.match_status === "confirmed" && c.offer_price_key && targetByKey[c.offer_price_key]);
    };
    const undecided = prices.filter(p => !isSaved(p));
    const matches = undecided.length ? await aiMatch(targets, undecided) : [];
    const byId = Object.fromEntries(matches.map(m => [m.price_id, m]));

    const proposals = prices.map(p => {
      const c = byPrice[p.price_id];
      if (isSaved(p)) {
        const tgt = targetByKey[c.offer_price_key];
        return {
          price_id: p.price_id,
          product_id: p.product_id,
          name: p.product_name || p.nickname,
          amount_cents: p.unit_amount,
          currency: p.currency,
          interval: p.interval,
          sub_count: p.sub_count,
          recent_90d: p.recent_90d || 0,
          newest_signup: p.newest_created ? new Date(p.newest_created * 1000).toISOString().slice(0, 10) : null,
          is_one_time: p.is_one_time === true,
          application: p.application,
          coachiq_product_id: p.coachiq_product_id || c.coachiq_product_id || null,
          prior_tier: c.tier,
          proposed_offer_price_key: c.offer_price_key,
          offer_id: c.offer_id || tgt.offer_id,
          proposed_tier: c.tier === "canonical" ? "canonical" : "legacy",
          confidence: 1,
          needs_review: false,
          saved: true,
          reason: "saved match",
        };
      }
      const m = byId[p.price_id] || {};
      const key = m.offer_price_key || null;
      const tgt = key ? targetByKey[key] : null;
      // Flag: a price with members on it that matched no offer → likely a plan missing from the offer.
      const unmatchedWithMembers = !key && p.sub_count > 0;
      return {
        price_id: p.price_id,
        product_id: p.product_id,
        name: p.product_name || p.nickname,
        amount_cents: p.unit_amount,
        currency: p.currency,
        interval: p.interval,
        sub_count: p.sub_count,
        recent_90d: p.recent_90d || 0,
        newest_signup: p.newest_created ? new Date(p.newest_created * 1000).toISOString().slice(0, 10) : null,
        is_one_time: p.is_one_time === true,
        application: p.application,
        coachiq_product_id: p.coachiq_product_id,   // harvested from metadata
        prior_tier: p.prior_tier || null,
        proposed_offer_price_key: key,
        offer_id: tgt ? tgt.offer_id : null,
        proposed_tier: m.tier === "live" ? "canonical" : (m.tier ? "legacy_unknown" : null), // live→canonical, anything else→legacy
        confidence: m.confidence != null ? m.confidence : null,
        needs_review: unmatchedWithMembers || m.needs_review === true || (m.confidence != null && m.confidence < 0.75),
        reason: unmatchedWithMembers ? `${p.sub_count} member(s) here but no matching offer — add it to the offer?` : (m.reason || null),
      };
    }).sort((a, b) => (a.proposed_offer_price_key || "~").localeCompare(b.proposed_offer_price_key || "~") || (b.amount_cents - a.amount_cents));

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      counts: { live_prices: prices.length, targets: targets.length, needs_review: proposals.filter(p => p.needs_review).length },
      targets: targets.map(t => ({ key: t.key, offer_id: t.offer_id, offering: t.offering, term: t.term, label: t.label, base_cents: t.base_cents, allin_cents: t.allin_cents, fee_label: t.fee_label })),
      proposals,
    });
  } catch (e) {
    // Always return a readable string — a thrown plain object would otherwise
    // serialize to "[object Object]" on the client.
    let msg = e && e.message;
    if (!msg) { try { msg = typeof e === "string" ? e : JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("match-prices error:", msg, e && e.stack);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
