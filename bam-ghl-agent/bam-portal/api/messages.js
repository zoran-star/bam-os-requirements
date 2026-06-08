import { withSentryApiRoute } from "./_sentry.js";
// ─────────────────────────────────────────────────────────
// /api/messages — in-portal messaging (Slack replacement)
// ─────────────────────────────────────────────────────────
// Routes:
//   GET  ?action=list-conversations         → inbox: list of conversations the
//                                              caller can see (staff: all,
//                                              client: theirs only — for a
//                                              multi-POC client user, all their
//                                              clients merged into one list).
//   GET  ?conversation_id=X[&before=ts][&limit=50]
//                                            → paginated messages for one convo
//   POST ?action=send                       → { conversation_id, body, files }
//   POST ?action=edit                       → { message_id, body }  (5min window)
//   POST ?action=delete                     → { message_id }        (5min window)
//   POST ?action=mark-read                  → { conversation_id }   updates conversation_reads
//
// Auth: same Bearer-token pattern as api/clients.js + api/marketing.js.
// Access policy (per design decision 2026-05-19):
//   - Any staff member can read + write any conversation
//   - A client can only read + write conversations attached to their own
//     clients (where clients.auth_user_id = their auth.uid())

import { notifyClientPush } from "./push/_send.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const EDIT_DELETE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ──────────────────────────────────────────────────────
async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };

  // Staff lookup: try user_id first, fall back to email
  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staff = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  // Client lookup: a single auth user can own multiple client rows (e.g. Mike
  // covers DETAIL Miami + Out Work + Johnson). Return ALL of them so the
  // merged inbox can list every conversation the user is authorized for.
  const clientRows = await sb(
    `clients?auth_user_id=eq.${user.id}&archived_at=is.null&select=id,business_name`
  ) || [];

  return { user, staff, clients: clientRows };
}

// ─── @mention parsing ─────────────────────────────────────────────
// Resolve @firstname OR @first.last OR @firstlast (case-insensitive)
// against the staff table. Returns array of matched staff_ids.
async function parseMentions(body) {
  if (!body || typeof body !== "string") return [];
  const matches = [...body.matchAll(/@([a-zA-Z][a-zA-Z0-9._-]{1,30})/g)];
  if (matches.length === 0) return [];

  const tokens = [...new Set(matches.map(m => m[1].toLowerCase()))];
  // Pull all staff once and resolve client-side (small table)
  const allStaff = await sb(`staff?select=id,name,email`);
  if (!Array.isArray(allStaff)) return [];

  const matched = new Set();
  for (const token of tokens) {
    for (const s of allStaff) {
      const name = (s.name || "").toLowerCase();
      const email = (s.email || "").toLowerCase();
      const emailLocal = email.split("@")[0];
      const firstName = name.split(/\s+/)[0] || "";
      const nameNoSpaces = name.replace(/\s+/g, "");
      if (
        token === firstName ||
        token === nameNoSpaces ||
        token === emailLocal ||
        emailLocal.startsWith(token)
      ) {
        matched.add(s.id);
      }
    }
  }
  return [...matched];
}

