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
// TERMINALS ARE OPT-IN. By default routeTransition only performs stage->stage
// moves; a terminal edge (member / unqualified / human) returns matched:false so
// a stage-only caller keeps its verified hardcoded close logic (and so an academy
// re-pointing a stage trigger at a terminal can't make a stage caller
// accidentally close a lead). A caller that KNOWS how to handle a terminal passes
// { allowTerminal:true } to enable it. See project_sales_focus_mode.md.

import { sbRest, resolveStage, moveStage, setStatus, findOpenOpp } from "./_store.js";
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
// A terminal result adds { kind:"terminal", terminal:"member"|"unqualified"|"human" };
// for "human" moved is false + escalate is true (the router performs no status
// change — escalation is caller-specific). Requires opts.allowTerminal:true.
export async function routeTransition(opts = {}) {
  const { clientId, sb, ghl, token, locationId, fromRole, trigger, contactId, allowTerminal } = opts;
  let { oppRef } = opts;

  const edge = await resolveEdge(clientId, fromRole, trigger);
  if (!edge) return { matched: false, reason: "no-edge" };

  // Pause wins over the fallback: the academy explicitly turned this route OFF in
  // focus mode. Return matched:true (so the caller does NOT run its hardcoded
  // move) but moved:false — the lead stays put by design.
  if (edge.enabled === false) return { matched: true, moved: false, paused: true };

  const isTerminal = edge.to_kind === "terminal" || !edge.to_stage_role;
  // Terminals are opt-in: a stage-only caller defers to its hardcoded close.
  if (isTerminal && !allowTerminal) return { matched: false, reason: "terminal-deferred" };

  const ghlFn = ghl || ghlDefault;
  // Resolve the contact's open opp if the caller didn't hand one in.
  if (!oppRef && contactId) {
    try { oppRef = await findOpenOpp({ clientId, sb, ghl: ghlFn, token, locationId, contactId }); }
    catch (_) { oppRef = null; }
  }
  const reason = opts.reason || `flow: ${fromRole || "entry"} + ${trigger}`;

  if (isTerminal) {
    const term = edge.to_terminal;
    // human = needs a person. The router changes NO status (escalation — task /
    // Slack / queue — is the caller's job); it just flags the branch.
    if (term === "human") return { matched: true, kind: "terminal", terminal: "human", moved: false, escalate: true };
    // member = enrolled/won; unqualified = the dead-end abandon, role-stamped so
    // the board + unqualified tag stay in sync (mirrors confirm-abandoned). Any
    // GHL tag / outcome-log side effects stay with the caller.
    const status = term === "member" ? "won" : "abandoned";
    const role = term === "unqualified" ? "unqualified" : undefined;
    if (oppRef) await setStatus({ clientId, sb, ghl: ghlFn, token, oppRef, status, role, contactId, reason });
    return { matched: true, kind: "terminal", terminal: term, moved: !!oppRef };
  }

  const role = edge.to_stage_role;
  const stage = await resolveStage(sb, ghlFn, { clientId, token, locationId, role });
  if (!stage) return { matched: false, reason: "no-stage" };
  if (oppRef) {
    await moveStage({ clientId, sb, ghl: ghlFn, token, oppRef, stage, role, contactId, reason });
  }
  return { matched: true, kind: "stage", role, moved: !!oppRef };
}
