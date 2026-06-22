import { withSentryApiRoute } from "./_sentry.js";
// V1.5 Contacts tab API.
//
//   GET  /api/contacts?client_id=&q=&tag=          search the synced mirror (fast)
//   GET  /api/contacts?action=custom-fields&client_id=   live GHL custom-field
//                                                        defs + has-data + suggestion
//   POST /api/contacts?action=set-athlete-fields&client_id=  { field_ids: [] }
//
// Search reads the ghl_contacts mirror (populated by cron-sync-contacts for V1.5
// academies). The setup talks to GHL live to list custom fields. Auth: Supabase
// JWT — staff or client_users membership for the academy.

const GHL_V2 = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION = "2021-07-28";
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!ur.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await ur.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && staff[0];
  const m = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(m) ? m.map(x => x.client_id) : [];
  return { isStaff: !!isStaff, clientIds };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function ghl(method, path, { token, body } = {}) {
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000));
  }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) { const e = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); e.status = res.status; throw e; }
  return json;
}
async function refreshGhlToken(client) {
  const clientId = (process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !client.ghl_refresh_token) throw new Error("GHL refresh not configured");
  const r = await fetch(GHL_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }) });
  const tok = await r.json();
  if (!r.ok || !tok?.access_token) throw new Error(tok?.error_description || "GHL token refresh failed");
  await sb(`clients?id=eq.${client.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString() }) });
  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}
async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (exp - Date.now() <= 60_000 && client.ghl_refresh_token) { try { return await refreshGhlToken(client); } catch (_) {} }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  if (process.env.GHL_LOCATIONS_JSON) {
    let locs; try { locs = JSON.parse(process.env.GHL_LOCATIONS_JSON); } catch (_) { locs = []; }
    if (Array.isArray(locs)) {
      const entry = locs.find(l => l.locationId === client.ghl_location_id) || locs.find(l => l.name && client.business_name && l.name.toLowerCase() === client.business_name.toLowerCase());
      if (entry && (entry.apiKeyV2 || entry.apiKey)) return { token: entry.apiKeyV2 || entry.apiKey, locationId: entry.locationId || client.ghl_location_id };
    }
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return token ? { token, locationId: client.ghl_location_id } : null;
}

// Does a GHL custom-field name look like an athlete's name field?
// athlete/player/child/etc + a name token (name / first / last / full).
function looksLikeAthleteName(name) {
  const n = String(name || "");
  const who = /\b(athlete|player|child|kid|son|daughter|camper|participant|student)\b/i.test(n);
  const nameTok = /\b(name|first|last|full)\b/i.test(n);
  return who && nameTok;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });

  // ── Batch auto-map athlete-name fields across every connected academy ──
  // GET /api/contacts?action=auto-map-athletes&key=<CRON_SECRET>[&dry=1][&overwrite=1]
  // For each v15 academy with a GHL token, scan custom fields and set
  // v15_config.athlete_name_field_ids to any field whose name looks like an
  // athlete name. Skips academies already mapped (unless &overwrite=1). dry=1
  // previews without writing.
  if (req.query.action === "auto-map-athletes") {
    const expected = (process.env.CRON_SECRET || "").trim();
    if (!expected || (req.query.key || "") !== expected) return res.status(401).json({ error: "unauthorized" });
    const dry = req.query.dry === "1";
    const overwrite = req.query.overwrite === "1";
    let clients;
    try { clients = await sb(`clients?v15_access=eq.true&ghl_access_token=not.is.null&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v15_config&order=business_name.asc`); }
    catch (e) { return res.status(500).json({ error: "DB: " + e.message }); }
    const out = [];
    for (const client of (Array.isArray(clients) ? clients : [])) {
      const row = { academy: client.business_name, action: null, matched: [] };
      const already = Array.isArray(client.v15_config?.athlete_name_field_ids) ? client.v15_config.athlete_name_field_ids.map(String) : [];
      if (already.length && !overwrite) { row.action = "skipped (already mapped)"; out.push(row); continue; }
      let creds; try { creds = await pickGhlToken(client); } catch (e) { row.action = "error: token " + e.message; out.push(row); continue; }
      if (!creds) { row.action = "error: not connected"; out.push(row); continue; }
      let defs;
      try { defs = (await ghl("GET", `/locations/${encodeURIComponent(creds.locationId)}/customFields`, { token: creds.token })).customFields || []; }
      catch (e) { row.action = "error: fields " + e.message; out.push(row); continue; }
      const hits = defs.filter(d => looksLikeAthleteName(d.name || d.fieldKey));
      row.matched = hits.map(d => d.name || d.fieldKey);
      if (!hits.length) { row.action = "no athlete-name field found"; out.push(row); continue; }
      if (dry) { row.action = "would set " + hits.length; out.push(row); continue; }
      const cfg = client.v15_config || {};
      cfg.athlete_name_field_ids = hits.map(d => String(d.id));
      try { await sb(`clients?id=eq.${client.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ v15_config: cfg }) }); row.action = "✓ set " + hits.length; }
      catch (e) { row.action = "error: save " + e.message; }
      out.push(row);
    }
    return res.status(200).json({ ok: true, dry, overwrite, academies: out, set: out.filter(r => String(r.action).startsWith("✓")).length, total: out.length });
  }

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  const action = req.query.action || "";
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  // ── POST: save the athlete-name custom-field mapping ──
  if (req.method === "POST" && action === "set-athlete-fields") {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const ids = Array.isArray(body.field_ids) ? body.field_ids.map(String) : [];
    const rows = await sb(`clients?id=eq.${clientId}&select=v15_config&limit=1`);
    const cfg = (Array.isArray(rows) && rows[0] && rows[0].v15_config) || {};
    cfg.athlete_name_field_ids = ids;
    await sb(`clients?id=eq.${clientId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ v15_config: cfg }) });
    return res.status(200).json({ ok: true, athlete_name_field_ids: ids });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "GET/POST only" });

  // ── GET ?action=custom-fields: live GHL custom-field defs + has-data + suggestion ──
  if (action === "custom-fields") {
    const rows = await sb(`clients?id=eq.${clientId}&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v15_config&limit=1`);
    const client = Array.isArray(rows) && rows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    let creds; try { creds = await pickGhlToken(client); } catch (e) { return res.status(500).json({ error: `GHL token: ${e.message}` }); }
    if (!creds) return res.status(400).json({ error: "Academy not connected to GHL." });
    const { token, locationId } = creds;
    try {
      const defs = (await ghl("GET", `/locations/${encodeURIComponent(locationId)}/customFields`, { token })).customFields || [];
      // Sample up to 100 contacts to learn which fields actually have data.
      const sample = (await ghl("GET", `/contacts/?${new URLSearchParams({ locationId, limit: "100" })}`, { token }));
      const sampleContacts = sample?.contacts || sample?.data || [];
      const withData = new Set();
      for (const c of sampleContacts) {
        for (const f of (c.customFields || c.customField || [])) {
          const v = f && (f.value ?? f.field_value ?? f.fieldValue);
          if (f && f.id != null && v != null && String(v).trim()) withData.add(String(f.id));
        }
      }
      const current = Array.isArray(client.v15_config?.athlete_name_field_ids) ? client.v15_config.athlete_name_field_ids.map(String) : [];
      const fields = defs.map(d => {
        const id = String(d.id);
        const name = d.name || d.fieldKey || id;
        const hasData = withData.has(id);
        // Strong = clearly an athlete/player/child name field; weak = mentions
        // athlete/player/child/etc. anywhere.
        const strong = /athlete\s*(full\s*)?name|player\s*(full\s*)?name|child\s*name|kid\s*name|name\s*of\s*(athlete|player|child)/i.test(name);
        const weak = /\b(athlete|player|child|kid|son|daughter|camper|participant)\b/i.test(name);
        const suggested = hasData && strong;
        // Sort score: athlete-like first, then has-data, then the rest.
        const score = (strong ? 4 : 0) + (weak ? 2 : 0) + (hasData ? 1 : 0);
        return { id, name, hasData, suggested, score };
      });
      // Most-likely (athlete-sounding) fields bubble to the top.
      fields.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
      // If never configured, default the selection to the suggestions.
      const selected = current.length ? current : fields.filter(f => f.suggested).map(f => f.id);
      return res.status(200).json({ fields, selected });
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
  }

  // ── GET (default): search the synced mirror ──
  const q = (req.query.q || "").replace(/[(),*%]/g, " ").trim();
  const tag = (req.query.tag || "").trim();
  let path = `ghl_contacts?client_id=eq.${encodeURIComponent(clientId)}` +
    `&select=id,ghl_contact_id,name,athlete_name,email,phone,tags` +
    `&order=name.asc.nullslast&limit=1000`;
  if (q) {
    const term = encodeURIComponent(q);
    path += `&or=(name.ilike.*${term}*,athlete_name.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${term}*)`;
  }
  if (tag) path += `&tags=cs.${encodeURIComponent(`{"${tag.replace(/"/g, "")}"}`)}`;
  try {
    const contacts = await sb(path);
    // Real (lettered) names first; phone-only / nameless leads sink to the
    // bottom (otherwise "(416)…" names sort above letters and fill the top).
    const named = (c) => !!(c && c.name && /[a-z]/i.test(c.name));
    (contacts || []).sort((a, b) => (named(b) ? 1 : 0) - (named(a) ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")));
    return res.status(200).json({ contacts: contacts || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
