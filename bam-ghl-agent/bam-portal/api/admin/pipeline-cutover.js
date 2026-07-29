import { withSentryApiRoute } from "../_sentry.js";
import { ANY_STAFF_ROLES, hasRole } from "../_roles.js";
import { shadowUpsertOpportunity, shadowUpsertStageRegistry, ROLE_MATCHERS, SEEDABLE_ROLES, roleForStageName } from "../agent/_store.js";
import { pickGhlToken } from "../ghl/_core.js";

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
//        `clean` means the report was ABLE to check and found nothing, so it is
//        false when the registry has a gap (clean_blocked_by names which), not only
//        when drift is non-zero. Zero drift over cards nobody could map is not a
//        pass. See the note above `clean` in actionReconcile.
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
//        ALSO runs seed-registry first (see below) - the two are one step,
//        because an import without it produces a store reconcile cannot read.
//
//   POST /api/admin/pipeline-cutover?action=seed-registry&client_id=<uuid>
//     -> fills pipeline_stages.ghl_stage_id for this academy from its LIVE GHL
//        board, matching stage NAMES to roles with the same ROLE_MATCHERS the
//        finders use. Read-only against GHL; idempotent; writes no opportunities.
//
// Auth: Supabase JWT; the caller MUST be BAM staff (a row in `staff`). Academy
// owners / client teammates can NOT reach this - it is staff-operations only.

