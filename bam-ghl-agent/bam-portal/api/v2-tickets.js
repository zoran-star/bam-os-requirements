import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function - V2 ticket rail (Track 2 / P3).
// Every mutation on v2_tickets / v2_ticket_messages flows through here, so the
// P6 notification hooks (Slack function channels + client SMS) get ONE place to
// live. Client portal calls with a Supabase Bearer token + ?client_id.
//
//   ?action=create   POST  { type, title?, intake, context, source, message? }
//   ?action=list     GET   client: own tickets; staff: filter role/status/client
//   ?action=thread   GET   &id=  ticket + messages (internal stripped for clients)
//   ?action=reply    POST  &id=  { body, attachments? }
//   ?action=status   POST  &id=  staff only { status, close_reason? }
//   ?action=upload-final          POST &id=  staff { files: [{name,url,size,mime}] }
//   ?action=send-to-marketing     POST &id=  staff, content_ask only { review_requested? }
//   ?action=mark-live             POST &id=  staff, marketing_ask only
//   ?action=request-client-action POST &id=  staff { kind: reply|upload|approval, message }
//   ?action=reassign              POST &id=  staff { assigned_to?, assignee_role?, type? }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// type -> the role that OWNS the work (locked registry, see the design doc).
const TYPE_ROLE = {
  fix: "backlog", // Zoran triages ALL client-reported bugs first; he re-lanes real system faults via ?action=reassign
  website_change: "systems",
  billing_fix: "systems",
  data_fix: "systems",
  build_ask: "systems",
  agent_correction: "agent_supervision",
  marketing_ask: "marketing",
  content_ask: "content",
  feature_idea: "backlog",
  general: "systems",
};

const ASSIGNEE_ROLES = ["systems", "agent_supervision", "marketing", "content", "backlog"];

// ── Auto-assignment (LOCKED: reuse Cam's V1.5 routing). The resolver logic is
// ported from api/marketing.js - kept local because serverless entries can't
// import each other. Every resolver returns null on failure; a null owner
// never blocks a ticket mutation.

// The marketing manager's (Cam's) staff id - global default owner of ads content.
async function marketingManagerStaffId() {
  try {
    const email = process.env.MARKETING_MANAGER_EMAIL || "cameron@byanymeansbusiness.com";
    const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=id`);
    return rows?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

// The client's Scaling Manager - auto-owner of their marketing tickets.
async function clientScalingManager(clientId) {
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=scaling_manager_id`);
    return rows?.[0]?.scaling_manager_id || null;
  } catch (_) {
    return null;
  }
}

