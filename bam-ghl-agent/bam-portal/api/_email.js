// Shared email sender - the one place portal-native email goes out (Lead Nurture,
// Ghosted email, agent first-touches, etc.). Parallels `sendSms` in api/ghl/_core.js.
//
// Resend is already wired for the auth emails (invite / reset-password) in
// api/clients.js via raw fetch to https://api.resend.com/emails. This centralizes
// that into a reusable sender WITH a suppression gate (never email a hard-bounced or
// complained address) and an email_events audit trail. Dependency-free (raw fetch),
// matching the rest of the codebase.
//
// FROM: defaults to GTA's branded sender info@byanymeanstoronto.ca. That domain is
// DNS-verified in Resend (the .com is NOT verified - sending from it 403s, which is
// why this is .ca). The auth emails send from the verified byanymeansbball.com and
// are intentionally left alone.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const DEFAULT_FROM         = process.env.RESEND_FROM || "BAM Toronto <info@byanymeanstoronto.ca>";

// Service-role Supabase REST helper (same shape as api/agent-confirm.js).
async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();

// Is this address on the suppression list (hard bounce / complaint / unsubscribe)?
// Fails OPEN (returns false) on a DB error so a transient blip doesn't silently
// stop all email - the webhook is the durable suppression source of truth.
export async function isSuppressed(email) {
  const e = normEmail(email);
  if (!e) return false;
  try {
    const rows = await sb(`email_suppressions?email=eq.${encodeURIComponent(e)}&select=email&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.error("[_email] isSuppressed check failed (failing open):", err.message);
    return false;
  }
}

// Best-effort audit row. Never throws.
async function logEmailEvent({ clientId, email, providerId, type, payload }) {
  try {
    await sb(`email_events`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ client_id: clientId || null, email: normEmail(email) || null, provider_message_id: providerId || null, type: type || "sent", payload: payload || null }]),
    });
  } catch (_) { /* audit is best-effort */ }
}

// Send one email through Resend. Returns { id } on success, { skipped } if the
// recipient is suppressed, and THROWS on a Resend error (so callers can react).
export async function sendEmail({ to, subject, html, text, from, replyTo, tags, clientId } = {}) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const recipient = normEmail(to);
  if (!recipient) throw new Error("sendEmail: 'to' is required");
  if (!subject) throw new Error("sendEmail: 'subject' is required");
  if (!html && !text) throw new Error("sendEmail: 'html' or 'text' is required");

  if (await isSuppressed(recipient)) {
    await logEmailEvent({ clientId, email: recipient, type: "suppressed_skip" });
    return { skipped: "suppressed" };
  }

  const body = {
    from: from || DEFAULT_FROM,
    to: [recipient],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(Array.isArray(tags) && tags.length ? { tags } : {}),
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) {
    console.error("[_email] Resend send failed:", txt.slice(0, 300));
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  let id = null;
  try { id = (txt ? JSON.parse(txt) : {}).id || null; } catch (_) {}
  await logEmailEvent({ clientId, email: recipient, providerId: id, type: "sent" });
  return { id };
}
