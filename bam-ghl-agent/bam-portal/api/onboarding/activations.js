// Post-payment activations for a portal-native signup.
//
// Called from api/stripe/webhook.js the FIRST time a PORTAL-OWNED onboarding sub
// is paid. Fires the two downstream systems — the portal is the SINGLE trigger
// (decided 2026-06-06; CoachIQ's own "send to GHL" step is turned OFF):
//
//   1. GHL   — POST the academy's existing inbound-webhook workflow with
//              { details: { user: { email }, product: { id } } }. That workflow
//              (already built by Zoran) finds/creates the contact, branches by
//              product id, tags, marks the opportunity WON, and sends emails.
//   2. COACHIQ (if the academy uses it) — create the CoachIQ user (Zapier; still
//              a stub until wired) and fire the per-product automation that grants
//              the product + credits.
//
// Each hook is INDEPENDENT and NON-FATAL: one failing never blocks the other or
// the Stripe webhook. Everything is GATED behind config, so with nothing set this
// is an inert no-op (safe to ship before the academy is configured).
//
// CONFIG (env for the BAM GTA proof; per-academy `clients` columns later):
//   GHL_ONBOARDING_WEBHOOK_URL   the inbound-webhook URL of the GHL workflow
//   ONBOARDING_PRODUCT_MAP       JSON: { "<plan>|<term>": { ghl_product_id,
//                                coachiq_automation_id } }  e.g.
//                                { "2/wk|4_weeks": { "ghl_product_id": "...",
//                                  "coachiq_automation_id": "..." } }
//   (CoachIQ key/group via api/coachiq.js → COACHIQ_API_KEY / COACHIQ_GROUP_ID)

import { coachiqEnabled, triggerCoachiqAutomation, createCoachiqUser } from "../coachiq.js";

function productMap() {
  try {
    const raw = process.env.ONBOARDING_PRODUCT_MAP;
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

// Resolve the per-plan+term ids the two hooks need. Returns {} when unmapped.
function mappingFor(plan, term) {
  const map = productMap();
  return map[`${plan}|${term}`] || map[plan] || {};
}

// member: the members row (needs parent_email, id, client_id, coachiq_member_id?)
// ctx:    { plan, term, sb, writeAudit }
export async function fireOnboardingActivations(member, ctx = {}) {
  const { plan, term, sb, writeAudit } = ctx;
  const map = mappingFor(plan, term);
  const results = { ghl: null, coachiq: null };

  const audit = async (action_type, args) => {
    try { if (writeAudit) await writeAudit({ client_id: member.client_id, member_id: member.id, action_type, args }); }
    catch (_) { /* non-fatal */ }
  };

  // ── 1. GHL webhook (portal is the only trigger) ──
  const ghlUrl = process.env.GHL_ONBOARDING_WEBHOOK_URL;
  if (ghlUrl && map.ghl_product_id && member.parent_email) {
    try {
      const payload = { details: { user: { email: member.parent_email }, product: { id: map.ghl_product_id } } };
      const r = await fetch(ghlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      results.ghl = { ok: r.ok, status: r.status };
      await audit(r.ok ? "onboarding-ghl-fired" : "onboarding-ghl-error", { product_id: map.ghl_product_id, status: r.status });
    } catch (e) {
      results.ghl = { ok: false, error: String(e && e.message || e) };
      await audit("onboarding-ghl-error", { product_id: map.ghl_product_id, error: results.ghl.error });
    }
  } else {
    results.ghl = { skipped: "GHL not configured (need GHL_ONBOARDING_WEBHOOK_URL + product map)" };
  }

  // ── 2. CoachIQ (only if the academy uses it) ──
  if (coachiqEnabled()) {
    try {
      // Ensure a CoachIQ user id (create via Zapier if we don't have one).
      let coachiqUserId = member.coachiq_member_id || null;
      if (!coachiqUserId) {
        // createCoachiqUser is still a stub until the Zapier "Create User" path is
        // wired — this will throw and be logged as blocked (expected for now).
        const created = await createCoachiqUser({
          email: member.parent_email, firstName: member.parent_name,
        });
        coachiqUserId = created && created.id;
        if (coachiqUserId && sb) {
          await sb(`members?id=eq.${member.id}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ coachiq_member_id: coachiqUserId }),
          }).catch(() => {});
        }
      }
      if (coachiqUserId && map.coachiq_automation_id) {
        await triggerCoachiqAutomation(map.coachiq_automation_id, { user: { id: coachiqUserId } });
        results.coachiq = { ok: true, automation_id: map.coachiq_automation_id };
        await audit("onboarding-coachiq-allocated", { coachiq_user_id: coachiqUserId, automation_id: map.coachiq_automation_id });
      } else {
        results.coachiq = { skipped: "missing coachiq user id or automation id" };
        await audit("onboarding-coachiq-skipped", { reason: results.coachiq.skipped });
      }
    } catch (e) {
      results.coachiq = { ok: false, error: String(e && e.message || e) };
      await audit("onboarding-coachiq-error", { error: results.coachiq.error });
    }
  } else {
    results.coachiq = { skipped: "CoachIQ not enabled for this academy" };
  }

  return results;
}
