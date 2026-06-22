import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, ghl } from "./_core.js";
// Staff/admin report — every connected academy's GHL pipelines + stages, one
// full-width row per academy, with an editable per-pipeline NOTES box that saves.
//
//   GET  /api/ghl/all-pipelines             → rendered HTML page
//   GET  /api/ghl/all-pipelines?format=json → JSON
//   POST /api/ghl/all-pipelines  {client_id, pipeline_id, note} → save a note
//
// PUBLIC (per Zoran) — open at staff.byanymeansbusiness.com/api/ghl/all-pipelines.
// Tokens handled server-side (pickGhlToken auto-refreshes), so it's always live.

export const maxDuration = 120; // rows+notes layout

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function gather(client) {
  const out = { client_id: client.id, name: client.business_name || "(academy)", tier: client.v2_access ? "V2" : client.v15_access ? "V1.5" : "-", ghl_name: null, pipelines: [], error: null };
  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { out.error = "token: " + (e.message || e); return out; }
  if (!creds || !creds.token || !creds.locationId) { out.error = "not connected"; return out; }
  try { const loc = await ghl("GET", `/locations/${creds.locationId}`, { token: creds.token }); out.ghl_name = (loc.location || loc || {}).name || null; } catch (_) {}
  try {
    const d = await ghl("GET", `/opportunities/pipelines?locationId=${creds.locationId}`, { token: creds.token });
    for (const p of (d.pipelines || [])) out.pipelines.push({ id: p.id, name: p.name, stages: (p.stages || []).map(s => s.name) });
  } catch (e) { out.error = "pipelines: " + (e.message || e); }
  return out;
}

async function mapLimit(items, limit, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx]); }
  }));
  return res;
}

