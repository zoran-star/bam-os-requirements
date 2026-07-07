// Vercel Serverless Function - mark / unmark a contact as spam from the inbox.
//
//   POST /api/ghl/mark-spam?client_id=<uuid>
//     body: { contact_id: <ghl_contact_id>, spam: true|false }
//
// Reuses the agent-mute table: a spam mark is a global mute (agent = NULL, so ALL
// bots skip this lead) tagged reason='spam'. The inbox reads reason='spam' mutes
// to move the conversation into its Spam group. Unmark deletes the spam mute (the
// agent can work them again). No new schema - one row does hide + stop-the-agent.
//
// Auth: Supabase JWT - staff, or a client_users member of client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map((m) => m.client_id) : [];
  return { isStaff, clientIds, email: user.email || null };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const clientId = req.query.client_id || (req.body && req.body.client_id);
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const b = req.body || {};
  const contactId = b.contact_id || null;
  const spam = b.spam !== false;   // default true
  if (!contactId) return res.status(400).json({ error: "contact_id required" });

  const cid = encodeURIComponent(clientId);
  const cc = encodeURIComponent(contactId);
  const spamFilter = `agent_mutes?client_id=eq.${cid}&ghl_contact_id=eq.${cc}&reason=eq.spam`;

  try {
    // Clear any existing spam mute first (idempotent), then re-add if marking spam.
    await sb(spamFilter, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
    if (spam) {
      await sb(`agent_mutes`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ client_id: clientId, ghl_contact_id: contactId, agent: null, reason: "spam", created_by: ctx.email || "staff" }]),
      });
    }
    return res.status(200).json({ ok: true, spam });
  } catch (e) {
    return res.status(500).json({ error: e.message || "couldn't update spam" });
  }
}

export default withSentryApiRoute(handler);
