// ── Stage-transition ROUTER (the Sales-Crew flow engine) ─────────────────────
// One place that turns a lead EVENT ("this lead in <fromRole> just did <trigger>")
// into an actual MOVE, by reading the academy's authored flow graph from the
// `stage_transitions` table instead of hardcoding the destination per agent.
//
// Why it exists: today every "on trigger X -> move to stage Y" is hardcoded
// across booking / confirm / closing / automations. That means every academy is
// stuck on GTA's flow. The router reads each academy's own edges, so a second
// academy needs only seeded (or custom) rows — zero code. GTA's seeded edges
// exactly match today's hardcoded flow, so routing through the table is
// behavior-identical for GTA.
//
// Additive + safe by design: if there's no matching enabled edge (academy not
// seeded, edge paused, lookup blip), routeTransition returns { matched:false }
// and the caller keeps its existing hardcoded move. The router never guesses.
//
// PHASE 1 SCOPE: only stage->stage moves are routed here. Terminal edges
// (member / unqualified / human) still DEFER to each caller's verified hardcoded
// close/status logic until their own swap lands — the router will never invent a
// won/lost/abandoned. See docs / project_sales_focus_mode.md for the swap order.

import { sbRest, resolveStage, moveStage, findOpenOpp } from "./_store.js";
import { ghl as ghlDefault } from "../ghl/_core.js";

// Read the single transition edge for (clientId, fromRole, trigger) on the
// client-wide default flow (pipeline_id IS NULL). Returns the edge row (including
// its `enabled` flag) or null (no such row / lookup failure). Never throws — a
// lookup blip must fall back to the caller's hardcoded path, not break a live
// agent action. NOTE: disabled rows are returned too (not filtered out) so the
// caller can tell "academy paused this route on purpose" (enabled=false) apart
// from "academy has no such row" (null) — the pause must win over the fallback.
// An enabled duplicate wins over a disabled one (order enabled.desc). `fromRole`
// may be null for the external new_lead entry (from_stage_role IS NULL).
export async function resolveEdge(clientId, fromRole, trigger) {
  if (!clientId || !trigger) return null;
  const fromClause = fromRole ? `from_stage_role=eq.${encodeURIComponent(fromRole)}` : `from_stage_role=is.null`;
  try {
    const rows = await sbRest(
      `stage_transitions?client_id=eq.${encodeURIComponent(clientId)}` +
      `&${fromClause}` +
      `&trigger=eq.${encodeURIComponent(trigger)}` +
      `&pipeline_id=is.null` +
      `&select=trigger,to_kind,to_stage_role,to_terminal,enabled&order=enabled.desc,sort_order.asc&limit=1`
    );
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (_) {
    return null;
  }
}

// Move a lead per the academy's authored flow.
//   opts: { clientId, sb, ghl, token, locationId, fromRole, trigger, contactId, oppRef?, reason? }
// Returns:
//   { matched:true,  kind:"stage", role, moved }  — routed + (best-effort) moved
//   { matched:false, reason }                     — caller should run its hardcoded move
// The move reuses the _store primitives (resolveStage + moveStage), so it inherits
// the ghl/portal provider split, the shadow mirror, and KPI hooks for free.
export async function routeTransition(opts = {}) {
  const { clientId, sb, ghl, token, locationId, fromRole, trigger, contactId } = opts;
  let { oppRef } = opts;

  const edge = await resolveEdge(clientId, fromRole, trigger);
  if (!edge) return { matched: false, reason: "no-edge" };

  // Pause wins over the fallback: the academy explicitly turned this route OFF in
  // focus mode. Return matched:true (so the caller does NOT run its hardcoded
  // move) but moved:false — the lead stays put by design.
  if (edge.enabled === false) return { matched: true, moved: false, paused: true };

  // Phase 1: terminals defer to the caller's verified hardcoded close logic.
  if (edge.to_kind !== "stage" || !edge.to_stage_role) {
    return { matched: false, reason: "terminal-deferred" };
  }

  const ghlFn = ghl || ghlDefault;
  // Resolve the contact's open opp if the caller didn't hand one in.
  if (!oppRef && contactId) {
    try { oppRef = await findOpenOpp({ clientId, sb, ghl: ghlFn, token, locationId, contactId }); }
    catch (_) { oppRef = null; }
  }

  const role = edge.to_stage_role;
  const stage = await resolveStage(sb, ghlFn, { clientId, token, locationId, role });
  if (!stage) return { matched: false, reason: "no-stage" };

  const reason = opts.reason || `flow: ${fromRole || "entry"} + ${trigger}`;
  if (oppRef) {
    await moveStage({ clientId, sb, ghl: ghlFn, token, oppRef, stage, role, contactId, reason });
  }
  return { matched: true, kind: "stage", role, moved: !!oppRef };
}
