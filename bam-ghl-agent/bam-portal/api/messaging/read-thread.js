// Messaging spine (5/5): read a lead's thread from the own-store (sms_messages),
// for academies on messaging_provider='twilio'. Two shapes:
//   readStoreThreadAgent  -> [{ role:'agent'|'parent', text, date }]  (agent context)
//   readStoreThreadInbox  -> { messages:[{ id, body, direction, type, date }] } (inbox UI)
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function threadByContact(clientId, ghlContactId) {
  if (!clientId || !ghlContactId) return null;
  const rows = await sb(`sms_threads?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=id&limit=1`);
  return (rows && rows[0]) || null;
}

// Agent thread context — same shape the GHL threadMessages() helper returns.
export async function readStoreThreadAgent(clientId, ghlContactId) {
  try {
    const thread = await threadByContact(clientId, ghlContactId);
    if (!thread) return [];
    const msgs = await sb(`sms_messages?thread_id=eq.${thread.id}&channel=eq.sms&select=direction,body,occurred_at&order=occurred_at.asc&limit=300`);
    return (msgs || [])
      // inbound tapbacks ("Liked ...") never register as messages (Zoran 2026-07-09)
      .filter((m) => m.body && !(m.direction !== "outbound" && /^Liked\b/.test(String(m.body).trim())))
      .map((m) => ({
        role: m.direction === "outbound" ? "agent" : "parent",
        text: m.body,
        date: m.occurred_at,
      }));
  } catch (e) { console.error("readStoreThreadAgent:", e.message); return []; }
}

// Parked Hawkeye sends: an approved reply whose send is held on send_after
// (quiet hours). Surfaced in the inbox thread as status:'scheduled' bubbles so
// an approved message never looks like it silently vanished - the exact
// confusion behind "I thought I sent a message and it never sent".
const REPLY_TABLES = ["agent_ready_replies", "agent_confirm_replies", "agent_closing_replies"];
export async function scheduledStoreMessages(clientId, ghlContactId) {
  if (!clientId || !ghlContactId) return [];
  try {
    const parts = await Promise.all(REPLY_TABLES.map((t) =>
      sb(`${t}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&status=eq.approved&sent_at=is.null&send_after=not.is.null&select=id,draft_message,send_after,approved_at,created_at`).catch(() => [])
    ));
    return parts.flat()
      .filter((r) => r && r.draft_message && String(r.draft_message).trim())
      .map((r) => ({
        id: `sched:${r.id}`, body: r.draft_message, type: "SMS",
        direction: "outbound", status: "scheduled",
        date: r.approved_at || r.created_at || r.send_after,
        send_after: r.send_after, attachments: [],
      }));
  } catch (e) { console.error("scheduledStoreMessages:", e.message); return []; }
}

// Inbox thread view — mapped to the inbox API's message shape.
export async function readStoreThreadInbox(clientId, ghlContactId) {
  const thread = await threadByContact(clientId, ghlContactId);
  if (!thread) return { conversation_id: null, messages: [] };
  const [msgs, sched] = await Promise.all([
    sb(`sms_messages?thread_id=eq.${thread.id}&select=id,direction,body,occurred_at,status&order=occurred_at.asc&limit=300`),
    scheduledStoreMessages(clientId, ghlContactId),
  ]);
  return {
    conversation_id: thread.id,
    messages: [
      ...(msgs || []).map((m) => ({
        id: m.id, body: m.body || "", type: "SMS",
        direction: m.direction || "", status: m.status || "",
        date: m.occurred_at, attachments: [],
      })),
      ...sched,
    ],
  };
}

// Inbox thread view by thread id (the id listStoreThreads returns as conversation id).
export async function readStoreThreadById(threadId) {
  const [msgs, trows] = await Promise.all([
    sb(`sms_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=id,direction,body,occurred_at,status&order=occurred_at.asc&limit=300`),
    sb(`sms_threads?id=eq.${encodeURIComponent(threadId)}&select=client_id,ghl_contact_id&limit=1`).catch(() => null),
  ]);
  const t = (trows && trows[0]) || null;
  const sched = t ? await scheduledStoreMessages(t.client_id, t.ghl_contact_id) : [];
  return {
    conversation_id: threadId,
    messages: [
      ...(msgs || []).map((m) => ({
        id: m.id, body: m.body || "", type: "SMS",
        direction: m.direction || "", status: m.status || "",
        date: m.occurred_at, attachments: [],
      })),
      ...sched,
    ],
  };
}

// Inbox conversation list from the store (newest activity first).
export async function listStoreThreads(clientId) {
  const rows = await sb(`sms_threads?client_id=eq.${encodeURIComponent(clientId)}&select=id,contact_phone,ghl_contact_id,contact_name,last_message_at,last_preview,last_direction,unread&order=last_message_at.desc.nullslast&limit=200`);
  return (rows || []).map((t) => ({
    id: t.id,
    contactId: t.ghl_contact_id || null,
    contactName: t.contact_name || t.contact_phone || "Lead",
    phone: t.contact_phone,
    lastMessageBody: t.last_preview || "",
    lastMessageDate: t.last_message_at,
    lastMessageDirection: t.last_direction || "",
    unreadCount: t.unread ? 1 : 0,
  }));
}
