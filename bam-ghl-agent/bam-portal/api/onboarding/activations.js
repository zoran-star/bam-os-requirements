// Post-payment activations for a portal-native signup.
//
// Called from api/stripe/webhook.js the FIRST time a PORTAL-OWNED onboarding sub
// is paid. Fires the two downstream systems — the portal is the SINGLE trigger
// (decided 2026-06-06; CoachIQ's own "send to GHL" step is turned OFF):
//
//   1. GHL   — using the academy's GHL OAuth token: upsert the contact, then
//              ENROLL them directly into the onboarding workflow by ID
//              (POST /contacts/{id}/workflow/{workflowId}). No inbound webhook —
//              manual API enrollment runs the workflow's action steps (tag, mark
//              opportunity WON, send welcome emails) for that contact. Decided
//              2026-06-18: direct-by-ID replaced the old inbound-webhook approach.
//   2. COACHIQ (if the academy uses it) — create + enroll the CoachIQ user via the
//              Zapier "Create User" hook (the only proven create+enroll path), then
//              grant the product (= product + program access + starter credits, no
//              payment). New users: the id returns via /api/coachiq/user-created,
//              which grants the product. Returning members (id already stored): grant
//              the product inline. See api/coachiq.js + memories/project_coachiq_integration.md.
//
// Each hook is INDEPENDENT and NON-FATAL: one failing never blocks the other or
// the Stripe webhook. Everything is GATED behind config, so with nothing set this
// is an inert no-op (safe to ship before the academy is configured).
//
// CONFIG (env for the BAM GTA proof; per-academy `clients` columns later):
//   GHL_ONBOARDING_WORKFLOW_ID       the GHL workflow id to enroll new paid members
//                                    into (the long id after /workflows/ in the URL).
//                                    The academy's GHL OAuth token does the API calls.
//   COACHIQ_CREATE_USER_WEBHOOK_URL  Zapier "Create User" catch-hook URL.
//   COACHIQ_PRODUCT_AUTOMATION_ID    "Add a Product Purchase" automation (+ optional
//                                    COACHIQ_PRODUCT_MAP per plan|term).
//   COACHIQ_API_KEY / COACHIQ_GROUP_ID / COACHIQ_WEBHOOK_SECRET  (see api/coachiq.js)

import { coachiqOnboardingEnabled, addCoachiqProduct } from "../coachiq.js";
import { getClientGhlToken } from "../website/availability.js";

const GHL_V2     = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

