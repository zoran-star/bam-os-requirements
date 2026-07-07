import { withSentryApiRoute, captureApiMessage } from "./_sentry.js";
import crypto from "node:crypto";
import { MARKETING_OPS_ROLES, CONTENT_MANAGER_ROLES, CONTENT_ROLES, hasRole } from "./_roles.js";
import { CANONICAL_FUNNEL, mapStageName, buildKpis } from "./_ghl_funnel.js";
import { notifyClientPush } from "./push/_send.js";

// Vercel Serverless Function — Marketing (combined: tickets + guide cards)
//
// One file routed by ?resource=… because the Hobby plan caps us at 12 functions.
// vercel.json rewrites preserve the original URLs:
//   /api/marketing-tickets  →  /api/marketing?resource=tickets
//   /api/guide-cards         →  /api/marketing?resource=guide-cards
//
// Marketing tickets:
//   GET    ?resource=tickets                     → list (scope = staff or client)
//   GET    ?resource=tickets&id=<uuid>           → one ticket
//   POST   ?resource=tickets                     → client creates
//   PATCH  ?resource=tickets&id=<uuid>           → action: approve-content,
//                                                  request-client-action, mark-completed,
//                                                  cancel, edit, respond
//
// Guide cards:
//   GET    ?resource=guide-cards                 → list (any authed)
//   GET    ?resource=guide-cards&id=<uuid>       → one
//   POST   ?resource=guide-cards                 → marketing staff only
//   PATCH  ?resource=guide-cards&id=<uuid>       → marketing staff only
//   DELETE ?resource=guide-cards&id=<uuid>       → marketing staff only

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const CONTENT_TYPES = new Set(["replace", "add", "campaign-create"]);
// Who can create/edit/delete guide cards. Keep in sync with the canonical
// STAFF_ROLES list (no bare "marketing" — it's not a real role).
const GUIDE_WRITE_ROLES = MARKETING_OPS_ROLES;

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
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

  // Resolve staff: try user_id first, fall back to email
  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staffRow = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  // Resolve the EFFECTIVE client for this request. A user reaches a client two
  // ways: as the academy's original owner (clients.auth_user_id) OR as an invited
  // teammate via client_users (the multi-user model). The client portal passes
  // ?client_id for the academy it's currently showing - honor it as long as the
  // caller actually belongs to that client (owner row or active membership).
  // Falls back to the owner row, then a sole membership. Single-owner clients keep
  // working unchanged; teammates can now use the Marketing/Content tabs.
  const ownerRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id,business_name`);
  const ownerRow = Array.isArray(ownerRows) && ownerRows[0] ? ownerRows[0] : null;

  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => String(m.client_id)) : [];

  const ownerId = ownerRow ? String(ownerRow.id) : null;
  const belongsTo = (id) => !!id && (id === ownerId || clientIds.includes(id));
  const requested = req.query && req.query.client_id ? String(req.query.client_id) : null;

  let targetId = null;
  if (requested && belongsTo(requested)) targetId = requested;   // validated - no IDOR
  else if (ownerId) targetId = ownerId;
  else if (clientIds.length === 1) targetId = clientIds[0];

  let clientRow = null;
  if (targetId && targetId === ownerId) {
    clientRow = ownerRow;
  } else if (targetId) {
    const rows = await sb(`clients?id=eq.${targetId}&select=id,business_name`);
    clientRow = Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  return { user, staff: staffRow, client: clientRow, clientIds };
}

function nowIso() { return new Date().toISOString(); }
function appendMessage(existing, msg) {
  const arr = Array.isArray(existing) ? existing : [];
  return [...arr, { ...msg, created_at: nowIso() }];
}

// Strip messages flagged internal:true before returning to clients.
// Keeps staff-only chatter (revision handoffs, content team upload notes,
// internal marketing_notes) out of the client conversation thread.
// Sanitize a ticket for CLIENT output: drop staff-internal messages AND the
// internal `assigned_to` owner — clients never see who's assigned to their
// creative/campaign. Staff reads go through enrichWithClient instead, so this
// only ever runs on client-facing responses.
function stripInternalMessages(ticket) {
  if (!ticket) return ticket;
  const { assigned_to, ...rest } = ticket;
  if (Array.isArray(rest.messages)) {
    rest.messages = rest.messages.filter(m => !m?.internal);
  }
  return rest;
}

// ─────────────────────────────────────────────────────────
// Slack client-channel notifications
// ─────────────────────────────────────────────────────────
// Posts to the client's dedicated Slack channel via the BAM Portal
// bot token. Fire-and-forget — never blocks the API response. Quietly
// no-ops if the client doesn't have slack_channel_id set or the bot
// token is missing.
function clientPortalLinkForTicket(req, kind, ticketId) {
  // Pinned to the canonical client portal domain — never derive from
  // request headers. Otherwise Slack notifications posted via Vercel's
  // auto-generated *.vercel.app URLs leak that hostname into
  // client-facing links. Same reasoning as portalUrls() in api/clients.js.
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";
  // We don't have deep-links to a specific ticket yet — Marketing tab on
  // the client portal is the right landing for now.
  return `${base}/client-portal.html`;
}

async function postClientSlackNotification(clientId, text, req) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return; // not configured — silent skip
    if (!clientId || !text) return;
    const rows = await sb(`clients?id=eq.${clientId}&select=slack_channel_id,business_name`);
    const r = rows?.[0];
    if (!r?.slack_channel_id) return; // no channel mapped — silent skip
    const portalLink = clientPortalLinkForTicket(req);
    const body = `${text}\n→ ${portalLink}`;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: r.slack_channel_id,
        text: body,
        unfurl_links: false,
      }),
    });
  } catch (err) {
    // Don't let Slack failures break the staff action. Log + move on.
    console.error("Slack notify failed:", err?.message || err);
  }
}

// Direct-message a single staff member via the BAM Portal bot. Slack accepts a
// user ID as the `channel` for chat.postMessage (opens/uses the IM). Fire-and-
// forget; no-ops if the bot token or the user's slack_user_id is missing.
async function postStaffSlackDM(slackUserId, text, req) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token || !slackUserId || !text) return;
    const portalLink = clientPortalLinkForTicket(req);
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: slackUserId, text: `${text}\n→ ${portalLink}`, unfurl_links: false }),
    });
  } catch (err) {
    console.error("Slack DM failed:", err?.message || err);
  }
}

// Shared content + marketing team channel: new requests, status checkpoints,
// and the daily deadline digest. Fire-and-forget; no-ops if SLACK_BOT_TOKEN or
// CONTENT_MARKETING_SLACK_CHANNEL is missing. Uses chat:write (no im:write
// needed), so it works without per-person DM permissions.
async function postContentMarketingSlack(text) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.CONTENT_MARKETING_SLACK_CHANNEL;
    if (!token || !channel || !text) return;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
    });
  } catch (err) {
    console.error("Team Slack post failed:", err?.message || err);
  }
}
// `<@U…>` ping if we have the user's Slack id (works inside a channel, no
// im:write), else just the bolded name, else ''.
function slackMention(slackUserId, fallbackName) {
  if (slackUserId) return `<@${slackUserId}>`;
  return fallbackName ? `*${fallbackName}*` : "";
}

// Server-side mirror of the content SLA (ContentView ctkDeadlineInfo):
// high priority = 3 business days, normal = 5, from the submit date.
function _addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
function _ctkDueDate(submittedIso, priority) {
  if (!submittedIso) return null;
  const sla = priority === "high" ? 3 : 5;
  return _addBusinessDays(new Date(submittedIso), sla);
}
// Marketing SLA — Ximena's turnaround once content lands in marketing:
// urgent (high) = 2 business days, standard = 4, from the marketing submit date.
function _mktDueDate(submittedIso, priority) {
  if (!submittedIso) return null;
  const sla = priority === "high" ? 2 : 4;
  return _addBusinessDays(new Date(submittedIso), sla);
}
// Short human date for Slack, e.g. "Tue Jun 30". No em dashes, no locale deps.
const _DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const _MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function _fmtDue(d) {
  if (!d) return "";
  const x = new Date(d);
  return `${_DOW[x.getDay()]} ${_MON[x.getMonth()]} ${x.getDate()}`;
}
// 'overdue' | 'today' | 'tomorrow' | 'later' (calendar-day comparison, local).
function _dueBucket(due) {
  if (!due) return "later";
  const a = new Date(due); a.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return "later";
}

// Daily deadline digest -> the content + marketing channel. Buckets outstanding
// content tickets into overdue / due-today / due-tomorrow and posts one message
// (@mentioning assignees). Cron auth: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
async function contentDeadlinesDigestCron(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if ((req.headers.authorization || "") !== `Bearer ${expected}`) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.SLACK_BOT_TOKEN || !process.env.CONTENT_MARKETING_SLACK_CHANNEL) {
    return res.status(200).json({ sent: false, reason: "slack_not_configured" });
  }
  try {
    const mktExecSid = await marketingExecutorSlackId();
    const contentTickets = await sb(`content_tickets?status=in.(active,client-dependent)&select=id,channel,context,submitted_at,assigned_to,client_id`) || [];
    const mktTickets = await sb(`marketing_tickets?status=eq.in-progress&select=id,fields,submitted_at,assigned_to,client_id`) || [];
    const buckets = { overdue: [], today: [], tomorrow: [] };
    for (const t of contentTickets) {
      const pri = (t.context && t.context.priority === "high") ? "high" : "normal";
      const b = _dueBucket(_ctkDueDate(t.submitted_at, pri));
      if (buckets[b]) buckets[b].push({ ...t, _kind: "content" });
    }
    for (const t of mktTickets) {
      const pri = (t.fields && t.fields.priority === "high") ? "high" : "normal";
      const b = _dueBucket(_mktDueDate(t.submitted_at, pri));
      if (buckets[b]) buckets[b].push({ ...t, _kind: "marketing" });
    }
    const all = [...buckets.overdue, ...buckets.today, ...buckets.tomorrow];
    if (!all.length) return res.status(200).json({ sent: false, reason: "nothing_due" });

    const clientIds = [...new Set(all.map(t => t.client_id).filter(Boolean))];
    const staffIds = [...new Set(all.map(t => t.assigned_to).filter(Boolean))];
    const clients = clientIds.length ? (await sb(`clients?id=in.(${clientIds.join(",")})&select=id,business_name`) || []) : [];
    const staff = staffIds.length ? (await sb(`staff?id=in.(${staffIds.join(",")})&select=id,slack_user_id`) || []) : [];
    const cName = {}; clients.forEach(c => { cName[c.id] = c.business_name; });
    const sSlack = {}; staff.forEach(s => { sSlack[s.id] = s.slack_user_id; });

    const line = (t) => {
      const code = String(t.id || "").slice(0, 3).toUpperCase();
      // Marketing lines ping Ximena (the doer); content lines ping the assignee.
      if (t._kind === "marketing") {
        const who = slackMention(mktExecSid);
        return `• Marketing · ${cName[t.client_id] || "client"} [${code}]${who ? " " + who : ""}`;
      }
      const chan = t.channel === "organic" ? "Organic" : "Paid ads";
      const who = slackMention(sSlack[t.assigned_to]);
      return `• ${chan} · ${cName[t.client_id] || "client"} [${code}]${who ? " " + who : ""}`;
    };
    const section = (emoji, label, arr) => arr.length ? `\n\n${emoji} *${label} (${arr.length})*\n` + arr.map(line).join("\n") : "";
    const msg = "📋 *Content / Marketing deadlines*"
      + section("🔴", "Overdue", buckets.overdue)
      + section("🟡", "Due today", buckets.today)
      + section("🔵", "Due tomorrow", buckets.tomorrow);
    await postContentMarketingSlack(msg);
    return res.status(200).json({ sent: true, overdue: buckets.overdue.length, today: buckets.today.length, tomorrow: buckets.tomorrow.length });
  } catch (e) {
    console.error("content-deadlines-cron error:", e?.message || e);
    return res.status(200).json({ sent: false, reason: e?.message || "error" });
  }
}

// Resolve the marketing manager's (Cam's) Slack user ID for new-ticket pings.
// Prefers an explicit env override; else looks up the staff row by email.
// Returns null — ping silently no-ops — until a slack_user_id is on file.
async function marketingManagerSlackId() {
  if (process.env.MARKETING_DM_SLACK_ID) return process.env.MARKETING_DM_SLACK_ID;
  try {
    const email = process.env.MARKETING_MANAGER_EMAIL || "cameron@byanymeansbusiness.com";
    const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=slack_user_id`);
    return rows?.[0]?.slack_user_id || null;
  } catch (_) {
    return null;
  }
}

// The marketing executor's (Ximena's) Slack id — the teammate who actually
// posts the ads, so they get pinged when content lands in marketing. Env
// override first, else the (first) marketing_executor on the team. Returns
// null — ping silently no-ops — until one resolves with a slack_user_id.
async function marketingExecutorSlackId() {
  if (process.env.MARKETING_EXECUTOR_SLACK_ID) return process.env.MARKETING_EXECUTOR_SLACK_ID;
  try {
    const email = process.env.MARKETING_EXECUTOR_EMAIL;
    if (email) {
      const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=slack_user_id`);
      if (rows?.[0]?.slack_user_id) return rows[0].slack_user_id;
    }
    const me = await sb(`staff?role=eq.marketing_executor&select=slack_user_id&order=created_at.asc&limit=1`);
    return me?.[0]?.slack_user_id || null;
  } catch (_) {
    return null;
  }
}

// The client's assigned manager (the "SM") — auto-owner of their marketing tickets.
async function clientScalingManager(clientId) {
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=scaling_manager_id`);
    return rows?.[0]?.scaling_manager_id || null;
  } catch (_) {
    return null;
  }
}

// The marketing manager's (Cam's) staff id — global default owner of ADS content.
async function marketingManagerStaffId() {
  try {
    const email = process.env.MARKETING_MANAGER_EMAIL || "cameron@byanymeansbusiness.com";
    const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=id`);
    return rows?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

// Global default owner of ORGANIC content. Env override first, else the (first)
// content_executor on the team. Returns null if neither resolves.
async function organicDefaultStaffId() {
  try {
    const email = process.env.CONTENT_ORGANIC_ASSIGNEE_EMAIL;
    if (email) {
      const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=id`);
      if (rows?.[0]?.id) return rows[0].id;
    }
    const ce = await sb(`staff?role=eq.content_executor&select=id&order=created_at.asc&limit=1`);
    return ce?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

// Channel-aware content-ticket routing. Precedence:
//   1. the client's per-channel roster assignment (admin-set), else
//   2. the global channel default (organic -> Eli, ads -> Cam).
// The explicit per-ticket override (admin "assign" action) is applied separately.
async function resolveContentAssignee(clientId, channel) {
  // Funnel content is owned by the marketing manager (Cam) - fixed owner, no
  // per-client roster override (deliberate; add a funnel roster column if
  // that ever changes).
  if (channel === "funnel") return await marketingManagerStaffId();
  const col = channel === "organic" ? "content_assignee_organic_id" : "content_assignee_ads_id";
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=${col}`);
    const rosterId = rows?.[0]?.[col];
    if (rosterId) return rosterId;
  } catch (_) { /* fall through to default */ }
  return channel === "organic" ? await organicDefaultStaffId() : await marketingManagerStaffId();
}

// Slack-DM id for a staff member by id (for pinging the resolved content owner).
async function staffSlackIdById(staffId) {
  if (!staffId) return null;
  try {
    const rows = await sb(`staff?id=eq.${staffId}&select=slack_user_id`);
    return rows?.[0]?.slack_user_id || null;
  } catch (_) {
    return null;
  }
}

// ─── Organic content credits (per-type monthly hard cap, V1) ───
// First day of the current calendar month, UTC midnight — the credit window start.
function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
// Organic creatives of `type` this calendar month that still hold a credit:
// anything not cancelled (delivered OR in-flight). Revisions reuse the same
// ticket, so they never double-count.
async function organicUsedThisMonth(clientId, type) {
  const since = encodeURIComponent(startOfMonthIso());
  const typeFilter = type ? `&type=eq.${type}` : "";   // omit type -> count ALL organic (the pool)
  const rows = await sb(`content_tickets?client_id=eq.${clientId}&channel=eq.organic${typeFilter}&status=neq.cancelled&submitted_at=gte.${since}&select=id`);
  return Array.isArray(rows) ? rows.length : 0;
}
// { total:{used,allowance,left}, video:{...}, graphic:{...} }. allowance null = no limit.
// total = combined pool (any type draws from it); video/graphic = optional hard caps.
async function organicCreditSummary(clientId) {
  const crows = await sb(`clients?id=eq.${clientId}&select=organic_total_credits_per_month,organic_video_credits_per_month,organic_graphic_credits_per_month`);
  const c = crows?.[0] || {};
  const out = {};
  const totalAllow = c.organic_total_credits_per_month == null ? null : Number(c.organic_total_credits_per_month);
  const totalUsed = await organicUsedThisMonth(clientId, null);
  out.total = { used: totalUsed, allowance: totalAllow, left: totalAllow == null ? null : Math.max(0, totalAllow - totalUsed) };
  for (const type of ["video", "graphic"]) {
    const col = type === "video" ? "organic_video_credits_per_month" : "organic_graphic_credits_per_month";
    const allowance = c[col] == null ? null : Number(c[col]);
    const used = await organicUsedThisMonth(clientId, type);
    out[type] = { used, allowance, left: allowance == null ? null : Math.max(0, allowance - used) };
  }
  return out;
}

// Announce a fresh marketing request: @Cam in #content-marketing (team
// coordination) + a DM to both Cam and the SM (ticket owner) for the full
// picture. Pass smId = the ticket's assigned_to. Safe to call unawaited.
function pingMarketingOnNewTicket({ ticketId, academy, priority, smId }, req) {
  const code = String(ticketId || "").slice(0, 3).toUpperCase();
  const pr = priority === "high" ? "⚡ HIGH priority " : "";
  const msg = `🆕 New marketing request ${pr}- ${academy || "client"} [${code}]`;
  Promise.all([marketingManagerSlackId(), staffSlackIdById(smId)]).then(([mgrSid, smSid]) => {
    if (mgrSid) postStaffSlackDM(mgrSid, msg, req);
    if (smSid && smSid !== mgrSid) postStaffSlackDM(smSid, msg, req);
    const who = slackMention(mgrSid);
    postContentMarketingSlack(`🆕 *New marketing request* ${pr}- ${academy || "client"} [${code}]${who ? " " + who : ""}`);
  });
}

async function enrichWithClient(tickets) {
  if (!tickets.length) return tickets;
  const clientIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))];
  const clientMap = {};
  if (clientIds.length) {
    const clients = await sb(`clients?id=in.(${clientIds.join(",")})&select=id,business_name,brand_data,scaling_manager_id,ads_content_approval_required`);
    Object.assign(clientMap, Object.fromEntries((clients || []).map(c => [c.id, c])));
  }
  // Resolve the assignee name: explicit assigned_to, else the client's manager.
  const staffIds = [...new Set([
    ...tickets.map(t => t.assigned_to),
    ...Object.values(clientMap).map(c => c?.scaling_manager_id),
  ].filter(Boolean))];
  const staffMap = {};
  if (staffIds.length) {
    const staff = await sb(`staff?id=in.(${staffIds.join(",")})&select=id,name`);
    Object.assign(staffMap, Object.fromEntries((staff || []).map(s => [s.id, s.name])));
  }
  return tickets.map(t => {
    const client = clientMap[t.client_id] || null;
    const assigneeId = t.assigned_to || client?.scaling_manager_id || null;
    const smId = client?.scaling_manager_id || null;
    return {
      ...t,
      client,
      assigned_to_name: assigneeId ? (staffMap[assigneeId] || null) : null,
      // The client's SM (scaling manager) — the contact to reach out to, shown
      // even when the ticket is owned by someone else (e.g. content → Cam).
      sm_name: smId ? (staffMap[smId] || null) : null,
    };
  });
}

// Spawn (or update, on a revision round-trip) the marketing ticket that a
// finished content ticket hands off to. Shared by the staff "Send to Marketing"
// action and the client auto-send on ads-content approval. `author` describes
// who triggered the handoff (staff or client) for the internal message.
// Returns the linked/spawned marketing ticket id.
async function spawnOrUpdateMarketingFromContent(ticket, { authorType, authorId, authorName, marketingNotes = "", req }) {
  const ctxObj = ticket.context || {};
  const source = ctxObj.source || "add-creative";
  const linkedMarketingId = ticket.marketing_ticket_id || null;

  if (linkedMarketingId) {
    // ── Revision round-trip — UPDATE the original marketing ticket ──
    const cur = await sb(`marketing_tickets?id=eq.${linkedMarketingId}&select=*`);
    const orig = cur?.[0];
    if (orig) {
      const newMessages = appendMessage(orig.messages, {
        author_type: authorType, author_id: authorId, author_name: authorName,
        body: marketingNotes
          ? `Revision uploaded. Notes for marketing: "${marketingNotes}"`
          : "Revision uploaded.",
        is_action_request: false,
        internal: true,
      });
      await sb(`marketing_tickets?id=eq.${linkedMarketingId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          files: ticket.final_files,
          awaiting_revision: false,
          messages: newMessages,
        }),
      });
    }
    return linkedMarketingId;
  }

  // ── Fresh spawn — INSERT a new marketing ticket ──
  const mktType =
    source === "new-campaign" ? "campaign-create" :
    source === "change-campaign" || source === "add-creative" ? "add" :
    "add";

  const mktFields = {
    campaign_title: ctxObj.campaign_title || "",
    note: ctxObj.note || "",
    priority: ctxObj.priority === "high" ? "high" : "normal",
  };
  if (mktType === "campaign-create") {
    mktFields.offer = ctxObj.offer || "";
    mktFields.is_new_offer = !!ctxObj.is_new_offer;
    mktFields.new_offer_description = ctxObj.new_offer_description || "";
    mktFields.monthly_spend = ctxObj.monthly_spend || "";
    mktFields.landing_page = ctxObj.landing_page || "";
  }
  if (ctxObj.related_creative_name) {
    mktFields.creative_name = ctxObj.related_creative_name;
  }
  const clientNotesRaw = (ticket.notes || "").trim();
  if (clientNotesRaw) {
    mktFields.client_notes = clientNotesRaw;
  }

  const initialMessage = {
    author_type: authorType, author_id: authorId, author_name: authorName,
    body: marketingNotes
      ? `Sent from content ticket (${ticket.type}). Notes for marketing: "${marketingNotes}"`
      : `Sent from content ticket (${ticket.type}).`,
    is_action_request: false,
    internal: true,
    created_at: nowIso(),
  };

  const marketingInsert = await sb("marketing_tickets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      client_id: ticket.client_id,
      type: mktType,
      status: "in-progress",
      content_check_status: "not-required",
      client_action_status: "none",
      fields: mktFields,
      files: ticket.final_files,
      messages: [initialMessage],
      originated_from_content_ticket_id: ticket.id,
      assigned_to: await clientScalingManager(ticket.client_id),
    }]),
  });
  const spawnedId = marketingInsert?.[0]?.id || null;
  if (spawnedId) {
    pingMarketingOnNewTicket({
      ticketId: spawnedId,
      academy: ctxObj.campaign_title || mktFields.campaign_title,
      priority: mktFields.priority,
      smId: marketingInsert?.[0]?.assigned_to,
    }, req);
  }
  return spawnedId;
}

// ─────────────────────────────────────────────────────────
// Main handler — routes by ?resource=
// ─────────────────────────────────────────────────────────

