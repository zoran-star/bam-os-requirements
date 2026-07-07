// Vercel Serverless Function - find + merge duplicate contacts (Phase 2).
//
//   POST /api/ghl/merge-contacts?client_id=<uuid>
//     { action: 'find',  contact_id }            -> { candidates: [{ghl_contact_id,name,phone,email,msgs}] }
//     { action: 'merge', contact_id, drop_id }   -> merges drop_id INTO contact_id (keep), returns { ok, moved }
//
// The merge itself is an ATOMIC Postgres function (merge_contacts): it re-points
// every contact-keyed table from the duplicate to the kept contact, consolidates
// the identity, and deletes the duplicate - all in one transaction, so a collision
// rolls the whole thing back rather than leaving half-merged data. Duplicate
// detection (find_duplicate_contacts) matches on last-10 phone digits or exact name.
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
  return { isStaff, clientIds };
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
  const action = b.action || "find";
  const contactId = b.contact_id || null;
  if (!contactId) return res.status(400).json({ error: "contact_id required" });

  try {
    if (action === "find") {
      const rows = await sb(`rpc/find_duplicate_contacts`, { method: "POST", body: JSON.stringify({ p_client: clientId, p_contact: contactId }) });
      return res.status(200).json({ candidates: Array.isArray(rows) ? rows : [] });
    }
    if (action === "merge") {
      const dropId = b.drop_id || null;
      if (!dropId) return res.status(400).json({ error: "drop_id required" });
      if (dropId === contactId) return res.status(400).json({ error: "can't merge a contact into itself" });
      const r = await sb(`rpc/merge_contacts`, { method: "POST", body: JSON.stringify({ p_client: clientId, p_keep: contactId, p_drop: dropId }) });
      if (r && r.error) return res.status(400).json({ error: r.error });
      return res.status(200).json(r || { ok: true });
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "merge failed" });
  }
}

export default withSentryApiRoute(handler);
