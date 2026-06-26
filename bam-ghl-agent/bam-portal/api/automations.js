import { withSentryApiRoute } from "./_sentry.js";
// Automation engine (P4a) — the portal-native scheduler for the 👻 Ghosted +
// 💔 Lead Nurture sequences. Three jobs:
//   1. enrollContact / exitEnrollment — helpers the P6 triggers call (exported).
//   2. GET ?action=work (Bearer CRON_SECRET) — the per-minute worker that sends due
//      step jobs and schedules the next step.
//   3. POST staff actions — the step-builder CRUD (list / upsert-automation /
//      upsert-step / delete-step / reorder / set-enabled / set-approved).
//
// INERT until an academy has an automation that is BOTH enabled AND approved with
// >= 1 enabled step AND a contact enrolled. A step send NEVER double-fires:
// every job carries a unique dedupe_key (enrollment_id:step_id) and the worker
// CLAIMS a job with a conditional pending->sending update before sending.

import { pickGhlToken, ghl } from "./ghl/_core.js";
import { nurtureStage } from "./agent/_stage.js";
import { sendOn } from "./_send.js";
import { renderEmail } from "./email-shells.js";
import { withinQuietHours, nextSendableTime } from "./agent/_quiet.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const WORK_CAP             = 50;       // max jobs processed per worker run
const MAX_ATTEMPTS         = 3;
const RETRY_BACKOFF_MS     = 5 * 60 * 1000;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
  return Array.isArray(rows) && rows[0];
}

async function logEvent({ clientId, contactId, automationId, type, payload }) {
  try {
    await sb(`automation_events`, { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ client_id: clientId || null, contact_id: contactId || null, automation_id: automationId || null, type: type || null, payload: payload || null }]) });
  } catch (_) { /* audit is best-effort */ }
}

// ── time math ──
function addWait(date, amount, unit) {
  const d = new Date(date.getTime());
  const n = Number(amount) || 0;
  switch (unit) {
    case "minutes": d.setTime(d.getTime() + n * 60000); break;
    case "hours":   d.setTime(d.getTime() + n * 3600000); break;
    case "weeks":   d.setTime(d.getTime() + n * 7 * 86400000); break;
    case "months":  d.setMonth(d.getMonth() + n); break;
    case "days":
    default:        d.setTime(d.getTime() + n * 86400000); break;
  }
  return d;
}

async function loadSteps(automationId) {
  const rows = await sb(`automation_steps?automation_id=eq.${automationId}&order=position.asc&select=*`);
  return Array.isArray(rows) ? rows : [];
}
const enabledSteps = (steps) => steps.filter(s => s.enabled).sort((a, b) => a.position - b.position);

// Schedule the job for one step of one enrollment. Idempotent via the dedupe_key
// unique index (re-scheduling the same step is a no-op).
async function scheduleStepJob({ clientId, automationId, enrollmentId, step, contactId, fromDate }) {
  const runAfter = nextSendableTime(addWait(fromDate || new Date(), step.wait_amount, step.wait_unit));
  const row = {
    client_id: clientId, automation_id: automationId, enrollment_id: enrollmentId, step_id: step.id,
    contact_id: String(contactId), channel: step.channel, run_after: runAfter.toISOString(),
    status: "pending", dedupe_key: `${enrollmentId}:${step.id}`,
  };
  try {
    await sb(`automation_jobs?on_conflict=dedupe_key`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify([row]) });
  } catch (_) { /* duplicate dedupe_key — already scheduled */ }
  return runAfter;
}