// Content lane (ads creatives): the client's per-channel roster assignee,
// else the global default (Cam).
async function contentAdsAssignee(clientId) {
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=content_assignee_ads_id`);
    if (rows?.[0]?.content_assignee_ads_id) return rows[0].content_assignee_ads_id;
  } catch (_) { /* fall through to the global default */ }
  return await marketingManagerStaffId();
}

// role -> auto-assigned owner at create. null = unassigned.
async function autoAssignFor(role, clientId) {
  try {
    if (role === "content") return await contentAdsAssignee(clientId);
    if (role === "marketing") return await clientScalingManager(clientId);
  } catch (_) { /* never block creation */ }
  return null;
}

// System row on a thread (doubles as the status/audit log).
async function systemMessage(ticketId, clientId, body) {
  await sb(`v2_ticket_messages`, {
    method: "POST",
    body: JSON.stringify({
      ticket_id: ticketId, client_id: clientId,
      author_kind: "system", author_name: "System", body,
    }),
  });
}

// Notify hook (P6 fills this in: Slack function channels + client SMS). Stubbed
// as a no-op log so every call site is already wired.
function notifyTicketEvent(event, ticket) {
  try { console.log(`[v2-tickets] ${event}`, ticket?.id, ticket?.type, ticket?.status); } catch (_) {}
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

  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role`);
  }
  const staff = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  const ownerRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id`);
  const ownerId = Array.isArray(ownerRows) && ownerRows[0] ? String(ownerRows[0].id) : null;
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=id,client_id,name`);
  const memberRows = Array.isArray(memberships) ? memberships : [];
  const clientIds = memberRows.map((m) => String(m.client_id));

  const belongsTo = (id) => !!id && (id === ownerId || clientIds.includes(id));
  const requested = req.query && req.query.client_id ? String(req.query.client_id) : null;
  let targetId = null;
  if (requested && belongsTo(requested)) targetId = requested;
  else if (ownerId) targetId = ownerId;
  else if (clientIds.length === 1) targetId = clientIds[0];

  // client_users row for created_by (the acting teammate), if any
  const memberForTarget = memberRows.find((m) => String(m.client_id) === targetId);
  return {
    user, staff,
    clientId: targetId,
    clientUserId: memberForTarget ? memberForTarget.id : null,
    authorName: (memberForTarget && memberForTarget.name) || staff?.name || user.email || "Client",
    isStaff: !!staff,
    belongsTo,
  };
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "supabase not configured" });
  }
  const action = (req.query.action || "").toString();
  let ctx;
  try { ctx = await resolveUser(req); } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  try {
    if (action === "create" && req.method === "POST") return await create(req, res, ctx);
    if (action === "list" && req.method === "GET") return await list(req, res, ctx);
    if (action === "thread" && req.method === "GET") return await thread(req, res, ctx);
    if (action === "reply" && req.method === "POST") return await reply(req, res, ctx);
    if (action === "status" && req.method === "POST") return await setStatus(req, res, ctx);
    if (action === "upload-final" && req.method === "POST") return await uploadFinal(req, res, ctx);
    if (action === "send-to-marketing" && req.method === "POST") return await sendToMarketing(req, res, ctx);
    if (action === "mark-live" && req.method === "POST") return await markLive(req, res, ctx);
    if (action === "request-client-action" && req.method === "POST") return await requestClientAction(req, res, ctx);
    if (action === "reassign" && req.method === "POST") return await reassign(req, res, ctx);
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

async function create(req, res, ctx) {
  const b = req.body || {};
  const type = String(b.type || "");
  if (!TYPE_ROLE[type]) return res.status(400).json({ error: "bad type" });
  const clientId = ctx.isStaff && b.client_id ? String(b.client_id) : ctx.clientId;
  if (!clientId) return res.status(400).json({ error: "no client" });
  if (!ctx.isStaff && !ctx.belongsTo(clientId)) return res.status(403).json({ error: "forbidden" });

  // Auto-assign the owner at create (V1.5 routing). Resolution failures or a
  // null result never block ticket creation - the ticket lands unowned.
  let assignedTo = null;
  try { assignedTo = await autoAssignFor(TYPE_ROLE[type], clientId); } catch (_) { assignedTo = null; }

  const row = {
    client_id: clientId,
    type,
    status: "new",
    assignee_role: TYPE_ROLE[type],
    assigned_to: assignedTo,
    title: (b.title || "").toString().slice(0, 200),
    source: String(b.source || (ctx.isStaff ? "staff" : "icon-chat")),
    intake: b.intake && typeof b.intake === "object" ? b.intake : {},
    context: b.context && typeof b.context === "object" ? b.context : {},
    created_by: ctx.isStaff ? null : ctx.clientUserId,
    created_by_staff: ctx.isStaff ? ctx.staff.id : null,
  };
  const inserted = await sb(`v2_tickets`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const ticket = Array.isArray(inserted) ? inserted[0] : inserted;

  // Optional opening message on the thread.
  const msgBody = (b.message || "").toString().trim();
  if (ticket && msgBody) {
    await sb(`v2_ticket_messages`, {
      method: "POST",
      body: JSON.stringify({
        ticket_id: ticket.id, client_id: clientId,
        author_kind: ctx.isStaff ? "staff" : "client",
        author_client_user_id: ctx.isStaff ? null : ctx.clientUserId,
        author_staff_id: ctx.isStaff ? ctx.staff.id : null,
        author_name: ctx.authorName, body: msgBody,
      }),
    });
  }
  notifyTicketEvent("created", ticket);
  return res.status(200).json({ ok: true, ticket });
}

async function list(req, res, ctx) {
  if (ctx.isStaff) {
    const parts = ["select=*", "order=updated_at.desc", "limit=200"];
    if (req.query.role) parts.push(`assignee_role=eq.${encodeURIComponent(req.query.role)}`);
    if (req.query.status) parts.push(`status=eq.${encodeURIComponent(req.query.status)}`);
    if (req.query.client_id) parts.push(`client_id=eq.${encodeURIComponent(req.query.client_id)}`);
    const rows = await sb(`v2_tickets?${parts.join("&")}`);
    return res.status(200).json({ tickets: rows || [] });
  }
  if (!ctx.clientId) return res.status(200).json({ tickets: [] });
  const rows = await sb(`v2_tickets?client_id=eq.${ctx.clientId}&order=updated_at.desc&limit=200&select=*`);
  return res.status(200).json({ tickets: rows || [] });
}

async function loadTicket(id) {
  const rows = await sb(`v2_tickets?id=eq.${id}&select=*`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
function canSee(ctx, ticket) {
  return ticket && (ctx.isStaff || ctx.belongsTo(String(ticket.client_id)));
}

async function thread(req, res, ctx) {
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!canSee(ctx, ticket)) return res.status(404).json({ error: "not found" });
  let msgs = await sb(`v2_ticket_messages?ticket_id=eq.${id}&order=created_at.asc&select=*`) || [];
  if (!ctx.isStaff) msgs = msgs.filter((m) => !m.internal);
  return res.status(200).json({ ticket, messages: msgs });
}

async function reply(req, res, ctx) {
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!canSee(ctx, ticket)) return res.status(404).json({ error: "not found" });
  const body = (req.body?.body || "").toString().trim();
  if (!body) return res.status(400).json({ error: "empty" });
  await sb(`v2_ticket_messages`, {
    method: "POST",
    body: JSON.stringify({
      ticket_id: id, client_id: ticket.client_id,
      author_kind: ctx.isStaff ? "staff" : "client",
      author_client_user_id: ctx.isStaff ? null : ctx.clientUserId,
      author_staff_id: ctx.isStaff ? ctx.staff.id : null,
      author_name: ctx.authorName, body,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      internal: ctx.isStaff && !!req.body?.internal,
    }),
  });
  // Client reply on a blocked ticket flips it back to in_progress and clears
  // the pending request card (request-client-action) if one is stamped.
  if (!ctx.isStaff && ticket.status === "waiting_client") {
    const patch = { status: "in_progress" };
    if (ticket.intake && ticket.intake.pending_request) {
      const intake = { ...ticket.intake };
      delete intake.pending_request;
      patch.intake = intake;
    }
    await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  notifyTicketEvent("reply", ticket);
  return res.status(200).json({ ok: true });
}

async function setStatus(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  const status = String(req.body?.status || "");
  if (!["new", "in_progress", "waiting_client", "resolved", "closed"].includes(status)) {
    return res.status(400).json({ error: "bad status" });
  }
  const patch = { status };
  if (status === "resolved") patch.resolved_at = new Date().toISOString();
  if (status === "closed") { patch.closed_at = new Date().toISOString(); if (req.body?.close_reason) patch.close_reason = String(req.body.close_reason); }
  await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  // status change = a system row on the thread (doubles as the status log)
  await sb(`v2_ticket_messages`, {
    method: "POST",
    body: JSON.stringify({
      ticket_id: id, client_id: ticket.client_id, author_kind: "system",
      author_name: "System", body: `Status: ${status}`,
    }),
  });
  notifyTicketEvent("status", { ...ticket, status });
  return res.status(200).json({ ok: true });
}

// ── C1: content -> marketing handoff + ads archive (locked design 2026-07-20) ──

// Staff attach the finished creative to the ticket. Appends to
// intake.final_files: [{ name, url, size, mime }].
async function uploadFinal(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  const files = (Array.isArray(req.body?.files) ? req.body.files : [])
    .filter((f) => f && typeof f === "object" && (f.url || f.name))
    .map((f) => ({
      name: (f.name || "").toString().slice(0, 300),
      url: (f.url || "").toString(),
      size: Number.isFinite(Number(f.size)) && Number(f.size) > 0 ? Number(f.size) : null,
      mime: (f.mime || "").toString() || null,
    }));
  if (!files.length) return res.status(400).json({ error: "no files" });

  const intake = { ...(ticket.intake || {}) };
  intake.final_files = [...(Array.isArray(intake.final_files) ? intake.final_files : []), ...files];
  await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ intake }) });
  await systemMessage(id, ticket.client_id, `Uploaded finished creative (${files.length} file${files.length === 1 ? "" : "s"})`);
  notifyTicketEvent("final-upload", ticket);
  return res.status(200).json({ ok: true, final_files: intake.final_files });
}

