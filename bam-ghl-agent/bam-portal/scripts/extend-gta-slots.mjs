// Extend BAM GTA's schedule on the portal runtime spine: re-run Luka's
// idempotent generate-slots for the next 60 days (skips existing slots, never
// overwrites manual edits), then verify coverage. Boundary-safe: slots are only
// created through the Luka-owned staff endpoints, never direct inserts.
//
// Run monthly (a scheduled Routine does this; safe to also run by hand):
//   1. vercel env pull /tmp/bam-portal.env --environment=production \
//        --scope zoran-stars-projects   (from the linked bam-portal dir)
//   2. node scripts/extend-gta-slots.mjs /tmp/bam-portal.env
//
// Auth: Luka's endpoints need a real staff login, so this mints a TEMP staff
// user (service role), signs in, calls the endpoints, then deletes the temp
// user - even on failure.

import { readFileSync } from "node:fs";

const envPath = process.argv[2];
if (!envPath) { console.error("usage: node scripts/extend-gta-slots.mjs <path-to-env-file>"); process.exit(1); }
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").replace(/(\\n)+$/g, "").trim()])
);
const SB_URL = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim();
const SERVICE = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "").trim();
const ANON = (env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
const PORTAL = "https://portal.byanymeansbusiness.com";
const CLIENT = "39875f07-0a4b-4429-a201-2249bc1f24df"; // BAM GTA
if (!SB_URL || !SERVICE || !ANON) { console.error("missing env values"); process.exit(1); }

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } };
const EMAIL = `slot-extender-${Date.now()}@byanymeansbball.com`;
const PASS = crypto.randomUUID() + "A1!";

let userId = null, staffId = null, failed = false;
try {
  const u = await j(await fetch(`${SB_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) }));
  userId = u.id || u.user?.id;
  if (!userId) throw new Error("temp user create failed: " + JSON.stringify(u).slice(0, 150));
  const st = await j(await fetch(`${SB_URL}/rest/v1/staff`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify([{ name: "Slot Extender (temp)", role: "admin", email: EMAIL, user_id: userId }]) }));
  staffId = Array.isArray(st) && st[0]?.id;
  if (!staffId) throw new Error("temp staff insert failed");
  const si = await j(await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) }));
  const JWT = si.access_token;
  if (!JWT) throw new Error("temp sign-in failed");
  const auth = { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" };

  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const g = await j(await fetch(`${PORTAL}/api/runtime/schedule/generate-slots`, { method: "POST", headers: auth, body: JSON.stringify({ client_id: CLIENT, date_from: today, date_to: to }) }));
  console.log(`generate-slots ${today} -> ${to}:`, JSON.stringify({ created: g.created, skipped_existing: g.skipped_existing, skipped_no_recurrence: g.skipped_no_recurrence }));
  if (g.created == null) { failed = true; console.error("generation response unexpected:", JSON.stringify(g).slice(0, 300)); }

  // Verify: how far out does coverage actually reach?
  const last = await j(await fetch(`${SB_URL}/rest/v1/schedule_slots?tenant_id=eq.${CLIENT}&is_cancelled=eq.false&select=start_time&order=start_time.desc&limit=1`, { headers: H }));
  const lastStart = Array.isArray(last) && last[0]?.start_time;
  const daysOut = lastStart ? Math.round((new Date(lastStart) - Date.now()) / 86400000) : -1;
  console.log(`coverage: last slot ${lastStart} (${daysOut} days out)`);
  if (daysOut < 30) { failed = true; console.error(`⚠️ coverage under 30 days - investigate (templates inactive? recurrence_end_date set?)`); }
} catch (e) {
  failed = true;
  console.error("FAILED:", e.message);
} finally {
  if (staffId) await fetch(`${SB_URL}/rest/v1/staff?id=eq.${staffId}`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } }).catch(() => {});
  if (userId) await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: H }).catch(() => {});
  console.log("temp identities cleaned");
}
process.exit(failed ? 1 : 0);
