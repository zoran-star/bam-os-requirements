// Notion Service — calls /api/notion/query when connected, returns empty on failure

const CONNECTED = import.meta.env.VITE_NOTION_CONNECTED === "true";

async function notionQuery(body) {
  const res = await fetch("/api/notion/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Notion query failed");
  return json.data;
}

// ─── Action Items ───────────────────────────────────────────────────────────

export async function fetchActionItems(filters = {}) {
  if (!CONNECTED) {
    return { data: [], error: null };
  }

  try {
    const data = await notionQuery({ type: "action_items" });
    let items = data || [];
    if (filters.status) items = items.filter(i => i.status === filters.status);
    if (filters.client) items = items.filter(i => i.client === filters.client);
    if (filters.urgency) items = items.filter(i => i.urgency === filters.urgency);
    if (filters.owner) items = items.filter(i => i.owner === filters.owner);
    if (filters.category) items = items.filter(i => i.category === filters.category);
    return { data: items, error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createActionItem(item) {
  if (!CONNECTED) {
    return { data: { ...item, id: `ai-local-${Date.now()}` }, error: null };
  }
  try {
    const res = await fetch("/api/notion/action-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateActionItem(id, fields) {
  if (!CONNECTED) {
    return { data: { id, ...fields }, error: null };
  }
  try {
    const res = await fetch("/api/notion/action-items", {
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

// ─── SOPs (tree + content) ──────────────────────────────────────────────────

export async function fetchSOPTree() {
  if (!CONNECTED) {
    return { data: [], error: null };
  }

  try {
    const data = await notionQuery({ type: "sop_tree" });
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchSOPContent(pageId) {
  if (!CONNECTED) {
    return { data: null, error: "Not connected" };
  }

  try {
    const data = await notionQuery({ type: "sop_content", pageId });
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// Legacy flat fetch (backwards compat)
export async function fetchSOPs() {
  if (!CONNECTED) {
    return { data: [], categories: [], error: null };
  }
  try {
    const data = await notionQuery({ type: "sops" });
    // Build categories from the returned data
    const catSet = new Set((data || []).map(s => s.category));
    const categories = [...catSet].map(id => ({
      id,
      label: id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    }));
    return { data: data || [], categories, error: null };
  } catch (err) {
    return { data: [], categories: [], error: err.message };
  }
}

// ─── All Clients ────────────────────────────────────────────────────────────

export async function fetchAllClients() {
  if (!CONNECTED) {
    return { data: null, error: null };
  }

  try {
    const data = await notionQuery({ type: "all_clients" });
    return { data: data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ─── Client Profile (single) ────────────────────────────────────────────────

export async function fetchClientProfile(clientName) {
  if (!CONNECTED) {
    return { data: null, error: null };
  }

  try {
    const data = await notionQuery({ type: "client_profile", clientName });
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ─── Solution Warehouses ────────────────────────────────────────────────────

export async function fetchSolutionWarehouses(category) {
  if (!CONNECTED) {
    return { data: [], error: null };
  }

  try {
    const data = await notionQuery({ type: "solution_warehouses", category });
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}
