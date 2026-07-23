import { withSentryApiRoute } from "../_sentry.js";

// Offer → sales-agent FACT sections (Gap #2, phase 2A).
//
//   GET  /api/offers/sync-agent?action=preview&client_id=&offer_id=
//     → { ok, sections:[{ key, label, body }] }
//        Generates the agent's per-academy FACT prompt sections from the offer +
//        client data (the same sections agent_prompt_sections overrides), so an
//        owner can review exactly what the booking agent will know.
//
//   POST /api/offers/sync-agent   body { client_id, offer_id, keys?:[...] }
//     → { ok, written:[keys] }
//        Upserts those sections as this academy's agent_prompt_sections overrides
//        (section_key + offer_id tagged). Only sections we can fill from the offer
//        are touched; anything else keeps its current override/default. User-
//        triggered so the live agent never changes silently.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function nowIso() { return new Date().toISOString(); }

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
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

// ── FACT builders now live in api/agent/fact-render.js (Build 2) ─────────────
// The SAME renderers run at READ time inside every agent's prompt build
// (derivedFactOverrides), so this sync endpoint is now just a preview surface +
// a writer of fallback text for sparse offers. One source of truth, no drift.
import { renderBusinessInfo, renderProgram, renderSchedule, renderPricing, renderSellingPoints, renderPolicies } from "../agent/fact-render.js";

const SECTIONS = [
  { key: "business_info",  label: "Business info",  gen: (c, d, l) => renderBusinessInfo(c, d, l) },
  { key: "program",        label: "Program",        gen: (c, d) => renderProgram(d) },
  { key: "schedule",       label: "Schedule",       gen: (c, d, l) => renderSchedule(d, l) },
  { key: "pricing",        label: "Pricing",        gen: (c, d) => renderPricing(d) },
  { key: "selling_points", label: "Selling points", gen: (c, d) => renderSellingPoints(d) },
  { key: "policies",       label: "Policies",       gen: (c, d) => renderPolicies(d) },
];

function generateSections(client, data, locations) {
  return SECTIONS.map(s => ({ key: s.key, label: s.label, body: s.gen(client, data, locations) }))
    .filter(s => s.body && s.body.trim());
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    const offerId = q.offer_id || b.offer_id;
    const action = q.action || b.action || (req.method === "GET" ? "preview" : "apply");
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });

    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,data&limit=1`);
    const offer = Array.isArray(offerRows) && offerRows[0];
    if (!offer) return res.status(404).json({ error: "offer not found for this academy" });
    const [clientRows, locationRows] = await Promise.all([
      sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name,address,website_setup&limit=1`),
      sb(`locations?client_id=eq.${encodeURIComponent(clientId)}&select=id,title,address,notes&order=sort_order.asc&limit=10`),
    ]);
    const client = (Array.isArray(clientRows) && clientRows[0]) || {};

    const sections = generateSections(client, offer.data || {}, locationRows || []);

    if (action === "preview") return res.status(200).json({ ok: true, sections });

    if (action === "apply") {
      const wantKeys = Array.isArray(b.keys) && b.keys.length ? new Set(b.keys) : null;
      const toWrite = sections.filter(s => !wantKeys || wantKeys.has(s.key));
      if (!toWrite.length) return res.status(200).json({ ok: true, written: [] });
      const rows = toWrite.map(s => ({
        client_id: clientId, section_key: s.key, body: s.body,
        offer_id: offerId, updated_by: "offer-sync", updated_at: nowIso(),
      }));
      await sb(`agent_prompt_sections?on_conflict=client_id,section_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      return res.status(200).json({ ok: true, written: toWrite.map(s => s.key) });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
