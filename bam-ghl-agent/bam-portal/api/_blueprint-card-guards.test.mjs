// Regression test for the Business Blueprint Brand + KPI save guards.
//
//   node api/_blueprint-card-guards.test.mjs
//   PORTAL_PATH=/some/other/client-portal.html node api/_blueprint-card-guards.test.mjs
//
// THE BUG THIS EXISTS TO PREVENT (fixed 2026-07-27):
// brand_data and kpi_data are deliberately NOT in CLIENT_SELECT_COLS, so the
// cached CLIENT_ROWS row carries neither. The Brand and KPI cards therefore
// rendered every field blank, and their change handlers read those blank
// inputs and posted a full object of empty strings. update_client_basics
// merges with COALESCE(p_patch->'brand_data', brand_data) - an empty OBJECT is
// not NULL, so the empty object won and every stored key was overwritten.
// Opening Brand and editing one field destroyed 18 of 19 stored brand_data
// keys. 11 academies had brand_data, 7 had kpi_data.
//
// HOW THIS TEST WORKS: it executes the REAL functions out of
// public/client-portal.html - no copies, no paraphrase - against a tiny stub
// document and a faithful port of the RPC's merge. Node builtins only: the
// full end-to-end harness used jsdom (to render the card's innerHTML) and
// PGlite (to run the real migration SQL), and neither is a repo dependency, so
// this covers the save path rather than the render path. What it cannot see is
// asserted directly instead: that CLIENT_SELECT_COLS still omits both columns
// (the precondition that makes the inputs render blank), and that the RPC
// still replaces jsonb wholesale (the reason blanks are destructive).
//
// The four scenarios that encode the fail-CLOSED reasoning - slow read,
// instant click, mid-session client switch, empty client - all fail when run
// against the pre-fix file. If you are refactoring these card paths and a
// guard here starts failing, the guard is the feature.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = process.env.PORTAL_PATH || path.join(HERE, "..", "public", "client-portal.html");
const MIGRATION = path.join(HERE, "..", "supabase", "migrations",
  "20260725033015_restore_update_client_basics_full_whitelist.sql");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✅ " + m); } else { fail++; console.log("  ❌ " + m); } };
const section = (t) => console.log("\n" + t);

const src = fs.readFileSync(PORTAL, "utf8");

// ── Extract the shipped source ────────────────────────────────────────────
// These are top-level functions inside a <script>, so the closing brace sits in
// column 0. Brace counting is unsafe: the render functions nest template
// literals inside `${}` inside template literals.
function grabFunction(name, optional) {
  const m = new RegExp("^(?:async\\s+)?function\\s+" + name + "\\s*\\(", "m").exec(src);
  if (!m) { if (optional) return ""; throw new Error("function not found in portal: " + name); }
  const end = src.indexOf("\n}", m.index);
  if (end < 0) throw new Error("unterminated function: " + name);
  return src.slice(m.index, end + 2) + "\n";
}
function grabDecl(kw, name, optional) {
  const m = new RegExp("^" + kw + "\\s+" + name + "\\s*=", "m").exec(src);
  if (!m) { if (optional) return ""; throw new Error(kw + " not found in portal: " + name); }
  let i = m.index, depth = 0, inStr = null, prev = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === inStr && prev !== "\\") inStr = null; }
    else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
    else if ("[{(".includes(ch)) depth++;
    else if ("]})".includes(ch)) depth--;
    else if (ch === ";" && depth === 0) { i++; break; }
    prev = ch;
  }
  return src.slice(m.index, i) + "\n";
}

// ── The RPC's merge, ported ───────────────────────────────────────────────
// From 20260725033015_restore_update_client_basics_full_whitelist.sql:
//   brand_data = CASE WHEN p_patch ? 'brand_data'
//                THEN COALESCE(p_patch->'brand_data', brand_data) ELSE brand_data END
// Wholesale replacement, NOT a deep merge. That is why posting {} is fatal.
const JSONB_COLS = ["brand_data", "kpi_data", "onboarding_setup"];
function rpcUpdateClientBasics(store, clientId, patch) {
  const row = store[clientId];
  if (!row) return false;
  for (const k of Object.keys(patch || {})) {
    if (JSONB_COLS.includes(k)) { if (patch[k] != null) row[k] = patch[k]; }
    else row[k] = patch[k];
  }
  return true;
}

// ── Stub document: getElementById / querySelectorAll over a flat id map ────
function makeDocument(ids) {
  const els = {};
  for (const id of ids) els[id] = { value: "", classList: { toggle() {} }, getAttribute: () => null };
  return {
    _els: els,
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
  };
}

