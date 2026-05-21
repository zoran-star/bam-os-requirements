// Member Management — full migration runner
//
// Does the entire go-live in one command, given a Supabase personal access
// token (account-level — reaches both projects via the Management API):
//   1. Create the 5 tables in the PORTAL project (runs member-management-schema.sql)
//   2. Read BAM GTA's LIVE roster from the GTA project
//   3. Insert that roster into the portal `members` table, scoped to BAM GTA
//   4. Verify the row count
//
// Usage:  node run-member-management-migration.mjs <SUPABASE_PERSONAL_ACCESS_TOKEN>
// Create a token at: https://supabase.com/dashboard/account/tokens
//
// Re-runnable: the schema SQL is idempotent; the roster load deletes BAM
// GTA's existing members first so it never duplicates.

import fs from 'fs';

const PAT = process.argv[2];
if (!PAT || !PAT.startsWith('sbp_')) {
  console.error('Usage: node run-member-management-migration.mjs <sbp_... token>');
  process.exit(1);
}

const PORTAL_REF = 'jnojmfmpnsfmtqmwhopz';                       // client portal project
const GTA_REF    = 'oatwstyzxreujgsbmaxr';                       // BAM GTA project
const BAM_GTA_CLIENT_ID = '39875f07-0a4b-4429-a201-2249bc1f24df'; // clients row, business_name 'BAM GTA'

const COLS = [
  'athlete_name', 'archetype', 'trainer', 'group_num', 'plan', 'status',
  'engagement', 'skill_notes', 'parent_name', 'parent_archetype',
  'parent_email', 'parent_phone', 'stripe_customer_id',
  'stripe_subscription_id', 'ghl_contact_id', 'coachiq_member_id', 'joined_date',
];

// ── env (portal service key, for the REST insert) ──
const envTxt = fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envTxt.split('\n')) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  let v = line.slice(i + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) { try { v = JSON.parse(v); } catch {} }
  env[line.slice(0, i).trim()] = v.trim();
}
const PORTAL_URL = env.VITE_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_KEY;

// ── helpers ──
async function mgmtQuery(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status} on ${ref}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function rest(method, path, body) {
  const r = await fetch(`${PORTAL_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SVC, Authorization: `Bearer ${SVC}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`REST ${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// ── run ──
console.log('Member Management migration — starting\n');

// STEP 1 — create the tables in the portal
console.log('[1/4] Creating tables in the portal project…');
const schemaSql = fs.readFileSync(
  new URL('../../supabase/member-management-schema.sql', import.meta.url), 'utf8');
await mgmtQuery(PORTAL_REF, schemaSql);
console.log('      ✓ schema applied (members, cancellations, referrals, refunds, member_audit_log)\n');

// STEP 2 — read BAM GTA's live roster
console.log('[2/4] Reading BAM GTA\'s live roster from the GTA project…');
const gtaRows = await mgmtQuery(GTA_REF, `SELECT ${COLS.join(', ')} FROM members ORDER BY athlete_name`);
console.log(`      ✓ ${gtaRows.length} athletes pulled\n`);

// STEP 3 — load into the portal, scoped to BAM GTA
console.log('[3/4] Loading roster into the portal…');
await rest('DELETE', `members?client_id=eq.${BAM_GTA_CLIENT_ID}`); // idempotent re-run
const portalRows = gtaRows.map(r => {
  const row = { client_id: BAM_GTA_CLIENT_ID };
  for (const c of COLS) row[c] = r[c] ?? null;
  return row;
});
const inserted = portalRows.length ? await rest('POST', 'members', portalRows) : [];
console.log(`      ✓ ${inserted.length} members inserted under BAM GTA\n`);

// STEP 4 — verify
console.log('[4/4] Verifying…');
const check = await rest('GET', `members?client_id=eq.${BAM_GTA_CLIENT_ID}&select=status`);
const live = check.filter(m => m.status === 'live').length;
const paused = check.filter(m => m.status === 'paused').length;
console.log(`      ✓ portal members for BAM GTA: ${check.length} total · ${live} live · ${paused} paused\n`);

console.log('Done. Next: flip MEMBER_MGMT_ENABLED → true in client-portal.html, commit, push.');
