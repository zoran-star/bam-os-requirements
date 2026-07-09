import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
import { parseFee, applyFee, feeLabel } from "../_fees.js";
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
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
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
async function fetchProductNames(stripeAccount) {
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
function _termFromLength(s) {
  const t = String(s || "").toLowerCase();
  if (/3\s*month/.test(t) || /\b12\s*week/.test(t)) return "3_months";
  if (/6\s*month/.test(t) || /\b24\s*week/.test(t)) return "6_months";
  return null;
}

// Build the match TARGETS from what the academy filled out in their Offers →
// Pricing section (data.pricing.pricing_offerings). Each Membership offering →
// a monthly target + one per commitment, with base + all-in amounts. All-in =
// base + the academy's own "added fees" (per offering / per commitment); no fee
// typed = all-in equals base. Nothing is added automatically.
async function buildOfferTargets(clientId) {
  const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id,title,type,data`) || [];
  const targets = [];
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
        const fee = parseFee(off.added_fees);
        targets.push({ key: `${title}|monthly`, offer_id: o.id, offering: title, term: "monthly",
          base_cents: cents(base), allin_cents: applyFee(cents(base), fee), fee_label: feeLabel(fee),
          label: `${title} · Monthly` });
      }
      for (const c of (off.commitments || [])) {
        const term = _termFromLength(c.length);
        const cb = parseFloat(c.price);
        if (term && !isNaN(cb)) {
          const fee = parseFee(c.added_fees);
          targets.push({ key: `${title}|${term}`, offer_id: o.id, offering: title, term,
            base_cents: cents(cb), allin_cents: applyFee(cents(cb), fee), fee_label: feeLabel(fee),
            label: `${title} · ${term.replace("_", " ")}` });
        }
      }
    }
  }
  return targets;
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
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
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
