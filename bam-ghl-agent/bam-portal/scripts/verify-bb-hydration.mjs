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
 * supabase/migrations/20260729T230000_clients_tagline_instagram.sql (the CURRENT full
 * whitelist - a superset of 20260729T210000, which supersedes 20260725033015 and
 * 20260727140000) - so if that function's SQL changes, update applyRpc to match or
 * these tests are checking the wrong contract.
 *
 * NEGATIVE CONTROL - the part that proves the suite has teeth
 * MUTATE=b1..b10 reverts one fix in the extracted source before running, so you can
 * confirm the suite FAILS without it rather than trusting that it passes with it.
 * Every one is a real regression: four caught in review, three from the business/owner
 * email split, two from the email footer pair:
 *   b1  the loader assigning unconditionally, so a stale response resets a
 *       value a save had just established  -> section H1 goes red
 *   b2  storing the lazy builder instead of a settled promise, so "dedup"
 *       dedupes nothing                    -> section H2 goes red
 *   b3  dropping the central refusal to write an unloaded jsonb blob
 *                                          -> section H3 goes red
 *   b4  merging a jsonb blob into the cache instead of assigning it, so the
 *       cache shows keys the write deleted -> section I goes red
 *   b5  business_email left out of the blank-guard list, so a save before the
 *       load NULLs the academy's public email - which does not degrade its
 *       emails, it HOLDS them              -> sections A, B, N go red
 *   b6  no per-column retry, so ONE column whose migration is not applied yet
 *       400s the batch and freezes every other field on the card as unloaded
 *                                          -> section N goes red
 *   b7  the rating patch allowed to send half a pair, which the pair constraint
 *       rejects - aborting the whole UPDATE and losing whatever else was in it
 *                                          -> section K goes red
 *   b8  tagline left out of the blank-guard list, so a save before the load NULLs the
 *       academy's email-footer tagline     -> section O goes red
 *   b9  the same for instagram_url, which removes the footer Instagram link
 *                                          -> section O goes red
 *   b10 locations.entry_note left out of the VENUE blank-guard list, so a save fired
 *       before that row loaded - or against a database that has not run the
 *       entry_note migration - NULLs the venue's entry directions, which is a parent
 *       standing outside a building with no idea which door
 *                                          -> section P goes red
 * b8 and b9 are the QUIET pair: unlike b5 nothing holds and nobody is told, the emails
 * just go out two footer elements shorter. Each control drops one name and leaves the
 * other, so neither can pass on the other's assertions.
 * b10 is the first control on a table OTHER than clients. The Locations card writes
 * PostgREST directly instead of going through update_client_basics, so it has its own
 * guard and its own list - but the same invariant and the same one "loaded" signal:
 * presence of the key on the cached row.
 * Measured 2026-07-29, unmutated ALL PASS; b1 -> 5 failures, b2 -> 1, b3 -> 2,
 * b4 -> 2, b5 -> 5, b6 -> 4, b7 -> 1, b8 -> 4, b9 -> 4.
 * Measured 2026-07-30: b10 -> 1.
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
  // The OWNER's inbox. Kept here precisely so the checks below can prove it is not
  // what any public field falls back to.
  email: 'alex@northside.example',
  // The ACADEMY's public email: footer contact line, {{SUPPORT_EMAIL}} and the
  // unsubscribe destination on every automation email. A blank written over this
  // does not degrade the email, it HOLDS every send the academy makes.
  business_email: 'info@northside.example',
  email_domain: 'northside.example',
  // The two facts that finish the black footer of every automation email. Blanked over,
  // the emails keep sending and just come out shorter - which is why they are here:
  // section O proves a save cannot do that before they have loaded.
  tagline: 'Youth basketball training on the north side.',
  instagram_url: 'https://instagram.com/northsidehoops',
  google_rating: '4.9',
  google_review_count: 67,
  google_rating_checked_at: '2026-07-29T18:38:11.990Z',
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
// '' -> NULL. business_email joined this list in 20260729T210000: a blank CLEARS it,
// which is a real choice ("we have no public address yet") and is why a blank written
// before the load lands is so expensive - it holds every automation email. tagline and
// instagram_url joined in 20260729T230000, same CLEARS-on-blank rule.
const NULLIF_COLS = ['legal_name', 'address', 'phone', 'entity_type', 'ein', 'time_zone',
  'business_email', 'tagline', 'instagram_url'];
