import { withSentryApiRoute } from "./_sentry.js";
import { contactsReadTable } from "./_contacts.js";
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
import { nurtureStage, interestedStage, scheduledTrialContactIdSetCached } from "./agent/_stage.js";
import { moveStage, setStatus, findOpenOpp as findOpenOppStore } from "./agent/_store.js";
import { routeTransition } from "./agent/_router.js";
import { nextSessionLabel } from "./_next_session.js";
import { sendOn } from "./_send.js";
import { renderEmail } from "./email-shells.js";
import { withinQuietHours, nextSendableTime, quietTz } from "./agent/_quiet.js";
import { isMuted } from "./agent/_mutes.js";
import { resolveAgentActor } from "./agent/_auth.js";
import { FORM_INTRO_DEFAULTS, GHOSTED_DEFAULT } from "./form-intro-automations.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const WORK_CAP             = 50;       // max jobs processed per worker run
const MAX_ATTEMPTS         = 3;
const RETRY_BACKOFF_MS     = 5 * 60 * 1000;

// ── re-arm sweep config (GET ?action=rearm) ──
// A lead that REPLIED (exited 👻 Ghosted on reply → bounced to Responded), got an
// agent answer, then went SILENT again has NO active engine watching it: the agent
// only acts on inbound replies, and Ghosted exited permanently on that one reply.
// After a few days it's the classic "silently stuck" case the client-portal panel
// only DISPLAYS. This sweep ACTS on it: re-enroll into Ghosted (+ move the opp back
// to the Interested/ghosted stage, mirroring the worker's form-intro roll-forward)
// so the long game picks the lead back up. Env-tunable; sane defaults for v1.
const REARM_IDLE_DAYS    = Number(process.env.REARM_IDLE_DAYS || 3);      // silent this long → re-arm (matches the panel's 3d)
const REARM_COOLDOWN_HRS = Number(process.env.REARM_COOLDOWN_HRS || 48);  // don't re-arm within this of the last Ghosted enrollment (anti-loop)
const REARM_MAX_GHOSTED  = Number(process.env.REARM_MAX_GHOSTED || 3);    // cap total Ghosted enrollments per lead (1 original + 2 re-arms) then leave for staff
const REARM_CAP          = 200;                                           // max opps scanned per run

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
  const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,time_zone,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config&limit=1`);
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
// UNIQUE CONSTRAINT (re-scheduling the same step is a no-op via ignore-duplicates).
//
// ⚠️ Postmortem (2026-07-10): dedupe was originally a PARTIAL unique index
// (where dedupe_key is not null). PostgREST's on_conflict=dedupe_key emits plain
// ON CONFLICT (dedupe_key), which Postgres REJECTS against a partial index
// (42P10) - so EVERY job insert failed, the silent catch below ate it, and the
// whole automation engine stopped queueing for a week while enrollments looked
// "active". Fixed by the fix_automation_jobs_dedupe_constraint migration (plain
// unique constraint) + this catch now LOGS. With ignore-duplicates a true dupe
// returns 200 (no throw), so anything landing in the catch is a REAL failure.
async function scheduleStepJob({ clientId, automationId, enrollmentId, step, contactId, fromDate }) {
  const runAfter = nextSendableTime(addWait(fromDate || new Date(), step.wait_amount, step.wait_unit));
  const row = {
    client_id: clientId, automation_id: automationId, enrollment_id: enrollmentId, step_id: step.id,
    contact_id: String(contactId), channel: step.channel, run_after: runAfter.toISOString(),
    status: "pending", dedupe_key: `${enrollmentId}:${step.id}`,
  };
  // Return whether the job actually got queued so callers don't record a healthy
  // active enrollment with ZERO pending jobs (the "looks healthy, sends nothing"
  // stall). Deterministic every-insert failure can't recur post dedupe-constraint
  // fix, but a transient PostgREST error would strand one enrollment silently (#27).
  try {
    await sb(`automation_jobs?on_conflict=dedupe_key`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify([row]) });
    return { ok: true, runAfter };
  } catch (e) {
    console.error(`[automations] scheduleStepJob FAILED (enrollment ${enrollmentId}, step ${step.id}): ${e.message}`);
    return { ok: false, runAfter, error: e.message || String(e) };
  }
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

  const sched = await scheduleStepJob({ clientId, automationId: auto.id, enrollmentId: enrollment.id, step: steps[0], contactId, fromDate: new Date() });
  if (!sched.ok) {
    // The first job never queued: don't leave a phantom-active enrollment that
    // will never send. Exit it with a visible reason so it's not silently stalled.
    try { await sb(`automation_enrollments?id=eq.${enrollment.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "exited", exited_at: new Date().toISOString(), exit_reason: `first step not scheduled: ${(sched.error || "unknown").slice(0, 160)}` }) }); } catch (_) {}
    return { error: "could not schedule the first step", detail: sched.error };
  }
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
  } else {
    // KEYLESS exit (payment "converted", reply "replied", booking "booked"): exit ALL
    // active enrollments EXCEPT the 🎉 onboarding welcome. A brand-new member who just
    // paid (or replies during onboarding) must keep getting their welcome sequence: a
    // keyless sweep used to cancel it too. Exclude only the `onboarding` automation; a
    // caller that genuinely needs to exit onboarding passes automationKey:"onboarding".
    const obAutos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.onboarding&select=id`);
    const obIds = (Array.isArray(obAutos) ? obAutos : []).map(a => a.id);
    if (obIds.length) autoFilter = `&automation_id=not.in.(${obIds.join(",")})`;
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

// Find a contact's open opportunity (provider-aware). Returns an oppRef
// { id?, ghlOpportunityId? } | null — store on provider='portal' (so portal-native
// opps are found), GHL search otherwise. Best-effort: null on any failure.
async function findOpenOppRef(clientId, token, locationId, contactId) {
  try { return await findOpenOppStore({ clientId, ghl, token, locationId, contactId }); }
  catch (_) { return null; }
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
  const contactCache = new Map();  // contactId -> {email,phone,firstName,fullName}
  const calCache    = new Map();   // clientId -> first calendar entry-point key | null
  let sent = 0, deferred = 0, advanced = 0, completed = 0, failed = 0, canceled = 0, lost = 0, nurtureLost = 0, ghostedLost = 0, formToGhosted = 0;

  // RECLAIM stuck claims: a worker that crashed or timed out between claiming a
  // job ('sending') and finishing it left the job in 'sending' FOREVER - the
  // pending-only picker above never saw it again and the enrollment stalled.
  // Any 'sending' job untouched for 15+ min goes back to pending (run_after
  // restamped so it runs next tick). The atomic claim below still guarantees
  // only one worker wins it.
  try {
    const staleIso = new Date(Date.now() - 15 * 60000).toISOString();
    await sb(`automation_jobs?status=eq.sending&run_after=lte.${staleIso}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "pending", run_after: nowIso }) });
  } catch (_) { /* best-effort - next run retries */ }

  for (const job of jobs) {
    // ATOMIC CLAIM: flip pending->sending ONLY if still pending. If 0 rows come
    // back, another worker already took it — skip (never double-send). The claim
    // restamps run_after so a crashed worker's job is reclaimable (see above).
    let claimed;
    try {
      claimed = await sb(`automation_jobs?id=eq.${job.id}&status=eq.pending`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "sending", run_after: nowIso }) });
    } catch (_) { continue; }
    if (!Array.isArray(claimed) || !claimed.length) { lost++; continue; }

    const finish = (patch) => sb(`automation_jobs?id=eq.${job.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }).catch(() => {});
    // Lazily load this client's GHL creds into the shared caches. The completion
    // branch can fire on the step-missing/disabled advance path where creds were
    // never loaded before the send, so roll-forward/terminal handlers call this.
    const ensureCreds = async () => {
      if (!clientCache.has(job.client_id)) clientCache.set(job.client_id, await loadClient(job.client_id));
      const client = clientCache.get(job.client_id);
      if (!tokenCache.has(job.client_id)) tokenCache.set(job.client_id, client ? await pickGhlToken(client) : null);
      return tokenCache.get(job.client_id);
    };
    // Schedule the next enabled step after `curPos`, or complete the enrollment.
    const advance = async (steps, curPos) => {
      const next = enabledSteps(steps).find(s => s.position > curPos);
      if (next) {
        const sched = await scheduleStepJob({ clientId: job.client_id, automationId: job.automation_id, enrollmentId: job.enrollment_id, step: next, contactId: job.contact_id, fromDate: new Date() });
        if (sched.ok) {
          await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ current_position: next.position }) }).catch(() => {});
          advanced++;
        } else {
          // Next step never queued - don't bump position onto a phantom-active
          // enrollment. Exit it with a visible reason instead of a silent stall (#27).
          await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "exited", exited_at: new Date().toISOString(), exit_reason: `next step not scheduled: ${(sched.error || "unknown").slice(0, 160)}` }) }).catch(() => {});
        }
      } else {
        await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", exited_at: new Date().toISOString(), exit_reason: "sequence complete" }) }).catch(() => {});
        await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "completed", payload: null });
        completed++;
        // L1/L3: 📝 contact_form / 🏀 trial_form / ⏰ missed_trial INTRO sent its step(s) and they
        // never replied -> the lead is stranded in Interested where nobody watches
        // (the ghost detector + agent only scan Responded). Roll them into 👻 Ghosted
        // so the long game picks up, mirroring the ghosted->nurture roll below
        // (enroll + move the opp to the Interested/ghosted stage via interestedStage).
        // Best-effort + idempotent; only when ghosted is live, else leave them put.
        try {
          const a = autoCache.get(job.automation_id);
          if (a && (a.automation_key === "contact_form" || a.automation_key === "trial_form" || a.automation_key === "missed_trial") && await isAutomationLive(job.client_id, "ghosted")) {
            await enrollContact({ clientId: job.client_id, automationKey: "ghosted", contactId: job.contact_id });
            const creds = await ensureCreds();
            if (creds && creds.token) {
              const is = await interestedStage(creds.token, creds.locationId, { clientId: job.client_id, sb });
              const oppRef = await findOpenOppRef(job.client_id, creds.token, creds.locationId, job.contact_id);
              // role MUST be "interested" - that's the canonical stage_role for the
              // Ghosted-automation stage everywhere (seed, enum, reply-bounce guards).
              // Stamping "ghosted" here left portal-store opps invisible to every
              // guard that checks stage_role=interested, so a reply from Ghosted
              // exited the automation but never bounced back to Booking.
              if (is && oppRef) await moveStage({ clientId: job.client_id, ghl, token: creds.token, oppRef, stage: is, role: "interested", contactId: job.contact_id, reason: "intro form sent, no reply - rolled into ghosted" });
            }
            await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "form_intro_to_ghosted", payload: { automation_key: a.automation_key } });
            formToGhosted++;
          }
        } catch (_) { /* best-effort roll-forward */ }
        // Model: 👻 Ghosted ran out and they're STILL silent -> roll into 💔 Lead
        // Nurture (the sparse long game). ☀️ Summer Special hands off the same way (its
        // last SMS is the final nudge before the long game). Only when nurture is live;
        // best-effort. L2(a): if nurture is NOT live, the lead would otherwise sit open +
        // idle forever -> fall back to a GHL-native terminal LOST + a pipeline_outcomes
        // row (mirrors confirm-lost), so the lead leaves the open board.
        try {
          const a = autoCache.get(job.automation_id);
          if (a && (a.automation_key === "ghosted" || a.automation_key === "summer_special")) {
            if (await isAutomationLive(job.client_id, "nurture")) {
              await enrollContact({ clientId: job.client_id, automationKey: "nurture", contactId: job.contact_id });
              const creds = await ensureCreds();
              if (creds && creds.token) {
                const oppRef = await findOpenOppRef(job.client_id, creds.token, creds.locationId, job.contact_id);
                // Roll into the long game per the academy's authored flow (the
                // ghosted_ran_out edge; GTA seed = interested -> nurture). Router
                // reads the edge; on no edge (unseeded / paused / lookup blip) it
                // returns matched:false and we run the original hardcoded move to
                // nurture - behavior-identical for GTA.
                const routed = await routeTransition({ clientId: job.client_id, sb, ghl, token: creds.token, locationId: creds.locationId, fromRole: "interested", trigger: "ghosted_ran_out", contactId: job.contact_id, oppRef, reason: `${a.automation_key} ran out - rolled into nurture` });
                if (!routed.matched) {
                  const ns = await nurtureStage(creds.token, creds.locationId, { clientId: job.client_id, sb });
                  if (ns && oppRef) await moveStage({ clientId: job.client_id, ghl, token: creds.token, oppRef, stage: ns, role: "nurture", contactId: job.contact_id, reason: `${a.automation_key} ran out - rolled into nurture` });
                }
              }
              await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: `${a.automation_key}_to_nurture`, payload: null });
            } else {
              const creds = await ensureCreds();
              if (creds && creds.token) {
                const oppRef = await findOpenOppRef(job.client_id, creds.token, creds.locationId, job.contact_id);
                const oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null;
                if (oppRef) {
                  try { await setStatus({ clientId: job.client_id, ghl, token: creds.token, oppRef, status: "lost", contactId: job.contact_id, reason: "ghosted exhausted, nurture off" }); } catch (_) { /* best-effort */ }
                  try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: job.client_id, opportunity_id: oppId, status: "lost", reason: "ghosted exhausted, nurture off" }]) }); } catch (_) {}
                  await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "ghosted_exhausted_lost", payload: { opportunity_id: oppId } });
                  ghostedLost++;
                }
              }
            }
          }
        } catch (_) { /* best-effort roll-forward */ }
        // Model: 💔 Lead Nurture is the LAST stop. If the nurture sequence itself runs
        // out and they're STILL silent, the lead has been worked the full long game with
        // no reply -> terminal LOST. Mark the opp lost (leaves the open board) + write a
        // pipeline_outcomes row. Do NOT re-enroll anywhere (that would loop). Best-effort
        // + idempotent: a nurture enrollment completes exactly once (status flips to
        // 'completed' so this branch can't re-fire for the same enrollment).
        // TODO: the GHL PUT becomes portal-native once effort E (opportunity store) lands.
        try {
          const a = autoCache.get(job.automation_id);
          if (a && a.automation_key === "nurture") {
            // creds may not be cached on the step-missing/disabled advance path — load them.
            if (!clientCache.has(job.client_id)) clientCache.set(job.client_id, await loadClient(job.client_id));
            const client = clientCache.get(job.client_id);
            if (!tokenCache.has(job.client_id)) tokenCache.set(job.client_id, client ? await pickGhlToken(client) : null);
            const creds = tokenCache.get(job.client_id);
            if (creds && creds.token) {
              const oppRef = await findOpenOppRef(job.client_id, creds.token, creds.locationId, job.contact_id);
              const oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null;
              if (oppRef) {
                try { await setStatus({ clientId: job.client_id, ghl, token: creds.token, oppRef, status: "lost", contactId: job.contact_id, reason: "nurture sequence exhausted" }); } catch (_) { /* best-effort */ }
                try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: job.client_id, opportunity_id: oppId, status: "lost", reason: "nurture sequence exhausted" }]) }); } catch (_) {}
                await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "nurture_exhausted_lost", payload: { opportunity_id: oppId } });
                nurtureLost++;
              }
            }
          }
        } catch (_) { /* best-effort terminal disposition */ }
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

      // Bot muted on this lead (global mute): stop the whole sequence - a spam-
      // marked lead shouldn't keep getting ghosted/nurture/form-intro drips. Exit
      // the enrollment so it never re-queues. Agent-specific mutes don't apply
      // here (automations aren't one agent); a global "mute all bots" does.
      if (await isMuted(job.client_id, job.contact_id, null)) {
        await finish({ status: "canceled", last_error: "bot muted on this lead" });
        try { await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "exited", exited_at: new Date().toISOString(), exit_reason: "bot muted on this lead" }) }); } catch (_) {}
        canceled++; continue;
      }

      // Load the client BEFORE the quiet-hours check: quiet hours are evaluated in
      // the academy's own timezone (clients.time_zone), so `client` must exist here.
      if (!clientCache.has(job.client_id)) clientCache.set(job.client_id, await loadClient(job.client_id));
      const client = clientCache.get(job.client_id);

      // Quiet hours: never send outside the window — defer this job to next morning
      // (re-queue as pending; do NOT advance until it actually sends).
      if (!withinQuietHours(new Date(), quietTz(client))) {
        await finish({ status: "pending", run_after: nextSendableTime(new Date(), quietTz(client)).toISOString() });
        deferred++; continue;
      }

      // creds + contact info
      if (!tokenCache.has(job.client_id)) tokenCache.set(job.client_id, client ? await pickGhlToken(client) : null);
      const creds = tokenCache.get(job.client_id);
      const token = creds && creds.token;
      const info = token ? await resolveContactInfo(token, job.contact_id, contactCache) : { email: null, phone: null, firstName: null, fullName: null };

      // 🏀 trial_form: if they've since BOOKED (now in the Scheduled Trial
      // stage, via any path) the 20-min nudge is moot - exit + skip the send.
      if (auto.automation_key === "trial_form" && token && creds.locationId) {
        try {
          const booked = await scheduledTrialContactIdSetCached(token, creds.locationId, 60000, { clientId: job.client_id, sb });
          if (booked && booked.has(String(job.contact_id))) {
            await sb(`automation_enrollments?id=eq.${job.enrollment_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "exited", exited_at: new Date().toISOString(), exit_reason: "booked" }) }).catch(() => {});
            await finish({ status: "skipped", last_error: "booked - in scheduled trial" });
            continue;
          }
        } catch (_) { /* fail open: send the nudge */ }
      }

      // {{next_session}} token: resolve the academy's next OPEN trial slot
      // (best-effort, only when the copy actually uses it). Phrasing lives here
      // so the sentence drops out cleanly when no slot is known.
      let next_session = "";
      if (token && /next_session/.test(`${step.body || ""}${step.subject || ""}`)) {
        try {
          if (!calCache.has(job.client_id)) {
            const eps = await sb(`entry_points?client_id=eq.${job.client_id}&type=eq.calendar&enabled=eq.true&select=key&limit=1`);
            calCache.set(job.client_id, (Array.isArray(eps) && eps[0] && eps[0].key) || null);
          }
          const calId = calCache.get(job.client_id);
          const label = calId ? await nextSessionLabel({ calendarId: calId, token, timezone: (client && client.time_zone) || "America/Toronto" }) : "";
          if (label) next_session = `Our next session is ${label}. `;
        } catch (_) { /* leave it blank */ }
      }

      // {{athletes_full_name}} token: the athlete (child) name, resolved by the
      // contact sync into ghl_contacts.athlete_name (the "resolver"). Only looked
      // up when the copy uses it; blank falls back to "your athlete" in the shell.
      let athlete = "";
      if (/athlet/i.test(`${step.body || ""}${step.subject || ""}`)) {
        try {
          const rows = await sb(`${await contactsReadTable(job.client_id)}?client_id=eq.${job.client_id}&ghl_contact_id=eq.${encodeURIComponent(job.contact_id)}&select=athlete_name&limit=1`);
          athlete = (Array.isArray(rows) && rows[0] && rows[0].athlete_name) || "";
        } catch (_) { /* leave blank */ }
      }

      const result = await sendOn({
        channel: step.channel, clientId: job.client_id, contactId: job.contact_id,
        toEmail: info.email, toPhone: info.phone, subject: step.subject, body: step.body, ghlToken: token,
        vars: { first_name: info.firstName, full_name: info.fullName, athlete, next_session },
      });

      if (result && result.sent) { await finish({ status: "sent", sent_at: new Date().toISOString() }); sent++; await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "step_sent", payload: { step_id: job.step_id, channel: step.channel } }); }
      else { await finish({ status: "skipped", last_error: (result && result.skipped) || "skipped" }); }

      // ADVANCE past this step (a suppressed/no-contact skip still moves the sequence on).
      await advance(steps, step.position);
    } catch (e) {
      // Send/processing failed — retry up to MAX_ATTEMPTS, else mark failed.
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) { await finish({ status: "failed", attempts, last_error: String(e.message || e).slice(0, 300) }); failed++; }
      else { await finish({ status: "pending", attempts, last_error: String(e.message || e).slice(0, 300), run_after: nextSendableTime(new Date(Date.now() + RETRY_BACKOFF_MS), quietTz(client)).toISOString() }); }
    }
  }
  return res.status(200).json({ ok: true, picked: jobs.length, sent, deferred, advanced, completed, failed, canceled, nurture_lost: nurtureLost, ghosted_lost: ghostedLost, form_to_ghosted: formToGhosted, lost_race: lost });
}

