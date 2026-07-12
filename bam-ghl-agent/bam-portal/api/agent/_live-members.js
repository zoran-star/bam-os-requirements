// Read-path helper: the set of GHL contact ids that are already LIVE (paying)
// members for an academy. Every Hawkeye deck's `list-ready` uses it to hide a
// signed-up lead INSTANTLY at read time - defense-in-depth alongside the
// detector's isLiveMember guards and the signup cancel sweep (a card that was
// cancelled a second ago, or an opp whose won-mark missed, still won't show).
//
// One cheap query, no GHL token needed. Matches on ghl_contact_id (the key every
// deck card carries) - the same semantics as the per-lead isLiveMember guards, so
// a converted parent is hidden even if a sibling shares the contact. Fails OPEN
// (empty set) so a DB blip shows the unfiltered deck rather than an empty one.
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

// Set<string> of ghl_contact_id for this academy's live members. Empty on any error.
export async function liveMemberContactIds(clientId) {
  if (!clientId) return new Set();
  try {
    const rows = await sb(`members?client_id=eq.${encodeURIComponent(clientId)}&status=eq.live&ghl_contact_id=not.is.null&select=ghl_contact_id`);
    return new Set((Array.isArray(rows) ? rows : []).map(r => String(r.ghl_contact_id)).filter(Boolean));
  } catch (e) {
    console.error("[_live-members] liveMemberContactIds failed (soft):", e.message);
    return new Set();
  }
}
