import crypto from "node:crypto";

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
const GUIDE_WRITE_ROLES = new Set(["admin", "marketing_manager", "marketing_executor"]);

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

// ─────────────────────────────────────────────────────────
// Slack client-channel notifications
// ─────────────────────────────────────────────────────────
// Posts to the client's dedicated Slack channel via the BAM Portal
// bot token. Fire-and-forget — never blocks the API response. Quietly
// no-ops if the client doesn't have slack_channel_id set or the bot
// token is missing.
function clientPortalLinkForTicket(req, kind, ticketId) {
  const origin = (req.headers["x-forwarded-host"] && `https://${req.headers["x-forwarded-host"]}`)
    || (req.headers.origin)
    || `https://${req.headers.host}`;
  // We don't have deep-links to a specific ticket yet — Marketing tab on
  // the client portal is the right landing for now.
  return `${origin}/client-portal.html`;
}

async function postClientSlackNotification(clientId, text, req) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return; // not configured — silent skip
    if (!clientId || !text) return;
    const rows = await sb(`clients?id=eq.${clientId}&select=slack_channel_id,name`);
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
    if (resource === "meta-auth") {
      return handleMetaAuth(req, res);
    }
    if (resource === "meta-adaccounts") {
      return handleMetaAdAccounts(req, res);
    }
    if (resource === "meta-campaigns") {
      return handleMetaCampaigns(req, res);
    }
    if (resource === "meta-creatives") {
      return handleMetaCreatives(req, res);
    }
    if (resource === "meta-staff-auth") {
      return handleStaffMetaAuth(req, res);
    }
    if (resource === "meta-staff-status") {
      return handleStaffMetaStatus(req, res);
    }
    if (resource === "onboarding") {
      return handleOnboarding(req, res);
    }
    return res.status(400).json({ error: "missing or invalid ?resource= (expected 'tickets' | 'guide-cards' | 'content-tickets' | 'meta-auth' | 'meta-adaccounts' | 'meta-campaigns' | 'meta-creatives' | 'meta-staff-auth' | 'meta-staff-status' | 'onboarding')" });
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
      patch.messages = appendMessage(ticket.messages, {
        author_type: "client", author_name: authorName,
        body: message, is_action_request: false,
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

      const contentInsert = await sb("content_tickets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          client_id: ticket.client_id,
          type: revisionType,
          status: "active",
          client_action_status: "none",
          notes: newContextNotes,
          raw_files: ticket.files || [],
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
            created_at: nowIso(),
          }],
        }]),
      });

      patch.awaiting_revision = true;
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: `Sent back to content for revision: "${message}". Tracking content ticket ${contentInsert?.[0]?.id || ""}.`,
        is_action_request: false,
      });
    }

    const updated = await sb(`marketing_tickets?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });

    // Slack notify (fire-and-forget) on action-request or completion.
    // We don't await — keeps the API snappy and Slack errors don't break us.
    if (action === "request-client-action") {
      const ask = (body.message || "").trim();
      postClientSlackNotification(ticket.client_id,
        `🔔 *Action requested* by ${authorName}\n_${ask}_`, req);
    } else if (action === "mark-completed") {
      postClientSlackNotification(ticket.client_id,
        `✅ Marketing ticket completed by ${authorName}`, req);
    }

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
    const clientActions = new Set(["cancel", "respond", "edit"]);

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
      });

    } else if (action === "send-to-marketing") {
      // 1. Validate
      if (!ticket.final_files || !ticket.final_files.length) {
        return res.status(409).json({ error: "upload at least one final creative before sending to marketing" });
      }

      const marketingNotes = (body.marketing_notes || "").trim();
      const ctxObj = ticket.context || {};
      const source = ctxObj.source || "add-creative";

      // 2. Are we updating an existing marketing ticket (revision round-trip) or inserting?
      const linkedMarketingId = ticket.marketing_ticket_id || null;

      if (linkedMarketingId) {
        // ── Revision round-trip — UPDATE the original marketing ticket ──
        // Pull current to merge messages cleanly
        const cur = await sb(`marketing_tickets?id=eq.${linkedMarketingId}&select=*`);
        const orig = cur?.[0];
        if (orig) {
          const newMessages = appendMessage(orig.messages, {
            author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
            body: marketingNotes
              ? `Revision uploaded. Notes for marketing: "${marketingNotes}"`
              : "Revision uploaded by content team.",
            is_action_request: false,
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
        patch.marketing_ticket_id = linkedMarketingId;
      } else {
        // ── Fresh spawn — INSERT a new marketing ticket ──
        const mktType =
          source === "new-campaign" ? "campaign-create" :
          source === "change-campaign" || source === "add-creative" ? "add" :
          "add";

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

        // Pass client's original notes through so the marketing team
        // sees what the client actually said (not just what content retyped).
        const clientNotesRaw = (ticket.notes || "").trim();
        if (clientNotesRaw) {
          mktFields.client_notes = clientNotesRaw;
        }

        const initialMessage = {
          author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
          body: marketingNotes
            ? `Sent from content ticket (${ticket.type}). Notes for marketing: "${marketingNotes}"`
            : `Sent from content ticket (${ticket.type}).`,
          is_action_request: false,
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
          }]),
        });
        patch.marketing_ticket_id = marketingInsert?.[0]?.id || null;
      }

      patch.status = "completed";
      patch.sent_to_marketing_at = nowIso();
      patch.resolved_at = nowIso();
      patch.messages = appendMessage(ticket.messages, {
        author_type: "staff", author_id: ctx.staff.id, author_name: authorName,
        body: marketingNotes
          ? `Sent to marketing. Notes: "${marketingNotes}"`
          : "Sent to marketing.",
        is_action_request: false,
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

    // Slack notify on action-request or completion (fire-and-forget)
    if (action === "request-client-action") {
      const ask = (body.message || "").trim();
      postClientSlackNotification(ticket.client_id,
        `🔔 *Action requested* by ${authorName} (content team)\n_${ask}_`, req);
    } else if (action === "mark-completed") {
      postClientSlackNotification(ticket.client_id,
        `✅ Content ticket completed by ${authorName}`, req);
    }

    return res.status(200).json({ ticket: updated?.[0] || null });
  }

  return res.status(405).json({ error: "method not allowed" });
}

// ─────────────────────────────────────────────────────────
// META OAUTH + API
// ─────────────────────────────────────────────────────────
// Client (academy owner) connects their own Meta ad account.
// Token stored in client_meta_tokens, scoped via RLS to that client.

const META_API_VERSION = "v22.0";
const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
const META_OAUTH_SCOPES = ["ads_read", "public_profile"];

function metaGetOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function metaRedirectUri(req) {
  return `${metaGetOrigin(req)}/api/auth/meta/callback`;
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

function metaRedirect(res, status, msg) {
  const params = new URLSearchParams({ meta: status });
  if (msg) params.set("msg", msg);
  res.setHeader("Location", `/client-portal.html?${params.toString()}`);
  return res.status(302).end();
}

async function handleMetaAuth(req, res) {
  const step = req.query.step;

  // step = prepare: POST, authenticated client, returns Facebook OAuth URL
  if (step === "prepare") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const ctx = await resolveUser(req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    if (!ctx.client) return res.status(403).json({ error: "client only" });

    const appId = process.env.META_APP_ID;
    if (!appId) return res.status(500).json({ error: "META_APP_ID not configured" });

    const state = metaSignState({
      client_id: ctx.client.id,
      exp: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomBytes(8).toString("hex"),
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: metaRedirectUri(req),
      scope: META_OAUTH_SCOPES.join(","),
      response_type: "code",
      state,
    });

    return res.status(200).json({
      redirect_url: `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`,
    });
  }

  // step = callback: GET from Facebook with ?code + ?state; exchange + store + redirect.
  if (step === "callback") {
    if (req.method !== "GET") return res.status(405).end();

    const { code, state, error: fbError, error_description } = req.query;
    if (fbError) return metaRedirect(res, "error", error_description || String(fbError));
    if (!code || !state) return metaRedirect(res, "error", "missing code or state");

    let payload;
    try { payload = metaVerifyState(state); }
    catch (e) { return metaRedirect(res, "error", `state: ${e.message}`); }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return metaRedirect(res, "error", "Meta app not configured");

    const shortUrl = `${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: metaRedirectUri(req),
      code,
    });
    const shortRes = await fetch(shortUrl);
    const shortJson = await shortRes.json();
    if (!shortRes.ok || !shortJson.access_token) {
      return metaRedirect(res, "error", shortJson?.error?.message || "token exchange failed");
    }

    const longUrl = `${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortJson.access_token,
    });
    const longRes = await fetch(longUrl);
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
      return metaRedirect(res, "error", me?.error?.message || "could not fetch FB user");
    }

    await sb(`client_meta_tokens?on_conflict=client_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        client_id: payload.client_id,
        fb_user_id: me.id,
        fb_user_name: me.name || null,
        access_token: accessToken,
        expires_at: expiresAt,
        scopes: META_OAUTH_SCOPES,
        updated_at: nowIso(),
      }]),
    });

    return metaRedirect(res, "connected");
  }

  return res.status(400).json({ error: "unknown step (expected 'prepare' or 'callback')" });
}

