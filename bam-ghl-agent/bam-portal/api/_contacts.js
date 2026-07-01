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