async function handler(req, res) {
  try {
    const resource = req.query.resource;
    if (resource === "content-deadlines-cron") {
      return await contentDeadlinesDigestCron(req, res);
    }
    if (resource === "meta-health-cron") {
      return await handleMetaHealthCron(req, res);
    }
    if (resource === "tickets") {
      return await handleMarketingTickets(req, res);
    }
    if (resource === "guide-cards") {
      return await handleGuideCards(req, res);
    }
    if (resource === "content-tickets") {
      return await handleContentTickets(req, res);
    }
    if (resource === "meta-adaccounts") {
      return await handleMetaAdAccounts(req, res);
    }
    if (resource === "meta-campaigns") {
      return await handleMetaCampaigns(req, res);
    }
    if (resource === "meta-kpis") {
      return await handleMetaKpis(req, res);
    }
    if (resource === "meta-report") {
      return await handleMetaReport(req, res);
    }
    if (resource === "meta-insight") {
      return await handleMetaInsight(req, res);
    }
    if (resource === "ghl-kpi-suggest") {
      return await handleGhlKpiSuggest(req, res);
    }
    if (resource === "ghl-kpis") {
      return await handleGhlKpis(req, res);
    }
    if (resource === "ghl-kpis-monthly") {
      return await handleGhlKpisMonthly(req, res);
    }
    if (resource === "ghl-kpi-detail") {
      return await handleGhlKpiDetail(req, res);
    }
    if (resource === "ghl-kpi-delete") {
      return await handleGhlKpiDelete(req, res);
    }
    if (resource === "ghl-kpi-restore") {
      return await handleGhlKpiRestore(req, res);
    }
    if (resource === "ghl-kpi-stripe") {
      return await handleGhlKpiStripe(req, res);
    }
    if (resource === "ghl-kpi-trash") {
      return await handleGhlKpiTrash(req, res);
    }
    if (resource === "meta-overview") {
      return await handleMetaOverview(req, res);
    }
    if (resource === "meta-creatives") {
      return await handleMetaCreatives(req, res);
    }
    if (resource === "meta-machine") {
      return await handleMetaMachine(req, res);
    }
    if (resource === "meta-staff-auth") {
      return await handleStaffMetaAuth(req, res);
    }
    if (resource === "meta-staff-status") {
      return await handleStaffMetaStatus(req, res);
    }
    if (resource === "onboarding") {
      return await handleOnboarding(req, res);
    }
    if (resource === "refresh-windows") {
      return await handleRefreshWindows(req, res);
    }
    return res.status(400).json({ error: "missing or invalid ?resource= (expected 'tickets' | 'guide-cards' | 'content-tickets' | 'meta-adaccounts' | 'meta-campaigns' | 'meta-kpis' | 'meta-report' | 'meta-insight' | 'meta-overview' | 'ghl-kpi-suggest' | 'ghl-kpis' | 'ghl-kpi-detail' | 'meta-creatives' | 'meta-staff-auth' | 'meta-staff-status' | 'onboarding')" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "internal error" });
  }
}

// ─────────────────────────────────────────────────────────
// MARKETING TICKETS
// ─────────────────────────────────────────────────────────

async function handleMarketingTickets(req, res) {
  const { id } = req.query;
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const isClient = !!ctx.client;
  if (!isStaff && !isClient) {
    return res.status(403).json({ error: "user is neither staff nor a linked client" });
  }

  if (req.method === "GET") {
    const scope = req.query.scope;
    let asStaff;
    if (scope === "staff")  asStaff = isStaff;
    else if (scope === "client") asStaff = false;
    else                    asStaff = isStaff && !isClient;

    if (id) {
      const rows = await sb(`marketing_tickets?id=eq.${id}&select=*`);
      const ticket = rows?.[0];
      if (!ticket) return res.status(404).json({ error: "not found" });
      if (!asStaff && (!isClient || ticket.client_id !== ctx.client.id)) {
        return res.status(403).json({ error: "not your ticket" });
      }
      const enriched = asStaff ? (await enrichWithClient([ticket]))[0] : stripInternalMessages(ticket);
      return res.status(200).json({ ticket: enriched });
    }

    // Pagination: default 50, cap at 200. Frontend can pass ?limit + ?offset.
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const pageQS = `&limit=${limit}&offset=${offset}`;

    if (asStaff) {
      // Optional client filter - used by the staff client-detail Marketing tab's
      // Tickets section to scope to one academy.
      const clientFilter = req.query.client_id ? `&client_id=eq.${req.query.client_id}` : "";
      const tickets = await sb(`marketing_tickets?select=*${clientFilter}&order=submitted_at.desc${pageQS}`);
      const out = await enrichWithClient(tickets || []);
      return res.status(200).json({ tickets: out, hasMore: (tickets || []).length === limit });
    }

    if (!isClient) return res.status(403).json({ error: "not authorized for this scope" });
    const tickets = await sb(`marketing_tickets?select=*&order=submitted_at.desc&client_id=eq.${ctx.client.id}${pageQS}`);
    return res.status(200).json({
      tickets: (tickets || []).map(stripInternalMessages),
      hasMore: (tickets || []).length === limit,
    });
  }

  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { type, fields, files } = body;
    if (!type) return res.status(400).json({ error: "type is required" });

    // Staff-initiated: a "confirm your monthly budgets" request. Creates a
    // budget-review ticket already flagged as awaiting client action, which the
    // client portal turns into an auto-popup on their next visit.
    if (type === "budget-review") {
      if (!isStaff) return res.status(403).json({ error: "staff only" });
      const clientId = body.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id is required" });
      const inserted = await sb("marketing_tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: clientId,
          type: "budget-review",
          status: "in-progress",
          content_check_status: "not-required",
          client_action_status: "requested",
          fields: { note: "Please confirm your monthly campaign budgets." },
          files: [],
          messages: [{
            author_type: "staff", author_id: ctx.staff.id,
            author_name: ctx.staff.name || "Marketing",
            body: "Requested the client to confirm their monthly budgets.",
            is_action_request: true, internal: false, created_at: nowIso(),
          }],
          assigned_to: await clientScalingManager(clientId),
        }]),
      });
      const t = inserted?.[0] || null;
      if (t) {
        const code = String(t.id || "").slice(0, 3).toUpperCase();
        postClientSlackNotification(clientId,
          `🔔 Action requested — please confirm your monthly budgets [${code}]`, req);
        notifyClientPush(clientId, "ticket-action-needed", {
          ticketTitle: "confirm your budgets", ticketId: t.id, view: "marketing",
        }).catch(() => {});
      }
      return res.status(201).json({ ticket: t });
    }

    if (!isClient) return res.status(403).json({ error: "only clients can submit marketing tickets" });
    const allowedTypes = ["replace", "add", "remove", "budget", "campaign-create"];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: `invalid type: ${type}` });

    const ccStatus = CONTENT_TYPES.has(type) ? "pending" : "not-required";

    const inserted = await sb("marketing_tickets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        client_id: ctx.client.id,
        type,
        status: "in-progress",
        content_check_status: ccStatus,
        client_action_status: "none",
        fields: fields || {},
        files: files || [],
        messages: [],
        // Auto-assign to the client's manager (the "SM") — owner of their tickets.
        assigned_to: await clientScalingManager(ctx.client.id),
      }]),
    });
    const newTicket = inserted?.[0] || null;
    if (newTicket) {
      pingMarketingOnNewTicket({
        ticketId: newTicket.id,
        academy: ctx.client.business_name,
        priority: fields?.priority,
        smId: newTicket.assigned_to,
      }, req);
    }
    return res.status(201).json({ ticket: newTicket });
  }

  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id query param is required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { action } = body;
    if (!action) return res.status(400).json({ error: "action is required in body" });

    const existing = await sb(`marketing_tickets?id=eq.${id}&select=*`);
    const ticket = existing?.[0];
    if (!ticket) return res.status(404).json({ error: "not found" });

    const staffActions = new Set(["approve-content", "request-client-action", "mark-completed", "request-content-revision", "hold", "resume"]);
    const clientActions = new Set(["cancel", "edit", "respond"]);

    if (action === "cancel" && isStaff) {
      // Staff may cancel any ticket (the UI has always offered the button; the
      // handler already writes "Cancelled by <staff name>"). Staff who are ALSO
      // client members previously fell into the client branch and got
      // "not your ticket" on other academies' tickets.
    } else if (staffActions.has(action)) {
      if (!isStaff) return res.status(403).json({ error: "staff only" });
    } else if (clientActions.has(action)) {
      if (!isClient) return res.status(403).json({ error: "client only" });
      if (ticket.client_id !== ctx.client.id) return res.status(403).json({ error: "not your ticket" });
    } else {
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    let patch = {};
    // Staff (not acting as a client) get the raw ticket back; clients get internal
    // messages stripped. Declared here because PATCH never set it before, which
    // crashed the respond/upload tail with "asStaff is not defined".
    const asStaff = isStaff && !isClient;
    const authorName = isStaff ? ctx.staff.name : (ctx.client.business_name || "Client");

    if (action === "approve-content") {
      if (ticket.content_check_status !== "pending") {
        return res.status(409).json({ error: "content check is not pending" });
      }
      patch.content_check_status = "approved";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Content approved.", is_action_request: false,
        internal: true,
      });
    } else if (action === "request-client-action") {
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "message is required" });
      patch.client_action_status = "requested";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: message, is_action_request: true,
      });
    } else if (action === "mark-completed") {
      patch.status = "completed";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Marked completed.", is_action_request: false,
      });
    } else if (action === "hold") {
      // Staff-only internal pause. NOT a status change - the client keeps seeing
      // the ticket exactly as before (hold is invisible to them; the activity
      // message is internal so it's stripped from the client view). No Slack/push.
      if (ticket.status !== "in-progress") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      if (ticket.on_hold === true) return res.status(409).json({ error: "already on hold" });
      patch.on_hold = true;
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Put on hold by ${authorName}.`, is_action_request: false,
        internal: true,
      });
    } else if (action === "resume") {
      if (ticket.on_hold !== true) return res.status(409).json({ error: "not on hold" });
      patch.on_hold = false;
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Resumed by ${authorName}.`, is_action_request: false,
        internal: true,
      });
    } else if (action === "cancel") {
      if (ticket.status !== "in-progress") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      patch.status = "cancelled";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: isStaff ? "staff" : "client",
        author_id: isStaff ? ctx.staff.id : undefined,
        author_name: authorName,
        body: isStaff ? `Cancelled by ${authorName}.` : "Cancelled by client.",
        is_action_request: false,
      });
    } else if (action === "edit") {
      if (ticket.status !== "in-progress") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      const summaryParts = [];
      if (body.fields && typeof body.fields === "object") {
        patch.fields = { ...(ticket.fields || {}), ...body.fields };
        summaryParts.push("Updated request details");
      }
      if (Array.isArray(body.files)) {
        patch.files = body.files;
        summaryParts.push("Updated files");
      }
      const noteText = (body.note || "").trim();
      if (!summaryParts.length && !noteText) {
        return res.status(400).json({ error: "nothing to update" });
      }
      let messageBody = summaryParts.join(", ") || "Added a note";
      if (noteText) {
        messageBody = summaryParts.length
          ? `${messageBody}. Note: "${noteText}"`
          : `Added a note: "${noteText}"`;
      }
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: messageBody, is_action_request: false,
      });
    } else if (action === "respond") {
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "message is required" });
      if (ticket.client_action_status !== "requested") {
        return res.status(409).json({ error: "no action was requested" });
      }
      patch.client_action_status = "responded";
      // Budget-review: the client's confirmation BECOMES one marketing support
      // ticket. We keep THIS ticket open (no auto-complete) and fold in the
      // confirmed per-campaign budgets so marketing can apply them and then mark
      // it completed. Always fires - even a "no changes" confirm leaves a ticket
      // the team can verify. budgets = [{ name, current, confirmed, changed }].
      let respBody = message;
      if (ticket.type === "budget-review" && Array.isArray(body.budgets)) {
        const budgets = body.budgets.map(b => ({
          name: String(b.name || "Campaign"),
          current: (b.current == null || b.current === "") ? null : Number(b.current),
          confirmed: (b.confirmed == null || b.confirmed === "") ? null : Number(b.confirmed),
          changed: !!b.changed,
        }));
        const changedCount = budgets.filter(b => b.changed).length;
        patch.fields = { ...(ticket.fields || {}), confirmed_budgets: budgets, changes_count: changedCount };
        // Stays in-progress as a marketing work ticket; make sure it has an owner.
        if (!ticket.assigned_to) patch.assigned_to = await clientScalingManager(ticket.client_id);
        // Build an itemized summary so the staff board reads at a glance.
        const lines = budgets.map(b => {
          const cur = b.current != null ? `$${b.current}` : "n/a";
          return b.changed
            ? `• ${b.name}: ${cur} → $${b.confirmed}  (change)`
            : `• ${b.name}: ${cur}  (no change)`;
        });
        respBody = `${changedCount ? `Confirmed monthly budgets - ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Confirmed monthly budgets - no changes"}:\n${lines.join("\n")}`;
      }
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: respBody, is_action_request: false,
      });
    } else if (action === "request-content-revision") {
      // Marketing wants the content team to redo the creative.
      // 1. Spawn a new content_ticket linked back to this marketing ticket
      // 2. Flip marketing.awaiting_revision = true so it leaves Active
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "revision notes are required" });

      const revisionType = body.type || "graphic";
      const originalFields = ticket.fields || {};
      const newContextNotes = `Revision requested by marketing.\n\n${message}`;

      // Pull the original raw files the client uploaded from the content
      // ticket that spawned this marketing ticket (if any). The content team
      // needs those, not just the polished creative — without them they're
      // working blind. Merge with the current marketing-side files so the
      // revision ticket carries every asset the content team might need.
      let originalRawFiles = [];
      if (ticket.originated_from_content_ticket_id) {
        try {
          const originRows = await sb(`content_tickets?id=eq.${ticket.originated_from_content_ticket_id}&select=raw_files`);
          if (Array.isArray(originRows?.[0]?.raw_files)) originalRawFiles = originRows[0].raw_files;
        } catch (_) { /* swallow — fall back to marketing files only */ }
      }
      const currentFiles = Array.isArray(ticket.files) ? ticket.files : [];
      const mergedFiles = (() => {
        const seen = new Set();
        const out = [];
        for (const f of [...originalRawFiles, ...currentFiles]) {
          const key = (f && f.url) || JSON.stringify(f);
          if (key && !seen.has(key)) { seen.add(key); out.push(f); }
        }
        return out;
      })();

      const contentInsert = await sb("content_tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: ticket.client_id,
          type: revisionType,
          status: "active",
          client_action_status: "none",
          notes: newContextNotes,
          raw_files: mergedFiles,
          context: {
            source: "marketing-revision",
            campaign_title: originalFields.campaign_title || "",
            related_creative_name: originalFields.creative_name || "",
            originated_from_marketing_ticket_id: ticket.id,
          },
          marketing_ticket_id: ticket.id, // direct link back so we know to UPDATE not INSERT on send-to-marketing
          messages: [{
            author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
            body: `Revision requested: ${message}`,
            is_action_request: false,
            internal: true,
            created_at: nowIso(),
          }],
        }]),
      });

      patch.awaiting_revision = true;
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Sent back to content for revision: "${message}". Tracking content ticket ${contentInsert?.[0]?.id || ""}.`,
        is_action_request: false,
        internal: true,
      });
    }

    const updated = await sb(`marketing_tickets?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });

    // Slack notify (fire-and-forget) on action-request or completion.
    // We don't await — keeps the API snappy and Slack errors don't break us.
    const code = String(ticket.id || "").slice(0, 3).toUpperCase();
    // SM (ticket owner) gets a full-picture DM on every status change. The team
    // channel stays for coordination (Ximena/Cam), not per-status SM noise.
    // Falls back to the client's SM if the ticket somehow has no assigned_to.
    // smDM takes a builder so the academy name is resolved lazily — only when a DM
    // will actually fire (sid present) — and dropped right into the ping so the SM
    // sees which academy the ticket belongs to (Mike's request, 2026-06-27).
    const smDM = (build) => (async () => {
      const smId = ticket.assigned_to || await clientScalingManager(ticket.client_id);
      const sid = await staffSlackIdById(smId);
      if (!sid) return;
      const academy = (await sb(`clients?id=eq.${ticket.client_id}&select=business_name`))?.[0]?.business_name || "client";
      postStaffSlackDM(sid, build(academy), req);
    })();
    if (action === "request-client-action") {
      const ask = (body.message || "").trim();
      postClientSlackNotification(ticket.client_id,
        `🔔 Action requested - Marketing [${code}]${ask ? `\n_${ask}_` : ""}`, req);
      notifyClientPush(ticket.client_id, "ticket-action-needed", {
        ticketTitle: "a marketing request", ticketId: ticket.id, view: "marketing",
      }).catch(() => {});
      smDM(a => `🔔 Action needed from client - ${a} · Marketing [${code}]`);
    } else if (action === "mark-completed") {
      // Client gets pinged in their channel...
      postClientSlackNotification(ticket.client_id,
        `✅ Completed - Marketing [${code}]`, req);
      notifyClientPush(ticket.client_id, "ticket-complete", {
        ticketTitle: "Your marketing request", ticketId: ticket.id, view: "marketing",
      }).catch(() => {});
      // ...and the SM gets a DM.
      smDM(a => `✅ Completed - ${a} · Marketing [${code}]`);
    } else if (action === "cancel") {
      postClientSlackNotification(ticket.client_id,
        `❌ Cancelled - Marketing [${code}]`, req);
      smDM(a => `❌ Cancelled - ${a} · Marketing [${code}]`);
    } else if (action === "respond") {
      smDM(a => `💬 Client responded - ${a} · Marketing [${code}]`);
    }

    // SEC-5: strip internal messages from any response that reaches a client.
    // Staff get the raw ticket (with internal notes intact).
    const outTicket = asStaff ? (updated?.[0] || null) : stripInternalMessages(updated?.[0]);
    return res.status(200).json({ ticket: outTicket });
  }

  return res.status(405).json({ error: "method not allowed" });
}

// ─────────────────────────────────────────────────────────
// GUIDE CARDS
// ─────────────────────────────────────────────────────────

