// THE GHL MIGRATION, TESTED BY BEHAVIOUR RATHER THAN BY TEXT.
//
//   node api/_ghl-migration.test.mjs      # exits non-zero on any failure
//
// WHY THIS FILE EXISTS. /ghl-pipeline-import is about to be automated, and the two
// things it automates were both broken in ways nothing noticed:
//
//   1. THE LEGACY ROLE. Migration 20260721150552 renamed the stage role
//      `interested` to `ghosted`; 20260723143000 exists only because the code kept
//      authoring the old key afterwards and re-created the drift (BAM San Jose got
//      a whole duplicate stage carrying live leads). Three writers were still
//      authoring it today: the runbook told Claude to classify cards into it,
//      api/admin/pipeline-cutover.js ACCEPTED it on import, and
//      scripts/seed-stages.js seeded a row for it. buildPresetRows never stamps a
//      registry row for `interested`, so a card imported at that role landed on a
//      role with no row at all.
//
//   2. THE RECONCILE GATE NOBODY HAD EVER SEEN PASS. actionReconcile maps GHL
//      opportunities to portal roles through pipeline_stages.ghl_stage_id.
//      buildPresetRows never writes that column, and import-cards never seeded it,
//      so the map was empty, every imported card read as drift, and `flip --force`
//      was the only way through. The one live path that filled the column was a
//      side effect of opening the Pipelines board with pipeline_shadow already on -
//      an instruction that appeared nowhere except inside the text of a 412 error
//      string.
//
// So the checks below drive the real action functions and assert what they DID: a
// card CANNOT be imported at the legacy role, the registry IS populated by an
// import, and reconcile goes from never-clean to clean on a realistic board. The
// rule for anything added here is the same as api/_arming-gate.test.mjs: if you
// cannot break the production code and watch this file go red, the check is not
// finished. Every comment below was written after watching its own check fail.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE NEGATIVE CONTROLS WORK. Same mechanism as api/_arming-gate.test.mjs: the
// control writes a MUTATED COPY of the real module next to it and imports that, so
// it is the real module with one line changed. A control whose pinned text is no
// longer in the file sets controlBroken and reports NEGATIVE CONTROL FAILED rather
// than passing quietly - a control that has lost its target looks exactly like a
// control that worked.
//
//   MUTATE=legacyrole  node api/_ghl-migration.test.mjs  # import-cards accepts `interested` again
//   MUTATE=legacyseed  node api/_ghl-migration.test.mjs  # scripts/seed-stages.js authors it again
//   MUTATE=seedalias   node api/_ghl-migration.test.mjs  # seed-registry iterates every matcher, alias included
//   MUTATE=noseed      node api/_ghl-migration.test.mjs  # import-cards stops seeding the registry
//   MUTATE=nostageid   node api/_ghl-migration.test.mjs  # ...seeds it without the one column that matters
//   MUTATE=extrastrict node api/_ghl-migration.test.mjs  # an unmapped-stage card counts as drift again
//   MUTATE=falsegreen  node api/_ghl-migration.test.mjs  # an unseeded registry reads clean
//   MUTATE=forceonly   node api/_ghl-migration.test.mjs  # flip refuses even a clean reconcile
//   MUTATE=seedcolumn  node api/_ghl-migration.test.mjs  # the registry upsert names a column that does not exist
//   MUTATE=mirrorraw   node api/_ghl-migration.test.mjs  # shadowMirrorMove stops mapping a raw GHL stage move
//   MUTATE=partialclean node api/_ghl-migration.test.mjs # a registry gap stops blocking `clean`
//   MUTATE=cardgap     node api/_ghl-migration.test.mjs  # ...the gap hunt stops looking at roles that HOLD cards
//   MUTATE=stagegap    node api/_ghl-migration.test.mjs  # ...and stops looking at the academy's own board
//   MUTATE=flippartial node api/_ghl-migration.test.mjs  # flip stops refusing the partial case by name
//   MUTATE=terminalgap node api/_ghl-migration.test.mjs  # won/unqualified become an unclearable gap
//   MUTATE=otherboardgap node api/_ghl-migration.test.mjs # an unrelated board's column becomes a gap
//   MUTATE=borrowstage node api/_ghl-migration.test.mjs  # seeding borrows another board's stage for a missing role
//   MUTATE=dropalias   node api/_ghl-migration.test.mjs  # the READ-side alias is tidied out of ROLE_MATCHERS
//   MUTATE=droplabelalias node api/_ghl-migration.test.mjs # ...and out of preset-master's ROLE_ALIASES
//
// WHAT THIS FILE DOES NOT PROVE.
//   • It never talks to GHL. The GHL board is a fixture, so a real academy whose
//     stage names match nothing this repo's ROLE_MATCHERS know about will seed an
//     empty registry and reconcile will refuse - correctly, and untested here.
//   • It does not run scripts/ghl-import.mjs's seed-registry BODY. The CLI is
//     checked by spawning it, which proves the command is dispatched and that
//     actionSeedRegistry is exported (a missing export is a link error), not that
//     the block inside does the right thing. The action itself is driven directly.
//   • It asserts nothing about api/offers/setup-status.js, the Activation tab, or
//     anything the owner sees. Those read the same flags; none of that is covered.
//
// AND WHAT THE FAKE POSTGREST CANNOT SEE. It applies filters, projects selects and
// rejects a column the real schema does not have, but it enforces no NOT NULL, no
// foreign key, no CHECK constraint and no unique index other than the on_conflict
// target it is handed. Notably: pipeline_stages.role and opportunities.stage_role
// carry CHECK constraints in production (migration 20260710181458 opened them to
// any lowercase snake_case role), and this stub would happily store a role the real
// database rejects. The column lists are a SNAPSHOT of the migrations, so a column
// added straight through the Supabase dashboard reads as a false FAILURE here, not
// as a false pass.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Answer @sentry/node locally - api/admin/pipeline-cutover.js line 1 imports
// api/_sentry.js, which statically imports it. Identical reasoning to the note in
// api/_arming-gate.test.mjs: sentryApiEnabled is false outside VERCEL_ENV
// production, so withSentryApiRoute already passes the handler straight through
// and not one of these stubs is called on any path this file drives.
register(`data:text/javascript,${encodeURIComponent(`
  const STUB = "data:text/javascript,${encodeURIComponent(
    "export function init(){} export function captureMessage(){} export function captureException(){}" +
    " export function flush(){return Promise.resolve(true)}" +
    " export function withIsolationScope(fn){return fn({setTag(){},setContext(){}})}")}";
  export async function resolve(spec, ctx, next) {
    if (spec === "@sentry/node") return { url: STUB, shortCircuit: true, format: "module" };
    return next(spec, ctx);
  }
`)}`);

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";
const REST = `${process.env.SUPABASE_URL}/rest/v1/`;
const GHL_HOST = "https://services.leadconnectorhq.com";

const fails = [];
function fail(what, detail) { fails.push({ what, detail }); }
function expect(cond, what, detail) { if (!cond) fail(what, detail); return !!cond; }

// ─── a PostgREST stand-in that APPLIES the filters and PROJECTS the select ───
let DB = null;

function cmp(val, spec) {
  if (spec.startsWith("not.")) return !cmp(val, spec.slice(4));
  const m = /^(eq|neq|is|in|lte|gte|lt|gt|like|ilike|cs)\.([\s\S]*)$/.exec(spec);
  if (!m) throw new Error(`stub PostgREST: unsupported filter '${spec}'`);
  const [, op, raw] = m;
  switch (op) {
    case "eq":  return raw === "true" ? val === true : raw === "false" ? val === false : String(val) === raw;
    case "neq": return !cmp(val, `eq.${raw}`);
    case "is":  return raw === "null" ? (val === null || val === undefined) : raw === "true" ? val === true : val === false;
    case "in":  return raw.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(val));
    case "lte": return String(val) <= raw;
    case "gte": return String(val) >= raw;
    case "lt":  return String(val) < raw;
    case "gt":  return String(val) > raw;
    default:    return true;
  }
}