// Content team hands the finished creative to marketing: the content_ask
// resolves and a NEW linked marketing_ask spawns in the marketing lane, owned
// by the client's Scaling Manager. Optional client-approval gate
// (review_requested, default off) parks the ORIGIN with the client instead.
async function sendToMarketing(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  if (ticket.type !== "content_ask") return res.status(400).json({ error: "only content_ask tickets can be sent to marketing" });
  const finals = Array.isArray(ticket.intake?.final_files) ? ticket.intake.final_files : [];
  if (!finals.length) return res.status(400).json({ error: "upload the finished creative first" });

  if (req.body?.review_requested) {
    const intake = { ...(ticket.intake || {}) };
    intake.pending_request = { kind: "approval", message: "Sent for client review", requested_at: new Date().toISOString() };
    await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "waiting_client", intake }) });
    await systemMessage(id, ticket.client_id, "Sent for client review");
    notifyTicketEvent("client-action-requested", { ...ticket, status: "waiting_client" });
    return res.status(200).json({ ok: true, spawned_ticket: null });
  }

  // Owner of the spawned marketing work = the client's Scaling Manager.
  // Null never blocks the handoff.
  let assignedTo = null;
  try { assignedTo = await clientScalingManager(ticket.client_id); } catch (_) { assignedTo = null; }

  await sb(`v2_tickets?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString() }),
  });
  await systemMessage(id, ticket.client_id, "Sent to marketing");

  const originIntake = ticket.intake || {};
  const spawnIntake = { mode: "post", origin_ticket_id: ticket.id, final_files: finals };
  // Carry the creative brief along (current P3a keys + the locked
  // Offer / Sales preset / Angle spellings landing in P3b).
  for (const k of ["brief", "offer", "offer_id", "preset", "sales_preset", "angle"]) {
    if (originIntake[k] !== undefined && originIntake[k] !== null) spawnIntake[k] = originIntake[k];
  }
  const spawnContext = { origin_ticket_id: ticket.id };
  if (ticket.context && ticket.context.campaign != null) spawnContext.campaign = ticket.context.campaign;

  const inserted = await sb(`v2_tickets`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      client_id: ticket.client_id,
      type: "marketing_ask",
      status: "new",
      assignee_role: "marketing",
      assigned_to: assignedTo,
      title: (ticket.title ? `Post the ad - ${ticket.title}` : "Post the ad").slice(0, 200),
      source: "staff",
      intake: spawnIntake,
      context: spawnContext,
      created_by: null,
      created_by_staff: ctx.staff.id,
    }),
  });
  const spawned = Array.isArray(inserted) ? inserted[0] : inserted;
  notifyTicketEvent("handoff", spawned);
  return res.status(200).json({ ok: true, spawned_ticket: spawned });
}

// Marketing posted the ad: resolve the marketing_ask and archive the final
// creatives into the client's asset library (category 'ads', visible to the
// academy). Archiving must never fail the mutation.
async function markLive(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  if (ticket.type !== "marketing_ask") return res.status(400).json({ error: "only marketing_ask tickets can go live" });

  await sb(`v2_tickets?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString() }),
  });
  await systemMessage(id, ticket.client_id, "Ad is live");

  let archivedIds = [];
  try {
    archivedIds = await archiveFinalsToAssets(ticket);
    if (archivedIds.length) {
      const intake = { ...(ticket.intake || {}) };
      intake.archived_asset_ids = [
        ...(Array.isArray(intake.archived_asset_ids) ? intake.archived_asset_ids : []),
        ...archivedIds,
      ];
      await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ intake }) });
    }
  } catch (e) {
    console.error("[v2-tickets] mark-live archive failed:", e?.message || e);
  }

  notifyTicketEvent("live", { ...ticket, status: "resolved" });
  return res.status(200).json({ ok: true, archived_asset_ids: archivedIds });
}

