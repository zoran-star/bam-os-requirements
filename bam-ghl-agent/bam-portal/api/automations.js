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
import { renderEmail, clientVars, renderStepMessage } from "./email-shells.js";
import { academyFacts } from "./_academy-facts.js";
import { SALES_AUTOMATION_KEYS, salesApprovalState, armingRefusal } from "./_sales-approval.js";
import { withinQuietHours, nextSendableTime, quietTz } from "./agent/_quiet.js";
import { isMuted } from "./agent/_mutes.js";
import { markUnqualified } from "./agent/_tags.js";
import { resolveAgentActor } from "./agent/_auth.js";
import { FORM_INTRO_DEFAULTS } from "./form-intro-automations.js";
import { presetAutomationKeys } from "./agent/presets.js";
import { seedAutomations } from "./agent/seed-automations.js";
import { buildStepRow } from "./_automation-step.js";

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

// ── the client row every automation renders from ─────────────────────────────
// public_name / community_group_* / google_review_url / phone are the parent-facing
// facts clientVars() renders from - without them every message silently falls
// back to the internal name and drops its group, review and phone lines.
//
// online_programs_url and referral_offer joined the list on 28 Jul 2026, when
// migration 20260727150000 was applied. Before that, naming a column that does not
// exist yet makes PostgREST 400 the whole select and every automation stops - SMS
// included, because this ONE read feeds every channel, not just email. A column goes
// in this list AFTER its migration is live, never in the same commit.
//
// business_email, tagline and instagram_url joined on 30 Jul 2026, when their
// migrations (20260729T210000 and 20260729T230000) were confirmed applied to
// production. They were READ by clientVars() from the day they were written and
// SELECTED by nobody, so all three arrived undefined and rendered as nothing: BAM GTA
// sent live automation emails with no tagline sentence under the wordmark and no
// footer Instagram link. Three columns went missing the same way in one day, which is
// why the gap is now a CHECK and not a habit - api/_email-select-coverage.test.mjs
// derives the required set from clientVars()'s own source and fails when this list
// does not cover it.
const CLIENT_COLS = ["id", "business_name", "public_name", "owner_name", "email", "phone",
  "business_email", "tagline", "instagram_url",
  "address", "time_zone", "website_setup", "community_group_url", "community_group_platform",
  "google_review_url", "online_programs_url", "referral_offer", "stripe_portal_url", "ghl_location_id",
  "ghl_access_token", "ghl_refresh_token", "ghl_token_expires_at", "ghl_kpi_config"];

// ⚠️ THE ONE EXCEPTION TO THE RULE ABOVE, and the only thing that makes it safe:
// columns listed HERE are asked for optimistically and DROPPED on the single error
// that means "its migration is not applied yet" (see loadClient below). Nothing else
// changes - the row comes back without the key, which is byte-identical to the state
// every consumer already handles: an absent business_email HOLDS the email and texts
// the owner (api/_send.js), and the SMS path never learns anything happened.
//
// Same per-column-fallback shape the Business Basics card already uses for exactly
// this problem (_bbHydrateClientCols in public/client-portal.html): ask, and on the
// column error ask again without the column that does not exist.
//
// ⚠️ INTENTIONALLY EMPTY, AND DELIBERATELY NOT DELETED.
//
// Empty because nothing is pending: business_email (20260729T210000), tagline /
// instagram_url (20260729T230000) and stripe_portal_url (20260731T090000) are all
// applied to production and have moved up into CLIENT_COLS. A column belongs here ONLY
// while its migration is pending - this is a safety net, not a parking spot, and
// anything left here costs one wasted 400 per uncached read for as long as it is wrong.
//
// ⚠️ AND THAT COST IS NOT A ROUNDING ERROR, which is the lesson stripe_portal_url paid
// for. It shipped here first, correctly and with the retry working exactly as designed,
// and the orchestrator's ruling on 31 Jul 2026 was still that the shape was wrong: the
// retry logs a warning on EVERY send while it holds, and a warning that fires correctly
// and forever is one people learn to scroll past. So this list is for the window
// between writing a read and applying its migration, measured in hours, not for the
// window between shipping a feature and someone getting round to the SQL. If the
// migration cannot be applied first, that is the thing to fix.
//
// Not deleted because this list plus the retry below it IS how the next column ships
// before its migration lands, and that is a recurring need, not a one-off. Deleting
// it means rebuilding it under time pressure next time, and the version that gets
// rebuilt in a hurry is the one that peels off only the column PostgREST NAMED -
// which is lethal at two pending columns (see the retry's comment). The retry is
// safe at any number of pending columns as written. Add a column name here, note its
// migration file on a comment line, and move it into CLIENT_COLS the day it lands.
// api/_pending-client-column.test.mjs proves the machinery still works by injecting a
// synthetic pending column, so it stays provable with this list empty.
const CLIENT_COLS_PENDING = [];

