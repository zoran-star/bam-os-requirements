import { withSentryApiRoute } from "../_sentry.js";
// Meta DM spine (3/4): wire an academy to direct Instagram + Messenger DMs.
// Staff-only. Uses the existing staff Meta token (staff_meta_tokens - the same
// one that powers ads) to derive the academy's Page token + IG account, then
// subscribes the Page to the app's webhook. The academy stays DORMANT
// (status='pending') until the explicit "activate" step, so nothing changes
// in the inbox until we deliberately flip it.
//
//   POST { action: "pages" }                      → pages visible to the staff token (picker)
//   POST { action: "wire", client_id, page_id }   → store config (pending) + subscribe webhook
//   POST { action: "activate", client_id }        → status='active' (webhook starts storing)
//   POST { action: "inbox-live", client_id, live } → inbox serves dm_threads + passthrough dedupe (post-App-Review cutover)
//   POST { action: "status", client_id }          → current config, secrets omitted
//
// Requires the staff token to carry the messaging scopes (reconnect Meta in
// staff Settings after the 2026-07-03 scope add) and META_DM_VERIFY_TOKEN to
// be set in Vercel for the app-dashboard webhook handshake.
import { encryptSecret } from "../messaging/_crypto.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GRAPH = "https://graph.facebook.com/v22.0";

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? { userId: user.id, email: user.email } : null;
}

// Own staff token first, then the newest team token - same order marketing.js uses.
async function staffMetaToken(userId) {
  const own = await sb(`staff_meta_tokens?staff_user_id=eq.${userId}&select=access_token&limit=1`).catch(() => []);
  if (own && own[0] && own[0].access_token) return own[0].access_token;
  const team = await sb(`staff_meta_tokens?select=access_token&order=updated_at.desc&limit=1`).catch(() => []);
  return (team && team[0] && team[0].access_token) || null;
}

async function graph(path, token, init = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph ${r.status}`);
  return j;
}

// All pages the staff token can manage, with their IG business account if linked.
async function listPages(token) {
  const j = await graph(`me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`, token);
  return (j.data || []).map((p) => ({
    page_id: p.id, page_name: p.name,
    has_page_token: !!p.access_token, _page_token: p.access_token || null,
    ig_user_id: p.instagram_business_account?.id || null,
    ig_username: p.instagram_business_account?.username || null,
  }));
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staff = await requireStaff(req);
  if (!staff) return res.status(401).json({ error: "staff sign-in required" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const token = await staffMetaToken(staff.userId);

    if (b.action === "pages") {
      if (!token) return res.status(400).json({ error: "No staff Meta token - connect Meta in Settings first." });
      const pages = await listPages(token);
      return res.status(200).json({ pages: pages.map(({ _page_token, ...p }) => p) });
    }

    if (b.action === "wire") {
      if (!b.client_id || !b.page_id) return res.status(400).json({ error: "client_id + page_id required" });
      if (!token) return res.status(400).json({ error: "No staff Meta token - connect Meta in Settings first." });
      const page = (await listPages(token)).find((p) => p.page_id === String(b.page_id));
      if (!page) return res.status(404).json({ error: "Page not visible to the staff Meta token." });
      if (!page._page_token) return res.status(400).json({ error: "No Page token returned - the staff token is missing the messaging scopes. Reconnect Meta in Settings, then retry." });

      // Subscribe the Page to the app's webhook (messages field). This is what
      // makes Meta start POSTing this academy's DMs to inbound-webhook.
      const sub = await graph(`${encodeURIComponent(page.page_id)}/subscribed_apps?subscribed_fields=messages`, page._page_token, { method: "POST" });
      if (!sub.success) return res.status(502).json({ error: "Page webhook subscription did not confirm." });

      await sb(`client_meta_messaging_config?on_conflict=client_id`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          client_id: b.client_id, page_id: page.page_id,
          ig_user_id: page.ig_user_id, page_token_enc: encryptSecret(page._page_token),
          status: "pending", notes: `wired by ${staff.email} ${new Date().toISOString().slice(0, 10)}`,
          updated_at: new Date().toISOString(),
        }]),
      });
      return res.status(200).json({ ok: true, page_id: page.page_id, page_name: page.page_name, ig_username: page.ig_username, status: "pending", subscribed: true });
    }

    if (b.action === "activate") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      const rows = await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(b.client_id)}&select=page_id&limit=1`);
      if (!rows || !rows[0]) return res.status(404).json({ error: "wire the academy first" });
      await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(b.client_id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "active", updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, status: "active" });
    }

    // Inbox cutover switch (increment 4). status='active' just stores webhook
    // deliveries; inbox_live=true makes the inbox SERVE dm_threads and drop
    // IG/FB from the GHL passthrough. Flip only after App Review passes and a
    // real lead's DM is proven to land in dm_threads. live:false = instant
    // rollback to the passthrough.
    if (b.action === "inbox-live") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      const rows = await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(b.client_id)}&select=status&limit=1`);
      if (!rows || !rows[0]) return res.status(404).json({ error: "wire the academy first" });
      if (b.live !== false && rows[0].status !== "active") return res.status(400).json({ error: "activate the academy first" });
      await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(b.client_id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ inbox_live: b.live !== false, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, inbox_live: b.live !== false });
    }

    if (b.action === "status") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      const rows = await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(b.client_id)}&select=page_id,ig_user_id,status,inbox_live,notes,updated_at&limit=1`);
      return res.status(200).json({ config: (rows && rows[0]) || null });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[meta-connect]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
