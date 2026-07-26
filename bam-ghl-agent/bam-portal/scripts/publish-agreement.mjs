#!/usr/bin/env node
// Publish an academy's enrollment agreement.
//
//   node scripts/publish-agreement.mjs <path-to-agreement.terms.json> [--dry]
//
// What it does:
//   1. Validates the terms document.
//   2. Computes its version_id (sha256 over the canonical terms).
//   3. Writes that id back into the terms file, so the academy's site serves it
//      and the enroll page can tell checkout which version it displayed.
//   4. Inserts it into public.agreement_documents as the current version.
//
// Publishing is what makes an edited agreement signable. Until you publish,
// checkout refuses signatures against the new wording rather than filing terms
// it cannot identify - so a forgotten publish fails loudly instead of quietly
// recording the wrong contract.
//
// Re-running with no changes is a no-op (same version_id already published).
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { versionIdFor, validateTerms } from "../api/_lib/agreement-version.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("usage: node scripts/publish-agreement.mjs <agreement.terms.json> [--dry]");
  process.exit(1);
}

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const path = resolve(file);
const raw = readFileSync(path, "utf8");
const doc = JSON.parse(raw);

/* ── validate ── */
const errs = validateTerms(doc);
if (!doc.client_id) errs.push("missing client_id (the academy's clients.id)");
if (errs.length) {
  console.error(`\n${file} is not publishable:\n`);
  errs.forEach((e) => console.error("  - " + e));
  console.error("");
  process.exit(1);
}

/* ── stamp ── */
const versionId = versionIdFor(doc);
const already = doc.version_id === versionId;

console.log(`\n  document : ${doc.doc_id}`);
console.log(`  academy  : ${doc.client_slug} (${doc.client_id})`);
console.log(`  revision : ${doc.revision || "-"}`);
console.log(`  version  : ${versionId}`);
console.log(`  sections : ${doc.sections.length}`);
const consents = [];
doc.sections.forEach((s) => (s.blocks || []).forEach((b) => { if (b.t === "consent") consents.push(b.key + (b.required ? " (required)" : "")); }));
console.log(`  consents : ${consents.length ? consents.join(", ") : "none"}`);
if (doc.notices && doc.notices.some((n) => n.kind === "draft")) {
  console.log(`\n  NOTE: this document still carries a DRAFT notice. It will be published\n        and signable. Remove the notice before real parents sign.`);
}

if (dry) { console.log("\n  --dry: nothing written.\n"); process.exit(0); }

/* ── write the id back into the terms file ── */
if (!already) {
  // Keep the file's formatting: replace just the version_id line.
  const updated = raw.replace(/"version_id"\s*:\s*(null|"[^"]*")/, `"version_id": "${versionId}"`);
  if (updated === raw) {
    console.error("\n  could not write version_id into the terms file (no version_id key found).\n");
    process.exit(1);
  }
  writeFileSync(path, updated);
  console.log(`\n  wrote version_id into ${file}`);
}

/* ── publish to the portal ── */
if (!SB_URL || !SB_KEY) {
  console.error("\n  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - the terms file was stamped");
  console.error("  but NOT published. Set them and re-run, or checkout will reject this version.\n");
  process.exit(1);
}

const sb = async (p, init = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/${p}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
};

const stamped = { ...doc, version_id: versionId };

const existing = await sb(
  `agreement_documents?client_id=eq.${doc.client_id}&doc_id=eq.${encodeURIComponent(doc.doc_id)}` +
  `&version_id=eq.${versionId}&select=id,is_current&limit=1`
);

if (existing && existing.length) {
  if (!existing[0].is_current) {
    await sb(`agreement_documents?id=eq.${existing[0].id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_current: true }),
    });
    console.log("  this version was already published; made it current again.");
  } else {
    console.log("  already published and current - nothing to do.");
  }
} else {
  await sb(`agreement_documents`, {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      client_id: doc.client_id,
      doc_id: doc.doc_id,
      version_id: versionId,
      revision: doc.revision || null,
      terms: stamped,
      is_current: true,
      published_by: process.env.USER || "publish-agreement.mjs",
    }]),
  });
  console.log("  published as the current version.");
}

console.log(`\n  Done. Deploy the site so it serves the stamped terms file.\n`);
