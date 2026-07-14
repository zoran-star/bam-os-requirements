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
const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

const FIELD_TYPES = ["text", "number", "date", "select", "multiselect", "boolean", "phone", "email", "url"];

// GHL customField dataType → our field type.
function mapGhlType(dataType) {
  switch (String(dataType || "").toUpperCase()) {
    case "NUMERICAL": case "MONETARY": return "number";
    case "DATE": return "date";
    case "PHONE": return "phone";
    case "EMAIL": return "email";
    case "SINGLE_OPTIONS": case "RADIO": return "select";
    case "MULTIPLE_OPTIONS": case "CHECKBOX": return "multiselect";
    default: return "text"; // TEXT, LARGE_TEXT, TEXTBOX_LIST, FILE_UPLOAD, …
  }
}

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

// Resolve a contacts row by portal uuid, or by (client_id, ghl_contact_id).
async function resolveContact(contactId, clientId, ghlContactId) {
  if (contactId) {
    const r = await sb(`contacts?id=eq.${encodeURIComponent(contactId)}&select=id,client_id&limit=1`);
    return (r && r[0]) || null;
  }
  if (clientId && ghlContactId) {
    const r = await sb(`contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=id,client_id&limit=1`);
    return (r && r[0]) || null;
  }
  return null;
}

