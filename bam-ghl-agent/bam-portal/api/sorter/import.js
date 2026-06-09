import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
import crypto from "node:crypto";
// Vercel Serverless Function — Pricing Sorter CSV importer (Step 2).
//
// POST modes:
//   • mode="map"    → propose a column→field mapping for an arbitrary CSV.
//       body: { client_id, header:[...], sample_rows:[[...]] }
//       Asks Claude (raw fetch) to map each CSV column to one of the canonical
//       member fields (or "ignore"), with a per-column confidence. Generates a
//       batch_id server-side. No DB writes.
//       → { batch_id, mapping:[{column,field,confidence}] }
//   • mode="commit" → apply the (owner-confirmed) mapping and stage the rows.
//       body: { client_id, batch_id, mapping:[{column,field}], rows:[{...}] }
//       Inserts the mapped rows into members_staging (unmapped columns stashed in
//       the raw jsonb column). → { ok, inserted, batch_id }
//
// GET ?client_id=&batch= → list the current staging rows for that batch (re-render).
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.
// Needs ANTHROPIC_API_KEY for mode="map".

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MODEL = "claude-sonnet-4-6";

// The canonical member fields a CSV column may map to (plus "ignore").
const FIELDS = [
  "athlete_name", "parent_name", "parent_email", "parent_phone",
  "plan", "status", "joined_date",
  "stripe_customer_id", "stripe_subscription_id", "ignore",
];

function nowIso() { return new Date().toISOString(); }

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

// Auth: staff (any client) or active client_users membership of client_id.
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// Ask Claude to map each CSV column → one canonical member field (or "ignore").
async function aiMapColumns(header, sampleRows) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const system =
    "You map the columns of a sports academy's messy member spreadsheet (CSV) to a fixed set of " +
    "canonical member fields. For EACH column header, pick the single best matching field — or " +
    "\"ignore\" if the column is irrelevant/leftover. Use BOTH the header name and the sample " +
    "values to decide. The allowed fields are:\n" +
    "  athlete_name           = the player/child's name\n" +
    "  parent_name            = the parent/guardian's name\n" +
    "  parent_email           = an email address\n" +
    "  parent_phone           = a phone number\n" +
    "  plan                   = the membership plan/term label\n" +
    "  status                 = active/cancelled/paused/etc.\n" +
    "  joined_date            = the date they joined/started\n" +
    "  stripe_customer_id     = a Stripe customer id (cus_...)\n" +
    "  stripe_subscription_id = a Stripe subscription id (sub_...)\n" +
    "  ignore                 = anything that fits none of the above\n" +
    "Map AT MOST ONE column to each non-ignore field (the best one); map the rest of overlapping " +
    "columns to \"ignore\". Respond with ONLY a JSON array, one object per input column, in the same " +
    "order as the headers, no prose:\n" +
    '[{"column"(the exact header string),"field"(one of the allowed values),"confidence"(0-1)}]';

  const payload = {
    headers: header,
    sample_rows: (Array.isArray(sampleRows) ? sampleRows : []).slice(0, 8),
    allowed_fields: FIELDS,
  };

  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 4096 });
}

// ── MODE: map — propose a column→field mapping for review ──
async function runMap(req, res, ctx, body, clientId) {
  const header = Array.isArray(body.header) ? body.header.map(h => String(h))
    : (Array.isArray(body.headers) ? body.headers.map(h => String(h)) : []);
  if (!header.length) return res.status(400).json({ error: "header[] required" });
  const sampleRows = Array.isArray(body.sample_rows) ? body.sample_rows : [];

  const raw = await aiMapColumns(header, sampleRows);
  const byColumn = Object.fromEntries((Array.isArray(raw) ? raw : []).map(m => [String(m.column), m]));

  // Normalize back onto the real headers so the response always covers every column.
  const mapping = header.map((column, i) => {
    const m = byColumn[column] || {};
    const field = FIELDS.includes(m.field) ? m.field : "ignore";
    const sample = (sampleRows[0] && sampleRows[0][i] != null) ? String(sampleRows[0][i]) : null;
    return { column, header: column, field: field === "ignore" ? null : field, confidence: m.confidence != null ? m.confidence : null, sample };
  });

  return res.status(200).json({
    batch_id: crypto.randomUUID(),
    mapping,
    unmapped_headers: mapping.filter(m => !m.field).map(m => m.column),
  });
}

// ── MODE: commit — apply confirmed mapping + stage rows into members_staging ──
async function runCommit(req, res, ctx, body, clientId) {
  const batchId = body.batch_id || body.import_batch_id;
  if (!batchId) return res.status(400).json({ error: "batch_id required" });
  const mapping = Array.isArray(body.mapping) ? body.mapping : [];
  if (!mapping.length) return res.status(400).json({ error: "mapping[] required" });
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(200).json({ ok: true, inserted: 0, batch_id: batchId });
  if (rows.length > 5000) return res.status(413).json({ error: "too many rows (max 5000 per import)" });

  // column → field (drop "ignore"/null/unknown fields → those go to raw).
  const colToField = {};
  for (const m of mapping) {
    if (!m || !m.column) continue;
    const field = m.field;
    if (field && field !== "ignore" && FIELDS.includes(field)) colToField[String(m.column)] = field;
  }

  const norm = v => (v == null ? null : String(v).trim() || null);
  // Parse a free-text date into YYYY-MM-DD; leave null if unparseable.
  const parseDate = v => {
    const s = norm(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const staged = rows.map((row, i) => {
    const r = (row && typeof row === "object") ? row : {};
    const out = {
      client_id: clientId,
      import_batch_id: batchId,
      source_row: typeof r.__row === "number" ? r.__row : i + 1,
      raw: {},                  // unmapped leftover columns
    };
    for (const [column, value] of Object.entries(r)) {
      if (column === "__row") continue;
      const field = colToField[column];
      if (!field) { out.raw[column] = value; continue; }
      if (field === "joined_date") out.joined_date = parseDate(value);
      else if (field === "parent_email") out.parent_email = norm(value) ? norm(value).toLowerCase() : null;
      else out[field] = norm(value);
    }
    return out;
  });

  // Bulk insert in chunks to keep request bodies small.
  let inserted = 0;
  for (let i = 0; i < staged.length; i += 200) {
    const chunk = staged.slice(i, i + 200);
    const r = await sb(`members_staging?select=id`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(chunk),
    });
    inserted += Array.isArray(r) ? r.length : 0;
  }

  return res.status(200).json({ ok: true, inserted, import_batch_id: batchId, batch_id: batchId });
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);

    // ── GET: list current staging rows for a batch (re-render) ──
    if (req.method === "GET") {
      const clientId = (req.query && (req.query.client_id || req.query.clientId)) || ctx.clientIds[0];
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });
      const batch = req.query && (req.query.batch || req.query.import_batch_id || req.query.batch_id);
      let path = `members_staging?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=source_row.asc`;
      if (batch) path += `&import_batch_id=eq.${encodeURIComponent(batch)}`;
      const rows = await sb(path) || [];
      return res.status(200).json({ ok: true, rows });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const mode = body.mode || ((body.batch_id || body.import_batch_id) && body.rows ? "commit" : "map");
    if (mode === "map") return await runMap(req, res, ctx, body, clientId);
    if (mode === "commit" || mode === "import") return await runCommit(req, res, ctx, body, clientId);
    return res.status(400).json({ error: "unknown mode (expected 'map' or 'commit')" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

void nowIso;
export default withSentryApiRoute(handler);
