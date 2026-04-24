// Clients Service — reads from /api/clients (Supabase clients table + live Stripe revenue)

export async function fetchClients() {
  try {
    const res = await fetch("/api/clients");
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchClient(id) {
  try {
    const res = await fetch(`/api/clients?id=${encodeURIComponent(id)}`);
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}
