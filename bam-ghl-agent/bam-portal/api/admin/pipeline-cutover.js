import { withSentryApiRoute } from "../_sentry.js";
import { ANY_STAFF_ROLES, hasRole } from "../_roles.js";
import { shadowUpsertOpportunity } from "../agent/_store.js";

// Vercel Serverless Function - Pipeline cutover control (off-GHL, Effort E).
//
// The safe, BAM-STAFF-ONLY surface that cuts an academy's sales board from GHL
// over to the portal-native opportunities store, and lets staff verify or roll
// back. ADDITIVE + DORMANT: nothing here runs until a staff member calls it, and
// every academy stays pipeline_provider='ghl' (the default) until an explicit
// flip. V1/V1.5 academies are never touched. See
// docs/off-ghl-pipeline-store-design.md.
//
//   GET  /api/admin/pipeline-cutover?action=status&client_id=<uuid>
//     -> pipeline_shadow, pipeline_provider, portal open-opp counts by stage_role,
//        and registry coverage (which of the 7 roles have a pipeline_stages row).
//
//   GET  /api/admin/pipeline-cutover?action=reconcile&client_id=<uuid>
//     -> READ-ONLY drift report: live GHL open opps vs the portal shadow store.
//        missing / extra / mismatched-stage rows. The gate staff check before flip.
//
//   POST /api/admin/pipeline-cutover?action=set-shadow&client_id=<uuid>
//     body: { on: true|false }   -> set clients.pipeline_shadow (dual-write toggle).
//
//   POST /api/admin/pipeline-cutover?action=flip&client_id=<uuid>
//     body: { provider: 'portal'|'ghl', force?: true }
//     -> set clients.pipeline_provider. GUARD: refuses provider='portal' unless
//        shadow has been ON and a fresh reconcile is clean (or force=true). Rolling
//        back to 'ghl' is always allowed and instant.
//
//   GET  /api/admin/pipeline-cutover?action=dump&client_id=<uuid>
//     -> every open GHL card with pipeline + stage NAMES - the raw material the
//        /ghl-pipeline-import runbook hands Claude to classify per-card into a
//        preset stage role (we import their PEOPLE, not their pipeline shape).
//
//   POST /api/admin/pipeline-cutover?action=import-cards&client_id=<uuid>
//     body: { cards: [{ id, role, contact_id?, name?, phone?, monetary_value?,
//             last_stage_change_at?, pipeline_id? }], dry_run?: true }
//     -> upserts each card into the opportunities store at the given preset
//        stage role (source 'ghl-import'). Idempotent (per ghl_opportunity_id).
//
// Auth: Supabase JWT; the caller MUST be BAM staff (a row in `staff`). Academy
// owners / client teammates can NOT reach this - it is staff-operations only.

const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// The 7 stage roles the registry + opportunities store track (see the E1 migration).
const ROLES = [
  "responded", "ghosted", "interested", "scheduled_trial", "done_trial",
  "nurture", "won", "unqualified",
];

// ─────────────────────────────────────────────────────────
// Supabase (service role)
// ─────────────────────────────────────────────────────────
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
    const err = new Error(`Supabase ${res.status}: ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ─────────────────────────────────────────────────────────
// Auth - BAM STAFF ONLY (no client-owner / teammate path)
// ─────────────────────────────────────────────────────────
async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  if (!user?.id) throw Object.assign(new Error("invalid token"), { status: 401 });

  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role&limit=1`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role&limit=1`);
  }
  const staff = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;
  // BAM-staff-only: must have a staff row whose role is a known staff role.
  if (!staff || !hasRole(staff.role, ANY_STAFF_ROLES)) {
    throw Object.assign(new Error("BAM staff only"), { status: 403 });
  }
  return { user, staff };
}

// ─────────────────────────────────────────────────────────
// Client flags - tolerant of pipeline_shadow not existing yet
// (the sibling dual-write migration owns that column).
// ─────────────────────────────────────────────────────────
async function loadClientFlags(clientId) {
  const base = "id,business_name,pipeline_provider";
  try {
    const rows = await sb(`clients?id=eq.${clientId}&select=${base},pipeline_shadow&limit=1`);
    const c = Array.isArray(rows) && rows[0];
    if (!c) return null;
    return { ...c, _shadowColumn: true };
  } catch (e) {
    // 42703 = undefined_column. The shadow column has not shipped yet; degrade
    // gracefully so status/reconcile still work (shadow reported as unavailable).
    const msg = String(e.body || e.message || "");
    if (!/pipeline_shadow|42703|column/i.test(msg)) throw e;
    const rows = await sb(`clients?id=eq.${clientId}&select=${base}&limit=1`);
    const c = Array.isArray(rows) && rows[0];
    if (!c) return null;
    return { ...c, pipeline_shadow: false, _shadowColumn: false };
  }
}

// ─────────────────────────────────────────────────────────
// GHL token (per-academy OAuth → env fallback). Same logic as
// api/ghl/pipelines.js, kept local so this endpoint is self-contained.
// ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ghl(method, path, { token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version:       V2_VERSION,
    Accept:        "application/json",
    "Content-Type": "application/json",
  };
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`);
    err.status = res.status; err.body = json;
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