// ── GHL (read the academy's live custom-field definitions) ─────────────────
async function ghlGet(path, token) {
  const r = await fetch(`${GHL_V2}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" } });
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = {}; }
  if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || `GHL ${r.status}`), { status: r.status });
  return j;
}

// Refresh-aware GHL token for a client (same pattern as contact-detail.js).
async function getGhlToken(client) {
  if (!client.ghl_access_token) throw Object.assign(new Error("academy not connected to GHL"), { status: 400 });
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000 || !client.ghl_refresh_token) return client.ghl_access_token;
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) return client.ghl_access_token;
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }),
  });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) return client.ghl_access_token;
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }),
  });
  return tok.access_token;
}

// The academy's GHL custom-field defs, mapped to our shape + flagged with
// whether we've already imported each (by ghl_field_id).
async function fetchGhlFields(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = rows && rows[0];
  if (!client) throw Object.assign(new Error("academy not found"), { status: 404 });
  if (!client.ghl_location_id) throw Object.assign(new Error("academy has no GHL location"), { status: 400 });
  const token = await getGhlToken(client);
  const defs = (await ghlGet(`/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, token)).customFields || [];
  const already = await sb(`custom_field_defs?client_id=eq.${clientId}&ghl_field_id=not.is.null&select=ghl_field_id`);
  const importedIds = new Set((already || []).map(r => r.ghl_field_id));
  return defs
    .filter(f => f && f.id)
    .map(f => ({
      ghl_field_id: f.id,
      name: f.name || f.fieldKey || "Untitled field",
      type: mapGhlType(f.dataType),
      options: Array.isArray(f.picklistOptions) ? f.picklistOptions.map(String).filter(Boolean)
             : Array.isArray(f.options) ? f.options.map(o => String(o?.name ?? o)).filter(Boolean) : [],
      imported: importedIds.has(f.id),
    }));
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

    // ── GET ?action=values: a contact's field defs + current values ────────
    // Accepts contact_id (portal uuid) OR client_id + ghl_contact_id. Optional
    // member_id: athlete-specific answers in member_field_values OVERLAY the
    // contact-level values (so siblings under one parent show their own data).
    if (req.method === "GET" && req.query && req.query.action === "values") {
      const contact = await resolveContact(req.query.contact_id, req.query.client_id, req.query.ghl_contact_id);
      if (!contact) return res.status(200).json({ contact_id: null, fields: [] });
      if (!canAccess(ctx, contact.client_id)) return res.status(403).json({ error: "not your academy" });
      // Role-scoped view: a LEAD's drawer asks for section=sales, a MEMBER's for
      // section=onboarding. Academy-level fields (offer_id null) always show;
      // offer fields show only for the matching role. No section = every field
      // (back-compat). offer_id filters further to one offer's fields.
      const section = (req.query.section === "sales" || req.query.section === "onboarding") ? req.query.section : null;
      let defsFilter = `custom_field_defs?client_id=eq.${contact.client_id}&archived=eq.false`;
      if (section) defsFilter += `&or=(offer_id.is.null,section.eq.${section})`;
      if (req.query.offer_id) defsFilter += `&or=(offer_id.is.null,offer_id.eq.${encodeURIComponent(req.query.offer_id)})`;
      const defs = await sb(`${defsFilter}&select=*&order=position.asc,created_at.asc`);
      const vals = await sb(`contact_field_values?contact_id=eq.${contact.id}&select=field_id,value`);
      const vmap = new Map((vals || []).map(v => [v.field_id, v.value]));
      const memberId = req.query.member_id ? String(req.query.member_id) : null;
      if (memberId) {
        const mvals = await sb(`member_field_values?member_id=eq.${encodeURIComponent(memberId)}&select=field_id,value`).catch(() => []);
        for (const v of (mvals || [])) vmap.set(v.field_id, v.value); // member value wins
      }
      return res.status(200).json({
        contact_id: contact.id, member_id: memberId,
        fields: (defs || []).map(d => ({ ...d, value: vmap.has(d.id) ? vmap.get(d.id) : null })),
      });
    }

    // ── POST ?action=set-value: upsert (or clear) one value ────────────────
    // With member_id -> writes member_field_values (per-athlete). Without ->
    // contact_field_values (parent-level, unchanged).
    if (req.method === "POST" && (req.body || {}).action === "set-value") {
      const b = req.body || {};
      if (!b.contact_id || !b.field_id) return res.status(400).json({ error: "contact_id and field_id required" });
      const contact = await resolveContact(b.contact_id);
      if (!contact) return res.status(404).json({ error: "contact not found" });
      if (!canAccess(ctx, contact.client_id)) return res.status(403).json({ error: "not your academy" });
      const def = await sb(`custom_field_defs?id=eq.${b.field_id}&client_id=eq.${contact.client_id}&select=id&limit=1`);
      if (!def || !def[0]) return res.status(400).json({ error: "field not on this academy" });

      const memberId = b.member_id ? String(b.member_id) : null;
      if (memberId) {
        const mrows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&client_id=eq.${contact.client_id}&select=id&limit=1`).catch(() => []);
        if (!mrows || !mrows[0]) return res.status(400).json({ error: "member not on this academy" });
      }
      const table = memberId ? "member_field_values" : "contact_field_values";
      const keyCol = memberId ? "member_id" : "contact_id";
      const keyVal = memberId ? memberId : contact.id;

      const v = b.value;
      const isEmpty = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
      if (isEmpty) {
        await sb(`${table}?${keyCol}=eq.${encodeURIComponent(keyVal)}&field_id=eq.${b.field_id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return res.status(200).json({ ok: true, cleared: true });
      }
      await sb(`${table}?on_conflict=${keyCol},field_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ [keyCol]: keyVal, field_id: b.field_id, value: v, updated_at: new Date().toISOString() }]),
      });
      return res.status(200).json({ ok: true });
    }

    // ── GET ?action=ghl-fields: the academy's live GHL custom fields ───────
    if (req.method === "GET" && req.query && req.query.action === "ghl-fields") {
      const clientId = req.query.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });
      const fields = await fetchGhlFields(clientId);
      return res.status(200).json({ fields });
    }

    // ── GET: list a client's field defs (+ value counts) ───────────────────
    if (req.method === "GET") {
      const clientId = (req.query && req.query.client_id) || null;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });

      // Optional filters: offer_id (wizard scopes to one offer) + section.
      // Multi-offer: a field authored on another offer can ALSO apply here via
      // custom_field_def_offers - fold those ids into the offer match. Degrades
      // to offer_id-only if the join table has not been migrated yet.
      let filter = `custom_field_defs?client_id=eq.${clientId}`;
      const wizardRead = !!req.query.offer_id || req.query.scope === "academy";
      if (req.query.offer_id) {
        const oid = encodeURIComponent(req.query.offer_id);
        let alsoIds = [];
        try {
          const links = await sb(`custom_field_def_offers?offer_id=eq.${oid}&select=field_id`);
          alsoIds = [...new Set((links || []).map(l => l.field_id).filter(Boolean))];
        } catch (e) { console.error("custom_field_def_offers read non-fatal:", e?.message || e); }
        filter += alsoIds.length
          ? `&or=(offer_id.eq.${oid},id.in.(${alsoIds.map(encodeURIComponent).join(",")}))`
          : `&offer_id=eq.${oid}`;
      } else if (req.query.scope === "academy") filter += `&offer_id=is.null`;
      if (req.query.section) filter += `&section=eq.${encodeURIComponent(req.query.section)}`;
      // Wizard reads never want archived fields; the staff tab (no scope) shows them dimmed.
      if (wizardRead) filter += `&archived=eq.false`;
      const fields = await sb(`${filter}&select=*&order=position.asc,created_at.asc`);
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

    // ── POST ?action=import-ghl: adopt selected GHL fields as defs ─────────
    if (req.method === "POST" && (req.body || {}).action === "import-ghl") {
      const b = req.body || {};
      const clientId = b.client_id;
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!canAccess(ctx, clientId)) return res.status(403).json({ error: "not your academy" });
      const want = Array.isArray(b.fields) ? b.fields.filter(f => f && f.ghl_field_id) : [];
      if (!want.length) return res.status(400).json({ error: "no fields selected" });

      // Skip any already imported (partial unique index on ghl_field_id).
      const already = await sb(`custom_field_defs?client_id=eq.${clientId}&ghl_field_id=not.is.null&select=ghl_field_id`);
      const importedIds = new Set((already || []).map(r => r.ghl_field_id));
      const posRow = await sb(`custom_field_defs?client_id=eq.${clientId}&select=position&order=position.desc&limit=1`);
      let pos = posRow && posRow[0] ? (posRow[0].position || 0) + 1 : 0;

      const toInsert = [];
      for (const f of want) {
        if (importedIds.has(f.ghl_field_id)) continue;
        const label = (f.name || "").trim() || "Imported field";
        const type = FIELD_TYPES.includes(f.type) ? f.type : "text";
        toInsert.push({
          client_id: clientId, key: await uniqueKey(clientId, label), label, type,
          options: cleanOptions(type, f.options), required: false,
          position: pos++, ghl_field_id: f.ghl_field_id,
        });
      }
      if (!toInsert.length) return res.status(200).json({ imported: 0, fields: [] });
      const rows = await sb(`custom_field_defs`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify(toInsert),
      });
      const created = (Array.isArray(rows) ? rows : [rows]).map(f => ({ ...f, value_count: 0 }));

      // Fold each contact's existing GHL blob values onto the newly-bridged
      // fields (contacts.custom_fields -> contact_field_values). Best-effort:
      // the fields are imported even if the value fold hiccups.
      let folded = 0;
      try {
        const r = await sb(`rpc/fold_custom_field_values`, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ p_client_id: clientId }),
        });
        folded = typeof r === "number" ? r : (Array.isArray(r) ? r[0] : 0) || 0;
      } catch (e) { console.error("fold_custom_field_values non-fatal:", e?.message || e); }

      return res.status(200).json({ imported: created.length, folded, fields: created });
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

      // Optional offer + section scope (authored in the offer wizard).
      const offerId = b.offer_id || null;
      const section = (b.section === "sales" || b.section === "onboarding") ? b.section : null;

      // Position at the end of the current scope's list.
      let posFilter = `custom_field_defs?client_id=eq.${clientId}`;
      posFilter += offerId ? `&offer_id=eq.${encodeURIComponent(offerId)}` : `&offer_id=is.null`;
      if (section) posFilter += `&section=eq.${section}`;
      const existing = await sb(`${posFilter}&select=position&order=position.desc&limit=1`);
      const nextPos = existing && existing[0] ? (existing[0].position || 0) + 1 : 0;
      const key = await uniqueKey(clientId, label);

      const rows = await sb(`custom_field_defs`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_id: clientId, key, label, type,
          options: cleanOptions(type, b.options),
          required: b.required === true,
          help_text: (typeof b.help_text === "string" && b.help_text.trim()) ? b.help_text.trim() : null,
          position: nextPos,
          offer_id: offerId, section,
        }),
      });
      const field = Array.isArray(rows) ? rows[0] : rows;

      // Multi-offer: a field can also apply to other offers (custom_field_def_offers).
      // The authoring offer_id anchors it; also_offer_ids adds the rest. Degrades
      // to a no-op if the join table has not been migrated yet.
      const alsoOffers = Array.isArray(b.also_offer_ids) ? [...new Set(b.also_offer_ids.filter(Boolean))] : [];
      const joinOffers = [...new Set([offerId, ...alsoOffers].filter(Boolean))];
      if (field && field.id && joinOffers.length) {
        try {
          await sb(`custom_field_def_offers?on_conflict=field_id,offer_id`, {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
            body: JSON.stringify(joinOffers.map(oid => ({ field_id: field.id, offer_id: oid }))),
          });
        } catch (e) { console.error("custom_field_def_offers write non-fatal:", e?.message || e); }
      }
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
      if ("help_text" in b) patch.help_text = (typeof b.help_text === "string" && b.help_text.trim()) ? b.help_text.trim() : null;
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
