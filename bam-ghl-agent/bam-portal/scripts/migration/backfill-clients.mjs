#!/usr/bin/env node
// Backfill script — populates Supabase `clients` from Notion CLIENT_PROFILES_PAGE.
//
// What it touches per matched client:
//   owner_name           <- Notion "Client Name" (only if null AND Notion value is real)
//   email                <- Notion "Email" (only if null AND value looks like a real email)
//   scaling_manager_id   <- staff lookup on Notion "Scaling Manager" (only if null)
//   notion_page_id       <- set if matched by name (only if null)
//
// Always dry-run unless --apply is passed.
// Read-only against Notion. Idempotent against Supabase.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", ".env.local");
const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=");
      if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY;
const NOTION_KEY = env.NOTION_API_KEY;
const CLIENT_PROFILES_PAGE = "3295aca8ac0f81f09b88c60e84173738";

// ── Per-client overrides (decisions from migration session) ────────────────
// Email for ACTIV8: Notion has "tj@activ8athlete.com / jana@activ8athlete.com" —
// Zoran picked Jana as the primary contact.
const EMAIL_OVERRIDES = {
  "ACTIV8": "jana@activ8athlete.com",
};

// Staff rows we must ensure exist before backfill so scaling_manager_id FK works
const STAFF_TO_ENSURE = [
  { name: "Alex Silva", role: "scaling_manager", email: null },
];

// Notion clients that are real but not in Supabase — create rows for these
const NOTION_ORPHANS_TO_CREATE = [
  { notionTitleContains: "Outwork Everyone", supabaseBusinessName: "Out Work", status: "onboarding", populateAll: true },
  { notionTitleContains: "Alex Twin", supabaseBusinessName: "Alex Twin", status: "onboarding", populateAll: false },
];

if (!SUPABASE_URL || !SUPABASE_KEY || !NOTION_KEY) {
  console.error("Missing env vars (VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, NOTION_API_KEY)");
  process.exit(1);
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
  return true;
}

