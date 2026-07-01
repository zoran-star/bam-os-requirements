import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Custom Field Definitions (v1)
//
// Owner-managed custom fields per academy: the portal-native replacement for
// GHL custom fields. Backs the staff-portal "Custom Fields" screen. CRUD over
// public.custom_field_defs; values live in public.contact_field_values (edited
// elsewhere, per contact). Dormant elsewhere - nothing depends on these yet.
//
//   GET    /api/custom-fields?client_id=<uuid>
//            → { fields: [ {..def, value_count} ] }   (ordered by position)
//   POST   /api/custom-fields          body: { client_id, label, type?, options?, required? }
//            → create one field (key auto-slugged from label, unique per client)
//   PATCH  /api/custom-fields          body: { id, label?, type?, options?, required?, position?, archived? }
//   DELETE /api/custom-fields?id=<uuid>   → delete a field (cascades its values)
//
// Auth: Supabase JWT in Authorization header. Caller must be BAM staff OR a
// member of client_id (owner / teammate / scaling manager) - same as action-items.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "boolean", "phone", "email", "url"];

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

// ── Auth (same shape as action-items.js) ───────────────────────────────────
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role&limit=1`);
  }
  const staffRow = Array.isArray(staff) && staff[0];

  const ids = new Set();
  const direct = await sb(`clients?auth_user_id=eq.${user.id}&select=id`);
  (direct || []).forEach(r => ids.add(r.id));
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  (memberships || []).forEach(r => ids.add(r.client_id));
  if (staffRow) {
    const sm = await sb(`clients?scaling_manager_id=eq.${staffRow.id}&select=id`);
    (sm || []).forEach(r => ids.add(r.id));
  }
  return { user, isStaff: !!staffRow, clientIds: Array.from(ids) };
}

function canAccess(ctx, clientId) {
  return ctx.isStaff || ctx.clientIds.includes(clientId);
}

// label → stable slug key, unique per client (append -2, -3 … on collision).
function slugify(label) {
  return String(label || "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "field";
}
async function uniqueKey(clientId, label) {
  const base = slugify(label);
  const existing = await sb(`custom_field_defs?client_id=eq.${clientId}&select=key`);
  const taken = new Set((existing || []).map(r => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) { const k = `${base}_${i}`; if (!taken.has(k)) return k; }
  return `${base}_${Date.now()}`;
}

function cleanOptions(type, options) {
  if (type !== "select" && type !== "multiselect") return [];
  if (!Array.isArray(options)) return [];
  return options.map(o => String(o).trim()).filter(Boolean).slice(0, 100);
}

// ── Handler ─────────────────────────────────────────────────────────────────
async function handler(req, res) {
  try {
    const ctx = await resolveUser(req);

    // ── GET: list a client's field defs (+ value counts) ───────────────────
    if (req.method === "GET") {
      const clientId = (req.query && req.query.client_id) || null;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });

      const fields = await sb(
        `custom_field_defs?client_id=eq.${clientId}&select=*&order=position.asc,created_at.asc`
      );
      // Attach how many contacts have a value per field (one grouped read).
      const counts = {};
      const ids = (fields || []).map(f => f.id);
      if (ids.length) {
        const rows = await sb(
          `contact_field_values?field_id=in.(${ids.map(encodeURIComponent).join(",")})&select=field_id`
        );
        (rows || []).forEach(r => { counts[r.field_id] = (counts[r.field_id] || 0) + 1; });
      }
      return res.status(200).json({
        fields: (fields || []).map(f => ({ ...f, value_count: counts[f.id] || 0 })),
      });
    }

    // ── POST: create a field def ───────────────────────────────────────────
    if (req.method === "POST") {
      const b = req.body || {};
      const clientId = b.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });
      const label = (b.label || "").trim();
      if (!label) return res.status(400).json({ error: "label required" });
      const type = FIELD_TYPES.includes(b.type) ? b.type : "text";

      // Position at the end of the current list.
      const existing = await sb(`custom_field_defs?client_id=eq.${clientId}&select=position&order=position.desc&limit=1`);
      const nextPos = existing && existing[0] ? (existing[0].position || 0) + 1 : 0;
      const key = await uniqueKey(clientId, label);

      const rows = await sb(`custom_field_defs`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id: clientId, key, label, type,
          options: cleanOptions(type, b.options),
          required: b.required === true,
          position: nextPos,
        }),
      });
      const field = Array.isArray(rows) ? rows[0] : rows;
      return res.status(200).json({ field: { ...field, value_count: 0 } });
    }

    // ── PATCH: update a field def ──────────────────────────────────────────
    if (req.method === "PATCH") {
      const b = req.body || {};
      const id = b.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const existingRows = await sb(`custom_field_defs?id=eq.${id}&select=*&limit=1`);
      const existing = Array.isArray(existingRows) && existingRows[0];
      if (!existing) return res.status(404).json({ error: "not found" });
      if (!canAccess(ctx, existing.client_id)) return res.status(403).json({ error: "not your academy" });

      const patch = { updated_at: new Date().toISOString() };
      if (typeof b.label === "string") {
        if (!b.label.trim()) return res.status(400).json({ error: "label cannot be empty" });
        patch.label = b.label.trim();
      }
      const nextType = "type" in b ? (FIELD_TYPES.includes(b.type) ? b.type : existing.type) : existing.type;
      if ("type" in b) patch.type = nextType;
      if ("options" in b || "type" in b) patch.options = cleanOptions(nextType, "options" in b ? b.options : existing.options);
      if ("required" in b) patch.required = b.required === true;
      if ("archived" in b) patch.archived = b.archived === true;
      if ("position" in b && Number.isFinite(b.position)) patch.position = b.position;

      const rows = await sb(`custom_field_defs?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      const field = Array.isArray(rows) ? rows[0] : rows;
      return res.status(200).json({ field });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const existingRows = await sb(`custom_field_defs?id=eq.${id}&select=client_id&limit=1`);
      const existing = Array.isArray(existingRows) && existingRows[0];
      if (!existing) return res.status(200).json({ ok: true }); // already gone
      if (!canAccess(ctx, existing.client_id)) return res.status(403).json({ error: "not your academy" });
      await sb(`custom_field_defs?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
