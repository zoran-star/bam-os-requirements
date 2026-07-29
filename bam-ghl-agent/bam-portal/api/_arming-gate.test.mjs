// THE ARMING GATES, TESTED BY BEHAVIOUR RATHER THAN BY TEXT.
//
//   node api/_arming-gate.test.mjs      # exits non-zero on any failure
//
// WHY THIS FILE EXISTS. api/_approval-render.test.mjs already checked the owner-only
// arming gates - by reading api/automations.js as a STRING and asserting that certain
// words were present in it. In round 5 a tester made three edits that reversed the
// behaviour while leaving every pinned word in place, and all eight suites, all nine
// negative controls and the UI verifier stayed green:
//
//   1. `canApproveAsOwner: (clientId) => staff || academyClientIds.includes(clientId)`
//      one word changed in api/agent/_auth.js, and every can_train_agent teammate is
//      an approver again. Every check asked whether automations.js CALLS
//      canApproveAsOwner; nothing asked what it MEANS.
//   2. `return res.status(403)` swapped for a `console.warn`, condition string
//      untouched. The grep matched the condition, so it passed.
//   3. `if (false && ...)` prefixed onto the other gate. The regex matched the
//      substring after `false &&`, so it passed.
//
// And a fourth, on the flag that makes the whole approval surface load-bearing:
// deleting `approved` from the three places api/automations.js requires it left the
// entire repo green. An approval nothing consults is decoration.
//
// So every check below INVOKES the real code and asserts what it DID. The rule for
// anything added here: if you cannot break the production code and watch this file
// go red, the check is not finished.
//
// ROUND 6 ADDED, in the same spirit: `enabled` proved load-bearing at the same three
// places `approved` already was (nothing was ever enabled:false + approved:true, so
// deleting the operator's Off switch from the worker shipped green); the yes proved
// not to reach the `onboarding` welcome sequence at the CALL SITE, not just in the
// constant; the tenant scope on the arming write; armingRefusal's two documented
// fail-closed branches, one of which refused only by accident via a TypeError; and
// the composed empty-sequence failure in F6, which is the one that mattered.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE NEGATIVE CONTROLS WORK, because it is unusual.
//
// A control has to apply the tester's exact edit to production source, which a test
// cannot do in place. So it writes a MUTATED COPY of the real module next to it and
// imports that instead (mutantModule below). The copy resolves the same relative
// imports, so it is the real module with one line changed, and it is deleted
// straight after import. If the text a control means to mutate is no longer in the
// file, the control THROWS rather than passing quietly - a control that has lost its
// target is the failure mode this whole file exists to catch.
//
//   MUTATE=ownergate    node api/_arming-gate.test.mjs  # canApproveAsOwner widened to canActOn
//   MUTATE=warngate     node api/_arming-gate.test.mjs  # the wizard 403 becomes a console.warn
//   MUTATE=deadgate     node api/_arming-gate.test.mjs  # the panel gate becomes `if (false && ...)`
//   MUTATE=academygate  node api/_arming-gate.test.mjs  # the per-academy canActOn 403 becomes a warn
//   MUTATE=enrolgate    node api/_arming-gate.test.mjs  # enrollContact stops requiring approved
//   MUTATE=livegate     node api/_arming-gate.test.mjs  # isAutomationLive stops requiring approved
//   MUTATE=workergate   node api/_arming-gate.test.mjs  # the worker stops requiring approved
//   MUTATE=bookinggate  node api/_arming-gate.test.mjs  # the booking opener lane loses its owner check
//   MUTATE=seedrepair   node api/_arming-gate.test.mjs  # the dormant-row repair is removed
//   MUTATE=seedwide     node api/_arming-gate.test.mjs  # the repair stops being scoped to step-less rows
//   MUTATE=seedapproved node api/_arming-gate.test.mjs  # the seeder writes `approved` too
//   MUTATE=disabledgreen node api/_arming-gate.test.mjs # approved-but-disabled reads as done
//   MUTATE=enrolenabled node api/_arming-gate.test.mjs  # enrollContact stops requiring enabled
//   MUTATE=liveenabled  node api/_arming-gate.test.mjs  # isAutomationLive stops requiring enabled
//   MUTATE=workerenabled node api/_arming-gate.test.mjs # the worker stops requiring enabled (the Off switch)
//   MUTATE=emptyapproval node api/_arming-gate.test.mjs # the approval stops skipping step-less rows
//   MUTATE=onboardingwide node api/_arming-gate.test.mjs # the yes widened to cover `onboarding`
//   MUTATE=formintroarmed node api/_arming-gate.test.mjs # seed-form-intro births an armed row
//   MUTATE=tenantscope  node api/_arming-gate.test.mjs  # set-approved loses its academy scope
//   MUTATE=approvescope node api/_arming-gate.test.mjs  # the approve SELECT loses its academy scope
//   MUTATE=selectcolumn node api/_arming-gate.test.mjs  # the approve select names a column that does not exist
//   MUTATE=patchcolumn  node api/_arming-gate.test.mjs  # the approve PATCH body names one
//   MUTATE=selectnoenabled node api/_arming-gate.test.mjs # the approve select drops `enabled`
//   MUTATE=statusenabled node api/_arming-gate.test.mjs # setup-status drops `enabled` from its select
//   MUTATE=refusalunknown node api/_arming-gate.test.mjs # armingRefusal stops failing closed on an unknown lane
//   MUTATE=refusalactor node api/_arming-gate.test.mjs  # ...and on an actor with no owner predicate
//   MUTATE=wizardempty  node api/_arming-gate.test.mjs  # the wizard offers a yes over empty sequences again
//
// WHAT THIS FILE DOES NOT PROVE. It never sends anything. The positive side of the
// send gates is a differential (the same fixture with approved:true reaches a
// DIFFERENT decision), not a delivered message - proving a real send needs the
// transport, and api/_approval-render.test.mjs owns that. What is proved here is
// that `approved:false` is the reason the send path stops, and that removing the
// flag from any of the three places changes the outcome.
//
// AND WHAT THE FAKE POSTGREST STILL CANNOT SEE, so nobody reads more into a green
// run than is there. It applies filters, projects the select and rejects a column
// the real schema does not have - but it enforces no NOT NULL, no foreign key, no
// CHECK constraint and no unique index other than the on_conflict target it is
// handed. A write that a real database would reject for any of those reasons
// succeeds here. The column lists are also a SNAPSHOT (prod-schema.sql, 2026-07-21,
// plus migrations since), so a column added straight through the Supabase dashboard
// exists in production and not in COLUMNS - which reads as a false failure, not a
// false pass, and is fixed by adding it.
//
// api/reignition.js is REGISTERED as an arming lane here but not DRIVEN: its
// approve path needs a campaign, a roster, candidates and a stage stamp, and no
// suite builds those. The registry->code and code->registry sweeps in
// api/_approval-render.test.mjs are what cover it, and they are inventory checks
// on text. Its staff-only gate has no behavioural test in this repo.

import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─── keep this suite genuinely dependency-free ───────────────────────────────
//
// The CI step that runs these files says "These run on plain node: no
// dependencies, no network, no database. If one ever needs any of those, it does
// not belong in this step." Measured, that was true of every suite except THIS one:
// it drives real handlers, api/automations.js line 1 imports api/_sentry.js, and
// that statically imports @sentry/node - which pulls in @sentry/core, the
// OpenTelemetry SDK and `import-in-the-middle`. So the rule the workflow states was
// already broken by the file quoting it.
//
// The fix is here rather than in api/_sentry.js. Making production load Sentry
// lazily to satisfy a test would put the error reporting of every API route behind
// a bundler's ability to trace a dynamic import - trading a true comment for a
// silent hole in the thing that tells us when production breaks. Instead the
// specifier is answered locally.
//
// IT CHANGES NOTHING UNDER TEST. sentryApiEnabled is false whenever VERCEL_ENV is
// not "production", so withSentryApiRoute already returns `handler(req, res)`
// untouched and not one of these functions is called on any path this file drives.
// Removing import-in-the-middle from the process is a small bonus: it patches module
// loading globally, and this suite imports mutated copies of modules for a living.
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
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";
process.env.CRON_SECRET = process.env.CRON_SECRET || "stub-cron-secret";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";
const REST = `${process.env.SUPABASE_URL}/rest/v1/`;

const fails = [];
function fail(what, detail) { fails.push({ what, detail }); }
function expect(cond, what, detail) { if (!cond) fail(what, detail); return !!cond; }

// ─── a Postgres-REST stand-in that actually APPLIES the filters ──────────────
//
// This is the whole trick. If the stub ignored the query string, deleting
// `&approved=eq.true` from a URL would change nothing and the F3 controls below
// would be decorative. So eq / neq / in / is / lte / gte / not.* and PostgREST's
// `or=(...)` are all evaluated against the in-memory rows, and an operator this
// stub does not understand THROWS rather than silently matching everything.
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
    // `cs.{cancelled}` - array contains. setup-status counts cancelled contacts with it.
    case "cs":  return Array.isArray(val) && raw.replace(/^\{|\}$/g, "").split(",").filter(Boolean).every((x) => val.includes(x));
    default:    return true;   // like/ilike are never used on a path this file drives
  }
}