async function handleGuideCards(req, res) {
  const { id } = req.query;
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff && !ctx.client) {
    return res.status(403).json({ error: "user is neither staff nor a linked client" });
  }

  const canWrite = ctx.staff && GUIDE_WRITE_ROLES.has(ctx.staff.role);

  if (req.method === "GET") {
    if (id) {
      const rows = await sb(`guide_cards?id=eq.${id}&select=*`);
      if (!rows?.[0]) return res.status(404).json({ error: "not found" });
      return res.status(200).json({ card: rows[0] });
    }
    const cards = await sb(`guide_cards?select=*&order=title.asc`);
    return res.status(200).json({ cards: cards || [] });
  }

  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    if (!canWrite) return res.status(403).json({ error: "admin or marketing role required" });
  }

  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const title = (body.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required" });

    const dupes = await sb(`guide_cards?title=eq.${encodeURIComponent(title)}&select=id`);
    if (dupes?.length) return res.status(409).json({ error: "a guide card with that title already exists" });

    // Only one card can be the First Campaign starter guide.
    if (body.is_default === true) {
      await sb(`guide_cards?is_default=eq.true`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_default: false }) });
    }

    const inserted = await sb("guide_cards", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        title,
        purpose: body.purpose || "",
        filming_tips: body.filming_tips || "",
        example_script: body.example_script || "",
        example_assets: Array.isArray(body.example_assets) ? body.example_assets : [],
        example_links:  Array.isArray(body.example_links)  ? body.example_links  : [],
        angles:         Array.isArray(body.angles)         ? body.angles         : [],
        is_default:     body.is_default === true,
        updated_by: ctx.staff.id,
      }]),
    });
    return res.status(201).json({ card: inserted?.[0] || null });
  }

  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id query param is required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};

    const patch = {};
    if (body.title !== undefined) {
      const newTitle = (body.title || "").trim();
      if (!newTitle) return res.status(400).json({ error: "title cannot be empty" });
      patch.title = newTitle;
    }
    if (body.purpose !== undefined)         patch.purpose = body.purpose || "";
    if (body.filming_tips !== undefined)    patch.filming_tips = body.filming_tips || "";
    if (body.example_script !== undefined)  patch.example_script = body.example_script || "";
    if (body.example_assets !== undefined)  patch.example_assets = Array.isArray(body.example_assets) ? body.example_assets : [];
    if (body.example_links !== undefined)   patch.example_links  = Array.isArray(body.example_links)  ? body.example_links  : [];
    if (body.angles !== undefined)          patch.angles         = Array.isArray(body.angles)         ? body.angles         : [];
    if (body.is_default !== undefined)      patch.is_default     = body.is_default === true;
    patch.updated_by = ctx.staff.id;

    // Only one card can be the First Campaign starter guide.
    if (patch.is_default === true) {
      await sb(`guide_cards?is_default=eq.true&id=neq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_default: false }) });
    }

    const updated = await sb(`guide_cards?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!updated?.[0]) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ card: updated[0] });
  }

  if (req.method === "DELETE") {
    if (!id) return res.status(400).json({ error: "id query param is required" });
    await sb(`guide_cards?id=eq.${id}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "method not allowed" });
}

// ─────────────────────────────────────────────────────────
// CONTENT TICKETS
// ─────────────────────────────────────────────────────────
// Lifecycle: client submits raw assets → content team turns them
// into final creatives → on "send-to-marketing" we spawn a new
// marketing_ticket carrying the finals + any campaign context.

async function handleContentTickets(req, res) {
  const { id } = req.query;
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const isClient = !!ctx.client;
  if (!isStaff && !isClient) {
    return res.status(403).json({ error: "user is neither staff nor a linked client" });
  }

  // Treat this request as staff (see internal messages, no strip) vs client
  // (stripped). Hoisted to FUNCTION scope so the PATCH branch's response also
  // uses it - it was previously declared only inside the GET branch, leaving
  // `asStaff` undefined in PATCH (crashed final uploads after the DB write).
  // `scope` disambiguates a dual-role user (staff who is also a client).
  const scope = req.query.scope;
  let asStaff;
  if (scope === "staff")  asStaff = isStaff;
  else if (scope === "client") asStaff = false;
  else                    asStaff = isStaff && !isClient;

  // ─── GET ───────────────────────────────────────────────────
  if (req.method === "GET") {

    if (id) {
      const rows = await sb(`content_tickets?id=eq.${id}&select=*`);
      const ticket = rows?.[0];
      if (!ticket) return res.status(404).json({ error: "not found" });
      if (!asStaff && (!isClient || ticket.client_id !== ctx.client.id)) {
        return res.status(403).json({ error: "not your ticket" });
      }
      const enriched = asStaff ? (await enrichWithClient([ticket]))[0] : stripInternalMessages(ticket);
      return res.status(200).json({ ticket: enriched });
    }

    // Organic credit summary for the meter ({ video, graphic } used/allowance/left).
    if (req.query.summary === "credits") {
      const clientId = asStaff ? (req.query.client_id || null) : ctx.client?.id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      return res.status(200).json({ credits: await organicCreditSummary(clientId) });
    }

    // Pagination: default 50, cap 200. Same shape as marketing tickets above.
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const pageQS = `&limit=${limit}&offset=${offset}`;
    // Optional channel filter ('ads' | 'organic').
    const channel = req.query.channel;
    const channelFilter = ["organic", "ads", "funnel"].includes(channel) ? `&channel=eq.${channel}` : "";

    if (asStaff) {
      // Staff list — oldest first per spec (so content team works FIFO)
      const tickets = await sb(`content_tickets?select=*${channelFilter}&order=submitted_at.asc${pageQS}`);
      const out = await enrichWithClient(tickets || []);
      return res.status(200).json({ tickets: out, hasMore: (tickets || []).length === limit });
    }

    // Client view: only return tickets where action is requested OR explicitly all=1
    if (!isClient) return res.status(403).json({ error: "not authorized for this scope" });
    const onlyActionable = req.query.all !== "1";
    // "requested" = a question to answer; "review-requested" = finished content
    // awaiting the client's approve/request-changes. Both need the client.
    const filter = onlyActionable
      ? `&client_action_status=in.(requested,review-requested)`
      : "";
    const tickets = await sb(`content_tickets?select=*&client_id=eq.${ctx.client.id}${filter}${channelFilter}&order=submitted_at.desc${pageQS}`);
    return res.status(200).json({
      tickets: (tickets || []).map(stripInternalMessages),
      hasMore: (tickets || []).length === limit,
    });
  }

  // ─── POST (client creates) ─────────────────────────────────
  if (req.method === "POST") {
    if (!isClient) return res.status(403).json({ error: "only clients can submit content tickets" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { type, notes, raw_files, context } = body;
    // Optional client-supplied creative name ("August camp promo"). Falls back
    // to null - lists render the type/notes preview when untitled.
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (!type) return res.status(400).json({ error: "type is required" });
    if (!["graphic", "video", "mixed"].includes(type)) {
      return res.status(400).json({ error: "type must be 'graphic', 'video', or 'mixed'" });
    }

    // Three channels: ads (Meta campaigns), organic (client socials, credit-
    // capped), funnel (website content - finals hand off to the systems team).
    const channel = ["organic", "funnel"].includes(body.channel) ? body.channel : "ads";

    // Funnel content is part of the scaling service (the client has a BAM-run
    // website). Content-only clients have no site to put it on.
    if (channel === "funnel") {
      const crows = await sb(`clients?id=eq.${ctx.client.id}&select=marketing_included`);
      if (crows?.[0]?.marketing_included === false) {
        return res.status(403).json({ error: "Funnel content isn't part of your current BAM plan." });
      }
    }

    // Per-type monthly organic credit cap (V1 hard limit, no overage). NULL allowance
    // = unlimited; 0 = none. Counts at request; cancelling a request frees the credit.
    if (channel === "organic") {
      // Organic requests are single-type so each counts toward the right limit —
      // a graphic+video upload (mixed) would otherwise bypass the caps entirely.
      if (type === "mixed") {
        return res.status(400).json({
          error: "For organic content, please submit videos and graphics as separate requests so each counts toward the right monthly limit.",
          code: "organic_single_type",
        });
      }
      if (type === "video" || type === "graphic") {
        const crows = await sb(`clients?id=eq.${ctx.client.id}&select=organic_total_credits_per_month,organic_video_credits_per_month,organic_graphic_credits_per_month`);
        const c = crows?.[0] || {};
        // 1. Per-type hard cap (optional; 0 = type not included).
        const typeCol = type === "video" ? "organic_video_credits_per_month" : "organic_graphic_credits_per_month";
        const typeAllow = c[typeCol];
        if (typeAllow != null) {
          const label = type === "video" ? "Video" : "Graphic";
          if (Number(typeAllow) === 0) {
            return res.status(403).json({
              error: `${label} creatives aren't included in your current plan.`,
              code: "credit_limit", type, used: 0, allowance: 0,
            });
          }
          const typeUsed = await organicUsedThisMonth(ctx.client.id, type);
          if (typeUsed >= Number(typeAllow)) {
            return res.status(403).json({
              error: `You've used all ${typeAllow} ${type} creative${typeAllow === 1 ? "" : "s"} for this month. Your allowance resets on the 1st.`,
              code: "credit_limit", type, used: typeUsed, allowance: Number(typeAllow),
            });
          }
        }
        // 2. Combined monthly pool (videos + graphics share it).
        const totalAllow = c.organic_total_credits_per_month;
        if (totalAllow != null) {
          const totalUsed = await organicUsedThisMonth(ctx.client.id, null);
          if (totalUsed >= Number(totalAllow)) {
            return res.status(403).json({
              error: `You've used all ${totalAllow} creative${totalAllow === 1 ? "" : "s"} for this month. Your allowance resets on the 1st.`,
              code: "credit_limit", type: "total", used: totalUsed, allowance: Number(totalAllow),
            });
          }
        }
      }
    }

    // Channel-aware routing: organic -> content team (Eli), ads -> marketing (Cam),
    // unless the admin roster assigns this client's channel to someone specific.
    const assignedTo = await resolveContentAssignee(ctx.client.id, channel);
    const inserted = await sb("content_tickets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        client_id: ctx.client.id,
        type,
        channel,
        title: title || null,
        status: "active",
        client_action_status: "none",
        notes: notes || "",
        raw_files: Array.isArray(raw_files) ? raw_files : [],
        context: (context && typeof context === "object") ? context : {},
        messages: [],
        // Internal owner; never surfaced to the client. The client's SM is shown
        // separately as the contact (sm_name on enrich).
        assigned_to: assignedTo,
      }]),
    });
    const newCt = inserted?.[0] || null;
    if (newCt) {
      // DM the resolved owner that a new content request landed (carries the urgent flag).
      const code = String(newCt.id || "").slice(0, 3).toUpperCase();
      const pr = (context?.priority === "high") ? "⚡ HIGH priority " : "";
      const label = channel === "organic" ? "organic content" : channel === "funnel" ? "funnel content" : "content";
      staffSlackIdById(assignedTo).then(sid => {
        if (sid) postStaffSlackDM(sid, `🆕 New ${label} request ${pr}- ${ctx.client.business_name || "client"} [${code}]`, req);
        const who = slackMention(sid);
        postContentMarketingSlack(`🆕 *New ${label} request* ${pr}- ${ctx.client.business_name || "client"} [${code}]${who ? " " + who : ""}`);
      });
    }
    return res.status(201).json({ ticket: newCt });
  }

  // ─── PATCH (actions) ───────────────────────────────────────
  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id query param is required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { action } = body;
    if (!action) return res.status(400).json({ error: "action is required in body" });

    const existing = await sb(`content_tickets?id=eq.${id}&select=*`);
    const ticket = existing?.[0];
    if (!ticket) return res.status(404).json({ error: "not found" });

    const staffActions = new Set([
      "upload-final", "set-final", "send-to-marketing", "send-for-review",
      "send-to-systems",
      "request-client-action", "mark-completed",
      "assign", "edit-context",
    ]);
    const clientActions = new Set(["cancel", "respond", "edit", "approve", "request-changes"]);

    if (action === "cancel" && isStaff) {
      // Staff may cancel any content ticket - same fix as the marketing
      // handler above; the cancel body already writes a staff-attributed
      // message. Cancelling frees an organic credit by design.
    } else if (staffActions.has(action)) {
      if (!isStaff) return res.status(403).json({ error: "staff only" });
    } else if (clientActions.has(action)) {
      if (!isClient) return res.status(403).json({ error: "client only" });
      if (ticket.client_id !== ctx.client.id) return res.status(403).json({ error: "not your ticket" });
    } else {
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    let patch = {};
    const authorName = isStaff ? ctx.staff.name : (ctx.client.business_name || "Client");

    if (action === "edit") {
      if (ticket.status !== "active") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      const newRawFiles = Array.isArray(body.raw_files) ? body.raw_files : null;
      const noteText = (body.note || "").trim();
      const summaryParts = [];

      if (newRawFiles) {
        const oldRaw = ticket.raw_files || [];
        const oldUrls = new Set(oldRaw.map(f => f.url));
        const newUrls = new Set(newRawFiles.map(f => f.url));
        const added = newRawFiles.filter(f => !oldUrls.has(f.url));
        const removed = oldRaw.filter(f => !newUrls.has(f.url));
        if (added.length) summaryParts.push(`Added ${added.length} file${added.length === 1 ? "" : "s"}`);
        if (removed.length) summaryParts.push(`Removed ${removed.length} file${removed.length === 1 ? "" : "s"}`);
        patch.raw_files = newRawFiles;
      }

      if (!summaryParts.length && !noteText) {
        return res.status(400).json({ error: "nothing to update" });
      }

      let messageBody = summaryParts.join(", ") || "Added a note";
      if (noteText) {
        messageBody = summaryParts.length
          ? `${messageBody}. Note: "${noteText}"`
          : `Added a note: "${noteText}"`;
      }
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: messageBody, is_action_request: false,
      });

    } else if (action === "upload-final") {
      const finals = Array.isArray(body.final_files) ? body.final_files : [];
      patch.final_files = [...(ticket.final_files || []), ...finals];
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Uploaded ${finals.length} final file${finals.length === 1 ? "" : "s"}.`,
        is_action_request: false,
        internal: true,
      });

    } else if (action === "set-final") {
      // Replace the whole final_files array - used to remove files uploaded by
      // mistake or to re-folder them. Staff-only.
      const prev = (ticket.final_files || []).length;
      patch.final_files = Array.isArray(body.final_files) ? body.final_files : [];
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Updated final files (${prev} -> ${patch.final_files.length}).`,
        is_action_request: false,
        internal: true,
      });

    } else if (action === "send-to-marketing") {
      if (!ticket.final_files || !ticket.final_files.length) {
        return res.status(409).json({ error: "upload at least one final creative before sending to marketing" });
      }
      const marketingNotes = (body.marketing_notes || "").trim();
      patch.marketing_ticket_id = await spawnOrUpdateMarketingFromContent(ticket, {
        authorType: "staff", authorId: ctx.staff.id, authorName, marketingNotes, req,
      });
      patch.status = "completed";
      patch.sent_to_marketing_at = nowIso();
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: marketingNotes
          ? `Sent to marketing. Notes: "${marketingNotes}"`
          : "Sent to marketing.",
        is_action_request: false,
        internal: true,
      });

    } else if (action === "request-client-action") {
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "message is required" });
      patch.status = "client-dependent";
      patch.client_action_status = "requested";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: message, is_action_request: true,
      });

    } else if (action === "mark-completed") {
      patch.status = "completed";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Marked completed.", is_action_request: false,
      });

    } else if (action === "assign") {
      // Reassigning a creative's owner is a manager/admin override — executors
      // (content_executor) work their own queue but can't hand tickets around.
      if (!CONTENT_MANAGER_ROLES.has(ctx.staff.role)) {
        return res.status(403).json({ error: "manager or admin role required to reassign" });
      }
      if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to || null;

    } else if (action === "edit-context") {
      // Staff correcting the client's brief in place (fix a typo, tighten notes,
      // adjust format/offer) without bouncing the ticket back to the client.
      const changed = [];
      if (body.context && typeof body.context === "object") {
        patch.context = { ...(ticket.context || {}), ...body.context };
        changed.push("brief details");
      }
      if (typeof body.notes === "string" && body.notes !== (ticket.notes || "")) {
        patch.notes = body.notes;
        changed.push("notes");
      }
      if (typeof body.title === "string") {
        const newTitle = body.title.trim().slice(0, 120) || null;
        if (newTitle !== (ticket.title || null)) {
          patch.title = newTitle;
          changed.push("title");
        }
      }
      if (patch.context === undefined && patch.notes === undefined && patch.title === undefined) {
        return res.status(400).json({ error: "nothing to update" });
      }
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Edited the client brief${changed.length ? ` (${changed.join(", ")})` : ""}.`,
        is_action_request: false,
        internal: true,
      });

    } else if (action === "send-to-systems") {
      // Funnel content only: finals are done, hand off to the systems team to
      // place on the client's website. Creates a Change ticket in the systems
      // flow (rides its existing Slack-on-insert + auto-due-date triggers) and
      // closes out the content side.
      if (ticket.channel !== "funnel") {
        return res.status(409).json({ error: "only funnel content can be sent to systems" });
      }
      if (ticket.status !== "active") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      const finals = Array.isArray(ticket.final_files) ? ticket.final_files : [];
      if (!finals.length) {
        return res.status(400).json({ error: "upload at least one final file before sending to systems" });
      }
      const staffNote = (body.note || "").trim();
      const label = (ticket.title || "").trim() || `${ticket.type} content`;
      const inserted = await sb("tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: ticket.client_id,
          type: "change",
          status: "open",
          priority: "normal",
          source: "funnel-content",
          fields: {
            // `title` doubles as the headline in the tickets-insert Slack
            // trigger (fields->>'title'), so the client channel confirm reads
            // "Change request submitted: Add funnel content..." not "(no title)".
            title: `Add funnel content to the website: ${label}`,
            what: `Add new funnel content to the website: ${label}`,
            how: [
              staffNote,
              (ticket.notes || "").trim() ? `Client brief: ${ticket.notes.trim()}` : "",
              `Final files are attached. Produced by the content team (content ticket ${String(ticket.id).slice(0, 3).toUpperCase()}).`,
            ].filter(Boolean).join("\n\n"),
            funnel_content_ticket_id: ticket.id,
          },
          menu_item: null,
          files: finals,
          messages: [],
          submitted_by_staff: ctx.staff.id,
        }]),
      });
      const sysTicket = inserted?.[0];
      if (!sysTicket) return res.status(500).json({ error: "failed to create the systems ticket" });
      patch.status = "completed";
      patch.resolved_at = nowIso();
      patch.context = { ...(ticket.context || {}), systems_ticket_id: sysTicket.id };
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Content finished - sent to the systems team to be added to your website.",
        is_action_request: false,
      });
      // No explicit client Slack here: the tickets-insert trigger
      // (notify_slack_on_new_ticket) already confirms the new Change ticket
      // in the client's channel - a second message would double-notify.

    } else if (action === "cancel") {
      if (!["active", "client-dependent"].includes(ticket.status)) {
        return res.status(409).json({ error: "ticket is not active" });
      }
      patch.status = "cancelled";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: isStaff ? "staff" : "client",
        author_id: isStaff ? ctx.staff.id : undefined,
        author_name: authorName,
        body: isStaff ? `Cancelled by ${authorName}.` : "Cancelled by client.",
        is_action_request: false,
      });

    } else if (action === "respond") {
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "message is required" });
      if (ticket.client_action_status !== "requested") {
        return res.status(409).json({ error: "no action was requested" });
      }
      patch.client_action_status = "responded";
      patch.status = "active";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: message, is_action_request: false,
      });

    } else if (action === "send-for-review") {
      // Content team sends the finished creative to the client to review.
      // Organic: review → approve adds it to the Creative Bank.
      // Ads (when the academy's ads_content_approval_required gate is on):
      //   review → approve auto-sends to marketing.
      // "review-requested" distinguishes a content review from a plain question
      // ("requested") so the client portal shows Approve/Request-changes here.
      if (!Array.isArray(ticket.final_files) || !ticket.final_files.length) {
        return res.status(400).json({ error: "upload at least one final creative before sending for review" });
      }
      patch.status = "client-dependent";
      patch.client_action_status = "review-requested";
      const note = (body.message || "").trim();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: note ? `Sent for your review: "${note}"` : "Sent for your review.",
        is_action_request: true,
      });

    } else if (action === "approve") {
      // Client approves a content review. Only valid while a review is open.
      if (ticket.client_action_status !== "review-requested") {
        return res.status(409).json({ error: "no review is awaiting approval" });
      }
      if (ticket.channel === "ads") {
        // Ads gate: approval auto-sends the finished creative to marketing.
        patch.marketing_ticket_id = await spawnOrUpdateMarketingFromContent(ticket, {
          authorType: "client", authorName, marketingNotes: "", req,
        });
        patch.status = "completed";
        patch.client_action_status = "responded";
        patch.sent_to_marketing_at = nowIso();
        patch.resolved_at = nowIso();
        patch.messages = appendMessage(ticket.messages, {
          author_type: "client", author_name: authorName,
          body: "Approved — sent to marketing.", is_action_request: false,
        });
      } else {
        // Organic: client approves the creative → moves to their Creative Bank.
        patch.status = "completed";
        patch.client_action_status = "responded";
        patch.resolved_at = nowIso();
        patch.messages = appendMessage(ticket.messages, {
          author_type: "client", author_name: authorName,
          body: "Approved — added to the creative bank.", is_action_request: false,
        });
      }

    } else if (action === "request-changes") {
      // Client wants changes on a content review → back to the content team.
      if (ticket.client_action_status !== "review-requested") {
        return res.status(409).json({ error: "no review is awaiting changes" });
      }
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "tell us what to change" });
      patch.status = "active";
      patch.client_action_status = "responded";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: `Requested changes: "${message}"`, is_action_request: false,
      });
    }

    const updated = await sb(`content_tickets?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });

    // Slack notify (fire-and-forget) — uniform template across all ticket types
    const code = String(ticket.id || "").slice(0, 3).toUpperCase();
    if (action === "request-client-action") {
      const ask = (body.message || "").trim();
      postClientSlackNotification(ticket.client_id,
        `🔔 Action requested — Content [${code}]${ask ? `\n_${ask}_` : ""}`, req);
      notifyClientPush(ticket.client_id, "ticket-action-needed", {
        ticketTitle: "a content request", ticketId: ticket.id, view: "marketing",
      }).catch(() => {});
    } else if (action === "send-for-review") {
      postClientSlackNotification(ticket.client_id,
        `🔔 Content ready for your review — [${code}]`, req);
      notifyClientPush(ticket.client_id, "ticket-action-needed", {
        ticketTitle: "content to review", ticketId: ticket.id, view: "marketing",
      }).catch(() => {});
    } else if (action === "mark-completed") {
      postClientSlackNotification(ticket.client_id,
        `✅ Completed — Content [${code}]`, req);
      notifyClientPush(ticket.client_id, "ticket-complete", {
        ticketTitle: "Your content request", ticketId: ticket.id, view: "marketing",
      }).catch(() => {});
      postContentMarketingSlack(`✅ *Completed* - Content [${code}]`);
    } else if (action === "send-to-marketing") {
      // Stamp Ximena's timeline on the ping: urgent = 2 biz days, standard = 4,
      // from now (the moment it lands in marketing).
      const mktPri = (ticket.context && ticket.context.priority === "high") ? "high" : "normal";
      const dueStr = _fmtDue(_mktDueDate(nowIso(), mktPri));
      const tag = mktPri === "high" ? " ⚡ URGENT" : "";
      marketingExecutorSlackId().then(sid =>
        postContentMarketingSlack(`➡️ *Sent to marketing* - Content [${code}] is ready to launch.${tag}${dueStr ? ` Due ${dueStr}.` : ""}${slackMention(sid) ? " " + slackMention(sid) : ""}`));
    } else if (action === "respond") {
      staffSlackIdById(ticket.assigned_to).then(sid =>
        postContentMarketingSlack(`💬 *Client responded* - Content [${code}]${slackMention(sid) ? " " + slackMention(sid) : ""}`));
    } else if (action === "cancel") {
      postClientSlackNotification(ticket.client_id,
        `❌ Cancelled — Content [${code}]`, req);
    }

    // SEC-5: strip internal messages from any response that reaches a client.
    const outTicket = asStaff ? (updated?.[0] || null) : stripInternalMessages(updated?.[0]);
    return res.status(200).json({ ticket: outTicket });
  }

  return res.status(405).json({ error: "method not allowed" });
}

// ─────────────────────────────────────────────────────────
// META OAUTH + API
// ─────────────────────────────────────────────────────────
// Meta is staff-managed. Client-side OAuth has been removed.
// Staff connect via /api/auth/staff-meta/* and the team token wires
// every client's ad account. The client_meta_tokens table is no
// longer read or written (kept in DB as historical record only).

const META_API_VERSION = "v22.0";
const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
// Messaging scopes (Meta DM spine, 2026-07-03): pages_messaging +
// instagram_manage_messages power direct IG/Messenger DMs; pages_show_list +
// pages_manage_metadata let us derive the Page token + subscribe the Page to
// the app's webhook; instagram_basic is required alongside IG messaging.
// Staff must RECONNECT Meta after this deploys for the token to carry them
// (same dance as the 2026-06-06 write-scopes add).
const META_OAUTH_SCOPES = [
  "ads_read", "ads_management", "business_management", "public_profile",
  "pages_show_list", "pages_manage_metadata", "pages_messaging",
  "instagram_basic", "instagram_manage_messages",
];

function metaGetOrigin(req) {
  // Pinned to the canonical staff URL — the Meta OAuth redirect URI
  // registered in the Meta app config must match exactly. Without this,
  // Vercel's *.vercel.app preview hostname leaks into the redirect_uri
  // param and Meta rejects with "URL Blocked".
  if (process.env.STAFF_PORTAL_URL) return process.env.STAFF_PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://staff.byanymeansbusiness.com";
}

function metaSignState(payload) {
  const secret = process.env.META_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function metaVerifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("invalid state format");
  const [data, sig] = state.split(".");
  const secret = process.env.META_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("bad signature");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) throw new Error("state expired");
  return payload;
}

// Staff-side ad account picker. Lists ad accounts the LOGGED-IN STAFF has
// access to (via user-role or BAM-BM partner connections). Used by the staff
// portal when assigning a meta_ad_account_id to a specific client.
//
// POST also accepts client_id+ad_account_id to wire a client's ad account
// without that client ever logging into Facebook.
//
// Restricted to admin + marketing roles (the people who actually wire up ads).
const META_OPS_ROLES = MARKETING_OPS_ROLES;
// "Our Ads" editors: the internal-acquisition crew may pick campaigns on the
// dedicated internal entry (INTERNAL_ADS_CLIENT_ID) even if their global role
// isn't a marketing/admin one. Scoped to that one entry — no access to real
// clients' ad config.
// Both login domains (bball.com legacy + business.com) and cam/cameron, so the
// scoped bypass matches whichever address they actually authenticate with.
const INTERNAL_ADS_EDITORS = new Set([
  "zoran@byanymeansbball.com", "zoran@byanymeansbusiness.com",
  "mike@byanymeansbball.com", "mike@byanymeansbusiness.com",
  "coleman@byanymeansbball.com", "coleman@byanymeansbusiness.com",
  "cam@byanymeansbball.com", "cam@byanymeansbusiness.com",
  "cameron@byanymeansbball.com", "cameron@byanymeansbusiness.com",
]);
async function handleMetaAdAccounts(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  // Both staff and clients can call this. Staff use it to pick an ad account
  // on behalf of a client (?client_id=… via Client Setup). Clients use it
  // post-OAuth to pick their own ad account.
  if (!ctx.staff && !ctx.client) return res.status(403).json({ error: "auth required" });
  const internalAdsClientId = (process.env.INTERNAL_ADS_CLIENT_ID || "").trim();
  const isInternalAdsEditor = !!ctx.staff && !!internalAdsClientId &&
    INTERNAL_ADS_EDITORS.has((ctx.staff.email || "").toLowerCase());
  if (ctx.staff && !META_OPS_ROLES.has(ctx.staff.role) && !isInternalAdsEditor) {
    return res.status(403).json({ error: "admin or marketing role required" });
  }
  // Internal-ads editors who aren't ops staff may only write to the internal entry.
  if (isInternalAdsEditor && !META_OPS_ROLES.has(ctx.staff.role)) {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const target = req.method === "POST"
      ? (typeof body.client_id === "string" ? body.client_id.trim() : "")
      : (req.query.client_id || "").trim();
    if ((req.method === "POST" || req.method === "DELETE") && target !== internalAdsClientId) {
      return res.status(403).json({ error: "internal ads editor: writes limited to the internal entry" });
    }
  }

  // POST → set a client's chosen ad account.
  // Staff: body.client_id required (they're assigning for someone else).
  // Client: auto-scoped to their own client row; body.client_id ignored.
  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const targetClientId = ctx.client
      ? ctx.client.id
      : (typeof body.client_id === "string" ? body.client_id.trim() : "");
    const chosen = typeof body.ad_account_id === "string" ? body.ad_account_id.trim() : "";
    if (!targetClientId) return res.status(400).json({ error: "client_id required" });
    if (!chosen) return res.status(400).json({ error: "ad_account_id required" });
    const patch = {
      meta_ad_account_id: chosen,
      onboarding_completed_at: nowIso(),
      updated_at: nowIso(),
    };
    // campaign_ids: optional array of strings. null/empty array = no filter
    // (client sees all campaigns in the ad account).
    if (Array.isArray(body.campaign_ids)) {
      const cleaned = body.campaign_ids
        .map(c => (typeof c === "string" ? c.trim() : ""))
        .filter(Boolean);
      patch.meta_campaign_ids = cleaned.length ? cleaned : null;
    }
    await sb(`clients?id=eq.${targetClientId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    return res.status(200).json({
      ok: true,
      client_id: targetClientId,
      meta_ad_account_id: chosen,
      meta_campaign_ids: patch.meta_campaign_ids ?? null,
    });
  }

  // DELETE → unset a client's ad account
  if (req.method === "DELETE") {
    const targetClientId = (req.query.client_id || "").trim();
    if (!targetClientId) return res.status(400).json({ error: "client_id required" });
    await sb(`clients?id=eq.${targetClientId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ meta_ad_account_id: null, updated_at: nowIso() }),
    });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "GET, POST, or DELETE" });

  // GET → list every ad account accessible to the caller's Meta token.
  //
  // Client callers don't reach this anymore (client-side OAuth removed);
  // the UI on client-portal.html no longer surfaces an ad-account picker.
  // Staff callers use their own staff_meta_tokens first, then fall back
  // to any team token, so any admin/marketing role can do Client Setup
  // without personally connecting Meta.
  let tok = null;
  let usingOwnToken = false;
  if (ctx.client) {
    // Defensive — surface a clear error if anyone reaches this from the
    // client side via a stale path. UI never calls this for clients now.
    return res.status(404).json({ error: "Meta is managed by BAM staff for your account. Ask your BAM contact if you need a change." });
  }
  const ownTokRows = await sb(`staff_meta_tokens?staff_user_id=eq.${ctx.user.id}&select=access_token,expires_at,fb_user_name`);
  if (ownTokRows?.[0]) {
    tok = ownTokRows[0];
    usingOwnToken = true;
  } else {
    const teamRows = await sb(`staff_meta_tokens?select=access_token,expires_at,fb_user_name&order=updated_at.desc&limit=1`);
    if (teamRows?.[0]) tok = teamRows[0];
  }
  if (!tok) return res.status(404).json({ error: "Meta not connected. Connect your Meta account on the staff side first." });

  const fbRes = await fetch(`${META_GRAPH}/me/adaccounts?` + new URLSearchParams({
    fields: "id,account_id,name,currency,account_status",
    access_token: tok.access_token,
    limit: "200",
  }));
  const fbJson = await fbRes.json();
  if (!fbRes.ok) {
    return res.status(fbRes.status).json({ error: fbJson?.error?.message || "Meta API error" });
  }
  return res.status(200).json({
    ad_accounts: fbJson.data || [],
    fb_user_name: tok.fb_user_name || null,
    using_team_token: !usingOwnToken,
  });
}

// Picks any valid staff token to query Meta on behalf of clients. Falls back
// to most-recently-updated token. Returns null if no staff has connected yet.
async function getAnyStaffMetaToken() {
  const rows = await sb(`staff_meta_tokens?select=access_token&order=updated_at.desc&limit=1`);
  return rows?.[0]?.access_token || null;
}

