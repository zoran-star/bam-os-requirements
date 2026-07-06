// ─────────────────────────────────────────────────────────────────────────
// api/push/_send.js — native push notification core (APNs, dependency-free)
// ─────────────────────────────────────────────────────────────────────────
// The reusable engine every push trigger calls. Looks up a client's device
// tokens (captured by the Capacitor wrapper into `device_tokens`) and sends
// an APNs alert with a `data` payload the app uses to DEEP-LINK to the right
// screen (see client-portal.html pushNotificationActionPerformed).
//
// Auth to APNs is TOKEN-BASED (.p8 key) — one key works for sandbox AND
// production; we just pick the host. We try the configured env first and
// auto-retry the other host on BadDeviceToken, so dev/TestFlight tokens and
// App Store tokens both deliver without per-build config.
//
// Required Vercel env (set once the APNs .p8 key exists — see
// memories/project_app_store_launch.md):
//   APNS_KEY_P8        — the .p8 private key contents (PEM). Or base64 in
//                        APNS_KEY_P8_BASE64 if multiline env is awkward.
//   APNS_KEY_ID        — the 10-char Key ID of the .p8 key
//   APNS_TEAM_ID       — the Apple Developer Team ID
//   APNS_TOPIC         — the bundle id (default com.byanymeansbusiness.portal)
//   APNS_ENV           — 'production' (default) | 'sandbox'
//
// If APNs env is not configured, every send is a SILENT no-op (logged once)
// so triggers wired into live routes never throw before the key is added.
// ─────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import http2 from "node:http2";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const APNS_TOPIC = process.env.APNS_TOPIC || "com.byanymeansbusiness.portal";
const APNS_HOST_PROD = "api.push.apple.com";
const APNS_HOST_SANDBOX = "api.sandbox.push.apple.com";

// ── Supabase REST (service role — mirrors api/messages.js sb()) ────────────
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

// ── APNs config + provider JWT (cached; APNs wants 20min<age<60min) ────────
function apnsConfigured() {
  return !!(
    (process.env.APNS_KEY_P8 || process.env.APNS_KEY_P8_BASE64) &&
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID
  );
}

function p8Pem() {
  if (process.env.APNS_KEY_P8) return process.env.APNS_KEY_P8.replace(/\\n/g, "\n");
  return Buffer.from(process.env.APNS_KEY_P8_BASE64, "base64").toString("utf8");
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let _jwtCache = { token: null, iat: 0 };
function providerJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (_jwtCache.token && now - _jwtCache.iat < 50 * 60) return _jwtCache.token; // reuse <50min
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }));
  const signingInput = `${header}.${claims}`;
  const sig = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: p8Pem(),
    dsaEncoding: "ieee-p1363", // ES256 raw r||s, required by APNs
  });
  const token = `${signingInput}.${b64url(sig)}`;
  _jwtCache = { token, iat: now };
  return token;
}