// `or=(role.eq.owner,can_train_agent.eq.true)` - resolveAgentActor's own filter, and
// the reason an outsider fixture is meaningful rather than accidental.
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
// WHY THIS EXISTS. The stub used to answer any column on any table, and
// auto-create any table it had never heard of. That hid the single most common
// way this repo has broken production: naming a column PostgREST does not have.
// PostgREST 400s the whole request, sb() throws, and the handler dies - the
// entire select fails, not just the missing field. api/automations.js:60 and
// api/agent/seed-automations.js:143 each carry a note about a real incident of
// exactly this. Four mutations shipped green against the old stub:
//
//   + owner_signed_off_at in the approve select  -> real: 400, the owner can
//                                                   NEVER approve, on any academy
//   + approved_by_user in the approve PATCH body -> real: 400, nothing approved
//   - enabled from the approve select            -> salesApprovalState fails
//                                                   closed, approve never reads done
//   - enabled from setup-status's select         -> every academy's approve step
//                                                   reads never-done
//
// SOURCE OF TRUTH, and its limits. These lists are the union of
// supabase/snapshots/prod-schema.sql (a real dump, 2026-07-21) and every
// migration's create/alter since. They are NOT derived from what the code asks
// for - that would rubber-stamp exactly the bug this is here to catch. Note that
// migrations alone are not enough either: clients.phone and clients.address exist
// in production and appear in no migration in this repo, so a migrations-only list
// would have failed the suite on real, working code.
//
// A table with no entry here THROWS rather than being invented, so a new code path
// cannot quietly get an anything-goes table. Add the table with its real columns.
const COLUMNS = {
  automations: "approved automation_key client_id created_at enabled ghl_stage_name id name offer_id updated_at",
  automation_steps: "automation_id body channel created_at enabled id position subject sync_class updated_at wait_amount wait_unit",
  automation_enrollments: "automation_id client_id contact_id current_position entered_at exit_reason exited_at id status",
  automation_jobs: "attempts automation_id channel client_id contact_id created_at dedupe_key enrollment_id id last_error run_after sent_at status step_id",
  automation_events: "automation_id client_id contact_id created_at id payload type",
  staff: "avatar_url booking_url created_at email id name role slack_token slack_user_id updated_at user_id",
  client_users: "allowed_kpis allowed_stages allowed_tabs avatar_url can_enroll_members can_train_agent client_id created_at email hide_from_team id instagram invite_retry_count last_invite_sent_at last_seen_at name phone role status title updated_at user_id",
  contacts: "athlete_name client_id created_at custom_fields date_added dnd email first_name ghl_contact_id id last_name name phone phone10 source stripe_customer_id tags updated_at",
  offers: "client_id created_at created_by data id sort_order status title type updated_at",
  pipeline_stages: "client_id created_at ghl_pipeline_id ghl_stage_id ghl_stage_name id is_terminal label offer_id position role updated_at",
  stage_transitions: "carries_context client_id created_at enabled from_stage_role id is_seed offer_id pipeline_id sort_order to_kind to_stage_role to_terminal trigger updated_at",
  agent_prompt_sections: "body client_id id offer_id section_key updated_at updated_by",
  custom_field_defs: "archived client_id created_at ghl_field_id help_text id key label offer_id options position required section type updated_at",
  entry_points: "bookable_program_id client_id created_at enabled field_map funnel_id ghl_workflow_id ghl_workflow_name id key label offer_id pipeline_name stage_name tags type updated_at",
  offer_prices: "amount_cents billing_interval created_at currency id is_active is_routable offer_option_id show_on_onboarding sort_order source_offer_id source_offer_price_key source_pricing_catalog_id stripe_price_id stripe_product_id tenant_id title updated_at",
  members: "agreement_pdf_path archetype athlete_name avatar_url billing_mode billing_portal_owned client_id coachiq_member_id contact_id created_at engagement ghl_contact_id ghl_opportunity_id group_num id joined_date offer_id offer_overridden parent_archetype parent_email parent_name parent_phone pause_scheduled_for plan signup_origin skill_notes start_date status stripe_customer_id stripe_joined_at stripe_price_id stripe_subscription_id total_spent_cents trainer updated_at",
  client_meta_messaging_config: "client_id created_at ig_user_id inbox_live notes page_id page_token_enc status updated_at",
  clients: "access_sync_mode address ads_connected_at ads_content_approval_required allowed_domains archived_at asana_project_id athlete_map_done_at auth_user_id base_retainer baseline_locked_until baseline_revenue booking_provider brand_data brand_marked_done_at business_name call_booked_at call_completed_at cam_call_booked_at coachiq_enabled coachiq_signup_url community_group_platform community_group_url contact_provider content_assignee_organic_id content_submitted_at created_at credit_engine_enabled ein email email_domain email_provider email_setup entity_type flat_amount general_marked_done_at ghl_access_token ghl_company_id ghl_connect_status ghl_connected_at ghl_contacts_last_synced_at ghl_history_imported_at ghl_kpi_config ghl_location_id ghl_refresh_token ghl_signup_done_at ghl_synced_at ghl_token_error ghl_token_expires_at google_review_url growth_share_pct id ig_setup kpi_data kpi_marked_done_at kpi_setup_done_at legal_name locations_marked_done_at marketing_included messaging_provider meta_ad_account_id meta_ads_marked_done_at meta_campaign_ids meta_capi meta_cpl_goal meta_monthly_budget notification_prefs notion_page_id offers_marked_done_at onboarding_completed_at onboarding_feedback_requested_at onboarding_feedback_submitted_at onboarding_method onboarding_setup onboarding_tracker_dismissed online_programs_url organic_content organic_total_credits_per_month organic_video_credits_per_month owner_name payment_model phone pipeline_ghl_mirror pipeline_provider pipeline_shadow public_name ready_for_review_at referral_offer refresh_week revenue_integration_connection review_call_booked_at scaling_manager_id scheduling_app slack_channel_id slack_join_done_at sorter_dismissals staff_marked_done_at staff_notify_phone status stripe_connect_account_id stripe_connect_connected_at stripe_connect_status stripe_customer_id subscription_renewal_date systems_buildout_triggered_at systems_onboarding_ticket_id tax_config time_zone tz_alert_at updated_at uses_own_ad_account v15_access v15_config v2_access v4_access website_setup welcome_slack_sent_at ximena_call_booked_at",
};
const COLS = new Map(Object.entries(COLUMNS).map(([t, s]) => [t, new Set(s.split(/\s+/).filter(Boolean))]));

// PostgREST's own shape for an unknown column, because that is what the code under
// test meets: a 400 whose body sb() puts into the thrown Error.
function pgUndefinedColumn(table, col, where) {
  return new Response(JSON.stringify({
    code: "42703",
    message: `column ${table}.${col} does not exist`,
    hint: `the stub rejects it because the real schema has no such column, so PostgREST would 400 this ${where} and sb() would throw. Either the column name is wrong, or its migration is not in this repo yet - in which case shipping it stops every request on this path.`,
  }), { status: 400, headers: { "content-type": "application/json" } });
}

function validateColumns(table, cols, u, init) {
  const known = COLS.get(table);
  const bad = (col, where) => pgUndefinedColumn(table, col, where);

  // 1. select=. `*` and PostgREST's alias / embedded forms are tolerated; a plain
  //    column name is not. Skipping `select` entirely is what let two of the four
  //    mutations through, so it is checked first.
  const sel = u.searchParams.get("select");
  if (sel) {
    for (const rawPart of sel.split(",")) {
      const part = rawPart.trim();
      if (!part || part === "*" || part.includes("(")) continue;   // embedded resource
      const col = part.includes(":") ? part.split(":").pop() : part;
      if (col !== "*" && !known.has(col)) return bad(col, "select");
    }
  }
  // 2. every filter is a column too. `&owner_signed_off_at=eq.x` 400s just as hard
  //    as naming it in the select.
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
  // 3. order= and on_conflict= name columns as well.
  for (const key of ["order", "on_conflict"]) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const col = part.trim().split(".")[0];
      if (col && !known.has(col)) return bad(col, `${key}=`);
    }
  }
  // 4. the body of a write. This is the one that catches an arming field being
  //    added to a PATCH under a name the table does not have.
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
    throw new Error(`stub PostgREST: no column list for table '${table}'.\n    The stub used to invent any table it was asked for, which meant a whole table could be misspelt and nothing noticed. Add '${table}' to COLUMNS with its REAL columns (supabase/snapshots/prod-schema.sql + the migrations since), not with the ones this code happens to ask for.`);
  }
  const columnError = validateColumns(table, null, u, init);
  if (columnError) return columnError;
  DB.tables[table] = DB.tables[table] || [];
  const all = DB.tables[table];

  // A SELECT THAT IS NOT PROJECTED IS NOT A SELECT. The stub used to hand back the
  // whole row whatever was asked for, so DELETING a column from a select changed
  // nothing here - `enabled` could vanish from the approve select or from
  // setup-status's and every check stayed green while salesApprovalState fell back
  // to failing closed on every academy. Projection is what makes those two
  // mutations observable.
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

  // `return=minimal` answers with an EMPTY BODY, which is what every caller's
  // `const txt = await res.text(); return txt ? JSON.parse(txt) : null` expects.
  // Status 200 rather than a real 204: Node's Response refuses to carry a body on
  // 204, and the difference is invisible to the code under test.
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
    // Anything else is an OUTBOUND attempt (Resend, GHL, Twilio). Recorded above so
    // a check can assert it did not happen; answered blandly so an unexpected one
    // shows up as a failed assertion rather than as a thrown error somewhere else.
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  return DB;
}

const OUTBOUND = (db) => db.wire.filter((c) => !c.url.startsWith(process.env.SUPABASE_URL));
const WRITES = (db, table) => db.wire.filter((c) => c.method !== "GET" && c.url.startsWith(`${REST}${table}`));

// ─── mutated copies of real modules, for the negative controls ───────────────
//
// A CONTROL THAT CANNOT FIND ITS TARGET IS NOT "CAUGHT". This is the trap the CI
// workflow already documents one level up: a mutation that no longer matches
// anything makes the suite throw, the suite reports a failure, and a run that keys
// on "did it fail?" calls that a working control. So a missing target (or a mutated
// copy that will not even import) sets `controlBroken`, and main() turns that into
// NEGATIVE CONTROL FAILED with the reason, never into a pass.
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

// The same contract as mutantModule, for a file that is not a module: the wizard is
// one HTML file with no import path, so its function is lifted out and run. A
// mutation that no longer matches sets controlBroken instead of passing quietly.
function mutantText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\nThe code it was written against has moved, so this control breaks NOTHING. Re-point it, or delete it.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

