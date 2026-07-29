// Public endpoint - an academy's displayable testimonials + Google aggregate.
//
//   GET /api/website/testimonials?client_id=<uuid>
//     → { aggregate: {rating, count, checked_at} | null,
//         testimonials: [{quote, author, source, rating?, date?}] }
//
// Feeds the academy websites' review sections (e.g. the free-trial page cards).
// All ordering, the under-4-star hide and the manual-rows-never-carry-review-
// framing rule live in api/_testimonials.js - THE one resolver - not here.
//
// NO FACT, NO OUTPUT: an academy with nothing on file gets
// { aggregate: null, testimonials: [] } and the caller renders NOTHING - no
// empty shell, no placeholder rating. `aggregate` is a point-in-time reading
// off the owner's Business Profile (see the clients column comments); the
// caller may show it with its count, and should not dress it up as live.
//
// Read-only and CORS-gated by clients.allowed_domains, same as the other
// api/website/* endpoints.

import { withSentryApiRoute } from "../_sentry.js";
import { resolveTestimonials } from "../_testimonials.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const r = await fetch(`${SB_URL}/rest/v1/clients?select=allowed_domains&allowed_domains=not.is.null`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const rows = await r.json();
  const set = new Set(DEV_ORIGINS);
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!client_id || !UUID_RE.test(client_id)) {
    return res.status(400).json({ error: "client_id required" });
  }

  try {
    const { aggregate, testimonials } = await resolveTestimonials(client_id);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).json({ aggregate, testimonials });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

export default withSentryApiRoute(handler);
