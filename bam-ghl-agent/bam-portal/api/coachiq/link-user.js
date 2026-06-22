// POST /api/coachiq/link-user
// Bulk-LINK an existing CoachIQ user id to a member — for the import "listening session".
// Fired by a CoachIQ automation: trigger "Tag added" → Send to External Webhook here.
// Unlike /user-created, this NEVER grants a product (these are existing members already
// running in CoachIQ) — it only stamps coachiq_member_id by matching on email.
//
// Matches (by email, case-insensitive), stamping coachiq_member_id where it's null:
//   1. members_staging rows  (so an in-progress import gets linked, carried by promote)
//   2. live members rows
// Records every hit/miss in coachiq_link_events so the UI can show check-offs + flag
// webhooks whose email isn't in the table.
//
// Secret-gated: COACHIQ_WEBHOOK_SECRET (body.secret | ?secret= | x-coachiq-secret).
// Body (tolerant): coachiq_user_id | id | userId | user.id ; email | user.email ; tag?
//
// Returns: { ok, coachiq_user_id, email, matched, staging_linked, members_linked }

import { withSentryApiRoute } from "../_sentry.js";
import { coachiqConfig } from "../coachiq.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });
  if (!SB_URL || !SB_KEY)    return res.status(500).json({ ok: false, error: "Supabase not configured" });

  const b = req.body || {};
  const secret = b.secret || req.query?.secret || req.headers["x-coachiq-secret"];
  const expected = coachiqConfig().webhookSecret;
  if (!expected || secret !== expected) return res.status(401).json({ ok: false, error: "unauthorized" });

  const coachiqUserId = b.coachiq_user_id || b.id || b.userId || b.user?.id;
  const email = (b.email || b.user?.email || b.parent_email || "").trim().toLowerCase();
  if (!coachiqUserId || !email) return res.status(400).json({ ok: false, error: "coachiq_user_id and email required" });

  // 1) staging rows (in-progress imports) without a coachiq id
  let stagingLinked = 0, membersLinked = 0, clientId = null, stagingId = null, memberId = null;
  try {
    const st = await sb(`members_staging?parent_email=eq.${encodeURIComponent(email)}&coachiq_member_id=is.null&select=id,client_id&order=created_at.desc`);
    if (Array.isArray(st) && st.length) {
      await sb(`members_staging?parent_email=eq.${encodeURIComponent(email)}&coachiq_member_id=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ coachiq_member_id: coachiqUserId }),
      });
      stagingLinked = st.length; clientId = st[0].client_id; stagingId = st[0].id;
    }
  } catch (_) { /* non-fatal */ }

  // 2) live members without a coachiq id
  try {
    const mm = await sb(`members?parent_email=eq.${encodeURIComponent(email)}&coachiq_member_id=is.null&select=id,client_id&order=created_at.desc`);
    if (Array.isArray(mm) && mm.length) {
      await sb(`members?parent_email=eq.${encodeURIComponent(email)}&coachiq_member_id=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ coachiq_member_id: coachiqUserId }),
      });
      membersLinked = mm.length; clientId = clientId || mm[0].client_id; memberId = mm[0].id;
    }
  } catch (_) { /* non-fatal */ }

  const matched = stagingLinked > 0 || membersLinked > 0;
  const target = stagingLinked > 0 ? "staging" : (membersLinked > 0 ? "member" : "none");

  // record the event (for the UI's live check-off + unmatched flags)
  try {
    await sb(`coachiq_link_events`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ client_id: clientId, email, coachiq_user_id: coachiqUserId, matched, target, staging_id: stagingId, member_id: memberId, tag: b.tag || null }]),
    });
  } catch (_) { /* non-fatal */ }

  return res.status(200).json({ ok: true, coachiq_user_id: coachiqUserId, email, matched, staging_linked: stagingLinked, members_linked: membersLinked, target });
}

export default withSentryApiRoute(handler);