function renderPage(rows, notes) {
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const connected = rows.filter(r => !r.error).length;
  const totalPipes = rows.reduce((n, r) => n + r.pipelines.length, 0);

  const sections = rows.map(r => {
    let match = "";
    if (r.ghl_name) {
      const ok = r.ghl_name.toLowerCase().includes(r.name.toLowerCase().slice(0, 5)) || r.name.toLowerCase().includes(r.ghl_name.toLowerCase().slice(0, 5));
      match = ok ? `<span class="ok">✓ ${esc(r.ghl_name)}</span>` : `<span class="warn">⚠ GHL: ${esc(r.ghl_name)}</span>`;
    }
    const tier = r.tier !== "-" ? `<span class="tier t${r.tier.replace(".", "")}">${esc(r.tier)}</span>` : "";

    let body;
    if (r.error) body = `<div class="err">Couldn't read — ${esc(r.error)}</div>`;
    else if (!r.pipelines.length) body = `<div class="muted">No pipelines in GHL.</div>`;
    else body = r.pipelines.map(p => {
      const stageEls = p.stages.length
        ? p.stages.map(s => `<div class="stage">${esc(s)}</div>`).join('<div class="arrow">→</div>')
        : `<div class="muted">no stages</div>`;
      const noteVal = esc(notes[`${r.client_id}|${p.id}`] || "");
      return `<div class="pipe-row">
        <div class="flow">
          <div class="pipe-label">${esc(p.name)}</div>
          <div class="stages">${stageEls}</div>
        </div>
        <div class="notes">
          <textarea placeholder="notes" data-client="${esc(r.client_id)}" data-pipeline="${esc(p.id)}" onblur="saveNote(this)">${noteVal}</textarea>
          <span class="saved" aria-hidden="true">saved ✓</span>
        </div>
      </div>`;
    }).join("");

    return `<section class="academy">
      <h2>${esc(r.name)} ${tier} <span class="match">${match}</span></h2>
      ${body}
    </section>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client Pipelines + Stages</title><style>
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;background-image:radial-gradient(#d7d9de 1px,transparent 1px);background-size:22px 22px;color:#1a1a1d;font:15px/1.45 -apple-system,system-ui,Inter,sans-serif;padding:32px 40px}
.top{max-width:1500px;margin:0 auto 26px} h1{font-size:24px;margin:0 0 2px} .sub{color:#6b6e76;font-size:13px}
.academy{max-width:1500px;margin:0 auto 40px;padding-bottom:26px;border-bottom:1px solid #e3e5ea}
.academy h2{font-size:28px;font-weight:800;margin:0 0 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.match{font-size:12px;font-weight:600} .ok{color:#1f9d57} .warn{color:#b8860b}
.tier{font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;border:1px solid #cfd2d8;color:#555}
.tier.tV2{background:#E8C547;border-color:#E8C547;color:#1a1a1a} .tier.tV15{color:#b8860b;border-color:#E8C547}
.pipe-row{display:flex;align-items:flex-start;gap:28px;margin-bottom:26px;flex-wrap:wrap}
.flow{flex:1;min-width:420px} .pipe-label{font-size:19px;font-weight:600;margin-bottom:12px}
.stages{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.stage{background:#7C5CFC;color:#fff;font-weight:600;font-size:14px;padding:13px 20px;border-radius:8px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.arrow{color:#7C5CFC;font-size:18px;font-weight:700;padding:0 2px}
.notes{width:340px;flex:none} .notes textarea{width:100%;min-height:120px;background:#FCF3D0;border:1px solid #E8C547;border-radius:10px;padding:12px 14px;font:inherit;color:#5a4b16;resize:vertical}
.notes textarea::placeholder{color:#b9a55a} .notes textarea:focus{outline:none;border-color:#d9b53b;box-shadow:0 0 0 3px rgba(232,197,71,.25)}
.saved{display:block;font-size:11px;color:#1f9d57;opacity:0;transition:opacity .2s;margin-top:3px} .saved.show{opacity:1}
.err{color:#c0392b} .muted{color:#9498a1;font-size:13px}
@media(max-width:700px){.notes{width:100%}.flow{min-width:0}}
</style></head><body>
<div class="top"><h1>👥 Client Pipelines + Stages</h1><div class="sub">${connected} academies connected · ${totalPipes} pipelines · ✓ = GHL name matches our record · notes save automatically</div></div>
${sections}
<script>
async function saveNote(el){
  const note=el.value, badge=el.parentElement.querySelector('.saved');
  try{
    const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:el.dataset.client,pipeline_id:el.dataset.pipeline,note})});
    if(r.ok&&badge){badge.classList.add('show');setTimeout(()=>badge.classList.remove('show'),1500);}
  }catch(e){}
}
</script>
</body></html>`;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).send("Supabase not configured");

  // Save a note (public, per Zoran).
  if (req.method === "POST") {
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = String(b.client_id || "").trim();
    const pipelineId = String(b.pipeline_id || "").trim();
    if (!clientId || !pipelineId) return res.status(400).json({ error: "client_id and pipeline_id required" });
    try {
      await sb(`pipeline_notes?on_conflict=client_id,pipeline_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ client_id: clientId, pipeline_id: pipelineId, note: String(b.note || ""), updated_at: new Date().toISOString() }]),
      });
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  let clients, noteRows;
  try {
    [clients, noteRows] = await Promise.all([
      sb(`clients?ghl_access_token=not.is.null&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v2_access,v15_access&order=business_name.asc`),
      sb(`pipeline_notes?select=client_id,pipeline_id,note`).catch(() => []),
    ]);
  } catch (e) { return res.status(500).send("DB error: " + esc(e.message)); }

  const notes = {};
  for (const n of (Array.isArray(noteRows) ? noteRows : [])) notes[`${n.client_id}|${n.pipeline_id}`] = n.note;

  const rows = await mapLimit(Array.isArray(clients) ? clients : [], 5, gather);

  if (req.query.format === "json") return res.status(200).json({ ok: true, academies: rows });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(renderPage(rows, notes));
}

export default withSentryApiRoute(handler);
