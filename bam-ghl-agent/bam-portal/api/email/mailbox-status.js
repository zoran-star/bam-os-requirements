import { withSentryApiRoute } from "../_sentry.js";
// Email spine (10/n): connected-mailbox STATUS - powers the onboarding detector
// ("Connect your inbox" step) and the Settings connect card's badge. Also lets an
// authorized user DISCONNECT. Read-only secrets never leave the server.
//
//   GET  /api/email/mailbox-status?client_id=<id>
//        -> { connected, provider, email, status, last_synced_at }
//   POST /api/email/mailbox-status  { client_id, action:'disconnect' }
import { sb } from "./_mailbox.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function ctx(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  let staff = await sb(`staff?user_id=eq.${u.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && u.email) staff = await sb(`staff?email=eq.${encodeURIComponent(u.email)}&select=id&limit=1`);
  const memberships = await sb(`client_users?user_id=eq.${u.id}&status=eq.active&select=client_id`);
  return { user: u, isStaff: !!(staff && staff[0]), clientIds: (memberships || []).map((m) => m.client_id) };
}
const allowed = (c, clientId) => c && (c.isStaff || c.clientIds.includes(clientId));

async function handler(req, res) {
  const c = await ctx(req);
  if (!c) return res.status(401).json({ error: "unauthorized" });

  if (req.method === "GET") {
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!allowed(c, clientId)) return res.status(403).json({ error: "not your academy" });
    const rows = await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}&select=provider,email,status,last_synced_at&limit=1`).catch(() => null);
    const m = rows && rows[0];
    return res.status(200).json({
      connected: !!(m && m.status === "active"),
      provider: m ? m.provider : null,
      email: m ? m.email : null,
      status: m ? m.status : null,
      last_synced_at: m ? m.last_synced_at : null,
    });
  }

  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!allowed(c, clientId)) return res.status(403).json({ error: "not your academy" });
    if (body.action === "disconnect") {
      await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
      return res.status(200).json({ ok: true, connected: false });
    }
    return res.status(400).json({ error: "unknown action" });
  }

  return res.status(405).json({ error: "GET or POST" });
}

export default withSentryApiRoute(handler);