// Fire-and-forget DM to each mentioned staff via Slack. Silently no-ops
// when SLACK_BOT_TOKEN isn't configured OR the mentioned staff has no
// slack_user_id on their row (which is currently true for every staff
// member — backfill the slack_user_id column to enable DMs).
//
// When native push lands in Phase 3, swap the body of this function
// for an FCM call. The mentioned_staff_ids stored on the message row
// is the same source of truth.
async function notifyMentionedStaff({ mentioned_staff_ids, conversation, message, authorLabel, req }) {
  if (!mentioned_staff_ids || mentioned_staff_ids.length === 0) return;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return; // not configured — silent skip

  // Load the staff rows we need (name + slack_user_id) in one shot
  const idsCsv = mentioned_staff_ids.join(",");
  let staffRows;
  try {
    staffRows = await sb(`staff?id=in.(${idsCsv})&select=id,name,slack_user_id`);
  } catch (_) { return; }
  if (!Array.isArray(staffRows) || staffRows.length === 0) return;

  // Resolve the client business name for context
  let businessName = "";
  try {
    const cRows = await sb(`clients?id=eq.${conversation.client_id}&select=business_name`);
    businessName = cRows?.[0]?.business_name || "";
  } catch (_) {}

  // Origin → staff portal link the receiver will click. Pinned to
  // STAFF_PORTAL_URL, else canonical staff.byanymeansbusiness.com.
  // Never derived from request headers — Slack DMs from .vercel.app
  // preview origins would leak the preview hostname.
  let origin;
  if (process.env.STAFF_PORTAL_URL) {
    origin = process.env.STAFF_PORTAL_URL.replace(/\/+$/, "");
  } else {
    const reqOrigin = req.headers.origin || `https://${req.headers.host || ""}`;
    origin = /localhost|127\.0\.0\.1/.test(reqOrigin)
      ? reqOrigin.replace(/\/+$/, "")
      : "https://staff.byanymeansbusiness.com";
  }
  const portalLink = `${origin}/?nav=inbox`;

  const preview = (message?.body || "").trim().slice(0, 180);
  const text = [
    `🔔 *${authorLabel}* mentioned you in *${businessName || "a conversation"}*`,
    preview ? `> ${preview}` : "(no text content)",
    `→ ${portalLink}`,
  ].filter(Boolean).join("\n");

  // Fire all DMs in parallel; swallow per-staff errors
  await Promise.all(staffRows.map(async (s) => {
    if (!s.slack_user_id) return;
    try {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: s.slack_user_id, text, unfurl_links: false }),
      });
    } catch (err) {
      console.warn(`Slack DM failed for staff ${s.id}:`, err?.message);
    }
  }));
}

// Pull conversation + verify the caller is authorized for it.
// Returns { conversation } or { error }.
async function loadConversationForUser(conversationId, ctx) {
  if (!conversationId) return { error: { status: 400, message: "conversation_id required" } };
  const rows = await sb(`conversations?id=eq.${conversationId}&select=id,client_id,kind,last_message_at`);
  const convo = rows?.[0];
  if (!convo) return { error: { status: 404, message: "conversation not found" } };

  if (ctx.staff) return { conversation: convo }; // staff has access to all

  const clientIds = new Set(ctx.clients.map(c => c.id));
  if (!clientIds.has(convo.client_id)) {
    return { error: { status: 403, message: "not your conversation" } };
  }
  return { conversation: convo };
}

