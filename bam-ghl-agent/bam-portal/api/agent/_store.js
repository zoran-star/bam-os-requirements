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
