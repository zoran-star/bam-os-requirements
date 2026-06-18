// POST /api/coachiq/user-created
// Inbound callback from the Zapier "Create User" Zap (its final step POSTs here).
// Stores the new CoachIQ user id on the member, then grants the product (which also
// gives program access + starter credits — no payment, they already paid in portal).
//
// Body: { member_id, coachiq_user_id, secret?, plan?, term? }
//   - member_id        : the members.id we sent in createCoachiqUser's payload
//   - coachiq_user_id  : the CoachIQ user id the Zap created (the join key for credits)
//   - secret           : must match COACHIQ_WEBHOOK_SECRET (guards this open endpoint)
//   - plan/term        : optional override; otherwise read from the member row
//
// Returns: { ok, member_id, coachiq_user_id, product } or { ok:false, error }
//
// Idempotent: if the member already has this coachiq id we still (re)grant the product
// only when grant_product !== false, so a Zap retry won't double-create.

import { withSentryApiRoute } from "../_sentry.js";
import { addCoachiqProduct, coachiqConfig } from "../coachiq.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });
  if (!SB_URL || !SB_KEY)    return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const b = req.body || {};
  const secret = b.secret || req.headers["x-coachiq-secret"];
  const expected = coachiqConfig().webhookSecret;
  if (!expected || secret !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const memberId      = b.member_id;
  const coachiqUserId = b.coachiq_user_id || b.id || b.userId;
  const grantProduct  = b.grant_product !== false;
  if (!memberId || !coachiqUserId) {
    return res.status(400).json({ ok: false, error: "member_id and coachiq_user_id required" });
  }

  // Load the member for plan/term (and to confirm it exists).
  let member;
  try {
    const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&select=id,plan,coachiq_member_id&limit=1`);
    member = Array.isArray(rows) && rows[0];
  } catch (e) {
    return res.status(500).json({ ok: false, error: `member lookup failed: ${e.message}` });
  }
  if (!member) return res.status(404).json({ ok: false, error: "member not found" });

  // Store the CoachIQ user id (the join key for all future credit/product calls).
  try {
    await sb(`members?id=eq.${encodeURIComponent(memberId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ coachiq_member_id: coachiqUserId }),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `failed to store coachiq id: ${e.message}` });
  }

  // Grant the product (+ access + starter credits). Non-fatal: the id is already
  // stored, so a product failure can be retried without re-creating the user.
  let product = { skipped: "grant_product=false" };
  if (grantProduct) {
    const plan = b.plan || member.plan || null;
    const term = b.term || null;
    try {
      product = await addCoachiqProduct(coachiqUserId, { plan, term, source: "website-enrollment" });
    } catch (e) {
      product = { ok: false, error: String(e && e.message || e) };
    }
  }

  return res.status(200).json({ ok: true, member_id: memberId, coachiq_user_id: coachiqUserId, product });
}

export default withSentryApiRoute(handler);