const JSONB_COLS = ['brand_data', 'kpi_data'];                                               // replaced wholesale
function applyRpc(row, patch) {
  for (const k of COALESCE_COLS) if (k in patch && patch[k] !== '' && patch[k] != null) row[k] = patch[k];
  for (const k of NULLIF_COLS) if (k in patch) row[k] = (patch[k] === '' || patch[k] == null) ? null : patch[k];
  for (const k of JSONB_COLS) if (k in patch) row[k] = patch[k] == null ? row[k] : patch[k];
  if ('tax_config' in patch) row.tax_config = patch.tax_config;
  applyRatingTriple(row, patch);
  return row;
}
// The google_rating triple, transcribed from the same migration. The three columns
// move TOGETHER or not at all: clients_google_rating_pair_check refuses a half, and
// a constraint violation would abort the whole UPDATE, so the function ignores a
// half instead and the rest of the patch still lands. The date is STAMPED when the
// writer omits it, and cleared when the pair is cleared.
function applyRatingTriple(row, patch) {
  const both = ('google_rating' in patch) && ('google_review_count' in patch);
  const blank = (v) => v === '' || v == null;
  const r = blank(patch.google_rating) ? null : patch.google_rating;
  const c = blank(patch.google_review_count) ? null : patch.google_review_count;
  if (!both || (r === null) !== (c === null)) return;      // half: stored values kept
  row.google_rating = r;
  row.google_review_count = c;
  row.google_rating_checked_at = r === null
    ? null
    : (blank(patch.google_rating_checked_at) ? 'STAMPED-BY-DB' : patch.google_rating_checked_at);
}

