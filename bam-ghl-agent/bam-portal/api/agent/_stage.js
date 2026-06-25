// Shared: locate the Training Pipeline "Responded" stage and check whether a
// contact's opportunity is currently in it. Used by the approval queue, the
// reminder cron, and the inbound-webhook notify hook so the "responded-only"
// rule is defined in exactly one place.
import { ghl } from "../ghl/_core.js";

// The agent only works OPEN opportunities. A won/lost/abandoned deal that's still
// parked in the Responded STAGE must be ignored — gate on status, not just stage.
// Missing status defaults to open (don't drop a valid lead on a sparse payload).
const isOpenOpp = (o) => String((o && o.status) || "open").toLowerCase() === "open";
const openOppContactIds = (opps) => new Set((opps || []).filter(isOpenOpp).map(o => o.contactId || o.contact?.id).filter(Boolean));

export async function respondedStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /respond/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

// The Training Pipeline "Interested" stage — where a lead lands when we send them
// to the Ghosted automation (the workflow then bounces them back to Responded on
// reply, or marks them lost). Same shape as respondedStage.
export async function interestedStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /interest/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

// The Training Pipeline "Scheduled Trial" (a.k.a. "Booked Trial") stage — where a
// lead lands AFTER the booking agent books their trial. This is the CONFIRM agent's
// queue: it confirms attendance, helps them get to the trial, and on "can't make it"
// bounces them back to Responded for the booking agent to rebook. Same shape as
// respondedStage. Anchored on "trial" so a generic "Booking"/"Bookings" stage can't
// match by accident.
export async function scheduledTrialStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /(schedul|book).*trial/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

// The Training Pipeline "Lead Nurture" stage — the long-game home for every
// non-Unqualified Lost lead (Booking / Confirm / Closing) plus leads who ran out
// of the Ghosted sequence. The portal-owned nurture automation (sparse email +
// text, built later) works the leads parked here; any reply bounces them back to
// Booking with context. Same shape as the other stage finders. Anchored on
// /nurtur/i so the academy can name it "Lead Nurture" / "Nurture" / "Lost - Nurture".
// Returns null until the academy creates the stage in GHL — callers must handle
// that (the routing stays dormant rather than erroring).
export async function nurtureStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /nurtur/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

export async function contactInRespondedStage(token, locationId, contactId, rs) {
  try {
    const params = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: rs.pipelineId, limit: "20" });
    const d = await ghl("GET", `/opportunities/search?${params}`, { token });
    const opps = d.opportunities || d.data || [];
    return opps.some(o => (o.pipelineStageId || o.stageId) === rs.stageId && isOpenOpp(o));
  } catch (_) { return false; }
}

// GHL returns lastMessageDate as a Unix epoch in MILLISECONDS (e.g. 1782158616605),
// which Postgres can't store in a timestamptz column. Normalize to ISO.
export function toIso(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : (/^\d{10,}$/.test(String(v).trim()) ? Number(v) : null);
  const d = n != null ? new Date(n) : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// The queue for one academy: Responded-stage contacts whose last message is inbound.
export async function computeQueue(token, locationId) {
  const rs = await respondedStage(token, locationId);
  if (!rs) return { rs: null, queue: [] };
  const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: rs.pipelineId, pipeline_stage_id: rs.stageId, limit: "100" });
  let opps = [];
  try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
  const respondedContactIds = openOppContactIds(opps);
  const cd = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
  const convos = cd.conversations || cd.data || [];
  const queue = convos
    .filter(c => respondedContactIds.has(c.contactId) && String(c.lastMessageDirection || "").toLowerCase() === "inbound")
    .map(c => ({ contact_id: c.contactId, conversation_id: c.id, name: c.fullName || c.contactName || "Unknown", last_message: c.lastMessageBody || "", last_at: toIso(c.lastMessageDate || c.dateUpdated) }))
    .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
  return { rs, queue, respondedIds: respondedContactIds };
}

