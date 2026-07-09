#!/usr/bin/env node
// gta-coverage-check.mjs
// -----------------------------------------------------------------------------
// GOAL: every OPEN card in the BAM GTA sales pipeline must be EITHER
//   (A) in an active automation enrollment, OR
//   (B) carrying a proposed agent action (pending/approved Hawkeye card).
// This script reports the cards that are in NEITHER bucket, and (with --fix)
// enrolls them into an automation "from the beginning" (step 1).
//
// GTA is a PORTAL academy, so its pipeline cards live in Supabase `opportunities`
// (not GHL). That means this whole check + fix needs ONLY the Supabase service key.
//
// SAFETY: the fix path imports the REAL production enrollContact() from
// ../api/automations.js, so enrollment, dedupe (one active per contact per
// automation), first-step scheduling, and quiet-hours are byte-identical to
// what the app does. It NEVER instant-texts unless step 1 itself has a 0 wait,
// and it is idempotent (already-enrolled contacts are skipped).
//
// USAGE
//   Set env first (same names the app uses):
//     export VITE_SUPABASE_URL=... (or SUPABASE_URL=...)
//     export SUPABASE_SERVICE_ROLE_KEY=...
//
//   node scripts/gta-coverage-check.mjs                 # DRY RUN - just report
//   node scripts/gta-coverage-check.mjs --fix           # enroll uncovered -> nurture
//   node scripts/gta-coverage-check.mjs --fix --key ghosted
//   node scripts/gta-coverage-check.mjs --client-id <uuid>   # skip name lookup
// -----------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env: set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const DO_FIX = argv.includes("--fix");
const KEY_ARG = (() => { const i = argv.indexOf("--key"); return i >= 0 ? argv[i + 1] : "nurture"; })();
const CLIENT_ID_ARG = (() => { const i = argv.indexOf("--client-id"); return i >= 0 ? argv[i + 1] : null; })();

// Terminal stage roles never need coverage (mirrors api/agent/_store.js roleIsTerminal
// plus the strip's terminal stages). A card in one of these is done, not stuck.
const TERMINAL_ROLES = new Set(["won", "unqualified", "lost", "member"]);
const CARD_TABLES = ["agent_ready_replies", "agent_confirm_replies", "agent_closing_replies"];

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : [];
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

async function resolveClientId() {
  if (CLIENT_ID_ARG) return CLIENT_ID_ARG;
  const rows = await sb(`clients?business_name=ilike.*gta*&select=id,business_name,booking_provider&limit=20`);
  if (!rows.length) throw new Error("No client matched business_name ilike '*gta*'. Pass --client-id <uuid>.");
  if (rows.length > 1) {
    console.error("Multiple GTA-ish clients found - re-run with --client-id <uuid>:");
    rows.forEach(r => console.error(`  ${r.id}  ${r.business_name}  (${r.booking_provider || "?"})`));
    process.exit(1);
  }
  console.log(`GTA client: ${rows[0].business_name}  id=${rows[0].id}  provider=${rows[0].booking_provider || "?"}`);
  return rows[0].id;
}

async function loadCoverage(clientId) {
  // One active enrollment => covered. Pull every active-enrolled contact_id.
  const enr = await sb(`automation_enrollments?client_id=eq.${clientId}&status=eq.active&select=contact_id&limit=100000`);
  const enrolled = new Set(enr.map(r => String(r.contact_id)));

  // Any pending/approved card in any of the 3 agent tables => covered.
  const carded = new Set();
  for (const t of CARD_TABLES) {
    const rows = await sb(`${t}?client_id=eq.${clientId}&status=in.(pending,approved)&select=ghl_contact_id&limit=100000`);
    rows.forEach(r => r.ghl_contact_id && carded.add(String(r.ghl_contact_id)));
  }
  return { enrolled, carded };
}

async function loadOpenCards(clientId) {
  const rows = await sb(
    `opportunities?client_id=eq.${clientId}` +
    `&select=id,ghl_opportunity_id,ghl_contact_id,contact_name,athlete_name,stage_role,status,last_stage_change_at,updated_at` +
    `&limit=100000`
  );
  // Open, non-terminal only. status column varies; treat anything not open/blank as closed.
  return rows.filter(o => {
    const st = String(o.status || "").toLowerCase();
    const openish = st === "" || st === "open";
    return openish && !TERMINAL_ROLES.has(String(o.stage_role || "").toLowerCase());
  });
}