// ─── Route handler ────────────────────────────────────────────────
async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }

  try {
    const ctx = await resolveUser(req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    if (!ctx.staff && !ctx.clients?.length) {
      return res.status(403).json({ error: "no portal access" });
    }

    const action = req.query.action;

    // ── GET ?action=list-conversations ───────────────────────────
    if (req.method === "GET" && action === "list-conversations") {
      let filter = "";
      if (!ctx.staff) {
        const ids = ctx.clients.map(c => c.id).join(",");
        filter = `&client_id=in.(${ids})`;
      }
      const convos = await sb(
        `conversations?select=id,client_id,kind,last_message_at,last_message_preview,clients(business_name)` +
        `${filter}&order=last_message_at.desc.nullslast`
      );
      // Unread per user: count messages newer than the user's last_read_at
      // for each convo. One query for all reads, then compute in JS.
      const reads = await sb(
        `conversation_reads?auth_user_id=eq.${ctx.user.id}&select=conversation_id,last_read_at`
      );
      const readMap = Object.fromEntries((reads || []).map(r => [r.conversation_id, r.last_read_at]));

      const enriched = (convos || []).map(c => {
        const lastRead = readMap[c.id];
        const lastMsg = c.last_message_at;
        const hasUnread = lastMsg && (!lastRead || new Date(lastMsg) > new Date(lastRead));
        return {
          id: c.id,
          client_id: c.client_id,
          business_name: c.clients?.business_name || "(unknown)",
          last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
          has_unread: !!hasUnread,
        };
      });
      return res.status(200).json({ conversations: enriched });
    }

    // ── GET ?conversation_id=…[&before=ts][&limit=N] ─────────────
    // Returns messages oldest→newest within the page, so the UI can
    // append directly. `before` is a timestamp cursor for backwards
    // pagination (load older messages on scroll-up).
    if (req.method === "GET") {
      const conversation_id = req.query.conversation_id;
      const { conversation, error } = await loadConversationForUser(conversation_id, ctx);
      if (error) return res.status(error.status).json({ error: error.message });

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const before = req.query.before
        ? `&created_at=lt.${encodeURIComponent(req.query.before)}`
        : "";
      const rows = await sb(
        `conversation_messages?conversation_id=eq.${conversation.id}` +
        `${before}&order=created_at.desc&limit=${limit}` +
        `&select=id,conversation_id,author_staff_id,author_client_id,author_auth_user_id,` +
        `body,files,mentioned_staff_ids,edited_at,deleted_at,created_at`
      );
      // Reverse so UI gets oldest→newest in the page
      const messages = (rows || []).reverse();

      // ── Group-chat identities: resolve each message's author (name + avatar).
      // Build directories the client also caches to enrich realtime messages.
      // Resilient: avatar_url may not exist yet (migration runs separately) —
      // fall back to name-only so the chat never breaks during the gap.
      const sbTry = async (withCol, withoutCol) => {
        try { return await sb(withCol); } catch { return await sb(withoutCol); }
      };
      const staffDir = {};
      const allStaffRows = await sbTry(`staff?select=id,name,avatar_url`, `staff?select=id,name`);
      (allStaffRows || []).forEach(s => {
        staffDir[s.id] = { name: s.name || "BAM team", avatar_url: s.avatar_url || null };
      });
      const userDir = {};
      const cuRows = await sbTry(
        `client_users?client_id=eq.${conversation.client_id}&select=user_id,name,avatar_url`,
        `client_users?client_id=eq.${conversation.client_id}&select=user_id,name`
      );
      (cuRows || []).forEach(u => {
        if (u.user_id) userDir[u.user_id] = { name: u.name || "Teammate", avatar_url: u.avatar_url || null };
      });
      messages.forEach(m => {
        if (m.author_staff_id && staffDir[m.author_staff_id]) {
          m.author_name = staffDir[m.author_staff_id].name;
          m.author_avatar_url = staffDir[m.author_staff_id].avatar_url;
          m.author_kind = "staff";
        } else if (m.author_auth_user_id && userDir[m.author_auth_user_id]) {
          m.author_name = userDir[m.author_auth_user_id].name;
          m.author_avatar_url = userDir[m.author_auth_user_id].avatar_url;
          m.author_kind = "client";
        } else {
          m.author_name = m.author_staff_id ? "BAM team" : "Someone";
          m.author_avatar_url = null;
          m.author_kind = m.author_staff_id ? "staff" : "client";
        }
      });

      return res.status(200).json({ messages, directory: { staff: staffDir, users: userDir } });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "method not allowed" });
    }

    const body = req.body || {};

    // ── POST ?action=send ────────────────────────────────────────
    if (action === "send") {
      const { conversation: convo, error } = await loadConversationForUser(body.conversation_id, ctx);
      if (error) return res.status(error.status).json({ error: error.message });

      const text = typeof body.body === "string" ? body.body.trim() : "";
      const files = Array.isArray(body.files) ? body.files.filter(f => f && f.url) : [];
      if (!text && files.length === 0) {
        return res.status(400).json({ error: "body or files required" });
      }
      // Cap on file count (sanity); per-file size is enforced by Supabase Storage
      if (files.length > 10) {
        return res.status(400).json({ error: "max 10 files per message" });
      }

      const mentioned_staff_ids = await parseMentions(text);

      const insertBody = {
        conversation_id: convo.id,
        author_staff_id: ctx.staff?.id || null,
        author_client_id: ctx.staff ? null : (ctx.clients?.find(c => c.id === convo.client_id)?.id || null),
        author_auth_user_id: ctx.user.id,
        body: text || null,
        files,
        mentioned_staff_ids,
      };

      const created = await sb(`conversation_messages`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(insertBody),
      });
      const row = Array.isArray(created) ? created[0] : created;

      // Auto-mark the sender's read pointer up to now — they obviously
      // saw their own message. Saves one round-trip from the UI.
      await sb(`conversation_reads`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          conversation_id: convo.id,
          auth_user_id: ctx.user.id,
          last_read_at: row?.created_at || new Date().toISOString(),
        }),
      }).catch(() => {});

      // Fire @mention notifications out-of-band. Don't await — keep the
      // send response snappy. Author label is "staff name" if sent by
      // staff, "client business name" if sent by client.
      if (mentioned_staff_ids.length > 0) {
        const authorLabel = ctx.staff
          ? (ctx.staff.name || "A staff member")
          : (ctx.clients?.find(c => c.id === convo.client_id)?.business_name || "A client");
        notifyMentionedStaff({
          mentioned_staff_ids,
          conversation: convo,
          message: row,
          authorLabel,
          req,
        }).catch(err => console.warn("notifyMentionedStaff failed:", err?.message));
      }

      // #5 new-message push → the CLIENT, only when STAFF is the sender
      // (the client has the native app; staff use the web portal). Fire and
      // forget — a push failure must not affect the send.
      if (ctx.staff) {
        const preview = text
          ? text.slice(0, 140)
          : (files.length ? "Sent you an attachment" : "");
        notifyClientPush(convo.client_id, "new-message", {
          sender: ctx.staff.name || "BAM",
          preview,
          conversationId: convo.id,
          view: "messages",
        }).catch(() => {});
      }

      return res.status(200).json({ message: row });
    }

    // ── POST ?action=edit ────────────────────────────────────────
    // 5min window after send, author-only. Soft replaces body; sets edited_at.
    if (action === "edit") {
      const message_id = body.message_id;
      const newBody = typeof body.body === "string" ? body.body.trim() : "";
      if (!message_id) return res.status(400).json({ error: "message_id required" });
      if (!newBody) return res.status(400).json({ error: "body required" });

      const rows = await sb(`conversation_messages?id=eq.${message_id}&select=*`);
      const msg = rows?.[0];
      if (!msg) return res.status(404).json({ error: "message not found" });
      if (msg.author_auth_user_id !== ctx.user.id) {
        return res.status(403).json({ error: "you can only edit your own messages" });
      }
      if (msg.deleted_at) return res.status(400).json({ error: "message was deleted" });
      const ageMs = Date.now() - new Date(msg.created_at).getTime();
      if (ageMs > EDIT_DELETE_WINDOW_MS) {
        return res.status(400).json({ error: "edit window expired (5 minutes after send)" });
      }

      const mentioned_staff_ids = await parseMentions(newBody);
      const updated = await sb(`conversation_messages?id=eq.${message_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          body: newBody,
          mentioned_staff_ids,
          edited_at: new Date().toISOString(),
        }),
      });
      return res.status(200).json({ message: Array.isArray(updated) ? updated[0] : updated });
    }

    // ── POST ?action=delete ──────────────────────────────────────
    // Soft delete: keeps the row for history but blanks body + files.
    // Same 5min window as edit; author-only.
    if (action === "delete") {
      const message_id = body.message_id;
      if (!message_id) return res.status(400).json({ error: "message_id required" });

      const rows = await sb(`conversation_messages?id=eq.${message_id}&select=*`);
      const msg = rows?.[0];
      if (!msg) return res.status(404).json({ error: "message not found" });
      if (msg.author_auth_user_id !== ctx.user.id) {
        return res.status(403).json({ error: "you can only delete your own messages" });
      }
      if (msg.deleted_at) return res.status(200).json({ ok: true }); // already deleted
      const ageMs = Date.now() - new Date(msg.created_at).getTime();
      if (ageMs > EDIT_DELETE_WINDOW_MS) {
        return res.status(400).json({ error: "delete window expired (5 minutes after send)" });
      }

      await sb(`conversation_messages?id=eq.${message_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          deleted_at: new Date().toISOString(),
          body: null,
          files: [],
        }),
      });
      return res.status(200).json({ ok: true });
    }

    // ── POST ?action=mark-read ───────────────────────────────────
    // Upserts the user's last_read_at for a conversation. Called when
    // the user opens/scrolls a thread. Idempotent.
    if (action === "mark-read") {
      const { conversation, error } = await loadConversationForUser(body.conversation_id, ctx);
      if (error) return res.status(error.status).json({ error: error.message });

      const last_read_at = body.last_read_at || new Date().toISOString();
      await sb(`conversation_reads`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          conversation_id: conversation.id,
          auth_user_id: ctx.user.id,
          last_read_at,
        }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({
      error: "invalid action (expected list-conversations | send | edit | delete | mark-read)",
    });
  } catch (err) {
    console.error("messages api error:", err?.message);
    return res.status(500).json({ error: err?.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
