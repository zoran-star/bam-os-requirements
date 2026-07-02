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
import { enrollContact, exitEnrollment } from "../automations.js";
import { createOpp, moveStage, findOpenOpp, pipelineFlags, ROLE_MATCHERS } from "../agent/_store.js";
import { upsertPortalContact, writePortalFieldValues, contactProvider, resolveOrMintPortalContact } from "../_contacts.js";
import { recordKpiEvent } from "../_kpi.js";

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
let originsCache = { set: null, patterns: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

async function getAllowedOrigins() {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) {
    return originsCache;
  }
  const set = new Set(DEV_ORIGINS);
  const patterns = [];
  const rows = await sbReq("clients?select=allowed_domains&allowed_domains=not.is.null");
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      if (domain.includes("*")) {
        patterns.push(new RegExp(`^https://${domain.replace(/\./g, "\\.").replace(/\*/g, "[a-z0-9-]+")}$`));
      } else {
        set.add(`https://${domain}`);
        set.add(`https://www.${domain}`);
      }
    }
  }
  originsCache = { set, patterns, at: Date.now() };
  return originsCache;
}

async function setCors(req, res) {
  const origin = req.headers.origin || "";
  let allowed = false;
  try {
    const { set, patterns } = await getAllowedOrigins();
    allowed = set.has(origin) || patterns.some(p => p.test(origin));
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

async function resolvePipelineStage(headers, ghlLocationId, pipelineName, stageName, clientId) {
  // Registry-first for pipeline_provider='portal' academies: resolve from the
  // portal's own pipeline_stages registry (by the role the configured stage name
  // maps to) - no GHL read. Any miss (no clientId, provider 'ghl', unmapped
  // custom stage name, unseeded row) falls through to the GHL lookup below.
  if (clientId) {
    try {
      const role = roleForStageName(stageName);
      if (role) {
        const prow = await sbReq(`clients?id=eq.${clientId}&select=pipeline_provider&limit=1`);
        if (prow?.[0]?.pipeline_provider === "portal") {
          const rows = await sbReq(`pipeline_stages?client_id=eq.${clientId}&role=eq.${encodeURIComponent(role)}&select=ghl_pipeline_id,ghl_stage_id&limit=1`);
          const row = rows?.[0];
          if (row?.ghl_pipeline_id && row?.ghl_stage_id) return { pipelineId: row.ghl_pipeline_id, stageId: row.ghl_stage_id };
        }
      }
    } catch (_) { /* fall through to GHL */ }
  }
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

// Best-effort role for a stage NAME, using the same regex registry resolveStage
// uses. The role only feeds the portal/shadow side of createOpp (stage_role +
// registry seeding); on provider='ghl' it does not touch the GHL POST body.
function roleForStageName(stageName) {
  const s = { name: stageName || "" };
  for (const [role, match] of Object.entries(ROLE_MATCHERS)) {
    try { if (match(s)) return role; } catch (_) {}
  }
  return null;
}

// PORTAL-NATIVE contact creation for contact_provider='portal' academies: the
// person is found-or-minted in the portal contacts store (no GHL contact, no
// GHL location config needed) and the pipeline card is placed through the
// provider-aware store. The minted uuid flows through the ghl_contact_id join
// key everywhere. Returns the contact join-key id (what pushToGhl returns).
async function portalNativeContact({ clientId, ghlLocationId, name, email, phone, message, messageFieldId, formType, pipelineConfig, extraTags, fields, fieldMap }) {
  const [firstName, ...rest] = (name || "").trim().split(" ");
  const cfMap = {};
  for (const [key, ghlFieldId] of Object.entries(fieldMap || {})) {
    const val = fields?.[key];
    if (ghlFieldId && val !== undefined && val !== null && String(val).trim() !== "") cfMap[String(ghlFieldId)] = String(val);
  }
  if (messageFieldId && message && !cfMap[String(messageFieldId)]) cfMap[String(messageFieldId)] = message;
  const formTag = `${(formType || "contact").replace(/-/g, " ")} form filled`;
  const tags = [...new Set(["website-inquiry", formTag, ...(extraTags || [])])];
  const contactId = await resolveOrMintPortalContact(clientId, {
    first_name: firstName || null,
    last_name:  rest.join(" ") || null,
    name:       (name || "").trim() || null,
    email, phone, tags,
    custom_fields: Object.keys(cfMap).length ? cfMap : null,
    source: "website-form",
  });
  // Card placement (form-step lands at the entry point's configured stage).
  // Stage resolution is registry-first for portal-pipeline academies, so the
  // GHL-less headers are only a fallback shell. Best-effort - a placement
  // failure must not lose the contact.
  if (contactId && pipelineConfig?.pipeline && pipelineConfig?.stage) {
    try {
      const bareHeaders = { Version: V2_VERSION, "Content-Type": "application/json", Accept: "application/json" };
      await placeOpportunity(bareHeaders, ghlLocationId, contactId, pipelineConfig, `${name || email}`, false, clientId);
    } catch (e) { console.error("portal-native card placement failed (non-fatal):", e.message); }
  }
  return contactId;
}

async function pushToGhl(locName, ghlLocationId, { clientId, contactProv, requireGhl, name, email, phone, message, messageFieldId, formType, pipelineConfig, extraTags, fields, fieldMap }) {
  // PORTAL-NATIVE creation runs FIRST: it needs no GHL location entry or API
  // key, so the GHL_LOCATIONS_JSON gates below must not be able to block it
  // (they did - prod's GHL_LOCATIONS_JSON is empty, which silently killed
  // contact creation for portal academies).
  if (clientId && contactProv === "portal" && !requireGhl) {
    return await portalNativeContact({ clientId, ghlLocationId, name, email, phone, message, messageFieldId, formType, pipelineConfig, extraTags, fields, fieldMap });
  }

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

  // Create the GHL contact (portal-native academies returned early above; the
  // only portal case reaching here is requireGhl - a booking on a
  // booking_provider='ghl' academy, which needs a real GHL contact for the GHL
  // calendar appointment). GHL matches on email/phone and creates or updates in
  // one call. (Search-then-create raced with GHL's duplicate prevention and
  // failed on repeat submissions from the same email.)
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
  // Skipped entirely for 'portal' academies - nobody reads GHL there, and the
  // message already lives on the website_leads row (+ mapped custom fields).
  if (contactId && message && contactProv !== "portal") {
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
      await placeOpportunity(headers, ghlLocationId, contactId, pipelineConfig, `${name || email}`, false, clientId);
    } catch (e) { console.error("GHL pipeline step failed (non-fatal):", e.message); }
  }

  return contactId;
}

// Move-or-create the contact's open opportunity in the named pipeline/stage.
// advance=false: create only if the contact has no open card in the pipeline.
// advance=true:  also MOVE an existing open card to the target stage.
async function placeOpportunity(headers, ghlLocationId, contactId, { pipeline, stage }, oppName, advance, clientId) {
  const { pipelineId, stageId } = await resolvePipelineStage(headers, ghlLocationId, pipeline, stage, clientId);

  // Existence check (provider-aware). A provider='portal' academy's opp lives in the
  // portal STORE, not GHL - searching GHL would MISS it and create a DUPLICATE opp on
  // every intake (this caused the dup cards for GTA's new leads). Look in the store for
  // those; every other academy keeps the exact GHL search. `existing` carries an oppRef
  // so the move below targets the right row regardless of provider.
  let existing = null;
  let provider = "ghl";
  if (clientId) { try { provider = (await pipelineFlags(clientId)).provider; } catch (_) {} }
  if (provider === "portal" && clientId) {
    const tok = (headers.Authorization || headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ref = await findOpenOpp({ clientId, token: tok, locationId: ghlLocationId, contactId }).catch(() => null);
    if (ref) existing = { id: ref.ghlOpportunityId || ref.id, ref };
  } else {
    const searchRes = await fetch(
      `${GHL_V2}/opportunities/search?${new URLSearchParams({ location_id: ghlLocationId, contact_id: contactId, status: "open" })}`,
      { headers }
    );
    if (searchRes.ok) {
      const found = (await searchRes.json()).opportunities || [];
      const match = found.find(o => (o.pipelineId || o.pipeline_id) === pipelineId) || null;
      if (match) existing = { id: match.id, ref: { ghlOpportunityId: match.id } };
    }
  }

  if (existing && advance) {
    // Move through the provider-aware store: on provider='portal' this updates the
    // opportunities row (NO GHL write); on 'ghl' (every client today) it's the exact
    // same PUT. Falls back to the raw PUT when the academy can't be resolved so
    // nothing regresses. Best-effort - a move failure must not break lead intake.
    if (clientId) {
      const token = (headers.Authorization || headers.authorization || "").replace(/^Bearer\s+/i, "");
      try {
        await moveStage({ clientId, token, oppRef: existing.ref, stage: { pipelineId, stageId, stageName: stage }, role: roleForStageName(stage), contactId });
      } catch (e) { console.error("opportunity move failed:", e.message); }
      return existing.id;
    }
    const moveRes = await fetch(`${GHL_V2}/opportunities/${existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ pipelineId, pipelineStageId: stageId }),
    });
    if (!moveRes.ok) console.error("GHL opportunity move failed:", moveRes.status, (await moveRes.text()).slice(0, 200));
    return existing.id;
  }
  if (!existing) {
    // CREATE through the provider-aware store: on provider='portal' it INSERTs an
    // opportunities row instead of POSTing to GHL; on provider='ghl' (every client
    // today) createOpp issues the exact same POST below, so this is byte-identical.
    // The store needs a client_id; if it can't be resolved (unknown academy) we
    // fall back to the raw GHL POST so nothing regresses. The auth token rides in
    // `headers.Authorization` (location API key here, OAuth token on the booking
    // flows) - extract it so createOpp's GHL branch uses the same credential.
    if (clientId) {
      const token = (headers.Authorization || headers.authorization || "").replace(/^Bearer\s+/i, "");
      try {
        const ref = await createOpp({
          clientId,
          token,
          locationId: ghlLocationId,
          contactId,
          stage: { pipelineId, stageId, stageName: stage },
          role: roleForStageName(stage),
          name: oppName,
        });
        return (ref && (ref.ghlOpportunityId || ref.id)) || null;
      } catch (e) {
        console.error("GHL opportunity create failed:", e.message);
        return existing?.id || null;
      }
    }
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
      `clients?id=eq.${client_id}&select=id,ghl_location_id,ghl_kpi_config,booking_provider,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
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
      `entry_points?client_id=eq.${client.id}&type=eq.website-form&key=eq.${encodeURIComponent(form_type)}&enabled=eq.true&select=id,offer_id,tags,pipeline_name,stage_name,field_map,ghl_workflow_id&limit=1`
    );
    const ep = eps?.[0];
    if (ep) {
      extraTags = ep.tags || [];
      fieldMap = ep.field_map || null;
      formWorkflowId = ep.ghl_workflow_id || null;
      if (ep.pipeline_name && ep.stage_name) {
        pipelineConfig = { pipeline: ep.pipeline_name, stage: ep.stage_name };
      }
      // Offer tie-in: the lead inherits lineage from its entry point (which
      // offer's funnel it came through). Best-effort; the lead is already saved.
      try {
        await sbReq(`website_leads?id=eq.${leadId}`, {
          method: "PATCH",
          body: JSON.stringify({ entry_point_id: ep.id, offer_id: ep.offer_id || null }),
        });
      } catch (e) { console.error("lead offer lineage stamp failed (non-fatal):", e.message); }
    }
  } catch (e) { console.error("entry_points lookup failed (non-fatal):", e.message); }

  // Contact provider: 'portal' academies mint leads in the portal store (no GHL
  // contact) - EXCEPT booking submissions on a booking_provider='ghl' academy,
  // which still need a real GHL contact for the GHL calendar appointment. Once
  // an academy's bookings run on the portal spine (booking_provider='portal'),
  // even booking submissions stay fully portal-native.
  const contactProv = await contactProvider(client.id);
  const bookingProv = client.booking_provider === "portal" ? "portal" : "ghl";
  const requireGhl = !!(booking?.calendar_id && booking?.start) && bookingProv !== "portal";

  let ghlStatus = "not-configured";
  let kpiContactId = null;
  if (ghlLocName && client.ghl_location_id) {
    let receipt;
    try {
      const ghlContactId = await pushToGhl(ghlLocName, client.ghl_location_id, { clientId: client.id, contactProv, requireGhl, name, email, phone, message, messageFieldId, formType: form_type, pipelineConfig, extraTags, fields, fieldMap });
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
          `entry_points?client_id=eq.${client.id}&type=eq.calendar&key=eq.${encodeURIComponent(booking.calendar_id)}&enabled=eq.true&select=id,label,pipeline_name,stage_name,ghl_workflow_id&limit=1`
        );
        if (!eps?.[0]) throw new Error("calendar not available");
        const calEp = eps[0];
        // OAuth headers power the GHL branch + downstream stage placement. On a
        // portal-booking academy they're best-effort: the registry-first stage
        // resolution and the portal opp store don't need GHL at all.
        let oauthHeaders = { Version: V2_VERSION, "Content-Type": "application/json", Accept: "application/json" };
        try {
          const oauthToken = await getClientGhlToken(client);
          oauthHeaders = { Authorization: `Bearer ${oauthToken}`, ...oauthHeaders };
        } catch (e) {
          if (bookingProv !== "portal") throw e;   // GHL booking can't proceed without a token
        }
        if (bookingProv === "portal") {
          // Book onto OUR slot via Luka's capacity-safe RPC (never a direct
          // insert). Resolve the chosen time to a schedule_slots row, scoped to
          // this calendar's "Group N" template family.
          const t = new Date(booking.start);
          if (isNaN(t.getTime())) throw new Error("invalid slot time");
          const slotRows = (await sbReq(
            `schedule_slots?tenant_id=eq.${client.id}&is_cancelled=eq.false&start_time=eq.${encodeURIComponent(t.toISOString())}&select=id,name&limit=10`
          )) || [];
          const groupMatch = /group\s*\d+/i.exec(calEp.label || "");
          const groupPrefix = groupMatch ? groupMatch[0].toLowerCase().replace(/\s+/g, " ") : null;
          const slot = slotRows.find(s => !groupPrefix || (s.name || "").toLowerCase().replace(/\s+/g, " ").includes(groupPrefix)) || slotRows[0];
          if (!slot) throw new Error("slot not found for chosen time");
          const rpcRes = await sbReq(`rpc/book_trial_slot`, {
            method: "POST",
            body: JSON.stringify({
              p_tenant_id: client.id,
              p_slot_id: slot.id,
              p_parent_name: name || null,
              p_parent_email: email ? email.toLowerCase() : null,
              p_athlete_name: (fields?.athlete_name || fields?.athlete || "").trim() || null,
              p_parent_phone: phone || null,
              p_athlete_dob: null,
              p_entry_point_id: calEp.id,
              p_offer_id: null,
              p_ghl_contact_id: receipt.ghl_contact_id,
              p_source: "website",
              p_metadata: { website_lead_id: leadId, calendar_key: booking.calendar_id, slot_name: slot.name },
            }),
          });
          const trialBookingId = typeof rpcRes === "string" ? rpcRes : (rpcRes && rpcRes.trial_booking_id) || null;
          if (!trialBookingId) throw new Error("trial booking failed");
          appointmentStatus = "booked";
          fields.trial_booking_id = trialBookingId;
          fields.booked_slot = booking.start;
          receipt.fields = fields;
        } else {
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
        }

        const routeCfg = client.ghl_kpi_config?.portal_entry_routing;
        if (routeCfg?.enabled) {
          // Portal routing ON: they booked, so cancel EVERY active sales sequence
          // (nurture / ghosted / contact_form / trial_form) - a lead who books
          // shouldn't keep getting drip nudges - and move the card to the scheduled
          // stage (Confirm bot owns it). No-key exit clears all active enrollments.
          try { await exitEnrollment({ clientId: client.id, contactId: receipt.ghl_contact_id, reason: "booked" }); } catch (_) {}
          if (routeCfg.pipeline && routeCfg.scheduled_stage) {
            try {
              await placeOpportunity(
                oauthHeaders, client.ghl_location_id, receipt.ghl_contact_id,
                { pipeline: routeCfg.pipeline, stage: routeCfg.scheduled_stage },
                `${name || email}`, true, client.id
              );
            } catch (e) { console.error("Booking portal route failed (non-fatal):", e.message); }
          }
        } else {
          if (calEp.ghl_workflow_id && contactProv !== "portal") {
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
                `${name || email}`, true, client.id
              );
            } catch (e) { console.error("Booking stage advance failed (non-fatal):", e.message); }
          }
        }
      } catch (e) {
        console.error("GHL appointment failed (lead saved):", e.message);
        fields.appointment_error = String(e.message).slice(0, 300);
        receipt.fields = fields;
      }
    }

    // 3. Receipt — stamp the lead row; never fail the request over it.
    // Also dual-write the portal-native contact (dormant store) and link it back
    // onto the lead via contact_id, so lead history is home even off GHL.
    if (receipt?.ghl_contact_id) {
      const portalContactId = await upsertPortalContact(client.id, receipt.ghl_contact_id, {
        name:   name || null,
        email:  email?.toLowerCase() || null,
        phone:  phone || null,
        source: "website-form",
      });
      if (portalContactId) {
        receipt.contact_id = portalContactId;
        // Close the write loop: land this form's custom-field values in the
        // portal (contact_field_values) in real time, keyed by custom_field_defs.
        await writePortalFieldValues(client.id, portalContactId, fieldMap, fields);
      }
    }
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

    // Form-step submission (no booking): route the lead. Portal routing (when ON)
    // places the card + enrols the portal automation; otherwise fall back to the
    // legacy GHL workflow enrol.
    if (kpiContactId && fields?.step !== "booking") {
      const routed = await maybePortalRoute(client, kpiContactId, form_type, { name, email });
      // GHL workflow fallback is meaningless for a 'portal' academy: its new
      // contacts are portal-minted uuids GHL has never heard of (enroll would
      // 404), and its outreach runs on portal automations.
      if (!routed && formWorkflowId && contactProv !== "portal") {
        await enrollInWorkflow(client, kpiContactId, formWorkflowId);
      }
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

// ── Portal-native entry routing (DORMANT until ghl_kpi_config.portal_entry_routing
// .enabled). When ON, the PORTAL owns the pipeline for new form fills instead of the
// GHL workflow: place the card in the configured stage + enrol the lead in the portal
// automation, and SKIP the legacy GHL workflow enrol (no double-touch). Flip ON per
// academy the moment its matching GHL "form filled" workflows are turned off.
//   contact form  -> contact_stage (e.g. Interested) + 👻 ghosted (immediately)
//   trial no-book  -> trial_stage   (e.g. Responded)  + 🏀 trial_followup (20-min timer)
// Returns true when it handled routing (caller then skips the GHL workflow enrol).
async function maybePortalRoute(client, contactId, formType, { name, email }) {
  const cfg = client.ghl_kpi_config?.portal_entry_routing;
  if (!cfg || !cfg.enabled || !contactId) return false;
  const isTrial = formType === "free-trial";
  const stage = isTrial ? cfg.trial_stage : cfg.contact_stage;
  // Each form gets its OWN dedicated first-touch INTRO automation, keyed by a FIXED
  // key (NOT derived from the landing stage). Seeds in the portal as approved:false,
  // so enrollContact is a no-op until the academy approves + turns it on (the engine
  // requires enabled+approved+>=1 enabled step). Defaults live in
  // api/form-intro-automations.js.
  //   contact form  -> contact_form intro (2-min SMS)
  //   trial no-book -> trial_form  intro (20-min SMS)
  const introKey = isTrial ? "trial_form" : "contact_form";
  // Whether the landing stage is owned by an AGENT (no stage automation). When it is,
  // we still leave an "Entry:" context note so the stage's bot (the Booking agent)
  // opens the conversation with context the moment the lead replies.
  const stageAutomation = isTrial ? cfg.trial_automation : cfg.contact_automation;
  if (cfg.pipeline && stage) {
    try {
      const token = await getClientGhlToken(client);
      const headers = { Authorization: `Bearer ${token}`, Version: V2_VERSION, "Content-Type": "application/json", Accept: "application/json" };
      await placeOpportunity(headers, client.ghl_location_id, contactId, { pipeline: cfg.pipeline, stage }, `${name || email}`, true, client.id);
    } catch (e) { console.error("portal route: place opp failed (non-fatal):", e.message); }
  }
  // Enrol the form's INTRO automation (the timed first touch). No-op until it's
  // enabled+approved with a step, so this stays DORMANT until the academy opts in.
  try {
    await enrollContact({ clientId: client.id, automationKey: introKey, contactId });
  } catch (e) { console.error("portal route: form-intro enroll failed (non-fatal):", e.message); }
  if (!stageAutomation) {
    // Agent-owned landing stage: drop an "Entry:" context note so the Booking agent
    // opens with context. contact-memory.js injects active agent_contact_notes into
    // the agent prompt; the opener detector pass in agent-approvals.js picks these up.
    const note = isTrial
      ? "Filled out the free-trial form but did not pick a time. Help them book a free trial."
      : "Filled out the contact form (general enquiry). Reach out and help them book a free trial.";
    try {
      await sbReq(`agent_contact_notes`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ client_id: client.id, ghl_contact_id: String(contactId), active: true, note: `Entry: ${note}`, created_by: "entry-routing" }]),
      });
    } catch (e) { console.error("portal route: entry note failed (non-fatal):", e.message); }
  }
  return true;
}

// KPI continuity: website leads land in ghl_funnel_events (raw.websiteForm)
// so the monthly KPI reader can count them once an era selects website forms
// (the post-GHL-native-forms world). Booking-step submissions are skipped —
// the form-step row already counted that person.
async function recordKpiLeadEvent(clientId, leadId, formType, fields, { name, email, phone, contactId }) {
  if (fields?.step === "booking") return;
  // KPI event log (Track A): the same lead lands in kpi_events - the table the
  // dashboard reads for portal academies and the sandbox imports into.
  await recordKpiEvent({
    clientId, step: "lead",
    ghlContactId: contactId || null, contactName: name || null,
    ref: `weblead:${leadId}`,
    meta: { form_type: formType, email: email ? email.toLowerCase() : null, phone: phone || null },
  });
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
