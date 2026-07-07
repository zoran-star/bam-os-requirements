import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
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
async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const encoded = body
    ? new URLSearchParams(
        Object.entries(body).reduce((acc, [k, v]) => {
          if (v !== undefined && v !== null) acc[k] = String(v);
          return acc;
        }, {})
      ).toString()
    : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${res.status}`);
    err.stripeStatus = res.status;
    throw err;
  }
  return json;
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

// Map an offer term ("monthly"/"4_weeks"/"3_months"/"6_months") → the catalog
// interval label we store, plus the Stripe recurring shape (checkout.js intervalFor).
function termToInterval(term) {
  const t = String(term || "").toLowerCase();
  if (t === "3_months") return { interval: "3_months", recurring: { interval: "month", interval_count: 3 } };
  if (t === "6_months") return { interval: "6_months", recurring: { interval: "month", interval_count: 6 } };
  return { interval: "4_weeks", recurring: { interval: "week", interval_count: 4 } }; // monthly / 4_weeks
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
    "exact price the academy typed. CHARGE THAT price: pick unit_amount_cents = base_cents. Do NOT add " +
    "tax, HST, or any markup automatically - tax/fees are configured separately by the academy in their " +
    "offer's added-fees setting, not here. " +
    "The recurring shape is fixed by the term: monthly/4_weeks → {interval:'week',interval_count:4}; " +
    "3_months → {interval:'month',interval_count:3}; 6_months → {interval:'month',interval_count:6}. " +
    "Write a SHORT plain_explanation a non-technical owner understands, e.g. '$200 every 4 weeks'. " +
    "Set matches_offer=true when unit_amount_cents equals the target's base_cents; offer_impact_note = " +
    "one short line on what creating this does (e.g. 'new signups on the Steady plan will be billed this'). " +
    `Currency is ${cur} (the academy's Stripe account currency) - use it for every recommendation. ` +
    "Respond with ONLY a JSON array, one object per input target, same order, no prose:\n" +
    '[{"key","recurring":{"interval","interval_count"},"unit_amount_cents","currency","plain_explanation","matches_offer"(bool),"offer_impact_note"}]';

  const payload = {
    targets: targets.map(t => ({
      key: t.key, offering: t.offering, term: t.term,
      base_cents: t.base_cents, allin_cents: t.allin_cents, label: t.label,
    })),
  };

  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 4096 });
}

// Deterministic fallback recommendation (also used to harden/normalize the AI output).
// Charges the BASE (pre-tax) price the academy typed - no automatic HST/markup.
function fallbackRecommend(t, currency) {
  const iv = termToInterval(t.term);
  const amount = t.base_cents || t.allin_cents || 0;
  const cadence = cadenceLabel(iv.recurring);
  const planLabel = (t.offering || String(t.key || "").split("|")[0] || "this plan").trim();
  return {
    key: t.key,
    recurring: iv.recurring,
    unit_amount_cents: amount,
    currency,
    plain_explanation: `${money(amount, currency)} ${cadence}`,
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

  const recommendations = targets.map(t => {
    const fb = fallbackRecommend(t, currency);
    const a = byKey[t.key];
    if (!a) return fb;
    const recurring = (a.recurring && a.recurring.interval) ? a.recurring : fb.recurring;
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
      plain_explanation: a.plain_explanation || fb.plain_explanation,
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

  const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id&limit=1`);
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
    const recurring = (c.recurring && c.recurring.interval)
      ? c.recurring
      : termToInterval(c.term).recurring;
    // Best-effort catalog interval label from the recurring shape.
    let interval = "4_weeks";
    if (recurring.interval === "month" && recurring.interval_count === 3) interval = "3_months";
    else if (recurring.interval === "month" && recurring.interval_count === 6) interval = "6_months";
    const priceName = (c.product_name || (key ? String(key).replace("|", " · ") : "FullControl price")).toString();

    // Create the recurring price with an INLINE product on the connected account.
    // Idempotent per (client, key, amount) so a double-click can't mint duplicates.
    const price = await stripeFetch(`/prices`, {
      method: "POST", stripeAccount,
      idempotencyKey: `sorter-price-${clientId}-${key || "nokey"}-${amount}`.slice(0, 200),
      body: {
        currency,
        unit_amount: amount,
        "recurring[interval]": recurring.interval,
        "recurring[interval_count]": recurring.interval_count,
        "product_data[name]": priceName,
        "metadata[source]": "fullcontrol-sorter",
        "metadata[offer_price_key]": key || undefined,
      },
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

    created.push({ key, stripe_price_id: price.id, stripe_product_id: price.product || null, livemode: price.livemode === true, account: stripeAccount || null });
  }

  return res.status(200).json({ ok: true, mode: "apply", created });
}

// ── SEARCH: list the academy's existing Stripe prices to match against ──
async function runSearch(req, res, ctx, body, clientId) {
  if (!stripeKey()) throw new Error("Stripe secret key not configured");
  const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id&limit=1`);
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