const M_AUTH = [["canApproveAsOwner: (clientId) => staff || ownerClientIds.includes(clientId)",
                 "canApproveAsOwner: (clientId) => staff || academyClientIds.includes(clientId)"]];

async function authModule() {
  return MUTATE === "ownergate" ? mutantModule("agent/_auth.js", M_AUTH) : import("./agent/_auth.js");
}

// The three edits the tester actually made, plus the flag deletions, applied to a
// copy of api/automations.js. `edits` is empty for a clean run.
async function automationsModule() {
  const edits = [];
  if (MUTATE === "warngate") edits.push([
    "      const refuseApprove = armingRefusal(\"approve-sales-messages\", actor, clientId);\n      if (refuseApprove) return res.status(refuseApprove.status).json({ error: refuseApprove.error });",
    "      const refuseApprove = armingRefusal(\"approve-sales-messages\", actor, clientId);\n      if (refuseApprove) console.warn(refuseApprove.error);"]);
  if (MUTATE === "deadgate") edits.push([
    "      if (b.action === \"set-approved\" && !!b.value) {",
    "      if (false && b.action === \"set-approved\" && !!b.value) {"]);
  if (MUTATE === "enrolgate") edits.push([
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=*&limit=1",
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&select=*&limit=1"]);
  if (MUTATE === "livegate") edits.push([
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=id&limit=1",
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&select=id&limit=1"]);
  if (MUTATE === "workergate") edits.push([
    "if (!auto || !auto.enabled || !auto.approved) {",
    "if (!auto || !auto.enabled) {"]);
  if (MUTATE === "academygate") edits.push([
    "if (!actor.canActOn(clientId)) return res.status(403).json({ error: \"not your academy\" });",
    "if (!actor.canActOn(clientId)) console.warn(\"not your academy\");"]);
  if (MUTATE === "enrolenabled") edits.push([
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=*&limit=1",
    "&automation_key=eq.${encodeURIComponent(automationKey)}&approved=eq.true&select=*&limit=1"]);
  if (MUTATE === "liveenabled") edits.push([
    "&automation_key=eq.${encodeURIComponent(automationKey)}&enabled=eq.true&approved=eq.true&select=id&limit=1",
    "&automation_key=eq.${encodeURIComponent(automationKey)}&approved=eq.true&select=id&limit=1"]);
  if (MUTATE === "workerenabled") edits.push([
    "if (!auto || !auto.enabled || !auto.approved) {",
    "if (!auto || !auto.approved) {"]);
  // ── SEV 1a: the composed failure. Put back the version that approved every sales
  //    row without asking whether it contained anything.
  if (MUTATE === "emptyapproval") edits.push([
    "      const stepRows = await sb(`automation_steps?automation_id=in.(${list.map((a) => a.id).join(\",\")})&select=automation_id`) || [];\n      const filled = new Set((Array.isArray(stepRows) ? stepRows : []).map((s) => s.automation_id));",
    "      const filled = { has: () => true };"]);
  // ── the yes widened to cover the post-conversion welcome sequence.
  if (MUTATE === "onboardingwide") edits.push([
    "automation_key=in.(${SALES_AUTOMATION_KEYS.join(\",\")})&select=id,automation_key,approved,enabled",
    "automation_key=in.(${SALES_AUTOMATION_KEYS.concat([\"onboarding\"]).join(\",\")})&select=id,automation_key,approved,enabled"]);
  // ── seed-form-intro births an ARMED row, under plain canActOn.
  if (MUTATE === "formintroarmed") edits.push([
    "body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, offer_id: b.offer_id || null, updated_at: new Date().toISOString() }]) });",
    "body: JSON.stringify([{ client_id: clientId, automation_key: key, name: def.name, enabled: !!def.enabled, approved: true, offer_id: b.offer_id || null, updated_at: new Date().toISOString() }]) });"]);
  // ── the tenant scope on the arming write, both halves of it.
  if (MUTATE === "tenantscope") edits.push(
    ["const a = await sb(`automations?id=eq.${automationId}&client_id=eq.${clientId}&select=id&limit=1`);",
     "const a = await sb(`automations?id=eq.${automationId}&select=id&limit=1`);"],
    ["await sb(`automations?id=eq.${b.automation_id}&client_id=eq.${clientId}`, { method: \"PATCH\"",
     "await sb(`automations?id=eq.${b.automation_id}`, { method: \"PATCH\""]);
  // ── the tenant scope on the approve SELECT: turns "no sales messages yet" into a
  //    false success by counting another academy's rows.
  if (MUTATE === "approvescope") edits.push([
    "const autos = await sb(`automations?client_id=eq.${clientId}&automation_key=in.(${SALES_AUTOMATION_KEYS.join(\",\")})&select=id,automation_key,approved,enabled`) || [];",
    "const autos = await sb(`automations?automation_key=in.(${SALES_AUTOMATION_KEYS.join(\",\")})&select=id,automation_key,approved,enabled`) || [];"]);
  // ── the three column mutations. Real PostgREST 400s each of these; the stub used
  //    to answer them happily, which is what made them worth a control.
  if (MUTATE === "selectcolumn") edits.push([
    "&select=id,automation_key,approved,enabled`) || [];",
    "&select=id,automation_key,approved,enabled,owner_signed_off_at`) || [];"]);
  if (MUTATE === "patchcolumn") edits.push([
    "body: JSON.stringify({ approved: true, updated_at: new Date().toISOString() }) });",
    "body: JSON.stringify({ approved: true, approved_by_user: true, updated_at: new Date().toISOString() }) });"]);
  if (MUTATE === "selectnoenabled") edits.push([
    "&select=id,automation_key,approved,enabled`) || [];",
    "&select=id,automation_key,approved`) || [];"]);
  return edits.length ? mutantModule("automations.js", edits) : import("./automations.js");
}

// api/offers/setup-status.js is what feeds the wizard's approve detector. Its
// `enabled` used to be guarded by a REGEX on this file's source text - the last text
// pin left in a behavioural suite, and it guarded the consumer while the producer
// could break underneath it.
async function setupStatusModule() {
  if (MUTATE !== "statusenabled") return import("./offers/setup-status.js");
  return mutantModule("offers/setup-status.js", [[
    "sb(`automations?client_id=eq.${enc(clientId)}&select=automation_key,approved,enabled`),",
    "sb(`automations?client_id=eq.${enc(clientId)}&select=automation_key,approved`),"]]);
}

// armingRefusal's own documented fail-closed branches.
async function refusalModule() {
  if (MUTATE === "refusalunknown") return mutantModule("_sales-approval.js", [[
    "  if (!def) return { status: 500, error: `unknown arming lane: ${lane}` };\n", ""]]);
  if (MUTATE === "refusalactor") return mutantModule("_sales-approval.js", [[
    "  if (!actor || typeof actor.canApproveAsOwner !== \"function\") return { status: 403, error: def.refusal };\n", ""]]);
  return import("./_sales-approval.js");
}

async function approvalsModule() {
  if (MUTATE !== "bookinggate") return import("./agent-approvals.js");
  return mutantModule("agent-approvals.js", [[
    "      if (wantsApproved) {\n        const refuseBooking = armingRefusal(\"booking-automations-set\", actor, clientId);\n        if (refuseBooking) return res.status(refuseBooking.status).json({ error: refuseBooking.error });\n      }",
    "      if (wantsApproved) { /* gate removed by the control */ }"]]);
}

async function seedModule() {
  const REPAIR = "      if (def.enabled && !auto.enabled) {\n        await sb(`automations?id=eq.${auto.id}&client_id=eq.${clientId}`, {\n          method: \"PATCH\", headers: { Prefer: \"return=minimal\" },\n          body: JSON.stringify({ enabled: true, updated_at: new Date().toISOString() }),\n        });\n        auto = { ...auto, enabled: true };\n      }";
  if (MUTATE === "seedrepair") return mutantModule("agent/seed-automations.js", [[REPAIR, ""]]);
  if (MUTATE === "seedapproved") return mutantModule("agent/seed-automations.js", [[
    "body: JSON.stringify({ enabled: true, updated_at: new Date().toISOString() }),",
    "body: JSON.stringify({ enabled: true, approved: true, updated_at: new Date().toISOString() }),"]]);
  // Move the repair OUT of the zero-steps branch, which is the edit that would put
  // San Jose's deliberately-off nurture-3 back on.
  if (MUTATE === "seedwide") return mutantModule("agent/seed-automations.js", [
    [REPAIR, ""],
    ["    const existing = await loadSteps(sb, auto.id);", `    const existing = await loadSteps(sb, auto.id);\n${REPAIR}`]]);
  return import("./agent/seed-automations.js");
}

async function stateModule() {
  if (MUTATE !== "disabledgreen") return import("./_sales-approval.js");
  return mutantModule("_sales-approval.js", [[
    "const live = rows.filter((a) => !!a.approved && !!a.enabled).length;",
    "const live = rows.filter((a) => !!a.approved).length;"]]);
}

// ─── fixtures ────────────────────────────────────────────────────────────────
const ACADEMY = "client-arming-test";
const OTHER   = "client-somebody-else";
// Written out rather than imported from api/_sales-approval.js on purpose: one
// control (MUTATE=disabledgreen) hands this file a MUTATED copy of that module, and
// a fixture built from the thing under test moves whenever the thing under test
// does. api/_approval-render.test.mjs is what keeps the two lists honest.
const SALES_KEYS = ["contact_form", "trial_form", "missed_trial", "ghosted", "nurture"];

// A teammate who holds can_train_agent and is NOT an owner and is NOT BAM staff.
// This person is the entire point of the split: they may operate the agent for
// their academy, and they may not be the one who says it can start texting parents.
const TEAMMATE = {
  user: { id: "u-teammate", email: "coach@academy.test" },
  tables: { staff: [], client_users: [{ user_id: "u-teammate", email: "coach@academy.test", client_id: ACADEMY, status: "active", role: "coach", can_train_agent: true }] },
};
const OWNER = {
  user: { id: "u-owner", email: "owner@academy.test" },
  tables: { staff: [], client_users: [{ user_id: "u-owner", email: "owner@academy.test", client_id: ACADEMY, status: "active", role: "owner", can_train_agent: true }] },
};
const STAFF = {
  user: { id: "u-staff", email: "zoran@byanymeansbball.com" },
  tables: { staff: [{ user_id: "u-staff", email: "zoran@byanymeansbball.com", role: "admin" }], client_users: [] },
};
// A member with neither the flag nor the role: resolveAgentActor's or() must exclude
// them, or every assertion about the teammate would pass for the wrong reason.
const OUTSIDER = {
  user: { id: "u-parent", email: "parent@academy.test" },
  tables: { staff: [], client_users: [{ user_id: "u-parent", email: "parent@academy.test", client_id: ACADEMY, status: "active", role: "member", can_train_agent: false }] },
};

function bearerReq(body) {
  return { method: "POST", headers: { authorization: "Bearer stub-token" }, query: {}, body };
}
function fakeRes() {
  const r = { statusCode: null, payload: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.setHeader = () => r; r.end = () => r; r.send = (b) => { r.payload = b; return r; };
  return r;
}

// ─── F1: what the owner scope MEANS, not what it is called ───────────────────
//
// Renaming one identifier inside canApproveAsOwner restores the hole this build
// closed, and every text check survives the rename because the FUNCTION NAME does
// not change. So this asserts the two scopes DISAGREE for the person they were
// split apart over, which no rename can satisfy.
async function checkOwnerScopeSemantics() {
  const { resolveAgentActor } = await authModule();
  const actorFor = async (fixture) => { installDb(fixture); return resolveAgentActor(bearerReq({})); };

  const teammate = await actorFor(TEAMMATE);
  expect(teammate && teammate.canActOn(ACADEMY) === true, "owner scope",
    "a teammate with can_train_agent cannot OPERATE the agent for their own academy. canActOn must stay wide - that flag exists so they can work the inbox.");
  expect(teammate && teammate.canApproveAsOwner(ACADEMY) === false, "owner scope",
    "canApproveAsOwner returned TRUE for a can_train_agent teammate who is not an owner and not BAM staff.\n    That is the exact hole this build closed: an operational flag is not the owner's consent to start texting parents.\n    If canApproveAsOwner now reads the same list as canActOn (whatever it is called), the split is gone.");

  const owner = await actorFor(OWNER);
  expect(owner && owner.canApproveAsOwner(ACADEMY) === true, "owner scope",
    "an academy OWNER cannot approve for their own academy. The gate has been narrowed past the person it is named after.");

  const staff = await actorFor(STAFF);
  expect(staff && staff.canApproveAsOwner(ACADEMY) === true && staff.canActOn(ACADEMY) === true, "owner scope",
    "BAM staff lost the owner scope. They keep it deliberately - the concierge path depends on it and they can reach the same flag through set-approved anyway.");

  const outsider = await actorFor(OUTSIDER);
  expect(outsider === null || (outsider.canActOn(ACADEMY) === false && outsider.canApproveAsOwner(ACADEMY) === false), "owner scope",
    "a plain member with neither `owner` nor can_train_agent resolved to an actor with scope. resolveAgentActor's or() filter is what keeps them out.");

  expect(owner && owner.canActOn(OTHER) === false && owner.canApproveAsOwner(OTHER) === false, "owner scope",
    "an owner of one academy carries scope into ANOTHER academy. Both predicates are per-academy.");
}

// ─── F2: the gates REFUSE, and nothing is written ────────────────────────────
//
// Asserting the refusal rather than the condition. The two edits that beat the old
// checks - a `console.warn` in place of the 403, and `if (false && ...)` - both
// leave the pinned text intact and both fail here, because a 200 is a 200 and a
// PATCH that happened, happened.
async function checkGatesRefuse() {
  const mod = await automationsModule();
  const handler = mod.default;
  const salesRows = () => SALES_KEYS.map((k, i) => ({
    id: `auto-${i}`, client_id: ACADEMY, automation_key: k, name: k, enabled: true, approved: false,
  }));
  // EVERY SEQUENCE HAS A MESSAGE IN IT. Not decoration: approve-sales-messages
  // refuses a step-less row (F6 below is the whole reason), so a fixture without
  // steps would make the POSITIVE half of this check - the owner CAN approve - pass
  // or fail for a reason that has nothing to do with the gate.
  const salesSteps = () => salesRows().map((a, i) => ({
    id: `step-${i}`, automation_id: a.id, position: 0, wait_amount: 0, wait_unit: "minutes",
    channel: "sms", body: "hi", enabled: true,
  }));

  const run = async (fixture, body) => {
    const db = installDb({ ...fixture, tables: { ...fixture.tables, automations: salesRows(), automation_steps: salesSteps() } });
    const res = fakeRes();
    await handler(bearerReq(body), res);
    return { db, res };
  };

  // 1. The wizard's one-press approval.
  {
    const { db, res } = await run(TEAMMATE, { action: "approve-sales-messages", client_id: ACADEMY });
    expect(res.statusCode === 403, "arming gate refuses",
      `approve-sales-messages returned ${res.statusCode} for a can_train_agent teammate. It must return 403.\n    A gate that logs and continues is not a gate.`);
    expect(WRITES(db, "automations").length === 0, "arming gate refuses",
      `approve-sales-messages WROTE to automations for a non-owner (${WRITES(db, "automations").length} write(s)) even though it refused. The refusal has to happen before the write.`);
    expect(db.tables.automations.every((a) => a.approved === false), "arming gate refuses",
      "a non-owner's refused approval still left rows approved. Whatever the status code said, the sequences are armed.");
  }

  // 2. The Sales panel's On switch, first yes.
  {
    const { db, res } = await run(TEAMMATE, { action: "set-approved", client_id: ACADEMY, automation_id: "auto-0", value: true });
    expect(res.statusCode === 403, "arming gate refuses",
      `set-approved value:true returned ${res.statusCode} for a can_train_agent teammate. It must return 403 - this is the Sales panel's On switch and it arms live messaging.`);
    expect(db.tables.automations[0].approved === false, "arming gate refuses",
      "set-approved armed an automation for a non-owner. The row came back approved:true.");
  }

  // 3. ...and the narrowing must NOT have swallowed the emergency stop or the kill
  //    switch. A one-directional gate that quietly became two-directional would
  //    strand an operator: they could turn a sequence off and never turn it back on.
  {
    const armed = salesRows().map((a) => ({ ...a, approved: true }));
    const db = installDb({ ...TEAMMATE, tables: { ...TEAMMATE.tables, automations: armed } });
    const res1 = fakeRes();
    await handler(bearerReq({ action: "set-approved", client_id: ACADEMY, automation_id: "auto-0", value: false }), res1);
    expect(res1.statusCode === 200 && db.tables.automations[0].approved === false, "arming gate refuses",
      `un-approving returned ${res1.statusCode} for a teammate. Un-approving is an emergency stop and must never wait for the owner.`);
    const res2 = fakeRes();
    await handler(bearerReq({ action: "set-enabled", client_id: ACADEMY, automation_id: "auto-1", value: true }), res2);
    expect(res2.statusCode === 200 && db.tables.automations[1].enabled === true, "arming gate refuses",
      `set-enabled returned ${res2.statusCode} for a teammate. Operators keep the kill switch and can re-enable what the owner already approved - only the FIRST consent is the owner's.`);
  }

  // 4. THE POSITIVE SIDE. Without this, a gate that refused everybody would pass.
  for (const [label, fixture] of [["the academy owner", OWNER], ["BAM staff", STAFF]]) {
    const { db, res } = await run(fixture, { action: "approve-sales-messages", client_id: ACADEMY });
    expect(res.statusCode === 200, "arming gate refuses",
      `approve-sales-messages returned ${res.statusCode} for ${label}. The gate is now refusing the person it is meant to admit.`);
    expect(db.tables.automations.every((a) => a.approved === true), "arming gate refuses",
      `${label} approved and the rows did not come back approved. The action reported success without writing.`);
  }

  // 5. THE GATE UNDERNEATH ALL OF THEM. Every action above sits behind one
  //    `if (!actor.canActOn(clientId)) return 403` at the top of the handler - the
  //    thing that stops academy A operating academy B. It had no behavioural check
  //    either: replacing that one `return` with a console.warn shipped green through
  //    the whole battery while every academy's automations became everyone's. It is
  //    the same class as the arming gates and it is asserted the same way, by asking
  //    for another academy's rows and requiring a refusal.
  {
    const db = installDb({ ...TEAMMATE, tables: { ...TEAMMATE.tables, automations: salesRows().map((a) => ({ ...a, client_id: OTHER })) } });
    for (const action of ["list", "approval-queue", "approve-sales-messages", "overview"]) {
      const res = fakeRes();
      await handler(bearerReq({ action, client_id: OTHER }), res);
      expect(res.statusCode === 403, "arming gate refuses",
        `'${action}' returned ${res.statusCode} for a teammate of a DIFFERENT academy asking about ${OTHER}. The per-academy canActOn gate at the top of the handler is what keeps one academy out of another's sales messages.`);
    }
    expect(db.wire.every((c) => c.method === "GET" || !c.url.startsWith(`${REST}automations`)), "arming gate refuses",
      "a cross-academy request wrote to another academy's automations before being refused.");
  }

  // 6. And the refusal has to be readable. It used to say "only the academy owner",
  //    which overstates who is refused - BAM staff, including content_executor and
  //    marketing_executor, are admitted by canApproveAsOwner and are not owners.
  const { res } = await run(TEAMMATE, { action: "approve-sales-messages", client_id: ACADEMY });
  const msg = String((res.payload && res.payload.error) || "");
  expect(!/only the academy owner/i.test(msg), "arming gate refuses",
    `the refusal still says "only the academy owner": ${JSON.stringify(msg)}.\n    BAM support can do it too, so a teammate who reads that and then watches support do it has been told something false about their own portal.`);
}

// ─── F3: `approved` is load-bearing in all three places ──────────────────────
//
// Deleting it from any one of them left the whole repo green. Each assertion below
// is a differential: the SAME fixture at approved:false and approved:true must reach
// different decisions, so removing the flag collapses the two and fails.
async function checkApprovedIsLoadBearing() {
  const { enrollContact, isAutomationLive, default: handler } = await automationsModule();

  const world = (approved) => ({
    ...STAFF,
    tables: {
      ...STAFF.tables,
      automations: [{ id: "auto-x", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: true, approved }],
      automation_steps: [{ id: "step-1", automation_id: "auto-x", position: 0, wait_amount: 0, wait_unit: "minutes", channel: "sms", body: "hi", enabled: true }],
      automation_enrollments: [], automation_jobs: [], automation_events: [],
      clients: [{ id: ACADEMY, business_name: "Arming Test Academy" }],
    },
  });

  // 1. enrollContact
  {
    const db = installDb(world(false));
    const out = await enrollContact({ clientId: ACADEMY, automationKey: "ghosted", contactId: "c1" });
    expect(out && out.skipped, "approved is load-bearing",
      `enrollContact ENROLLED a lead into an automation that is enabled but NOT approved (${JSON.stringify(out)}).\n    That flag is the owner's yes; without it here, the approval surface is decoration.`);
    expect(db.tables.automation_enrollments.length === 0, "approved is load-bearing",
      "enrollContact refused in its return value but still wrote an enrollment row.");
  }
  {
    installDb(world(true));
    const out = await enrollContact({ clientId: ACADEMY, automationKey: "ghosted", contactId: "c1" });
    expect(out && out.ok === true, "approved is load-bearing",
      `enrollContact refused an enabled + APPROVED automation (${JSON.stringify(out)}). The differential is gone, so the check above proves nothing.`);
  }

  // 2. isAutomationLive - what the P6 triggers branch on
  {
    installDb(world(false));
    expect((await isAutomationLive(ACADEMY, "ghosted")) === false, "approved is load-bearing",
      "isAutomationLive reported an unapproved automation LIVE. Every trigger that branches on it would route real leads onto it.");
    installDb(world(true));
    expect((await isAutomationLive(ACADEMY, "ghosted")) === true, "approved is load-bearing",
      "isAutomationLive reported an enabled + approved automation with an enabled step as NOT live.");
  }

  // 3. The worker. A due job on an unapproved automation must be cancelled at the
  //    automation gate - identified by its own REASON, so a job that stopped for
  //    some unrelated reason cannot be mistaken for the gate working.
  //
  //    The step is deliberately DISABLED in this fixture. It makes the differential
  //    land squarely on the gate and nowhere else: the only thing that changes
  //    between the two runs is `approved`, and the worker stops one line apart
  //    ("automation off" vs "step missing/disabled"). It also keeps the send path
  //    out of a test that is not about sending - see the header for what that costs.
  const jobWorld = (approved) => {
    const w = world(approved);
    w.tables.automation_steps[0].enabled = false;
    w.tables.automation_jobs = [{ id: "job-1", client_id: ACADEMY, automation_id: "auto-x", enrollment_id: "enr-1", step_id: "step-1", contact_id: "c1", channel: "sms", run_after: "2000-01-01T00:00:00.000Z", status: "pending", dedupe_key: "enr-1:step-1" }];
    w.tables.automation_enrollments = [{ id: "enr-1", client_id: ACADEMY, automation_id: "auto-x", contact_id: "c1", status: "active", current_position: 0 }];
    return w;
  };
  const workReq = { method: "GET", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: { action: "work" }, body: null };
  {
    const db = installDb(jobWorld(false));
    const res = fakeRes();
    await handler(workReq, res);
    expect(db.tables.automation_jobs[0].last_error === "automation off", "approved is load-bearing",
      `the worker processed a due job on an enabled-but-UNAPPROVED automation. Job ended status=${db.tables.automation_jobs[0].status} last_error=${JSON.stringify(db.tables.automation_jobs[0].last_error)}, expected it cancelled with "automation off".`);
    expect(OUTBOUND(db).length === 0, "approved is load-bearing",
      `the worker made ${OUTBOUND(db).length} outbound call(s) on an unapproved automation: ${OUTBOUND(db).map((c) => c.url).join(", ")}`);
    expect(db.tables.automation_enrollments[0].status === "active", "approved is load-bearing",
      "the worker touched the enrollment on an unapproved automation. It must stop at the automation gate and go no further.");
  }
  {
    const db = installDb(jobWorld(true));
    const res = fakeRes();
    await handler(workReq, res);
    expect(db.tables.automation_jobs[0].last_error === "step missing/disabled", "approved is load-bearing",
      `with the SAME fixture at approved:true the worker should have walked past the automation gate and stopped at the disabled step, but it ended last_error=${JSON.stringify(db.tables.automation_jobs[0].last_error)}. Without that, the check above cannot tell a working gate from a fixture that never runs at all.`);
    expect(db.tables.automation_enrollments[0].status !== "active", "approved is load-bearing",
      "at approved:true the worker never reached the enrollment, so the two runs did not actually diverge at the gate.");
  }
}

// ─── F5: the fourth arming lane, the one the table-scoped grep could not see ──
//
// clients.ghl_kpi_config.booking_initial_automations. When live + approved,
// scriptedBookingOpener() makes its template the FIRST message a new lead receives.
async function checkBookingOpenerLane() {
  const mod = await approvalsModule();
  const handler = mod.default;
  const world = (fixture, cfg) => ({ ...fixture, tables: { ...fixture.tables, clients: [{ id: ACADEMY, business_name: "Arming Test Academy", ghl_kpi_config: cfg || {} }] } });
  const body = (approved) => ({ action: "booking-automations-set", client_id: ACADEMY, automations: { enabled: true, approved, entries: {} } });

  {
    const db = installDb(world(TEAMMATE, {}));
    const res = fakeRes();
    await handler(bearerReq(body(true)), res);
    expect(res.statusCode === 403, "booking opener lane",
      `booking-automations-set returned ${res.statusCode} for a can_train_agent teammate arming the scripted opener. Arming a sales message is the owner's call on every route, and this one writes the FIRST message a lead sees.`);
    const saved = (db.tables.clients[0].ghl_kpi_config || {}).booking_initial_automations;
    expect(!saved || saved.approved !== true, "booking opener lane",
      "the booking opener came back approved after a refused save.");
  }
  {
    const db = installDb(world(OWNER, {}));
    const res = fakeRes();
    await handler(bearerReq(body(true)), res);
    expect(res.statusCode === 200, "booking opener lane",
      `booking-automations-set returned ${res.statusCode} for the academy OWNER. The gate is refusing the person it is meant to admit.`);
    expect(((db.tables.clients[0].ghl_kpi_config || {}).booking_initial_automations || {}).approved === true, "booking opener lane",
      "the owner armed the booking opener and it did not save as approved.");
  }
  {
    // The un-arming direction stays open, same as set-approved value:false.
    const db = installDb(world(TEAMMATE, { booking_initial_automations: { enabled: true, approved: true, entries: {} } }));
    const res = fakeRes();
    await handler(bearerReq(body(false)), res);
    expect(res.statusCode === 200, "booking opener lane",
      `a teammate could not save the booking opener UN-approved (${res.statusCode}). Un-arming is an emergency stop and must never wait for the owner.`);
    expect(((db.tables.clients[0].ghl_kpi_config || {}).booking_initial_automations || {}).approved === false, "booking opener lane",
      "the un-arming save did not clear `approved`.");
  }
}

// ─── F4: a row born dormant gets repaired, and only that row ─────────────────
//
// The panel creates placeholder rows with no `enabled`, so they land on the database
// default false; the seeder used to return early on any existing row, so the sequence
// stayed silent while the owner's approval read complete. Confirmed live on BAM NY.
async function checkDormantRowRepair() {
  const { seedAutomations } = await seedModule();
  // seedAutomations takes its `sb` as an argument (that is how api/_sync-class.test.mjs
  // drives it), so this is the same shim api/agent/_store.js exports, over the stub.
  const sb = async (p, init = {}) => {
    const r = restCall(`${REST}${p}`, init);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  };

  // 1. THE BUG. Step-less row created by the panel at enabled:false.
  {
    const db = installDb({ tables: { automations: [{ id: "a1", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: false, approved: false }], automation_steps: [] } });
    await seedAutomations({ clientId: ACADEMY, keys: ["ghosted"], sb });
    expect(db.tables.automations[0].enabled === true, "dormant row repair",
      "a step-less automation sitting at enabled:false was left dormant by the seeder. The owner approves it, the wizard reads complete, and the sequence never sends - which is what BAM NY is doing in production right now.");
    expect(db.tables.automations[0].approved === false, "dormant row repair",
      "the seeder wrote `approved`. It must never: that flag is the owner's word and the only thing this whole approval surface exists to set.");
    expect(db.tables.automation_steps.length > 0, "dormant row repair",
      "the repair ran but the steps did not seed, so the row is now enabled with nothing in it.");
  }

  // 2. THE THING THE REPAIR MUST NOT DO. A row WITH steps is an academy that has
  //    configured this sequence, and `enabled:false` there is a human decision -
  //    San Jose's nurture-3 is off because somebody turned it off. Never touched.
  {
    const db = installDb({ tables: {
      automations: [{ id: "a1", client_id: ACADEMY, automation_key: "nurture", name: "Lead Nurture", enabled: false, approved: true }],
      automation_steps: [{ id: "s1", automation_id: "a1", position: 0, channel: "sms", body: "already written", enabled: false }],
    } });
    await seedAutomations({ clientId: ACADEMY, keys: ["nurture"], sb });
    expect(db.tables.automations[0].enabled === false, "dormant row repair",
      "the seeder re-enabled an automation that ALREADY HAS STEPS. That is a human's off switch being overruled by a re-seed, and it is the exact rule (\"never touch an existing row's enabled\") that protects San Jose's nurture-3.");
    expect(db.tables.automation_steps.length === 1 && db.tables.automation_steps[0].body === "already written", "dormant row repair",
      "the seeder rewrote steps an academy had already authored.");
  }

  // 3. An already-healthy row is left alone (no pointless write).
  {
    const db = installDb({ tables: { automations: [{ id: "a1", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: true, approved: true }], automation_steps: [] } });
    await seedAutomations({ clientId: ACADEMY, keys: ["ghosted"], sb });
    expect(db.tables.automations[0].approved === true && db.tables.automations[0].enabled === true, "dormant row repair",
      "seeding disturbed an automation that was already enabled and approved.");
  }
}

// ─── F4 (second half): approved but disabled must not read green ─────────────
async function checkDisabledIsNotDone() {
  const { salesApprovalState, SALES_AUTOMATION_KEYS } = await stateModule();
  const rows = (patch) => SALES_AUTOMATION_KEYS.map((k) => ({ automation_key: k, approved: true, enabled: true, ...patch(k) }));

  const allLive = salesApprovalState(rows(() => ({})));
  expect(allLive.done === true, "approved but silent",
    `five approved + enabled sales automations did not read done: ${JSON.stringify(allLive)}`);

  const oneDormant = salesApprovalState(rows((k) => (k === "nurture" ? { enabled: false } : {})));
  expect(oneDormant.done === false, "approved but silent",
    `an approved-but-DISABLED sales automation still read done: ${JSON.stringify(oneDormant)}.\n    The engine needs enabled AND approved to send, so that is a finished-looking step over a sequence that cannot say anything. This is the state the panel's seed list creates.`);

  const noEnabledField = salesApprovalState(SALES_AUTOMATION_KEYS.map((k) => ({ key: k, approved: true })));
  expect(noEnabledField.done === false, "approved but silent",
    "rows with no `enabled` field at all read as done. It must fail CLOSED: a caller that forgot to select the column is not evidence that anything is live.");

  expect(salesApprovalState([]).done === false, "approved but silent",
    "zero sales automations read as done. Nothing to approve is not approval.");

  // The wizard's own copy of this arithmetic, and setup-status feeding it, are both
  // asserted by checkSetupStatusFeedsTheDetector below - by DRIVING setup-status
  // rather than by grepping it. The regex that used to sit here guarded the consumer
  // while the producer's select could lose the column underneath it.
}

// ─── F6: consent is never banked for an empty sequence ───────────────────────
//
// THE COMPOSED FAILURE. Two fixes, each correct alone, each with a passing test:
//
//   approve-sales-messages approved every sales row it found, without looking at
//     whether the row CONTAINED anything. Fine while a step-less row also stayed
//     enabled:false, because then it was silent either way.
//   the seeder learned to repair a row born dormant: zero steps + enabled:false
//     becomes enabled:true with the canonical steps written in. Fine on its own.
//
// Composed, against BAM NY's real production shape (ghosted + nurture, enabled
// false, approved false, zero steps): the owner presses Approve over a screen with
// NO MESSAGES ON IT, both rows go approved:true, a routine re-seed (applyPreset
// calls seedAutomations, and seed-preset-automations is a portal action) fills them
// and enables them, and isAutomationLive returns true for both. Four live outbound
// steps on a consent nobody could have given, because there was nothing to read.
//
// The shape to internalise: the seeder fix converted a dormant, VISIBLE failure into
// an armed, INVISIBLE one. Each half's own test still passes. This check therefore
// runs the WHOLE sequence - approve, then really re-seed, then ask the send path.
async function checkEmptySequenceNeverBanksConsent() {
  const { default: handler, isAutomationLive } = await automationsModule();
  const { seedAutomations } = await seedModule();
  const sb = async (p, init = {}) => {
    const r = restCall(`${REST}${p}`, init);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  };

  // BAM NY, 2026-07-29: two placeholder rows the automations panel created, at the
  // database default enabled:false, with nothing in them.
  const bamNy = () => ({
    ...OWNER,
    tables: {
      ...OWNER.tables,
      automations: [
        { id: "a-ghosted", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: false, approved: false },
        { id: "a-nurture", client_id: ACADEMY, automation_key: "nurture", name: "Lead Nurture", enabled: false, approved: false },
      ],
      automation_steps: [],
    },
  });

  const db = installDb(bamNy());
  const res = fakeRes();
  await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), res);
  expect(res.statusCode === 400, "empty approval",
    `the owner pressed Approve over two sequences with NO MESSAGES in them and the action returned ${res.statusCode}. There is nothing to consent to, so it must refuse.`);
  expect(db.tables.automations.every((a) => a.approved === false), "empty approval",
    "approving banked a yes on a sequence with zero steps. That consent is about nothing, and a later re-seed fills the row - so it becomes consent to copy the owner has never seen.");

  // THE SECOND HALF. A routine re-seed - the real seeder, not a stand-in.
  await seedAutomations({ clientId: ACADEMY, keys: ["ghosted", "nurture"], sb });
  expect(db.tables.automations.every((a) => a.enabled === true), "empty approval",
    "the re-seed did not repair the dormant rows, so this check is no longer running the scenario it was written for. Re-point it at what the seeder does now.");
  expect(db.tables.automation_steps.length > 0, "empty approval",
    "the re-seed wrote no steps, so the composed scenario never happens here and the assertion below proves nothing.");

  for (const key of ["ghosted", "nurture"]) {
    expect((await isAutomationLive(ACADEMY, key)) === false, "empty approval",
      `'${key}' is LIVE after a re-seed filled it, with the owner's only press having landed on an empty screen. The fill has to come back and ask.`);
  }

  // AND THE OTHER DIRECTION, or a rule that refused everything would pass. Once the
  // messages exist, the owner's yes works and the sequences go live.
  const res2 = fakeRes();
  await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), res2);
  expect(res2.statusCode === 200, "empty approval",
    `with the messages now written, the owner's approval returned ${res2.statusCode}: ${JSON.stringify(res2.payload)}. The refusal above has to be about EMPTINESS, not about refusing everybody.`);
  expect((await isAutomationLive(ACADEMY, "ghosted")) === true, "empty approval",
    "a filled, enabled, freshly approved sequence still is not live. The two runs did not diverge, so the check above proves nothing.");

  // THE MIXED CASE, which is the one an academy mid-setup is actually in: some
  // sequences written, some still empty. The written ones are approved, the empty
  // ones are NAMED in the response, and the step does not read done.
  {
    const mixed = installDb({
      ...OWNER,
      tables: {
        ...OWNER.tables,
        automations: [
          { id: "m-contact", client_id: ACADEMY, automation_key: "contact_form", name: "Contact", enabled: true, approved: false },
          { id: "m-trial", client_id: ACADEMY, automation_key: "trial_form", name: "Trial", enabled: true, approved: false },
          { id: "m-ghosted", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: false, approved: false },
        ],
        automation_steps: [{ id: "s1", automation_id: "m-contact", position: 0, channel: "sms", body: "hi", enabled: true },
                           { id: "s2", automation_id: "m-trial", position: 0, channel: "sms", body: "hi", enabled: true }],
      },
    });
    const r = fakeRes();
    await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), r);
    expect(r.statusCode === 200, "empty approval", `the mixed case returned ${r.statusCode}; the two written sequences are approvable.`);
    const rows = Object.fromEntries(mixed.tables.automations.map((a) => [a.automation_key, a]));
    expect(rows.contact_form.approved === true && rows.trial_form.approved === true, "empty approval",
      "the sequences that DO have messages were not approved. Skipping the empty ones must not skip the rest.");
    expect(rows.ghosted.approved === false, "empty approval",
      "the empty sequence was approved alongside the written ones.");
    const skipped = (r.payload && r.payload.skipped) || [];
    expect(Array.isArray(skipped) && skipped.includes("ghosted"), "empty approval",
      `the response does not name the sequence it skipped (skipped=${JSON.stringify(skipped)}). Without it the wizard reports a blanket yes and the owner never learns one sequence still needs reading.`);
    expect(r.payload && r.payload.done === false, "empty approval",
      `the response reported done=${r.payload && r.payload.done} while one sales sequence is unapproved. A green step over a sequence nobody approved is exactly what this suite exists to reject.`);
  }

  // ...and the response has to tell the truth about the FULL case too, which is what
  // makes the `enabled` column in the approve select load-bearing: drop it and
  // salesApprovalState fails closed, so approve can never report done.
  {
    installDb({
      ...OWNER,
      tables: {
        ...OWNER.tables,
        automations: SALES_KEYS.map((k, i) => ({ id: `f-${i}`, client_id: ACADEMY, automation_key: k, name: k, enabled: true, approved: false })),
        automation_steps: SALES_KEYS.map((k, i) => ({ id: `fs-${i}`, automation_id: `f-${i}`, position: 0, channel: "sms", body: "hi", enabled: true })),
      },
    });
    const r = fakeRes();
    await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), r);
    expect(r.statusCode === 200 && r.payload && r.payload.done === true, "empty approval",
      `five written, enabled sequences approved by the owner did not report done: ${r.statusCode} ${JSON.stringify(r.payload)}.\n    The response is built from the columns the action SELECTS, so this fails if the select loses \`enabled\`, gains a column the table does not have, or the PATCH body does.`);
  }
}

