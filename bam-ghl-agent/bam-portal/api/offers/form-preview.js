import { withSentryApiRoute } from "../_sentry.js";
import { buildFields } from "../website/offer.js";

// Live form preview for the offer wizard's form builder (Gap #5, phase 5A-3).
//
//   GET /api/offers/form-preview?client_id=<uuid>&offer_id=<uuid>&section=sales|onboarding
//     → { ok, section, fields:[{ key, label, type, required, options?, help_text?, placeholder? }] }
//
// Returns the EXACT field list the live free-trial (sales) / intake (onboarding)
// form renders, via the same buildFields() the public offer page uses - so the
// preview never drifts from what a lead / member actually sees. The public
// offer endpoint is CORS-gated to client website domains, so the portal reads
// this JWT-authed sibling instead.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
    const q = req.query || {};
    const clientId = q.client_id;
    const offerId = q.offer_id;
    const section = q.section === "sales" ? "sales" : "onboarding";
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });

    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,title,type,data&limit=1`);
    const offer = Array.isArray(offerRows) && offerRows[0];
    if (!offer) return res.status(404).json({ error: "offer not found for this academy" });

    // Split academy-core + this-offer's section defs the same way the public
    // offer page does (offer_id match OR a multi-offer join link).
    let linkedIds = new Set();
    try {
      const links = (await sb(`custom_field_def_offers?offer_id=eq.${encodeURIComponent(offerId)}&select=field_id`)) || [];
      linkedIds = new Set(links.map(l => l.field_id).filter(Boolean));
    } catch { /* join table not migrated - offer_id match still works */ }
    const defs = (await sb(
      `custom_field_defs?client_id=eq.${encodeURIComponent(clientId)}&archived=eq.false` +
      `&select=id,key,label,type,options,required,section,offer_id,help_text&order=position.asc`
    )) || [];
    const coreDefs = [], sectionDefs = [];
    for (const d of defs) {
      if (!d.offer_id) { coreDefs.push(d); continue; }
      const appliesToOffer = d.offer_id === offerId || linkedIds.has(d.id);
      if (!appliesToOffer) continue;
      if (section === "sales") { if (d.section === "sales") sectionDefs.push(d); }
      else if (d.section !== "sales") sectionDefs.push(d); // onboarding + unsectioned
    }

    const fields = buildFields(offer, [...coreDefs, ...sectionDefs], section);
    return res.status(200).json({ ok: true, section, fields });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "error" });
  }
}

export default withSentryApiRoute(handler);
