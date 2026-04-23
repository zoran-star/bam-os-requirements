// GHL Service — always tries live API, no feature flag gate

async function fetchWithRetry(url, retries = 2, delay = 2000) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url);
    if (res.status === 429 && i < retries) {
      await new Promise(r => setTimeout(r, delay * (i + 1)));
      continue;
    }
    return res;
  }
}

export async function fetchLocations() {
  try {
    const res = await fetchWithRetry("/api/ghl?action=locations");
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchContacts(location, query = "") {
  try {
    let url = `/api/ghl?action=contacts&location=${encodeURIComponent(location)}`;
    if (query) url += `&query=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], total: json.total || 0, error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchConversations(location, contactId = "") {
  try {
    let url = `/api/ghl?action=conversations&location=${encodeURIComponent(location)}`;
    if (contactId) url += `&contactId=${encodeURIComponent(contactId)}`;
    const res = await fetchWithRetry(url);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchPipelines(location, pipelineId = "") {
  try {
    let url = `/api/ghl?action=pipelines&location=${encodeURIComponent(location)}`;
    if (pipelineId) url += `&pipelineId=${encodeURIComponent(pipelineId)}`;
    const res = await fetchWithRetry(url);
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data || { pipelines: [], opportunities: [] }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchContact(location, contactId) {
  try {
    const res = await fetchWithRetry(`/api/ghl?action=contact&location=${encodeURIComponent(location)}&contactId=${encodeURIComponent(contactId)}`);
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data || null, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchConversationMessages(location, conversationId) {
  try {
    const res = await fetchWithRetry(`/api/ghl?action=messages&location=${encodeURIComponent(location)}&conversationId=${encodeURIComponent(conversationId)}`);
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}
