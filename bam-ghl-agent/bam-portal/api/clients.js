// Vercel Serverless Function — Clients (Supabase clients table + live Stripe revenue)
// GET /api/clients               → list all clients
// GET /api/clients?id=<uuid>     → single client

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// In-memory cache for Stripe revenue (keyed by stripe_customer_id, 60s TTL)
const revenueCache = new Map();
const REVENUE_TTL_MS = 60 * 1000;

async function supabaseSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getStripeRevenue(customerId) {
  if (!customerId || !STRIPE_KEY) return null;

  const cached = revenueCache.get(customerId);
  if (cached && Date.now() - cached.at < REVENUE_TTL_MS) return cached.data;

  try {
    const res = await fetch(
      `${STRIPE_API}/subscriptions?customer=${customerId}&status=all&limit=10`,
      { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const subs = json.data || [];

    const active = subs.filter(s => ["active", "trialing", "past_due"].includes(s.status));
    const mrrCents = active.reduce((sum, s) => {
      const amount = s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0;
      const interval = s.plan?.interval || s.items?.data?.[0]?.price?.recurring?.interval || "month";
      const monthly = interval === "year" ? amount / 12 : interval === "week" ? amount * 4 : amount;
      return sum + monthly;
    }, 0);

    const data = {
      mrr: Math.round(mrrCents) / 100,
      activeSubs: active.length,
      totalSubs: subs.length,
      status: active.length > 0 ? "active" : subs.length > 0 ? "lapsed" : "none",
      revenueLabel: active.length > 0 ? `$${(Math.round(mrrCents) / 100).toLocaleString()}/mo` : "—",
    };
    revenueCache.set(customerId, { data, at: Date.now() });
    return data;
  } catch {
    return null;
  }
}

function shapeClient(row, revenue) {
  return {
    id: row.id,
    name: row.name,
    owner_name: row.owner_name || null,
    email: row.email || null,
    auth_user_id: row.auth_user_id || null,
    status: row.status,
    ghl_location_id: row.ghl_location_id || null,
    slack_channel_id: row.slack_channel_id || null,
    stripe_customer_id: row.stripe_customer_id || null,
    notion_page_id: row.notion_page_id || null,
    asana_project_id: row.asana_project_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,

    // Live Stripe data
    revenue: revenue?.revenueLabel || "—",
    mrr: revenue?.mrr || 0,
    billing_status: revenue?.status || "unknown",
    active_subs: revenue?.activeSubs || 0,

    // Legacy-shape fields (UI compat — empty until backfilled in Supabase)
    manager: "",
    startDate: "",
    renewal: "",
    onboardingStatus: row.status === "onboarding" ? "In Progress" : "Done",
    progress: row.status === "active" ? 100 : 0,
    checks: Array(14).fill(row.status === "active"),
    health: row.status === "active" ? 95 : 50,
    healthStatus: row.status === "active" ? "healthy" : "at-risk",
    tier: "Foundations",
    lastActivity: "",
    tasksDue: 0,
    notes: "",
    wins: row.status === "active" ? ["Onboarding complete"] : [],
    alerts: [],
    salesNotes: "",
    customTasks: [],
    aiSentiment: null,
  };
}

async function supabaseInsert(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase env vars missing (need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)" });
  }

  if (req.method === "POST") {
    try {
      // ── Staff auth (admin only) ──
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).json({ error: "auth required" });

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) return res.status(401).json({ error: "invalid token" });
      const user = await userRes.json();
      if (!user?.email) return res.status(401).json({ error: "invalid token" });

      const staffRows = await supabaseSelect(
        `staff?email=eq.${encodeURIComponent(user.email)}&select=role`
      );
      const role = staffRows?.[0]?.role;
      if (role !== "admin") return res.status(403).json({ error: "admin only" });

      // ── Action router ──
      // ?action=reset-password   → send a password-reset email to a client
      // (no action)              → create a new client (default)
      const action = req.query.action;

      if (action === "reset-password") {
        const body = req.body || {};
        const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!targetEmail) return res.status(400).json({ error: "email required" });

        // Use Supabase auth recover endpoint — sends the standard recovery email
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/client-portal.html?type=recovery`;
        const recoverRes = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: targetEmail, redirect_to: redirectTo }),
        });
        if (!recoverRes.ok) {
          const errText = await recoverRes.text();
          return res.status(400).json({ error: errText || `recover ${recoverRes.status}` });
        }
        return res.status(200).json({ ok: true, sent_to: targetEmail });
      }

      // ── Validate inputs ──
      const body = req.body || {};
      const name       = typeof body.name === "string" ? body.name.trim() : "";
      const owner_name = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
      const email      = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password   = typeof body.password === "string" ? body.password : "";
      const status     = typeof body.status === "string" && ["onboarding","active","paused","churned"].includes(body.status) ? body.status : "onboarding";

      if (!name)       return res.status(400).json({ error: "academy name required" });
      if (!owner_name) return res.status(400).json({ error: "owner name required" });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "valid email required" });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
      }

      // ── Create the Supabase auth user (admin API, auto-confirmed) ──
      const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (!createUserRes.ok) {
        const errText = await createUserRes.text();
        // 422 = email already exists; surface a clean message
        const friendly = createUserRes.status === 422 || /already/i.test(errText)
          ? "an account with that email already exists"
          : `auth: ${errText}`;
        return res.status(400).json({ error: friendly });
      }
      const newUser = await createUserRes.json();
      const auth_user_id = newUser?.id;
      if (!auth_user_id) return res.status(500).json({ error: "auth user created but id missing" });

      // ── Insert the clients row, linked to the new auth user ──
      try {
        const rows = await supabaseInsert("clients", {
          name, owner_name, email, status, auth_user_id,
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        return res.status(200).json({ id: row?.id, name: row?.name });
      } catch (insertErr) {
        // Roll back the auth user if the clients insert fails so they don't get orphaned
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
          method: "DELETE",
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        }).catch(() => {});
        return res.status(500).json({ error: `clients insert failed: ${insertErr.message}` });
      }
    } catch (err) {
      console.error("/api/clients POST error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const id = req.query.id;
    const path = id
      ? `clients?id=eq.${encodeURIComponent(id)}&select=*`
      : `clients?select=*&order=name.asc`;

    const rows = await supabaseSelect(path);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const revenue = await getStripeRevenue(row.stripe_customer_id);
        return shapeClient(row, revenue);
      })
    );

    return res.status(200).json({ data: id ? enriched[0] : enriched });
  } catch (err) {
    console.error("/api/clients error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
