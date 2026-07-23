// Off-GHL pipeline store seam (Effort E, PR 1). The single place that resolves a
// stage ROLE (what the code means: "responded", "scheduled_trial", ...) to a
// concrete pipeline+stage. Today it is a thin indirection that returns the SAME
// GHL ids the regex finders returned before, so production is byte-identical -
// but the coupling to GHL stage NAMES now lives behind one function the later
// phases (dual-write, portal-read) build on. See docs/off-ghl-pipeline-store-design.md.
//
// resolveStage(sb, ghl, { clientId, token, locationId, role }):
//   • If clients.pipeline_provider === 'portal' AND a pipeline_stages row exists
//     for (clientId, role)  ->  return that row in the finder shape, sourced from
//     its ghl_* columns (seeded to today's exact GHL ids by scripts/seed-stages.js).
//   • OTHERWISE (the default for every academy today, and whenever no clientId is
//     threaded in) -> fall back to the live-GHL regex finder, byte-identical to
//     the pre-seam _stage.js logic.
//
// Dependency-light: uses global fetch + the Supabase service key, mirroring the
// sb() helper in api/ghl/_core.js. No new packages.

import { ghl as ghlDefault } from "../ghl/_core.js";
import { recordKpiEvent } from "../_kpi.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// A portal opportunity id is a Postgres uuid; a GHL opportunity id is a 20-char
// alphanumeric string. The board still hands out GHL ids even for a
// provider='portal' academy, so lookups must accept either. Guard any `id=eq.`
// filter with this: passing a non-uuid into a uuid column throws Postgres 22P02
// and rejects the WHOLE query, instead of simply not matching that clause.
export const isUuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

// Build the PostgREST opportunity-match clause for a handle that may be a portal
// uuid OR a GHL opportunity id. Matches both id and ghl_opportunity_id when the
// handle is a uuid; only ghl_opportunity_id when it is a GHL id (avoids 22P02).
export const oppMatchClause = (oppId) =>
  isUuid(oppId)
    ? `or=(id.eq.${encodeURIComponent(oppId)},ghl_opportunity_id.eq.${encodeURIComponent(oppId)})`
    : `ghl_opportunity_id=eq.${encodeURIComponent(oppId)}`;

// Default Supabase REST reader (service role). Used only when a caller threads in
// a clientId but no custom sb reader. Mirrors api/ghl/_core.js sb().
async function defaultSbGet(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Role -> stage NAME matcher. This is the EXACT regex coupling that lived inline
// in each _stage.js finder; keeping it in one place is the whole point of PR 1.
// won / unqualified have no stage-name match today (won is a GHL status, and
// unqualified is status='abandoned' + a tag), so they have no matcher here - the
// registry can still hold those roles, they just have null ghl_* until seeded.
export const ROLE_MATCHERS = {
  responded:       (s) => /respond/i.test(s.name || ""),
  // Canonical role key is `ghosted` (2026-07-23). The GHL sub-account stage is
  // still NAMED "Interested" on most academies, so the matcher accepts both -
  // that name mirror is deliberate and does NOT get renamed. `interested` stays
  // registered as a legacy alias so any row still carrying the old role resolves
  // during the transition; drop it once every academy reads `ghosted`.
  ghosted:         (s) => /interest|ghost/i.test(s.name || ""),
  interested:      (s) => /interest|ghost/i.test(s.name || ""),
  scheduled_trial: (s) => /(schedul|book).*trial/i.test(s.name || ""),
  nurture:         (s) => /nurtur/i.test(s.name || ""),
  done_trial:      (s) => {
    const n = (s.name || "").toLowerCase();
    return n.includes("trial") && (n.includes("done") || n.includes("complete") || n.includes("attend"));
  },
};

// The Training pipeline for an academy (the one all the finders target): the
// pipeline whose name matches /training/i, else the first one. Returns null when
// there are no pipelines. Identical to the per-finder logic it replaces; THROWS
// on a GHL error exactly as the finders did (callers rely on fail-open).
async function ghlTrainingPipeline(ghl, token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  return pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0] || null;
}

