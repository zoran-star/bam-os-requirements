import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60; // Stripe customer + sub write
// Vercel Serverless Function — "Set up monthly billing" for a PREPAID member.
//
// A member who paid a one-time prepaid commitment (e.g. $854 for "Accelerate
// 3 Months") has NO subscription that will auto-revert. This creates a
// PORTAL-OWNED monthly subscription anchored to start when the prepaid term
// ends (trial_end = charge date + term months) — so no charge until then, then
// it bills monthly automatically. This is the first real create-sub; it writes
// live billing, so the UI always confirms first.
//
// POST mode=preview  { client_id, customer_id, offer_price_key, charge_date, term_months }
//   → { monthly_price_id, amount_cents, currency, interval, trial_end (unix+iso),
//       card_last4 | needs_card, payment_link? }  (writes nothing except, if no
//       card, a Checkout setup session whose URL staff can send by hand)
//
// POST mode=create   { ...same, monthly_price_id?, trial_end? }
//   → creates the subscription (trial_end anchor, reuse default card). Refuses
//     if no reusable card (caller must collect one via the preview's link first).
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

function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
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

// "Title|3_months" → "Title|monthly"; months from the term.
function monthlyKeyOf(key) {
  const title = String(key || "").split("|")[0];
  return title ? `${title}|monthly` : null;
}
function termMonths(key) {
  const t = String(key || "").toLowerCase();
  if (t.includes("3_month")) return 3;
  if (t.includes("6_month")) return 6;
  if (t.includes("12_month") || t.includes("year")) return 12;
  return 1;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (!stripeKey()) throw new Error("Stripe secret key not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const customerId = body.customer_id;
    if (!customerId) return res.status(400).json({ error: "customer_id required" });
    const offerKey = body.offer_price_key;
    if (!offerKey) return res.status(400).json({ error: "offer_price_key required" });

    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=stripe_connect_account_id&limit=1`);
    const acct = Array.isArray(clientRows) && clientRows[0] && clientRows[0].stripe_connect_account_id;
    if (!acct) return res.status(409).json({ error: "academy not connected to Stripe" });

    // The monthly LIVE price the member reverts TO.
    const mKey = monthlyKeyOf(offerKey);
    const rows = await sb(
      `pricing_catalog?client_id=eq.${encodeURIComponent(clientId)}&offer_price_key=eq.${encodeURIComponent(mKey)}` +
      `&tier=eq.canonical&match_status=eq.confirmed&select=stripe_price_id,amount_cents,currency,interval&limit=1`
    );
    const mp = Array.isArray(rows) && rows[0];
    if (!mp || !mp.stripe_price_id) {
      return res.status(409).json({ error: `No LIVE monthly price for "${mKey}". Create it in Price Match first, then set up monthly billing.` });
    }

    // Anchor: prepaid charge date + term months (never in the past).
    const months = termMonths(offerKey);
    let trialEnd = Math.floor(Date.now() / 1000) + 60;
    if (body.charge_date) {
      const d = new Date(body.charge_date);
      if (!isNaN(d.getTime())) { d.setMonth(d.getMonth() + months); trialEnd = Math.max(Math.floor(d.getTime() / 1000), trialEnd); }
    }
    // Direct first-charge-date override (staff picked it in the modal). Wins over charge_date.
    if (body.first_charge_date) {
      const fd = new Date(body.first_charge_date);
      if (!isNaN(fd.getTime())) trialEnd = Math.max(Math.floor(fd.getTime() / 1000), Math.floor(Date.now() / 1000) + 60);
    }
    // Stripe rejects trial_end more than 730 days out — clamp (a 12-month prepaid
    // anchored from an old charge date can otherwise exceed it → 400).
    const STRIPE_TRIAL_MAX_SECS = 729 * 86400;
    trialEnd = Math.min(trialEnd, Math.floor(Date.now() / 1000) + STRIPE_TRIAL_MAX_SECS);

    // Reusable card? prefer the customer's default PM, else any attached card.
    const cust = await stripeFetch(`/customers/${encodeURIComponent(customerId)}?expand[]=invoice_settings.default_payment_method`, { stripeAccount: acct });
    let defaultPm = cust.invoice_settings && cust.invoice_settings.default_payment_method;
    let last4 = defaultPm && defaultPm.card && defaultPm.card.last4;
    if (!defaultPm) {
      const pms = await stripeFetch(`/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=1`, { stripeAccount: acct });
      const pm = pms.data && pms.data[0];
      if (pm) { defaultPm = pm.id; last4 = pm.card && pm.card.last4; }
    } else {
      defaultPm = defaultPm.id || defaultPm;
    }

    const trialIso = new Date(trialEnd * 1000).toISOString().slice(0, 10);

    if (body.mode === "preview" || !body.mode) {
      let payment_link = null;
      if (!defaultPm) {
        // No card → a Checkout setup session whose URL staff send by hand.
        try {
          const origin = (req.headers.origin || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
          const sess = await stripeFetch(`/checkout/sessions`, {
            method: "POST", stripeAccount: acct,
            body: {
              mode: "setup", currency: "cad", customer: customerId,
              success_url: `${origin}/client-portal.html?card=saved`,
              cancel_url: `${origin}/client-portal.html?card=cancelled`,
            },
          });
          payment_link = sess.url || null;
        } catch (_) {}
      }
      return res.status(200).json({
        ok: true, mode: "preview",
        monthly_price_id: mp.stripe_price_id,
        amount_cents: mp.amount_cents, currency: mp.currency, interval: mp.interval,
        term_months: months, trial_end: trialEnd, trial_end_iso: trialIso,
        card_last4: last4 || null, needs_card: !defaultPm, payment_link,
      });
    }

    // ── create ──
    if (!defaultPm) {
      return res.status(409).json({ error: "No card on file — collect one with the payment link first, then set up monthly billing." });
    }
    const sub = await stripeFetch(`/subscriptions`, {
      method: "POST", stripeAccount: acct,
      idempotencyKey: `prepaid-monthly-${clientId}-${customerId}-${mp.stripe_price_id}-${trialEnd}`.slice(0, 200),
      body: {
        customer: customerId,
        "items[0][price]": mp.stripe_price_id,
        trial_end: trialEnd,
        default_payment_method: defaultPm,
        // origin=fullcontrol-portal is the STANDARD portal-owned marker the webhook +
        // members.js both read — without it these subs never flip live or get can_manage.
        // import_silent=1 → flip live without firing the new-signup welcome (existing members).
        "metadata[origin]": "fullcontrol-portal",
        "metadata[import_silent]": "1",
        "metadata[source]": "fullcontrol-prepaid-monthly",
        "metadata[offer_price_key]": mKey,
        "metadata[member_email]": body.member_email || undefined,
        "metadata[staging_id]": body.staging_id || undefined,
      },
    });

    // Best-effort: link the new sub onto the staged member row.
    if (body.staging_id) {
      await sb(`members_staging?id=eq.${encodeURIComponent(body.staging_id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ stripe_subscription_id: sub.id, stripe_price_id: mp.stripe_price_id, updated_at: new Date().toISOString() }),
      }).catch(() => {});
    }

    return res.status(200).json({
      ok: true, mode: "create",
      subscription_id: sub.id, status: sub.status,
      trial_end: trialEnd, trial_end_iso: trialIso,
      amount_cents: mp.amount_cents, card_last4: last4 || null,
    });
  } catch (e) {
    return res.status(e.stripeStatus || e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
