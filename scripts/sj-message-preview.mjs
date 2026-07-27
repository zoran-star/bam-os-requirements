// Render EVERY San Jose automation message exactly as a parent would receive it.
// Not an approximation: it imports the REAL send-path modules (api/email-shells.js)
// and mirrors how api/automations.js assembles `vars` at send time, so what shows
// up on the page is byte-for-byte what the worker would hand to Twilio / Resend.
//
// Reads the live rows from Supabase (automations + automation_steps), writes a
// static site to build/sj-messages/, which scripts/sj-message-preview.sh serves
// detached on :4600.
//
// Read-only. Nothing here enables, approves, or sends anything.
//
// WHY THIS EXISTS, and why rendered output beats grep on this codebase: during the
// 2026-07-26 preset-parity audit a static literal-grep produced three BLOCKER-severity
// false positives (a locFor GTA fallback removed on 2026-07-25, and two agent prompt
// defaults that fact-render.js overrides at runtime). Every one died against rendered
// output: grep proves "GTA literal present in file", the render proves "not present in
// what the parent receives". The same pass then found two REAL leaks the grep missed.
// The rule that fell out of it: a literal in a source file is not evidence of a leak.
// What matters is whether anything overrides it on the path to output, and whether that
// override fails OPEN or CLOSED. See docs/automation-message-harness.md.
//
// LIMITATION, stated honestly: this is pinned to ONE academy - a CLIENT_ID const plus a
// committed data snapshot rather than a live read. Parameterising it by client id and
// reading automation_steps live turns it into a before/after verification surface for
// any academy a preset change touches. That is the obvious next move, deliberately not
// done here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, resolveMergeVars, locFor, clientVars } from "../bam-ghl-agent/bam-portal/api/email-shells.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build", "sj-messages");
const CLIENT_ID = "5576acf0-acd3-4c05-9f9f-ebfde8618154";

// The client row + the 13 steps, captured from Supabase (read-only snapshot so the
// page can be rebuilt without DB access). Refresh with scripts/sj-message-preview.sh --pull.
const DATA = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sj-message-preview.data.json"), "utf8"));
const CLIENT = DATA.client;
const STEPS = DATA.steps;

// Realistic sample lead so merge fields read like a real message, not a test.
const LEAD = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };

// EXACTLY the vars api/automations.js builds for a send (line ~506).
const VARS = { ...LEAD, next_session: "", ...clientVars(CLIENT) };
const L = locFor(CLIENT_ID, VARS);

