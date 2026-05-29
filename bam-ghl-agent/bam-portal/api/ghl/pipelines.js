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
async function ghl(method, path, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
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
  const cid = process.env.GHL_OAUTH_CLIENT_ID;
  const sec = process.env.GHL_OAUTH_CLIENT_SECRET;
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
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at` +
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
export default async function handler(req, res) {
  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  const academy = await loadAcademyAndToken(clientId, ctx, res);
  if (!academy) return;  // loadAcademyAndToken already sent the response
  const { client, token, locationId } = academy;

  // ── PATCH: move an opportunity to a new stage ─────────────
  if (req.method === "PATCH") {
    const oppId = req.query.opportunity_id;
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    if (!oppId)               return res.status(400).json({ error: "opportunity_id required" });
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

  return res.status(200).json({ pipelines: enriched, totals: {
    pipelines: enriched.length,
    opportunities: enriched.reduce((s, p) => s + p.opportunities.length, 0),
  } });
}
