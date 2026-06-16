// Public endpoint — receives form submissions from client websites.
// Lead data lives in OUR database first: every submission writes a
// website_leads row, then syncs to the client's GHL (contact + inbox
// message) when configured. The row is stamped with the sync receipt
// (ghl_contact_id / ghl_synced_at / ghl_error) so failed syncs are
// visible and retryable, and migrating a client off GHL is just
// "stop syncing" — their lead history is already home.
//
// POST body: { client_id, form_type?, name, email, phone?, fields?, source_url? }
// fields is a free-form object for any extra form data (e.g. { message: "..." })
//
// Allowed origins come from clients.allowed_domains (text[] of bare domains,
// e.g. {"byanymeansbball.com","bam-gta.vercel.app"}) — onboarding a new
// client site is a DB row update, not a code change. GHL push activates
// automatically when the client has ghl_kpi_config.ghl_location set and
// that location is present in GHL_LOCATIONS_JSON.

import { withSentryApiRoute } from "../_sentry.js";
import { getClientGhlToken } from "./availability.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

// Module-level cache so warm serverless instances don't hit the DB on
// every preflight. 60s is fine — domain changes are rare.
let originsCache = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) {
    return originsCache.set;
  }
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      set.add(`https://${domain}`);
      set.add(`https://www.${domain}`);
    }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function setCors(req, res) {
  const origin = req.headers.origin || "";
  let allowed = false;
  try {
    allowed = (await getAllowedOrigins()).has(origin);
  } catch { /* DB hiccup — treat as not allowed; POST will 403 */ }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowed;
}

async function sbReq(path, init = {}) {
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
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

function loadLocations() {
  try {
    return process.env.GHL_LOCATIONS_JSON ? JSON.parse(process.env.GHL_LOCATIONS_JSON) : [];
  } catch { return []; }
}

// Resolve a pipeline + stage by NAME (case-insensitive) so per-client config
// stays human-readable. Cached per location on warm instances.
let pipelinesCache = {};
const PIPELINES_TTL_MS = 5 * 60_000;

async function resolvePipelineStage(headers, ghlLocationId, pipelineName, stageName) {
  const cached = pipelinesCache[ghlLocationId];
  let pipelines = cached && Date.now() - cached.at < PIPELINES_TTL_MS ? cached.list : null;
  if (!pipelines) {
    const r = await fetch(`${GHL_V2}/opportunities/pipelines?locationId=${ghlLocationId}`, { headers });
    if (!r.ok) throw new Error(`GHL pipelines ${r.status}: ${(await r.text()).slice(0, 120)}`);
    pipelines = (await r.json()).pipelines || [];
    pipelinesCache[ghlLocationId] = { list: pipelines, at: Date.now() };
  }
  const norm = (s) => (s || "").trim().toLowerCase();
  const pipeline = pipelines.find(p => norm(p.name) === norm(pipelineName));
  if (!pipeline) throw new Error(`pipeline "${pipelineName}" not found`);
  const stage = (pipeline.stages || []).find(s => norm(s.name) === norm(stageName));
  if (!stage) throw new Error(`stage "${stageName}" not found in pipeline "${pipelineName}"`);
  return { pipelineId: pipeline.id, stageId: stage.id };
}

async function pushToGhl(locName, ghlLocationId, { name, email, phone, message, messageFieldId, formType, pipelineConfig, extraTags, fields, fieldMap }) {
  const loc = loadLocations().find(l => l.name === locName);
  if (!loc) return null;

  const apiKey = loc.apiKeyV2 || loc.apiKey;
  if (!apiKey) return null;

  const [firstName, ...rest] = (name || "").trim().split(" ");
  const lastName = rest.join(" ") || undefined;

  // Custom fields: the entry point's field_map says which submission fields
  // copy into which GHL contact fields ({ fieldsKey: ghlFieldId }).
  // message_field_id from ghl_kpi_config is the legacy single-field variant.
  const customFields = [];
  const mappedIds = new Set();
  for (const [key, ghlFieldId] of Object.entries(fieldMap || {})) {
    const val = fields?.[key];
    if (ghlFieldId && val !== undefined && val !== null && String(val).trim() !== "") {
      customFields.push({ id: ghlFieldId, field_value: String(val) });
      mappedIds.add(ghlFieldId);
    }
  }
  if (messageFieldId && message && !mappedIds.has(messageFieldId)) {
    customFields.push({ id: messageFieldId, field_value: message });
  }

  // e.g. form_type "contact" → "contact form filled", "free-trial" → "free trial form filled"
  const formTag = `${(formType || "contact").replace(/-/g, " ")} form filled`;
  const tags = [...new Set(["website-inquiry", formTag, ...(extraTags || [])])];

  const payload = {
    locationId: ghlLocationId,
    firstName,
    ...(lastName ? { lastName } : {}),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(phone ? { phone } : {}),
    source: "website-form",
    tags,
    ...(customFields.length ? { customFields } : {}),
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: V2_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Upsert: GHL matches on email/phone and creates or updates in one call.
  // (Search-then-create raced with GHL's duplicate prevention and failed on
  // repeat submissions from the same email.)
  const upsertRes = await fetch(`${GHL_V2}/contacts/upsert`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (!upsertRes.ok) throw new Error(`GHL ${upsertRes.status}: ${(await upsertRes.text()).slice(0, 120)}`);
  const upserted = await upsertRes.json();
  const contactId = (upserted.contact || upserted).id || null;

  // Make the message readable in GHL. The inbox thread can't carry it without
  // a registered conversation provider (/conversations/messages/inbound
  // requires conversationProviderId), so the contract is:
  //   1. NOTE on the contact — always works, holds the full message text
  //   2. conversation entry — puts the contact in the team inbox unread,
  //      which fires the normal GHL notification
  if (contactId && message) {
    try {
      const noteRes = await fetch(`${GHL_V2}/contacts/${contactId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: `Website form message:\n\n${message}` }),
      });
      if (!noteRes.ok) console.error("GHL note failed:", noteRes.status, (await noteRes.text()).slice(0, 200));
    } catch (e) { console.error("GHL note post failed (non-fatal):", e.message); }

    try {
      await fetch(`${GHL_V2}/conversations/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId: ghlLocationId, contactId }),
      });
    } catch (e) { console.error("GHL conversation create failed (non-fatal):", e.message); }
  }

  // Drop the lead into a pipeline when the client config maps this form type
  // to a pipeline + stage (by name). A repeat submission never creates a
  // second card; advance=true moves the existing card to the target stage
  // (used when a booking upgrades a form-stage lead).
  if (contactId && pipelineConfig?.pipeline && pipelineConfig?.stage) {
    try {
      await placeOpportunity(headers, ghlLocationId, contactId, pipelineConfig, `${name || email}`, false);
    } catch (e) { console.error("GHL pipeline step failed (non-fatal):", e.message); }
  }

  return contactId;
}

