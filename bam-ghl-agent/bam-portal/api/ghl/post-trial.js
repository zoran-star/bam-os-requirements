// Vercel Serverless Function — Post-trial review submit.
//
//   POST /api/ghl/post-trial?client_id=<uuid>
//     body: { opportunity_id, good_fit, trainer, notes }
//     → records a post_trial_reviews row. If good_fit:
//        • moves the opportunity to the Done Trial stage
//        • writes the trainer to the contact's "Lead Sales Person" field
//        • QUEUES a signup-link text (status 'queued') — NOT sent yet; the
//          comms tab will deliver queued texts once it exists.
//
// Auth: Supabase JWT — staff, or client_users membership for client_id.

import { withSentryApiRoute } from "../_sentry.js";
import { maybeSendSmsViaProvider } from "../messaging/provider.js";
import { moveStage, pipelineFlags, oppMatchClause, resolveStage, setStatus } from "../agent/_store.js";
import { routeTransition } from "../agent/_router.js";
import { markUnqualified } from "../agent/_tags.js";
import { nurtureStage } from "../agent/_stage.js";
import { isAutomationLive, enrollContact } from "../automations.js";
import { contactProvider } from "../_contacts.js";
import { recordKpiEvent } from "../_kpi.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role,name&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, staff: isStaff ? staff[0] : null, isStaff, clientIds };
}

