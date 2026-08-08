#!/usr/bin/env node
// PRE-SEED THE MEMBER WORKBOOK from an academy's Stripe, so when the owner opens
// it the grid is a true CONFIRM and not a blank form (decision A in
// docs/plans/member-apply-engine-plan.md).
//
//     node bam-portal/scripts/seed-member-workbook.mjs CLIENT_ID           # DRY RUN: prints the plan, writes NOTHING
//     APPLY=yes node bam-portal/scripts/seed-member-workbook.mjs CLIENT_ID # actually writes
//
// The client_id may also come from the CLIENT_ID env var. It defaults to BAM San
// Jose (the pilot) only when nothing else is supplied, and the run prints which
// academy it resolved so a mis-point is loud, not silent.
//
// WHAT IT DOES, in three writes and never any Stripe write:
//   1. Reads the academy's ACTIVE Stripe subscriptions (READ-ONLY). Per sub it
//      pulls id, customer, the current price id, the amount, and the item-level
//      period dates (last = current_period_start, next = current_period_end -
//      Stripe carries these on items.data[0], NOT the subscription, per
//      docs/plans/sj-price-match-log.md).
//   2. Finds-or-creates ONE `members` shell per sub, idempotent on
//      (client_id, stripe_subscription_id), carrying stripe_subscription_id /
//      stripe_customer_id / current stripe_price_id / billing_portal_owned=false,
//      and prefilling athlete_name / parent_name / parent_phone from the
//      `contacts` join (matched by stripe_customer_id). Age lands in
//      `member_field_values` (decision B: the per-athlete store, so two siblings
//      on one sub keep their own age - NOT a members column, which does not
//      exist). Amount and next-payment are NOT members columns; they are carried
//      only as workbook answers.
//   3. Finds-or-creates the kind='member' `workbooks` row + one card per sub
//      (card_key = member:<stripe_subscription_id>) + the seeded `workbook_answers`
//      so the page renders the confirm grid. Each answer: proposed = the value we
//      inferred, current_value = the DB value (the members column, the seeded
//      age, or null for a carried fact with no column), answered = null.
//
// The seeded answer target_fields are EXACTLY the leaves of the engine's MEMBER_T
// map (api/workbook.js) - the apply engine is the source of truth and a field this
// seed writes that MEMBER_T does not know would be refused at apply. EVERY editable
// member field is pre-seeded, off_card_method / off_card_method_note included, so
// the workbook is a true confirm and the page never has to mint on a member card.
// (A member card cannot mint - mintableOn("member:*") is empty - so a null-id save
// of off_card_method 404s; seeding the rows here is what lets the page save an
// off-card member by id. This is the D1 rehearsal fix, matching decision A.)
//
// APPLY BOUNDARY. Everything here is a PORTAL-DB write (members, member_field_values,
// workbooks/cards/answers). There is NO Stripe write at all - the seed only READS
// Stripe. Dry-run is the default; APPLY=yes is required to write; a re-run creates
// no duplicates (idempotent on the sub id, the card_key, and the answer field).
//
// REFUSALS, all fail-closed:
//   - a member workbook already in status submitted/reviewed/applied is someone's
//     recorded answers under a reviewer - seeding into it is the late-write defect
//     by another door. REFUSED, loudly.
//   - missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> refuse, write nothing.
//   - without APPLY=yes nothing is written; the full plan prints.
//
// DO NOT run this against production. The orchestrator runs the live seed later,
// against the intended project, on purpose. Modelled on scripts/seed-sj-age-rows.mjs.

import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

// BAM San Jose (the pilot), from docs/plans/sj-price-match-log.md. A default, not
// a hardcode: a client_id argument or the CLIENT_ID env var overrides it.
export const SJ_CLIENT_ID = "5576acf0-acd3-4c05-9f9f-ebfde8618154";
// The GHL custom-field id that holds athlete age inside contacts.custom_fields
// (from the brief; 14/20 SJ contacts carry it).
export const AGE_GHL_KEY = "7pFORuEEtAW2en6U3NMi";

// The fields this seed writes as answers. EXACTLY the leaves of MEMBER_T in
// api/workbook.js; api/_seed-member-workbook.test.mjs pins this list against that
// map so the two cannot drift. off_card_method / off_card_method_note ARE seeded
// (empty), because a member card cannot mint a row and the page must be able to
// save an off-card member by id (D1).
export const SEEDED_FIELDS = [
  "athlete_name",
  "athlete_age",
  "stripe_price_id",
  "offer_id",
  "plan",
  "amount_cents",
  "next_payment",
  "outcome",
  "billing_mode",
  "parent_name",
  "parent_phone",
  "off_card_method",
  "off_card_method_note",
];

