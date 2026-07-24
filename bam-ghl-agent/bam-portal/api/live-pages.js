import { withSentryApiRoute } from "./_sentry.js";
// Live Pages - the academy's own website pages, as they are live right now.
// Powers the client-portal "Live Pages" tab: fast review, monitoring, and
// raising a ticket against a specific page.
//
// The site URL is seeded per client at clients.ghl_kpi_config.site = { slug, url }
// (resolved from the Vercel project that builds that client's site). Pages are
// read LIVE from the site's own sitemap.xml on each request, so the list always
// matches what is actually published - nothing to keep in sync by hand.
//
//   GET ?client_id=   AUTH -> { enabled, site_url, pages:[{path,url,label}] }
//
// Auth: Supabase JWT - staff (any academy) or an active client_users member.
// V1 / V1.5 only: V2 academies are not seeded with a site and get enabled:false.

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map((m) => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// Turn "/private-basketball" into "Private Basketball", "/" into "Home".
function labelFor(path) {
  const p = String(path || "/").replace(/^\/+|\/+$/g, "");
  if (!p) return "Home";
  const last = p.split("/").pop().replace(/\.html?$/i, "");
  return last.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Read the site's own sitemap. No XML parser needed - the <loc> values are all
// we want, and a sitemap is machine-generated so the shape is predictable.
async function pagesFromSitemap(siteUrl) {
  const base = siteUrl.replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`${base}/sitemap.xml`, { signal: ctl.signal, headers: { Accept: "application/xml,text/xml,*/*" } });
    if (!r.ok) return null;
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (!locs.length) return null;
    const seen = new Set();
    const pages = [];
    for (const loc of locs) {
      let path;
      try { path = new URL(loc).pathname || "/"; } catch { continue; }
      if (seen.has(path)) continue;
      seen.add(path);
      pages.push({ path, url: `${base}${path === "/" ? "" : path}`, label: labelFor(path) });
    }
    // Home first, then alphabetical - matches how someone reviews a site.
    pages.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.label.localeCompare(b.label)));
    return pages;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
    if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
    const clientId = req.query && req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    const ctx = await resolveUser(req);
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,ghl_kpi_config&limit=1`);
    const client = rows?.[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    const cfg = (client.ghl_kpi_config && typeof client.ghl_kpi_config === "object") ? client.ghl_kpi_config : {};
    const site = cfg.site && typeof cfg.site === "object" ? cfg.site : null;
    const siteUrl = site && typeof site.url === "string" ? site.url.trim() : "";
    if (!siteUrl) return res.status(200).json({ enabled: false, site_url: null, pages: [] });

    // Sitemap is the good path. If a site has none, still give them the
    // homepage so the tab is useful rather than empty.
    const pages = (await pagesFromSitemap(siteUrl)) || [{ path: "/", url: siteUrl, label: "Home" }];

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ enabled: true, site_url: siteUrl, pages });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
}

export default withSentryApiRoute(handler);