// GET → returns onboarding state for the current client.
// POST → marks onboarding complete (used by Skip / Done in the wizard).
async function handleOnboarding(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.client) return res.status(403).json({ error: "client only" });

  if (req.method === "GET") {
    const rows = await sb(`clients?id=eq.${ctx.client.id}&select=onboarding_completed_at,meta_ad_account_id`);
    const r = rows?.[0] || {};
    return res.status(200).json({
      onboarding_completed_at: r.onboarding_completed_at || null,
      meta_ad_account_id: r.meta_ad_account_id || null,
    });
  }

  if (req.method === "POST") {
    await sb(`clients?id=eq.${ctx.client.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ onboarding_completed_at: nowIso(), updated_at: nowIso() }),
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "GET or POST" });
}

async function handleMetaCampaigns(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  // staff_picker=1 mode: staff is browsing all campaigns in a client's ad
  // account to decide which ones to associate. Bypasses the meta_campaign_ids
  // filter that would otherwise hide some. Requires staff auth + ?client_id=.
  const isStaffPicker = req.query.staff_picker === "1" && ctx.staff;

  // Both clients (viewing their own portal) and staff (debugging/preview) can call this.
  // For client requests, scope to the client. For staff requests, expect ?client_id=...
  // Staff viewing a specific client via ?client_id= must win over any ctx.client
  // the caller might also resolve to (otherwise a staff user who is also a client
  // would silently read THEIR data, not the academy they opened).
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const clientRows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids`);
  const clientFull = clientRows?.[0];

  // Always use the team staff token to query Meta. Client-side OAuth was
  // removed — there's only one token source now, which makes attribution +
  // refresh management much simpler.
  const staffToken = await getAnyStaffMetaToken();

  if (!clientFull?.meta_ad_account_id) {
    // No ad account wired yet. Frontend shows passive "BAM is setting
    // this up" copy + sample data — no CTA (Meta is staff-managed).
    return res.status(200).json({
      campaigns: [],
      reason: "no_ad_account",
      meta_connected: false,
    });
  }
  if (!staffToken) return res.status(200).json({ campaigns: [], reason: "no_staff_token" });
  const tok = { access_token: staffToken };

  const adAcct = clientFull.meta_ad_account_id.startsWith("act_")
    ? clientFull.meta_ad_account_id
    : `act_${clientFull.meta_ad_account_id}`;

  // Only return campaigns that are actually running. effective_status
  // covers nuances like CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED — we want
  // strictly ACTIVE (delivering ads right now).
  const cRes = await fetch(`${META_GRAPH}/${adAcct}/campaigns?` + new URLSearchParams({
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights.date_preset(this_month){spend,actions,cost_per_action_type,results}",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]),
    access_token: tok.access_token,
    limit: "50",
  }));
  const cJson = await cRes.json();
  if (!cRes.ok) {
    return res.status(cRes.status).json({ error: cJson?.error?.message || "Meta API error" });
  }

  const campaigns = (cJson.data || []).map(c => {
    const ins = c.insights?.data?.[0] || {};
    const spend = parseFloat(ins.spend || "0");
    let resultsCount = 0;
    if (Array.isArray(ins.results) && ins.results[0]?.values?.[0]?.value) {
      resultsCount = parseInt(ins.results[0].values[0].value, 10) || 0;
    } else if (Array.isArray(ins.actions)) {
      const link = ins.actions.find(a => a.action_type === "link_click");
      resultsCount = link ? parseInt(link.value, 10) || 0 : 0;
    }
    const cpr = resultsCount > 0 ? spend / resultsCount : 0;
    // Preset/planned ad spend = the campaign's Meta budget (minor units → $).
    // Only present when set at the CAMPAIGN level (CBO); ad-set-level budgets
    // aren't returned on the campaign object, so this can be null.
    const daily = c.daily_budget ? parseFloat(c.daily_budget) / 100 : null;
    const lifetime = c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null;
    const budget_display = lifetime ? `$${lifetime.toFixed(2)} lifetime` : (daily ? `$${daily.toFixed(2)}/day` : null);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      spend,
      spend_display: `$${spend.toFixed(2)}`,
      results: resultsCount,
      cpr,
      cpr_display: resultsCount > 0 ? `$${cpr.toFixed(2)}` : "—",
      budget_display,
    };
  });

  // Filter: outside staff-picker mode, ONLY return the client's associated
  // campaigns. The shared ad account holds every academy's campaigns, so an
  // empty filter must return nothing (not "all") — otherwise this client sees
  // every other academy's campaigns. staff_picker=1 bypasses this so staff can
  // pick from the full list.
  const associated = Array.isArray(clientFull.meta_campaign_ids) ? clientFull.meta_campaign_ids : null;
  let filtered = campaigns;
  if (!isStaffPicker) {
    if (!associated || !associated.length) {
      return res.status(200).json({ campaigns: [], reason: "no_campaigns_selected" });
    }
    const allow = new Set(associated);
    filtered = campaigns.filter(c => allow.has(c.id));
  }

  return res.status(200).json({
    campaigns: filtered,
    // Only echo the filter list to staff (clients don't need to know about it)
    ...(isStaffPicker ? { meta_campaign_ids: associated || [] } : {}),
  });
}

// Action types that count as a "lead" across Meta's various tracking
// setups. GTA's lead-gen campaign registers conversions as
// offsite_conversion.fb_pixel_custom (a custom pixel event) rather than
// standard `lead` actions, so all four are summed.
const LEAD_ACTION_TYPES = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "offsite_conversion.fb_pixel_custom",
]);

function countLeads(actions) {
  if (!Array.isArray(actions)) return 0;
  let n = 0;
  for (const a of actions) {
    if (LEAD_ACTION_TYPES.has(a.action_type)) n += parseInt(a.value, 10) || 0;
  }
  return n;
}

// GET ?resource=meta-kpis&client_id=<id>
// Marketing KPIs for a client's ad account:
//   - yesterday: leads / spend / cpl (the full prior calendar day)
//   - lastWeek + weekBefore: two complete Monday-Sunday weeks
//   - leadChangePct: week-over-week lead change for drop-off detection
// One Meta API call (daily increment over the whole span), then bucketed.
async function handleMetaKpis(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  // Staff viewing a specific client via ?client_id= must win over any ctx.client
  // the caller might also resolve to (otherwise a staff user who is also a client
  // would silently read THEIR data, not the academy they opened).
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const clientRows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids`);
  const clientFull = clientRows?.[0];
  if (!clientFull?.meta_ad_account_id) {
    return res.status(200).json({ reason: "no_ad_account" });
  }
  const staffToken = await getAnyStaffMetaToken();
  if (!staffToken) return res.status(200).json({ reason: "no_staff_token" });

  // Scope to this client's own campaigns. The shared ad account holds every
  // academy's campaigns, so without a filter this would blend all of them into
  // one client's lead-flow numbers. No filter = clean empty state, not a blend.
  const allow = Array.isArray(clientFull.meta_campaign_ids) && clientFull.meta_campaign_ids.length
    ? new Set(clientFull.meta_campaign_ids) : null;
  if (!allow) return res.status(200).json({ reason: "no_campaigns_selected" });

  const adAcct = clientFull.meta_ad_account_id.startsWith("act_")
    ? clientFull.meta_ad_account_id
    : `act_${clientFull.meta_ad_account_id}`;

  // ── Date windows (UTC). Weeks are Monday-Sunday, both complete. ──
  const fmt = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setUTCDate(now.getUTCDate() - 1);
  const dow = now.getUTCDay();                 // 0=Sun .. 6=Sat
  const daysSinceSun = dow === 0 ? 7 : dow;    // days back to the last completed Sunday
  const lastSunday = new Date(now); lastSunday.setUTCDate(now.getUTCDate() - daysSinceSun);
  const lastMonday = new Date(lastSunday); lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);
  const prevSunday = new Date(lastMonday); prevSunday.setUTCDate(lastMonday.getUTCDate() - 1);
  const prevMonday = new Date(prevSunday); prevMonday.setUTCDate(prevSunday.getUTCDate() - 6);

  // Single fetch spanning the earliest needed day (prevMonday) through yesterday.
  const rangeSince = fmt(prevMonday);
  const rangeUntil = fmt(yesterday) >= fmt(lastSunday) ? fmt(yesterday) : fmt(lastSunday);
  const insUrl = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,spend,actions",
    time_range: JSON.stringify({ since: rangeSince, until: rangeUntil }),
    time_increment: "1",
    access_token: staffToken,
    limit: "500",
  });
  const insRes = await fetch(insUrl);
  const insJson = await insRes.json();
  if (!insRes.ok) {
    return res.status(insRes.status).json({ error: insJson?.error?.message || "Meta API error" });
  }

  const yKey = fmt(yesterday);
  const lwStart = fmt(lastMonday), lwEnd = fmt(lastSunday);
  const wbStart = fmt(prevMonday), wbEnd = fmt(prevSunday);
  const buckets = {
    yesterday:  { leads: 0, spend: 0 },
    lastWeek:   { leads: 0, spend: 0 },
    weekBefore: { leads: 0, spend: 0 },
  };
  for (const row of (insJson.data || [])) {
    if (allow && !allow.has(row.campaign_id)) continue;
    const d = row.date_start;
    const leads = countLeads(row.actions);
    const spend = parseFloat(row.spend || "0") || 0;
    if (d === yKey) { buckets.yesterday.leads += leads; buckets.yesterday.spend += spend; }
    if (d >= lwStart && d <= lwEnd) { buckets.lastWeek.leads += leads; buckets.lastWeek.spend += spend; }
    if (d >= wbStart && d <= wbEnd) { buckets.weekBefore.leads += leads; buckets.weekBefore.spend += spend; }
  }

  const shape = (b) => ({
    leads: b.leads,
    spend: Math.round(b.spend * 100) / 100,
    cpl: b.leads > 0 ? Math.round((b.spend / b.leads) * 100) / 100 : null,
  });

  // Week-over-week lead change %
  let leadChangePct = null;
  if (buckets.weekBefore.leads > 0) {
    leadChangePct = Math.round(
      ((buckets.lastWeek.leads - buckets.weekBefore.leads) / buckets.weekBefore.leads) * 100
    );
  }

  return res.status(200).json({
    ad_account: adAcct,
    yesterday:  { date: yKey, ...shape(buckets.yesterday) },
    lastWeek:   { start: lwStart, end: lwEnd, ...shape(buckets.lastWeek) },
    weekBefore: { start: wbStart, end: wbEnd, ...shape(buckets.weekBefore) },
    leadChangePct,
  });
}

// Sum a single Meta action type (e.g. "landing_page_view") out of the
// insights `actions` array. Same shape as countLeads but for one type.
function countAction(actions, type) {
  if (!Array.isArray(actions)) return 0;
  let n = 0;
  for (const a of actions) {
    if (a.action_type === type) n += parseInt(a.value, 10) || 0;
  }
  return n;
}

// Industry benchmark defaults — Ximena's hand-noted standards for the
// sports/training/coaching niche. These are the fallback "goal lines" when
// a client has no custom goal set (clients.meta_cpl_goal / meta_monthly_budget).
const MKT_BENCHMARKS = {
  cpl: 25,                     // target cost-per-lead ($); "good to keep around $25"
  ctr_min: 1.5, ctr_max: 2.5,  // link CTR % — sports/coaching industry
  freq_min: 2,  freq_max: 4,   // monthly frequency — sports/coaching industry
};

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

const META_CAMPAIGN_FIELDS = "campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,actions";

function daysInUTCMonth(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
function verdictFor(cpl, target) {
  if (cpl == null) return { verdict: "attention", verdict_label: "Worth revisiting" };
  if (!target || cpl <= target) return { verdict: "strong", verdict_label: "Performing well" };
  if (cpl <= target * 1.5) return { verdict: "steady", verdict_label: "On track" };
  return { verdict: "attention", verdict_label: "Worth revisiting" };
}

const _r2 = (n) => Math.round(n * 100) / 100;

// Fold one Meta insights row into a running campaign accumulator.
function sumRowInto(acc, row) {
  acc.spend += parseFloat(row.spend || "0") || 0;
  acc.impressions += parseInt(row.impressions || "0", 10) || 0;
  acc.reach += parseInt(row.reach || "0", 10) || 0;
  acc.link_clicks += parseInt(row.inline_link_clicks || "0", 10) || 0;
  acc.leads += countLeads(row.actions);
  acc.landing_page_views += countAction(row.actions, "landing_page_view");
  return acc;
}
function newAcc() {
  return { spend: 0, impressions: 0, reach: 0, link_clicks: 0, leads: 0, landing_page_views: 0 };
}
// Turn an accumulator into the public campaign/totals metric shape.
function finalizeMetrics(acc) {
  return {
    leads: acc.leads,
    cpl: acc.leads > 0 ? _r2(acc.spend / acc.leads) : null,
    spend: _r2(acc.spend),
    reach: acc.reach,
    impressions: acc.impressions,
    link_clicks: acc.link_clicks,
    landing_page_views: acc.landing_page_views,
    ctr: acc.impressions > 0 ? _r2((acc.link_clicks / acc.impressions) * 100) : null,
    frequency: acc.reach > 0 ? _r2(acc.impressions / acc.reach) : null,
  };
}
function totalsFromCampaigns(campaigns) {
  const acc = campaigns.reduce((a, c) => {
    a.spend += c.spend; a.leads += c.leads;
    a.impressions += c.impressions; a.reach += c.reach;
    a.link_clicks += c.link_clicks; a.landing_page_views += c.landing_page_views;
    return a;
  }, newAcc());
  return finalizeMetrics(acc);
}

// GET ?resource=meta-report&client_id=<id>&months=<n>&window=monthly|last7
// Automates Ximena's KPI sheet: per-campaign Meta metrics (leads, CPL, spend,
// reach, impressions, link clicks, landing page views, CTR, frequency).
//   window=monthly (default) → one row per campaign per month, last N months,
//     ONE Meta call (level=campaign, time_increment=monthly).
//   window=last7 → last 7 complete days vs the previous 7 (for deltas), ONE
//     Meta call (level=campaign, time_increment=1 over 14 days, bucketed).
// Always returns the client's goals + industry benchmark defaults.
async function handleMetaReport(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  // Staff viewing a specific client via ?client_id= must win over any ctx.client
  // the caller might also resolve to (otherwise a staff user who is also a client
  // would silently read THEIR data, not the academy they opened).
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const months = Math.min(Math.max(parseInt(req.query.months || "8", 10) || 8, 1), 24);

  // Resilient select: meta_cpl_goal / meta_monthly_budget may not exist yet
  // (migration: supabase/marketing_goals.sql). Fall back without them so the
  // report works before AND after the columns are added.
  let clientFull = null;
  try {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids,meta_cpl_goal,meta_monthly_budget`);
    clientFull = rows?.[0] || null;
  } catch {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids`);
    clientFull = rows?.[0] || null;
  }

  const goals = {
    cpl_goal: clientFull?.meta_cpl_goal != null ? Number(clientFull.meta_cpl_goal) : null,
    monthly_budget: clientFull?.meta_monthly_budget != null ? Number(clientFull.meta_monthly_budget) : null,
  };
  const base = { goals, benchmarks: MKT_BENCHMARKS };

  if (!clientFull?.meta_ad_account_id) return res.status(200).json({ reason: "no_ad_account", ...base });
  const staffToken = await getAnyStaffMetaToken();
  if (!staffToken) return res.status(200).json({ reason: "no_staff_token", ...base });

  const adAcct = clientFull.meta_ad_account_id.startsWith("act_")
    ? clientFull.meta_ad_account_id
    : `act_${clientFull.meta_ad_account_id}`;

  // Per-client campaign filter. The BAM staff Meta token spans EVERY academy's
  // campaigns inside one shared ad account, so an empty filter must NOT fall back
  // to "show every active campaign" — that blends (and, for a logged-in client,
  // leaks) every other academy's spend into this client's report. Require an
  // explicit selection; until staff pick this client's campaigns, return a clean
  // empty state instead of an all-academy total.
  const allow = Array.isArray(clientFull.meta_campaign_ids) && clientFull.meta_campaign_ids.length
    ? new Set(clientFull.meta_campaign_ids) : null;
  if (!allow) return res.status(200).json({ reason: "no_campaigns_selected", ...base });

  const fmt = (d) => d.toISOString().slice(0, 10);
  const FIELDS = "campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,actions";

  // ── window=range: arbitrary [since, until], optional previous-period compare ──
  // since/until are YYYY-MM-DD (inclusive). compare=1 also fetches the equal-length
  // window immediately before `since`. ONE Meta call (time_increment=1), bucketed.
  if (req.query.window === "range") {
    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    const since = String(req.query.since || "");
    const until = String(req.query.until || "");
    if (!reDate.test(since) || !reDate.test(until)) {
      return res.status(400).json({ error: "since/until must be YYYY-MM-DD", ...base });
    }
    const sinceD = new Date(since + "T00:00:00Z");
    const untilD = new Date(until + "T00:00:00Z");
    if (untilD < sinceD) return res.status(400).json({ error: "until must be on/after since", ...base });
    const compare = req.query.compare === "1";
    const DAY = 86400000;
    const lenDays = Math.round((untilD - sinceD) / DAY) + 1; // inclusive
    const prevUntilD = new Date(sinceD.getTime() - DAY);
    const prevSinceD = new Date(prevUntilD.getTime() - (lenDays - 1) * DAY);
    const fetchSince = compare ? prevSinceD : sinceD;

    const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
      level: "campaign", fields: FIELDS,
      time_range: JSON.stringify({ since: fmt(fetchSince), until: fmt(untilD) }),
      time_increment: "1", access_token: staffToken, limit: "500",
    });
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || "Meta API error", ...base });

    const splitDay = fmt(sinceD); // rows on/after `since` = current period
    const cur = new Map(), prev = new Map();
    for (const row of (j.data || [])) {
      if (allow && !allow.has(row.campaign_id)) continue;
      const bucket = (row.date_start >= splitDay) ? cur : prev;
      if (!bucket.has(row.campaign_id)) bucket.set(row.campaign_id, { name: row.campaign_name || "(unnamed)", acc: newAcc() });
      sumRowInto(bucket.get(row.campaign_id).acc, row);
    }
    const campaigns = [...cur.entries()].map(([id, v]) => ({ id, name: v.name, ...finalizeMetrics(v.acc) }));
    const period = {
      key: "range",
      label: `${since} to ${until}`,
      campaigns,
      totals: totalsFromCampaigns(campaigns),
    };
    if (compare) {
      const prevCampaigns = [...prev.entries()].map(([id, v]) => ({ id, ...finalizeMetrics(v.acc) }));
      period.compareTotals = totalsFromCampaigns(prevCampaigns);
      period.compareCampaigns = prevCampaigns;
      period.compareLabel = `${fmt(prevSinceD)} to ${fmt(prevUntilD)}`;
    }
    return res.status(200).json({ ad_account: adAcct, view: "range", periods: [period], ...base });
  }

  // ── window=last7: last 7 complete days vs previous 7 ──────────────────
  if (req.query.window === "last7") {
    const now = new Date();
    const until = new Date(now); until.setUTCDate(now.getUTCDate() - 1);   // yesterday (complete)
    const since = new Date(until); since.setUTCDate(until.getUTCDate() - 13); // 14-day span
    const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
      level: "campaign", fields: FIELDS,
      time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }),
      time_increment: "1", access_token: staffToken, limit: "500",
    });
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || "Meta API error", ...base });

    const splitDay = fmt(new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - 6)));
    const cur = new Map();   // id → { name, acc }
    const prev = new Map();
    for (const row of (j.data || [])) {
      if (allow && !allow.has(row.campaign_id)) continue;
      const bucket = (row.date_start >= splitDay) ? cur : prev;
      if (!bucket.has(row.campaign_id)) bucket.set(row.campaign_id, { name: row.campaign_name || "(unnamed)", acc: newAcc() });
      sumRowInto(bucket.get(row.campaign_id).acc, row);
    }
    const campaigns = [...cur.entries()].map(([id, v]) => ({ id, name: v.name, ...finalizeMetrics(v.acc) }));
    const prevCampaigns = [...prev.entries()].map(([id, v]) => ({ id, ...finalizeMetrics(v.acc) }));
    const period = {
      key: "last7",
      label: "Last 7 days",
      campaigns,
      totals: totalsFromCampaigns(campaigns),
      compareTotals: totalsFromCampaigns(prevCampaigns),
      compareLabel: "previous 7 days",
      compareCampaigns: prevCampaigns,
    };
    return res.status(200).json({ ad_account: adAcct, view: "last7", periods: [period], ...base });
  }

  // ── window=monthly (default): one row per campaign per month ──────────
  const now = new Date();
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
    level: "campaign", fields: FIELDS,
    time_range: JSON.stringify({ since: fmt(startMonth), until: fmt(now) }),
    time_increment: "monthly", access_token: staffToken, limit: "500",
  });
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || "Meta API error", ...base });

  const monthsMap = new Map(); // "YYYY-MM" → Map(id → {name, acc})
  for (const row of (j.data || [])) {
    if (allow && !allow.has(row.campaign_id)) continue;
    const monthKey = (row.date_start || "").slice(0, 7);
    if (!monthKey) continue;
    if (!monthsMap.has(monthKey)) monthsMap.set(monthKey, new Map());
    const m = monthsMap.get(monthKey);
    if (!m.has(row.campaign_id)) m.set(row.campaign_id, { name: row.campaign_name || "(unnamed)", acc: newAcc() });
    sumRowInto(m.get(row.campaign_id).acc, row);
  }

  const periods = [...monthsMap.keys()].sort().reverse().map((key) => {
    const campaigns = [...monthsMap.get(key).entries()].map(([id, v]) => ({ id, name: v.name, ...finalizeMetrics(v.acc) }));
    const [yy, mm] = key.split("-");
    return {
      key,
      label: `${MONTH_NAMES[parseInt(mm, 10) - 1]} ${yy}`,
      campaigns,
      totals: totalsFromCampaigns(campaigns),
    };
  });

  return res.status(200).json({ ad_account: adAcct, view: "monthly", periods, ...base });
}

// Deterministic fallback insight (no Claude key / API error). Mirrors the
// wording tiers Zoran approved — never says "bad", always constructive.
function ruleInsight(totals, campaigns, goals, bm, audience = "client") {
  const target = (goals && goals.cpl_goal != null) ? goals.cpl_goal : bm.cpl;
  const t = totals || {};
  const money = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US");

  let verdict, verdict_label;
  if (t.cpl == null) { verdict = "attention"; verdict_label = "Worth revisiting"; }
  else if (t.cpl <= target) { verdict = "strong"; verdict_label = "Performing well"; }
  else if (t.cpl <= target * 1.5) { verdict = "steady"; verdict_label = "On track"; }
  else { verdict = "attention"; verdict_label = "Worth revisiting"; }

  const headline = t.cpl == null
    ? `Spent ${money(t.spend)} so far — no leads recorded yet.`
    : `Spent ${money(t.spend)} and brought in ${t.leads} lead${t.leads === 1 ? "" : "s"} at ${money(t.cpl)} each.`;

  const list = Array.isArray(campaigns) ? campaigns : [];
  const withLeads = list.filter(c => c.cpl != null);
  const best = withLeads.slice().sort((a, b) => a.cpl - b.cpl)[0];
  const worst = list.slice().sort((a, b) => (b.cpl == null ? 1e9 : b.cpl) - (a.cpl == null ? 1e9 : a.cpl))[0];
  const win = best ? `${best.name} is your most efficient — ${money(best.cpl)} per lead.` : `Leads are still coming in — give campaigns a few more days of data.`;

  // Results-first vs diagnostic framing depends on the audience.
  //  - client: lead with results (leads, CPL vs target). Click rate / frequency
  //    / reach are SUPPORTING CONTEXT, never the headline when CPL is on target.
  //  - staff: lead with the diagnostic signal — that's what staff act on.
  const resultsStrong = t.cpl != null && t.cpl <= target && t.leads > 0;
  const overTarget = list.filter(c => c.cpl != null && c.cpl > target).sort((a, b) => b.cpl - a.cpl)[0];
  let fix;
  if (audience === "client") {
    if (overTarget) fix = `${overTarget.name}'s cost per lead is above your ${money(target)} target — tighten the audience or improve the landing page to bring it down.`;
    else if (resultsStrong) fix = best ? `Your cost per lead is beating target — the move now is to put more behind ${best.name} and pull in more leads.` : `Cost per lead is on target — keep it running and let the leads build.`;
    else if (worst && worst.ctr != null && worst.ctr < bm.ctr_min) fix = `Results are tracking — one thing to watch: ${worst.name}'s click rate is a little low, so a fresh hook could make leads even cheaper.`;
    else if (worst && worst.frequency != null && worst.frequency > bm.freq_max) fix = `Results are tracking — one thing to watch: ${worst.name} is being shown to the same people a lot, so refreshing the ad would help.`;
    else fix = `Everything's tracking near target — keep it running.`;
  } else {
    fix = `Everything's tracking near target — keep it running.`;
    if (worst) {
      if (worst.ctr != null && worst.ctr < bm.ctr_min) fix = `${worst.name}'s click rate is low — refresh the creative so more people click.`;
      else if (worst.frequency != null && worst.frequency > bm.freq_max) fix = `${worst.name} is being shown too often to the same people — widen the audience or refresh the ad.`;
      else if (worst.cpl != null && worst.cpl > target) fix = `${worst.name}'s cost per lead is above target — tighten targeting or improve the landing page.`;
    }
  }

  const perCampaign = {};
  for (const c of list) {
    if (c.cpl == null) { perCampaign[c.id] = `Spent ${money(c.spend)} with no leads yet.`; continue; }
    if (audience === "client") {
      // Results lead: CPL-vs-target first; click rate / frequency are secondary.
      if (c.cpl > target) perCampaign[c.id] = `${money(c.cpl)} per lead, a bit over your ${money(target)} target — worth a tweak.`;
      else if (c.ctr != null && c.ctr < bm.ctr_min) perCampaign[c.id] = `${money(c.cpl)} per lead — under target. Click rate's a little low, so there's room to make it even cheaper.`;
      else if (c.frequency != null && c.frequency > bm.freq_max) perCampaign[c.id] = `${money(c.cpl)} per lead — under target. People have seen this a lot, so a refresh keeps it working.`;
      else perCampaign[c.id] = `${money(c.cpl)} per lead — at or under your ${money(target)} target.`;
    } else {
      if (c.ctr != null && c.ctr < bm.ctr_min) perCampaign[c.id] = `${money(c.cpl)} per lead. Few people are clicking — a fresh hook would help.`;
      else if (c.frequency != null && c.frequency > bm.freq_max) perCampaign[c.id] = `${money(c.cpl)} per lead. People have seen this a lot — time to refresh.`;
      else if (c.cpl > target) perCampaign[c.id] = `${money(c.cpl)} per lead, a bit over your ${money(target)} target.`;
      else perCampaign[c.id] = `${money(c.cpl)} per lead — at or under your ${money(target)} target.`;
    }
  }
  return { verdict, verdict_label, headline, win, fix, campaigns: perCampaign, source: "rule" };
}