// ─── the yes covers the five sales keys and NOT the welcome sequence ─────────
//
// `onboarding` is deliberately not in SALES_AUTOMATION_KEYS: it is the
// post-conversion welcome sequence for people who have already paid, and several of
// its steps seed OFF until the academy has entered its own schedule, venue and
// coaches. Two files say so in prose. Nothing checked the CALL SITE, so
// SALES_AUTOMATION_KEYS.concat(["onboarding"]) right there survived everything -
// _approval-render.test.mjs pins the constant's CONTENTS, which the widening does
// not touch.
async function checkApprovalDoesNotReachOnboarding() {
  const { default: handler } = await automationsModule();
  const rows = [
    ...SALES_KEYS.map((k, i) => ({ id: `s-${i}`, client_id: ACADEMY, automation_key: k, name: k, enabled: true, approved: false })),
    { id: "s-onb", client_id: ACADEMY, automation_key: "onboarding", name: "Welcome", enabled: true, approved: false },
  ];
  const steps = rows.map((a, i) => ({ id: `st-${i}`, automation_id: a.id, position: 0, channel: "sms", body: "hi", enabled: true }));
  const db = installDb({ ...OWNER, tables: { ...OWNER.tables, automations: rows, automation_steps: steps } });
  const res = fakeRes();
  await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), res);
  expect(res.statusCode === 200, "onboarding is not armed", `the owner's approval returned ${res.statusCode}.`);
  const onb = db.tables.automations.find((a) => a.automation_key === "onboarding");
  expect(onb && onb.approved === false, "onboarding is not armed",
    "approving the SALES messages armed the `onboarding` welcome sequence too. It is not a sales message to a lead - it goes to people who have already paid - and its steps are gated separately, several of them seeded OFF until the academy has entered its schedule, venue and coaches. The approval surface never showed the owner a word of it.");
  expect(db.tables.automations.filter((a) => a.approved).length === SALES_KEYS.length, "onboarding is not armed",
    "the approval touched a different number of rows than there are sales keys.");
}