async function loadGhlCreds(clientId) {
  const rows = await sb(
    `clients?id=eq.${clientId}` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
  );
  const client = Array.isArray(rows) && rows[0];
  if (!client) return { error: { status: 404, message: "academy not found" } };
  if (!client.ghl_location_id && !client.ghl_access_token) {
    return { error: { status: 400, message: "Academy not connected to GHL." } };
  }
  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { return { error: { status: 500, message: `GHL token refresh: ${e.message}` } }; }
  if (!creds) return { error: { status: 500, message: "GHL not configured for this academy." } };
  return { client, ...creds };
}

// Pull ALL open opportunities for an academy across every pipeline (cursor-
// paginated, same shape as the board reader). Returns [{ id, stageId, name }].
async function fetchAllOpenGhlOpps({ token, locationId }) {
  const pipelinesResp = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = pipelinesResp.pipelines || pipelinesResp.data || [];
  const out = [];
  for (const p of pipelines) {
    let startAfter, startAfterId;
    for (let page = 0; page < 8; page++) {            // hard cap ~800 open/pipeline
      const params = new URLSearchParams({ location_id: locationId, pipeline_id: p.id, status: "open", limit: "100" });
      if (startAfter)   params.set("startAfter", String(startAfter));
      if (startAfterId) params.set("startAfterId", String(startAfterId));
      let r;
      try { r = await ghl("GET", `/opportunities/search?${params}`, { token }); }
      catch (_) { break; }
      const batch = r.opportunities || r.data || [];
      for (const o of batch) {
        out.push({ id: o.id, stageId: o.pipelineStageId || o.stageId || null, name: o.name || o.contact?.name || "" });
      }
      const meta = r.meta || {};
      startAfter = meta.startAfter; startAfterId = meta.startAfterId;
      if (batch.length < 100 || (!startAfter && !startAfterId)) break;
    }
  }
  return out;
}

// Rich board dump for the /ghl-pipeline-import runbook: pipelines with stage
// names + every open opp with enough context (name, contact, stage name, last
// stage change) for a per-card classification into preset roles.
async function fetchBoardDump({ token, locationId }) {
  const pipelinesResp = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { token });
  const pipelines = pipelinesResp.pipelines || pipelinesResp.data || [];
  const stageName = new Map();
  for (const p of pipelines) for (const s of (p.stages || [])) stageName.set(s.id, { stage: s.name, pipeline: p.name, pipeline_id: p.id });
  const cards = [];
  for (const p of pipelines) {
    let startAfter, startAfterId;
    for (let page = 0; page < 8; page++) {
      const params = new URLSearchParams({ location_id: locationId, pipeline_id: p.id, status: "open", limit: "100" });
      if (startAfter)   params.set("startAfter", String(startAfter));
      if (startAfterId) params.set("startAfterId", String(startAfterId));
      let r;
      try { r = await ghl("GET", `/opportunities/search?${params}`, { token }); }
      catch (_) { break; }
      const batch = r.opportunities || r.data || [];
      for (const o of batch) {
        const sid = o.pipelineStageId || o.stageId || null;
        const loc = (sid && stageName.get(sid)) || {};
        cards.push({
          id: o.id,
          name: o.name || (o.contact && o.contact.name) || "",
          contact_id: o.contactId || (o.contact && o.contact.id) || null,
          contact_name: (o.contact && o.contact.name) || null,
          phone: (o.contact && o.contact.phone) || null,
          email: (o.contact && o.contact.email) || null,
          stage_id: sid,
          stage_name: loc.stage || null,
          pipeline_name: loc.pipeline || null,
          pipeline_id: loc.pipeline_id || p.id,
          monetary_value: o.monetaryValue || 0,
          last_stage_change_at: o.lastStageChangeAt || o.updatedAt || null,
          created_at: o.createdAt || o.dateAdded || null,
        });
      }
      const meta = r.meta || {};
      startAfter = meta.startAfter; startAfterId = meta.startAfterId;
      if (batch.length < 100 || (!startAfter && !startAfterId)) break;
    }
  }
  return {
    pipelines: pipelines.map(p => ({ id: p.id, name: p.name, stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position })) })),
    cards,
  };
}

