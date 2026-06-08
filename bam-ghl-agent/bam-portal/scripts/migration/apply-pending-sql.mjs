// Apply the portal's pending SQL migrations via the Supabase Management API.
//
// Same approach as run-member-management-migration.mjs: an account-level
// personal access token (sbp_...) runs DDL against the portal project. Every
// migration here is idempotent (CREATE TABLE / ADD COLUMN IF NOT EXISTS), so
// re-running is always safe.
//
// Usage:  node apply-pending-sql.mjs <sbp_... token>
// Token:  https://supabase.com/dashboard/account/tokens

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PAT = process.argv[2];
if (!PAT || !PAT.startsWith("sbp_")) {
  console.error("Usage: node apply-pending-sql.mjs <sbp_... Supabase access token>");
  console.error("Create one (account-level) at https://supabase.com/dashboard/account/tokens");
  process.exit(1);
}

const REF = process.env.SUPABASE_PROJECT_REF || "jnojmfmpnsfmtqmwhopz"; // client portal project
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(here, "..", "..", "supabase");

// Ordered list of migrations the marketing + GHL KPI features need.
const FILES = [
  "marketing_goals.sql",     // clients.meta_cpl_goal / meta_monthly_budget
  "ghl_kpi_config.sql",      // clients.ghl_kpi_config (which forms = leads, etc.)
  "ghl_funnel_events.sql",   // lead/response/booking/conversion event log
  "ghl_funnel_excluded.sql", // ghl_funnel_events.excluded soft-delete (KPI cleaning + trash)
];

async function runSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${text.slice(0, 400)}`);
  return text;
}

console.log(`Applying migrations to project ${REF}…\n`);
for (const f of FILES) {
  const p = path.join(sqlDir, f);
  if (!fs.existsSync(p)) { console.log(`  – ${f}: not found, skipping`); continue; }
  process.stdout.write(`  • ${f} … `);
  try {
    await runSql(fs.readFileSync(p, "utf8"));
    console.log("OK");
  } catch (e) {
    console.log("FAILED");
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}
console.log("\nDone. Migrations are idempotent — safe to run again any time.");
