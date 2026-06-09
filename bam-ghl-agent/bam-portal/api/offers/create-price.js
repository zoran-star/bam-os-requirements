import { withSentryApiRoute } from "../_sentry.js";
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
const HST = 1.13; // 13% Ontario HST — mirrors buildOfferTargets() in match-prices.js

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

// Map an offer term ("monthly"/"4_weeks"/"3_months"/"6_months") → the catalog
// interval label we store, plus the Stripe recurring shape (checkout.js intervalFor).
function termToInterval(term) {
  const t = String(term || "").toLowerCase();
  if (t === "3_months") return { interval: "3_months", recurring: { interval: "month", interval_count: 3 } };
  if (t === "6_months") return { interval: "6_months", recurring: { interval: "month", interval_count: 6 } };
  return { interval: "4_weeks", recurring: { interval: "week", interval_count: 4 } }; // monthly / 4_weeks
}

function money(cents, currency) {
  const c = String(currency || "cad").toUpperCase();
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
}
function cadenceLabel(recurring) {
  const n = recurring.interval_count, u = recurring.interval;
  if (u === "week" && n === 4) return "every 4 weeks";
  return `every ${n > 1 ? n + " " : ""}${u}${n > 1 ? "s" : ""}`;
}

// ── PROPOSE: ask Claude for a plain-language recommendation per unmatched target ──
async function aiRecommend(targets) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const system =
    "A sports academy typed offer prices (plan × term) into their Offers, but some have NO matching " +
    "Stripe price yet. For EACH target, recommend the Stripe price to create. Each target has a " +
    "base_cents (pre-tax) and allin_cents (base + 13% HST). Academies usually CHARGE THE ALL-IN amount " +
    "(tax included). Pick unit_amount_cents = allin_cents unless the label clearly implies tax-exclusive. " +
    "The recurring shape is fixed by the term: monthly/4_weeks → {interval:'week',interval_count:4}; " +
    "3_months → {interval:'month',interval_count:3}; 6_months → {interval:'month',interval_count:6}. " +
    "Write a SHORT plain_explanation a non-technical owner understands, e.g. " +
    "'$226 every 4 weeks = your $200 + 13% HST'. Set matches_offer=true when the amount equals base or " +
    "all-in of the target; offer_impact_note = one short line on what creating this does (e.g. 'new " +
    "signups on the Steady plan will be billed this'). Currency is CAD unless told otherwise. " +
    "Respond with ONLY a JSON array, one object per input target, same order, no prose:\n" +
    '[{"key","recurring":{"interval","interval_count"},"unit_amount_cents","currency","plain_explanation","matches_offer"(bool),"offer_impact_note"}]';

  const payload = {
    targets: targets.map(t => ({
      key: t.key, offering: t.offering, term: t.term,
      base_cents: t.base_cents, allin_cents: t.allin_cents, label: t.label,
    })),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3072, system,
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

// Deterministic fallback recommendation (also used to harden/normalize the AI output).
function fallbackRecommend(t) {
  const iv = termToInterval(t.term);
  const amount = t.allin_cents || t.base_cents || 0;
  const base = t.base_cents || Math.round(amount / HST);
  const cadence = cadenceLabel(iv.recurring);
  const planLabel = (t.offering || String(t.key || "").split("|")[0] || "this plan").trim();
  let plain = `${money(amount, "cad")} ${cadence}`;
  if (base && Math.abs(Math.round(base * HST) - amount) <= 2 && base !== amount) {
    plain += ` = your ${money(base, "cad")} + 13% HST`;
  }
  return {
    key: t.key,
    recurring: iv.recurring,
    unit_amount_cents: amount,
    currency: "cad",
    plain_explanation: plain,
    matches_offer: true,
    offer_impact_note: `New signups on ${planLabel} (${String(t.term || "").replace("_", " ")}) will be billed this.`,
  };
}

async function runPropose(req, res, ctx, body, clientId) {
  const targets = Array.isArray(body.targets) ? body.targets : [];
  if (!targets.length) return res.status(400).json({ error: "targets[] required" });

  let aiOut = [];
  try { aiOut = await aiRecommend(targets); } catch (_) { aiOut = []; }
  const byKey = Object.fromEntries((Array.isArray(aiOut) ? aiOut : []).map(r => [String(r.key), r]));

  const recommendations = targets.map(t => {
    const fb = fallbackRecommend(t);
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
      currency: (a.currency || fb.currency || "cad").toLowerCase(),
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

  const created = [];
  for (const c of creations) {
    const key = c.key || null;
    const amount = Math.round(Number(c.unit_amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) { created.push({ key, error: "invalid unit_amount_cents" }); continue; }
    const currency = String(c.currency || "cad").toLowerCase();
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
    const row = {
      client_id: clientId,
      stripe_price_id: price.id,
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

    created.push({ key, stripe_price_id: price.id, stripe_product_id: price.product || null });
  }

  return res.status(200).json({ ok: true, mode: "apply", created });
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
    return res.status(400).json({ error: "unknown mode (expected 'propose' or 'apply')" });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
