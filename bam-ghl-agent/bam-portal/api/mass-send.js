import { withSentryApiRoute } from "./_sentry.js";
import { timingSafeEqual } from "node:crypto";
// V1.5 mass send — queued, throttled, DND-respecting bulk SMS/email to a
// tag-filtered audience (GHL bulk rules: skip DND, pace the sends).
//
//   POST /api/mass-send?action=create&client_id=   { channel, tag, subject, body, attachments }
//        → resolves the audience from the ghl_contacts mirror (tag + has-channel
//          + NOT dnd), creates a job + recipient rows. Returns counts.
//   GET  /api/mass-send?action=status&job_id=       job progress (JWT)
//   GET  /api/mass-send?action=work                 worker (cron) — drains a batch

const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const BATCH = 25;                 // recipients per worker run
const SEND_GAP_MS = 400;          // pace between sends (GHL rate-limit safety)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

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
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!ur.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await ur.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  return { isStaff: !!(Array.isArray(staff) && staff[0]), clientIds: Array.isArray(m) ? m.map(x => x.client_id) : [] };
}
async function ghl(method, path, { token, body } = {}) {
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000));
  }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}
async function refreshGhlToken(client) {
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), cs = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !cs || !client.ghl_refresh_token) throw new Error("GHL refresh not configured");
  const r = await fetch(GHL_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cid, client_secret: cs, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }) });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) throw new Error(tok?.error_description || "GHL token refresh failed");
  await sb(`clients?id=eq.${client.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }) });
  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}
async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (exp - Date.now() <= 60_000 && client.ghl_refresh_token) { try { return await refreshGhlToken(client); } catch (_) {} }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return token ? { token, locationId: client.ghl_location_id } : null;
}

// ── Worker: drain one job's pending recipients (cron) ──
async function runWorker(res) {
  const jobs = await sb(`mass_send_jobs?status=in.(queued,sending)&order=created_at.asc&limit=1`);
  const job = Array.isArray(jobs) && jobs[0];
  if (!job) return res.status(200).json({ ok: true, idle: true });

  const clientRows = await sb(`clients?id=eq.${job.client_id}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
  const client = Array.isArray(clientRows) && clientRows[0];
  let creds = null; try { creds = client ? await pickGhlToken(client) : null; } catch (_) {}
  if (!creds) {
    await sb(`mass_send_jobs?id=eq.${job.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", updated_at: nowIso() }) });
    return res.status(200).json({ ok: false, job: job.id, reason: "no GHL token" });
  }
  const { token } = creds;

  await sb(`mass_send_jobs?id=eq.${job.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sending", updated_at: nowIso() }) });

  const recips = await sb(`mass_send_recipients?job_id=eq.${job.id}&status=eq.pending&order=id.asc&limit=${BATCH}`);
  let sent = 0, failed = 0;
  for (const rcp of (recips || [])) {
    try {
      const sendBody = job.channel === "Email"
        ? { type: "Email", contactId: rcp.contact_id, subject: job.subject || "", html: job.body ? `<p>${job.body}</p>` : "" }
        : { type: "SMS", contactId: rcp.contact_id, message: job.body || "" };
      const atts = Array.isArray(job.attachments) ? job.attachments : [];
      if (atts.length) sendBody.attachments = atts;
      await ghl("POST", `/conversations/messages`, { token, body: sendBody });
      await sb(`mass_send_recipients?id=eq.${rcp.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: nowIso() }) });
      sent++;
    } catch (e) {
      await sb(`mass_send_recipients?id=eq.${rcp.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", error: String(e.message || e).slice(0, 300) }) });
      failed++;
    }
    await sleep(SEND_GAP_MS);
  }

  // Update job counts; mark done when no pending remain.
  const remaining = await sb(`mass_send_recipients?job_id=eq.${job.id}&status=eq.pending&select=id&limit=1`);
  const patch = { sent: (job.sent || 0) + sent, failed: (job.failed || 0) + failed, updated_at: nowIso() };
  if (!Array.isArray(remaining) || remaining.length === 0) patch.status = "done";
  await sb(`mass_send_jobs?id=eq.${job.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  return res.status(200).json({ ok: true, job: job.id, sent, failed, done: patch.status === "done" });
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const action = req.query.action || "";

  // Worker (cron) — Bearer CRON_SECRET.
  if (action === "work") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expected = process.env.CRON_SECRET || "";
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "unauthorized" });
    try { return await runWorker(res); } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let ctx; try { ctx = await resolveUser(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // Status
  if (req.method === "GET" && action === "status") {
    const jobId = req.query.job_id;
    if (!jobId) return res.status(400).json({ error: "job_id required" });
    const rows = await sb(`mass_send_jobs?id=eq.${encodeURIComponent(jobId)}&select=*&limit=1`);
    const job = Array.isArray(rows) && rows[0];
    if (!job) return res.status(404).json({ error: "job not found" });
    if (!ctx.isStaff && !ctx.clientIds.includes(job.client_id)) return res.status(403).json({ error: "not your academy" });
    return res.status(200).json({ job });
  }

  // Tags — distinct tags across the academy's contact mirror (for the audience picker).
  if (req.method === "GET" && action === "tags") {
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
    const rows = await sb(`ghl_contacts?client_id=eq.${encodeURIComponent(clientId)}&dnd=eq.false&select=tags&limit=5000`);
    const counts = {};
    for (const r of (rows || [])) for (const t of (r.tags || [])) counts[t] = (counts[t] || 0) + 1;
    const tags = Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
    return res.status(200).json({ tags });
  }

  // Create
  if (req.method === "POST" && action === "create") {
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const channel = body.channel === "Email" ? "Email" : "SMS";
    const tag = (body.tag || "").trim();
    const text = (body.body || "").trim();
    const subject = (body.subject || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter(u => typeof u === "string" && u) : [];
    if (!tag) return res.status(400).json({ error: "a tag (audience) is required" });
    if (!text && !attachments.length) return res.status(400).json({ error: "a message body or attachment is required" });
    if (channel === "Email" && !subject) return res.status(400).json({ error: "email needs a subject" });

    // Audience from the mirror: the tag, NOT dnd, with the right channel field.
    const channelFilter = channel === "Email" ? "&email=not.is.null" : "&phone=not.is.null";
    const audience = await sb(
      `ghl_contacts?client_id=eq.${encodeURIComponent(clientId)}&dnd=eq.false` +
      `&tags=cs.${encodeURIComponent(`{"${tag.replace(/"/g, "")}"}`)}${channelFilter}` +
      `&select=ghl_contact_id,name,phone,email&limit=5000`
    );
    const list = (audience || []).filter(c => c.ghl_contact_id);
    if (!list.length) return res.status(200).json({ ok: true, total: 0, message: "No eligible contacts (after removing do-not-contact + missing " + (channel === "Email" ? "email" : "phone") + ")." });

    const jobRows = await sb(`mass_send_jobs?select=id`, { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ client_id: clientId, channel, tag, subject: channel === "Email" ? subject : null, body: text, attachments, status: "queued", total: list.length }]) });
    const jobId = Array.isArray(jobRows) && jobRows[0] && jobRows[0].id;
    // Insert recipients in chunks.
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500).map(c => ({ job_id: jobId, client_id: clientId, contact_id: c.ghl_contact_id, name: c.name || null, phone: c.phone || null, email: c.email || null }));
      await sb(`mass_send_recipients`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(chunk) });
    }
    return res.status(200).json({ ok: true, job_id: jobId, total: list.length, channel });
  }

  return res.status(405).json({ error: "unsupported" });
}

export default withSentryApiRoute(handler);
