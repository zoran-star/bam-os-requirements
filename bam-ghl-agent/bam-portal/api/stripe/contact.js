import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Stripe info for a SINGLE contact, scoped to one
// academy's CONNECTED Stripe account. Powers the Stripe section of the V1.5
// Contacts-tab right drawer.
//
//   GET /api/stripe/contact?client_id=<uuid>&ghl_contact_id=<gid>&email=<email>
//     → { connected, customer }  (customer is null if none matched)
//
// Resolution order for the Stripe customer:
//   1. members table  (members.ghl_contact_id → stripe_customer_id) — exact
//   2. /customers/search?query=email:"…"  on the connected account — fallback
//
// All reads go through the platform key + `Stripe-Account: <clients
// .stripe_connect_account_id>` header (same pattern as api/members.js). No
// per-academy secret key is stored. Auth: Supabase JWT — staff (any academy)
// or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  return { isStaff: Array.isArray(staff) && !!staff[0], clientIds: Array.isArray(m) ? m.map(x => x.client_id) : [] };
}

async function stripeFetch(path, { stripeAccount } = {}) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json?.error?.message || `Stripe ${res.status}`); e.status = res.status; throw e; }
  return json;
}

// Stripe 2025-03-31 moved current_period_end onto the subscription item.
function subCurrentPeriodEnd(sub) {
  if (!sub) return null;
  if (sub.current_period_end) return sub.current_period_end;
  return sub.items?.data?.[0]?.current_period_end || null;
}

function planName(price) {
  if (!price) return null;
  return price.nickname || price.product?.name || (price.unit_amount != null
    ? `$${(price.unit_amount / 100).toFixed(2)}/${price.recurring?.interval || "once"}`
    : price.id) || null;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const clientId = req.query.client_id;
  const ghlContactId = (req.query.ghl_contact_id || "").trim();
  const email = (req.query.email || "").trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
  if (!ghlContactId && !email) return res.status(400).json({ error: "ghl_contact_id or email required" });

  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=stripe_connect_account_id,stripe_connect_status&limit=1`);
    const client = Array.isArray(rows) && rows[0];
    const acct = client && client.stripe_connect_account_id;
    if (!acct) return res.status(200).json({ connected: false });

    // 1) Resolve the Stripe customer id. Prefer the members roster (exact link).
    let customerId = null;
    if (ghlContactId) {
      const mem = await sb(`members?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=stripe_customer_id&limit=1`);
      customerId = (Array.isArray(mem) && mem[0] && mem[0].stripe_customer_id) || null;
    }
    // 2) Fallback: search the connected account by email.
    if (!customerId && email) {
      try {
        const found = await stripeFetch(`/customers/search?query=${encodeURIComponent(`email:"${email.replace(/"/g, "")}"`)}&limit=1`, { stripeAccount: acct });
        customerId = found?.data?.[0]?.id || null;
      } catch (_) { /* search unavailable / no match — leave null */ }
    }
    if (!customerId) return res.status(200).json({ connected: true, customer: null });

    const customer = await stripeFetch(`/customers/${encodeURIComponent(customerId)}`, { stripeAccount: acct });
    if (customer.deleted) return res.status(200).json({ connected: true, customer: null });

    // Subscriptions (all statuses), with price + product expanded for names.
    const subsRes = await stripeFetch(
      `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10&expand[]=data.items.data.price.product`,
      { stripeAccount: acct }
    );
    const subscriptions = (subsRes.data || []).map(s => {
      const price = s.items?.data?.[0]?.price || null;
      return {
        id: s.id, status: s.status,
        plan_name: planName(price),
        amount_cents: price?.unit_amount ?? null,
        currency: (price?.currency || customer.currency || "usd"),
        interval: price?.recurring?.interval || null,
        interval_count: price?.recurring?.interval_count || 1,
        current_period_end: subCurrentPeriodEnd(s),
        cancel_at_period_end: !!s.cancel_at_period_end,
        canceled_at: s.canceled_at || null,
      };
    });

    // Charges (recent + lifetime spend). Cap at 100; flag if more exist.
    const chRes = await stripeFetch(`/charges?customer=${encodeURIComponent(customerId)}&limit=100`, { stripeAccount: acct });
    const charges = chRes.data || [];
    let totalSpendCents = 0;
    for (const c of charges) {
      if (c.paid && c.status === "succeeded") totalSpendCents += (c.amount_captured ?? c.amount ?? 0) - (c.amount_refunded ?? 0);
    }
    const payments = charges.slice(0, 12).map(c => ({
      id: c.id,
      amount_cents: c.amount ?? null,
      currency: c.currency || "usd",
      status: c.refunded ? "refunded" : c.status,
      created: c.created,
      description: c.description || null,
      receipt_url: c.receipt_url || null,
    }));

    const live = customer.livemode !== false;
    const dashboard_url = `https://dashboard.stripe.com/${live ? "" : "test/"}customers/${customerId}`;

    return res.status(200).json({
      connected: true,
      customer: {
        id: customerId,
        name: customer.name || null,
        email: customer.email || null,
        currency: customer.currency || (subscriptions[0]?.currency) || "usd",
        total_spend_cents: totalSpendCents,
        dashboard_url,
        subscriptions,
        payments,
        more_payments: !!chRes.has_more,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "stripe lookup failed" });
  }
}

export default withSentryApiRoute(handler);
