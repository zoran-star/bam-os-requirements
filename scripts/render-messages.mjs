// Render EVERY message an academy would send, through the REAL send path, and
// build the review page phase 6 of the email skills hands to staff.
//
// Not an approximation: it imports api/email-shells.js and mirrors how
// api/automations.js assembles `vars` at send time, so what renders is what the
// worker would hand to Twilio / Resend today.
//
// Parameterised by client. Was pinned to a BAM GTA const (render-gta-emails.mjs);
// this one takes any academy, so it doubles as the before/after verification
// surface for any preset change.
//
//   node scripts/render-messages.mjs --data snapshots/bam-gta.json
//   node scripts/render-messages.mjs --client <uuid>          (needs env)
//   node scripts/render-messages.mjs --name "BAM San Jose"    (needs env)
//   node scripts/render-messages.mjs --data ... --annotate scripts/annotations/bam-gta.mjs
//
// Env for live reads: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SERVICE_KEY). Read-only. Nothing here enables, approves or sends.
//
// A snapshot is {client, automations:[{automation_key,name,enabled,approved,steps:[...]}]}
// so the page can be rebuilt with no database access at all.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, resolveMergeVars, locFor, clientVars } from "../bam-ghl-agent/bam-portal/api/email-shells.js";
import { annotate } from "./lib/annotate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DATA_FILE = arg("--data");
const CLIENT_ID = arg("--client");
const NAME = arg("--name");
const OUT = path.resolve(ROOT, arg("--out") || "docs/plans/review");
// Optional: mark up every email so each run of text carries photocopy / swap / custom.
// Rules live beside the data they describe, e.g. scripts/annotations/bam-gta.mjs.
const ANNOTATE = arg("--annotate");

if (!DATA_FILE && !CLIENT_ID && !NAME) {
  console.error("usage: --data <snapshot.json> | --client <uuid> | --name \"BAM GTA\"");
  process.exit(2);
}

