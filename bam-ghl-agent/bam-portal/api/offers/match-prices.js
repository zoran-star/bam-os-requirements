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
    "You reconcile a sports academy's messy live Stripe prices to the academy's OWN offer prices " +
    "(the plans + terms they typed into their Offers). Each target has BOTH a base_cents amount and " +
    "an allin_cents amount (base + 13% tax). For EACH live price, pick the single best matching " +
    "offer_price_key (or null if none). Match the live amount_cents to EITHER the base OR the all-in " +
    "amount of a target (small rounding differences are fine), then by NAME, then by interval. " +
    "Assign a tier:\n" +
    "  canonical  = amount matches a target closely (the standard current price for that plan+term)\n" +
    "  legacy     = a grandfathered/odd-amount variant of a target (recognize old subs only)\n" +
    "  deprecated = clearly retired/old plan name\n" +
    "  sale       = a promo/discounted variant\n" +
    "If a live price matches NO target BUT has members on it (sub_count>0), set offer_price_key=null, " +
    "needs_review=true, and note in reason it may be a plan missing from the offer. Amounts are cents. " +
    "Respond with ONLY a JSON array, one object per input price, no prose:\n" +
    '[{"price_id","offer_price_key"(or null),"tier","confidence"(0-1),"needs_review"(bool),"reason"(<=18 words)}]';

  const payload = {
    offer_price_targets: targets.map(t => ({ key: t.key, label: t.label, offering: t.offering, term: t.term, base_cents: t.base_cents, allin_cents: t.allin_cents })),
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

// Term from a free-text commitment length ("12 Weeks (3 Months)" → 3_months).
function _termFromLength(s) {
  const t = String(s || "").toLowerCase();
  if (/3\s*month/.test(t) || /\b12\s*week/.test(t)) return "3_months";
  if (/6\s*month/.test(t) || /\b24\s*week/.test(t)) return "6_months";
  return null;
}

// Build the match TARGETS from what the academy filled out in their Offers →
// Pricing section (data.pricing.pricing_offerings). Each Membership offering →
// a monthly target + one per commitment, with base + all-in (×1.13) amounts.
async function buildOfferTargets(clientId) {
  const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id,title,type,data`) || [];
  const targets = [];
  const HST = 1.13;
  const cents = n => Math.round(n * 100);
  for (const o of offers) {
    const offerings = (o.data && o.data.pricing && o.data.pricing.pricing_offerings) || [];
    for (const off of offerings) {
      if (String(off.type || "").toLowerCase() !== "membership") continue; // skip Other/test junk
      const title = String(off.title || "").trim();
      if (!title) continue;
      const base = parseFloat(off.price);
      if (!isNaN(base)) {
        targets.push({ key: `${title}|monthly`, offer_id: o.id, offering: title, term: "monthly",
          base_cents: cents(base), allin_cents: cents(base * HST), label: `${title} · Monthly` });
      }
      for (const c of (off.commitments || [])) {
        const term = _termFromLength(c.length);
        const cb = parseFloat(c.price);
        if (term && !isNaN(cb)) {
          targets.push({ key: `${title}|${term}`, offer_id: o.id, offering: title, term,
            base_cents: cents(cb), allin_cents: cents(cb * HST), label: `${title} · ${term.replace("_", " ")}` });
        }
      }
    }
  }
  return targets;
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
          offer_id: a.offer_id || body.offer_id || null,
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

    // Fill product names (couldn't expand them inline) from a one-shot product list.
    const productNames = await fetchProductNames(client.stripe_connect_account_id);
    for (const p of prices) { if (!p.product_name && p.product_id) p.product_name = productNames[p.product_id] || null; }

    // Existing catalog rows → prior tier/plan + so we PATCH the right rows on apply
    const catalog = await sb(`pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&select=stripe_price_id,canonical_plan,tier,interval,amount_cents`) || [];
    const byPrice = Object.fromEntries(catalog.map(c => [c.stripe_price_id, c]));
    for (const p of prices) {
      const c = byPrice[p.price_id];
      if (c) { p.prior_tier = c.tier; p.prior_plan = c.canonical_plan; }
    }

    // Targets = what the academy filled out in their Offers → Pricing section.
    const targets = await buildOfferTargets(clientId);
    if (!targets.length) {
      return res.status(200).json({ ok: true, proposals: [], note: "no Membership offers filled out yet — add prices in Offers → Pricing first" });
    }
    const targetByKey = Object.fromEntries(targets.map(t => [t.key, t]));

    const matches = await aiMatch(targets, prices);
    const byId = Object.fromEntries(matches.map(m => [m.price_id, m]));

    const proposals = prices.map(p => {
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
        application: p.application,
        coachiq_product_id: p.coachiq_product_id,   // harvested from metadata
        prior_tier: p.prior_tier || null,
        proposed_offer_price_key: key,
        offer_id: tgt ? tgt.offer_id : null,
        proposed_tier: m.tier || null,
        confidence: m.confidence != null ? m.confidence : null,
        needs_review: unmatchedWithMembers || m.needs_review === true || (m.confidence != null && m.confidence < 0.75),
        reason: unmatchedWithMembers ? `${p.sub_count} member(s) here but no matching offer — add it to the offer?` : (m.reason || null),
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