// ─── `enabled` is load-bearing too, in the same three places ─────────────────
//
// api/_sales-approval.js states that the worker will not enrol, will not report an
// automation live and will not send unless the row is BOTH enabled and approved.
// F3 proves the `approved` half at all three. The `enabled` half had no check at
// all, because no fixture was ever enabled:false + approved:true - so all three
// deletions shipped green. The first of them is the operator's Off switch: a
// teammate hits Off mid-complaint and the queued jobs keep sending.
async function checkEnabledIsLoadBearing() {
  const { enrollContact, isAutomationLive, default: handler } = await automationsModule();

  const world = (enabled) => ({
    ...STAFF,
    tables: {
      ...STAFF.tables,
      automations: [{ id: "auto-x", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled, approved: true }],
      automation_steps: [{ id: "step-1", automation_id: "auto-x", position: 0, wait_amount: 0, wait_unit: "minutes", channel: "sms", body: "hi", enabled: true }],
      automation_enrollments: [], automation_jobs: [], automation_events: [],
      clients: [{ id: ACADEMY, business_name: "Arming Test Academy" }],
    },
  });

  {
    const db = installDb(world(false));
    const out = await enrollContact({ clientId: ACADEMY, automationKey: "ghosted", contactId: "c1" });
    expect(out && out.skipped, "enabled is load-bearing",
      `enrollContact ENROLLED a lead into an automation that is approved but SWITCHED OFF (${JSON.stringify(out)}). Off has to mean off.`);
    expect(db.tables.automation_enrollments.length === 0, "enabled is load-bearing",
      "enrollContact refused in its return value but still wrote an enrollment row.");
  }
  {
    installDb(world(true));
    const out = await enrollContact({ clientId: ACADEMY, automationKey: "ghosted", contactId: "c1" });
    expect(out && out.ok === true, "enabled is load-bearing",
      `enrollContact refused an ENABLED + approved automation (${JSON.stringify(out)}). The differential is gone, so the check above proves nothing.`);
  }

  installDb(world(false));
  expect((await isAutomationLive(ACADEMY, "ghosted")) === false, "enabled is load-bearing",
    "isAutomationLive reported a switched-OFF automation live. Every trigger that branches on it would route real leads onto a sequence an operator turned off.");
  installDb(world(true));
  expect((await isAutomationLive(ACADEMY, "ghosted")) === true, "enabled is load-bearing",
    "isAutomationLive reported an enabled + approved automation with an enabled step as NOT live.");

  // The worker, with a job already queued - which is the case that matters. Turning
  // a sequence off does not delete the jobs already in the queue, so the worker's
  // own check is the thing that stops them going out.
  const jobWorld = (enabled) => {
    const w = world(enabled);
    w.tables.automation_steps[0].enabled = false;
    w.tables.automation_jobs = [{ id: "job-1", client_id: ACADEMY, automation_id: "auto-x", enrollment_id: "enr-1", step_id: "step-1", contact_id: "c1", channel: "sms", run_after: "2000-01-01T00:00:00.000Z", status: "pending", dedupe_key: "enr-1:step-1" }];
    w.tables.automation_enrollments = [{ id: "enr-1", client_id: ACADEMY, automation_id: "auto-x", contact_id: "c1", status: "active", current_position: 0 }];
    return w;
  };
  const workReq = { method: "GET", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: { action: "work" }, body: null };
  {
    const db = installDb(jobWorld(false));
    await handler(workReq, fakeRes());
    expect(db.tables.automation_jobs[0].last_error === "automation off", "enabled is load-bearing",
      `the worker processed a due job on an approved-but-SWITCHED-OFF automation. Job ended status=${db.tables.automation_jobs[0].status} last_error=${JSON.stringify(db.tables.automation_jobs[0].last_error)}.\n    This is the operator's Off switch: somebody hits Off in the middle of a complaint and the queued jobs keep going out.`);
    expect(OUTBOUND(db).length === 0, "enabled is load-bearing",
      `the worker made ${OUTBOUND(db).length} outbound call(s) on a switched-off automation: ${OUTBOUND(db).map((c) => c.url).join(", ")}`);
  }
  {
    const db = installDb(jobWorld(true));
    await handler(workReq, fakeRes());
    expect(db.tables.automation_jobs[0].last_error === "step missing/disabled", "enabled is load-bearing",
      `with the SAME fixture at enabled:true the worker should have walked past the automation gate and stopped at the disabled step, but it ended last_error=${JSON.stringify(db.tables.automation_jobs[0].last_error)}. Without that the check above cannot tell a working gate from a fixture that never runs.`);
  }
}