// ── EXPORTED: enroll a contact into an academy's automation (called by P6 triggers) ──
export async function enrollContact({ clientId, automationKey, contactId }) {
  if (!clientId || !automationKey || !contactId) return { skipped: "missing args" };
  const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=*&limit=1`);
  const auto = Array.isArray(autos) && autos[0];
  if (!auto) return { skipped: "no enabled+approved automation" };
  const steps = enabledSteps(await loadSteps(auto.id));
  if (!steps.length) return { skipped: "no enabled steps" };

  // One active enrollment per contact per automation (honor the partial unique index).
  const existing = await sb(`automation_enrollments?client_id=eq.${clientId}&automation_id=eq.${auto.id}&contact_id=eq.${encodeURIComponent(String(contactId))}&status=eq.active&select=id&limit=1`);
  if (Array.isArray(existing) && existing[0]) return { skipped: "already enrolled", enrollment_id: existing[0].id };

  let enrollment;
  try {
    const ins = await sb(`automation_enrollments`, { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ client_id: clientId, automation_id: auto.id, contact_id: String(contactId), status: "active", current_position: steps[0].position }]) });
    enrollment = Array.isArray(ins) && ins[0];
  } catch (_) { return { skipped: "enroll race (already active)" }; }
  if (!enrollment) return { skipped: "enroll failed" };

  await scheduleStepJob({ clientId, automationId: auto.id, enrollmentId: enrollment.id, step: steps[0], contactId, fromDate: new Date() });
  await logEvent({ clientId, contactId, automationId: auto.id, type: "enrolled", payload: { automation_key: automationKey } });
  return { ok: true, enrollment_id: enrollment.id };
}

// ── EXPORTED: exit a contact's active enrollment(s) (P6 calls on reply → Booking) ──
export async function exitEnrollment({ clientId, automationKey = null, contactId, reason = "exited" }) {
  if (!clientId || !contactId) return { skipped: "missing args" };
  let autoFilter = "";
  if (automationKey) {
    const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(automationKey)}&select=id`);
    const ids = (Array.isArray(autos) ? autos : []).map(a => a.id);
    if (!ids.length) return { skipped: "no such automation" };
    autoFilter = `&automation_id=in.(${ids.join(",")})`;
  }
  const active = await sb(`automation_enrollments?client_id=eq.${clientId}&contact_id=eq.${encodeURIComponent(String(contactId))}&status=eq.active${autoFilter}&select=id,automation_id`);
  let exited = 0;
  for (const e of (Array.isArray(active) ? active : [])) {
    try {
      await sb(`automation_enrollments?id=eq.${e.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "exited", exited_at: new Date().toISOString(), exit_reason: reason }) });
      await sb(`automation_jobs?enrollment_id=eq.${e.id}&status=in.(pending,sending)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", last_error: reason }) });
      await logEvent({ clientId, contactId, automationId: e.automation_id, type: "exited", payload: { reason } });
      exited++;
    } catch (_) {}
  }
  return { ok: true, exited };
}