async function ghl(method, path, { token, body } = {}) {
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function getToken(client) {
  if (!client.ghl_access_token) throw new Error("academy not connected to GHL");
  const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000 || !client.ghl_refresh_token) return client.ghl_access_token;
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim(), sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) return client.ghl_access_token;
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }),
  });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) return client.ghl_access_token;
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }),
  });
  return tok.access_token;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  const b = req.body || {};
  const oppId = b.opportunity_id;
  if (!oppId) return res.status(400).json({ error: "opportunity_id required" });
  const goodFit = !!b.good_fit;
  const showedUp = (b.showed_up === true || b.showed_up === false) ? b.showed_up : null;
  const trainer = (b.trainer || "").trim() || null;
  const notes = (b.notes || "").trim() || null;
  const sendLink = !!b.send_onboarding_link;
  // Not-a-fit terminal outcome: "unqualified" (quiet dead-end, default) or "lost"
  // (Lead Nurture takes over). Only consulted when showed up + not a good fit.
  const notFitOutcome = b.outcome === "lost" ? "lost" : "unqualified";
  // No-show extras (Zoran 2026-07-14): the coach's read on WHY they no-showed and
  // an optional first-text they want the rebook to work from. Both become
  // <contact_memory> the booking agent uses to draft the rebook (which still lands
  // in the Hawkeye deck for the coach's final ✓ - nothing is sent from here on a
  // no-show). The reason also rides the review row so it shows on the record.
  const rebookReason = (b.rebook_reason || "").toString().trim();
  const rebookSeed = (b.rebook_seed || "").toString().trim();

  const rows = await sb(`clients?id=eq.${clientId}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,booking_provider&limit=1`);
  const client = rows?.[0];
  if (!client) return res.status(404).json({ error: "academy not found" });

  let token;
  try { token = await getToken(client); }
  catch (e) { return res.status(502).json({ error: `GHL token: ${e.message}` }); }

  // Look up the opportunity for contact + pipeline (provider-aware). A provider='portal'
  // academy's opp lives in the store and its id is a portal uuid, so a GHL fetch would
  // 404 - read the store row instead. `oppRef` is the handle passed to the stage moves.
  let contactId = null, pipelineId = null, oppRef = null, oppOfferId = null;
  const { provider } = await pipelineFlags(clientId).catch(() => ({ provider: "ghl" }));
  if (provider === "portal") {
    try {
      const rows = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&${oppMatchClause(oppId)}&select=id,ghl_opportunity_id,ghl_contact_id,ghl_pipeline_id,offer_id&limit=1`);
      const row = Array.isArray(rows) && rows[0];
      if (row) { contactId = row.ghl_contact_id || null; pipelineId = row.ghl_pipeline_id || null; oppOfferId = row.offer_id || null; oppRef = { id: row.id, ghlOpportunityId: row.ghl_opportunity_id || null }; }
    } catch (e) { return res.status(500).json({ error: `store opp: ${e.message}` }); }
  } else {
    let opp;
    try { opp = (await ghl("GET", `/opportunities/${encodeURIComponent(oppId)}`, { token })).opportunity; }
    catch (e) { return res.status(e.status || 502).json({ error: `GHL opp: ${e.message}` }); }
    contactId = opp?.contactId || opp?.contact?.id || null;
    pipelineId = opp?.pipelineId || opp?.pipeline_id || null;
    oppRef = { ghlOpportunityId: oppId };
  }

  // Resolve the specific trial this review is for (portal academies) so the
  // post-trial form card keys on the TRIAL, not the contact - a rebooked lead's
  // prior-trial review must never suppress the new trial's card (Zoran 2026-07-10).
  // Rule: the contact's most recent trial whose session has started (1h grace for
  // early submits).
  //   - trialBookingTarget = most recent *BOOKED* started trial -> drives the
  //     SHOWED/NO_SHOW outcome stamp (only a still-BOOKED trial gets stamped).
  //   - reviewTrialId = most recent started trial of ANY status (BOOKED/SHOWED/
  //     NO_SHOW) -> the id the review ties to. This must NEVER be null when a
  //     passed trial exists: a null trial_booking_id is dropped from the
  //     list-ready reviewedBookings set, so the form card RESURRECTS even after a
  //     good submit (Kartik-class bug, GTA 2026-07-11). On a second submit the
  //     first stamped the trial SHOWED, so a BOOKED-only lookup returns nothing -
  //     the any-status fallback keeps trial_booking_id stable + non-null.
  let trialBookingTarget = null, reviewTrialId = null;
  if (contactId && client.booking_provider === "portal") {
    try {
      const tbs = await sb(
        `trial_bookings?tenant_id=eq.${encodeURIComponent(clientId)}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=in.(BOOKED,SHOWED,NO_SHOW)&select=id,slot_id,status&limit=50`
      );
      if (Array.isArray(tbs) && tbs.length) {
        const slotIds = tbs.map(t => t.slot_id).filter(Boolean);
        const slots = slotIds.length ? await sb(`schedule_slots?id=in.(${slotIds.map(encodeURIComponent).join(",")})&select=id,start_time`) : [];
        const startById = new Map((slots || []).map(s => [s.id, new Date(s.start_time).getTime()]));
        const started = tbs
          .map(t => ({ ...t, startMs: startById.get(t.slot_id) || 0 }))
          .filter(t => t.startMs && t.startMs <= Date.now() + 60 * 60_000)   // session started (1h grace)
          .sort((a, b) => b.startMs - a.startMs);
        reviewTrialId = started[0]?.id || null;                        // most recent passed trial, any status
        trialBookingTarget = started.find(t => t.status === "BOOKED") || null;   // most recent still-BOOKED -> outcome stamp
      }
    } catch (e) { console.error("resolve trial_booking for review failed (non-fatal):", e.message); }
  }

  // Record the review (one per opportunity). trial_booking_id ties it to the
  // specific trial so the Confirm-tab form card is per-trial, not per-contact.
  try {
    await sb("post_trial_reviews?on_conflict=client_id,opportunity_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        client_id: clientId, opportunity_id: oppId, ghl_contact_id: contactId,
        offer_id: oppOfferId, trial_booking_id: reviewTrialId || trialBookingTarget?.id || null,
        good_fit: goodFit, showed_up: showedUp, trainer, notes: notes || (showedUp === false ? (rebookReason || null) : null),
        signup_text_status: sendLink ? "queued" : "skipped",
        created_by: ctx.staff?.name || ctx.user?.email || null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) { return res.status(500).json({ error: `save review: ${e.message}` }); }

  // KPI event log (Track A): the trial outcome is a funnel moment - attended or
  // no-show. One outcome per opportunity (idempotent ref). Best-effort.
  if (showedUp !== null) {
    await recordKpiEvent({
      clientId, step: showedUp ? "trial_attended" : "trial_no_show",
      ghlContactId: contactId || null,
      ref: `trialoutcome:${oppId}`,
      meta: { opportunity_id: oppId, good_fit: goodFit, trainer: trainer || null },
    });
  }

  // Calendars-off-GHL ④: on a portal-booking academy, stamp the outcome onto the
  // contact's trial_bookings row too (SHOWED / NO_SHOW via Luka's set_trial_outcome
  // RPC - never a direct update), so the portal calendar + conversion lineage agree
  // with the coach's form. Reuses trialBookingTarget resolved above (same "most
  // recent started BOOKED trial" rule). Best-effort: a miss must never fail submit.
  if (showedUp !== null && trialBookingTarget) {
    try {
      await sb(`rpc/set_trial_outcome`, { method: "POST", body: JSON.stringify({ p_tenant_id: clientId, p_trial_booking_id: trialBookingTarget.id, p_status: showedUp ? "SHOWED" : "NO_SHOW" }) });
    } catch (e) { console.error("trial_bookings outcome stamp failed (non-fatal):", e.message); }
  }

  // Contact provider gate: a 'portal' academy owns attendance + trainer in its own
  // tables (post_trial_reviews above, contact_trainers below), so the redundant GHL
  // custom-field writes are skipped for it. Every other academy keeps writing GHL.
  const contactProv = await contactProvider(clientId);

  // Write attendance to the "Did the Athlete show up?" field (non-fatal).
  if (contactId && showedUp !== null && contactProv !== "portal") {
    try {
      const cf = (await ghl("GET", `/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, { token })).customFields || [];
      const f = cf.find(x => /did the athlete show up|showed up|attended/i.test(x.name || ""));
      if (f) await ghl("PUT", `/contacts/${encodeURIComponent(contactId)}`, { token, body: { customFields: [{ id: f.id, field_value: showedUp ? "Yes" : "No" }] } });
    } catch (e) { console.error("attendance write failed (non-fatal):", e.message); }
  }

  // Mirror the trainer onto the contact so the Communications tab's trainer
  // tabs pick it up (also editable inline there).
  if (contactId && trainer) {
    try {
      await sb("contact_trainers?on_conflict=client_id,ghl_contact_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ client_id: clientId, ghl_contact_id: contactId, trainer, updated_by: ctx.staff?.name || ctx.user?.email || null, updated_at: new Date().toISOString() }),
      });
    } catch (e) { console.error("contact_trainers upsert failed (non-fatal):", e.message); }
  }

  const result = { ok: true, good_fit: goodFit, showed_up: showedUp, moved: false, trainer, signup_text: "none" };

  // No-show: bounce the lead back to RESPONDED so the BOOKING agent actively
  // rebooks them (Zoran 2026-07-06). This REPLACES the old Interested + missed_trial
  // nurture path - the standalone missed_trial firing is retired here; the booking
  // rebook opener (scripted if the academy approved its booking initial automations,
  // else the AI opener) owns the outreach. Route the no_show edge (GTA seed =
  // scheduled_trial -> responded); on no edge, hardcode the Responded move. Then drop
  // a persistent rebook-context note + an "Entry: Rebook" trigger note the booking
  // rebook pass consumes to open the lead exactly once. Non-fatal.
  if (showedUp === false) {
    try {
      const routed = await routeTransition({ clientId, sb, ghl, token, locationId: client.ghl_location_id, fromRole: "scheduled_trial", trigger: "no_show", contactId, oppRef, reason: "post-trial: no-show, rebook" });
      if (routed.matched) {
        if (routed.moved) { result.moved = true; result.moved_to = "responded"; }
      } else {
        let stage = null;
        if (provider === "portal") {
          const st = await resolveStage(sb, ghl, { clientId, token, locationId: client.ghl_location_id, role: "responded" });
          if (st) stage = { pipelineId: st.pipelineId || pipelineId, stageId: st.stageId, stageName: st.stageName || "Responded" };
        } else {
          const pls = (await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(client.ghl_location_id)}`, { token })).pipelines || [];
          const pl = pls.find(p => p.id === pipelineId) || pls[0];
          const responded = (pl?.stages || []).find(s => /respond/i.test(s.name || ""));
          if (responded) stage = { pipelineId: pl.id, stageId: responded.id, stageName: responded.name };
        }
        if (stage) {
          await moveStage({ clientId, sb, ghl, token, oppRef, stage, role: "responded", contactId });
          result.moved = true;
          result.moved_to = "responded";
        }
      }
    } catch (e) { console.error("no-show responded move failed (non-fatal):", e.message); }
    // Rebook context + trigger notes for the booking agent (best-effort). The
    // "Entry: Rebook" note is consumed (deactivated) by the rebook pass after it
    // opens, so the lead is texted exactly once.
    if (contactId) {
      try {
        // The persistent context note + optional coach steer come FIRST (loadContactMemory
        // reads active notes as the team's guidance the draft must honor), and the
        // "Entry: Rebook" trigger note comes LAST so the rebook pass fires exactly once.
        const noteRows = [
          { client_id: clientId, ghl_contact_id: String(contactId), active: true, note: "Rebook needed (no-show): they didn't show for their booked trial.", created_by: "post-trial-noshow" },
        ];
        if (rebookReason) noteRows.push({ client_id: clientId, ghl_contact_id: String(contactId), active: true, note: `Coach's read on the no-show (use it when you write the rebook): ${rebookReason}`, created_by: "post-trial-noshow" });
        if (rebookSeed) noteRows.push({ client_id: clientId, ghl_contact_id: String(contactId), active: true, note: `The coach drafted a rebook opener to work from - send it or adapt it to fit the conversation: "${rebookSeed}"`, created_by: "post-trial-noshow" });
        noteRows.push({ client_id: clientId, ghl_contact_id: String(contactId), active: true, note: "Entry: Rebook needed - no-show", created_by: "post-trial-noshow" });
        await sb(`agent_contact_notes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(noteRows) });
      } catch (e) { console.error("no-show rebook notes failed (non-fatal):", e.message); }
    }
    result.missed_trial = "retired";
  }

  if (goodFit) {
    // Advance to Done Trial per the academy's authored flow (the post_trial_good_fit
    // edge; GTA seed = scheduled_trial -> done_trial). Router reads the edge; on no
    // edge (unseeded / paused / lookup blip) it returns matched:false and we run the
    // original provider-branch resolve + move - behavior-identical for GTA.
    try {
      const routed = await routeTransition({ clientId, sb, ghl, token, locationId: client.ghl_location_id, fromRole: "scheduled_trial", trigger: "post_trial_good_fit", contactId, oppRef, reason: "post-trial: good fit" });
      if (routed.matched) {
        if (routed.moved) result.moved = true;
      } else {
        let stage = null;
        if (provider === "portal") {
          const st = await resolveStage(sb, ghl, { clientId, token, locationId: client.ghl_location_id, role: "done_trial" });
          if (st) stage = { pipelineId: st.pipelineId || pipelineId, stageId: st.stageId, stageName: st.stageName || "Done Trial" };
        } else {
          const pls = (await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(client.ghl_location_id)}`, { token })).pipelines || [];
          const pl = pls.find(p => p.id === pipelineId) || pls[0];
          const doneStage = (pl?.stages || []).find(s => { const n = (s.name || "").toLowerCase(); return n.includes("trial") && (n.includes("done") || n.includes("complete") || n.includes("attended")); });
          if (doneStage) stage = { pipelineId: pl.id, stageId: doneStage.id, stageName: doneStage.name };
        }
        if (stage) {
          // Move through the provider-aware store; on ghl it is the identical PUT and the
          // store does the shadow mirror internally (replacing the manual shadowMirrorMove).
          await moveStage({ clientId, sb, ghl, token, oppRef, stage, role: "done_trial", contactId });
          result.moved = true;
        } else {
          result.move_warning = "could not resolve the Done Trial stage";
        }
      }
    } catch (e) {
      console.error("done-trial move failed:", e.message);
      // Surface it: the review row already saved (killing the never-expiring form
      // card), so a silent move failure would strand the good-fit lead in
      // Scheduled-Trial while the UI cheerfully said "Routed to Done Trial".
      result.move_warning = e.message;
    }
    // move_ok = did the good-fit lead actually reach Done Trial? The deck/board
    // read this to warn (retry needed) instead of claiming success on a failure.
    result.move_ok = !!result.moved;

    // Write the trainer to the contact's "Lead Sales Person" field (GTA convention).
    if (contactId && trainer && contactProv !== "portal") {
      try {
        const cf = (await ghl("GET", `/locations/${encodeURIComponent(client.ghl_location_id)}/customFields`, { token })).customFields || [];
        const lsp = cf.find(f => /lead sales person/i.test(f.name || "")) || cf.find(f => /sales person|trainer/i.test(f.name || ""));
        if (lsp) {
          await ghl("PUT", `/contacts/${encodeURIComponent(contactId)}`, { token, body: { customFields: [{ id: lsp.id, field_value: trainer }] } });
        }
      } catch (e) { console.error("trainer write failed (non-fatal):", e.message); }
    }
  }

  // Showed up but NOT a fit -> a terminal close. The coach picks which one on the
  // form: "lost" (Lead Nurture takes over) or "unqualified" (quiet dead-end).
  if (showedUp === true && !goodFit && notFitOutcome === "lost") {
    // Showed up but LOST (qualified, not proceeding): same terminal as the Confirm
    // agent's Mark Lost - route into 💔 Lead Nurture if that sequence is live + a
    // Lead Nurture stage exists (opp stays OPEN), else GHL-native status=lost.
    // Quiet close, no message. (Zoran 2026-07-10)
    const lostReason = (b.lost_reason || "").toString().trim() || "post-trial: lost";
    let routedToNurture = false;
    try {
      if (await isAutomationLive(clientId, "nurture")) {
        const ns = await nurtureStage(token, client.ghl_location_id, { clientId, sb });
        if (ns) {
          await moveStage({ clientId, sb, ghl, token, oppRef, stage: ns, role: "nurture", contactId, reason: lostReason });
          await enrollContact({ clientId, automationKey: "nurture", contactId });
          routedToNurture = true;
        }
      }
    } catch (e) { console.error("post-trial lost -> nurture failed (falling back to status=lost):", e.message); }
    // lost_ok = did the close actually land? The deck reads this to warn (retry
    // needed) instead of claiming "Marked lost" when both writes silently failed
    // (mirrors move_ok on the good-fit path).
    let lostLanded = routedToNurture;
    if (!routedToNurture) {
      try { await setStatus({ clientId, ghl, token, oppRef, status: "lost", contactId, reason: lostReason }); lostLanded = true; }
      catch (e) { console.error("post-trial mark lost failed (non-fatal):", e.message); }
    }
    result.lost = true;
    result.lost_ok = lostLanded;
    result.routed_to_nurture = routedToNurture;
    try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: routedToNurture ? "nurture" : "lost", reason: lostReason }]) }); } catch (_) {}
  } else if (showedUp === true && !goodFit) {
    // Showed up but NOT a fit -> the dead end. Route the post_trial_not_fit edge
    // through the router's terminal path (GTA seed = scheduled_trial -> Unqualified):
    // close the opp (setStatus abandoned + role:unqualified) and stamp the GHL
    // unqualified tag + an outcome row, mirroring the confirm-abandoned action.
    // Only fires when the coach explicitly marked showed-up + not-a-fit; a paused or
    // missing edge leaves the lead put (no legacy behavior to preserve here). No
    // message is sent - it's a quiet close.
    // unqualified_ok = did the close actually land? A paused/unseeded edge (or a
    // lookup blip -> resolveEdge returns null) leaves the lead PUT with nothing
    // closed; the deck reads this to warn instead of falsely toasting "Closed as
    // unqualified" (Zoran 2026-07-10).
    let uqLanded = false;
    try {
      const routed = await routeTransition({ clientId, sb, ghl, token, locationId: client.ghl_location_id, fromRole: "scheduled_trial", trigger: "post_trial_not_fit", contactId, oppRef, allowTerminal: true, reason: "post-trial: showed up, not a fit" });
      if (routed.matched && routed.terminal === "unqualified" && routed.moved) {
        result.unqualified = true; uqLanded = true;
        if (contactId) { try { await markUnqualified(token, contactId, clientId); } catch (_) {} }
        try { await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: oppId, status: "abandoned", reason: "post-trial: not a fit" }]) }); } catch (_) {}
      }
    } catch (e) { console.error("not-a-fit unqualified close failed (non-fatal):", e.message); }
    result.unqualified_ok = uqLanded;
  }

  // Send the trainer's first follow-up message: their personal note (TOP) + the
  // academy sign-up link on its own line at the BOTTOM (only when "add the sign-up
  // link" is on). Link is configured per-academy on the training offer
  // (offers.data.signup_url). Never send for a no-show (guard if the flag leaks).
  const firstMessage = (b.first_message || "").toString().trim();
  if (contactId && showedUp !== false && (firstMessage || sendLink)) {
    try {
      let signupUrl = "";
      if (sendLink) {
        const offers = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
        signupUrl = ((offers && offers[0] && offers[0].data && offers[0].data.signup_url) || "").trim();
      }
      const parts = [];
      if (firstMessage) parts.push(firstMessage);
      if (signupUrl)    parts.push(signupUrl);
      const msg = parts.join("\n\n");
      if (!msg) {
        result.signup_text = sendLink ? "no_link" : "none";   // link asked for but none set, and no note typed
      } else {
        // Provider seam (same as every agent send): a Twilio academy sends from
        // its own number and the outbound lands in the portal thread. A raw GHL
        // send here went out on the old LC number and split the conversation.
        const g = await maybeSendSmsViaProvider(clientId, { ghlContactId: contactId, body: msg, sentBy: ctx.staff?.name || ctx.user?.email || "post-trial-form" });
        if (g.handled) { if (!g.ok) throw new Error(g.error); }
        else await ghl("POST", `/conversations/messages`, { token, body: { type: "SMS", contactId, message: msg } });
        result.signup_text = "sent";
        try {
          await sb(`post_trial_reviews?client_id=eq.${encodeURIComponent(clientId)}&opportunity_id=eq.${encodeURIComponent(oppId)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ signup_text_status: "sent", updated_at: new Date().toISOString() }),
          });
        } catch (_) {}
      }
    } catch (e) {
      console.error("first-message send failed (non-fatal):", e.message);
      result.signup_text = "failed";
    }
  }

  return res.status(200).json(result);
}

export default withSentryApiRoute(handler);
