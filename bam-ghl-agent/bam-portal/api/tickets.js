// Vercel Serverless Function — Tickets
// Staff (authenticated): GET/PATCH via Bearer token (Supabase access token)
// Client portal (public): GET/PATCH with ?public=1 and client_id

import { sendPush } from "./_lib/push.js";

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

async function sbPatch(path, body) {
  return sb(path, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────
// Slack client-channel notifications
// ─────────────────────────────────────────────────────────
// Mirrors postClientSlackNotification in api/marketing.js. Fire-and-forget,
// silently no-ops if SLACK_BOT_TOKEN unset or client has no slack_channel_id.
function clientPortalLink(req) {
  // Pinned to the canonical client portal domain — never derive from
  // request headers. Otherwise tickets posted via Vercel's auto-generated
  // *.vercel.app URLs leak that hostname into client-facing Slack links
  // (e.g. https://bam-portal-tawny.vercel.app/client-portal.html). Local
  // dev falls back to the request origin. Same reasoning as portalUrls()
  // in api/clients.js — see comment there.
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";
  return `${base}/client-portal.html`;
}

async function postClientSlackNotification(clientId, text, req) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return;
    if (!clientId || !text) return;
    const rows = await sb(`clients?id=eq.${clientId}&select=slack_channel_id`);
    const r = rows?.[0];
    if (!r?.slack_channel_id) return;
    const body = `${text}\n→ ${clientPortalLink(req)}`;
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
    console.error("Slack notify failed:", err?.message || err);
  }
}

async function verifyStaff(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;

  const rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  const me = Array.isArray(rows) && rows[0];
  if (!me) return null;
  const systemsRoles = ["admin", "scaling_manager", "systems_manager", "systems_executor", "systems"];
  if (!systemsRoles.includes(me.role)) return null;
  return me;
}

function isManager(me) {
  return me && (me.role === "admin" || me.role === "scaling_manager" || me.role === "systems_manager");
}

// Mirrors my_client_ids() RLS function for the public ticket API. Returns
// every client UUID the authed user can act on — covers direct owners
// (clients.auth_user_id), invited teammates (client_users), AND BAM
// staff who are set as the client's scaling_manager. Without this, the
// public API would fall back to single-client lookup via auth_user_id
// and lock scaling managers + invited members out of write actions.
async function userClientIds(userId) {
  const ids = new Set();
  const direct = await sb(`clients?auth_user_id=eq.${userId}&select=id`);
  (direct || []).forEach(r => ids.add(r.id));
  const members = await sb(`client_users?user_id=eq.${userId}&status=eq.active&select=client_id`);
  (members || []).forEach(r => ids.add(r.client_id));
  const staffRows = await sb(`staff?user_id=eq.${userId}&select=id`);
  const staffIds = (staffRows || []).map(r => r.id);
  if (staffIds.length) {
    const sm = await sb(`clients?scaling_manager_id=in.(${staffIds.join(",")})&select=id`);
    (sm || []).forEach(r => ids.add(r.id));
  }
  return Array.from(ids);
}

async function enrichTickets(tickets) {
  if (!tickets.length) return tickets;
  const clientIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))];
  const staffIds = [...new Set(
    tickets.flatMap(t => [t.assigned_to, t.delegated_by]).filter(Boolean)
  )];

  const [clients, staff] = await Promise.all([
    clientIds.length
      ? sb(`clients?id=in.(${clientIds.join(",")})&select=id,business_name`)
      : Promise.resolve([]),
    staffIds.length
      ? sb(`staff?id=in.(${staffIds.join(",")})&select=id,name,role`)
      : Promise.resolve([]),
  ]);

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));
  const staffMap = Object.fromEntries((staff || []).map(s => [s.id, s]));

  return tickets.map(t => ({
    ...t,
    client: clientMap[t.client_id] || null,
    assignee: staffMap[t.assigned_to] || null,
    delegator: staffMap[t.delegated_by] || null,
  }));
}

