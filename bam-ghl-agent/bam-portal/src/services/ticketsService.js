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
  if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}`, me: null };
  return { data: json.data, error: null, me: json.me || null };
}

export async function fetchTickets() {
  return req("/api/tickets?scope=all");
}

export async function fetchTicket(id) {
  return req(`/api/tickets?id=${id}`);
}

export async function fetchDelegationPool() {
  return req("/api/tickets?resource=staff");
}

function patch(id, action, body) {
  return req(`/api/tickets?id=${id}&action=${action}`, {
    method: "PATCH",
    body: JSON.stringify(body || {}),
  });
}

export const delegateTicket       = (id, assigned_to)          => patch(id, "delegate", { assigned_to });
export const startTicket          = (id)                       => patch(id, "start");
export const saveTicketNotes      = (id, staff_notes)          => patch(id, "notes", { staff_notes });
export const saveUserGuide        = (id, user_guide)           => patch(id, "save_user_guide", { user_guide });
export const requestClientAction  = (id, client_action_request)=> patch(id, "request_client", { client_action_request });
export const cancelClientRequest  = (id)                       => patch(id, "cancel_client_request");
export const submitForReview      = (id, user_guide)           => patch(id, "submit_review", { user_guide });
export const approveTicket        = (id)                       => patch(id, "approve");
export const denyTicket           = (id, denial_notes)         => patch(id, "deny", { denial_notes });