// Move-or-create the contact's open opportunity in the named pipeline/stage.
// advance=false: create only if the contact has no open card in the pipeline.
// advance=true:  also MOVE an existing open card to the target stage.
async function placeOpportunity(headers, ghlLocationId, contactId, { pipeline, stage }, oppName, advance) {
  const { pipelineId, stageId } = await resolvePipelineStage(headers, ghlLocationId, pipeline, stage);

  let existing = null;
  const searchRes = await fetch(
    `${GHL_V2}/opportunities/search?${new URLSearchParams({ location_id: ghlLocationId, contact_id: contactId, status: "open" })}`,
    { headers }
  );
  if (searchRes.ok) {
    const found = (await searchRes.json()).opportunities || [];
    existing = found.find(o => (o.pipelineId || o.pipeline_id) === pipelineId) || null;
  }

  if (existing && advance) {
    const moveRes = await fetch(`${GHL_V2}/opportunities/${existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ pipelineId, pipelineStageId: stageId }),
    });
    if (!moveRes.ok) console.error("GHL opportunity move failed:", moveRes.status, (await moveRes.text()).slice(0, 200));
    return existing.id;
  }
  if (!existing) {
    const oppRes = await fetch(`${GHL_V2}/opportunities/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        locationId: ghlLocationId,
        pipelineId,
        pipelineStageId: stageId,
        contactId,
        name: oppName,
        status: "open",
      }),
    });
    if (!oppRes.ok) console.error("GHL opportunity create failed:", oppRes.status, (await oppRes.text()).slice(0, 200));
    else return ((await oppRes.json()).opportunity || {}).id || null;
  }
  return existing?.id || null;
}