// ── sandbox ──
let DOM = {}, rpcCalls = [], selectCalls = [], HYDRATION_OPEN = false, pending = [], requests = 0;
// The locations table is written DIRECTLY (PostgREST update), not through the
// clients RPC, so it needs its own recorder. UPDATE_ERROR is how section P plays
// "the migration has not been applied yet" without a database.
let updateCalls = [], UPDATE_ERROR = null;
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
      update: (patch) => {
        const call = { patch, eqs: [] };
        const chain = {
          eq: (k, v) => { call.eqs.push([k, v]); return chain; },
          then(onF, onR) {
            updateCalls.push(call);
            const out = { data: null, error: UPDATE_ERROR };
            return new Promise((res, rej) => {
              try { res(onF ? onF(out) : out); } catch (e) { rej(onR ? onR(e) : e); }
            });
          },
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
  _assetBankHtml: () => '<!-- assets -->',
  _bbAutoDone: () => {},
  _plToast: () => {},
  _bbRenderFromHash: () => {},
  _bbRenderWebsitePages: () => {},
  _bbRenderBrandBoard: () => {},
  _bbGenTaxNote: () => {},
  _bbGenTaxChanged: () => {},
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
  // The public-email + Google-reading block. Grabbed for REAL, not stubbed: the copy
  // these produce is the honesty guarantee ("Google showed 4.9 ... on 29 Jul", never
  // "Google rating: 4.9"), and a stub would let that rot while the suite stayed green.
  grab('_bbGenEmailNote'), grab('_bbGenGoogleNote'), grab('_bbGenShortDate'),
  'let _bbGenRatingSaveTimer = null;', grab('_bbGenRatingChanged'), grab('_bbGenRatingPatch'),
  grab('_bbStaffOwnerChanged'), grab('_bbBrandHydrate'), grab('_bbBrandChanged'),
  grabConst('_BB_KPI_GROUPS'), grabConst('_BB_KPI_IDS'),
  grab('_bbKpisHydrate'), grab('_bbKpisChanged'),
  // The Locations card. Same hydrate-then-save contract, different table: these
  // write PostgREST directly instead of the clients RPC, and _bbLocations is the
  // cache that stands in for CLIENT_ROWS. Section P.
  'let _bbLocations = [];', grab('_bbLocationById'),
  grabConst('_BB_LOC_GUARDED_COLS'), grab('_bbLocGuardBlanks'),
  'const _bbLocSaveTimers = {};', grab('_bbLocFieldChanged'), grab('_bbSaveLocationField'),
  grab('_bbRenderLocationsListInPanel'),
  'return { _bbRenderGeneralCard, _bbGenHydrate, _bbGenChanged, _bbStaffOwnerChanged,' +
  ' _bbBrandHydrate, _bbBrandChanged, _bbKpisHydrate, _bbKpisChanged, _BB_KPI_IDS, _BB_GEN_COLS,' +
  ' _bbSaveClientBasics, _bbHydrateClientCols, _bbGenEmailNote, _bbGenGoogleNote,' +
  ' _bbGenRatingChanged, _bbGenRatingPatch,' +
  ' _BB_LOC_GUARDED_COLS, _bbLocFieldChanged, _bbSaveLocationField,' +
  ' _bbRenderLocationsListInPanel, setLocations: (rows) => { _bbLocations = rows; } };',
].join('\n');
// Negative control: MUTATE=b1|b2|b3 reverts one fix in the extracted source, so
// the suite proves it FAILS without it rather than just passing with it.
const MUT = {
  b1: [/missing\.forEach\(k => \{ if \(!\(k in row\)\) row\[k\]/, 'missing.forEach(k => { row[k]'],
  b2: [/_BB_COL_INFLIGHT\[key\] = Promise\.resolve\(_sb/, '_BB_COL_INFLIGHT[key] = (_sb'],
  b3: [/patch = _bbDropUnloadedBlobs\(patch \|\| \{\}\);/, 'patch = (patch || {});'],
  b4: [/row\[k\] = patch\[k\] === '' \? null : patch\[k\];/,
       'row[k] = _BB_WHOLESALE_COLS.includes(k) ? { ...(row[k] || {}), ...patch[k] } : (patch[k] === \'\' ? null : patch[k]);'],
  // Re-pointed when tagline + instagram_url joined the guard list: the array no longer
  // ENDS at business_email, so the old `...'business_email']));` anchor matched nothing.
  // The script fails loudly on a moved target rather than silently reverting nothing,
  // which is how this was caught.
  b5: [/'public_name', 'business_email',/, "'public_name',"],
  b6: [/if \(\(missing \|\| \[\]\)\.length > 1\) \{/, 'if (false) {'],
  b7: [/if \(!isFinite\(count\) \|\| count < 0 \|\| String\(count\) !== cv\) return null;/, 'if (count < 0) return null;'],
  // The footer pair, one control each. Both target the same line and drop the OTHER
  // name, so each control leaves exactly one column unguarded - a single control
  // dropping both could pass on either one's assertions and hide the other.
  // The `));` is load-bearing: the identical pair of names also ends _BB_GEN_COLS, and a
  // non-global replace takes the FIRST match, which is that list. Anchoring on the call
  // close keeps these pointed at the GUARD list.
  b8: [/'tagline', 'instagram_url'\]\)\);/, "'instagram_url']));"],
  b9: [/'tagline', 'instagram_url'\]\)\);/, "'tagline']));"],
  // The venue entry note, on the locations table. Empties the guard list so a save
  // fired before the row loaded (or against a database that has not run the
  // entry_note migration) writes NULL over an owner's real entry directions.
  b10: [/const _BB_LOC_GUARDED_COLS = \['entry_note'\];/, "const _BB_LOC_GUARDED_COLS = [];"],
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
// A fake <input>. Assigning `value` COERCES to a string, exactly like a real
// HTMLInputElement does - and that matters here rather than being pedantry: the
// hydrate loop assigns straight off the row, and an integer review count would sit
// in an unfaithful double as a NUMBER, so card code that reads .value.trim() would
// throw against the test and work in a browser. A double that is easier to satisfy
// than the real thing is a suite testing something nobody ships.
function inputEl(initial = '') {
  let v = String(initial == null ? '' : initial);
  return { get value() { return v; }, set value(nv) { v = String(nv == null ? '' : nv); } };
}
function domFromHtml(markup, ids) {
  const dom = {};
  for (const id of ids) {
    let val = null;
    const inp = markup.match(new RegExp('<input id="' + id + '"[^>]*value="([^"]*)"'));
    if (inp) val = inp[1];
    const ta = markup.match(new RegExp('<textarea id="' + id + '"[^>]*>([\\s\\S]*?)</textarea>'));
    if (ta) val = ta[1];
    dom[id] = inputEl((val || '').replace(/&#10;/g, '\n').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }
  return dom;
}
const flush = async () => {
  HYDRATION_OPEN = true; pending.splice(0).forEach(f => f());
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
};
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const GEN = ['business_name', 'legal_name', 'address', 'ein', 'business_email',
  'tagline', 'instagram_url'];

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
check(!('business_email' in pA), 'unhydrated business_email NOT written (a blank HOLDS every automation email)');
check(pA.business_name === 'Northside Hoops Academy!', 'the field the user typed IS written');
const afterA = applyRpc({ ...STORED }, pA);
check(afterA.legal_name === STORED.legal_name && afterA.address === STORED.address && afterA.ein === STORED.ein,
  'stored legal_name / address / ein untouched');
check(afterA.business_email === STORED.business_email, 'stored business_email untouched');
// The whole point of the split: nothing public may borrow the owner's address.
check(afterA.business_email !== STORED.email, 'business_email is NOT the owner email');

// ── B. hydration lands, then save ──
console.log('\n── B. hydration lands, then the same save ──');
await flush();
console.log('  card-scoped select:', JSON.stringify(selectCalls[0]));
for (const f of ['legal_name', 'address', 'ein', 'business_email']) {
  check(DOM['bb-gen-' + f].value === STORED[f], `${f} now shows the stored value`);
}
check(DOM['bb-gen-business_name'].value === 'Northside Hoops Academy!', 'in-flight typing not clobbered by hydration');
rpcCalls = [];
api._bbGenChanged();
const pB = rpcCalls[0]?.p_patch || {};
const afterB = applyRpc({ ...STORED }, pB);
for (const f of ['legal_name', 'address', 'ein', 'business_email']) check(afterB[f] === STORED[f], `${f} SURVIVES the save`);

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
DOM = { 'bb-owner-name': inputEl(STORED.owner_name), 'bb-owner-email': inputEl(STORED.email),
        'bb-owner-phone': inputEl(rowD.phone || '') };
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
  'why_us', 'dream_athletes', 'proof'].forEach(k => { DOM['bb-brand-' + k] = inputEl(''); });
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
DOM = {}; api._BB_KPI_IDS.forEach(id => { DOM['bb-kpi-' + id] = inputEl(''); });
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
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = inputEl(''); });
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
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = inputEl(''); });
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

