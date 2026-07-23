// Un-mark "lost" when a parked lead comes back (Zoran, 2026-07-22).
//
// THE GAP THIS CLOSES: sending a lead to Nurture writes a `pipeline_outcomes`
// row, and the qualified-trial close rate counts outcome 'lost' OR 'nurture' as
// LOST ("nurture = marked lost", Zoran 2026-07-15). The reply bounce that pulls
// them back out of Ghosted/Nurture into Responded wrote NO outcome row - so a
// lead who returned and is actively being worked again still scored as lost
// until they actually bought. The close rate read worse than reality.
//
// FIX: append a 'reopened' row on the bounce. `cc_qualified_trials` reads the
// LATEST outcome per opportunity, so:
//   nurture -> lost · nurture then reopened -> pending · reopened then nurture -> lost
// Append-only, so the audit trail keeps every transition (no row is rewritten).
//
// Best-effort by design: the stage move is what matters operationally; a failed
// KPI-bookkeeping write must never break an inbound reply.

export const REOPENED = "reopened";

export async function markReopened({ clientId, sb, oppRef, offerId = null, reason = "replied - back in play" }) {
  try {
    if (!clientId || !sb || !oppRef) return false;
    const oppId = oppRef.ghlOpportunityId || oppRef.id || null;
    if (!oppId) return false;
    await sb(`pipeline_outcomes`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id: clientId,
        opportunity_id: String(oppId),
        status: REOPENED,
        reason,
        ...(offerId ? { offer_id: offerId } : {}),
      }]),
    });
    return true;
  } catch (e) {
    console.error("markReopened:", e && e.message);
    return false;
  }
}