// POST ?resource=meta-insight  → Claude-written, plain-English coaching for a
// period: a constructive verdict, a money-framed headline, the biggest win,
// the biggest fix, and a one-line note per campaign. Falls back to ruleInsight
// when ANTHROPIC_API_KEY is missing or the call fails, so the UI never breaks.
// Body: { label, totals, campaigns, goals, benchmarks }.
async function handleMetaInsight(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.client && !ctx.staff) return res.status(403).json({ error: "client or staff required" });

  const body = req.body || {};
  const goals = body.goals || { cpl_goal: null, monthly_budget: null };
  const bm = body.benchmarks || MKT_BENCHMARKS;
  const totals = body.totals || {};
  const campaigns = Array.isArray(body.campaigns) ? body.campaigns : [];
  const label = String(body.label || "this period").slice(0, 60);
  const audience = body.audience === "staff" ? "staff" : "client";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json(ruleInsight(totals, campaigns, goals, bm, audience));

  const target = (goals && goals.cpl_goal != null) ? goals.cpl_goal : bm.cpl;
  const data = JSON.stringify({ period: label, target_cpl: target, monthly_budget: goals.monthly_budget,
    benchmarks: bm, totals, campaigns }, null, 0);

  const audienceRule = audience === "client"
    ? "AUDIENCE = the academy owner (a client). Put the MOST weight on results: leads, cost per lead vs target, and conversions. Treat click rate, frequency and reach as SUPPORTING CONTEXT only — never make them the headline or the main 'fix' when cost per lead is at or under target. Only raise them when results are off target, and even then frame them as a secondary 'one thing to watch'."
    : "AUDIENCE = internal marketing staff who use click rate, frequency and reach to DIAGNOSE campaigns. It's fine to surface those technical signals directly in the fix and per-campaign notes when relevant.";

  const system = [
    "You are a friendly, plain-spoken marketing coach writing for a sports-academy owner who does NOT understand advertising jargon.",
    "Read the Meta ad metrics and explain what they MEAN and what to DO — never just restate numbers.",
    audienceRule,
    "Rules: No emojis. No jargon (say 'click rate' not 'CTR', 'how often people saw it' not 'frequency'). Frame in plain money where useful.",
    "Tone: constructive and encouraging. NEVER say performance is 'bad' or 'poor'. For weak results say 'worth revisiting' or 'room to improve'.",
    "verdict must be exactly one of: strong, steady, attention.",
    "verdict_label must be one of: 'Performing well' (strong), 'On track' (steady), 'Worth revisiting' (attention).",
    "Keep headline to one sentence. win and fix to one sentence each. Each per-campaign note one short sentence.",
    "Return ONLY valid JSON, no markdown, with exactly these keys: verdict, verdict_label, headline, win, fix, campaigns (an object mapping each campaign id to its note string).",
  ].join(" ");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system,
        messages: [{ role: "user", content: `Here is the ad data as JSON:\n\n${data}\n\nWrite the coaching JSON now.` }],
      }),
    });
    if (!r.ok) return res.status(200).json(ruleInsight(totals, campaigns, goals, bm, audience));
    const j = await r.json();
    const text = j.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(200).json(ruleInsight(totals, campaigns, goals, bm, audience));
    const parsed = JSON.parse(match[0]);
    // Guard the required shape; fall back if Claude drifted.
    if (!parsed.verdict || !parsed.headline) return res.status(200).json(ruleInsight(totals, campaigns, goals, bm, audience));
    if (!parsed.campaigns || typeof parsed.campaigns !== "object") parsed.campaigns = {};
    parsed.source = "ai";
    return res.status(200).json(parsed);
  } catch {
    return res.status(200).json(ruleInsight(totals, campaigns, goals, bm, audience));
  }
}

// POST ?resource=ghl-kpi-suggest  (staff only) — DISCOVERY SPIKE.
// Maps an academy's GHL pipeline stages onto the canonical acquisition funnel
// and recommends KPIs. Deterministic stage-name matcher (see _ghl_funnel.js) —
// confirmed against BAM GTA's stage semantics, and the pattern recurs across
// academies. Stages it can't confidently match are returned "(unmapped)" for
// staff to fix. Read-only; nothing is saved. Body: { businessName,
// pipelines:[{name,stages:[{name}]}], stageCounts:{stageName:n} }.
async function handleGhlKpiSuggest(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff) return res.status(403).json({ error: "staff only" });

  const body = req.body || {};
  const pipelines = Array.isArray(body.pipelines) ? body.pipelines : [];
  const stageCounts = body.stageCounts || {};

  // Unique stage names across all pipelines, in pipeline order.
  const seen = new Set();
  const stageNames = [];
  for (const p of pipelines) for (const s of (p.stages || [])) {
    const nm = (s?.name || "").trim();
    if (nm && !seen.has(nm)) { seen.add(nm); stageNames.push(nm); }
  }

  const mapping = stageNames.map(name => {
    const canonical = mapStageName(name);
    return { stage: name, canonical: canonical || "(unmapped)", confidence: canonical ? "high" : "low", count: stageCounts[name] ?? null };
  });

  const order = ["Lead", "Contacted", "Booked", "Showed", "Trial", "Won", "Lost"];
  const present = [...new Set(mapping.map(m => m.canonical).filter(c => order.includes(c)))];
  const missing = ["Lead", "Contacted", "Booked", "Showed", "Won"].filter(s => !present.includes(s));
  const unmapped = mapping.filter(m => m.canonical === "(unmapped)").map(m => m.stage);
  const { kpis, hidden } = buildKpis(present);

  const matched = mapping.filter(m => m.confidence === "high").length;
  let summary = `Recognised ${matched} of ${mapping.length} stages and mapped them onto the funnel (Lead → Contacted → Booked → Showed → Won, with Lost tracked).`;
  if (unmapped.length) summary += ` Needs your call on: ${unmapped.join(", ")}.`;
  else if (missing.length) summary += ` No stage detected for: ${missing.join(", ")}.`;
  else summary += " All core funnel steps are represented.";

  return res.status(200).json({
    summary, mapping, missing, unmapped,
    kpis, hidden_kpis: hidden,
    canonical: CANONICAL_FUNNEL,
    source: "rules",
  });
}

// GET ?resource=ghl-kpis&client_id=<id>&days=<n>
// The live funnel KPIs, counted from ghl_funnel_events (forms/messages/bookings)
// + Stripe conversions, with CAC vs Meta spend. Leads = form submissions;
// response/booking/conversion = distinct contacts; rates are vs leads.
async function handleGhlKpis(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  // Staff viewing a specific client via ?client_id= must win over any ctx.client
  // the caller might also resolve to (otherwise a staff user who is also a client
  // would silently read THEIR data, not the academy they opened).
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const days = Math.min(Math.max(parseInt(req.query.days || "30", 10) || 30, 1), 365);
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000);
  const sinceIso = since.toISOString();

  // Client meta (for CAC) + last sync time (for stale-while-revalidate).
  let adAccount = null, syncedAt = null;
  try {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=meta_ad_account_id,ghl_synced_at`);
    adAccount = rows?.[0]?.meta_ad_account_id || null;
    syncedAt = rows?.[0]?.ghl_synced_at || null;
  } catch { /* columns may not exist yet */ }

  let events = [];
  try {
    // Fetch all events for the client and window-filter in JS. (A PostgREST
    // occurred_at=gte filter with a URL-encoded timestamp silently matched
    // nothing — the verify count proved JS filtering is correct.)
    events = await sb(`ghl_funnel_events?client_id=eq.${targetClientId}&excluded=is.false&select=event_type,contact_id,contact_email,contact_phone,occurred_at&limit=20000`) || [];
  } catch {
    // table may not exist yet (migration not run) — treat as no data.
    return res.status(200).json({ days, since: sinceIso, ready: false, synced_at: syncedAt, leads: 0, trials: 0, clients_new: 0, clients_existing: 0 });
  }

  // GTA's 3-KPI funnel: Leads in → Trials booked → New clients.
  // Dedupe EVERY stage to one unique person (GHL contact → email → phone).
  const key = (e) => e.contact_id || e.contact_email || e.contact_phone || Math.random().toString();
  const leadSet = new Set(), trialSet = new Set(), newSet = new Set(), existingSet = new Set(), allSet = new Set();
  for (const e of events) {
    if (e.occurred_at && e.occurred_at < sinceIso) continue; // window filter (in JS)
    const k = key(e);
    if (e.event_type === "lead") leadSet.add(k);
    else if (e.event_type === "trial") trialSet.add(k);
    else if (e.event_type === "client_new") { newSet.add(k); allSet.add(k); }
    else if (e.event_type === "client_existing") { existingSet.add(k); allSet.add(k); }
  }
  const leads = leadSet.size;
  const trials = trialSet.size;
  const clients_new = newSet.size;
  const clients_existing = existingSet.size;
  const clients_all = allSet.size;
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 1000) / 10 : null;

  // CAC vs Meta spend over the same window.
  let spend = null;
  try {
    const token = await getAnyStaffMetaToken();
    if (adAccount && token) {
      const adAcct = adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`;
      const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
        fields: "spend",
        time_range: JSON.stringify({ since: sinceIso.slice(0, 10), until: now.toISOString().slice(0, 10) }),
        access_token: token,
      });
      const r = await fetch(url);
      const j = await r.json();
      if (r.ok) spend = parseFloat(j.data?.[0]?.spend || "0") || 0;
    }
  } catch { /* spend stays null */ }

  const round2 = (n) => Math.round(n * 100) / 100;
  return res.status(200).json({
    days, since: sinceIso, ready: true, synced_at: syncedAt,
    debug: { fetched: events.length, used_client_id: targetClientId },
    leads, trials, clients_new, clients_existing, clients_all,
    rates: {
      trial_rate: pct(trials, leads),         // leads → trials booked
      new_client_rate: pct(clients_new, leads), // leads → new clients
    },
    spend: spend == null ? null : round2(spend),
    cac: spend == null ? null : {
      per_lead: leads ? round2(spend / leads) : null,
      per_trial: trials ? round2(spend / trials) : null,
      per_new_client: clients_new ? round2(spend / clients_new) : null,
    },
  });
}

// GET ?resource=ghl-kpis-monthly&client_id=&months=
// Month-by-month KPIs: current month-to-date (first entry) + N prior full months.
// Same 3-KPI model + CAC as ghl-kpis, but bucketed by calendar month (UTC) and
// deduped to one unique person PER MONTH. CAC uses per-month Meta spend.
async function handleGhlKpisMonthly(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const monthsBack = Math.min(Math.max(parseInt(req.query.months || "6", 10) || 6, 1), 24);

  // Build the month buckets, newest first. key=YYYY-MM (UTC), with ISO start/end.
  const now = new Date();
  const buckets = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    buckets.push({ key, label, start, end, is_current: i === 0,
      _sets: { lead: new Set(), trial: new Set(), client_new: new Set(), client_existing: new Set(), all: new Set() } });
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));

  let adAccount = null, syncedAt = null, cfg = {};
  try {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=meta_ad_account_id,ghl_synced_at,ghl_kpi_config`);
    adAccount = rows?.[0]?.meta_ad_account_id || null;
    syncedAt = rows?.[0]?.ghl_synced_at || null;
    cfg = rows?.[0]?.ghl_kpi_config || {};
  } catch { /* columns may not exist */ }

  // Per-month forms/calendars: a month uses its EXACT `effective_configs` entry
  // (keyed by `from` = that month) if set, else the top-level default selection.
  // An empty set = "no filter" (count all lead/trial events).
  const overrides = (Array.isArray(cfg.effective_configs) ? cfg.effective_configs : [])
    .slice().sort((a, b) => String(a.from || "").localeCompare(String(b.from || "")));
  const overrideMap = new Map(overrides.map(o => [String(o.from || ""), o]));
  const defForms = Array.isArray(cfg.lead_form_ids) ? cfg.lead_form_ids : [];
  const defCals = Array.isArray(cfg.booking_calendar_ids) ? cfg.booking_calendar_ids : [];
  // website_lead_forms: form_type keys of website forms (entry_points) whose
  // submissions count as leads for the month — the post-GHL-forms era.
  const defWebForms = Array.isArray(cfg.website_lead_forms) ? cfg.website_lead_forms : [];
  const effectiveFor = (monthKey) => {
    const chosen = overrideMap.get(monthKey);
    return chosen
      ? { from: chosen.from, forms: chosen.lead_form_ids || [], cals: chosen.booking_calendar_ids || [],
          webForms: chosen.website_lead_forms || [],
          formNames: chosen.lead_form_names || [], calNames: chosen.booking_calendar_names || [] }
      : { from: null, forms: defForms, cals: defCals, webForms: defWebForms, formNames: cfg.lead_form_names || [], calNames: cfg.booking_calendar_names || [] };
  };
  for (const b of buckets) {
    b._eff = effectiveFor(b.key);
    b._formSet = new Set(b._eff.forms);
    b._calSet = new Set(b._eff.cals);
    b._webFormSet = new Set(b._eff.webForms);
  }

  let events = [];
  try {
    events = await sb(`ghl_funnel_events?client_id=eq.${targetClientId}&excluded=is.false&select=event_type,contact_id,contact_email,contact_phone,occurred_at,raw&limit=20000`) || [];
  } catch {
    return res.status(200).json({ ready: false, synced_at: syncedAt, months: [] });
  }

  const key = (e) => e.contact_id || e.contact_email || e.contact_phone || Math.random().toString();
  const monthKeyOf = (iso) => { const d = new Date(iso); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  for (const e of events) {
    if (!e.occurred_at) continue;
    const b = byKey.get(monthKeyOf(e.occurred_at));
    if (!b) continue;
    const k = key(e);
    if (e.event_type === "lead") {
      // Website-form leads (raw.websiteForm) count only when the month's era
      // selects them; GHL-form leads keep the existing formId filter. This is
      // what keeps KPIs continuous across the GHL-forms → website cutover.
      if (e.raw && e.raw.websiteForm) {
        if (b._webFormSet.has(e.raw.websiteForm)) b._sets.lead.add(k);
      } else if (b._formSet.size === 0 || (e.raw && b._formSet.has(e.raw.formId))) {
        b._sets.lead.add(k);
      }
    } else if (e.event_type === "trial") {
      if (b._calSet.size === 0 || (e.raw && b._calSet.has(e.raw.calendarId))) b._sets.trial.add(k);
    } else if (e.event_type === "client_new") { b._sets.client_new.add(k); b._sets.all.add(k); }
    else if (e.event_type === "client_existing") { b._sets.client_existing.add(k); b._sets.all.add(k); }
  }

  // Per-month Meta spend (one monthly-increment insights call across the range).
  const spendByMonth = {};
  try {
    const token = await getAnyStaffMetaToken();
    if (adAccount && token) {
      const adAcct = adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`;
      const since = buckets[buckets.length - 1].start.toISOString().slice(0, 10);
      const until = now.toISOString().slice(0, 10);
      const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
        fields: "spend", time_increment: "monthly",
        time_range: JSON.stringify({ since, until }), access_token: token,
      });
      const r = await fetch(url);
      const j = await r.json();
      if (r.ok) for (const row of (j.data || [])) {
        const mk = (row.date_start || "").slice(0, 7);
        if (mk) spendByMonth[mk] = parseFloat(row.spend || "0") || 0;
      }
    }
  } catch { /* spend stays empty → CAC null */ }

  const round2 = (n) => Math.round(n * 100) / 100;
  const months = buckets.map(b => {
    const leads = b._sets.lead.size, trials = b._sets.trial.size;
    const clients_new = b._sets.client_new.size, clients_existing = b._sets.client_existing.size, clients_all = b._sets.all.size;
    const spend = b.key in spendByMonth ? round2(spendByMonth[b.key]) : null;
    return {
      key: b.key, label: b.label, is_current: b.is_current,
      start: b.start.toISOString(), end: b.end.toISOString(),
      leads, trials, clients_new, clients_existing, clients_all,
      spend,
      cac: spend == null ? null : {
        per_lead: leads ? round2(spend / leads) : null,
        per_trial: trials ? round2(spend / trials) : null,
        per_new_client: clients_new ? round2(spend / clients_new) : null,
      },
      // Which forms/calendars feed THIS month (effective-dated). override_from is
      // the `from` of the override in effect, or null when using the default.
      forms: { ids: [...b._formSet], names: b._eff.formNames },
      calendars: { ids: [...b._calSet], names: b._eff.calNames },
      override_from: b._eff.from,
    };
  });

  return res.status(200).json({
    ready: true, synced_at: syncedAt, months,
    config: {
      default: { lead_form_ids: defForms, lead_form_names: cfg.lead_form_names || [], booking_calendar_ids: defCals, booking_calendar_names: cfg.booking_calendar_names || [] },
      effective_configs: overrides,
    },
  });
}

// GET ?resource=ghl-kpi-detail&client_id=&days=&type=&month=YYYY-MM
// The records BEHIND a KPI number, so staff can verify the count by name.
// type: 'lead' | 'trial' | 'client_new' | 'clients_all'. Pass month=YYYY-MM to
// scope to a calendar month (else uses days= as a rolling window).
async function handleGhlKpiDetail(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required" });

  const days = Math.min(Math.max(parseInt(req.query.days || "30", 10) || 30, 1), 365);
  const type = String(req.query.type || "client_new");

  // Window: a calendar month (?month=YYYY-MM) takes precedence over the rolling
  // ?days= window. monthEnd is exclusive (first instant of the next month).
  let sinceIso, untilIso = null;
  const monthParam = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : null;
  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    sinceIso = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    untilIso = new Date(Date.UTC(y, m, 1)).toISOString();
  } else {
    sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  }

  let events = [];
  try {
    events = await sb(`ghl_funnel_events?client_id=eq.${targetClientId}&excluded=is.false&select=id,event_type,contact_email,contact_id,contact_phone,occurred_at,value,raw&order=occurred_at.desc&limit=20000`) || [];
  } catch { return res.status(200).json({ type, days, count: 0, items: [] }); }

  const wanted = type === "clients_all"
    ? new Set(["client_new", "client_existing"])
    : new Set([type]);

  // Dedupe to one row per unique person (most recent kept), matching the KPI counts.
  // `ids` collects EVERY underlying event row for that person+type so the
  // drill-down can delete all of them in one click (data cleaning).
  const byKey = new Map();
  const items = [];
  for (const e of events) {
    if (e.occurred_at && e.occurred_at < sinceIso) continue;
    if (untilIso && e.occurred_at && e.occurred_at >= untilIso) continue;
    if (!wanted.has(e.event_type)) continue;
    const k = e.contact_id || e.contact_email || e.contact_phone || `row:${e.id}`;
    if (byKey.has(k)) { byKey.get(k).ids.push(e.id); continue; }
    const item = {
      ids: [e.id],
      key: k,   // identity for matching the same person across funnel stages (board view)
      contact_id: e.contact_id || null,
      phone: e.contact_phone || null,
      name: (e.raw && e.raw.name) || e.contact_email || "(unknown)",
      email: e.contact_email || null,
      date: e.occurred_at,
      amount: e.value != null ? Number(e.value) : null,
      is_new: e.event_type === "client_new",
      kind: e.raw && e.raw.kind || null,
    };
    byKey.set(k, item);
    items.push(item);
  }
  return res.status(200).json({ type, days, count: items.length, items });
}

// POST ?resource=ghl-kpi-delete  { client_id?, ids: [..] }
// Hard-deletes funnel-event rows behind a drill-down entry (staff data cleaning).
// Scoped to the resolved client so one academy can't delete another's rows.
// NOTE: a subsequent "Refresh now" re-pulls from GHL/Stripe and will re-add any
// entry that still exists at the source — use this for junk/test/stale rows.
async function handleGhlKpiDelete(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  let targetClientId = null;
  if (ctx.staff && req.body?.client_id) targetClientId = String(req.body.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required" });

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isInteger)
    : [];
  if (!ids.length) return res.status(400).json({ error: "ids required" });

  try {
    // Soft-delete: mark excluded (persists + survives re-pull) instead of removing.
    const updated = await sb(
      `ghl_funnel_events?client_id=eq.${targetClientId}&id=in.(${ids.join(",")})`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ excluded: true, excluded_at: nowIso() }) }
    );
    return res.status(200).json({ deleted: Array.isArray(updated) ? updated.length : 0, rows: updated || [] });
  } catch (e) {
    return res.status(500).json({ error: `delete failed: ${e.message}` });
  }
}

// POST ?resource=ghl-kpi-restore  { client_id?, rows: [<deleted ghl_funnel_events rows>] }
// Undo for the board/drill-down delete: clears the `excluded` flag on those rows
// (POST { client_id?, ids: [...] }). Soft-delete means the rows never left, so
// undo just un-hides them.
async function handleGhlKpiRestore(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  let targetClientId = null;
  if (ctx.staff && req.body?.client_id) targetClientId = String(req.body.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required" });

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isInteger)
    : [];
  if (!ids.length) return res.status(400).json({ error: "ids required" });

  try {
    const updated = await sb(
      `ghl_funnel_events?client_id=eq.${targetClientId}&id=in.(${ids.join(",")})`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ excluded: false, excluded_at: null }) }
    );
    return res.status(200).json({ restored: Array.isArray(updated) ? updated.length : 0 });
  } catch (e) {
    return res.status(500).json({ error: `restore failed: ${e.message}` });
  }
}

// GET ?resource=ghl-kpi-trash&client_id=&month=YYYY-MM
// The excluded (soft-deleted) records for a month, grouped by person + stage —
// powers the persistent trash bin / undo. Survives a page refresh because it
// reads from the DB, not browser memory.
async function handleGhlKpiTrash(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required" });

  let sinceIso = null, untilIso = null;
  const monthParam = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : null;
  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    sinceIso = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    untilIso = new Date(Date.UTC(y, m, 1)).toISOString();
  }

  let rows = [];
  try {
    rows = await sb(`ghl_funnel_events?client_id=eq.${targetClientId}&excluded=is.true&select=id,event_type,contact_id,contact_email,contact_phone,occurred_at,raw,excluded_at&order=excluded_at.desc.nullslast&limit=5000`) || [];
  } catch { return res.status(200).json({ items: [] }); }

  const bucket = (t) => t === "lead" ? "lead" : t === "trial" ? "trial" : "sale"; // client_new/existing → sale
  const items = [];
  const byKey = new Map();
  for (const e of rows) {
    if (monthParam) { if (!e.occurred_at || e.occurred_at < sinceIso || e.occurred_at >= untilIso) continue; }
    const k = (e.contact_id || e.contact_email || e.contact_phone || `row:${e.id}`) + "|" + bucket(e.event_type);
    if (byKey.has(k)) { byKey.get(k).ids.push(e.id); continue; }
    const item = { ids: [e.id], name: (e.raw && e.raw.name) || e.contact_email || "(unknown)", excluded_at: e.excluded_at || null };
    byKey.set(k, item);
    items.push(item);
  }
  return res.status(200).json({ items });
}

