import { withSentryApiRoute } from "../_sentry.js";
import { presetEntrySources } from "../agent/presets.js";

// Seed the website entry points + funnels a preset's stations declare (Gap 2D,
// preset-driven since the station model).
//
//   POST /api/offers/seed-entry-points   body { client_id, offer_id, preset? }
//     → { ok, entry_points: n, funnels: n }
//
// The form list comes from the preset manifest (api/agent/presets.js): each
// stage's entry.sources of kind website-form, plus the funnel it belongs to.
// Default preset is free_trial, which declares exactly the pair this endpoint
// used to hardcode (free-trial primary + contact). Calendar sources are NOT
// seeded here - booking go-live creates those.
//
// Creates, idempotently (upsert on the tables' unique keys, ignore-duplicates):
//   funnels:      from the sources' funnel declarations, offer-tied
//   entry_points: website-form rows, offer-tied, enabled, linked to their
//                 funnel. GHL-specific columns stay null - the lead endpoint
//                 tolerates null pipeline/stage/field_map/workflow for
//                 portal-native academies (contact minting, tags, and offer
//                 lineage all still work; routing is configured afterwards in
//                 the Entry Points wizard).
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
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = b.client_id;
    const offerId = b.offer_id;
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const offerRows = await sb(`offers?id=eq.${enc(offerId)}&client_id=eq.${enc(clientId)}&select=id&limit=1`);
    if (!(Array.isArray(offerRows) && offerRows[0])) return res.status(404).json({ error: "offer not found for this academy" });

    // The station manifest declares which forms (+ funnels) this preset needs.
    const presetKey = String(b.preset || "free_trial");
    const sources = presetEntrySources(presetKey).filter(s => s.kind === "website-form");
    if (!sources.length) return res.status(400).json({ error: `preset '${presetKey}' declares no website-form sources` });

    // Funnels first (unique: client_id, key) so entry points can link to them.
    const funnelDecls = [];
    for (const s of sources) {
      if (s.funnel && !funnelDecls.find(f => f.key === s.funnel.key)) funnelDecls.push(s.funnel);
    }
    await sb(`funnels?on_conflict=client_id,key`, {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(funnelDecls.map(f => (
        { client_id: clientId, offer_id: offerId, key: f.key, label: f.label, is_primary: !!f.primary }
      ))),
    });
    const funnelKeys = funnelDecls.map(f => f.key).join(",");
    const funnels = await sb(`funnels?client_id=eq.${enc(clientId)}&key=in.(${funnelKeys})&select=id,key`) || [];
    const funnelId = (key) => (funnels.find(f => f.key === key) || {}).id || null;

    // Entry points (unique: client_id, type, key). GHL columns stay null.
    await sb(`entry_points?on_conflict=client_id,type,key`, {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(sources.map(s => (
        { client_id: clientId, type: "website-form", key: s.key, label: s.label,
          tags: s.tags || [], offer_id: offerId, funnel_id: s.funnel ? funnelId(s.funnel.key) : null, enabled: true }
      ))),
    });

    const epKeys = sources.map(s => s.key).join(",");
    const eps = await sb(`entry_points?client_id=eq.${enc(clientId)}&type=eq.website-form&key=in.(${epKeys})&select=id`) || [];
    return res.status(200).json({ ok: true, entry_points: eps.length, funnels: funnels.length });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
