// Vercel Serverless Function - Client Milestones & Records
//
//   GET  /api/milestones?client_id=<loc_id>
//        -> { milestones: [{ key, value, achieved_at }] }
//
//   POST /api/milestones
//        body: { client_id, key, value }
//        -> upserts: inserts if new, updates value+achieved_at if record is beaten
//
// Auth: Supabase JWT in Authorization header.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: init.prefer || "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Validate the caller's JWT and resolve which academies they may touch. Staff
// see everything; a client_users member sees only their own academies. Mirrors
// the resolveUser pattern in contacts.js. Without this, /api/milestones would
// take client_id straight from the request and expose any academy's revenue
// milestones to any caller (the service key bypasses RLS).
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!ur.ok) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const user = await ur.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && staff[0];
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(m) ? m.map((x) => x.client_id) : [];
  return { isStaff: !!isStaff, clientIds };
}
const _owns = (ctx, clientId) => ctx.isStaff || ctx.clientIds.includes(clientId);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message || "Unauthorized" }); }

  try {
    if (req.method === "GET") {
      const clientId = req.query.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!_owns(ctx, clientId)) return res.status(403).json({ error: "not your academy" });
      const rows = await sb(
        `client_milestones?client_id=eq.${encodeURIComponent(clientId)}&select=key,value,achieved_at&order=achieved_at.desc`
      );
      return res.json({ milestones: rows || [] });
    }

    if (req.method === "POST") {
      const { client_id, key, value } = req.body || {};
      if (!client_id || !key) return res.status(400).json({ error: "client_id and key required" });
      if (!_owns(ctx, client_id)) return res.status(403).json({ error: "not your academy" });

      const numVal = Number(value) || 0;
      const isRecord = key.startsWith("record_");

      if (isRecord) {
        // Upsert: insert or update if new value beats existing
        const existing = await sb(
          `client_milestones?client_id=eq.${encodeURIComponent(client_id)}&key=eq.${encodeURIComponent(key)}&select=id,value`
        );
        if (existing && existing.length > 0) {
          const old = existing[0];
          if (numVal > Number(old.value || 0)) {
            await sb(`client_milestones?id=eq.${old.id}`, {
              method: "PATCH",
              body: JSON.stringify({ value: numVal, achieved_at: new Date().toISOString() }),
            });
            return res.json({ action: "record_beaten", key, value: numVal, previous: Number(old.value) });
          }
          return res.json({ action: "no_change", key, value: numVal, current: Number(old.value) });
        }
        // First time
        await sb("client_milestones", {
          method: "POST",
          body: JSON.stringify({ client_id, key, value: numVal }),
        });
        return res.json({ action: "new_record", key, value: numVal });
      }

      // Tier milestone: insert if not exists, skip if already achieved
      const existing = await sb(
        `client_milestones?client_id=eq.${encodeURIComponent(client_id)}&key=eq.${encodeURIComponent(key)}&select=id`
      );
      if (existing && existing.length > 0) {
        return res.json({ action: "already_achieved", key });
      }
      await sb("client_milestones", {
        method: "POST",
        body: JSON.stringify({ client_id, key, value: numVal }),
      });
      return res.json({ action: "new_milestone", key, value: numVal });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("milestones error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
