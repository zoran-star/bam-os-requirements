// Vercel Serverless Function — Asana → Portal import
// GET  : lists unimported open Asana tickets from "Tickets - MASTER", parses notes
// POST : imports one Asana ticket as a portal ticket (creates tickets row)
// Staff-only (Bearer auth).

const ASANA_API = "https://app.asana.com/api/1.0";
const TICKETS_MASTER_PROJECT = "1211109205654944";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Map Asana assignee name → staff email (for resolving to staff.id)
const ASANA_TO_STAFF_EMAIL = {
  "Rosano":              "rarandila@gmail.com",
  "Jenny":               "jennybabeco@gmail.com",
  "Chris Delos Trinos":  "mcdelostrinos@gmail.com",
};

const SB_HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...SB_HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function asana(path) {
  const res = await fetch(`${ASANA_API}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Asana ${res.status}: ${await res.text()}`);
  return res.json();
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
  const rows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email`);
  const me = Array.isArray(rows) && rows[0];
  if (!me) return null;
  const allowed = ["admin", "systems_manager"]; // managers only — import is a cleanup workflow
  if (!allowed.includes(me.role)) return null;
  return me;
}

// Parse the standard Asana notes template used by the old submission form.
// Template:
//   Academy:
//   <value>
//
//   Email address (if we need something from you):
//   <value>
//
//   Category:
//   <value>
//
//   Title:
//   <value>
//
//   Issue Description:
//   <value (rest of notes)>
function parseNotes(notes) {
  const out = { academy: "", email: "", category: "", title: "", description: "" };
  if (!notes) return out;

  // Normalize line endings
  const text = notes.replace(/\r\n/g, "\n");

  // Split on the known field labels; keep order
  const FIELDS = [
    { key: "academy",     label: /Academy:\s*\n/i },
    { key: "email",       label: /Email address[^\n]*:\s*\n/i },
    { key: "category",    label: /Category:\s*\n/i },
    { key: "title",       label: /Title:\s*\n/i },
    { key: "description", label: /(Issue Description|Description|Details)\s*:\s*\n/i },
  ];

  // Build an array of { key, index } by finding each label occurrence
  const found = [];
  for (const f of FIELDS) {
    const m = text.match(f.label);
    if (m) found.push({ key: f.key, start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);

  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    const value = text.slice(cur.end, next ? next.start : text.length).trim();
    out[cur.key] = value;
  }
  return out;
}

// Pull custom field values from an Asana task
function customFields(t) {
  const out = { academy_enum: null, category: null, red_alert: null };
  for (const cf of (t.custom_fields || [])) {
    const name = cf.name;
    const val = cf.enum_value?.name || cf.text_value || null;
    if (name === "Academy") out.academy_enum = val;
    else if (name === "Category") out.category = val;
    else if (name === "Red Alert?") out.red_alert = val;
  }
  return out;
}

function mapAsanaTicket(t, importedGids) {
  if (importedGids.has(t.gid)) return null;
  const parsed = parseNotes(t.notes);
  const cf = customFields(t);
  return {
    asana_gid:     t.gid,
    name:          t.name || "",
    created_at:    t.created_at || null,
    modified_at:   t.modified_at || null,
    due_on:        t.due_on || null,
    assignee_name: t.assignee?.name || null,
    permalink:     t.permalink_url || "",
    num_subtasks:  t.num_subtasks || 0,
    parsed: {
      academy:     parsed.academy || cf.academy_enum || "",
      email:       parsed.email || "",
      category:    (parsed.category || cf.category || "").toLowerCase() || null, // systems | website | ads | other
      title:       parsed.title || t.name || "",
      description: parsed.description || "",
      red_alert:   cf.red_alert === "Yes",
    },
  };
}

async function loadMapping() {
  const rows = await sb(`academy_mappings?select=asana_name,client_id,skip`);
  const map = {};
  (rows || []).forEach(r => { map[r.asana_name] = { client_id: r.client_id, skip: r.skip }; });
  return map;
}

export default async function handler(req, res) {
  if (!process.env.ASANA_ACCESS_TOKEN) {
    return res.status(500).json({ error: "ASANA_ACCESS_TOKEN not configured" });
  }

  const me = await verifyStaff(req);
  if (!me) return res.status(401).json({ error: "unauthorized" });

  try {
    // ─── GET: list unimported open Asana tickets with parsed + mapping ─────
    if (req.method === "GET") {
      const OPT_FIELDS = [
        "name","notes","completed","due_on","created_at","modified_at","permalink_url","num_subtasks",
        "assignee.name","assignee.gid",
        "custom_fields.name","custom_fields.enum_value.name","custom_fields.text_value",
      ].join(",");

      // Asana paginates; we pull up to 100 (more than enough; only 21 incomplete today)
      const asanaRes = await asana(
        `/tasks?project=${TICKETS_MASTER_PROJECT}&completed_since=now&opt_fields=${OPT_FIELDS}&limit=100`
      );
      const openTasks = (asanaRes.data || []).filter(t => !t.completed);

      // Already-imported gids
      const importedRows = await sb(`tickets?source=eq.asana_import&asana_gid=not.is.null&select=asana_gid`);
      const importedGids = new Set((importedRows || []).map(r => r.asana_gid));

      // Parse + enrich
      const parsed = openTasks
        .map(t => mapAsanaTicket(t, importedGids))
        .filter(Boolean);

      // Include mapping + client/staff lookup data so UI can render dropdowns
      const [mapping, clients, staff] = await Promise.all([
        loadMapping(),
        sb(`clients?select=id,name&order=name.asc`),
        sb(`staff?role=in.(systems_manager,systems_executor,admin)&select=id,name,role,email`),
      ]);

      return res.status(200).json({
        data: parsed,
        mapping,
        clients: clients || [],
        staff: staff || [],
        stafflookup: ASANA_TO_STAFF_EMAIL,
        total_open: openTasks.length,
        already_imported: importedGids.size,
      });
    }

    // ─── POST: either save a mapping or import one Asana ticket ──────────
    if (req.method === "POST") {
      // Sub-action: upsert academy mapping (folded in to keep function count <= 12)
      if (req.body?.kind === "mapping") {
        const { asana_name, client_id = null, skip = false } = req.body;
        if (!asana_name) return res.status(400).json({ error: "asana_name required" });
        const upsert = await fetch(`${SUPABASE_URL}/rest/v1/academy_mappings`, {
          method: "POST",
          headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            asana_name,
            client_id: skip ? null : client_id,
            skip,
            created_by: me.id,
          }),
        });
        if (!upsert.ok) {
          const errText = await upsert.text();
          return res.status(500).json({ error: `upsert failed: ${errText}` });
        }
        const [row] = await upsert.json();
        return res.status(200).json({ data: row });
      }

      const {
        asana_gid,
        client_id,
        category,       // 'systems' | 'website' | 'ads' | 'other'
        type,           // 'error' | 'change' | 'build'
        priority,       // 'standard' | 'red_alert'
        title,
        fields,         // jsonb — type-specific
        menu_item,      // optional (for build type)
        assigned_to,    // staff uuid (optional)
        asana_created_at,
        due_date,
      } = req.body || {};

      if (!asana_gid) return res.status(400).json({ error: "asana_gid required" });
      if (!client_id) return res.status(400).json({ error: "client_id required" });
      if (!type || !["error","change","build"].includes(type)) return res.status(400).json({ error: "type invalid" });
      if (!category || !["systems","website","ads","other"].includes(category)) return res.status(400).json({ error: "category invalid" });

      // Guard: already imported?
      const existing = await sb(`tickets?asana_gid=eq.${asana_gid}&select=id`);
      if (existing && existing.length) return res.status(409).json({ error: "already imported", data: existing[0] });

      const row = {
        client_id,
        type,
        category,
        status: "open",
        priority: priority || "standard",
        fields: { ...(fields || {}), title: title || null },
        menu_item: menu_item || null,
        assigned_to: assigned_to || null,
        source: "asana_import",
        asana_gid,
        submitted_at: asana_created_at || new Date().toISOString(),
        due_date: due_date || null,
      };

      // If we're pre-assigning during import, set delegated metadata too
      if (assigned_to) {
        row.status = "delegated";
        row.delegated_by = me.id;
        row.delegated_at = new Date().toISOString();
      }

      const created = await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
        method: "POST",
        headers: { ...SB_HEADERS, Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!created.ok) {
        const errText = await created.text();
        return res.status(500).json({ error: `insert failed: ${errText}` });
      }
      const [inserted] = await created.json();
      return res.status(201).json({ data: inserted });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("asana-import error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