// ── Controllable timers, so the 600ms debounce is deterministic ────────────
function makeTimers() {
  let seq = 0; const queue = new Map();
  return {
    setTimeout: (fn) => { const id = ++seq; queue.set(id, fn); return id; },
    clearTimeout: (id) => { queue.delete(id); },
    // Fire everything currently pending (the debounce reschedules by
    // clearing, so at most one brand save is ever queued).
    flush() { const fns = [...queue.values()]; queue.clear(); fns.forEach(fn => fn()); },
    get pending() { return queue.size; },
  };
}

// ── Fake supabase client over an in-memory store ───────────────────────────
// `gate` lets a test hold the clients read open to simulate a slow network.
function makeSb(store, ctl) {
  return {
    async rpc(fn, args) {
      if (fn !== "update_client_basics") return { error: { message: "unknown rpc " + fn } };
      ctl.saves.push(JSON.parse(JSON.stringify(args.p_patch || {})));
      rpcUpdateClientBasics(store, args.p_client_id, args.p_patch || {});
      return { error: null };
    },
    from() {
      const st = { cols: null, id: null };
      const api = {
        select(cols) { st.cols = cols; return api; },
        eq(_c, v) { st.id = v; return api; },
        neq() { return api; },
        async maybeSingle() {
          if (ctl.gate) await ctl.gate;
          if (ctl.readFails) return { data: null, error: { message: "network" } };
          const row = store[st.id];
          return { data: row ? { [st.cols]: row[st.cols] ?? null } : null, error: null };
        },
      };
      return api;
    },
  };
}

const BRAND_IDS = ["color_primary", "color_secondary", "color_accent", "font_display", "font_body",
  "logo_dark_url", "logo_light_url", "icon_url", "notes", "story", "why_us", "dream_athletes",
  "proof", "website_url", "domain", "references", "stats"];   // union of pre- and post-reshape
const KPI_IDS = ["rev_30d", "rev_avg_3mo", "rev_highest_month", "rev_goal_6mo", "clients_active",
  "clients_new_30d", "clients_lost_30d", "churn_pct", "avg_stay_months", "avg_spend_client",
  "est_ltv", "peak_active", "leads_30d", "cpl", "trials_30d", "showup_pct", "close_pct", "cac",
  "monthly_ad_spend", "avg_monthly_expenses", "expenses_breakdown"];

// Boot one isolated copy of the card code.
function boot(store, clientId) {
  const ctl = { saves: [], gate: null, readFails: false };
  const timers = makeTimers();
  const doc = makeDocument([
    ...BRAND_IDS.map(k => "bb-brand-" + k),
    ...KPI_IDS.map(k => "bb-kpi-" + k),
  ]);
  const sandbox = {
    CLIENT_ID: clientId,
    // Exactly what the page has after loading CLIENT_SELECT_COLS: the row is
    // present, brand_data and kpi_data are absent.
    CLIENT_ROWS: [{ id: clientId, business_name: "Test Academy" }],
    _sb: makeSb(store, ctl),
    document: doc,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    console,
    alert: (m) => { ctl.alerts = (ctl.alerts || []).concat(m); },
    // Collaborators outside the Brand/KPI save paths.
    _bbAutoDone: () => {}, _obtScheduleRefresh: () => {}, _bbRenderFromHash: () => {},
    _bbBrandRenderDerived: () => {}, _obfFetchState: async () => ({}),
    _OBF_STATE: null, _OBF_AT: 0,
  };
  let code = "let _bbBasicsSaveTimer = null;\n";
  code += grabDecl("let", "_BB_BRAND_LOADED_FOR", true) || "let _BB_BRAND_LOADED_FOR = null;\n";
  code += grabDecl("let", "_BB_KPIS_LOADED_FOR", true) || "let _BB_KPIS_LOADED_FOR = null;\n";
  code += grabDecl("const", "_BB_KPI_GROUPS");
  code += grabDecl("const", "_BB_KPI_IDS");
  code += grabDecl("const", "_BB_BRAND_TEXT_FIELDS", true);
  // Collaborators of whichever hydration implementation the portal carries.
  // All optional: the assertions below are about BEHAVIOUR, so this list is
  // wiring, not contract. Add names here rather than renaming portal code.
  for (const d of ["_BB_WHOLESALE_COLS", "_BB_KEEP_ON_BLANK", "_BB_GEN_COLS", "_BB_COL_INFLIGHT"])
    code += grabDecl("const", d, true);
  for (const f of ["_bbSaveClientBasics", "_bbBasicsScheduleSave", "_bbBrandChanged",
    "_bbKpisChanged", "_bbBrandSetWebsiteStatus"]) code += grabFunction(f);
  for (const f of ["_bbLoadClientJsonCol", "_bbFillIfBlank", "_bbBrandHydrate",
    "_bbKpisHydrate", "_bbBrandIntakeChanged",
    "_bbHydrateClientCols", "_bbDropUnloadedBlobs"]) code += grabFunction(f, true);
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: "client-portal-cards.js" });
  return { ctx, ctl, timers, doc };
}

