import { withSentryApiRoute } from "../_sentry.js";
// Meta DM spine (2/4): Instagram + FB Messenger inbound webhook. The Meta
// counterpart of api/twilio/inbound-webhook.js - when an academy runs direct
// Meta messaging (client_meta_messaging_config.status='active'), DMs land here
// and are stored in dm_threads/dm_messages. Side-effects (contact mint,
// pipeline bounce, agent wake) come in increment 4 - this stores + notifies.
//
// Meta App setup (one-time, in the app dashboard for META_APP_ID):
//   Products: Messenger + Instagram → Webhooks
//   Callback URL:  https://portal.byanymeansbusiness.com/api/meta/inbound-webhook
//   Verify token:  META_DM_VERIFY_TOKEN (Vercel env)
//   Subscriptions: object 'page' + 'instagram', field 'messages'
//   Then subscribe the academy's Page to the app (subscribed_apps).
//
// Security: GET handles Meta's hub.challenge verification; POST validates
// X-Hub-Signature-256 (HMAC-SHA256 of the RAW body with META_APP_SECRET).
// Always answers 200 fast on POST - Meta retries non-200s aggressively, and a
// bug in our side-effects must not re-deliver the whole batch forever.
import crypto from "node:crypto";
import { notifyOwners } from "../_notify-owners.js";
import { decryptSecret } from "../messaging/_crypto.js";

