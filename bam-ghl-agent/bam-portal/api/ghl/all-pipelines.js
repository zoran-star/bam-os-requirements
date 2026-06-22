import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken, ghl } from "./_core.js";
// Staff/admin report — every connected academy's GHL pipelines + stages on one
// page. Tokens are handled server-side (pickGhlToken auto-refreshes), so this
// always reflects live GHL and covers academies whose stored token expired.
//
//   GET /api/ghl/all-pipelines            → rendered HTML page
//   GET /api/ghl/all-pipelines?format=json → JSON
//
// PUBLIC (per Zoran) — open at staff.byanymeansbusiness.com/api/ghl/all-pipelines.
// Exposes pipeline + stage NAMES only (no contacts/PII).

export const maxDuration = 120;

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function gather(client) {
  const out = { name: client.business_name || "(academy)", tier: client.v2_access ? "V2" : client.v15_access ? "V1.5" : "-", ghl_name: null, pipelines: [], error: null };
  let creds;
  try { creds = await pickGhlToken(client); }
  catch (e) { out.error = "token: " + (e.message || e); return out; }
  if (!creds || !creds.token || !creds.locationId) { out.error = "not connected"; return out; }
  try { const loc = await ghl("GET", `/locations/${creds.locationId}`, { token: creds.token }); out.ghl_name = (loc.location || loc || {}).name || null; } catch (_) {}
  try {
    const d = await ghl("GET", `/opportunities/pipelines?locationId=${creds.locationId}`, { token: creds.token });
    for (const p of (d.pipelines || [])) out.pipelines.push({ name: p.name, stages: (p.stages || []).map(s => s.name) });
  } catch (e) { out.error = "pipelines: " + (e.message || e); }
  return out;
}

// Bounded-concurrency map.
async function mapLimit(items, limit, fn) {
  const res = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return res;
}

function renderPage(rows) {
  rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const connected = rows.filter(r => !r.error).length;
  const totalPipes = rows.reduce((n, r) => n + r.pipelines.length, 0);
  const cards = rows.map(r => {
    let match = "";
    if (r.ghl_name) {
      const ok = r.name.toLowerCase().slice(0, 5) && (r.ghl_name.toLowerCase().includes(r.name.toLowerCase().slice(0, 5)) || r.name.toLowerCase().includes(r.ghl_name.toLowerCase().slice(0, 5)));
      match = ok ? `<span class="ok">✓ ${esc(r.ghl_name)}</span>` : `<span class="warn">⚠ GHL: ${esc(r.ghl_name)}</span>`;
    }
    const tier = r.tier !== "-" ? `<span class="tier t${r.tier.replace(".", "")}">${esc(r.tier)}</span>` : "";
    let body;
    if (r.error) body = `<div class="err">Couldn't read — ${esc(r.error)}</div>`;
    else if (!r.pipelines.length) body = `<div class="muted">No pipelines in GHL.</div>`;
    else body = r.pipelines.map(p => {
      const stages = p.stages.map(s => `<span class="stage">${esc(s)}</span>`).join("") || `<span class="muted">no stages</span>`;
      return `<div class="pipe"><div class="pipe-name">🛣 ${esc(p.name)} <span class="muted">(${p.stages.length} stage${p.stages.length === 1 ? "" : "s"})</span></div><div class="stages">${stages}</div></div>`;
    }).join("");
    return `<div class="card"><div class="head"><div class="title">${esc(r.name)} ${tier}</div><div class="match">${match}</div></div>${body}</div>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client Pipelines + Stages</title><style>
:root{--ink:#0e0e11;--surface:#16161a;--border:#2a2a31;--text:#ededed;--mute:#8a8a93;--accent:#E8C547;--green:#7BC47F}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--text);font:15px/1.5 -apple-system,system-ui,Inter,sans-serif;padding:28px}
.wrap{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mute);font-size:13px;margin-bottom:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px}
.title{font-weight:800;font-size:15px}.match{font-size:11px;text-align:right;white-space:nowrap}
.ok{color:var(--green)}.warn{color:var(--accent)}.err{color:#e0654f;font-size:13px}.muted{color:var(--mute);font-size:12px}
.tier{font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;border:1px solid var(--border);margin-left:4px}
.tier.tV2{color:#1a1a1a;background:var(--accent)}.tier.tV15{color:var(--accent);border-color:var(--accent)}
.pipe{margin-bottom:10px}.pipe-name{font-weight:700;font-size:13px;margin-bottom:5px}
.stages{display:flex;flex-wrap:wrap;gap:5px}.stage{font-size:11.5px;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:6px;padding:2px 8px}
</style></head><body><div class="wrap">
<h1>👥 Client Pipelines + Stages</h1>
<div class="sub">${connected} academies connected · ${totalPipes} pipelines · ✓ = GHL account name matches our record</div>
<div class="grid">${cards}</div></div></body></html>`;
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).send("Supabase not configured");
  // Public (per Zoran) — open at staff.byanymeansbusiness.com/api/ghl/all-pipelines.
  // Exposes pipeline + stage NAMES only (no contacts/PII). Re-gate later if needed.

  let clients;
  try { clients = await sb(`clients?ghl_access_token=not.is.null&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v2_access,v15_access&order=business_name.asc`); }
  catch (e) { return res.status(500).send("DB error: " + esc(e.message)); }

  const rows = await mapLimit(Array.isArray(clients) ? clients : [], 5, gather);

  if (req.query.format === "json") return res.status(200).json({ ok: true, academies: rows });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(renderPage(rows));
}

export default withSentryApiRoute(handler);