const BRAND = {
  color_primary: "#D4B65C", color_secondary: "#000000", color_accent: "#FFFFFF",
  font_display: "Bebas Neue", font_body: "Inter", logo_dark_url: "https://cdn/d.png",
  logo_light_url: "https://cdn/l.png", icon_url: "https://cdn/i.png",
  notes: "House voice", story: "Started in a church gym.", why_us: "Every rep coached.",
  dream_athletes: "Ages 9-16.", proof: "12 D1 players",
  // Legacy keys the reshaped card no longer edits. They must survive a save
  // untouched, which is what protects academies between deploy and migration.
  website_url: "https://byanymeanstoronto.ca", domain: "byanymeanstoronto.ca",
  references: "example-a.com", stats: "43+ active members", website_status: "Have one, happy with it",
  site_pages: [{ slug: "camps", label: "Camps" }],
};
const KPI = { rev_30d: "48000", rev_avg_3mo: "44000", clients_active: "47", churn_pct: "4",
  leads_30d: "210", cpl: "9.40", avg_monthly_expenses: "21000", expenses_breakdown: "Rent, coaches" };

const CID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const freshStore = () => ({
  [CID]: { id: CID, brand_data: { ...BRAND }, kpi_data: { ...KPI }, onboarding_setup: {} },
  [OTHER]: { id: OTHER, brand_data: { color_primary: "#FF0000", story: "other story" },
             kpi_data: {}, onboarding_setup: {} },
});
const deferred = () => { let r; const p = new Promise(res => { r = res; }); return { p, resolve: r }; };
const settle = () => new Promise(res => setImmediate(res));

// ── Preconditions: the two facts that make blanks destructive ─────────────
section("Preconditions");
{
  const m = /const CLIENT_SELECT_COLS = ['"]([^'"]+)['"]/.exec(src);
  ok(!!m, "CLIENT_SELECT_COLS found in the portal");
  const cols = (m ? m[1] : "").split(",").map(s => s.trim());
  ok(!cols.includes("brand_data"),
    "CLIENT_SELECT_COLS omits brand_data (so the card renders blank without a separate read)");
  ok(!cols.includes("kpi_data"), "CLIENT_SELECT_COLS omits kpi_data");
  const mig = fs.readFileSync(MIGRATION, "utf8");
  ok(mig.includes("COALESCE(p_patch->'brand_data', brand_data)"),
    "update_client_basics still replaces brand_data WHOLESALE (if this fails, revisit rpcUpdateClientBasics above)");
}

// ── 1. The headline case ──────────────────────────────────────────────────
section("Open the card, edit one unrelated field, save");
{
  const store = freshStore();
  const { ctx, ctl, timers, doc } = boot(store, CID);
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  await settle();
  ok(doc.getElementById("bb-brand-story").value === BRAND.story,
    "hydration puts the stored story back into the input");
  doc.getElementById("bb-brand-notes").value = "House voice, updated";
  ctx._bbBrandChanged();
  timers.flush();
  await settle();
  const after = store[CID].brand_data;
  const lost = Object.keys(BRAND).filter(k => JSON.stringify(after[k]) !== JSON.stringify(BRAND[k]) && k !== "notes");
  ok(lost.length === 0, `no stored brand_data key is destroyed (lost: ${JSON.stringify(lost)})`);
  ok(after.notes === "House voice, updated", "the edit itself is saved");
  ok(JSON.stringify(after.site_pages) === JSON.stringify(BRAND.site_pages),
    "site_pages survives even though the card never edits it");
}
{
  const store = freshStore();
  const { ctx, timers, doc } = boot(store, CID);
  ctx._bbKpisHydrate && ctx._bbKpisHydrate();
  await settle();
  ok(doc.getElementById("bb-kpi-clients_active").value === "47", "KPI card hydrates the stored count");
  doc.getElementById("bb-kpi-cpl").value = "9.10";
  ctx._bbKpisChanged();
  timers.flush();
  await settle();
  const after = store[CID].kpi_data;
  const lost = Object.keys(KPI).filter(k => k !== "cpl" && after[k] !== KPI[k]);
  ok(lost.length === 0, `no stored kpi_data key is destroyed (lost: ${JSON.stringify(lost)})`);
  ok(after.cpl === "9.10", "the KPI edit itself is saved");
}

