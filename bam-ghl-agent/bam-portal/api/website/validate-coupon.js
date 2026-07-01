// Public endpoint — validates a coupon code the parent types at checkout and
// returns the discounted price to preview. CORS-gated by clients.allowed_domains,
// same as the other api/website/* endpoints.
//
//   GET /api/website/validate-coupon?client_id=<uuid>&offer_id=<uuid?>
//                                   &offer_price_key=<Title|term>&code=<CODE>
//     → { valid:true,  code, label, discount_cents, discounted_cents, amount_cents }
//     → { valid:false, reason }
//
// The plan price is looked up server-side from pricing_catalog (never trusted
// from the client). The coupon math + limits come from the live Stripe promotion
// code on the academy's connected account. The $1 floor / 1-99% guardrails run
// through the shared _coupon-guardrails module so checkout can't be tricked into
// a negative or $0 charge. Stripe remains the final gate at payment time.

import { withSentryApiRoute } from "../_sentry.js";
import { applyDiscountToCents, normCode } from "../_coupon-guardrails.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const STRIPE_API = "https://api.stripe.com/v1";

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);
let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

function stripeKey() {
  return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
async function stripeFetch(path, stripeAccount) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const r = await fetch(`${STRIPE_API}${path}`, { headers });
  const txt = await r.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error(json?.error?.message || `Stripe ${r.status}`);
  return json;
}

// Routable catalog row for one offer_price_key (prefer canonical tier).
function pickRoutable(rows) {
  const routable = (rows || []).filter((r) => r.is_routable);
  if (!routable.length) return null;
  return routable.find((r) => r.tier === "canonical") || routable[0];
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const origin = req.headers.origin || "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const clientId = req.query.client_id;
  const offerId = req.query.offer_id;
  const priceKey = req.query.offer_price_key;
  const code = normCode(req.query.code);
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!priceKey) return res.status(400).json({ error: "offer_price_key required" });
  if (!code) return res.status(200).json({ valid: false, reason: "Enter a code" });

  try {
    // Plan price the code will discount - server-side, never trusted from client.
    let catalogPath = `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}` +
      `&offer_price_key=eq.${encodeURIComponent(priceKey)}` +
      `&select=amount_cents,currency,is_routable,tier`;
    if (offerId) catalogPath += `&offer_id=eq.${encodeURIComponent(offerId)}`;
    const rows = await sbReq(catalogPath);
    const row = pickRoutable(rows);
    if (!row || !row.amount_cents) {
      return res.status(200).json({ valid: false, reason: "Pick a plan first" });
    }

    // Academy's connected Stripe account.
    const clientRows = await sbReq(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = clientRows && clientRows[0] && clientRows[0].stripe_connect_account_id;
    if (!acct) return res.status(200).json({ valid: false, reason: "Coupons not available" });
    if (!stripeKey()) return res.status(500).json({ error: "Stripe not configured" });

    // Live promotion code (active only). Stripe matches code case-sensitively but
    // we always create UPPERCASE, so uppercasing the input lines them up.
    const list = await stripeFetch(
      `/promotion_codes?code=${encodeURIComponent(code)}&limit=1`, acct
    );
    const pc = (list.data || [])[0];
    if (!pc || pc.active === false) return res.status(200).json({ valid: false, reason: "Code not found" });

    // Expiry + redemption cap (Stripe also enforces these at payment).
    if (pc.expires_at && Math.floor(Date.now() / 1000) > pc.expires_at) {
      return res.status(200).json({ valid: false, reason: "This code has expired" });
    }
    if (pc.max_redemptions && (pc.times_redeemed || 0) >= pc.max_redemptions) {
      return res.status(200).json({ valid: false, reason: "This code is fully redeemed" });
    }

    // Coupon math from the live coupon + shared $1-floor / percent guardrails.
    const cp = pc.coupon || {};
    const def = cp.percent_off != null
      ? { kind: "Percent off", value: cp.percent_off }
      : { kind: "Dollar off", value: (cp.amount_off || 0) / 100 };
    const applied = applyDiscountToCents(def, row.amount_cents);
    if (!applied.ok) return res.status(200).json({ valid: false, reason: applied.error });

    return res.status(200).json({
      valid: true,
      code,
      label: applied.label,
      amount_cents: row.amount_cents,
      discount_cents: applied.discountCents,
      discounted_cents: applied.discountedCents,
      currency: row.currency || "cad",
    });
  } catch (e) {
    return res.status(200).json({ valid: false, reason: "Could not check that code" });
  }
}

export default withSentryApiRoute(handler);
