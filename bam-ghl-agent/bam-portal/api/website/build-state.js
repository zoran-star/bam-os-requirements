import { withSentryApiRoute } from "../_sentry.js";

// The website BUILD state machine + readiness gate (accepted design 2026-07-15).
// Rides clients.website_setup (jsonb) WITHOUT touching the domain wizard's keys
// (domain/records/status stay DNS-land):
//
//   build_status   queued → building → staging_ready → verified
//   staging_url    the Vercel URL the build deploys to
//   readiness      { auto: {...last run}, manual: { brand_ok, copy_ok, agent_ok } }
//
//   GET  /api/website/build-state?client_id=            → the whole block
//   GET  /api/website/build-state?client_id=&action=readiness
//        runs the AUTOMATED checks against staging_url: every site_pages page
//        answers 200, /api/website/offer returns plans. Stores the run.
//   POST /api/website/build-state  { client_id, action:'set', build_status, staging_url? }
//   POST /api/website/build-state  { client_id, action:'sign', key:'brand_ok'|'copy_ok'|'agent_ok', ok:true|false }
//
// 'verified' can only be SET when the last auto run passed and all three manual
// sign-offs are true - the gate api/website/domain-setup.js enforces on flip.
//
// Auth: BAM staff only (this drives the Activation tab).

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;
const STATES = ["queued", "building", "staging_ready", "verified"];
const MANUAL = ["brand_ok", "copy_ok", "agent_ok"];

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  if (!(Array.isArray(staff) && staff[0])) throw Object.assign(new Error("staff only"), { status: 403 });
}

async function loadSetup(clientId) {
  const rows = await sb(`clients?id=eq.${enc(clientId)}&select=website_setup&limit=1`);
  if (!(Array.isArray(rows) && rows[0])) throw Object.assign(new Error("academy not found"), { status: 404 });
  return rows[0].website_setup || {};
}
async function saveSetup(clientId, setup) {
  await sb(`clients?id=eq.${enc(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ website_setup: setup, updated_at: new Date().toISOString() }),
  });
}

// The automated readiness run: staging pages 200 + the offer endpoint answers.
async function runAutoChecks(clientId, setup) {
  const base = String(setup.staging_url || "").replace(/\/$/, "");
  const checks = [];
  if (!base) return { ok: false, at: new Date().toISOString(), checks: [{ name: "staging_url set", ok: false, note: "set it via action:'set'" }] };

  const pages = await sb(`site_pages?client_id=eq.${enc(clientId)}&select=page_key,file&limit=100`).catch(() => []);
  const htmlPages = (pages || []).filter(p => /\.html$/.test(p.file || "")).slice(0, 25);
  if (!htmlPages.length) checks.push({ name: "site_pages mapped", ok: false, note: "run sync-tracking.mjs --push in bam-client-sites" });
  for (const p of htmlPages) {
    const url = `${base}/${p.page_key === "index" ? "" : p.page_key + ".html"}`;
    let ok = false, note = "";
    try { const r = await fetch(url, { method: "GET", redirect: "follow" }); ok = r.ok; note = String(r.status); }
    catch (e) { note = e.message.slice(0, 60); }
    checks.push({ name: `page ${p.page_key}`, ok, note });
  }
  try {
    // The offer endpoint is origin-gated (clients.allowed_domains) - send the
    // staging origin, exactly like the browser will.
    const origin = new URL(base).origin;
    const r = await fetch(`https://portal.byanymeansbusiness.com/api/website/offer?client_id=${enc(clientId)}`, { headers: { Origin: origin } });
    const j = await r.json().catch(() => ({}));
    const plans = (j.plans || j.offer?.plans || []).length || (Array.isArray(j.questions) ? 1 : 0);
    checks.push({ name: "offer endpoint answers", ok: r.ok && plans > 0, note: r.ok ? `${plans} plan group(s)` : String(r.status) });
  } catch (e) { checks.push({ name: "offer endpoint answers", ok: false, note: e.message.slice(0, 60) }); }

  return { ok: checks.length > 0 && checks.every(c => c.ok), at: new Date().toISOString(), checks };
}

const summary = (setup) => ({
  ok: true,
  build_status: setup.build_status || null,
  staging_url: setup.staging_url || null,
  readiness: setup.readiness || { auto: null, manual: {} },
  can_verify: !!(setup.readiness && setup.readiness.auto && setup.readiness.auto.ok
    && MANUAL.every(k => setup.readiness.manual && setup.readiness.manual[k] === true)),
});

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    const action = q.action || b.action || "status";
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    await requireStaff(req);
    const setup = await loadSetup(clientId);

    if (req.method === "GET" && action === "status") return res.status(200).json(summary(setup));

    if (req.method === "GET" && action === "readiness") {
      const auto = await runAutoChecks(clientId, setup);
      setup.readiness = { ...(setup.readiness || {}), auto, manual: (setup.readiness && setup.readiness.manual) || {} };
      await saveSetup(clientId, setup);
      return res.status(200).json(summary(setup));
    }

    if (req.method === "POST" && action === "set") {
      const next = String(b.build_status || "");
      if (!STATES.includes(next)) return res.status(400).json({ error: `build_status must be one of ${STATES.join(" | ")}` });
      if (next === "verified") {
        const s = summary(setup);
        if (!s.can_verify) return res.status(412).json({ error: "verified needs a passing auto run + all three manual sign-offs (brand_ok, copy_ok, agent_ok)", ...s });
      }
      setup.build_status = next;
      if (b.staging_url !== undefined) setup.staging_url = String(b.staging_url || "");
      setup.build_updated_at = new Date().toISOString();
      await saveSetup(clientId, setup);
      return res.status(200).json(summary(setup));
    }

    if (req.method === "POST" && action === "sign") {
      const key = String(b.key || "");
      if (!MANUAL.includes(key)) return res.status(400).json({ error: `key must be one of ${MANUAL.join(" | ")}` });
      setup.readiness = setup.readiness || { auto: null, manual: {} };
      setup.readiness.manual = { ...(setup.readiness.manual || {}), [key]: b.ok === true };
      await saveSetup(clientId, setup);
      return res.status(200).json(summary(setup));
    }

    return res.status(400).json({ error: "unknown action (status | readiness | set | sign)" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
