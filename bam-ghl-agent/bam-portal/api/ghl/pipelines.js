import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Per-academy GHL Pipelines (kanban + moves)
//
//   GET   /api/ghl/pipelines?client_id=<uuid>
//     → all pipelines + stages + opportunities per pipeline, with each
//       opportunity tagged member/lead by cross-referencing members table.
//
//   PATCH /api/ghl/pipelines?client_id=<uuid>&opportunity_id=<id>
//     body: { pipeline_id, stage_id }
//     → moves the opportunity to a new stage (calls GHL PUT
//       /opportunities/<id>).
//
//   POST  /api/ghl/pipelines/convert?client_id=<uuid>
//     body: { opportunity_id }
//     → creates a member row from the opportunity's contact info, status
//       'payment_method_required'. Idempotent on (athlete_name, parent_email).
//
// Auth: Supabase JWT, scoped to client_users membership for client_id.
// Token: per-academy OAuth (clients.ghl_access_token, auto-refresh).

const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();

  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && staff[0];

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// ── GHL helpers ─────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ghl(method, path, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  // Retry on GHL rate-limit (429) with backoff — respects Retry-After if sent.
  let res, text;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    const wait = ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000);
    await sleep(wait);
  }
  text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function refreshGhlToken(client) {
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec) throw new Error("GHL_OAUTH_CLIENT_ID/SECRET not configured");
  if (!client.ghl_refresh_token) throw new Error("academy has no GHL refresh_token");
  const tokenRes = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cid, client_secret: sec,
      grant_type: "refresh_token",
      refresh_token: client.ghl_refresh_token,
      user_type: "Location",
    }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok || !tok?.access_token) {
    throw new Error(tok?.error_description || tok?.error || "GHL token refresh failed");
  }
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ghl_access_token: tok.access_token,
      ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token,
      ghl_token_expires_at: expiresAt,
    }),
  });
  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}

async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (exp - Date.now() <= 60_000 && client.ghl_refresh_token) {
      try { return await refreshGhlToken(client); } catch (_) {}
    }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  if (process.env.GHL_LOCATIONS_JSON) {
    let locs;
    try { locs = JSON.parse(process.env.GHL_LOCATIONS_JSON); } catch (_) { locs = []; }
    if (Array.isArray(locs)) {
      const entry =
        locs.find(l => l.locationId && l.locationId === client.ghl_location_id) ||
        locs.find(l => l.name && client.business_name && l.name.toLowerCase() === client.business_name.toLowerCase());
      if (entry && (entry.apiKeyV2 || entry.apiKey)) {
        return { token: entry.apiKeyV2 || entry.apiKey, locationId: entry.locationId || client.ghl_location_id };
      }
    }
  }
  const tok = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return tok ? { token: tok, locationId: client.ghl_location_id } : null;
}

