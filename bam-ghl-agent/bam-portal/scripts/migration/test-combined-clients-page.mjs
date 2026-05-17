#!/usr/bin/env node
// Automated tests for the combined Clients page (list + per-client tabs).
// Validates the schema additions, the new API actions, and the data shape
// the React view expects. Read-only against existing data; uses a test row
// for write tests then rolls back.
//
// Usage:
//   node scripts/migration/test-combined-clients-page.mjs              # DB only
//   node scripts/migration/test-combined-clients-page.mjs --api=local  # + http://localhost:3000
//   node scripts/migration/test-combined-clients-page.mjs --api=prod   # + bam-portal-tawny.vercel.app

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

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
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
console.log("COMBINED CLIENTS PAGE — TEST SUITE");
console.log("━".repeat(72));

// ─── 1. Schema additions ───────────────────────────────────────────────────
console.log("\n[Schema additions]");
try {
  await sb("client_notes?select=id&limit=1");
  check("client_notes table exists", true);
} catch (e) {
  check("client_notes table exists", false, e.message);
}
try {
  await sb("clients?select=archived_at&limit=1");
  check("clients.archived_at column exists", true);
} catch (e) {
  check("clients.archived_at column exists", false, e.message);
}

// ─── 2. Existing data shape is intact ──────────────────────────────────────
console.log("\n[Existing data intact]");
const sampleClients = await sb("clients?select=id,business_name,owner_name,status,scaling_manager_id,slack_channel_id,ghl_location_id,stripe_customer_id,notion_page_id,archived_at&limit=5");
check(`Returned ≥3 client rows (${sampleClients.length})`, sampleClients.length >= 3);
check("Every row has business_name", sampleClients.every(c => c.business_name));
check("No row has stale `name` field (no leak)", sampleClients.every(c => !("name" in c)));

// ─── 3. Slack channel parser (logic in the React view) ─────────────────────
console.log("\n[Slack channel parser (logic copy of the React fn)]");
function parseSlackChannel(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[CGD][A-Z0-9]{8,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/[CGD][A-Z0-9]{8,}/);
  return m ? m[0] : null;
}
check("Bare ID passthrough: C01ABCDE2", parseSlackChannel("C01ABCDE2") === "C01ABCDE2");
check("Slack URL: ...archives/C01ABCDE2", parseSlackChannel("https://example.slack.com/archives/C01ABCDE2/p1234") === "C01ABCDE2");
check("Query string form", parseSlackChannel("https://slack.com/?team=T01ABC&channel=C0987XYZA") === "C0987XYZA");
check("Trim whitespace", parseSlackChannel("   C01ABCDE2   ") === "C01ABCDE2");
check("Garbage returns null", parseSlackChannel("not a channel") === null);
check("Empty returns null", parseSlackChannel("") === null);

// ─── 4. Notes table write/read roundtrip ───────────────────────────────────
console.log("\n[client_notes roundtrip]");
const testClient = sampleClients[0];
let createdNoteId = null;
try {
  const created = await sb("client_notes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ client_id: testClient.id, body: "TEST NOTE — automated test, will be deleted" }),
  });
  createdNoteId = Array.isArray(created) ? created[0]?.id : created?.id;
  check("Insert note succeeds", !!createdNoteId);

  const fetched = await sb(`client_notes?id=eq.${createdNoteId}&select=body`);
  check("Insert is persistent + readable", fetched?.[0]?.body?.startsWith("TEST NOTE"));

  if (createdNoteId) {
    await sb(`client_notes?id=eq.${createdNoteId}`, { method: "DELETE" });
    const after = await sb(`client_notes?id=eq.${createdNoteId}`);
    check("Note deletes cleanly", after.length === 0);
  }
} catch (e) {
  check("Note CRUD roundtrip", false, e.message);
  if (createdNoteId) {
    try { await sb(`client_notes?id=eq.${createdNoteId}`, { method: "DELETE" }); } catch {}
  }
}

// ─── 5. Archive flag (no actual write) ─────────────────────────────────────
console.log("\n[Archive filter logic]");
const allActive = await sb("clients?archived_at=is.null&select=id");
const allArchived = await sb("clients?archived_at=not.is.null&select=id");
const total = await sb("clients?select=id");
check(`Active + archived = total (${allActive.length} + ${allArchived.length} = ${total.length})`,
  allActive.length + allArchived.length === total.length);

