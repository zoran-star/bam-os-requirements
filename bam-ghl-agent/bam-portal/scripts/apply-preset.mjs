#!/usr/bin/env node
// Stamp a pipeline preset onto an academy's OFFER (Phase 2).
//
// Replaces the one-off seed_default_stage_transitions(): reads the code registry
// in api/agent/presets.js and writes the academy's pipeline_stages + stage_transitions
// rows for one offer. Idempotent (upserts). Use --dry-run to preview the exact rows
// without writing.
//
//   node scripts/apply-preset.mjs <clientId> <offerId> <presetKey> [--dry-run]
//   node scripts/apply-preset.mjs --list                 # show known presets
//
// Env (required for a real run): SUPABASE_URL (or VITE_SUPABASE_URL) +
// SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY). --dry-run for a NEW academy
// still needs them (it reads pipeline_stages for the multi-offer guard); pass a
// clientId with no existing rows.

import { PRESETS, applyPreset, buildPresetRows } from "../api/agent/presets.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const list = args.includes("--list");
const [clientId, offerId, presetKey] = args.filter((a) => !a.startsWith("--"));

if (list) {
  console.log("Known presets:");
  for (const [k, p] of Object.entries(PRESETS)) {
    console.log(`  ${k.padEnd(16)} ${p.label} — ${p.stages.length} stages, ${p.transitions.length} edges`);
  }
  process.exit(0);
}

if (!presetKey || !clientId) {
  console.error("usage: node scripts/apply-preset.mjs <clientId> <offerId> <presetKey> [--dry-run] [--force]");
  console.error("       node scripts/apply-preset.mjs --list");
  process.exit(1);
}
if (!PRESETS[presetKey]) {
  console.error(`unknown preset '${presetKey}'. Known: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

// Pure-offline dry run (no DB) when the caller can't reach Supabase: print rows
// straight from buildPresetRows. Falls back to this if env keys are absent.
const hasEnv = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
               (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

if (dryRun && !hasEnv) {
  const { stageRows, transitionRows } = buildPresetRows(presetKey, clientId, offerId || null);
  console.log(`[dry-run:offline] preset '${presetKey}' → client ${clientId} offer ${offerId || "(none)"} (no DB, skipped the multi-offer guard)`);
  console.log(`${stageRows.length} pipeline_stages rows:`);
  for (const s of stageRows) console.log(`   stage  ${s.position}  ${s.role.padEnd(22)} "${s.label}"`);
  console.log(`${transitionRows.length} stage_transitions rows:`);
  for (const t of transitionRows) {
    const dest = t.to_kind === "stage" ? t.to_stage_role : `@${t.to_terminal}`;
    console.log(`   edge   ${String(t.from_stage_role || "(entry)").padEnd(22)} --${t.trigger}--> ${dest}`);
  }
  process.exit(0);
}

try {
  const res = await applyPreset({ clientId, offerId: offerId || null, presetKey, dryRun, force });
  console.log(res.dryRun ? "\n(dry run — nothing written)" : `\nDone: ${res.stages} stages + ${res.transitions} edges.`);
} catch (e) {
  console.error(`apply-preset failed: ${e.message}`);
  process.exit(1);
}
