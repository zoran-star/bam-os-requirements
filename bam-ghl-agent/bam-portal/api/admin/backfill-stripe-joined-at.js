import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — One-shot backfill of members.stripe_joined_at
//
// POST /api/admin/backfill-stripe-joined-at?client_id=<uuid>
//
// For each member of the given academy with a stripe_subscription_id but
// no stripe_joined_at, fetches the sub from Stripe Connect and writes the
// sub.created timestamp.
//
// Safe to re-run — only touches rows where stripe_joined_at IS NULL.
//
// Auth: caller must be staff. Re-uses the staff lookup pattern from members.js.

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

async function stripeFetch(path, stripeAccount) {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${key}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
  return res.json();
}

async function resolveStaff(req) {
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
  if (!Array.isArray(staff) || !staff[0]) throw Object.assign(new Error("staff only"), { status: 403 });
  return staff[0];
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    await resolveStaff(req);
    const clientId = (req.query && req.query.client_id) || null;
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    // Get the academy's Stripe Connect account
    const clientRows = await sb(`clients?id=eq.${clientId}&select=stripe_connect_account_id&limit=1`);
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client || !client.stripe_connect_account_id) {
      return res.status(400).json({ error: "academy has no Stripe Connect account" });
    }
    const stripeAccount = client.stripe_connect_account_id;

    // Pull members needing backfill
    const members = await sb(
      `members?client_id=eq.${clientId}` +
      `&stripe_subscription_id=not.is.null` +
      `&stripe_joined_at=is.null` +
      `&select=id,athlete_name,stripe_subscription_id`
    );
    const targets = Array.isArray(members) ? members : [];

    const results = { ok: [], failed: [], skipped_no_created: [] };

    // Run in chunks of 8 to avoid hammering Stripe + keep within Vercel
    // function timeout (60s default). At ~150ms per Stripe call, 8 in
    // parallel handles ~50 in a few seconds.
    for (let i = 0; i < targets.length; i += 8) {
      const slice = targets.slice(i, i + 8);
      await Promise.all(slice.map(async (m) => {
        try {
          const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, stripeAccount);
          if (!sub.created) { results.skipped_no_created.push(m.athlete_name); return; }
          const iso = new Date(sub.created * 1000).toISOString();
          await sb(`members?id=eq.${m.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ stripe_joined_at: iso }),
          });
          results.ok.push({ athlete_name: m.athlete_name, joined: iso.slice(0, 10) });
        } catch (e) {
          results.failed.push({ athlete_name: m.athlete_name, error: e.message });
        }
      }));
    }

    return res.status(200).json({
      ok: true,
      attempted: targets.length,
      backfilled: results.ok.length,
      failed: results.failed.length,
      skipped: results.skipped_no_created.length,
      details: results,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
