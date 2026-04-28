// Vercel Serverless Function — Tickets
// Staff (authenticated): GET/PATCH via Bearer token (Supabase access token)
// Client portal (public): GET/PATCH with ?public=1 and client_id

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
  const systemsRoles = ["admin", "systems_manager", "systems_executor", "systems"];
  if (!systemsRoles.includes(me.role)) return null;
  return me;
}

function isManager(me) {
  return me && (me.role === "admin" || me.role === "systems_manager");
}

async function enrichTickets(tickets) {
  if (!tickets.length) return tickets;
  const clientIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))];
  const staffIds = [...new Set(
    tickets.flatMap(t => [t.assigned_to, t.delegated_by]).filter(Boolean)
  )];

  const [clients, staff] = await Promise.all([
    clientIds.length
      ? sb(`clients?id=in.(${clientIds.join(",")})&select=id,name`)
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
      // Resolve client_id from the authed Supabase user
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).json({ error: "auth required" });
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) return res.status(401).json({ error: "invalid token" });
      const user = await userRes.json();
      if (!user?.id) return res.status(401).json({ error: "invalid token" });
      const clientRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id`);
      const clientId = clientRows?.[0]?.id;
      if (!clientId) return res.status(403).json({ error: "no linked client" });

      if (req.method === "GET") {
        const data = await sb(
          `tickets?client_id=eq.${clientId}&select=id,type,menu_item,fields,files,status,priority,client_action_request,user_guide,submitted_at,updated_at,resolved_at,messages&order=updated_at.desc`
        );
        return res.status(200).json({ data });
      }

      if (req.method === "PATCH") {
        const { id, action } = req.query;
        const body = req.body || {};
        if (action !== "client_respond") return res.status(400).json({ error: "invalid action" });
        if (!id) return res.status(400).json({ error: "id required" });

        const existing = await sb(`tickets?id=eq.${id}&select=id,client_id,status,messages`);
        if (!existing?.length || existing[0].client_id !== clientId) {
          return res.status(403).json({ error: "not your ticket" });
        }
        if (existing[0].status !== "awaiting_client") {
          return res.status(400).json({ error: "ticket not awaiting client" });
        }

        const newMsg = {
          direction: "client_to_staff",
          body: body.client_action_response || "",
          files: body.client_action_files || [],
          author_id: null,
          created_at: new Date().toISOString(),
        };
        const messages = [...(existing[0].messages || []), newMsg];

        const updated = await sbPatch(`tickets?id=eq.${id}`, {
          client_action_response: body.client_action_response || "",
          client_action_files: body.client_action_files || [],
          messages,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        });
        return res.status(200).json({ data: updated?.[0] });
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

        default:
          return res.status(400).json({ error: "invalid action" });
      }

      const updated = await sbPatch(`tickets?id=eq.${id}`, update);
      const enriched = await enrichTickets(updated || []);
      return res.status(200).json({ data: enriched[0] });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("tickets api error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
