// Email spine (9/n): send a HUMAN 1-to-1 email OUT through the academy's connected
// mailbox (Gmail), so it lands in their real "Sent" and threads natively. The
// counterpart of maybeSendSmsViaProvider / maybeSendEmailViaResend. DORMANT for any
// academy without an active gmail mailbox -> { handled:false } so the caller runs
// its existing Resend/GHL email path. Automated/bulk email stays on Resend (this
// gate is only wired into the human inbox-reply path, api/ghl/send-message.js).
import {
  sb, norm, getMailbox, accessTokenForMailbox, flagMailbox, gmailPost,
} from "./_mailbox.js";

// RFC 2047 encode a header value if it has non-ASCII (subjects with emoji/accents).
function encodeHeader(v) {
  const s = String(v || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

// Build a base64url RFC822 message for gmail messages.send.
function buildRaw({ from, to, subject, html, text, inReplyTo, references }) {
  const bodyHtml = html || `<p>${(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean).join("\r\n");
  const b64Body = Buffer.from(bodyHtml, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${headers}\r\n\r\n${b64Body}`, "utf8").toString("base64url");
}

// Look up the academy's thread with this contact to (a) thread the reply natively
// and (b) know the thread row for the outbound store write.
async function threadFor(clientId, toEmail) {
  try {
    const rows = await sb(`email_threads?client_id=eq.${encodeURIComponent(clientId)}&contact_email=eq.${encodeURIComponent(norm(toEmail))}&select=id,ghl_contact_id,contact_name&limit=1`);
    if (!rows || !rows[0]) return null;
    const t = rows[0];
    // Most recent message on the thread that carries a gmail thread id / Message-ID
    // so we can thread the reply (In-Reply-To + References + Gmail threadId).
    const msgs = await sb(`email_messages?thread_id=eq.${t.id}&mailbox_thread_id=not.is.null&select=mailbox_thread_id,message_id_header&order=occurred_at.desc&limit=1`);
    const last = msgs && msgs[0];
    return { id: t.id, ghlContactId: t.ghl_contact_id, contactName: t.contact_name, mailboxThreadId: last && last.mailbox_thread_id, lastMessageId: last && last.message_id_header };
  } catch (_) { return null; }
}

// The gate every HUMAN email send site calls FIRST.
//   { handled:false }              -> caller runs its existing Resend/GHL send
//   { handled:true, ok:true, id }  -> sent via Gmail + stored
//   { handled:true, ok:false, err} -> academy has a mailbox but the send failed
// Never throws.
export async function maybeSendEmailViaMailbox(clientOrId, { toEmail, subject, html, text, ghlContactId, sentBy, contactName } = {}) {
  try {
    const clientId = typeof clientOrId === "string" ? clientOrId : (clientOrId && clientOrId.id);
    if (!clientId) return { handled: false };
    const mailbox = await getMailbox(clientId);
    if (!mailbox || mailbox.provider !== "gmail" || mailbox.status !== "active") return { handled: false };
    if (!toEmail) return { handled: true, ok: false, error: "no recipient email for mailbox send" };

    let accessToken;
    try { accessToken = await accessTokenForMailbox(mailbox); }
    catch (e) { await flagMailbox(clientId, "needs_reconnect", e.message); return { handled: true, ok: false, error: "mailbox needs reconnect" }; }

    const thread = await threadFor(clientId, toEmail);
    const raw = buildRaw({
      from: mailbox.email, to: toEmail, subject: subject || "(no subject)", html, text,
      inReplyTo: thread && thread.lastMessageId, references: thread && thread.lastMessageId,
    });

    let sent;
    try {
      sent = await gmailPost(accessToken, "/messages/send", { raw, ...(thread && thread.mailboxThreadId ? { threadId: thread.mailboxThreadId } : {}) });
    } catch (e) {
      if (e.status === 401) await flagMailbox(clientId, "needs_reconnect", e.message);
      return { handled: true, ok: false, error: e.message };
    }

    // Store the outbound row immediately (instant UI). Idempotent on the returned
    // message id, so the sync cron won't double-insert when it sees this SENT mail.
    try {
      const occurred = new Date().toISOString();
      const trow = thread || (await (async () => {
        const rows = await sb(`email_threads?on_conflict=client_id,contact_email`, {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([{ client_id: clientId, contact_email: norm(toEmail), ghl_contact_id: ghlContactId || null, contact_name: contactName || null, last_subject: subject || null }]),
        });
        const r = Array.isArray(rows) ? rows[0] : null;
        return r ? { id: r.id } : null;
      })());
      if (trow) {
        const preview = (text || String(html || "").replace(/<[^>]+>/g, " ")).trim().slice(0, 160);
        await sb(`email_messages?on_conflict=client_id,mailbox_message_id`, {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify([{ thread_id: trow.id, client_id: clientId, provider: "gmail", direction: "outbound", channel: "email", subject: subject || null, body: text || html || "", status: "sent", mailbox_message_id: sent.id || null, mailbox_thread_id: sent.threadId || null, sent_by: sentBy || null, occurred_at: occurred }]),
        }).catch(() => {});
        await sb(`email_threads?id=eq.${trow.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ last_message_at: occurred, last_preview: preview, last_subject: subject || null, last_direction: "outbound", unread: false, updated_at: occurred }),
        }).catch(() => {});
      }
    } catch (_) { /* store best-effort */ }

    return { handled: true, ok: true, id: sent.id || null };
  } catch (e) {
    return { handled: true, ok: false, error: e.message || String(e) };
  }
}