// Just the set of contact ids currently in the Responded stage (any message
// direction). Used to gate the follow-up engine + prune stale drafts.
export async function respondedContactIds(token, locationId) {
  const rs = await respondedStage(token, locationId);
  if (!rs) return { rs: null, ids: new Set() };
  const params = new URLSearchParams({ location_id: locationId, pipeline_id: rs.pipelineId, pipeline_stage_id: rs.stageId, limit: "100" });
  let opps = [];
  try { const od = await ghl("GET", `/opportunities/search?${params}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
  return { rs, ids: openOppContactIds(opps) };
}

// Read-time gate for Hawkeye's queues (Ready messages + Follow-ups). The detector
// cron prunes stale drafts when a lead leaves Responded, but that lag lets a card
// linger; this lets the LIST endpoints hide those rows immediately. Unlike
// respondedContactIds() above, this THROWS on a GHL failure (and returns null when
// there's no Responded stage) so callers can fail OPEN — showing a possibly-stale
// card beats an empty inbox when GHL is down. Returns a Set of contact ids, or null
// if the academy has no Responded stage (cannot gate).
export async function respondedContactIdSet(token, locationId) {
  const rs = await respondedStage(token, locationId);   // throws on GHL error
  if (!rs) return null;                                  // no stage → cannot gate
  const params = new URLSearchParams({ location_id: locationId, pipeline_id: rs.pipelineId, pipeline_stage_id: rs.stageId, limit: "100" });
  const od = await ghl("GET", `/opportunities/search?${params}`, { token });  // throws on GHL error
  return openOppContactIds(od.opportunities || od.data || []);
}

// Cached wrapper, keyed by location, so the inbox's frequent count refresh doesn't
// hit GHL on every call. Warm serverless instances reuse the set for `ttlMs`; a cold
// start just re-fetches. Throws propagate so callers fail open.
const _ridCache = new Map();   // locationId -> { at, ids }

// Peek the cache WITHOUT a GHL token — lets a hot read path (list-ready, the inbox's
// frequent count refresh) skip the token fetch entirely on a cache hit. Returns the
// cached Set, or undefined when there's no fresh entry (caller must then fill).
export function peekRespondedIdSet(locationId, ttlMs = 60000) {
  const hit = _ridCache.get(locationId);
  return (hit && (Date.now() - hit.at) < ttlMs) ? hit.ids : undefined;
}

export async function respondedContactIdSetCached(token, locationId, ttlMs = 60000) {
  const hit = peekRespondedIdSet(locationId, ttlMs);
  if (hit !== undefined) return hit;
  const ids = await respondedContactIdSet(token, locationId);
  _ridCache.set(locationId, { at: Date.now(), ids });
  return ids;
}

// ── CONFIRM AGENT (Scheduled-Trial stage) ───────────────────────────────────
// Mirrors the Responded helpers above, for the confirm agent's queue.

// The confirm queue for one academy: ALL open opps in the Scheduled-Trial stage,
// each tagged with its last message + direction so the detector can branch —
// inbound last → draft a live reply; no agent message yet → draft an opening
// confirmation; agent already waiting on a reply → skip. (Unlike the booking
// computeQueue, this is NOT inbound-only: confirming attendance is proactive.)
export async function computeConfirmQueue(token, locationId) {
  const sts = await scheduledTrialStage(token, locationId);
  if (!sts) return { sts: null, queue: [] };
  const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: sts.pipelineId, pipeline_stage_id: sts.stageId, limit: "100" });
  let opps = [];
  try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
  const ids = openOppContactIds(opps);
  const cd = await ghl("GET", `/conversations/search?${new URLSearchParams({ locationId, limit: "100" })}`, { token });
  const convos = cd.conversations || cd.data || [];
  const queue = convos
    .filter(c => ids.has(c.contactId))
    .map(c => ({
      contact_id: c.contactId,
      conversation_id: c.id,
      name: c.fullName || c.contactName || "Unknown",
      last_message: c.lastMessageBody || "",
      last_direction: String(c.lastMessageDirection || "").toLowerCase(),
      last_at: toIso(c.lastMessageDate || c.dateUpdated),
    }))
    .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
  return { sts, queue, scheduledIds: ids };
}

// Throws on GHL failure (callers fail open), null when there's no Scheduled-Trial
// stage. The read-time gate for the confirm queue + send guard.
export async function scheduledTrialContactIdSet(token, locationId) {
  const sts = await scheduledTrialStage(token, locationId);   // throws on GHL error
  if (!sts) return null;                                       // no stage → cannot gate
  const params = new URLSearchParams({ location_id: locationId, pipeline_id: sts.pipelineId, pipeline_stage_id: sts.stageId, limit: "100" });
  const od = await ghl("GET", `/opportunities/search?${params}`, { token });  // throws on GHL error
  return openOppContactIds(od.opportunities || od.data || []);
}

const _stsCache = new Map();   // locationId -> { at, ids }

export function peekScheduledTrialIdSet(locationId, ttlMs = 60000) {
  const hit = _stsCache.get(locationId);
  return (hit && (Date.now() - hit.at) < ttlMs) ? hit.ids : undefined;
}

export async function scheduledTrialContactIdSetCached(token, locationId, ttlMs = 60000) {
  const hit = peekScheduledTrialIdSet(locationId, ttlMs);
  if (hit !== undefined) return hit;
  const ids = await scheduledTrialContactIdSet(token, locationId);
  _stsCache.set(locationId, { at: Date.now(), ids });
  return ids;
}