function orMatches(row, spec) {
  const inner = spec.replace(/^\(/, "").replace(/\)$/, "");
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.some((p) => {
    const m = /^([\w]+)\.([\s\S]+)$/.exec(p.trim());
    if (!m) throw new Error(`stub PostgREST: unparsable or() term '${p}'`);
    return cmp(row[m[1]], m[2]);
  });
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

// ─── THE COLUMNS EACH TABLE ACTUALLY HAS ─────────────────────────────────────
//
// Union of supabase/snapshots/prod-schema.sql and every migration's create/alter
// since - NOT derived from what the code asks for, which would rubber-stamp the
// exact bug this catches. A table with no entry here THROWS rather than being
// invented, so a path that reaches an unexpected table is loud.
//
// The one that matters most here is pipeline_stages.ghl_stage_id: it is the
// column the whole cutover hangs on, and a write that misnames it 400s the whole
// request in production while shadowUpsertStageRegistry swallows the error and
// returns null. MUTATE=seedcolumn is that regression.
const COLUMNS = {
  pipeline_stages: "client_id created_at ghl_pipeline_id ghl_stage_id ghl_stage_name id is_terminal label offer_id position role updated_at",
  opportunities: "athlete_name client_id closed_at contact_id contact_name contact_phone created_at entry_point ghl_contact_id ghl_opportunity_id ghl_pipeline_id id last_stage_change_at member_id monetary_value offer_id reason source stage_id stage_role status updated_at",
  staff: "avatar_url booking_url created_at email id name role slack_token slack_user_id updated_at user_id",
  clients: "access_sync_mode address ads_connected_at ads_content_approval_required allowed_domains archived_at asana_project_id athlete_map_done_at auth_user_id base_retainer baseline_locked_until baseline_revenue booking_provider brand_data brand_marked_done_at business_name call_booked_at call_completed_at cam_call_booked_at coachiq_enabled coachiq_signup_url community_group_platform community_group_url contact_provider content_assignee_organic_id content_submitted_at created_at credit_engine_enabled ein email email_domain email_provider email_setup entity_type flat_amount general_marked_done_at ghl_access_token ghl_company_id ghl_connect_status ghl_connected_at ghl_contacts_last_synced_at ghl_history_imported_at ghl_kpi_config ghl_location_id ghl_refresh_token ghl_signup_done_at ghl_synced_at ghl_token_error ghl_token_expires_at google_review_url growth_share_pct id ig_setup kpi_data kpi_marked_done_at kpi_setup_done_at legal_name locations_marked_done_at marketing_included messaging_provider meta_ad_account_id meta_ads_marked_done_at meta_campaign_ids meta_capi meta_cpl_goal meta_monthly_budget notification_prefs notion_page_id offers_marked_done_at onboarding_completed_at onboarding_feedback_requested_at onboarding_feedback_submitted_at onboarding_method onboarding_setup onboarding_tracker_dismissed online_programs_url organic_content organic_total_credits_per_month organic_video_credits_per_month owner_name payment_model phone pipeline_ghl_mirror pipeline_provider pipeline_shadow public_name ready_for_review_at referral_offer refresh_week revenue_integration_connection review_call_booked_at scaling_manager_id scheduling_app slack_channel_id slack_join_done_at sorter_dismissals staff_marked_done_at staff_notify_phone status stripe_connect_account_id stripe_connect_connected_at stripe_connect_status stripe_customer_id subscription_renewal_date systems_buildout_triggered_at systems_onboarding_ticket_id tax_config time_zone tz_alert_at updated_at uses_own_ad_account v15_access v15_config v2_access v4_access website_setup welcome_slack_sent_at ximena_call_booked_at",
};
const COLS = new Map(Object.entries(COLUMNS).map(([t, s]) => [t, new Set(s.split(/\s+/).filter(Boolean))]));

function pgUndefinedColumn(table, col, where) {
  return new Response(JSON.stringify({
    code: "42703",
    message: `column ${table}.${col} does not exist`,
    hint: `the stub rejects it because the real schema has no such column, so PostgREST would 400 this ${where}. Either the name is wrong, or its migration is not in this repo yet.`,
  }), { status: 400, headers: { "content-type": "application/json" } });
}

function validateColumns(table, u, init) {
  const known = COLS.get(table);
  const bad = (col, where) => pgUndefinedColumn(table, col, where);
  const sel = u.searchParams.get("select");
  if (sel) {
    for (const rawPart of sel.split(",")) {
      const part = rawPart.trim();
      if (!part || part === "*" || part.includes("(")) continue;
      const col = part.includes(":") ? part.split(":").pop() : part;
      if (col !== "*" && !known.has(col)) return bad(col, "select");
    }
  }
  for (const [k, v] of u.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === "or") {
      for (const m of String(v).matchAll(/([a-z_][a-z0-9_]*)\./g)) {
        if (!known.has(m[1]) && !/^(eq|neq|is|in|lte|gte|lt|gt|not|like|ilike|cs|cd)$/.test(m[1])) return bad(m[1], "or() filter");
      }
      continue;
    }
    if (!known.has(k)) return bad(k, "filter");
  }
  for (const key of ["order", "on_conflict"]) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const col = part.trim().split(".")[0];
      if (col && !known.has(col)) return bad(col, `${key}=`);
    }
  }
  const method = String(init.method || "GET").toUpperCase();
  if (method === "POST" || method === "PATCH") {
    let payload = null;
    try { payload = JSON.parse(init.body || "null"); } catch (_) { payload = null; }
    for (const row of (Array.isArray(payload) ? payload : payload ? [payload] : [])) {
      if (!row || typeof row !== "object") continue;
      for (const k of Object.keys(row)) if (!known.has(k)) return bad(k, `${method} body`);
    }
  }
  return null;
}

