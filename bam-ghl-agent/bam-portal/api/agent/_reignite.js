// 🔥 Reignition helpers (Zoran 2026-07-10). A "yes, but later" lead is PARKED in
// place: an agent_reignitions row holds the date + the pre-written re-engagement
// message. The lead stays in their current stage; the owning agent's proactive
// detector passes skip them (reigniteContactIdSet), the detect cron fires due rows
// into a kind='reignite_due' Hawkeye card (dueReignitions + markCarded), and any
// real activity cancels the park (cancelReignitions - called by the inbound
// webhook and every terminal/move agent action).
//
// Everything here fails OPEN/soft: a DB blip never blocks a send or a detector run.
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

// Validate + normalize a reignite date. Accepts 'YYYY-MM-DD' (from the agents'
// propose_reply tool or the deck's date picker) or a full ISO datetime. A bare
// date lands at 14:00Z (~9-10am Toronto - same convention as the closing agent's
// followup_not_before). Must be in the future and within `maxDays` (default 18
// months). Returns the ISO string or null when invalid.
export function normalizeReigniteAt(raw, { maxDays = 550 } = {}) {
  if (!raw || typeof raw !== "string") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? `${raw.trim()}T14:00:00Z` : raw.trim();
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  if (t <= Date.now()) return null;
  if (t > Date.now() + maxDays * 86400000) return null;
  return new Date(t).toISOString();
}

// Park a lead: one scheduled reignition per contact per academy - an existing
// scheduled row is superseded (canceled) first, so a re-park always wins. Throws
// on failure (the confirm-reignite action surfaces the error to the deck).
export async function scheduleReignition({ clientId, contactId, contactName, agent, reigniteAt, message, reason, source = "agent", createdBy = null }) {
  await sb(`agent_reignitions?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.scheduled`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "canceled", cancel_reason: "superseded by a new reignition", updated_at: new Date().toISOString() }),
  });
  const [row] = await sb(`agent_reignitions`, {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      client_id: clientId, ghl_contact_id: String(contactId), contact_name: contactName || null,
      agent, reignite_at: reigniteAt, message: String(message || "").trim(),
      reason: reason ? String(reason).slice(0, 500) : null, source, created_by: createdBy,
    }]),
  });
  return row || null;
}

// Auto-cancel a contact's scheduled reignition (real reply / booked / enrolled /
// lost / unqualified / ghosted / left the stage). Best-effort: returns how many
// rows were canceled, 0 on error - callers never block on this.
export async function cancelReignitions(clientId, contactId, reason) {
  if (!clientId || !contactId) return 0;
  try {
    const rows = await sb(`agent_reignitions?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.scheduled`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "canceled", cancel_reason: String(reason || "").slice(0, 200) || null, updated_at: new Date().toISOString() }),
    });
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e) {
    console.error("[_reignite] cancelReignitions failed (soft):", e.message);
    return 0;
  }
}

// The set of contact ids with a SCHEDULED reignition for an academy - the agents'
// proactive detector passes (openers, ghost proposals, scripted confirms, closing
// follow-up loop) skip these leads: they said "later", so silence is the plan.
// Fails OPEN (empty set) so a blip never freezes a queue.
export async function reigniteContactIdSet(clientId) {
  const set = new Set();
  if (!clientId) return set;
  try {
    const rows = await sb(`agent_reignitions?client_id=eq.${clientId}&status=eq.scheduled&select=ghl_contact_id`);
    for (const r of (Array.isArray(rows) ? rows : [])) if (r.ghl_contact_id) set.add(String(r.ghl_contact_id));
  } catch (e) {
    console.error("[_reignite] reigniteContactIdSet failed (failing open):", e.message);
  }
  return set;
}

// Like reigniteContactIdSet, but carries each park's created_at so a detector can
// tell a GENUINE new reply (inbound AFTER the park) from a lead who is simply
// still inbound-last because their park was silent (no ack) or the ack send failed.
// Cancelling on mere queue membership wrongly killed silent parks every cron
// (Zoran 2026-07-10). Fails OPEN (empty map). Map<cid, { created_at, reignite_at }>.
export async function reigniteParkMap(clientId) {
  const map = new Map();
  if (!clientId) return map;
  try {
    const rows = await sb(`agent_reignitions?client_id=eq.${clientId}&status=eq.scheduled&select=ghl_contact_id,created_at,reignite_at`);
    for (const r of (Array.isArray(rows) ? rows : [])) if (r.ghl_contact_id) map.set(String(r.ghl_contact_id), { created_at: r.created_at || null, reignite_at: r.reignite_at || null });
  } catch (e) {
    console.error("[_reignite] reigniteParkMap failed (failing open):", e.message);
  }
  return map;
}

// Did the lead genuinely reply AFTER we parked them? True only when we can prove
// a new inbound landed after the park's created_at. No park row or no lead
// timestamp => false (KEEP the park - cancelling on ambiguity is the harm we are
// fixing; the inbound webhook is the authoritative canceller for real replies).
export function repliedAfterPark(park, lastInboundAt) {
  if (!park || !park.created_at || !lastInboundAt) return false;
  const parked = new Date(park.created_at).getTime();
  const last = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(parked) || !Number.isFinite(last)) return false;
  return last > parked;
}

// Due rows for ONE agent's detect cron (reignite_at has arrived, still scheduled).
// Fails soft (empty list).
export async function dueReignitions(clientId, agent, { limit = 10 } = {}) {
  try {
    const rows = await sb(`agent_reignitions?client_id=eq.${clientId}&agent=eq.${encodeURIComponent(agent)}&status=eq.scheduled&reignite_at=lte.${new Date().toISOString()}&select=*&order=reignite_at.asc&limit=${limit}`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error("[_reignite] dueReignitions failed (soft):", e.message);
    return [];
  }
}

// Status transitions used by the fire step + the send path. Best-effort.
export async function markReignition(id, status, extra = {}) {
  try {
    const stamp = status === "carded" ? { carded_at: new Date().toISOString() }
      : status === "done" ? { done_at: new Date().toISOString() } : {};
    await sb(`agent_reignitions?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, ...stamp, ...extra, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("[_reignite] markReignition failed (soft):", e.message);
  }
}

// Scheduled reignitions for the deck badges / drawer chip / home list.
export async function listReignitions(clientId) {
  try {
    const rows = await sb(`agent_reignitions?client_id=eq.${clientId}&status=eq.scheduled&select=id,ghl_contact_id,contact_name,agent,reignite_at,message,reason,source,created_at&order=reignite_at.asc&limit=200`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error("[_reignite] listReignitions failed (soft):", e.message);
    return [];
  }
}