async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const allowed = await setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const b = req.body || {};
  const { client_id, form_type = "contact", name, email, phone, fields = {}, source_url, booking } = b;

  if (!client_id) return res.status(400).json({ error: "client_id required" });
  if (!name && !email) return res.status(400).json({ error: "name or email required" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid email" });
  }

  let client;
  try {
    const rows = await sbReq(
      `clients?id=eq.${client_id}&select=id,ghl_location_id,ghl_kpi_config,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    client = rows?.[0];
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!client) return res.status(404).json({ error: "client not found" });

  // 1. Save — our database is the source of truth for every lead.
  let leadId;
  try {
    const rows = await sbReq("website_leads", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        client_id: client.id,
        form_type,
        name: name || null,
        email: email?.toLowerCase() || null,
        phone: phone || null,
        fields,
        source_url: source_url || null,
      }),
    });
    leadId = rows?.[0]?.id;
  } catch (e) {
    return res.status(500).json({ error: `submission failed: ${e.message}` });
  }

  // 2. Deliver — sync to the client's GHL when configured.
  const ghlLocName = client.ghl_kpi_config?.ghl_location;
  const messageFieldId = client.ghl_kpi_config?.message_field_id || null;
  const message = fields?.message || null;
  // Routing comes from the entry_points table — the row for this client's
  // website form of this form_type carries the tags + pipeline/stage names
  // configured in the portal's Entry Point Set Up wizard.
  let pipelineConfig = null;
  let extraTags = [];
  let fieldMap = null;
  let formWorkflowId = null;
  try {
    const eps = await sbReq(
      `entry_points?client_id=eq.${client.id}&type=eq.website-form&key=eq.${encodeURIComponent(form_type)}&enabled=eq.true&select=tags,pipeline_name,stage_name,field_map,ghl_workflow_id&limit=1`
    );
    const ep = eps?.[0];
    if (ep) {
      extraTags = ep.tags || [];
      fieldMap = ep.field_map || null;
      formWorkflowId = ep.ghl_workflow_id || null;
      if (ep.pipeline_name && ep.stage_name) {
        pipelineConfig = { pipeline: ep.pipeline_name, stage: ep.stage_name };
      }
    }
  } catch (e) { console.error("entry_points lookup failed (non-fatal):", e.message); }

  let ghlStatus = "not-configured";
  let kpiContactId = null;
  if (ghlLocName && client.ghl_location_id) {
    let receipt;
    try {
      const ghlContactId = await pushToGhl(ghlLocName, client.ghl_location_id, { name, email, phone, message, messageFieldId, formType: form_type, pipelineConfig, extraTags, fields, fieldMap });
      if (ghlContactId) {
        ghlStatus = "synced";
        kpiContactId = ghlContactId;
        receipt = { ghl_contact_id: ghlContactId, ghl_synced_at: new Date().toISOString(), ghl_error: null };
      } else {
        ghlStatus = "failed";
        receipt = { ghl_error: "location not found in GHL_LOCATIONS_JSON or no API key" };
      }
    } catch (e) {
      console.error("GHL sync failed — lead is saved, stamping error:", e.message);
      ghlStatus = "failed";
      receipt = { ghl_error: e.message.slice(0, 500) };
    }

    // 2b. Booking — when the form carried a chosen slot, create the GHL
    // appointment. The calendar must be one of the client's calendar entry
    // points. Failure degrades gracefully: the lead is saved + synced, the
    // site tells the parent "we'll confirm by email", and the receipt shows
    // what happened.
    let appointmentStatus;
    if (booking?.calendar_id && booking?.start && receipt?.ghl_contact_id) {
      appointmentStatus = "failed";
      try {
        const eps = await sbReq(
          `entry_points?client_id=eq.${client.id}&type=eq.calendar&key=eq.${encodeURIComponent(booking.calendar_id)}&enabled=eq.true&select=id,pipeline_name,stage_name,ghl_workflow_id&limit=1`
        );
        if (!eps?.[0]) throw new Error("calendar not available");
        const calEp = eps[0];
        const oauthToken = await getClientGhlToken(client);
        const oauthHeaders = {
          Authorization: `Bearer ${oauthToken}`,
          Version: V2_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        const apptRes = await fetch(`${GHL_V2}/calendars/events/appointments`, {
          method: "POST",
          headers: oauthHeaders,
          body: JSON.stringify({
            calendarId: booking.calendar_id,
            locationId: client.ghl_location_id,
            contactId: receipt.ghl_contact_id,
            startTime: booking.start,
          }),
        });
        const apptJson = await apptRes.json().catch(() => ({}));
        if (!apptRes.ok) throw new Error(apptJson.message || apptJson.error || `GHL ${apptRes.status}`);
        appointmentStatus = "booked";
        fields.appointment_id = (apptJson.appointment || apptJson).id || null;
        fields.booked_slot = booking.start;
        receipt.fields = fields;

        if (calEp.ghl_workflow_id) {
          await enrollInWorkflow(client, receipt.ghl_contact_id, calEp.ghl_workflow_id);
        }

        // Booking advances the pipeline card to the CALENDAR entry point's
        // stage (e.g. form fill lands at "interested", a real booking moves
        // the card to "scheduled trial"). Non-fatal.
        if (calEp.pipeline_name && calEp.stage_name) {
          try {
            await placeOpportunity(
              oauthHeaders, client.ghl_location_id, receipt.ghl_contact_id,
              { pipeline: calEp.pipeline_name, stage: calEp.stage_name },
              `${name || email}`, true
            );
          } catch (e) { console.error("Booking stage advance failed (non-fatal):", e.message); }
        }
      } catch (e) {
        console.error("GHL appointment failed (lead saved):", e.message);
        fields.appointment_error = String(e.message).slice(0, 300);
        receipt.fields = fields;
      }
    }

    // 3. Receipt — stamp the lead row; never fail the request over it.
    try {
      await sbReq(`website_leads?id=eq.${leadId}`, {
        method: "PATCH",
        body: JSON.stringify(receipt),
      });
    } catch (e) {
      console.error("Failed to stamp GHL receipt on lead", leadId, e.message);
    }

    if (appointmentStatus) {
      await recordKpiLeadEvent(client.id, leadId, form_type, fields, { name, email, phone, contactId: kpiContactId });
      return res.status(200).json({ ok: true, id: leadId, ghl: ghlStatus, appointment: appointmentStatus });
    }

    // Form-step submission (no booking): enroll in the form's workflow.
    if (kpiContactId && formWorkflowId && fields?.step !== "booking") {
      await enrollInWorkflow(client, kpiContactId, formWorkflowId);
    }
  }

  await recordKpiLeadEvent(client.id, leadId, form_type, fields, { name, email, phone, contactId: kpiContactId });
  return res.status(200).json({ ok: true, id: leadId, ghl: ghlStatus });
}

// V1 automations: enroll the GHL contact into an existing GHL workflow
// (the entry point's ghl_workflow_id). The portal is the trigger now —
// the workflow's own steps (texts, emails, waits) keep running in GHL.
// Falls back to the location API key when no OAuth token is present —
// workflow enrollment doesn't require calendar scopes.
async function enrollInWorkflow(client, contactId, workflowId) {
  if (!contactId || !workflowId) return;
  try {
    let token;
    try {
      token = await getClientGhlToken(client);
    } catch {
      const loc = loadLocations().find(l => l.name === client.ghl_kpi_config?.ghl_location);
      token = loc?.apiKeyV2 || loc?.apiKey || null;
    }
    if (!token) { console.error("GHL workflow enroll skipped: no token or API key available"); return; }
    const r = await fetch(`${GHL_V2}/contacts/${contactId}/workflow/${workflowId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, "Content-Type": "application/json", Accept: "application/json" },
      // GHL rejects the 'Z' suffix — it demands an explicit timezone offset.
      body: JSON.stringify({ eventStartTime: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") }),
    });
    if (!r.ok) console.error("GHL workflow enroll failed:", r.status, (await r.text()).slice(0, 150));
  } catch (e) { console.error("GHL workflow enroll failed (non-fatal):", e.message); }
}

// KPI continuity: website leads land in ghl_funnel_events (raw.websiteForm)
// so the monthly KPI reader can count them once an era selects website forms
// (the post-GHL-native-forms world). Booking-step submissions are skipped —
// the form-step row already counted that person.
async function recordKpiLeadEvent(clientId, leadId, formType, fields, { name, email, phone, contactId }) {
  if (fields?.step === "booking") return;
  try {
    await sbReq("ghl_funnel_events?on_conflict=event_type,ref", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        client_id: clientId,
        event_type: "lead",
        contact_id: contactId || null,
        contact_email: email ? email.toLowerCase() : null,
        contact_phone: phone || null,
        ref: `weblead:${leadId}`,
        occurred_at: new Date().toISOString(),
        raw: { websiteForm: formType, leadId, name: name || null },
      }),
    });
  } catch (e) { console.error("KPI lead event insert failed (non-fatal):", e.message); }
}

export default withSentryApiRoute(handler);
