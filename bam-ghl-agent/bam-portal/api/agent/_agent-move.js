// Shared: move a lead from the sales agent that holds them to a DIFFERENT one.
//
// Zoran 2026-08-07, from a real BAM GTA lead (Ala Babiker): her closing row was
// closed lost weeks ago and she was sitting in the Booking agent, where no amount
// of booking work was going to help her. Staff could SEE the wrong agent had her
// and had no way to say so. The "Move the lead" section of a Hawkeye card now
// carries a button per other agent, and this is what those buttons run.
//
// The template is confirm-handoff (api/agent-confirm.js), which has done exactly
// this for confirm -> booking since day one: write the context note, move the
// opportunity, then draft the receiving agent's card INLINE so it is waiting in
// the deck the moment the modal closes instead of up to 15 minutes later on the
// next cron. That pair keeps its own purpose-built path (it also voids the dropped
// trial booking and files a "rebook" pipeline outcome); this is the general one.
//
// THREE deliberate differences from confirm-handoff:
//
//   1. NO router. confirm-handoff asks routeTransition where the academy's
//      authored flow sends a "can't make it", because the AGENT decided. Here a
//      human picked the destination by name. Honouring an authored edge that
//      disagreed would silently land the lead somewhere other than the button
//      they pressed.
//   2. Failures are LOUD. confirm-handoff swallows a failed stage move because
//      its note is the part that must land. Here the move IS the request, so a
//      missing stage or a missing opportunity comes back as an error and the
//      source card stays in the deck rather than resolving on a move that never
//      happened.
//   3. NOTHING is ever sent. The receiving agent's draft lands as a pending card
//      a human approves. No path here touches shouldAutoSend.

import { ghl } from "../ghl/_core.js";
import { respondedStage, scheduledTrialStage, doneTrialStage } from "./_stage.js";
import { moveStage, findOpenOpp } from "./_store.js";
import { cancelReignitions } from "./_reignite.js";
import { markReopened } from "./_reopen.js";

// The three sales agents, each keyed by the Hawkeye tab that shows it. `role` is
// the pipeline-stage role in _store.js's registry; `stage` resolves it live;
// `table` is the agent's own card queue, swept when a lead leaves it.
export const AGENTS = {
  booking: { label: "Booking", role: "responded",       stageLabel: "Responded",       stage: respondedStage,      table: "agent_ready_replies",   active: "pending,approved" },
  confirm: { label: "Confirm", role: "scheduled_trial", stageLabel: "Scheduled Trial", stage: scheduledTrialStage, table: "agent_confirm_replies", active: "pending,approved" },
  // Closing sweeps PAUSED rows too: a frozen follow-up cadence must not survive
  // the lead leaving this agent and thaw itself back later (Zoran 2026-07-23).
  closing: { label: "Closing", role: "done_trial",      stageLabel: "Done Trial",      stage: doneTrialStage,      table: "agent_closing_replies", active: "pending,approved,paused" },
};

export const isAgentKey = (k) => Object.prototype.hasOwnProperty.call(AGENTS, String(k || ""));

// The note the RECEIVING agent reads. contact-memory.js injects active
// agent_contact_notes into every agent's prompt, so this is the whole mechanism
// by which the next agent knows why it suddenly has this lead. Named staff, named
// source, and the reason in the mover's own words.
export function moveNoteText(fromAgent, toAgent, why, staffEmail) {
  const from = (AGENTS[fromAgent] && AGENTS[fromAgent].label) || fromAgent;
  const to = (AGENTS[toAgent] && AGENTS[toAgent].label) || toAgent;
  const who = (staffEmail || "").trim();
  const reason = String(why || "").trim();
  return `Moved from the ${from} agent to the ${to} agent by ${who || "staff"}. ${reason || "No reason given."}`.slice(0, 900);
}

/**
 * Move one lead's opportunity into `toAgent`'s stage and leave the receiving
 * agent the context note it needs. Does NOT draft, resolve the source card, or
 * cancel parks: the calling agent's API owns its own bookkeeping.
 *
 * Returns { ok: true, opportunity_id, stage_name } or { ok: false, error, status }.
 * Every failure is a real answer about this lead, never a swallowed one.
 */
