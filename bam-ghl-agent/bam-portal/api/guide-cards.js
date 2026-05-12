// Vercel Serverless Function — Guide Cards
//
// Routes (single file, branches on method + query):
//   GET    /api/guide-cards               → list all guide cards (any authenticated user)
//   GET    /api/guide-cards?id=<uuid>     → one card
//   POST   /api/guide-cards               → create (admin + marketing staff)
//                                            body: { title, purpose?, filming_tips?, example_script?, example_assets?, example_links? }
//   PATCH  /api/guide-cards?id=<uuid>     → update (admin + marketing staff)
//                                            body: { fields to update }
//   DELETE /api/guide-cards?id=<uuid>     → delete (admin + marketing staff)
//
// Auth:
//   - Header: Authorization: Bearer <supabase access token>
//   - Read: any authenticated user (clients need to fetch these for the wizard).
//   - Write: admin / marketing / marketing_manager / marketing_executor only.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const WRITE_ROLES = new Set(["admin", "marketing", "marketing_manager", "marketing_executor"]);

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

function canWrite(staff) {
  return staff && WRITE_ROLES.has(staff.role);
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    const ctx = await resolveUser(req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    if (!ctx.staff && !ctx.client) {
      return res.status(403).json({ error: "user is neither staff nor a linked client" });
    }

    // ─── GET ─────────────────────────────────────────────────────
    if (req.method === "GET") {
      if (id) {
        const rows = await sb(`guide_cards?id=eq.${id}&select=*`);
        if (!rows?.[0]) return res.status(404).json({ error: "not found" });
        return res.status(200).json({ card: rows[0] });
      }
      const cards = await sb(`guide_cards?select=*&order=title.asc`);
      return res.status(200).json({ cards: cards || [] });
    }

    // ─── Write actions require staff role ────────────────────────
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      if (!canWrite(ctx.staff)) {
        return res.status(403).json({ error: "admin or marketing role required" });
      }
    }

    // ─── POST (create) ───────────────────────────────────────────
    if (req.method === "POST") {
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const title = (body.title || "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });

      // Reject duplicate titles
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

    // ─── PATCH (update) ──────────────────────────────────────────
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

    // ─── DELETE ──────────────────────────────────────────────────
    if (req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id query param is required" });
      await sb(`guide_cards?id=eq.${id}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "internal error" });
  }
}