// ── Low-level: send one alert to one device token on one host ──────────────
function postToApns(host, deviceToken, jwt, payload) {
  return new Promise((resolve) => {
    let client;
    try {
      client = http2.connect(`https://${host}`);
    } catch (e) {
      return resolve({ status: 0, reason: String(e) });
    }
    client.on("error", (e) => resolve({ status: 0, reason: String(e) }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.setEncoding("utf8");
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      try { client.close(); } catch {}
      let reason = "";
      try { reason = body ? (JSON.parse(body).reason || "") : ""; } catch {}
      resolve({ status, reason });
    });
    req.on("error", (e) => {
      try { client.close(); } catch {}
      resolve({ status: 0, reason: String(e) });
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Send to one token, auto-falling-back to the other APNs host on a token/env
// mismatch (BadDeviceToken). Prunes dead tokens (Unregistered/BadDeviceToken).
async function sendToToken(deviceToken, payload) {
  const jwt = providerJwt();
  const primary =
    (process.env.APNS_ENV || "production") === "sandbox"
      ? APNS_HOST_SANDBOX
      : APNS_HOST_PROD;
  const secondary = primary === APNS_HOST_PROD ? APNS_HOST_SANDBOX : APNS_HOST_PROD;

  let r = await postToApns(primary, deviceToken, jwt, payload);
  if (r.status === 400 && r.reason === "BadDeviceToken") {
    r = await postToApns(secondary, deviceToken, jwt, payload); // dev/prod mismatch
  }
  // Apple says drop these tokens — they'll never deliver again.
  if (r.reason === "Unregistered" || r.reason === "BadDeviceToken") {
    try {
      await sb(`device_tokens?token=eq.${encodeURIComponent(deviceToken)}`, { method: "DELETE" });
    } catch {}
  }
  return r;
}

// ── Event catalog — the single source of truth for WHAT we send ───────────
// Each builder returns { title, body }. `data` (for deep-linking) is added by
// the caller. Keep copy short, actionable, never spammy.
const EVENTS = {
  "ticket-action-needed": (d) => ({
    title: "Action needed",
    body: `BAM needs your input on "${d.ticketTitle || "your request"}"`,
  }),
  "ticket-complete": (d) => ({
    title: "Request complete ✅",
    body: `"${d.ticketTitle || "Your request"}" is done`,
  }),
  "action-item-assigned": (d) => ({
    title: "New action item",
    body: d.label || "You have a new action item",
  }),
  "action-item-due-soon": (d) => ({
    title: "Due tomorrow",
    body: `Reminder: "${d.label || "an action item"}" is due soon`,
  }),
  "payment-failed": (d) => ({
    title: "Payment failed",
    body: `${d.name || "A member"}'s payment didn't go through - they're flagged in your portal`,
  }),
  "hawkeye-ready": (d) => ({
    title: "Hawkeye has something for you",
    body: (d.count || 1) > 1 ? `${d.count} drafts are waiting for your approval` : "A draft is waiting for your approval",
  }),
  "new-message": (d) => ({
    title: d.sender ? `New message from ${d.sender}` : "New message",
    body: d.preview || "You have a new message from your BAM team",
  }),
  "campaign-milestone": (d) => ({
    title: `Campaign ${d.state || "updated"}`,
    body: `"${d.campaign || "Your campaign"}" is now ${d.state || "updated"}`,
  }),
  "weekly-digest": (d) => ({
    title: "This week",
    body: d.summary || "Your weekly performance summary is ready",
  }),
};

// Build the full APNs payload for an event + deep-link data.
function buildPayload(kind, detail = {}) {
  const tmpl = EVENTS[kind];
  if (!tmpl) throw new Error(`Unknown push event kind: ${kind}`);
  const { title, body } = tmpl(detail);
  return {
    aps: {
      alert: { title, body },
      sound: "default",
      "thread-id": kind,
      // badge intentionally omitted here — the app recomputes its own count
    },
    // Custom keys → delivered to the app for deep-linking (#15)
    type: kind,
    ticketId: detail.ticketId || null,
    itemId: detail.itemId || null,
    conversationId: detail.conversationId || null,
    view: detail.view || null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

// Fire-and-forget push to every device of one client. NEVER throws — a push
// failure must not break the business action that triggered it.
export async function notifyClientPush(clientId, kind, detail = {}) {
  try {
    if (!clientId || !apnsConfigured()) {
      if (!apnsConfigured()) console.log("[push] APNs not configured — skip send");
      return { sent: 0, skipped: true };
    }
    const rows = await sb(
      `device_tokens?client_id=eq.${clientId}&platform=eq.ios&select=token`
    );
    if (!rows || !rows.length) return { sent: 0 };
    const payload = buildPayload(kind, detail);
    const results = await Promise.all(rows.map((r) => sendToToken(r.token, payload)));
    const sent = results.filter((r) => r.status === 200).length;
    console.log(`[push] ${kind} → client ${clientId}: ${sent}/${rows.length} delivered`);
    return { sent, total: rows.length, results };
  } catch (e) {
    console.warn("[push] notifyClientPush error:", e?.message || e);
    return { sent: 0, error: true };
  }
}

// Same, but addressed to a single auth user (e.g. one teammate's devices).
export async function notifyAuthUserPush(authUserId, kind, detail = {}) {
  try {
    if (!authUserId || !apnsConfigured()) return { sent: 0, skipped: !apnsConfigured() };
    const rows = await sb(
      `device_tokens?auth_user_id=eq.${authUserId}&platform=eq.ios&select=token`
    );
    if (!rows || !rows.length) return { sent: 0 };
    const payload = buildPayload(kind, detail);
    const results = await Promise.all(rows.map((r) => sendToToken(r.token, payload)));
    const sent = results.filter((r) => r.status === 200).length;
    return { sent, total: rows.length, results };
  } catch (e) {
    console.warn("[push] notifyAuthUserPush error:", e?.message || e);
    return { sent: 0, error: true };
  }
}

export { apnsConfigured, EVENTS, buildPayload };
