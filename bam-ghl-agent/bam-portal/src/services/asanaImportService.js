import { supabase } from "../lib/supabase";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

async function req(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(await authHeaders()), ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}` };
  return { data: json.data, error: null, extra: json };
}

export async function fetchAsanaImport() {
  const { data, error, extra } = await req("/api/asana-import");
  return { data, error, mapping: extra?.mapping || {}, clients: extra?.clients || [], staff: extra?.staff || [], stafflookup: extra?.stafflookup || {} };
}

export async function importAsanaTicket(payload) {
  return req("/api/asana-import", { method: "POST", body: JSON.stringify(payload) });
}

export async function saveAcademyMapping({ asana_name, client_id = null, skip = false }) {
  return req("/api/asana-import", { method: "POST", body: JSON.stringify({ kind: "mapping", asana_name, client_id, skip }) });
}
