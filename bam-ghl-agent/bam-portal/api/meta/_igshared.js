// Shared helpers for the client-facing Instagram connect wizard
// (ig-connect.js + ig-callback.js). The academy OWNER signs into their own
// Meta account, picks their Facebook Page, and the portal wires the Meta DM
// spine (client_meta_messaging_config) exactly like the staff flow in
// connect.js - just with the client's Page token instead of the staff one.
//
// Wizard state (between OAuth callback and page pick, plus display info)
// lives on clients.ig_setup - mirrors the email wizard's clients.email_setup.
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "../messaging/_crypto.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GRAPH = "https://graph.facebook.com/v22.0";

// Messaging-only subset of the staff scopes (marketing.js) - no ads access.
export const IG_OAUTH_SCOPES = [
  "public_profile", "pages_show_list", "pages_manage_metadata",
  "pages_messaging", "instagram_basic", "instagram_manage_messages",
];

export async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

export async function graph(path, token, init = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph ${r.status}`);
  return j;
}

// Pinned to the canonical CLIENT portal URL - the redirect URI registered in
// the Meta app config must match exactly (same reasoning as metaGetOrigin in
// marketing.js: Vercel preview hostnames would otherwise leak in).
export function portalOrigin(req) {
  if (process.env.CLIENT_PORTAL_URL) return process.env.CLIENT_PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://portal.byanymeansbusiness.com";
}

export const igRedirectUri = (req) => `${portalOrigin(req)}/api/meta/ig-callback`;

// HMAC-signed OAuth state - same scheme as marketing.js metaSignState.
const stateSecret = () => process.env.META_OAUTH_STATE_SECRET || SB_KEY;
export function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
export function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("invalid state format");
  const [data, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (!payload.exp || Date.now() > payload.exp) throw new Error("state expired - start over");
  return payload;
}

// All pages the user token can manage, with their IG business account if linked.
export async function listPagesForToken(userToken) {
  const j = await graph(`me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`, userToken);
  return (j.data || []).map((p) => ({
    page_id: p.id, page_name: p.name,
    _page_token: p.access_token || null,
    ig_user_id: p.instagram_business_account?.id || null,
    ig_username: p.instagram_business_account?.username || null,
  }));
}

export async function readClient(clientId) {
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,ig_setup&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function saveSetup(clientId, setup) {
  await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ig_setup: setup, updated_at: new Date().toISOString() }),
  });
}

// Wire one page onto the Meta DM spine: subscribe the Page to the app's
// webhook, store the encrypted Page token, and go straight to active +
// inbox_live (the self-serve flow is one-shot; the staged pending->active->
// inbox-live path in connect.js stays for staff-managed cutovers).
export async function wirePage({ clientId, userToken, pageId, by, existingSetup }) {
  const page = (await listPagesForToken(userToken)).find((p) => p.page_id === String(pageId));
  if (!page) throw new Error("That page isn't visible to the connected Facebook account.");
  if (!page._page_token) throw new Error("Facebook didn't return a page token - reconnect and grant all requested permissions.");

  const sub = await graph(`${encodeURIComponent(page.page_id)}/subscribed_apps?subscribed_fields=messages`, page._page_token, { method: "POST" });
  if (!sub.success) throw new Error("Page webhook subscription did not confirm.");

  await sb(`client_meta_messaging_config?on_conflict=client_id`, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      client_id: clientId, page_id: page.page_id,
      ig_user_id: page.ig_user_id, page_token_enc: encryptSecret(page._page_token),
      status: "active", inbox_live: true,
      notes: `self-serve OAuth by ${by || "client"} ${new Date().toISOString().slice(0, 10)}`,
      updated_at: new Date().toISOString(),
    }]),
  });

  // Keep display info; drop the user token now that the page token is stored.
  const setup = { ...(existingSetup || {}) };
  delete setup.user_token_enc; delete setup.pages;
  await saveSetup(clientId, {
    ...setup, page_id: page.page_id, page_name: page.page_name,
    ig_username: page.ig_username, wired_at: new Date().toISOString(),
  });
  return { page_id: page.page_id, page_name: page.page_name, ig_username: page.ig_username };
}

export { encryptSecret, decryptSecret };