const GHL_V2        = "https://services.leadconnectorhq.com";
const V2_VERSION    = "2021-07-28";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// The stage roles the registry + opportunities store track (see the E1 migration).
//
// `interested` is NOT here, and its absence is the point: it is the pre-rename key
// for `ghosted` (migration 20260721150552, cleaned up again by 20260723143000).
// buildPresetRows never stamps a registry row for it, so a card accepted at that
// role landed on a role with no row - and this list is what the runbook's
// classifier is handed and validated against, so accepting it was an invitation.
// READING it still works everywhere (ROLE_MATCHERS, preset-master's ROLE_ALIASES,
// _stage.js's interestedStage); only WRITING it is refused.
const ROLES = [
  "responded", "ghosted", "scheduled_trial", "done_trial",
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

// Token picking/refresh is shared with every other GHL caller. Keeping a second
// copy here meant the token-renewal fix had to be made twice, so it now imports
// the one implementation in ../ghl/_core.js.

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
// paginated, same shape as the board reader). Returns { opps, pipelines }.
//
// The PIPELINES come back too, and that is not incidental. It costs no extra call
// (this function already fetches them) and it is the only way reconcile can tell
// the two kinds of unmapped stage apart: a column the preset has no role for at
// all ("New Lead"), which is the classifier's job, versus a column our own
// matchers WOULD call a role that the registry never mapped, which is a seeding
// hole. Without the names those two are indistinguishable, and the second one is
// how BAM San Jose ended up with 44 nurture cards nothing had ever checked.
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
  return { opps: out, pipelines };
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

// ─────────────────────────────────────────────────────────
// seed-registry - fill pipeline_stages.ghl_stage_id from the academy's LIVE board
// ─────────────────────────────────────────────────────────
//
// WHY THIS EXISTS. Every GHL-side read in this file resolves an opportunity to a
// portal role through pipeline_stages.ghl_stage_id: actionReconcile builds its
// stageToRole map from that column, and shadowMirrorMove maps a raw GHL stage move
// back to a role from it. buildPresetRows (api/agent/presets.js) stamps the
// registry rows an academy needs but has no idea what THAT academy's GHL calls
// those stages, so it leaves the column null.
//
// Until this action existed, exactly one live path ever filled it:
// shadowBackfillFromBoard, fired as a side effect of api/ghl/pipelines.js when a
// staff member happened to open the Pipelines board with pipeline_shadow already
// on. That instruction appeared nowhere but inside the text of a 412 error string,
// so in practice the column stayed null, reconcile mapped nothing, every imported
// card read as drift, and `flip --force` was the only way through. A gate nobody
// has ever seen pass is not a gate.
//
// Read-only against GHL. Idempotent (upserts on client_id,role). Writes no
// opportunities and flips no flags.
async function seedRegistryFromGhl(clientId, acc) {
  const resp = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(acc.locationId)}`, { token: acc.token });
  const pipelines = resp.pipelines || resp.data || [];
  // ONE PIPELINE, chosen the way every other resolver in this repo chooses it:
  // the /training/i one, else the first. Identical to ghlTrainingPipeline in
  // api/agent/_store.js and to scripts/seed-stages.js.
  //
  // Searching ALL boards and taking the first match was the obvious-looking
  // version and it is wrong twice over. Academies keep other boards - sponsorships,
  // camps, gym rentals - whose columns are also called "Responded" or "Nurture",
  // so whichever pipeline GHL happened to list first would decide the mapping. And
  // for a role the sales board genuinely lacks, it would quietly borrow another
  // board's column, after which reconcile maps THAT board's cards into the sales
  // pipeline and misses the real ones. A role the Training board has no column for
  // must come back unmatched and be dealt with as the gap it is.
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0] || null;
  const stages = (pipe && pipe.stages) || [];
  const seeded = [], unmatched = [];
  // SEEDABLE_ROLES, not Object.keys(ROLE_MATCHERS): the matchers still answer the
  // legacy `interested` key on the READ side, and iterating them here would mint a
  // second registry row for the same GHL stage - the exact drift migration
  // 20260723143000 was written to clean up.
  for (const role of SEEDABLE_ROLES) {
    const st = stages.find(ROLE_MATCHERS[role]);
    const hit = st ? { pipelineId: pipe.id, stageId: st.id, stageName: st.name } : null;
    if (!hit) { unmatched.push(role); continue; }
    // label/position are deliberately NOT passed: the preset owns the board's
    // column names and order, and a merge-duplicates upsert only touches the
    // columns it carries. This fills the GHL bridge and nothing else.
    const rowId = await shadowUpsertStageRegistry(clientId, role, hit);
    seeded.push({ role, ghl_stage_id: hit.stageId, ghl_stage_name: hit.stageName, row_id: rowId || null });
  }
  const written = seeded.filter(s => s.row_id).length;
  return { pipelines: pipelines.length, pipeline: pipe ? { id: pipe.id, name: pipe.name || "" } : null, seeded, written, unmatched };
}

async function actionSeedRegistry(clientId) {
  const acc = await loadGhlCreds(clientId);
  if (acc.error) return { error: acc.error };
  let out;
  try { out = await seedRegistryFromGhl(clientId, acc); }
  catch (e) { return { error: { status: e.status || 502, message: `seed-registry: ${e.message}` } }; }
  // shadowUpsertStageRegistry swallows its own write errors and returns null, so a
  // run that matched stages and wrote NOTHING would otherwise report ok:true over a
  // registry that is still empty - the failure mode this whole action exists to end.
  if (out.seeded.length && out.written === 0) {
    return { error: { status: 500, message: `seed-registry matched ${out.seeded.length} GHL stage(s) but wrote 0 pipeline_stages rows. The registry is still empty, so reconcile cannot map anything.` } };
  }
  return { ok: true, client_id: clientId, ...out };
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

  // SEED THE REGISTRY AS PART OF THE IMPORT, not as a step someone remembers.
  // Cards written without it are cards reconcile can only read as drift, so the
  // two halves are one operation. Best-effort on purpose: a GHL hiccup must not
  // throw away a classification the user just confirmed card by card, so the
  // failure is REPORTED on the result (and `seed-registry` can be re-run alone)
  // rather than aborting the write.
  let registry;
  const acc = await loadGhlCreds(clientId);
  if (acc.error) registry = { ok: false, error: acc.error.message };
  else {
    try { registry = { ok: true, ...(await seedRegistryFromGhl(clientId, acc)) }; }
    catch (e) { registry = { ok: false, error: `seed-registry: ${e.message}` }; }
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
  return { ok: true, written, failed, registry };
}

// Exported for scripts/ghl-import.mjs (the /ghl-pipeline-import runbook runs
// these locally with service-role env instead of a staff JWT). An action that is
// NOT in this list is HTTP-only and the CLI cannot reach it - actionStatus is the
// standing example.
export { actionDump, actionImportCards, actionSeedRegistry, actionReconcile, actionSetShadow, actionFlip, loadClientFlags };

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
  const reg = await sb(`pipeline_stages?client_id=eq.${clientId}&select=role,ghl_stage_id,ghl_pipeline_id`) || [];
  const stageToRole = new Map();
  for (const r of reg) if (r.ghl_stage_id) stageToRole.set(String(r.ghl_stage_id), r.role);
  const mappedRoles = new Set(stageToRole.values());
  // Which GHL pipelines the registry actually points at. Used to scope the gap
  // hunt below: an academy's Sponsorship board may also have a "Nurture" column,
  // and that is not a hole in the SALES registry.
  const registryPipelineIds = new Set(reg.map(r => r.ghl_pipeline_id).filter(Boolean));

  // GHL side: every open opp, mapped to a role via the registry. Opps in a stage
  // the registry doesn't cover are "unmapped" - the shadow never holds them, so
  // they are reported informationally, not as drift.
  const { opps: ghlOpps, pipelines: ghlPipelines } = await fetchAllOpenGhlOpps(acc);
  const stageNameById = new Map();         // ghl stage id -> its name on the board
  for (const p of ghlPipelines) for (const st of (p.stages || [])) stageNameById.set(String(st.id), st.name || "");
  const ghlByGid = new Map();              // ghl_opportunity_id -> { role, name }
  const ghlOpenIds = new Set();            // EVERY open GHL opp, mapped or not
  const ghlByRole = {};
  let ghlUnmapped = 0;
  for (const role of ROLES) ghlByRole[role] = 0;
  for (const o of ghlOpps) {
    ghlOpenIds.add(String(o.id));
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
  //   extra      = open in portal, not open in GHL AT ALL (portal stale / GHL closed it)
  const missing = [];
  const mismatched = [];
  for (const [gid, g] of ghlByGid) {
    const p = portalByGid.get(gid);
    if (!p) { missing.push({ ghl_opportunity_id: gid, role: g.role, name: g.name }); continue; }
    if (p.stage_role !== g.role) {
      mismatched.push({ ghl_opportunity_id: gid, ghl_role: g.role, portal_role: p.stage_role, name: g.name });
    }
  }
  // `extra` is keyed on "is this card open in GHL at all", NOT on "did the registry
  // give it a role". The two are different and conflating them made a clean
  // reconcile impossible on any real academy: the runbook classifies PEOPLE, so a
  // card sitting in an academy's own "New Lead" column - which matches no role by
  // name - is imported at a judged role ON PURPOSE. Under the old test every one of
  // those read as a stale portal row, drift never reached zero, and `flip --force`
  // was the only exit. They are reported separately as `unverifiable`: still open in
  // GHL, so not stale, but in a stage the registry cannot name, so their role is
  // vouched for by the classifier alone and by nothing this report checked.
  const extra = [];
  const unverifiable = [];
  for (const [gid, p] of portalByGid) {
    if (ghlByGid.has(gid)) continue;
    const row = { ghl_opportunity_id: gid, role: p.stage_role, name: p.contact_name || "" };
    if (ghlOpenIds.has(gid)) unverifiable.push(row); else extra.push(row);
  }

  // ── IS THE REGISTRY COMPLETE, not "is it non-empty" ────────────────────────
  //
  // Counting seeded rows was the wrong question and it produced a false green on
  // the one academy this whole runbook exists for. BAM San Jose has 5 registry
  // rows, 4 of them mapped, and 44 open `nurture` cards on the unmapped fifth -
  // every one of them carrying a ghl_opportunity_id. Under a `size > 0` bar the
  // registry read as seeded, all 44 fell into `unverifiable`, `unverifiable` sits
  // outside `counts`, and reconcile certified an academy whose largest column had
  // never been looked at. DETAIL Miami is the same shape (17 `ghosted` cards on an
  // unmapped role) and is ALREADY flipped to portal.
  //
  // Two halves, because they catch different things and either one alone leaves a
  // hole:
  //   a. a role that HOLDS open portal cards and has no ghl_stage_id. Needs no GHL
  //      knowledge, and catches the cards that are portal-native (no GHL id at
  //      all), which the unverifiable arithmetic can never see.
  //   b. a stage on the academy's own board that OUR OWN matchers call a role the
  //      registry never mapped. Catches the hole BEFORE a single card is imported,
  //      which is when it is cheap to fix.
  //
  // won / unqualified are excluded from (a) on purpose and narrowly: won is a GHL
  // status and unqualified is a status plus a tag, so neither has a GHL stage to
  // map by design (see scripts/seed-stages.js). Note this exception is not
  // exercised by real data - no open opportunity sits at a terminal role in
  // production today - so it is reasoning, not observation.
  const TERMINAL_ROLES = new Set(["won", "unqualified"]);
  const rolesWithOpenCards = new Set(portalRows.map(p => p.stage_role).filter(Boolean));
  const gapRoles = new Set();
  for (const role of rolesWithOpenCards) {
    if (!mappedRoles.has(role) && !TERMINAL_ROLES.has(role)) gapRoles.add(role);
  }
  const gapStages = [];
  for (const p of ghlPipelines) {
    if (registryPipelineIds.size && !registryPipelineIds.has(p.id)) continue;
    for (const st of (p.stages || [])) {
      if (stageToRole.has(String(st.id))) continue;
      const role = roleForStageName(st.name);
      if (role && !mappedRoles.has(role)) { gapRoles.add(role); gapStages.push({ role, stage_id: st.id, stage_name: st.name || "", pipeline: p.name || "" }); }
    }
  }
  const registryGaps = [...gapRoles].sort();

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
    portal: {
      open_total: portalRows.length,
      open_without_ghl_id: portalNoGid,
      open_unverifiable: unverifiable.length,
      by_role: portalByRole,
    },
    drift: {
      counts,
      missing: missing.slice(0, CAP),
      mismatched: mismatched.slice(0, CAP),
      extra: extra.slice(0, CAP),
      // Not drift, and deliberately not in `counts` - see the note above.
      unverifiable: unverifiable.slice(0, CAP),
      truncated: counts.total > CAP * 3,
    },
    registry: {
      roles_with_ghl_stage: stageToRole.size,
      mapped_roles: [...mappedRoles].sort(),
      complete: registryGaps.length === 0,
      gap_roles: registryGaps,
      gap_stages: gapStages.slice(0, CAP),
    },
    // A REPORT THAT COULD NOT LOOK HAS NOT VERIFIED ANYTHING, and `clean` is the
    // word the operator reads before flipping an academy's system of record. Two
    // ways it can be vacuous, both of which produce zero drift by arithmetic:
    //   registry_unseeded   - nothing mapped at all, so every card is unmapped.
    //   registry_incomplete - some role that has cards, or that the board plainly
    //                         has a column for, was never mapped. San Jose.
    //
    // WHAT IS DELIBERATELY *NOT* A BLOCKER, stated explicitly because it is the
    // narrow exception: an `unverifiable` card whose GHL stage matches no role at
    // all. An academy's "New Lead" or "Contacted" column has no preset role by
    // design, so a card there is placed by the classifier and by nothing else -
    // that is what "we import their PEOPLE, not their pipeline shape" MEANS, and
    // blocking on it would make every realistic import unpassable and put
    // `--force` straight back as the only route. Those cards are counted, listed,
    // and shown to the operator; they are not called drift.
    clean: counts.total === 0 && registryGaps.length === 0 && (stageToRole.size > 0 || ghlOpps.length === 0),
    clean_blocked_by: counts.total !== 0 ? null
      : stageToRole.size === 0 && ghlOpps.length > 0 ? "registry_unseeded"
      : registryGaps.length ? "registry_incomplete"
      : null,
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
      message: `Refusing to flip to portal: GHL has ${ghlOpen} open opportunit${ghlOpen === 1 ? "y" : "ies"} but the portal store is empty - nothing has been imported. Run seed-registry + import-cards for this academy (scripts/ghl-import.mjs import, which does both), then reconcile and flip.`,
      reason: "store_unpopulated",
      ghl_open: ghlOpen,
    } };
  }

  // 2c. ...and the report must have been ABLE to check. Both vacuum cases produce
  //     zero drift by arithmetic, so the generic message below would say "0 drift
  //     item(s)" and read as a bug rather than as the command that fixes it.
  if (recon.clean_blocked_by === "registry_unseeded" && !force) {
    return { error: {
      status: 412,
      message: "Refusing to flip to portal: pipeline_stages.ghl_stage_id is empty for this academy, so reconcile could not map a single GHL card to a portal role and its clean report means nothing. Run seed-registry (node scripts/ghl-import.mjs seed-registry --client <id>), then reconcile again.",
      reason: "registry_unseeded",
    } };
  }
  //     The PARTIAL case is the one that actually bites. BAM San Jose holds 44 open
  //     nurture cards on a role with no ghl_stage_id; DETAIL Miami holds 17 ghosted
  //     ones and is already on portal. Neither shows a single drift item, because
  //     the drift arithmetic never reaches a card it cannot map.
  if (recon.clean_blocked_by === "registry_incomplete" && !force) {
    const gaps = (recon.registry && recon.registry.gap_roles) || [];
    return { error: {
      status: 412,
      message: `Refusing to flip to portal: the stage registry has no GHL stage for ${gaps.join(", ")}, so every card on ${gaps.length === 1 ? "that role" : "those roles"} was skipped by reconcile rather than checked - the zero-drift result does not cover them. Run seed-registry (node scripts/ghl-import.mjs seed-registry --client <id>). If the academy's GHL genuinely has no column for ${gaps.length === 1 ? "that role" : "those roles"}, seeding will not fill it and this needs a human decision, not force.`,
      reason: "registry_incomplete",
      gap_roles: gaps,
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
      if (action === "seed-registry") {
        const out = await actionSeedRegistry(clientId);
        if (out.error) return res.status(out.error.status || 502).json({ error: out.error.message });
        return res.status(200).json(out);
      }
      if (action === "flip") {
        const out = await actionFlip(clientId, flags, (body.provider || "").toString(), !!body.force);
        if (out.error) return res.status(out.error.status || 412).json(out.error);
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "unknown POST action (use set-shadow | seed-registry | import-cards | flip)" });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