// Live-GHL regex finder for one role. Byte-identical to the old _stage.js bodies:
// returns { pipelineId, stageId, stageName } or null, and propagates GHL errors.
async function ghlFindStage(ghl, token, locationId, role) {
  const matcher = ROLE_MATCHERS[role];
  if (!matcher) return null;                       // won/unqualified: no name match (as before)
  const pipe = await ghlTrainingPipeline(ghl, token, locationId);
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(matcher);
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

// Registry lookup: only for academies explicitly flipped to provider='portal'.
// Returns the finder-shaped object, or null to mean "fall back to live GHL".
// Returns null (fall back) when the row is missing OR has no usable GHL stage id,
// so a portal academy that has not seeded a stage still behaves like the regex.
async function resolveFromRegistry(sb, clientId, role, offerId) {
  const sbGet = typeof sb === "function" ? sb : defaultSbGet;
  const clientRows = await sbGet(`clients?id=eq.${encodeURIComponent(clientId)}&select=pipeline_provider&limit=1`);
  const provider = clientRows && clientRows[0] && clientRows[0].pipeline_provider;
  if (provider !== "portal") return null;
  // Phase 3 offer seam (DORMANT): filter to one offer's pipeline ONLY when the
  // caller threads an offerId. No caller does today, so this is byte-identical to
  // the pre-seam single-pipeline lookup. The engine turns it on when an academy
  // runs more than one offer pipeline and the (client, role) lookup would be
  // ambiguous. pipeline_stages.offer_id is fully backfilled, so a filtered lookup
  // resolves the same row an unfiltered one does today.
  const offerClause = offerId ? `&offer_id=eq.${encodeURIComponent(offerId)}` : "";
  const rows = await sbGet(
    `pipeline_stages?client_id=eq.${encodeURIComponent(clientId)}&role=eq.${encodeURIComponent(role)}${offerClause}` +
    `&select=id,label,ghl_pipeline_id,ghl_stage_id,ghl_stage_name&limit=1`
  );
  const row = rows && rows[0];
  if (!row) return null;
  if (row.ghl_stage_id) return { pipelineId: row.ghl_pipeline_id || null, stageId: row.ghl_stage_id, stageName: row.ghl_stage_name || null };
  // Unseeded GHL ids (a never-on-GHL academy whose stages came from applyPreset):
  // key by the registry row id - the SAME fallback key buildPortalBoard uses
  // (ghl_stage_id || row.id) - so store writes and board rendering stay
  // consistent, and a portal academy never falls back to a live GHL read it has
  // no token for. Seeded academies (GTA/DETAIL) hit the branch above unchanged.
  return { pipelineId: row.ghl_pipeline_id || null, stageId: row.id, stageName: row.ghl_stage_name || row.label || null };
}

// The seam. Same return contract as the _stage.js finders: { pipelineId,
// stageId, stageName } or null, and GHL errors propagate.
export async function resolveStage(sb, ghl, { clientId, token, locationId, role, offerId } = {}) {
  const ghlFn = ghl || ghlDefault;
  // Registry path is only attempted when a clientId is threaded in. No current
  // finder call site passes one, so today this branch never runs and resolveStage
  // is byte-identical to the old regex finders. A registry miss/error also falls
  // through to live GHL, never breaking an existing path. offerId is the dormant
  // Phase 3 seam (see resolveFromRegistry) — optional, off by default.
  if (clientId) {
    try {
      const fromRegistry = await resolveFromRegistry(sb, clientId, role, offerId);
      if (fromRegistry) return fromRegistry;
    } catch (_) { /* fall through to live GHL */ }
  }
  return ghlFindStage(ghlFn, token, locationId, role);
}

// ───────────────────────────────────────────────────────────────────────────
// P1 dual-write + read-from-portal (Effort E, PR 2). PURELY ADDITIVE, DORMANT.
//
// Two independent per-academy flags gate everything below (both default OFF, so
// with the defaults production is byte-identical - none of this code path runs):
//   • clients.pipeline_shadow=true  -> dual-write each opp move/create/close into
//        the portal `opportunities` table AND self-seed `pipeline_stages` from the
//        GHL stages we just resolved. Reads still come from GHL. Safe populate+soak.
//   • clients.pipeline_provider='portal' -> board READS come from the store instead
//        of GHL (buildPortalBoard below). resolveStage already returns from the
//        registry under 'portal' (see top of file).
//
// EVERYTHING here is best-effort + try/catch wrapped so it can NEVER block or break
// the real GHL write/read. The shadow gate (`if (!shadow) return`) makes the whole
// dual-write branch unreachable for any academy that has not been opted in.
//
// TODO(P4 - stop GHL writes): once an academy is reconciled-clean on provider=portal
// for a soak period, the move/close call sites can skip the GHL PUT entirely and
// shadowMirrorMove becomes the sole writer (and WON relocates into the Stripe/
// activations path). Do NOT stop any GHL write yet - this PR only ADDS the mirror.
// ───────────────────────────────────────────────────────────────────────────

// Write-capable service-role Supabase REST. Throws on a non-2xx so callers (which
// always wrap in try/catch) can swallow it; returns parsed JSON or null.
export async function sbRest(path, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const roleIsTerminal = (role) => role === "won" || role === "unqualified";
const isClosedStatus = (s) => s === "won" || s === "lost" || s === "abandoned";

// Per-instance flag cache so the hot paths (a move, a board open) don't re-read
// clients on every call. Short TTL so an opt-in flip takes effect within seconds.
const _pipelineFlagCache = new Map();   // clientId -> { at, shadow, provider }
const PIPELINE_FLAG_TTL_MS = 30000;

// { shadow, provider } for an academy. Pass an override (e.g. a client row already
// loaded by the caller) to skip the read entirely. Defaults to the dormant values
// on any miss/error, so a Supabase blip can never accidentally enable the path.
export async function pipelineFlags(clientId, override) {
  if (override && typeof override.shadow !== "undefined") {
    return { shadow: !!override.shadow, provider: override.provider || "ghl" };
  }
  if (!clientId) return { shadow: false, provider: "ghl" };
  const hit = _pipelineFlagCache.get(clientId);
  if (hit && (Date.now() - hit.at) < PIPELINE_FLAG_TTL_MS) return { shadow: hit.shadow, provider: hit.provider };
  let shadow = false, provider = "ghl";
  try {
    const rows = await sbRest(`clients?id=eq.${encodeURIComponent(clientId)}&select=pipeline_shadow,pipeline_provider&limit=1`);
    if (rows && rows[0]) { shadow = !!rows[0].pipeline_shadow; provider = rows[0].pipeline_provider || "ghl"; }
  } catch (_) { /* stay dormant on error */ }
  _pipelineFlagCache.set(clientId, { at: Date.now(), shadow, provider });
  return { shadow, provider };
}

// Idempotent UPSERT of the (client_id, role) registry row with the GHL stage we
// just resolved (self-seeding - no separate seed script needed). Returns the row
// id so the opportunity upsert can point stage_id at it. Best-effort: returns null
// on any failure. Only call this when you actually resolved a concrete stage.
export async function shadowUpsertStageRegistry(clientId, role, { pipelineId, stageId, stageName, label, position } = {}) {
  if (!clientId || !role) return null;
  const body = {
    client_id: clientId,
    role,
    ghl_pipeline_id: pipelineId || null,
    ghl_stage_id: stageId || null,
    ghl_stage_name: stageName || null,
    is_terminal: roleIsTerminal(role),
    updated_at: new Date().toISOString(),
  };
  if (label != null) body.label = label;
  if (position != null) body.position = position;
  try {
    const rows = await sbRest(`pipeline_stages?on_conflict=client_id,role&select=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([body]),
    });
    return Array.isArray(rows) && rows[0] ? rows[0].id : null;
  } catch (_) { return null; }
}

// Idempotent UPSERT of one portal opportunity, keyed on (client_id,
// ghl_opportunity_id). Only the fields provided are written, so an update never
// clobbers columns a different call site already set. Best-effort.
export async function shadowUpsertOpportunity(clientId, opp = {}) {
  const {
    ghlOpportunityId, ghlContactId, contactName, athleteName, contactPhone,
    stageRole, stageId, status, ghlPipelineId, monetaryValue, reason,
    source, entryPoint, lastStageChangeAt,
  } = opp;
  if (!clientId || !ghlOpportunityId) return false;
  const now = new Date().toISOString();
  const body = { client_id: clientId, ghl_opportunity_id: ghlOpportunityId, updated_at: now };
  if (ghlContactId   != null) body.ghl_contact_id = ghlContactId;
  if (contactName    != null) body.contact_name = contactName;
  if (athleteName    != null) body.athlete_name = athleteName;
  if (contactPhone   != null) body.contact_phone = contactPhone;
  if (stageRole      != null) body.stage_role = stageRole;
  if (stageId        != null) body.stage_id = stageId;
  if (ghlPipelineId  != null) body.ghl_pipeline_id = ghlPipelineId;
  if (monetaryValue  != null) body.monetary_value = monetaryValue;
  if (reason         != null) body.reason = reason;
  if (source         != null) body.source = source;
  if (entryPoint     != null) body.entry_point = entryPoint;
  if (lastStageChangeAt != null) body.last_stage_change_at = lastStageChangeAt;
  if (status != null) {
    body.status = status;
    if (isClosedStatus(status)) body.closed_at = now;
    else if (status === "open") body.closed_at = null;   // an un-close / reopen
  }
  try {
    await sbRest(`opportunities?on_conflict=client_id,ghl_opportunity_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([body]),
    });
    return true;
  } catch (_) { return false; }
}

// THE single move/close mirror used at every stage-move / status-close site. Gated
// on pipeline_shadow (pass opts.shadow when the caller already knows it, else this
// reads the flag). When the flag is off it returns immediately - the whole branch
// below is unreachable. Accepts either:
//   • role + stageResolved {pipelineId,stageId,stageName}  -> seed the registry for
//     that role and stamp stage_role + last_stage_change_at (a stage MOVE), or
//   • ghlStageId + ghlPipelineId (raw PATCH move) -> map the stage id back to a role
//     via the registry, or
//   • status only (won/lost/abandoned/open) -> a status close with no stage move.
export async function shadowMirrorMove(clientId, opts = {}) {
  try {
    let shadow = opts.shadow;
    if (typeof shadow === "undefined") shadow = (await pipelineFlags(clientId)).shadow;
    if (!shadow) return;   // ← dormant gate: nothing below runs unless opted in
    const {
      ghlOpportunityId, ghlContactId, role, status, reason, stageResolved,
      ghlStageId, ghlPipelineId, contactName, contactPhone, monetaryValue, source, entryPoint,
    } = opts;
    if (!ghlOpportunityId) return;
    // role (with a resolved stage) wins; opts.stageRole is an explicit override for
    // status-only closes that imply a role but move no stage (e.g. abandoned -> unqualified).
    let stageRole = role || opts.stageRole || null;
    let stageId = null;
    let pipelineId = ghlPipelineId || (stageResolved && stageResolved.pipelineId) || null;
    const rawStageId = ghlStageId || null;
    const isMove = !!(stageResolved && stageResolved.stageId) || !!rawStageId;

    if (role && stageResolved && stageResolved.stageId) {
      // We resolved a role to a concrete stage: self-seed the registry, get its id.
      stageId = await shadowUpsertStageRegistry(clientId, role, {
        pipelineId: stageResolved.pipelineId,
        stageId: stageResolved.stageId,
        stageName: stageResolved.stageName,
      });
    } else if (!role && rawStageId) {
      // Raw stage move: best-effort map the GHL stage id back to a seeded role.
      try {
        const rows = await sbRest(
          `pipeline_stages?client_id=eq.${encodeURIComponent(clientId)}` +
          `&ghl_stage_id=eq.${encodeURIComponent(rawStageId)}&select=id,role&limit=1`
        );
        if (rows && rows[0]) { stageId = rows[0].id; stageRole = rows[0].role; }
      } catch (_) { /* leave stage_role untouched */ }
    }

    await shadowUpsertOpportunity(clientId, {
      ghlOpportunityId,
      ghlContactId,
      stageRole,
      stageId,
      status,
      reason,
      ghlPipelineId: pipelineId,
      contactName,
      contactPhone,
      monetaryValue,
      source,
      entryPoint,
      lastStageChangeAt: isMove ? new Date().toISOString() : null,
    });
  } catch (_) { /* best-effort: never block the real GHL write */ }
}

// Board-READ backfill: given the GHL board pipelines.js already fetched (the
// `enriched` array), mirror every OPEN opp that sits in a sales-board role-stage
// into the store and self-seed the registry - all with ZERO extra GHL calls. Gated
// on pipeline_shadow. Stage->role is derived with the SAME ROLE_MATCHERS the finders
// use, so an opp's stage_role here matches what resolveStage would return.
export async function shadowBackfillFromBoard(clientId, { pipelines, shadow } = {}) {
  try {
    let sh = shadow;
    if (typeof sh === "undefined") sh = (await pipelineFlags(clientId)).shadow;
    if (!sh) return;                       // ← dormant gate
    if (!Array.isArray(pipelines)) return;
    // Match each pipeline's stage NAMES to roles; remember which stage id is which
    // role, and seed the registry once per role.
    const roleByStageId = new Map();       // ghl stage id -> { role, pipelineId, stageName, position, rowId }
    for (const p of pipelines) {
      for (const role of Object.keys(ROLE_MATCHERS)) {
        const st = (p.stages || []).find(s => ROLE_MATCHERS[role](s));
        if (st && !roleByStageId.has(st.id)) {
          roleByStageId.set(st.id, { role, pipelineId: p.id, stageName: st.name, position: st.position });
        }
      }
    }
    const seededRowIdByRole = new Map();
    for (const [stId, info] of roleByStageId.entries()) {
      if (seededRowIdByRole.has(info.role)) { info.rowId = seededRowIdByRole.get(info.role); continue; }
      const rid = await shadowUpsertStageRegistry(clientId, info.role, {
        pipelineId: info.pipelineId, stageId: stId, stageName: info.stageName, position: info.position,
      });
      seededRowIdByRole.set(info.role, rid);
      info.rowId = rid;
    }
    for (const p of pipelines) {
      for (const o of (p.opportunities || [])) {
        if (String(o.status || "open").toLowerCase() !== "open") continue;
        const info = roleByStageId.get(o.stageId);
        if (!info) continue;               // not a sales-board role stage; skip
        await shadowUpsertOpportunity(clientId, {
          ghlOpportunityId: o.id,
          ghlContactId: o.contactId || null,
          contactName: (o.contact && o.contact.name) || o.name || null,
          athleteName: o.athlete || null,
          contactPhone: (o.contact && o.contact.phone) || null,
          stageRole: info.role,
          stageId: info.rowId || null,
          status: "open",
          ghlPipelineId: info.pipelineId,
          monetaryValue: o.monetaryValue || 0,
          source: "ghl-import",
          entryPoint: "ghl-import",
          lastStageChangeAt: o.lastStageChangeAt || null,
        });
      }
    }
  } catch (_) { /* best-effort backfill */ }
}

// Read-from-portal board. Assembles the SAME base shape pipelines.js builds from
// GHL (its steps 1-2: pipelines + open opps), but sourced from the store, so
// pipelines.js can run its identical enrichment on top and stay the single shaper.
// Only called when clients.pipeline_provider==='portal'. Returns { pipelines }.
export async function buildPortalBoard(clientId) {
  const stages = (await sbRest(
    `pipeline_stages?client_id=eq.${encodeURIComponent(clientId)}` +
    `&select=id,role,label,position,ghl_pipeline_id,ghl_stage_id,ghl_stage_name&order=position.asc`
  )) || [];
  const opps = (await sbRest(
    `opportunities?client_id=eq.${encodeURIComponent(clientId)}&status=eq.open` +
    `&select=id,ghl_opportunity_id,ghl_contact_id,contact_name,athlete_name,contact_phone,stage_role,status,monetary_value,ghl_pipeline_id,last_stage_change_at,updated_at`
  )) || [];
  const regByRole = new Map();
  for (const s of stages) regByRole.set(s.role, s);
  // Group registry stages into pipelines by ghl_pipeline_id (synthetic 'portal'
  // once GHL is fully off). Pipeline display name is not stored on the registry;
  // 'Training' is the board's canonical name. TODO(P4): store pipeline name/label.
  const pipeMap = new Map();
  for (const s of stages) {
    const pid = s.ghl_pipeline_id || "portal";
    if (!pipeMap.has(pid)) pipeMap.set(pid, { id: pid, name: "Training", stages: [], opportunities: [] });
    pipeMap.get(pid).stages.push({
      id: s.ghl_stage_id || s.id,
      name: s.ghl_stage_name || s.label || s.role,
      position: s.position,
    });
  }
  if (pipeMap.size === 0) pipeMap.set("portal", { id: "portal", name: "Training", stages: [], opportunities: [] });
  for (const o of opps) {
    const reg = regByRole.get(o.stage_role);
    const pid = (reg && reg.ghl_pipeline_id) || o.ghl_pipeline_id || "portal";
    let pipe = pipeMap.get(pid);
    if (!pipe) { pipe = { id: pid, name: "Training", stages: [], opportunities: [] }; pipeMap.set(pid, pipe); }
    pipe.opportunities.push({
      id: o.ghl_opportunity_id || o.id,
      name: o.contact_name || o.athlete_name || "",
      contactId: o.ghl_contact_id || null,
      contact: { name: o.contact_name || "Unknown", email: null, phone: o.contact_phone || null },
      monetaryValue: o.monetary_value || 0,
      status: o.status || "open",
      stageId: (reg && (reg.ghl_stage_id || reg.id)) || null,
      lastStatusChangeAt: null,
      lastStageChangeAt: o.last_stage_change_at || null,
      updatedAt: o.updated_at || null,
    });
  }
  return { pipelines: Array.from(pipeMap.values()) };
}

// ───────────────────────────────────────────────────────────────────────────
// Provider-aware OPPORTUNITY LAYER (Effort E, Task A). PURELY ADDITIVE, DORMANT.
//
// Six functions that wrap every opportunity operation the sales pipeline does
// (create / move / set-status / find-open / list-a-stage / is-in-stage) behind a
// single provider seam. Each reads pipelineFlags(clientId) ONCE, then branches:
//
//   • provider='ghl' (the default for every academy today)  -> do EXACTLY what the
//        call sites do today: the same GHL HTTP calls with the same field shapes,
//        plus shadowMirrorMove when the shadow flag is on. With no flag overrides
//        this path is byte-identical to current production - the whole layer stays
//        dormant until ops flips a client to provider='portal'.
//   • provider='portal'  -> operate on the portal `opportunities` table directly
//        (no GHL call). Only reachable for a client explicitly flipped.
//
// An `oppRef` is the opaque handle threaded between these functions:
//   { ghlOpportunityId }  on GHL    |    { id, ghlOpportunityId? }  on portal.
//
// A `stage` here is the resolveStage() shape { pipelineId, stageId, stageName }
// PLUS the role string (the code contract). GHL branches use pipelineId/stageId;
// portal branches use role (resolving the registry row id via the existing
// shadowUpsertStageRegistry helper, idempotent). Callers already hold both - they
// call resolveStage() to get the stage and know the role they asked for.
//
// DEVIATION FROM THE LITERAL SPEC (documented on purpose): the spec sketched a bare
// `stageId`; this codebase's contract is a resolved-stage object + a role (that is
// what resolveStage returns and what shadowMirrorMove already consumes), so these
// functions take `{ stage, role }` to stay faithful to the existing seam.
//
// GHL branches use the shared ghl() wrapper (throws on non-2xx, like the agent /
// stripe / pipelines call sites - the dominant convention); callers wrap in
// try/catch exactly as they do today. Portal branches let Supabase errors propagate
// (the store is the system-of-record there, so a failed write must not be silently
// swallowed) - callers wrap the same way.
// ───────────────────────────────────────────────────────────────────────────

// Resolve { provider, shadow } once, honoring caller-supplied overrides (e.g. a
// client row already loaded). Only hits Supabase when an override is missing.
async function oppFlags(clientId, opts = {}) {
  let provider = opts.provider, shadow = opts.shadow;
  if (provider == null || shadow == null) {
    const f = await pipelineFlags(clientId);
    if (provider == null) provider = f.provider;
    if (shadow == null) shadow = f.shadow;
  }
  return { provider: provider || "ghl", shadow: !!shadow };
}

// PostgREST filter selecting one portal opportunity row from an oppRef. Prefers the
// portal row id; falls back to the GHL id (a row dual-written while still on GHL).
function oppRefFilter(clientId, oppRef = {}) {
  const base = `opportunities?client_id=eq.${encodeURIComponent(clientId)}`;
  if (oppRef.id) return `${base}&id=eq.${encodeURIComponent(oppRef.id)}`;
  if (oppRef.ghlOpportunityId) return `${base}&ghl_opportunity_id=eq.${encodeURIComponent(oppRef.ghlOpportunityId)}`;
  return null;
}

// The seeded/looked-up pipeline_stages row id for a (client, role). Reuses the
// idempotent registry upsert so a portal move/create always has a stage_id.
async function portalStageRowId(clientId, role, stage) {
  if (!role) return null;
  return shadowUpsertStageRegistry(clientId, role, stage ? {
    pipelineId: stage.pipelineId, stageId: stage.stageId, stageName: stage.stageName,
  } : {});
}

// 1. createOpp - create an opportunity for a contact in a stage. Returns an oppRef.
//   ghl:    POST /opportunities/ (same body shape as api/website/leads.js create) +
//           shadowMirrorMove when shadow on. Returns { ghlOpportunityId }.
//   portal: INSERT one opportunities row (status=open). Returns { id }.
export async function createOpp(opts = {}) {
  const {
    clientId, sb, ghl, token, locationId, contactId, stage, role,
    name, monetaryValue, source, entryPoint, contactName, contactPhone, athleteName,
  } = opts;
  const { provider, shadow } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const stageId = await portalStageRowId(clientId, role, stage);
    // Offer tie-in: a card belongs to the offer whose board it lands on
    // (one pipeline per offer). Callers may pass offerId explicitly;
    // otherwise inherit from the stage row. Lineage is best-effort and
    // never blocks the create.
    let offerId = opts.offerId != null ? opts.offerId : null;
    if (!offerId && stageId) {
      try {
        const srows = await sbRest(`pipeline_stages?id=eq.${stageId}&select=offer_id&limit=1`);
        offerId = (Array.isArray(srows) && srows[0] && srows[0].offer_id) || null;
      } catch (_) { /* best-effort */ }
    }
    const now = new Date().toISOString();
    // Denormalize the contact's phone/name onto the card when the caller didn't
    // pass them (the website booking flow only sends `name`) - otherwise cards
    // render without a number and click-to-call/texting can't work on them.
    let cRow = null;
    if (contactId && (contactPhone == null || contactName == null)) {
      try {
        const crows = await sbRest(`contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(contactId)}&select=id,name,phone&limit=1`);
        cRow = (Array.isArray(crows) && crows[0]) || null;
      } catch (_) { /* best-effort */ }
    }
    const e164 = (p) => {
      const d = String(p || "").replace(/\D/g, "");
      if (String(p || "").startsWith("+")) return p;
      if (d.length === 10) return `+1${d}`;
      if (d.length === 11 && d[0] === "1") return `+${d}`;
      return p || null;
    };
    const body = {
      client_id: clientId,
      ghl_contact_id: contactId || null,
      contact_id: (cRow && cRow.id) || null,
      contact_name: contactName != null ? contactName : (name || (cRow && cRow.name) || null),
      athlete_name: athleteName != null ? athleteName : null,
      contact_phone: contactPhone != null ? contactPhone : (cRow && cRow.phone ? e164(cRow.phone) : null),
      stage_role: role || "responded",
      stage_id: stageId || null,
      offer_id: offerId,
      status: "open",
      source: source != null ? source : null,
      entry_point: entryPoint != null ? entryPoint : null,
      monetary_value: monetaryValue != null ? monetaryValue : 0,
      ghl_pipeline_id: (stage && stage.pipelineId) || null,
      last_stage_change_at: now,
      updated_at: now,
    };
    const rows = await sbRest(`opportunities?select=id,ghl_opportunity_id`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([body]),
    });
    const row = Array.isArray(rows) && rows[0];
    return row ? { id: row.id, ghlOpportunityId: row.ghl_opportunity_id || null } : null;
  }

  // provider === 'ghl': today's create (mirrors api/website/leads.js placeOpportunity).
  const ghlFn = ghl || ghlDefault;
  const oppBody = {
    locationId,
    pipelineId: stage && stage.pipelineId,
    pipelineStageId: stage && stage.stageId,
    contactId,
    name: name || contactName || "",
    status: "open",
  };
  if (monetaryValue != null) oppBody.monetaryValue = monetaryValue;
  const out = await ghlFn("POST", `/opportunities/`, { token, body: oppBody });
  const ghlOpportunityId = (out && out.opportunity && out.opportunity.id) || (out && out.id) || null;
  if (shadow && ghlOpportunityId) {
    try {
      await shadowMirrorMove(clientId, {
        shadow, ghlOpportunityId, ghlContactId: contactId, role,
        stageResolved: stage, status: "open",
        contactName, contactPhone, monetaryValue, source, entryPoint,
      });
    } catch (_) { /* mirror is best-effort */ }
  }
  return { ghlOpportunityId };
}

