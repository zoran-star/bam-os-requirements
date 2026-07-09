// Vercel Serverless Function - Funnels (landing pages that host direct entry points)
//
//   GET   /api/website/funnels?client_id=<uuid>
//     → all funnels rows for the academy, each with its entry_points nested.
//       url falls back to a derived URL (most-common funnel_events page_view
//       path for that funnel key, joined to the client's preferred domain)
//       when funnels.url is null - same derivation the marketing machine uses.
//
//   PATCH /api/website/funnels?client_id=<uuid>&id=<uuid>
//     body: { label?, url?, enabled? }
//     → saves display/config fields for one funnel. Pass url:null to clear.
//
// Model (Zoran 2026-07-08): a DIRECT entry point is a form or calendar, and
// those always live in a funnel (a page on the academy site). funnels.key
// matches funnel_events.funnel so analytics joins by key.
//
// Auth: Supabase JWT - staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

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

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// Most-common page_view path per funnel key, joined to the client's preferred
// domain (skip *.vercel.app and www when a branded domain exists). Mirrors the
// pageUrl derivation in api/marketing.js meta-machine.
function deriveUrls(funnelRows, allowedDomains) {
  const byFunnel = {};
  for (const r of Array.isArray(funnelRows) ? funnelRows : []) {
    if (!r.url) continue;
    const c = (byFunnel[r.funnel] = byFunnel[r.funnel] || {});
    c[r.url] = (c[r.url] || 0) + 1;
  }
  const domains = Array.isArray(allowedDomains) ? allowedDomains : [];
  const pick = domains.find((d) => !/vercel\.app$/i.test(d) && !/^www\./i.test(d))
    || domains.find((d) => !/vercel\.app$/i.test(d)) || domains[0] || null;
  const out = {};
  for (const [key, counts] of Object.entries(byFunnel)) {
    const path = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (/^https?:\/\//i.test(path)) { out[key] = path; continue; }
    if (!pick) continue;
    out[key] = "https://" + pick.replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
  }
  return out;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  if (req.method === "GET") {
    try {
      const [funnels, entryPoints, client, beacons] = await Promise.all([
        sb(
          `funnels?client_id=eq.${clientId}` +
          `&select=id,offer_id,key,label,url,is_primary,enabled,updated_at` +
          `&order=is_primary.desc,label.asc`
        ),
        sb(
          `entry_points?client_id=eq.${clientId}` +
          `&select=id,funnel_id,type,key,label,pipeline_name,stage_name,ghl_workflow_name,enabled&order=type.asc,label.asc`
        ),
        sb(`clients?id=eq.${clientId}&select=allowed_domains&limit=1`),
        sb(
          `funnel_events?client_id=eq.${clientId}&step=eq.page_view` +
          `&select=funnel,url&order=created_at.desc&limit=2000`
        ),
      ]);
      const domains = client && client[0] && client[0].allowed_domains;
      const derived = deriveUrls(beacons, domains);
      const eps = Array.isArray(entryPoints) ? entryPoints : [];
      // Base origin = the PRIMARY funnel's live URL (its stored url or the domain
      // its beacons actually load from). Reusing it means a funnel with no
      // beacons resolves to the same proven-live domain rather than a guess.
      const primary = (funnels || []).find((f) => f.is_primary);
      const primaryUrl = primary && (primary.url || derived[primary.key]);
      let baseOrigin = null;
      if (primaryUrl) { try { baseOrigin = new URL(primaryUrl).origin; } catch (_) {} }
      // url_resolved priority: stored override -> this funnel's own beacon path ->
      // base origin + "/" + funnel key (the site's cleanUrls page slug, e.g.
      // contact -> /contact). Only the slug is conventional; the DOMAIN is proven
      // from the primary funnel, so we never load a wrong-domain page. Null (no
      // primary either) -> annotator shows an honest "no page yet" state.
      const out = (funnels || []).map((f) => ({
        ...f,
        url_resolved: f.url || derived[f.key] || (baseOrigin ? baseOrigin + "/" + f.key : null),
        entry_points: eps.filter((e) => e.funnel_id === f.id),
      }));
      return res.status(200).json({ funnels: out });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const b = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if ("label" in b && b.label) patch.label = String(b.label).slice(0, 120);
    if ("url" in b) {
      const u = b.url ? String(b.url).trim() : null;
      if (u && !/^https?:\/\//i.test(u) && !u.startsWith("/")) {
        return res.status(400).json({ error: "url must be absolute (https://...) or a path (/...)" });
      }
      patch.url = u;
    }
    if ("enabled" in b) patch.enabled = !!b.enabled;
    try {
      const rows = await sb(`funnels?id=eq.${id}&client_id=eq.${clientId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!rows || !rows[0]) return res.status(404).json({ error: "funnel not found" });
      return res.status(200).json({ funnel: rows[0] });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: "GET or PATCH required" });
}

export default withSentryApiRoute(handler);
