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

// Mark a mailbox as needing reconnect (e.g. refresh token revoked). Surfaced as a
// red badge in the UI; the sync/send paths skip it until reconnected.
export async function flagMailbox(clientId, status, lastError) {
  try {
    await sb(`client_mailboxes?client_id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, last_error: (lastError || "").slice(0, 300), updated_at: new Date().toISOString() }),
    });
  } catch (_) { /* best-effort */ }
}

// A fresh access token for a stored mailbox row. Throws (caller flags reconnect) if
// the refresh token is gone/revoked.
export async function accessTokenForMailbox(mailbox) {
  const rt = decryptSecret(mailbox.refresh_token_enc);
  if (!rt) throw new Error("no refresh token stored");
  return freshGoogleAccessToken(rt);
}

// ── Gmail REST helpers (v1) ────────────────────────────────────────────────────
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export async function gmailGet(accessToken, path) {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { const t = await r.text(); const e = new Error(`gmail ${r.status}: ${t.slice(0, 200)}`); e.status = r.status; throw e; }
  return r.json();
}
export async function gmailPost(accessToken, path, body) {
  const r = await fetch(`${GMAIL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); const e = new Error(`gmail ${r.status}: ${t.slice(0, 200)}`); e.status = r.status; throw e; }
  return r.json();
}

// The mailbox's current historyId (sync cursor baseline).
export async function gmailProfileHistoryId(accessToken) {
  const p = await gmailGet(accessToken, "/profile");
  return p.historyId || null;
}

const b64urlToUtf8 = (s) => { try { return Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch (_) { return ""; } };

function walkParts(payload, out) {
  if (!payload) return;
  const mime = payload.mimeType || "";
  if (payload.body && payload.body.data) {
    if (mime === "text/plain") out.text += b64urlToUtf8(payload.body.data);
    else if (mime === "text/html") out.html += b64urlToUtf8(payload.body.data);
  }
  for (const p of payload.parts || []) walkParts(p, out);
}

// Normalize a full Gmail message resource into the shape the store wants.
export function parseGmailMessage(msg) {
  const headers = {};
  for (const h of (msg.payload && msg.payload.headers) || []) headers[String(h.name || "").toLowerCase()] = h.value || "";
  const labels = msg.labelIds || [];
  const outbound = labels.includes("SENT") && !labels.includes("INBOX");
  const bodyParts = { text: "", html: "" };
  walkParts(msg.payload, bodyParts);
  const bodyText = (bodyParts.text || bodyParts.html.replace(/<[^>]+>/g, " ") || msg.snippet || "").trim();
  return {
    id: msg.id,
    threadId: msg.threadId,
    direction: outbound ? "outbound" : "inbound",
    from: headers.from || "",
    to: headers.to || "",
    subject: headers.subject || "",
    messageIdHeader: headers["message-id"] || null,
    inReplyTo: headers["in-reply-to"] || null,
    body: bodyText,
    internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
  };
}