// KPI event log hook (Track A of KPIs-off-GHL): every move into Scheduled Trial
// = a "trial booked" funnel moment. ALL paths funnel through moveStage (agent
// confirm-book, manual board drag, website booking advance), so this one hook
// covers them. Idempotent per card per month (a same-month re-book is not
// double-counted; a next-month re-book counts again). Best-effort, never blocks.
function kpiTrialBooked(clientId, oppRef, contactId) {
  const oppKey = (oppRef && (oppRef.id || oppRef.ghlOpportunityId)) || null;
  if (!clientId || !oppKey) return Promise.resolve();
  const month = new Date().toISOString().slice(0, 7);
  return recordKpiEvent({
    clientId, step: "trial_booked",
    ghlContactId: contactId || null,
    ref: `trialbook:${oppKey}:${month}`,
    meta: { opp: oppKey },
  });
}

// 2. moveStage - move an opp into a stage.
//   ghl:    PUT /opportunities/{id} { pipelineId, pipelineStageId } + shadow mirror.
//   portal: UPDATE the row's stage_role / stage_id / last_stage_change_at.
export async function moveStage(opts = {}) {
  const { clientId, sb, ghl, token, oppRef = {}, stage, role, contactId, reason } = opts;
  const { provider, shadow } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const filter = oppRefFilter(clientId, oppRef);
    if (!filter) return oppRef;
    const stageId = await portalStageRowId(clientId, role, stage);
    const now = new Date().toISOString();
    const patch = {
      stage_role: role || undefined,
      stage_id: stageId || null,
      ghl_pipeline_id: (stage && stage.pipelineId) || undefined,
      last_stage_change_at: now,
      updated_at: now,
    };
    if (reason != null) patch.reason = reason;
    // return=representation so a 0-row PATCH (missing/mismatched store row) is
    // VISIBLE: log the drift and skip the trial-booked KPI - counting a booking
    // whose card never actually moved corrupted the funnel numbers.
    const hitRows = await sbRest(filter + "&select=id", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    const moved = Array.isArray(hitRows) && hitRows.length > 0;
    if (!moved) console.error(`[moveStage] portal PATCH matched 0 rows - store drift? client=${clientId} oppRef=${JSON.stringify(oppRef)} role=${role || "?"}`);
    if (moved && role === "scheduled_trial") await kpiTrialBooked(clientId, oppRef, contactId);
    return oppRef;
  }

  // provider === 'ghl': today's move PUT (same shape used across the agents + pipelines.js).
  const ghlFn = ghl || ghlDefault;
  const oppId = oppRef.ghlOpportunityId;
  if (oppId) {
    await ghlFn("PUT", `/opportunities/${encodeURIComponent(oppId)}`, {
      token, body: { pipelineId: stage && stage.pipelineId, pipelineStageId: stage && stage.stageId },
    });
    if (shadow) {
      try {
        await shadowMirrorMove(clientId, {
          shadow, ghlOpportunityId: oppId, ghlContactId: contactId, role,
          stageResolved: stage, status: "open", reason: reason != null ? reason : undefined,
        });
      } catch (_) { /* mirror is best-effort */ }
    }
    if (role === "scheduled_trial") await kpiTrialBooked(clientId, oppRef, contactId);
  }
  return oppRef;
}