// GET ?resource=ghl-kpi-stripe&client_id=&email=
// A person's Stripe history on the client's connected account, so staff can judge
// if they're a live paying member. Looks the customer up by email, returns their
// subscriptions + recent charges + a simple live/not verdict.
async function handleGhlKpiStripe(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required" });

  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(200).json({ found: false, reason: "no_email" });

  let stripeAcct = null;
  try {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=stripe_connect_account_id`);
    stripeAcct = rows?.[0]?.stripe_connect_account_id || null;
  } catch { /* ignore */ }
  const stripeKey = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!stripeAcct || !stripeKey) return res.status(200).json({ found: false, reason: "no_stripe" });

  const sFetch = async (path) => {
    const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${stripeKey}`, "Stripe-Account": stripeAcct } });
    if (!r.ok) throw new Error(`stripe ${r.status}`);
    return r.json();
  };

  try {
    const custRes = await sFetch(`/customers?email=${encodeURIComponent(email)}&limit=5`);
    const customers = custRes.data || [];
    if (!customers.length) return res.status(200).json({ found: false, reason: "no_customer", email });
    const cust = customers[0];

    const [subRes, chRes] = await Promise.all([
      sFetch(`/subscriptions?customer=${cust.id}&status=all&limit=20`),
      sFetch(`/charges?customer=${cust.id}&limit=25`),
    ]);

    const subscriptions = (subRes.data || []).map(s => ({
      id: s.id, status: s.status,
      amount: (s.items?.data?.[0]?.price?.unit_amount || 0) / 100,
      interval: s.items?.data?.[0]?.price?.recurring?.interval || null,
      current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: !!s.cancel_at_period_end,
      created: s.created ? new Date(s.created * 1000).toISOString() : null,
    }));
    const charges = (chRes.data || []).map(c => ({
      id: c.id, amount: (c.amount || 0) / 100, currency: c.currency,
      created: c.created ? new Date(c.created * 1000).toISOString() : null,
      paid: !!c.paid, refunded: !!c.refunded, status: c.status,
      description: c.description || null,
    }));

    const activeSub = subscriptions.find(s => s.status === "active" || s.status === "trialing");
    const pastDue = subscriptions.find(s => s.status === "past_due" || s.status === "unpaid");
    const totalPaid = charges.filter(c => c.paid && !c.refunded).reduce((a, c) => a + c.amount, 0);
    const verdict = activeSub ? "live" : pastDue ? "at_risk" : (totalPaid > 0 ? "former" : "none");

    return res.status(200).json({
      found: true, email,
      customer: { id: cust.id, name: cust.name || null, email: cust.email || email, created: cust.created ? new Date(cust.created * 1000).toISOString() : null },
      customers_count: customers.length,
      subscriptions, charges,
      verdict, total_paid: Math.round(totalPaid * 100) / 100,
    });
  } catch (e) {
    return res.status(200).json({ found: false, reason: "error", error: e.message, email });
  }
}

// GET ?resource=meta-overview  (staff only)
// Cross-client marketing roster: this-month vs last-month totals per
// marketing-included client, plus goal, verdict, trend, and budget pacing —
// the "single marketing portal" overview. One Meta call per connected client
// (level=campaign, monthly, last 2 months), run in parallel.
async function handleMetaOverview(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff) return res.status(403).json({ error: "staff only" });
  if (req.method === "POST") return metaOverviewSlackAlert(req, res);
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });

  let clients = [];
  const sel = "id,business_name,meta_ad_account_id,meta_campaign_ids,meta_cpl_goal,meta_monthly_budget,marketing_included,status";
  try { clients = await sb(`clients?select=${sel}&order=business_name.asc`); }
  catch { clients = await sb(`clients?select=id,business_name,meta_ad_account_id,meta_campaign_ids,marketing_included,status&order=business_name.asc`); }
  clients = (clients || []).filter(c => c.marketing_included !== false);

  // Budget-confirmation status per client, from the "budget-review" ticket the
  // marketing team sends ("confirm your monthly budgets"). Newest ticket per
  // client wins:
  //   complete   = ticket marked completed (client confirmed + team actioned) → green check
  //   confirmed  = client filled it out but ticket not done yet → red flag "needs action"
  //   requested  = sent but client hasn't filled it → orange dot
  //   (no ticket) = never sent → grey dot (falls back to "none")
  const budgetStatusById = {};
  try {
    const bt = await sb(`marketing_tickets?type=eq.budget-review&select=client_id,client_action_status,status,submitted_at&order=submitted_at.desc`);
    for (const t of (bt || [])) {
      if (budgetStatusById[t.client_id]) continue; // first = newest
      budgetStatusById[t.client_id] = t.status === "completed" ? "complete"
        : t.client_action_status === "responded" ? "confirmed"
        : "requested";
    }
  } catch { /* leave map empty — every client falls back to "none" */ }

  const staffToken = await getAnyStaffMetaToken();
  const now = new Date();
  const curKey = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastKey = lastMonthDate.toISOString().slice(0, 7);
  const since = lastMonthDate.toISOString().slice(0, 10);
  const until = now.toISOString().slice(0, 10);
  const monthPct = Math.round((now.getUTCDate() / daysInUTCMonth(now)) * 100);
  const bm = MKT_BENCHMARKS;

  const pctChange = (cur, prev) => (prev == null || prev === 0 || cur == null) ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100);

  const rows = await Promise.all(clients.map(async (c) => {
    const goal_cpl = c.meta_cpl_goal != null ? Number(c.meta_cpl_goal) : null;
    const monthly_budget = c.meta_monthly_budget != null ? Number(c.meta_monthly_budget) : null;
    const baseRow = { id: c.id, business_name: c.business_name, goal_cpl, monthly_budget, budget_status: budgetStatusById[c.id] || "none" };
    if (!c.meta_ad_account_id || !staffToken) return { ...baseRow, connected: false };
    try {
      const adAcct = c.meta_ad_account_id.startsWith("act_") ? c.meta_ad_account_id : `act_${c.meta_ad_account_id}`;
      // No campaign filter on a shared ad account = would blend every academy's
      // spend. Don't pull/blend — flag it so staff know to pick campaigns.
      const allow = Array.isArray(c.meta_campaign_ids) && c.meta_campaign_ids.length ? new Set(c.meta_campaign_ids) : null;
      if (!allow) return { ...baseRow, connected: true, needs_campaigns: true };
      const url = `${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
        level: "campaign", fields: META_CAMPAIGN_FIELDS,
        time_range: JSON.stringify({ since, until }), time_increment: "monthly",
        access_token: staffToken, limit: "500",
      });
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) return { ...baseRow, connected: true, error: true };
      const cur = newAcc(), prev = newAcc();
      for (const row of (j.data || [])) {
        if (allow && !allow.has(row.campaign_id)) continue;
        const mk = (row.date_start || "").slice(0, 7);
        if (mk === curKey) sumRowInto(cur, row);
        else if (mk === lastKey) sumRowInto(prev, row);
      }
      const m = finalizeMetrics(cur), pm = finalizeMetrics(prev);
      const target = goal_cpl != null ? goal_cpl : bm.cpl;
      const v = verdictFor(m.cpl, target);
      const pacing = monthly_budget != null
        ? { spent_pct: monthly_budget > 0 ? Math.round((m.spend / monthly_budget) * 100) : null, month_pct: monthPct }
        : null;
      const overPace = pacing && pacing.spent_pct != null && pacing.spent_pct > monthPct + 15;
      const attention = (m.cpl == null && m.spend > 5) || (m.cpl != null && m.cpl > target) || overPace;
      return {
        ...baseRow, connected: true,
        spend: m.spend, leads: m.leads, cpl: m.cpl, impressions: m.impressions, reach: m.reach,
        link_clicks: m.link_clicks, ctr: m.ctr, frequency: m.frequency,
        ...v,
        trend: { leads_pct: pctChange(m.leads, pm.leads), cpl_pct: pctChange(m.cpl, pm.cpl), spend_pct: pctChange(m.spend, pm.spend) },
        pacing, attention,
        _prev: pm,
      };
    } catch { return { ...baseRow, connected: true, error: true }; }
  }));

  // Roll-up across connected clients.
  const live = rows.filter(r => r.connected && !r.error && !r.needs_campaigns);
  const sum = (k) => live.reduce((a, r) => a + (r[k] || 0), 0);
  const prevSpend = live.reduce((a, r) => a + (r._prev?.spend || 0), 0);
  const prevLeads = live.reduce((a, r) => a + (r._prev?.leads || 0), 0);
  const totalSpend = _r2(sum("spend")), totalLeads = sum("leads");
  const rollup = {
    clients: live.length,
    spend: totalSpend,
    leads: totalLeads,
    cpl: totalLeads > 0 ? _r2(totalSpend / totalLeads) : null,
    spend_pct: pctChange(totalSpend, prevSpend),
    leads_pct: pctChange(totalLeads, prevLeads),
    attention: live.filter(r => r.attention).length,
  };
  rows.forEach(r => { delete r._prev; });

  return res.status(200).json({
    as_of: now.toISOString(),
    month_label: `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
    month_pct: monthPct,
    rollup, clients: rows, benchmarks: bm,
  });
}

// POST ?resource=meta-overview  (staff) — post a "needs attention" digest to
// the marketing-team Slack channel. Frontend sends the already-computed list.
// Requires SLACK_BOT_TOKEN + MARKETING_ALERTS_SLACK_CHANNEL (channel id).
async function metaOverviewSlackAlert(req, res) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.MARKETING_ALERTS_SLACK_CHANNEL;
  if (!token || !channel) return res.status(200).json({ sent: false, reason: "slack_not_configured" });

  const { month_label, items } = req.body || {};
  const list = Array.isArray(items) ? items : [];
  const lines = list.length
    ? list.map(i => `• *${i.name}* — ${i.reason || "worth a look"}`).join("\n")
    : "All marketing clients are on or under target right now. Nice work.";
  const text = `:bar_chart: *Marketing check${month_label ? ` — ${month_label}` : ""}*\n${lines}`;

  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text }),
    });
    const j = await r.json();
    if (!j.ok) return res.status(200).json({ sent: false, reason: j.error || "slack_error" });
    return res.status(200).json({ sent: true, count: list.length });
  } catch (err) {
    return res.status(200).json({ sent: false, reason: err?.message || "slack_error" });
  }
}

// ─── Marketing Machine (V2 client dashboard) ─────────────────────────────
// GET ?resource=meta-machine&client_id=<id>[&since=YYYY-MM-DD&until=YYYY-MM-DD]
// ONE aggregate payload powering both the Marketing page simple card and the
// detailed "Marketing Machine" modal. Default range = month to date (UTC).
// All health judgments are computed HERE (the UI only draws what it is told)
// so the card and the modal can never disagree.
// Spec + locked health recipes: memories/project_marketing_machine_dashboard.md

const MM_CPL_GOLD = 40;        // $ cost per lead: green < 40 (Zoran 2026-07-03)
const MM_CPL_RED = 55;         // gold 40-55, red >= 55
const MM_C2L_GREEN = 10;       // % of link clicks becoming leads (proposed bands)
const MM_C2L_GOLD = 5;
const MM_HOOK_MIN = 25;        // % 3-sec views / impressions below this = demote
const MM_FREQ_MAX = 3.5;       // frequency above this = demote
const MM_TESTING_AGE_DAYS = 3; // younger ads get a grey "testing" state
const MM_TESTING_SPEND = 20;   // ...same for ads under this spend
const MM_KILL_SPEND = 75;      // red CPL at this spend -> "kill it" guidance
const MM_WANT_CREATIVES = 6;   // distinct live angles wanted (Andromeda note)
const MM_WINDOW_DAYS = 14;     // judged window for lead-based metrics (sub-$1k/mo spends make 7d too noisy)
const MM_FAST_DAYS = 7;        // impression-based metrics window (freq/CTR - high volume, fast signal)
const MM_MIN_LEADS = 8;        // don't color a window CPL below this sample...
const MM_MIN_SPEND = 250;      // ...unless spend says the silence itself is the signal

function mmCplBand(cpl, spend) {
  if (cpl == null) return spend >= MM_KILL_SPEND ? "red" : "grey";
  if (cpl < MM_CPL_GOLD) return "green";
  if (cpl < MM_CPL_RED) return "gold";
  return "red";
}
function mmDemote(band) {
  if (band === "green") return "gold";
  if (band === "gold") return "red";
  return band;
}
// Higher-is-better percentage band.
function mmPctBand(pct, green, gold) {
  if (pct == null) return "grey";
  if (pct >= green) return "green";
  if (pct >= gold) return "gold";
  return "red";
}
// Meta reports one real lead under several action_types at once (verified on
// GTA 2026-07-03: lead:5 + offsite_conversion.fb_pixel_lead:5 = 5 leads, not
// 10). "lead" is Meta's deduped total - prefer it; fall back to the legacy
// summed set only when the aggregate is absent.
function mmCountLeads(actions) {
  // STRICT: only Meta's deduped "lead" aggregate. The legacy countLeads()
  // fallback let offsite_conversion.fb_pixel_custom (a custom event, not a
  // lead) count as leads in pre-funnel weeks, which polluted the lifetime
  // anchor and its "since" date (seen live on GTA 2026-07-03).
  return countAction(actions, "lead");
}
function mmImageFromCreative(c) {
  if (!c) return null;
  if (c.image_url || c.thumbnail_url) return c.image_url || c.thumbnail_url;
  const slides = c.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(slides)) {
    const withPic = slides.find((a) => a.picture);
    if (withPic) return withPic.picture;
  }
  if (Array.isArray(c.asset_feed_spec?.images) && c.asset_feed_spec.images.length) {
    return c.asset_feed_spec.images[0].url || null;
  }
  return null;
}