// Archive intake.final_files into client_assets as LINK rows (category 'ads').
// NOTE: client_assets.source_ticket_id FKs the LEGACY content_tickets table,
// so it stays NULL for rail tickets - the back-link lives on the ticket's
// intake.archived_asset_ids instead. Per-file inserts so a duplicate
// (client_id, link_url) skips that file without dropping the rest.
async function archiveFinalsToAssets(ticket) {
  const files = (Array.isArray(ticket.intake?.final_files) ? ticket.intake.final_files : [])
    .filter((f) => f && f.url);
  const ids = [];
  for (const f of files) {
    const name = (f.name || "").toString();
    const row = {
      client_id: ticket.client_id,
      label: name.replace(/\.[^./]+$/, "").trim() || name || "ad",
      category: "ads",
      link_url: f.url,
      mime_type: f.mime || null,
      size_bytes: Number.isFinite(Number(f.size)) && Number(f.size) > 0 ? Number(f.size) : null,
      source: "ticket",
      source_ticket_id: null,
    };
    try {
      const inserted = await sb(`client_assets`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      const a = Array.isArray(inserted) ? inserted[0] : inserted;
      if (a?.id) ids.push(a.id);
    } catch (_) {
      // Duplicate (client_id, link_url) or a per-file failure - skip this one.
    }
  }
  return ids;
}

// One mechanism, three types: staff ask the client for a reply, an upload, or
// an approval. Parks the ticket waiting_client, rides the shared thread as a
// visible staff message, and stamps intake.pending_request for the client-side
// "your team needs something" card. Cleared by the client reply flip.
async function requestClientAction(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  const kind = String(req.body?.kind || "");
  if (!["reply", "upload", "approval"].includes(kind)) return res.status(400).json({ error: "bad kind" });
  const message = (req.body?.message || "").toString().trim();
  if (!message) return res.status(400).json({ error: "empty message" });

  const intake = { ...(ticket.intake || {}) };
  intake.pending_request = { kind, message, requested_at: new Date().toISOString() };
  await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "waiting_client", intake }) });

  await sb(`v2_ticket_messages`, {
    method: "POST",
    body: JSON.stringify({
      ticket_id: id, client_id: ticket.client_id,
      author_kind: "staff",
      author_staff_id: ctx.staff.id,
      author_name: ctx.authorName,
      body: message,
      internal: false,
    }),
  });

  notifyTicketEvent("client-action-requested", { ...ticket, status: "waiting_client" });
  return res.status(200).json({ ok: true });
}

