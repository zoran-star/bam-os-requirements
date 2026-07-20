// Email spine (6/n): connected-mailbox helpers, shared by the connect flow,
// inbound sync, and human-send routing. Google (Gmail API) first; Outlook (Graph)
// and IMAP/SMTP land in later phases with the same shape. Dependency-free raw
// fetch, matching the rest of api/. Refresh tokens are stored encrypted in
// client_mailboxes via the same AES-256-GCM crypto as the Twilio creds.
import { encryptSecret, decryptSecret } from "../messaging/_crypto.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Gmail scopes for 2-way sync. gmail.modify ALONE covers read + compose + send +
// mark-read/label (Gmail's messages.send accepts gmail.modify), so we don't add a
// separate gmail.send. userinfo.email lets us domain-validate the connection.
// gmail.modify is a RESTRICTED scope -> the Google Cloud OAuth app needs
// verification (CASA) before non-test users can consent; Testing mode is fine now.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export { encryptSecret, decryptSecret };

export async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export const norm = (e) => String(e || "").trim().toLowerCase();
export function domainOf(addr) { const a = norm(addr); const i = a.lastIndexOf("@"); return i >= 0 ? a.slice(i + 1) : ""; }

// Exchange an authorization code for tokens (Google). Returns the raw token JSON.
export async function exchangeGoogleCode(code, redirectUri) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return r.json();
}

// A fresh access token from the stored refresh token. Google access tokens last
// ~1h; we never persist them - refresh on demand (mirrors the calendar flow).
export async function freshGoogleAccessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google refresh failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// Which Google account is this token for? Used to domain-validate the connection.
export async function googleProfileEmail(accessToken) {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json())?.email || null;
}

// Load a client's connected mailbox row (or null). Decrypts nothing by itself.
export async function getMailbox(clientId) {
  if (!clientId) return null;
  const rows = await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}&limit=1`);
  return (rows && rows[0]) || null;
}

// Upsert a Google mailbox connection (one per academy).
export async function saveGoogleMailbox({ clientId, email, refreshToken, connectedBy, historyId }) {
  const now = new Date().toISOString();
  await sb(`client_mailboxes?on_conflict=client_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      client_id: clientId,
      provider: "gmail",
      email: norm(email),
      refresh_token_enc: encryptSecret(refreshToken),
      history_id: historyId || null,
      status: "active",
      last_error: null,
      connected_by: connectedBy || null,
      updated_at: now,
    }]),
  });
}