async function handleMetaMachine(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  // Staff viewing a specific client via ?client_id= must win over any ctx.client
  // the caller might also resolve to (otherwise a staff user who is also a client
  // would silently read THEIR data, not the academy they opened).
  let targetClientId = null;
  if (req.query.client_id && (ctx.staff || (ctx.clientIds || []).includes(String(req.query.client_id)))) targetClientId = String(req.query.client_id);
  else if (ctx.client) targetClientId = ctx.client.id;
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  // Judged window: default = last MM_WINDOW_DAYS ending today (custom since/until
  // from the modal's date picker overrides). Lifetime CPL is the anchor and is
  // always computed over the campaign's whole life regardless of the window.
  const reDate = /^\d{4}-\d{2}-\d{2}$/;
  const fmt = (d) => d.toISOString().slice(0, 10);
  const DAY = 86400000;
  const now = new Date();
  const todayD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let untilD = todayD;
  let sinceD = new Date(todayD.getTime() - (MM_WINDOW_DAYS - 1) * DAY);
  const isCustom = reDate.test(String(req.query.since || "")) && reDate.test(String(req.query.until || ""));
  if (isCustom) {
    sinceD = new Date(req.query.since + "T00:00:00Z");
    untilD = new Date(req.query.until + "T00:00:00Z");
    if (untilD < sinceD) return res.status(400).json({ error: "until must be on/after since" });
    if (untilD > todayD) untilD = todayD;
  }
  const winDays = Math.round((untilD - sinceD) / DAY) + 1;
  const fastSinceD = new Date(Math.max(sinceD.getTime(), untilD.getTime() - (MM_FAST_DAYS - 1) * DAY));
  const prevUntilD = new Date(sinceD.getTime() - DAY);
  const prevSinceD = new Date(prevUntilD.getTime() - (winDays - 1) * DAY);
  const sinceIso = sinceD.toISOString();
  const endIso = new Date(untilD.getTime() + DAY).toISOString(); // exclusive end
  const prevSinceIso = prevSinceD.toISOString();

  let clientFull = null;
  try {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids,meta_cpl_goal,meta_monthly_budget,allowed_domains`);
    clientFull = rows?.[0] || null;
  } catch {
    const rows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids`);
    clientFull = rows?.[0] || null;
  }
  const notReady = (reason) => res.status(200).json({ ok: true, meta_connected: false, reason });
  if (!clientFull?.meta_ad_account_id) return notReady("no_ad_account");
  const staffToken = await getAnyStaffMetaToken();
  if (!staffToken) return notReady("no_staff_token");
  const allow = Array.isArray(clientFull.meta_campaign_ids) && clientFull.meta_campaign_ids.length
    ? clientFull.meta_campaign_ids.map(String) : null;
  if (!allow) return notReady("no_campaigns_selected");
  const allowSet = new Set(allow);
  const adAcct = clientFull.meta_ad_account_id.startsWith("act_")
    ? clientFull.meta_ad_account_id : `act_${clientFull.meta_ad_account_id}`;

  const graph = async (url) => {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || "Meta API error");
    return j;
  };
  const campFilter = JSON.stringify([{ field: "campaign.id", operator: "IN", value: allow }]);
  const activeFilter = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]);

  const [lifeJson, monthJson, adDailyJson, perCampaign, funnelRows, firstBeaconRows, kpiRows, roiRows] = await Promise.all([
    // 1. Lifetime weekly buckets: the anchor CPL + the sparkline, one call.
    graph(`${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
      level: "campaign", fields: "campaign_id,spend,actions",
      date_preset: "maximum", time_increment: "7", access_token: staffToken, limit: "500",
    })),
    // 2. Month-to-date spend for the pacing line (always MTD, independent of window).
    graph(`${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
      level: "campaign", fields: "campaign_id,spend",
      date_preset: "this_month", access_token: staffToken, limit: "500",
    })),
    // 3. Ad-level DAILY rows over prev+current window in one call - bucketed into
    //    prev / window / fast(last 7) per ad. Hook rate lives in actions.video_view.
    graph(`${META_GRAPH}/${adAcct}/insights?` + new URLSearchParams({
      level: "ad",
      fields: "campaign_id,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions",
      time_range: JSON.stringify({ since: fmt(prevSinceD), until: fmt(untilD) }),
      time_increment: "1", filtering: campFilter, access_token: staffToken, limit: "500",
    })),
    // 4. Per campaign: live ads (creative + created_time), live ad sets
    //    (learning stage + ABO budget fallback), campaign budget fields.
    Promise.all(allow.map(async (campId) => {
      const [ads, adsets, camp] = await Promise.all([
        graph(`${META_GRAPH}/${campId}/ads?` + new URLSearchParams({
          fields: "id,name,adset_id,created_time,creative{id,image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec}",
          filtering: activeFilter, access_token: staffToken, limit: "100",
        })).catch(() => ({ data: [] })),
        graph(`${META_GRAPH}/${campId}/adsets?` + new URLSearchParams({
          fields: "id,name,daily_budget,learning_stage_info,targeting",
          filtering: activeFilter, access_token: staffToken, limit: "50",
        })).catch(() => ({ data: [] })),
        graph(`${META_GRAPH}/${campId}?` + new URLSearchParams({
          fields: "name,daily_budget,lifetime_budget", access_token: staffToken,
        })).catch(() => ({})),
      ]);
      return { ads: ads.data || [], adsets: adsets.data || [], camp };
    })),
    sb(`funnel_events?client_id=eq.${targetClientId}&funnel=eq.free-trial&created_at=gte.${encodeURIComponent(sinceIso)}&created_at=lt.${encodeURIComponent(endIso)}&select=step,session_id,utm,meta,created_at,url&limit=20000`).catch(() => []),
    sb(`funnel_events?client_id=eq.${targetClientId}&funnel=eq.free-trial&select=created_at&order=created_at.asc&limit=1`).catch(() => []),
    sb(`kpi_events?client_id=eq.${targetClientId}&step=in.(lead,trial_booked)&occurred_at=gte.${encodeURIComponent(prevSinceIso)}&occurred_at=lt.${encodeURIComponent(endIso)}&select=step,occurred_at,ghl_contact_id&limit=10000`).catch(() => []),
    sb(`kpi_events?client_id=eq.${targetClientId}&step=in.(trial_booked,trial_attended,trial_no_show,joined)&occurred_at=gte.${encodeURIComponent(new Date(todayD.getTime() - 89 * 86400000).toISOString())}&select=step&limit=10000`).catch(() => []),
  ]);

  // ── Lifetime anchor + weekly sparkline ──
  // Anchor starts at the FIRST week that ever recorded a lead: campaigns that
  // ran before lead tracking existed (e.g. pre-BAM-funnel migration - GTA had
  // ~11 months of spend with zero lead events) would otherwise poison the
  // anchor with spend that could never produce a tracked lead.
  const weekMap = new Map();
  for (const row of (lifeJson.data || [])) {
    if (!allowSet.has(String(row.campaign_id))) continue;
    const w = weekMap.get(row.date_start) || { spend: 0, leads: 0 };
    w.spend += parseFloat(row.spend || "0") || 0;
    w.leads += mmCountLeads(row.actions);
    weekMap.set(row.date_start, w);
  }
  const weeksSorted = [...weekMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const firstLeadIdx = weeksSorted.findIndex(([, w]) => w.leads > 0);
  let lifeSpend = 0, lifeLeads = 0;
  if (firstLeadIdx >= 0) {
    for (const [, w] of weeksSorted.slice(firstLeadIdx)) { lifeSpend += w.spend; lifeLeads += w.leads; }
  }
  const lifetimeCpl = lifeLeads > 0 ? _r2(lifeSpend / lifeLeads) : null;
  const lifetimeBand = lifeLeads > 0 ? mmCplBand(lifetimeCpl, lifeSpend) : "grey";
  const sparkline = weeksSorted.slice(-8)
    .map(([week, w]) => {
      const cpl = w.leads > 0 ? _r2(w.spend / w.leads) : null;
      return { week, cpl, spend: _r2(w.spend), leads: w.leads, band: w.spend > 0 ? mmCplBand(cpl, w.spend) : "grey" };
    });

  // ── Month pacing (always MTD) ──
  let monthSpend = 0;
  for (const row of (monthJson.data || [])) {
    if (allowSet.has(String(row.campaign_id))) monthSpend += parseFloat(row.spend || "0") || 0;
  }

  // ── Bucket ad-level daily rows: prev window / judged window / fast tail ──
  const splitDay = fmt(sinceD), fastDay = fmt(fastSinceD);
  const zero = () => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, v3: 0, lpv: 0 });
  const win = zero(), fast = zero(), prevW = zero();
  const adAgg = new Map(); // ad_id -> {name, ...zero()}
  for (const row of (adDailyJson.data || [])) {
    const spend = parseFloat(row.spend || "0") || 0;
    const impressions = parseInt(row.impressions || "0", 10) || 0;
    const reach = parseInt(row.reach || "0", 10) || 0;
    const clicks = parseInt(row.inline_link_clicks || "0", 10) || 0;
    const leads = mmCountLeads(row.actions);
    const v3 = countAction(row.actions, "video_view");
    // Meta's landing_page_view = the click actually loaded the page (a subset of
    // clicks, so lpv <= clicks always). The clicks->lpv gap is the page-speed /
    // bounce read that opens the funnel.
    const lpv = countAction(row.actions, "landing_page_view");
    const into = (b) => { b.spend += spend; b.impressions += impressions; b.reach += reach; b.clicks += clicks; b.leads += leads; b.v3 += v3; b.lpv += lpv; };
    if (row.date_start < splitDay) { into(prevW); continue; }
    into(win);
    if (row.date_start >= fastDay) into(fast);
    let a = adAgg.get(String(row.ad_id));
    if (!a) { a = zero(); a.name = row.ad_name || ""; adAgg.set(String(row.ad_id), a); }
    into(a);
  }
  const beaconDay = firstBeaconRows?.[0]?.created_at ? String(firstBeaconRows[0].created_at).slice(0, 10) : null;
  let clicksComparable = 0, lpvComparable = 0;
  if (beaconDay) {
    for (const row of (adDailyJson.data || [])) {
      if (row.date_start >= splitDay && row.date_start >= beaconDay) {
        clicksComparable += parseInt(row.inline_link_clicks || "0", 10) || 0;
        lpvComparable += countAction(row.actions, "landing_page_view");
      }
    }
  }
  const winCpl = win.leads > 0 ? _r2(win.spend / win.leads) : null;
  // Minimum-sample guard: a window CPL earns a verdict once it has a real lead
  // sample OR enough spend that the missing leads ARE the verdict.
  const judged = win.leads >= MM_MIN_LEADS || win.spend >= MM_MIN_SPEND;
  const windowBand = judged ? mmCplBand(winCpl, win.spend) : "grey";
  const barBand = judged ? windowBand : lifetimeBand;
  const healthCpl = judged ? winCpl : lifetimeCpl;
  let driftPct = null, driftBand = null;
  if (judged && winCpl != null && lifetimeCpl != null && lifetimeCpl > 0) {
    driftPct = _r2(((winCpl - lifetimeCpl) / lifetimeCpl) * 100);
    driftBand = driftPct <= 0 ? "green" : (driftPct <= 20 ? "gold" : "red");
  }
  const fastFreq = fast.reach > 0 ? _r2(fast.impressions / fast.reach) : null;
  const fastCtr = fast.impressions > 0 ? _r2((fast.clicks / fast.impressions) * 100) : null;

  // Learning stage rollup: any set still LEARNING -> "learning"; FAIL -> "limited".
  const allAdsets = perCampaign.flatMap((p) => p.adsets);
  const stages = allAdsets.map((s) => s.learning_stage_info?.status).filter(Boolean);
  const learning = stages.includes("FAIL") ? "limited" : (stages.includes("LEARNING") ? "learning" : (stages.length ? "active" : null));

  // ── Planned monthly spend: staff-set goal, else campaign daily budget,
  //    else sum of ACTIVE ad sets' daily budgets (ABO - most clients). ──
  const daysInMonth = daysInUTCMonth(todayD);
  let dailyPlanned = 0;
  for (const p of perCampaign) {
    const campDaily = p.camp?.daily_budget ? parseFloat(p.camp.daily_budget) / 100 : 0;
    if (campDaily > 0) { dailyPlanned += campDaily; continue; }
    dailyPlanned += p.adsets.reduce((a, s) => a + (s.daily_budget ? parseFloat(s.daily_budget) / 100 : 0), 0);
  }
  const monthlyBudget = clientFull.meta_monthly_budget != null ? Number(clientFull.meta_monthly_budget) : null;
  const planned = monthlyBudget || (dailyPlanned > 0 ? _r2(dailyPlanned * daysInMonth) : null);

  // ── Creatives: join windowed ad aggregates onto the live ads list ──
  const bestable = [];
  const creatives = perCampaign.flatMap((p, pi) => (p.ads || []).map((ad) => ({ __ad: ad, __cid: allow[pi] }))).map(({ __ad: ad, __cid: cid }) => {
    const a = adAgg.get(String(ad.id)) || zero();
    const spend = _r2(a.spend);
    const cpl = a.leads > 0 ? _r2(spend / a.leads) : null;
    const ctr = a.impressions > 0 ? _r2((a.clicks / a.impressions) * 100) : null;
    const frequency = a.reach > 0 ? _r2(a.impressions / a.reach) : null;
    const isVideo = !!ad.creative?.video_id;
    const hookRate = (isVideo && a.impressions > 0) ? _r2((a.v3 / a.impressions) * 100) : null;
    const ageDays = ad.created_time ? Math.floor((now - new Date(ad.created_time)) / DAY) : null;
    const testing = (ageDays != null && ageDays < MM_TESTING_AGE_DAYS) || spend < MM_TESTING_SPEND;

    let band = mmCplBand(cpl, spend);
    let demotedBy = null;
    if (!testing) {
      if (frequency != null && frequency > MM_FREQ_MAX) { band = mmDemote(band); demotedBy = "frequency"; }
      else if (hookRate != null && hookRate < MM_HOOK_MIN) { band = mmDemote(band); demotedBy = "hook"; }
    } else {
      band = "grey";
    }
    // KEEP / EDIT / REPLACE call (Zoran-approved table 2026-07-03):
    // replace = the audience decided (priced out or worn out);
    // edit = salvageable (only the opening fails); keep = leave it alone.
    let verdict = null, verdictNote = null;
    if (!testing) {
      if (spend >= MM_KILL_SPEND && (cpl == null || cpl >= MM_CPL_RED)) {
        verdict = "replace"; verdictNote = "not producing affordable leads";
      } else if (frequency != null && frequency > MM_FREQ_MAX) {
        verdict = "replace"; verdictNote = "audience worn out - fresh angle";
      } else if (hookRate != null && hookRate < MM_HOOK_MIN) {
        verdict = "edit"; verdictNote = "improve the hook - first 3 seconds";
      } else {
        verdict = "keep"; verdictNote = null;
      }
    }
    const out = {
      ad_id: ad.id, name: ad.name || "(unnamed)",
      campaign_id: cid, adset_id: ad.adset_id || null,
      image_url: mmImageFromCreative(ad.creative), is_video: isVideo,
      age_days: ageDays, spend, leads: a.leads, cpl, ctr, frequency, hook_rate: hookRate,
      band, testing, demoted_by: demotedBy, best: false,
      verdict, verdict_note: verdictNote,
    };
    if (!testing && cpl != null) bestable.push(out);
    return out;
  });
  if (bestable.length) {
    bestable.sort((a, b) => a.cpl - b.cpl);
    bestable[0].best = true;
  }
  const liveJudged = creatives.filter((c) => !c.testing);

  // ── Page + result from our own beacons/events ──
  const sess = {};
  const adVisitors = new Set();
  // Earliest timestamp per (step, session) so we can measure how long people
  // linger between micro-steps. Only the FIRST hit of a step counts (a session
  // that bounces back and re-views a step shouldn't restart the clock).
  const stepTs = {}; // step -> Map(session_id -> earliest ms)
  // Page-load performance samples from the page_view beacon's meta blob. Kept as
  // a per-session best (fastest) value so a session that fires twice (load +
  // pagehide) counts once. Bucketed by traffic source so the portal can slice it.
  const loadBySession = new Map(); // session_id -> {load,lcp,ttfb,source}
  for (const row of (Array.isArray(funnelRows) ? funnelRows : [])) {
    const sid = row.session_id || "";
    (sess[row.step] = sess[row.step] || new Set()).add(sid);
    const ts = row.created_at ? Date.parse(row.created_at) : NaN;
    if (!Number.isNaN(ts)) {
      const m = (stepTs[row.step] = stepTs[row.step] || new Map());
      if (!m.has(sid) || ts < m.get(sid)) m.set(sid, ts);
    }
    if (row.step === "page_view") {
      const u = row.utm || {};
      if (u.fbclid || /fb|ig|meta|facebook|instagram/i.test(String(u.source || ""))) adVisitors.add(row.session_id || "");
      const pm = row.meta || {};
      const load = Number(pm.load_ms);
      if (Number.isFinite(load) && load > 0 && load < 60000) {   // drop absurd/idle outliers
        const prev = loadBySession.get(sid);
        if (!prev || load < prev.load) {
          loadBySession.set(sid, {
            load,
            lcp: (Number.isFinite(Number(pm.lcp_ms)) && Number(pm.lcp_ms) > 0) ? Number(pm.lcp_ms) : null,
            ttfb: (Number.isFinite(Number(pm.ttfb_ms)) && Number(pm.ttfb_ms) > 0) ? Number(pm.ttfb_ms) : null,
            source: String(pm.source || "other"),
          });
        }
      }
    }
  }
  // Median seconds to advance from one step to the next, over sessions that hit
  // both. Median (not mean) resists idle/abandoned tabs skewing the number.
  // Guarded: needs >= 2 sessions (need at least two points for a median; the
  // chip's tooltip discloses the sample size so a thin sample reads as tentative).
  const MM_TIME_MIN_N = 2;
  const _medianAdvanceS = (fromStep, toStep) => {
    const a = stepTs[fromStep], b = stepTs[toStep];
    if (!a || !b) return null;
    const deltas = [];
    for (const [sid, t0] of a) {
      const t1 = b.get(sid);
      if (t1 != null && t1 >= t0) deltas.push((t1 - t0) / 1000);
    }
    if (deltas.length < MM_TIME_MIN_N) return null;
    deltas.sort((x, y) => x - y);
    const mid = Math.floor(deltas.length / 2);
    const med = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
    return { median_s: Math.round(med), n: deltas.length };
  };
  // Full landing-page URL for the in-portal annotator iframe: most-common
  // page_view path joined to the client's preferred domain (skip *.vercel.app
  // and www when a cleaner branded domain exists). Beacon logs a path; if it
  // ever logs an absolute URL we pass it straight through.
  const pageUrl = (() => {
    const rows = (Array.isArray(funnelRows) ? funnelRows : []).filter((r) => r.step === "page_view" && r.url);
    if (!rows.length) return null;
    const counts = {};
    for (const r of rows) counts[r.url] = (counts[r.url] || 0) + 1;
    const path = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (/^https?:\/\//i.test(path)) return path;
    const domains = Array.isArray(clientFull.allowed_domains) ? clientFull.allowed_domains : [];
    if (!domains.length) return null;
    const pick = domains.find((d) => !/vercel\.app$/i.test(d) && !/^www\./i.test(d))
      || domains.find((d) => !/vercel\.app$/i.test(d)) || domains[0];
    return "https://" + pick.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
  })();
  // ── Page-load speed (median, resists idle-tab outliers) overall + per source ──
  const _median = (arr) => {
    if (!arr || !arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return Math.round(a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2);
  };
  const loadPerf = (() => {
    const rows = [...loadBySession.values()];
    if (!rows.length) return null;
    const bySrc = {};
    for (const r of rows) (bySrc[r.source] = bySrc[r.source] || []).push(r.load);
    const by_source = {};
    for (const k of Object.keys(bySrc)) by_source[k] = { median_ms: _median(bySrc[k]), n: bySrc[k].length };
    return {
      median_ms: _median(rows.map((r) => r.load)),
      lcp_ms: _median(rows.map((r) => r.lcp).filter((v) => v != null)),
      ttfb_ms: _median(rows.map((r) => r.ttfb).filter((v) => v != null)),
      n: rows.length,
      by_source,
    };
  })();
  const nSess = (step) => (sess[step] ? sess[step].size : 0);
  const visitors = nSess("page_view");
  const formStarted = nSess("form_started");
  const sawCalendar = nSess("calendar_viewed");
  const bookedSessions = nSess("confirmed");
  const pct = (num, den) => (den > 0 ? _r2((num / den) * 100) : null);

  const kpiList = Array.isArray(kpiRows) ? kpiRows : [];
  const inCur = (r) => r.occurred_at >= sinceIso;
  // Fixed last-7-days counts for the card's OVERALL line (independent of the
  // judged window, which is 14d by default).
  const since7Iso = new Date(untilD.getTime() + DAY - 7 * 86400000).toISOString();
  const in7 = (r) => r.occurred_at >= since7Iso;
  const leadsCur = kpiList.filter((r) => r.step === "lead" && inCur(r)).length;
  const leadsPrev = kpiList.filter((r) => r.step === "lead" && !inCur(r)).length;
  const bookedCurRows = kpiList.filter((r) => r.step === "trial_booked" && inCur(r));
  const bookedPrev = kpiList.filter((r) => r.step === "trial_booked" && !inCur(r)).length;
  const bookedCur = bookedCurRows.length;

  // Agent-booked split: kpi_events carries no booking source; the pipeline
  // store does. Join booked contacts onto opportunities.source.
  let agentBooked = 0;
  const bookedContacts = [...new Set(bookedCurRows.map((r) => r.ghl_contact_id).filter(Boolean))];
  if (bookedContacts.length) {
    try {
      const inList = bookedContacts.slice(0, 200).map((id) => `"${id.replace(/"/g, "")}"`).join(",");
      const opps = await sb(`opportunities?client_id=eq.${targetClientId}&ghl_contact_id=in.(${encodeURIComponent(inList)})&select=ghl_contact_id,source`);
      const agentContacts = new Set((opps || []).filter((o) => o.source === "agent").map((o) => o.ghl_contact_id));
      agentBooked = bookedCurRows.filter((r) => agentContacts.has(r.ghl_contact_id)).length;
    } catch { /* split is best-effort; totals stay correct */ }
  }

  const clicksToLeadsPct = pct(leadsCur, win.clicks);
  const abandonmentPct = sawCalendar > 0 ? _r2(((sawCalendar - bookedSessions) / sawCalendar) * 100) : null;
  // Lower-is-better: <25 green, 25-40 gold, >40 red (heuristic from spec note).
  const abandonBand = abandonmentPct == null ? "grey" : (abandonmentPct < 25 ? "green" : (abandonmentPct <= 40 ? "gold" : "red"));

  const cpbt = bookedCur > 0 ? _r2(win.spend / bookedCur) : null;
  const prevCpbt = bookedPrev > 0 && prevW.spend > 0 ? _r2(prevW.spend / bookedPrev) : null;
  // Verdict number is judged by trend vs the prior equal-length window.
  let cpbtBand = "grey";
  if (cpbt != null && prevCpbt != null) {
    cpbtBand = cpbt <= prevCpbt ? "green" : (cpbt <= prevCpbt * 1.2 ? "gold" : "red");
  }

  // ── The single warning line (worst thing wins) ──
  const bestName = bestable[0]?.name;
  let warning = null;
  const killer = liveJudged.find((c) => c.band === "red" && c.spend >= MM_KILL_SPEND);
  const wornOut = liveJudged.find((c) => c.demoted_by === "frequency");
  const weakHook = liveJudged.find((c) => c.demoted_by === "hook");
  if (killer) warning = `"${killer.name}" is burning budget - kill it${bestName && bestName !== killer.name ? ` and move spend to "${bestName}"` : ""}`;
  else if (barBand === "red") warning = "cost per lead is running hot - review the campaign";
  else if (wornOut) warning = `"${wornOut.name}" is worn out - clone the winner with a fresh angle`;
  else if (weakHook) warning = `"${weakHook.name}" is not stopping thumbs - re-hook the first 3 seconds`;
  else if (clicksToLeadsPct != null && clicksToLeadsPct < MM_C2L_GOLD) warning = "the page is losing clicks - visitors are not becoming leads";
  else if (liveJudged.length && liveJudged.length < MM_WANT_CREATIVES) warning = `only ${liveJudged.length} proven creative${liveJudged.length === 1 ? "" : "s"} live - add fresh angles (want ${MM_WANT_CREATIVES}+)`;

  // ── Per-campaign structure: campaign -> ad sets -> creatives ──
  const campaignsOut = perCampaign.map((p, i) => {
    const cid = allow[i];
    let cSpend = 0, cLeads = 0;
    for (const row of (adDailyJson.data || [])) {
      if (String(row.campaign_id) !== cid || row.date_start < splitDay) continue;
      cSpend += parseFloat(row.spend || "0") || 0;
      cLeads += mmCountLeads(row.actions);
    }
    const cCpl = cLeads > 0 ? _r2(cSpend / cLeads) : null;
    const cJudged = cLeads >= MM_MIN_LEADS || cSpend >= MM_MIN_SPEND;
    const adsetsOut = (p.adsets || []).map((a2) => {
      const t = a2.targeting || {};
      const geo = t.geo_locations || {};
      let where = null;
      if (Array.isArray(geo.custom_locations) && geo.custom_locations.length) {
        const g = geo.custom_locations[0];
        where = g.radius ? (g.radius + (g.distance_unit === "mile" ? " mi" : " km") + " radius") : null;
      } else if (Array.isArray(geo.cities) && geo.cities.length) where = geo.cities.length + " city area";
      else if (Array.isArray(geo.countries) && geo.countries.length) where = geo.countries.join(", ");
      return {
        id: a2.id, name: a2.name || null,
        daily_budget: a2.daily_budget ? _r2(parseFloat(a2.daily_budget) / 100) : null,
        learning: a2.learning_stage_info?.status || null,
        targeting_brief: [(t.age_min && t.age_max) ? ("ages " + t.age_min + "-" + t.age_max) : null, where].filter(Boolean).join(" &middot; ") || null,
        creatives: creatives.filter((c) => String(c.campaign_id) === String(cid) && String(c.adset_id || "") === String(a2.id)),
      };
    });
    const claimed = new Set(adsetsOut.flatMap((a2) => a2.creatives.map((c) => c.ad_id)));
    const orphans = creatives.filter((c) => String(c.campaign_id) === String(cid) && !claimed.has(c.ad_id));
    if (orphans.length && adsetsOut.length) adsetsOut[0].creatives.push(...orphans);
    return {
      id: cid, name: p.camp?.name || null,
      spend: _r2(cSpend), leads: cLeads, cpl: cCpl,
      band: cJudged ? mmCplBand(cCpl, cSpend) : "grey", judged: cJudged,
      adsets: adsetsOut,
    };
  });
  // month pacing: spend vs where the month says you should be
  const elapsedFrac = todayD.getUTCDate() / daysInMonth;
  const pace = planned ? _r2(monthSpend / (planned * elapsedFrac)) : null;
  const paceStatus = pace == null ? null : (pace < 0.8 ? "under" : (pace > 1.2 ? "over" : "on pace"));

  return res.status(200).json({
    ok: true,
    meta_connected: true,
    campaigns: campaignsOut,
    roi: (() => {
      // 90-day conversion rates for the ROI machine (joins lag trials, so the
      // judged window is too short for these)
      const rc = { trial_booked: 0, trial_attended: 0, trial_no_show: 0, joined: 0 };
      for (const row of (Array.isArray(roiRows) ? roiRows : [])) if (rc[row.step] != null) rc[row.step]++;
      const outcomes = rc.trial_attended + rc.trial_no_show;
      return {
        lookback_days: 90,
        booked: rc.trial_booked, attended: rc.trial_attended, no_show: rc.trial_no_show, joined: rc.joined,
        show_rate: outcomes >= 5 ? _r2(rc.trial_attended / outcomes) : null,
        attended_to_join: rc.trial_attended >= 5 ? _r2(rc.joined / rc.trial_attended) : null,
        booked_to_join: rc.trial_booked >= 5 ? _r2(rc.joined / rc.trial_booked) : null,
      };
    })(),
    range: {
      since: fmt(sinceD), until: fmt(untilD), days: winDays, is_default: !isCustom,
      prev_since: fmt(prevSinceD), prev_until: fmt(prevUntilD),
    },
    month: {
      name: MONTH_NAMES[todayD.getUTCMonth()], day: todayD.getUTCDate(),
      days_in_month: daysInMonth, planned, spend: _r2(monthSpend),
    },
    campaign: {
      name: perCampaign[0]?.camp?.name || null,
      count: allow.length,
      // The machine's flow edge: this campaign's clicks land on this funnel.
      // Today every campaign feeds the free-trial funnel; when campaigns get
      // per-funnel routing this becomes a real mapping.
      sends_to: "free-trial",
      band: barBand,                 // the card bar verdict
      health_cpl: healthCpl,         // what the bar's fill length maps
      lifetime: { cpl: lifetimeCpl, band: lifetimeBand, spend: _r2(lifeSpend), leads: lifeLeads, since: firstLeadIdx >= 0 ? weeksSorted[firstLeadIdx][0] : null },
      window: { cpl: winCpl, band: windowBand, judged, leads: win.leads, spend: _r2(win.spend), drift_vs_lifetime_pct: driftPct, drift_band: driftBand },
      fast: { days: MM_FAST_DAYS, frequency: fastFreq, ctr: fastCtr },
      sparkline,
      impressions: win.impressions, reach: win.reach, link_clicks: win.clicks,
      learning,
    },
    creatives,
    creatives_live: liveJudged.length,
    creatives_band: liveJudged.length ? (liveJudged.some((c) => c.band === "red") ? "red" : (liveJudged.some((c) => c.band === "gold") ? "gold" : (liveJudged.length >= MM_WANT_CREATIVES ? "green" : "gold"))) : "grey",
    page: {
      funnel: "free-trial",
      fed_by: allow,
      url: pageUrl,                          // full landing-page URL for the annotator iframe
      clicks_comparable: clicksComparable,   // Meta clicks on days beacons were live
      lpv_comparable: lpvComparable,         // Meta landing-page-views, same day window
      link_clicks: win.clicks, landing_page_views: win.lpv,   // full-window Meta totals
      visitors, ad_visitors: adVisitors.size, form_started: formStarted, saw_calendar: sawCalendar, booked_sessions: bookedSessions,
      // median seconds to move between the beacon-tracked micro-steps (null when
      // the sample is too thin). No timing for clicked->loaded: Meta gives no
      // per-session click/page-load timestamps.
      step_times: {
        loaded_to_form: _medianAdvanceS("page_view", "form_started"),
        form_to_calendar: _medianAdvanceS("form_started", "calendar_viewed"),
        calendar_to_booked: _medianAdvanceS("calendar_viewed", "confirmed"),
      },
      // median page-load ms (full load event) + LCP/TTFB + per-source split from
      // the page_view beacon. null until beacons start arriving (no backfill).
      load: loadPerf,
      visitors_to_form_pct: pct(formStarted, visitors),
      clicks_to_leads_pct: clicksToLeadsPct,
      band: mmPctBand(clicksToLeadsPct, MM_C2L_GREEN, MM_C2L_GOLD),
      abandonment_pct: abandonmentPct, abandonment_band: abandonBand,
    },
    pills: {
      // click->visit counts ONLY ad-tagged sessions (fbclid / meta source) so
      // organic visitors can't flatter the number.
      click_to_visit_pct: pct(adVisitors.size, clicksComparable),
      click_to_visit_band: mmPctBand(pct(adVisitors.size, clicksComparable), 70, 60),
      visit_to_lead_pct: pct(leadsCur, visitors),
      visit_to_lead_band: mmPctBand(pct(leadsCur, visitors), 10, 5),
      lead_to_booked_pct: pct(bookedCur, leadsCur),
      lead_to_booked_band: mmPctBand(pct(bookedCur, leadsCur), 35, 20),
    },
    result: {
      leads: leadsCur, prev_leads: leadsPrev, booked: bookedCur, agent_booked: agentBooked,
      leads_7d: kpiList.filter((r) => r.step === "lead" && in7(r)).length,
      booked_7d: kpiList.filter((r) => r.step === "trial_booked" && in7(r)).length,
      booked_pct: pct(bookedCur, leadsCur),
      cost_per_booked_trial: cpbt, prev_cost_per_booked_trial: prevCpbt, cpbt_band: cpbtBand,
    },
    warning: warning ? { text: warning } : null,
  });
}

// GET ?resource=meta-creatives&campaign_id=<id>
// Returns the live ad creatives in a campaign (image/video assets the
// audience actually sees). Filtered to ACTIVE ads only.
async function handleMetaCreatives(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.client && !ctx.staff) return res.status(403).json({ error: "client or staff required" });

  const campaignId = (req.query.campaign_id || "").trim();
  if (!campaignId) return res.status(400).json({ error: "campaign_id required" });

  // Use any valid staff token; same partner-share strategy as campaigns.
  const staffToken = await getAnyStaffMetaToken();
  if (!staffToken) return res.status(200).json({ creatives: [], reason: "no_staff_token" });
  const tok = { access_token: staffToken };

  // Get all ACTIVE ads in this campaign, expanding to creative + image fields.
  // For carousels, image data lives inside object_story_spec.link_data.child_attachments,
  // not at the top of the creative — so we expand that too.
  const adsRes = await fetch(`${META_GRAPH}/${encodeURIComponent(campaignId)}/ads?` + new URLSearchParams({
    fields: "id,name,status,effective_status,creative{id,name,image_url,thumbnail_url,image_hash,object_type,video_id,object_story_spec,asset_feed_spec,effective_object_story_id}",
    filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]),
    access_token: tok.access_token,
    limit: "50",
  }));
  const adsJson = await adsRes.json();
  if (!adsRes.ok) {
    return res.status(adsRes.status).json({ error: adsJson?.error?.message || "Meta API error" });
  }

  // Extract the best representative image we can find for this creative.
  // Order of preference: image_url → thumbnail_url → first carousel
  // slide's picture → first asset_feed image. Don't rewrite URLs —
  // Meta CDN URLs are cryptographically signed; mangling breaks them.
  function extractCreativeAssets(c) {
    let imageUrl = c.image_url || c.thumbnail_url || null;
    let isCarousel = false;
    const childAttachments = c.object_story_spec?.link_data?.child_attachments;
    if (Array.isArray(childAttachments) && childAttachments.length) {
      isCarousel = true;
      if (!imageUrl) {
        const firstWithPic = childAttachments.find(a => a.picture);
        if (firstWithPic) imageUrl = firstWithPic.picture;
      }
    }
    if (!imageUrl && Array.isArray(c.asset_feed_spec?.images) && c.asset_feed_spec.images.length) {
      imageUrl = c.asset_feed_spec.images[0].url || null;
    }
    return { imageUrl, isCarousel };
  }

  const creatives = (adsJson.data || []).map(ad => {
    const c = ad.creative || {};
    const { imageUrl, isCarousel } = extractCreativeAssets(c);
    const isVideo = c.object_type === "VIDEO" || !!c.video_id;
    // Meta returns object_type="PRIVACY_CHECK_FAIL" when the creative's
    // source post has restricted privacy — we can't preview it even though
    // the ad is still running. Flag it so the UI shows the right tile.
    const isPrivacyLocked = c.object_type === "PRIVACY_CHECK_FAIL";
    // Detect carousel by name when child_attachments is unavailable
    const inferredCarousel = isCarousel || /carrousel|carousel/i.test((ad.name || "") + " " + (c.name || ""));
    return {
      ad_id: ad.id,
      ad_name: ad.name || "",
      creative_id: c.id || null,
      creative_name: c.name || ad.name || "",
      image_url: imageUrl,
      is_video: isVideo,
      is_carousel: inferredCarousel,
      is_privacy_locked: isPrivacyLocked,
      video_id: c.video_id || null,
      effective_object_story_id: c.effective_object_story_id || null,
    };
  });
  // No filter — show every active ad, even if we couldn't find an image.
  // Empty-image creatives still render as a tile placeholder.

  // For video creatives, fetch source + permalink in parallel so the client
  // can render an embedded player (or fall back to Facebook permalink).
  // Also fetch picture for video poster.
  const videos = creatives.filter(c => c.video_id);
  if (videos.length) {
    await Promise.all(videos.map(async (c) => {
      // Always include a hardcoded fallback Facebook URL so the client always has
      // somewhere to send the user even if /{video_id} returns nothing useful.
      c.video_fb_url = `https://www.facebook.com/${encodeURIComponent(c.video_id)}`;
      try {
        const vRes = await fetch(`${META_GRAPH}/${encodeURIComponent(c.video_id)}?` + new URLSearchParams({
          fields: "source,permalink_url,picture,thumbnails,embed_html",
          access_token: tok.access_token,
        }));
        const vText = await vRes.text();
        let v = null;
        try { v = JSON.parse(vText); } catch (_) {}
        if (!vRes.ok || !v) {
          c.video_fetch_error = vText.slice(0, 200);
        } else if (v.error) {
          c.video_fetch_error = v.error.message || JSON.stringify(v.error).slice(0, 200);
        } else {
          c.video_source_url = v.source || null;
          if (v.permalink_url) {
            c.video_permalink_url = v.permalink_url.startsWith("http")
              ? v.permalink_url
              : `https://www.facebook.com${v.permalink_url.startsWith("/") ? v.permalink_url : "/" + v.permalink_url}`;
          }
          c.video_embed_html = v.embed_html || null;
          // Pick the BEST poster image available, in order:
          //   1. preferred thumbnail from /video?fields=thumbnails (highest res)
          //   2. video's `picture` field (full-quality poster)
          //   3. existing c.image_url (creative-level)
          //   4. fall back to c.thumbnail_url (often tiny 64x64)
          let bestPoster = null;
          const thumbs = Array.isArray(v.thumbnails?.data) ? v.thumbnails.data : [];
          if (thumbs.length) {
            // Sort by width desc, prefer is_preferred=true
            const preferred = thumbs.find(t => t.is_preferred);
            const sorted = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
            bestPoster = (preferred?.uri) || sorted[0]?.uri || null;
          }
          if (!bestPoster && v.picture) bestPoster = v.picture;
          if (bestPoster) c.image_url = bestPoster;
        }
      } catch (e) {
        c.video_fetch_error = e.message;
      }
    }));
  }

  return res.status(200).json({ creatives });
}

