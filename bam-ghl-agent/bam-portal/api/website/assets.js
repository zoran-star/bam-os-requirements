// Public endpoint — an academy's brand/asset library for its website(s).
//
//   GET /api/website/assets?client_id=<uuid>&offer_id=<uuid?>
//     → { assets: [ { id, label, category, alt, url, width, height,
//                     offer_id, staff_id, location_id } ],
//         byCategory: { logo:{url,alt,id}, hero:{…}, … } }
//
// `byCategory` is a convenience: the first asset per category, so a page can do
// data.byCategory.logo.url. When offer_id is passed, assets tagged to that offer
// win over brand-level ones for the same category (so an offer's page can have
// its own hero while falling back to the brand hero).
//
// Read-only, CORS-gated by clients.allowed_domains — same as the other
// api/website/* endpoints. Images come from the public `client-assets` bucket.

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

function publicUrl(path) {
  return `${SB_URL}/storage/v1/object/public/client-assets/${path}`;
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
  const offerId = req.query.offer_id || null;
  if (!client_id) return res.status(400).json({ error: "client_id required" });

  try {
    const rows = await sbReq(
      `client_assets?client_id=eq.${encodeURIComponent(client_id)}` +
      `&select=id,label,category,alt,storage_path,width,height,offer_id,staff_id,location_id` +
      `&order=sort_order.asc,created_at.desc`
    );

    const assets = (rows || []).map((a) => ({
      id: a.id, label: a.label, category: a.category, alt: a.alt || "",
      url: publicUrl(a.storage_path),
      width: a.width, height: a.height,
      offer_id: a.offer_id, staff_id: a.staff_id, location_id: a.location_id,
    }));

    // First asset per category. Prefer the requested offer's assets, then
    // brand-level (untagged), then anything else.
    const score = (a) =>
      (offerId && a.offer_id === offerId) ? 0
      : (!a.offer_id && !a.staff_id && !a.location_id) ? 1
      : 2;
    const byCategory = {};
    for (const a of [...assets].sort((x, y) => score(x) - score(y))) {
      if (!byCategory[a.category]) byCategory[a.category] = { url: a.url, alt: a.alt, id: a.id };
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ assets, byCategory });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
