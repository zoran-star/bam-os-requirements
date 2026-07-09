import { withSentryApiRoute } from "../_sentry.js";

// Vercel Serverless Function - self-manage the portal's Stripe webhook events
// (STAFF ONLY). The portal's Connect webhook endpoint must be subscribed to
// every event api/stripe/webhook.js handles; historically adding an event was
// a manual Stripe-dashboard step (price.created 2026-05, customer.created
// 2026-07). This endpoint makes the PORTAL own it: it finds the endpoint by
// URL on the PLATFORM account and unions in whatever is missing. Run it from
// the staff portal's Stripe Link-Up view after deploying a new handler.
//
// POST /api/stripe/ensure-webhook-events   {} -> { ok, endpoint_id, url,
//   added: [...], enabled_events: [...] }   (no-op when nothing is missing
//   or the endpoint listens to '*')
//
// Platform-level: ONE endpoint receives events for EVERY connected academy,
// so this is one call for all clients, not per-client.

const STRIPE_API = "https://api.stripe.com/v1";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// KEEP IN SYNC with the switch in api/stripe/webhook.js.
const REQUIRED_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "invoice.paid",
  "payment_method.attached",
  "charge.refunded",
  "price.created",
  "price.updated",
  "customer.created",
];

const WEBHOOK_PATH = "/api/stripe/webhook";

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

async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name&limit=1`);
  }
  if (!Array.isArray(staff) || !staff[0]) throw Object.assign(new Error("BAM staff only"), { status: 403 });
  return { user, staff: staff[0] };
}

// PLATFORM-level Stripe calls (no Stripe-Account header - webhook endpoints
// live on the platform account, not the connected academies).
async function stripeFetch(path, { method = "GET", body } = {}) {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${key}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    await resolveStaff(req);

    const list = await stripeFetch(`/webhook_endpoints?limit=100`);
    const endpoints = Array.isArray(list.data) ? list.data : [];
    const target = endpoints.find(e => String(e.url || "").includes(WEBHOOK_PATH));
    if (!target) {
      return res.status(404).json({
        error: `No webhook endpoint containing ${WEBHOOK_PATH} found on the platform account (${endpoints.length} endpoints checked).`,
      });
    }

    const current = Array.isArray(target.enabled_events) ? target.enabled_events : [];
    if (current.includes("*")) {
      return res.status(200).json({ ok: true, endpoint_id: target.id, url: target.url, added: [], enabled_events: ["*"], note: "endpoint listens to all events" });
    }
    const missing = REQUIRED_EVENTS.filter(ev => !current.includes(ev));
    if (!missing.length) {
      return res.status(200).json({ ok: true, endpoint_id: target.id, url: target.url, added: [], enabled_events: current, note: "already up to date" });
    }

    const union = [...current, ...missing];
    const params = new URLSearchParams();
    union.forEach((ev, i) => params.append(`enabled_events[${i}]`, ev));
    const updated = await stripeFetch(`/webhook_endpoints/${encodeURIComponent(target.id)}`, {
      method: "POST", body: params.toString(),
    });

    return res.status(200).json({
      ok: true, endpoint_id: target.id, url: target.url,
      added: missing, enabled_events: updated.enabled_events || union,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