// Does THIS error blame a pending column? Returns the blamed one(s) for the log,
// but the RETRY DROPS THE WHOLE PENDING LIST - see why below.
//
// Deliberately NOT "retry on any failure": a transient 5xx must never quietly
// downgrade the read to a row missing business_email, because that would hold an
// academy's email for a reason that has nothing to do with its data. Only an
// undefined-column error (PostgREST 42703) that NAMES a pending column earns a
// retry; everything else stays a throw, exactly as before.
//
// ⚠️ WHY THE RETRY DROPS ALL OF THEM, NOT JUST THE NAMED ONE. Postgres reports only
// the FIRST unknown column in a select - verified against prod: `select tagline,
// instagram_url from clients` blames `tagline` and never mentions `instagram_url`.
// So peeling off just the blamed column meant a SECOND pending column 400'd the
// retry, and the retry's read is the last statement in the catch, so that throw
// escapes loadClient. Its worker callers have no catch: every automation would stop,
// SMS included - the exact incident this mechanism was written to prevent, through
// the mechanism itself. It was safe for exactly one pending column and silently
// lethal at two, which is the worst possible number to be safe up to.
//
// Dropping the whole list is safe for ANY number of pending columns and needs no
// loop: by definition a pending column is one the code already degrades without.
function pendingColsBlamedBy(err) {
  const msg = String((err && err.message) || err || "");
  if (!/42703|does not exist/i.test(msg)) return [];
  return CLIENT_COLS_PENDING.filter((c) => msg.includes(c));
}

