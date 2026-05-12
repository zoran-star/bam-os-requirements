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
const GUIDE_WRITE_ROLES = new Set(["admin", "marketing", "marketing_manager", "marketing_executor"]);

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

  // Always also resolve client (a user can be both)
  const clientRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id,name`);
  const clientRow = Array.isArray(clientRows) && clientRows[0] ? clientRows[0] : null;

  return { user, staff: staffRow, client: clientRow };
}

function nowIso() { return new Date().toISOString(); }
function appendMessage(existing, msg) {
  const arr = Array.isArray(existing) ? existing : [];
  return [...arr, { ...msg, created_at: nowIso() }];
}

async function enrichWithClient(tickets) {
  if (!tickets.length) return tickets;
  const clientIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))];
  if (!clientIds.length) return tickets;
  const clients = await sb(`clients?id=in.(${clientIds.join(",")})&select=id,name`);
  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));
  return tickets.map(t => ({ ...t, client: clientMap[t.client_id] || null }));
}

// ─────────────────────────────────────────────────────────
// Main handler — routes by ?resource=
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const resource = req.query.resource;
    if (resource === "tickets") {
      return handleMarketingTickets(req, res);
    }
    if (resource === "guide-cards") {
      return handleGuideCards(req, res);
    }
    if (resource === "content-tickets") {
      return handleContentTickets(req, res);
    }
    return res.status(400).json({ error: "missing or invalid ?resource= (expected 'tickets' | 'guide-cards' | 'content-tickets')" });
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

  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id query param is required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { action } = body;
    if (!action) return res.status(400).json({ error: "action is required in body" });

    const existing = await sb(`marketing_tickets?id=eq.${id}&select=*`);
    const ticket = existing?.[0];
    if (!ticket) return res.status(404).json({ error: "not found" });

    const staffActions = new Set(["approve-content", "request-client-action", "mark-completed", "request-content-revision"]);
    const clientActions = new Set(["cancel", "edit", "respond"]);

    if (staffActions.has(action)) {
      if (!isStaff) return res.status(403).json({ error: "staff only" });
    } else if (clientActions.has(action)) {
      if (!isClient) return res.status(403).json({ error: "client only" });
      if (ticket.client_id !== ctx.client.id) return res.status(403).json({ error: "not your ticket" });
    } else {
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    let patch = {};
    const authorName = isStaff ? ctx.staff.name : (ctx.client.name || "Client");

    if (action === "approve-content") {
      if (ticket.content_check_status !== "pending") {
        return res.status(409).json({ error: "content check is not pending" });
      }
      patch.content_check_status = "approved";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Content approved.", is_action_request: false,
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
    } else if (action === "cancel") {
      if (ticket.status !== "in-progress") {
        return res.status(409).json({ error: "ticket is not active" });
      }
      patch.status = "cancelled";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: "Cancelled by client.", is_action_request: false,
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
        author_type: "client", author_name: authorName,
        body: "Updated the request.", is_action_request: false,
      });
    } else if (action === "respond") {
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "message is required" });
      if (ticket.client_action_status !== "requested") {
        return res.status(409).json({ error: "no action was requested" });
      }
      patch.client_action_status = "responded";
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: message, is_action_request: false,
      });
    } else if (action === "request-content-revision") {
      // Marketing wants the content team to redo the creative.
      // Spawn a new content_ticket carrying the revision notes + original final
      // files (for reference) + the same campaign context.
      const message = (body.message || "").trim();
      if (!message) return res.status(400).json({ error: "revision notes are required" });

      const revisionType = body.type || "graphic"; // default; UI should pass through
      const originalFields = ticket.fields || {};
      const newContextNotes = `Revision requested by marketing.\n\n${message}`;

      const contentInsert = await sb("content_tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: ticket.client_id,
          type: revisionType,
          status: "active",
          client_action_status: "none",
          notes: newContextNotes,
          raw_files: ticket.files || [],     // pass previous finals as starting point
          context: {
            source: "marketing-revision",
            campaign_title: originalFields.campaign_title || "",
            related_creative_name: originalFields.creative_name || "",
            originated_from_marketing_ticket_id: ticket.id,
          },
          messages: [{
            author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
            body: `Revision requested: ${message}`,
            is_action_request: false,
            created_at: nowIso(),
          }],
        }]),
      });

      // Mark the marketing ticket as awaiting revision (just leaves a message; doesn't change status)
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Sent back to content for revision. Tracking: ${contentInsert?.[0]?.id || ""}`,
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
    patch.updated_by = ctx.staff.id;

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

  // ─── GET ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const scope = req.query.scope;
    let asStaff;
    if (scope === "staff")  asStaff = isStaff;
    else if (scope === "client") asStaff = false;
    else                    asStaff = isStaff && !isClient;

    if (id) {
      const rows = await sb(`content_tickets?id=eq.${id}&select=*`);
      const ticket = rows?.[0];
      if (!ticket) return res.status(404).json({ error: "not found" });
      if (!asStaff && (!isClient || ticket.client_id !== ctx.client.id)) {
        return res.status(403).json({ error: "not your ticket" });
      }
      const enriched = asStaff ? (await enrichWithClient([ticket]))[0] : ticket;
      return res.status(200).json({ ticket: enriched });
    }

    if (asStaff) {
      // Staff list — oldest first per spec (so content team works FIFO)
      const tickets = await sb(`content_tickets?select=*&order=submitted_at.asc`);
      const out = await enrichWithClient(tickets || []);
      return res.status(200).json({ tickets: out });
    }

    // Client view: only return tickets where action is requested OR explicitly all=1
    if (!isClient) return res.status(403).json({ error: "not authorized for this scope" });
    const onlyActionable = req.query.all !== "1";
    const filter = onlyActionable
      ? `&client_action_status=eq.requested`
      : "";
    const tickets = await sb(`content_tickets?select=*&client_id=eq.${ctx.client.id}${filter}&order=submitted_at.desc`);
    return res.status(200).json({ tickets: tickets || [] });
  }

  // ─── POST (client creates) ─────────────────────────────────
  if (req.method === "POST") {
    if (!isClient) return res.status(403).json({ error: "only clients can submit content tickets" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { type, notes, raw_files, context } = body;
    if (!type) return res.status(400).json({ error: "type is required" });
    if (!["graphic", "video", "mixed"].includes(type)) {
      return res.status(400).json({ error: "type must be 'graphic', 'video', or 'mixed'" });
    }

    const inserted = await sb("content_tickets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        client_id: ctx.client.id,
        type,
        status: "active",
        client_action_status: "none",
        notes: notes || "",
        raw_files: Array.isArray(raw_files) ? raw_files : [],
        context: (context && typeof context === "object") ? context : {},
        messages: [],
      }]),
    });
    return res.status(201).json({ ticket: inserted?.[0] || null });
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
      "upload-final", "send-to-marketing",
      "request-client-action", "mark-completed",
      "assign", "edit-context",
    ]);
    const clientActions = new Set(["cancel", "respond"]);

    if (staffActions.has(action)) {
      if (!isStaff) return res.status(403).json({ error: "staff only" });
    } else if (clientActions.has(action)) {
      if (!isClient) return res.status(403).json({ error: "client only" });
      if (ticket.client_id !== ctx.client.id) return res.status(403).json({ error: "not your ticket" });
    } else {
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    let patch = {};
    const authorName = isStaff ? ctx.staff.name : (ctx.client.name || "Client");

    if (action === "upload-final") {
      const finals = Array.isArray(body.final_files) ? body.final_files : [];
      patch.final_files = [...(ticket.final_files || []), ...finals];
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Uploaded ${finals.length} final file${finals.length === 1 ? "" : "s"}.`,
        is_action_request: false,
      });

    } else if (action === "send-to-marketing") {
      // Spawn the downstream marketing ticket carrying the finals + context.
      if (!ticket.final_files || !ticket.final_files.length) {
        return res.status(409).json({ error: "upload at least one final creative before sending to marketing" });
      }

      const ctxObj = ticket.context || {};
      const source = ctxObj.source || "add-creative";

      // Determine marketing ticket type from source
      const mktType =
        source === "new-campaign" ? "campaign-create" :
        source === "change-campaign" || source === "add-creative" ? "add" :
        "add";

      // Build marketing ticket fields
      const mktFields = {
        campaign_title: ctxObj.campaign_title || "",
        note: ctxObj.note || "",
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

      // Insert marketing ticket
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
          messages: [{
            author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
            body: `Sent from content ticket (${ticket.type}).`,
            is_action_request: false,
            created_at: nowIso(),
          }],
          originated_from_content_ticket_id: ticket.id,
        }]),
      });
      const spawnedId = marketingInsert?.[0]?.id;

      patch.status = "completed";
      patch.sent_to_marketing_at = nowIso();
      patch.resolved_at = nowIso();
      patch.marketing_ticket_id = spawnedId || null;
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: "Sent to marketing.", is_action_request: false,
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
      if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to || null;

    } else if (action === "edit-context") {
      if (body.context && typeof body.context === "object") {
        patch.context = { ...(ticket.context || {}), ...body.context };
      }

    } else if (action === "cancel") {
      if (!["active", "client-dependent"].includes(ticket.status)) {
        return res.status(409).json({ error: "ticket is not active" });
      }
      patch.status = "cancelled";
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: "Cancelled by client.", is_action_request: false,
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
    }

    const updated = await sb(`content_tickets?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    return res.status(200).json({ ticket: updated?.[0] || null });
  }

  return res.status(405).json({ error: "method not allowed" });
}
