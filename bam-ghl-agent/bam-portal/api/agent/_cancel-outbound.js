// One central sweep that cancels EVERY pending/approved scheduled sales outbound
// for a contact, across all four agent queues plus any parked reignition. Three
// callers share it so the list can never drift again:
//   1. GHL inbound webhook   - a lead REPLIED (don't text someone who's talking to us)
//   2. Twilio inbound webhook - same, on the Twilio spine
//   3. Stripe webhook         - a lead CONVERTED / signed up (never sell to a paid member)
//
// Why it exists: before this, only the REPLY path swept everything. CONVERSION
// (signup) cancelled just the ghosted/nurture drip (exitEnrollment) + marked the
// opp won, so a fresh paying member could still get closing / booking / confirm
// follow-ups (and a parked reignition) until a cron happened to notice they left
// the stage - and the returning-client "silent" enroll path skips the won-mark
// entirely, so nothing cancelled those cards. This closes that gap: signup now
// cancels as instantly and completely as a reply.
//
// Portal-native tables only (the V2 agent queues) - it never reads or writes GHL,
// so V1 / GHL-managed academies are untouched. Fails soft per table; callers wrap
// in try/catch and never block on it.
import { cancelReignitions } from "./_reignite.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// The four agent scheduled-outbound queues:
//   agent_followups        - legacy quiet-lead nudges (Responded)
//   agent_ready_replies    - booking agent drafts (Responded)
//   agent_confirm_replies  - confirm agent drafts (Scheduled-Trial)
//   agent_closing_replies  - closing agent drafts + scripted sequence + the approved
//                            multi-message follow-up PLAN (Done-Trial)
const QUEUES = ["agent_followups", "agent_ready_replies", "agent_confirm_replies", "agent_closing_replies"];

// Cancel every pending/approved card in all four queues + any scheduled reignition
// for one contact. `sendError` is stamped on the canceled rows (so staff can see WHY
// they were pulled); `reigniteReason` defaults to it. Returns a per-queue result map;
// never throws.
//
// Freeze a contact's scheduled CLOSING follow-up plan (step_key followup_N) so a
// reply doesn't destroy it. Call this BEFORE a pending/approved cancel sweep: the
// plan rows move out of those statuses, so the sweep only clears the non-plan
// cards. Exported for the reply paths that do their own inline sweep (the email
// spines). Best-effort - never throws.
export async function pauseClosingPlan(clientId, contactId, reason = "lead replied") {
  if (!clientId || !contactId) return 0;
  const base = `agent_closing_replies?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(String(contactId))}`;
  let n = 0;
  for (const from of ["pending", "approved"]) {
    try {
      const rows = await sb(`${base}&status=eq.${from}&step_key=like.followup*`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "paused", paused_from: from, send_error: reason, updated_at: new Date().toISOString() }),
      });
      n += Array.isArray(rows) ? rows.length : 0;
    } catch (e) { console.error("[_cancel-outbound] pauseClosingPlan failed (soft):", e.message); }
  }
  return n;
}

// `pauseClosing` (Zoran 2026-07-23, the REPLY callers pass true): the closing
// follow-up PLAN is PAUSED rather than canceled. A lead who answers "Thank you"
// after our post-trial info used to lose their whole scheduled cadence before a
// human saw the card. Paused rows still can't auto-fire (every reader filters on
// pending/approved), but Hawkeye's "send nothing" puts them straight back, and a
// real reply / terminal move finalizes them to canceled. Same spirit as
// keepReignition below - a reply is not a reason to erase a planned cadence.
// CONVERSION (Stripe) never pauses - a paying member's cadence must die.
//
// `keepReignition` (Zoran 2026-07-23): the REPLY callers pass true. A park is a
// deliberate "circle back on this date" decision - a routine logistics reply
// ("he can't make Tuesday, see you Thursday") must not silently delete it. It
// deleted Mike Sandhu's Jul 28 park, and the next cron - seeing no park - queued
// the 2-message follow-up plan the park existed to prevent. The queued CARDS still
// get cancelled (never text someone mid-conversation); the park stands and keeps
// the proactive engines off the lead until its date. CONVERSION callers (Stripe
// signup, live-member reconcile) still cancel it - a paying member must never get
// a parked re-engagement.
export async function cancelAllSalesOutbound({ clientId, contactId, sendError = "lead converted", reigniteReason = null, keepReignition = false, pauseClosing = false } = {}) {
  if (!clientId || !contactId) return { skipped: "missing clientId/contactId" };
  const cid = encodeURIComponent(String(contactId));
  const patch = {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "canceled", send_error: sendError, updated_at: new Date().toISOString() }),
  };
  const result = {};
  // Freeze the closing PLAN first so the cancel sweep below can't reach it. Only
  // plan rows (step_key followup_N) pause: a live single card - a drafted reply,
  // an enroll/lost proposal - is answering an OLDER message, so a fresh inbound
  // makes it stale and it still cancels. Keeping those out of the paused set also
  // keeps the resume safe: the one-active-per-contact unique index buckets
  // step_key-null rows together, so thawing an old draft would collide with the
  // new card.
  if (pauseClosing) {
    result.closing_plan_paused = await pauseClosingPlan(clientId, contactId, sendError);
  }
  for (const t of QUEUES) {
    try {
      await sb(`${t}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${cid}&status=in.(pending,approved)`, patch);
      result[t] = "ok";
    } catch (e) {
      result[t] = String((e && e.message) || e);
    }
  }
  if (keepReignition) {
    result.reignitions = "kept";
  } else {
    try {
      result.reignitions = await cancelReignitions(clientId, String(contactId), reigniteReason || sendError);
    } catch (e) {
      result.reignitions = String((e && e.message) || e);
    }
  }
  return { ok: true, ...result };
}
