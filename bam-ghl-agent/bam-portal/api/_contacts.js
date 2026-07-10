// Portal-native contacts store - dual-write helper (Contacts effort, P3b).
//
// DORMANT-SAFE: every function here only writes public.contacts (which nothing
// reads yet) and NEVER calls GHL, so wiring these into live flows cannot change
// existing behavior. Each function is best-effort - it swallows its own errors
// and returns null (or nothing), so a contacts-mirror hiccup can never break a
// lead capture, a signup, or the sync cron. Keys on (client_id, ghl_contact_id),
// the same bridge every other table uses, so upserts are idempotent.

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

// Drop keys whose value would clobber good data with nothing (null / "" / [] / {}).
// Keeps booleans (incl. false) and real values, so a sparse caller that omits a
// field never nulls an existing name/email under merge-duplicates.
function clean(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

async function post(path, body, prefer) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// athlete_name at write time (Zoran 2026-07-10): portal-native contacts never
// pass through the GHL contact sync, so cards like Mike Boam's showed no athlete
// even though the name sat in custom_fields. Whenever a write carries
// custom_fields without an athlete_name, resolve it from the academy's mapped
// field ids (v15_config.athlete_name_field_ids, first non-empty wins - the same
// precedence as cron-sync-contacts). Best-effort: never blocks a write.
const _athleteFieldsCache = new Map();   // clientId -> string[] (process lifetime)
async function athleteFieldIds(clientId) {
  if (_athleteFieldsCache.has(clientId)) return _athleteFieldsCache.get(clientId);
  let ids = [];
  try {
    const r = await get(`clients?id=eq.${encodeURIComponent(clientId)}&select=v15_config&limit=1`);
    const v = Array.isArray(r) && r[0] && r[0].v15_config;
    if (v && Array.isArray(v.athlete_name_field_ids)) ids = v.athlete_name_field_ids.map(String);
  } catch (_) { return ids; /* don't cache a lookup blip */ }
  _athleteFieldsCache.set(clientId, ids);
  return ids;
}
async function withAthleteName(clientId, fields) {
  try {
    const cf = fields && fields.custom_fields;
    if (!cf || typeof cf !== "object" || Array.isArray(cf)) return fields;
    if (fields.athlete_name && String(fields.athlete_name).trim()) return fields;
    for (const fid of await athleteFieldIds(clientId)) {
      const v = cf[fid];
      if (v != null && String(v).trim()) return { ...fields, athlete_name: String(v).trim() };
    }
  } catch (_) { /* name resolution is a nicety - never block the write */ }
  return fields;
}

// PORTAL-NATIVE contact creation (Stage 4 of contacts-off-GHL). Finds the person
// in the portal store by email (preferred) or phone; if found, merge-updates the
// row (never clobbering good data) and returns its ghl_contact_id - which for a
// legacy contact is the real GHL id, keeping every historical join intact. If not
// found, MINTS a new contact: a fresh uuid used as BOTH contacts.id and
// contacts.ghl_contact_id, so the minted id flows through the system-wide join key
// (members/opportunities/threads all key on ghl_contact_id) without any schema
// change. No GHL call is ever made. Returns the join-key id, or null on failure
// (callers treat null exactly like a GHL upsert failure).
export async function resolveOrMintPortalContact(clientId, fields = {}) {
  try {
    if (!SB_URL || !SB_KEY || !clientId) return null;
    fields = await withAthleteName(clientId, fields);
    const email = (fields.email || "").trim().toLowerCase() || null;
    const phone = (fields.phone || "").trim() || null;
    if (!email && !phone) return null;

    // 1. Find an existing person (email beats phone - phones get shared).
    let row = null;
    if (email) {
      const r = await get(`contacts?client_id=eq.${encodeURIComponent(clientId)}&email=eq.${encodeURIComponent(email)}&select=id,ghl_contact_id,tags&limit=1`);
      row = (Array.isArray(r) && r[0]) || null;
    }
    if (!row && phone) {
      const r = await get(`contacts?client_id=eq.${encodeURIComponent(clientId)}&phone=eq.${encodeURIComponent(phone)}&select=id,ghl_contact_id,tags&limit=1`);
      row = (Array.isArray(r) && r[0]) || null;
    }

    const { tags, ...rest } = fields;
    if (row) {
      // Merge-update: clean() drops empties so sparse forms never null a name;
      // tags union case-insensitively with what the contact already has.
      const patchBody = { ...clean({ ...rest, email }), updated_at: new Date().toISOString() };
      const have = Array.isArray(row.tags) ? row.tags.map(String) : [];
      const hset = new Set(have.map((t) => t.toLowerCase()));
      const add = (Array.isArray(tags) ? tags : []).map((t) => String(t || "").trim()).filter((t) => t && !hset.has(t.toLowerCase()));
      if (add.length) patchBody.tags = [...have, ...add];
      await patch(`contacts?id=eq.${row.id}`, patchBody);
      return row.ghl_contact_id || row.id;
    }

    // 2. Mint: one uuid = contacts.id = ghl_contact_id (the join key everywhere).
    const minted = crypto.randomUUID();
    await post("contacts?select=id", [{
      id: minted,
      client_id: clientId,
      ghl_contact_id: minted,
      ...clean({ ...rest, email, tags }),
      date_added: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], "return=minimal");
    return minted;
  } catch (e) {
    console.error("[resolveOrMintPortalContact] non-fatal:", e?.message || e);
    return null;
  }
}

// Upsert ONE contact; returns the portal contacts.id (for linking) or null.
export async function upsertPortalContact(clientId, ghlContactId, fields = {}) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !ghlContactId) return null;
    fields = await withAthleteName(clientId, fields);
    const row = {
      client_id: clientId,
      ghl_contact_id: ghlContactId,
      ...clean(fields),
      updated_at: new Date().toISOString(),
    };
    const j = await post(
      "contacts?on_conflict=client_id,ghl_contact_id&select=id",
      [row],
      "resolution=merge-duplicates,return=representation",
    );
    return Array.isArray(j) && j[0]?.id ? j[0].id : null;
  } catch (e) {
    console.error("[upsertPortalContact] non-fatal:", e?.message || e);
    return null;
  }
}