// Staff move a ticket: new owner (assigned_to), new lane (assignee_role),
// and/or a type change that re-lanes it. Same row, thread intact; a system
// message logs the move.
async function reassign(req, res, ctx) {
  if (!ctx.isStaff) return res.status(403).json({ error: "staff only" });
  const id = String(req.query.id || "");
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  const patch = {};
  const notes = [];

  if (b.type !== undefined) {
    const type = String(b.type || "");
    if (!TYPE_ROLE[type]) return res.status(400).json({ error: "bad type" });
    if (type !== ticket.type) {
      patch.type = type;
      patch.assignee_role = TYPE_ROLE[type];
      notes.push(`type ${ticket.type} -> ${type}`);
    }
  }
  if (b.assignee_role !== undefined) {
    const role = String(b.assignee_role || "");
    if (!ASSIGNEE_ROLES.includes(role)) return res.status(400).json({ error: "bad role" });
    if (role !== (patch.assignee_role || ticket.assignee_role)) {
      patch.assignee_role = role;
      notes.push(`lane ${ticket.assignee_role} -> ${role}`);
    }
  }
  if ("assigned_to" in b) {
    const to = b.assigned_to == null || b.assigned_to === "" ? null : String(b.assigned_to);
    let ownerName = "unassigned";
    if (to) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(to)) {
        return res.status(400).json({ error: "bad staff id" });
      }
      const rows = await sb(`staff?id=eq.${to}&select=id,name`);
      if (!rows?.[0]) return res.status(400).json({ error: "unknown staff" });
      ownerName = rows[0].name || "staff";
    }
    patch.assigned_to = to;
    notes.push(`owner -> ${ownerName}`);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to change" });

  await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  await systemMessage(id, ticket.client_id, `Reassigned: ${notes.join(", ")}`);
  notifyTicketEvent("reassigned", { ...ticket, ...patch });
  return res.status(200).json({ ok: true });
}

export default withSentryApiRoute(handler);
