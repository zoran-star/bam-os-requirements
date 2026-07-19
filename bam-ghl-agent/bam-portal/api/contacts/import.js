import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
import crypto from "node:crypto";
export const maxDuration = 60; // AI mapping + bulk merge can take a while
// Vercel Serverless Function — CONTACT spreadsheet importer (Plan 5, 2026-07-18).
//
// The wizard's Contacts step for academies NOT on GoHighLevel: the owner drops
// their contact list (any layout), we map the columns, they confirm, everyone
// lands in `contacts` deduped against what's already there.
//
// POST modes (same rhythm as api/sorter/import.js, the member importer):
//   • mode="map"    body { client_id, header:[...], sample_rows:[[...]] }
//       AI maps each column to a canonical contact field, or proposes a FATE
//       for columns that fit nothing:
//         create  = structured + useful → becomes a real custom field
//         archive = freeform history → kept on the contact record (jsonb)
//         skip    = junk → explicitly dropped
//       → { batch_id, mapping:[{column,field,fate,confidence,sample}] }
//   • mode="commit" body { client_id, batch_id, mapping:[{column,field?,fate?,label?}], rows:[{...}] }
//       Dedupe in-file (email beats phone), match against existing contacts
//       (email → phone), merge or mint. 'create' columns become
//       custom_field_defs + contact_field_values; 'archive' columns merge into
//       the contact's custom_fields jsonb under their header name. Unknown
//       columns are NEVER silently dropped - every column has a fate.
//       → { ok, imported, merged_existing, merged_in_file, name_only, skipped_empty,
//           fields_created:[labels] }
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MODEL = "claude-sonnet-4-6";
const enc = encodeURIComponent;

const FIELDS = ["name", "first_name", "last_name", "email", "phone", "tags", "ignore"];
const FATES = ["create", "archive", "skip"];

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

const norm = (v) => (v == null ? null : String(v).trim() || null);
const normEmail = (v) => { const s = norm(v); return s ? s.toLowerCase() : null; };
const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10) || null;
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "field";

