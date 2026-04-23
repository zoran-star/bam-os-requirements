// Asana Service — always tries live API, returns empty data on error

export async function fetchTasks({ user = "mike", mode = "user", project = "all" } = {}) {
  try {
    const params = new URLSearchParams({ mode, user, project });
    const res = await fetch(`/api/asana/tasks?${params}`);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    // Map section names to status
    const tasks = (json.data || []).map(t => ({
      ...t,
      status: t.completed ? "done"
        : t.section?.toLowerCase().includes("progress") ? "in_progress"
        : t.section?.toLowerCase().includes("review") ? "review"
        : "todo",
    }));
    return { data: tasks, error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

// Fetch tasks for all team members (aggregated view)
export async function fetchAllTeamTasks() {
  try {
    const members = ["mike", "coleman", "silva", "zoran", "graham"];
    const results = await Promise.all(
      members.map(user =>
        fetch(`/api/asana/tasks?mode=user&user=${user}`)
          .then(r => r.json())
          .then(json => json.data || [])
          .catch(() => [])
      )
    );
    // Deduplicate by task ID
    const seen = new Set();
    const allTasks = results.flat().filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).map(t => ({
      ...t,
      status: t.completed ? "done"
        : t.section?.toLowerCase().includes("progress") ? "in_progress"
        : t.section?.toLowerCase().includes("review") ? "review"
        : "todo",
    }));
    return { data: allTasks, error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createTask({ title, assignee, dueDate, notes, project }) {
  try {
    const res = await fetch("/api/asana/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, assignee, dueDate, notes, project }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: { ...json.data, status: "todo" }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateTask(id, fields) {
  try {
    const res = await fetch("/api/asana/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchTaskDetail(taskId) {
  try {
    const res = await fetch(`/api/asana/tasks?mode=detail&taskId=${taskId}`);
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchComments(taskId) {
  try {
    const res = await fetch(`/api/asana/tasks?mode=comments&taskId=${taskId}`);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function addComment(taskId, text) {
  try {
    const res = await fetch("/api/asana/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "comment", taskId, text }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchSubtasks(taskId) {
  try {
    const res = await fetch(`/api/asana/tasks?mode=subtasks&taskId=${taskId}`);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function addSubtask(taskId, title) {
  try {
    const res = await fetch("/api/asana/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "subtask", taskId, title }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}