// ── J. the public email clears only when the owner means it ──
// Section A already proved a blank cannot be written before the load. The other half:
// once loaded, clearing it IS a real instruction and must clear. Empty does not mean
// "fall back to the owner email" - it means the academy has no public address, which
// holds its automation email. That is exactly why it cannot be written by accident.
console.log('\n── J. business email cleared deliberately, after loading ──');
HYDRATION_OPEN = false; pending = [];
bootRow();
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = inputEl(''); });
const hydJ = api._bbGenHydrate();
await flush(); await hydJ;
check(DOM['bb-gen-business_email'].value === STORED.business_email, 'business email hydrated');
DOM['bb-gen-business_email'].value = '';
rpcCalls = [];
api._bbGenChanged();
const pJ = rpcCalls[0]?.p_patch || {};
const afterJ = applyRpc({ ...STORED }, pJ);
check('business_email' in pJ && afterJ.business_email === null, 'a loaded business email clears to NULL as asked');
check(afterJ.email === STORED.email, 'clearing the PUBLIC email does not touch the OWNER email');

// ── K. the Google rating triple ──
// Three columns, one human fact, and a database that refuses half of it. A half-set
// patch would abort the whole UPDATE - taking the unrelated field the owner was
// editing in the same keystroke with it - and surface a raw constraint error in the
// portal. So a half must never leave the browser.
console.log('\n── K. Google rating: three columns, one fact ──');
HYDRATION_OPEN = false; pending = [];
const rowK = bootRow();
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = inputEl(''); });
DOM['bb-gen-google_rating'] = inputEl('');
DOM['bb-gen-google_review_count'] = inputEl('');
DOM['bb-gen-google-note'] = { textContent: '' };
DOM['bb-gen-business_email-note'] = { textContent: '' };
DOM['bb-gen-tax_label'] = inputEl(''); DOM['bb-gen-tax_pct'] = inputEl('');
rpcCalls = [];
DOM['bb-gen-google_rating'].value = '4.9';                 // typed before the load lands
api._bbGenRatingChanged();
check(rpcCalls.length === 0, 'nothing saved while the rating columns are unloaded');
const hydK = api._bbGenHydrate();
await flush(); await hydK;
check(DOM['bb-gen-google_review_count'].value === String(STORED.google_review_count), 'review count hydrated');
rpcCalls = [];
DOM['bb-gen-google_rating'].value = '4.8';
DOM['bb-gen-google_review_count'].value = '';             // owner mid-edit: a HALF
api._bbGenRatingChanged();
check(rpcCalls.length === 0, 'a half-filled pair sends NOTHING (the DB would reject it)');
check(/both/i.test(DOM['bb-gen-google-note'].textContent), 'and the note says both are needed');
const halfPatch = { google_rating: '4.8', google_review_count: '' };   // if one ever slipped through
const afterHalf = applyRpc({ ...STORED }, halfPatch);
check(afterHalf.google_rating === STORED.google_rating && afterHalf.google_review_count === STORED.google_review_count,
  'and the RPC ignores a half rather than half-writing it');