// ─── 6. FK integrity for scaling_manager_id stays clean ────────────────────
console.log("\n[Referential integrity]");
const withMgr = await sb("clients?scaling_manager_id=not.is.null&select=id,scaling_manager_id");
const staffIds = new Set((await sb("staff?select=id")).map(s => s.id));
const orphans = withMgr.filter(c => !staffIds.has(c.scaling_manager_id));
check("No client points to a missing scaling manager", orphans.length === 0,
  orphans.length ? `${orphans.length} orphans` : "");

// ─── 7. API smoke tests (only if --api flag passed) ────────────────────────
if (apiBase) {
  console.log();
  console.log("━".repeat(72));
  console.log(`API SMOKE — ${apiBase}`);
  console.log("━".repeat(72));

  try {
    const res = await fetch(`${apiBase}/api/clients`);
    check(`GET /api/clients reachable (200 or 401)`, res.status === 200 || res.status === 401);
    if (res.ok) {
      const json = await res.json();
      const data = json.data || json;
      check("Returns array", Array.isArray(data));
      const sample = data?.[0];
      check("Sample row has business_name", sample?.business_name);
      check("Sample row has scaling_manager_id key", sample && "scaling_manager_id" in sample);
    }
  } catch (e) {
    check(`GET /api/clients reachable`, false, e.message);
  }

  // Note: action=update-fields, action=archive, etc. all require staff auth
  // (a real Bearer token from a logged-in staff session). Auth flow isn't
  // automated here — those are exercised via the UI checklist below.
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log();
console.log("━".repeat(72));
console.log(`RESULTS: ${pass} passed, ${fail} failed`);
console.log("━".repeat(72));

if (fail > 0) {
  console.log("\n❌ Some checks failed — investigate before shipping.");
  process.exit(1);
}

console.log("\n✅ All automated checks passed!\n");
console.log("━".repeat(72));
console.log("MANUAL UI CHECKLIST  (open http://localhost:5173/  → Clients tab)");
console.log("━".repeat(72));
console.log(`
LIST VIEW
□ Page loads; "Total / Active / Onboarding" stats render at top
□ Search box filters by business name AND owner name
□ Status pills filter (Active / Onboarding / Paused / Churned / All)
□ Sort dropdown switches between A→Z and Recently added
□ "+ New client" button visible if you're admin or scaling_manager
□ Click any row → navigates to that client's detail view

DETAIL VIEW — OVERVIEW TAB
□ Header shows business name + owner/email/manager + status pill
□ Breadcrumb "← Clients / [business]" navigates back when clicked
□ Profile section lists Business Name, Owner, Email, Scaling Manager, Status, Created
□ Quick links section shows Slack/GHL/Stripe/Notion (with "Not linked" for empty)
□ Auth section shows status (Active / Ready to invite / No email)
□ Admin/scaling: Stripe MRR + billing status shown
□ Non-admin/scaling: financial section hidden

DETAIL VIEW — SETUP TAB
□ All fields editable inline (business_name, owner_name, email, status, manager dropdown)
□ Slack channel field auto-parses a pasted Slack URL into the channel ID on save
□ Stripe customer ID + Notion page ID only show if admin/scaling
□ "Save changes" button greyed out until something is edited
□ "Discard" button reverts unsaved edits
□ Account management section shows "Send portal invite" or "Send password reset"
□ Danger zone shows Archive button (admin/scaling only)

DETAIL VIEW — MARKETING TAB
□ If client has no meta_ad_account_id, shows "No Meta ad account linked"
□ If client has Meta wired, shows active campaigns
□ Each campaign row links to https://www.facebook.com/adsmanager/... on click

DETAIL VIEW — ACTIVITY TAB
□ Hidden for non-admin/scaling staff
□ Recent tickets table shows up to 10 most recent (or "No tickets yet")

DETAIL VIEW — NOTES TAB
□ Add-note textarea + "Add note" button works
□ New note appears immediately at top of feed
□ Note shows author name + timestamp
□ Empty state shows "No notes yet. Be the first to add one."

PERMISSIONS (test by changing your role in Settings → Team if dev mode)
□ As admin: see all tabs, can edit all fields, can archive
□ As scaling_manager: same as admin
□ As marketing_executor: cannot see Activity tab, cannot see Stripe ID field
□ As systems_executor: same as marketing (no financial data)

INTEGRATION
□ Editing a field then clicking Save → row updates + persists across reload
□ Archive → client disappears from active list, row gets archived_at timestamp
□ New client modal: "Send portal invite" checkbox conditionally requires email + owner
`);
