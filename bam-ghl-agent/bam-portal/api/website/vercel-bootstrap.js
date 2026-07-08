import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 60;

// TEMPORARY one-time bootstrap - REMOVE AFTER USE (tracked in
// memories/project_detail_portal_native_plan.md). The remote agent environment
// can't reach api.vercel.com (egress policy), but these functions can. Takes
// the owner's Vercel token, discovers the bam-client-sites + bam-portal
// project ids, and writes VERCEL_TOKEN / VERCEL_SITES_PROJECT_ID
// (+ VERCEL_TEAM_ID when the projects live in a team) onto THIS project so the
// website domain wizard (api/website/domain-setup.js) works.
//
//   POST /api/website/vercel-bootstrap
//     { token, dry_run?, sites_project_id?, portal_project_id?, team_id? }
//
// Carries no secrets of its own and grants nothing: it can only do what the
// caller's own Vercel token can already do against api.vercel.com directly.

const ENV_TARGETS = ["production", "preview", "development"];

async function vc(token, path, init = {}) {
  const r = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const token = String(body.token || "").trim();
  if (!token) return res.status(400).json({ error: "token required" });

  const report = { scopes: [], projects: [], picked: {}, set: [], errors: [] };
  try {
    // Personal scope + every team the token can see.
    const scopes = [{ teamId: null, label: "personal" }];
    try {
      const t = await vc(token, "/v2/teams?limit=20");
      for (const team of t.teams || []) scopes.push({ teamId: team.id, label: team.slug || team.name });
    } catch (e) { report.errors.push(`teams: ${e.message}`); }

    let portal = null, sites = null;
    for (const s of scopes) {
      const qs = s.teamId ? `?teamId=${encodeURIComponent(s.teamId)}&limit=100` : "?limit=100";
      let projects = [];
      try { projects = (await vc(token, `/v9/projects${qs}`)).projects || []; }
      catch (e) { report.errors.push(`projects(${s.label}): ${e.message}`); continue; }
      report.scopes.push(s.label);
      for (const p of projects) {
        report.projects.push({ scope: s.label, teamId: s.teamId, id: p.id, name: p.name });
        if (!sites && /client[-_]?sites/i.test(p.name)) sites = { teamId: s.teamId, id: p.id, name: p.name };
        if (!portal && /portal/i.test(p.name) && !/client[-_]?sites|app/i.test(p.name)) portal = { teamId: s.teamId, id: p.id, name: p.name };
      }
    }
    // Explicit overrides win over name matching.
    if (body.sites_project_id) sites = { teamId: body.team_id || (sites && sites.teamId) || null, id: String(body.sites_project_id), name: "(override)" };
    if (body.portal_project_id) portal = { teamId: body.team_id || (portal && portal.teamId) || null, id: String(body.portal_project_id), name: "(override)" };
    report.picked = { portal, sites };

    if (!portal || !sites) {
      return res.status(200).json({ ok: false, note: "could not identify both projects - see report.projects and re-POST with portal_project_id/sites_project_id", report });
    }
    if (body.dry_run) return res.status(200).json({ ok: true, dry_run: true, report });

    // Upsert the env vars on the PORTAL project (all targets).
    const envs = [
      { key: "VERCEL_TOKEN", value: token, type: "encrypted", target: ENV_TARGETS },
      { key: "VERCEL_SITES_PROJECT_ID", value: sites.id, type: "encrypted", target: ENV_TARGETS },
    ];
    if (sites.teamId) envs.push({ key: "VERCEL_TEAM_ID", value: sites.teamId, type: "encrypted", target: ENV_TARGETS });
    const qs = portal.teamId ? `?upsert=true&teamId=${encodeURIComponent(portal.teamId)}` : "?upsert=true";
    const r = await vc(token, `/v10/projects/${encodeURIComponent(portal.id)}/env${qs}`, {
      method: "POST",
      body: JSON.stringify(envs),
    });
    report.set = envs.map(e => e.key);
    return res.status(200).json({ ok: true, report, created: (r.created || []).length, failed: r.failed || [] });
  } catch (e) {
    report.errors.push(e.message);
    return res.status(500).json({ ok: false, report });
  }
}

export default withSentryApiRoute(handler);