// ── EXPORTED: is this academy's automation actually LIVE? (enabled + approved +
// at least one enabled step). The P6 triggers branch on this so live behavior is
// unchanged until an academy turns a portal sequence on (then it auto-switches off
// the GHL workflow / status=lost path). Fails CLOSED (false) on a DB error so a
// transient blip never flips a lead onto an unproven portal path. ──
export async function isAutomationLive(clientId, automationKey) {
  if (!clientId || !automationKey) return false;
  try {
    const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=id&limit=1`);
    const auto = Array.isArray(autos) && autos[0];
    if (!auto) return false;
    const steps = await sb(`automation_steps?automation_id=eq.${auto.id}&enabled=eq.true&select=id&limit=1`);
    return Array.isArray(steps) && steps.length > 0;
  } catch (_) { return false; }
}

// Find a contact's open opportunity id (for the ghosted->nurture stage move).
async function findOpenOppId(token, locationId, contactId) {
  try {
    const d = await ghl("GET", `/opportunities/search?${new URLSearchParams({ location_id: locationId, contact_id: String(contactId), limit: "20" })}`, { token });
    const opps = d.opportunities || d.data || [];
    return (opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0] || null)?.id || null;
  } catch (_) { return null; }
}

// ── the worker: send due jobs, then schedule the next step ──
// Exported so the confirm agent's scripted automations can resolve a lead's
// email/name the same way. `cache` is optional (the worker passes a shared Map).
export async function resolveContactInfo(token, contactId, cache = new Map()) {
  const key = String(contactId);
  if (cache.has(key)) return cache.get(key);
  let info = { email: null, phone: null, firstName: null, fullName: null };
  try {
    const d = await ghl("GET", `/contacts/${encodeURIComponent(key)}`, { token });
    const c = (d && (d.contact || d)) || {};
    const first = c.firstName || c.first_name || (c.name ? String(c.name).trim().split(/\s+/)[0] : null) || null;
    const full = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || first || null;
    info = { email: c.email || null, phone: c.phone || null, firstName: first, fullName: full };
  } catch (_) {}
  cache.set(key, info);
  return info;
}

async function runWork(res) {
  const nowIso = new Date().toISOString();
  let jobs = [];
  try {
    jobs = await sb(`automation_jobs?status=eq.pending&run_after=lte.${nowIso}&order=run_after.asc&limit=${WORK_CAP}&select=*`);
  } catch (e) { return res.status(500).json({ error: `load jobs: ${e.message}` }); }
  jobs = Array.isArray(jobs) ? jobs : [];

  const clientCache = new Map();   // clientId -> client
  const tokenCache  = new Map();   // clientId -> {token,locationId} | null
  const autoCache   = new Map();   // automationId -> automation
  const stepsCache  = new Map();   // automationId -> steps[]
  const contactCache = new Map();  // contactId -> {email,phone}
  let sent = 0, deferred = 0, advanced = 0, completed = 0, failed = 0, canceled = 0, lost = 0;

  for (const job of jobs) {
    // ATOMIC CLAIM: flip pending->sending ONLY if still pending. If 0 rows come
    // back, another worker already took it — skip (never double-send).
    let claimed;
    try {
      claimed = await sb(`automation_jobs?id=eq.${job.id}&status=eq.pending`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "sending" }) });
    } catch (_) { continue; }
    if (!Array.isArray(claimed) || !claimed.length) { lost++; continue; }

    const finish = (patch) => sb(`automation_jobs?id=eq.${job.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }).catch(() => {});
    // Schedule the next enabled step after `curPos`, or complete the enrollment.
    const advance = async (steps, curPos) => {
      const next = enabledSteps(steps).find(s => s.position > curPos);
      if (next) {
        await scheduleStepJob({ clientId: job.client_id, automationId: job.automation_id, enrollmentId: job.enrollment_id, step: next, contactId: job.contact_id, fromDate: new Date() });
        await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ current_position: next.position }) }).catch(() => {});
        advanced++;
      } else {
        await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", exited_at: new Date().toISOString(), exit_reason: "sequence complete" }) }).catch(() => {});
        await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "completed", payload: null });
        completed++;
        // Model: 👻 Ghosted ran out and they're STILL silent -> roll into 💔 Lead
        // Nurture (the sparse long game). Only when nurture is live; best-effort.
        try {
          const a = autoCache.get(job.automation_id);
          if (a && a.automation_key === "ghosted" && await isAutomationLive(job.client_id, "nurture")) {
            await enrollContact({ clientId: job.client_id, automationKey: "nurture", contactId: job.contact_id });
            const creds = tokenCache.get(job.client_id);
            if (creds && creds.token) {
              const ns = await nurtureStage(creds.token, creds.locationId);
              const oppId = await findOpenOppId(creds.token, creds.locationId, job.contact_id);
              if (ns && oppId) await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token: creds.token, body: { pipelineId: ns.pipelineId, pipelineStageId: ns.stageId } });
            }
            await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "ghosted_to_nurture", payload: null });
          }
        } catch (_) { /* best-effort roll-forward */ }
      }
    };

    try {
      // automation still live?
      if (!autoCache.has(job.automation_id)) {
        const a = await sb(`automations?id=eq.${job.automation_id}&select=*&limit=1`);
        autoCache.set(job.automation_id, (Array.isArray(a) && a[0]) || null);
      }
      const auto = autoCache.get(job.automation_id);
      if (!auto || !auto.enabled || !auto.approved) { await finish({ status: "canceled", last_error: "automation off" }); canceled++; continue; }

      // enrollment still active?
      const enr = await sb(`automation_enrollments?id=eq.${job.enrollment_id}&select=*&limit=1`);
      const enrollment = Array.isArray(enr) && enr[0];
      if (!enrollment || enrollment.status !== "active") { await finish({ status: "canceled", last_error: "enrollment not active" }); canceled++; continue; }

      // the step
      if (!stepsCache.has(job.automation_id)) stepsCache.set(job.automation_id, await loadSteps(job.automation_id));
      const steps = stepsCache.get(job.automation_id);
      const step = steps.find(s => s.id === job.step_id);

      // Step gone or turned off: skip it and advance, no send, no quiet-hours defer.
      if (!step || !step.enabled) {
        await finish({ status: "skipped", last_error: "step missing/disabled" });
        await advance(steps, step ? step.position : (enrollment.current_position || 0));
        continue;
      }

      // Quiet hours: never send outside the window — defer this job to next morning
      // (re-queue as pending; do NOT advance until it actually sends).
      if (!withinQuietHours()) {
        await finish({ status: "pending", run_after: nextSendableTime().toISOString() });
        deferred++; continue;
      }

      // creds + contact info
      if (!clientCache.has(job.client_id)) clientCache.set(job.client_id, await loadClient(job.client_id));
      const client = clientCache.get(job.client_id);
      if (!tokenCache.has(job.client_id)) tokenCache.set(job.client_id, client ? await pickGhlToken(client) : null);
      const creds = tokenCache.get(job.client_id);
      const token = creds && creds.token;
      const info = token ? await resolveContactInfo(token, job.contact_id, contactCache) : { email: null, phone: null, firstName: null, fullName: null };

      const result = await sendOn({
        channel: step.channel, clientId: job.client_id, contactId: job.contact_id,
        toEmail: info.email, toPhone: info.phone, subject: step.subject, body: step.body, ghlToken: token,
        vars: { first_name: info.firstName, full_name: info.fullName },
      });

      if (result && result.sent) { await finish({ status: "sent", sent_at: new Date().toISOString() }); sent++; await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "step_sent", payload: { step_id: job.step_id, channel: step.channel } }); }
      else { await finish({ status: "skipped", last_error: (result && result.skipped) || "skipped" }); }

      // ADVANCE past this step (a suppressed/no-contact skip still moves the sequence on).
      await advance(steps, step.position);
    } catch (e) {
      // Send/processing failed — retry up to MAX_ATTEMPTS, else mark failed.
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) { await finish({ status: "failed", attempts, last_error: String(e.message || e).slice(0, 300) }); failed++; }
      else { await finish({ status: "pending", attempts, last_error: String(e.message || e).slice(0, 300), run_after: nextSendableTime(new Date(Date.now() + RETRY_BACKOFF_MS)).toISOString() }); }
    }
  }
  return res.status(200).json({ ok: true, picked: jobs.length, sent, deferred, advanced, completed, failed, canceled, lost_race: lost });
}

