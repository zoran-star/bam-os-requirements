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
//   2. COACHIQ (if the academy uses it) — create the CoachIQ user (Zapier; still
//              a stub until wired) and fire the per-product automation that grants
//              the product + credits.
//
// Each hook is INDEPENDENT and NON-FATAL: one failing never blocks the other or
// the Stripe webhook. Everything is GATED behind config, so with nothing set this
// is an inert no-op (safe to ship before the academy is configured).
//
// CONFIG (env for the BAM GTA proof; per-academy `clients` columns later):
//   GHL_ONBOARDING_WORKFLOW_ID   the GHL workflow id to enroll new paid members into
//                                (the long id after /workflows/ in the GHL URL).
//                                THIS IS ALL THAT'S NEEDED to fire the onboarding
//                                automation. The academy's GHL OAuth token (clients
//                                .ghl_access_token, auto-refresh) does the API calls.
//   ONBOARDING_PRODUCT_MAP       OPTIONAL JSON: { "<plan>|<term>": { coachiq_automation_id } }.
//                                Only used by the CoachIQ hook below. GTA doesn't need it.
//   (CoachIQ key/group via api/coachiq.js → COACHIQ_API_KEY / COACHIQ_GROUP_ID)

import { coachiqEnabled, triggerCoachiqAutomation, createCoachiqUser } from "../coachiq.js";
import { getClientGhlToken } from "../website/availability.js";

const GHL_V2     = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

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
