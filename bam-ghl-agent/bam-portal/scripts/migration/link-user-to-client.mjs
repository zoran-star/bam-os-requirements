#!/usr/bin/env node
// One-shot account linker.
//
// Fixes "Your account is not linked to a client." on the multi-user client
// portal. The portal resolves access ONLY from the `client_users` join table
// (via the my_client_ids() RLS predicate). A Supabase auth user with no
// client_users row — even if clients.auth_user_id points at them — gets the
// "not linked" wall. This script creates/reactivates that membership row.
//
// DRY-RUN by default — prints the plan and writes nothing. Pass --apply to
// commit the change.
//
// Usage:
//   node link-user-to-client.mjs --email gabe@adaptacademysd.com [--client "adapt"] [--apply]
//
// Credentials are read from (in order): process.env, then ../../.env.local.
// Needs: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_KEY.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- args ----
const args = process.argv.slice(2);
function arg(name, def = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const EMAIL = (arg("email") || "").toString().trim().toLowerCase();
const CLIENT_MATCH = (arg("client") || "").toString().trim().toLowerCase();
const APPLY = args.includes("--apply");

if (!EMAIL) {
  console.error("Usage: node link-user-to-client.mjs --email <addr> [--client <name-substring>] [--apply]");
  process.exit(1);
}

// ---- env (process.env wins, then .env.local) ----
function loadEnvFile() {
  try {
    const raw = readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8");
    return Object.fromEntries(
      raw.split("\n").filter(l => l && !l.startsWith("#")).map(l => {
        const idx = l.indexOf("=");
        if (idx === -1) return ["", ""];
        let v = l.slice(idx + 1);
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
        return [l.slice(0, idx).trim(), v];
      })
    );
  } catch {
    return {};
  }
}
const fileEnv = loadEnvFile();
const pick = (...keys) => keys.map(k => process.env[k] || fileEnv[k]).find(Boolean);

const SUPABASE_URL = pick("SUPABASE_URL", "VITE_SUPABASE_URL");
const SERVICE_KEY = pick("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY.");
  console.error("Set them in the environment or in bam-portal/.env.local.");
  process.exit(1);
}

const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function findAuthUserByEmail(email) {
  // Page through the GoTrue admin user list and match by email.
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!res.ok) throw new Error(`GoTrue ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const users = body.users || [];
    const hit = users.find(u => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) break; // last page
  }
  return null;
}

function fmt(c) {
  return `  • ${c.business_name || c.name || "(no name)"}  [${c.id}]  auth_user_id=${c.auth_user_id || "—"}`;
}

(async () => {
  console.log(`\n🔗 Account linker — ${APPLY ? "APPLY" : "DRY RUN"}\n`);
  console.log(`Email:  ${EMAIL}`);

  // 1) auth user
  const user = await findAuthUserByEmail(EMAIL);
  if (!user) {
    console.error(`\n❌ No Supabase auth user found for ${EMAIL}.`);
    console.error(`   They must sign up / be invited first (so an auth.users row exists).`);
    process.exit(2);
  }
  console.log(`Auth user: ${user.id}  (confirmed: ${!!user.email_confirmed_at})`);

  // 2) candidate client(s)
  const defaultMatch = CLIENT_MATCH || EMAIL.split("@")[1]?.split(".")[0] || "";
  const clients = await rest(
    `clients?select=id,business_name,name,auth_user_id,status&or=(business_name.ilike.*${encodeURIComponent(defaultMatch)}*,name.ilike.*${encodeURIComponent(defaultMatch)}*)`
  );
  console.log(`\nClient matches for "${defaultMatch}":`);
  if (!clients.length) {
    console.error("  (none)");
    console.error(`\n❌ No client matched. Re-run with --client "<part of academy name>".`);
    console.error(`   Or the academy may not exist in 'clients' yet — create it in the staff portal first.`);
    process.exit(3);
  }
  clients.forEach(c => console.log(fmt(c)));

  if (clients.length > 1) {
    console.error(`\n⚠️  ${clients.length} clients matched — narrow it with --client "<unique name>" and re-run.`);
    process.exit(4);
  }
  const client = clients[0];

  // 3) existing membership?
  const existing = await rest(
    `client_users?user_id=eq.${user.id}&client_id=eq.${client.id}&select=id,role,status`
  );
  const isOwner = client.auth_user_id === user.id;
  const role = isOwner ? "owner" : "member";

  console.log(`\nPlan:`);
  console.log(`  link ${EMAIL}`);
  console.log(`    → ${client.business_name || client.name} [${client.id}]`);
  console.log(`    role=${role} (auth_user_id ${isOwner ? "matches → owner" : "differs → member"}), status=active`);

  if (existing?.length) {
    console.log(`  (existing row ${existing[0].id}: role=${existing[0].role}, status=${existing[0].status} → will reactivate)`);
  }

  if (!APPLY) {
    console.log(`\n🟡 DRY RUN — nothing written. Re-run with --apply to commit.\n`);
    return;
  }

  // 4) apply
  if (existing?.length) {
    await rest(`client_users?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ role, status: "active" }),
    });
    console.log(`\n✅ Reactivated client_users row ${existing[0].id}.`);
  } else {
    const inserted = await rest("client_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        client_id: client.id,
        name: user.user_metadata?.name || EMAIL.split("@")[0],
        email: EMAIL,
        role,
        status: "active",
      }),
    });
    console.log(`\n✅ Created client_users row ${inserted?.[0]?.id || "(ok)"}.`);
  }
  console.log(`   ${EMAIL} can now sign in and reach ${client.business_name || client.name}.\n`);
})().catch(err => {
  console.error(`\n💥 ${err.message}`);
  process.exit(1);
});