// 3. setStatus - set the open/won/lost/abandoned lifecycle status (no stage move).
//   ghl:    PUT /opportunities/{id} { status } + shadow mirror.
//   portal: UPDATE status (+ closed_at). Optional role stamps stage_role (e.g. an
//           abandoned -> 'unqualified' close, mirroring api/agent-approvals.js).
export async function setStatus(opts = {}) {
  const { clientId, sb, ghl, token, oppRef = {}, status, role, contactId, reason } = opts;
  const { provider, shadow } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const filter = oppRefFilter(clientId, oppRef);
    if (!filter) return oppRef;
    const now = new Date().toISOString();
    const patch = { status, updated_at: now };
    if (isClosedStatus(status)) patch.closed_at = now;
    else if (status === "open") patch.closed_at = null;   // reopen
    if (role != null) patch.stage_role = role;
    if (reason != null) patch.reason = reason;
    const hitRows = await sbRest(filter + "&select=id", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    if (!Array.isArray(hitRows) || !hitRows.length) console.error(`[setStatus] portal PATCH matched 0 rows - store drift? client=${clientId} oppRef=${JSON.stringify(oppRef)} status=${status}`);
    return oppRef;
  }

  // provider === 'ghl': today's status PUT (api/stripe/webhook.js won, agents lost/abandoned).
  const ghlFn = ghl || ghlDefault;
  const oppId = oppRef.ghlOpportunityId;
  if (oppId) {
    await ghlFn("PUT", `/opportunities/${encodeURIComponent(oppId)}`, { token, body: { status } });
    if (shadow) {
      try {
        await shadowMirrorMove(clientId, {
          shadow, ghlOpportunityId: oppId, ghlContactId: contactId, status,
          stageRole: role != null ? role : undefined, reason: reason != null ? reason : undefined,
        });
      } catch (_) { /* mirror is best-effort */ }
    }
  }
  return oppRef;
}

