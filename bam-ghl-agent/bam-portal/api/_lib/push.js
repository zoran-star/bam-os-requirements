// Shared push-notification sender for the BAM portal native app.
//
//   iOS     → APNs over HTTP/2, auth via an ES256 JWT signed with the .p8 key
//   Android → FCM HTTP v1, auth via a service-account OAuth token (RS256 JWT)
//
// No third-party deps — Node's built-in crypto + http2 + global fetch
// (Vercel Node 18+). Device tokens are read from / cleaned up in the Supabase
// `device_tokens` table (columns: id, token, platform, auth_user_id,
// client_id). Files under api/_lib are NOT routed by Vercel (underscore
// prefix), so this is import-only.
//
// Required env (set in Vercel — see env/.env.example):
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_P8        (iOS)
//   APNS_ENV = "production" | "sandbox"   (optional, default production)
//   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY         (Android)
//
// Until those exist, the matching platform is skipped gracefully (no throw),
// so wiring a trigger to this never breaks ticket flows before keys land.

import http2 from "node:http2";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// ─── small helpers ──────────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PEM private keys are stored in env with literal "\n" — restore newlines.
function pem(envVar) {
  return (envVar || "").replace(/\\n/g, "\n").trim();
}

function apnsConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID && process.env.APNS_P8);
}
function fcmConfigured() {
  return !!(process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY);
}

async function sbSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`device_tokens select ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sbDeleteToken(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/device_tokens?id=eq.${id}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  }).catch(() => {});
}

// ─── APNs ───────────────────────────────────────────────────────────────────

// The provider JWT is valid up to 60 min and Apple wants it REUSED, not minted
// per request (minting too often gets you throttled). Cache for ~50 min.
let _apnsJwt = { token: null, iat: 0 };
function apnsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_apnsJwt.token && now - _apnsJwt.iat < 3000) return _apnsJwt.token;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }));
  const signingInput = `${header}.${payload}`;
  // ES256 = ECDSA P-256 + SHA-256; JWT needs the raw R||S (ieee-p1363) form,
  // not the DER that crypto emits by default.
  const sig = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: pem(process.env.APNS_P8),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${b64url(sig)}`;
  _apnsJwt = { token, iat: now };
  return token;
}

// Send to every iOS token over a single HTTP/2 connection. Returns per-token
// results and the ids of dead tokens (410 = unregistered) to prune.
async function apnsSendAll(tokens, { title, body, data }) {
  const host = process.env.APNS_ENV === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const jwt = apnsToken();
  const bundle = process.env.APNS_BUNDLE_ID;
  const aps = { aps: { alert: { title, body }, sound: "default" }, ...(data || {}) };
  const payloadStr = JSON.stringify(aps);

  const client = http2.connect(host);
  const results = [];
  const dead = [];
  try {
    await Promise.all(
      tokens.map(
        (t) =>
          new Promise((resolve) => {
            const req = client.request({
              ":method": "POST",
              ":path": `/3/device/${t.token}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": bundle,
              "apns-push-type": "alert",
              "content-type": "application/json",
            });
            let status = 0;
            let respBody = "";
            req.on("response", (h) => { status = h[":status"]; });
            req.setEncoding("utf8");
            req.on("data", (d) => { respBody += d; });
            req.on("end", () => {
              if (status === 410 || /BadDeviceToken|Unregistered/i.test(respBody)) dead.push(t.id);
              results.push({ platform: "ios", id: t.id, ok: status === 200, status, body: respBody || undefined });
              resolve();
            });
            req.on("error", (e) => {
              results.push({ platform: "ios", id: t.id, ok: false, error: e.message });
              resolve();
            });
            req.end(payloadStr);
          })
      )
    );
  } finally {
    client.close();
  }
  return { results, dead };
}

// ─── FCM (HTTP v1) ──────────────────────────────────────────────────────────

let _fcmTok = { token: null, exp: 0 };
async function fcmAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_fcmTok.token && now < _fcmTok.exp - 60) return _fcmTok.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: process.env.FCM_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), pem(process.env.FCM_PRIVATE_KEY)));
  const assertion = `${header}.${claim}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`fcm token ${res.status}: ${JSON.stringify(j)}`);
  _fcmTok = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return _fcmTok.token;
}

async function fcmSendAll(tokens, { title, body, data }) {
  const at = await fcmAccessToken();
  // FCM data values must all be strings.
  const dataStr = {};
  for (const [k, v] of Object.entries(data || {})) dataStr[k] = String(v);
  const url = `https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`;
  const results = [];
  const dead = [];
  await Promise.all(
    tokens.map(async (t) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { token: t.token, notification: { title, body }, data: dataStr } }),
        });
        const txt = await res.text();
        if (res.status === 404 || /UNREGISTERED|InvalidRegistration|NotRegistered/i.test(txt)) dead.push(t.id);
        results.push({ platform: "android", id: t.id, ok: res.ok, status: res.status, body: res.ok ? undefined : txt });
      } catch (e) {
        results.push({ platform: "android", id: t.id, ok: false, error: e.message });
      }
    })
  );
  return { results, dead };
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Send a push to a portal user (all their registered devices).
 * Provide exactly one of auth_user_id or client_id.
 *   - auth_user_id → that one person's devices
 *   - client_id    → every device linked to that client (all teammates)
 *
 * Returns { ok, sent, skipped, results } and never throws for per-device
 * failures — only for a hard config/DB error. Unconfigured platforms are
 * skipped (so calling this before keys exist is safe).
 */
export async function sendPush({ auth_user_id, client_id, title, body, data }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, error: "supabase not configured" };
  if (!title || !body) return { ok: false, error: "title and body required" };
  if (!auth_user_id && !client_id) return { ok: false, error: "auth_user_id or client_id required" };

  const filter = auth_user_id ? `auth_user_id=eq.${auth_user_id}` : `client_id=eq.${client_id}`;
  const tokens = await sbSelect(`device_tokens?${filter}&select=id,token,platform`);
  if (!tokens?.length) return { ok: true, sent: 0, skipped: [], results: [], note: "no registered devices" };

  const ios = tokens.filter((t) => t.platform === "ios");
  const android = tokens.filter((t) => t.platform === "android");
  const results = [];
  const dead = [];
  const skipped = [];

  if (ios.length) {
    if (apnsConfigured()) {
      try {
        const r = await apnsSendAll(ios, { title, body, data });
        results.push(...r.results);
        dead.push(...r.dead);
      } catch (e) {
        results.push({ platform: "ios", ok: false, error: e.message });
      }
    } else {
      skipped.push(`ios(${ios.length}): APNs not configured`);
    }
  }
  if (android.length) {
    if (fcmConfigured()) {
      try {
        const r = await fcmSendAll(android, { title, body, data });
        results.push(...r.results);
        dead.push(...r.dead);
      } catch (e) {
        results.push({ platform: "android", ok: false, error: e.message });
      }
    } else {
      skipped.push(`android(${android.length}): FCM not configured`);
    }
  }

  // Prune dead tokens so the table stays clean (best-effort).
  await Promise.all([...new Set(dead)].map(sbDeleteToken));

  return { ok: true, sent: results.filter((r) => r.ok).length, skipped, results };
}

export const _push = { apnsConfigured, fcmConfigured };
