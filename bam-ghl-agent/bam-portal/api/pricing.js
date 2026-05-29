// Vercel Serverless Function — Pricing catalog (read-only)
//
// GET /api/pricing?client_id=<uuid>
//   → all catalog rows for one academy, with member_count per row
//
// GET /api/pricing?client_id=<uuid>&price_id=<stripe_price_id>
//   → full detail for one row + the list of members tied to that price
//
// Auth: Supabase JWT in Authorization header.
// Scope: caller must belong to client_id via client_users (multi-user model).
// Staff role: can read any academy.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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
  const isStaff = Array.isArray(staff) && staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const ctx = await resolveUser(req);
    const targetClientId = (req.query && req.query.client_id) || ctx.clientIds[0] || null;
    if (!targetClientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(targetClientId)) {
      return res.status(403).json({ error: "not your academy" });
    }

    const singlePriceId = (req.query && req.query.price_id) || null;

    // ── Single price detail ────────────────────────────────────
    if (singlePriceId) {
      const priceRows = await sb(
        `pricing_catalog?client_id=eq.${targetClientId}` +
        `&stripe_price_id=eq.${encodeURIComponent(singlePriceId)}` +
        `&select=*&limit=1`
      );
      const price = Array.isArray(priceRows) && priceRows[0];
      if (!price) return res.status(404).json({ error: "price not found in catalog" });

      const members = await sb(
        `members?client_id=eq.${targetClientId}` +
        `&stripe_price_id=eq.${encodeURIComponent(singlePriceId)}` +
        `&select=id,athlete_name,parent_name,status,trainer,avatar_url` +
        `&order=athlete_name.asc`
      );

      return res.status(200).json({
        price,
        members: Array.isArray(members) ? members : [],
        member_count: Array.isArray(members) ? members.length : 0,
      });
    }

    // ── List all catalog rows + per-row member count ───────────
    const catalog = await sb(
      `pricing_catalog?client_id=eq.${targetClientId}` +
      `&select=*&order=tier.asc,canonical_plan.asc,amount_cents.asc`
    );
    const catalogList = Array.isArray(catalog) ? catalog : [];

    // Batch member counts via group-by in Postgres (PostgREST RPC would be
    // cleaner, but here we just pull all sub price IDs once and tally).
    const memberRows = await sb(
      `members?client_id=eq.${targetClientId}` +
      `&stripe_price_id=not.is.null&select=stripe_price_id`
    );
    const counts = new Map();
    if (Array.isArray(memberRows)) {
      for (const m of memberRows) {
        counts.set(m.stripe_price_id, (counts.get(m.stripe_price_id) || 0) + 1);
      }
    }
    for (const row of catalogList) {
      row.member_count = counts.get(row.stripe_price_id) || 0;
    }

    // Surface members whose sub price isn't in the catalog at all
    // (gap signal — should be empty in steady state).
    const catalogPriceIds = new Set(catalogList.map(r => r.stripe_price_id));
    const uncatalogued = [];
    if (Array.isArray(memberRows)) {
      const seen = new Set();
      for (const m of memberRows) {
        if (m.stripe_price_id && !catalogPriceIds.has(m.stripe_price_id) && !seen.has(m.stripe_price_id)) {
          seen.add(m.stripe_price_id);
          uncatalogued.push({
            stripe_price_id: m.stripe_price_id,
            member_count:    counts.get(m.stripe_price_id) || 0,
          });
        }
      }
    }

    return res.status(200).json({
      catalog: catalogList,
      uncatalogued,
      totals: {
        catalog_rows: catalogList.length,
        members_with_price: memberRows ? memberRows.length : 0,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