async function loadAcademyAndToken(clientId, ctx, res) {
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) {
    res.status(403).json({ error: "not your academy" });
    return null;
  }
  const rows = await sb(
    `clients?id=eq.${clientId}` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_kpi_config` +
    `&limit=1`
  );
  const client = Array.isArray(rows) && rows[0];
  if (!client) { res.status(404).json({ error: "academy not found" }); return null; }
  if (!client.ghl_location_id && !client.ghl_access_token) {
    res.status(400).json({ error: "Academy not connected to GHL.", hint: "Click 'Connect GHL' on Members tab." });
    return null;
  }
  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { res.status(500).json({ error: `GHL token refresh: ${e.message}` }); return null; }
  if (!creds) { res.status(500).json({ error: "GHL not configured for this academy." }); return null; }
  return { client, ...creds };
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────
async function handler(req, res) {
  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  const academy = await loadAcademyAndToken(clientId, ctx, res);
  if (!academy) return;  // loadAcademyAndToken already sent the response
  const { client, token, locationId } = academy;

  // ── PATCH: move an opportunity to a new stage, or set its status ──
  if (req.method === "PATCH") {
    const oppId = req.query.opportunity_id;
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    if (!oppId) return res.status(400).json({ error: "opportunity_id required" });

    // Status-only update (e.g. mark won/lost from the Done Trial stage).
    if (body.status && !body.stage_id) {
      const allowed = ["open", "won", "lost", "abandoned"];
      if (!allowed.includes(body.status)) return res.status(400).json({ error: "invalid status" });
      try {
        const out = await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, {
          token, body: { status: body.status },
        });
        // V1.5: record the outcome + free-text reason (status 'open' = an undo).
        const cid = req.query.client_id;
        if (cid && body.status !== "open") {
          await sb(`pipeline_outcomes`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{ client_id: cid, opportunity_id: oppId, status: body.status, reason: (body.reason || "").toString().trim() || null }]),
          }).catch(() => {});
        }
        return res.status(200).json({ ok: true, opportunity_id: oppId, status: body.status, raw: out });
      } catch (e) {
        return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
      }
    }

    if (!body.pipeline_id)    return res.status(400).json({ error: "pipeline_id required in body" });
    if (!body.stage_id)       return res.status(400).json({ error: "stage_id required in body" });
    try {
      const out = await ghl("PUT", `/opportunities/${encodeURIComponent(oppId)}`, {
        token,
        body: { pipelineId: body.pipeline_id, pipelineStageId: body.stage_id },
      });
      return res.status(200).json({ ok: true, opportunity_id: oppId, new_stage_id: body.stage_id, raw: out });
    } catch (e) {
      return res.status(e.status || 502).json({ error: `GHL: ${e.message}`, detail: e.body || null });
    }
  }

  // ── POST ?action=convert: create a member from an opportunity ──
  if (req.method === "POST" && req.query.action === "convert") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const oppId = body.opportunity_id || req.query.opportunity_id;
    if (!oppId) return res.status(400).json({ error: "opportunity_id required" });

    // Fetch opportunity to get the contact
    let opp;
    try { opp = await ghl("GET", `/opportunities/${encodeURIComponent(oppId)}`, { token }); }
    catch (e) { return res.status(e.status || 502).json({ error: `GHL fetch opp: ${e.message}` }); }
    const oppObj = opp.opportunity || opp;
    const contactId = oppObj.contactId || oppObj.contact?.id;
    if (!contactId) return res.status(400).json({ error: "opportunity has no contact" });

    let contact;
    try { contact = await ghl("GET", `/contacts/${encodeURIComponent(contactId)}`, { token }); }
    catch (e) { return res.status(e.status || 502).json({ error: `GHL fetch contact: ${e.message}` }); }
    const c = contact.contact || contact;

    const parentName  = c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || null;
    const parentEmail = (c.email || "").toLowerCase().trim() || null;
    const parentPhone = c.phone || null;

    // Idempotent: skip if (athlete_name, parent_email) row already exists.
    // Athlete name is taken from opportunity.name or contact.contactName.
    const athleteName = oppObj.name || parentName || "(unnamed athlete)";
    if (parentEmail) {
      const exists = await sb(
        `members?client_id=eq.${clientId}` +
        `&parent_email=eq.${encodeURIComponent(parentEmail)}` +
        `&athlete_name=eq.${encodeURIComponent(athleteName)}` +
        `&select=id,status&limit=1`
      );
      if (Array.isArray(exists) && exists[0]) {
        return res.status(200).json({ ok: true, duplicate: true, member: exists[0] });
      }
    }

    const inserted = await sb(`members?select=*`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        client_id:      clientId,
        athlete_name:   athleteName,
        parent_name:    parentName,
        parent_email:   parentEmail,
        parent_phone:   parentPhone,
        ghl_contact_id: contactId,
        status:         "payment_method_required",
        joined_date:    new Date().toISOString().slice(0, 10),
        created_at:     nowIso(),
        updated_at:     nowIso(),
      }]),
    });
    const member = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;

    // Audit
    try {
      await sb(`member_audit_log`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          client_id:    clientId,
          member_id:    member?.id || null,
          action_type:  "convert-from-pipeline",
          args:         { opportunity_id: oppId, ghl_contact_id: contactId },
          performed_by_name: ctx.staff?.name || ctx.user?.email || null,
        }]),
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, member });
  }

  // ── POST ?action=enroll-workflow: drop the opportunity's contact into the
  // academy's configured nudge automation (e.g. the summer special). The
  // workflow id is read from config server-side so the UI never needs it. ──
  if (req.method === "POST" && req.query.action === "enroll-workflow") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const oppId = body.opportunity_id || req.query.opportunity_id;
    const isGhosted = body.source === "ghosted";
    let workflowId = body.workflow_id;
    // Ghosted automation is configured per-academy on the training offer
    // (offers.data.ghosted_workflow), same place as missed_trial_workflow.
    if (!workflowId && isGhosted) {
      try {
        const offers = await sb(`offers?client_id=eq.${encodeURIComponent(client.id)}&type=eq.training&select=data&order=sort_order.asc&limit=1`);
        workflowId = ((offers && offers[0] && offers[0].data && offers[0].data.ghosted_workflow) || "").trim();
      } catch (_) { /* fall through to error below */ }
    }
    if (!workflowId) workflowId = client.ghl_kpi_config?.summer_special_workflow_id;
    if (!workflowId) {
      return res.status(400).json(isGhosted
        ? { error: "No ghosted automation set up yet.", hint: "Pick a Ghosted automation on the training offer's Sales step (offers.data.ghosted_workflow)." }
        : { error: "No automation configured for this academy yet.", hint: "Set ghl_kpi_config.summer_special_workflow_id." });
    }

    // Resolve the contact: explicit contact_id, else fetch it from the opportunity.
    let contactId = body.contact_id;
    if (!contactId) {
      if (!oppId) return res.status(400).json({ error: "opportunity_id or contact_id required" });
      let opp;
      try { opp = await ghl("GET", `/opportunities/${encodeURIComponent(oppId)}`, { token }); }
      catch (e) { return res.status(e.status || 502).json({ error: `GHL fetch opp: ${e.message}` }); }
      const oppObj = opp.opportunity || opp;
      contactId = oppObj.contactId || oppObj.contact?.id;
    }
    if (!contactId) return res.status(400).json({ error: "no contact for this opportunity" });

    // GHL rejects a trailing 'Z' on eventStartTime — send an explicit +00:00 offset.
    const eventStartTime = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
    try {
      await ghl("POST", `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {
        token, body: { eventStartTime },
      });
    } catch (e) {
      return res.status(e.status || 502).json({ error: `GHL enroll: ${e.message}`, detail: e.body || null });
    }
    return res.status(200).json({ ok: true, contact_id: contactId, workflow_id: workflowId });
  }

  // ── GET: list pipelines + stages + opportunities ───────────
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });

  // 1. Pull pipelines (lightweight call)
  let pipelinesResp;
  try {
    pipelinesResp = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  } catch (e) {
    return res.status(e.status || 502).json({ error: `GHL pipelines: ${e.message}`, detail: e.body || null });
  }
  const pipelines = pipelinesResp.pipelines || pipelinesResp.data || [];

  // 2. For each pipeline, pull opportunities (capped at 100 per pipeline for now)
  //    GHL search endpoint:  GET /opportunities/search?location_id=XXX&pipeline_id=YYY&limit=100
  const enriched = await Promise.all(pipelines.map(async (p) => {
    let opps = [];
    try {
      const params = new URLSearchParams({
        location_id: locationId,
        pipeline_id: p.id,
        limit:       "100",
      });
      const r = await ghl("GET", `/opportunities/search?${params}`, { token });
      opps = r.opportunities || r.data || [];
    } catch (_) { opps = []; }

    return {
      id:     p.id,
      name:   p.name,
      stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position })),
      opportunities: opps.map(o => ({
        id:           o.id,
        name:         o.name || "",
        contactId:    o.contactId || o.contact?.id || null,
        contact: {
          name:  o.contact?.name || o.contactName || "Unknown",
          email: (o.contact?.email || "").toLowerCase() || null,
          phone: o.contact?.phone || null,
        },
        monetaryValue: o.monetaryValue || 0,
        status:       o.status || "open",
        stageId:      o.pipelineStageId || o.stageId || null,
        lastStatusChangeAt: o.lastStatusChangeAt || null,
        lastStageChangeAt:  o.lastStageChangeAt  || null,
        updatedAt:    o.updatedAt || null,
      })),
    };
  }));

  // 3. Cross-reference each opportunity's contact with members table.
  //    A 'member' badge appears when we can match by email or phone or
  //    saved ghl_contact_id.
  const members = await sb(
    `members?client_id=eq.${clientId}` +
    `&select=id,athlete_name,parent_name,parent_email,parent_phone,ghl_contact_id,status`
  ).catch(() => []);
  const memberList = Array.isArray(members) ? members : [];
  const byContactId = new Map();
  const byEmail     = new Map();
  const byPhone     = new Map();
  for (const m of memberList) {
    if (m.ghl_contact_id) byContactId.set(m.ghl_contact_id, m);
    if (m.parent_email)   byEmail.set(m.parent_email.toLowerCase(), m);
    if (m.parent_phone)   byPhone.set(m.parent_phone, m);
  }

  for (const p of enriched) {
    for (const o of p.opportunities) {
      const m =
        (o.contactId            && byContactId.get(o.contactId)) ||
        (o.contact.email        && byEmail.get(o.contact.email)) ||
        (o.contact.phone        && byPhone.get(o.contact.phone)) ||
        null;
      o.member = m ? { id: m.id, athlete_name: m.athlete_name, status: m.status } : null;
    }
  }

  // 4. Enrich with athlete name + booked trial date from our own website_leads
  //    (we own this data — avoids a per-contact GHL call per card). Rows come
  //    newest-first, so the first row seen per contact is the latest.
  const wlRows = await sb(
    `website_leads?client_id=eq.${clientId}&ghl_contact_id=not.is.null` +
    `&select=ghl_contact_id,fields,created_at&order=created_at.desc&limit=2000`
  ).catch(() => []);
  const leadByContact = new Map();
  for (const r of (Array.isArray(wlRows) ? wlRows : [])) {
    const cid = r.ghl_contact_id;
    if (!cid) continue;
    const f = r.fields || {};
    const cur = leadByContact.get(cid) || { athlete: null, trialDate: null, formFilledAt: null };
    if (!cur.athlete) {
      cur.athlete = f.athlete || `${f.athlete_first || ""} ${f.athlete_last || ""}`.trim() || null;
    }
    if (!cur.trialDate && f.booked_slot) cur.trialDate = f.booked_slot;
    // Rows are newest-first, so the last seen per contact is the earliest = the
    // original form fill.
    if (r.created_at) cur.formFilledAt = r.created_at;
    leadByContact.set(cid, cur);
  }
  for (const p of enriched) {
    for (const o of p.opportunities) {
      const led = o.contactId ? leadByContact.get(o.contactId) : null;
      o.athlete = led?.athlete || null;
      o.trialDate = led?.trialDate || null;
      o.formFilledAt = led?.formFilledAt || null;
    }
  }

  // 4b. Booked-trial dates from the ACTUAL GHL appointments on the client's
  //     calendar entry points — the most authoritative source. A few calls
  //     (one per calendar), not per-contact. Also collect which pipeline
  //     stages are the trial-booking stages so the UI can flag date-less
  //     cards that should have one.
  const trialStageSet = new Set(); // `${pipelineNameLower}|||${stageNameLower}`
  try {
    const calEps = await sb(
      `entry_points?client_id=eq.${clientId}&type=eq.calendar&enabled=eq.true&select=key,pipeline_name,stage_name`
    ).catch(() => []);
    for (const ep of (Array.isArray(calEps) ? calEps : [])) {
      if (ep.pipeline_name && ep.stage_name) {
        trialStageSet.add(`${ep.pipeline_name.toLowerCase()}|||${ep.stage_name.toLowerCase()}`);
      }
    }
    const apptByContact = new Map();
    const now = Date.now();
    const winStart = now - 120 * 86400000, winEnd = now + 120 * 86400000;
    for (const ep of (Array.isArray(calEps) ? calEps : [])) {
      try {
        const ev = await ghl("GET",
          `/calendars/events?locationId=${encodeURIComponent(locationId)}&calendarId=${encodeURIComponent(ep.key)}&startTime=${winStart}&endTime=${winEnd}`,
          { token });
        for (const e of (ev.events || [])) {
          const cid = e.contactId;
          if (!cid || !e.startTime || e.appointmentStatus === "cancelled") continue;
          const prev = apptByContact.get(cid);
          if (!prev || new Date(e.startTime) > new Date(prev)) apptByContact.set(cid, e.startTime);
        }
      } catch (_) {}
    }
    for (const p of enriched) for (const o of p.opportunities) {
      if (!o.trialDate && o.contactId && apptByContact.has(o.contactId)) {
        o.trialDate = apptByContact.get(o.contactId);
      }
    }
  } catch (_) {}

  // Mark which stages expect a trial date (so the UI can flag empties orange).
  for (const p of enriched) for (const st of p.stages) {
    st.expectsTrial = trialStageSet.has(`${(p.name || "").toLowerCase()}|||${(st.name || "").toLowerCase()}`);
  }

  // 4c. Post-trial reviews (our DB) → attach trainer to each opportunity so
  //     the assigned coach shows on the card.
  let trainerOptions = [];
  try {
    const reviews = await sb(
      `post_trial_reviews?client_id=eq.${clientId}&select=opportunity_id,trainer,good_fit,showed_up,notes,created_at`
    ).catch(() => []);
    const byOpp = new Map();
    for (const r of (Array.isArray(reviews) ? reviews : [])) byOpp.set(r.opportunity_id, r);
    for (const p of enriched) for (const o of p.opportunities) {
      const rv = byOpp.get(o.id);
      o.trainer = rv?.trainer || null;
      o.goodFit = rv ? rv.good_fit : null;
      o.review = rv ? { good_fit: rv.good_fit, showed_up: rv.showed_up, trainer: rv.trainer, notes: rv.notes, created_at: rv.created_at } : null;
    }
  } catch (_) {}

  // Trainer dropdown options from the "Lead Sales Person" custom field.
  try {
    const cf = (await ghl("GET", `/locations/${encodeURIComponent(locationId)}/customFields`, { token })).customFields || [];
    const lsp = cf.find(f => /lead sales person/i.test(f.name || "")) || cf.find(f => /sales person|trainer/i.test(f.name || ""));
    if (lsp) trainerOptions = lsp.picklistOptions || lsp.options || [];
  } catch (_) {}

  // 5. For cards still missing an athlete name or trial date (legacy
  //    GHL-native contacts, not from the website), resolve from the contact's
  //    GHL custom fields. Field ids are discovered by name once, then contacts
  //    are fetched in throttled batches (bounded so a huge board can't blow the
  //    rate limit or the function timeout).
  try {
    const missing = [];
    for (const p of enriched) for (const o of p.opportunities) {
      if ((!o.athlete || !o.trialDate) && o.contactId) missing.push(o);
    }
    if (missing.length) {
      let athleteFull = null, athleteFirst = null, athleteLast = null, trialDateField = null;
      try {
        const cf = await ghl("GET", `/locations/${encodeURIComponent(locationId)}/customFields`, { token });
        for (const f of (cf.customFields || [])) {
          const n = (f.name || "").toLowerCase();
          if (n.includes("athlete") && n.includes("full")) athleteFull = f.id;
          else if (n.includes("athlete") && n.includes("first")) athleteFirst = f.id;
          else if (n.includes("athlete") && n.includes("last")) athleteLast = f.id;
          else if (n.includes("free trial date") || (n.includes("trial") && n.includes("date"))) trialDateField = f.id;
        }
      } catch (_) {}

      if (athleteFull || athleteFirst || trialDateField) {
        const CAP = 150, BATCH = 8;
        const targets = missing.slice(0, CAP);
        const readField = (fields, id) => { if (!id) return null; const m = fields.find(x => (x.id || x.key) === id); return m ? (Array.isArray(m.value) ? m.value.join(" ") : m.value) : null; };
        const readAthlete = (fields) => {
          const full = readField(fields, athleteFull);
          if (full && String(full).trim()) return String(full).trim();
          const combined = `${readField(fields, athleteFirst) || ""} ${readField(fields, athleteLast) || ""}`.trim();
          return combined || null;
        };
        for (let i = 0; i < targets.length; i += BATCH) {
          const slice = targets.slice(i, i + BATCH);
          await Promise.all(slice.map(async (o) => {
            try {
              const cr = await ghl("GET", `/contacts/${encodeURIComponent(o.contactId)}`, { token });
              const fields = (cr.contact || cr).customFields || (cr.contact || cr).customField || [];
              if (!o.athlete) o.athlete = readAthlete(fields) || null;
              if (!o.trialDate) { const td = readField(fields, trialDateField); if (td) o.trialDate = td; }
            } catch (_) { /* leave as-is */ }
          }));
        }
      }
    }
  } catch (_) { /* non-fatal — cards just show parent-only */ }

  return res.status(200).json({ pipelines: enriched, trainers: trainerOptions, location_id: locationId, totals: {
    pipelines: enriched.length,
    opportunities: enriched.reduce((s, p) => s + p.opportunities.length, 0),
  } });
}

export default withSentryApiRoute(handler);
