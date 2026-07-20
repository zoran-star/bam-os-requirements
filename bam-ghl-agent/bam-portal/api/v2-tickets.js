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
  fix: "systems",
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

  const row = {
    client_id: clientId,
    type,
    status: "new",
    assignee_role: TYPE_ROLE[type],
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
  // Client reply on a blocked ticket flips it back to in_progress.
  if (!ctx.isStaff && ticket.status === "waiting_client") {
    await sb(`v2_tickets?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
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

export default withSentryApiRoute(handler);