// Staff-side ad account picker. Lists ad accounts the LOGGED-IN STAFF has
// access to (via user-role or BAM-BM partner connections). Used by the staff
// portal when assigning a meta_ad_account_id to a specific client.
//
// POST also accepts client_id+ad_account_id to wire a client's ad account
// without that client ever logging into Facebook.
//
// Restricted to admin + marketing roles (the people who actually wire up ads).
const META_OPS_ROLES = new Set(["admin", "marketing_manager", "marketing_executor"]);
async function handleMetaAdAccounts(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff) return res.status(403).json({ error: "staff only" });
  if (!META_OPS_ROLES.has(ctx.staff.role)) {
    return res.status(403).json({ error: "admin or marketing role required" });
  }

  // POST → set a client's chosen ad account (staff assigning on behalf of client)
  // Optionally also accepts campaign_ids[] to filter what the client sees
  // when wired to a SHARED ad account (e.g. BAM's "all academies" account).
  if (req.method === "POST") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const targetClientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
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

  // GET → list every ad account accessible to the team's Meta connection.
  // First tries the LOGGED-IN staff's own token; falls back to any valid
  // team token (most-recently-updated). This way any admin/marketing role
  // can use Client Setup without needing to connect Meta personally — they
  // share Ximena's (or whoever connected) token for read-only ad account
  // browsing.
  let tok = null;
  let usingOwnToken = false;
  const ownTokRows = await sb(`staff_meta_tokens?staff_user_id=eq.${ctx.user.id}&select=access_token,expires_at,fb_user_name`);
  if (ownTokRows?.[0]) {
    tok = ownTokRows[0];
    usingOwnToken = true;
  } else {
    // Fall back to any team token (most recent)
    const teamRows = await sb(`staff_meta_tokens?select=access_token,expires_at,fb_user_name&order=updated_at.desc&limit=1`);
    if (teamRows?.[0]) tok = teamRows[0];
  }
  if (!tok) return res.status(404).json({ error: "Meta not connected. Connect your Meta on the staff portal first." });

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
  let targetClientId = null;
  if (ctx.client) targetClientId = ctx.client.id;
  else if (ctx.staff && req.query.client_id) targetClientId = String(req.query.client_id);
  if (!targetClientId) return res.status(403).json({ error: "client_id required (client login or staff with ?client_id)" });

  const clientRows = await sb(`clients?id=eq.${targetClientId}&select=id,meta_ad_account_id,meta_campaign_ids`);
  const clientFull = clientRows?.[0];
  if (!clientFull?.meta_ad_account_id) {
    return res.status(200).json({ campaigns: [], reason: "no_ad_account" });
  }

  // Use any valid staff token (BAM is partner-connected; one token covers all clients).
  const staffToken = await getAnyStaffMetaToken();
  if (!staffToken) return res.status(200).json({ campaigns: [], reason: "no_staff_token" });
  const tok = { access_token: staffToken };

  const adAcct = clientFull.meta_ad_account_id.startsWith("act_")
    ? clientFull.meta_ad_account_id
    : `act_${clientFull.meta_ad_account_id}`;

  // Only return campaigns that are actually running. effective_status
  // covers nuances like CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED — we want
  // strictly ACTIVE (delivering ads right now).
  const cRes = await fetch(`${META_GRAPH}/${adAcct}/campaigns?` + new URLSearchParams({
    fields: "id,name,status,effective_status,objective,insights.date_preset(last_30d){spend,actions,cost_per_action_type,results}",
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
    };
  });

  // Filter: if meta_campaign_ids is set on the client, only return those.
  // staff_picker=1 mode bypasses this filter so staff can pick from all.
  let filtered = campaigns;
  const associated = Array.isArray(clientFull.meta_campaign_ids) ? clientFull.meta_campaign_ids : null;
  if (!isStaffPicker && associated && associated.length) {
    const allow = new Set(associated);
    filtered = campaigns.filter(c => allow.has(c.id));
  }

  return res.status(200).json({
    campaigns: filtered,
    // Only echo the filter list to staff (clients don't need to know about it)
    ...(isStaffPicker ? { meta_campaign_ids: associated || [] } : {}),
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
async function handleStaffMetaStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
  if (!ctx.staff) return res.status(403).json({ error: "staff only" });

  // Logged-in staff's own connection
  const ownRows = await sb(`staff_meta_tokens?staff_user_id=eq.${ctx.user.id}&select=fb_user_name,expires_at,created_at,updated_at`);
  const own = ownRows?.[0];

  // Team-wide connection (anyone on staff connected — token shared for read ops)
  const teamRows = await sb(`staff_meta_tokens?select=fb_user_name,updated_at&order=updated_at.desc&limit=1`);
  const team = teamRows?.[0];

  return res.status(200).json({
    connected: !!own,
    fb_user_name: own?.fb_user_name || null,
    expires_at: own?.expires_at || null,
    connected_at: own?.created_at || null,
    updated_at: own?.updated_at || null,
    team_connected: !!team,
    team_fb_user_name: team?.fb_user_name || null,
  });
}
