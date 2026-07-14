import { withSentryApiRoute } from "../_sentry.js";

// Sales-machine readiness for one offer (Gap #2 / DETAIL "what's left" view).
//
//   GET /api/offers/setup-status?client_id=&offer_id=
//     → { ok, pipeline_stages, transitions, automations:[{key,approved,steps}],
//         agent_sections, sales_fields, onboarding_fields }
//
// Read-only: powers the Sales section's setup checklist so an owner sees which
// parts of the machine (pipeline, automations, agent facts, form fields) are in
// place and which still need setting up.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
const count = (rows) => Array.isArray(rows) ? rows.length : 0;

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
    const clientId = req.query.client_id;
    let offerId = req.query.offer_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    // Resolve the offer when the caller omits it (the onboarding flow passes only
    // client_id): the published training offer, else the newest training offer.
    let offer = null;
    if (offerId) {
      const rows = await sb(`offers?id=eq.${enc(offerId)}&client_id=eq.${enc(clientId)}&select=id,data&limit=1`);
      offer = Array.isArray(rows) && rows[0];
    } else {
      const rows = await sb(`offers?client_id=eq.${enc(clientId)}&type=eq.training&select=id,data,status&order=status.asc,updated_at.desc`);
      offer = (rows || []).find(o => o.status === "published") || (rows || [])[0] || null;
      offerId = offer ? offer.id : null;
    }
    if (!offerId) {
      // No offer yet - nothing to score. The onboarding flow shows every step as
      // not-done, which is correct (they need to build the offer first).
      return res.status(200).json({ ok: true, offer_id: null, pipeline_stages: 0, transitions: 0, automations: [], agent_sections: 0, sales_fields: 0, onboarding_fields: 0, entry_points: 0, has_policy: false, booking_live: false });
    }

    // Pipeline stages/edges scoped to this offer (or the academy-wide default).
    const offerFilter = `or=(offer_id.eq.${enc(offerId)},offer_id.is.null)`;
    const [stages, edges, autos, agentSecs, salesDefs, onbDefs, eps, clientRows] = await Promise.all([
      sb(`pipeline_stages?client_id=eq.${enc(clientId)}&${offerFilter}&select=role`),
      sb(`stage_transitions?client_id=eq.${enc(clientId)}&${offerFilter}&select=id`),
      sb(`automations?client_id=eq.${enc(clientId)}&select=automation_key,approved`),
      sb(`agent_prompt_sections?client_id=eq.${enc(clientId)}&select=section_key`),
      sb(`custom_field_defs?client_id=eq.${enc(clientId)}&archived=eq.false&section=eq.sales&or=(offer_id.eq.${enc(offerId)},offer_id.is.null)&select=id`),
      sb(`custom_field_defs?client_id=eq.${enc(clientId)}&archived=eq.false&section=eq.onboarding&or=(offer_id.eq.${enc(offerId)},offer_id.is.null)&select=id`),
      sb(`entry_points?client_id=eq.${enc(clientId)}&offer_id=eq.${enc(offerId)}&type=eq.website-form&select=id`),
      sb(`clients?id=eq.${enc(clientId)}&select=booking_provider&limit=1`),
    ]);
    const policy = (offer && offer.data && offer.data.policy) || {};

    return res.status(200).json({
      ok: true,
      offer_id: offerId,
      pipeline_stages: count(stages),
      transitions: count(edges),
      automations: (Array.isArray(autos) ? autos : []).map(a => ({ key: a.automation_key, approved: !!a.approved })),
      agent_sections: count(agentSecs),
      sales_fields: count(salesDefs),
      onboarding_fields: count(onbDefs),
      entry_points: count(eps),
      has_policy: policy && typeof policy === "object" && Object.keys(policy).length > 0,
      booking_live: (Array.isArray(clientRows) && clientRows[0] && clientRows[0].booking_provider) === "portal",
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
