// Email spine (2/n): outbound provider resolver + a SAFE gate that every email
// send site funnels through, mirroring api/messaging/provider.js (SMS). DORMANT:
// returns "not handled" for any academy not on email_provider='resend', so the
// existing GHL email path runs unchanged. Never throws to the caller.
//
// Unlike SMS (per-academy Twilio creds), email uses the single BAM Resend account
// (RESEND_API_KEY) sending from the academy's verified domain. The lead stays tied
// to its GHL contact (email_threads.ghl_contact_id) so pipeline + agents keep working.
import { sendEmail } from "../_email.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const _cache = new Map(); // clientId -> { at, provider, domain }
const TTL = 30_000;

async function resolveEmail(clientId) {
  if (!clientId) return { provider: "ghl", domain: null };
  const hit = _cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let out = { at: Date.now(), provider: "ghl", domain: null };
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=email_provider,email_domain&limit=1`);
    if (rows && rows[0]) {
      out.domain = rows[0].email_domain || null;
      if (rows[0].email_provider === "resend") out.provider = "resend";
    }
  } catch (_) { /* default ghl */ }
  _cache.set(clientId, out);
  return out;
}

// Accepts a client object or a bare clientId.
export async function emailProvider(clientOrId) {
  const id = typeof clientOrId === "string" ? clientOrId : (clientOrId && clientOrId.id);
  return (await resolveEmail(id)).provider;
}

const norm = (e) => String(e || "").trim().toLowerCase();

async function upsertThread(clientId, email, ghlContactId, name, subject) {
  const rows = await sb(`email_threads?on_conflict=client_id,contact_email`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ client_id: clientId, contact_email: norm(email), ghl_contact_id: ghlContactId || null, contact_name: name || null, last_subject: subject || null }]),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

// The gate every email send site calls FIRST.
//   { handled:false }                 -> caller runs its existing GHL email send
//   { handled:true, ok:true, id }     -> sent via Resend + stored
//   { handled:true, ok:false, error } -> academy is resend but send failed
// Never throws.
export async function maybeSendEmailViaResend(clientOrId, { toEmail, subject, html, text, ghlContactId, sentBy, contactName } = {}) {
  try {
    const clientId = typeof clientOrId === "string" ? clientOrId : (clientOrId && clientOrId.id);
    if (!clientId) return { handled: false };
    const info = await resolveEmail(clientId);
    if (info.provider !== "resend") return { handled: false };
    if (!toEmail) return { handled: true, ok: false, error: "no email for resend send" };

    const from = info.domain ? `info@${info.domain}` : undefined; // else _email.js default
    const r = await sendEmail({ to: toEmail, subject: subject || "(no subject)", html, text, from, replyTo: from, clientId });
    if (r && r.skipped) return { handled: true, ok: false, error: "recipient suppressed" };

    // Record in the own-store (best-effort - a store hiccup never fails the send).
    try {
      const thread = await upsertThread(clientId, toEmail, ghlContactId, contactName, subject);
      if (thread) {
        const occurred = new Date().toISOString();
        const preview = (text || String(html || "").replace(/<[^>]+>/g, " ")).trim().slice(0, 160);
        await sb(`email_messages`, {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{ thread_id: thread.id, client_id: clientId, provider: "resend", direction: "outbound", channel: "email", subject: subject || null, body: text || html || "", status: "sent", resend_id: (r && r.id) || null, sent_by: sentBy || null, occurred_at: occurred, raw: r || null }]),
        }).catch(() => {});
        await sb(`email_threads?id=eq.${thread.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          // unread:false - replying means the inbound was handled (nothing else
          // ever clears the flag; per-user receipts cover read-without-reply).
          body: JSON.stringify({ last_message_at: occurred, last_preview: preview, last_subject: subject || null, last_direction: "outbound", unread: false, updated_at: occurred }),
        }).catch(() => {});
      }
    } catch (_) { /* store best-effort */ }

    return { handled: true, ok: true, id: (r && r.id) || null };
  } catch (e) {
    return { handled: true, ok: false, error: e.message || String(e) };
  }
}
