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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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
  interested:      (s) => /interest/i.test(s.name || ""),
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
async function resolveFromRegistry(sb, clientId, role) {
  const sbGet = typeof sb === "function" ? sb : defaultSbGet;
  const clientRows = await sbGet(`clients?id=eq.${encodeURIComponent(clientId)}&select=pipeline_provider&limit=1`);
  const provider = clientRows && clientRows[0] && clientRows[0].pipeline_provider;
  if (provider !== "portal") return null;
  const rows = await sbGet(
    `pipeline_stages?client_id=eq.${encodeURIComponent(clientId)}&role=eq.${encodeURIComponent(role)}` +
    `&select=ghl_pipeline_id,ghl_stage_id,ghl_stage_name&limit=1`
  );
  const row = rows && rows[0];
  if (!row || !row.ghl_stage_id) return null;
  return { pipelineId: row.ghl_pipeline_id || null, stageId: row.ghl_stage_id, stageName: row.ghl_stage_name || null };
}

// The seam. Same return contract as the _stage.js finders: { pipelineId,
// stageId, stageName } or null, and GHL errors propagate.
export async function resolveStage(sb, ghl, { clientId, token, locationId, role } = {}) {
  const ghlFn = ghl || ghlDefault;
  // Registry path is only attempted when a clientId is threaded in. No current
  // finder call site passes one, so today this branch never runs and resolveStage
  // is byte-identical to the old regex finders. A registry miss/error also falls
  // through to live GHL, never breaking an existing path.
  if (clientId) {
    try {
      const fromRegistry = await resolveFromRegistry(sb, clientId, role);
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
async function sbRest(path, init = {}) {
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