async function actionDump(clientId) {
  const acc = await loadGhlCreds(clientId);
  if (acc.error) return { error: acc.error };
  const board = await fetchBoardDump(acc);
  return { ok: true, roles: ROLES, ...board, total_cards: board.cards.length };
}

// import-cards - the runbook's write leg. Each card lands in the opportunities
// store at the CLASSIFIED preset role. Idempotent per ghl_opportunity_id.
async function actionImportCards(clientId, body) {
  const cards = Array.isArray(body.cards) ? body.cards : [];
  if (!cards.length) return { error: { status: 400, message: "cards required: [{ id, role, ... }]" } };
  const bad = cards.filter(c => !c || !c.id || !ROLES.includes(c.role));
  if (bad.length) return { error: { status: 400, message: `${bad.length} card(s) missing id or with an unknown role (allowed: ${ROLES.join(", ")})` } };
  if (body.dry_run) {
    const byRole = {};
    for (const c of cards) byRole[c.role] = (byRole[c.role] || 0) + 1;
    return { ok: true, dry_run: true, cards: cards.length, by_role: byRole };
  }
  let written = 0, failed = 0;
  for (const c of cards) {
    const ok = await shadowUpsertOpportunity(clientId, {
      ghlOpportunityId: c.id,
      ghlContactId: c.contact_id || null,
      contactName: c.contact_name || c.name || null,
      contactPhone: c.phone || null,
      stageRole: c.role,
      status: "open",
      ghlPipelineId: c.pipeline_id || null,
      monetaryValue: c.monetary_value || 0,
      source: "ghl-import",
      entryPoint: "ghl-import",
      lastStageChangeAt: c.last_stage_change_at || null,
    });
    if (ok) written++; else failed++;
  }
  return { ok: true, written, failed };
}

// Exported for scripts/ghl-import.mjs (the /ghl-pipeline-import runbook runs
// these locally with service-role env instead of a staff JWT).
export { actionDump, actionImportCards, actionReconcile, actionSetShadow, actionFlip, loadClientFlags };

// ─────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────

// status - read-only snapshot of where this academy stands in the cutover.
async function actionStatus(clientId, flags) {
  const reg = await sb(`pipeline_stages?client_id=eq.${clientId}&select=role,ghl_stage_id`) || [];
  const seededRoles = new Set(reg.map(r => r.role));
  const coverage = ROLES.map(role => ({
    role,
    seeded: seededRoles.has(role),
    has_ghl_stage: !!(reg.find(r => r.role === role && r.ghl_stage_id)),
  }));

  const portalRows = await sb(
    `opportunities?client_id=eq.${clientId}&status=eq.open&select=stage_role`
  ) || [];
  const byRole = {};
  for (const role of ROLES) byRole[role] = 0;
  for (const p of portalRows) byRole[p.stage_role] = (byRole[p.stage_role] || 0) + 1;

  return {
    client_id: clientId,
    business_name: flags.business_name || null,
    pipeline_provider: flags.pipeline_provider || "ghl",
    pipeline_shadow: !!flags.pipeline_shadow,
    shadow_column_present: flags._shadowColumn !== false,
    portal_open_total: portalRows.length,
    portal_open_by_role: byRole,
    registry_coverage: coverage,
    registry_seeded_roles: coverage.filter(c => c.seeded).length,
  };
}

