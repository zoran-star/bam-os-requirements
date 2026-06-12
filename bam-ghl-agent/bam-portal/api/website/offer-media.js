// Public endpoint — media an offer exposes to the client's website,
// starting with the post-booking welcome video (uploaded by the academy
// in BB → Offers → Onboarding → "Welcome video").
//
//   GET /api/website/offer-media?client_id=<uuid>&offer_type=training
//     → { welcome_video: <public url> | null }
//
// Same CORS allow-list as the other website endpoints.

import { withSentryApiRoute } from "../_sentry.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const origin = req.headers.origin || "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const { client_id } = req.query;
  const offerType = req.query.offer_type || "training";
  if (!client_id) return res.status(400).json({ error: "client_id required" });

  try {
    const offers = await sbReq(
      `offers?client_id=eq.${client_id}&type=eq.${encodeURIComponent(offerType)}&select=id&order=sort_order.asc&limit=1`
    );
    const offer = offers?.[0];
    if (!offer) return res.status(200).json({ welcome_video: null });

    const files = await sbReq(
      `offer_files?offer_id=eq.${offer.id}&section=eq.welcome_video&select=storage_path&order=created_at.desc&limit=1`
    );
    const path = files?.[0]?.storage_path || null;
    const url = path ? `${SB_URL}/storage/v1/object/public/offers/${path}` : null;
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ welcome_video: url });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

export default withSentryApiRoute(handler);