const enc = encodeURIComponent;
const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const orNull = (x) => (x === undefined || x === "" ? null : x);

// ── pure helpers, all exported so the test can hold their round trips ─────────

// A string, trimmed, with "" collapsing to null: a prefill is a claim, and a
// whitespace-only claim is no claim. Same rule as seed-sj-age-rows.
export function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Age as a bare digit string in 1..99, or null. It must round-trip through
// api/workbook.js tAgeStrOrEmpty, which REFUSES a padded value (" 9") and
// anything non-integer, so this only ever proposes a value that translator will
// accept. A padded or non-numeric age becomes null (no proposal), never a value
// our own seed manufactured that apply then refuses.
export function cleanAge(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 99 ? String(n) : null;
}

// Pull the age value out of a GHL custom_fields blob, which arrives EITHER as an
// object keyed by field id OR as an array of { id, value } (GHL ships both).
export function ageFromCustomFields(customFields) {
  if (!customFields) return null;
  if (Array.isArray(customFields)) {
    const hit = customFields.find((f) => f && String(f.id) === AGE_GHL_KEY);
    return hit ? cleanAge(hit.value) : null;
  }
  if (typeof customFields === "object") return cleanAge(customFields[AGE_GHL_KEY]);
  return null;
}

// A raw Stripe subscription -> the flat facts the seed needs. Dates and amount
// live on the ITEM, not the subscription (sj-price-match-log.md). Returns id=null
// for a sub with no usable item so the caller can drop it.
export function normalizeSub(raw) {
  if (!raw || !raw.id) return { id: null };
  const item = (((raw.items || {}).data) || [])[0] || {};
  const price = item.price || {};
  const amount = price.unit_amount;
  const toDay = (secs) =>
    typeof secs === "number" && secs > 0
      ? new Date(secs * 1000).toISOString().slice(0, 10)
      : null;
  // A readable plan name for the Plan column, so the owner never sees a raw
  // price id (D3). The Stripe PRODUCT name is what he recognises ("Elementary
  // Academy"); the price nickname is the fallback. Both are only present when the
  // read expanded the product - absent, plan_label stays null and the page falls
  // back to the plan answer, never the price id.
  const product = price.product;
  const productName =
    product && typeof product === "object" ? cleanStr(product.name) : null;
  return {
    id: String(raw.id),
    customer: raw.customer == null ? null : String(raw.customer),
    price_id: price.id ? String(price.id) : null,
    amount_cents: Number.isInteger(amount) && amount >= 0 ? amount : null,
    last_date: toDay(item.current_period_start),
    next_date: toDay(item.current_period_end),
    plan_label: productName || cleanStr(price.nickname) || null,
  };
}

// The prefill facts a contact contributes (matched to a sub by stripe_customer_id).
export function prefillFromContact(contact) {
  if (!contact) return { athlete_name: null, parent_name: null, parent_phone: null, age: null };
  return {
    athlete_name: cleanStr(contact.athlete_name),
    parent_name: cleanStr(contact.name),
    parent_phone: cleanStr(contact.phone),
    age: ageFromCustomFields(contact.custom_fields),
  };
}

// members.status -> the member-outcome vocabulary. Every live/paused/payment_*
// status means "still a member" = confirmed; the owner flips it to stop_billing
// in the workbook if they left. There is no DB status that means "left", so the
// current_value is always confirmed at pre-seed - and proposed is confirmed too,
// a true confirm the owner can override.
export function outcomeFromStatus(_status) {
  return "confirmed";
}

// members.billing_mode -> the billing-mode vocabulary. 'alternate' means off-card;
// anything else (including the null default) is card.
export function billingModeOf(billing_mode) {
  return String(billing_mode || "") === "alternate" ? "alternate" : "card";
}

// The shell columns for a NEW members row. athlete_name is NOT NULL in the schema,
// so a missing name seeds as "" (an empty string the owner fills in the workbook),
// never null. offer_id/plan stay null: coverage resolves them at apply, never here.
export function buildShell({ clientId, sub, contact, prefill }) {
  return {
    client_id: clientId,
    athlete_name: prefill.athlete_name || "",
    parent_name: prefill.parent_name,
    parent_phone: prefill.parent_phone,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer,
    stripe_price_id: sub.price_id,
    offer_id: null,
    plan: null,
    billing_portal_owned: false,
    contact_id: contact ? contact.id : null,
    status: "live",
  };
}

