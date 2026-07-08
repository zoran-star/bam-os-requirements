import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 30;

// Branded email domain wizard - onboarding an academy's OWN sending domain onto
// Resend straight through the portal (no Resend dashboard, no engineer). Tier 2
// of the email-onboarding plan (Zoran 2026-07-08).
//
//   POST /api/email/domain-setup   { client_id, action, domain? }
//     action=create  { domain: "detail-mia.com" }
//       -> creates mail.<root> in Resend (subdomain on purpose: their root MX /
//          Google Workspace is never touched), stores state on clients.email_setup,
//          returns the DNS records to paste at the registrar.
//     action=status
//       -> re-checks Resend (triggers a verify pass while pending). When Resend
//          says verified: sets clients.email_domain + flips email_provider='resend'
//          (the built email spine takes over: outbound via _email.js, inbound via
//          resend/inbound-webhook.js). Returns { status, records, flipped }.
//
// Auth: staff (any academy) or an active client_users member of client_id -
// same pattern as offers/create-price.js. Needs RESEND_API_KEY (already in Vercel).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND = "https://api.resend.com";

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

async function resend(method, path, body) {
  const r = await fetch(`${RESEND}${path}`, {
    method,
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  const json = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw Object.assign(new Error(json.message || `Resend ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return json;
}

// "https://www.Detail-Mia.com/" -> "detail-mia.com". Reject anything that isn't
// a plain registrable-looking domain.
function normalizeDomain(raw) {
  let s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

const pickRecords = (d) => (d.records || []).map(r => ({
  record: r.record || null, type: r.type || null, name: r.name || null,
  value: r.value || null, ttl: r.ttl || null, priority: r.priority ?? null, status: r.status || null,
}));

async function saveSetup(clientId, setup) {
  await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ email_setup: setup, updated_at: new Date().toISOString() }),
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not configured" });
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(body.client_id || ctx.clientIds[0] || "").trim();
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,email_provider,email_domain,email_setup&limit=1`);
    const client = Array.isArray(rows) && rows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const action = String(body.action || "status");

    if (action === "create") {
      const root = normalizeDomain(body.domain);
      if (!root) return res.status(400).json({ error: "Enter a plain domain, e.g. detail-mia.com" });
      // Subdomain on purpose - never touches the academy's root MX (their real
      // email at the root keeps working; mail.<root> is ours end to end).
      const sending = root.startsWith("mail.") ? root : `mail.${root}`;
      const d = await resend("POST", `/domains`, { name: sending });
      const setup = {
        resend_domain_id: d.id, domain: sending, root,
        records: pickRecords(d), status: d.status || "pending",
        created_at: new Date().toISOString(),
      };
      await saveSetup(clientId, setup);
      return res.status(200).json({ ok: true, ...setup });
    }

    if (action === "status") {
      const setup = client.email_setup;
      if (client.email_provider === "resend" && client.email_domain) {
        return res.status(200).json({ ok: true, status: "live", domain: client.email_domain, records: (setup && setup.records) || [] });
      }
      if (!setup || !setup.resend_domain_id) return res.status(200).json({ ok: true, status: "none" });
      // Nudge Resend to re-check while pending (best-effort), then read.
      try { await resend("POST", `/domains/${encodeURIComponent(setup.resend_domain_id)}/verify`); } catch (_) {}
      const d = await resend("GET", `/domains/${encodeURIComponent(setup.resend_domain_id)}`);
      const status = d.status || "pending";
      const next = { ...setup, records: pickRecords(d), status };
      let flipped = false;
      if (status === "verified") {
        await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ email_domain: setup.domain, email_provider: "resend", email_setup: { ...next, flipped_at: new Date().toISOString() }, updated_at: new Date().toISOString() }),
        });
        flipped = true;
      } else {
        await saveSetup(clientId, next);
      }
      return res.status(200).json({ ok: true, status: flipped ? "live" : status, domain: setup.domain, records: next.records, flipped });
    }

    return res.status(400).json({ error: "unknown action (create|status)" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
