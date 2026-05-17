#!/usr/bin/env node
// One-shot inspector: shows every row in Supabase `clients`, every page under
// Notion CLIENT_PROFILES_PAGE, and which fields are populated on each side.
// Read-only. No writes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", ".env.local");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=");
      if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      // Vercel env pull encodes embedded newlines as literal \n — strip them
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY;
const NOTION_KEY = env.NOTION_API_KEY;
const CLIENT_PROFILES_PAGE = "3295aca8ac0f81f09b88c60e84173738";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}
if (!NOTION_KEY) {
  console.error("Missing NOTION_API_KEY in .env.local");
  process.exit(1);
}

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notion(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      "Notion-Version": "2022-06-28",
    },
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

function richText(arr) {
  return arr?.map(t => t.plain_text || "").join("").trim() || "";
}

function parseClientInfoTable(blocks) {
  // Find a table block and parse rows as key/value pairs.
  const info = {};
  for (const block of blocks) {
    if (block.type !== "table") continue;
    // Table rows are children of the table block — but the API returned
    // children block, so we work with whatever we got. If the rows aren't
    // here, return what we have.
  }
  return info;
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
      // Only capture the Client Info table (skip the Action Items table)
      if (info[key] === undefined) info[key] = value;
    }
    // Stop after first table that looks like the Client Info table
    if (info["Client Name"] || info["Business Name"]) break;
  }
  return info;
}

console.log("=".repeat(80));
console.log("SUPABASE clients table");
console.log("=".repeat(80));

const sbClients = await sb("clients?select=*&order=name.asc");
console.log(`\nTotal rows: ${sbClients.length}\n`);
const cols = Object.keys(sbClients[0] || {});
console.log("Columns:", cols.join(", "));
console.log();

for (const c of sbClients) {
  const filled = Object.entries(c)
    .filter(([k, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k]) => k);
  const empty = cols.filter(k => !filled.includes(k));
  console.log(`• ${c.name || "(no name)"}  [${c.status}]`);
  console.log(`    id: ${c.id}`);
  console.log(`    notion_page_id: ${c.notion_page_id || "(null)"}`);
  console.log(`    filled: ${filled.length}/${cols.length}`);
  if (empty.length) console.log(`    EMPTY: ${empty.join(", ")}`);
  console.log();
}

console.log("=".repeat(80));
console.log("NOTION client profile pages");
console.log("=".repeat(80));

const notionChildren = await notion(`/blocks/${CLIENT_PROFILES_PAGE}/children?page_size=100`);
const clientPages = notionChildren.results.filter(b =>
  b.type === "child_page" &&
  !(b.child_page?.title || "").includes("BAM Locations") &&
  !(b.child_page?.title || "").includes("Fathom") &&
  !(b.child_page?.title || "").toLowerCase().includes("sop") &&
  !(b.child_page?.title || "").toLowerCase().includes("phase ") &&
  !(b.child_page?.title || "").toLowerCase().includes("bam business")
);

console.log(`\nFound ${clientPages.length} client profile pages.\n`);

const notionClients = [];
for (const cp of clientPages) {
  const title = cp.child_page?.title || "(untitled)";
  process.stdout.write(`Fetching: ${title} ... `);
  try {
    const info = await parseClientInfoFromPage(cp.id);
    notionClients.push({
      pageId: cp.id,
      title,
      info,
    });
    console.log(`✓ ${Object.keys(info).length} fields`);
  } catch (err) {
    console.log(`✗ ${err.message}`);
  }
}

console.log();
console.log("=".repeat(80));
console.log("NOTION client field summary");
console.log("=".repeat(80));
console.log();

for (const nc of notionClients) {
  console.log(`• ${nc.title}`);
  console.log(`    pageId: ${nc.pageId}`);
  for (const [k, v] of Object.entries(nc.info)) {
    const truncated = v.length > 60 ? v.slice(0, 60) + "…" : v;
    console.log(`    ${k.padEnd(20)} ${truncated}`);
  }
  console.log();
}

console.log("=".repeat(80));
console.log("MATCH ANALYSIS");
console.log("=".repeat(80));
console.log();

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const matched = [];
const notionOrphans = [];
const supabaseOrphans = [...sbClients];

for (const nc of notionClients) {
  const business = nc.info["Business Name"] || "";
  const titleBiz = (nc.title || "").replace(/—.*$/, "").trim();
  const candidates = [business, titleBiz].filter(Boolean).map(normalize);

  let match = null;
  // First: match by notion_page_id if already set
  match = supabaseOrphans.find(c => c.notion_page_id === nc.pageId);
  if (!match) {
    // Second: match by name normalize
    match = supabaseOrphans.find(c => candidates.includes(normalize(c.name)));
  }

  if (match) {
    matched.push({ notion: nc, supabase: match });
    const idx = supabaseOrphans.indexOf(match);
    if (idx > -1) supabaseOrphans.splice(idx, 1);
  } else {
    notionOrphans.push(nc);
  }
}

console.log(`MATCHED (${matched.length}):`);
for (const m of matched) {
  console.log(`  ✓ Notion "${m.notion.info["Business Name"] || m.notion.title}" → Supabase "${m.supabase.name}" (${m.supabase.id.slice(0, 8)}…)`);
}
console.log();

console.log(`NOTION ORPHANS (${notionOrphans.length}) — in Notion, not in Supabase:`);
for (const o of notionOrphans) {
  console.log(`  ? ${o.info["Business Name"] || o.title}  [Status: ${o.info["Profile Status"] || "unknown"}]`);
}
console.log();

console.log(`SUPABASE ORPHANS (${supabaseOrphans.length}) — in Supabase, no Notion match:`);
for (const o of supabaseOrphans) {
  console.log(`  ? ${o.name}  [Status: ${o.status}]`);
}
console.log();

console.log("=".repeat(80));
console.log("DONE — read-only inspection complete. No writes performed.");
console.log("=".repeat(80));
