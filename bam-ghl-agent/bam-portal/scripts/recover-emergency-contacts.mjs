#!/usr/bin/env node
// What emergency contacts we could recover, and for whom. REPORT ONLY.
//
// THE HISTORY THIS READS. Until 2026-07-31 the enroll form asked every parent
// for an emergency contact, REQUIRED it, and then dropped the answer: the two
// questions are a code block in api/website/offer.js rather than
// custom_field_defs rows, and writePortalFieldValues matches an answer to a def
// BY KEY. No academy had the key, so nothing matched and nothing was stored. The
// answers exist in exactly one place - member_audit_log.args.intake, stashed by
// the enrollment audit line in api/website/checkout.js.
//
// WHY THIS WRITES NOTHING BY DEFAULT, AND WHY THAT IS NOT TIMIDITY. Recovering
// these means writing personal data onto live contact records from a source that
// was never meant to be authoritative. Three things can be wrong with a row here
// and none of them are visible from the audit log alone:
//   * the contact may have been MERGED since (the dup-contact reconciler moves
//     rows between contacts), so the member_id in a 6-week-old audit row may not
//     be where that family lives today;
//   * a parent may have RE-ENROLLED with a different emergency contact, and the
//     newest audit row is not always the one a coach would want;
//   * a household may have split, in which case the stored number belongs to
//     someone who should no longer be called.
// A migration cannot weigh any of that. A person can. So this prints the
// evidence and stops.
//
//   node scripts/recover-emergency-contacts.mjs                 # the report
//   node scripts/recover-emergency-contacts.mjs --json          # machine-readable
//   node scripts/recover-emergency-contacts.mjs --write         # DOES write (see below)
//
// --write is deliberately not a silent superpower: it refuses unless the defs
// already exist (run the migration or let one enrollment mint them), it only
// ever fills a value that is currently ABSENT, and it never overwrites an
// answer a human has already typed into the drawer.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (or
// SUPABASE_SERVICE_KEY). Read-only credentials are enough for the report.

import { STORAGE_ONLY_DEF_KEYS } from "../api/_contacts.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const doWrite = args.includes("--write");

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB_URL || !SB_KEY) {
  console.error("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).");
  process.exit(1);
}

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// The submitted key carries a "__<index>" suffix and the INDEX IS NOT STABLE -
// production has shipped both emergency_contact_name__3 and __6 for the same
// question, because the suffix is the field's position on that academy's form
// and other fields moved around it. So match on the stripped key, exactly the
// way writePortalFieldValues does. Matching on a literal "__3" would silently
// miss every academy whose form is shaped differently.
const stripIdx = (k) => String(k).replace(/__\d+$/, "");
const KEYS = new Set(STORAGE_ONLY_DEF_KEYS);

function answersIn(intake) {
  const out = {};
  for (const [k, v] of Object.entries(intake || {})) {
    const base = stripIdx(k);
    if (!KEYS.has(base)) continue;
    const s = String(v == null ? "" : v).trim();
    if (s) out[base] = s;
  }
  return out;
}

const rows = await sb(
  `member_audit_log?action_type=eq.website-enrollment-checkout-created` +
  `&select=id,client_id,member_id,args,created_at&order=created_at.asc`,
) || [];

// NEWEST WINS, per member. Asserted by sorting ascending and letting later rows
// overwrite earlier ones - a parent who re-enrolled with a different emergency
// contact should surface the one they gave most recently, and the report prints
// how many earlier answers each member had so a superseded one is visible rather
// than silently discarded.
const byMember = new Map();
let scanned = 0, withAnswers = 0;
for (const r of rows) {
  scanned++;
  const found = answersIn(r.args && r.args.intake);
  if (!Object.keys(found).length) continue;
  withAnswers++;
  const mid = r.member_id;
  if (!mid) continue;   // an audit row whose member insert failed: nothing to attach to
  const prev = byMember.get(mid);
  byMember.set(mid, {
    member_id: mid, client_id: r.client_id, at: r.created_at,
    answers: found, supersedes: prev ? prev.supersedes + 1 : 0,
  });
}

// Who these people are, and what is on their contact record TODAY. A row is only
// "recoverable" if there is somewhere to put it: a live member with a contact.
const memberIds = [...byMember.keys()];
const members = memberIds.length
  ? await sb(`members?id=in.(${memberIds.join(",")})&select=id,client_id,parent_name,parent_email,athlete_name,status,contact_id`)
  : [];
const memberById = new Map((members || []).map((m) => [m.id, m]));

const defs = await sb(`custom_field_defs?key=in.(${STORAGE_ONLY_DEF_KEYS.join(",")})&archived=eq.false&select=id,client_id,key`) || [];
const defFor = (clientId, key) => (defs.find((d) => d.client_id === clientId && d.key === key) || {}).id || null;

const clients = await sb(`clients?select=id,business_name`) || [];
const clientName = (id) => (clients.find((c) => c.id === id) || {}).business_name || id;