// ─── source ──────────────────────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(q) {
  const res = await fetch(`${SB_URL.replace(/\n/g, "")}/rest/v1/${q}`, {
    headers: { apikey: SB_KEY.replace(/\n/g, ""), Authorization: `Bearer ${SB_KEY.replace(/\n/g, "")}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return JSON.parse((await res.text()) || "null");
}

async function load() {
  if (DATA_FILE) return JSON.parse(fs.readFileSync(path.resolve(ROOT, DATA_FILE), "utf8"));
  if (!SB_URL || !SB_KEY) {
    console.error("live read needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Use --data <snapshot.json> instead.");
    process.exit(2);
  }
  const sel = "id,business_name,legal_name,owner_name,email,phone,address,time_zone,website_setup,brand_data";
  const rows = CLIENT_ID
    ? await sb(`clients?id=eq.${CLIENT_ID}&select=${sel}`)
    : await sb(`clients?business_name=eq.${encodeURIComponent(NAME)}&select=${sel}`);
  const client = rows && rows[0];
  if (!client) { console.error("no such client"); process.exit(1); }
  const autos = (await sb(`automations?client_id=eq.${client.id}&select=id,automation_key,name,enabled,approved`)) || [];
  const automations = [];
  for (const a of autos) {
    const steps = (await sb(`automation_steps?automation_id=eq.${a.id}&order=position.asc&select=position,wait_amount,wait_unit,channel,subject,body,enabled`)) || [];
    automations.push({ ...a, steps });
  }
  return { client, automations };
}

// ─── the sample family, so merge fields read like a real send ────────────────
const LEAD = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };

// ─── what an empty identity field silently drops ─────────────────────────────
// The one thing staff cannot see by reading the email: a block that vanished.
function missingFacts(client, L) {
  const out = [];
  const add = (what, why) => out.push({ what, why });
  if (!L.siteUrl) add("every website link and the free-trial CTA", "no domain on file");
  if (!L.instagram) add("footer Instagram link", "no instagram on file, and nothing collects one");
  if (!L.tagline) add("footer tagline", "no tagline on file, and nothing collects one");
  if (!L.email) add("footer email link and the unsubscribe", "no support email on file");
  if (!L.ownerFirst) add("the owner signature in Ghosted step 3", "no owner name on file");
  if (!client.phone) add("the coach contact line in the welcome email", "clients.phone is empty");
  return out;
}

// ─── render one step exactly as it would send ────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isEmail = (s) => String(s.channel || "").toLowerCase() === "email";
const ref = (key, i) => (key.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() + (i + 1));

function renderStep(step, i, ctx) {
  const { clientId, vars, key, specs } = ctx;
  const r = ref(key, i);
  if (isEmail(step)) {
    let html = renderEmail({ clientId, subject: step.subject || "", body: step.body || "", vars });
    if (specs) {
      // Match on the template key first (nurture-1), else "<automation>-<position>".
      const tref = String(step.body || "").match(/^\s*template:([\w/-]+)\s*$/);
      const spec = specs[tref ? tref[1] : `${key}-${i + 1}`];
      if (spec) html = annotate(html, spec).html;
    }
    return { r, kind: "email", subject: step.subject || "", html };
  }
  const L = ctx.L;
  const text = resolveMergeVars(String(step.body || ""), L, vars);
  return { r, kind: "sms", text };
}

// ─── page ────────────────────────────────────────────────────────────────────
const WAIT = (s) => {
  const n = Number(s.wait_amount || 0), u = String(s.wait_unit || "").replace(/s$/, "");
  return n === 0 ? "immediately" : `${n} ${u}${n === 1 ? "" : "s"}`;
};

function page(client, groups, missing) {
  const tabs = groups.map((g, i) =>
    `<button class="tab${i === 0 ? " on" : ""}" data-k="${esc(g.key)}">${esc(g.name || g.key)}</button>`).join("");

  const panels = groups.map((g, i) => {
    const rows = g.rendered.map((m, j) => {
      const st = g.steps[j];
      const inner = m.kind === "email"
        ? `<div class="mailwrap"><div class="mailbar"><span class="l">rendered exactly as it sends</span>
             <a href="msg/${esc(g.key)}-${j + 1}.html" target="_blank" rel="noopener">Open full size</a></div>
             <iframe src="msg/${esc(g.key)}-${j + 1}.html" loading="lazy" title="${esc(m.subject)}"></iframe></div>`
        : `<div class="bub">${esc(m.text)}</div>`;
      return `<div class="msg${st.enabled === false ? " off" : ""}">
        <div class="mh"><span class="rf">${m.r}</span><span class="wt">${WAIT(st)}</span>
          <span class="ch ${m.kind}">${m.kind.toUpperCase()}</span>
          ${m.subject ? `<span class="sj">${esc(m.subject)}</span>` : ""}
          ${st.enabled === false ? `<span class="dis">step disabled</span>` : ""}</div>
        <div class="mb">${inner}</div></div>`;
    }).join("");
    return `<div class="pan${i === 0 ? " on" : ""}" data-k="${esc(g.key)}">
      <div class="ph"><h2>${esc(g.name || g.key)}</h2>
        <span class="meta">${g.steps.length} step${g.steps.length === 1 ? "" : "s"} &middot;
        ${g.approved ? "approved" : "<b>dormant, not approved</b>"}</span></div>
      ${rows || '<div class="empty">No steps. This automation exists with zero steps, which is a broken seed.</div>'}
    </div>`;
  }).join("");

  const miss = missing.length
    ? `<div class="missing"><h3>Did not render, and why</h3>${missing.map(m =>
        `<div class="mrow"><b>${esc(m.what)}</b><span>${esc(m.why)}</span></div>`).join("")}</div>`
    : `<div class="missing ok"><h3>Nothing dropped</h3><div class="mrow"><span>Every identity field this academy needs is on file.</span></div></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(client.business_name)} - message review</title>
<style>
:root{--gold:#D4B65C;--bg:#0C0C0D;--card:#141416;--card2:#1A1A1D;--line:#2A2A2E;
--tx:#EDEDEF;--tx2:#A8A8B0;--tx3:#6E6E78;--red:#E5674E;--blue:#5B9DD9;--green:#5FBF8A;
--ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font-family:var(--ui);line-height:1.6}
.wrap{max-width:1000px;margin:0 auto;padding:30px 18px 80px}
h1{font-size:27px;margin:0 0 6px;font-weight:800;letter-spacing:-.02em}
.sub{color:var(--tx2);font-size:14.5px;margin:0 0 20px}
.sw{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);margin:0 -18px 18px;padding:11px 18px}
.swrow{display:flex;gap:6px;overflow-x:auto;padding-bottom:3px}
.tab{flex:none;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--tx2);
border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;font-family:var(--ui);white-space:nowrap}
.tab:hover{color:var(--tx)}
.tab.on{background:rgba(212,182,92,.13);border-color:var(--gold);color:var(--tx)}
.pan{display:none}.pan.on{display:block}
.ph{display:flex;align-items:baseline;gap:11px;flex-wrap:wrap;margin-bottom:13px}
.ph h2{margin:0;font-size:20px;font-weight:800}
.ph .meta{color:var(--tx3);font-size:12.5px}
.ph .meta b{color:var(--gold)}
.msg{background:var(--card);border:1px solid var(--line);border-radius:13px;overflow:hidden;margin-bottom:13px}
.msg.off{opacity:.55}
.mh{display:flex;align-items:center;gap:9px;padding:10px 14px;background:var(--card2);border-bottom:1px solid var(--line);flex-wrap:wrap}
.rf{font-family:var(--mono);font-size:11px;color:var(--bg);background:var(--gold);border-radius:5px;padding:1px 7px;font-weight:700}
.wt{font-family:var(--mono);font-size:11px;color:var(--gold)}
.ch{font-size:9.5px;letter-spacing:.1em;font-weight:700;padding:2px 7px;border-radius:4px}
.ch.sms{background:rgba(91,157,217,.15);color:var(--blue)}
.ch.email{background:rgba(212,182,92,.16);color:var(--gold)}
.sj{font-size:11.5px;color:var(--tx2);font-style:italic}
.dis{font-size:9.5px;text-transform:uppercase;font-weight:700;color:var(--red);
background:rgba(229,103,78,.14);border-radius:4px;padding:1px 7px;margin-left:auto}
.mb{padding:14px}
.bub{background:#25252A;border-radius:13px 13px 13px 4px;padding:12px 15px;font-size:13px;
white-space:pre-wrap;word-break:break-word;max-width:560px}
.mailwrap{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#EDEDEA}
.mailbar{display:flex;align-items:center;gap:9px;padding:7px 11px;background:var(--card2);border-bottom:1px solid var(--line)}
.mailbar .l{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--tx3);font-weight:700}
.mailbar a{margin-left:auto;font-size:11px;color:var(--gold);text-decoration:none;font-weight:600}
.mailwrap iframe{display:block;width:100%;height:480px;border:0;background:#EDEDEA}
.empty{background:rgba(229,103,78,.08);border:1px solid rgba(229,103,78,.3);border-radius:11px;padding:14px 16px;color:var(--tx2);font-size:13.5px}
.missing{background:var(--card2);border:1px solid var(--line);border-left:3px solid var(--red);border-radius:12px;padding:15px 18px;margin-top:26px}
.missing.ok{border-left-color:var(--green)}
.missing h3{margin:0 0 9px;font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--red);font-weight:800}
.missing.ok h3{color:var(--green)}
.mrow{display:flex;gap:12px;padding:6px 0;font-size:13.5px;color:var(--tx2);flex-wrap:wrap}
.mrow b{color:var(--tx);min-width:250px}
.note{margin-top:22px;color:var(--tx3);font-size:12.5px}
</style></head><body><div class="wrap">
<h1>${esc(client.business_name)}</h1>
<p class="sub">Every message rendered through the real send path, as ${esc(LEAD.full_name)} would receive it.
Reference each one by its tag when you send notes back.</p>
<div class="sw"><div class="swrow">${tabs}</div></div>
${panels}
${miss}
<p class="note">Read-only. Nothing here enables, approves or sends anything.</p>
<script>
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.pan').forEach(p=>p.classList.toggle('on',p.dataset.k===t.dataset.k));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
  window.scrollTo({top:0,behavior:'instant'});
});
</script></div></body></html>`;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const specs = ANNOTATE ? (await import(path.resolve(ROOT, ANNOTATE))).default : null;
const { client, automations } = await load();
const vars = { ...LEAD, next_session: "", ...clientVars(client) };
const L = locFor(client.id, vars);

fs.mkdirSync(path.join(OUT, "msg"), { recursive: true });

const groups = [];
for (const a of automations) {
  const ctx = { clientId: client.id, vars, L, key: a.automation_key, specs };
  const rendered = (a.steps || []).map((s, i) => {
    const m = renderStep(s, i, ctx);
    if (m.kind === "email") fs.writeFileSync(path.join(OUT, "msg", `${a.automation_key}-${i + 1}.html`), m.html);
    return m;
  });
  groups.push({ key: a.automation_key, name: a.name, approved: a.approved, steps: a.steps || [], rendered });
}

const missing = missingFacts(client, L);
fs.writeFileSync(path.join(OUT, "index.html"), page(client, groups, missing));

const emails = groups.reduce((n, g) => n + g.rendered.filter((m) => m.kind === "email").length, 0);
const sms = groups.reduce((n, g) => n + g.rendered.filter((m) => m.kind === "sms").length, 0);
console.log(`${client.business_name}: ${groups.length} automations, ${sms} SMS, ${emails} emails${specs ? " (annotated)" : ""}`);
if (missing.length) {
  console.log(`\ndid not render (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.what.padEnd(46)} ${m.why}`);
}
console.log(`\n-> ${path.relative(ROOT, OUT)}/index.html`);