// The 13 seeded answers for one member. proposed = what we inferred; current_value
// = the DB value (the members column, the age already in member_field_values, or
// null for a carried fact that has no column: amount_cents and next_payment);
// answered = null. For a freshly-created shell the column values ARE the inferred
// ones, so current_value == proposed and review renders a clean confirm; for an
// existing member whose stored value differs, review honestly shows a change.
// off_card_method / off_card_method_note seed EMPTY (proposed=null, current_value=
// null): there is no method until the owner marks a member off-card, but the ROWS
// must exist so the page can save that choice by id (a member card cannot mint).
export function computeAnswers({ dbMember, dbAge, prefill, sub }) {
  const m = dbMember || {};
  return [
    { target_field: "athlete_name",    current_value: orNull(cleanStr(m.athlete_name)), proposed: prefill.athlete_name ?? orNull(cleanStr(m.athlete_name)) },
    { target_field: "athlete_age",     current_value: orNull(dbAge),                    proposed: prefill.age ?? orNull(dbAge) },
    { target_field: "stripe_price_id", current_value: orNull(m.stripe_price_id),        proposed: sub.price_id ?? orNull(m.stripe_price_id) },
    { target_field: "offer_id",        current_value: orNull(m.offer_id),               proposed: orNull(m.offer_id) },
    { target_field: "plan",            current_value: orNull(m.plan),                   proposed: orNull(m.plan) },
    { target_field: "amount_cents",    current_value: null,                             proposed: sub.amount_cents ?? null },
    { target_field: "next_payment",    current_value: null,                             proposed: sub.next_date ?? null },
    { target_field: "outcome",         current_value: outcomeFromStatus(m.status),      proposed: "confirmed" },
    { target_field: "billing_mode",    current_value: billingModeOf(m.billing_mode),    proposed: billingModeOf(m.billing_mode) },
    { target_field: "parent_name",     current_value: orNull(cleanStr(m.parent_name)),  proposed: prefill.parent_name ?? orNull(cleanStr(m.parent_name)) },
    { target_field: "parent_phone",    current_value: orNull(cleanStr(m.parent_phone)), proposed: prefill.parent_phone ?? orNull(cleanStr(m.parent_phone)) },
    { target_field: "off_card_method",      current_value: null, proposed: null },
    { target_field: "off_card_method_note", current_value: null, proposed: null },
  ];
}

// The Age custom_field_def for this academy (member_field_values is typed by a
// def). Same resolution the apply engine uses (resolveAgeFieldDef): the canonical
// "Athlete age" label/key first, then any loose age field. Null = no such def, in
// which case age is seeded as a workbook proposal only and the member_field_values
// write is deferred (reported, never guessed onto a column).
export async function resolveAgeDef(sb, clientId) {
  const rows = await sb(`custom_field_defs?client_id=eq.${enc(clientId)}&archived=eq.false&select=id,key,label`).catch(() => null);
  if (!Array.isArray(rows)) return null;
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
  return rows.find((d) => norm(d.label) === "athlete age" || norm(d.key) === "athlete_age")
    || rows.find((d) => /(^|[^a-z])age([^a-z]|$)/.test(norm(d.label)) || /(^|_)age($|_)/.test(norm(d.key)))
    || null;
}

