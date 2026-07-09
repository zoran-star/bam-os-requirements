import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 30;

// Instagram connect wizard (client self-serve) - the academy owner links their
// own Instagram/Facebook to the portal inbox, no BAM staff involved. Lives in
// the client portal's Settings dock next to the email domain wizard.
//
//   POST /api/meta/ig-connect   { client_id, action, page_id? }
//     action=status     -> { status: none|pick|pending|active|disconnected,
//                            ig_username?, page_name?, inbox_live? }
//     action=start      -> { redirect_url }  (Facebook OAuth dialog)
//     action=pages      -> { pages: [{page_id,page_name,ig_username}] }  (after OAuth)
//     action=wire       -> { ok, ig_username, page_name }  (pick a page -> live)
//     action=disconnect -> { ok }  (config disabled, tokens cleared)
//
// Auth: staff (any academy) or an active client_users member of client_id -
// same pattern as email/domain-setup.js. The OAuth callback itself is
// /api/meta/ig-callback (registered as a Valid OAuth Redirect URI on the Meta
// app). Real (non-tester) owners can only finish OAuth once Meta App Review
// approves the messaging scopes - until then this flow works for app testers.
import {
  sb, graph, decryptSecret, signState, igRedirectUri, IG_OAUTH_SCOPES,
  listPagesForToken, readClient, saveSetup, wirePage,
} from "./_igshared.js";
import crypto from "node:crypto";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const META_API_VERSION = "v22.0";

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds, userId: user.id, email: user.email };
}

const readConfig = async (clientId) => {
  const rows = await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(clientId)}&select=page_id,ig_user_id,page_token_enc,status,inbox_live&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
};

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(body.client_id || ctx.clientIds[0] || "").trim();
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const client = await readClient(clientId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    const setup = client.ig_setup || {};
    const action = String(body.action || "status");

    if (action === "status") {
      const cfg = await readConfig(clientId);
      if (cfg && cfg.status !== "disabled") {
        let igUsername = setup.ig_username || null;
        let pageName = setup.page_name || null;
        // Staff-wired academies (GTA) have no ig_setup - enrich once from Graph.
        if (!igUsername && cfg.page_token_enc) {
          try {
            const p = await graph(`${encodeURIComponent(cfg.page_id)}?fields=name,instagram_business_account{username}`, decryptSecret(cfg.page_token_enc));
            pageName = p.name || pageName;
            igUsername = p.instagram_business_account?.username || null;
            await saveSetup(clientId, { ...setup, page_id: cfg.page_id, page_name: pageName, ig_username: igUsername });
          } catch (_) {}
        }
        return res.status(200).json({ ok: true, status: cfg.status, inbox_live: cfg.inbox_live !== false, ig_username: igUsername, page_name: pageName });
      }
      if (setup.user_token_enc && Array.isArray(setup.pages) && setup.pages.length) {
        return res.status(200).json({ ok: true, status: "pick", pages: setup.pages });
      }
      return res.status(200).json({ ok: true, status: cfg ? "disconnected" : "none" });
    }

    if (action === "start") {
      const appId = process.env.META_APP_ID;
      if (!appId) return res.status(500).json({ error: "META_APP_ID not configured" });
      const state = signState({
        client_id: clientId, user_id: ctx.userId, by: ctx.email || null,
        exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomBytes(8).toString("hex"),
      });
      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: igRedirectUri(req),
        scope: IG_OAUTH_SCOPES.join(","),
        response_type: "code",
        auth_type: "rerequest", // reconnects must re-show the permission screen
        state,
      });
      return res.status(200).json({ ok: true, redirect_url: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}` });
    }

    if (action === "pages") {
      if (!setup.user_token_enc) return res.status(400).json({ error: "Connect with Facebook first." });
      const pages = await listPagesForToken(decryptSecret(setup.user_token_enc));
      return res.status(200).json({ ok: true, pages: pages.map(({ _page_token, ...p }) => p) });
    }

    if (action === "wire") {
      if (!body.page_id) return res.status(400).json({ error: "page_id required" });
      if (!setup.user_token_enc) return res.status(400).json({ error: "Connect with Facebook first." });
      const wired = await wirePage({
        clientId, userToken: decryptSecret(setup.user_token_enc),
        pageId: body.page_id, by: ctx.email, existingSetup: setup,
      });
      return res.status(200).json({ ok: true, status: "active", ...wired });
    }

    if (action === "disconnect") {
      await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "disabled", inbox_live: false, page_token_enc: null, notes: `disconnected by ${ctx.email || "client"} ${new Date().toISOString().slice(0, 10)}`, updated_at: new Date().toISOString() }),
      });
      const next = { ...setup, disconnected_at: new Date().toISOString() };
      delete next.user_token_enc; delete next.pages;
      await saveSetup(clientId, next);
      return res.status(200).json({ ok: true, status: "disconnected" });
    }

    return res.status(400).json({ error: "unknown action (status|start|pages|wire|disconnect)" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
