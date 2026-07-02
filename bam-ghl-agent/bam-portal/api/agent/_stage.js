// Shared: locate the Training Pipeline "Responded" stage and check whether a
// contact's opportunity is currently in it. Used by the approval queue, the
// reminder cron, and the inbound-webhook notify hook so the "responded-only"
// rule is defined in exactly one place.
import { ghl } from "../ghl/_core.js";
import { resolveStage, queueOpps, contactInRole, pipelineFlags } from "./_store.js";

// Provider-aware opp-membership lookup for a stage. Returns a Set of contact ids
// for the OPEN opps in `stage` (role `role`) when the academy is flipped to
// provider='portal' - sourced from the portal store via queueOpps, ZERO GHL calls.
// Returns null to mean "not portal-routed, use the live-GHL search below". Only
// engages when a ctx carrying { clientId, sb } is threaded in; with no ctx (every
// caller today) it returns null immediately, so the GHL path stays byte-identical.
// Reuses pipelineFlags' dormant-on-error default: any flag-read blip -> GHL path.
async function portalStageContactIds(stage, role, ctx) {
  if (!ctx || !ctx.clientId || !stage) return null;
  let provider = "ghl";
  try { provider = (await pipelineFlags(ctx.clientId)).provider; } catch (_) { provider = "ghl"; }
  if (provider !== "portal") return null;
  const rows = await queueOpps({ clientId: ctx.clientId, sb: ctx.sb, stage: { ...stage, role }, role });
  return new Set(rows.map(r => r.contactId).filter(Boolean));
}

// The agent only works OPEN opportunities. A won/lost/abandoned deal that's still
// parked in the Responded STAGE must be ignored — gate on status, not just stage.
// Missing status defaults to open (don't drop a valid lead on a sparse payload).
const isOpenOpp = (o) => String((o && o.status) || "open").toLowerCase() === "open";
const openOppContactIds = (opps) => new Set((opps || []).filter(isOpenOpp).map(o => o.contactId || o.contact?.id).filter(Boolean));

// Delegates through the pipeline-store seam (_store.js). Optional ctx carries
// { sb, clientId } for the future portal-read path; no current caller passes it,
// so the seam takes the live-GHL /respond/i regex fallback - byte-identical to
// the pre-seam body. Same { pipelineId, stageId, stageName } | null shape, and
// GHL errors still throw.
export async function respondedStage(token, locationId, ctx = {}) {
  return resolveStage(ctx.sb, ghl, { clientId: ctx.clientId, token, locationId, role: "responded" });
}

// The Training Pipeline "Interested" stage — where a lead lands when we send them
// to the Ghosted automation (the workflow then bounces them back to Responded on
// reply, or marks them lost). Same shape as respondedStage.
export async function interestedStage(token, locationId, ctx = {}) {
  return resolveStage(ctx.sb, ghl, { clientId: ctx.clientId, token, locationId, role: "interested" });
}

// The Training Pipeline "Scheduled Trial" (a.k.a. "Booked Trial") stage — where a
// lead lands AFTER the booking agent books their trial. This is the CONFIRM agent's
// queue: it confirms attendance, helps them get to the trial, and on "can't make it"
// bounces them back to Responded for the booking agent to rebook. Same shape as
// respondedStage. Anchored on "trial" so a generic "Booking"/"Bookings" stage can't
// match by accident.
export async function scheduledTrialStage(token, locationId, ctx = {}) {
  return resolveStage(ctx.sb, ghl, { clientId: ctx.clientId, token, locationId, role: "scheduled_trial" });
}

// The Training Pipeline "Lead Nurture" stage — the long-game home for every
// non-Unqualified Lost lead (Booking / Confirm / Closing) plus leads who ran out
// of the Ghosted sequence. The portal-owned nurture automation (sparse email +
// text, built later) works the leads parked here; any reply bounces them back to
// Booking with context. Same shape as the other stage finders. Anchored on
// /nurtur/i so the academy can name it "Lead Nurture" / "Nurture" / "Lost - Nurture".
// Returns null until the academy creates the stage in GHL — callers must handle
// that (the routing stays dormant rather than erroring).
export async function nurtureStage(token, locationId, ctx = {}) {
  return resolveStage(ctx.sb, ghl, { clientId: ctx.clientId, token, locationId, role: "nurture" });
}

