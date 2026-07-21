#!/usr/bin/env node
// Seed the pipeline_stages registry for ONE academy (Effort E, PR 1).
//
// Reads the academy's current GHL Training pipeline and upserts a pipeline_stages
// row per ROLE, filling the ghl_* columns with TODAY's exact GHL pipeline/stage
// ids. After this runs, resolveStage() under pipeline_provider='portal' returns
// the identical ids the regex finders return today - which is what makes the
// cutover byte-safe. won / unqualified have no GHL stage by name (won is a GHL
// status, unqualified is status + a tag), so their rows are created with null
// ghl_* and is_terminal=true (the registry tolerates a roleless-of-GHL stage).
//
// Read-from-GHL + write-to-Supabase only. It does NOT touch GHL or flip any flag.
// Idempotent: upserts on (client_id, role). Safe to re-run.
//
//   node scripts/seed-stages.js [clientId]
//
// Defaults to BAM GTA (39875f07-0a4b-4429-a201-2249bc1f24df) when no id is given.
// Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_KEY (and a usable GHL token: the
// client's ghl_access_token, else GHL_API_KEY / GHL_AGENCY_TOKEN) in ../../.env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env.local");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=");
      if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const GHL_V2 = "https://services.leadconnectorhq.com";
const V2_VERSION = "2021-07-28";
const CLIENT_ID = process.argv[2] || "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

// Role registry definition. Matchers MUST stay identical to ROLE_MATCHERS in
// api/agent/_store.js so the seeded ids match what the finders resolve today.
const ROLES = [
  { role: "responded",       label: "Booking",      position: 0, is_terminal: false, match: (s) => /respond/i.test(s.name || "") },
  { role: "ghosted",         label: "Ghosted",      position: 1, is_terminal: false, match: (s) => /interest|ghost/i.test(s.name || "") },
  { role: "scheduled_trial", label: "Confirm",      position: 2, is_terminal: false, match: (s) => /(schedul|book).*trial/i.test(s.name || "") },
  { role: "done_trial",      label: "Closing",      position: 3, is_terminal: false, match: (s) => {
      const n = (s.name || "").toLowerCase();
      return n.includes("trial") && (n.includes("done") || n.includes("complete") || n.includes("attend"));
    } },
  { role: "nurture",         label: "Lead Nurture", position: 4, is_terminal: false, match: (s) => /nurtur/i.test(s.name || "") },
  { role: "won",             label: "Member",       position: 5, is_terminal: true,  match: null }, // GHL status, no stage name
  { role: "unqualified",     label: "Unqualified",  position: 6, is_terminal: true,  match: null }, // status + tag, no stage name
];

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function ghl(method, path, token) {
  const res = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`GHL ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

async function main() {
  const rows = await sb(`clients?id=eq.${CLIENT_ID}&select=id,business_name,ghl_access_token,ghl_location_id`);
  const client = rows && rows[0];
  if (!client) { console.error(`No clients row for ${CLIENT_ID}`); process.exit(1); }

  const token = client.ghl_access_token || env.GHL_API_KEY || env.GHL_AGENCY_TOKEN;
  const locationId = client.ghl_location_id;
  if (!token || !locationId) {
    console.error("No usable GHL token / locationId for this client (need ghl_access_token + ghl_location_id, or a GHL_API_KEY fallback).");
    process.exit(1);
  }

  console.log(`Seeding pipeline_stages for ${client.business_name || CLIENT_ID} (${CLIENT_ID})`);
  const data = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, token);
  const pipelines = data.pipelines || data.data || [];
  const pipe = pipelines.find(p => /training/i.test(p.name || "")) || pipelines[0];
  if (!pipe) { console.error("No GHL pipelines found for this academy."); process.exit(1); }
  console.log(`Training pipeline: ${pipe.name} (${pipe.id})`);

  const payload = ROLES.map(r => {
    const stage = r.match ? (pipe.stages || []).find(r.match) : null;
    if (r.match && !stage) console.warn(`  ! no GHL stage matched role '${r.role}' (leaving ghl_* null)`);
    else if (stage) console.log(`  ${r.role.padEnd(16)} -> ${stage.name} (${stage.id})`);
    else console.log(`  ${r.role.padEnd(16)} -> (no GHL stage; status-driven)`);
    return {
      client_id: CLIENT_ID,
      role: r.role,
      label: r.label,
      position: r.position,
      is_terminal: r.is_terminal,
      ghl_pipeline_id: pipe.id,
      ghl_stage_id: stage ? stage.id : null,
      ghl_stage_name: stage ? stage.name : null,
      updated_at: new Date().toISOString(),
    };
  });

  await sb(`pipeline_stages?on_conflict=client_id,role`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  console.log(`Upserted ${payload.length} pipeline_stages rows. Done.`);
}

main().catch(e => { console.error(e); process.exit(1); });
