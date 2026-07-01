// Email spine (4/n): read a lead's EMAIL thread from the own-store
// (email_messages), for academies on email_provider='resend'. Mirrors
// api/messaging/read-thread.js (SMS) with type:"Email". Merged alongside the SMS
// store by api/ghl/inbox.js so the own-store inbox shows both channels.
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function threadByContact(clientId, ghlContactId) {
  if (!clientId || !ghlContactId) return null;
  const rows = await sb(`email_threads?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=id&limit=1`);
  return (rows && rows[0]) || null;
}

const mapMsg = (m) => ({
  id: m.id, body: m.body || "", subject: m.subject || "", type: "Email",
  direction: m.direction || "", status: m.status || "",
  date: m.occurred_at, attachments: [],
});

// Agent thread context — same shape the GHL/SMS helpers return.
export async function readEmailStoreThreadAgent(clientId, ghlContactId) {
  try {
    const thread = await threadByContact(clientId, ghlContactId);
    if (!thread) return [];
    const msgs = await sb(`email_messages?thread_id=eq.${thread.id}&select=direction,body,occurred_at&order=occurred_at.asc&limit=300`);
    return (msgs || []).filter((m) => m.body).map((m) => ({
      role: m.direction === "outbound" ? "agent" : "parent",
      text: m.body, date: m.occurred_at,
    }));
  } catch (e) { console.error("readEmailStoreThreadAgent:", e.message); return []; }
}

export async function readEmailStoreThreadInbox(clientId, ghlContactId) {
  const thread = await threadByContact(clientId, ghlContactId);
  if (!thread) return { conversation_id: null, messages: [] };
  const msgs = await sb(`email_messages?thread_id=eq.${thread.id}&select=id,direction,body,subject,occurred_at,status&order=occurred_at.asc&limit=300`);
  return { conversation_id: thread.id, messages: (msgs || []).map(mapMsg) };
}

export async function readEmailStoreThreadById(threadId) {
  const msgs = await sb(`email_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=id,direction,body,subject,occurred_at,status&order=occurred_at.asc&limit=300`);
  return { conversation_id: threadId, messages: (msgs || []).map(mapMsg) };
}

// Inbox conversation list from the email store (newest activity first).
export async function listEmailStoreThreads(clientId) {
  const rows = await sb(`email_threads?client_id=eq.${encodeURIComponent(clientId)}&select=id,contact_email,ghl_contact_id,contact_name,last_message_at,last_preview,last_direction,unread&order=last_message_at.desc.nullslast&limit=200`);
  return (rows || []).map((t) => ({
    id: t.id,
    contactId: t.ghl_contact_id || null,
    contactName: t.contact_name || t.contact_email || "Lead",
    email: t.contact_email,
    channel: "Email",
    lastMessageBody: t.last_preview || "",
    lastMessageDate: t.last_message_at,
    lastMessageDirection: t.last_direction || "",
    unreadCount: t.unread ? 1 : 0,
  }));
}