export async function moveLeadToAgent({ sb, clientId, token, locationId, contactId, fromAgent, toAgent, why, staffEmail }) {
  if (!isAgentKey(toAgent)) return { ok: false, status: 400, error: "Pick a valid agent to move them to." };
  if (fromAgent === toAgent) return { ok: false, status: 400, error: "That lead is already with this agent." };
  if (!contactId) return { ok: false, status: 400, error: "ready_id or contact_id required" };
  const dest = AGENTS[toAgent];

  // 1. The destination stage must exist BEFORE anything is written. An academy
  //    whose Training Pipeline has no Done-Trial stage cannot receive a lead into
  //    Closing, and saying so is more useful than a note nobody acts on.
  let stage;
  try { stage = await dest.stage(token, locationId, { clientId, sb }); }
  catch (e) { return { ok: false, status: 502, error: `We couldn't read this academy's pipeline, so nothing was moved: ${e.message}` }; }
  if (!stage) return { ok: false, status: 409, error: `This academy's Training Pipeline has no ${dest.stageLabel} stage, so the ${dest.label} agent has nowhere to take them.` };

  // 2. And so must an open opportunity. A lead with no open opp has nothing to
  //    move; the note alone would leave the deck claiming a move that did not
  //    happen.
  let oppRef = null;
  try { oppRef = await findOpenOpp({ clientId, ghl, token, locationId, contactId }); }
  catch (e) { return { ok: false, status: 502, error: `We couldn't look this lead's opportunity up, so nothing was moved: ${e.message}` }; }
  if (!oppRef) return { ok: false, status: 409, error: "This lead has no open opportunity, so there is nothing to move between agents." };
  const oppId = (oppRef.ghlOpportunityId || oppRef.id) || null;

  // 3. The note lands first: if the stage move then fails, the lead is where they
  //    were and the note explains the attempt. The other order can move a lead
  //    into an agent that has no idea why it has them.
  const note = moveNoteText(fromAgent, toAgent, why, staffEmail);
  try {
    await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
      client_id: clientId, ghl_contact_id: String(contactId), active: true,
      note, created_by: staffEmail || "agent-move",
    }]) });
  } catch (e) { return { ok: false, status: 500, error: `couldn't save the move note: ${e.message}` }; }

  // 4. The move itself. Provider-aware via moveStage (GHL PUT, or a portal-store
  //    row update plus no GHL at all on provider='portal').
  try { await moveStage({ clientId, ghl, token, oppRef, stage, role: dest.role, contactId, reason: note.slice(0, 300) }); }
  catch (e) { return { ok: false, status: e.status || 502, error: `couldn't move them to ${dest.stageLabel}: ${e.message}` }; }

  // 5. Bookkeeping for the KPI/outcome log, as 'reopened' rather than a status of
  //    its own. cc_qualified_trials reads the LATEST pipeline_outcomes row per
  //    opportunity and scores 'lost'/'nurture' as lost, everything else pending
  //    (see api/agent/_reopen.js). A hand-moved lead IS back in play: Ala Babiker,
  //    the lead this feature was built for, had been closed lost on 2026-07-15 and
  //    was about to be worked again. A novel status like "moved_to_closing" would
  //    have produced the same number by accident; 'reopened' means it on purpose.
  //    Best-effort: the move already landed and must not be undone by a log write.
  await markReopened({ clientId, sb, oppRef, reason: `moved to the ${dest.label} agent` });

  return { ok: true, opportunity_id: oppId, stage_name: stage.stageName || dest.stageLabel };
}

/**
 * Draft the receiving agent's first card INLINE, so it is in that agent's Hawkeye
 * tab by the time the modal closes. Loaded lazily: each agent API owns its own
 * drafter, and a static import in every direction would make three import cycles.
 *
 * Returns whatever the drafter returns ({ queued, row?, skipped?, stale? }) and
 * NEVER throws. The lead has already moved at this point; a draft that fails is a
 * missing convenience, not a reason to undo a move. The cards these produce are
 * always pending: no drafter here consults shouldAutoSend.
 */