rpcCalls = [];
DOM['bb-gen-google_review_count'].value = '71';
api._bbGenRatingChanged();
const pK = rpcCalls[0]?.p_patch || {};
check(pK.google_rating === '4.8' && pK.google_review_count === '71', 'a complete pair saves both');
check(typeof pK.google_rating_checked_at === 'string' && !isNaN(new Date(pK.google_rating_checked_at).getTime()),
  'the date is STAMPED by the writer, not typed by anyone');
const afterK = applyRpc({ ...STORED }, pK);
check(afterK.google_rating === '4.8' && String(afterK.google_review_count) === '71', 'the reading lands');
check(afterK.google_rating_checked_at === pK.google_rating_checked_at, 'stored with the date it was read');
rpcCalls = [];
DOM['bb-gen-google_rating'].value = ''; DOM['bb-gen-google_review_count'].value = '';
api._bbGenRatingChanged();
const pK2 = rpcCalls[0]?.p_patch || {};
const afterK2 = applyRpc({ ...STORED }, pK2);
check(afterK2.google_rating === null && afterK2.google_review_count === null && afterK2.google_rating_checked_at === null,
  'clearing both clears the date too (a date with no reading is worse than no date)');
rpcCalls = [];
DOM['bb-gen-google_rating'].value = '6';                  // out of range
DOM['bb-gen-google_review_count'].value = '71';
api._bbGenRatingChanged();
check(rpcCalls.length === 0, 'a rating outside 1.0-5.0 is not sent (the DB constraint would abort the patch)');

// ── L. the copy itself: a dated reading, never a current figure ──
// This is the honesty guarantee, and it lives in a string, so it is asserted like
// one. A number we could have fetched reads as current unless the sentence says when
// it was read.
console.log('\n── L. the rating reads as a READING ON A DATE ──');
DOM['bb-gen-google_rating'].value = String(STORED.google_rating);
DOM['bb-gen-google_review_count'].value = String(STORED.google_review_count);
api._bbGenGoogleNote();
const noteL = DOM['bb-gen-google-note'].textContent;
console.log('  note:', noteL);
check(/Google showed/.test(noteL), 'it says GOOGLE SHOWED, not "your rating is"');
check(/29 Jul/.test(noteL), 'it names the date the figure was read');
check(/4\.9/.test(noteL) && /67 reviews/.test(noteL), 'it reports the rating and the count together');
check(!/^Google rating:/.test(noteL) && !/verified/i.test(noteL), 'it never presents itself as current or verified');

// ── M. the business email note tells the truth about what is wired ──
console.log('\n── M. what the business email note claims ──');
const rowM = (g.CLIENT_ROWS || []).find(r => r.id === 'cid-1') || {};
DOM['bb-gen-business_email'].value = '';
api._bbGenEmailNote();
check(/HELD|held/.test(DOM['bb-gen-business_email-note'].textContent),
  'empty says the emails are HELD, not that we will use something else');
check(!/owner/i.test(DOM['bb-gen-business_email-note'].textContent.replace(/personal owner address/i, '')),
  'and it never offers the owner address as a stand-in');
