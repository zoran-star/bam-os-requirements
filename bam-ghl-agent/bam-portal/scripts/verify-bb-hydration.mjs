#!/usr/bin/env node
/**
 * Business Blueprint hydrate-then-save guard rails.
 *
 *     node bam-portal/scripts/verify-bb-hydration.mjs        # from bam-ghl-agent/
 *     MUTATE=b1 node bam-portal/scripts/verify-bb-hydration.mjs   # see below
 *
 * Plain node. No dependencies, no network, no database. Exits 1 on failure.
 *
 * WHY THIS EXISTS
 * Business Basics, Staff, Brand and KPIs all render from the cached clients row
 * and auto-save on every keystroke. Columns those cards need are deliberately
 * NOT in CLIENT_SELECT_COLS (that query runs at every login for every academy
 * the user can reach - a federal tax ID does not belong in it), so each card
 * loads them for itself. That makes a window where a field is on screen but not
 * yet loaded, and update_client_basics turns a blank into NULL and replaces
 * jsonb blobs wholesale. Saving inside that window destroys real data: it did,
 * in production, to legal_name / address / ein and to brand_data / kpi_data.
 *
 * The invariant the portal now holds, and this file exists to keep holding:
 *   - presence of the key ON THE CACHED ROW is the one "loaded" signal;
 *   - nothing blank may be written for a key that has not loaded;
 *   - a wholesale-replaced jsonb blob may not be written at all until loaded;
 *   - WHOEVER KNOWS FIRST WINS - a response that was already in flight never
 *     overwrites a value a save has since established.
 *
 * HOW IT WORKS
 * It extracts the REAL functions out of public/client-portal.html and runs them
 * against a fake DOM and a fake Supabase whose responses this file holds open,
 * so the in-flight window can be opened and closed on demand. The fake query
 * builder is a LAZY THENABLE, like PostgREST's: every .then() fires a fresh
 * request. Saves are applied to the stored row by applyRpc(), transcribed from
 * supabase/migrations/20260725033015_restore_update_client_basics_full_whitelist.sql
 * - so if that function's SQL changes, update applyRpc to match or these tests
 * are checking the wrong contract.
 *
 * NEGATIVE CONTROL - the part that proves the suite has teeth
 * MUTATE=b1|b2|b3|b4 reverts one fix in the extracted source before running, so
 * you can confirm the suite FAILS without it rather than trusting that it
 * passes with it. All four are real regressions caught in review:
 *   b1  the loader assigning unconditionally, so a stale response resets a
 *       value a save had just established  -> section H1 goes red
 *   b2  storing the lazy builder instead of a settled promise, so "dedup"
 *       dedupes nothing                    -> section H2 goes red
 *   b3  dropping the central refusal to write an unloaded jsonb blob
 *                                          -> section H3 goes red
 *   b4  merging a jsonb blob into the cache instead of assigning it, so the
 *       cache shows keys the write deleted -> section I goes red
 * Expected: unmutated ALL PASS; b1 -> 5 failures, b2 -> 1, b3 -> 2, b4 -> 2.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTAL = process.argv[2] || join(__dirname, '..', 'public', 'client-portal.html');
const html = readFileSync(PORTAL, 'utf8');

// ── source extraction ──
function grab(name) {
  let i = html.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = html.indexOf('\nasync function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  i += 1;
  let k = html.indexOf('{', i), depth = 0;
  for (; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) break; }
  }
  return html.slice(i, k + 1);
}
function grabConst(name) {
  const i = html.indexOf('\nconst ' + name + ' =') + 1;
  if (!i) throw new Error('const not found: ' + name);
  const open = html.indexOf('[', i);
  let k = open, depth = 0;
  for (; k < html.length; k++) {
    if (html[k] === '[') depth++;
    else if (html[k] === ']') { depth--; if (!depth) break; }
  }
  return html.slice(i, k + 1) + ';';
}
const SELECT_COLS = html.match(/const CLIENT_SELECT_COLS = '[^']*';/)[0];

// ── stored row: a client with everything filled in ──
const STORED = {
  id: 'cid-1',
  business_name: 'Northside Hoops Academy',
  owner_name: 'Alex Carter',
  email: 'alex@northside.example',
  legal_name: 'NORTHSIDE HOOPS LLC',
  address: '123 Main St\nSuite 4\nToronto ON M4B 1B3',
  ein: '82-1234567',
  phone: '416-555-0134',
  tax_config: { label: 'HST', pct: 13 },
  brand_data: { color_primary: '#D4B65C', font_body: 'Inter', story: 'Founded 2011.', website_status: 'No website yet', site_pages: [{ slug: 'home' }] },
  kpi_data: { rev_30d: '42000', clients_active: '180' },
  contact_provider: 'ghl',
};

// ── update_client_basics, transcribed from the migration ──
const COALESCE_COLS = ['business_name', 'owner_name', 'email'];                              // '' ignored
const NULLIF_COLS = ['legal_name', 'address', 'phone', 'entity_type', 'ein', 'time_zone'];   // '' -> NULL
const JSONB_COLS = ['brand_data', 'kpi_data'];                                               // replaced wholesale
function applyRpc(row, patch) {
  for (const k of COALESCE_COLS) if (k in patch && patch[k] !== '' && patch[k] != null) row[k] = patch[k];
  for (const k of NULLIF_COLS) if (k in patch) row[k] = (patch[k] === '' || patch[k] == null) ? null : patch[k];
  for (const k of JSONB_COLS) if (k in patch) row[k] = patch[k] == null ? row[k] : patch[k];
  if ('tax_config' in patch) row.tax_config = patch.tax_config;
  return row;
}

// ── sandbox ──
let DOM = {}, rpcCalls = [], selectCalls = [], HYDRATION_OPEN = false, pending = [], requests = 0;
// The fetch resolves from SNAPSHOT: what the DB held when the request went out.
// Saves land in `db`. That is what makes a late response genuinely STALE.
let SNAPSHOT = STORED;
const g = {
  CLIENT_ID: 'cid-1',
  CLIENT_ROWS: [],
  _sb: {
    rpc: async (fn, args) => { rpcCalls.push({ fn, ...args }); return { error: null }; },
    from: () => ({
      select: (cols) => {
        selectCalls.push(cols);
        const chain = {
          eq: () => chain,
          // PostgREST builders are LAZY THENABLES: every .then() fires a fresh
          // request. Modelled faithfully so the dedup claim is actually tested.
          maybeSingle: () => ({
            then(onF, onR) {
              requests++;
              const out = { data: Object.fromEntries(cols.split(',').map(c => c.trim()).map(c => [c, SNAPSHOT[c]])), error: null };
              return new Promise((res, rej) => {
                const fire = () => { try { res(onF ? onF(out) : out); } catch (e) { rej(onR ? onR(e) : e); } };
                if (HYDRATION_OPEN) fire(); else pending.push(fire);   // held = still in flight
              });
            },
          }),
        };
        return chain;
      },
    }),
  },
  document: {
    getElementById: (id) => DOM[id] || null,
    querySelectorAll: () => [],
  },
  _obtScheduleRefresh: null,
  _bbAutoDone: () => {},
  _plToast: () => {},
  _bbRenderFromHash: () => {},
  _bbRenderWebsitePages: () => {},
  _bbRenderBrandBoard: () => {},
  _bbGenTaxNote: () => {},
  setTimeout: (fn) => { fn(); return 1; },      // debounced saves run immediately
  clearTimeout: () => {},
  console,
};
const src = [
  grab('_bbEscapeHtml'), grab('_bbEscapeAttr'), grab('_bbSaveClientBasics'),
  grabConst('_BB_GEN_COLS'), grabConst('_BB_WHOLESALE_COLS'), grabConst('_BB_KEEP_ON_BLANK'),
  grab('_bbDropUnloadedBlobs'),
  html.match(/const _BB_COL_INFLIGHT = \{\};/)[0],
  grab('_bbHydrateClientCols'), grab('_bbGuardBlanks'),
  'let _bbBasicsSaveTimer = null;', grab('_bbBasicsScheduleSave'),
  grab('_bbRenderGeneralCard'), grab('_bbGenHydrate'), grab('_bbGenChanged'),
  grab('_bbStaffOwnerChanged'), grab('_bbBrandHydrate'), grab('_bbBrandChanged'),
  grabConst('_BB_KPI_GROUPS'), grabConst('_BB_KPI_IDS'),
  grab('_bbKpisHydrate'), grab('_bbKpisChanged'),
  'return { _bbRenderGeneralCard, _bbGenHydrate, _bbGenChanged, _bbStaffOwnerChanged,' +
  ' _bbBrandHydrate, _bbBrandChanged, _bbKpisHydrate, _bbKpisChanged, _BB_KPI_IDS, _BB_GEN_COLS,' +
  ' _bbSaveClientBasics, _bbHydrateClientCols };',
].join('\n');
// Negative control: MUTATE=b1|b2|b3 reverts one fix in the extracted source, so
// the suite proves it FAILS without it rather than just passing with it.
const MUT = {
  b1: [/missing\.forEach\(k => \{ if \(!\(k in row\)\) row\[k\]/, 'missing.forEach(k => { row[k]'],
  b2: [/_BB_COL_INFLIGHT\[key\] = Promise\.resolve\(_sb/, '_BB_COL_INFLIGHT[key] = (_sb'],
  b3: [/patch = _bbDropUnloadedBlobs\(patch \|\| \{\}\);/, 'patch = (patch || {});'],
  b4: [/row\[k\] = patch\[k\] === '' \? null : patch\[k\];/,
       'row[k] = _BB_WHOLESALE_COLS.includes(k) ? { ...(row[k] || {}), ...patch[k] } : (patch[k] === \'\' ? null : patch[k]);'],
};
let srcFinal = src;
if (process.env.MUTATE) {
  // An UNKNOWN control name used to destructure `undefined` and die with a
  // TypeError. That exited non-zero, which is exactly what a caught control looks
  // like from the outside, so CI could not tell "this control bit" from "this
  // control does not exist". Say so explicitly instead, and do not print the
  // PASSED banner, so a stale name in the docs fails the build.
  if (!Object.prototype.hasOwnProperty.call(MUT, process.env.MUTATE)) {
    console.log('\n❌ NEGATIVE CONTROL FAILED: no control named ' + process.env.MUTATE
      + '. Known controls: ' + Object.keys(MUT).join(', '));
    process.exit(1);
  }
  const [re, rep] = MUT[process.env.MUTATE];
  if (!re.test(srcFinal)) {
    console.log('\n❌ NEGATIVE CONTROL FAILED: ' + process.env.MUTATE
      + ' target text has moved, so it reverts nothing. Re-point it at the fix it is meant to break.');
    process.exit(1);
  }
  srcFinal = srcFinal.replace(re, rep);
  console.log('!! MUTATED: ' + process.env.MUTATE + ' fix reverted\n');
}
const api = new Function(...Object.keys(g), srcFinal)(...Object.values(g));

// ── helpers ──
function bootRow() {                       // what boot() puts in CLIENT_ROWS
  const keys = SELECT_COLS.replace(/^const CLIENT_SELECT_COLS = '/, '').replace(/';$/, '')
    .split(',').map(s => s.trim());
  const out = {};
  for (const k of keys) if (k in STORED) out[k] = STORED[k];
  g.CLIENT_ROWS.length = 0; g.CLIENT_ROWS.push(out);
  return out;
}
function domFromHtml(markup, ids) {
  const dom = {};
  for (const id of ids) {
    let val = null;
    const inp = markup.match(new RegExp('<input id="' + id + '"[^>]*value="([^"]*)"'));
    if (inp) val = inp[1];
    const ta = markup.match(new RegExp('<textarea id="' + id + '"[^>]*>([\\s\\S]*?)</textarea>'));
    if (ta) val = ta[1];
    dom[id] = { value: (val || '').replace(/&#10;/g, '\n').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") };
  }
  return dom;
}
const flush = async () => {
  HYDRATION_OPEN = true; pending.splice(0).forEach(f => f());
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
};
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const GEN = ['business_name', 'legal_name', 'address', 'ein'];

console.log('card-scoped columns present in CLIENT_SELECT_COLS?',
  /legal_name|\bein\b|,\s*address/.test(SELECT_COLS) ? 'YES (wrong)' : 'no (correct)');

// ── A. cold open: save fires BEFORE hydration returns ──
console.log('\n── A. save fired mid-flight, before hydration lands ──');
HYDRATION_OPEN = false; pending = [];
bootRow();
const panel = { innerHTML: '' };
api._bbRenderGeneralCard(panel, { label: 'Business basics', desc: '' });
DOM = domFromHtml(panel.innerHTML, GEN.map(f => 'bb-gen-' + f));
check(DOM['bb-gen-legal_name'].value === '', 'legal_name renders empty before hydration (expected)');
DOM['bb-gen-business_name'].value = 'Northside Hoops Academy!';   // user types straight away
rpcCalls = [];
api._bbGenChanged();
const pA = rpcCalls[0]?.p_patch || {};
console.log('  patch:', JSON.stringify(pA));
check(!('legal_name' in pA) && !('address' in pA) && !('ein' in pA), 'unhydrated fields NOT written');
check(pA.business_name === 'Northside Hoops Academy!', 'the field the user typed IS written');
const afterA = applyRpc({ ...STORED }, pA);
check(afterA.legal_name === STORED.legal_name && afterA.address === STORED.address && afterA.ein === STORED.ein,
  'stored legal_name / address / ein untouched');

// ── B. hydration lands, then save ──
console.log('\n── B. hydration lands, then the same save ──');
await flush();
console.log('  card-scoped select:', JSON.stringify(selectCalls[0]));
for (const f of ['legal_name', 'address', 'ein']) {
  check(DOM['bb-gen-' + f].value === STORED[f], `${f} now shows the stored value`);
}
check(DOM['bb-gen-business_name'].value === 'Northside Hoops Academy!', 'in-flight typing not clobbered by hydration');
rpcCalls = [];
api._bbGenChanged();
const pB = rpcCalls[0]?.p_patch || {};
const afterB = applyRpc({ ...STORED }, pB);
for (const f of ['legal_name', 'address', 'ein']) check(afterB[f] === STORED[f], `${f} SURVIVES the save`);

// ── C. clearing a LOADED field still clears (no behaviour change) ──
console.log('\n── C. owner deliberately clears a loaded field ──');
DOM['bb-gen-legal_name'].value = '';
rpcCalls = [];
api._bbGenChanged();
const pC = rpcCalls[0]?.p_patch || {};
const afterC = applyRpc({ ...STORED }, pC);
check('legal_name' in pC && afterC.legal_name === null, 'legal_name cleared to NULL as asked');
check(afterC.ein === STORED.ein, 'ein untouched by that edit');

// ── D. staff card owner block (phone) ──
console.log('\n── D. staff card owner block, phone ──');
HYDRATION_OPEN = false; pending = [];
const rowD = bootRow();
DOM = { 'bb-owner-name': { value: STORED.owner_name }, 'bb-owner-email': { value: STORED.email },
        'bb-owner-phone': { value: rowD.phone || '' } };
rpcCalls = [];
api._bbStaffOwnerChanged();                       // fires before phone is loaded
const pD = rpcCalls[0]?.p_patch || {};
check(!('phone' in pD), 'phone not written while unhydrated');
check(applyRpc({ ...STORED }, pD).phone === STORED.phone, 'stored phone survives');
check(!('phone' in rowD), 'a dropped blank is NOT mirrored onto the row (no guard bypass)');
const hydD = api._bbGenHydrate();                 // the SAME shared loader
await flush(); await hydD;
DOM['bb-owner-phone'].value = rowD.phone || '';   // staff card renders from the row
rpcCalls = [];
api._bbStaffOwnerChanged();
check(rowD.phone === STORED.phone, 'phone reached the row via the shared load');
check(applyRpc({ ...STORED }, rpcCalls[0]?.p_patch || {}).phone === STORED.phone, 'phone survives after hydration');

// ── E. brand_data (jsonb, replaced wholesale) ──
console.log('\n── E. brand card ──');
HYDRATION_OPEN = false; pending = [];
bootRow();
DOM = {}; ['color_primary', 'color_secondary', 'color_accent', 'font_display', 'font_body', 'logo_dark_url',
  'logo_light_url', 'icon_url', 'website_url', 'domain', 'references', 'stats', 'notes', 'story',
  'why_us', 'dream_athletes', 'proof'].forEach(k => { DOM['bb-brand-' + k] = { value: '' }; });
const hydE = api._bbBrandHydrate();
rpcCalls = [];
DOM['bb-brand-color_primary'].value = '#FFF';
api._bbBrandChanged();
check(rpcCalls.length === 0, 'no save at all while brand_data is unloaded');
await flush(); await hydE;
check(DOM['bb-brand-story'].value === STORED.brand_data.story, 'brand story filled from the DB');
rpcCalls = [];
DOM['bb-brand-notes'].value = 'new note';
api._bbBrandChanged();
const afterE = applyRpc({ ...STORED, brand_data: { ...STORED.brand_data } }, rpcCalls[0]?.p_patch || {});
check(afterE.brand_data.story === STORED.brand_data.story, 'existing brand answers survive');
check(afterE.brand_data.website_status === STORED.brand_data.website_status, 'website_status (no input) survives');
check(Array.isArray(afterE.brand_data.site_pages), 'site_pages (no input) survives');
check(afterE.brand_data.notes === 'new note', 'the edit itself lands');

// ── F. kpi_data ──
console.log('\n── F. KPI card ──');
HYDRATION_OPEN = false; pending = [];
bootRow();
DOM = {}; api._BB_KPI_IDS.forEach(id => { DOM['bb-kpi-' + id] = { value: '' }; });
const hydF = api._bbKpisHydrate();
rpcCalls = [];
DOM['bb-kpi-rev_30d'].value = '1';
api._bbKpisChanged();
check(rpcCalls.length === 0, 'no save while kpi_data is unloaded');
await flush(); await hydF;
check(DOM['bb-kpi-clients_active'].value === STORED.kpi_data.clients_active, 'KPI values filled from the DB');
rpcCalls = [];
DOM['bb-kpi-rev_30d'].value = '43000';
api._bbKpisChanged();
const afterF = applyRpc({ ...STORED, kpi_data: { ...STORED.kpi_data } }, rpcCalls[0]?.p_patch || {});
check(afterF.kpi_data.clients_active === STORED.kpi_data.clients_active, 'other KPIs survive');
check(afterF.kpi_data.rev_30d === '43000', 'the edit itself lands');

// ── G. hydration FAILS (offline / RLS) - nothing may be written ──
console.log('\n── G. hydration errors out ──');
const realFrom = g._sb.from;
g._sb.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) });
bootRow();
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = { value: '' }; });
await api._bbGenHydrate();
rpcCalls = [];
DOM['bb-gen-business_name'].value = 'Renamed';
api._bbGenChanged();
const pG = rpcCalls[0]?.p_patch || {};
check(!('legal_name' in pG) && !('address' in pG) && !('ein' in pG), 'a failed load never marks fields as loaded');
check(applyRpc({ ...STORED }, pG).ein === STORED.ein, 'stored ein survives a failed load');
g._sb.from = realFrom;

// ── H1. CP 575 SCENARIO: hydration lands AFTER a save already succeeded ──
// The inverse of the race everything above tests, and the harder one to
// imagine. legal_name / ein are NULL in the DB, the card-scoped fetch is slow,
// the owner types both off their IRS CP 575 letter, the save succeeds - and
// only THEN does the stale response arrive carrying the pre-save NULLs. If the
// loader assigns unconditionally it resets the cache to NULL, the re-rendered
// card shows blank, and the next keystroke in any field persists that blank.
// These are the exact three columns Twilio TrustHub must match character for
// character off the CP 575, and Twilio allows three free resubmissions.
console.log('\n── H1. CP 575: stale hydration lands after a successful save ──');
HYDRATION_OPEN = false; pending = [];
SNAPSHOT = { ...STORED, legal_name: null, ein: null, address: null, phone: null, tax_config: null };
const db = { ...STORED, legal_name: null, ein: null, address: null };   // real stored state
const rowH = bootRow();
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = { value: '' }; });
const hydH = api._bbGenHydrate();                       // request goes out, held in flight
DOM['bb-gen-legal_name'].value = 'NORTHSIDE HOOPS LLC'; // typed off the IRS letter
DOM['bb-gen-ein'].value = '82-1234567';
rpcCalls = [];
api._bbGenChanged();
applyRpc(db, rpcCalls[0]?.p_patch || {});               // the save lands in the DB
check(db.legal_name === 'NORTHSIDE HOOPS LLC' && db.ein === '82-1234567', 'typed values saved');
await flush(); await hydH;                              // NOW the stale response arrives
check(rowH.legal_name === 'NORTHSIDE HOOPS LLC', 'stale response did NOT reset cached legal_name');
check(rowH.ein === '82-1234567', 'stale response did NOT reset cached ein');
const panelH = { innerHTML: '' };
api._bbRenderGeneralCard(panelH, { label: 'x', desc: '' });   // card re-renders from the cache
DOM = domFromHtml(panelH.innerHTML, GEN.map(f => 'bb-gen-' + f));
check(DOM['bb-gen-legal_name'].value === 'NORTHSIDE HOOPS LLC', 're-rendered card still shows the legal name');
check(DOM['bb-gen-ein'].value === '82-1234567', 're-rendered card still shows the EIN');
rpcCalls = [];
DOM['bb-gen-business_name'].value = 'Northside Hoops Academy!';   // next keystroke, any field
api._bbGenChanged();
applyRpc(db, rpcCalls[0]?.p_patch || {});
check(db.legal_name === 'NORTHSIDE HOOPS LLC' && db.ein === '82-1234567',
  'next keystroke does NOT NULL them');
SNAPSHOT = STORED;

// ── H2. dedup actually dedups (lazy thenable, one request for two callers) ──
console.log('\n── H2. two concurrent callers, one request ──');
HYDRATION_OPEN = false; pending = []; requests = 0;
bootRow();
const c1 = api._bbHydrateClientCols(['brand_data']);
const c2 = api._bbHydrateClientCols(['brand_data']);
await flush(); await c1; await c2;
check(requests === 1, `one request issued for two concurrent callers (saw ${requests})`);

// ── H3. structural: an unloaded jsonb blob cannot be written at all ──
console.log('\n── H3. save a wholesale blob that never loaded ──');
bootRow();
rpcCalls = [];
const okH3 = await api._bbSaveClientBasics({ brand_data: { color_primary: '#FFF' } });
check(rpcCalls.length === 0, 'no RPC fired for an unloaded brand_data (guard is central, not per card)');
rpcCalls = [];
await api._bbSaveClientBasics({ kpi_data: { rev_30d: '1' }, business_name: 'Still saves' });
const pH3 = rpcCalls[0]?.p_patch || {};
check(!('kpi_data' in pH3), 'unloaded kpi_data dropped from a mixed patch');
check(pH3.business_name === 'Still saves', 'the rest of the mixed patch still saves');

// ── I. the cache mirror must copy what the RPC ACTUALLY did ──
// Presence-on-the-row is the loaded signal, so a mirror that disagrees with the
// database hands every guard above a wrong answer. Covers EVERY wholesale
// column, not just brand_data: the RPC replaces them, so the mirror assigns -
// a merge would leave keys in the cache that the write just deleted.
console.log('\n── I. cached row mirrors the write exactly ──');
HYDRATION_OPEN = true;
for (const col of ['brand_data', 'kpi_data']) {
  const rowI = bootRow();
  rowI[col] = { keep_me: 'yes', drop_me: 'also yes' };        // loaded
  await api._bbSaveClientBasics({ [col]: { keep_me: 'yes' } });   // wholesale replace
  check(JSON.stringify(rowI[col]) === JSON.stringify({ keep_me: 'yes' }),
    `${col}: cache matches the wholesale write, no merged-in ghost keys`);
}
const rowI2 = bootRow();
rowI2.legal_name = 'OLD LEGAL LLC';
await api._bbSaveClientBasics({ legal_name: '', business_name: '' });
check(rowI2.legal_name === null, 'blank legal_name mirrored as NULL (RPC NULLIFs it)');
check(rowI2.business_name === STORED.business_name,
  'blank business_name leaves the cache alone (RPC COALESCEs it)');

console.log(fails ? `\nRESULT: ${fails} FAILURE(S)` : '\nRESULT: ALL PASS');

// Under a control, report in the SAME language as the api/_*.test.mjs suites, so
// CI can apply one rule everywhere: a control counts as caught only if the run
// SAYS it was caught. Exit status alone cannot carry that, because this script
// also exits non-zero when a control is missing or its target has moved.
if (process.env.MUTATE) {
  console.log(fails
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${process.env.MUTATE} was caught by ${fails} assertion(s).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${process.env.MUTATE} reverted a fix and every assertion still passed. That control is decorative.`);
  process.exit(fails ? 0 : 1);
}
process.exit(fails ? 1 : 0);
