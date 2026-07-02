#!/usr/bin/env node
// Rehearsal sweep for the Phase 5 access sync: dry-run syncAccessForMember
// (reason: invoice-paid) against EVERY member of an academy and report what
// it would grant or why it would skip. Read-only - nothing is written.
//
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     npx tsx scripts/access-sync-sweep.mjs --client <client_id>

import { createRuntimeSupabaseClient } from "../api/_runtime/supabase.js";
import { syncAccessForMember } from "../api/_runtime/access-sync.js";

const idx = process.argv.indexOf("--client");
const clientId = idx === -1 ? null : process.argv[idx + 1];
if (!clientId) {
  console.error("usage: access-sync-sweep.mjs --client <client_id>");
  process.exit(1);
}

const supabase = createRuntimeSupabaseClient();
const { data: members, error } = await supabase
  .from("members")
  .select("id, athlete_name, status, plan, stripe_subscription_id, stripe_price_id")
  .eq("client_id", clientId)
  .order("athlete_name");
if (error) { console.error(error.message); process.exit(1); }

let granted = 0;
const flagged = [];
for (const m of members) {
  const outcome = await syncAccessForMember(
    supabase,
    {
      clientId,
      memberId: m.id,
      reason: "invoice-paid",
      subscriptionId: m.stripe_subscription_id,
    },
    { dryRun: true },
  );
  const label = `${(m.athlete_name || m.id).slice(0, 28).padEnd(30)} ${String(m.status).padEnd(24)} ${String(m.plan || "-").padEnd(8)}`;
  if (outcome.action === "granted") {
    granted += 1;
    console.log(`  ✓ ${label} ${outcome.source_ref}`);
  } else {
    flagged.push({ member: m, outcome });
    console.log(`  ⚠ ${label} ${outcome.action}: ${outcome.skip_reason || ""}`);
  }
}
console.log(`\n${members.length} members: ${granted} would grant, ${flagged.length} flagged`);
process.exit(flagged.length ? 2 : 0);
