// Vercel Serverless Function - set a contact's display name from the inbox.
//
//   POST /api/ghl/set-contact-name?client_id=<uuid>
//     body: { contact_id?: <ghl_contact_id>, phone?: '+1...', name: 'Sarah Chen' }
//     -> upserts the contacts row's name (+ first/last split). Off GHL - writes the
//        portal contacts store only. Matches an existing row by ghl_contact_id (or
//        phone); inserts one if none exists yet (a thread-only lead).
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
  const name = String(b.name || "").trim().slice(0, 120);
  const contactId = b.contact_id || null;
  const phone = b.phone || null;
  if (!name) return res.status(400).json({ error: "name required" });
  if (!contactId && !phone) return res.status(400).json({ error: "contact_id or phone required" });

  const parts = name.split(/\s+/);
  const first = parts[0] || null;
  const last = parts.length > 1 ? parts.slice(1).join(" ") : null;
  const cid = encodeURIComponent(clientId);
  const patch = { name, first_name: first, last_name: last, updated_at: new Date().toISOString() };

  try {
    // Prefer matching by ghl_contact_id; fall back to phone.
    const filter = contactId
      ? `contacts?client_id=eq.${cid}&ghl_contact_id=eq.${encodeURIComponent(contactId)}`
      : `contacts?client_id=eq.${cid}&phone=eq.${encodeURIComponent(phone)}`;
    const existing = await sb(`${filter}&select=id&limit=1`).catch(() => []);
    if (Array.isArray(existing) && existing[0]) {
      await sb(`${filter}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    } else {
      await sb(`contacts`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ client_id: clientId, ghl_contact_id: contactId, phone: phone || null, ...patch }]),
      });
    }
    return res.status(200).json({ ok: true, name });
  } catch (e) {
    return res.status(500).json({ error: e.message || "couldn't save name" });
  }
}

export default withSentryApiRoute(handler);