async function loadClient(clientId) {
  const cols = CLIENT_COLS.concat(CLIENT_COLS_PENDING);
  const read = (list) => sb(`clients?id=eq.${clientId}&select=${list.join(",")}&limit=1`);
  let rows;
  try {
    rows = await read(cols);
  } catch (e) {
    const blamed = pendingColsBlamedBy(e);
    if (!blamed.length) throw e;
    console.warn(`[automations] loadClient: ${blamed.join(", ")} not in the schema yet (migration pending) - re-reading without ${blamed.length > 1 ? "them" : "it"}`);
    rows = await read(cols.filter((c) => !CLIENT_COLS_PENDING.includes(c)));   // ALL of them, not just `blamed` - Postgres names only the first
  }
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

// The sample family every OWNER-FACING render uses (the Sales step preview and the
// onboarding approval surface), so the same message cannot read differently on the
// two screens an owner is sent between. Contact tokens only - the academy's own
// facts come from its row and its other tables, spread over the top at each site.
//
// {{next_session}} is the one token a preview cannot know: the worker resolves the
// academy's next OPEN slot at send time. Empty here renders exactly as a real send
// with no slot known - the sentence carrying it drops out.
const PREVIEW_FAMILY = { first_name: "Alex", full_name: "Alex Rivera", athlete: "Jordan Rivera", athlete_first: "Jordan", next_session: "" };

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
/**
 * The lead's name / email / phone for merge tokens at send time.
 *
 * READS THE PORTAL STORE FIRST (Zoran 2026-08-05). This used to ask GHL and only
 * GHL, which is wrong for every off-GHL academy: BAM GTA mints its own contact
 * ids for website leads, so `GET /contacts/:id` answers "Contact with id ... not
 * found", the catch below swallowed the 400, and `firstName` came back null.
 * `{{contact.first_name}}` then resolved to its "there" fallback, so the very
 * first message an academy ever sends a new parent opened "Hi there" while their
 * name sat in our own contacts table. Measured on GTA the day this was found: 27
 * of 174 greeting texts in 30 days.
 *
 * `clientId` is optional only so existing callers keep working; without it the
 * portal read is skipped and behaviour is exactly as before. Pass it.
 */
export async function resolveContactInfo(token, contactId, cache = new Map(), clientId = null) {
  const key = String(contactId);
  if (cache.has(key)) return cache.get(key);
  let info = { email: null, phone: null, firstName: null, fullName: null };
  // 1) The portal's own contacts row - authoritative for portal-native leads,
  //    and correct for GHL-era ones too (the sync mirrors them here).
  if (clientId) {
    try {
      const tbl = await contactsReadTable(clientId);
      const rows = await sb(`${tbl}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(key)}&select=name,first_name,last_name,email,phone&limit=1`);
      const c = (Array.isArray(rows) && rows[0]) || null;
      if (c) {
        // Names arrive with stray whitespace from form fills ("Ramon  Dioquino",
        // last_name " Dioquino"), so collapse it - an un-trimmed value renders as
        // "Hi Ramon  Dioquino" in a text message.
        const tidy = (v) => String(v || "").replace(/\s+/g, " ").trim() || null;
        const first = tidy(c.first_name) || (tidy(c.name) ? tidy(c.name).split(" ")[0] : null);
        const full = tidy(c.name) || tidy([tidy(c.first_name), tidy(c.last_name)].filter(Boolean).join(" ")) || first;
        info = { email: c.email || null, phone: c.phone || null, firstName: first, fullName: full };
      }
    } catch (_) { /* fall through to GHL */ }
  }
  // 2) GHL, for academies whose contacts genuinely live there - and as a backfill
  //    for any single field the portal row was missing.
  if (!info.firstName || !info.email || !info.phone) {
    try {
      const d = await ghl("GET", `/contacts/${encodeURIComponent(key)}`, { token });
      const c = (d && (d.contact || d)) || {};
      const first = c.firstName || c.first_name || (c.name ? String(c.name).trim().split(/\s+/)[0] : null) || null;
      const full = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || first || null;
      info = {
        email: info.email || c.email || null,
        phone: info.phone || c.phone || null,
        firstName: info.firstName || first,
        fullName: info.fullName || full,
      };
    } catch (_) {}
  }
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
  let sent = 0, deferred = 0, advanced = 0, completed = 0, failed = 0, canceled = 0, lost = 0, nurtureLost = 0, ghostedLost = 0, formToGhosted = 0, held = 0;

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
              if (is && oppRef) await moveStage({ clientId: job.client_id, ghl, token: creds.token, oppRef, stage: is, role: "ghosted", contactId: job.contact_id, reason: "intro form sent, no reply - rolled into ghosted" });
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
                const routed = await routeTransition({ clientId: job.client_id, sb, ghl, token: creds.token, locationId: creds.locationId, fromRole: "ghosted", trigger: "ghosted_ran_out", contactId: job.contact_id, oppRef, reason: `${a.automation_key} ran out - rolled into nurture` });
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
        // no reply -> they exit the pipeline as UNQUALIFIED (Zoran, 2026-07-21). Route
        // per the academy's authored flow (the ghosted_ran_out edge; seed = nurture ->
        // @unqualified): the router's terminal close stamps status=abandoned +
        // role=unqualified, and we mirror confirm-abandoned's side effects (the
        // unqualified tag + a pipeline_outcomes 'abandoned' row). A paused or
        // re-authored edge is respected as-is; on NO edge (unseeded academy / lookup
        // blip) fall back to the original terminal LOST so the lead still leaves the
        // open board. Do NOT re-enroll anywhere (that would loop). Best-effort +
        // idempotent: a nurture enrollment completes exactly once (status flips to
        // 'completed' so this branch can't re-fire for the same enrollment).
        try {
          const a = autoCache.get(job.automation_id);
          if (a && a.automation_key === "nurture") {
            const creds = await ensureCreds();
            if (creds && creds.token) {
              const oppRef = await findOpenOppRef(job.client_id, creds.token, creds.locationId, job.contact_id);
              const oppId = oppRef && (oppRef.ghlOpportunityId || oppRef.id) || null;
              if (oppRef) {
                let routed = { matched: false };
                try { routed = await routeTransition({ clientId: job.client_id, sb, ghl, token: creds.token, locationId: creds.locationId, fromRole: "nurture", trigger: "ghosted_ran_out", contactId: job.contact_id, oppRef, allowTerminal: true, reason: "nurture sequence exhausted" }); } catch (_) { /* fall back below */ }
                if (routed.matched && routed.terminal === "unqualified") {
                  try { await markUnqualified(creds.token, job.contact_id, job.client_id); } catch (_) { /* best-effort tag */ }
                  try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: job.client_id, opportunity_id: oppId, status: "abandoned", reason: "nurture sequence exhausted" }]) }); } catch (_) {}
                  await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "nurture_exhausted_unqualified", payload: { opportunity_id: oppId } });
                  nurtureLost++;
                } else if (!routed.matched) {
                  try { await setStatus({ clientId: job.client_id, ghl, token: creds.token, oppRef, status: "lost", contactId: job.contact_id, reason: "nurture sequence exhausted" }); } catch (_) { /* best-effort */ }
                  try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: job.client_id, opportunity_id: oppId, status: "lost", reason: "nurture sequence exhausted" }]) }); } catch (_) {}
                  await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "nurture_exhausted_lost", payload: { opportunity_id: oppId } });
                  nurtureLost++;
                } else {
                  // Edge matched but paused / re-pointed by the academy: the
                  // authored flow already handled the lead - just log the outcome.
                  await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "nurture_exhausted_routed", payload: { opportunity_id: oppId, terminal: routed.terminal || null, role: routed.role || null, paused: !!routed.paused } });
                  nurtureLost++;
                }
              }
            }
          }
        } catch (_) { /* best-effort terminal disposition */ }
      }
    };

    // DECLARED OUT HERE ON PURPOSE - DO NOT MOVE IT BACK INSIDE THE `try`.
    // The catch at the bottom of this loop computes the retry time in the
    // academy's OWN timezone: nextSendableTime(..., quietTz(client)). `const`/`let`
    // inside the `try` is block-scoped to the try, so the catch cannot see it and
    // reading `client` there throws ReferenceError - INSIDE the error handler,
    // where nothing catches it. That escapes runWork() and kills the entire cron
    // run (see the catch for the full blast radius). The retryable branch is the
    // only one that touched `client`, which is why the exhausted-retries branch
    // looked fine and this went unnoticed.
    // Degradation is deliberate: it starts as null, so a job that fails BEFORE the
    // client row loads hits quietTz(null) -> the QUIET_TZ default (America/Toronto),
    // exactly what every other quiet-hours caller does with a missing client. It
    // never silently becomes UTC, which would move sends outside the parent-facing
    // window.
    let client = null;

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
      client = clientCache.get(job.client_id) || null;

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
      // clientId is what lets this read the portal's own contacts row - without it
      // an off-GHL academy's every merge token falls back to "there".
      const info = await resolveContactInfo(token, job.contact_id, contactCache, job.client_id);

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

      // The member-facing facts that are not on the client row: the training venue,
      // the weekly schedule generated from real sessions, and the coaches to follow.
      // Resolved here for the same reason next_session is, because they need database
      // reads that clientVars deliberately does not do. Only fetched when the message
      // actually references one, so the ordinary sales SMS pays nothing for it.
      let facts = {};
      if (/location\.(?:venue|schedule|testimonials)|template:(?:onboarding-welcome|nurture-3|onboarding-testimonials)/.test(`${step.body || ""}${step.subject || ""}`)) {
        try { facts = await academyFacts(sb, client); } catch (_) { /* shorter message, never a failed send */ }
      }

      // {{location.*}} / {{location_owner.first_name}} resolve from the REAL
      // client row (clientVars), never the hardcoded LOCATIONS map - a new
      // academy must never send another academy's name, site, or owner. Unknown
      // values render EMPTY (the resolver drops the affected line).
      const result = await sendOn({
        channel: step.channel, clientId: job.client_id, contactId: job.contact_id,
        toEmail: info.email, toPhone: info.phone, subject: step.subject, body: step.body, ghlToken: token,
        vars: { first_name: info.firstName, full_name: info.fullName, athlete, next_session, ...clientVars(client), ...facts },
      });

      // HELD (email only): the academy has no verified sending domain, so nothing
      // went out and nothing generic went out in its place. Re-queue the job as-is -
      // still pending, NO attempts increment (a hold is not a failure), and do NOT
      // advance, so the step keeps its place in the sequence. The moment
      // clients.email_domain is set, the next hourly pass sends it for real. Without
      // this branch a hold would fall into the skipped bucket below and be silently
      // lost, which is exactly what the guardrail exists to prevent.
      if (result && result.held) {
        await finish({ status: "pending", run_after: new Date(Date.now() + 3600000).toISOString(), last_error: `held: ${result.held}`.slice(0, 300) });
        held++; continue;
      }

      if (result && result.sent) { await finish({ status: "sent", sent_at: new Date().toISOString() }); sent++; await logEvent({ clientId: job.client_id, contactId: job.contact_id, automationId: job.automation_id, type: "step_sent", payload: { step_id: job.step_id, channel: step.channel } }); }
      else { await finish({ status: "skipped", last_error: (result && result.skipped) || "skipped" }); }

      // ADVANCE past this step (a suppressed/no-contact skip still moves the sequence on).
      await advance(steps, step.position);
    } catch (e) {
      // Send/processing failed - retry up to MAX_ATTEMPTS, else mark failed.
      // NOTHING in this block may throw. There is no try/catch around the job
      // loop, so a throw here escapes runWork() and the handler: the remaining
      // jobs in this run are never processed, the cron gets a 500, and this job
      // stays parked in 'sending' with its attempts NEVER incremented - so it can
      // never reach MAX_ATTEMPTS and can never fail out. The stale-claim reaper at
      // the top of runWork frees it after 15 min, which turns a retryable blip
      // into an unbounded re-send loop rather than a stuck row. `client` is
      // hoisted above the try for exactly this reason.
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) { await finish({ status: "failed", attempts, last_error: String(e.message || e).slice(0, 300) }); failed++; }
      else { await finish({ status: "pending", attempts, last_error: String(e.message || e).slice(0, 300), run_after: nextSendableTime(new Date(Date.now() + RETRY_BACKOFF_MS), quietTz(client)).toISOString() }); }
    }
  }
  return res.status(200).json({ ok: true, picked: jobs.length, sent, deferred, held, advanced, completed, failed, canceled, nurture_lost: nurtureLost, ghosted_lost: ghostedLost, form_to_ghosted: formToGhosted, lost_race: lost });
}

