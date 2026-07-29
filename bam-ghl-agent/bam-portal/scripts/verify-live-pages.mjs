#!/usr/bin/env node
/**
 * Live Pages: grouping, dates, and the old-response fallback.
 *
 *     node bam-portal/scripts/verify-live-pages.mjs        # from bam-ghl-agent/
 *     MUTATE=m1|m2|m3 node bam-portal/scripts/verify-live-pages.mjs   # see below
 *
 * Plain node. No dependencies, no network. Exits 1 on failure.
 *
 * WHY THIS EXISTS
 * The tab lists an academy's live pages. A site can now publish /pages.json to say
 * how those pages should be grouped (Main pages / Sub pages / Funnels) and when
 * each last changed, and the portal renders a section per group. Three things can
 * silently break, and all three are invisible until a client opens the tab:
 *
 *   1. a page the site serves but the manifest omits must still be listed - the
 *      manifest orders and labels, it never decides what exists;
 *   2. every other academy has NO manifest, so a response with no groups must
 *      render exactly as it did before (one flat grid, no section headers);
 *   3. a page with no date, or a junk date, must show nothing rather than
 *      "Updated Invalid Date" in front of a paying client.
 *
 * HOW IT WORKS
 * Extracts the REAL merge/sort logic out of api/live-pages.js and the REAL render
 * out of public/client-portal.html, then runs both against fixtures and a fake DOM.
 *
 * NEGATIVE CONTROL - the part that proves the suite has teeth
 *   m1  manifest replaces the page list instead of leading it  -> B goes red
 *   m2  render never draws a section header                    -> C goes red
 *   m3  _lpWhen returns the raw value on a bad date            -> D goes red
 * Expected: unmutated ALL PASS; m1 -> 11 failures, m2 -> 2, m3 -> 2.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const html = readFileSync(join(ROOT, 'public', 'client-portal.html'), 'utf8');
let api = readFileSync(join(ROOT, 'api', 'live-pages.js'), 'utf8');
const MUTATE = (process.env.MUTATE || '').trim();

// ── source extraction ──
function grab(src, name) {
  let i = src.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = src.indexOf('\nasync function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  i += 1;
  let k = src.indexOf('{', i), depth = 0;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(i, k + 1);
}
function grabBlock(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('block start not found: ' + startMarker);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error('block end not found: ' + endMarker);
  return src.slice(i, j);
}

// ── the API's grouping + merge, run for real ──
const apiPieces = [
  api.match(/const GROUP_ORDER = \[[^\]]*\];/)[0],
  api.match(/const FUNNEL_PATHS = \/[^\n]*\/i;/)[0],
  api.match(/const FUNNEL_SUFFIX = \/[^\n]*\/i;/)[0],
  grab(api, 'guessGroup'),
  grab(api, 'orderGroups'),
  grab(api, 'labelFor'),
].join('\n');

// The merge + sort, lifted verbatim out of the handler.
let mergeSrc = grabBlock(api,
  '    // Rebuild every URL from the CURRENT base',
  '    res.setHeader("Cache-Control", "no-store");');
if (MUTATE === 'm1') {
  // The regression: treat the manifest as the whole list.
  mergeSrc = mergeSrc
    .replace(/for \(const p of seeded\) if \(!byPath\.has\(p\.path\)\)[^\n]*\n/, '')
    .replace(/for \(const p of live\) if \(!byPath\.has\(p\.path\)\)[^\n]*\n/, '');
}

const buildResponse = new Function('siteUrl', 'manifest', 'seeded', 'live', `
  ${apiPieces}
  ${mergeSrc}
  return { groups, pages };
`);

// ── the portal render, run for real against a fake DOM ──
let renderSrc = grab(html, 'openLivePagesView');
let whenSrc = grab(html, '_lpWhen');
if (MUTATE === 'm2') renderSrc = renderSrc.replace("const head = g === null ? '' :", "const head = true ? '' :");
if (MUTATE === 'm3') whenSrc = whenSrc.replace("if (isNaN(d.getTime())) return '';", 'if (isNaN(d.getTime())) return String(iso);');

function fakeDom() {
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, innerHTML: '', style: {}, scrollIntoView() {} });
  mk('livepages-content'); mk('lp-preview');
  return {
    getElementById: (id) => nodes[id] || null,
    querySelectorAll: () => [],
    nodes,
  };
}

async function render(data) {
  const doc = fakeDom();
  const sandbox = {
    document: doc,
    CLIENT_ID: 'cid-1',
    _LP_DATA: data,
    _LP_DEVICE: 'web',
    _LP_CURRENT: null,
    _bbEscapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    _mreqAuthToken: async () => 'tok',
    fetch: async () => ({ ok: true, json: async () => data }),
    _lpOpen: () => {},                 // preview is not what this file checks
    Date,
  };
  const fn = new Function('S', `
    with (S) {
      ${whenSrc}
      ${renderSrc}
      return openLivePagesView();
    }
  `);
  await fn(sandbox);
  return doc.nodes['livepages-content'].innerHTML;
}

// ── fixtures ──
const SITE = 'https://proprecision.com.au';
const PP_MANIFEST = [
  { path: '/', label: 'Home', group: 'Main pages', updated: '2026-07-28T18:53:27+08:00' },
  { path: '/academies', label: 'Academies', group: 'Main pages', updated: '2026-07-25T00:30:44+08:00' },
  { path: '/camps', label: 'Camps & Clinics', group: 'Main pages', updated: '2026-07-29T12:40:07+08:00' },
  { path: '/tryout-dominance', label: 'Tryout Dominance Camps', group: 'Sub pages', updated: '2026-07-29T12:52:27+08:00' },
  { path: '/marymede-flames', label: 'Marymede Flames x Pro Precision', group: 'Sub pages', updated: '2026-07-29T12:40:07+08:00' },
  { path: '/free-trial', label: 'Free Trial', group: 'Funnels', updated: '2026-07-26T10:06:11+08:00' },
];
// What the seed knows: the same site, plus a page the manifest forgot.
const PP_SEEDED = [
  { path: '/', url: `${SITE}/`, label: 'Home' },
  { path: '/contact', url: `${SITE}/contact`, label: 'Contact' },
  { path: '/shooting', url: `${SITE}/shooting`, label: 'Shooting' },
];

// ── harness ──
let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

// ── A. grouping order and the funnel guess ──
section('A. groups come back in a fixed order, funnels guessed only for known paths');
{
  const r = buildResponse(SITE, PP_MANIFEST, PP_SEEDED, []);
  ok(JSON.stringify(r.groups) === JSON.stringify(['Main pages', 'Sub pages', 'Website pages', 'Funnels']),
    'group order is Main, Sub, Website pages, Funnels', JSON.stringify(r.groups));
  const g = (p) => (r.pages.find((x) => x.path === p) || {}).group;   // may be missing under MUTATE
  ok(g('/contact') === 'Website pages', 'a seeded page with no manifest entry is a website page', g('/contact'));

  const noManifest = buildResponse(SITE, [], [
    { path: '/', url: `${SITE}/`, label: 'Home' },
    { path: '/free-trial', url: `${SITE}/free-trial`, label: 'Free Trial' },
    { path: '/enroll', url: `${SITE}/enroll`, label: 'Enroll' },
    { path: '/programs', url: `${SITE}/programs`, label: 'Programs' },
    { path: '/private-training-funnel', url: `${SITE}/private-training-funnel`, label: 'Private Training Funnel' },
  ], []);
  const gg = (p) => (noManifest.pages.find((x) => x.path === p) || {}).group;
  ok(gg('/free-trial') === 'Funnels' && gg('/enroll') === 'Funnels', 'a site with no manifest still separates its funnels');
  ok(gg('/private-training-funnel') === 'Funnels', 'a path the site itself named a funnel is grouped as one', gg('/private-training-funnel'));
  ok(gg('/programs') === 'Website pages' && gg('/') === 'Website pages', 'and does not guess a funnel out of an ordinary page');
}

// ── B. the manifest orders, it does not decide what exists ──
section('B. a page the site serves is never dropped because the manifest omits it');
{
  const r = buildResponse(SITE, PP_MANIFEST, PP_SEEDED, [{ path: '/newsletter', url: `${SITE}/newsletter`, label: 'Newsletter' }]);
  const paths = r.pages.map((p) => p.path);
  ok(paths.includes('/contact') && paths.includes('/shooting'), 'seeded pages missing from the manifest are still listed', paths.join(' '));
  ok(paths.includes('/newsletter'), 'a page found live but in neither list is still listed', paths.join(' '));
  ok(r.pages.length === 9, 'nine unique pages, nothing duplicated', String(r.pages.length));
  const mainOrder = r.pages.filter((p) => p.group === 'Main pages').map((p) => p.path);
  ok(JSON.stringify(mainOrder) === JSON.stringify(['/', '/academies', '/camps']), 'the manifest order is kept inside a group', mainOrder.join(' '));
  ok(r.pages.every((p) => p.url.startsWith(SITE)), 'every url is rebuilt from the current domain');
}

// ── C. render: grouped when grouped, flat when not ──
section('C. grouped sections when the API sends groups, old flat list when it does not');
{
  const grouped = buildResponse(SITE, PP_MANIFEST, PP_SEEDED, []);
  const out = await render({ enabled: true, site_url: SITE, manifest: true, groups: grouped.groups, pages: grouped.pages });
  const heads = ['Main pages', 'Sub pages', 'Website pages', 'Funnels'].map((g) => out.indexOf('>' + g + '<'));
  ok(heads.every((i) => i > -1), 'a header for every group', heads.join(','));
  ok(heads[0] < heads[1] && heads[1] < heads[2] && heads[2] < heads[3], 'headers in the API order', heads.join(','));
  ok((out.match(/data-lp-path=/g) || []).length === grouped.pages.length, 'one card per page', String((out.match(/data-lp-path=/g) || []).length));
  // 6 from the manifest + 3 seeded, and '/' is in both, so 8.
  ok(grouped.pages.length === 8 && out.includes('8 pages live'), 'the count reflects every page, manifest plus seeded', String(grouped.pages.length));

  const old = await render({
    enabled: true, site_url: SITE,
    pages: [{ path: '/', url: SITE, label: 'Home' }, { path: '/contact', url: `${SITE}/contact`, label: 'Contact' }],
  });
  ok(!/Main pages|Website pages/.test(old) && (old.match(/data-lp-path=/g) || []).length === 2,
    'an older response with no groups renders flat, exactly as before');
}

// ── D. dates ──
section('D. dates: readable, absent when unknown, never "Invalid Date"');
{
  const fn = new Function(`${whenSrc} return _lpWhen;`)();
  const day = 86400000;
  ok(fn(new Date().toISOString()) === 'today', 'today', fn(new Date().toISOString()));
  ok(fn(new Date(Date.now() - day).toISOString()) === 'yesterday', 'yesterday');
  ok(fn(new Date(Date.now() - 3 * day).toISOString()) === '3 days ago', '3 days ago');
  ok(/\w{3} \d/.test(fn(new Date(Date.now() - 30 * day).toISOString())), 'a real date once it is old', fn(new Date(Date.now() - 30 * day).toISOString()));
  ok(fn('not a date') === '', 'junk gives an empty string, so nothing renders', JSON.stringify(fn('not a date')));
  ok(fn(null) === '', 'null gives an empty string', JSON.stringify(fn(null)));

  const mixed = await render({
    enabled: true, site_url: SITE, manifest: true, groups: ['Main pages'],
    pages: [
      { path: '/', url: SITE, label: 'Home', group: 'Main pages', updated: new Date().toISOString() },
      { path: '/contact', url: `${SITE}/contact`, label: 'Contact', group: 'Main pages', updated: null },
      { path: '/bad', url: `${SITE}/bad`, label: 'Bad', group: 'Main pages', updated: 'whenever' },
    ],
  });
  ok((mixed.match(/Updated /g) || []).length === 1, 'only the page with a real date says Updated', String((mixed.match(/Updated /g) || []).length));
  ok(!/Invalid Date/.test(mixed), 'no "Invalid Date" anywhere');
  ok(/Last update today/.test(mixed), 'the header shows the newest change across the site');
}

// ── E. no em dash anywhere in what a client sees ──
section('E. no em dash in the new copy');
{
  const grouped = buildResponse(SITE, PP_MANIFEST, PP_SEEDED, []);
  const out = await render({ enabled: true, site_url: SITE, manifest: true, groups: grouped.groups, pages: grouped.pages });
  ok(!out.includes('—'), 'rendered output has no em dash');
}

console.log(`\nRESULT: ${fail ? `${fail} FAILED, ${pass} passed` : 'ALL PASS'}${MUTATE ? `  (MUTATE=${MUTATE})` : ''}`);
process.exit(fail ? 1 : 0);