DOM['bb-gen-business_email'].value = 'info@northside.example';
api._bbGenEmailNote();
const noteM = DOM['bb-gen-business_email-note'].textContent;
console.log('  note:', noteM);
check(/Sending is set up/.test(noteM), 'a domain that matches the sending domain says sending is set up');
check(/replies/i.test(noteM) && !/verified/i.test(noteM),
  'and it says the REPLY half is unchecked rather than implying the address is verified');
DOM['bb-gen-business_email'].value = 'hello@someotherdomain.com';
api._bbGenEmailNote();
check(/someotherdomain\.com/.test(DOM['bb-gen-business_email-note'].textContent)
  && /northside\.example/.test(DOM['bb-gen-business_email-note'].textContent),
  'a mismatch names both domains instead of failing silently');
check(rowM.email_domain === STORED.email_domain, 'email_domain is read only, never written back');

// ── N. one un-applied column may not freeze the whole card ──
// _BB_GEN_COLS is fetched as ONE select. Name a column whose migration has not been
// applied and PostgREST 400s the whole thing, which would leave legal name, address
// and EIN permanently unloaded - and an unloaded field is one the owner cannot edit
// or clear. The loader falls back to one column at a time: what exists loads, what
// does not stays ABSENT, which is what keeps the blank guards holding for it.
console.log('\n── N. a column that does not exist yet ──');
const PENDING_COL = 'business_email';   // exactly the state of prod before the migration
const realFrom2 = g._sb.from;
let singleSelects = 0;
g._sb.from = () => ({
  select: (cols) => {
    const list = cols.split(',').map(s => s.trim());
    if (list.length === 1) singleSelects++;
    const chain = {
      eq: () => chain,
      maybeSingle: async () => list.includes(PENDING_COL)
        ? { data: null, error: { message: `column clients.${PENDING_COL} does not exist` } }
        : { data: Object.fromEntries(list.map(c => [c, SNAPSHOT[c]])), error: null },
    };
    return chain;
  },
});
const rowN = bootRow();
DOM = {}; GEN.forEach(f => { DOM['bb-gen-' + f] = inputEl(''); });
DOM['bb-gen-google_rating'] = inputEl(''); DOM['bb-gen-google_review_count'] = inputEl('');
DOM['bb-gen-google-note'] = { textContent: '' }; DOM['bb-gen-business_email-note'] = { textContent: '' };
DOM['bb-gen-tax_label'] = inputEl(''); DOM['bb-gen-tax_pct'] = inputEl('');
await api._bbGenHydrate();
check(singleSelects > 1, `the batch failure retried column by column (${singleSelects} single-column selects)`);
check(rowN.legal_name === STORED.legal_name, 'legal_name still loaded despite the un-applied column');
check(DOM['bb-gen-ein'].value === STORED.ein, 'EIN still reached the screen');
check(!(PENDING_COL in rowN), 'the un-applied column stays ABSENT from the row');
rpcCalls = [];
DOM['bb-gen-business_name'].value = 'Renamed again';
api._bbGenChanged();
const pN = rpcCalls[0]?.p_patch || {};
check(!(PENDING_COL in pN), 'so a save still refuses to write it');
check(pN.legal_name === STORED.legal_name, 'while the columns that DID load save normally');
g._sb.from = realFrom2;

// ── O. the email footer pair: tagline + instagram_url ──
// The same hydrate-then-save contract as business_email, and it is here because the
// FAILURE MODE IS QUIETER, not louder. A blanked business_email HOLDS every automation
// email and texts the owner. A blanked tagline or Instagram link changes nothing an
// owner would notice: the emails keep going out, two elements shorter, and the only
// signal is a footer nobody is looking at. Silent damage needs the guard MORE, not
// less, so both columns are in _BB_GEN_COLS and in the blank-guard list, and this
// section is what says so. MUTATE=b8 / MUTATE=b9 drop one each from that list.
console.log('\n── O. email footer tagline + Instagram ──');
HYDRATION_OPEN = false; pending = [];
bootRow();
const panelO = { innerHTML: '' };
api._bbRenderGeneralCard(panelO, { label: 'Business basics', desc: '' });
DOM = domFromHtml(panelO.innerHTML, GEN.map(f => 'bb-gen-' + f));
DOM['bb-gen-business_email-note'] = { textContent: '' };
DOM['bb-gen-google-note'] = { textContent: '' };
DOM['bb-gen-google_rating'] = inputEl(''); DOM['bb-gen-google_review_count'] = inputEl('');
DOM['bb-gen-tax_label'] = inputEl(''); DOM['bb-gen-tax_pct'] = inputEl('');
// The card has to actually SHOW them, or there is nothing for an owner to fix and the
// columns are write-only. Asserted off the rendered markup, not off a hand-built DOM.
check(/id="bb-gen-tagline"/.test(panelO.innerHTML), 'the card renders a tagline input');
check(/id="bb-gen-instagram_url"/.test(panelO.innerHTML), 'the card renders an Instagram input');
check(api._BB_GEN_COLS.includes('tagline') && api._BB_GEN_COLS.includes('instagram_url'),
  'and both are in the card-scoped load, so they hydrate at all');