function coverageOf(card, { enrolled, carded }) {
  const cid = card.ghl_contact_id ? String(card.ghl_contact_id) : null;
  if (!cid) return { covered: false, reason: "NO_CONTACT_ID" };
  if (enrolled.has(cid)) return { covered: true, reason: "automation" };
  if (carded.has(cid)) return { covered: true, reason: "agent_action" };
  return { covered: false, reason: "UNCOVERED" };
}

function report(uncovered) {
  if (!uncovered.length) { console.log("\n✅ 0 uncovered cards - every open GTA card is in an automation or has a proposed action."); return; }
  console.log(`\n⚠️  ${uncovered.length} UNCOVERED card(s):\n`);
  console.log("  " + ["stage_role", "days_idle", "name", "contact_id", "flag"].join("  |  "));
  for (const { card } of uncovered) {
    const idle = daysSince(card.last_stage_change_at || card.updated_at);
    const nm = card.athlete_name || card.contact_name || "(no name)";
    const flag = card.ghl_contact_id ? "" : "NO_CONTACT_ID(manual)";
    console.log("  " + [card.stage_role || "?", idle == null ? "?" : idle + "d", nm, card.ghl_contact_id || "-", flag].join("  |  "));
  }
}

async function main() {
  const clientId = await resolveClientId();
  const [cards, cov] = await Promise.all([loadOpenCards(clientId), loadCoverage(clientId)]);
  console.log(`Open non-terminal cards: ${cards.length}  |  active enrollments: ${cov.enrolled.size}  |  carded contacts: ${cov.carded.size}`);

  const uncovered = cards.map(card => ({ card, c: coverageOf(card, cov) })).filter(x => !x.c.covered);
  report(uncovered);

  if (!DO_FIX || !uncovered.length) {
    if (!DO_FIX && uncovered.length) console.log("\nDRY RUN. Re-run with --fix to enroll these into the automation from step 1.");
    return;
  }

  // ---- FIX: enroll uncovered contacts using the REAL production helper ----
  const enrollable = uncovered.filter(x => x.card.ghl_contact_id);
  const manual = uncovered.length - enrollable.length;
  console.log(`\n--fix: enrolling ${enrollable.length} contact(s) into "${KEY_ARG}" from step 1${manual ? ` (${manual} skipped: no contact_id)` : ""}...\n`);

  const { enrollContact } = await import("../api/automations.js");
  let ok = 0, skipped = 0;
  const skipReasons = {};
  for (const { card } of enrollable) {
    const r = await enrollContact({ clientId, automationKey: KEY_ARG, contactId: String(card.ghl_contact_id) });
    if (r && r.ok) { ok++; console.log(`  ✓ ${card.athlete_name || card.contact_name || card.ghl_contact_id}`); }
    else { skipped++; const why = (r && r.skipped) || "unknown"; skipReasons[why] = (skipReasons[why] || 0) + 1; console.log(`  - ${card.athlete_name || card.contact_name || card.ghl_contact_id}: ${why}`); }
  }
  console.log(`\nEnrolled: ${ok}  |  Skipped: ${skipped}`);
  if (Object.keys(skipReasons).length) console.log("Skip reasons:", skipReasons);
  if (skipReasons["no enabled+approved automation"]) {
    console.log(`\n⛔ "${KEY_ARG}" automation is not enabled+approved for GTA - enrollment can't fire until it is.`);
    console.log(`   Enable+approve it in the portal (Automations step-builder), then re-run --fix.`);
  }

  // Re-check so we print a real before/after.
  const cov2 = await loadCoverage(clientId);
  const still = cards.map(card => ({ card, c: coverageOf(card, cov2) })).filter(x => !x.c.covered && x.card.ghl_contact_id);
  console.log(`\nAfter fix: ${still.length} still uncovered (had ${enrollable.length}).`);
  if (!still.length) console.log("✅ Every enrollable open GTA card is now covered.");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
