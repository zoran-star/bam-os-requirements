// Vercel Serverless Function — Asana Tasks
// GET: list tasks from BAM Business projects
// POST: create task
// PATCH: update task (complete, reassign, etc.)

const ASANA_API = "https://app.asana.com/api/1.0";

const WORKSPACE_GID = "1201652590043795";

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

export default async function handler(req, res) {
  if (!process.env.ASANA_ACCESS_TOKEN) {
    return res.status(500).json({ error: "ASANA_ACCESS_TOKEN not configured" });
  }

  try {
    if (req.method === "GET") {
      const mode = req.query.mode || "user"; // "user", "project", "detail", "comments", "subtasks"
      const userKey = req.query.user || "mike"; // default to Mike
      const projectKey = req.query.project || "all";
      const completedSince = req.query.completed_since || "now";
      const taskId = req.query.taskId;

      // Fetch single task detail
      if (mode === "detail" && taskId) {
        const DETAIL_FIELDS = "name,assignee,assignee.name,assignee.gid,due_on,start_on,completed,notes,html_notes,memberships.project.name,memberships.project.gid,memberships.section.name,permalink_url,created_at,modified_at,liked,num_likes,tags,tags.name,followers,followers.name,parent,parent.name,num_subtasks";
        const data = await asanaFetch(`/tasks/${taskId}?opt_fields=${DETAIL_FIELDS}`);
        return res.status(200).json({ data: mapTask(data.data) });
      }

      // Fetch comments/stories for a task
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

      // Fetch subtasks for a task
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
        // Fetch tasks assigned to a specific user (their "My Tasks")
        const userId = TEAM_MEMBERS[userKey.toLowerCase()] || userKey;
        let url = `/tasks?assignee=${userId}&workspace=${WORKSPACE_GID}&completed_since=${completedSince}&opt_fields=${OPT_FIELDS}&limit=100`;
        const data = await asanaFetch(url);
        allTasks = (data.data || []).map(mapTask);
      } else {
        // Fetch from projects
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

      // Add a comment to a task
      if (action === "comment") {
        const { taskId, text } = req.body;
        if (!taskId || !text) return res.status(400).json({ error: "taskId and text are required" });
        const data = await asanaFetch(`/tasks/${taskId}/stories`, {
          method: "POST",
          body: JSON.stringify({ data: { text } }),
        });
        return res.status(201).json({ data: { id: data.data.gid, text: data.data.text, createdAt: data.data.created_at, author: data.data.created_by?.name || "You" } });
      }

      // Create a subtask
      if (action === "subtask") {
        const { taskId, title } = req.body;
        if (!taskId || !title) return res.status(400).json({ error: "taskId and title are required" });
        const data = await asanaFetch(`/tasks/${taskId}/subtasks`, {
          method: "POST",
          body: JSON.stringify({ data: { name: title } }),
        });
        return res.status(201).json({ data: { id: data.data.gid, title: data.data.name, completed: false } });
      }

      // Create a new task
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
      // Update a task
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
