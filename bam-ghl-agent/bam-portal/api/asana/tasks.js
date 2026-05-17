// Vercel Serverless Function — Asana Tasks (combined: tasks + import)
//
// Default mode (no ?import flag):
//   GET   : list tasks (mode=user|project|projects|detail|comments|subtasks)
//   POST  : create task / add comment / add subtask
//   PATCH : update task
//
// Import mode (?import=1) — merged from former /api/asana-import to stay under
// the Hobby plan's 12-function cap. vercel.json rewrites /api/asana-import to
// /api/asana/tasks?import=1, so callers don't need to change.
//   GET  ?import=1                  : list unimported open tickets from "Tickets - MASTER"
//   POST ?import=1                  : import one Asana ticket as a portal ticket
//   POST ?import=1  body.kind=mapping: upsert an academy_mappings row

const ASANA_API = "https://app.asana.com/api/1.0";

const WORKSPACE_GID = "1201652590043795";
const TICKETS_MASTER_PROJECT = "1211109205654944";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// BAM team member GIDs
const TEAM_MEMBERS = {
  mike: "1204629688846292",
  coleman: "1201652586650919",
  silva: "1207912647792637",
  zoran: "1207912763848532",
  graham: "1207268337470309",
  cameron: "1210063466337646",
  elijah: "1210664529037826",
};

// BAM Business project GIDs (fallback for project-based queries)
const BAM_PROJECTS = {
  admin: "1211102792586430",
  content: "1211102791267744",
  systems: "1211102792586445",
  marketing: "1211102792586427",
};

// Map Asana assignee name → staff email (for import resolution)
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

// ── Generic fetch helpers ────────────────────────────────
async function asanaFetch(path, options = {}) {
  const res = await fetch(`${ASANA_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asana API ${res.status}: ${err}`);
  }
  return res.json();
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...SB_HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Task mapper (for default mode) ───────────────────────
function mapTask(t) {
  return {
    id: t.gid,
    title: t.name || "",
    assignee: t.assignee?.name || null,
    assigneeId: t.assignee?.gid || null,
    dueDate: t.due_on || null,
    completed: t.completed || false,
    notes: t.notes || "",
    htmlNotes: t.html_notes || "",
    project: t.memberships?.[0]?.project?.name || "",
    projectId: t.memberships?.[0]?.project?.gid || "",
    section: t.memberships?.[0]?.section?.name || "",
    permalink: t.permalink_url || "",
    createdAt: t.created_at || "",
    modifiedAt: t.modified_at || "",
    startDate: t.start_on || null,
    liked: t.liked || false,
    numLikes: t.num_likes || 0,
    tags: (t.tags || []).map(tag => ({ id: tag.gid, name: tag.name })),
    followers: (t.followers || []).map(f => ({ id: f.gid, name: f.name })),
    parent: t.parent ? { id: t.parent.gid, title: t.parent.name } : null,
    numSubtasks: t.num_subtasks || 0,
  };
}

// ── Import-mode helpers ──────────────────────────────────
async function verifyStaffForImport(req) {
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
  const allowed = ["admin", "systems_manager"];
  if (!allowed.includes(me.role)) return null;
  return me;
}

function parseNotes(notes) {
  const out = { academy: "", email: "", category: "", title: "", description: "" };
  if (!notes) return out;
  const text = notes.replace(/\r\n/g, "\n");
  const FIELDS = [
    { key: "academy",     label: /Academy:\s*\n/i },
    { key: "email",       label: /Email address[^\n]*:\s*\n/i },
    { key: "category",    label: /Category:\s*\n/i },
    { key: "title",       label: /Title:\s*\n/i },
    { key: "description", label: /(Issue Description|Description|Details)\s*:\s*\n/i },
  ];
  const found = [];
  for (const f of FIELDS) {
    const m = text.match(f.label);
    if (m) found.push({ key: f.key, start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    out[cur.key] = text.slice(cur.end, next ? next.start : text.length).trim();
  }
  return out;
}

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
      category:    (parsed.category || cf.category || "").toLowerCase() || null,
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

// ─────────────────────────────────────────────────────────
// Main handler — routes on ?import=1
// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!process.env.ASANA_ACCESS_TOKEN) {
    return res.status(500).json({ error: "ASANA_ACCESS_TOKEN not configured" });
  }

  if (req.query.import === "1" || req.query.import === "true") {
    return importHandler(req, res);
  }

  return tasksHandler(req, res);
}