export default async function handler(req, res) {
  try {
    const isPublic = req.query.public === "1";

    // ─── PUBLIC (client portal) — session-based auth ────────────────
    if (isPublic) {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).json({ error: "auth required" });
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) return res.status(401).json({ error: "invalid token" });
      const user = await userRes.json();
      if (!user?.id) return res.status(401).json({ error: "invalid token" });
      // All clients this user can act on — covers owners, invited
      // teammates (client_users), and scaling managers (staff link).
      const accessibleIds = await userClientIds(user.id);
      if (!accessibleIds.length) return res.status(403).json({ error: "no linked client" });

      if (req.method === "GET") {
        // Optional ?client_id= for multi-client users; defaults to first.
        const requested = req.query.client_id;
        const clientId = requested && accessibleIds.includes(requested) ? requested : accessibleIds[0];
        const data = await sb(
          `tickets?client_id=eq.${clientId}&select=id,type,menu_item,fields,files,status,priority,client_action_request,user_guide,submitted_at,updated_at,resolved_at,messages&order=updated_at.desc`
        );
        return res.status(200).json({ data });
      }

      if (req.method === "PATCH") {
        const { id, action } = req.query;
        const body = req.body || {};
        if (!id) return res.status(400).json({ error: "id required" });
        const validActions = ["client_respond", "final_approve", "final_feedback"];
        if (!validActions.includes(action)) return res.status(400).json({ error: "invalid action" });

        const existing = await sb(`tickets?id=eq.${id}&select=id,client_id,status,messages,user_guide`);
        if (!existing?.length || !accessibleIds.includes(existing[0].client_id)) {
          return res.status(403).json({ error: "not your ticket" });
        }
        const t = existing[0];
        const now = new Date().toISOString();

        if (action === "client_respond") {
          if (t.status !== "awaiting_client") return res.status(400).json({ error: "ticket not awaiting client" });
          const newMsg = {
            direction: "client_to_staff",
            body: body.client_action_response || "",
            files: body.client_action_files || [],
            author_id: null, created_at: now,
          };
          const updated = await sbPatch(`tickets?id=eq.${id}`, {
            client_action_response: body.client_action_response || "",
            client_action_files: body.client_action_files || [],
            messages: [...(t.messages || []), newMsg],
            status: "in_progress",
            updated_at: now,
          });
          return res.status(200).json({ data: updated?.[0] });
        }

        if (action === "final_approve") {
          if (t.status !== "final_review") return res.status(400).json({ error: "ticket not in final review" });
          const newMsg = {
            direction: "client_to_staff",
            body: "(client approved final review)",
            files: [], author_id: null, system: true, created_at: now,
          };
          const updated = await sbPatch(`tickets?id=eq.${id}`, {
            messages: [...(t.messages || []), newMsg],
            status: "done",
            resolved_at: now,
            updated_at: now,
          });
          // Slack notify on the client channel — closes the loop.
          postClientSlackNotification(t.client_id,
            `✅ Client approved final review — Systems [${String(id).slice(0, 8).toUpperCase()}]`, req);
          return res.status(200).json({ data: updated?.[0] });
        }

        if (action === "final_feedback") {
          if (t.status !== "final_review") return res.status(400).json({ error: "ticket not in final review" });
          const feedback = (body.feedback || "").trim();
          if (!feedback) return res.status(400).json({ error: "feedback text required" });
          const newMsg = {
            direction: "client_to_staff",
            body: feedback,
            files: body.files || [],
            author_id: null, created_at: now,
          };
          const updated = await sbPatch(`tickets?id=eq.${id}`, {
            messages: [...(t.messages || []), newMsg],
            status: "in_progress",
            updated_at: now,
          });
          postClientSlackNotification(t.client_id,
            `🔄 Client sent feedback on final review — Systems [${String(id).slice(0, 8).toUpperCase()}]`, req);
          return res.status(200).json({ data: updated?.[0] });
        }
      }

      return res.status(405).json({ error: "method not allowed" });
    }

    // ─── STAFF (authenticated) ──────────────────────────────────────
    const me = await verifyStaff(req);
    if (!me) return res.status(401).json({ error: "unauthorized" });

    if (req.method === "GET") {
      if (req.query.resource === "staff") {
        const data = await sb(`staff?role=in.(systems_manager,systems_executor)&select=id,name,role&order=name.asc`);
        return res.status(200).json({ data });
      }
      if (req.query.id) {
        const rows = await sb(`tickets?id=eq.${req.query.id}&select=*`);
        const enriched = await enrichTickets(rows || []);
        return res.status(200).json({ data: enriched[0] || null, me });
      }
      const all = await sb(`tickets?select=*&order=submitted_at.desc`);
      const enriched = await enrichTickets(all || []);
      return res.status(200).json({ data: enriched, me });
    }

    if (req.method === "POST") {
      // Staff creates a new ticket on behalf of a client. Available to any
      // authenticated staff. Lands in 'open' status (delegation pool).
      const body = req.body || {};
      const client_id = typeof body.client_id === "string" ? body.client_id : "";
      const type      = ["error","change","build"].includes(body.type) ? body.type : "";
      const title     = typeof body.title === "string" ? body.title.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const priority  = ["standard","red_alert"].includes(body.priority) ? body.priority : "standard";

      if (!client_id) return res.status(400).json({ error: "client_id required" });
      if (!type)      return res.status(400).json({ error: "type must be error|change|build" });
      if (!description) return res.status(400).json({ error: "description required" });

      const fields = { description };
      if (title) fields.title = title;

      const inserted = await sb(`tickets`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id,
          type,
          status: "open",
          priority,
          fields,
          menu_item: type === "build" && title ? title : null,
          files: [],
          messages: [],
          submitted_at: new Date().toISOString(),
          // Tracks who created it server-side for audit
          submitted_by_staff: me.id,
        }),
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return res.status(200).json({ data: row });
    }

    if (req.method === "PATCH") {
      const { id, action } = req.query;
      if (!id || !action) return res.status(400).json({ error: "id and action required" });
      const body = req.body || {};
      const now = new Date().toISOString();

      const existing = await sb(`tickets?id=eq.${id}&select=*`);
      if (!existing?.length) return res.status(404).json({ error: "ticket not found" });
      const t = existing[0];

      let update = { updated_at: now };

      switch (action) {
        case "delegate":
          if (!isManager(me)) return res.status(403).json({ error: "manager only" });
          if (!body.assigned_to) return res.status(400).json({ error: "assigned_to required" });
          update.assigned_to = body.assigned_to;
          update.delegated_by = me.id;
          update.delegated_at = now;
          update.status = "delegated";
          break;

        case "start":
          if (t.assigned_to !== me.id && !isManager(me)) return res.status(403).json({ error: "not your ticket" });
          update.status = "in_progress";
          break;

        case "notes":
          update.staff_notes = body.staff_notes ?? t.staff_notes;
          break;

        case "save_user_guide":
          // Anyone authenticated can save the user guide. Frontend gates
          // who sees the editable textarea (managers always; executors
          // while assigned and pre-review).
          update.user_guide = body.user_guide ?? t.user_guide;
          break;

        case "request_client":
          // Any systems-team member can send a client request (assignee
          // restriction lifted). Multiple pending requests on the same
          // ticket are supported — each appends a message; status stays
          // awaiting_client until the client responds.
          update.client_action_request = body.client_action_request || "";
          update.status = "awaiting_client";
          update.messages = [
            ...(t.messages || []),
            {
              direction: "staff_to_client",
              body: body.client_action_request || "",
              files: body.files || [],
              author_id: me.id,
              created_at: now,
            },
          ];
          break;

        case "cancel_client_request":
          // Any systems-team member can cancel a pending client request
          if (t.status !== "awaiting_client") return res.status(400).json({ error: "ticket not awaiting client" });
          update.client_action_request = "";
          update.status = "in_progress";
          update.messages = [
            ...(t.messages || []),
            {
              direction: "staff_to_client",
              body: "(request cancelled by staff)",
              files: [],
              author_id: me.id,
              system: true,
              created_at: now,
            },
          ];
          break;

        case "submit_review":
          if (t.assigned_to !== me.id && !isManager(me)) return res.status(403).json({ error: "not your ticket" });
          update.user_guide = body.user_guide || "";
          update.status = "in_review";
          break;

        case "approve":
          if (!isManager(me)) return res.status(403).json({ error: "manager only" });
          update.status = "done";
          update.resolved_at = now;
          break;

        case "deny":
          if (!isManager(me)) return res.status(403).json({ error: "manager only" });
          update.denial_notes = body.denial_notes || "";
          update.status = "needs_rework";
          break;

        case "update_fields":
          // Edit the submission fields (ticket.fields jsonb). Any
          // authenticated systems staff can edit. Refuse on terminal
          // statuses so the audit trail stays clean.
          if (["done", "approved", "cancelled"].includes(t.status)) {
            return res.status(400).json({ error: "ticket is final; fields are locked" });
          }
          if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
            return res.status(400).json({ error: "fields object required" });
          }
          // Merge: start with what's there, overwrite with edits. This lets
          // the caller send only the fields that changed instead of the
          // full object.
          update.fields = { ...(t.fields || {}), ...body.fields };
          break;

        case "send_for_final_review":
          // Manager forwards an in_review ticket to the client for their
          // sign-off. Status goes to final_review (a special variant of
          // awaiting_client — same UX bucket, dedicated UI on both ends).
          if (!isManager(me)) return res.status(403).json({ error: "manager only" });
          if (t.status !== "in_review") return res.status(400).json({ error: "ticket must be in_review" });
          update.status = "final_review";
          update.messages = [
            ...(t.messages || []),
            {
              direction: "staff_to_client",
              body: "(sent to client for final review)",
              files: [], author_id: me.id, system: true, created_at: now,
            },
          ];
          break;

        case "set_due_date":
          // Admin-only override of the auto-calc'd due_date. Accepts ISO
          // YYYY-MM-DD or empty string to clear back to NULL.
          if (me.role !== "admin") return res.status(403).json({ error: "admin only" });
          if (body.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
            return res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
          }
          update.due_date = body.due_date || null;
          break;

        case "cancel_ticket":
          // Hard-cancel the whole ticket. Any authenticated systems staff
          // can do this, at any non-final status. Done/approved/cancelled
          // are terminal — refuse to re-cancel.
          if (["done", "approved", "cancelled"].includes(t.status)) {
            return res.status(400).json({ error: "ticket is already final and cannot be cancelled" });
          }
          update.status = "cancelled";
          update.resolved_at = now;
          // If staff provided a reason, append it as a system message so the
          // audit trail captures why. Empty reason is fine.
          if (body.reason && String(body.reason).trim()) {
            update.messages = [
              ...(t.messages || []),
              {
                direction: "staff_to_client",
                body: `(ticket cancelled by staff)${body.reason ? ` — ${String(body.reason).trim()}` : ""}`,
                files: [],
                author_id: me.id,
                system: true,
                created_at: now,
              },
            ];
          }
          break;

        default:
          return res.status(400).json({ error: "invalid action" });
      }

      const updated = await sbPatch(`tickets?id=eq.${id}`, update);
      const enriched = await enrichTickets(updated || []);

      // Slack notify (fire-and-forget) on client-facing actions only.
      // Uniform template: {emoji} {Action} — {Type} [{CODE}] + optional body.
      const code = String(t.id || "").slice(0, 3).toUpperCase();
      // Native push mirrors the Slack notify, but only for the actions a
      // client actually needs to act on (skip the withdrawn-request notice).
      // Fire-and-forget; sendPush no-ops safely if no devices / keys unset.
      const pushClient = (title, pbody) =>
        sendPush({ client_id: t.client_id, title, body: pbody, data: { ticket_id: String(t.id), type: t.type || "" } })
          .catch((e) => console.warn("push failed:", e?.message));
      if (action === "request_client") {
        const ask = (body.client_action_request || "").trim();
        postClientSlackNotification(t.client_id,
          `🔔 Action requested — Systems [${code}]${ask ? `\n_${ask}_` : ""}`, req);
        pushClient("BAM needs your input", ask || "Open the portal to respond to a request.");
      } else if (action === "cancel_client_request") {
        postClientSlackNotification(t.client_id,
          `↩️ Request withdrawn — Systems [${code}]`, req);
      } else if (action === "approve") {
        postClientSlackNotification(t.client_id,
          `✅ Completed — Systems [${code}]`, req);
        pushClient("Your request is complete ✅", "BAM finished work on your ticket.");
      } else if (action === "send_for_final_review") {
        postClientSlackNotification(t.client_id,
          `🟢 Final review ready — Systems [${code}]\n_Open the portal to approve or send feedback._`, req);
        pushClient("Ready for your review", "A ticket is ready for your approval in the portal.");
      }

      return res.status(200).json({ data: enriched[0] });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("tickets api error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
