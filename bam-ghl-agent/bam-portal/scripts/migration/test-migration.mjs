#!/usr/bin/env node
// Post-migration verification — read-only.
// Runs assertions against live Supabase + (optionally) the API.
// Exits 0 if everything passes, 1 if any check fails.
//
// Usage:
//   node scripts/migration/test-migration.mjs              # DB only
//   node scripts/migration/test-migration.mjs --api=local  # DB + http://localhost:3000
//   node scripts/migration/test-migration.mjs --api=prod   # DB + bam-portal-tawny.vercel.app

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8")
    .split("\n").filter(l => l && !l.startsWith("#")).map(l => {
      const idx = l.indexOf("="); if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY;

const apiFlag = process.argv.find(a => a.startsWith("--api="));
const apiMode = apiFlag?.split("=")[1];
const apiBase = apiMode === "local" ? "http://localhost:3000"
              : apiMode === "prod" ? "https://bam-portal-tawny.vercel.app"
              : null;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

let pass = 0, fail = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${detail ? "  →  " + detail : ""}`);
    fail++;
  }
}

console.log("━".repeat(72));
console.log("DATABASE INTEGRITY");
console.log("━".repeat(72));

// 1. Schema — business_name + scaling_manager_id exist, name does not
console.log("\n[Schema]");
try {
  await sb("clients?select=business_name&limit=1");
  check("clients.business_name exists", true);
} catch (e) {
  check("clients.business_name exists", false, e.message);
}
try {
  await sb("clients?select=name&limit=1");
  check("clients.name is GONE (rename was real)", false, "name column still exists!");
} catch (e) {
  check("clients.name is GONE (rename was real)", /does not exist/.test(e.message), e.message);
}
try {
  await sb("clients?select=scaling_manager_id&limit=1");
  check("clients.scaling_manager_id exists", true);
} catch (e) {
  check("clients.scaling_manager_id exists", false, e.message);
}

// 2. Data — Alex Silva staff exists
console.log("\n[Staff]");
const silvaRows = await sb("staff?name=eq.Alex%20Silva&select=id,name,role");
check("Alex Silva staff row exists", silvaRows.length === 1, JSON.stringify(silvaRows));
check("Alex Silva has role=scaling_manager", silvaRows[0]?.role === "scaling_manager", silvaRows[0]?.role);
const silvaId = silvaRows[0]?.id;

// 3. Data — Out Work + Alex Twin clients exist
console.log("\n[New client rows]");
const outWorkRows = await sb("clients?business_name=eq.Out%20Work&select=*");
check("Out Work client row exists", outWorkRows.length === 1);
check("Out Work has owner_name=Niko Brooks", outWorkRows[0]?.owner_name === "Niko Brooks", outWorkRows[0]?.owner_name);
check("Out Work has notion_page_id set", !!outWorkRows[0]?.notion_page_id);
check("Out Work has scaling_manager_id set (Mike)", !!outWorkRows[0]?.scaling_manager_id);

const alexTwinRows = await sb("clients?business_name=eq.Alex%20Twin&select=*");
check("Alex Twin client row exists", alexTwinRows.length === 1);
check("Alex Twin status = onboarding", alexTwinRows[0]?.status === "onboarding");

// 4. Data — matched-client backfills landed
console.log("\n[Backfill checks]");
const samples = [
  { biz: "Major Hoops",        owner: "Jeremy Major",                email: "jeremy@majorhoops.com" },
  { biz: "Basketball+",        owner: "Jake Russell",                 email: null },
  { biz: "ACTIV8",             owner: "TJ Moreno & Jana Moreno",      email: "jana@activ8athlete.com" },
  { biz: "Total Hoops Training", owner: "George Fowler",              email: "georgefowler4@gmail.com" },
  { biz: "Supreme Hoops Training", owner: "Anthony Rizzo & Anthony Sciff", email: "supremehoopstraining@gmail.com" },
];

for (const s of samples) {
  const rows = await sb(`clients?business_name=eq.${encodeURIComponent(s.biz)}&select=owner_name,email,scaling_manager_id`);
  const r = rows[0];
  check(`${s.biz}: owner_name = "${s.owner}"`, r?.owner_name === s.owner, r?.owner_name);
  if (s.email !== null) {
    check(`${s.biz}: email = "${s.email}"`, r?.email === s.email, r?.email);
  }
  check(`${s.biz}: has scaling_manager_id`, !!r?.scaling_manager_id);
}

// 5. ACTIV8 specifically uses Alex Silva (not Mike)
const activ8 = (await sb("clients?business_name=eq.ACTIV8&select=scaling_manager_id"))[0];
check("ACTIV8 scaling manager IS Alex Silva", activ8?.scaling_manager_id === silvaId, activ8?.scaling_manager_id);

// 6. Mike Eluki staff row referenced by 14 clients (sanity check, not strict)
const mikeRows = await sb("staff?name=eq.Mike%20Eluki&select=id");
const mikeId = mikeRows[0]?.id;
const mikeClients = await sb(`clients?scaling_manager_id=eq.${mikeId}&select=business_name`);
check(`Mike Eluki has ≥10 clients assigned (${mikeClients.length} found)`, mikeClients.length >= 10);

// 7. No client still has scaling_manager_id pointing to a missing staff row
console.log("\n[Referential integrity]");
const allClientsWithMgr = await sb("clients?scaling_manager_id=not.is.null&select=business_name,scaling_manager_id");
const allStaff = await sb("staff?select=id");
const staffIds = new Set(allStaff.map(s => s.id));
const orphanFK = allClientsWithMgr.filter(c => !staffIds.has(c.scaling_manager_id));
check("All scaling_manager_id values reference real staff rows", orphanFK.length === 0,
  orphanFK.length ? orphanFK.map(o => o.business_name).join(", ") : "");

// 8. Total client count
console.log("\n[Volume]");
const allClients = await sb("clients?select=id");
check(`Client count ≥ 25 (was 23 + 2 inserted, found ${allClients.length})`, allClients.length >= 25);

// ── API smoke tests (only if --api flag passed) ──
if (apiBase) {
  console.log();
  console.log("━".repeat(72));
  console.log(`API SMOKE (${apiBase})`);
  console.log("━".repeat(72));

  try {
    const res = await fetch(`${apiBase}/api/clients`);
    check(`GET /api/clients reachable`, res.status === 200 || res.status === 401);
    if (res.status === 401) {
      console.log("    (401 expected — endpoint requires auth)");
    } else if (res.ok) {
      const data = await res.json();
      check("Returns array of clients", Array.isArray(data));
      const sample = data[0];
      check("Each client has business_name", sample?.business_name !== undefined);
      check("Each client has `name` alias (legacy compat)", sample?.name !== undefined);
      check("Each client has scaling_manager_id field", "scaling_manager_id" in sample);
    }
  } catch (e) {
    check(`GET /api/clients reachable`, false, e.message);
  }
}

// ── Summary ──
console.log();
console.log("━".repeat(72));
console.log(`RESULTS: ${pass} passed, ${fail} failed`);
console.log("━".repeat(72));

if (fail > 0) {
  console.log("\n❌ Some checks failed — investigate before deploying.");
  process.exit(1);
}

console.log("\n✅ All automated checks passed!");
console.log();
console.log("━".repeat(72));
console.log("MANUAL UI TEST CHECKLIST (run after deploy)");
console.log("━".repeat(72));
console.log(`
□ Open the staff portal, log in
□ Clients tab loads
  □ Shows ~20 clients in Active, a couple in Onboarding
  □ Each card shows: business name, owner name, manager name (where set)
  □ Sample to verify: Major Hoops → Jeremy Major / Mike Eluki
  □ Sample to verify: ACTIV8 → TJ Moreno & Jana Moreno / Alex Silva
  □ New rows: Out Work, Alex Twin appear in Onboarding tab
□ Click a client card → ClientModal opens, shows tabs (Overview, KPIs, etc.)
□ Client Setup tab — shows the SAME clients as Clients tab (no orphans)
□ Settings → Team — Alex Silva appears with role "scaling_manager"
□ Marketing tab — campaign cards still render (uses business_name now)
□ Systems tab — tickets show "Unknown client" or business name correctly
□ Submit a test support ticket (Build something) — should not error
□ Onboarding form (/onboarding.html) — submit a test signup, verify Supabase row appears with business_name set (NOT name)
`);
