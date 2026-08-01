#!/usr/bin/env node
// One-shot GHL -> portal contact refresh for a SINGLE academy, run by hand.
//
// WHY THIS EXISTS. api/ghl/cron-sync-contacts.js only mirrors GHL contacts into
// ghl_contacts + the portal contacts store inside its v15_access block, so a
// v2-only academy on contact_provider='ghl' (e.g. BAM San Jose) gets NO ongoing
// contact sync - its portal contacts are frozen at whatever a one-off import
// wrote. This script refreshes ONE academy on demand, reusing the cron's exact
// fetch backoff + per-contact mapping (ghlContactToMirrorRow), so the CLI and
// the cron can never drift apart.
//
//   node scripts/refresh-portal-contacts.mjs --client <id>            # dry-run (default)
//   node scripts/refresh-portal-contacts.mjs --client <id> --apply    # write
//
// Env: VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same as
// scripts/ghl-import.mjs).
//
// Writes on --apply: upserts ghl_contacts (on client_id,ghl_contact_id) AND the
// portal-native contacts store via bulkUpsertPortalContacts, tagged
// source:'ghl-import' to match the rows the original one-off import created
// (the cron tags 'sync'; consistency WITHIN the academy wins).
//
// REFUSES contact_provider='portal' academies: their contacts store is the
// SOURCE OF TRUTH, so pulling GHL back over it would clobber portal-only edits
// (tags/fields written straight to the store). Same rule the cron follows.

import { ghlContactToMirrorRow, ghlFetchWithBackoff } from "../api/ghl/cron-sync-contacts.js";
import { pickGhlToken } from "../api/ghl/_core.js";
import { bulkUpsertPortalContacts } from "../api/_contacts.js";

const args = process.argv.slice(2);
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);
const clientId = val("--client");
const apply = has("--apply");

function die(msg) { console.error(msg); process.exit(1); }

if (!clientId) die("usage: node scripts/refresh-portal-contacts.mjs --client <id> [--apply]");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  die("missing env: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY");
}

