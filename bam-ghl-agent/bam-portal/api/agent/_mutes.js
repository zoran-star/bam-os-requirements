// Per-lead bot mute helpers (guardrail #6). A mute row stops a bot from drafting
// on its own for one contact - the agent detectors call mutedContactIdSet() once
// per run to skip muted leads, and the single-contact draft path calls isMuted().
// A NULL `agent` row mutes ALL bots for that lead; an agent-specific row mutes just
// that one. Explicit human sends are never gated by these.
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Is this contact muted for `agent`? Matches an agent-specific mute OR a global
// (agent IS NULL) mute. Fails OPEN (false) on a DB error so a blip never silently
// freezes a bot - the worst case is one un-skipped draft, which a human still approves.
export async function isMuted(clientId, contactId, agent) {
  if (!clientId || !contactId) return false;
  try {
    const rows = await sb(`agent_mutes?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&or=(agent.is.null,agent.eq.${encodeURIComponent(agent || "")})&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error("[_mutes] isMuted failed (failing open):", e.message);
    return false;
  }
}

// The set of contact ids muted for `agent` (agent-specific OR global). One query
// per detector run. Fails OPEN (empty set) so a blip never freezes the whole queue.
export async function mutedContactIdSet(clientId, agent) {
  const set = new Set();
  if (!clientId) return set;
  try {
    const rows = await sb(`agent_mutes?client_id=eq.${clientId}&or=(agent.is.null,agent.eq.${encodeURIComponent(agent || "")})&select=ghl_contact_id`);
    for (const r of (Array.isArray(rows) ? rows : [])) if (r.ghl_contact_id) set.add(String(r.ghl_contact_id));
  } catch (e) {
    console.error("[_mutes] mutedContactIdSet failed (failing open):", e.message);
  }
  return set;
}