// Newest GHL message timestamp (ms, ANY direction) for a contact — the SAME signal
// the client-portal panel trusts for "idle". Returns null when it can't be
// determined (no creds / API error) so the caller fails SAFE and never re-arms a
// lead it couldn't verify. Any-direction is deliberate: the agent's own outbound
// sends land here too, so we never re-arm right after we just messaged the lead.
async function lastGhlMessageMs(token, locationId, contactId) {
  try {
    const search = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId: String(contactId) })}`, { token });
    const convos = (search && (search.conversations || search.data)) || [];
    let ms = 0;
    for (const c of convos) { const t = c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0; if (t > ms) ms = t; }
    return ms;
  } catch (_) { return null; }
}

// ── the re-arm sweep: put silently-stuck Responded leads back into 👻 Ghosted ──
// Population = the SAME leads the client-portal "not flowing" panel surfaces
// (open + Responded + no active engine + idle), computed server-side so we ACT,
// not just display. Scopes itself safely to portal-native academies: the
// `opportunities` store only holds portal-provider opps, and the ghosted live-gate
// (isAutomationLive) is false for V1/GHL-workflow academies, so this never touches
// V1. Best-effort per lead; a single failure never aborts the sweep.
async function runRearm(res) {
  const IDLE_MS     = REARM_IDLE_DAYS * 86400000;
  const COOLDOWN_MS = REARM_COOLDOWN_HRS * 3600000;
  const cutoffIso   = new Date(Date.now() - IDLE_MS).toISOString();

  let opps = [];
  try {
    // Coarse net: open opps in Responded whose store row last moved before the idle
    // cutoff. updated_at is only a FLOOR (the pipeline sync rewrites it in bulk, so
    // it is NOT a reliable "last activity" clock) — the authoritative idle gate is
    // the live GHL last-message check per candidate below, matching the panel.
    opps = await sb(`opportunities?status=eq.open&stage_role=eq.responded&updated_at=lte.${cutoffIso}&select=id,client_id,ghl_contact_id,contact_name,updated_at&order=updated_at.asc&limit=${REARM_CAP}`);
  } catch (e) { return res.status(500).json({ error: `load opps: ${e.message}` }); }
  opps = Array.isArray(opps) ? opps : [];

  const liveCache   = new Map();   // clientId -> ghosted live?
  const ghAutoCache = new Map();   // clientId -> ghosted automation id[]
  const clientCache = new Map();
  const tokenCache  = new Map();
  let armed = 0, noLive = 0, hasActive = 0, agentBusy = 0, recentTouch = 0, cooldown = 0, capped = 0, noCreds = 0, errors = 0;

  const creds = async (clientId) => {
    if (!clientCache.has(clientId)) clientCache.set(clientId, await loadClient(clientId));
    const client = clientCache.get(clientId);
    if (!tokenCache.has(clientId)) tokenCache.set(clientId, client ? await pickGhlToken(client) : null);
    return tokenCache.get(clientId);
  };

  for (const o of opps) {
    const cid = o.ghl_contact_id;
    const clientId = o.client_id;
    if (!cid || !clientId) continue;
    const enc = encodeURIComponent(String(cid));
    try {
      // 1) Ghosted must be LIVE for this academy (also the V1 firewall).
      if (!liveCache.has(clientId)) liveCache.set(clientId, await isAutomationLive(clientId, "ghosted"));
      if (!liveCache.get(clientId)) { noLive++; continue; }

      // 2) Already inside an active automation → it's flowing, leave it.
      const active = await sb(`automation_enrollments?client_id=eq.${clientId}&contact_id=eq.${enc}&status=eq.active&select=id&limit=1`);
      if (Array.isArray(active) && active[0]) { hasActive++; continue; }

      // 3) The agent is already on it (a queued/approved reply, or a parked
      //    reignition) → don't double up on the lead.
      const rr = await sb(`agent_ready_replies?client_id=eq.${clientId}&ghl_contact_id=eq.${enc}&status=in.(pending,approved)&select=id&limit=1`);
      if (Array.isArray(rr) && rr[0]) { agentBusy++; continue; }
      const reign = await sb(`agent_reignitions?client_id=eq.${clientId}&ghl_contact_id=eq.${enc}&status=eq.pending&select=id&limit=1`);
      if (Array.isArray(reign) && reign[0]) { agentBusy++; continue; }

      // 4) AUTHORITATIVE idle gate: newest GHL message (any direction), the same
      //    source the panel trusts. Fail-safe: if creds/inbox can't be read we skip
      //    (never re-arm a lead we couldn't verify). Also honor the updated_at floor
      //    so a lead just MOVED into Responded (no new message yet) isn't re-armed.
      const c = await creds(clientId);
      if (!c || !c.token || !c.locationId) { noCreds++; continue; }
      const msgMs = await lastGhlMessageMs(c.token, c.locationId, cid);
      if (msgMs === null) { noCreds++; continue; }
      const lastTouch = Math.max(new Date(o.updated_at).getTime(), msgMs);
      if (Date.now() - lastTouch < IDLE_MS) { recentTouch++; continue; }

      // 5) Cooldown + cap: don't loop on a lead that keeps re-ghosting. Count this
      //    lead's prior Ghosted enrollments (any status) — cap total, and honor a
      //    cooldown since the most recent one.
      if (!ghAutoCache.has(clientId)) {
        const ga = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.ghosted&select=id`);
        ghAutoCache.set(clientId, (Array.isArray(ga) ? ga : []).map(a => a.id));
      }
      const ghIds = ghAutoCache.get(clientId);
      if (ghIds.length) {
        const prior = await sb(`automation_enrollments?client_id=eq.${clientId}&contact_id=eq.${enc}&automation_id=in.(${ghIds.join(",")})&select=entered_at,exited_at&order=entered_at.desc`);
        const priorArr = Array.isArray(prior) ? prior : [];
        if (priorArr.length >= REARM_MAX_GHOSTED) { capped++; continue; }
        const last = priorArr[0];
        const ref = last && (last.exited_at || last.entered_at);
        if (ref && (Date.now() - new Date(ref).getTime()) < COOLDOWN_MS) { cooldown++; continue; }
      }

      // 6) ARM. Re-enroll into Ghosted and move the opp back to the Interested/ghosted
      //    stage — the SAME handoff the worker's form-intro roll-forward does, so the
      //    lead leaves Responded (where the agent + ghost detector scan) and the long
      //    game owns it. On the next inbound reply the bounce guard returns them to
      //    Responded and the agent re-engages.
      const enr = await enrollContact({ clientId, automationKey: "ghosted", contactId: cid });
      if (!enr || (!enr.ok && !enr.enrollment_id)) { errors++; continue; }
      try {
        const is = await interestedStage(c.token, c.locationId, { clientId, sb });
        const oppRef = await findOpenOppRef(clientId, c.token, c.locationId, cid);
        if (is && oppRef) await moveStage({ clientId, ghl, token: c.token, oppRef, stage: is, role: "interested", contactId: cid, reason: "re-arm: Responded lead went silent, rolled back into ghosted" });
      } catch (_) { /* enrollment stands even if the stage move blips */ }
      await logEvent({ clientId, contactId: cid, automationId: null, type: "rearm_ghosted", payload: { from: "responded", idle_days: REARM_IDLE_DAYS } });
      armed++;
    } catch (_) { errors++; }
  }
  return res.status(200).json({ ok: true, scanned: opps.length, armed, skipped: { no_live: noLive, has_active: hasActive, agent_busy: agentBusy, recent_touch: recentTouch, cooldown, capped, no_creds: noCreds }, errors });
}