// Newest message timestamp (ms) + its DIRECTION for a contact — the SAME idle signal
// the client-portal panel/inbox trusts. Two sources, take the newest across both:
//   1. Portal STORE threads (Twilio SMS / Resend email / Meta DM) — the PRIMARY
//      messaging source for portal-native academies (GTA). Keyed by ghl_contact_id
//      even for portal-native (UUID) contacts that never existed in GHL, so this
//      also covers leads the GHL lookup below can't resolve. Each thread carries
//      last_message_at + last_direction.
//   2. GHL conversations — for academies still messaging through GHL directly
//      (lastMessageDate + lastMessageDirection).
// Any-direction is deliberate for the idle CLOCK: our own outbound sends land here
// too, so we never re-arm right after messaging a lead. `direction` is the direction
// of that newest message so the re-arm sweep can tell "lead replied last (waiting on
// US)" from "our message got no response" — only the latter is a real ghost.
// Returns { ms:null } ONLY when NEITHER source could be read (fail SAFE — never
// re-arm a lead we couldn't verify).
async function lastContactMessage(clientId, token, locationId, contactId) {
  const enc = encodeURIComponent(String(contactId));
  let ms = 0, direction = null, known = false;
  const consider = (t, dir) => { if (t > ms) { ms = t; direction = dir ? String(dir).toLowerCase() : null; } };
  for (const tbl of ["sms_threads", "email_threads", "dm_threads"]) {
    try {
      const rows = await sb(`${tbl}?client_id=eq.${clientId}&ghl_contact_id=eq.${enc}&select=last_message_at,last_direction&order=last_message_at.desc.nullslast&limit=1`);
      if (Array.isArray(rows) && rows[0]) {
        known = true;
        consider(rows[0].last_message_at ? new Date(rows[0].last_message_at).getTime() : 0, rows[0].last_direction);
      }
    } catch (_) { /* one store table down must not blind the others */ }
  }
  if (token && locationId) {
    try {
      const search = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, contactId: String(contactId) })}`, { token });
      known = true; // a successful GHL response is a valid (possibly empty) signal
      const convos = (search && (search.conversations || search.data)) || [];
      for (const c of convos) consider(c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0, c.lastMessageDirection);
    } catch (_) { /* GHL blip — rely on the store signal if we got one */ }
  }
  return known ? { ms, direction } : { ms: null, direction: null };
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
  let armed = 0, noLive = 0, hasActive = 0, agentBusy = 0, recentTouch = 0, repliedLast = 0, cooldown = 0, capped = 0, noCreds = 0, errors = 0;

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

      // 4) AUTHORITATIVE idle gate: newest message across the portal store threads
      //    (primary for GTA) + GHL conversations, the same source the panel trusts.
      //    Fail-safe: if NEITHER source can be read we skip (never re-arm a lead we
      //    couldn't verify). Also honor the updated_at floor so a lead just MOVED
      //    into Responded (no new message yet) isn't re-armed. Creds are best-effort
      //    here (the store signal works without GHL) but required to move the stage.
      const c = await creds(clientId);
      const { ms: msgMs, direction: lastDir } = await lastContactMessage(clientId, c && c.token, c && c.locationId, cid);
      if (msgMs === null) { noCreds++; continue; }
      const lastTouch = Math.max(new Date(o.updated_at).getTime(), msgMs);
      if (Date.now() - lastTouch < IDLE_MS) { recentTouch++; continue; }

      // 4b) REPLIED-LAST GUARD: the re-arm only chases leads whose OUR-message got no
      //     response. A lead whose most recent message is INBOUND replied to us and is
      //     waiting on a real answer — re-enrolling them into Ghosted restarts it at
      //     step 0 and re-fires the identical opener at someone we OWE a reply. That is
      //     exactly the "you keep sending the same message" complaint. Leave them for
      //     the reply agent (Hawkeye / self-drive), never re-arm. Only skip on a DEFINITE
      //     inbound; unknown direction falls through to the prior behavior.
      if (lastDir === "inbound") { repliedLast++; continue; }

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
        if (c && c.token && c.locationId) {
          const is = await interestedStage(c.token, c.locationId, { clientId, sb });
          const oppRef = await findOpenOppRef(clientId, c.token, c.locationId, cid);
          if (is && oppRef) await moveStage({ clientId, ghl, token: c.token, oppRef, stage: is, role: "ghosted", contactId: cid, reason: "re-arm: Responded lead went silent, rolled back into ghosted" });
        }
      } catch (_) { /* enrollment stands even if the stage move blips */ }
      await logEvent({ clientId, contactId: cid, automationId: null, type: "rearm_ghosted", payload: { from: "responded", idle_days: REARM_IDLE_DAYS } });
      armed++;
    } catch (_) { errors++; }
  }
  return res.status(200).json({ ok: true, scanned: opps.length, armed, skipped: { no_live: noLive, has_active: hasActive, agent_busy: agentBusy, recent_touch: recentTouch, replied_last: repliedLast, cooldown, capped, no_creds: noCreds }, errors });
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

    // Render an email step to full HTML for the in-portal preview modal (the Sales
    // step editor's "Preview" button). Goes through renderStepMessage, the SAME
    // call api/_send.js makes at send time and the approval surface below makes -
    // one render path for all three.
    //
    // It used to call renderEmail directly with its own sample family and an
    // UNRESOLVED subject, so a subject carrying {{contact.first_name}} previewed as
    // the literal token. That mattered more once the approval step started telling
    // owners to "edit any message in Sales": the two owner-facing surfaces would
    // have disagreed about the same message.
    if (b.action === "preview-email") {
      // Load the client so the preview renders with the academy's OWN identity
      // (name / site / owner), exactly like the real send path.
      const client = await loadClient(clientId).catch(() => null);
      // The member-facing facts too, or this stops being a preview of the real send.
      // Without them the welcome email an owner approves from is missing its entire
      // weekly schedule table, its location block, and its coaches - the parts an
      // owner is most likely to be checking. That is worse than no preview, because
      // it is a preview that quietly disagrees with what will be sent.
      const facts = await academyFacts(sb, client).catch(() => ({}));
      const m = renderStepMessage({
        channel: "email", clientId, subject: b.subject, body: b.body,
        vars: { ...PREVIEW_FAMILY, ...clientVars(client), ...facts },
      });
      return res.status(200).json({ html: m.html, subject: m.subject, empty: m.empty });
    }

    // ── The owner's sales-message approval (onboarding wizard, Offer section) ──
    //
    // `approval-queue` returns every message in the five SALES automations
    // (SALES_AUTOMATION_KEYS), RENDERED, so the owner reads exactly what a parent
    // will receive before those sequences are allowed to send.
    // `approve-sales-messages` is the yes.
    //
    // SCOPE: these five and nothing else. The confirm agent's scripted booking
    // confirmation and same-day check-in are not automations rows and are gated by
    // confirm_agent_mode, not `approved` - see the header of api/_sales-approval.js.
    //
    // ONE RENDER PATH. Both the vars and the renderer here are the send path's:
    // clientVars(client) + academyFacts(sb, client) spread into vars, then
    // renderStepMessage - the same call sendOn() makes at send time and the same one
    // `preview-email` above makes. See the header of api/email-shells.js for the
    // full list of callers and for which lock covers what.
    if (b.action === "approval-queue") {
      const client = await loadClient(clientId).catch(() => null);
      const facts = await academyFacts(sb, client).catch(() => ({}));
      const vars = { ...PREVIEW_FAMILY, ...clientVars(client), ...facts };
      const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=in.(${SALES_AUTOMATION_KEYS.join(",")})&select=*`) || [];
      // Preset order, not alphabetical: the owner reads the sequences in the order a
      // lead meets them.
      const list = SALES_AUTOMATION_KEYS.map((k) => (Array.isArray(autos) ? autos : []).find((a) => a.automation_key === k)).filter(Boolean);
      const messages = [];
      for (const a of list) {
        const steps = await loadSteps(a.id);
        messages.push({
          id: a.id, automation_key: a.automation_key, approved: !!a.approved, enabled: !!a.enabled,
          steps: steps.map((s) => {
            const base = {
              id: s.id, position: s.position, channel: s.channel,
              wait_amount: s.wait_amount, wait_unit: s.wait_unit,
              // A step the seeder left OFF (its copy is another academy's literals
              // until this one writes its own - see api/_sync-class.js) will not
              // send, and the surface says so rather than showing it as approved.
              enabled: !!s.enabled,
            };
            // FAIL SOFT, PER STEP. renderStepMessage throws on a channel it does
            // not know, and `channel` is not validated on every write path into
            // automation_steps - so one malformed row would 500 this handler and
            // blank the ENTIRE approval surface, where the send path would only
            // lose that one step. The owner reads and approves the rest, and the
            // bad step is shown as unrenderable. It cannot send either: sendOn
            // throws on the same channel, so the step fails rather than going out.
            try {
              const m = renderStepMessage({ channel: s.channel, clientId, subject: s.subject, body: s.body, vars });
              return { ...base, subject: m.subject || "", html: m.html || "", text: m.text || "", empty: !!m.empty };
            } catch (e) {
              console.error("[automations] approval-queue could not render step", s.id, e && e.message);
              return { ...base, subject: "", html: "", text: "", empty: false, unrenderable: String((e && e.message) || e).slice(0, 200) };
            }
          }),
        });
      }
      return res.status(200).json({ ok: true, messages, ...salesApprovalState(list) });
    }

    // The approval itself: sets approved:true on this academy's five sales
    // automations, which is what lets anything send at all.
    //
    // FAILS CLOSED, four ways: the rows are re-read scoped to this academy (never
    // trusted from the request), only the five shared sales keys are ever touched
    // (the `onboarding` welcome sequence is NOT part of this yes), an academy
    // with no sales automations is refused rather than reported approved - nothing
    // to approve is not approval - and a row with ZERO STEPS is skipped, because
    // consent to an empty sequence is consent to whatever lands in it later.
    //
    // WHY THE STEP-LESS SKIP EXISTS, because it is not obvious and it was created by
    // a fix to the other half of this path (2026-07-29). The seeder learned to repair
    // a row born dormant: a step-less automation at enabled:false gets enabled:true
    // and the canonical steps written into it. Good on its own. But this action used
    // to approve every sales row it found without looking at whether it CONTAINED
    // anything, and `approval-queue` happily renders a sequence with no messages in
    // it. Composed, on BAM NY's real shape:
    //
    //   owner presses Approve over a screen with no messages on it -> approved:true
    //   a routine re-seed runs (applyPreset calls seedAutomations, and
    //     seed-preset-automations is a portal action) -> enabled:true + steps
    //   isAutomationLive -> true. Four live outbound steps, no second consent.
    //
    // Before the seeder repair the row stayed enabled:false and stayed silent, so
    // that fix turned a dormant, VISIBLE failure into an armed, INVISIBLE one. The
    // owner's yes has to be about messages they read, so an empty sequence does not
    // collect one and the fill has to come back and ask.
    //
    // The boundary is ZERO STEPS on purpose - the same boundary the seeder's repair
    // uses. A row with steps is one an academy has configured; whether those steps
    // are switched on is a separate decision the owner can see on the surface. A row
    // with no steps is one the seeder will still write into.
    //
    // It writes `approved` ONLY. It must never touch `enabled` on an automation or
    // on a step: the seeder turns individual steps off on purpose, and flipping them
    // on here would live-send one academy's words from another academy's number.
    if (b.action === "approve-sales-messages") {
      // OWNER ONLY (plus BAM staff - see resolveAgentActor). The operate scope
      // `canActOn` admits any teammate with can_train_agent, and this action arms
      // live outbound to leads under a step the product calls the owner's approval.
      // An operational flag is not that person's consent. The decision itself lives
      // in armingRefusal (api/_sales-approval.js) so it can be tested by invoking it
      // rather than by grepping for it - see api/_arming-gate.test.mjs.
      const refuseApprove = armingRefusal("approve-sales-messages", actor, clientId);
      if (refuseApprove) return res.status(refuseApprove.status).json({ error: refuseApprove.error });
      // `enabled` is selected because salesApprovalState needs it: a row that is
      // approved but disabled cannot send, so it must not be reported as done.
      const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=in.(${SALES_AUTOMATION_KEYS.join(",")})&select=id,automation_key,approved,enabled`) || [];
      const list = Array.isArray(autos) ? autos : [];
      if (!list.length) return res.status(400).json({ error: "no sales messages to approve yet - apply your sales preset first" });
      // Which of them actually contain something to consent to. One query for all
      // five rather than one per row.
      const stepRows = await sb(`automation_steps?automation_id=in.(${list.map((a) => a.id).join(",")})&select=automation_id`) || [];
      const filled = new Set((Array.isArray(stepRows) ? stepRows : []).map((s) => s.automation_id));
      const armable = list.filter((a) => filled.has(a.id));
      // Named, and returned, so the surface can say "these are not ready yet"
      // instead of reading green off an approval that covered nothing.
      const skipped = list.filter((a) => !filled.has(a.id)).map((a) => a.automation_key);
      if (!armable.length) {
        return res.status(400).json({ error: "these sequences have no messages in them yet - nothing to approve", skipped });
      }
      for (const a of armable) {
        if (a.approved) continue;
        await sb(`automations?id=eq.${a.id}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ approved: true, updated_at: new Date().toISOString() }) });
      }
      // The response reports what is TRUE after the write, not what was asked for:
      // a skipped row stays at its stored `approved`, so salesApprovalState cannot
      // report done over a sequence nobody has read.
      const after = list.map((a) => (filled.has(a.id) ? { ...a, approved: true } : a));
      return res.status(200).json({ ok: true, skipped, ...salesApprovalState(after) });
    }

    // Home-screen X (Zoran 2026-07-21): pull one lead out of every active
    // automation (except onboarding). Deliberately stamps NO unqualified tag -
    // this is cleanup ("get them out of here"), not a qualification verdict.
    // The client pairs this with a PATCH status=abandoned on the opportunity.
    if (b.action === "exit-enrollment") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      const n = await exitEnrollment({ clientId, contactId: String(b.contact_id), reason: b.reason || "removed from home screen" });
      return res.status(200).json({ ok: true, exited: (n && n.exited) || 0 });
    }

    // NOTE: this action does NOT carry `enabled` / `approved`. See below.
    if (b.action === "upsert-automation") {
      if (!b.automation_key) return res.status(400).json({ error: "automation_key required" });
      // THE THIRD DOOR, closed by construction rather than by a guard.
      //
      // This wrote `approved: !!b.approved` and `enabled: !!b.enabled` straight from
      // the request body, and because it upserts (on_conflict + merge-duplicates) it
      // UPDATES an existing row. So a POST of
      //   {action:'upsert-automation', automation_key:'trial_form', approved:true, enabled:true}
      // armed a live sales sequence under the plain `canActOn` scope - the same hole
      // set-approved had, one action over, and reachable by anyone who could open the
      // automations panel.
      //
      // It was not only theoretical: the panel's own seed list (_AUTO_SEED in
      // client-portal.html) called it with approved:true, enabled:true for
      // `onboarding` and `nurture`. Merely OPENING that panel for an academy with no
      // nurture row created one already armed, with nobody having approved anything -
      // and seed-preset-automations, being edit-safe, would later fill it with steps.
      //
      // The fields are DROPPED rather than guarded. On INSERT the columns take their
      // database defaults (both false - migration 20260625204628), which is exactly
      // the dormant seed the whole model depends on. On UPDATE, PostgREST only writes
      // the columns present in the payload, so an academy's live state is untouched
      // by a rename. Arming now has exactly two doors, both owner-scoped:
      // `approve-sales-messages` and `set-approved`.
      const row = {
        client_id: clientId, automation_key: String(b.automation_key),
        name: b.name ?? null,
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
    // Dormant: seeds enabled:true, so nothing sends until approved AND
    // portal_entry_routing.enabled is on.
    //
    // `approved` IS NOT IN THE INSERT, for the reason upsert-automation does not
    // carry it either. It only ever wrote `!!def.approved`, which is false for every
    // key in FORM_INTRO_DEFAULTS, so the row was born dormant - but this action runs
    // under the plain canActOn scope, which admits any teammate with can_train_agent,
    // and a fifth write site that PASSES an arming field is one edit away from
    // birthing an armed row. Leaving the column off the payload means the database
    // default (false, migration 20260625204628) decides, and there is nothing here to
    // flip. Arming still has exactly two doors, both owner-scoped.
    if (b.action === "seed-form-intro") {
      const key = String(b.automation_key || "");
      const def = FORM_INTRO_DEFAULTS[key];
      if (!def) return res.status(400).json({ error: "unknown form-intro key" });
      let autos = await sb(`automations?client_id=eq.${clientId}&automation_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
      let auto = Array.isArray(autos) && autos[0];
      if (!auto) {
        const ins = await sb(`automations?on_conflict=client_id,automation_key`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, offer_id: b.offer_id || null, updated_at: new Date().toISOString() }]) });
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

    // Seed the preset's BASELINE automations in one call (Gap #2, phase 2C).
    // The actual seeding is the SHARED seeder (api/agent/seed-automations.js) -
    // the same one applyPreset now fires automatically on preset apply - so
    // "canonical" can never mean two different things. Idempotent + edit-safe
    // (create only if missing; add steps only when zero). Dormant seeds.
    // Preset-driven (station model): pass b.preset (e.g. 'free_trial') and the
    // seed list comes from the preset manifest itself - stage engines + form
    // intros + exit actions. Explicit b.keys still wins; no preset = all defaults.
    if (b.action === "seed-preset-automations") {
      const manifestKeys = b.preset ? presetAutomationKeys(String(b.preset)) : null;
      const keys = (Array.isArray(b.keys) && b.keys.length) ? b.keys
        : (Array.isArray(manifestKeys) && manifestKeys.length) ? manifestKeys
        : null;
      const results = await seedAutomations({ clientId, offerId: b.offer_id || null, keys, sb });
      return res.status(200).json({ ok: true, results });
    }

    // Verify an automation_id belongs to this academy before mutating its steps.
    //
    // `&client_id=eq.${clientId}` is the ENTIRE tenant boundary for set-approved -
    // the arming write. Every other action here is reached through the handler's
    // canActOn gate on the client_id in the BODY, which stops academy A asking about
    // academy B; this one takes an automation_id instead, so without the scope on
    // this select an owner of A could arm an automation belonging to B by id. The
    // write itself carries the same filter (defence in depth, not a substitute).
    async function ownsAutomation(automationId) {
      const a = await sb(`automations?id=eq.${automationId}&client_id=eq.${clientId}&select=id&limit=1`);
      return Array.isArray(a) && !!a[0];
    }

    if (b.action === "upsert-step") {
      if (!b.automation_id || !(await ownsAutomation(b.automation_id))) return res.status(403).json({ error: "unknown automation" });
      if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: "body required" });
      if (!["sms", "email"].includes(b.channel)) return res.status(400).json({ error: "channel must be sms|email" });
      // Row shape lives in _automation-step.js. On UPDATE it deliberately OMITS
      // `enabled` unless the caller sent it, so saving a step's wording can never
      // re-enable a step a human turned off (the portal editor sends no `enabled`).
      const row = buildStepRow(b);
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
      // ARMING IS THE OWNER'S CALL, ON EVERY ROUTE (Zoran, 2026-07-29). Switching on
      // live messaging to parents is an owner decision wherever it happens - not only
      // on the onboarding step that carries his name.
      //
      // This is the SECOND door to that decision. The wizard's approve-sales-messages
      // action was already owner-scoped, but the Sales panel's On/Off switch
      // (_autoSetLive) fires set-approved + set-enabled together, so this route was
      // "arm this sequence" under the weaker `canActOn` scope - which admits any
      // teammate holding can_train_agent. A teammate could flip the five sequences On,
      // parents would start receiving texts, and the wizard's approve step would go
      // green with the owner never having read a message.
      //
      // NARROW, AND ONLY IN THE ARMING DIRECTION:
      //   set-approved value=true   -> owner (or BAM staff). First consent.
      //   set-approved value=false  -> canActOn. Un-approving is an emergency stop;
      //                               it must never wait for the owner.
      //   set-enabled  either way   -> canActOn. Operators keep the kill switch and
      //                               can re-enable what the owner already approved.
      //
      // The can_train_agent FLAG is untouched - it means other things. Only these
      // routes narrowed.
      if (b.action === "set-approved" && !!b.value) {
        const refuseArm = armingRefusal("set-approved", actor, clientId);
        if (refuseArm) return res.status(refuseArm.status).json({ error: refuseArm.error });
      }
      const field = b.action === "set-enabled" ? "enabled" : "approved";
      await sb(`automations?id=eq.${b.automation_id}&client_id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ [field]: !!b.value, updated_at: new Date().toISOString() }) });
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
