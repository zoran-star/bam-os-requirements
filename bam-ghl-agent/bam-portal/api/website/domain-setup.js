import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 30;

// Website domain wizard - point an academy's domain at their rebuilt Vercel
// site (bam-client-sites) straight through the portal, sibling of the email
// wizard (api/email/domain-setup.js). GTA precedent: byanymeanstoronto.ca ->
// Vercel -> serves clients/bam-gta at the root, so host routing exists.
//
//   POST /api/website/domain-setup   { client_id, action, domain? }
//     action=create  { domain: "detail-mia.com" }
//       -> attaches the domain (+ www) to the bam-client-sites Vercel project
//          via the Vercel API, stores state in clients.website_setup, returns
//          the two DNS records to paste at the registrar.
//     action=status
//       -> re-reads Vercel's domain config; 'verified' when DNS points at
//          Vercel and the domain is attached. Returns { status, records }.
//
// Env (one-time): VERCEL_TOKEN (API token), VERCEL_SITES_PROJECT_ID (the
// bam-client-sites project id or name), VERCEL_TEAM_ID (optional). Reports
// exactly which one is missing so first use tells you what to add.
// Auth: staff or an active client_users member of client_id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const SITES_PROJECT = process.env.VERCEL_SITES_PROJECT_ID;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

// Vercel's standard records - stable, documented values (GTA's live DNS uses
// Vercel-assigned equivalents; these classic ones are accepted for all projects).
const APEX_A = "76.76.21.21";
const WWW_CNAME = "cname.vercel-dns.com";

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
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

function vercelQs() { return TEAM_ID ? `?teamId=${encodeURIComponent(TEAM_ID)}` : ""; }
async function vercel(method, path, body) {
  const r = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!r.ok) {
    const code = json?.error?.code || "";
    if (code === "domain_already_in_use" || code === "domain_taken") return { alreadyAttached: true, ...json };
    throw Object.assign(new Error(json?.error?.message || `Vercel ${r.status}`), { status: 502 });
  }
  return json;
}

function normalizeDomain(raw) {
  let s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

const recordsFor = (root) => ([
  { record: "apex", type: "A", name: "@", value: APEX_A },
  { record: "www", type: "CNAME", name: "www", value: WWW_CNAME },
]);

async function saveSetup(clientId, setup) {
  await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ website_setup: setup, updated_at: new Date().toISOString() }),
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const missing = [!VERCEL_TOKEN && "VERCEL_TOKEN", !SITES_PROJECT && "VERCEL_SITES_PROJECT_ID"].filter(Boolean);
    if (missing.length) return res.status(500).json({ error: `Vercel env not configured: add ${missing.join(" + ")} in the Vercel dashboard (one-time).` });

    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(body.client_id || ctx.clientIds[0] || "").trim();
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,website_setup,allowed_domains&limit=1`);
    const client = Array.isArray(rows) && rows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const action = String(body.action || "status");

    if (action === "create") {
      const root = normalizeDomain(body.domain);
      if (!root) return res.status(400).json({ error: "Enter a plain domain, e.g. detail-mia.com" });
      // Attach apex + www to the sites project (idempotent-ish: already-attached is OK).
      await vercel("POST", `/v10/projects/${encodeURIComponent(SITES_PROJECT)}/domains${vercelQs()}`, { name: root });
      await vercel("POST", `/v10/projects/${encodeURIComponent(SITES_PROJECT)}/domains${vercelQs()}`, { name: `www.${root}`, redirect: root }).catch(() => {});
      const setup = { domain: root, records: recordsFor(root), status: "pending", created_at: new Date().toISOString() };
      await saveSetup(clientId, setup);
      return res.status(200).json({ ok: true, ...setup });
    }

    if (action === "status") {
      const setup = client.website_setup;
      if (!setup || !setup.domain) {
        // Pre-wizard sites (GTA): the domain was attached to the sites project
        // by hand, so website_setup is empty even though the site is LIVE.
        // Detect it from allowed_domains so status (and the onboarding flow's
        // website step) reports the truth instead of "none".
        const candidates = [...new Set((client.allowed_domains || []).map(normalizeDomain).filter(Boolean))].slice(0, 4);
        for (const dom of candidates) {
          const onProject = await vercel("GET", `/v9/projects/${encodeURIComponent(SITES_PROJECT)}/domains/${encodeURIComponent(dom)}${vercelQs()}`).catch(() => null);
          if (!onProject || !onProject.name) continue; // not attached to our sites project
          const cfg = await vercel("GET", `/v6/domains/${encodeURIComponent(dom)}/config${vercelQs()}`).catch(() => null);
          if (cfg && cfg.misconfigured === false) {
            return res.status(200).json({ ok: true, status: "live", domain: dom, records: [] });
          }
        }
        return res.status(200).json({ ok: true, status: "none" });
      }
      // verified = attached to the project AND DNS resolving to Vercel.
      const cfg = await vercel("GET", `/v6/domains/${encodeURIComponent(setup.domain)}/config${vercelQs()}`).catch(() => null);
      const live = cfg && cfg.misconfigured === false;
      const status = live ? "live" : "pending";
      const next = { ...setup, status, checked_at: new Date().toISOString() };
      await saveSetup(clientId, next);
      return res.status(200).json({ ok: true, status, domain: setup.domain, records: setup.records || recordsFor(setup.domain) });
    }

    return res.status(400).json({ error: "unknown action (create|status)" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
