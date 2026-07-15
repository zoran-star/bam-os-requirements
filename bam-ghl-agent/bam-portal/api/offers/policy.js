import { withSentryApiRoute } from "../_sentry.js";
import { buildClauses } from "../_lib/agreement-pdf.js";

// Offer Policy section ⇄ downstream consumers.
//
//   GET  /api/offers/policy?action=preview&client_id=<uuid>&offer_id=<uuid>
//     → { ok, academyName, clauses:[[title,body],...] }
//        The exact enrollment-agreement clauses generated from offer.data.policy
//        (same buildClauses() the signed PDF uses at checkout). Lets an owner see
//        the real doc without a test enrollment.
//
//   POST /api/offers/policy?action=push-agent   body { client_id, offer_id, agent? }
//     → { ok, body }
//        Generates the sales agent's "policies" fact-section text from the same
//        rules and upserts it as the academy's per-agent override
//        (agent_prompt_sections, section_key "policies"). User-triggered so the
//        live agent never changes silently.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of
// client_id. Writes run with the service role (RLS write is staff-only), gated
// behind that check.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function nowIso() { return new Date().toISOString(); }

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
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

// offer.data.policy → the agent's "policies" fact-section text. Mirrors the
// same rules buildClauses() uses for clause 6, phrased as agent-readable facts.
function policyToAgentText(policy) {
  const p = policy || {};
  const lines = [];

  const amt = Number(p.cancel_notice_amount);
  if (p.cancellation === "Notice required" && amt > 0) {
    const unit = p.cancel_notice_unit === "hours" ? "hours" : "days";
    const u = amt === 1 ? unit.replace(/s$/, "") : unit;
    lines.push(`Cancellation: ${amt} ${u} written notice is required before the next billing date.`);
  } else {
    lines.push(`Cancellation: members can cancel anytime; notice stops the next charge.`);
  }

  if (p.pause_allowed === "Yes") {
    const mn = Number(p.pause_min_days), mx = Number(p.pause_max_days), per = Number(p.pause_per_year);
    let len;
    if (mn > 0 && mx > 0 && mn < mx) len = `${mn} to ${mx} days at a time`;
    else if (mx > 0) len = `up to ${mx} days at a time`;
    else len = "flexible length";
    const freq = per === 1 ? ", once per year" : per === 2 ? ", twice per year" : per > 0 ? `, ${per} times per year` : "";
    lines.push(`Pause: memberships can be paused (${len}${freq}).`);
  } else if (p.pause_allowed === "No") {
    lines.push(`Pause: memberships cannot be paused.`);
  }

  const rw = Number(p.refund_window_days);
  if (p.refund_policy === "Refundable within a window" && rw > 0) {
    lines.push(`Refunds: fees are refundable within ${rw} days of purchase, otherwise non-refundable except where required by law.`);
  } else {
    lines.push(`Refunds: fees already charged are non-refundable except where required by law.`);
  }

  if (p.makeup_policy && String(p.makeup_policy).trim()) {
    lines.push(`Makeup/reschedule: ${String(p.makeup_policy).trim()}`);
  }

  // Session-day facts parents ask about constantly (policy extras, 2026-07-14).
  if (p.parent_watching) lines.push(`Parents watching: ${p.parent_watching}.`);
  if (p.under_18) lines.push(`Under-18s: ${p.under_18}.`);
  if (p.holiday_schedule) lines.push(`Holidays: ${p.holiday_schedule}.`);

  return lines.join("\n");
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    const offerId  = q.offer_id  || b.offer_id;
    const action   = q.action    || b.action || (req.method === "GET" ? "preview" : "");
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });

    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) {
      return res.status(403).json({ error: "not authorized for this academy" });
    }

    // Offer must belong to this academy.
    const offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,title,data&limit=1`);
    const offer = Array.isArray(offerRows) && offerRows[0];
    if (!offer) return res.status(404).json({ error: "offer not found for this academy" });
    const policy = (offer.data && offer.data.policy) || {};

    if (action === "preview") {
      const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name,email&limit=1`);
      const client = (Array.isArray(clientRows) && clientRows[0]) || {};
      const clauses = buildClauses({
        academyName: client.business_name || "By Any Means",
        cancelContact: client.email || "",
        policy,
      });
      return res.status(200).json({ ok: true, academyName: client.business_name || "By Any Means", clauses });
    }

    if (action === "push-agent") {
      const agent = b.agent || "booking";
      const body = policyToAgentText(policy);
      await sb(`agent_prompt_sections?on_conflict=client_id,section_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          client_id: clientId, section_key: "policies", body,
          offer_id: offerId, updated_by: "policy-sync", updated_at: nowIso(),
        }]),
      });
      return res.status(200).json({ ok: true, agent, body });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "error" });
  }
}

export default withSentryApiRoute(handler);
