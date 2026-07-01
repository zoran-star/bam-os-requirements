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

// Upsert ONE contact; returns the portal contacts.id (for linking) or null.
export async function upsertPortalContact(clientId, ghlContactId, fields = {}) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !ghlContactId) return null;
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
// values straight into portal contact_field_values, keyed by custom_field_defs
// (matched via each def's ghl_field_id bridge). Portal-native + real-time, so
// the portal no longer depends on the GHL sync+fold to hold a lead's field
// values. Archived defs are skipped. Best-effort; never throws.
export async function writePortalFieldValues(clientId, portalContactId, fieldMap, fields) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !portalContactId || !fieldMap || !fields) return;
    const ghlIds = [...new Set(Object.values(fieldMap).filter(Boolean))];
    if (!ghlIds.length) return;
    const defs = await get(
      `custom_field_defs?client_id=eq.${clientId}&archived=eq.false&ghl_field_id=in.(${ghlIds.join(",")})&select=id,type,ghl_field_id`,
    );
    if (!Array.isArray(defs) || !defs.length) return;
    const byGhl = new Map(defs.map((d) => [d.ghl_field_id, d]));
    const now = new Date().toISOString();
    const rows = [];
    for (const [key, ghlFieldId] of Object.entries(fieldMap)) {
      const def = byGhl.get(ghlFieldId);
      if (!def) continue;
      const val = coerceValue(def.type, fields[key]);
      if (val === null || (Array.isArray(val) && !val.length)) continue;
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
    const clean_rows = rows
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