// reconcile - READ-ONLY drift report: live GHL open opps vs the portal shadow.
async function actionReconcile(clientId, flags) {
  const acc = await loadGhlCreds(clientId);
  if (acc.error) return { error: acc.error };

  // Registry: ghl_stage_id -> role (only roles with a concrete GHL stage map).
  const reg = await sb(`pipeline_stages?client_id=eq.${clientId}&select=role,ghl_stage_id`) || [];
  const stageToRole = new Map();
  for (const r of reg) if (r.ghl_stage_id) stageToRole.set(String(r.ghl_stage_id), r.role);

  // GHL side: every open opp, mapped to a role via the registry. Opps in a stage
  // the registry doesn't cover are "unmapped" - the shadow never holds them, so
  // they are reported informationally, not as drift.
  const ghlOpps = await fetchAllOpenGhlOpps(acc);
  const ghlByGid = new Map();              // ghl_opportunity_id -> { role, name }
  const ghlByRole = {};
  let ghlUnmapped = 0;
  for (const role of ROLES) ghlByRole[role] = 0;
  for (const o of ghlOpps) {
    const role = o.stageId && stageToRole.get(String(o.stageId));
    if (!role) { ghlUnmapped++; continue; }
    ghlByGid.set(String(o.id), { role, name: o.name });
    ghlByRole[role] = (ghlByRole[role] || 0) + 1;
  }

  // Portal side: open opportunities in the shadow store.
  const portalRows = await sb(
    `opportunities?client_id=eq.${clientId}&status=eq.open&select=ghl_opportunity_id,stage_role,contact_name`
  ) || [];
  const portalByGid = new Map();
  const portalByRole = {};
  let portalNoGid = 0;
  for (const role of ROLES) portalByRole[role] = 0;
  for (const p of portalRows) {
    portalByRole[p.stage_role] = (portalByRole[p.stage_role] || 0) + 1;
    if (p.ghl_opportunity_id) portalByGid.set(String(p.ghl_opportunity_id), p);
    else portalNoGid++;
  }

  // Drift detection (all keyed on ghl_opportunity_id - the idempotent bridge):
  //   missing    = open in GHL, no matching open portal row (dual-write gap)
  //   mismatched = present both sides but stage_role differs (a move didn't mirror)
  //   extra      = open in portal, not open in GHL (portal stale / GHL closed it)
  const missing = [];
  const mismatched = [];
  for (const [gid, g] of ghlByGid) {
    const p = portalByGid.get(gid);
    if (!p) { missing.push({ ghl_opportunity_id: gid, role: g.role, name: g.name }); continue; }
    if (p.stage_role !== g.role) {
      mismatched.push({ ghl_opportunity_id: gid, ghl_role: g.role, portal_role: p.stage_role, name: g.name });
    }
  }
  const extra = [];
  for (const [gid, p] of portalByGid) {
    if (!ghlByGid.has(gid)) extra.push({ ghl_opportunity_id: gid, role: p.stage_role, name: p.contact_name || "" });
  }

  const counts = {
    missing: missing.length,
    extra: extra.length,
    mismatched: mismatched.length,
  };
  counts.total = counts.missing + counts.extra + counts.mismatched;

  const CAP = 200;   // cap the row lists so a wildly-divergent academy can't blow the payload
  return {
    client_id: clientId,
    business_name: acc.client.business_name || flags.business_name || null,
    pipeline_provider: flags.pipeline_provider || "ghl",
    pipeline_shadow: !!flags.pipeline_shadow,
    ghl: { open_mapped: ghlByGid.size, open_unmapped: ghlUnmapped, by_role: ghlByRole },
    portal: { open_total: portalRows.length, open_without_ghl_id: portalNoGid, by_role: portalByRole },
    drift: {
      counts,
      missing: missing.slice(0, CAP),
      mismatched: mismatched.slice(0, CAP),
      extra: extra.slice(0, CAP),
      truncated: counts.total > CAP * 3,
    },
    clean: counts.total === 0,
  };
}