// 4. findOpenOpp - the single OPEN opp for a contact, or null.
//   ghl:    GET /opportunities/search?contact_id (mirrors api/stripe/webhook.js:
//           prefer the open one, else the first). Returns { ghlOpportunityId }|null.
//   portal: SELECT one open row for the contact. Returns { id, ghlOpportunityId }|null.
export async function findOpenOpp(opts = {}) {
  const { clientId, sb, ghl, token, locationId, contactId } = opts;
  if (!contactId) return null;
  const { provider } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const rows = await sbRest(
      `opportunities?client_id=eq.${encodeURIComponent(clientId)}` +
      `&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open` +
      `&select=id,ghl_opportunity_id&order=created_at.desc&limit=1`
    );
    const row = Array.isArray(rows) && rows[0];
    return row ? { id: row.id, ghlOpportunityId: row.ghl_opportunity_id || null } : null;
  }

  // provider === 'ghl': today's contact search + open pick (api/stripe/webhook.js).
  const ghlFn = ghl || ghlDefault;
  const params = new URLSearchParams({ location_id: locationId, contact_id: contactId, limit: "20" });
  const d = await ghlFn("GET", `/opportunities/search?${params}`, { token });
  const opps = (d && (d.opportunities || d.data)) || [];
  const pick = opps.find(o => String(o.status || "").toLowerCase() === "open") || opps[0] || null;
  return pick ? { ghlOpportunityId: pick.id } : null;
}

