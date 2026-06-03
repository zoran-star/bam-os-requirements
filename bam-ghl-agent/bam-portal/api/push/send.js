// POST /api/push/send — staff-only manual/test push.
// Body: { client_id?, auth_user_id?, title, body, data? }  (one of client_id /
// auth_user_id). Verifies the caller is BAM staff, then fans out via the
// shared sender (APNs + FCM). Handy for a future staff "send notification" UI
// and for proving push works during App Store review.

import { sendPush } from "../_lib/push.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  return res.ok ? res.json() : null;
}

async function requireStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role`);
  }
  if (!staff || !staff[0]) return { error: { status: 403, message: "staff only" } };
  return { staff: staff[0] };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "supabase not configured" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }
  const { error } = await requireStaff(req);
  if (error) return res.status(error.status).json({ error: error.message });

  const body = req.body || {};
  const { client_id, auth_user_id, title, data } = body;
  const message = body.body;
  if (!title || !message) return res.status(400).json({ error: "title and body required" });
  if (!client_id && !auth_user_id) return res.status(400).json({ error: "client_id or auth_user_id required" });

  try {
    const result = await sendPush({ client_id, auth_user_id, title, body: message, data });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
