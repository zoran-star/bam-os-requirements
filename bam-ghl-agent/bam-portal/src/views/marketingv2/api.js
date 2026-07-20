import { supabase } from "../../lib/supabase";

// Every MUTATION on a v2_ticket goes through the serverless API (service role +
// the P6 notify hooks). Reads stay on supabase-js (RLS is_staff()). We attach
// the logged-in staff member's Supabase access token as a Bearer.

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data?.session?.access_token || ""}`,
  };
}

async function post(action, id, body) {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/v2-tickets?action=${action}&id=${encodeURIComponent(id)}`,
    { method: "POST", headers, body: JSON.stringify(body || {}) }
  );
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json || {};
}

// marketing_ask went live: resolves + archives finals to the client's Content
// Library category 'ads' (server-side).
export function markLive(id) { return post("mark-live", id, {}); }

// Generic status move (budget / remove / campaign "mark done" -> resolved).
export function setStatus(id, status, extra = {}) {
  return post("status", id, { status, ...extra });
}

// Staff reply on the shared thread. internal=true keeps it staff-only (used by
// the Ping Systems note).
export function reply(id, body, internal = false) {
  return post("reply", id, { body, internal });
}

// Move owner / lane / type.
export function reassign(id, patch) { return post("reassign", id, patch); }

// Park the ticket waiting_client (reply / upload / approval).
export function requestClientAction(id, kind, message) {
  return post("request-client-action", id, { kind, message });
}