export async function draftForNewAgent({ toAgent, client, token, locationId, contactId, contactName, createdBy = "agent-move" }) {
  try {
    let fn = null;
    if (toAgent === "booking") fn = (await import("../agent-approvals.js")).draftAndQueueRebook;
    else if (toAgent === "confirm") fn = (await import("../agent-confirm.js")).draftAndQueueConfirm;
    else if (toAgent === "closing") fn = (await import("../agent-closing.js")).draftAndQueueClosing;
    if (typeof fn !== "function") return { queued: false, skipped: "no drafter for that agent" };
    return await fn({ token, locationId, client, contactId, contactName, createdBy });
  } catch (e) {
    return { queued: false, skipped: `draft threw - ${(e && e.message) || e}` };
  }
}

// Shape the drafted card for the deck's review modal. Null when there is nothing
// to review, which the front end reports honestly rather than hiding.
export function reviewPayload(drafted) {
  if (!drafted || !drafted.queued || !drafted.row) return null;
  const row = drafted.row;
  if (!String(row.draft_message || "").trim()) return null;
  return {
    ready_id: row.id,
    draft_message: row.draft_message,
    book_slot_at: row.book_slot_at || null,
    book_group: row.book_group || null,
    reasoning: row.reasoning || null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
  };
}

/**
 * The whole "move-agent" request, shared by all three agent APIs so the six
 * directed pairs cannot drift apart. Each API supplies its own `sb` and says
 * which agent it IS; everything else is symmetric.
 *
 * Returns { status, body } for the caller to hand straight to res.
 */
export async function handleAgentMove({ sb, clientId, client, token, locationId, staffEmail, fromAgent, body = {} }) {
  const toAgent = String(body.to_agent || "").trim();
  if (!isAgentKey(toAgent)) return { status: 400, body: { error: "Pick a valid agent to move them to." } };
  const src = AGENTS[fromAgent], dest = AGENTS[toAgent];

  let row = null, contactId = body.contact_id || null;
  if (body.ready_id) {
    [row] = await sb(`${src.table}?id=eq.${encodeURIComponent(body.ready_id)}&client_id=eq.${clientId}&select=*`);
    if (!row) return { status: 404, body: { error: "not found" } };
    contactId = row.ghl_contact_id;
  }
  if (!contactId) return { status: 400, body: { error: "ready_id or contact_id required" } };

  const moved = await moveLeadToAgent({
    sb, clientId, token, locationId, contactId, fromAgent, toAgent,
    why: body.move_note, staffEmail,
  });
  // Nothing has been resolved or swept at this point, so a refusal leaves the
  // card exactly where it was and staff can read why and try again.
  if (!moved.ok) return { status: moved.status || 500, body: { error: moved.error } };

  const reason = `moved to the ${dest.label} agent`;
  // Sweep the SOURCE agent's cards: this lead is not its problem any more. They
  // are 'canceled', never 'sent' - a move texts the family nothing, and stamping
  // a sweep 'sent' would fake a sent_at row and poison the training data.
  try {
    await sb(`${src.table}?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(${src.active})`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: reason, updated_at: new Date().toISOString() }) });
  } catch (_) { /* the move landed; a stale card is hidden by the read-time stage gate anyway */ }
  // Booking's queued follow-ups live in their own table and would otherwise fire
  // at a lead the booking agent no longer owns.
  if (fromAgent === "booking") {
    try { await sb(`agent_followups?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(pending,approved)`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "canceled", send_error: reason, updated_at: new Date().toISOString() }) }); } catch (_) {}
  }
  // A park is "leave them alone until this date". Staff just decided a different
  // agent should work them NOW, so an old re-engagement text firing later would
  // talk over it. Same call confirm-handoff makes.
  await cancelReignitions(clientId, contactId, reason);

  // Draft the receiving agent's card inline, so the lead lands in that agent's
  // deck rather than waiting up to 15 minutes for its cron.
  const drafted = await draftForNewAgent({
    toAgent, client, token, locationId, contactId,
    contactName: (row && row.contact_name) || body.contact_name || null,
  });
  const review = reviewPayload(drafted);
  return {
    status: 200,
    body: {
      ok: true, moved: true, from_agent: fromAgent, to_agent: toAgent,
      to_label: dest.label, opportunity_id: moved.opportunity_id, stage_name: moved.stage_name,
      // The drafted card, for the deck to review in the same modal. Null is a
      // real outcome (nothing to say yet), and `draft_skipped` says which.
      review,
      draft_skipped: review ? null : (drafted.skipped || (drafted.queued ? "the card has no message to review" : "not drafted")),
    },
  };
}
