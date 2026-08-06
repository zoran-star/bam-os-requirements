#!/usr/bin/env node
// SEED THE PER-PLAN AGE ROWS onto the LIVE San Jose price workbook (Step 12).
//
//     node bam-portal/scripts/seed-sj-age-rows.mjs              # dry run: prints the plan, writes NOTHING
//     APPLY=yes node bam-portal/scripts/seed-sj-age-rows.mjs    # actually inserts
//
// WHAT IT DOES. The live San Jose price workbook was seeded before the
// per-plan age question existed, so its plan cards have no `age_min` /
// `age_max` answer rows for the page to save into (the doSave mint whitelist
// covers the page's own typing; this script is the seed-side answer so the
// cards ASK the question with a prefill where one is defensible). For every
// plan card it inserts two workbook_answers rows:
//
//   workbook_id / card_id / client_id / target_kind / target_table /
//   target_id   copied from that card's existing `title` row - the same
//               derive-from-siblings rule doSave's mint path uses, so a row
//               this script writes is indistinguishable from one the page
//               grew. NOTHING here invents a target.
//   target_field  age_min / age_max
//   current_value null   (the portal stores no plan ages today)
//   answered      null
//   proposed      PREFILL ONLY WHERE DEFENSIBLE: the Elementary plan card
//                 gets the ages of its class twin in
//                 offers.data.schedule.classes (the one claim we can point
//                 at); every other plan prefills EMPTY (proposed null),
//                 because a prefill is a claim and an invented one would be
//                 confirmed-without-editing straight into configuration.
//
// REFUSALS, all fail-closed:
//   - the workbook must be in status draft or sent. A submitted/reviewed/
//     applied workbook is someone's recorded answers; seeding rows under a
//     reviewer is the late-write defect by another door. REFUSED, loudly.
//   - a card that already carries an age row is SKIPPED (idempotent - running
//     twice cannot mint twins).
//   - a card with no title row to derive targets from is SKIPPED and named
//     (no sibling, no target, no guess).
//   - without APPLY=yes nothing is written at all; the full plan prints.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (or
// SUPABASE_SERVICE_KEY). Never run from a machine that has not been pointed
// at the intended project on purpose.

const CLIENT_ID = "5576acf0-acd3-4c05-9f9f-ebfde8618154";   // BAM San Jose
const APPLY = process.env.APPLY === "yes";

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!SB_URL || !SB_KEY) {
  console.error("REFUSED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was written.");
  process.exit(1);
}

const enc = encodeURIComponent;
async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${String(path).split("?")[0]}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const die = (msg) => { console.error(msg); process.exit(1); };

// ── the workbook, and the status gate ────────────────────────────────────────
const wbs = await sb(`workbooks?client_id=eq.${enc(CLIENT_ID)}&kind=eq.price&select=id,status,submitted_at&order=created_at.desc`);
const wb = (Array.isArray(wbs) ? wbs : []).find((w) => w.status === "draft" || w.status === "sent");
if (!wb) {
  const seen = (Array.isArray(wbs) ? wbs : []).map((w) => `${w.id} (${w.status})`).join(", ") || "none";
  die(`REFUSED: no San Jose price workbook in status draft/sent. Workbooks seen: ${seen}. `
    + "A submitted or reviewed workbook is someone's recorded answers - seeding rows under a reviewer is the late-write defect by another door. Nothing was written.");
}
console.log(`Workbook ${wb.id} (status ${wb.status}) - eligible.`);

// ── the plan cards and their existing rows ───────────────────────────────────
const cards = (await sb(`workbook_cards?workbook_id=eq.${enc(wb.id)}&select=id,card_key,title&order=sort_order.asc`)) || [];
const planCards = cards.filter((c) => String(c.card_key || "").startsWith("plan:"));
if (!planCards.length) die("REFUSED: the workbook has no plan cards. Nothing was written.");
const answers = (await sb(`workbook_answers?workbook_id=eq.${enc(wb.id)}&select=id,card_id,target_kind,target_table,target_id,target_field`)) || [];

// ── the Elementary prefill, from the class twin - the one defensible claim ───
// The claim "this plan is for ages 9-12" is only made where the schedule
// already says it: the class whose name carries "elementary". Everything else
// prefills empty, because a prefill the owner confirms without editing lands
// in configuration.
const offers = (await sb(`offers?client_id=eq.${enc(CLIENT_ID)}&status=neq.archived&select=id,data`)) || [];
let eleAges = null;
for (const o of offers) {
  const classes = (((o.data || {}).schedule) || {}).classes || [];
  const twin = classes.find((cl) => cl && /elementary/i.test(String(cl.name || cl.title || "")));
  if (twin && (String(twin.age_min || "").trim() || String(twin.age_max || "").trim())) {
    eleAges = { age_min: String(twin.age_min || ""), age_max: String(twin.age_max || "") };
    break;
  }
}
console.log(eleAges
  ? `Elementary class twin found: ages ${eleAges.age_min || "?"}-${eleAges.age_max || "?"} (prefill for the Elementary card only).`
  : "No Elementary class twin with ages found in schedule.classes - NO card gets a prefill (a prefill is a claim, and there is nothing to point at).");

// ── build the inserts ────────────────────────────────────────────────────────
const inserts = [];
for (const card of planCards) {
  const mine = answers.filter((a) => a.card_id === card.id);
  if (mine.some((a) => a.target_field === "age_min" || a.target_field === "age_max")) {
    console.log(`  ${card.card_key} ("${card.title}"): already carries age rows - SKIPPED (idempotent).`);
    continue;
  }
  const sib = mine.find((a) => a.target_field === "title") || mine.find((a) => a.target_table);
  if (!sib) {
    console.log(`  ${card.card_key} ("${card.title}"): no sibling row to derive a target from - SKIPPED, no guess.`);
    continue;
  }
  const isElementary = /elementary/i.test(String(card.title || "")) || /elementary/i.test(String(card.card_key || ""));
  const prefill = isElementary && eleAges ? eleAges : { age_min: null, age_max: null };
  for (const field of ["age_min", "age_max"]) {
    inserts.push({
      workbook_id: wb.id,
      card_id: card.id,
      client_id: CLIENT_ID,
      target_kind: sib.target_kind,
      target_table: sib.target_table,
      target_id: sib.target_id,
      target_field: field,
      current_value: null,
      proposed: prefill[field],
      answered: null,
    });
  }
  console.log(`  ${card.card_key} ("${card.title}"): 2 rows -> ${sib.target_table}/${sib.target_id}`
    + (prefill.age_min || prefill.age_max ? ` with proposed ${prefill.age_min || ""}-${prefill.age_max || ""} (class twin)` : " with proposed empty"));
}

if (!inserts.length) { console.log("Nothing to insert - every plan card already has its age rows."); process.exit(0); }
if (!APPLY) {
  console.log(`\nDRY RUN: ${inserts.length} rows would be inserted. Re-run with APPLY=yes to write them.`);
  process.exit(0);
}
await sb("workbook_answers", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify(inserts),
});
console.log(`Inserted ${inserts.length} workbook_answers rows.`);
