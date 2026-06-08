import { withSentryApiRoute } from "../_sentry.js";
// ─────────────────────────────────────────────────────────────────────────
// api/push/send.js — staff-triggered / test push endpoint (admin-gated)
// ─────────────────────────────────────────────────────────────────────────
// The 7 event triggers call notifyClientPush() in _send.js directly from
// their own routes. THIS endpoint is for:
//   GET  ?action=status            → { configured: bool } (no secrets) — lets
//                                     the staff UI show "push ready?" + helps
//                                     debug before the APNs key is added.
//   POST ?action=send              → { clientId, kind, detail } admin-only,
//                                     send a templated event to a client now
//                                     (manual nudge + the way to test delivery).
//
// ⚠️ Service-role key bypasses RLS — every action is gated in code (admin only
// for sends). See docs/portal-engineering-guide.md §3.
// ─────────────────────────────────────────────────────────────────────────

import { notifyClientPush, apnsConfigured, EVENTS } from "./_send.js";
import { ADMIN_LIKE_ROLES, hasRole } from "../_roles.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };
  let rows = await sb(`staff?user_id=eq.${user.id}&select=role`);
  if ((!rows || !rows[0]) && user.email) {
    rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role`);
  }
  return { role: rows?.[0]?.role || null };
}

async function handler(req, res) {
  const action = req.query?.action;

  // ?action=status — booleans only, no secrets. Open to any logged-in staff.
  if (req.method === "GET" && action === "status") {
    const { error } = await resolveStaff(req);
    if (error) return res.status(error.status).json({ error: error.message });
    return res.status(200).json({ configured: apnsConfigured(), events: Object.keys(EVENTS) });
  }

  if (req.method === "POST" && action === "send") {
    const { role, error } = await resolveStaff(req);
    if (error) return res.status(error.status).json({ error: error.message });
    if (!hasRole(role, ADMIN_LIKE_ROLES)) {
      return res.status(403).json({ error: "admin only" });
    }
    const { clientId, kind, detail } = req.body || {};
    if (!clientId || !kind) {
      return res.status(400).json({ error: "clientId and kind are required" });
    }
    if (!EVENTS[kind]) {
      return res.status(400).json({ error: `unknown kind; valid: ${Object.keys(EVENTS).join(", ")}` });
    }
    if (!apnsConfigured()) {
      return res.status(503).json({ error: "APNs not configured (missing APNS_* env)" });
    }
    const result = await notifyClientPush(clientId, kind, detail || {});
    return res.status(200).json({ ok: true, ...result });
  }

  return res.status(400).json({ error: "unknown action" });
}

export default withSentryApiRoute(handler);
