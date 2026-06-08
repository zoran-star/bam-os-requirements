import { withSentryApiRoute } from "./_sentry.js";
// ─────────────────────────────────────────────────────────────────────────
// api/profile.js — update the signed-in user's own profile (avatar for now)
// ─────────────────────────────────────────────────────────────────────────
//   POST ?action=update-avatar  { avatar_url }
//     → staff caller     → staff.avatar_url
//     → client teammate  → client_users.avatar_url (all their membership rows)
//
// Any authenticated user can update THEIR OWN avatar. The image itself is
// uploaded client-side to the public `member-avatars` bucket; this just saves
// the resulting URL. Service-role bypasses RLS, so we only ever write rows
// keyed to the caller's own auth id.
// ─────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

async function handler(req, res) {
  if (req.method !== "POST" || req.query?.action !== "update-avatar") {
    return res.status(400).json({ error: "unknown action" });
  }
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "auth required" });
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: "invalid token" });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: "invalid token" });

    const avatar_url = (req.body || {}).avatar_url;
    if (typeof avatar_url !== "string" || !avatar_url.startsWith("http")) {
      return res.status(400).json({ error: "valid avatar_url required" });
    }

    // Staff first (by user_id, then email).
    let staff = await sb(`staff?user_id=eq.${user.id}&select=id`);
    if ((!staff || !staff[0]) && user.email) {
      staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id`);
    }
    if (staff && staff[0]) {
      await sb(`staff?id=eq.${staff[0].id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ avatar_url }),
      });
      return res.status(200).json({ ok: true, scope: "staff", avatar_url });
    }

    // Otherwise a client teammate — update every membership row for this user.
    await sb(`client_users?user_id=eq.${user.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ avatar_url }),
    });
    return res.status(200).json({ ok: true, scope: "client", avatar_url });
  } catch (e) {
    console.error("profile update-avatar error:", e?.message || e);
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
