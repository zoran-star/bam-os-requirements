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
import { cancelReignitions, pauseReignitions } from "./_reignite.js";

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

// `pauseClosing` (the two REPLY callers pass it, Zoran 2026-07-23): the closing
// queue + the closing park are PAUSED rather than canceled. A lead who answers
// "Thank you" after our post-trial info used to lose their whole scheduled
// cadence before a human saw the card. Paused rows still can't auto-fire (every
// reader filters on pending/approved/scheduled), but Hawkeye's "send nothing"
// puts them straight back, and a real reply / terminal move finalizes them to
// canceled. CONVERSION (Stripe) never pauses - a paying member's cadence must die.
export async function cancelAllSalesOutbound({ clientId, contactId, sendError = "lead converted", reigniteReason = null, pauseClosing = false } = {}) {
  if (!clientId || !contactId) return { skipped: "missing clientId/contactId" };
  const cid = encodeURIComponent(String(contactId));
  const patch = {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "canceled", send_error: sendError, updated_at: new Date().toISOString() }),
  };
  const result = {};
  for (const t of QUEUES) {
    try {
      const base = `${t}?client_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${cid}`;
      if (pauseClosing && t === "agent_closing_replies") {
        // ONLY the scheduled follow-up PLAN (step_key followup_N) pauses. A live
        // single card - a drafted reply, an enroll/lost proposal - is answering an
        // OLDER message, so a fresh inbound makes it stale: those still cancel, and
        // the detector drafts a new one. Keeping them out of the paused set also
        // keeps the resume safe: the one-active-per-contact unique index buckets
        // step_key-null rows together, so thawing an old cardless draft would
        // collide with the new card.
        // Two passes so paused_from remembers where each step came back to: an
        // approved step resumes ready-to-send, a pending one still needs a ✓.
        for (const from of ["pending", "approved"]) {
          await sb(`${base}&status=eq.${from}&step_key=like.followup*`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "paused", paused_from: from, send_error: sendError, updated_at: new Date().toISOString() }),
          });
        }
        // Whatever is LEFT active is a non-plan card - cancel it as before (the
        // plan rows are already out of pending/approved by now).
        await sb(`${base}&status=in.(pending,approved)`, patch);
      } else {
        await sb(`${base}&status=in.(pending,approved)`, patch);
      }
      result[t] = "ok";
    } catch (e) {
      result[t] = String((e && e.message) || e);
    }
  }
  try {
    const reason = reigniteReason || sendError;
    result.reignitions = pauseClosing
      ? await pauseReignitions(clientId, String(contactId), reason, { agent: "closing" })
      : await cancelReignitions(clientId, String(contactId), reason);
    // Booking/confirm parks still hard-cancel on a reply even in pause mode -
    // only the closing agent got the new rule. Scoped to 'scheduled' so it can't
    // undo the freeze the line above just applied to the closing park.
    if (pauseClosing) {
      result.reignitions_canceled = await cancelReignitions(clientId, String(contactId), reason, { statuses: ["scheduled"] });
    }
  } catch (e) {
    result.reignitions = String((e && e.message) || e);
  }
  return { ok: true, ...result };
}