// ── staff CRUD (backs the P4b step-builder) ──
async function handler(req, res) {
  if (req.method === "GET" && req.query.action === "work") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    return await runWork(res);
  }
  if (req.method === "GET" && req.query.action === "rearm") {
    const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.CRON_SECRET || got !== process.env.CRON_SECRET) return res.status(401).json({ error: "unauthorized" });
    return await runRearm(res);
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
      // Offer tie-in: scope the automation to an offer when the caller says so.
      // Only include the key when provided, so older callers never clobber an
      // existing offer_id back to null via the merge-duplicates upsert.
      if (b.offer_id !== undefined) row.offer_id = b.offer_id || null;
      const r = await sb(`automations?on_conflict=client_id,automation_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([row]) });
      return res.status(200).json({ ok: true, automation: Array.isArray(r) && r[0] });
    }

    // Seed a per-form INTRO automation (contact_form / trial_form) from the shipped
    // DEFAULTS the first time its Entry Point tab loads. Idempotent + edit-safe:
    //   - creates the automation only if it doesn't exist (never resets an academy's
    //     enabled/approved on an existing one),
    //   - adds the default step ONLY when the automation has zero steps (never clobbers
    //     an edited message).
    // Dormant: seeds enabled:true + approved:false, so nothing sends until approved
    // AND portal_entry_routing.enabled is on.
    if (b.action === "seed-form-intro") {
      const key = String(b.automation_key || "");
      const def = FORM_INTRO_DEFAULTS[key];
      if (!def) return res.status(400).json({ error: "unknown form-intro key" });
      let autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
      let auto = Array.isArray(autos) && autos[0];
      if (!auto) {
        const ins = await sb(`automations?on_conflict=client_id,automation_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, approved: !!def.approved, offer_id: b.offer_id || null, updated_at: new Date().toISOString() }]) });
        auto = Array.isArray(ins) && ins[0];
      }
      if (!auto) return res.status(500).json({ error: "seed failed" });
      const steps = await loadSteps(auto.id);
      if (!steps.length) {
        await sb(`automation_steps`, { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{ automation_id: auto.id, position: def.step.position || 0, wait_amount: def.step.wait_amount, wait_unit: def.step.wait_unit, channel: def.step.channel, subject: def.step.subject ?? null, body: def.step.body, enabled: true, updated_at: new Date().toISOString() }]) });
      }
      return res.status(200).json({ ok: true, automation: { ...auto, steps: await loadSteps(auto.id) } });
    }

    // Seed the preset's BASELINE automations in one call (Gap #2, phase 2C): the
    // three form-intro first-touches + the multi-step 👻 Ghosted drip. Same
    // idempotent + edit-safe rule as seed-form-intro (create only if missing; add
    // steps only when the automation has zero). All dormant (approved:false).
    if (b.action === "seed-preset-automations") {
      const DEFS = { ...FORM_INTRO_DEFAULTS, ghosted: GHOSTED_DEFAULT };
      const keys = (Array.isArray(b.keys) && b.keys.length) ? b.keys.filter(k => DEFS[k]) : Object.keys(DEFS);
      const results = [];
      for (const key of keys) {
        const def = DEFS[key];
        let autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
        let auto = Array.isArray(autos) && autos[0];
        let created = false;
        if (!auto) {
          const ins = await sb(`automations?on_conflict=client_id,automation_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, approved: !!def.approved, offer_id: b.offer_id || null, updated_at: new Date().toISOString() }]) });
          auto = Array.isArray(ins) && ins[0];
          created = true;
        }
        if (!auto) { results.push({ key, ok: false }); continue; }
        const existing = await loadSteps(auto.id);
        if (!existing.length) {
          const steps = def.steps || (def.step ? [def.step] : []);
          if (steps.length) {
            await sb(`automation_steps`, { method: "POST", headers: { Prefer: "return=minimal" },
              body: JSON.stringify(steps.map((s, i) => ({ automation_id: auto.id, position: s.position != null ? s.position : i, wait_amount: s.wait_amount, wait_unit: s.wait_unit, channel: s.channel, subject: s.subject ?? null, body: s.body, enabled: true, updated_at: new Date().toISOString() }))) });
          }
        }
        results.push({ key, name: def.name, created, steps: (await loadSteps(auto.id)).length });
      }
      return res.status(200).json({ ok: true, results });
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
          const contacts = (await sb(`${await contactsReadTable(clientId)}?client_id=eq.${clientId}&ghl_contact_id=in.(${inList})&select=ghl_contact_id,name,athlete_name`)) || [];
          for (const c of contacts) nameMap[c.ghl_contact_id] = c.name || c.athlete_name || null;
        } catch (_) { /* names are best-effort */ }
      }
      const people = rows.map(r => ({ contact_id: r.contact_id, contact_name: nameMap[r.contact_id] || null, current_position: r.current_position, entered_at: r.entered_at }));
      return res.status(200).json({ people });
    }

    // Active enrollments with step ordinal + entry time, for the simple-view
    // cascade ("enrolled · step 2 of 3", newest entries on top). Step positions
    // can have gaps, so each is mapped to its 1-based ordinal per automation.
    if (b.action === "active-enrollments") {
      const autos = await sb(`automations?client_id=eq.${clientId}&select=id,automation_key`) || [];
      const posMap = {};
      for (const a of (Array.isArray(autos) ? autos : [])) {
        const steps = await loadSteps(a.id);
        const m = {}; steps.forEach((s, i) => { m[s.position] = i + 1; });
        posMap[a.id] = { m, total: steps.length, key: a.automation_key };
      }
      const rows = await sb(`automation_enrollments?client_id=eq.${clientId}&status=eq.active&select=id,contact_id,automation_id,current_position,entered_at&order=entered_at.desc&limit=5000`) || [];
      // When the next step fires: earliest pending job per enrollment. The stage
      // list shows "next step in 2d" instead of step counters (Zoran 2026-07-10).
      const nextByEnrollment = {};
      try {
        const jobs = await sb(`automation_jobs?client_id=eq.${clientId}&status=eq.pending&select=enrollment_id,run_after&order=run_after.asc&limit=5000`) || [];
        for (const j of (Array.isArray(jobs) ? jobs : [])) {
          if (j.enrollment_id && !nextByEnrollment[j.enrollment_id]) nextByEnrollment[j.enrollment_id] = j.run_after;
        }
      } catch (_) { /* next-step time is a nicety - never block the list */ }
      const enrollments = (Array.isArray(rows) ? rows : []).map(r => {
        const p = posMap[r.automation_id] || {};
        return {
          contact_id: String(r.contact_id), automation_key: p.key || null,
          step: (p.m && p.m[r.current_position]) || null, steps_total: p.total || null,
          entered_at: r.entered_at, next_run_after: nextByEnrollment[r.id] || null,
        };
      });
      return res.status(200).json({ enrollments });
    }

    // Distinct contacts with an ACTIVE enrollment in ANY automation. Powers the
    // pipeline board's "!" alert (a lead nobody is messaging) - one cheap query.
    if (b.action === "active-contacts") {
      const rows = await sb(`automation_enrollments?client_id=eq.${clientId}&status=eq.active&select=contact_id&limit=5000`) || [];
      const ids = [...new Set((Array.isArray(rows) ? rows : []).map(r => String(r.contact_id)).filter(Boolean))];
      return res.status(200).json({ contact_ids: ids });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[automations]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
