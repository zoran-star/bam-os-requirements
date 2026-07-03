// Meta DM spine (4/4): read dm_threads/dm_messages for the inbox + send DMs
// via the Graph API. The Meta counterpart of api/messaging/read-thread.js
// (store reads) and api/messaging/provider.js (the "maybe send" gate that
// every send site funnels through). DORMANT: everything here no-ops unless
// the academy has a client_meta_messaging_config row with status='active'.
import { decryptSecret } from "../messaging/_crypto.js";

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GRAPH = "https://graph.facebook.com/v22.0";   // keep in step with marketing.js META_API_VERSION

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Active config for the academy, or null. Null = the whole module stays dormant
// (inbox keeps serving social via the GHL passthrough, sends keep going to GHL).
//
// requireInboxLive (the inbox read path) additionally demands inbox_live=true:
// status='active' only means the webhook stores what Meta DELIVERS, and under
// Standard Access that is app-role senders only - real leads' DMs stay in GHL
// until App Review grants Advanced Access. Serving dm_threads (and deduping
// the passthrough) before inbox_live would hide real leads' threads.
export async function metaDmConfig(clientId, { requireInboxLive = false } = {}) {
  if (!clientId) return null;
  try {
    const live = requireInboxLive ? "&inbox_live=eq.true" : "";
    const rows = await sb(`client_meta_messaging_config?client_id=eq.${encodeURIComponent(clientId)}&status=eq.active${live}&select=client_id,page_id,ig_user_id,page_token_enc&limit=1`);
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (e) { console.error("metaDmConfig:", e.message); return null; }
}

// Inbox message type label per channel - what the client renders in the thread
// ("Instagram · 2:14 PM") and what _ghlSendType maps back to IG/FB on reply.
const typeOf = (channel) => (channel === "instagram" ? "Instagram" : "Facebook");

const mapMsg = (m) => ({
  id: m.id, body: m.body || "", type: typeOf(m.channel),
  direction: m.direction || "", status: m.status || "",
  date: m.occurred_at, attachments: m.attachments || [],
});

// Inbox conversation list from the DM store - same row shape as
// listStoreThreads (sms) so the inbox merge + classifier treat it identically.
export async function listDmThreads(clientId) {
  const rows = await sb(`dm_threads?client_id=eq.${encodeURIComponent(clientId)}&select=id,channel,psid,ghl_contact_id,contact_name,ig_username,last_message_at,last_preview,last_direction,unread&order=last_message_at.desc.nullslast&limit=200`);
  return (rows || []).map((t) => ({
    id: t.id,
    contactId: t.ghl_contact_id || null,
    contactName: t.contact_name || (t.ig_username ? `@${t.ig_username}` : null) || "Lead",
    email: null,
    phone: null,
    lastMessageBody: t.last_preview || "",
    lastMessageDate: t.last_message_at,
    lastMessageDirection: t.last_direction || "",
    unreadCount: t.unread ? 1 : 0,
    channel: t.channel,          // 'instagram' | 'facebook' - labels + reply type derive from this
  }));
}

// Inbox thread view by dm_threads id (uuid - the id listDmThreads returns).
// Returns null (not an empty thread) when the id isn't a DM thread, so the
// inbox can keep trying its other stores.
export async function readDmThreadById(threadId) {
  const rows = await sb(`dm_threads?id=eq.${encodeURIComponent(threadId)}&select=id&limit=1`);
  if (!rows || !rows[0]) return null;
  const msgs = await sb(`dm_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=id,channel,direction,body,occurred_at,status,attachments&order=occurred_at.asc&limit=300`);
  return { conversation_id: threadId, messages: (msgs || []).map(mapMsg) };
}

// A contact's DM messages across their IG + FB threads (Mode C / merged
// contact view). Empty until increment "contact mint" backfills ghl_contact_id.
export async function readDmThreadInbox(clientId, ghlContactId) {
  if (!clientId || !ghlContactId) return { conversation_id: null, messages: [] };
  const threads = await sb(`dm_threads?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=id&limit=5`);
  if (!threads || !threads.length) return { conversation_id: null, messages: [] };
  const ids = threads.map((t) => t.id);
  const msgs = await sb(`dm_messages?thread_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,channel,direction,body,occurred_at,status,attachments&order=occurred_at.asc&limit=300`);
  return { conversation_id: ids[0], messages: (msgs || []).map(mapMsg) };
}

// ── Send ────────────────────────────────────────────────────────────────────
// Graph API send: POST /{page_id}/messages with the academy's Page token.
// Works for both Messenger (PSID) and Instagram (IGSID) recipients. Meta's
// standard-messaging window applies: replies are only accepted within 24h of
// the person's last message (we don't use the human_agent tag - it needs App
// Review approval we don't have yet).
const WINDOW_RE = /outside.*window|allowed window|24 ?h|2018278|2534022/i;

async function graphSend(cfg, psid, payload) {
  const token = decryptSecret(cfg.page_token_enc);
  if (!token) throw new Error("Page token missing - re-wire the academy via /api/meta/connect");
  const r = await fetch(`${GRAPH}/${encodeURIComponent(cfg.page_id)}/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error?.message || `Graph ${r.status}`;
    const friendly = WINDOW_RE.test(`${msg} ${j.error?.error_subcode || ""}`)
      ? "Meta's 24h reply window has closed - the lead must message first before you can reply."
      : msg;
    throw new Error(friendly);
  }
  return j;   // { recipient_id, message_id }
}

// Guess Meta's attachment type from the URL so images render inline.
function attachmentType(url) {
  const u = String(url).split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(u)) return "image";
  if (/\.(mp4|mov|webm)$/.test(u))       return "video";
  if (/\.(mp3|m4a|wav|ogg)$/.test(u))    return "audio";
  return "file";
}

// The gate send-message.js calls for type IG/FB. Same contract as
// maybeSendSmsViaProvider:
//   { handled:false }                    -> caller runs its existing GHL send
//   { handled:true, ok:true, mid }       -> sent via Graph + stored
//   { handled:true, ok:false, error }    -> academy is on the spine but send failed
// Thread resolution: conversationId (dm_threads uuid, the inbox reply case)
// first, then ghlContactId+channel. No thread -> not handled, so replies to
// old GHL-passthrough conversations still go out through GHL.
export async function maybeSendDmViaMeta(clientId, { conversationId, ghlContactId, channel, text, attachments, sentBy } = {}) {
  let cfg;
  try { cfg = await metaDmConfig(clientId); } catch (_) { cfg = null; }
  if (!cfg) return { handled: false };

  let thread = null;
  try {
    const isUuid = conversationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(conversationId));
    if (isUuid) {
      const rows = await sb(`dm_threads?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,channel,psid&limit=1`);
      thread = (rows && rows[0]) || null;
    }
    if (!thread && ghlContactId && channel) {
      const rows = await sb(`dm_threads?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&channel=eq.${channel}&select=id,channel,psid&limit=1`);
      thread = (rows && rows[0]) || null;
    }
  } catch (e) { console.error("maybeSendDmViaMeta lookup:", e.message); }
  if (!thread) return { handled: false };

  const urls = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  try {
    // Text first, then each attachment as its own message (Meta takes one
    // attachment per send). Keep the first mid as the send's id.
    let firstMid = null;
    if (text) {
      const j = await graphSend(cfg, thread.psid, { text });
      firstMid = j.message_id || null;
    }
    for (const url of urls) {
      const j = await graphSend(cfg, thread.psid, { attachment: { type: attachmentType(url), payload: { url, is_reusable: false } } });
      if (!firstMid) firstMid = j.message_id || null;
    }

    // Store the outbound. The webhook will also see our send as an echo - the
    // (client_id, meta_message_id) unique index makes whichever lands second
    // a no-op, so the thread never double-shows a reply.
    const now = new Date().toISOString();
    await sb(`dm_messages`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        thread_id: thread.id, client_id: clientId, provider: "meta",
        direction: "outbound", channel: thread.channel,
        body: text || null, attachments: urls.map((u) => ({ type: attachmentType(u), url: u })),
        status: "sent", meta_message_id: firstMid, sent_by: sentBy || "staff",
        occurred_at: now,
      }]),
    }).catch((e) => { if (!/duplicate|23505|409/.test(String(e.message))) throw e; });
    await sb(`dm_threads?id=eq.${thread.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        last_message_at: now, last_preview: (text || "[attachment]").slice(0, 160),
        last_direction: "outbound", unread: false, updated_at: now,
      }),
    }).catch(() => {});
    return { handled: true, ok: true, mid: firstMid };
  } catch (e) {
    return { handled: true, ok: false, error: e.message };
  }
}
