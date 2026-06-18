// POST /api/coachiq/user-created
// Inbound callback fired by CoachIQ's "New User → Send to External Webhook" automation
// (self-signup model): when a parent signs up on the academy's CoachIQ group login
// page, CoachIQ posts the new user here. We match them to the paid member (by email,
// or member_id if present), store the CoachIQ user id, and grant the product
// (= product + program access + starter credits — they already paid in the portal).
//
// Secret-gated via COACHIQ_WEBHOOK_SECRET (body.secret | ?secret= | x-coachiq-secret).
//
// Accepted (tolerant — map whatever CoachIQ's webhook sends):
//   coachiq_user_id : b.coachiq_user_id | b.id | b.userId | b.user.id   (required)
//   email           : b.email | b.user.email | b.parent_email           (match key)
//   member_id       : b.member_id                                        (optional exact match)
//   grant_product   : default true
//
// Returns: { ok, member_id, coachiq_user_id, matched_by, product } or { ok:false, error }

import { withSentryApiRoute } from "../_sentry.js";
import { addCoachiqProduct, coachiqConfig } from "../coachiq.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });
  if (!SB_URL || !SB_KEY)    return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const b = req.body || {};
  const secret = b.secret || req.query?.secret || req.headers["x-coachiq-secret"];
  const expected = coachiqConfig().webhookSecret;
  if (!expected || secret !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const coachiqUserId = b.coachiq_user_id || b.id || b.userId || b.user?.id;
  const email = (b.email || b.user?.email || b.parent_email || "").trim().toLowerCase();
  const memberId = b.member_id && UUID_RE.test(b.member_id) ? b.member_id : null;
  const grantProduct = b.grant_product !== false;
  if (!coachiqUserId) return res.status(400).json({ ok: false, error: "coachiq_user_id (or id/userId/user.id) required" });
  if (!memberId && !email) return res.status(400).json({ ok: false, error: "member_id or email required to match a member" });

  // Find the member: exact id if given, else most-recent member with that email.
  let member, matchedBy;
  try {
    if (memberId) {
      const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&select=id,plan,parent_email,coachiq_member_id&limit=1`);
      member = Array.isArray(rows) && rows[0]; matchedBy = "member_id";
    } else {
      const rows = await sb(`members?parent_email=eq.${encodeURIComponent(email)}&select=id,plan,parent_email,coachiq_member_id&order=created_at.desc&limit=1`);
      member = Array.isArray(rows) && rows[0]; matchedBy = "email";
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: `member lookup failed: ${e.message}` });
  }
  // No matching paid member (e.g. a signup unrelated to our funnel) → accept + skip.
  if (!member) {
    return res.status(200).json({ ok: true, matched_by: matchedBy, skipped: "no matching member for this signup", email });
  }

  // Already linked to this exact id → idempotent no-op (automation retry).
  const alreadyLinked = member.coachiq_member_id === coachiqUserId;

  // Store the id on every member sharing this parent_email (siblings share the
  // parent's CoachIQ user) that doesn't already have one.
  try {
    await sb(`members?parent_email=eq.${encodeURIComponent(member.parent_email)}&coachiq_member_id=is.null`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ coachiq_member_id: coachiqUserId }),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `failed to store coachiq id: ${e.message}` });
  }

  // Grant the product once (skip if this was already a linked retry).
  let product = { skipped: alreadyLinked ? "already linked (retry)" : "grant_product=false" };
  if (grantProduct && !alreadyLinked) {
    try {
      product = await addCoachiqProduct(coachiqUserId, { plan: b.plan || member.plan, term: b.term, source: "self-signup" });
    } catch (e) {
      product = { ok: false, error: String(e && e.message || e) };
    }
  }

  return res.status(200).json({ ok: true, member_id: member.id, coachiq_user_id: coachiqUserId, matched_by: matchedBy, product });
}

export default withSentryApiRoute(handler);