const PER_REQUEST_SLEEP_MS = 200;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ── Load the academy ──
const CLIENT_COLS = "id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_company_id,v15_access,v15_config,contact_provider";
let client;
try {
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=${CLIENT_COLS}`);
  client = Array.isArray(rows) ? rows[0] : null;
} catch (e) {
  die(`FAILED: could not load the client row: ${e.message}`);
}
if (!client) die(`academy not found: ${clientId}`);

if (client.contact_provider === "portal") {
  die(
    `REFUSING to refresh ${client.business_name || client.id}: contact_provider='portal'.\n` +
    `Its portal contacts store is the SOURCE OF TRUTH - pulling GHL over it would\n` +
    `clobber portal-only edits (tags/fields written straight to the store).\n` +
    `Nothing was written.`
  );
}

// ── Token ──
let tok;
try { tok = await pickGhlToken(client); }
catch (e) { die(`FAILED: token pick errored: ${e.message}`); }
if (!tok?.token || !tok?.locationId) {
  die(`FAILED: no usable GHL token / location for ${client.business_name || client.id}`);
}

// ── Page ALL contacts from GHL, exactly like the cron ──
async function fetchAllGhlContacts() {
  let startAfterId = null, startAfter = null;
  const all = [];
  while (true) {
    const params = new URLSearchParams({ locationId: tok.locationId, limit: "100" });
    // GHL contacts paging needs BOTH the timestamp (startAfter) and the id
    // (startAfterId) - passing only the id stalls after the first page (~100).
    if (startAfterId) params.set("startAfterId", String(startAfterId));
    if (startAfter != null) params.set("startAfter", String(startAfter));

    const data = await ghlFetchWithBackoff(`/contacts/?${params}`, tok.token);
    const contacts = data?.contacts || data?.data || [];
    if (contacts.length === 0) break;
    all.push(...contacts);

    const last = contacts[contacts.length - 1];
    const meta = data?.meta || {};
    startAfterId = meta.startAfterId || meta.lastId || last?.id || last?.contactId || null;
    startAfter = (meta.startAfter != null) ? meta.startAfter : (last?.dateAdded ? new Date(last.dateAdded).getTime() : null);
    if (!startAfterId || contacts.length < 100) break;

    await sleep(PER_REQUEST_SLEEP_MS);
  }
  return all;
}

let ghlContacts;
try { ghlContacts = await fetchAllGhlContacts(); }
catch (e) {
  // Three-outcome discipline: a fetch failure is a FAILURE, never "0 contacts".
  die(`FAILED: GHL contacts fetch errored for ${client.business_name || client.id}: ${e.message}`);
}

// ── Map through the cron's exact per-contact mapping ──
const nowStr = new Date().toISOString();
const mappedRows = ghlContacts.map(c => ghlContactToMirrorRow(client, c, nowStr)).filter(Boolean);

// ── Diff against the portal contacts store ──
async function fetchExistingPortalContacts() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await sb(
      `contacts?client_id=eq.${encodeURIComponent(clientId)}` +
      `&select=ghl_contact_id,email,phone,name&order=ghl_contact_id.asc&limit=1000&offset=${offset}`
    );
    out.push(...(page || []));
    if (!Array.isArray(page) || page.length < 1000) break;
  }
  return out;
}

let existingRows;
try { existingRows = await fetchExistingPortalContacts(); }
catch (e) { die(`FAILED: could not read existing portal contacts: ${e.message}`); }

const existingById = new Map(existingRows.map(r => [r.ghl_contact_id, r]));
const newRows = [];
let alreadyExist = 0, wouldChange = 0;
for (const row of mappedRows) {
  const ex = existingById.get(row.ghl_contact_id);
  if (!ex) { newRows.push(row); continue; }
  alreadyExist++;
  const diff = (a, b) => (a || null) !== (b || null);
  if (diff(row.email, ex.email) || diff(row.phone, ex.phone) || diff(row.name, ex.name)) wouldChange++;
}

console.log(`\n── ${client.business_name || client.id} contact refresh ${apply ? "(APPLY)" : "(DRY-RUN)"} ──`);
console.log(`  fetched from GHL:                        ${ghlContacts.length} (${mappedRows.length} mappable)`);
console.log(`  already in portal contacts:              ${alreadyExist}`);
console.log(`  NEW inserts:                             ${newRows.length}`);
console.log(`  existing rows w/ changed email/phone/name: ${wouldChange}`);
if (newRows.length) {
  console.log(`  sample new contacts (up to 10):`);
  for (const r of newRows.slice(0, 10)) {
    console.log(`    - ${r.name || "(no name)"}${r.email ? ` <${r.email}>` : ""}`);
  }
}

if (!apply) {
  console.log(`\nDry-run only - nothing written. Re-run with --apply to write.`);
  process.exit(0);
}

// ── Apply: ghl_contacts mirror + portal contacts store ──
try {
  for (let i = 0; i < mappedRows.length; i += 500) {
    await sb(`ghl_contacts?on_conflict=client_id,ghl_contact_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(mappedRows.slice(i, i + 500)),
    });
  }
} catch (e) {
  die(`FAILED: ghl_contacts upsert errored: ${e.message}`);
}
console.log(`\n  upserted into ghl_contacts:              ${mappedRows.length}`);

// synced_at is a ghl_contacts-only column; drop it and tag provenance to match
// the academy's existing rows (source:'ghl-import').
if (client.contact_provider !== "portal") {
  await bulkUpsertPortalContacts(
    mappedRows.map(({ synced_at, ...r }) => ({ ...r, source: "ghl-import" })),
  );
  console.log(`  upserted into portal contacts store:     ${mappedRows.length} (source: ghl-import)`);
}

console.log(`\nDone: ${newRows.length} new, ${wouldChange} changed, ${alreadyExist} pre-existing.`);
