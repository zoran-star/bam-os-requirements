// CoachIQ bridge — let the portal drive an academy's CoachIQ (credits/booking
// engine) while FullControl owns billing. See the full design + proof in
// memories/project_coachiq_integration.md.
//
// STATUS (2026-06-18 — onboarding flow wired):
//   ✅ triggerCoachiqAutomation()/addCoachiqCredits() — PROVEN webhook bridge.
//   ✅ addCoachiqProduct()    — fires the "Add a Product Purchase" automation
//      (product + program access + starter credits, no payment). Same proven shape.
//   ✅ createCoachiqUser()    — fires the Zapier "Create User" catch-hook (the only
//      proven create+ENROLL path). Async: the new id returns via the Zap's callback
//      to /api/coachiq/user-created, which stores it + grants the product.
//   Wired into api/onboarding/activations.js (post-payment) and testable in isolation
//      via api/coachiq/test-onboard.js. GATED behind config — inert until env is set.
//   ⚠️ COACHIQ_API_KEY pasted in chat 2026-06-01 must be ROTATED before go-live.

import { firstEnv, requireEnv } from "./_env.js";

const COACHIQ_API_BASE = "https://api-v3.coachiq.io";

// Per-academy CoachIQ config. For multi-academy (the product goal) this should
// live on the `clients` row (e.g. clients.coachiq_group_id /
// clients.coachiq_credit_automation_id / a secret ref). For the BAM GTA proof
// it can come from env. Pass an explicit `cfg` to override.
function coachiqConfig(cfg = {}) {
  return {
    apiKey:             cfg.apiKey             || firstEnv("COACHIQ_API_KEY"),
    groupId:            cfg.groupId            || firstEnv("COACHIQ_GROUP_ID"),
    creditAutomationId: cfg.creditAutomationId || firstEnv("COACHIQ_CREDIT_AUTOMATION_ID"),
    // Zapier "Create User" catch-hook URL — the only proven create+enroll path
    // (api-v3 signUp_V2 makes bare, unenrolled accounts; adminAddUser is blocked).
    createUserWebhookUrl: cfg.createUserWebhookUrl || firstEnv("COACHIQ_CREATE_USER_WEBHOOK_URL"),
    // "Add a Product Purchase to a User" automation id (grants product + credits,
    // no payment). One default + optional per-plan map (COACHIQ_PRODUCT_MAP JSON:
    // { "<plan>|<term>": "<automationId>" }).
    productAutomationId: cfg.productAutomationId || firstEnv("COACHIQ_PRODUCT_AUTOMATION_ID"),
    productMap:          cfg.productMap          || coachiqProductMap(),
    // Shared secret guarding the inbound callback + the test endpoint.
    webhookSecret:      cfg.webhookSecret      || firstEnv("COACHIQ_WEBHOOK_SECRET"),
  };
}

