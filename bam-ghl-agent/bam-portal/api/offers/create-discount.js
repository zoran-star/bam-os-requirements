import { withSentryApiRoute } from "../_sentry.js";
import { validateCouponDef, stripeCouponBody, stripePromoBody, couponFromPromo } from "../_coupon-guardrails.js";
export const maxDuration = 60; // Stripe coupon + promo-code creation per row
// Vercel Serverless Function — Price Match → create discount codes in Stripe.
//
// The offer's Pricing section holds a discount_codes list (code + kind +
// value). This endpoint mirrors each one into Stripe as a Coupon (the discount
// math) + a Promotion Code (the customer-facing code string) on the academy's
// CONNECTED account, so the funnel/checkout can apply them.
//
// GET  /api/offers/create-discount?client_id=…
//   → { codes:[{ code, exists, promotion_code_id, coupon_id }] } — which of the
//     academy's promotion codes already live in Stripe (case-insensitive).
//
// POST /api/offers/create-discount   body: { client_id, codes:[{code,kind,value}] }
//   kind ∈ 'Percent off' | 'Dollar off'.  Idempotent: skips a code that already
//   exists as an active promotion code. Creates Coupon(duration=forever) +
//   Promotion Code(code). → { results:[{ code, created, promotion_code_id, error? }] }
//
// Auth: resolveUser() — staff (any academy) or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

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
    ? new URLSearchParams(Object.entries(body).reduce((a, [k, v]) => {
        if (v !== undefined && v !== null) a[k] = String(v);
        return a;
      }, {})).toString()
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

const normCode = (s) => String(s || "").trim().toUpperCase();
const isPercent = (kind) => /percent|%/i.test(String(kind || ""));

// All active promotion codes on the connected account, keyed by UPPER code.
async function liveCodes(stripeAccount) {
  const map = new Map();
  let startingAfter = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "100", active: "true" });
    // Expand the coupon (nested under promotion.coupon on this API version) so we
    // can read its %/$ + duration for the manager pills.
    qs.append("expand[]", "data.promotion.coupon");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeFetch(`/promotion_codes?${qs.toString()}`, { stripeAccount });
    for (const pc of (r.data || [])) map.set(normCode(pc.code), pc);
    if (!r.has_more || !(r.data || []).length) break;
    startingAfter = r.data[r.data.length - 1].id;
  }
  return map;
}

async function clientAccount(clientId) {
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
  const acct = Array.isArray(rows) && rows[0] && rows[0].stripe_connect_account_id;
  if (!acct) throw Object.assign(new Error("academy not connected to Stripe"), { status: 409 });
  return acct;
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");
    const ctx = await resolveUser(req);

    if (req.method === "GET") {
      const clientId = (req.query && req.query.client_id) || ctx.clientIds[0];
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });
      const acct = await clientAccount(clientId);
      const live = await liveCodes(acct);
      const codes = [...live.values()].map(pc => {
        const cp = couponFromPromo(pc);
        return {
          code: pc.code,
          exists: true,
          active: pc.active !== false && cp.valid !== false,
          promotion_code_id: pc.id,
          coupon_id: cp.id || null,
          kind: cp.percent_off != null ? "Percent off" : "Dollar off",
          value: cp.percent_off != null ? cp.percent_off : (cp.amount_off != null ? cp.amount_off / 100 : null),
          duration: cp.duration || null,
          duration_months: cp.duration_in_months || null,
          max_redemptions: pc.max_redemptions || null,
          times_redeemed: pc.times_redeemed || 0,
          expires_at: pc.expires_at || null,
          once_per_customer: !!(pc.restrictions && pc.restrictions.first_time_transaction),
        };
      });
      return res.status(200).json({ ok: true, codes });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    // Deactivate a live promotion code (manager kill switch). Existing members
    // who already redeemed it keep their discount - this only stops NEW uses.
    if (body.deactivate) {
      const acctD = await clientAccount(clientId);
      const pc = await stripeFetch(`/promotion_codes/${String(body.deactivate)}`, {
        method: "POST", stripeAccount: acctD, body: { active: "false" },
      });
      return res.status(200).json({ ok: true, deactivated: pc.id, active: pc.active });
    }

    const codes = Array.isArray(body.codes) ? body.codes : [];
    if (!codes.length) return res.status(400).json({ error: "codes[] required" });
    const acct = await clientAccount(clientId);
    const live = await liveCodes(acct);

    const results = [];
    for (const c of codes) {
      const code = normCode(c.code);
      if (!code) { results.push({ code: c.code, error: "empty code" }); continue; }
      if (live.has(code)) {
        const pc = live.get(code);
        results.push({ code, created: false, exists: true, promotion_code_id: pc.id });
        continue;
      }
      // Guardrails: rejects 0/100% and bad shapes before anything hits Stripe.
      const check = validateCouponDef(c);
      if (!check.ok) { results.push({ code, error: check.error }); continue; }
      const def = check.coupon;
      try {
        // Coupon = the discount math (percent/dollar + how long it lasts).
        const coupon = await stripeFetch(`/coupons`, {
          method: "POST", stripeAccount: acct,
          idempotencyKey: `sorter-coupon-${clientId}-${code}-${def.duration}-${def.duration_months || 0}-${isPercent(c.kind) ? "p" : "d"}-${def.value}`.slice(0, 200),
          body: stripeCouponBody(def),
        });
        // Promotion Code = the customer-facing string + limits (expiry, max uses,
        // once-per-customer) pointing at the coupon.
        const pc = await stripeFetch(`/promotion_codes`, {
          method: "POST", stripeAccount: acct,
          idempotencyKey: `sorter-promo-${clientId}-${code}`.slice(0, 200),
          body: stripePromoBody(def, coupon.id),
        });
        results.push({ code, created: true, promotion_code_id: pc.id, coupon_id: coupon.id });
      } catch (e) {
        results.push({ code, error: e.message || String(e) });
      }
    }
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