async function get(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Add or remove tags on a portal contact's tags[] (source of truth once flipped).
// Best-effort + store-only (never calls GHL). Reads the current array, merges
// case-insensitively, writes it back. No-op if the portal contact row doesn't
// exist yet (a lead flow / backfill will create it). This is the 'portal' branch
// of the tag write seam; the 'ghl' branch keeps hitting GHL in _tags.js.
export async function mergePortalContactTags(clientId, ghlContactId, tags, { remove = false } = {}) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !ghlContactId) return;
    const list = (Array.isArray(tags) ? tags : [tags]).map((t) => String(t || "").trim()).filter(Boolean);
    if (!list.length) return;
    const rows = await get(`contacts?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&select=id,tags&limit=1`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return;
    const cur = Array.isArray(row.tags) ? row.tags.map(String) : [];
    let next;
    if (remove) {
      const drop = new Set(list.map((t) => t.toLowerCase()));
      next = cur.filter((t) => !drop.has(t.toLowerCase()));
    } else {
      const have = new Set(cur.map((t) => t.toLowerCase()));
      next = [...cur];
      for (const t of list) if (!have.has(t.toLowerCase())) next.push(t);
    }
    await patch(`contacts?id=eq.${row.id}`, { tags: next, updated_at: new Date().toISOString() });
    return next;
  } catch (e) {
    console.error("[mergePortalContactTags] non-fatal:", e?.message || e);
  }
}

// Read the academy's contact system-of-record: 'ghl' (default) or 'portal' (own
// contacts store). Best-effort - any hiccup returns 'ghl', so a lookup failure can
// never silently flip an academy off GHL. This is the READ-side seam: callers pick
// the table to query from it.
export async function contactProvider(clientId) {
  try {
    if (!SB_URL || !SB_KEY || !clientId) return "ghl";
    const rows = await get(`clients?id=eq.${encodeURIComponent(clientId)}&select=contact_provider&limit=1`);
    const p = Array.isArray(rows) && rows[0] && rows[0].contact_provider;
    return p === "portal" ? "portal" : "ghl";
  } catch (e) {
    console.error("[contactProvider] non-fatal:", e?.message || e);
    return "ghl";
  }
}

