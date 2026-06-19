// POST /api/coachiq/test-onboard  — manual test harness for the CoachIQ onboarding
// flow, so every link can be exercised WITHOUT a real payment. Secret-gated
// (COACHIQ_WEBHOOK_SECRET). Pick a `mode`:
//
//   mode:"status"   → report which config pieces are present (no secrets leaked)
//                     + whether onboarding is fully enabled.
//   mode:"create"   → fire createCoachiqUser. Pass member_id (loads the row) OR
//                     ad-hoc { first|name, last, email, phone, plan, term }.
//                     The Zap will call /user-created back with the new id.
//   mode:"product"  → fire addCoachiqProduct for an EXISTING coachiq_user_id
//                     (+ optional plan/term). Use this once you have an id.
//   mode:"callback" → simulate the Zapier callback in-process: store coachiq_user_id
//                     on member_id and grant the product. Proves the back half
//                     without waiting on Zapier.
//   mode:"full"     → member_id → createCoachiqUser (then Zapier → /user-created
//                     finishes it). End-to-end with a real member, no charge.
//
// Body always includes: { secret }. Returns structured step results.

import { withSentryApiRoute } from "../_sentry.js";
import {
  createCoachiqUser, addCoachiqProduct,
  coachiqConfig, coachiqOnboardingEnabled, coachiqProductAutomationFor,
} from "../coachiq.js";

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

async function loadMember(memberId) {
  const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&select=id,client_id,plan,parent_name,parent_email,parent_phone,coachiq_member_id&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });

  const b = req.body || {};
  const expected = coachiqConfig().webhookSecret;
  const secret = b.secret || req.headers["x-coachiq-secret"];
  if (!expected || secret !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized (set COACHIQ_WEBHOOK_SECRET and pass secret)" });
  }

  const mode = b.mode || "status";

  try {
    // ── status ──────────────────────────────────────────────────────────────
    if (mode === "status") {
      const c = coachiqConfig();
      return res.status(200).json({
        ok: true, mode,
        onboarding_enabled: coachiqOnboardingEnabled(),
        config_present: {
          api_key: !!c.apiKey, group_id: !!c.groupId,
          create_user_webhook_url: !!c.createUserWebhookUrl,
          product_automation_id: !!c.productAutomationId,
          product_map_keys: Object.keys(c.productMap || {}),
          credit_automation_id: !!c.creditAutomationId,
          webhook_secret: !!c.webhookSecret,
        },
      });
    }

    // ── create ──────────────────────────────────────────────────────────────
    if (mode === "create" || mode === "full") {
      let member;
      if (b.member_id) {
        member = await loadMember(b.member_id);
        if (!member) return res.status(404).json({ ok: false, error: "member not found" });
      } else {
        const name = b.name || [b.first, b.last].filter(Boolean).join(" ");
        if (!b.email) return res.status(400).json({ ok: false, error: "member_id OR email required" });
        member = {
          id: b.member_id || `test-${b.email}`, client_id: b.client_id || null,
          parent_name: name, parent_email: b.email, parent_phone: b.phone || null,
          plan: b.plan || null, term: b.term || null,
        };
      }
      const result = await createCoachiqUser(member);
      return res.status(200).json({
        ok: true, mode, member_id: member.id, create: result,
        note: result.pending
          ? "Zap fired; the new id arrives via /api/coachiq/user-created, which then grants the product."
          : "Zap returned an id synchronously.",
      });
    }

    // ── product ─────────────────────────────────────────────────────────────
    if (mode === "product") {
      const id = b.coachiq_user_id;
      if (!id) return res.status(400).json({ ok: false, error: "coachiq_user_id required" });
      const automationId = coachiqProductAutomationFor(b.plan, b.term);
      const product = await addCoachiqProduct(id, { plan: b.plan, term: b.term, source: "test" });
      return res.status(200).json({ ok: true, mode, coachiq_user_id: id, resolved_automation_id: automationId, product });
    }

    // ── callback (simulate Zapier posting the id back) ────────────────────────
    if (mode === "callback") {
      const { member_id, coachiq_user_id } = b;
      if (!member_id || !coachiq_user_id) return res.status(400).json({ ok: false, error: "member_id and coachiq_user_id required" });
      const member = await loadMember(member_id);
      if (!member) return res.status(404).json({ ok: false, error: "member not found" });
      await sb(`members?id=eq.${encodeURIComponent(member_id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ coachiq_member_id: coachiq_user_id }),
      });
      let product = { skipped: true };
      if (b.grant_product !== false) {
        product = await addCoachiqProduct(coachiq_user_id, { plan: b.plan || member.plan, term: b.term, source: "test-callback" });
      }
      return res.status(200).json({ ok: true, mode, member_id, coachiq_user_id, stored: true, product });
    }

    return res.status(400).json({ ok: false, error: `unknown mode "${mode}" (status|create|product|callback|full)` });
  } catch (e) {
    return res.status(500).json({ ok: false, mode, error: String(e && e.message || e) });
  }
}

export default withSentryApiRoute(handler);
