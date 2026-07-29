#!/usr/bin/env node
// CLI wrapper around the ONE reconciler in api/_testimonial-drift.js. Read that
// file for what the invariants are and why - including the named coupling to
// `resolveSyncClass`, which can change this check's MEANING without breaking it.
//
// ⚠️ THIS IS NOT THE CHECK'S REAL HOME. It reads live data, so it cannot run
// meaningfully in CI (no Supabase secrets in the workflows) and it is
// deliberately NOT wired into portal-ci.yml. The scheduled run at
// api/testimonial-drift.js is the enforcement; this is the on-demand version
// for a human mid-change.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-testimonial-seed-drift.mjs
//
// Verify it still catches things with scripts/verify-testimonial-seed-drift.mjs
// (runs this against a production snapshot plus four mutations).

import { reconcileTestimonialDrift } from "../api/_testimonial-drift.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

if (!SB_URL || !SB_KEY) {
  console.error("FAIL - no Supabase credentials. This check cannot run blind; it will not report a pass it did not verify.");
  process.exit(2);
}

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path}`);
  return r.json();
}

const { failures, reports, summary } = await reconcileTestimonialDrift(sbReq);

if (reports.length) {
  console.log("REPORT (not failures):");
  for (const r of reports) console.log(`  ${r}`);
  console.log("");
}

if (failures.length) {
  console.error(`FAIL - ${summary}:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    `\n  Fix by populating that academy's own store (the /testimonials skill) or by\n` +
    `  disabling the step. Do NOT hand-edit the step body to remove the quotes.`
  );
  process.exit(1);
}

console.log(`PASS - ${summary}.`);
