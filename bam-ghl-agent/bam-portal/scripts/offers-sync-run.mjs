#!/usr/bin/env node
// Staff operator tool for the Phase 6.8 offers sync. Drives the EXACT code
// path of POST /api/runtime/offers/sync (runOffersSync) with service-role
// credentials - preview by default, --apply to write.
//
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/offers-sync-run.mjs --client <client_id> --offer <offer_id> \
//       [--program <bookable_program_id>] [--rules <rules.json>] [--apply]
//
// Without --rules it uses the confirmed BAM GTA Training rules
// (parent-app-architecture-handoff.md, reviewed by Zoran + Luka 2026-07-02).

import { readFileSync } from "node:fs";
import { createRuntimeSupabaseClient } from "../api/_runtime/supabase.js";
import { runOffersSync } from "../api/runtime/offers-sync.js";

const GTA_TRAINING_RULES = {
  Steady: { kind: "WEEKLY_CREDITS", credits_per_period: 1, credit_period: "WEEK" },
  Accelerate: { kind: "WEEKLY_CREDITS", credits_per_period: 2, credit_period: "WEEK" },
  Elevate: { kind: "WEEKLY_CREDITS", credits_per_period: 3, credit_period: "WEEK" },
  Dominate: { kind: "UNLIMITED_BOOKING" },
  "Summer Unlimited": { kind: "UNLIMITED_BOOKING" },
};

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? null : process.argv[idx + 1] || null;
}

const clientId = arg("client");
const offerId = arg("offer");
if (!clientId || !offerId) {
  console.error("usage: offers-sync-run.mjs --client <id> --offer <id> [--program <id>] [--rules <file>] [--apply]");
  process.exit(1);
}
const rulesFile = arg("rules");
const rules = rulesFile ? JSON.parse(readFileSync(rulesFile, "utf8")) : GTA_TRAINING_RULES;
const mode = process.argv.includes("--apply") ? "apply" : "preview";

const supabase = createRuntimeSupabaseClient();
const result = await runOffersSync(supabase, {
  client_id: clientId,
  offer_id: offerId,
  mode,
  bookable_program_id: arg("program"),
  entitlement_rules: rules,
});
console.log(JSON.stringify(result, null, 2));