export async function contactInRespondedStage(token, locationId, contactId, rs, ctx = {}) {
  // Portal route: delegate the membership check to the store. Engages only when a
  // ctx { clientId, sb } is threaded in AND the academy is on provider='portal'.
  if (ctx && ctx.clientId) {
    let provider = "ghl";
    try { provider = (await pipelineFlags(ctx.clientId)).provider; } catch (_) { provider = "ghl"; }
    if (provider === "portal") {
      return contactInRole({ clientId: ctx.clientId, sb: ctx.sb, contactId, stage: { ...rs, role: "responded" }, role: "responded" });
    }
  }
  // GHL route - byte-identical to the pre-seam body.
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
// Optional trailing ctx { clientId, sb } routes the opp-MEMBERSHIP half (which
// contacts sit in the Responded stage) through the portal store on provider='portal';
// the /conversations/search last-message join is LEFT AS-IS (messaging is a separate
// effort). With no ctx (every caller today) this is byte-identical to before.
export async function computeQueue(token, locationId, ctx = {}) {
  const rs = await respondedStage(token, locationId, ctx);
  if (!rs) return { rs: null, queue: [] };
  let respondedContactIds = await portalStageContactIds(rs, "responded", ctx);
  if (respondedContactIds === null) {
    const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: rs.pipelineId, pipeline_stage_id: rs.stageId, limit: "100" });
    let opps = [];
    try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
    respondedContactIds = openOppContactIds(opps);
  }
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
export async function respondedContactIds(token, locationId, ctx = {}) {
  const rs = await respondedStage(token, locationId, ctx);
  if (!rs) return { rs: null, ids: new Set() };
  const portalIds = await portalStageContactIds(rs, "responded", ctx);
  if (portalIds !== null) return { rs, ids: portalIds };
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
export async function respondedContactIdSet(token, locationId, ctx = {}) {
  const rs = await respondedStage(token, locationId, ctx);   // throws on GHL error
  if (!rs) return null;                                  // no stage → cannot gate
  const portalIds = await portalStageContactIds(rs, "responded", ctx);  // store read; throws -> caller fails open
  if (portalIds !== null) return portalIds;
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

export async function respondedContactIdSetCached(token, locationId, ttlMs = 60000, ctx = {}) {
  const hit = peekRespondedIdSet(locationId, ttlMs);
  if (hit !== undefined) return hit;
  const ids = await respondedContactIdSet(token, locationId, ctx);
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
export async function computeConfirmQueue(token, locationId, ctx = {}) {
  const sts = await scheduledTrialStage(token, locationId, ctx);
  if (!sts) return { sts: null, queue: [] };
  let ids = await portalStageContactIds(sts, "scheduled_trial", ctx);
  if (ids === null) {
    const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: sts.pipelineId, pipeline_stage_id: sts.stageId, limit: "100" });
    let opps = [];
    try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
    ids = openOppContactIds(opps);
  }
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
  // Stage contacts with NO conversation yet (booked a trial straight off the
  // calendar; nobody has texted them) were previously INVISIBLE here - the
  // queue was conversation-seeded, so they never got the scripted booking
  // confirmation (or any touch at all). Append them as bare proactive items:
  // the scripted step opens the thread, and the send itself creates the GHL
  // conversation. They sit at the back so recently-active threads keep
  // priority under the detector's per-run cap.
  const _inQueue = new Set(queue.map(q => q.contact_id));
  for (const id of ids) {
    if (!_inQueue.has(id)) queue.push({ contact_id: id, conversation_id: null, name: null, last_message: "", last_direction: "", last_at: null });
  }
  return { sts, queue, scheduledIds: ids };
}

// Throws on GHL failure (callers fail open), null when there's no Scheduled-Trial
// stage. The read-time gate for the confirm queue + send guard.
export async function scheduledTrialContactIdSet(token, locationId, ctx = {}) {
  const sts = await scheduledTrialStage(token, locationId, ctx);   // throws on GHL error
  if (!sts) return null;                                       // no stage → cannot gate
  const portalIds = await portalStageContactIds(sts, "scheduled_trial", ctx);
  if (portalIds !== null) return portalIds;
  const params = new URLSearchParams({ location_id: locationId, pipeline_id: sts.pipelineId, pipeline_stage_id: sts.stageId, limit: "100" });
  const od = await ghl("GET", `/opportunities/search?${params}`, { token });  // throws on GHL error
  return openOppContactIds(od.opportunities || od.data || []);
}

const _stsCache = new Map();   // locationId -> { at, ids }

export function peekScheduledTrialIdSet(locationId, ttlMs = 60000) {
  const hit = _stsCache.get(locationId);
  return (hit && (Date.now() - hit.at) < ttlMs) ? hit.ids : undefined;
}

export async function scheduledTrialContactIdSetCached(token, locationId, ttlMs = 60000, ctx = {}) {
  const hit = peekScheduledTrialIdSet(locationId, ttlMs);
  if (hit !== undefined) return hit;
  const ids = await scheduledTrialContactIdSet(token, locationId, ctx);
  _stsCache.set(locationId, { at: Date.now(), ids });
  return ids;
}

// ── CLOSING AGENT (Done-Trial stage) ─────────────────────────────────────────
// Mirrors the Scheduled-Trial helpers above, for the closing agent's queue. The
// closing agent works leads who ATTENDED a good-fit trial (the post-trial form
// moved them here) and converts them into paying members.

// The Training Pipeline "Done Trial" (a.k.a. "Attended" / "Trial Complete") stage —
// where a lead lands AFTER the coach's post-trial form marks them showed-up + good
// fit. Anchored on "trial" + (done|complete|attend) so it can't match the
// Scheduled-Trial stage by accident. Same {pipelineId, stageId, stageName} shape.
export async function doneTrialStage(token, locationId, ctx = {}) {
  return resolveStage(ctx.sb, ghl, { clientId: ctx.clientId, token, locationId, role: "done_trial" });
}

// The closing queue for one academy: ALL open opps in the Done-Trial stage, each
// tagged with its last message + direction so the detector can branch — inbound
// last → draft a live reply; no agent message yet → draft a post-trial opener;
// agent already waiting on a reply → skip. (Like the confirm queue, NOT inbound-only:
// the post-trial follow-up is proactive.)
export async function computeClosingQueue(token, locationId, ctx = {}) {
  const dts = await doneTrialStage(token, locationId, ctx);
  if (!dts) return { dts: null, queue: [] };
  let ids = await portalStageContactIds(dts, "done_trial", ctx);
  if (ids === null) {
    const oppParams = new URLSearchParams({ location_id: locationId, pipeline_id: dts.pipelineId, pipeline_stage_id: dts.stageId, limit: "100" });
    let opps = [];
    try { const od = await ghl("GET", `/opportunities/search?${oppParams}`, { token }); opps = od.opportunities || od.data || []; } catch (_) {}
    ids = openOppContactIds(opps);
  }
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
  return { dts, queue, doneIds: ids };
}

// Throws on GHL failure (callers fail open), null when there's no Done-Trial stage.
// The read-time gate for the closing queue + send guard.
export async function doneTrialContactIdSet(token, locationId, ctx = {}) {
  const dts = await doneTrialStage(token, locationId, ctx);   // throws on GHL error
  if (!dts) return null;                                  // no stage → cannot gate
  const portalIds = await portalStageContactIds(dts, "done_trial", ctx);
  if (portalIds !== null) return portalIds;
  const params = new URLSearchParams({ location_id: locationId, pipeline_id: dts.pipelineId, pipeline_stage_id: dts.stageId, limit: "100" });
  const od = await ghl("GET", `/opportunities/search?${params}`, { token });  // throws on GHL error
  return openOppContactIds(od.opportunities || od.data || []);
}

const _dtsClosingCache = new Map();   // locationId -> { at, ids }

export function peekDoneTrialIdSet(locationId, ttlMs = 60000) {
  const hit = _dtsClosingCache.get(locationId);
  return (hit && (Date.now() - hit.at) < ttlMs) ? hit.ids : undefined;
}

export async function doneTrialContactIdSetCached(token, locationId, ttlMs = 60000, ctx = {}) {
  const hit = peekDoneTrialIdSet(locationId, ttlMs);
  if (hit !== undefined) return hit;
  const ids = await doneTrialContactIdSet(token, locationId, ctx);
  _dtsClosingCache.set(locationId, { at: Date.now(), ids });
  return ids;
}