// ── MODE: map — AI proposes field mapping + a fate for every leftover ──
async function runMap(res, body) {
  const header = Array.isArray(body.header) ? body.header.map(h => String(h)) : [];
  if (!header.length) return res.status(400).json({ error: "header[] required" });
  const sampleRows = Array.isArray(body.sample_rows) ? body.sample_rows.slice(0, 8) : [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const system =
    "You map the columns of a sports academy's contact list (CSV) to canonical CRM contact fields. " +
    "For EACH column header pick the single best field, or \"ignore\" if none fits. Fields:\n" +
    "  name       = the full name of the contact (parent/lead)\n" +
    "  first_name = first name only\n" +
    "  last_name  = last name only\n" +
    "  email      = email address\n" +
    "  phone      = phone number\n" +
    "  tags       = labels/segments/groups (comma or semicolon separated)\n" +
    "  ignore     = fits none of the above\n" +
    "Map AT MOST ONE column to each non-ignore field. If both a full-name column and " +
    "first/last columns exist, prefer first_name+last_name and ignore the full-name column.\n" +
    "For every \"ignore\" column ALSO propose a fate:\n" +
    "  create  = structured, useful going forward (e.g. jersey size, school, birthday) → becomes a custom field\n" +
    "  archive = freeform history worth keeping on the record (e.g. notes, old CRM remarks)\n" +
    "  skip    = empty/junk/technical noise (row ids, export artifacts)\n" +
    "Respond with ONLY a JSON array, one object per column, same order as the headers, no prose:\n" +
    '[{"column"(exact header),"field"(allowed value),"fate"(create|archive|skip, only when field is ignore),"confidence"(0-1)}]';

  const raw = await claudeJsonArray({ apiKey, model: MODEL, system, payload: { headers: header, sample_rows: sampleRows, allowed_fields: FIELDS }, maxTokens: 4096 });
  const byColumn = Object.fromEntries((Array.isArray(raw) ? raw : []).map(m => [String(m.column), m]));
  const mapping = header.map((column, i) => {
    const m = byColumn[column] || {};
    const field = FIELDS.includes(m.field) && m.field !== "ignore" ? m.field : null;
    const fate = !field && FATES.includes(m.fate) ? m.fate : (field ? null : "archive");
    const sample = (sampleRows[0] && sampleRows[0][i] != null) ? String(sampleRows[0][i]) : null;
    return { column, header: column, field, fate, confidence: m.confidence != null ? m.confidence : null, sample };
  });
  return res.status(200).json({ batch_id: crypto.randomUUID(), mapping });
}

// ── MODE: commit — merge/mint contacts + apply column fates ──
async function runCommit(res, body, clientId) {
  const mapping = Array.isArray(body.mapping) ? body.mapping : [];
  if (!mapping.length) return res.status(400).json({ error: "mapping[] required" });
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(200).json({ ok: true, imported: 0 });
  if (rows.length > 5000) return res.status(413).json({ error: "too many rows (max 5000 per import)" });

  const colToField = {}, colFate = {}, colLabel = {};
  for (const m of mapping) {
    if (!m || !m.column) continue;
    if (m.field && FIELDS.includes(m.field) && m.field !== "ignore") colToField[m.column] = m.field;
    else colFate[m.column] = FATES.includes(m.fate) ? m.fate : "skip";
    if (m.label) colLabel[m.column] = String(m.label);
  }

  // Parse every row into { fields, archive, fieldVals } form.
  const parsed = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const fields = {}, archive = {}, create = {};
    for (const [column, value] of Object.entries(r)) {
      if (column === "__row") continue;
      const f = colToField[column];
      if (f === "email") fields.email = normEmail(value);
      else if (f === "phone") fields.phone = norm(value);
      else if (f === "tags") fields.tags = String(value || "").split(/[;,]/).map(t => t.trim()).filter(Boolean);
      else if (f) fields[f] = norm(value);
      else if (colFate[column] === "archive") { const v = norm(value); if (v) archive[column] = v; }
      else if (colFate[column] === "create") { const v = norm(value); if (v) create[column] = v; }
    }
    if (!fields.name && (fields.first_name || fields.last_name)) {
      fields.name = [fields.first_name, fields.last_name].filter(Boolean).join(" ");
    }
    if (!fields.email && !fields.phone && !fields.name) continue; // nothing identifies them
    parsed.push({ fields, archive, create });
  }
  const skippedEmpty = rows.length - parsed.length;

  // Dedupe IN-FILE: email beats phone beats normalized name. Later rows merge
  // into the first sighting (non-empty wins, tags union, archives merge).
  const seen = new Map();
  const keyOf = (p) => p.fields.email || (normPhone(p.fields.phone) ? "p:" + normPhone(p.fields.phone) : null) || (p.fields.name ? "n:" + p.fields.name.toLowerCase() : null);
  const unique = [];
  let mergedInFile = 0;
  for (const p of parsed) {
    const k = keyOf(p);
    const prev = k && seen.get(k);
    if (!prev) { if (k) seen.set(k, p); unique.push(p); continue; }
    mergedInFile++;
    for (const [f, v] of Object.entries(p.fields)) {
      if (f === "tags") prev.fields.tags = [...new Set([...(prev.fields.tags || []), ...(v || [])])];
      else if (v && !prev.fields[f]) prev.fields[f] = v;
    }
    Object.assign(prev.archive, p.archive);
    for (const [c, v] of Object.entries(p.create)) if (!prev.create[c]) prev.create[c] = v;
  }

  // Custom field defs for 'create' columns (created once, values per contact).
  const createCols = [...new Set(unique.flatMap(p => Object.keys(p.create)))];
  const defByCol = {};
  const fieldsCreated = [];
  if (createCols.length) {
    const existingDefs = await sb(`custom_field_defs?client_id=eq.${enc(clientId)}&select=id,key,label`);
    const taken = new Set((existingDefs || []).map(d => d.key));
    const byLabel = new Map((existingDefs || []).map(d => [String(d.label).toLowerCase(), d]));
    let pos = 1000; // park imported defs after the curated ones
    for (const col of createCols) {
      const label = colLabel[col] || col;
      const already = byLabel.get(label.toLowerCase());
      if (already) { defByCol[col] = already.id; continue; }
      let key = slugify(label);
      for (let i = 2; taken.has(key); i++) key = `${slugify(label)}_${i}`;
      taken.add(key);
      const made = await sb(`custom_field_defs`, {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ client_id: clientId, key, label, type: "text", options: [], required: false, position: pos++ }),
      });
      const def = Array.isArray(made) ? made[0] : made;
      if (def && def.id) { defByCol[col] = def.id; fieldsCreated.push(label); }
    }
  }

  // Existing contacts, matched in memory (email → phone), then merge or mint.
  const existing = await sb(`contacts?client_id=eq.${enc(clientId)}&select=id,ghl_contact_id,name,first_name,last_name,email,phone,tags,custom_fields&limit=5000`) || [];
  const byEmail = new Map(), byPhone = new Map();
  for (const c of existing) {
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
    const ph = normPhone(c.phone);
    if (ph && !byPhone.has(ph)) byPhone.set(ph, c);
  }

  const nowIso = new Date().toISOString();
  const toInsert = [];
  const patches = []; // { id, body }
  const valueRows = []; // contact_field_values upserts
  let mergedExisting = 0, nameOnly = 0;
  for (const p of unique) {
    const hit = (p.fields.email && byEmail.get(p.fields.email)) || (normPhone(p.fields.phone) && byPhone.get(normPhone(p.fields.phone))) || null;
    let contactId;
    if (hit) {
      mergedExisting++;
      contactId = hit.id;
      const tags = [...new Set([...(Array.isArray(hit.tags) ? hit.tags : []), ...(p.fields.tags || [])])];
      const patch = { updated_at: nowIso, tags };
      for (const f of ["name", "first_name", "last_name", "email", "phone"]) {
        if (p.fields[f] && !hit[f]) patch[f] = p.fields[f]; // fill blanks, never clobber
      }
      if (Object.keys(p.archive).length) patch.custom_fields = { ...(hit.custom_fields || {}), ...p.archive };
      patches.push({ id: hit.id, body: patch });
    } else {
      if (!p.fields.email && !p.fields.phone) nameOnly++;
      contactId = crypto.randomUUID();
      toInsert.push({
        id: contactId, client_id: clientId, ghl_contact_id: contactId,
        name: p.fields.name || null, first_name: p.fields.first_name || null, last_name: p.fields.last_name || null,
        email: p.fields.email || null, phone: p.fields.phone || null,
        tags: p.fields.tags || [],
        custom_fields: Object.keys(p.archive).length ? p.archive : {},
        date_added: nowIso, updated_at: nowIso,
      });
      // keep in-memory maps current so a later file row can't double-mint
      if (p.fields.email) byEmail.set(p.fields.email, { id: contactId });
      const ph = normPhone(p.fields.phone);
      if (ph) byPhone.set(ph, { id: contactId });
    }
    for (const [col, v] of Object.entries(p.create)) {
      if (defByCol[col]) valueRows.push({ contact_id: contactId, field_id: defByCol[col], value: v, updated_at: nowIso });
    }
  }

  for (let i = 0; i < toInsert.length; i += 200) {
    await sb(`contacts?select=id`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(toInsert.slice(i, i + 200)) });
  }
  for (let i = 0; i < patches.length; i += 15) {
    await Promise.all(patches.slice(i, i + 15).map(p =>
      sb(`contacts?id=eq.${enc(p.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(p.body) })
    ));
  }
  for (let i = 0; i < valueRows.length; i += 200) {
    await sb(`contact_field_values?on_conflict=contact_id,field_id`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(valueRows.slice(i, i + 200)),
    });
  }

  return res.status(200).json({
    ok: true,
    imported: toInsert.length,
    merged_existing: mergedExisting,
    merged_in_file: mergedInFile,
    name_only: nameOnly,
    skipped_empty: skippedEmpty,
    fields_created: fieldsCreated,
  });
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });
    const mode = body.mode || (body.rows ? "commit" : "map");
    if (mode === "map") return await runMap(res, body);
    if (mode === "commit") return await runCommit(res, body, clientId);
    return res.status(400).json({ error: "unknown mode (expected 'map' or 'commit')" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