export const config = { api: { bodyParser: false } };

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const APP_SECRET   = process.env.META_APP_SECRET;
const VERIFY_TOKEN = process.env.META_DM_VERIFY_TOKEN;
const GRAPH = "https://graph.facebook.com/v22.0";   // keep in step with marketing.js META_API_VERSION

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function validSignature(rawBody, header) {
  if (!APP_SECRET || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf-8").digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(header))); } catch { return false; }
}

// Resolve the academy from the entry's page/IG id. Only ACTIVE configs receive
// - a pending row means the academy is still being wired up (store nothing so
// the GHL passthrough stays the single source and nothing double-shows).
async function configFor(channel, entryId) {
  const col = channel === "instagram" ? "ig_user_id" : "page_id";
  const rows = await sb(`client_meta_messaging_config?${col}=eq.${encodeURIComponent(entryId)}&status=eq.active&select=client_id,page_id,ig_user_id,page_token_enc&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

// Best-effort profile lookup so threads show a name, not a numeric id. IG
// exposes username+name on the IGSID; Messenger exposes first/last on the PSID.
async function lookupProfile(cfg, channel, psid) {
  try {
    if (!cfg.page_token_enc) return {};
    const token = decryptSecret(cfg.page_token_enc);
    if (!token) return {};
    const fields = channel === "instagram" ? "name,username" : "first_name,last_name,name";
    const r = await fetch(`${GRAPH}/${encodeURIComponent(psid)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
    if (!r.ok) return {};
    const j = await r.json();
    const name = j.name || [j.first_name, j.last_name].filter(Boolean).join(" ") || null;
    return { name, username: j.username || null };
  } catch (_) { return {}; }
}

function previewOf(text, attachments) {
  if (text) return String(text).slice(0, 160);
  const kind = attachments && attachments[0] && attachments[0].type;
  return kind ? `[${kind}]` : "[attachment]";
}

// Store one messaging event. Meta sends echoes (message.is_echo) for outbound
// DMs sent natively (IG app / Business Suite) AND for our own Graph API sends -
// storing them keeps the thread complete either way (mid dedupes our sends).
async function storeEvent(cfg, channel, ev) {
  const msg = ev.message;
  if (!msg || msg.is_deleted) return null;               // reads/reactions/deletes: skip
  const isEcho = !!msg.is_echo;
  const psid = isEcho ? (ev.recipient && ev.recipient.id) : (ev.sender && ev.sender.id);
  if (!psid) return null;
  const mid = msg.mid || null;
  const text = msg.text || "";
  const attachments = Array.isArray(msg.attachments)
    ? msg.attachments.map((a) => ({ type: a.type || "file", url: (a.payload && a.payload.url) || null }))
    : [];
  if (!text && !attachments.length) return null;
  const occurredAt = new Date(ev.timestamp || Date.now()).toISOString();
  const direction = isEcho ? "outbound" : "inbound";

  // Thread upsert on (client_id, channel, psid).
  let thread = (await sb(`dm_threads?client_id=eq.${cfg.client_id}&channel=eq.${channel}&psid=eq.${encodeURIComponent(psid)}&select=id,contact_name&limit=1`))?.[0];
  if (!thread) {
    const prof = await lookupProfile(cfg, channel, psid);
    const inserted = await sb(`dm_threads?on_conflict=client_id,channel,psid`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ client_id: cfg.client_id, channel, psid, contact_name: prof.name || null, ig_username: prof.username || null }]),
    });
    thread = inserted && inserted[0];
  }
  if (!thread) return null;

  // Message insert - idempotent on (client_id, mid) so Meta's retries no-op.
  try {
    await sb(`dm_messages`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        thread_id: thread.id, client_id: cfg.client_id, provider: "meta",
        direction, channel, body: text || null, attachments,
        status: isEcho ? "sent" : "received", meta_message_id: mid,
        sent_by: isEcho ? "meta-native" : null, occurred_at: occurredAt,
        raw: { sender: ev.sender, recipient: ev.recipient, timestamp: ev.timestamp },
      }]),
    });
  } catch (e) {
    if (/duplicate|23505|409/.test(String(e.message))) return null;   // retry delivery - already stored
    throw e;
  }

  await sb(`dm_threads?id=eq.${thread.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      last_message_at: occurredAt, last_preview: previewOf(text, attachments),
      last_direction: direction, ...(direction === "inbound" ? { unread: true } : {}),
      updated_at: new Date().toISOString(),
    }),
  });
  return { direction, channel, psid, text };
}

async function handler(req, res) {
  // Meta's one-time webhook verification handshake.
  if (req.method === "GET") {
    const mode = req.query["hub.mode"], tok = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && VERIFY_TOKEN && tok === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).json({ error: "verify token mismatch" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const rawBody = await readRawBody(req);
  if (!validSignature(rawBody, req.headers["x-hub-signature-256"])) {
    return res.status(401).json({ error: "invalid signature" });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return res.status(400).json({ error: "bad JSON" }); }

  const channel = event.object === "instagram" ? "instagram"
                : event.object === "page"      ? "facebook"
                : null;
  if (!channel) return res.status(200).json({ ok: true, skipped: "object" });

  let stored = 0;
  // Collect owner-notify promises and AWAIT them before responding. Vercel
  // freezes the function the moment we return 200, so a fire-and-forget
  // notifyOwners() (which chains several Twilio fetches) is frequently killed
  // mid-send - which is exactly why some inbound DMs never texted the owner.
  // The SMS is a few hundred ms; Meta's webhook timeout is ~20s, so awaiting
  // is safe and makes the notification reliable.
  const notifies = [];
  for (const entry of (Array.isArray(event.entry) ? event.entry : [])) {
    try {
      const cfg = await configFor(channel, String(entry.id || ""));
      if (!cfg) continue;                                // academy not on the Meta spine
      for (const ev of (Array.isArray(entry.messaging) ? entry.messaging : [])) {
        const r = await storeEvent(cfg, channel, ev);
        if (!r) continue;
        stored++;
        if (r.direction === "inbound") {
          // Same owner ping the other inbound webhooks fire - best-effort.
          const label = r.channel === "instagram" ? "Instagram" : "Messenger";
          notifies.push(notifyOwners(cfg.client_id, "inbox_message", `💬 New ${label} DM in your inbox${r.text ? `: "${String(r.text).slice(0, 80)}"` : ""}`).catch(() => {}));
        }
      }
    } catch (e) { console.error("[meta-inbound]", e.message); /* next entry - never 500 the batch */ }
  }
  if (notifies.length) await Promise.allSettled(notifies);
  return res.status(200).json({ ok: true, stored });
}

export default withSentryApiRoute(handler);