// ─── the tenant boundary on the arming write ─────────────────────────────────
//
// Every other action on this handler is scoped by the canActOn gate on the
// client_id in the request BODY. set-approved is not: it takes an automation_id,
// and `ownsAutomation` is the only thing tying that id back to the academy. Nothing
// tested it, so dropping the scope survived every suite - and it is the arming
// write, so the failure is owner A switching on live messaging in academy B.
async function checkArmingWriteIsTenantScoped() {
  const { default: handler } = await automationsModule();

  {
    const db = installDb({
      ...OWNER,
      tables: {
        ...OWNER.tables,
        automations: [
          { id: "mine", client_id: ACADEMY, automation_key: "ghosted", name: "Ghosted", enabled: true, approved: false },
          { id: "theirs", client_id: OTHER, automation_key: "ghosted", name: "Ghosted", enabled: true, approved: false },
        ],
      },
    });
    const res = fakeRes();
    // The body names the owner's OWN academy, so the handler's canActOn gate lets
    // this through. The only thing standing between them and another academy's
    // automation is ownsAutomation.
    await handler(bearerReq({ action: "set-approved", client_id: ACADEMY, automation_id: "theirs", value: true }), res);
    expect(res.statusCode === 403, "arming write is tenant-scoped",
      `set-approved returned ${res.statusCode} for an owner arming an automation belonging to ANOTHER academy. ownsAutomation is the whole boundary here.`);
    expect(db.tables.automations.find((a) => a.id === "theirs").approved === false, "arming write is tenant-scoped",
      "an owner of one academy armed another academy's sequence. Parents at an academy they have nothing to do with start receiving texts.");
  }

  // The same boundary on the wizard's one-press approval, via its SELECT. An academy
  // with no sales automations must be refused; if that select is not scoped it counts
  // somebody else's rows and answers "approved" over nothing of its own.
  {
    const db = installDb({
      ...OWNER,
      tables: {
        ...OWNER.tables,
        automations: SALES_KEYS.map((k, i) => ({ id: `o-${i}`, client_id: OTHER, automation_key: k, name: k, enabled: true, approved: false })),
        automation_steps: SALES_KEYS.map((k, i) => ({ id: `os-${i}`, automation_id: `o-${i}`, position: 0, channel: "sms", body: "hi", enabled: true })),
      },
    });
    const res = fakeRes();
    await handler(bearerReq({ action: "approve-sales-messages", client_id: ACADEMY }), res);
    expect(res.statusCode === 400, "arming write is tenant-scoped",
      `an academy with ZERO sales automations of its own got ${res.statusCode} from approve-sales-messages: ${JSON.stringify(res.payload)}. It must be refused - nothing to approve is not approval - and a select that is not scoped to the academy turns that refusal into a false success.`);
    expect(db.tables.automations.every((a) => a.approved === false), "arming write is tenant-scoped",
      "approving for one academy wrote approved:true onto another academy's rows.");
  }
}

