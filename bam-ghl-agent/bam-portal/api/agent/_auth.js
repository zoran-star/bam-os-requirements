// Shared auth for the agent inbox (approvals + follow-ups).
//
// resolveStaff      → BAM staff only (any academy). Used for the autonomy MODE
//                     switch and cross-academy staff panels.
// resolveAgentActor → BAM staff OR an academy member who may OPERATE the agent
//                     for THEIR OWN academy (role 'owner' or can_train_agent).
//                     Used so an academy owner can approve/send the agent's
//                     drafts for their own leads. `.canActOn(clientId)` enforces
//                     the per-academy scope.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function getUser(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? u : null;
}

async function isStaffUser(user) {
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && !!staff[0];
}

// BAM staff only → returns the email (string) or null.
export async function resolveStaff(req) {
  const user = await getUser(req);
  if (!user) return null;
  return (await isStaffUser(user)) ? (user.email || "staff") : null;
}

// Staff OR academy owner / can_train_agent member.
export async function resolveAgentActor(req) {
  const user = await getUser(req);
  if (!user) return null;
  const staff = await isStaffUser(user);
  let mem = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&or=(role.eq.owner,can_train_agent.eq.true)&select=client_id`);
  if ((!mem || !mem.length) && user.email) {
    mem = await sb(`client_users?email=eq.${encodeURIComponent(user.email)}&status=eq.active&or=(role.eq.owner,can_train_agent.eq.true)&select=client_id`);
  }
  const academyClientIds = Array.isArray(mem) ? mem.map(m => m.client_id) : [];
  return {
    email: user.email || "user",
    isStaff: staff,
    academyClientIds,
    canActOn: (clientId) => staff || academyClientIds.includes(clientId),
  };
}