// ─────────────────────────────────────────────────────────
// Default mode: tasks list / create / update
// ─────────────────────────────────────────────────────────
async function tasksHandler(req, res) {
  try {
    if (req.method === "GET") {
      if (req.query.mode === "projects") {
        const data = await asanaFetch(`/projects?workspace=${WORKSPACE_GID}&limit=100&opt_fields=gid,name,archived,color,notes`);
        const projects = (data.data || []).map(p => ({
          id: p.gid, name: p.name, archived: p.archived || false, color: p.color || "", notes: p.notes || "",
        }));
        return res.status(200).json({ data: projects });
      }

      const mode = req.query.mode || "user";
      const userKey = req.query.user || "mike";
      const projectKey = req.query.project || "all";
      const completedSince = req.query.completed_since || "now";
      const taskId = req.query.taskId;

      if (mode === "detail" && taskId) {
        const DETAIL_FIELDS = "name,assignee,assignee.name,assignee.gid,due_on,start_on,completed,notes,html_notes,memberships.project.name,memberships.project.gid,memberships.section.name,permalink_url,created_at,modified_at,liked,num_likes,tags,tags.name,followers,followers.name,parent,parent.name,num_subtasks";
        const data = await asanaFetch(`/tasks/${taskId}?opt_fields=${DETAIL_FIELDS}`);
        return res.status(200).json({ data: mapTask(data.data) });
      }

      if (mode === "comments" && taskId) {
        const data = await asanaFetch(`/tasks/${taskId}/stories?opt_fields=text,html_text,created_at,created_by,created_by.name,type,resource_subtype&limit=50`);
        const comments = (data.data || [])
          .filter(s => s.resource_subtype === "comment_added")
          .map(s => ({
            id: s.gid,
            text: s.text || "",
            htmlText: s.html_text || "",
            createdAt: s.created_at,
            author: s.created_by?.name || "Unknown",
          }));
        return res.status(200).json({ data: comments });
      }

      if (mode === "subtasks" && taskId) {
        const data = await asanaFetch(`/tasks/${taskId}/subtasks?opt_fields=name,completed,assignee,assignee.name,due_on&limit=50`);
        const subtasks = (data.data || []).map(st => ({
          id: st.gid,
          title: st.name || "",
          completed: st.completed || false,
          assignee: st.assignee?.name || null,
          dueDate: st.due_on || null,
        }));
        return res.status(200).json({ data: subtasks });
      }

      const OPT_FIELDS = "name,assignee,assignee.name,assignee.gid,due_on,start_on,completed,notes,html_notes,memberships.project.name,memberships.project.gid,memberships.section.name,permalink_url,created_at,modified_at,liked,num_likes,tags,tags.name,followers,followers.name,parent,parent.name,num_subtasks";

      let allTasks = [];

      if (mode === "user") {
        const userId = TEAM_MEMBERS[userKey.toLowerCase()] || userKey;
        const url = `/tasks?assignee=${userId}&workspace=${WORKSPACE_GID}&completed_since=${completedSince}&opt_fields=${OPT_FIELDS}&limit=100`;
        const data = await asanaFetch(url);
        allTasks = (data.data || []).map(mapTask);
      } else {
        const projectIds = projectKey === "all"
          ? Object.values(BAM_PROJECTS)
          : [BAM_PROJECTS[projectKey] || projectKey];
        for (const pid of projectIds) {
          const data = await asanaFetch(
            `/tasks?project=${pid}&completed_since=${completedSince}&opt_fields=${OPT_FIELDS}&limit=50`
          );
          allTasks = allTasks.concat((data.data || []).map(mapTask));
        }
      }

      return res.status(200).json({ data: allTasks });
    }

    if (req.method === "POST") {
      const { action } = req.body;

      if (action === "comment") {
        const { taskId, text } = req.body;
        if (!taskId || !text) return res.status(400).json({ error: "taskId and text are required" });
        const data = await asanaFetch(`/tasks/${taskId}/stories`, {
          method: "POST",
          body: JSON.stringify({ data: { text } }),
        });
        return res.status(201).json({ data: { id: data.data.gid, text: data.data.text, createdAt: data.data.created_at, author: data.data.created_by?.name || "You" } });
      }

      if (action === "subtask") {
        const { taskId, title } = req.body;
        if (!taskId || !title) return res.status(400).json({ error: "taskId and title are required" });
        const data = await asanaFetch(`/tasks/${taskId}/subtasks`, {
          method: "POST",
          body: JSON.stringify({ data: { name: title } }),
        });
        return res.status(201).json({ data: { id: data.data.gid, title: data.data.name, completed: false } });
      }

      const { title, assignee, dueDate, notes, project } = req.body;
      const projectId = BAM_PROJECTS[project] || project || BAM_PROJECTS.admin;

      const taskData = {
        data: {
          name: title,
          projects: [projectId],
          ...(assignee && { assignee }),
          ...(dueDate && { due_on: dueDate }),
          ...(notes && { notes }),
        },
      };

      const data = await asanaFetch("/tasks", {
        method: "POST",
        body: JSON.stringify(taskData),
      });

      return res.status(201).json({ data: mapTask(data.data) });
    }

    if (req.method === "PATCH") {
      const { id, ...fields } = req.body;
      if (!id) return res.status(400).json({ error: "id is required" });

      const updateData = { data: {} };
      if (fields.title !== undefined) updateData.data.name = fields.title;
      if (fields.completed !== undefined) updateData.data.completed = fields.completed;
      if (fields.assignee !== undefined) updateData.data.assignee = fields.assignee;
      if (fields.dueDate !== undefined) updateData.data.due_on = fields.dueDate;
      if (fields.notes !== undefined) updateData.data.notes = fields.notes;

      const data = await asanaFetch(`/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      return res.status(200).json({ data: mapTask(data.data) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Asana API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Import mode: list/import Asana → portal tickets
// ─────────────────────────────────────────────────────────
async function importHandler(req, res) {
  const me = await verifyStaffForImport(req);
  if (!me) return res.status(401).json({ error: "unauthorized" });

  try {
    if (req.method === "GET") {
      const OPT_FIELDS = [
        "name","notes","completed","due_on","created_at","modified_at","permalink_url","num_subtasks",
        "assignee.name","assignee.gid",
        "custom_fields.name","custom_fields.enum_value.name","custom_fields.text_value",
      ].join(",");

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const asanaRes = await asanaFetch(
        `/tasks?project=${TICKETS_MASTER_PROJECT}&modified_since=${ninetyDaysAgo}&opt_fields=${OPT_FIELDS}&limit=100`
      );
      const openTasks = (asanaRes.data || []).filter(t => !t.completed);

      const importedRows = await sb(`tickets?source=eq.asana_import&asana_gid=not.is.null&select=asana_gid`);
      const importedGids = new Set((importedRows || []).map(r => r.asana_gid));

      const parsed = openTasks
        .map(t => mapAsanaTicket(t, importedGids))
        .filter(Boolean);

      const [mapping, clients, staff] = await Promise.all([
        loadMapping(),
        sb(`clients?select=id,business_name&order=business_name.asc`),
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

    if (req.method === "POST") {
      // Sub-action: upsert academy mapping
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
        asana_gid, client_id, category, type, priority, title, fields,
        menu_item, assigned_to, asana_created_at, due_date,
      } = req.body || {};

      if (!asana_gid) return res.status(400).json({ error: "asana_gid required" });
      if (!client_id) return res.status(400).json({ error: "client_id required" });
      if (!type || !["error","change","build"].includes(type)) return res.status(400).json({ error: "type invalid" });
      if (!category || !["systems","website","ads","other"].includes(category)) return res.status(400).json({ error: "category invalid" });

      const existing = await sb(`tickets?asana_gid=eq.${asana_gid}&select=id`);
      if (existing && existing.length) return res.status(409).json({ error: "already imported", data: existing[0] });

      const row = {
        client_id, type, category,
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