const hydO = api._bbGenHydrate();                       // in flight, held
rpcCalls = [];
DOM['bb-gen-business_name'].value = 'Northside Hoops Academy!';   // owner types elsewhere
api._bbGenChanged();
const pO = rpcCalls[0]?.p_patch || {};
console.log('  patch:', JSON.stringify(pO));
check(!('tagline' in pO), 'unhydrated tagline NOT written');
check(!('instagram_url' in pO), 'unhydrated instagram_url NOT written');
const afterO = applyRpc({ ...STORED }, pO);
check(afterO.tagline === STORED.tagline, 'stored tagline survives a save fired mid-flight');
check(afterO.instagram_url === STORED.instagram_url, 'stored Instagram link survives it too');
await flush(); await hydO;
check(DOM['bb-gen-tagline'].value === STORED.tagline, 'tagline hydrated onto the screen');
check(DOM['bb-gen-instagram_url'].value === STORED.instagram_url, 'Instagram link hydrated too');
rpcCalls = [];
api._bbGenChanged();
const afterO2 = applyRpc({ ...STORED }, rpcCalls[0]?.p_patch || {});
check(afterO2.tagline === STORED.tagline && afterO2.instagram_url === STORED.instagram_url,
  'both SURVIVE a save made after the load landed');
// The other half, same as business_email: once loaded, clearing IS an instruction.
DOM['bb-gen-tagline'].value = '';
DOM['bb-gen-instagram_url'].value = '';
rpcCalls = [];
api._bbGenChanged();
const pO2 = rpcCalls[0]?.p_patch || {};
const afterO3 = applyRpc({ ...STORED }, pO2);
check('tagline' in pO2 && afterO3.tagline === null, 'a loaded tagline clears to NULL as asked');
check('instagram_url' in pO2 && afterO3.instagram_url === null, 'and so does the Instagram link');

// ── P. the venue entry note (locations.entry_note) ──
// A different table, the same contract, and the first field on this card that an
// owner edits in place. The morning-of trial confirmation used to end with a
// hardcoded sentence describing BAM GTA's Linbrook door, sent by every academy on a
// SHARED automation step; it now renders from this column on the venue the family is
// actually booked into. Which makes a blank here expensive in a new way: NULL does
// not degrade the message, it deletes a real instruction a parent needs on the
// morning they are standing outside a building.
//
// Two reasons a blank can be written by accident, and both are guarded the same way:
//   - the row has not loaded yet (_bbLoadLocations is the hydration path), or
//   - the entry_note migration (20260730T160000) has not been applied, so the key is
//     absent from every row this portal will ever cache.
// In both cases the key is ABSENT from the cached venue, and absent means we know
// nothing about it. MUTATE=b10 empties that guard list.
console.log('\n── P. venue entry note: per venue, never blanked before it loads ──');
const LOADED_VENUE = { id: 'loc-1', title: 'Linbrook', address: '1079 Linbrook Rd, Oakville, ON L6J 2L2',
  notes: 'Entrance is on the left side.', entry_note: 'The gym entrance we use is at the front of the building, on the left side.' };
const SECOND_VENUE = { id: 'loc-2', title: "Mildred's", address: '1080 Linbrook Rd, Oakville, ON L6J 2L1', notes: null, entry_note: null };
// The SAME venue as it looks before its column exists: no entry_note key at all.
const UNLOADED_VENUE = { id: 'loc-1', title: 'Linbrook', address: '1079 Linbrook Rd, Oakville, ON L6J 2L2', notes: 'Entrance is on the left side.' };