async function notion(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_KEY}`, "Notion-Version": "2022-06-28" },
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

function richText(arr) {
  return arr?.map(t => t.plain_text || "").join("").trim() || "";
}

async function parseClientInfoFromPage(pageId) {
  const blocks = await notion(`/blocks/${pageId}/children?page_size=100`);
  const info = {};
  const tableBlocks = blocks.results.filter(b => b.type === "table");
  for (const tableBlock of tableBlocks) {
    const rows = await notion(`/blocks/${tableBlock.id}/children?page_size=100`);
    for (const row of rows.results) {
      if (row.type !== "table_row") continue;
      const cells = row.table_row.cells || [];
      if (cells.length < 2) continue;
      const key = richText(cells[0]).replace(/\*+/g, "").trim();
      const value = richText(cells[1]).replace(/\*+/g, "").trim();
      if (!key || key.toLowerCase() === "field" || key.toLowerCase() === "action") continue;
      if (info[key] === undefined) info[key] = value;
    }
    if (info["Client Name"] || info["Business Name"] || info["Client Names"]) break;
  }
  return info;
}

// ── Match helpers ──────────────────────────────────────────────────────────
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")      // strip (DCB), (ACTIV8 LLC)
    .replace(/\+/g, " plus ")     // Basketball+ → Basketball Plus
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]/g, "");
}

function nameMatch(a, b) {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // Substring match only if shorter side is meaningfully long (avoid false positives)
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  return false;
}

function isGarbageValue(v) {
  if (!v) return true;
  const s = v.toLowerCase().trim();
  return (
    s === "" ||
    s === "n/a" ||
    s === "na" ||
    s === "tbd" ||
    s === "(to be confirmed)" ||
    s === "to be confirmed" ||
    s.startsWith("(to be confirmed") ||
    s.includes("to be confirmed")
  );
}

function looksLikeEmail(v) {
  if (!v || isGarbageValue(v)) return false;
  // strip any markdown-style decoration the Notion parser may leave in
  const candidate = v.split(/[\s,/]/)[0].trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
}

function extractEmail(v) {
  if (!looksLikeEmail(v)) return null;
  return v.split(/[\s,/]/)[0].trim().toLowerCase();
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log("=".repeat(80));
console.log(APPLY ? "BACKFILL — APPLY MODE (writes will happen)" : "BACKFILL — DRY RUN (no writes)");
console.log("=".repeat(80));
console.log();

console.log("Loading Supabase clients + staff …");
let [sbClients, sbStaff] = await Promise.all([
  // Select * so we can detect post-migration columns like scaling_manager_id without
  // hard-coding them — pre-migration runs still work because we don't read missing keys.
  sbGet("clients?select=*&order=business_name.asc"),
  sbGet("staff?select=id,name,email,role"),
]);
console.log(`  ${sbClients.length} clients, ${sbStaff.length} staff`);

// ── Ensure required staff rows exist (e.g. Alex Silva) ─────────────────────
const staffActions = [];
for (const required of STAFF_TO_ENSURE) {
  const existing = sbStaff.find(s => normalize(s.name) === normalize(required.name));
  if (existing) {
    staffActions.push({ kind: "exists", name: required.name, id: existing.id });
  } else if (APPLY) {
    const inserted = await sbPost("staff", required);
    const row = inserted[0];
    sbStaff.push(row);
    staffActions.push({ kind: "created", name: required.name, id: row.id, role: required.role });
  } else {
    // Dry run — push a synthetic row so downstream scaling_manager_id matching
    // reflects post-apply state in the report
    const synthetic = { id: `__pending_${required.name.toLowerCase().replace(/\W+/g, "_")}__`, ...required };
    sbStaff.push(synthetic);
    staffActions.push({ kind: "would_create", name: required.name, role: required.role, syntheticId: synthetic.id });
  }
}

console.log("Loading Notion client profile pages …");
const notionChildren = await notion(`/blocks/${CLIENT_PROFILES_PAGE}/children?page_size=100`);
const clientPages = notionChildren.results.filter(b =>
  b.type === "child_page" &&
  !(b.child_page?.title || "").includes("BAM Locations") &&
  !(b.child_page?.title || "").includes("Fathom") &&
  !(b.child_page?.title || "").toLowerCase().includes("sop") &&
  !(b.child_page?.title || "").toLowerCase().includes("phase ") &&
  !(b.child_page?.title || "").toLowerCase().includes("bam business")
);

const notionClients = [];
for (const cp of clientPages) {
  const title = cp.child_page?.title || "";
  if (!title) continue;
  const info = await parseClientInfoFromPage(cp.id);
  notionClients.push({ pageId: cp.id, title, info });
}
console.log(`  ${notionClients.length} Notion client pages parsed`);
console.log();

// ── Match Notion ↔ Supabase ────────────────────────────────────────────────
const matched = [];
const notionOrphans = [];
const supabaseRemaining = [...sbClients];

for (const nc of notionClients) {
  // Skip empty notion pages (no Business Name, no Client Name)
  const business = nc.info["Business Name"] || "";
  const titleBiz = (nc.title || "").replace(/—.*$/, "").trim();
  if (isGarbageValue(business) && !titleBiz) {
    notionOrphans.push({ ...nc, reason: "Empty Notion page" });
    continue;
  }

  // First: match by notion_page_id if already set on the Supabase row
  let match = supabaseRemaining.find(c => c.notion_page_id === nc.pageId);
  // Second: fuzzy match by business name or page title
  if (!match) {
    match = supabaseRemaining.find(c =>
      nameMatch(business, c.business_name) || nameMatch(titleBiz, c.business_name)
    );
  }

  if (match) {
    matched.push({ notion: nc, supabase: match });
    const idx = supabaseRemaining.indexOf(match);
    if (idx > -1) supabaseRemaining.splice(idx, 1);
  } else {
    notionOrphans.push({ ...nc, reason: "No Supabase match" });
  }
}

// ── Compute new-row inserts for the orphan list ────────────────────────────
const insertsPlanned = [];
for (const orphanRule of NOTION_ORPHANS_TO_CREATE) {
  // Find the Notion page that matches
  const found = notionClients.find(nc =>
    (nc.title || "").includes(orphanRule.notionTitleContains) ||
    nameMatch(nc.info["Business Name"], orphanRule.supabaseBusinessName)
  );
  if (!found) {
    console.warn(`  ! Notion orphan rule for "${orphanRule.supabaseBusinessName}" matched no Notion page`);
    continue;
  }

  // Check if it's already in Supabase under any name
  const alreadyExists = sbClients.find(c =>
    nameMatch(c.business_name, orphanRule.supabaseBusinessName) ||
    c.notion_page_id === found.pageId
  );
  if (alreadyExists) {
    console.warn(`  ! "${orphanRule.supabaseBusinessName}" is already in Supabase as "${alreadyExists.business_name}" — skipping insert`);
    continue;
  }

  const newRow = {
    business_name: orphanRule.supabaseBusinessName,
    status: orphanRule.status,
    notion_page_id: found.pageId,
  };

  if (orphanRule.populateAll) {
    // Pull all the standard fields from Notion
    const clientName = found.info["Client Name"] || found.info["Client Names"];
    if (!isGarbageValue(clientName)) newRow.owner_name = clientName;

    const overrideEmail = EMAIL_OVERRIDES[orphanRule.supabaseBusinessName];
    if (overrideEmail) {
      newRow.email = overrideEmail;
    } else {
      const cleanEmail = extractEmail(found.info["Email"] || "");
      if (cleanEmail) newRow.email = cleanEmail;
    }

    const mgrName = found.info["Scaling Manager"] || "";
    if (!isGarbageValue(mgrName)) {
      const normMgr = normalize(mgrName);
      let staffMatch = sbStaff.find(s => normalize(s.name) === normMgr);
      if (!staffMatch) {
        staffMatch = sbStaff.find(s => {
          const ns = normalize(s.name);
          return ns.includes(normMgr) || normMgr.includes(ns);
        });
      }
      if (staffMatch) newRow.scaling_manager_id = staffMatch.id;
    }
  }

  insertsPlanned.push({ rule: orphanRule, notionPage: found, row: newRow });
}

// ── Build patch per matched client ─────────────────────────────────────────
const patches = [];
const staffUnmatched = new Set();
const emailsRejected = []; // for the doc — Notion had something but it didn't pass validation

for (const { notion: nc, supabase: sb } of matched) {
  const patch = {};
  const notes = [];

  // owner_name
  if (!sb.owner_name) {
    const clientName = nc.info["Client Name"] || nc.info["Client Names"] || "";
    if (!isGarbageValue(clientName)) {
      patch.owner_name = clientName;
      notes.push(`owner_name: "${clientName}"`);
    }
  }

  // email — check per-client override first, then parse Notion
  if (!sb.email) {
    const override = EMAIL_OVERRIDES[sb.business_name];
    if (override) {
      patch.email = override;
      notes.push(`email: "${override}" (override)`);
    } else {
      const rawEmail = nc.info["Email"] || "";
      const cleanEmail = extractEmail(rawEmail);
      if (cleanEmail) {
        patch.email = cleanEmail;
        notes.push(`email: "${cleanEmail}"`);
      } else if (rawEmail && !isGarbageValue(rawEmail)) {
        emailsRejected.push({ business: sb.business_name, raw: rawEmail });
      }
    }
  }

  // notion_page_id (set if missing — useful for future matching even when matched-by-name)
  if (!sb.notion_page_id) {
    patch.notion_page_id = nc.pageId;
    notes.push(`notion_page_id: ${nc.pageId}`);
  }

  // scaling_manager_id (only if column will exist post-migration)
  if (!sb.scaling_manager_id) {
    const mgrName = nc.info["Scaling Manager"] || "";
    if (!isGarbageValue(mgrName)) {
      // Match against staff.name. Try exact first, then case-insensitive substring.
      const normMgr = normalize(mgrName);
      let staffMatch = sbStaff.find(s => normalize(s.name) === normMgr);
      if (!staffMatch) {
        staffMatch = sbStaff.find(s => {
          const ns = normalize(s.name);
          return ns.includes(normMgr) || normMgr.includes(ns);
        });
      }
      if (staffMatch) {
        const pending = String(staffMatch.id).startsWith("__pending_");
        patch.scaling_manager_id = staffMatch.id;
        notes.push(`scaling_manager_id: ${staffMatch.id} (${staffMatch.name}${pending ? ", pending insert" : ""})`);
      } else {
        staffUnmatched.add(mgrName);
      }
    }
  }

  if (Object.keys(patch).length) {
    patches.push({ supabaseId: sb.id, supabaseName: sb.business_name, notionTitle: nc.title, patch, notes });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log("─".repeat(80));
console.log(`STAFF ROWS ENSURED: ${staffActions.length}`);
console.log("─".repeat(80));
for (const s of staffActions) {
  if (s.kind === "exists") console.log(`  • ${s.name} — already exists (${s.id})`);
  else if (s.kind === "created") console.log(`  ✓ ${s.name} — CREATED role=${s.role} id=${s.id}`);
  else console.log(`  ? ${s.name} — WOULD CREATE role=${s.role} (dry-run)`);
}
console.log();

console.log("─".repeat(80));
console.log(`NEW CLIENT ROWS TO INSERT (from Notion orphans): ${insertsPlanned.length}`);
console.log("─".repeat(80));
for (const ins of insertsPlanned) {
  console.log(`\n• ${ins.row.business_name} (status=${ins.row.status})`);
  for (const [k, v] of Object.entries(ins.row)) {
    if (k === "business_name" || k === "status") continue;
    console.log(`    ${k}: ${v}`);
  }
}
console.log();

console.log("─".repeat(80));
console.log(`MATCHED: ${matched.length}`);
console.log("─".repeat(80));
for (const m of matched) {
  console.log(`  ✓ "${m.notion.info["Business Name"] || m.notion.title}" → "${m.supabase.business_name}"`);
}
console.log();

console.log("─".repeat(80));
console.log(`PATCHES TO APPLY: ${patches.length}`);
console.log("─".repeat(80));
for (const p of patches) {
  console.log(`\n• ${p.supabaseName} (${p.supabaseId.slice(0, 8)}…)`);
  for (const n of p.notes) console.log(`    ${n}`);
}
console.log();

console.log("─".repeat(80));
console.log(`NOTION ORPHANS (will not be imported): ${notionOrphans.length}`);
console.log("─".repeat(80));
for (const o of notionOrphans) {
  console.log(`  ? ${o.info["Business Name"] || o.title}  [${o.reason}]`);
  if (o.info["Client Name"]) console.log(`     Client Name: ${o.info["Client Name"]}`);
  if (o.info["Scaling Manager"]) console.log(`     Scaling Manager: ${o.info["Scaling Manager"]}`);
  if (o.info["Profile Status"]) console.log(`     Profile Status: ${o.info["Profile Status"]}`);
}
console.log();

console.log("─".repeat(80));
console.log(`SUPABASE CLIENTS WITH NO NOTION MATCH: ${supabaseRemaining.length}`);
console.log("─".repeat(80));
for (const o of supabaseRemaining) {
  console.log(`  ? ${o.business_name}  [${o.notion_page_id ? "has notion_page_id but no matching Notion page" : "no Notion link"}]`);
}
console.log();

console.log("─".repeat(80));
console.log(`SCALING MANAGER NAMES THAT DID NOT MATCH ANY STAFF ROW: ${staffUnmatched.size}`);
console.log("─".repeat(80));
for (const name of staffUnmatched) console.log(`  ? "${name}"`);
console.log();

if (emailsRejected.length) {
  console.log("─".repeat(80));
  console.log(`EMAIL VALUES IN NOTION THAT FAILED VALIDATION: ${emailsRejected.length}`);
  console.log("─".repeat(80));
  for (const e of emailsRejected) console.log(`  ? ${e.business}: "${e.raw}"`);
  console.log();
}

// ── Apply if requested ─────────────────────────────────────────────────────
if (APPLY) {
  console.log("─".repeat(80));
  console.log("APPLYING INSERTS (Notion orphans → new Supabase rows) …");
  console.log("─".repeat(80));
  let iOk = 0, iFail = 0;
  for (const ins of insertsPlanned) {
    try {
      await sbPost("clients", ins.row);
      console.log(`  ✓ Inserted ${ins.row.business_name}`);
      iOk++;
    } catch (err) {
      console.log(`  ✗ Insert ${ins.row.business_name}: ${err.message}`);
      iFail++;
    }
  }
  console.log(`  Inserts: ${iOk} ok, ${iFail} failed.\n`);

  console.log("─".repeat(80));
  console.log("APPLYING PATCHES …");
  console.log("─".repeat(80));
  let ok = 0, fail = 0;
  for (const p of patches) {
    try {
      await sbPatch(`clients?id=eq.${p.supabaseId}`, { ...p.patch, updated_at: new Date().toISOString() });
      console.log(`  ✓ ${p.supabaseName}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ ${p.supabaseName}: ${err.message}`);
      fail++;
    }
  }
  console.log();
  console.log(`Patches: ${ok} ok, ${fail} failed.`);
} else {
  console.log("─".repeat(80));
  console.log("DRY RUN — no writes performed. Re-run with --apply to commit.");
  console.log("─".repeat(80));
}