function restCall(url, init) {
  const u = new URL(url);
  const table = decodeURIComponent(u.pathname.replace(/^\/rest\/v1\//, ""));
  const method = String(init.method || "GET").toUpperCase();
  const prefer = String((init.headers && (init.headers.Prefer || init.headers.prefer)) || "");
  if (!COLS.has(table)) {
    throw new Error(`stub PostgREST: no column list for table '${table}'. Add it to COLUMNS with its REAL columns (supabase/snapshots/prod-schema.sql + the migrations since), not with the ones this code happens to ask for.`);
  }
  const columnError = validateColumns(table, u, init);
  if (columnError) return columnError;
  DB.tables[table] = DB.tables[table] || [];
  const all = DB.tables[table];

  const project = (rows) => {
    const sel = u.searchParams.get("select");
    if (!sel || sel.split(",").some((p) => p.trim() === "*" || p.includes("("))) return rows;
    const cols = sel.split(",").map((p) => p.trim()).map((p) => (p.includes(":") ? p.split(":").pop() : p)).filter(Boolean);
    return rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
  };

  const pick = () => {
    let rows = all;
    for (const [k, v] of u.searchParams) {
      if (RESERVED.has(k)) continue;
      if (k === "or") { rows = rows.filter((r) => orMatches(r, v)); continue; }
      rows = rows.filter((r) => cmp(r[k], v));
    }
    const lim = Number(u.searchParams.get("limit") || 0);
    return lim > 0 ? rows.slice(0, lim) : rows;
  };

  const reply = (rows) => (prefer.includes("return=representation")
    ? new Response(JSON.stringify(project(rows)), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("", { status: 200 }));

  if (method === "GET") {
    return new Response(JSON.stringify(project(pick())), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (method === "POST") {
    const incoming = JSON.parse(init.body || "[]");
    const conflict = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
    const out = [];
    for (const raw of (Array.isArray(incoming) ? incoming : [incoming])) {
      const row = { id: `${table}-${all.length + 1}`, ...raw };
      const dupe = conflict.length ? all.find((r) => conflict.every((c) => String(r[c]) === String(row[c]))) : null;
      if (dupe && prefer.includes("resolution=ignore-duplicates")) { out.push(dupe); continue; }
      if (dupe && prefer.includes("resolution=merge-duplicates")) { Object.assign(dupe, raw); out.push(dupe); continue; }
      all.push(row); out.push(row);
    }
    return reply(out);
  }
  if (method === "PATCH") {
    const patch = JSON.parse(init.body || "{}");
    const hit = pick();
    for (const r of hit) Object.assign(r, patch);
    return reply(hit);
  }
  if (method === "DELETE") { const hit = pick(); for (const r of hit) all.splice(all.indexOf(r), 1); return reply(hit); }
  throw new Error(`stub PostgREST: unsupported method ${method}`);
}

// ─── the academy's LIVE GHL board, as a fixture ──────────────────────────────
//
// Deliberately NOT a board whose stage names all match a role. A real academy's
// first column is "New Lead" or "Contacted" and matches nothing this repo knows,
// which is the whole reason the runbook classifies PEOPLE rather than importing a
// pipeline shape - and the reason `extra` had to stop meaning "the registry could
// not name this card's stage".
const PIPELINE = {
  id: "pipe-training",
  name: "Training Pipeline",
  stages: [
    { id: "st-new",  name: "New Lead",       position: 0 },   // matches no role
    { id: "st-resp", name: "Responded",      position: 1 },   // -> responded
    { id: "st-int",  name: "Interested",     position: 2 },   // -> ghosted (the GHL NAME never changed)
    { id: "st-book", name: "Booked Trial",   position: 3 },   // -> scheduled_trial
    { id: "st-done", name: "Trial Complete", position: 4 },   // -> done_trial
    { id: "st-nurt", name: "Nurture",        position: 5 },   // -> nurture
  ],
};
// A second board, listed FIRST by GHL, whose first column is also called
// "Responded". Academies really do keep these (sponsorships, camps, gym rentals),
// and whichever one GHL returns first is not a decision anyone made.
const OTHER_PIPELINE = {
  id: "pipe-sponsors",
  name: "Sponsorship Outreach",
  stages: [{ id: "sp-resp", name: "Responded", position: 0 }],
};
const MATCHED_ROLES = ["responded", "ghosted", "scheduled_trial", "done_trial", "nurture"];
const STAGE_FOR_ROLE = {
  responded: "st-resp", ghosted: "st-int", scheduled_trial: "st-book",
  done_trial: "st-done", nurture: "st-nurt",
};

// Five open cards. g4 sits in "New Lead", so nothing but a human's classification
// can say what role it belongs in.
const GHL_OPEN = [
  { id: "g1", pipelineStageId: "st-resp", name: "Ada Parent" },
  { id: "g2", pipelineStageId: "st-int",  name: "Ben Parent" },
  { id: "g3", pipelineStageId: "st-book", name: "Cara Parent" },
  { id: "g4", pipelineStageId: "st-new",  name: "Dev Parent" },
  { id: "g5", pipelineStageId: "st-nurt", name: "Eli Parent" },
];
// What the runbook would produce for that board: their PEOPLE, sorted into our
// preset. g4 is a judgement call, exactly as the runbook intends.
const CARDS = [
  { id: "g1", role: "responded",       name: "Ada Parent",  pipeline_id: "pipe-training" },
  { id: "g2", role: "ghosted",         name: "Ben Parent",  pipeline_id: "pipe-training" },
  { id: "g3", role: "scheduled_trial", name: "Cara Parent", pipeline_id: "pipe-training" },
  { id: "g4", role: "responded",       name: "Dev Parent",  pipeline_id: "pipe-training" },
  { id: "g5", role: "nurture",         name: "Eli Parent",  pipeline_id: "pipe-training" },
];

let GHL_BOARD = { pipelines: [OTHER_PIPELINE, PIPELINE], opps: GHL_OPEN };

// Swap which cards are OPEN in GHL for the duration of one check. The board's
// stages never change - a stage the registry has no mapping for is a gap whether
// or not anybody is standing in it, which is the point of check F8.4.
async function withGhlOpps(opps, fn) {
  const prev = GHL_BOARD.opps;
  GHL_BOARD.opps = opps;
  try { return await fn(); } finally { GHL_BOARD.opps = prev; }
}

// Swap the BOARD ITSELF. Two academy shapes only this can build: one whose
// columns match none of our matchers at all, and one missing a single column
// whose role still holds cards - which is very likely the real BAM San Jose,
// whose unmapped `nurture` row has a null ghl_pipeline_id too, meaning nothing
// ever found a stage for it.
async function withGhlBoard(pipelines, fn) {
  const prev = GHL_BOARD.pipelines;
  GHL_BOARD.pipelines = pipelines;
  try { return await fn(); } finally { GHL_BOARD.pipelines = prev; }
}
const boardWithout = (stageId) => [OTHER_PIPELINE, { ...PIPELINE, stages: PIPELINE.stages.filter((s) => s.id !== stageId) }];

function ghlCall(url) {
  const u = new URL(url);
  if (u.pathname === "/opportunities/pipelines") {
    return new Response(JSON.stringify({ pipelines: GHL_BOARD.pipelines }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.pathname === "/opportunities/search") {
    const pid = u.searchParams.get("pipeline_id");
    const opps = GHL_BOARD.opps.filter((o) => !pid || (o.pipelineId || PIPELINE.id) === pid);
    return new Response(JSON.stringify({ opportunities: opps, meta: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`stub GHL: unexpected call ${u.pathname} - this suite drives no other GHL endpoint, so a new one is either a real new dependency or a typo.`);
}

const ACADEMY = "acad-ghl-migration-test";
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 3600e3).toISOString();

// A connected academy that has NOT been flipped. ghl_token_expires_at is a year
// out so pickGhlToken returns the stored token without attempting a renewal - a
// renewal would be an outbound call this suite is not here to exercise.
const clientRow = (over = {}) => ({
  id: ACADEMY, business_name: "Migration Test Academy",
  pipeline_provider: "ghl", pipeline_shadow: false,
  ghl_location_id: "loc-test", ghl_access_token: "ghl-token",
  ghl_refresh_token: null, ghl_token_expires_at: FAR_FUTURE,
  ...over,
});

function installDb({ user = null, tables = {} } = {}) {
  DB = { user, tables: JSON.parse(JSON.stringify(tables)), wire: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    DB.wire.push({ method: String(init.method || "GET").toUpperCase(), url: u, body: init.body || null });
    if (u.endsWith("/auth/v1/user")) {
      return DB.user
        ? new Response(JSON.stringify(DB.user), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("", { status: 401 });
    }
    if (u.startsWith(REST)) return restCall(u, init);
    if (u.startsWith(GHL_HOST)) return ghlCall(u);
    throw new Error(`stub: unexpected outbound call to ${u}`);
  };
  return DB;
}

const stages = () => (DB.tables.pipeline_stages || []);
const opps   = () => (DB.tables.opportunities || []);

// ─── mutated copies of real modules, for the negative controls ───────────────
let controlBroken = null;
let mutantCount = 0;
async function mutantModule(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of api/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

async function cutoverModule() {
  const edits = [];
  // The legacy role back in the accepted list - the state this build found.
  if (MUTATE === "legacyrole") edits.push([
    '  "responded", "ghosted", "scheduled_trial", "done_trial",\n  "nurture", "won", "unqualified",',
    '  "responded", "ghosted", "interested", "scheduled_trial", "done_trial",\n  "nurture", "won", "unqualified",']);
  // Seeding iterates every matcher again, alias included.
  if (MUTATE === "seedalias") edits.push([
    "  for (const role of SEEDABLE_ROLES) {\n    const st = stages.find(ROLE_MATCHERS[role]);",
    "  for (const role of Object.keys(ROLE_MATCHERS)) {\n    const st = stages.find(ROLE_MATCHERS[role]);"]);
  // import-cards stops seeding: the state in which reconcile could never be clean.
  if (MUTATE === "noseed") edits.push([
    "  let registry;\n  const acc = await loadGhlCreds(clientId);\n  if (acc.error) registry = { ok: false, error: acc.error.message };\n  else {\n    try { registry = { ok: true, ...(await seedRegistryFromGhl(clientId, acc)) }; }\n    catch (e) { registry = { ok: false, error: `seed-registry: ${e.message}` }; }\n  }",
    "  let registry = null;"]);
  // Seeds rows, but without ghl_stage_id - the column everything downstream maps on.
  if (MUTATE === "nostageid") edits.push([
    "    const hit = st ? { pipelineId: pipe.id, stageId: st.id, stageName: st.name } : null;",
    "    const hit = st ? { pipelineId: pipe.id, stageName: st.name } : null;"]);
  // `extra` back to meaning "the registry could not name this card's stage".
  if (MUTATE === "extrastrict") edits.push([
    "    if (ghlOpenIds.has(gid)) unverifiable.push(row); else extra.push(row);",
    "    extra.push(row);"]);
  // Clean stops requiring the report to have been able to look at anything.
  if (MUTATE === "falsegreen") edits.push([
    "    clean: counts.total === 0 && registryGaps.length === 0 && (stageToRole.size > 0 || ghlOpps.length === 0),",
    "    clean: counts.total === 0 && registryGaps.length === 0,"]);
  // The flip refuses whatever reconcile says, so --force is the only way through.
  if (MUTATE === "forceonly") edits.push([
    "  if (!recon.clean && !force) {",
    "  if (!force) {"]);
  // ── THE PARTIAL-REGISTRY CONTROLS. The first round of this build shipped
  //    `registrySeeded = stageToRole.size > 0`, which is true for BAM San Jose
  //    (4 roles mapped of 5) while 44 open nurture cards sat on the unmapped one.
  //    Each of these puts back one piece of that false green.
  if (MUTATE === "partialclean") edits.push([
    "    clean: counts.total === 0 && registryGaps.length === 0 && (stageToRole.size > 0 || ghlOpps.length === 0),",
    "    clean: counts.total === 0 && (stageToRole.size > 0 || ghlOpps.length === 0),"]);
  // Only the board half of the gap hunt survives: a role with cards but no mapping
  // goes unnoticed whenever its GHL column is absent or renamed past the matchers.
  if (MUTATE === "cardgap") edits.push([
    "    if (!mappedRoles.has(role) && !TERMINAL_ROLES.has(role)) gapRoles.add(role);",
    "    void role;"]);
  // ...and only the cards half: the hole is invisible until someone imports into it.
  if (MUTATE === "stagegap") edits.push([
    "      if (role && !mappedRoles.has(role)) { gapRoles.add(role); gapStages.push({ role, stage_id: st.id, stage_name: st.name || \"\", pipeline: p.name || \"\" }); }",
    "      if (role && !mappedRoles.has(role)) { gapStages.push({ role, stage_id: st.id, stage_name: st.name || \"\", pipeline: p.name || \"\" }); }"]);
  // The flip stops refusing the partial case by name.
  // The terminal-role carve-out deleted: won/unqualified can never be mapped, so a
  // card at one of them would block a flip that no amount of seeding could clear.
  if (MUTATE === "terminalgap") edits.push([
    "    if (!mappedRoles.has(role) && !TERMINAL_ROLES.has(role)) gapRoles.add(role);",
    "    if (!mappedRoles.has(role)) gapRoles.add(role);"]);
  // The gap hunt stops scoping to the pipelines the registry points at, so an
  // unrelated board's "Nurture" column becomes a permanent block on the sales flip.
  if (MUTATE === "otherboardgap") edits.push([
    "    if (registryPipelineIds.size && !registryPipelineIds.has(p.id)) continue;", "    void 0;"]);
  // Seeding goes back to searching every board and taking the first match, so a
  // role the Training pipeline lacks silently borrows another pipeline's column.
  if (MUTATE === "borrowstage") edits.push([
    "    const st = stages.find(ROLE_MATCHERS[role]);\n    const hit = st ? { pipelineId: pipe.id, stageId: st.id, stageName: st.name } : null;",
    "    let hit = null;\n    for (const p of pipelines) { const s2 = (p.stages || []).find(ROLE_MATCHERS[role]); if (s2) { hit = { pipelineId: p.id, stageId: s2.id, stageName: s2.name }; break; } }"]);
  if (MUTATE === "flippartial") edits.push([
    '  if (recon.clean_blocked_by === "registry_incomplete" && !force) {',
    '  if (false && recon.clean_blocked_by === "registry_incomplete" && !force) {']);
  return edits.length ? mutantModule("admin/pipeline-cutover.js", edits) : import("./admin/pipeline-cutover.js");
}

async function storeModule() {
  // The read-side alias, deleted as a tidy-up. This is the mutation the first
  // version of check F1.5 did NOT catch, because it only drove the registry
  // lookup - which resolves by role string and never consults a matcher.
  if (MUTATE === "dropalias") return mutantModule("agent/_store.js", [[
    '  interested:      (s) => /interest|ghost/i.test(s.name || ""),\n', ""]]);
  if (MUTATE === "seedcolumn") return mutantModule("agent/_store.js", [[
    "    ghl_stage_id: stageId || null,", "    ghl_stage_key: stageId || null,"]]);
  if (MUTATE === "mirrorraw") return mutantModule("agent/_store.js", [[
    "        if (rows && rows[0]) { stageId = rows[0].id; stageRole = rows[0].role; }",
    "        if (false && rows && rows[0]) { stageId = rows[0].id; stageRole = rows[0].role; }"]]);
  return import("./agent/_store.js");
}

async function presetMasterModule() {
  if (MUTATE !== "droplabelalias") return import("./agent/preset-master.js");
  return mutantModule("agent/preset-master.js", [[
    'const ROLE_ALIASES = { interested: "ghosted" };   // legacy role key, same stage',
    "const ROLE_ALIASES = {};"]]);
}

async function seedStagesModule() {
  if (MUTATE !== "legacyseed") return import("../scripts/seed-stages.js");
  return mutantModule("../scripts/seed-stages.js", [[
    '  { role: "ghosted",         label: "Ghosted",',
    '  { role: "interested",      label: "Ghosted",']]);
}

// ─── F1: the legacy role can no longer be WRITTEN, and still RESOLVES ────────
//
// `interested` was renamed to `ghosted` in July and three writers never got the
// message. The point of this check is the asymmetry: refusing to author it must not
// break the rows that already carry it, or the fix is a second outage.
async function checkLegacyRoleIsWriteOnlyRefused() {
  const { actionImportCards, actionSeedRegistry } = await cutoverModule();

  // 1. import-cards refuses it, and writes NOTHING - not even the valid cards
  //    alongside it. A partial import is worse than a refused one: the operator
  //    reads "ok" and never learns which half landed.
  {
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const out = await actionImportCards(ACADEMY, { cards: [
      { id: "g1", role: "responded", name: "Ada Parent" },
      { id: "g2", role: "interested", name: "Ben Parent" },
    ] });
    expect(out.error && out.error.status === 400, "legacy role refused on write",
      `import-cards ACCEPTED a card at role 'interested' (${JSON.stringify(out)}).\n    buildPresetRows never stamps a pipeline_stages row for that role, so the card lands on a role with no registry row - and the runbook was actively telling Claude to classify cards into it.`);
    expect(opps().length === 0, "legacy role refused on write",
      `import-cards wrote ${opps().length} opportunity row(s) despite refusing the batch. The validation has to happen before any write.`);
  }

  // 2. THE POSITIVE SIDE. Without it, a validator that refused everything passes.
  {
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const out = await actionImportCards(ACADEMY, { cards: [{ id: "g2", role: "ghosted", name: "Ben Parent" }] });
    expect(out.ok && out.written === 1, "legacy role refused on write",
      `import-cards refused the CANONICAL role 'ghosted' (${JSON.stringify(out)}). The differential is gone, so the refusal above proves nothing.`);
    expect(opps()[0] && opps()[0].stage_role === "ghosted", "legacy role refused on write",
      `the imported card landed at stage_role=${opps()[0] && opps()[0].stage_role}, not 'ghosted'.`);
  }

  // 3. Seeding the registry from a board whose stage is literally NAMED
  //    "Interested" must produce ONE row, at the canonical role. ROLE_MATCHERS
  //    still answers the legacy key (deliberately - see 5), so a loop over it that
  //    forgets to exclude the alias mints a duplicate row for the same GHL stage.
  //    That duplicate is precisely what migration 20260723143000 had to delete.
  {
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const out = await actionSeedRegistry(ACADEMY);
    expect(out.ok, "legacy role refused on write", `seed-registry failed: ${JSON.stringify(out)}`);
    const legacy = stages().filter((s) => s.role === "interested");
    expect(legacy.length === 0, "legacy role refused on write",
      `seed-registry created ${legacy.length} pipeline_stages row(s) at the legacy role 'interested'. The academy now has two rows pointing at the same GHL stage, which is the drift migration 20260723143000 exists to clean up.`);
    const ghosted = stages().find((s) => s.role === "ghosted");
    expect(ghosted && ghosted.ghl_stage_id === "st-int", "legacy role refused on write",
      `the GHL stage NAMED "Interested" did not seed the canonical 'ghosted' row (got ${JSON.stringify(ghosted)}). The GHL name is deliberately never renamed; the role key is what moved.`);
  }

  // 4. scripts/seed-stages.js writes into the SAME (client_id, role) rows, so a
  //    role it authors that import-cards refuses means the two writers disagree
  //    about what the board's roles are called. Driven, not grepped: every role in
  //    its table is offered to the import validator.
  {
    const { ROLES: seedRoles } = await seedStagesModule();
    for (const r of seedRoles) {
      installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
      const out = await actionImportCards(ACADEMY, { cards: [{ id: "gx", role: r.role }], dry_run: true });
      expect(!out.error, "legacy role refused on write",
        `scripts/seed-stages.js seeds a pipeline_stages row at role '${r.role}', and api/admin/pipeline-cutover.js refuses to import a card at it: ${JSON.stringify(out.error)}.\n    The two write into the same rows, so one of them is authoring a role the other believes does not exist.`);
    }
  }

  // 5. AND THE READ SIDE IS UNTOUCHED. Refusing to author the old key must not
  //    orphan the rows and the academies that still carry it, or the fix is a
  //    second outage. Three distinct readers, checked separately because they
  //    fail independently - the first version of this check drove only the
  //    registry lookup, which resolves by role STRING and therefore stayed green
  //    with the alias deleted from every other reader in the repo.
  {
    const { resolveStage, ROLE_MATCHERS } = await storeModule();

    // a. A registry row still at the legacy role resolves for an academy already
    //    flipped to the portal.
    installDb({ tables: {
      clients: [clientRow({ pipeline_provider: "portal" })],
      pipeline_stages: [{ id: "reg-legacy", client_id: ACADEMY, role: "interested", label: "Ghosted", ghl_pipeline_id: "pipe-training", ghl_stage_id: "st-int", ghl_stage_name: "Interested", position: 1 }],
      opportunities: [],
    } });
    const fromRegistry = await resolveStage(null, null, { clientId: ACADEMY, role: "interested", token: "t", locationId: "loc-test" });
    expect(fromRegistry && fromRegistry.stageId === "st-int", "legacy role refused on write",
      `resolveStage no longer returns anything for a registry row still at the legacy role 'interested' (${JSON.stringify(fromRegistry)}).`);

    // b. And for the far more common case - an academy still on GHL, where
    //    resolveStage falls through to the live regex finder. THAT is the reader
    //    ROLE_MATCHERS.interested exists for, and it is the one a tidy-up would
    //    delete first.
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const fromGhl = await resolveStage(null, null, { clientId: ACADEMY, role: "interested", token: "t", locationId: "loc-test" });
    expect(fromGhl && fromGhl.stageId === "st-int", "legacy role refused on write",
      `resolveStage could not find the stage for role 'interested' on an academy still reading from GHL (${JSON.stringify(fromGhl)}).\n    ROLE_MATCHERS keeps that alias on purpose: this build stops WRITING the key, it does not stop anything from asking for it.`);
    expect(typeof ROLE_MATCHERS.interested === "function", "legacy role refused on write",
      "ROLE_MATCHERS lost its `interested` entry. SEEDABLE_ROLES is what keeps it off the write paths; deleting the matcher itself breaks every caller that still asks for the old role.");

    // c. The board's DISPLAY name for a legacy row. preset-master's ROLE_ALIASES is
    //    the only thing that gives 'interested' a label, and without it an academy
    //    whose cleanup migration has not run renders a nameless column.
    const { masterStageLabels } = await presetMasterModule();
    const labels = masterStageLabels("free_trial") || {};
    expect(labels.interested && labels.interested === labels.ghosted, "legacy role refused on write",
      `the free_trial preset gives role 'interested' the label ${JSON.stringify(labels.interested)} and 'ghosted' ${JSON.stringify(labels.ghosted)}. They have to agree - it is one stage under two keys, and a legacy row with no label renders as a blank board column.`);
  }
}

// ─── F2: an import POPULATES the registry ────────────────────────────────────
//
// pipeline_stages.ghl_stage_id is the column reconcile and shadowMirrorMove both
// map through, and nothing in the import path had ever written it.
async function checkImportSeedsTheRegistry() {
  const { actionImportCards, actionSeedRegistry } = await cutoverModule();

  // 1. seed-registry as a first-class action: it fills the bridge column and
  //    touches no opportunity.
  {
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const out = await actionSeedRegistry(ACADEMY);
    expect(out.ok && out.written === MATCHED_ROLES.length, "import seeds the registry",
      `seed-registry reported ${JSON.stringify(out)}; expected ${MATCHED_ROLES.length} rows written for ${MATCHED_ROLES.join(", ")}.`);
    for (const role of MATCHED_ROLES) {
      const row = stages().find((s) => s.role === role);
      expect(row && row.ghl_stage_id === STAGE_FOR_ROLE[role], "import seeds the registry",
        `role '${role}' did not get ghl_stage_id=${STAGE_FOR_ROLE[role]} (row: ${JSON.stringify(row)}). Without it reconcile cannot map that stage's cards to a portal role at all.`);
    }
    expect(opps().length === 0, "import seeds the registry",
      "seed-registry wrote opportunity rows. It is registry-only - the import is the thing that moves people.");
    // The academy's Sponsorship board is listed FIRST by GHL and its first column
    // is also called "Responded". Seeding `responded` to it would make reconcile
    // map sponsor conversations into the sales pipeline and see none of the real
    // leads - drift that reads as data.
    expect(stages().find((s) => s.role === "responded").ghl_stage_id === "st-resp", "import seeds the registry",
      `role 'responded' seeded to ${stages().find((s) => s.role === "responded").ghl_stage_id}, not the Training pipeline's stage. Every other resolver in this repo prefers the /training/i pipeline; seeding has to agree with them or the registry points at a different board than the finders do.`);
  }

  // 2. ...and import-cards does the same seeding itself, so driving the CLI by
  //    hand cannot skip it. This is the half that made the gate reachable in
  //    practice rather than in principle.
  {
    installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    expect(stages().length === 0, "import seeds the registry", "fixture started with a seeded registry, so this check would pass without the code doing anything.");
    const out = await actionImportCards(ACADEMY, { cards: CARDS });
    expect(out.ok && out.written === CARDS.length, "import seeds the registry", `import-cards returned ${JSON.stringify(out)}`);
    expect(out.registry && out.registry.ok === true && out.registry.written === MATCHED_ROLES.length, "import seeds the registry",
      `import-cards did not report a successful registry seed: ${JSON.stringify(out.registry)}. The operator has to be able to SEE that half happened - it is best-effort, so silence would mean an import that reconcile can never read.`);
    for (const role of MATCHED_ROLES) {
      const row = stages().find((s) => s.role === role);
      expect(row && row.ghl_stage_id === STAGE_FOR_ROLE[role], "import seeds the registry",
        `after a plain import-cards, role '${role}' still has no ghl_stage_id (row: ${JSON.stringify(row)}).`);
    }
  }

  // 3. Idempotent, and it does not clobber the preset's board labels. applyPreset
  //    owns label/position; seeding owns the GHL bridge. A merge that carried
  //    label would rename an academy's columns to whatever their GHL calls them.
  {
    installDb({ tables: {
      clients: [clientRow()],
      pipeline_stages: [{ id: "reg-1", client_id: ACADEMY, role: "ghosted", label: "Ghosted", position: 1, offer_id: "offer-1", is_terminal: false }],
      opportunities: [],
    } });
    await actionSeedRegistry(ACADEMY);
    await actionSeedRegistry(ACADEMY);
    const ghosted = stages().filter((s) => s.role === "ghosted");
    expect(ghosted.length === 1, "import seeds the registry",
      `two seed-registry runs produced ${ghosted.length} 'ghosted' rows. The upsert is supposed to be idempotent on (client_id, role).`);
    expect(ghosted[0].label === "Ghosted" && ghosted[0].offer_id === "offer-1", "import seeds the registry",
      `seeding overwrote the preset's own columns: ${JSON.stringify(ghosted[0])}. It must fill the GHL bridge and leave label/position/offer_id alone.`);
    expect(ghosted[0].ghl_stage_id === "st-int", "import seeds the registry",
      "seeding an EXISTING preset row left ghl_stage_id unfilled, which is the exact state every preset-stamped academy starts in.");
  }
}

// ─── F3: reconcile goes from never-clean to clean ────────────────────────────
//
// The headline. Same fixture, same cards; the only difference is whether the
// registry has been seeded.
async function checkReconcileCanBeClean() {
  const { actionImportCards, actionSeedRegistry, actionReconcile, loadClientFlags } = await cutoverModule();
  const flags = { pipeline_provider: "ghl", pipeline_shadow: true, business_name: "Migration Test Academy" };

  // A store populated exactly as a pre-fix import left it: every card written, the
  // registry untouched.
  const importedButUnseeded = () => ({
    clients: [clientRow({ pipeline_shadow: true })],
    pipeline_stages: [],
    opportunities: CARDS.map((c, i) => ({
      id: `opp-${i}`, client_id: ACADEMY, ghl_opportunity_id: c.id,
      stage_role: c.role, status: "open", contact_name: c.name, source: "ghl-import",
    })),
  });

  // 1. BEFORE. Drift is zero because nothing could be compared, and that is not
  //    the same thing as clean. This is the state every academy was in.
  {
    installDb({ tables: importedButUnseeded() });
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === false, "reconcile can be clean",
      `reconcile called an UNSEEDED academy clean (${JSON.stringify({ clean: recon.clean, counts: recon.drift.counts, registry: recon.registry })}).\n    With no ghl_stage_id anywhere, every GHL card is unmapped and every portal card unverifiable, so the drift arithmetic is vacuously zero. A report that compared nothing is not a clean bill of health.`);
    expect(recon.clean_blocked_by === "registry_unseeded", "reconcile can be clean",
      `reconcile did not name the reason it could not certify: clean_blocked_by=${JSON.stringify(recon.clean_blocked_by)}. "0 drift items and still not clean" is unreadable without it.`);
  }

  // 1b. THE SAME VACUUM, on an academy whose board matches NOTHING. Every other
  //     unseeded fixture is caught by the registry-gap hunt too (an unmapped board
  //     column is a gap), so this is the only shape where the "the report mapped
  //     nothing at all" conjunct is the sole thing standing between a real academy
  //     and a green flip. An academy whose columns are all called things like
  //     "New Lead" is not exotic - it is exactly who has never been migrated.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    const onlyNewLead = [{ id: "pipe-training", name: "Training Pipeline", stages: [{ id: "st-new", name: "New Lead", position: 0 }] }];
    const recon = await withGhlBoard(onlyNewLead, () => withGhlOpps([{ id: "g4", pipelineStageId: "st-new", name: "Dev Parent" }], () => actionReconcile(ACADEMY, flags)));
    expect(recon.registry.gap_roles.length === 0, "reconcile can be clean",
      `this fixture is meant to have NO registry gaps - the board simply matches no role - so that the vacuum conjunct is the only thing left to catch it. It reported ${JSON.stringify(recon.registry.gap_roles)}.`);
    expect(recon.clean === false && recon.clean_blocked_by === "registry_unseeded", "reconcile can be clean",
      `an academy with an empty registry, a board that matches no role, and an open card in GHL read as clean: ${JSON.stringify({ clean: recon.clean, blocked: recon.clean_blocked_by, counts: recon.drift.counts })}.\n    Nothing was compared. Flipping here would move the system of record to an empty store.`);
  }

  // 2. AFTER. Seed the registry against the same store - nothing else changes -
  //    and the same report certifies. Nobody had ever seen this happen.
  {
    installDb({ tables: importedButUnseeded() });
    const seeded = await actionSeedRegistry(ACADEMY);
    expect(seeded.ok, "reconcile can be clean", `seed-registry failed: ${JSON.stringify(seeded)}`);
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === true, "reconcile can be clean",
      `reconcile is STILL not clean after seeding the registry: ${JSON.stringify({ counts: recon.drift.counts, missing: recon.drift.missing, mismatched: recon.drift.mismatched, extra: recon.drift.extra, blocked: recon.clean_blocked_by })}.\n    This is the whole point of the build: if it cannot reach clean, \`flip --force\` is still the only way through and the gate is still decoration.`);
    expect(recon.drift.counts.total === 0, "reconcile can be clean", `clean was true but counts were ${JSON.stringify(recon.drift.counts)}`);
    // g4 lives in "New Lead" and was classified by hand. Still open in GHL, so not
    // stale; unnameable by the registry, so not verified either.
    expect(recon.drift.unverifiable.length === 1 && recon.drift.unverifiable[0].ghl_opportunity_id === "g4", "reconcile can be clean",
      `the card imported out of an unmapped stage was reported as ${JSON.stringify(recon.drift.unverifiable)}; expected exactly g4.\n    Counting it as drift is what made a realistic import permanently dirty; hiding it entirely would mean nobody sees which rows only the classifier vouches for.`);
  }

  // 3. And the whole path, end to end, from an empty store.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    await actionImportCards(ACADEMY, { cards: CARDS });
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === true, "reconcile can be clean",
      `import-cards followed by reconcile is not clean: ${JSON.stringify({ counts: recon.drift.counts, blocked: recon.clean_blocked_by })}. This is the exact sequence the runbook tells staff to run.`);
  }

  // 4. THE DIFFERENTIALS. A gate that says clean no matter what is worse than one
  //    that never says it, so each drift class has to still bite on the same board.
  {
    // extra: a portal row for a card GHL does not have open at all.
    installDb({ tables: importedButUnseeded() });
    await actionSeedRegistry(ACADEMY);
    DB.tables.opportunities.push({ id: "opp-stale", client_id: ACADEMY, ghl_opportunity_id: "g-gone", stage_role: "responded", status: "open", contact_name: "Closed In GHL" });
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === false && recon.drift.counts.extra === 1, "reconcile can be clean",
      `a portal row whose card is not open in GHL AT ALL did not count as extra: ${JSON.stringify(recon.drift.counts)}. That is a genuinely stale row and relaxing \`extra\` must not have swallowed it.`);
  }
  {
    // mismatched: the portal disagrees with the stage the card actually sits in.
    installDb({ tables: importedButUnseeded() });
    await actionSeedRegistry(ACADEMY);
    DB.tables.opportunities.find((o) => o.ghl_opportunity_id === "g1").stage_role = "nurture";
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === false && recon.drift.counts.mismatched === 1, "reconcile can be clean",
      `a card sitting in GHL's Responded stage but stamped 'nurture' in the portal did not count as mismatched: ${JSON.stringify(recon.drift.counts)}`);
  }
  {
    // missing: a card open in a MAPPED GHL stage that the import skipped.
    installDb({ tables: importedButUnseeded() });
    await actionSeedRegistry(ACADEMY);
    DB.tables.opportunities = DB.tables.opportunities.filter((o) => o.ghl_opportunity_id !== "g3");
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === false && recon.drift.counts.missing === 1, "reconcile can be clean",
      `a card open in GHL's Booked Trial stage with no portal row did not count as missing: ${JSON.stringify(recon.drift.counts)}`);
  }
  // loadClientFlags is imported so a broken export list fails here rather than in
  // production - scripts/ghl-import.mjs calls it before every command.
  expect(typeof loadClientFlags === "function", "reconcile can be clean", "loadClientFlags is no longer exported; scripts/ghl-import.mjs cannot run.");
}

// ─── F4: the flip goes through WITHOUT --force ───────────────────────────────
//
// The behavioural success criterion. `--force` was the only way anyone had ever
// completed a cutover, which means the guard was never a guard.
async function checkFlipNeedsNoForce() {
  const { actionImportCards, actionFlip } = await cutoverModule();

  // 1. The honest path: shadow on, cards imported, reconcile clean, flip.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    await actionImportCards(ACADEMY, { cards: CARDS });
    const flags = { pipeline_provider: "ghl", pipeline_shadow: true };
    const out = await actionFlip(ACADEMY, flags, "portal", false);
    expect(out.ok === true, "flip needs no force",
      `flip refused a properly imported, properly seeded academy WITHOUT force: ${JSON.stringify(out.error || out)}.\n    If this cannot pass, every cutover still ends in \`flip --force\` and every guard in this file is decoration.`);
    expect(out.forced === false, "flip needs no force", `the flip reported forced=${out.forced} on a clean reconcile.`);
    expect(DB.tables.clients[0].pipeline_provider === "portal", "flip needs no force",
      `flip returned ok but clients.pipeline_provider is ${DB.tables.clients[0].pipeline_provider}.`);
  }

  // 2. An unseeded registry is refused BY NAME, and the refusal names the command
  //    that fixes it. The old message told staff to go open a board.
  {
    installDb({ tables: {
      clients: [clientRow({ pipeline_shadow: true })],
      pipeline_stages: [],
      opportunities: CARDS.map((c, i) => ({ id: `opp-${i}`, client_id: ACADEMY, ghl_opportunity_id: c.id, stage_role: c.role, status: "open", contact_name: c.name })),
    } });
    const out = await actionFlip(ACADEMY, { pipeline_provider: "ghl", pipeline_shadow: true }, "portal", false);
    expect(out.error && out.error.reason === "registry_unseeded", "flip needs no force",
      `flipping an academy whose registry was never seeded returned ${JSON.stringify(out)}. It has to refuse, and say which command fixes it - a "0 drift items, refused" message reads as a bug.`);
    expect(/seed-registry/.test(String(out.error && out.error.message)), "flip needs no force",
      `the refusal does not name seed-registry: ${JSON.stringify(out.error && out.error.message)}`);
    expect(DB.tables.clients[0].pipeline_provider === "ghl", "flip needs no force", "a refused flip still changed the provider.");
  }

  // 3. Real drift is still refused. Otherwise check 1 proves only that the guard
  //    was removed.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    await actionImportCards(ACADEMY, { cards: CARDS });
    DB.tables.opportunities.push({ id: "opp-stale", client_id: ACADEMY, ghl_opportunity_id: "g-gone", stage_role: "responded", status: "open", contact_name: "Closed In GHL" });
    const out = await actionFlip(ACADEMY, { pipeline_provider: "ghl", pipeline_shadow: true }, "portal", false);
    expect(out.error && out.error.reason === "drift", "flip needs no force",
      `flip accepted an academy with a stale portal row: ${JSON.stringify(out)}`);
    expect(DB.tables.clients[0].pipeline_provider === "ghl", "flip needs no force", "a drifted flip still changed the provider.");
  }
}

// ─── F5: a raw GHL stage move mirrors, once the registry is seeded ───────────
//
// The side effect. shadowMirrorMove maps a raw stage id back to a role through the
// same column, so while the registry was empty a board drag on a shadowed academy
// silently stamped nothing - the same missing column, a different symptom.
async function checkRawStageMoveMirrors() {
  const { actionSeedRegistry } = await cutoverModule();
  const { shadowMirrorMove } = await storeModule();

  const world = () => ({
    clients: [clientRow({ pipeline_shadow: true })],
    pipeline_stages: [],
    opportunities: [{ id: "opp-1", client_id: ACADEMY, ghl_opportunity_id: "g1", stage_role: "responded", status: "open", contact_name: "Ada Parent" }],
  });

  // Unseeded: the lookup finds nothing, stage_role is left alone.
  {
    installDb({ tables: world() });
    await shadowMirrorMove(ACADEMY, { shadow: true, ghlOpportunityId: "g1", ghlStageId: "st-int", ghlPipelineId: "pipe-training" });
    expect(opps()[0].stage_role === "responded", "raw stage move mirrors",
      `with an EMPTY registry the mirror somehow resolved a role (${opps()[0].stage_role}). This half of the differential is what makes the seeded half meaningful.`);
  }
  // Seeded: the same call maps st-int back to 'ghosted'.
  {
    installDb({ tables: world() });
    await actionSeedRegistry(ACADEMY);
    await shadowMirrorMove(ACADEMY, { shadow: true, ghlOpportunityId: "g1", ghlStageId: "st-int", ghlPipelineId: "pipe-training" });
    expect(opps()[0].stage_role === "ghosted", "raw stage move mirrors",
      `a raw GHL stage move into st-int left the portal row at stage_role=${opps()[0].stage_role}. shadowMirrorMove maps the stage id through pipeline_stages.ghl_stage_id, so a board drag on a shadowed academy mirrors nothing until that column is filled.`);
  }
}

// ─── F6: the registry upsert actually WRITES ─────────────────────────────────
//
// shadowUpsertStageRegistry swallows its own errors and returns null, so a column
// name PostgREST does not have turns into a silent no-op rather than a 500. That is
// the failure mode nothing in this repo would have noticed.
async function checkRegistryUpsertWrites() {
  const { shadowUpsertStageRegistry } = await storeModule();
  installDb({ tables: { clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
  const rowId = await shadowUpsertStageRegistry(ACADEMY, "ghosted", {
    pipelineId: "pipe-training", stageId: "st-int", stageName: "Interested",
  });
  expect(!!rowId, "registry upsert writes",
    "shadowUpsertStageRegistry returned null - it caught its own error and reported nothing. Every seeding path in this build goes through it, so a silent failure here is a silent failure everywhere.");
  const row = stages()[0];
  expect(row && row.ghl_stage_id === "st-int" && row.ghl_stage_name === "Interested", "registry upsert writes",
    `the registry row does not carry the GHL stage: ${JSON.stringify(row)}`);
}

// ─── F7: seed-registry is reachable from BOTH entry points ───────────────────
//
// The skill being written against this calls the action by name, so "it exists as a
// function" is not enough - it has to be dispatchable from the staff HTTP handler
// AND from scripts/ghl-import.mjs. actionStatus is the standing counter-example:
// HTTP-only, absent from the export list, invisible to the CLI.
async function checkBothEntryPoints() {
  const mod = await cutoverModule();
  expect(typeof mod.actionSeedRegistry === "function", "both entry points",
    "actionSeedRegistry is not exported from api/admin/pipeline-cutover.js, so scripts/ghl-import.mjs cannot import it.");

  // 1. The staff HTTP path, driven for real through the handler.
  {
    installDb({
      user: { id: "u-staff", email: "zoran@byanymeansbball.com" },
      tables: { staff: [{ user_id: "u-staff", email: "zoran@byanymeansbball.com", role: "admin" }], clients: [clientRow()], pipeline_stages: [], opportunities: [] },
    });
    const res = fakeRes();
    await mod.default({ method: "POST", headers: { authorization: "Bearer stub" }, query: { action: "seed-registry", client_id: ACADEMY }, body: {} }, res);
    expect(res.statusCode === 200, "both entry points",
      `POST action=seed-registry returned ${res.statusCode}: ${JSON.stringify(res.payload)}. The staff handler does not dispatch it.`);
    expect(stages().length === MATCHED_ROLES.length, "both entry points",
      `the HTTP path returned 200 but wrote ${stages().length} registry rows.`);
  }

  // 2. ...and it is BAM-staff-only, like every other action on this endpoint. A new
  //    action added outside the gate would be a write path with no auth.
  {
    installDb({ user: null, tables: { staff: [], clients: [clientRow()], pipeline_stages: [], opportunities: [] } });
    const res = fakeRes();
    await mod.default({ method: "POST", headers: {}, query: { action: "seed-registry", client_id: ACADEMY }, body: {} }, res);
    expect(res.statusCode === 401 || res.statusCode === 403, "both entry points",
      `an unauthenticated POST action=seed-registry returned ${res.statusCode}. Every action on this endpoint is staff-only.`);
    expect(stages().length === 0, "both entry points", "an unauthenticated seed-registry still wrote to the registry.");
  }

  // 3. The CLI. Spawned rather than imported (its top level runs commands and calls
  //    process.exit), so what this proves is narrow and worth stating: the command
  //    NAME is dispatched, and the module links - a missing actionSeedRegistry
  //    export is a link error, not a runtime one. It does NOT execute the block.
  const cli = (args) => {
    try { execFileSync(process.execPath, [path.join(HERE, "../scripts/ghl-import.mjs"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return { out: "", err: "" }; }
    catch (e) { return { out: String(e.stdout || ""), err: String(e.stderr || "") }; }
  };
  const known = cli(["seed-registry"]);
  const unknown = cli(["not-a-command"]);
  expect(/--client <id> required/.test(known.err), "both entry points",
    `\`ghl-import.mjs seed-registry\` did not reach the --client check; it said: ${JSON.stringify(known.err.slice(0, 400))}.\n    Either the command is not in the CLI's dispatch list, or the module failed to link (a missing export shows up here as a SyntaxError).`);
  expect(/usage: ghl-import/.test(unknown.err), "both entry points",
    `an unknown command did not print the usage line, so the check above cannot tell "dispatched" from "everything reaches the same error": ${JSON.stringify(unknown.err.slice(0, 400))}`);
  expect(/seed-registry/.test(unknown.err), "both entry points",
    "the CLI's own usage line does not list seed-registry, so nobody driving it by hand would find it.");
}

// ─── F8: BAM SAN JOSE. A PARTIALLY SEEDED REGISTRY IS NOT CLEAN ──────────────
//
// This is the check the first round of this build did not have, and the gap it
// left was not theoretical. Production, measured:
//
//   BAM San Jose  5 registry rows, 4 mapped, `nurture` unmapped, 44 OPEN nurture
//                 cards, every one of them carrying a ghl_opportunity_id
//   DETAIL Miami  4 rows, 3 mapped, `ghosted` unmapped, 17 open cards - and it is
//                 ALREADY on pipeline_provider='portal'
//
// Under a `registry seeded = size > 0` bar, all 44 of San Jose's cards land in
// `unverifiable`, `unverifiable` was moved out of `counts` so that a realistic
// import could ever pass, and reconcile therefore certified an academy whose
// largest column had never been compared to anything. Zero drift, because the
// arithmetic never reached a card it could not map.
//
// The narrowing that made `clean` reachable was correct. What was wrong is that it
// was silent at the point of decision.
async function checkPartialRegistryIsNotClean() {
  const { actionSeedRegistry, actionReconcile, actionFlip } = await cutoverModule();
  const flags = { pipeline_provider: "ghl", pipeline_shadow: true };

  // San Jose's exact shape: a COMPLETE, drift-free import, then the one mapping
  // removed. Built by importing for real first, so the fixture is whatever the
  // production code actually writes and the only thing hand-edited is the gap.
  //
  // Every assertion below leans on drift being ZERO. If the fixture ever drifts,
  // the checks would pass for the wrong reason, so the first one asserts that.
  const { actionImportCards } = await cutoverModule();
  const sanJose = async () => {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    await actionImportCards(ACADEMY, { cards: CARDS });
    const nurture = stages().find((s) => s.role === "nurture");
    nurture.ghl_stage_id = null; nurture.ghl_stage_name = null;
  };

  // 1. Reconcile refuses, and refuses for the right reason. Note what it does NOT
  //    do: report drift. Every count is zero, which is why counting was never going
  //    to catch this.
  {
    await sanJose();
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.drift.counts.total === 0, "a partial registry is not clean",
      `this fixture is supposed to show ZERO drift - that is the whole point of it. It showed ${JSON.stringify(recon.drift.counts)}, so the check below would pass for the wrong reason.`);
    expect(recon.clean === false, "a partial registry is not clean",
      `reconcile certified an academy whose 'nurture' role has no GHL stage while an open card sits on it. Zero drift, because the arithmetic skipped that card instead of checking it: ${JSON.stringify({ counts: recon.drift.counts, unverifiable: recon.drift.unverifiable, registry: recon.registry })}.\n    This is BAM San Jose with 44 cards instead of 1, and DETAIL Miami with 17 - and DETAIL is already flipped.`);
    expect(recon.clean_blocked_by === "registry_incomplete", "a partial registry is not clean",
      `the refusal was not named 'registry_incomplete' (got ${JSON.stringify(recon.clean_blocked_by)}). "Not clean, 0 drift" with no reason attached reads as a bug and gets forced past.`);
    expect(recon.registry.complete === false && recon.registry.gap_roles.join(",") === "nurture", "a partial registry is not clean",
      `the report does not name WHICH role is unmapped: ${JSON.stringify(recon.registry)}. An operator cannot fix a gap the report will not point at.`);
  }

  // 2. The flip refuses it by name too, and does not move the provider.
  {
    await sanJose();
    const out = await actionFlip(ACADEMY, flags, "portal", false);
    expect(out.error && out.error.reason === "registry_incomplete", "a partial registry is not clean",
      `flip accepted a partially seeded academy: ${JSON.stringify(out)}`);
    expect(/nurture/.test(String(out.error && out.error.message)), "a partial registry is not clean",
      `the flip refusal does not say which role is missing: ${JSON.stringify(out.error && out.error.message)}`);
    expect(DB.tables.clients[0].pipeline_provider === "ghl", "a partial registry is not clean",
      "a refused flip still moved the system of record.");
  }

  // 3. It is caught even when the cards are PORTAL-NATIVE - no ghl_opportunity_id,
  //    so nothing about them appears in the unverifiable arithmetic at all. This is
  //    the half a check built only on `unverifiable > 0` would miss, and 13 of BAM
  //    GTA's 29 nurture cards are exactly this shape.
  {
    await sanJose();
    // The board has NO Nurture column, so nothing can be inferred from it - and the
    // nurture card is portal-native, so nothing can be inferred from the drift
    // arithmetic either. The only thing that can catch this is asking which ROLES
    // hold cards. This is very likely the real BAM San Jose: its unmapped `nurture`
    // row has a null ghl_pipeline_id too, which means no seeding run ever found a
    // stage for it. 13 of BAM GTA's 29 nurture cards are portal-native as well.
    await withGhlBoard(boardWithout("st-nurt"), () => withGhlOpps(GHL_OPEN.filter((o) => ["g1", "g2", "g3"].includes(o.id)), async () => {
      DB.tables.opportunities = DB.tables.opportunities.filter((o) => ["g1", "g2", "g3"].includes(o.ghl_opportunity_id));
      DB.tables.opportunities.push({ id: "opp-native", client_id: ACADEMY, ghl_opportunity_id: null, stage_role: "nurture", status: "open", contact_name: "Portal Native" });
      const recon = await actionReconcile(ACADEMY, flags);
      expect(recon.drift.counts.total === 0 && recon.drift.unverifiable.length === 0 && (recon.registry.gap_stages || []).length === 0, "a partial registry is not clean",
        `this fixture is meant to leave the roles-with-cards check as the ONLY thing that can catch the gap: zero drift, zero unverifiable, no unmapped board column. It has ${JSON.stringify(recon.drift.counts)} / ${recon.drift.unverifiable.length} / ${JSON.stringify(recon.registry.gap_stages)}.`);
      expect(recon.clean === false && recon.clean_blocked_by === "registry_incomplete", "a partial registry is not clean",
        `a portal-native card, on a role with no GHL stage, on a board with no such column, read as clean: ${JSON.stringify({ clean: recon.clean, blocked: recon.clean_blocked_by, registry: recon.registry })}.\n    Nothing in the unverifiable arithmetic can see this card and nothing on the board hints at it, which is why the gap has to be measured on the ROLES THAT HOLD CARDS and not only on what failed to map.`);
    }));
  }

  // 4. And caught BEFORE any card is imported, off the board alone. This is when it
  //    is cheap: the operator seeds, sees the gap, fixes it, then imports.
  {
    await sanJose();
    DB.tables.opportunities = [];
    const recon = await withGhlOpps([], () => actionReconcile(ACADEMY, flags));
    expect(recon.clean === false && recon.registry.gap_roles.includes("nurture"), "a partial registry is not clean",
      `an empty store over a registry with a known gap read as clean: ${JSON.stringify({ clean: recon.clean, registry: recon.registry })}. The academy's own board has a Nurture column; the registry has no stage for it.`);
    const gap = (recon.registry.gap_stages || []).find((g) => g.role === "nurture");
    expect(gap && gap.stage_name === "Nurture", "a partial registry is not clean",
      `the report does not say which GHL column is unmapped: ${JSON.stringify(recon.registry.gap_stages)}. Naming the stage is what turns "seed it again" into something the operator can check.`);
  }

  // 5. THE NARROW EXCEPTION, asserted rather than assumed. A card classified out of
  //    a column that matches NO role ("New Lead") must still be able to read clean,
  //    or every realistic import is unpassable and --force comes straight back. The
  //    difference from the case above is exact: there, our own matchers name a role
  //    the registry missed; here, there is no role to miss.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    const { actionImportCards } = await cutoverModule();
    await actionImportCards(ACADEMY, { cards: CARDS });
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.clean === true, "a partial registry is not clean",
      `a fully seeded academy with one card classified out of its "New Lead" column is no longer clean: ${JSON.stringify({ counts: recon.drift.counts, blocked: recon.clean_blocked_by, registry: recon.registry })}.\n    Blocking on unverifiable cards outright would mean every academy with a column outside the preset can never flip without --force, which is the failure this whole build set out to end.`);
    expect(recon.drift.unverifiable.length === 1, "a partial registry is not clean",
      "the clean fixture no longer contains an unverifiable card, so it stopped proving the exception is real.");
    expect(recon.registry.complete === true, "a partial registry is not clean",
      `the registry reported a gap on a fully seeded academy: ${JSON.stringify(recon.registry)}. "New Lead" matches no role, so it is not a gap - it is the classifier's job.`);
  }

  // 6. THE TERMINAL-ROLE EXCEPTION, exercised rather than reasoned about. won and
  //    unqualified have no GHL stage BY DESIGN - won is a GHL status and
  //    unqualified is a status plus a tag (see scripts/seed-stages.js) - so a card
  //    at one of them can never be mapped, and treating that as a gap would be a
  //    refusal seed-registry could never clear. A permanently unfixable gate is
  //    just --force with extra steps.
  //
  //    Written after watching the suite stay GREEN with the exception deleted: no
  //    fixture had an open card at a terminal role, so the carve-out was pure
  //    assertion. Production has none either, which is exactly why it needed one
  //    here instead.
  {
    installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
    const { actionImportCards } = await cutoverModule();
    await actionImportCards(ACADEMY, { cards: CARDS });
    DB.tables.opportunities.push({ id: "opp-unq", client_id: ACADEMY, ghl_opportunity_id: null, stage_role: "unqualified", status: "open", contact_name: "Wrong Age" });
    const recon = await actionReconcile(ACADEMY, flags);
    expect(recon.registry.gap_roles.length === 0 && recon.clean === true, "a partial registry is not clean",
      `an open card at the terminal role 'unqualified' was reported as a registry gap: ${JSON.stringify({ clean: recon.clean, registry: recon.registry })}.\n    Nothing can ever map it - there is no GHL stage for a status-and-tag role - so this refusal could never be cleared by seed-registry, and the operator's only remaining move would be the --force this build exists to retire.`);
  }

  // 7. ANOTHER BOARD'S COLUMN IS NOT A GAP IN THIS ONE. An academy's Sponsorship
  //    pipeline may well have a "Nurture" column; the sales registry not mapping it
  //    is correct, not a hole. Two things are asserted at once, and the second was a
  //    real bug this fixture found: seeding must not BORROW that column either.
  //    Before the fix, seedRegistryFromGhl searched every pipeline and took the
  //    first match, so a Training board with no Nurture column silently mapped the
  //    `nurture` role onto the sponsorship board - after which reconcile compares
  //    sponsor conversations against the sales pipeline and calls it verified.
  {
    const sponsorsWithNurture = { id: "pipe-sponsors", name: "Sponsorship Outreach", stages: [
      { id: "sp-resp", name: "Responded", position: 0 },
      { id: "sp-nurt", name: "Nurture",   position: 1 },
    ] };
    const board = [sponsorsWithNurture, { ...PIPELINE, stages: PIPELINE.stages.filter((s) => s.id !== "st-nurt") }];
    const threeCards = CARDS.filter((c) => ["g1", "g2", "g3"].includes(c.id));
    await withGhlBoard(board, () => withGhlOpps(GHL_OPEN.filter((o) => ["g1", "g2", "g3"].includes(o.id)), async () => {
      installDb({ tables: { clients: [clientRow({ pipeline_shadow: true })], pipeline_stages: [], opportunities: [] } });
      const { actionImportCards } = await cutoverModule();
      const imported = await actionImportCards(ACADEMY, { cards: threeCards });
      expect(imported.registry.unmatched.includes("nurture"), "a partial registry is not clean",
        `seeding claimed to match 'nurture' on a Training board that has no Nurture column: ${JSON.stringify(imported.registry)}. It borrowed the Sponsorship board's, which points the sales role at another pipeline entirely.`);
      expect(!stages().some((s) => s.ghl_stage_id === "sp-nurt"), "a partial registry is not clean",
        `a registry row was seeded with the SPONSORSHIP board's stage id: ${JSON.stringify(stages())}.`);
      const recon = await actionReconcile(ACADEMY, flags);
      expect(recon.clean === true && recon.registry.gap_roles.length === 0, "a partial registry is not clean",
        `an unrelated board's "Nurture" column was treated as a gap in the SALES registry: ${JSON.stringify({ clean: recon.clean, registry: recon.registry })}.\n    No sales card is unmapped and no sales column is unmapped; refusing here would be a permanent block driven by a pipeline this cutover does not touch.`);
    }));
  }
}

function fakeRes() {
  const r = { statusCode: null, payload: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.setHeader = () => r; r.end = () => r; r.send = (b) => { r.payload = b; return r; };
  return r;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN) await main();

async function main() {
  console.log("\n── GHL migration: the legacy role, and the gate nobody had seen pass ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const steps = [
    ["the legacy role cannot be written, and still resolves", checkLegacyRoleIsWriteOnlyRefused],
    ["an import populates the stage registry", checkImportSeedsTheRegistry],
    ["reconcile goes from never-clean to clean", checkReconcileCanBeClean],
    ["the flip goes through without --force", checkFlipNeedsNoForce],
    ["a raw GHL stage move mirrors once seeded", checkRawStageMoveMirrors],
    ["a partially seeded registry is not clean", checkPartialRegistryIsNotClean],
    ["the registry upsert actually writes", checkRegistryUpsertWrites],
    ["seed-registry is reachable from both entry points", checkBothEntryPoints],
  ];
  for (const [label, fn] of steps) {
    const before = fails.length;
    try { await fn(); }
    catch (e) { fail(label, `threw: ${e && e.stack ? e.stack : e}`); }
    console.log(`  ${fails.length > before ? "❌" : "✅"} ${label}`);
  }

  for (const f of fails) console.log(`\n── ${f.what} ──\n${f.detail}`);

  if (MUTATE) {
    if (controlBroken) {
      console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
      process.exit(1);
    }
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }
  if (!fails.length) {
    console.log("\n✅ The migration writes only the canonical role, seeds the registry it depends on, and can reconcile clean without --force.\n");
    process.exit(0);
  }
  console.log(`\n❌ ${fails.length} failure(s).\n`);
  process.exit(1);
}