// The table a contact-card READ should come from for this academy:
//   'portal' -> the portal-owned `contacts` store (source of truth once flipped)
//   'ghl'    -> the `ghl_contacts` mirror (kept fresh by the sync cron)
// Both carry the same search columns (id, ghl_contact_id, name, athlete_name,
// email, phone, tags), so a caller swaps ONLY the table name and keeps its query.
export async function contactsReadTable(clientId) {
  return (await contactProvider(clientId)) === "portal" ? "contacts" : "ghl_contacts";
}

// Coerce a raw form value to the shape the def's type stores as jsonb.
function coerceValue(type, v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  if (type === "number") { const n = Number(s); return Number.isFinite(n) ? n : s; }
  if (type === "boolean") return /^(true|yes|1|on)$/i.test(s);
  if (type === "multiselect") return s.split(",").map((x) => x.trim()).filter(Boolean);
  return s;
}

// Close the write loop: on a form submit, write the collected custom-field
// values straight into portal contact_field_values, keyed by custom_field_defs.
// Two ways a submission key resolves to a def:
//   1. the def's own portal KEY (funnel forms submit by field.key, possibly
//      with a "__<index>" suffix from api/website/offer.js) - this is what
//      captures brand-new wizard questions that have NO ghl_field_id.
//   2. the legacy ghl_field_id BRIDGE via fieldMap (submission key -> ghl id) -
//      still used by GHL-imported fields.
// Portal-native + real-time, so the portal no longer depends on GHL sync+fold.
// Archived defs are skipped. Best-effort; never throws.
export async function writePortalFieldValues(clientId, portalContactId, fieldMap, fields) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !portalContactId || !fields) return;
    const entries = Object.entries(fields).filter(([k]) => k != null && k !== "");
    if (!entries.length) return;
    // All the academy's live defs; match by key first, then the ghl bridge.
    const defs = await get(
      `custom_field_defs?client_id=eq.${clientId}&archived=eq.false&select=id,type,key,ghl_field_id`,
    );
    if (!Array.isArray(defs) || !defs.length) return;
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const byGhl = new Map(defs.filter((d) => d.ghl_field_id).map((d) => [d.ghl_field_id, d]));
    const stripIdx = (k) => String(k).replace(/__\d+$/, "");
    const now = new Date().toISOString();
    const seen = new Set();
    const rows = [];
    for (const [subKey, raw] of entries) {
      let def = byKey.get(subKey) || byKey.get(stripIdx(subKey));
      if (!def && fieldMap && fieldMap[subKey]) def = byGhl.get(fieldMap[subKey]);
      if (!def || seen.has(def.id)) continue;
      const val = coerceValue(def.type, raw);
      if (val === null || (Array.isArray(val) && !val.length)) continue;
      seen.add(def.id);
      rows.push({ contact_id: portalContactId, field_id: def.id, value: val, updated_at: now });
    }
    if (!rows.length) return;
    await post(
      "contact_field_values?on_conflict=contact_id,field_id",
      rows,
      "resolution=merge-duplicates,return=minimal",
    );
  } catch (e) {
    console.error("[writePortalFieldValues] non-fatal:", e?.message || e);
  }
}

// Bulk mirror (sync cron). rows must already be contacts-shaped (snake_case
// columns). Best-effort, returns nothing.
export async function bulkUpsertPortalContacts(rows) {
  try {
    if (!SB_URL || !SB_KEY || !Array.isArray(rows) || rows.length === 0) return;
    const now = new Date().toISOString();
    // Cron rows arrive with athlete_name already resolved, so withAthleteName
    // no-ops there; the per-client field-id cache keeps this one lookup per client.
    const named = [];
    for (const r of rows) named.push(r && r.client_id ? await withAthleteName(r.client_id, r) : r);
    const clean_rows = named
      .map((r) => ({ ...clean(r), updated_at: now }))
      .filter((r) => r.client_id && r.ghl_contact_id);
    if (!clean_rows.length) return;
    await post(
      "contacts?on_conflict=client_id,ghl_contact_id",
      clean_rows,
      "resolution=merge-duplicates,return=minimal",
    );
  } catch (e) {
    console.error("[bulkUpsertPortalContacts] non-fatal:", e?.message || e);
  }
}
