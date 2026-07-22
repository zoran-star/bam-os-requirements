// ── Cancelled-booking rebook handshake (2026-07-21 team meeting) ─────────────
// A lead who CANCELS their upcoming booked trial through the calendar (the
// website manage-booking link, the parent app) is the same "can't make it"
// moment the confirm agent hands off in api/agent-confirm.js confirm-handoff -
// except no agent is in the loop: the lead acted directly on the booking. This
// helper performs the identical handshake so the booking agent proactively
// opens a rebook conversation instead of the lead going dark:
//
//   1. fires only for an UPCOMING slot + a lead still sitting in Scheduled-Trial
//   2. writes the persistent "Rebook needed (cancelled booking): ..." context
//      note + the "Entry: Rebook needed - cancelled booking" trigger note. The
//      A5 rebook pass in api/agent-approvals.js keys off "Entry: Rebook" notes
//      (once the lead is in Responded) and consumes the trigger note after
//      drafting, so the lead is opened exactly once.
//   3. routes the cancel_booking edge (GTA seed = scheduled_trial -> responded);
//      on no edge (unseeded academy / lookup blip) falls back to the hardcoded
//      Responded move, mirroring the cant_make_it path.
//
// Best-effort by design: the cancellation itself already succeeded before this
// runs - nothing here may throw at the caller.

import { routeTransition } from "./_router.js";
import { sbRest, resolveStage, moveStage, findOpenOpp, contactInRole } from "./_store.js";

export async function bounceCancelledTrialToRebook({ clientId, contactId, trialBookingId, source } = {}) {
  try {
    if (!clientId || !contactId) return { bounced: false, reason: "no-contact" };
    // Only an upcoming slot triggers a rebook - cancelling a past BOOKED row is
    // bookkeeping, not a "get me a new time" signal. Unknown start time proceeds.
    if (trialBookingId) {
      try {
        const rows = await sbRest(
          `trial_bookings?id=eq.${encodeURIComponent(trialBookingId)}&tenant_id=eq.${encodeURIComponent(clientId)}&select=schedule_slots(start_time)&limit=1`
        );
        const st = Array.isArray(rows) && rows[0] && rows[0].schedule_slots && rows[0].schedule_slots.start_time;
        if (st && st <= new Date().toISOString()) return { bounced: false, reason: "slot-already-ran" };
      } catch (_) { /* unknown start time - proceed */ }
    }
    // Only a lead the confirm agent is still working (Scheduled-Trial) bounces.
    // contactInRole reads the portal store; a GHL-provider academy (no token
    // threaded here) safely returns false and the lead is left alone.
    let inStage = false;
    try { inStage = await contactInRole({ clientId, contactId, role: "scheduled_trial" }); } catch (_) {}
    if (!inStage) return { bounced: false, reason: "not-in-scheduled-trial" };
    const context = "They cancelled their booked trial in the calendar - reach out and find them a new time.";
    // Persistent context note FIRST (contact memory reads active notes as the
    // team's guidance), the "Entry:" trigger note LAST so the rebook pass fires
    // exactly once. Mirrors api/ghl/post-trial.js's no-show handshake.
    try {
      await sbRest(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([
        { client_id: clientId, ghl_contact_id: String(contactId), active: true, note: `Rebook needed (cancelled booking): ${context}`, created_by: source || "calendar-cancel" },
        { client_id: clientId, ghl_contact_id: String(contactId), active: true, note: "Entry: Rebook needed - cancelled booking", created_by: source || "calendar-cancel" },
      ]) });
    } catch (_) { /* notes are best-effort too - still attempt the bounce */ }
    // Bounce Scheduled-Trial -> Responded per the authored flow (cancel_booking
    // edge); on no edge run the hardcoded Responded move (mirrors cant_make_it).
    let moved = false;
    try {
      const oppRef = await findOpenOpp({ clientId, contactId });
      const reason = "lead cancelled their booked trial in the calendar";
      const routed = await routeTransition({ clientId, fromRole: "scheduled_trial", trigger: "cancel_booking", contactId, oppRef, reason });
      if (routed.matched) moved = !!routed.moved;
      else if (oppRef) {
        const stage = await resolveStage(null, null, { clientId, role: "responded" });
        if (stage) { await moveStage({ clientId, oppRef, stage, role: "responded", contactId, reason }); moved = true; }
      }
    } catch (_) { /* the notes already landed - the rebook pass picks the lead up once they reach Responded */ }
    return { bounced: true, moved };
  } catch (_) {
    return { bounced: false, reason: "error" };
  }
}
