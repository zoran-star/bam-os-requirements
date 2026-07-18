import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Members intake (GHL webhook landing)
//
// Receives GHL Workflow "form submitted" webhooks and creates a member
// row in `payment_method_required` state. The Stripe webhook
// (api/stripe/webhook.js) later flips the row to `live` and populates
// stripe_customer_id + stripe_subscription_id when the first payment
// succeeds. Match key between the two webhooks = parent_email.
//
// Auth: shared static header `X-Webhook-Secret` (GHL doesn't sign
// requests, so HMAC isn't available — a long random secret + HTTPS is
// the practical surface).
//
// Idempotent on (athlete_name, parent_email): a re-submit returns the
// existing row instead of duplicating.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// BAM GTA is the only academy with member-management live (Phase 4 will
// generalize this to per-academy webhook routing — likely via a
// per-academy secret or a `client_id` field in the GHL webhook payload).
const BAM_GTA_CLIENT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

  const secret = process.env.GHL_INTAKE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "GHL_INTAKE_WEBHOOK_SECRET not configured" });
  const provided = req.headers["x-webhook-secret"] || req.headers["X-Webhook-Secret"];
  if (provided !== secret) return res.status(401).json({ error: "invalid webhook secret" });

  const body = (req.body && typeof req.body === "object") ? req.body : {};

  // Diagnostic: log incoming body to Vercel logs + write failures to the
  // audit log so we can query exactly what GHL sent. Remove once intake
  // is stable.
  console.log("[intake] received body:", JSON.stringify(body));

  // GHL custom data may arrive nested under `customData` or `custom_data`
  // depending on the workflow template — flatten if so.
  const flat = (body.customData && typeof body.customData === "object") ? { ...body, ...body.customData }
             : (body.custom_data && typeof body.custom_data === "object") ? { ...body, ...body.custom_data }
             : body;

  // Normalize: GHL field names vary by template; accept a few common shapes.
  const athleteName = flat.athlete_name || flat.athleteName || flat.athletes_full_name || flat.name || null;
  const parentName  = flat.parent_name  || flat.parentName  || flat.parents_full_name  || flat.full_name || null;
  const parentEmail = (flat.parent_email || flat.parentEmail || flat.parents_email     || flat.email || "").toLowerCase().trim() || null;
  const parentPhone = flat.parent_phone || flat.parentPhone || flat.parents_phone     || flat.phone || null;
  const plan        = flat.plan || null;

  async function logIntakeFailure(reason) {
    try {
      await sb(`member_audit_log`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id:         BAM_GTA_CLIENT_ID,
          action_type:       "intake-ghl-failed",
          args:              { reason, received_body: body, keys: Object.keys(body || {}) },
          performed_by_name: "GHL Workflow (validation failed)",
        }]),
      });
    } catch (_) {}
  }

  if (!athleteName) { await logIntakeFailure("athlete_name missing"); return res.status(400).json({ error: "athlete_name required", received_keys: Object.keys(body) }); }
  if (!parentEmail) { await logIntakeFailure("parent_email missing"); return res.status(400).json({ error: "parent_email required", received_keys: Object.keys(body) }); }

  // Idempotency — avoid dupes from accidental resubmits.
  const existing = await sb(
    `members?client_id=eq.${BAM_GTA_CLIENT_ID}` +
    `&parent_email=eq.${encodeURIComponent(parentEmail)}` +
    `&athlete_name=eq.${encodeURIComponent(athleteName)}` +
    `&select=id,status,stripe_subscription_id&limit=1`
  );
  if (Array.isArray(existing) && existing[0]) {
    return res.status(200).json({ ok: true, duplicate: true, member: existing[0] });
  }

  const row = {
    client_id:        BAM_GTA_CLIENT_ID,
    athlete_name:     athleteName,
    parent_name:      parentName,
    parent_email:     parentEmail,
    parent_phone:     parentPhone,
    plan,
    // Enroll form filled, not paid yet: a pre-payment shell. signup_origin
    // 'website_enroll' keeps it OFF the members roster until the Stripe
    // webhook flips it live - the person stays a lead in the pipeline.
    status:           "payment_method_required",
    signup_origin:    "website_enroll",
    archetype:        body.archetype        || null,
    trainer:          body.trainer          || null,
    group_num:        body.group_num        || null,
    parent_archetype: body.parent_archetype || null,
    engagement:       body.engagement       || null,
    skill_notes:      body.skill_notes      || null,
    ghl_contact_id:   body.ghl_contact_id || body.contact_id || null,
    joined_date:      body.joined_date || new Date().toISOString().slice(0, 10),
    created_at:       nowIso(),
    updated_at:       nowIso(),
  };

  let member = null;
  try {
    const inserted = await sb(`members?select=*`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([row]),
    });
    member = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Audit row — traceability for "where did this member come from?"
  try {
    await sb(`member_audit_log`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id:         BAM_GTA_CLIENT_ID,
        member_id:         member?.id || null,
        action_type:       "intake-ghl",
        args:              { source: "ghl_webhook", body },
        performed_by_name: "GHL Workflow",
        db_changes:        { members: "inserted as payment_method_required" },
      }]),
    });
  } catch (_) { /* non-fatal */ }

  return res.status(200).json({ ok: true, member });
}

export default withSentryApiRoute(handler);
