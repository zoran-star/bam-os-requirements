#!/usr/bin/env node
// Backfill GHL form answers onto portal contacts rows (fill-only, never clobbers).
//
// Why: when an academy flips to contact_provider='portal', its historical GHL
// leads get backfilled with just email+phone - their form answers (athlete
// first/last name, start timeline, etc.) stay behind in GHL. The sales agents
// + Hawkeye Book-it card read the portal row, so they see nothing (Meg Pappas,
// 2026-07-16: staff had to hand-type "Blake Pappas" that the form already gave).
//
// For every portal contact with a REAL GHL id (no dashes) and empty
// custom_fields or a missing athlete_name, fetch the live GHL contact and fill:
//   custom_fields  (only when the row's map is empty)
//   athlete_name   (only when null - resolved via v15_config.athlete_name_field_ids,
//                   first+last aware)
//   name/first/last (only when null)
//
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     node scripts/backfill-ghl-contact-fields.mjs --client <client_id> [--apply]
//
// Dry-run by default: prints what it would write. --apply writes.

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB_URL || !SB_KEY) { console.error("Set VITE_SUPABASE_URL + SUPABASE_SERVICE_KEY"); process.exit(1); }

const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";

const idx = process.argv.indexOf("--client");
const clientId = idx === -1 ? null : process.argv[idx + 1];
const apply = process.argv.includes("--apply");
const limIdx = process.argv.indexOf("--limit");
const limit = limIdx === -1 ? Infinity : Number(process.argv[limIdx + 1]) || Infinity;
if (!clientId) { console.error("usage: backfill-ghl-contact-fields.mjs --client <client_id> [--apply] [--limit N]"); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Same rule as api/_contacts.js resolveAthleteNameFromFields (kept in sync by
// hand - scripts don't import api/ modules to stay runnable standalone).
function resolveAthleteName(cfMap, ids) {
  const vals = [];
  for (const fid of (ids || [])) {
    const raw = cfMap[String(fid)];
    const s = raw == null ? "" : (Array.isArray(raw) ? raw.join(" ") : String(raw)).trim();
    if (s && !vals.some(x => x.toLowerCase() === s.toLowerCase())) vals.push(s);
  }
  if (!vals.length) return null;
  return vals.find(s => /\s/.test(s)) || vals.join(" ");
}

async function ghlGet(path, token) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${GHL_V2}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
    });
    if (r.status === 429 && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GHL ${r.status}: ${(await r.text()).slice(0, 150)}`);
    return r.json();
  }
}

const clients = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,ghl_access_token,ghl_location_id,v15_config&limit=1`);
const client = Array.isArray(clients) && clients[0];
if (!client) { console.error("client not found"); process.exit(1); }
if (!client.ghl_access_token) { console.error(`${client.business_name}: no GHL access token`); process.exit(1); }
const token = client.ghl_access_token;
const athleteIds = Array.isArray(client.v15_config?.athlete_name_field_ids)
  ? client.v15_config.athlete_name_field_ids.map(String) : [];
console.log(`${client.business_name} - athlete field ids: ${athleteIds.join(", ") || "(none mapped)"}`);

// Page through every contact for the client; filter in JS (jsonb-empty filters
// are awkward through PostgREST).
const rows = [];
for (let from = 0; ; from += 1000) {
  const page = await sb(`contacts?client_id=eq.${encodeURIComponent(clientId)}&select=id,ghl_contact_id,name,first_name,last_name,athlete_name,custom_fields&order=id.asc`, {
    headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
  });
  if (!Array.isArray(page) || !page.length) break;
  rows.push(...page);
  if (page.length < 1000) break;
}
const cfEmpty = (cf) => !cf || typeof cf !== "object" || !Object.values(cf).some(v => v != null && String(v).trim());
const targets = rows.filter(r =>
  r.ghl_contact_id && !String(r.ghl_contact_id).includes("-") &&
  (cfEmpty(r.custom_fields) || !String(r.athlete_name || "").trim()),
).slice(0, limit);
console.log(`${rows.length} contacts, ${targets.length} need enrichment${apply ? "" : " (DRY RUN - pass --apply to write)"}`);

let updated = 0, ghlMisses = 0, noNew = 0, errors = 0;
for (let i = 0; i < targets.length; i++) {
  const row = targets[i];
  try {
    const data = await ghlGet(`/contacts/${encodeURIComponent(row.ghl_contact_id)}`, token);
    const c = data && (data.contact || data);
    if (!c) { ghlMisses++; continue; }
    const arr = c.customFields || c.customField || [];
    const cfMap = {};
    for (const f of (Array.isArray(arr) ? arr : [])) {
      const v = f && (f.value ?? f.field_value ?? f.fieldValue);
      if (f && f.id != null && v != null && String(v).trim()) cfMap[String(f.id)] = v;
    }
    const patch = {};
    if (cfEmpty(row.custom_fields) && Object.keys(cfMap).length) patch.custom_fields = cfMap;
    if (!String(row.athlete_name || "").trim()) {
      const an = resolveAthleteName(cfMap, athleteIds);
      if (an) patch.athlete_name = an;
    }
    const nm = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.contactName || c.name || "";
    if (!String(row.name || "").trim() && nm) patch.name = nm;
    if (!String(row.first_name || "").trim() && c.firstName) patch.first_name = c.firstName;
    if (!String(row.last_name || "").trim() && c.lastName) patch.last_name = c.lastName;
    if (!Object.keys(patch).length) { noNew++; continue; }
    if (apply) {
      patch.updated_at = new Date().toISOString();
      await sb(`contacts?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    }
    updated++;
    const brief = [patch.athlete_name ? `athlete=${patch.athlete_name}` : null, patch.custom_fields ? `${Object.keys(patch.custom_fields).length} fields` : null, patch.name ? `name=${patch.name}` : null].filter(Boolean).join(", ");
    console.log(`${apply ? "✓" : "would"} ${row.ghl_contact_id} ${row.name || "(no name)"} → ${brief}`);
  } catch (e) {
    errors++;
    console.error(`✗ ${row.ghl_contact_id}: ${e.message}`);
    if (errors > 20) { console.error("too many errors, stopping"); break; }
  }
  await sleep(150);   // stay inside GHL's 100-req/10s location budget
  if ((i + 1) % 100 === 0) console.log(`… ${i + 1}/${targets.length}`);
}
console.log(`done: ${updated} ${apply ? "updated" : "would update"}, ${noNew} had nothing new, ${ghlMisses} not in GHL, ${errors} errors`);