// ── 2. Slow read: the debounce fires BEFORE the stored values arrive ──────
section("Slow read (fails CLOSED: skip the save, never write blanks)");
{
  const store = freshStore();
  const { ctx, ctl, timers, doc } = boot(store, CID);
  const gate = deferred();
  ctl.gate = gate.p;
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  doc.getElementById("bb-brand-notes").value = "typed immediately";
  ctx._bbBrandChanged();
  timers.flush();                       // debounce fires while the read is in flight
  await settle();
  ok(ctl.saves.length === 0, "a save scheduled before hydration is skipped entirely");
  ok(Object.keys(store[CID].brand_data).length === Object.keys(BRAND).length,
    "stored brand_data is untouched while the read is in flight");
  ctl.gate = null; gate.resolve();
  await settle(); await settle();
  ok(doc.getElementById("bb-brand-notes").value === "typed immediately",
    "hydration does not clobber what the user typed during the fetch");
  ok(doc.getElementById("bb-brand-story").value === BRAND.story,
    "hydration still fills the fields the user did NOT touch");
  ctx._bbBrandChanged();
  timers.flush();
  await settle();
  ok(store[CID].brand_data.notes === "typed immediately" && store[CID].brand_data.story === BRAND.story,
    "the save after hydration takes the edit and keeps everything else");
}

// ── 3. The read fails outright ────────────────────────────────────────────
section("Read failure (fails CLOSED)");
{
  const store = freshStore();
  const { ctx, ctl, timers, doc } = boot(store, CID);
  ctl.readFails = true;
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  await settle();
  doc.getElementById("bb-brand-notes").value = "typed after a failed read";
  ctx._bbBrandChanged();
  timers.flush();
  await settle();
  ok(ctl.saves.length === 0, "a failed read leaves the card locked, so nothing is written");
  ok(store[CID].brand_data.story === BRAND.story, "stored values survive a failed read");
}

// ── 4. Website-status button clicked the instant the card opens ───────────
section("Instant website-status click");
{
  const store = freshStore();
  const { ctx, ctl } = boot(store, CID);
  const gate = deferred();
  ctl.gate = gate.p;
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  const click = ctx._bbBrandSetWebsiteStatus("No website yet");
  ctl.gate = null; gate.resolve();
  await click;
  ok(Object.keys(store[CID].brand_data).length === Object.keys(BRAND).length,
    "clicking a status button does not collapse brand_data to a single key");
  ok(store[CID].brand_data.story === BRAND.story, "brand identity survives the status click");
  const landed = store[CID].onboarding_setup.website_status === "No website yet"
    || store[CID].brand_data.website_status === "No website yet";
  ok(landed, "the status itself is stored (onboarding_setup after the 2026-07-27 reshape)");
}

// ── 5. Staff switches client with the card still open ─────────────────────
section("Mid-session client switch (the unlock is per client id, not a boolean)");
{
  const store = freshStore();
  const { ctx, ctl, timers } = boot(store, CID);
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  await settle();
  ctx.CLIENT_ID = OTHER;                                   // impersonation switch
  ctx.CLIENT_ROWS = [{ id: OTHER, business_name: "Other Academy" }];
  ctx._bbBrandChanged();                                   // stale DOM, new client
  timers.flush();
  await settle();
  ok(store[OTHER].brand_data.story === "other story",
    "the stale card cannot write over the newly selected client");
  ok(store[OTHER].brand_data.color_primary === "#FF0000", "the new client's colours are intact");
}

// ── 6. An academy with nothing stored yet must still be able to save ──────
section("Empty client (the guard must not lock anyone out)");
{
  const store = { [CID]: { id: CID, brand_data: null, kpi_data: null, onboarding_setup: {} } };
  const { ctx, timers, doc } = boot(store, CID);
  ctx._bbBrandHydrate && ctx._bbBrandHydrate();
  await settle();
  doc.getElementById("bb-brand-story").value = "first ever entry";
  ctx._bbBrandChanged();
  timers.flush();
  await settle();
  ok(store[CID].brand_data && store[CID].brand_data.story === "first ever entry",
    "a client with no brand_data can still make the first save");
}

console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
