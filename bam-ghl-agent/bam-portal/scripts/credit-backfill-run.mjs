#!/usr/bin/env node
// Opening-balance backfill for the credit engine (offer tie-in step D).
// Members who paid BEFORE the engine went live have no credits until their
// next invoice. This replays each member's most recent PAID Stripe invoice
// through applyInvoiceCreditGrants - the exact engine path the webhook runs -
// so balances appear with proper invoice_line refs. Idempotent: re-runs and
// future webhook deliveries of the same invoice converge on the DB guard.
//
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... STRIPE_SECRET_KEY=... \
//     npx tsx scripts/credit-backfill-run.mjs --client <client_id> \
//       --account <stripe_connect_acct> [--apply]
//
// Without --apply it lists each member's latest paid invoice and stops.

import { createRuntimeSupabaseClient } from "../api/_runtime/supabase.js";
import { applyInvoiceCreditGrants } from "../api/_runtime/credit-engine.js";

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? null : process.argv[idx + 1] || null;
}
const clientId = arg("client");
const account = arg("account");
const apply = process.argv.includes("--apply");
const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
if (!clientId || !account || !stripeKey) {
  console.error("usage: credit-backfill-run.mjs --client <id> --account <acct_...> [--apply] (STRIPE_SECRET_KEY required)");
  process.exit(1);
}

const supabase = createRuntimeSupabaseClient();
const { data: members, error } = await supabase
  .from("members")
  .select("id, athlete_name, status, plan, stripe_subscription_id")
  .eq("client_id", clientId)
  .not("stripe_subscription_id", "is", null)
  .order("athlete_name");
if (error) { console.error(error.message); process.exit(1); }

let applied = 0, skippedMembers = 0;
for (const m of members) {
  const res = await fetch(
    `https://api.stripe.com/v1/invoices?subscription=${encodeURIComponent(m.stripe_subscription_id)}&status=paid&limit=1`,
    { headers: { Authorization: `Basic ${Buffer.from(`${stripeKey}:`).toString("base64")}`, "Stripe-Account": account } },
  );
  const body = await res.json();
  const inv = body && body.data && body.data[0];
  const label = `${(m.athlete_name || m.id).slice(0, 26).padEnd(28)} ${String(m.plan || "-").padEnd(18)}`;
  if (!inv) { console.log(`  - ${label} no paid invoice`); skippedMembers += 1; continue; }
  const lines = ((inv.lines && inv.lines.data) || [])
    .filter((line) => line && line.id && line.price && line.price.id)
    .map((line) => ({
      lineId: line.id,
      stripePriceId: line.price.id,
      periodStart: new Date(((line.period && line.period.start) || 0) * 1000).toISOString(),
      periodEnd: new Date(((line.period && line.period.end) || 0) * 1000).toISOString(),
    }));
  if (!lines.length) { console.log(`  - ${label} invoice ${inv.id}: no price lines`); skippedMembers += 1; continue; }
  if (!apply) {
    console.log(`  · ${label} would replay ${inv.id} (${lines.map((l) => l.stripePriceId).join(",")})`);
    continue;
  }
  const result = await applyInvoiceCreditGrants(supabase, {
    tenantId: clientId,
    subscriptionId: m.stripe_subscription_id,
    invoiceId: inv.id,
    lines,
  });
  const granted = result.granted.map((g) => `+bal=${g.balance}`).join(",");
  const skips = result.skipped.map((s) => s.reason).join(",");
  console.log(`  ${result.granted.length ? "✓" : "-"} ${label} ${inv.id} ${granted || ""}${skips ? ` skip:${skips}` : ""}`);
  applied += result.granted.length;
}
console.log(`\n${members.length} members: ${applied} grants applied, ${skippedMembers} without invoices${apply ? "" : " (dry run - use --apply)"}`);
