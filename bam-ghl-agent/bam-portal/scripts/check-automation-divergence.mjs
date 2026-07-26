#!/usr/bin/env node
// Divergence check: diff an academy's seeded automation_steps against the
// CANONICAL defaults (api/form-intro-automations.js), so a stale or broken seed
// can never ship silently again (the gap that nearly gave San Jose weak drip
// copy, 2026-07-25). Run it in onboarding QA right after applying a preset -
// a just-onboarded academy should be all MATCH.
//
//   node scripts/check-automation-divergence.mjs <clientId>      # one academy
//   node scripts/check-automation-divergence.mjs --all           # every academy with automations
//
// Per automation key, the verdict is one of:
//   MATCH    seeded copy is byte-identical to the canonical default
//   EDITED   the academy changed copy/timing/channel (fine when deliberate -
//            but if the edit is generally good, PROMOTE it into the defaults;
//            if it looks like an old stale seed, re-seed: delete the steps and
//            run seed-preset-automations)
//   MISSING  the automation row doesn't exist (seed never ran for this key)
//   EMPTY    the automation exists with zero steps (broken half-seed)
//   EXTRA    (listed per academy) automation keys outside the canonical set
//
// Exit codes: 0 = no broken seeds (MATCH/EDITED/EXTRA only); 1 = any MISSING or
// EMPTY. EDITED never fails the run - edits are a feature, drift is the finding.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (or
// SUPABASE_SERVICE_KEY). Read-only - this script never writes.

import { CANONICAL_DEFAULTS, canonicalSteps } from "../api/form-intro-automations.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("env required: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)");
  process.exit(2);
}

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const args = process.argv.slice(2).filter(Boolean);
const all = args.includes("--all");
const clientId = args.find((a) => !a.startsWith("--"));
if (!all && !clientId) {
  console.error("usage: node scripts/check-automation-divergence.mjs <clientId> | --all");
  process.exit(2);
}

// Field-level comparison of one step against its canonical counterpart.
function stepDiff(seeded, canon) {
  const diffs = [];
  const norm = (v) => (v == null ? "" : String(v));
  if (Number(seeded.wait_amount) !== Number(canon.wait_amount) || norm(seeded.wait_unit) !== norm(canon.wait_unit)) {
    diffs.push(`wait ${seeded.wait_amount} ${seeded.wait_unit} vs ${canon.wait_amount} ${canon.wait_unit}`);
  }
  if (norm(seeded.channel) !== norm(canon.channel)) diffs.push(`channel ${seeded.channel} vs ${canon.channel}`);
  if (norm(seeded.subject) !== norm(canon.subject)) diffs.push("subject differs");
  if (norm(seeded.body) !== norm(canon.body)) diffs.push("body differs");
  return diffs;
}

async function checkClient(cid, name) {
  const autos = (await sb(`automations?client_id=eq.${cid}&select=id,automation_key,name,enabled,approved`)) || [];
  const byKey = new Map(autos.map((a) => [a.automation_key, a]));
  const rows = [];
  let broken = 0;

  for (const [key, def] of Object.entries(CANONICAL_DEFAULTS)) {
    const auto = byKey.get(key);
    if (!auto) { rows.push([key, "MISSING", "automation row does not exist"]); broken++; continue; }
    const steps = (await sb(`automation_steps?automation_id=eq.${auto.id}&order=position.asc&select=position,wait_amount,wait_unit,channel,subject,body,enabled`)) || [];
    if (!steps.length) { rows.push([key, "EMPTY", "0 steps (broken half-seed)"]); broken++; continue; }
    const canon = canonicalSteps(def);
    const notes = [];
    if (steps.length !== canon.length) notes.push(`${steps.length} steps vs ${canon.length} canonical`);
    for (let i = 0; i < Math.min(steps.length, canon.length); i++) {
      const d = stepDiff(steps[i], canon[i]);
      if (d.length) notes.push(`step ${i + 1}: ${d.join(", ")}`);
    }
    rows.push(notes.length ? [key, "EDITED", notes.join(" | ")] : [key, "MATCH", ""]);
  }

  const extra = autos.map((a) => a.automation_key).filter((k) => !CANONICAL_DEFAULTS[k]);

  console.log(`\n${name || cid}  (${cid})`);
  for (const [key, verdict, note] of rows) {
    console.log(`  ${verdict.padEnd(8)} ${key.padEnd(14)} ${note}`);
  }
  if (extra.length) console.log(`  EXTRA    ${extra.join(", ")} (academy-specific, outside the canonical set)`);
  return broken;
}

let targets;
if (all) {
  const autos = (await sb(`automations?select=client_id`)) || [];
  const ids = [...new Set(autos.map((a) => a.client_id))];
  const clients = ids.length ? (await sb(`clients?id=in.(${ids.join(",")})&select=id,business_name`)) || [] : [];
  const nameById = new Map(clients.map((c) => [c.id, c.business_name]));
  targets = ids.map((id) => [id, nameById.get(id) || id]);
} else {
  const c = (await sb(`clients?id=eq.${clientId}&select=id,business_name`)) || [];
  targets = [[clientId, (c[0] && c[0].business_name) || clientId]];
}

let totalBroken = 0;
for (const [cid, name] of targets) totalBroken += await checkClient(cid, name);

console.log(totalBroken
  ? `\n${totalBroken} broken seed(s) found (MISSING/EMPTY). Fix: POST /api/automations action=seed-preset-automations, or re-apply the preset.`
  : "\nNo broken seeds. EDITED entries (if any) are per-academy copy - promote generally-good edits into api/form-intro-automations.js.");
process.exit(totalBroken ? 1 : 0);
