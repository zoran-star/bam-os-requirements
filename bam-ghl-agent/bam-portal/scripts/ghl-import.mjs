#!/usr/bin/env node
// GHL migration CLI - the write/read legs of the /ghl-pipeline-import runbook.
//
// The runbook (repo-root .claude/commands/ghl-pipeline-import.md) drives this
// with Claude in the loop: dump the board, Claude classifies every open card
// into a preset stage role, staff confirm, then import + reconcile + flip.
//
//   node scripts/ghl-import.mjs dump      --client <id> [--out board.json]
//   node scripts/ghl-import.mjs import    --client <id> --map cards.json [--dry-run]
//        cards.json: [{ "id": "<ghlOpportunityId>", "role": "responded", ... }]
//        (extra fields from the dump - name/contact_id/phone/... - ride along)
//   node scripts/ghl-import.mjs shadow-on --client <id>
//   node scripts/ghl-import.mjs reconcile --client <id>
//   node scripts/ghl-import.mjs flip      --client <id> [--force]
//   node scripts/ghl-import.mjs rollback  --client <id>
//
// Env: VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same as
// scripts/apply-preset.mjs). Uses the SAME action functions the staff admin
// endpoint runs - no drift between CLI and API behavior.

import fs from "node:fs";
import {
  actionDump, actionImportCards, actionReconcile, actionSetShadow, actionFlip, loadClientFlags,
} from "../api/admin/pipeline-cutover.js";

const args = process.argv.slice(2);
const cmd = args[0];
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);
const clientId = val("--client");

function die(msg) { console.error(msg); process.exit(1); }

if (!cmd || !["dump", "import", "shadow-on", "reconcile", "flip", "rollback"].includes(cmd)) {
  die("usage: ghl-import.mjs <dump|import|shadow-on|reconcile|flip|rollback> --client <id> [--map cards.json] [--out board.json] [--dry-run] [--force]");
}
if (!clientId) die("--client <id> required");

const flags = await loadClientFlags(clientId).catch((e) => die(`load client: ${e.message}`));
if (!flags) die("academy not found");

if (cmd === "dump") {
  const out = await actionDump(clientId);
  if (out.error) die(`dump failed: ${out.error.message}`);
  const path = val("--out");
  if (path) { fs.writeFileSync(path, JSON.stringify(out, null, 2)); console.log(`wrote ${out.total_cards} open cards + ${out.pipelines.length} pipelines to ${path}`); }
  else console.log(JSON.stringify(out, null, 2));
}

if (cmd === "import") {
  const mapPath = val("--map");
  if (!mapPath) die("--map cards.json required");
  const cards = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const out = await actionImportCards(clientId, { cards: Array.isArray(cards) ? cards : cards.cards, dry_run: has("--dry-run") });
  if (out.error) die(`import failed: ${out.error.message}`);
  console.log(JSON.stringify(out, null, 2));
}

if (cmd === "shadow-on") {
  const out = await actionSetShadow(clientId, flags, true);
  if (out.error) die(`shadow-on failed: ${out.error.message}`);
  console.log(JSON.stringify(out, null, 2));
}

if (cmd === "reconcile") {
  const out = await actionReconcile(clientId, flags);
  if (out.error) die(`reconcile failed: ${out.error.message}`);
  console.log(JSON.stringify(out, null, 2));
}

if (cmd === "flip") {
  const out = await actionFlip(clientId, flags, "portal", has("--force"));
  if (out.error) die(`flip refused: ${JSON.stringify(out.error)}`);
  console.log(JSON.stringify(out, null, 2));
}

if (cmd === "rollback") {
  const out = await actionFlip(clientId, flags, "ghl", true);
  if (out.error) die(`rollback failed: ${JSON.stringify(out.error)}`);
  console.log(JSON.stringify(out, null, 2));
}