// P1. the owner can actually see and set it, per venue, off the REAL renderer.
api.setLocations([LOADED_VENUE, SECOND_VENUE]);
const listEl = { innerHTML: '' };
DOM = { 'bb-locations-list': listEl };
api._bbRenderLocationsListInPanel();
check(/id="bb-loc-entry_note-loc-1"/.test(listEl.innerHTML) && /id="bb-loc-entry_note-loc-2"/.test(listEl.innerHTML),
  'the card renders an entry-note box on EVERY venue, not one per academy');
check(listEl.innerHTML.includes('front of the building, on the left side'),
  "and it shows the venue's saved note, so an owner can correct it");
check(!/id="bb-loc-entry_note-loc-2"[^>]*>[^<]/.test(listEl.innerHTML),
  "a venue with no note renders an EMPTY box (Mildred's is a second door we know nothing about)");

// P2. the guard: unloaded key + blank box -> nothing goes to the wire at all.
api.setLocations([UNLOADED_VENUE]);
DOM = { 'bb-loc-entry_note-loc-1': inputEl('') };
updateCalls = []; UPDATE_ERROR = null;
api._bbLocFieldChanged('loc-1', 'entry_note');
for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
console.log('  updates sent:', JSON.stringify(updateCalls.map(c => c.patch)));
check(updateCalls.length === 0, 'a blank box over an UNLOADED entry_note sends no update at all');

// P3. and the guard is not just "never write": a typed value always saves.
DOM['bb-loc-entry_note-loc-1'].value = 'Use the side door by the parking lot.';
updateCalls = [];
api._bbLocFieldChanged('loc-1', 'entry_note');
for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
check(updateCalls.length === 1 && updateCalls[0].patch.entry_note === 'Use the side door by the parking lot.',
  'a note the owner actually typed still saves, unloaded or not');
check(updateCalls[0].eqs.some(([k]) => k === 'id') && updateCalls[0].eqs.some(([k]) => k === 'client_id'),
  'and it is scoped to one venue id AND one academy, so it cannot write across');

// P4. loaded + blank: clearing IS an instruction, exactly like the clients row.
api.setLocations([{ ...LOADED_VENUE }, { ...SECOND_VENUE }]);
DOM = { 'bb-loc-entry_note-loc-1': inputEl('') };
updateCalls = [];
api._bbLocFieldChanged('loc-1', 'entry_note');
for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
check(updateCalls.length === 1 && updateCalls[0].patch.entry_note === null,
  'a LOADED note clears to NULL when the owner means it');

// P5. the cache mirrors what the write did, and only for the venue written.
api.setLocations([{ ...LOADED_VENUE }, { ...SECOND_VENUE }]);
DOM = { 'bb-loc-entry_note-loc-1': inputEl('Ring the buzzer at the blue door.') };
updateCalls = []; UPDATE_ERROR = null;
await api._bbSaveLocationField('loc-1', 'entry_note', 'Ring the buzzer at the blue door.');
const listEl2 = { innerHTML: '' };
DOM['bb-locations-list'] = listEl2;
api._bbRenderLocationsListInPanel();
check(listEl2.innerHTML.includes('Ring the buzzer at the blue door.'), "venue 1's note updated in the cache");
check(!/id="bb-loc-entry_note-loc-2"[^>]*>[^<]/.test(listEl2.innerHTML),
  'and venue 2 is untouched - one academy, two doors, two facts');

// P6. the pre-migration failure is honest: the write fails, the cache does NOT
// pretend it landed. Otherwise the box would show a saved note that is not stored.
api.setLocations([{ ...LOADED_VENUE }]);
UPDATE_ERROR = { message: 'column "entry_note" of relation "locations" does not exist' };
const ok = await api._bbSaveLocationField('loc-1', 'entry_note', 'Side door.');
UPDATE_ERROR = null;
check(ok === false, 'a failed write reports failure');
const listEl3 = { innerHTML: '' };
DOM = { 'bb-locations-list': listEl3 };
api._bbRenderLocationsListInPanel();
check(listEl3.innerHTML.includes('front of the building') && !listEl3.innerHTML.includes('Side door.'),
  'and the cache still holds the STORED note, not the one the write failed to save');

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
