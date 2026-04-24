// Vercel Serverless Function — Academy → Client mappings
// Staff-only (Bearer auth). Manager role required for writes.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SB_HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...SB_HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function verifyStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;
  const rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email`);
  const me = Array.isArray(rows) && rows[0];
  if (!me) return null;
  return me;
}

export default async function handler(req, res) {
  const me = await verifyStaff(req);
  if (!me) return res.status(401).json({ error: "unauthorized" });
  const isManager = me.role === "admin" || me.role === "systems_manager";

  try {
    if (req.method === "GET") {
      const rows = await sb(`academy_mappings?select=asana_name,client_id,skip`);
      return res.status(200).json({ data: rows || [] });
    }

    if (req.method === "POST") {
      if (!isManager) return res.status(403).json({ error: "manager only" });
      const { asana_name, client_id = null, skip = false } = req.body || {};
      if (!asana_name) return res.status(400).json({ error: "asana_name required" });

      // Upsert by primary key
      const created = await fetch(`${SUPABASE_URL}/rest/v1/academy_mappings`, {
        method: "POST",
        headers: {
          ...SB_HEADERS,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          asana_name,
          client_id: skip ? null : client_id,
          skip,
          created_by: me.id,
        }),
      });
      if (!created.ok) {
        const errText = await created.text();
        return res.status(500).json({ error: `upsert failed: ${errText}` });
      }
      const [row] = await created.json();
      return res.status(200).json({ data: row });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("academy-mappings error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