// ─── armingRefusal's documented fail-closed branches ─────────────────────────
//
// api/_sales-approval.js documents failing closed on an unknown lane and on an actor
// that does not carry the owner predicate. Deleting either line shipped green: the
// first has no test, and the second refuses only by ACCIDENT - `actor.canApproveAsOwner`
// on an object that has no such method throws a TypeError that the handler's try
// happens to catch. An accident is not a gate; it moves the moment somebody adds a
// catch, or passes an actor whose predicate is a truthy non-function.
async function checkRefusalFailsClosed() {
  const { armingRefusal, ARMING_LANES } = await refusalModule();

  const unknown = armingRefusal("no-such-lane", { canApproveAsOwner: () => true }, ACADEMY);
  expect(unknown && unknown.status === 500, "refusal fails closed",
    `armingRefusal on an UNREGISTERED lane returned ${JSON.stringify(unknown)}. It must fail closed with a 500: an unknown lane means somebody wired a new arming route and forgot to register it, and answering null there admits everybody.`);

  for (const [label, actor] of [
    ["an actor with no owner predicate at all", { canActOn: () => true }],
    ["an actor whose predicate is a truthy non-function", { canApproveAsOwner: true }],
    ["null", null],
  ]) {
    const out = armingRefusal("set-approved", actor, ACADEMY);
    expect(out && out.status === 403, "refusal fails closed",
      `armingRefusal admitted ${label} (returned ${JSON.stringify(out)}). Passing the wrong object has to REFUSE, and by a branch that says so rather than by throwing.`);
    expect(out && out.error === ARMING_LANES["set-approved"].refusal, "refusal fails closed",
      `the refusal for ${label} is not the lane's own message: ${JSON.stringify(out && out.error)}`);
  }

  // ...and the positive side, or a function that refused everything would pass.
  expect(armingRefusal("set-approved", { canApproveAsOwner: () => true }, ACADEMY) === null, "refusal fails closed",
    "armingRefusal refused an actor that DOES carry the owner predicate and returns true.");
}

