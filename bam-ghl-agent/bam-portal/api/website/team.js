// Public endpoint — an academy's coaching staff for its public "Our Team" page.
//
//   GET /api/website/team?client_id=<uuid>
//     → { coaches: [ { id, name, title, bio, photo_url } ] }
//
// A coach = a client_users row (name/title/bio, edited in Business Blueprint >
// Staff) plus their Content Library photo (client_assets tagged staff_id, with
// content_type='coaching' preferred). Only staff who are NOT hidden and have a
// title or bio filled appear — the bio is the opt-in.
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
  if (!client_id) return res.status(400).json({ error: "client_id required" });

  try {
    // Staff who opted onto the team page: not hidden, with a title or bio.
    const people = await sbReq(
      `client_users?client_id=eq.${encodeURIComponent(client_id)}` +
      `&status=eq.active&hide_from_team=eq.false&or=(title.not.is.null,bio.not.is.null)` +
      `&select=id,name,title,bio,instagram,role,created_at&order=created_at.asc`
    );
    const list = Array.isArray(people) ? people : [];
    // Owner first, then by creation order (matches how a team page usually reads).
    list.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));

    // Their photos: staff-tagged assets, coaching content preferred.
    let photoByStaff = {};
    if (list.length) {
      const ids = list.map((p) => p.id).join(",");
      const assets = await sbReq(
        `client_assets?client_id=eq.${encodeURIComponent(client_id)}` +
        `&staff_id=in.(${ids})&category=eq.photo` +
        `&select=staff_id,storage_path,link_url,content_type,sort_order,created_at` +
        `&order=sort_order.asc,created_at.desc`
      );
      for (const a of assets || []) {
        const cur = photoByStaff[a.staff_id];
        // First hit wins per staff, but a coaching-typed photo overrides a plain one.
        if (!cur || (a.content_type === "coaching" && cur.content_type !== "coaching")) {
          photoByStaff[a.staff_id] = a;
        }
      }
    }

    const coaches = list.map((p) => {
      const a = photoByStaff[p.id];
      const photo_url = a ? (a.storage_path ? publicUrl(a.storage_path) : (a.link_url || "")) : "";
      return { id: p.id, name: p.name || "", title: p.title || "", bio: p.bio || "", instagram: p.instagram || "", photo_url };
    });

    // Whether the owner wants a public team page (Blueprint > Staff toggle,
    // stored on brand_data.wants_about_page). Undecided defaults to showing it if
    // there are coaches; an explicit "Not now" (false) hides the section.
    let show_team_page = coaches.length > 0;
    try {
      const cr = await sbReq(`clients?id=eq.${encodeURIComponent(client_id)}&select=brand_data`);
      const wap = cr && cr[0] && cr[0].brand_data ? cr[0].brand_data.wants_about_page : undefined;
      if (wap === false) show_team_page = false;
      else if (wap === true) show_team_page = true;
    } catch (_) { /* keep the default */ }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ coaches, show_team_page });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