// ── staff CRUD (backs the P4b step-builder) ──
async function handler(req, res) {
  if (req.method === "GET" && req.query.action === "work") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    return await runWork(res);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });

  try {
    if (b.action === "list") {
      const autos = await sb(`automations?client_id=eq.${clientId}&order=automation_key.asc&select=*`) || [];
      const out = [];
      for (const a of autos) out.push({ ...a, steps: await loadSteps(a.id) });
      return res.status(200).json({ automations: out });
    }

    // Render an email step to full HTML for the in-portal preview modal. Uses the
    // SAME renderEmail the sender uses (template:<key> refs resolved, brand frame,
    // GHL merge tokens) so the preview matches the real send. Sample contact tokens.
    if (b.action === "preview-email") {
      const html = renderEmail({
        clientId,
        subject: b.subject || "",
        body: b.body || "",
        vars: { first_name: "Alex", athlete: "Jordan" },
      });
      return res.status(200).json({ html, subject: b.subject || "" });
    }

    if (b.action === "upsert-automation") {
      if (!b.automation_key) return res.status(400).json({ error: "automation_key required" });
      const row = {
        client_id: clientId, automation_key: String(b.automation_key),
        name: b.name ?? null, enabled: !!b.enabled, approved: !!b.approved,
        ghl_stage_name: b.ghl_stage_name ?? null, updated_at: new Date().toISOString(),
      };
      const r = await sb(`automations?on_conflict=client_id,automation_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([row]) });
      return res.status(200).json({ ok: true, automation: Array.isArray(r) && r[0] });
    }

    // Verify an automation_id belongs to this academy before mutating its steps.
    async function ownsAutomation(automationId) {
      const a = await sb(`automations?id=eq.${automationId}&client_id=eq.${clientId}&select=id&limit=1`);
      return Array.isArray(a) && !!a[0];
    }

    if (b.action === "upsert-step") {
      if (!b.automation_id || !(await ownsAutomation(b.automation_id))) return res.status(403).json({ error: "unknown automation" });
      if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: "body required" });
      if (!["sms", "email"].includes(b.channel)) return res.status(400).json({ error: "channel must be sms|email" });
      const row = {
        automation_id: b.automation_id, position: Number(b.position) || 0,
        wait_amount: Number(b.wait_amount) || 0, wait_unit: b.wait_unit || "days",
        channel: b.channel, subject: b.subject ?? null, body: String(b.body),
        enabled: b.enabled === undefined ? true : !!b.enabled, updated_at: new Date().toISOString(),
      };
      let r;
      if (b.id) r = await sb(`automation_steps?id=eq.${encodeURIComponent(b.id)}&automation_id=eq.${b.automation_id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      else r = await sb(`automation_steps`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([row]) });
      return res.status(200).json({ ok: true, step: Array.isArray(r) && r[0] });
    }

    if (b.action === "delete-step") {
      if (!b.step_id) return res.status(400).json({ error: "step_id required" });
      const s = await sb(`automation_steps?id=eq.${encodeURIComponent(b.step_id)}&select=automation_id&limit=1`);
      const aId = Array.isArray(s) && s[0] && s[0].automation_id;
      if (!aId || !(await ownsAutomation(aId))) return res.status(403).json({ error: "unknown step" });
      await sb(`automation_steps?id=eq.${encodeURIComponent(b.step_id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return res.status(200).json({ ok: true });
    }

    if (b.action === "reorder") {
      if (!b.automation_id || !(await ownsAutomation(b.automation_id))) return res.status(403).json({ error: "unknown automation" });
      const ids = Array.isArray(b.ordered_step_ids) ? b.ordered_step_ids : [];
      for (let i = 0; i < ids.length; i++) {
        await sb(`automation_steps?id=eq.${encodeURIComponent(ids[i])}&automation_id=eq.${b.automation_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ position: i, updated_at: new Date().toISOString() }) }).catch(() => {});
      }
      return res.status(200).json({ ok: true, reordered: ids.length });
    }

    if (b.action === "set-enabled" || b.action === "set-approved") {
      if (!b.automation_id || !(await ownsAutomation(b.automation_id))) return res.status(403).json({ error: "unknown automation" });
      const field = b.action === "set-enabled" ? "enabled" : "approved";
      await sb(`automations?id=eq.${b.automation_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ [field]: !!b.value, updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    // Read-only observability (guardrail #8): how many leads are in each automation,
    // total + per current step. Counts come from active enrollments grouped by
    // current_position, aligned to the ordered steps.
    if (b.action === "overview") {
      const autos = await sb(`automations?client_id=eq.${clientId}&order=automation_key.asc&select=*`) || [];
      const out = [];
      for (const a of autos) {
        const steps = await loadSteps(a.id);
        const enr = await sb(`automation_enrollments?client_id=eq.${clientId}&automation_id=eq.${a.id}&status=eq.active&select=current_position&limit=5000`) || [];
        const list = Array.isArray(enr) ? enr : [];
        const byPos = new Map();
        for (const e of list) byPos.set(e.current_position, (byPos.get(e.current_position) || 0) + 1);
        const by_step = steps.map((s, i) => ({
          position: s.position, step_id: s.id, channel: s.channel,
          label: String(i + 1), preview: String(s.body || "").slice(0, 60),
          count: byPos.get(s.position) || 0,
        }));
        out.push({ id: a.id, automation_key: a.automation_key, name: a.name, enabled: a.enabled, approved: a.approved, total_active: list.length, by_step });
      }
      return res.status(200).json({ overview: out });
    }

    // The people currently in one automation (optionally at one step position).
    if (b.action === "people") {
      if (!b.automation_id || !(await ownsAutomation(b.automation_id))) return res.status(403).json({ error: "unknown automation" });
      let path = `automation_enrollments?client_id=eq.${clientId}&automation_id=eq.${b.automation_id}&status=eq.active&select=contact_id,current_position,entered_at&order=entered_at.desc&limit=200`;
      if (b.position !== undefined && b.position !== null && b.position !== "") path += `&current_position=eq.${Number(b.position)}`;
      const rows = (await sb(path)) || [];
      const ids = [...new Set(rows.map(r => r.contact_id).filter(Boolean))];
      const nameMap = {};
      if (ids.length) {
        try {
          const inList = ids.map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
          const contacts = (await sb(`ghl_contacts?client_id=eq.${clientId}&ghl_contact_id=in.(${inList})&select=ghl_contact_id,name,athlete_name`)) || [];
          for (const c of contacts) nameMap[c.ghl_contact_id] = c.name || c.athlete_name || null;
        } catch (_) { /* names are best-effort */ }
      }
      const people = rows.map(r => ({ contact_id: r.contact_id, contact_name: nameMap[r.contact_id] || null, current_position: r.current_position, entered_at: r.entered_at }));
      return res.status(200).json({ people });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[automations]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