// Already stored? Only an ABSENT value is a recovery candidate - a value a human
// typed into the drawer is authoritative and this must never talk over it.
const defIds = defs.map((d) => d.id);
const contactIds = [...new Set((members || []).map((m) => m.contact_id).filter(Boolean))];
const existing = (defIds.length && contactIds.length)
  ? await sb(`contact_field_values?field_id=in.(${defIds.join(",")})&contact_id=in.(${contactIds.join(",")})&select=contact_id,field_id,value`) || []
  : [];
const hasValue = (contactId, fieldId) =>
  existing.some((v) => v.contact_id === contactId && v.field_id === fieldId
    && v.value != null && String(v.value).trim() !== "");

const report = [];
for (const rec of byMember.values()) {
  const m = memberById.get(rec.member_id);
  const perKey = STORAGE_ONLY_DEF_KEYS.map((key) => {
    const fieldId = m ? defFor(m.client_id, key) : null;
    return {
      key,
      answer: rec.answers[key] || null,
      def_exists: !!fieldId,
      field_id: fieldId,
      already_stored: !!(m && m.contact_id && fieldId && hasValue(m.contact_id, fieldId)),
    };
  });
  const blockers = [];
  if (!m) blockers.push("member row is gone");
  else if (!m.contact_id) blockers.push("member has no portal contact to write to");
  if (m && perKey.some((p) => p.answer && !p.def_exists)) blockers.push("storage def missing for this academy (run the migration, or let one enrollment mint it)");
  report.push({
    member_id: rec.member_id,
    academy: m ? clientName(m.client_id) : "(unknown)",
    parent: m ? m.parent_name : null,
    athlete: m ? m.athlete_name : null,
    status: m ? m.status : null,
    enrolled_at: rec.at,
    superseded_answers: rec.supersedes,
    fields: perKey,
    recoverable: blockers.length === 0 && perKey.some((p) => p.answer && !p.already_stored),
    blockers,
  });
}
report.sort((a, b) => String(a.academy).localeCompare(String(b.academy)) || String(a.enrolled_at).localeCompare(String(b.enrolled_at)));

if (asJson) {
  console.log(JSON.stringify({ scanned, withAnswers, members: report }, null, 2));
} else {
  console.log(`\nEMERGENCY CONTACT RECOVERY - REPORT ONLY (nothing has been written)\n`);
  console.log(`Scanned ${scanned} enrollment audit rows; ${withAnswers} carried an emergency contact answer.`);
  console.log(`They map to ${report.length} member(s).\n`);
  for (const r of report) {
    const flag = r.recoverable ? "RECOVERABLE" : (r.blockers.length ? "BLOCKED" : "already stored");
    console.log(`  [${flag}] ${r.academy} - ${r.parent || "?"} (athlete: ${r.athlete || "?"}, status: ${r.status || "?"})`);
    console.log(`      enrolled ${String(r.enrolled_at).slice(0, 10)}${r.superseded_answers ? `, ${r.superseded_answers} earlier answer(s) superseded` : ""}`);
    for (const f of r.fields) {
      if (!f.answer) { console.log(`      ${f.key.padEnd(24)} (not asked / left blank)`); continue; }
      console.log(`      ${f.key.padEnd(24)} ${JSON.stringify(f.answer)}${f.already_stored ? "  [already on the record - will NOT be touched]" : ""}`);
    }
    for (const b of r.blockers) console.log(`      ⚠️  ${b}`);
    console.log("");
  }
  const n = report.filter((r) => r.recoverable).length;
  console.log(`${n} member(s) recoverable. This script wrote NOTHING.`);
  console.log(`Recovering is a human decision - see the header for the three ways an audit row can be wrong.`);
  console.log(`When that decision is made: node scripts/recover-emergency-contacts.mjs --write\n`);
}

if (!doWrite) process.exit(0);

// ── --write ──────────────────────────────────────────────────────────────────
// Fills ONLY absent values, only where the def already exists, and never
// overwrites. Prints every row it writes.
const toWrite = [];
for (const r of report) {
  if (!r.recoverable) continue;
  const m = memberById.get(r.member_id);
  for (const f of r.fields) {
    if (!f.answer || f.already_stored || !f.field_id) continue;
    toWrite.push({ contact_id: m.contact_id, field_id: f.field_id, value: f.answer, updated_at: new Date().toISOString() });
  }
}
if (!toWrite.length) {
  console.log("--write: nothing to write.");
  process.exit(0);
}
console.log(`--write: inserting ${toWrite.length} value(s)...`);
// on_conflict do-nothing rather than merge: a value that appeared between the
// report and this write belongs to whoever wrote it, not to this script.
await sb("contact_field_values?on_conflict=contact_id,field_id", {
  method: "POST",
  headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
  body: JSON.stringify(toWrite),
});
console.log(`--write: done. ${toWrite.length} value(s) written, 0 overwritten.`);
