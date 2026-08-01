import { withSentryApiRoute } from "../_sentry.js";
import { validateCouponDef, stripeCouponBody, stripePromoBody, couponFromPromo, couponAppliesToKeys } from "../_coupon-guardrails.js";
import { stripeFetch as transportStripeFetch } from "../_stripe-transport.js";
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
  // Delegates to THE seam (api/_stripe-transport.js): platform key + Stripe-Account
  // header for Connect academies, the academy's own key when a direct row exists.
  return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey });
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

// Build C: the owner's checked price keys -> the Stripe PRODUCT ids a coupon
// should be restricted to. Scoped to LIVE prices only (Zoran 2026-07-24):
// active + routable in the portal AND carrying a Stripe product. A key that no
// longer resolves is dropped, so a code can never be attached to something
// that cannot be sold.
//
// Returns null when the code is unrestricted (applies to everything), which is
// how every pre-Build-C code behaves.
//
// CAVEAT, verified live: prices can SHARE a product (DETAIL Miami has 9 active
// prices on 6 products). Stripe restricts by product, so ticking one price of a
// shared product also covers its siblings. The checklist groups those into one
// line so the UI never promises finer control than Stripe can enforce.
async function productIdsForKeys(clientId, keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const rows = await sb(
    `offer_prices?tenant_id=eq.${encodeURIComponent(clientId)}` +
    `&is_active=eq.true&is_routable=eq.true&select=source_offer_price_key,stripe_product_id`
  ).catch(() => []);
  const byKey = new Map((Array.isArray(rows) ? rows : [])
    .filter(r => r && r.stripe_product_id)
    .map(r => [String(r.source_offer_price_key || ""), r.stripe_product_id]));
  const ids = keys.map(k => byKey.get(String(k))).filter(Boolean);
  // SAFE FAILURE: the owner restricted this code, but none of the ticked keys
  // resolve to a live sellable price. Returning null here would mean
  // "applies to everything", the exact opposite of what they asked for, so the
  // caller refuses to create the code instead.
  if (!ids.length) return { error: "none of the selected prices are live yet - run Price Match first, or untick them to let the code apply to everything" };
  return [...new Set(ids)];
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
        // Build C: a live code already exists. Its coupon's applies_to is
        // IMMUTABLE - Stripe only lets you edit a coupon's name/metadata
        // ("other coupon details are, by design, not editable"), so the
        // portal's applies_to list can never reach Stripe by updating.
        // Compare what Stripe actually enforces against what the owner wants:
        //   same        -> nothing to do
        //   different   -> report needs_reissue, or perform the swap when the
        //                  caller explicitly asked for it
        const wantKeys = couponAppliesToKeys(c);
        const wantResolved = await productIdsForKeys(clientId, wantKeys);
        if (wantResolved && wantResolved.error) { results.push({ code, error: wantResolved.error }); continue; }
        const want = [...(wantResolved || [])].sort();
        const liveCoupon = couponFromPromo(pc) || {};
        const haveList = (liveCoupon.applies_to && liveCoupon.applies_to.products) || [];
        const have = [...haveList].sort();
        const same = want.length === have.length && want.every((x, i) => x === have[i]);
        if (same) {
          results.push({ code, created: false, exists: true, promotion_code_id: pc.id, applicability: "in_sync" });
          continue;
        }
        if (!body.reissue) {
          results.push({
            code, created: false, exists: true, promotion_code_id: pc.id,
            needs_reissue: true,
            live_products: have.length, wanted_products: want.length,
            message: want.length
              ? "This code is live in Stripe without the 'applies to' limits you set. Stripe cannot edit them on an existing code, so it has to be re-issued. Parents already subscribed keep the discount they signed up with."
              : "This code is limited in Stripe but your 'applies to' list is now empty (applies to everything). Re-issue to match.",
          });
          continue;
        }
        // ── Explicit re-issue ────────────────────────────────────────────
        // New coupon carrying the wanted restriction, then swap the customer
        // facing string onto it: deactivate the old promotion code and mint a
        // new one with the same code. Deactivating only stops FUTURE
        // redemptions - "it doesn't remove the discount from any subscription
        // or invoice that already has it" - so live members are untouched.
        const rcheck = validateCouponDef(c);
        if (!rcheck.ok) { results.push({ code, error: rcheck.error }); continue; }
        try {
          const newCoupon = await stripeFetch(`/coupons`, {
            method: "POST", stripeAccount: acct,
            idempotencyKey: `sorter-coupon-reissue-${clientId}-${code}-${want.join(",").slice(0, 60)}`.slice(0, 200),
            body: stripeCouponBody(rcheck.coupon, want.length ? want : null),
          });
          await stripeFetch(`/promotion_codes/${pc.id}`, {
            method: "POST", stripeAccount: acct, body: { active: "false" },
          });
          const newPc = await stripeFetch(`/promotion_codes`, {
            method: "POST", stripeAccount: acct,
            idempotencyKey: `sorter-promo-reissue-${clientId}-${code}-${newCoupon.id}`.slice(0, 200),
            body: stripePromoBody(rcheck.coupon, newCoupon.id),
          });
          results.push({
            code, created: true, reissued: true,
            promotion_code_id: newPc.id, coupon_id: newCoupon.id,
            replaced_promotion_code_id: pc.id,
            applies_to_products: want.length || null,
          });
        } catch (e) {
          results.push({ code, error: `re-issue failed: ${e.message || String(e)}` });
        }
        continue;
      }
      // Guardrails: rejects 0/100% and bad shapes before anything hits Stripe.
      const check = validateCouponDef(c);
      if (!check.ok) { results.push({ code, error: check.error }); continue; }
      const def = check.coupon;
      try {
        // Coupon = the discount math (percent/dollar + how long it lasts).
        // Build C: restrict to the products behind the owner's checked prices.
        // The idempotency key includes an applicability fingerprint so changing
        // the checklist mints a NEW coupon instead of silently reusing the old
        // one (Stripe coupons are immutable - risk 2 of the money-model plan).
        const applyKeys = couponAppliesToKeys(c);
        const resolved = await productIdsForKeys(clientId, applyKeys);
        if (resolved && resolved.error) { results.push({ code, error: resolved.error }); continue; }
        const productIds = resolved;
        const applyTag = productIds ? productIds.slice().sort().join(",").slice(0, 40) : "all";
        const coupon = await stripeFetch(`/coupons`, {
          method: "POST", stripeAccount: acct,
          idempotencyKey: `sorter-coupon-${clientId}-${code}-${def.duration}-${def.duration_months || 0}-${isPercent(c.kind) ? "p" : "d"}-${def.value}-${applyTag}`.slice(0, 200),
          body: stripeCouponBody(def, productIds),
        });
        // Promotion Code = the customer-facing string + limits (expiry, max uses,
        // once-per-customer) pointing at the coupon.
        const pc = await stripeFetch(`/promotion_codes`, {
          method: "POST", stripeAccount: acct,
          idempotencyKey: `sorter-promo-${clientId}-${code}`.slice(0, 200),
          body: stripePromoBody(def, coupon.id),
        });
        results.push({ code, created: true, promotion_code_id: pc.id, coupon_id: coupon.id, applies_to_products: productIds ? productIds.length : null });
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
