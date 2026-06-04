// CoachIQ bridge — let the portal drive an academy's CoachIQ (credits/booking
// engine) while FullControl owns billing. See the full design + proof in
// memories/project_coachiq_integration.md.
//
// STATUS (2026-06-03):
//   ✅ addCoachiqCredits()  — PROVEN live. Fires a CoachIQ "Incoming Webhook"
//      automation that adds credits/products to a user, resolved by CoachIQ
//      user id. This is the only piece confirmed working end-to-end.
//   ⏳ createCoachiqUser()  — NOT yet wired. Direct create+enroll needs an
//      admin-scoped session (emailLogin gives only an athlete/"Guest" token;
//      adminAddUser → "not allowed"). Pending: admin token OR Zapier "Create
//      User". Left as a documented stub so the call site is ready.
//
// Nothing here is invoked by a live flow yet — it's a tested building block.
// Wire addCoachiqCredits() into api/stripe/webhook.js handleInvoiceSucceeded
// ONLY for PORTAL-OWNED subs (sub.application == null AND created by us), so we
// never double-credit subs CoachIQ still bills natively.

import { firstEnv, requireEnv } from "./_env.js";

const COACHIQ_API_BASE = "https://api-v3.coachiq.io";

// Per-academy CoachIQ config. For multi-academy (the product goal) this should
// live on the `clients` row (e.g. clients.coachiq_group_id /
// clients.coachiq_credit_automation_id / a secret ref). For the BAM GTA proof
// it can come from env. Pass an explicit `cfg` to override.
function coachiqConfig(cfg = {}) {
  return {
    apiKey:            cfg.apiKey            || firstEnv("COACHIQ_API_KEY"),
    groupId:           cfg.groupId           || firstEnv("COACHIQ_GROUP_ID"),
    creditAutomationId: cfg.creditAutomationId || firstEnv("COACHIQ_CREDIT_AUTOMATION_ID"),
  };
}

export function coachiqEnabled(cfg = {}) {
  const c = coachiqConfig(cfg);
  return !!(c.apiKey && c.groupId && c.creditAutomationId);
}

// Fire a CoachIQ automation by webhook. PROVEN call shape:
//   POST {base}/hook/automation/trigger/{automationId}
//   headers: Authorization: Bearer <apiKey>, x-group-id: <groupId>
//   body: arbitrary JSON; the automation reads it. The target user MUST be the
//         CoachIQ USER id (members.coachiq_member_id), nested as {user:{id}}.
//         email / profileId / top-level userId do NOT resolve — see #1 in the note.
//
// The endpoint is async: HTTP 200 {"success":true} only means "accepted". The
// automation's own actions (Add Credits) run after; check CoachIQ Execution Logs
// for action-level success. There is an auth rate limit (~450s) under rapid calls.
export async function triggerCoachiqAutomation(automationId, payload, cfg = {}) {
  const c = coachiqConfig(cfg);
  if (!c.apiKey)  throw new Error("CoachIQ: missing COACHIQ_API_KEY");
  if (!c.groupId) throw new Error("CoachIQ: missing COACHIQ_GROUP_ID");
  if (!automationId) throw new Error("CoachIQ: missing automationId");

  const resp = await fetch(`${COACHIQ_API_BASE}/hook/automation/trigger/${automationId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${c.apiKey}`,
      "x-group-id": c.groupId,
    },
    body: JSON.stringify(payload || {}),
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!resp.ok || (json && json.success === false)) {
    const msg = (json && (json.message || json.error)) || text.slice(0, 200);
    const err = new Error(`CoachIQ webhook failed (${resp.status}): ${msg}`);
    err.status = resp.status;
    throw err;
  }
  return json || { raw: text };
}

// Add session credits to a CoachIQ user (the member's coachiq_member_id).
// `coachiqUserId` is REQUIRED and must be the CoachIQ user id, not email.
// `extra` lets the automation read more payload fields (e.g. plan, amount) via
// {{payload.*}} if the academy's automation uses them.
export async function addCoachiqCredits(coachiqUserId, extra = {}, cfg = {}) {
  if (!coachiqUserId) throw new Error("CoachIQ: coachiqUserId (members.coachiq_member_id) is required");
  const c = coachiqConfig(cfg);
  const automationId = cfg.creditAutomationId || c.creditAutomationId;
  if (!automationId) throw new Error("CoachIQ: missing COACHIQ_CREDIT_AUTOMATION_ID");
  return triggerCoachiqAutomation(automationId, { user: { id: coachiqUserId }, ...extra }, cfg);
}

// ── Create + enroll a CoachIQ user — NOT YET AVAILABLE via the API key ──
// emailLogin yields only an athlete/"Guest" token; adminAddUser needs an
// admin-scoped session we can't get with the key. Options being evaluated:
//   (a) admin session token (from the dashboard) used against api-v3/graphql
//   (b) Zapier "Create User" action (integration scope; may enroll in group)
// Capture the returned CoachIQ user id and store it in members.coachiq_member_id.
export async function createCoachiqUser(/* { firstName, lastName, email, phone }, cfg */) {
  throw new Error(
    "createCoachiqUser: not implemented — admin-scoped create+enroll path unresolved. " +
    "See memories/project_coachiq_integration.md (#2 / login-perms)."
  );
}