// 5. queueOpps - every opp in a stage (or set of stages). Used by the agent queues.
//   ghl:    GET /opportunities/search?pipeline_id&pipeline_stage_id (open only,
//           mirrors api/agent/_stage.js computeQueue's opp half).
//   portal: SELECT open rows by stage_role.
//   Accepts a single { stage, role } or arrays { stages, roles } (positionally
//   paired). Returns [{ contactId, oppRef, status, name, monetaryValue }].
export async function queueOpps(opts = {}) {
  const { clientId, sb, ghl, token, locationId } = opts;
  const stages = opts.stages || (opts.stage ? [opts.stage] : []);
  const roles  = opts.roles  || (opts.role  ? [opts.role]  : []);
  const { provider } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const roleList = roles.length ? roles : stages.map(s => s && s.role).filter(Boolean);
    if (!roleList.length) return [];
    const inList = roleList.map(r => `"${r}"`).join(",");
    const rows = await sbRest(
      `opportunities?client_id=eq.${encodeURIComponent(clientId)}` +
      `&stage_role=in.(${encodeURIComponent(inList)})&status=eq.open` +
      `&select=id,ghl_opportunity_id,ghl_contact_id,contact_name,athlete_name,monetary_value,status`
    ) || [];
    return rows.map(o => ({
      contactId: o.ghl_contact_id || null,
      oppRef: { id: o.id, ghlOpportunityId: o.ghl_opportunity_id || null },
      status: o.status || "open",
      name: o.contact_name || o.athlete_name || "",
      monetaryValue: o.monetary_value || 0,
    }));
  }

  // provider === 'ghl': today's per-stage open-opp search (api/agent/_stage.js).
  const ghlFn = ghl || ghlDefault;
  const out = [];
  for (const stage of stages) {
    if (!stage) continue;
    const params = new URLSearchParams({ location_id: locationId, pipeline_id: stage.pipelineId, pipeline_stage_id: stage.stageId, limit: "100" });
    let opps = [];
    try { const od = await ghlFn("GET", `/opportunities/search?${params}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
    for (const o of opps) {
      if (String((o && o.status) || "open").toLowerCase() !== "open") continue;
      out.push({
        contactId: o.contactId || (o.contact && o.contact.id) || null,
        oppRef: { ghlOpportunityId: o.id },
        status: o.status || "open",
        name: o.name || o.contactName || "",
        monetaryValue: o.monetaryValue || 0,
      });
    }
  }
  return out;
}

// 6. contactInRole - boolean: is this contact's open opp in the given stage?
//   ghl:    GET /opportunities/search?contact_id&pipeline_id then match the stage id
//           (mirrors api/agent/_stage.js contactInRespondedStage).
//   portal: SELECT exists by stage_role.
export async function contactInRole(opts = {}) {
  const { clientId, sb, ghl, token, locationId, contactId, stage, role } = opts;
  if (!contactId) return false;
  const { provider } = await oppFlags(clientId, opts);

  if (provider === "portal") {
    const r = role || (stage && stage.role);
    if (!r) return false;
    const rows = await sbRest(
      `opportunities?client_id=eq.${encodeURIComponent(clientId)}` +
      `&ghl_contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open` +
      `&stage_role=eq.${encodeURIComponent(r)}&select=id&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  // provider === 'ghl': today's contact+pipeline search, match the stage id.
  const ghlFn = ghl || ghlDefault;
  try {
    const params = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: stage && stage.pipelineId, limit: "20" });
    const d = await ghlFn("GET", `/opportunities/search?${params}`, { token });
    const opps = d.opportunities || d.data || [];
    return opps.some(o => (o.pipelineStageId || o.stageId) === (stage && stage.stageId) && String((o && o.status) || "open").toLowerCase() === "open");
  } catch (_) { return false; }
}
