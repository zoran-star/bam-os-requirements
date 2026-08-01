// FullControl investor demo - build script
// Generates public/index.html from the CANONICAL client portal on every deploy,
// so the demo can never drift from the real product (the fullcontrol-investor
// stale-copy lesson, 2026-07-31). Never hand-edit the output.
//
// The generated page is the real client-portal.html with four patches:
//   1. Mock mode forced ON (the fixture academy IS the demo - no backend anywhere)
//   2. The parked FCUI pilot forced OFF (mock normally auto-ons it)
//   3. A network belt: fetch/XHR to real product hosts is blocked client-side
//      (the static host has no API routes anyway - belt AND suspenders)
//   4. Demo dressing: noindex, title, welcome overlay, persistent DEMO badge
//
// Run: node build.mjs   (no dependencies; Vercel runs it as the buildCommand)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'bam-ghl-agent', 'bam-portal', 'public', 'client-portal.html');
const OUT_DIR = join(here, 'public');

let html = readFileSync(SRC, 'utf8');
const patches = [];
function patch(name, from, to, { all = false } = {}) {
  const n = html.split(from).length - 1;
  if (n === 0) throw new Error(`PATCH FAILED (source drifted?): ${name}`);
  if (!all && n > 1) throw new Error(`PATCH AMBIGUOUS (${n} matches): ${name}`);
  html = html.split(from).join(to);
  patches.push(`${name} (${n})`);
}

// ── 1. Force mock mode: the whole gate IIFE becomes `true` ──
patch('force-mock-gate',
`window.__MOCK__ = (() => {
  try {
    if (new URLSearchParams(location.search).get('mock') !== '1') return false;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
      || /^(192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/.test(h);
  } catch (_) { return false; }
})();`,
`window.__MOCK__ = true; /* FC DEMO BUILD: fixture academy always on */`);

// ── 2. Parked FCUI pilot stays off (mock normally auto-ons it) ──
patch('fcui-off-in-demo',
`  return !!window.__MOCK__;
}
function _fcDesk()`,
`  return false; /* FC DEMO BUILD: pilot parked - V2 command center is the product */
}
function _fcDesk()`);

// ── 3. Network belt: block real product hosts client-side ──
// The static demo host has no API routes, but block by construction anyway.
const belt = `<script>/* FC DEMO BUILD: default-deny belt for real product hosts */
(function(){
  var BLOCK = /byanymeansbusiness\\.com|supabase\\.(co|com)|leadconnectorhq|gohighlevel|msgsndr/i;
  var of = window.fetch;
  window.fetch = function(input, init){
    try {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (BLOCK.test(u)) return Promise.resolve(new Response('{"error":"demo"}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    } catch (_) {}
    return of.apply(this, arguments);
  };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){
    try { if (BLOCK.test(String(u))) { arguments[1] = 'about:blank'; } } catch (_) {}
    return oo.apply(this, arguments);
  };
})();
</script>`;

// ── 4. Demo dressing ──
const DEMO_TITLE = '<title>FullControl Demo - A Fictional Academy, The Real Product</title>';
patch('title', /<title>[^<]*<\/title>/.exec(html)[0], DEMO_TITLE);
patch('noindex+belt', DEMO_TITLE, DEMO_TITLE + '\n<meta name="robots" content="noindex,nofollow">\n' + belt);

const overlay = `
<style>
#fcdemo-ov{position:fixed;inset:0;z-index:12000;background:rgba(20,18,12,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px}
#fcdemo-card{background:#FBFAF7;color:#1c1b18;border:1px solid rgba(28,27,24,.12);border-radius:16px;max-width:470px;width:100%;padding:30px 30px 24px;box-shadow:0 24px 70px rgba(0,0,0,.30);font-family:'Plus Jakarta Sans',system-ui,sans-serif}
#fcdemo-card .k{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#A8842C;margin-bottom:10px}
#fcdemo-card h2{font-size:22px;font-weight:800;margin:0 0 8px;line-height:1.25}
#fcdemo-card p{font-size:13.5px;line-height:1.6;color:rgba(28,27,24,.7);margin:0 0 14px}
#fcdemo-card ol{margin:0 0 18px;padding-left:20px}
#fcdemo-card li{font-size:13.5px;line-height:1.7;color:rgba(28,27,24,.8)}
#fcdemo-card li b{color:#1c1b18}
#fcdemo-go{display:block;width:100%;background:#C8A84E;color:#1c1b18;border:none;border-radius:999px;padding:13px 18px;font:inherit;font-size:14px;font-weight:800;cursor:pointer}
#fcdemo-go:hover{filter:brightness(1.05)}
#fcdemo-badge{position:fixed;left:14px;bottom:14px;z-index:11000;background:#1c1b18;color:#E8D48B;border-radius:999px;padding:7px 14px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
@media(max-width:560px){#fcdemo-badge{bottom:76px}}
</style>
<div id="fcdemo-ov" style="display:none">
  <div id="fcdemo-card">
    <div class="k">FullControl Demo</div>
    <h2>A fictional academy. The real product.</h2>
    <p>Northside Hoops Academy is seeded demo data. Every click is safe - nothing here is real, saved, or sent.</p>
    <ol>
      <li><b>Scroll the command center</b> - the whole business on one page.</li>
      <li><b>Open Sales, then Hawkeye</b> - the AI sales agent's approval deck.</li>
      <li><b>Approve the drafted reply</b> - that one tap is how owners run sales.</li>
    </ol>
    <button id="fcdemo-go" type="button">Start poking around</button>
  </div>
</div>
<div id="fcdemo-badge" title="About this demo">Demo &middot; fictional data</div>
<script>
(function(){
  var ov = document.getElementById('fcdemo-ov');
  var open = function(){ ov.style.display = 'flex'; };
  var close = function(){ ov.style.display = 'none'; try { sessionStorage.setItem('fcdemo_seen','1'); } catch(_){} };
  document.getElementById('fcdemo-go').addEventListener('click', close);
  ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
  document.getElementById('fcdemo-badge').addEventListener('click', open);
  var seen = false; try { seen = sessionStorage.getItem('fcdemo_seen') === '1'; } catch(_){}
  if (!seen) setTimeout(open, 900);
})();
</script>`;
patch('overlay', '</body>', overlay + '\n</body>');

// ── stamp + write ──
let hash = 'unknown';
try { hash = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim(); } catch (_) {}
html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n<!-- FC DEMO BUILD: generated from bam-ghl-agent/bam-portal/public/client-portal.html @ ${hash} on ${new Date().toISOString().slice(0, 10)}. DO NOT EDIT - edit the canonical file and rebuild. -->`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'index.html'), html);
writeFileSync(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('fc-demo built:', patches.join(' · '), `-> public/index.html (${(html.length / 1024 / 1024).toFixed(1)}MB)`);
