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
    qs.append("expand[]", "data.items.data.price.product");
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

const ACTIVEISH = new Set(["active", "trialing", "past_due", "paused", "unpaid"]);

// Group subs by their (first item's) price; collect signals per price.
function groupByPrice(subs) {
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
        coachiq_product_ids: {},   // metadata.productId → count
        sample_emails: [],
      });
    }
    const g = groups.get(key);
    g.sub_count++;
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
    "You reconcile a sports academy's messy live Stripe prices to a clean set of OFFER-PRICES " +
    "(plan × term). For EACH live price, choose the single best matching offer_price_key from the " +
    "provided targets (or null if it matches none), and a tier:\n" +
    "  canonical  = the standard current price for that offer-price (amount ≈ target amount, on-name)\n" +
    "  legacy     = a grandfathered/old/odd-amount variant of an offer-price (recognize old subs only)\n" +
    "  deprecated = clearly retired/old plan name\n" +
    "  sale       = a promo/discounted variant\n" +
    "Match primarily on AMOUNT, then product/price NAME, then BILLING INTERVAL, then the creator " +
    "(application id). Amounts are in cents. Be conservative: if unsure, set needs_review=true and " +
    "lower confidence. Respond with ONLY a JSON array, one object per input price, no prose:\n" +
    '[{"price_id","offer_price_key"(or null),"tier","confidence"(0-1),"needs_review"(bool),"reason"(<=18 words)}]';

  const payload = {
    offer_price_targets: targets, // [{ key, plan, interval, canonical_amount_cents, label }]
    live_prices: prices.map(p => ({
      price_id: p.price_id, amount_cents: p.unit_amount, currency: p.currency,
      interval: p.interval, interval_count: p.interval_count,
      name: p.product_name || p.nickname, application: p.application,
      sub_count: p.sub_count, prior_tier: p.prior_tier || null, prior_plan: p.prior_plan || null,
    })),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4096, system,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("AI did not return a JSON array");
  return JSON.parse(text.slice(start, end + 1));
}

export default async function handler(req, res) {
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
      const results = [];
      for (const a of approvals) {
        if (!a.price_id) continue;
        const patch = {
          offer_id: body.offer_id || null,
          offer_price_key: a.offer_price_key || null,
          coachiq_product_id: a.coachiq_product_id || null,
          tier: a.tier || undefined,
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
        results.push({ price_id: a.price_id, updated: Array.isArray(r) ? r.length : 0 });
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
    if (!prices.length) return res.status(200).json({ ok: true, proposals: [], note: "no active subs/prices found" });

    // Existing catalog rows → prior tier/plan + so we PATCH the right rows on apply
    const catalog = await sb(`pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&select=stripe_price_id,canonical_plan,tier,interval,amount_cents`) || [];
    const byPrice = Object.fromEntries(catalog.map(c => [c.stripe_price_id, c]));
    for (const p of prices) {
      const c = byPrice[p.price_id];
      if (c) { p.prior_tier = c.tier; p.prior_plan = c.canonical_plan; }
    }

    // Offer-price targets = canonical rows (plan × term) for this academy
    const canon = catalog.filter(c => c.tier === "canonical");
    const targets = canon.map(c => ({
      key: `${c.canonical_plan}|${c.interval}`,
      plan: c.canonical_plan, interval: c.interval,
      canonical_amount_cents: c.amount_cents,
      label: `${c.canonical_plan} · ${c.interval}`,
    }));

    const matches = await aiMatch(targets, prices);
    const byId = Object.fromEntries(matches.map(m => [m.price_id, m]));

    const proposals = prices.map(p => {
      const m = byId[p.price_id] || {};
      return {
        price_id: p.price_id,
        product_id: p.product_id,
        name: p.product_name || p.nickname,
        amount_cents: p.unit_amount,
        currency: p.currency,
        interval: p.interval,
        sub_count: p.sub_count,
        application: p.application,
        coachiq_product_id: p.coachiq_product_id,   // harvested from metadata
        prior_tier: p.prior_tier || null,
        proposed_offer_price_key: m.offer_price_key || null,
        proposed_tier: m.tier || null,
        confidence: m.confidence != null ? m.confidence : null,
        needs_review: m.needs_review === true || (m.confidence != null && m.confidence < 0.75),
        reason: m.reason || null,
      };
    }).sort((a, b) => (a.proposed_offer_price_key || "~").localeCompare(b.proposed_offer_price_key || "~") || (b.amount_cents - a.amount_cents));

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      counts: { live_prices: prices.length, targets: targets.length, needs_review: proposals.filter(p => p.needs_review).length },
      proposals,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}