function coachiqProductMap() {
  try {
    const raw = firstEnv("COACHIQ_PRODUCT_MAP");
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

// Resolve the product automation id for a plan|term (map → default).
export function coachiqProductAutomationFor(plan, term, cfg = {}) {
  const c = coachiqConfig(cfg);
  const map = c.productMap || {};
  return map[`${plan}|${term}`] || map[plan] || c.productAutomationId || null;
}

export function coachiqEnabled(cfg = {}) {
  const c = coachiqConfig(cfg);
  return !!(c.apiKey && c.groupId && c.creditAutomationId);
}

// Onboarding (grant a product to a CoachIQ user) is enabled when we can fire the
// product automation (api key + group + a product automation id/map). User CREATION
// is NOT our job in the self-signup model — the parent signs up on the academy's
// CoachIQ group login page (enrolled), CoachIQ's "New User" automation webhooks us
// the id, and we grant the product. (createUserWebhookUrl is only for the optional
// Zapier create path; not required here.)
export function coachiqOnboardingEnabled(cfg = {}) {
  const c = coachiqConfig(cfg);
  return !!(c.apiKey && c.groupId && (c.productAutomationId || Object.keys(c.productMap || {}).length));
}

export { coachiqConfig };

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

// POST to a full CoachIQ automation webhook URL (the value pasted per Stripe price in
// pricing_catalog.coachiq_automation_url) with the CoachIQ auth headers. Same success
// semantics as triggerCoachiqAutomation.
async function postCoachiqWebhook(url, payload, cfg = {}) {
  const c = coachiqConfig(cfg);
  if (!c.apiKey)  throw new Error("CoachIQ: missing COACHIQ_API_KEY");
  if (!c.groupId) throw new Error("CoachIQ: missing COACHIQ_GROUP_ID");
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${c.apiKey}`,
      "x-group-id": c.groupId,
    },
    body: JSON.stringify(payload || {}),
  });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!resp.ok || (json && json.success === false)) {
    const msg = (json && (json.message || json.error)) || text.slice(0, 200);
    throw new Error(`CoachIQ webhook failed (${resp.status}): ${msg}`);
  }
  return json || { raw: text };
}

// Grant a CoachIQ product (+ program access + starter credits) to a user, with no
// payment — they already paid in the portal. The product automation is resolved by:
//   1. an explicit `automationUrl` (the per-Stripe-price coachiq_automation_url) — preferred,
//   2. else the per-plan|term env map / COACHIQ_PRODUCT_AUTOMATION_ID default.
// `sub_id` (the portal-owned Stripe subscription) is sent so the CoachIQ automation can
// store it on the product → CoachIQ knows the renewal date to refresh credits.
export async function addCoachiqProduct(coachiqUserId, { plan, term, automationUrl, ...extra } = {}, cfg = {}) {
  if (!coachiqUserId) throw new Error("CoachIQ: coachiqUserId is required");
  const payload = { user: { id: coachiqUserId }, plan, term, ...extra };
  if (automationUrl) {
    const res = await postCoachiqWebhook(automationUrl, payload, cfg);
    return { ok: true, automationUrl, res };
  }
  const automationId = coachiqProductAutomationFor(plan, term, cfg);
  if (!automationId) throw new Error("CoachIQ: no product automation (price has no coachiq_automation_url, and no COACHIQ_PRODUCT_AUTOMATION_ID/MAP)");
  const res = await triggerCoachiqAutomation(automationId, payload, cfg);
  return { ok: true, automationId, res };
}

// ── Create + enroll a CoachIQ user via the Zapier "Create User" action ──
// Direct-API create+enroll is a DEAD END (signUp_V2 makes bare unenrolled accounts;
// adminAddUser is blocked; admin.coachiq.io is WAF-locked). Zapier "Create User" is
// the ONLY proven create+ENROLL path (returns a real, creditable user id).
//
// Zapier catch-hooks respond 200 immediately and run async, so they can't return the
// new user id synchronously. So this fires the hook FIRE-AND-FORGET; the id comes back
// via the Zap's final step POSTing to /api/coachiq/user-created (then we store it and
// grant the product). Returns { fired: true, pending: true }.
//
// `member` needs: id, client_id, parent_email, parent_name, parent_phone, plan, term.
export async function createCoachiqUser(member, cfg = {}) {
  const c = coachiqConfig(cfg);
  if (!c.createUserWebhookUrl) throw new Error("CoachIQ: missing COACHIQ_CREATE_USER_WEBHOOK_URL");
  if (!member?.parent_email)   throw new Error("CoachIQ: member has no parent_email");

  const nameParts = (member.parent_name || "").trim().split(/\s+/);
  const payload = {
    // Fields the Zapier "Create User" action maps:
    first: nameParts[0] || "",
    last:  nameParts.slice(1).join(" ") || "",
    email: member.parent_email.toLowerCase(),
    phone: member.parent_phone || "",
    // Echoed back so the callback can match this to the member + grant the product:
    member_id: member.id,
    client_id: member.client_id,
    plan:      member.plan || null,
    term:      member.term || null,
    callback_secret: c.webhookSecret || null,
  };

  const resp = await fetch(c.createUserWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`CoachIQ create-user hook failed (${resp.status}): ${(await resp.text()).slice(0, 150)}`);
  }
  // Some Zaps CAN return JSON synchronously (Webhook Response). If an id comes back,
  // surface it; otherwise it arrives later via the callback.
  let id = null;
  try { const j = await resp.json(); id = j?.id || j?.coachiq_user_id || j?.userId || null; } catch { /* async hook */ }
  return id ? { fired: true, id } : { fired: true, pending: true };
}