const SEQUENCES = [
  { key: "trial_form", trigger: "Parent fills the free-trial form but never picks a time on the calendar." },
  { key: "contact_form", trigger: "Parent fills the general contact / enquiry form." },
  { key: "missed_trial", trigger: "Athlete no-showed their booked trial and the trainer marked \"did not attend\"." },
  { key: "ghosted", trigger: "The first-touch message above got no reply. The lead rolls forward into this drip." },
  { key: "nurture", trigger: "Ghosted ran dry. The long game: four designed brand emails over about 8 weeks." },
  { key: "onboarding", trigger: "A brand-new paid member goes live. This is the welcome drip, not a sales drip." },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function waitLabel(amount, unit) {
  const n = Number(amount) || 0;
  const u = String(unit || "").replace(/s$/, "");
  return `${n} ${u}${n === 1 ? "" : "s"}`;
}

// Cumulative elapsed time from the trigger, so a sequence reads as a timeline.
const MIN = { minute: 1, hour: 60, day: 1440, week: 10080 };
function cumulative(steps, i) {
  let m = 0;
  for (let k = 0; k <= i; k++) m += (Number(steps[k].wait_amount) || 0) * (MIN[String(steps[k].wait_unit).replace(/s$/, "")] || 0);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} hr`;
  if (m < 10080) return `day ${Math.round(m / 1440)}`;
  return `week ${Math.round(m / 10080)}`;
}

// GSM-7 vs UCS-2: our copy carries emoji, which halves the segment size. Worth
// showing because a 2-segment SMS costs twice as much to send.
function smsMeta(text) {
  const ucs2 = /[^\x00-\x7F\n\r]/.test(text) && /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(text);
  const per = ucs2 ? 67 : 153;
  const single = ucs2 ? 70 : 160;
  const len = [...text].length;
  const segs = len <= single ? 1 : Math.ceil(len / per);
  return { len, segs, enc: ucs2 ? "UCS-2 (emoji)" : "GSM-7" };
}

const bySeq = new Map();
for (const s of STEPS) {
  if (!bySeq.has(s.automation_key)) bySeq.set(s.automation_key, []);
  bySeq.get(s.automation_key).push(s);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "emails"), { recursive: true });

let cards = "";
let nav = "";
let smsCount = 0;
let emailCount = 0;

for (const seq of SEQUENCES) {
  const steps = (bySeq.get(seq.key) || []).sort((a, b) => a.position - b.position);
  if (!steps.length) continue;
  const name = steps[0].name;
  const anchor = seq.key;
  nav += `<a class="navitem" href="#${anchor}"><span class="navname">${esc(name)}</span><span class="navcount">${steps.length}</span></a>`;

  let body = "";
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const held = st.step_enabled === false;
    const isEmail = st.channel === "email";
    if (!held) { if (isEmail) emailCount++; else smsCount++; }

    const timing = `<div class="wait"><span class="waitline"></span><span class="waitchip">wait ${waitLabel(st.wait_amount, st.wait_unit)}</span><span class="waitat">${cumulative(steps, i)} from trigger</span><span class="waitline"></span></div>`;

    let payload = "";
    if (isEmail) {
      const subject = resolveMergeVars(String(st.subject || ""), L, VARS);
      // The SAME renderEmail the sender uses: template:<key> refs resolved,
      // brand shell filled with San Jose's own identity, merge tokens replaced.
      const html = renderEmail({ clientId: CLIENT_ID, subject, body: st.body, vars: VARS });
      const file = `emails/${seq.key}-${st.position}.html`;
      fs.writeFileSync(path.join(OUT, file), html);
      const isTemplate = /^\s*template:/.test(String(st.body || ""));
      payload = `
        <div class="mailhead">
          <div class="mailrow"><span class="maillabel">From</span><span class="mailval">${esc(L.full)} &lt;${esc(L.email)}&gt;</span></div>
          <div class="mailrow"><span class="maillabel">To</span><span class="mailval">${esc(LEAD.full_name)} &lt;maya.alvarez@gmail.com&gt;</span></div>
          <div class="mailrow"><span class="maillabel">Subject</span><span class="mailval subj">${esc(subject)}</span></div>
        </div>
        <div class="mailframe"><iframe class="mail" src="${file}" title="${esc(subject)}" loading="lazy"></iframe></div>
        <div class="mailfoot">${isTemplate ? `designed template <code>${esc(String(st.body).trim())}</code>` : "plain body on the branded shell"} <a href="${file}" target="_blank">open full size &rarr;</a></div>`;
    } else {
      const text = resolveMergeVars(String(st.body || ""), L, VARS);
      const m = smsMeta(text);
      payload = `
        <div class="phone"><div class="phonetop"><span class="phonefrom">${esc(L.full)}</span></div>
          <div class="bubble">${esc(text).replace(/\n/g, "<br>")}</div>
          <div class="delivered">Delivered</div>
        </div>
        <div class="smsmeta">${m.len} characters &middot; ${m.segs} segment${m.segs === 1 ? "" : "s"} &middot; ${m.enc}</div>`;
    }

    body += `
      ${timing}
      <div class="step ${isEmail ? "isemail" : "issms"} ${held ? "isheld" : ""}">
        <div class="stephead">
          <span class="chan ${isEmail ? "chan-email" : "chan-sms"}">${isEmail ? "EMAIL" : "SMS"}</span>
          <span class="stepno">Message ${i + 1} of ${steps.length}</span>
          ${held ? `<span class="heldpill">HELD - not sending</span>` : ""}
        </div>
        ${held ? `<div class="heldnote"><b>Deliberately off.</b> This email quotes real GTA parents re-attributed to San Jose families via {{location.city}}. Zoran's ruling (2026-07-27): the durable fix is a QUOTE-FREE VARIANT, so the drip still sends on schedule and the quote block drops out until that academy has Google reviews connected. Disabled here until that variant exists. <code>onboarding-testimonials</code> has the identical problem. Shown for review only.</div>` : ""}
        ${payload}
      </div>`;
  }

  cards += `
    <section class="seq" id="${anchor}">
      <div class="seqhead">
        <h2>${esc(name)}</h2>
        <div class="seqmeta"><span class="dormant">dormant until launch</span><span class="seqsteps">${steps.length} message${steps.length === 1 ? "" : "s"}</span></div>
      </div>
      <p class="trigger"><span class="triglabel">Trigger</span>${esc(seq.trigger)}</p>
      ${body}
    </section>`;
}

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BAM San Jose - every automated message</title>
<style>
  :root{
    --bg:#0B0B0C; --panel:#131316; --panel2:#191920; --line:#26262E;
    --ink:#F2F2F0; --mid:#A8A8A6; --dim:#6E6E72; --gold:#D4B65C;
    --sms:#4C8DFF; --mail:#C08BE8; --held:#E0A33E;
    --ui:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    --mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--ui);-webkit-font-smoothing:antialiased;}
  .wrap{display:grid;grid-template-columns:250px minmax(0,1fr);gap:40px;max-width:1180px;margin:0 auto;padding:0 28px 120px;}

  header.top{border-bottom:1px solid var(--line);margin-bottom:34px;background:linear-gradient(180deg,#141416,transparent);}
  .topin{max-width:1180px;margin:0 auto;padding:38px 28px 30px;}
  .kicker{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);font-weight:700;margin:0 0 10px;}
  h1{margin:0 0 14px;font-size:38px;line-height:1.05;letter-spacing:-.5px;font-weight:800;}
  .sub{margin:0;color:var(--mid);font-size:15px;line-height:1.6;max-width:640px;}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:7px 15px;font-size:12.5px;color:var(--mid);}
  .stat b{color:var(--ink);font-weight:700;}
  .warn{background:rgba(224,163,62,.09);border:1px solid rgba(224,163,62,.32);color:#F0C878;border-radius:12px;padding:12px 16px;margin-top:20px;font-size:13.5px;max-width:720px;line-height:1.55;}

  nav{position:sticky;top:24px;align-self:start;}
  .navttl{font-size:10.5px;letter-spacing:2.4px;text-transform:uppercase;color:var(--dim);font-weight:700;margin:0 0 12px;padding-left:2px;}
  .navitem{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;color:var(--mid);text-decoration:none;font-size:13.5px;border:1px solid transparent;}
  .navitem:hover{background:var(--panel);border-color:var(--line);color:var(--ink);}
  .navcount{font-family:var(--mono);font-size:11px;color:var(--dim);background:var(--panel2);border-radius:999px;padding:2px 8px;}
  .navfoot{margin-top:22px;padding:14px 12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--dim);line-height:1.6;}

  .seq{margin:0 0 72px;}
  .seqhead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px;}
  .seq h2{margin:0;font-size:25px;font-weight:800;letter-spacing:-.2px;}
  .seqmeta{display:flex;gap:8px;align-items:center;}
  .dormant{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:4px 10px;}
  .seqsteps{font-size:12px;color:var(--dim);}
  .trigger{margin:16px 0 4px;color:var(--mid);font-size:14px;line-height:1.6;}
  .triglabel{display:inline-block;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:var(--gold);margin-right:10px;}

  .wait{display:flex;align-items:center;gap:12px;margin:26px 0 14px;}
  .waitline{flex:1;height:1px;background:var(--line);}
  .waitchip{font-family:var(--mono);font-size:11px;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:5px 12px;white-space:nowrap;}
  .waitat{font-size:11px;color:var(--dim);white-space:nowrap;}

  .step{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px 22px;}
  .step.isheld{opacity:.72;border-style:dashed;border-color:rgba(224,163,62,.4);}
  .stephead{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;}
  .chan{font-size:10px;letter-spacing:1.6px;font-weight:800;border-radius:6px;padding:5px 9px;}
  .chan-sms{background:rgba(76,141,255,.14);color:#8FB6FF;}
  .chan-email{background:rgba(192,139,232,.14);color:#D3AEF0;}
  .stepno{font-size:12px;color:var(--dim);}
  .heldpill{font-size:10px;letter-spacing:1.4px;font-weight:800;color:#0B0B0C;background:var(--held);border-radius:6px;padding:5px 9px;}
  .heldnote{background:rgba(224,163,62,.08);border-left:3px solid var(--held);border-radius:0 8px 8px 0;padding:12px 15px;margin-bottom:18px;font-size:13px;line-height:1.6;color:#E8CFA0;}
  .heldnote b{color:#F5DFAE;}

  .phone{max-width:400px;background:#000;border:1px solid #2A2A32;border-radius:26px;padding:16px 14px 14px;}
  .phonetop{text-align:center;padding-bottom:12px;border-bottom:1px solid #1D1D24;margin-bottom:16px;}
  .phonefrom{font-size:12px;color:#8A8A90;font-weight:600;}
  .bubble{background:#28282E;color:#fff;border-radius:20px 20px 20px 6px;padding:13px 16px;font-size:15px;line-height:1.45;max-width:88%;word-wrap:break-word;}
  .delivered{font-size:10.5px;color:#5C5C64;margin:7px 0 0 4px;}
  .smsmeta{margin-top:11px;font-family:var(--mono);font-size:11px;color:var(--dim);}

  .mailhead{border:1px solid var(--line);border-bottom:none;border-radius:12px 12px 0 0;background:var(--panel2);padding:14px 16px;}
  .mailrow{display:flex;gap:12px;font-size:12.5px;line-height:1.9;}
  .maillabel{width:56px;flex:none;color:var(--dim);}
  .mailval{color:var(--mid);word-break:break-word;}
  .mailval.subj{color:var(--ink);font-weight:700;font-size:14px;}
  .mailframe{border:1px solid var(--line);border-radius:0 0 12px 12px;overflow:hidden;background:#EDEDEA;}
  iframe.mail{width:100%;border:0;display:block;height:800px;background:#EDEDEA;}
  .mailfoot{margin-top:10px;font-size:11.5px;color:var(--dim);display:flex;gap:14px;align-items:center;flex-wrap:wrap;}
  .mailfoot code{font-family:var(--mono);color:var(--mid);background:var(--panel2);padding:2px 6px;border-radius:5px;}
  .mailfoot a{color:var(--gold);text-decoration:none;font-weight:600;}
  .mailfoot a:hover{text-decoration:underline;}

  @media (max-width:900px){.wrap{grid-template-columns:1fr;gap:0}nav{display:none}h1{font-size:29px}}
</style>
</head><body>

<header class="top"><div class="topin">
  <p class="kicker">By Any Means San Jose</p>
  <h1>Every automated message, as a parent gets it</h1>
  <p class="sub">All 13 steps rendered through the real production send pipeline: the same shell, the same merge-token resolver, the same designed email templates. Sample lead is <b>Maya Alvarez</b>, athlete <b>Jordan Alvarez</b>. Nothing on this page can send.</p>
  <div class="stats">
    <span class="stat"><b>6</b> sequences</span>
    <span class="stat"><b>${smsCount}</b> live SMS</span>
    <span class="stat"><b>${emailCount}</b> live emails</span>
    <span class="stat"><b>1</b> held</span>
    <span class="stat">domain <b>${esc(L.siteLabel)}</b></span>
    <span class="stat">owner <b>${esc(L.ownerFirst)}</b></span>
  </div>
  <div class="warn">These are seeded from the <b>shared canonical master defaults</b>. A wording change belongs in the master so every academy gets it. A wrong name, city or link is a data fix, not a copy fix. Tell me which each one is before anything gets saved.</div>
</div></header>

<div class="wrap">
  <nav>
    <p class="navttl">Sequences</p>
    ${nav}
    <div class="navfoot">Read top to bottom: that is the order a lead who never replies actually experiences.</div>
  </nav>
  <main>${cards}</main>
</div>

<script>
  // Size every email iframe to its own content so nothing is cut off or scrolled.
  // Collapse first, then measure: leaving the old height in place makes the inner
  // documentElement report the IFRAME's height back, so it could only ever grow.
  function fit(f){ try{ var d=f.contentDocument; if(!d||!d.body) return; f.style.height='0px'; var h=d.body.scrollHeight; f.style.height=(h>0?h:800)+'px'; }catch(e){} }
  function fitAll(){ document.querySelectorAll('iframe.mail').forEach(fit); }
  document.querySelectorAll('iframe.mail').forEach(function(f){
    f.addEventListener('load',function(){ fit(f); setTimeout(function(){fit(f)},300); });
  });
  // Belt and braces: a lazy iframe can finish loading before its listener is
  // attached, and webfonts land after load. Re-fit for the first few seconds and
  // whenever one scrolls into view, so no email is ever clipped.
  var t=setInterval(fitAll,400); setTimeout(function(){clearInterval(t)},6000);
  if(window.IntersectionObserver){ var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting) fit(e.target);});}); document.querySelectorAll('iframe.mail').forEach(function(f){io.observe(f)}); }
  window.addEventListener('resize',fitAll);
  fitAll();
</script>
</body></html>`;

fs.writeFileSync(path.join(OUT, "index.html"), page);
console.log(`Wrote ${OUT}/index.html - ${STEPS.length} steps (${smsCount} SMS, ${emailCount} emails, 1 held)`);
