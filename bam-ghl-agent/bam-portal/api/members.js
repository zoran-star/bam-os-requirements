// Vercel Serverless Function — Members (academy roster + billing)
//
// Powers the client-portal "Members" tab. Ported from the BAM GTA
// member-management system (blueprint: /Users/zoransavic/BAM GTA/).
//
//   GET  /api/members?scope=client&client_id=<uuid>  → an academy's roster
//   GET  /api/members?id=<member_uuid>               → one member
//   (staff) GET /api/members[?client_id=<uuid>]      → all, or one academy's
//
// Auth uses the MULTI-USER model: a login's academies come from the
// client_users join table (see project_multi_user_portal). The caller
// passes ?client_id= to pick which academy; staff may target any.
//
// PHASE 3 (not built yet) — billing write actions arrive as:
//   PATCH /api/members?id=<member_uuid>  with { action, ... }
//   actions: pause · unpause · cancel · refund · change · payment-link · refer
// They act on the academy's Stripe CONNECTED account (platform key +
// `Stripe-Account: <clients.stripe_connect_account_id>` header), honoring
// BAM GTA's locked Stripe conventions (trial_end-everywhere, 720-day cap,
// auto-rollover, orphan-draft void) and writing a member_audit_log row.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// ─────────────────────────────────────────────────────────
// Shared helpers (kept consistent with api/marketing.js)
// ─────────────────────────────────────────────────────────

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };

  // Resolve staff: try user_id first, fall back to email.
  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staffRow = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  // Resolve the academies this user belongs to via client_users — the
  // multi-user model (many logins per academy). Includes the Stripe Connect
  // fields so Phase 3 billing actions can reach the connected account.
  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,role`
  );
  const clientIds = Array.isArray(memberships)
    ? [...new Set(memberships.map(m => m.client_id).filter(Boolean))]
    : [];
  let clients = [];
  if (clientIds.length) {
    clients = await sb(
      `clients?id=in.(${clientIds.join(",")})&select=id,business_name,stripe_connect_account_id,stripe_connect_status`
    ) || [];
  }

  return { user, staff: staffRow, clients, memberships: memberships || [] };
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  let ctx;
  try {
    ctx = await resolveUser(req);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const clients = Array.isArray(ctx.clients) ? ctx.clients : [];
  const isClient = clients.length > 0;
  if (!isStaff && !isClient) {
    return res.status(403).json({ error: "not authorized" });
  }

  const id = req.query.id || null;

  // Which academy is this request scoped to? A user may belong to several
  // academies; the caller passes ?client_id= to pick one. Staff may target
  // any academy (or all, when no client_id is given).
  function resolveTargetClient() {
    const requested = req.query.client_id || null;
    if (requested) {
      if (isStaff || clients.some(c => c.id === requested)) return requested;
      return null; // caller is not a member of the requested academy
    }
    return clients.length ? clients[0].id : null;
  }

  // ── GET ────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // Single member
      if (id) {
        const rows = await sb(`members?id=eq.${id}&select=*`);
        const member = Array.isArray(rows) && rows[0] ? rows[0] : null;
        if (!member) return res.status(404).json({ error: "member not found" });
        // A client may only read members of an academy it belongs to.
        if (!isStaff && !clients.some(c => c.id === member.client_id)) {
          return res.status(403).json({ error: "not your member" });
        }
        return res.status(200).json({ member });
      }

      // List
      let query;
      if (isStaff && !req.query.client_id) {
        // Staff with no filter: every academy's members.
        query = `members?select=*&order=athlete_name.asc`;
      } else {
        const targetClientId = resolveTargetClient();
        if (!targetClientId) {
          return res.status(403).json({ error: "no academy in scope" });
        }
        query = `members?client_id=eq.${targetClientId}&select=*&order=athlete_name.asc`;
      }
      const members = await sb(query);
      return res.status(200).json({ members: Array.isArray(members) ? members : [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH (Phase 3 — billing actions) ──────────────────
  if (req.method === "PATCH") {
    return res.status(501).json({
      error: "billing actions (pause/cancel/refund/change/refer) arrive in Phase 3",
    });
  }

  return res.status(405).json({ error: "method not allowed" });
}
