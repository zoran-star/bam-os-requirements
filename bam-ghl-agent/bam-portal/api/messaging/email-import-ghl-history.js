import { withSentryApiRoute } from "../_sentry.js";
// Email spine: import an academy's GoHighLevel EMAIL history into the email
// own-store (email_threads + email_messages, provider='ghl') before it cuts over
// to Resend, so no past email threads are lost. Email counterpart of
// api/messaging/import-ghl-history.js (SMS).
//
//   POST /api/messaging/email-import-ghl-history { client_id, max_pages? }   (STAFF)
//     → pages GHL /conversations/search, keeps EMAIL messages, fetches each
//       email's subject/body (from meta.email + GET /conversations/messages/email/{id}),
//       upserts email_threads (on client_id, contact_email) + email_messages
//       (idempotent on (client_id, ghl_message_id)).
//
// Read-only against GHL. Writes only to our own store. Dormant w.r.t. live email.
import { pickGhlToken, ghl } from "../ghl/_core.js";

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

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

const norm = (v) => (v == null ? "" : String(v));
const isEmail = (m) => {
  const t = String(m.type ?? m.messageType ?? "").toLowerCase();
  return t.includes("email") || t === "3" || !!(m.meta && m.meta.email);
};

// Fetch an email message's HTML/text body from GHL (the conversation list omits it).
async function fetchEmailBody(token, emailMessageId) {
  if (!emailMessageId) return "";
  try {
    const d = await ghl("GET", `/conversations/messages/email/${encodeURIComponent(emailMessageId)}`, { token });
    const e = d.emailMessage || d.email || d;
    return e.text || e.body || e.html || "";
  } catch (_) { return ""; }
}

// Resolve a conversation's contact email: prefer the convo field, else the portal contact.
async function resolveEmail(clientId, convo) {
  const direct = norm(convo.email || convo.contactEmail).trim().toLowerCase();
  if (direct) return direct;
  const cid = norm(convo.contactId || convo.contact_id);
  if (!cid) return "";
  try {
    const rows = await sb(`contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(cid)}&select=email&limit=1`);
    return (rows && rows[0] && rows[0].email) ? String(rows[0].email).toLowerCase() : "";
  } catch (_) { return ""; }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staff = await requireStaff(req);
  if (!staff) return res.status(401).json({ error: "staff only" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (!b.client_id) return res.status(400).json({ error: "client_id required" });
  const maxPages = Math.min(Number(b.max_pages) || 10, 30);
  const DEADLINE = Date.now() + 12000;

  const rows = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=id,business_name,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_location_id&limit=1`);
  const client = rows && rows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });

  const creds = await pickGhlToken(client);
  if (!creds || !creds.token) return res.status(400).json({ error: "no GHL token for this academy" });
  const { token, locationId } = creds;
  if (!locationId) return res.status(400).json({ error: "no GHL location_id" });

  let convScanned = 0, threadsUpserted = 0, msgInserted = 0, msgSkipped = 0, noEmail = 0, pages = 0;
  let startAfterDate = b.start_after_date || null, startAfter = b.start_after || null;
  let done = false;
  const seen = new Set();

  try {
    while (pages < maxPages) {
      pages++;
      const params = new URLSearchParams({ locationId, limit: "100" });
      if (startAfterDate) params.set("startAfterDate", String(startAfterDate));
      if (startAfter) params.set("startAfter", String(startAfter));
      const data = await ghl("GET", `/conversations/search?${params}`, { token });
      const convos = data.conversations || data.data || [];
      if (!convos.length) { done = true; break; }

      for (const convo of convos) {
        if (!convo || seen.has(convo.id)) continue;
        seen.add(convo.id);
        convScanned++;

        const contactId = norm(convo.contactId || convo.contact_id);
        const contactName = norm(convo.fullName || convo.contactName || convo.name).trim() || null;
        const email = await resolveEmail(client.id, convo);
        if (!email) { noEmail++; continue; }

        // Pull this conversation's messages; keep the EMAIL ones.
        let messages = [];
        try {
          const md = await ghl("GET", `/conversations/${encodeURIComponent(convo.id)}/messages?limit=100`, { token });
          messages = md.messages?.messages || md.messages || md.data || [];
        } catch (_) { messages = []; }
        const emails = messages.filter(isEmail);
        if (!emails.length) continue;

        // Upsert the thread (unique on client_id, contact_email).
        const threadRows = await sb(`email_threads?on_conflict=client_id,contact_email`, {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([{ client_id: client.id, contact_email: email, ghl_contact_id: contactId || null, contact_name: contactName }]),
        });
        const thread = Array.isArray(threadRows) ? threadRows[0] : null;
        if (!thread) continue;
        threadsUpserted++;

        // Skip already-imported (idempotent).
        const ids = emails.map((m) => m.id).filter(Boolean);
        let existing = new Set();
        if (ids.length) {
          const inList = ids.map((x) => `"${x}"`).join(",");
          const ex = await sb(`email_messages?client_id=eq.${client.id}&ghl_message_id=in.(${encodeURIComponent(inList)})&select=ghl_message_id`);
          existing = new Set((ex || []).map((r) => r.ghl_message_id));
        }
        const fresh = emails.filter((m) => m.id && !existing.has(m.id));
        msgSkipped += emails.length - fresh.length;
        if (!fresh.length) continue;

        const payload = [];
        for (const m of fresh) {
          const em = (m.meta && m.meta.email) || {};
          const emailMsgId = Array.isArray(em.messageIds) ? em.messageIds[0] : null;
          const body = m.body || m.message || (await fetchEmailBody(token, emailMsgId));
          payload.push({
            thread_id: thread.id, client_id: client.id, provider: "ghl",
            direction: (em.direction === "outbound" || m.direction === "outbound") ? "outbound" : "inbound",
            channel: "email", subject: em.subject || null, body: body || "",
            status: m.status || null, ghl_message_id: m.id, ghl_conversation_id: convo.id,
            occurred_at: m.dateAdded || m.createdAt || m.timestamp || new Date().toISOString(), raw: m,
          });
          if (Date.now() > DEADLINE) break;
        }
        if (payload.length) {
          await sb(`email_messages`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
          msgInserted += payload.length;
          const latest = payload[payload.length - 1];
          await sb(`email_threads?id=eq.${thread.id}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ last_message_at: latest.occurred_at, last_preview: (latest.body || latest.subject || "").slice(0, 160), last_subject: latest.subject, last_direction: latest.direction, updated_at: new Date().toISOString() }),
          }).catch(() => {});
        }
        if (Date.now() > DEADLINE) break;
      }

      const last = convos[convos.length - 1];
      startAfterDate = last?.lastMessageDate || last?.dateUpdated || last?.dateAdded || null;
      startAfter = last?.id || null;
      if (convos.length < 100 || !startAfterDate) { done = true; break; }
      if (Date.now() > DEADLINE) break;
    }
  } catch (e) {
    return res.status(e.status || 502).json({ error: `import failed: ${e.message}`, progress: { pages, convScanned, threadsUpserted, msgInserted, msgSkipped } });
  }

  return res.status(200).json({
    ok: true, done, client_id: client.id, business_name: client.business_name,
    cursor: done ? null : { start_after_date: startAfterDate, start_after: startAfter },
    pages, conversations_scanned: convScanned, threads_upserted: threadsUpserted,
    messages_imported: msgInserted, messages_skipped: msgSkipped, skipped_no_email: noEmail,
  });
}

export default withSentryApiRoute(handler);
