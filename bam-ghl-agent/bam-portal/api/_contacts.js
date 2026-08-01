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

// Last 10 digits of a phone, or "" - the shape contacts.phone10 (a generated
// column) holds, so a lookup matches regardless of how the source formatted the
// number. contacts.phone itself is stored in whatever shape its source used:
// E.164 from the GHL sync ("+16044424595"), bare digits from a website form
// ("6044424595"), human-formatted from a typed field ("(604) 442-4595"). Exact
// string compares across those shapes silently miss and mint duplicate people.
// Only a FULL 10 digits counts - a partial number is not identity.
export function phone10(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

const nameKey = (raw) => String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");

// Identity fields a weaker (phone) match must not overwrite - it may be a second
// person on the same household number, and their name/email/athlete is not a
// correction of the record already there. Everything else (custom fields, first/
// last, stripe ids) still merges normally: those are additive detail, not identity.
const IDENTITY = ["name", "email", "phone", "athlete_name"];
function fillBlanks(fields, row) {
  const out = { ...fields };
  for (const k of IDENTITY) {
    const have = row && row[k];
    if (have != null && String(have).trim() !== "") delete out[k];
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
// in the portal store by email (preferred) or normalized phone; if found,
// merge-updates the row (never clobbering good data) and returns its ghl_contact_id - which for a
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
    const p10 = phone10(phone);
    if (!email && !p10) return null;

    // 1. Find an existing person (email beats phone - phones get shared).
    const SELECT = "id,ghl_contact_id,tags,name,email,phone,athlete_name";
    let row = null;
    let viaPhone = false;
    if (email) {
      const r = await get(`contacts?client_id=eq.${encodeURIComponent(clientId)}&email=eq.${encodeURIComponent(email)}&select=${SELECT}&limit=1`);
      row = (Array.isArray(r) && r[0]) || null;
    }
    if (!row && p10) {
      // Match on the normalized phone, not the raw string (see phone10 above).
      // A phone is a HOUSEHOLD, not a person: mum and dad share it, so do two
      // siblings. Accept the match unless both sides name an athlete and they
      // DISAGREE - that is the one shape where merging would fuse two different
      // kids' records. Same rule the reconcile sweep uses for dup contacts.
      const r = await get(`contacts?client_id=eq.${encodeURIComponent(clientId)}&phone10=eq.${encodeURIComponent(p10)}&select=${SELECT}&order=date_added.asc.nullslast&limit=10`);
      const mine = nameKey(fields.athlete_name);
      const hit = (Array.isArray(r) ? r : []).find((c) => {
        const theirs = nameKey(c.athlete_name);
        return !mine || !theirs || mine === theirs;
      });
      if (hit) { row = hit; viaPhone = true; }
    }

    const { tags, ...rest } = fields;
    if (row) {
      // Merge-update: clean() drops empties so sparse forms never null a name;
      // tags union case-insensitively with what the contact already has.
      // A PHONE match is the weaker signal - it says "same household", not
      // "same person" - so it only ever FILLS BLANKS. Without that, the second
      // parent to enrol would rename the contact and overwrite the email of the
      // one who has been in the thread all along (Gbolonyo: Ama's checkout would
      // have relabelled Mawumefa's record mid-conversation).
      const merged = viaPhone ? fillBlanks({ ...rest, email }, row) : { ...rest, email };
      const patchBody = { ...clean(merged), updated_at: new Date().toISOString() };
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

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE-ONLY INTAKE FIELDS
// ─────────────────────────────────────────────────────────────────────────────
// THE BUG THIS EXISTS FOR. The membership enroll form asks every parent for an
// emergency contact and REQUIRES it (REQUIRED_INTAKE_LABELS in
// api/website/offer.js, owner ruling: required for every academy on the preset).
// The answer was then thrown away. Not by an error - by a gap: those two
// questions are a CODE BLOCK in buildFields, not custom_field_defs rows, and
// writePortalFieldValues resolves a submitted answer to a def BY KEY. No academy
// had the key (verified 2026-07-31: 0 emergency defs across every academy), so
// every emergency contact ever collected fell straight through. It survived only
// inside member_audit_log.args.intake, which is an audit trail nobody reads off a
// member's record - 18 enrollments, 13 members, back to 2026-06-16.
//
// A required field with nowhere to land is the worst shape a field can have: the
// form is asking parents for something in an emergency's name and the coach who
// would need it cannot see it.
//
// WHAT A "STORAGE-ONLY" DEF IS. A custom_field_defs row that exists so a value
// has somewhere to go, for a question the FORM already renders from code. It is
// a real def in every other respect - the Members drawer reads it, a coach can
// edit it inline (api/custom-fields.js returns every offer_id-null def with its
// value) - it simply must never be RENDERED as a def, or the enroll form would
// ask the same question twice. api/website/offer.js skips these keys at its one
// def-rendering choke point; see STORAGE_ONLY_DEF_KEYS there and the four
// consequences that skip prevents.
//
// WHY THE DEF LIVES HERE AND THE SKIP LIVES THERE. This module owns storage, so
// the manifest is here and offer.js imports the keys. The other direction would
// make a core storage lib depend on an API route module (offer.js pulls in
// _sentry.js and a handler), which nothing else in this file does.
//
// THE KEYS ARE DERIVED FROM THE FORM'S LABELS AND MUST STAY THAT WAY.
// buildFields submits `fieldKey("Emergency contact name")` =
// "emergency_contact_name" (plus a "__<index>" suffix that writePortalFieldValues
// strips - the index is NOT stable, production has shipped both __3/__4 and
// __6/__7 as the academy's other fields moved around it). Rename the LABEL in
// offer.js and the submitted key changes with it, silently orphaning these rows.
// That is not left to memory: api/_emergency-contact-storage.test.mjs asserts
// EMERGENCY_CONTACT.map(fieldKey) equals these keys, so a label rename fails the
// suite and the person renaming has to decide what happens to the stored answers.
export const STORAGE_ONLY_INTAKE_DEFS = [
  { key: "emergency_contact_name",  label: "Emergency contact name",  type: "text",  position: 100 },
  { key: "emergency_contact_phone", label: "Emergency contact phone", type: "phone", position: 101 },
];
export const STORAGE_ONLY_DEF_KEYS = STORAGE_ONLY_INTAKE_DEFS.map((d) => d.key);

// Make sure this academy has the storage-only defs, so the answers the enroll
// form is ALREADY collecting have a row to land in.
//
// Idempotent by construction: ignore-duplicates against the (client_id, key)
// unique index, so a second call writes nothing and an academy that already has
// the key keeps ITS row - label, type and required flag included. It never
// PATCHes and never deletes.
//
// ARCHIVED ROWS ARE LEFT ARCHIVED, and that is a real decision rather than an
// oversight. ignore-duplicates matches on the KEY, so an academy that archived
// its emergency field stays archived and its answers keep falling through. That
// is correct: archiving is a deliberate act by an owner, and a storage helper
// that silently un-archived a field would be overriding them on a money path. It
// is also visible - the field is absent from the drawer, which is what archiving
// means. The form-level requirement is a separate question and a separate owner
// decision; nothing here should quietly settle it.
//
// Best-effort, like everything else in this file: it swallows its own errors and
// returns false rather than throwing, because it is called from the enrollment
// path and no field definition is worth failing a payment over.
export async function ensureStorageOnlyDefs(clientId, sbPost = post) {
  try {
    if (!SB_URL || !SB_KEY || !clientId) return false;
    await sbPost(
      "custom_field_defs?on_conflict=client_id,key",
      STORAGE_ONLY_INTAKE_DEFS.map((d) => ({
        client_id: clientId,
        key: d.key,
        label: d.label,
        type: d.type,
        options: [],
        position: d.position,
        required: false,
        archived: false,
        // ACADEMY-LEVEL on purpose (offer_id null, section null). An offer-scoped
        // def would be invisible on the contact record for anyone who bought a
        // different offer, and emergency contact belongs to the person, not the
        // purchase.
        offer_id: null,
        section: null,
      })),
      "resolution=ignore-duplicates,return=minimal",
    );
    return true;
  } catch (e) {
    console.error("[ensureStorageOnlyDefs] non-fatal:", e?.message || e);
    return false;
  }
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
// columns). Best-effort; returns the count of rows actually posted (0 on
// failure) so a caller that cares can tell "wrote nothing" from "wrote all".
export async function bulkUpsertPortalContacts(rows) {
  let posted = 0;
  try {
    if (!SB_URL || !SB_KEY || !Array.isArray(rows) || rows.length === 0) return posted;
    const now = new Date().toISOString();
    // Cron rows arrive with athlete_name already resolved, so withAthleteName
    // no-ops there; the per-client field-id cache keeps this one lookup per client.
    const named = [];
    for (const r of rows) named.push(r && r.client_id ? await withAthleteName(r.client_id, r) : r);
    const clean_rows = named
      .map((r) => ({ ...clean(r), updated_at: now }))
      .filter((r) => r.client_id && r.ghl_contact_id);
    if (!clean_rows.length) return posted;
    // PostgREST bulk inserts demand every object share the same keys (PGRST102
    // "All object keys must match") and reject the WHOLE batch otherwise. clean()
    // strips empty fields per row, so a mixed batch (one row has email, the next
    // does not) is the norm, not the exception - and for a long time such batches
    // silently vanished into the catch below. Bucket rows by their exact key set
    // and post each homogeneous bucket on its own.
    const buckets = new Map();
    for (const r of clean_rows) {
      const sig = Object.keys(r).sort().join(",");
      if (!buckets.has(sig)) buckets.set(sig, []);
      buckets.get(sig).push(r);
    }
    for (const bucket of buckets.values()) {
      await post(
        "contacts?on_conflict=client_id,ghl_contact_id",
        bucket,
        "resolution=merge-duplicates,return=minimal",
      );
      posted += bucket.length;
    }
    return posted;
  } catch (e) {
    console.error("[bulkUpsertPortalContacts] non-fatal:", e?.message || e);
    return posted;
  }
}
