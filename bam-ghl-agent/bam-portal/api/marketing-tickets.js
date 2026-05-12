// Vercel Serverless Function — Marketing Tickets
//
// Routes (single file, branches on method + query):
//   GET    /api/marketing-tickets                 → list (staff: all; client: their own)
//   GET    /api/marketing-tickets?id=<uuid>       → one ticket
//   POST   /api/marketing-tickets                 → client creates a new ticket
//                                                   body: { type, fields, files }
//   PATCH  /api/marketing-tickets?id=<uuid>       → update via action
//                                                   body: { action, ...payload }
//
// Action keys (PATCH):
//   Staff actions:
//     - approve-content        : flip content_check_status = 'approved'
//     - request-client-action  : { message } — appends message, sets client_action_status = 'requested'
//     - mark-completed         : flip status = 'completed'
//   Client actions:
//     - cancel                 : flip status = 'cancelled' (own ticket only)
//     - edit                   : { fields?, files? } (own ticket, in-progress only)
//     - respond                : { message } (own ticket, when action requested)
//
// Auth:
//   - Header: Authorization: Bearer <supabase access token>
//   - Resolves user role: staff (in `staff` table) vs client (matches `clients.auth_user_id`)
//   - Staff role gate is broad (any staff). Per-role policies enforced at action level.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const CONTENT_TYPES = new Set(["replace", "add", "campaign-create"]);

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

  // Resolve staff: try user_id first, fall back to email (handles legacy rows)
  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staffRow = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  // Always also resolve client (a user can be both — used for client-context actions)
  const clientRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id,name`);
  const clientRow = Array.isArray(clientRows) && clientRows[0] ? clientRows[0] : null;

  return { user, staff: staffRow, client: clientRow };
}

async function enrichWithClient(tickets) {
  if (!tickets.length) return tickets;
  const clientIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))];
  if (!clientIds.length) return tickets;
  const clients = await sb(`clients?id=in.(${clientIds.join(",")})&select=id,name`);
  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));
  return tickets.map(t => ({ ...t, client: clientMap[t.client_id] || null }));
}

function nowIso() { return new Date().toISOString(); }

function appendMessage(existing, msg) {
  const arr = Array.isArray(existing) ? existing : [];
  return [...arr, { ...msg, created_at: nowIso() }];
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;

    // ─── Resolve user ────────────────────────────────────────────
    const ctx = await resolveUser(req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

    const isStaff = !!ctx.staff;
    const isClient = !!ctx.client;
    if (!isStaff && !isClient) {
      return res.status(403).json({ error: "user is neither staff nor a linked client" });
    }

    // ─── GET ─────────────────────────────────────────────────────
    if (req.method === "GET") {
      // Scope resolves which "view" we return when a user is dual-role.
      // ?scope=staff  → return all (requires staff role)
      // ?scope=client → return only own (requires client role)
      // (no scope)    → default: staff if pure staff; otherwise client
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
        const enriched = asStaff ? (await enrichWithClient([ticket]))[0] : ticket;
        return res.status(200).json({ ticket: enriched });
      }

      if (asStaff) {
        const tickets = await sb(`marketing_tickets?select=*&order=submitted_at.desc`);
        const out = await enrichWithClient(tickets || []);
        return res.status(200).json({ tickets: out });
      }

      if (!isClient) return res.status(403).json({ error: "not authorized for this scope" });
      const tickets = await sb(`marketing_tickets?select=*&order=submitted_at.desc&client_id=eq.${ctx.client.id}`);
      return res.status(200).json({ tickets: tickets || [] });
    }

    // ─── POST (client creates) ───────────────────────────────────
    if (req.method === "POST") {
      if (!isClient) return res.status(403).json({ error: "only clients can submit marketing tickets" });
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const { type, fields, files } = body;
      if (!type) return res.status(400).json({ error: "type is required" });
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
        }]),
      });
      return res.status(201).json({ ticket: inserted?.[0] || null });
    }

    // ─── PATCH (actions) ─────────────────────────────────────────
    if (req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id query param is required" });
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const { action } = body;
      if (!action) return res.status(400).json({ error: "action is required in body" });

      // Fetch current ticket
      const existing = await sb(`marketing_tickets?id=eq.${id}&select=*`);
      const ticket = existing?.[0];
      if (!ticket) return res.status(404).json({ error: "not found" });

      // Authorization per action
      const staffActions = new Set(["approve-content", "request-client-action", "mark-completed"]);
      const clientActions = new Set(["cancel", "edit", "respond"]);

      if (staffActions.has(action)) {
        if (!isStaff) return res.status(403).json({ error: "staff only" });
      } else if (clientActions.has(action)) {
        if (!isClient) return res.status(403).json({ error: "client only" });
        if (ticket.client_id !== ctx.client.id) return res.status(403).json({ error: "not your ticket" });
      } else {
        return res.status(400).json({ error: `unknown action: ${action}` });
      }

      // Build patch payload
      let patch = {};
      const authorName = isStaff ? ctx.staff.name : (ctx.client.name || "Client");
      const authorType = isStaff ? "staff" : "client";

      if (action === "approve-content") {
        if (ticket.content_check_status !== "pending") {
          return res.status(409).json({ error: "content check is not pending" });
        }
        patch.content_check_status = "approved";
        patch.messages = appendMessage(ticket.messages, {
          author_type: "staff",
          author_id: ctx.staff.id,
          author_name: authorName,
          body: "Content approved.",
          is_action_request: false,
        });
      } else if (action === "request-client-action") {
        const message = (body.message || "").trim();
        if (!message) return res.status(400).json({ error: "message is required" });
        patch.client_action_status = "requested";
        patch.messages = appendMessage(ticket.messages, {
          author_type: "staff",
          author_id: ctx.staff.id,
          author_name: authorName,
          body: message,
          is_action_request: true,
        });
      } else if (action === "mark-completed") {
        patch.status = "completed";
        patch.resolved_at = nowIso();
        patch.messages = appendMessage(ticket.messages, {
          author_type: "staff",
          author_id: ctx.staff.id,
          author_name: authorName,
          body: "Marked completed.",
          is_action_request: false,
        });
      } else if (action === "cancel") {
        if (ticket.status !== "in-progress") {
          return res.status(409).json({ error: "ticket is not active" });
        }
        patch.status = "cancelled";
        patch.resolved_at = nowIso();
        patch.messages = appendMessage(ticket.messages, {
          author_type: "client",
          author_name: authorName,
          body: "Cancelled by client.",
          is_action_request: false,
        });
      } else if (action === "edit") {
        if (ticket.status !== "in-progress") {
          return res.status(409).json({ error: "ticket is not active" });
        }
        if (body.fields && typeof body.fields === "object") {
          patch.fields = { ...(ticket.fields || {}), ...body.fields };
        }
        if (Array.isArray(body.files)) {
          patch.files = body.files;
        }
        patch.messages = appendMessage(ticket.messages, {
          author_type: "client",
          author_name: authorName,
          body: "Updated the request.",
          is_action_request: false,
        });
      } else if (action === "respond") {
        const message = (body.message || "").trim();
        if (!message) return res.status(400).json({ error: "message is required" });
        if (ticket.client_action_status !== "requested") {
          return res.status(409).json({ error: "no action was requested" });
        }
        patch.client_action_status = "responded";
        patch.messages = appendMessage(ticket.messages, {
          author_type: "client",
          author_name: authorName,
          body: message,
          is_action_request: false,
        });
      }

      const updated = await sb(`marketing_tickets?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      return res.status(200).json({ ticket: updated?.[0] || null });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