// The academy's plan FAMILIES, for the Plan picker on each member card (D3). Read
// from the offer's pricing_offerings so the picker renders even when
// pricing_catalog is empty (San Jose's state until the price side's live mint
// runs). One option per LIVE family: { plan, label, offer_id }. `plan` is the
// family name the coverage step resolves on. Archived families are skipped (they
// are out of everything that sells). A read failure or no offer -> [], and the
// page falls back to the plan label with no picker rather than 500ing.
export async function readPlanOptions(sb, clientId) {
  const offers = await sb(`offers?client_id=eq.${enc(clientId)}&status=neq.archived&select=id,data`).catch(() => null);
  if (!Array.isArray(offers)) return [];
  const opts = [];
  const seen = new Set();
  for (const o of offers) {
    const offerings = (((o.data || {}).pricing) || {}).pricing_offerings || [];
    for (const off of Array.isArray(offerings) ? offerings : []) {
      if (!off || off.archived) continue;
      const title = cleanStr(off.title);
      if (!title) continue;
      const key = `${o.id}::${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({ plan: title, label: title, offer_id: o.id });
    }
  }
  return opts;
}

// The presentation meta a member card carries: a readable plan_label (never the
// raw price id) and the plan_options picker. One-way, computed - the owner cannot
// edit these, same as the price card's meta.
export function memberCardMeta(sub, planOptions) {
  return { plan_label: sub.plan_label || null, plan_options: planOptions || [] };
}

// Find the client's member workbook to seed into, or create one. A workbook the
// owner already submitted (submitted/reviewed/applied) is REFUSED - seeding rows
// under a reviewer is the late-write defect. A draft/sent one is reused (so the
// pre-seed is idempotent across re-runs). None -> create a draft, but only when
// applying; a dry run reports the create it WOULD do.
const WB_REVIEWED = new Set(["submitted", "reviewed", "applied"]);
export async function findOrCreateMemberWorkbook(sb, clientId, apply, log) {
  const wbs = (await sb(`workbooks?client_id=eq.${enc(clientId)}&kind=eq.member&select=id,status&order=created_at.desc`)) || [];
  const reviewed = wbs.find((w) => WB_REVIEWED.has(w.status));
  if (reviewed) {
    throw new Error(
      `REFUSED: San Jose already has a member workbook in status ${reviewed.status} (${reviewed.id}). `
      + "That is someone's recorded answers - seeding rows under a reviewer is the late-write defect by another door. Nothing was written."
    );
  }
  const open = wbs.find((w) => w.status === "draft" || w.status === "sent");
  if (open) {
    log(`Member workbook ${open.id} (status ${open.status}) - reused.`);
    return { ...open, created: false };
  }
  if (!apply) {
    log("No member workbook exists yet - a draft WOULD be created (dry run).");
    return { id: "<new-workbook>", status: "draft", created: true, dryPlaceholder: true };
  }
  const created = await sb("workbooks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ client_id: clientId, kind: "member", token: randomToken(), status: "draft" }]),
  });
  const wb = Array.isArray(created) && created[0] ? created[0] : null;
  if (!wb) throw new Error("REFUSED: the member workbook could not be created. Nothing further was written.");
  log(`Member workbook ${wb.id} created (draft).`);
  return { ...wb, created: true };
}

// A 256-bit url-safe token, same shape doCreate mints. Never derived from
// client_id or anything an outsider could construct.
function randomToken() {
  return randomBytes(32).toString("base64url");
}

// ── the seed, injectable so the test drives it with in-memory stubs ───────────
//
// deps.sb(path, init)                     -> parsed PostgREST JSON (or null)
// deps.listActiveSubscriptions(account)   -> [ raw Stripe subscription ]  (READ-ONLY)
//
// `mutate` is the one-line control the idempotency test corrupts: 'noskip'
// disables the "skip a row that already exists" guard, so a second run duplicates
// - proving the guard is what keeps re-runs clean.
export async function seed({ clientId, stripeAccount, apply, deps, log = console.log, mutate = process.env.MUTATE || "" }) {
  const { sb, listActiveSubscriptions } = deps;
  const skipExisting = mutate !== "noskip";
  const summary = {
    subs_read: 0, shells_created: 0, shells_found: 0,
    cards_created: 0, cards_found: 0, answers_created: 0,
    ages_written: 0, prefilled_from_ghl: 0, blank: 0, deferred: [],
  };

  // 1. Active Stripe subs (read-only).
  const rawSubs = (await listActiveSubscriptions(stripeAccount)) || [];
  const subs = rawSubs.map(normalizeSub).filter((s) => s.id);
  summary.subs_read = subs.length;

  // 2. contacts prefill map, keyed by stripe_customer_id.
  const contacts = (await sb(`contacts?client_id=eq.${enc(clientId)}&select=id,stripe_customer_id,athlete_name,name,phone,custom_fields`)) || [];
  const contactByCustomer = new Map();
  for (const c of contacts) if (c.stripe_customer_id) contactByCustomer.set(String(c.stripe_customer_id), c);

  // 3. existing members, keyed by stripe_subscription_id (the idempotency key).
  const memberCols = "id,stripe_subscription_id,stripe_customer_id,stripe_price_id,offer_id,plan,athlete_name,parent_name,parent_phone,billing_portal_owned,billing_mode,status,contact_id";
  const members = (await sb(`members?client_id=eq.${enc(clientId)}&select=${memberCols}`)) || [];
  const memberBySub = new Map();
  for (const m of members) if (m.stripe_subscription_id) memberBySub.set(String(m.stripe_subscription_id), m);

  // Ages already stored, so an existing member's age reads as its DB value.
  const ageByMember = new Map();
  if (members.length) {
    const ids = members.map((m) => m.id);
    const rows = (await sb(`member_field_values?member_id=in.(${ids.map(enc).join(",")})&select=member_id,field_id,value`).catch(() => null)) || [];
    for (const r of rows) if (!ageByMember.has(String(r.member_id))) ageByMember.set(String(r.member_id), cleanAge(r.value));
  }

  const ageDef = await resolveAgeDef(sb, clientId);
  if (!ageDef) summary.deferred.push("no Age custom_field_def: ages seeded as workbook proposals only, member_field_values write skipped");

  // The plan-family picker options, read once (D3). Empty when there is no offer
  // yet; the card still shows the readable plan_label, never the price id.
  const planOptions = await readPlanOptions(sb, clientId);
  if (!planOptions.length) summary.deferred.push("no live pricing_offerings: plan picker seeds empty, cards show the plan label only");

  // 4. the member workbook (find-or-create, or refuse).
  const wb = await findOrCreateMemberWorkbook(sb, clientId, apply, log);

  const existingCards = wb.dryPlaceholder ? [] : ((await sb(`workbook_cards?workbook_id=eq.${enc(wb.id)}&select=id,card_key`)) || []);
  const cardByKey = new Map(existingCards.map((c) => [c.card_key, c]));
  const existingAnswers = wb.dryPlaceholder ? [] : ((await sb(`workbook_answers?workbook_id=eq.${enc(wb.id)}&select=id,card_id,target_field`)) || []);
  const answersByCard = new Map();
  for (const a of existingAnswers) {
    if (!answersByCard.has(a.card_id)) answersByCard.set(a.card_id, new Set());
    answersByCard.get(a.card_id).add(a.target_field);
  }

  for (const sub of subs) {
    const contact = contactByCustomer.get(String(sub.customer)) || null;
    const prefill = prefillFromContact(contact);
    if (prefill.athlete_name) summary.prefilled_from_ghl++; else summary.blank++;

    // find-or-create the shell (idempotent on stripe_subscription_id).
    let member = skipExisting ? (memberBySub.get(sub.id) || null) : null;
    if (member) {
      summary.shells_found++;
    } else {
      const shell = buildShell({ clientId, sub, contact, prefill });
      if (apply) {
        const created = await sb("members", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([shell]) });
        member = Array.isArray(created) && created[0] ? created[0] : { id: `<new:${sub.id}>`, ...shell };
        memberBySub.set(sub.id, member);
      } else {
        member = { id: `<new:${sub.id}>`, ...shell };
      }
      summary.shells_created++;
    }

    // age -> member_field_values (only where we can point at a def and a value,
    // and only when it is not already stored). Deferred, never guessed, otherwise.
    let dbAge = ageByMember.get(String(member.id)) ?? null;
    if (ageDef && prefill.age && !dbAge) {
      if (apply) {
        await sb(`member_field_values?on_conflict=member_id,field_id`, {
          method: "POST",
          headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify([{ member_id: member.id, field_id: ageDef.id, value: prefill.age }]),
        });
      }
      ageByMember.set(String(member.id), prefill.age);
      dbAge = prefill.age;
      summary.ages_written++;
    }

    // find-or-create the card.
    const cardKey = `member:${sub.id}`;
    let card = skipExisting ? cardByKey.get(cardKey) : undefined;
    if (card) {
      summary.cards_found++;
    } else {
      const row = { workbook_id: wb.id, card_key: cardKey, title: cardTitle(prefill, sub), sort_order: summary.cards_created + summary.cards_found, meta: memberCardMeta(sub, planOptions) };
      if (apply && !wb.dryPlaceholder) {
        const created = await sb("workbook_cards", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([row]) });
        card = Array.isArray(created) && created[0] ? created[0] : { id: `<new-card:${sub.id}>`, ...row };
      } else {
        card = { id: `<new-card:${sub.id}>`, ...row };
      }
      cardByKey.set(cardKey, card);
      summary.cards_created++;
    }

    // seed the answers this card is still missing.
    const have = skipExisting ? (answersByCard.get(card.id) || new Set()) : new Set();
    const answers = computeAnswers({ dbMember: member, dbAge, prefill, sub });
    const toInsert = answers
      .filter((a) => !have.has(a.target_field))
      .map((a) => ({
        workbook_id: wb.id,
        card_id: card.id,
        client_id: clientId,
        target_kind: "member_row",
        target_table: "members",
        target_id: member.id,
        target_field: a.target_field,
        current_value: a.current_value,
        proposed: a.proposed,
        answered: null,
      }));
    if (apply && !wb.dryPlaceholder && toInsert.length) {
      await sb("workbook_answers", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(toInsert) });
    }
    // keep the in-memory view current so a single run cannot double-insert.
    const seen = answersByCard.get(card.id) || new Set();
    for (const a of toInsert) seen.add(a.target_field);
    answersByCard.set(card.id, seen);
    summary.answers_created += toInsert.length;
  }

  return { summary, workbook: wb };
}

// The card's display title: parent (athlete), falling back to whatever we have,
// then the sub id. Display only - the card_key is the identifier.
function cardTitle(prefill, sub) {
  if (prefill.parent_name && prefill.athlete_name) return `${prefill.parent_name} (${prefill.athlete_name})`;
  return prefill.parent_name || prefill.athlete_name || sub.id;
}

function printSummary(log, s, apply) {
  log("");
  log(`  Subscriptions read:        ${s.subs_read}`);
  log(`  Member shells created:     ${s.shells_created}`);
  log(`  Member shells found:       ${s.shells_found}`);
  log(`  Cards created:             ${s.cards_created}`);
  log(`  Cards found:               ${s.cards_found}`);
  log(`  Answers created:           ${s.answers_created}`);
  log(`  Ages -> member_field_values: ${s.ages_written}`);
  log(`  Prefilled from GHL:        ${s.prefilled_from_ghl}`);
  log(`  Blank (no GHL name):       ${s.blank}`);
  for (const d of s.deferred) log(`  DEFERRED: ${d}`);
  log("");
  log(apply ? "APPLIED." : "DRY RUN: nothing was written. Re-run with APPLY=yes to write.");
}

// ── real transports, built only when run directly ────────────────────────────

async function realSb(SB_URL, SB_KEY, path, init = {}) {
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

// Read every active subscription, expanding the item price so amount + item-level
// period dates are present. READ-ONLY: only GET, no idempotency key, no writes.
async function realListActiveSubscriptions(stripeFetch, stripeAccount) {
  const out = [];
  let starting_after = null;
  for (let page = 0; page < 50; page++) {
    // Expand the price AND its product so the readable plan_label (the product
    // name) is present without a second round trip (D3).
    const qs = new URLSearchParams({ status: "active", limit: "100" });
    qs.append("expand[]", "data.items.data.price");
    qs.append("expand[]", "data.items.data.price.product");
    if (starting_after) qs.set("starting_after", starting_after);
    const res = await stripeFetch(`/subscriptions?${qs.toString()}`, { method: "GET", stripeAccount });
    const data = (res && res.data) || [];
    out.push(...data);
    if (!res || !res.has_more || !data.length) break;
    starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const apply = process.env.APPLY === "yes";
  const clientId = String(process.argv[2] || process.env.CLIENT_ID || SJ_CLIENT_ID).trim();

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!SB_URL || !SB_KEY) {
    console.error("REFUSED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was written.");
    process.exit(1);
  }

  const sb = (path, init) => realSb(SB_URL, SB_KEY, path, init);

  // Resolve the academy's Stripe account so the read routes correctly (Connect or
  // the direct-key transport). This is a READ; no key material is ever printed.
  const clients = await sb(`clients?id=eq.${enc(clientId)}&select=id,public_name,business_name,stripe_connect_account_id&limit=1`);
  const client = Array.isArray(clients) && clients[0] ? clients[0] : null;
  if (!client) { console.error(`REFUSED: academy ${clientId} not found. Nothing was written.`); process.exit(1); }
  console.log(`Academy: ${client.public_name || client.business_name || clientId} (${clientId})`);
  console.log(apply ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const { stripeFetch } = await import("../api/_stripe-transport.js");
  const stripeAccount = client.stripe_connect_account_id || null;
  const listActiveSubscriptions = (account) => realListActiveSubscriptions(stripeFetch, account);

  const { summary } = await seed({ clientId, stripeAccount, apply, deps: { sb, listActiveSubscriptions } });
  printSummary(console.log, summary, apply);
}

// Importing this file runs NOTHING - only the exported helpers. The script body
// executes only when invoked directly, so the suite tests it with no Supabase or
// Stripe key in sight.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { printSummary };
