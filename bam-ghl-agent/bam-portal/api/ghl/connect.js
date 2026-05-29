// Vercel Serverless Function — GHL OAuth (Location-level Connect)
//
// Connects each academy's GHL sub-account to the BAM Business platform.
// Modeled on api/stripe/connect.js (Standard Connect OAuth pattern).
//
// Flow:
//   1. POST /api/ghl/connect   body: { client_id }
//      → returns { redirect_url } pointing at GHL's chooselocation page
//   2. Academy owner picks their location in GHL, approves scopes
//   3. GHL redirects back to GET /api/ghl/connect?code=...&state=...
//   4. We exchange code for an access_token + refresh_token at GHL's
//      token endpoint, store both (+ locationId + expiry) on the
//      academy's clients row
//   5. Send-message uses the stored token. When it nears expiry, the
//      send-message code refreshes it automatically.
//
// Env vars required:
//   GHL_OAUTH_CLIENT_ID         BAM Business's GHL marketplace app client_id
//   GHL_OAUTH_CLIENT_SECRET     same, secret
//   GHL_OAUTH_STATE_SECRET      HMAC secret for the state token
//                                (falls back to SUPABASE_SERVICE_ROLE_KEY)
//   VITE_SUPABASE_URL / SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY
//
// Redirect URI to register in the GHL Marketplace app config:
//   https://portal.byanymeansbusiness.com/api/ghl/connect

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const GHL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL     = "https://services.leadconnectorhq.com/oauth/token";

// Scopes the portal needs end-to-end. Conservative — covers SMS, email,
// contact lookup, location read. Extend later when new GHL features ship.
const SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "conversations.write",
  "conversations/message.readonly",
  "conversations/message.write",
  "locations.readonly",
].join(" ");

function nowIso() { return new Date().toISOString(); }

function getOrigin(req) {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://portal.byanymeansbusiness.com";
}

// The redirect URI registered in the GHL Marketplace app must match this.
function redirectUri(req) {
  return `${getOrigin(req)}/api/ghl/connect`;
}

function signState(payload) {
  const secret = process.env.GHL_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("invalid state format");
  const [data, sig] = state.split(".");
  const secret = process.env.GHL_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) throw new Error("state expired");
  return payload;
}

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

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };

  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const staff = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];

  return { user, staff, clientIds };
}

function redirectBack(res, status, msg) {
  const params = new URLSearchParams({ ghl_connect: status });
  if (msg) params.set("msg", String(msg).slice(0, 160));
  res.setHeader("Location", `/client-portal.html?${params.toString()}#members`);
  return res.status(302).end();
}

export default async function handler(req, res) {
  if (req.method === "POST") return handlePrepare(req, res);
  if (req.method === "GET")  return handleCallback(req, res);
  return res.status(405).json({ error: "method not allowed" });
}

// ── Step 1: prepare ───────────────────────────────────────
async function handlePrepare(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  const isStaff = !!ctx.staff;
  const owns = (ctx.clientIds || []).includes(clientId);
  if (!isStaff && !owns) return res.status(403).json({ error: "not your academy" });

  const ghlClientId = process.env.GHL_OAUTH_CLIENT_ID;
  if (!ghlClientId) return res.status(500).json({ error: "GHL_OAUTH_CLIENT_ID not configured" });

  const state = signState({
    client_id: clientId,
    user_id: ctx.user.id,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomBytes(8).toString("hex"),
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id:     ghlClientId,
    redirect_uri:  redirectUri(req),
    scope:         SCOPES,
    state,
  });

  try {
    await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ghl_connect_status: "onboarding", updated_at: nowIso() }),
    });
  } catch (_) { /* non-fatal */ }

  return res.status(200).json({ redirect_url: `${GHL_AUTHORIZE_URL}?${params.toString()}` });
}

// ── Step 2: callback ──────────────────────────────────────
async function handleCallback(req, res) {
  const { code, state, error: ghlError, error_description } = req.query;
  if (ghlError) return redirectBack(res, "error", error_description || String(ghlError));
  if (!code || !state) return redirectBack(res, "error", "missing code or state");

  let payload;
  try { payload = verifyState(state); }
  catch (e) { return redirectBack(res, "error", `state: ${e.message}`); }
  if (!payload.client_id) return redirectBack(res, "error", "state missing client_id");

  const clientId     = process.env.GHL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GHL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectBack(res, "error", "GHL OAuth env vars missing");
  }

  // Exchange the authorization code for an access + refresh token pair.
  let tok;
  try {
    const tokenRes = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  redirectUri(req),
        user_type:     "Location",
      }),
    });
    tok = await tokenRes.json();
    if (!tokenRes.ok || !tok?.access_token) {
      return redirectBack(res, "error", tok?.error_description || tok?.error || tok?.message || "token exchange failed");
    }
  } catch (e) {
    return redirectBack(res, "error", `token exchange: ${e.message}`);
  }

  // GHL token response shape:
  //   { access_token, refresh_token, expires_in, scope, userType,
  //     companyId, locationId, ... }
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();

  try {
    await sb(`clients?id=eq.${encodeURIComponent(payload.client_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ghl_access_token:     tok.access_token,
        ghl_refresh_token:    tok.refresh_token || null,
        ghl_token_expires_at: expiresAt,
        ghl_location_id:      tok.locationId || null,
        ghl_company_id:       tok.companyId  || null,
        ghl_connect_status:   "connected",
        ghl_connected_at:     nowIso(),
        updated_at:           nowIso(),
      }),
    });
  } catch (e) {
    return redirectBack(res, "error", `db write: ${e.message}`);
  }

  return redirectBack(res, "connected");
}
