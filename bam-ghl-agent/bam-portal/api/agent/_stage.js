// Shared: locate the Training Pipeline "Responded" stage and check whether a
// contact's opportunity is currently in it. Used by the approval queue, the
// reminder cron, and the inbound-webhook notify hook so the "responded-only"
// rule is defined in exactly one place.
import { ghl } from "../ghl/_core.js";

export async function respondedStage(token, locationId) {
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => /respond/i.test(s.name || ""));
  return stage ? { pipelineId: pipe.id, stageId: stage.id, stageName: stage.name } : null;
}

export async function contactInRespondedStage(token, locationId, contactId, rs) {
  try {
    const params = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: rs.pipelineId, limit: "20" });
    const d = await ghl("GET", `/opportunities/search?${params}`, { token });
    const opps = d.opportunities || d.data || [];
    return opps.some(o => (o.pipelineStageId || o.stageId) === rs.stageId);
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
  const respondedContactIds = new Set(opps.map(o => o.contactId || o.contact?.id).filter(Boolean));
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
  return { rs, ids: new Set(opps.map(o => o.contactId || o.contact?.id).filter(Boolean)) };
}