// member: the members row (needs parent_email, id, client_id, coachiq_member_id?)
// ctx:    { plan, term, sb, writeAudit }
export async function fireOnboardingActivations(member, ctx = {}) {
  const { plan, term, sb, writeAudit } = ctx;
  const results = { ghl: null, coachiq: null };

  const audit = async (action_type, args) => {
    try { if (writeAudit) await writeAudit({ client_id: member.client_id, member_id: member.id, action_type, args }); }
    catch (_) { /* non-fatal */ }
  };

  // ── 1. GHL — upsert contact + enroll directly into the onboarding workflow by ID ──
  // No inbound webhook. We use the academy's GHL OAuth token (auto-refresh) to upsert
  // the contact (match on email/phone), then POST it into GHL_ONBOARDING_WORKFLOW_ID.
  // Manual API enrollment runs the workflow's steps (tag, mark WON, welcome emails) —
  // the workflow itself needs no trigger.
  const workflowId = process.env.GHL_ONBOARDING_WORKFLOW_ID;
  if (workflowId && member.parent_email && sb) {
    try {
      const rows = await sb(`clients?id=eq.${member.client_id}&select=id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`);
      const client = Array.isArray(rows) && rows[0];
      if (!client || !client.ghl_location_id) throw new Error("academy has no GHL location");

      const token = await getClientGhlToken(client);
      const headers = {
        Authorization:  `Bearer ${token}`,
        Version:        V2_VERSION,
        "Content-Type": "application/json",
        Accept:         "application/json",
      };

      // Upsert the contact (GHL matches on email/phone → creates or updates in one call).
      const nameParts = (member.parent_name || "").trim().split(/\s+/);
      const contactPayload = {
        locationId: client.ghl_location_id,
        firstName:  nameParts[0] || undefined,
        lastName:   nameParts.slice(1).join(" ") || undefined,
        email:      member.parent_email.toLowerCase(),
        phone:      member.parent_phone || undefined,
        source:     "Website enrollment",
        tags:       ["website-enrollment"],
      };
      const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
        method: "POST", headers, body: JSON.stringify(contactPayload),
      });
      if (!upsertRes.ok) throw new Error(`GHL upsert ${upsertRes.status}: ${(await upsertRes.text()).slice(0, 120)}`);
      const upserted  = await upsertRes.json();
      const contactId = (upserted.contact || upserted).id || null;
      if (!contactId) throw new Error("GHL upsert returned no contact id");

      // Enroll the contact into the onboarding workflow.
      const enrollRes = await fetch(`${GHL_V2}/contacts/${contactId}/workflow/${workflowId}`, {
        method: "POST", headers,
        body: JSON.stringify({ eventStartTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") }),
      });
      if (!enrollRes.ok) throw new Error(`GHL workflow enroll ${enrollRes.status}: ${(await enrollRes.text()).slice(0, 120)}`);

      results.ghl = { ok: true, contact_id: contactId, workflow_id: workflowId };
      await audit("onboarding-ghl-fired", { contact_id: contactId, workflow_id: workflowId, plan, term });
    } catch (e) {
      results.ghl = { ok: false, error: String(e && e.message || e) };
      await audit("onboarding-ghl-error", { workflow_id: workflowId, plan, term, error: results.ghl.error });
    }
  } else {
    results.ghl = { skipped: "GHL not configured (need GHL_ONBOARDING_WORKFLOW_ID + parent_email)" };
  }

  // ── 2. CoachIQ (self-signup model — only if the academy uses it) ──
  //   • Returning member (already has coachiq_member_id) → grant the product NOW.
  //   • New member → do nothing here. The parent creates their CoachIQ account on
  //     the academy's group login page (enrolled); CoachIQ's "New User" automation
  //     webhooks the id to /api/coachiq/user-created, which matches by email + grants
  //     the product then. The confirmation page tells them to sign up. Non-fatal.
  // Per-academy gate: only run CoachIQ when this academy's scheduling app IS
  // CoachIQ (clients.scheduling_app / coachiq_enabled). GTA = 'none' → skipped.
  let _schedCoachiq = false;
  try {
    if (sb && member.client_id) {
      const cr = await sb(`clients?id=eq.${encodeURIComponent(member.client_id)}&select=scheduling_app,coachiq_enabled&limit=1`).catch(() => null);
      const c = Array.isArray(cr) && cr[0];
      _schedCoachiq = !!c && (c.scheduling_app === "coachiq" || c.coachiq_enabled === true);
    }
  } catch (_) { /* default off */ }
  if (coachiqOnboardingEnabled() && _schedCoachiq) {
    try {
      const existingId = member.coachiq_member_id || null;
      if (existingId) {
        let automationUrl = null;
        if (sb && member.stripe_price_id) {
          const pr = await sb(`pricing_catalog?stripe_price_id=eq.${encodeURIComponent(member.stripe_price_id)}&select=coachiq_automation_url&limit=1`).catch(() => null);
          automationUrl = (Array.isArray(pr) && pr[0] && pr[0].coachiq_automation_url) || null;
        }
        const product = await addCoachiqProduct(existingId, {
          plan, term, automationUrl, sub_id: member.stripe_subscription_id || null, source: "website-enrollment",
        });
        results.coachiq = { ok: true, coachiq_user_id: existingId, product };
        await audit("onboarding-coachiq-product", { coachiq_user_id: existingId, plan, term });
      } else {
        results.coachiq = { pending: "awaiting parent self-signup → /api/coachiq/user-created grants product" };
        await audit("onboarding-coachiq-await-signup", { member_id: member.id, parent_email: member.parent_email, plan, term });
      }
    } catch (e) {
      results.coachiq = { ok: false, error: String(e && e.message || e) };
      await audit("onboarding-coachiq-error", { error: results.coachiq.error });
    }
  } else {
    results.coachiq = { skipped: _schedCoachiq ? "CoachIQ onboarding not configured (env)" : "scheduling app is not CoachIQ for this academy" };
  }

  return results;
}