// ─────────────────────────────────────────────────────────
// STAFF-SIDE META OAUTH
// ─────────────────────────────────────────────────────────
// Staff (BAM admins, marketing team) connect their own Meta account.
// Their token gives access to every ad account they have access to via
// user-role or partner-share (e.g. Ximena has access to all academy
// ad accounts via BAM's BM partnerships). That token then powers the
// campaigns + creatives endpoints for ALL clients.

function metaStaffRedirectUri(req) {
  return `${metaGetOrigin(req)}/api/auth/staff-meta/callback`;
}

function metaStaffRedirect(res, status, msg) {
  const params = new URLSearchParams({ meta_staff: status });
  if (msg) params.set("msg", msg);
  // Staff portal lives at root, not /client-portal.html
  res.setHeader("Location", `/?${params.toString()}`);
  return res.status(302).end();
}

async function handleStaffMetaAuth(req, res) {
  const step = req.query.step;

  // step = prepare: POST, authenticated staff, returns Facebook OAuth URL
  if (step === "prepare") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const ctx = await resolveUser(req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    if (!ctx.staff) return res.status(403).json({ error: "staff only" });
    if (!META_OPS_ROLES.has(ctx.staff.role)) {
      return res.status(403).json({ error: "admin or marketing role required" });
    }

    const appId = process.env.META_APP_ID;
    if (!appId) return res.status(500).json({ error: "META_APP_ID not configured" });

    const state = metaSignState({
      staff_user_id: ctx.user.id,
      exp: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomBytes(8).toString("hex"),
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: metaStaffRedirectUri(req),
      scope: META_OAUTH_SCOPES.join(","),
      response_type: "code",
      // Force Facebook to show the permission screen even when the app is already
      // authorized, so a reconnect actually grants newly-added scopes (e.g. the
      // ads_management/business_management write scopes) instead of silently
      // returning the previously-granted read-only set.
      auth_type: "rerequest",
      state,
    });

    return res.status(200).json({
      redirect_url: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`,
    });
  }

  // step = callback: GET from Facebook with code+state. Exchange + store + redirect.
  if (step === "callback") {
    if (req.method !== "GET") return res.status(405).end();

    const { code, state, error: fbError, error_description } = req.query;
    if (fbError) return metaStaffRedirect(res, "error", error_description || String(fbError));
    if (!code || !state) return metaStaffRedirect(res, "error", "missing code or state");

    let payload;
    try { payload = metaVerifyState(state); }
    catch (e) { return metaStaffRedirect(res, "error", `state: ${e.message}`); }
    if (!payload.staff_user_id) return metaStaffRedirect(res, "error", "state missing staff_user_id");

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return metaStaffRedirect(res, "error", "Meta app not configured");

    // Code → short-lived token
    const shortRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: metaStaffRedirectUri(req),
      code,
    }));
    const shortJson = await shortRes.json();
    if (!shortRes.ok || !shortJson.access_token) {
      return metaStaffRedirect(res, "error", shortJson?.error?.message || "token exchange failed");
    }

    // Short → long-lived (60 days)
    const longRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortJson.access_token,
    }));
    const longJson = await longRes.json();
    const accessToken = longJson.access_token || shortJson.access_token;
    const expiresIn = longJson.expires_in || shortJson.expires_in || 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const meRes = await fetch(`${META_GRAPH}/me?` + new URLSearchParams({
      fields: "id,name",
      access_token: accessToken,
    }));
    const me = await meRes.json();
    if (!meRes.ok || !me.id) {
      return metaStaffRedirect(res, "error", me?.error?.message || "could not fetch FB user");
    }

    await sb(`staff_meta_tokens?on_conflict=staff_user_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        staff_user_id: payload.staff_user_id,
        fb_user_id: me.id,
        fb_user_name: me.name || null,
        access_token: accessToken,
        expires_at: expiresAt,
        scopes: META_OAUTH_SCOPES,
        updated_at: nowIso(),
      }]),
    });

    return metaStaffRedirect(res, "connected");
  }

  return res.status(400).json({ error: "unknown step (expected 'prepare' or 'callback')" });
}

// GET ?resource=meta-staff-status
// Lets the staff portal show "Meta connected as X" or "Connect Meta" button.
// Live-validate a stored Meta token. A row existing in staff_meta_tokens does
// NOT mean the token works — but ALSO, the token failing to LIST ad accounts
// (/me/adaccounts) does NOT mean it's dead: a token can read accounts it's been
// granted (campaigns load fine) while lacking the scope to enumerate them. So
// we separate two things:
//   valid           = the token authenticates at all (/me succeeds)
//   canListAccounts = it can enumerate ad accounts (needed by the picker)
// reason: ok | ok_no_accounts | limited (alive but can't list — usually a
//   missing/old scope, fix by reconnecting) | expired | revoked | error | none
async function probeMetaToken(accessToken, expiresAt) {
  if (!accessToken) return { valid: false, canListAccounts: false, reason: "none" };
  // Cheap local check first — skip the network call when clearly expired.
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return { valid: false, canListAccounts: false, reason: "expired" };
  }
  // 1) Is the token alive at all?
  try {
    const meR = await fetch(`${META_GRAPH}/me?` + new URLSearchParams({ fields: "id", access_token: accessToken }));
    const meJ = await meR.json().catch(() => ({}));
    if (!meR.ok) {
      const err = meJ?.error || {};
      let reason = "error";
      if (err.code === 190) reason = err.error_subcode === 463 ? "expired" : "revoked";
      return { valid: false, canListAccounts: false, reason, message: err.message || `HTTP ${meR.status}` };
    }
  } catch (e) {
    return { valid: false, canListAccounts: false, reason: "error", message: e?.message || "probe failed" };
  }
  // 2) Token is alive — can it enumerate ad accounts? (picker needs this)
  try {
    const adR = await fetch(`${META_GRAPH}/me/adaccounts?` + new URLSearchParams({ fields: "account_id", limit: "1", access_token: accessToken }));
    const adJ = await adR.json().catch(() => ({}));
    if (adR.ok) {
      const hasAccounts = Array.isArray(adJ.data) && adJ.data.length > 0;
      return { valid: true, canListAccounts: true, reason: hasAccounts ? "ok" : "ok_no_accounts" };
    }
    // Alive but can't list — almost always a missing/old scope. Token still
    // serves campaign data for accounts it's been granted.
    return { valid: true, canListAccounts: false, reason: "limited", message: adJ?.error?.message || `HTTP ${adR.status}` };
  } catch (e) {
    return { valid: true, canListAccounts: false, reason: "limited", message: e?.message || "list failed" };
  }
}

// Daily watchdog (Vercel cron). Probes the shared/team Meta token and, if it's
// broken, posts a Slack alert with the reason + raises a Sentry event so we
// catch a dead token within a day instead of discovering it via a blank ad
// dashboard. Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
async function handleMetaHealthCron(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if ((req.headers.authorization || "") !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // The most-recently-updated token is the one read ops actually use.
  const teamRows = await sb(`staff_meta_tokens?select=access_token,fb_user_name,expires_at,updated_at&order=updated_at.desc&limit=1`);
  const team = teamRows?.[0];
  if (!team) {
    // No token at all — distinct from "broken". Alert once so it's not silent.
    await postMetaHealthAlert(":warning: *Meta token watchdog* — no staff Meta token connected at all. Client ad dashboards are running on sample/blank data. Someone needs to connect Meta in the staff portal (Settings → Connect Meta).");
    return res.status(200).json({ ok: true, state: "none" });
  }

  const probe = await probeMetaToken(team.access_token, team.expires_at);

  // Token is alive — campaign data still flows. Don't cry wolf.
  if (probe.valid) {
    // "limited" = alive but can't enumerate ad accounts (the picker breaks, but
    // dashboards work). Record it quietly in Sentry; no Slack — it's not an
    // outage, it just means someone should reconnect to refresh scopes.
    if (!probe.canListAccounts) {
      captureApiMessage(`Meta token limited: ${probe.reason}`, {
        level: "warning",
        tags: { area: "meta", reason: probe.reason },
        extra: { fb_user_name: team.fb_user_name || null, message: probe.message || null },
      });
    }
    return res.status(200).json({ ok: true, state: probe.canListAccounts ? "valid" : "limited", reason: probe.reason, fb_user_name: team.fb_user_name || null });
  }

  // Truly dead (expired/revoked/error) — campaigns won't load. Alert loudly.
  const who = team.fb_user_name ? ` (${team.fb_user_name})` : "";
  const detail = probe.message ? ` — ${probe.message}` : "";
  const msg = `:rotating_light: *Meta token watchdog* — the shared Meta connection${who} is down: *${probe.reason}*${detail}. Client + internal ad dashboards are blank until someone reconnects Meta (staff portal → Settings → Connect Meta). Durable fix: a non-expiring Business Manager System User token.`;
  await postMetaHealthAlert(msg);
  captureApiMessage(`Meta token down: ${probe.reason}`, {
    level: "error",
    tags: { area: "meta", reason: probe.reason },
    extra: { fb_user_name: team.fb_user_name || null, expires_at: team.expires_at || null, message: probe.message || null },
  });

  return res.status(200).json({ ok: true, state: "down", reason: probe.reason, fb_user_name: team.fb_user_name || null });
}

// Post a plain-text alert to the marketing/ops Slack channel. No-ops quietly if
// Slack isn't configured.
async function postMetaHealthAlert(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.MARKETING_ALERTS_SLACK_CHANNEL;
  if (!token || !channel) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
    });
  } catch (err) {
    console.error("Meta health Slack alert failed:", err?.message || err);
  }
}

async function handleStaffMetaStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff) return res.status(403).json({ error: "staff only" });

  // Logged-in staff's own connection
  const ownRows = await sb(`staff_meta_tokens?staff_user_id=eq.${ctx.user.id}&select=access_token,fb_user_name,expires_at,created_at,updated_at`);
  const own = ownRows?.[0];

  // Team-wide connection (anyone on staff connected — token shared for read ops)
  const teamRows = await sb(`staff_meta_tokens?select=access_token,fb_user_name,expires_at,updated_at&order=updated_at.desc&limit=1`);
  const team = teamRows?.[0];

  // Live-probe so the UI reflects reality, not just row presence.
  const ownProbe = own ? await probeMetaToken(own.access_token, own.expires_at) : { valid: false, reason: "none" };
  const teamProbe = team
    ? (own && team.access_token === own.access_token ? ownProbe : await probeMetaToken(team.access_token, team.expires_at))
    : { valid: false, reason: "none" };

  return res.status(200).json({
    // connected = your own token authenticates (campaigns can load)
    connected: ownProbe.valid,
    own_present: !!own,
    own_reason: ownProbe.reason,
    own_can_list: ownProbe.canListAccounts,
    own_message: ownProbe.message || null,
    fb_user_name: own?.fb_user_name || null,
    expires_at: own?.expires_at || null,
    connected_at: own?.created_at || null,
    updated_at: own?.updated_at || null,
    // team_connected = a working team token exists (validated, not just present)
    team_connected: teamProbe.valid,
    team_present: !!team,
    team_reason: teamProbe.reason,
    team_can_list: teamProbe.canListAccounts,
    team_message: teamProbe.message || null,
    team_fb_user_name: team?.fb_user_name || null,
    team_expires_at: team?.expires_at || null,
  });
}

// ─────────────────────────────────────────────────────────
// CREATIVE REFRESH WINDOWS (phase 1)
// ─────────────────────────────────────────────────────────
// Monthly creative-update windows per client, week-anchored: clients.refresh_week
// (1-4) = Monday-Sunday of that week each month. The staff Marketing tab renders
// a week-lane calendar from creative_refresh_windows; managers nudge / move /
// mark received. Statuses derive on read; submissions auto-detect from tickets
// submitted inside the window. See memories/project_creative_refresh_calendar.md.
//
//   GET   ?resource=refresh-windows&month=YYYY-MM
//         → { month, weeks, windows, unassigned, canEdit } (generates missing
//           rows for enrolled clients, derives statuses, auto-detects submits)
//   PATCH ?resource=refresh-windows   body { action, ... } (managers only):
//         set-week      { client_id, week|null, month? }  enroll / re-anchor / unenroll
//         move-week     { id, week }                      one-off move, this month only
//         nudge         { id }                            Slack to the client channel
//         mark-received { id }                            manual submitted flip
//         skip          { id }                            skip this month
//
// View = CONTENT_ROLES (marketing + content team see load); edit = managers.
// Only V1.5/V2 clients are eligible - V1 academies never appear (hard rule).

function refreshIsoDate(d) { return d.toISOString().slice(0, 10); }

// month 'YYYY-MM' → { 1: {start,end}, ... } Monday-anchored lanes. Week 1 starts
// on the first Monday of the month; each lane is Monday-Sunday inclusive.
function refreshMonthWeeks(month) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (8 - first.getUTCDay()) % 7; // days from the 1st to the first Monday
  const weeks = {};
  for (let w = 1; w <= 4; w++) {
    const start = new Date(Date.UTC(y, m - 1, 1 + offset + (w - 1) * 7));
    const end = new Date(start.getTime() + 6 * 86400000);
    weeks[w] = { start: refreshIsoDate(start), end: refreshIsoDate(end) };
  }
  return weeks;
}

// Derived status: submitted/skipped are sticky; the rest is pure date math so
// rows never go stale between crons.
function refreshDeriveStatus(row, todayIso) {
  if (row.status === "submitted" || row.status === "skipped") return row.status;
  if (todayIso < row.window_start) return "upcoming";
  if (todayIso <= row.window_end) return "open";
  return "overdue";
}

async function handleRefreshWindows(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  const role = ctx.staff?.role;
  if (!hasRole(role, CONTENT_ROLES)) {
    return res.status(403).json({ error: "marketing/content staff only" });
  }
  const canEdit = hasRole(role, CONTENT_MANAGER_ROLES);
  const todayIso = nowIso().slice(0, 10);

  if (req.method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "")
      ? req.query.month
      : nowIso().slice(0, 7);
    const weeks = refreshMonthWeeks(month);

    // Eligible = V1.5/V2 and not churned. V1 academies are never enrolled.
    const allClients = await sb(
      `clients?or=(v2_access.is.true,v15_access.is.true)&select=id,business_name,status,refresh_week`
    );
    const eligible = (allClients || []).filter(c => c.status !== "churned");
    const enrolled = eligible.filter(c => c.refresh_week >= 1 && c.refresh_week <= 4);
    const unassigned = eligible
      .filter(c => !c.refresh_week)
      .map(c => ({ id: c.id, business_name: c.business_name }));
    const nameById = Object.fromEntries(eligible.map(c => [String(c.id), c.business_name]));

    // Materialize this month's rows for enrolled clients (idempotent - the
    // unique (client_id, month) index absorbs re-runs).
    if (enrolled.length) {
      const inserts = enrolled.map(c => ({
        client_id: c.id,
        month,
        window_start: weeks[c.refresh_week].start,
        window_end: weeks[c.refresh_week].end,
      }));
      await sb(`creative_refresh_windows?on_conflict=client_id,month`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(inserts),
      });
    }

    let rows = (await sb(`creative_refresh_windows?month=eq.${month}&select=*`)) || [];

    // Auto-detect submissions + last-submission dates in two ticket queries
    // (last 120 days covers any month view the calendar realistically shows).
    const clientIds = [...new Set([...rows.map(r => String(r.client_id)), ...enrolled.map(c => String(c.id))])];
    const lastSubmission = {};
    if (clientIds.length) {
      const since = new Date(Date.now() - 120 * 86400000).toISOString();
      const idList = clientIds.join(",");
      const [mk, ct] = await Promise.all([
        sb(`marketing_tickets?client_id=in.(${idList})&submitted_at=gte.${since}&select=id,client_id,submitted_at`),
        sb(`content_tickets?client_id=in.(${idList})&submitted_at=gte.${since}&select=id,client_id,submitted_at`),
      ]);
      const all = [
        ...(ct || []).map(t => ({ ...t, _type: "content" })),
        ...(mk || []).map(t => ({ ...t, _type: "marketing" })),
      ];
      for (const t of all) {
        const key = String(t.client_id);
        if (!lastSubmission[key] || t.submitted_at > lastSubmission[key]) {
          lastSubmission[key] = t.submitted_at;
        }
      }
      // A ticket submitted inside an unfinished window satisfies it.
      for (const r of rows) {
        if (r.status === "submitted" || r.status === "skipped") continue;
        const hit = all.find(t =>
          String(t.client_id) === String(r.client_id) &&
          t.submitted_at >= r.window_start &&
          t.submitted_at <= `${r.window_end}T23:59:59Z`
        );
        if (hit) {
          const patch = {
            status: "submitted",
            submitted_ticket_id: hit.id,
            submitted_ticket_type: hit._type,
            updated_at: nowIso(),
          };
          await sb(`creative_refresh_windows?id=eq.${r.id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          });
          Object.assign(r, patch);
        }
      }
    }

    const windows = rows.map(r => {
      const week = Math.min(4, Math.max(1,
        Math.round((Date.parse(r.window_start) - Date.parse(weeks[1].start)) / (7 * 86400000)) + 1
      ));
      return {
        id: r.id,
        client_id: r.client_id,
        business_name: nameById[String(r.client_id)] || "Unknown academy",
        week,
        window_start: r.window_start,
        window_end: r.window_end,
        status: refreshDeriveStatus(r, todayIso),
        nudges: Array.isArray(r.nudges) ? r.nudges : [],
        submitted_ticket_id: r.submitted_ticket_id,
        submitted_ticket_type: r.submitted_ticket_type,
        last_submission: lastSubmission[String(r.client_id)] || null,
      };
    });

    return res.status(200).json({ month, weeks, windows, unassigned, canEdit });
  }

  if (req.method === "PATCH") {
    if (!canEdit) return res.status(403).json({ error: "managers only" });
    const body = req.body || {};
    const action = body.action;

    if (action === "set-week") {
      const clientId = body.client_id;
      const week = body.week === null ? null : Number(body.week);
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (week !== null && !(week >= 1 && week <= 4)) {
        return res.status(400).json({ error: "week must be 1-4 or null" });
      }
      await sb(`clients?id=eq.${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ refresh_week: week }),
      });
      const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : nowIso().slice(0, 7);
      if (week === null) {
        // Unenroll: drop this month's untouched window; history stays.
        await sb(
          `creative_refresh_windows?client_id=eq.${clientId}&month=eq.${month}&status=in.(upcoming,open,overdue)`,
          { method: "DELETE" }
        );
      } else {
        const weeks = refreshMonthWeeks(month);
        await sb(
          `creative_refresh_windows?client_id=eq.${clientId}&month=eq.${month}&status=in.(upcoming,open,overdue)`,
          {
            method: "PATCH",
            body: JSON.stringify({
              window_start: weeks[week].start,
              window_end: weeks[week].end,
              updated_at: nowIso(),
            }),
          }
        );
      }
      return res.status(200).json({ ok: true });
    }

    // Everything below operates on one window row.
    const id = body.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const rows = await sb(`creative_refresh_windows?id=eq.${id}&select=*`);
    const row = rows?.[0];
    if (!row) return res.status(404).json({ error: "window not found" });

    if (action === "move-week") {
      const week = Number(body.week);
      if (!(week >= 1 && week <= 4)) return res.status(400).json({ error: "week must be 1-4" });
      if (row.status === "submitted" || row.status === "skipped") {
        return res.status(400).json({ error: "window already resolved" });
      }
      const weeks = refreshMonthWeeks(row.month);
      const updated = await sb(`creative_refresh_windows?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          window_start: weeks[week].start,
          window_end: weeks[week].end,
          updated_at: nowIso(),
        }),
      });
      return res.status(200).json({ window: updated?.[0] || null });
    }

    if (action === "nudge") {
      const clientRows = await sb(`clients?id=eq.${row.client_id}&select=business_name`);
      const businessName = clientRows?.[0]?.business_name || "your academy";
      const until = new Date(`${row.window_end}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      });
      // Fire-and-forget, same as ticket notifications - Slack being down
      // must never block the staff action.
      postClientSlackNotification(
        row.client_id,
        `🎨 Creative refresh time for ${businessName}! Your update window is open until ${until}. Send us fresh ad creatives - or share recent posts from your page and we'll test those.`,
        req
      );
      const nudges = [
        ...(Array.isArray(row.nudges) ? row.nudges : []),
        { at: nowIso(), by: ctx.staff.name || ctx.staff.email, kind: "manual" },
      ];
      const updated = await sb(`creative_refresh_windows?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ nudges, updated_at: nowIso() }),
      });
      return res.status(200).json({ window: updated?.[0] || null });
    }

    if (action === "mark-received") {
      const updated = await sb(`creative_refresh_windows?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "submitted",
          submitted_ticket_type: "manual",
          updated_at: nowIso(),
        }),
      });
      return res.status(200).json({ window: updated?.[0] || null });
    }

    if (action === "skip") {
      const updated = await sb(`creative_refresh_windows?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "skipped", updated_at: nowIso() }),
      });
      return res.status(200).json({ window: updated?.[0] || null });
    }

    return res.status(400).json({ error: "unknown action" });
  }

  return res.status(405).json({ error: "method not allowed" });
}

export default withSentryApiRoute(handler);