// set-shadow - toggle clients.pipeline_shadow (dual-write on/off). Best-effort.
async function actionSetShadow(clientId, flags, on) {
  if (flags._shadowColumn === false) {
    return { error: { status: 409, message: "pipeline_shadow column is not present yet. The dual-write migration ships it; cannot toggle shadow until then." } };
  }
  await sb(`clients?id=eq.${clientId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ pipeline_shadow: !!on }),
  });
  return { ok: true, client_id: clientId, pipeline_shadow: !!on };
}

// flip - set clients.pipeline_provider with the cutover GUARD.
async function actionFlip(clientId, flags, provider, force) {
  if (provider !== "portal" && provider !== "ghl") {
    return { error: { status: 400, message: "provider must be 'portal' or 'ghl'" } };
  }

  // Rolling back to GHL is ALWAYS allowed and instant - it is the safety valve.
  if (provider === "ghl") {
    await sb(`clients?id=eq.${clientId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ pipeline_provider: "ghl" }),
    });
    return { ok: true, client_id: clientId, pipeline_provider: "ghl", rolled_back: true };
  }

  // provider === 'portal' - GUARDED.
  // 1. Shadow must have been ON (otherwise the portal store was never populated).
  if (!flags.pipeline_shadow) {
    return { error: {
      status: 412,
      message: "Refusing to flip to portal: shadow (dual-write) has not been turned on. Start shadow, let it soak, then reconcile clean before flipping.",
      reason: "shadow_off",
    } };
  }

  // 2. A FRESH reconcile must be clean (recomputed here - never trust a passed-in
  //    'clean' flag). force=true lets staff override a non-zero (near-zero) drift.
  const recon = await actionReconcile(clientId, flags);
  if (recon.error) return { error: recon.error };

  // 2b. The store must actually be POPULATED. With shadow freshly turned on but no
  //     board read yet, the stage registry is empty, so reconcile maps zero opps and
  //     reports clean (0 mapped = 0 drift) - a false green that would flip to an EMPTY
  //     portal board. Refuse when GHL holds open opps the store doesn't. force overrides.
  const ghlOpen = (recon.ghl.open_mapped || 0) + (recon.ghl.open_unmapped || 0);
  if (ghlOpen > 0 && (recon.portal.open_total || 0) === 0 && !force) {
    return { error: {
      status: 412,
      message: `Refusing to flip to portal: GHL has ${ghlOpen} open opportunit${ghlOpen === 1 ? "y" : "ies"} but the portal store is empty - the shadow backfill has not run. Open this academy's Pipelines board once (with shadow on) to seed the stage registry and mirror the opps, then reconcile and flip.`,
      reason: "store_unpopulated",
      ghl_open: ghlOpen,
    } };
  }

  if (!recon.clean && !force) {
    return { error: {
      status: 412,
      message: `Refusing to flip to portal: reconcile shows ${recon.drift.counts.total} drift item(s) (missing ${recon.drift.counts.missing}, extra ${recon.drift.counts.extra}, mismatched ${recon.drift.counts.mismatched}). Heal the drift and re-run reconcile, or pass force to override.`,
      reason: "drift",
      drift: recon.drift.counts,
    } };
  }

  await sb(`clients?id=eq.${clientId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ pipeline_provider: "portal" }),
  });
  return {
    ok: true,
    client_id: clientId,
    pipeline_provider: "portal",
    forced: !!force && !recon.clean,
    reconcile: { clean: recon.clean, drift: recon.drift.counts },
  };
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────
async function handler(req, res) {
  // BAM-staff-only gate on EVERY request, before any work.
  try { await resolveStaff(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  const action = (req.query.action || (req.body && req.body.action) || "").toString();

  let flags;
  try { flags = await loadClientFlags(clientId); }
  catch (e) { return res.status(e.status || 500).json({ error: `load client: ${e.message}` }); }
  if (!flags) return res.status(404).json({ error: "academy not found" });

  try {
    if (req.method === "GET") {
      if (action === "status")    return res.status(200).json(await actionStatus(clientId, flags));
      if (action === "dump") {
        const out = await actionDump(clientId);
        if (out.error) return res.status(out.error.status || 502).json({ error: out.error.message });
        return res.status(200).json(out);
      }
      if (action === "reconcile") {
        const out = await actionReconcile(clientId, flags);
        if (out.error) return res.status(out.error.status || 502).json({ error: out.error.message });
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "unknown GET action (use status | dump | reconcile)" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (action === "set-shadow") {
        const out = await actionSetShadow(clientId, flags, !!body.on);
        if (out.error) return res.status(out.error.status || 500).json({ error: out.error.message });
        return res.status(200).json(out);
      }
      if (action === "import-cards") {
        const out = await actionImportCards(clientId, body);
        if (out.error) return res.status(out.error.status || 400).json({ error: out.error.message });
        return res.status(200).json(out);
      }
      if (action === "flip") {
        const out = await actionFlip(clientId, flags, (body.provider || "").toString(), !!body.force);
        if (out.error) return res.status(out.error.status || 412).json(out.error);
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "unknown POST action (use set-shadow | import-cards | flip)" });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
