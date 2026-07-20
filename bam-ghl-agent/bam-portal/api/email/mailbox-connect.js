import { withSentryApiRoute } from "../_sentry.js";
// Email spine (7/n): connect an academy's OWN Google mailbox for 2-way sync.
// One-time OAuth; the connection itself is the proof of which inbox is tied (we
// store the Google-returned address, never a typed guess) and we domain-validate
// it against clients.email_domain so a personal @gmail can't be wired by mistake.
//
// Reached via explicit vercel.json rewrites (like api/google-oauth.js):
//   GET /api/email/connect?token=<supabase access token>&client_id=<academy>[&ret=<origin>]
//   GET /api/email/callback?code=...&state=<b64url>
//
// login   -> verify the initiator (staff OR a member of that academy), redirect to
//            Google's consent screen with Gmail scopes.
// callback -> exchange code, confirm the connected address's domain matches the
//            academy on file, store the encrypted refresh token in client_mailboxes.
import {
  GMAIL_SCOPES, exchangeGoogleCode, googleProfileEmail, saveGoogleMailbox,
  sb, norm, domainOf,
} from "./_mailbox.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// The mailbox connect is academy-facing, so it anchors to the client portal host
// (where the APIs/webhooks live). The registered redirect URI in Google Cloud MUST
// match this exactly. Override with EMAIL_OAUTH_BASE_URL if the host ever changes.
const OAUTH_BASE = (process.env.EMAIL_OAUTH_BASE_URL || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
// Only ever redirect the browser back to a host we own (no open redirect).
const RETURN_ALLOWLIST = [
  "https://portal.byanymeansbusiness.com",
  "https://staff.byanymeansbusiness.com",
];
function safeReturn(origin) {
  const o = String(origin || "").replace(/\/+$/, "");
  if (RETURN_ALLOWLIST.includes(o)) return o;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return OAUTH_BASE;
}

const b64urlEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
function b64urlDecode(s) { try { return JSON.parse(Buffer.from(String(s || ""), "base64url").toString("utf8")); } catch (_) { return null; } }

async function verifySupabaseUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch (_) { return null; }
}

// May this user connect a mailbox for this academy? Staff (any client) OR an active
// member of that academy. Mirrors the staff-vs-client_users check used across api/.
async function canManageClient(user, clientId) {
  if (!user || !clientId) return false;
  try {
    let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
    if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
    if (staff && staff[0]) return true;
    const m = await sb(`client_users?user_id=eq.${user.id}&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=client_id&limit=1`);
    return !!(m && m[0]);
  } catch (_) { return false; }
}

async function handler(req, res) {
  const step = req.query.step;
  const redirectUri = `${OAUTH_BASE}/api/email/callback`;

  // ── LOGIN ──
  if (step === "login") {
    const { token, client_id: clientId, ret } = req.query;
    const user = await verifySupabaseUser(token);
    if (!user) return res.status(401).send("Not signed in. Open the portal, then connect your inbox from Settings.");
    if (!clientId) return res.status(400).send("Missing client_id.");
    if (!GOOGLE_CLIENT_ID) return res.status(500).send("GOOGLE_CLIENT_ID not configured");
    if (!(await canManageClient(user, clientId))) return res.status(403).send("You do not have access to this academy.");

    // Require the academy to have its sending domain on file so we can validate the
    // connected inbox against it (and so it lines up with the Resend send-from).
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=email_domain&limit=1`);
    const emailDomain = rows && rows[0] && rows[0].email_domain;
    if (!emailDomain) {
      return res.redirect(302, `${safeReturn(ret)}/?mailbox=error&reason=no_domain_on_file`);
    }

    const state = b64urlEncode({ t: token, c: clientId, r: safeReturn(ret), d: norm(emailDomain) });
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      // Nudge Google to pre-fill the academy's shared inbox.
      login_hint: `info@${norm(emailDomain)}`,
      state,
    });
    return res.redirect(302, authUrl);
  }

  // ── CALLBACK ──
  if (step === "callback") {
    const { code, state, error } = req.query;
    const st = b64urlDecode(state);
    const ret = safeReturn(st && st.r);
    if (error || !code || !st) return res.redirect(302, `${ret}/?mailbox=error&reason=${encodeURIComponent(error || "bad_state")}`);

    const user = await verifySupabaseUser(st.t);
    if (!user || !(await canManageClient(user, st.c))) {
      return res.redirect(302, `${ret}/?mailbox=error&reason=auth`);
    }

    try {
      const tokens = await exchangeGoogleCode(code, redirectUri);
      // No refresh_token => Google didn't issue one (prior grant). prompt=consent
      // should force it; if not, surface so we don't store a half connection.
      if (tokens.error || !tokens.refresh_token) {
        return res.redirect(302, `${ret}/?mailbox=error&reason=no_refresh_token`);
      }

      const connectedEmail = await googleProfileEmail(tokens.access_token);
      if (!connectedEmail) return res.redirect(302, `${ret}/?mailbox=error&reason=no_email`);

      // THE GUARANTEE: the connected inbox's domain must match the academy on file.
      if (domainOf(connectedEmail) !== norm(st.d)) {
        return res.redirect(302, `${ret}/?mailbox=error&reason=domain_mismatch&got=${encodeURIComponent(connectedEmail)}&want=${encodeURIComponent(st.d)}`);
      }

      await saveGoogleMailbox({
        clientId: st.c,
        email: connectedEmail,
        refreshToken: tokens.refresh_token,
        connectedBy: user.email || user.id,
      });
      return res.redirect(302, `${ret}/?mailbox=connected&email=${encodeURIComponent(connectedEmail)}`);
    } catch (err) {
      console.error("mailbox connect callback error:", err?.message || err);
      return res.redirect(302, `${ret}/?mailbox=error&reason=exception`);
    }
  }

  return res.status(404).json({ error: "unknown step (expected login or callback)" });
}

export default withSentryApiRoute(handler);