// ─── setup-status feeds the wizard's detector, proved by driving it ──────────
//
// This was a regex on setup-status.js's source text - the one text pin left in a
// behavioural suite - and it guarded the CONSUMER while the PRODUCER could break
// underneath it. So it runs the real handler and asks the real detector.
async function checkSetupStatusFeedsTheDetector() {
  const { default: statusHandler } = await setupStatusModule();
  const { salesApprovalState } = await stateModule();

  const world = (patch = () => ({})) => ({
    ...STAFF,
    tables: {
      ...STAFF.tables,
      clients: [{ id: ACADEMY, business_name: "Arming Test Academy", booking_provider: "portal" }],
      offers: [{ id: "offer-1", client_id: ACADEMY, type: "training", status: "published", data: {} }],
      automations: SALES_KEYS.map((k, i) => ({ id: `a-${i}`, client_id: ACADEMY, automation_key: k, name: k, enabled: true, approved: true, ...patch(k) })),
      contacts: [], pipeline_stages: [], stage_transitions: [], agent_prompt_sections: [],
      custom_field_defs: [], entry_points: [], offer_prices: [], members: [],
      client_meta_messaging_config: [],
    },
  });
  const statusReq = { method: "GET", headers: { authorization: "Bearer stub-token" }, query: { client_id: ACADEMY }, body: null };

  installDb(world());
  const res = fakeRes();
  await statusHandler(statusReq, res);
  const body = res.payload || {};
  expect(res.statusCode === 200, "setup-status feeds the detector",
    `setup-status returned ${res.statusCode}: ${JSON.stringify(body)}`);
  expect(salesApprovalState(body.automations).done === true, "setup-status feeds the detector",
    `five approved AND enabled sales automations did not read done through setup-status: ${JSON.stringify(body.automations)} -> ${JSON.stringify(salesApprovalState(body.automations))}.\n    salesApprovalState fails CLOSED on a missing \`enabled\`, so if setup-status stops returning it, every academy's approve step reads never-done and the owner is asked to approve something they already approved.`);

  // The differential: one sequence switched off has to come back through the same
  // path as not-done. Without it, a detector that always said done would pass.
  installDb(world((k) => (k === "nurture" ? { enabled: false } : {})));
  const res2 = fakeRes();
  await statusHandler(statusReq, res2);
  expect(salesApprovalState((res2.payload || {}).automations).done === false, "setup-status feeds the detector",
    `an approved-but-switched-off sales automation still read done through setup-status: ${JSON.stringify((res2.payload || {}).automations)}`);

  // The wizard carries its OWN copy of this arithmetic and it is the one the owner
  // sees; it cannot import from here, so this is the one place a text pin is the
  // only option left.
  const html = fs.readFileSync(path.join(HERE, "../public/client-portal.html"), "utf8");
  if (!/next\.approve_n = _salesAutos\.filter\(a => a\.approved && a\.enabled\)\.length;/.test(html)) {
    fail("setup-status feeds the detector", "the wizard's own detector counts `approved` without `enabled`, so the step the owner looks at would go green over a sequence that cannot send. It has to agree with salesApprovalState().");
  }
}

// ─── the approval surface never offers a yes over an empty sequence ──────────
//
// The API refuses a step-less row. The SURFACE has to agree, or the owner is shown
// "Approve these messages" over a card that reads "No messages in this one yet" and
// the refusal arrives as an error after the click. The wizard lives in a single HTML
// file with no import path, so the function is lifted out and RUN against a fake
// document rather than grepped for.
async function checkWizardDoesNotOfferAnEmptyYes() {
  let html = fs.readFileSync(path.join(HERE, "../public/client-portal.html"), "utf8");
  if (MUTATE === "wizardempty") html = mutantText(html, "public/client-portal.html", [
    ["const pending = list.filter(seq => !seq.approved && (seq.steps || []).length);",
     "const pending = list.filter(seq => !seq.approved);"],
    ["${!pending.length && !empty.length", "${!pending.length"],
  ]);
  const start = html.indexOf("function _obfApproveRender()");
  if (start < 0) return fail("wizard offers no empty yes", "_obfApproveRender has been renamed or removed; re-point this check at the function that renders the approval step.");
  // Brace-match the function body so a reformat cannot silently truncate it.
  let i = html.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return fail("wizard offers no empty yes", "could not brace-match _obfApproveRender's body.");
  const src = html.slice(start, end);

  const render = (messages) => {
    const host = { innerHTML: "" };
    const doc = { getElementById: (id) => (id === "obf-approve-host" ? host : null) };
    const fn = new Function("document", "_OBF_APPROVE", "_OBF_SALES_LABELS", "_obfApproveMsgHtml", "escapeHTML",
      `${src}\n return _obfApproveRender();`);
    fn(doc, { messages }, {}, (s, i2) => `<i>${i2}</i>`, (s) => String(s));
    return host.innerHTML;
  };

  const seq = (key, over) => ({ automation_key: key, approved: false, enabled: false, steps: [], ...over });
  const filled = { steps: [{ id: "s", position: 0, channel: "sms", enabled: true }] };

  const allEmpty = render([seq("ghosted"), seq("nurture")]);
  expect(!/_obfApprove\(this\)/.test(allEmpty), "wizard offers no empty yes",
    "the wizard offers an Approve button over sequences with NO MESSAGES in them. The API refuses that press, so the button is a promise the write does not keep - and before the API refused it, the press became consent to whatever a re-seed put in the row.");
  expect(!/obf2-done/.test(allEmpty), "wizard offers no empty yes",
    "the wizard shows the green \"You approved these\" tick over sequences that are empty and unapproved. Nothing pending is not the same as everything done.");

  const mixed = render([seq("contact_form", { ...filled, approved: false }), seq("ghosted")]);
  expect(/_obfApprove\(this\)/.test(mixed), "wizard offers no empty yes",
    "the wizard hid the Approve button even though one sequence has messages waiting for a yes. Empty sequences must be excluded, not the whole step.");

  const done = render([seq("contact_form", { ...filled, approved: true, enabled: true })]);
  expect(/obf2-done/.test(done), "wizard offers no empty yes",
    "a fully approved, fully written sales system did not render as done. The three states have collapsed.");
}

// ─── seed-form-intro births a DORMANT row, under the weaker scope ────────────
//
// The fifth write site to the automations table, and the only one that passed an
// arming field while sitting on plain canActOn.
async function checkFormIntroSeedIsDormant() {
  const { default: handler } = await automationsModule();
  const db = installDb({ ...TEAMMATE, tables: { ...TEAMMATE.tables, automations: [], automation_steps: [] } });
  const res = fakeRes();
  await handler(bearerReq({ action: "seed-form-intro", client_id: ACADEMY, automation_key: "contact_form" }), res);
  expect(res.statusCode === 200, "form-intro seed is dormant",
    `seed-form-intro returned ${res.statusCode}: ${JSON.stringify(res.payload)}. It is an ordinary panel action and stays on canActOn.`);
  const row = db.tables.automations[0];
  expect(row && row.approved !== true, "form-intro seed is dormant",
    `seed-form-intro created an automation at approved:${row && row.approved}. Opening an Entry Point tab would then arm a sequence nobody approved - and this action is reachable by any teammate with can_train_agent, not only an owner.`);
  expect(row && row.enabled === true && db.tables.automation_steps.length === 1, "form-intro seed is dormant",
    "the form-intro seed no longer creates an enabled row with its default step, so this check is aimed at something that has moved.");
}

// ─── run ─────────────────────────────────────────────────────────────────────
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (RUN) await main();

async function main() {
  console.log("\n── Arming gates: behaviour, not text ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const steps = [
    ["the owner scope MEANS something a rename cannot satisfy", checkOwnerScopeSemantics],
    ["every arming route REFUSES a non-owner, and writes nothing", checkGatesRefuse],
    ["`approved` stops the send in all three places", checkApprovedIsLoadBearing],
    ["the booking agent's scripted opener is owner-gated too", checkBookingOpenerLane],
    ["`enabled` stops the send in the same three places", checkEnabledIsLoadBearing],
    ["a row born dormant is repaired, a configured row is not", checkDormantRowRepair],
    ["approved but disabled does not read as done", checkDisabledIsNotDone],
    ["an EMPTY sequence never collects the owner's yes", checkEmptySequenceNeverBanksConsent],
    ["the wizard never offers a yes over an empty sequence", checkWizardDoesNotOfferAnEmptyYes],
    ["the sales yes does not reach the onboarding welcome", checkApprovalDoesNotReachOnboarding],
    ["the arming write cannot cross academies", checkArmingWriteIsTenantScoped],
    ["armingRefusal fails closed where it says it does", checkRefusalFailsClosed],
    ["setup-status really feeds the approve detector", checkSetupStatusFeedsTheDetector],
    ["seed-form-intro births a dormant row", checkFormIntroSeedIsDormant],
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
    console.log("\n✅ Arming a sales message needs an owner, and the owner's yes is what lets it send.\n");
    process.exit(0);
  }
  console.log(`\n❌ ${fails.length} failure(s).\n`);
  process.exit(1);
}
