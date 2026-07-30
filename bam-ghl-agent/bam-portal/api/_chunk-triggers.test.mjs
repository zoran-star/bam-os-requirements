// THE BUILD-CHUNK TRIGGERS, PINNED AS A TRUTH TABLE AND AS A ONE-WAY PROMOTION.
//
//   node api/_chunk-triggers.test.mjs      # exits non-zero on any failure
//
// WHY THIS FILE EXISTS. api/offers/setup-status.js flips a build chunk from
// `waiting` to `ready` and pings the academy's staff Slack channel telling a human
// to go run the matching skill. So a trigger is not a status light. It is an
// instruction to a person, and a wrong one costs a build started on inputs that do
// not exist yet.
//
// Three rows fired on a signal that did not imply what the build actually needs.
// The first two were found independently, a week apart, by people who were not
// looking for each other's bug; the third was found by applying the rule those two
// produced, which is the whole argument for writing the rule down:
//
//   sales       fired on `!!sig.preset` alone. The sales funnel and its emails are
//               built on the published branding deck, so the preset stamp on its
//               own could send staff to build the funnel before the brand existed.
//   templates   fired on the published deck alone. The member transactional emails
//               quote PRICES and state POLICY, neither of which the deck implies.
//   onboarding  had prices + policy + fields but no deck. Its funnel emails are
//               built on the published brand exactly like the sales ones
//               (Zoran, 2026-07-30).
//
// The shape, which is the reusable part: A CHUNK TRIGGER MUST IMPLY ITS
// PREREQUISITES, NOT JUST ITS SIGNAL. Ask of any new row - if ONLY this condition
// is true and nothing else, can the skill finish? If not, the missing inputs belong
// in the condition. The same sentence is written above the table in
// api/offers/setup-status.js, where someone adding a row will actually be reading.
//
// HOW IT IS CHECKED. Not by grepping the source. `chunkTriggerDefs` is exported and
// INVOKED over the complete signal space - every combination of the seven signals
// plus deckPublished, 256 of them - and each row's answer is compared against a
// predicate written independently here. That is what makes "unchanged" mean
// something for the three rows nobody touched: deck / core / agreement are pinned
// over the same 256 cases, so loosening one of them is a deliberate act that edits
// this file too, not a quiet edit that stays green.
//
// The second half is the property that made the fix safe to ship: TIGHTENING A
// TRIGGER CANNOT DEMOTE A CHUNK. promoteChunks only ever rewrites a row that is
// `waiting` or status-less, so a chunk already ready / building / published rides
// through a now-false condition untouched. Proved by rank, over every status and
// both answers, rather than by reading the `if`.
//
//   MUTATE=salespreset   node api/_chunk-triggers.test.mjs # sales reverts to preset-alone
//   MUTATE=templatesdeck node api/_chunk-triggers.test.mjs # templates reverts to deck-alone
//   MUTATE=onboardingdeck node api/_chunk-triggers.test.mjs # onboarding drops the deck again
//   MUTATE=demote        node api/_chunk-triggers.test.mjs # promotion loses its waiting-only guard
//
// A control writes a MUTATED COPY of api/offers/setup-status.js beside the real one
// and imports that, then deletes it. If the text a control is pinned to is no longer
// in the file the control THROWS instead of passing quietly, because a control that
// has lost its target looks exactly like a control that caught nothing.
//
// WHAT THIS FILE DOES NOT PROVE. It never touches the database and never posts to
// Slack. The write and the ping live in the handler's `evaluateChunks` closure,
// which needs auth, a client row and a fake PostgREST; api/_arming-gate.test.mjs
// already drives the whole handler and is where that belongs. What is proved here
// is the decision - which chunks a given academy state makes ready, and that a
// chunk that already advanced is never walked back.

import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep this suite genuinely dependency-free, the same way api/_arming-gate.test.mjs
// does. api/offers/setup-status.js line 1 imports api/_sentry.js, which statically
// imports @sentry/node. Answering that one specifier locally keeps the CI promise
// ("plain node: no dependencies, no network, no database") true of this file. It
// changes nothing under test: sentryApiEnabled is false outside VERCEL_ENV
// production, and no function below goes near the Sentry wrapper anyway.
register(`data:text/javascript,${encodeURIComponent(`
  const STUB = "data:text/javascript,${encodeURIComponent(
    "export function init(){} export function captureMessage(){} export function captureException(){}" +
    " export function flush(){return Promise.resolve(true)}" +
    " export function withIsolationScope(fn){return fn({setTag(){},setContext(){}})}")}";
  export async function resolve(spec, ctx, next) {
    if (spec === "@sentry/node") return { url: STUB, shortCircuit: true, format: "module" };
    return next(spec, ctx);
  }
`)}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

const fails = [];
function fail(what, detail) { fails.push({ what, detail }); }
function expect(cond, what, detail) { if (!cond) fail(what, detail); return !!cond; }

let controlBroken = "";
let mutantCount = 0;

async function mutantModule(rel, edits) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of api/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

// The module under test, or the tester's broken version of it.
async function loadStatus() {
  if (MUTATE === "salespreset") {
    return mutantModule("offers/setup-status.js", [[
      `["sales",      "Sales funnel + emails",      !!(sig.preset && deckPublished)],`,
      `["sales",      "Sales funnel + emails",      !!sig.preset],`,
    ]]);
  }
  if (MUTATE === "templatesdeck") {
    return mutantModule("offers/setup-status.js", [[
      `["templates",  "Email templates",            !!(deckPublished && sig.prices > 0 && sig.policy)],`,
      `["templates",  "Email templates",            !!deckPublished],`,
    ]]);
  }
  if (MUTATE === "onboardingdeck") {
    return mutantModule("offers/setup-status.js", [[
      `["onboarding", "Onboarding funnel + emails", !!(deckPublished && sig.prices > 0 && sig.policy && sig.onb_fields > 0)],`,
      `["onboarding", "Onboarding funnel + emails", !!(sig.prices > 0 && sig.policy && sig.onb_fields > 0)],`,
    ]]);
  }
  if (MUTATE === "demote") {
    return mutantModule("offers/setup-status.js", [[
      `if (ready && (cur.status === "waiting" || !cur.status)) {`,
      `if (ready) {`,
    ]]);
  }
  return import("./offers/setup-status.js");
}

let mod;
try { mod = await loadStatus(); }
catch (e) {
  // A control whose target text has moved, or a mutated copy that will not import.
  // Say so in the banner CI reads, rather than dying with a stack that looks like
  // the control did its job.
  console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken || (e && e.message)}`);
  process.exit(1);
}
const { chunkTriggerDefs, promoteChunks } = mod;
if (typeof chunkTriggerDefs !== "function" || typeof promoteChunks !== "function") {
  console.log("\n❌ api/offers/setup-status.js no longer exports chunkTriggerDefs / promoteChunks. The triggers moved back out of reach of any test, which is how they went unchecked the first time.\n");
  process.exit(1);
}

// ─── the spec, written here rather than read from there ──────────────────────
//
// Deliberately a second copy. If this file derived the expectation from the code
// it is checking, it would agree with any edit, which is the failure mode the whole
// suite exists to avoid. Changing a trigger means changing BOTH, on purpose.
const EXPECTED = [
  ["deck",       "Branding deck",              (s, deck) => !!(s.brief_submitted && s.story)],
  ["core",       "Core site pages",            (s, deck) => !!deck],
  ["templates",  "Email templates",            (s, deck) => !!(deck && s.prices > 0 && s.policy)],
  ["sales",      "Sales funnel + emails",      (s, deck) => !!(s.preset && deck)],
  ["onboarding", "Onboarding funnel + emails", (s, deck) => !!(deck && s.prices > 0 && s.policy && s.onb_fields > 0)],
  ["agreement",  "Branded agreement",          (s, deck) => !!(s.policy && s.legal_name)],
];

// The shape setup-status builds its signal object in (see baseSig in the handler).
const SIGNAL_KEYS = ["brief_submitted", "story", "legal_name", "preset", "prices", "policy", "onb_fields"];

function sigFromMask(mask) {
  return {
    brief_submitted: !!(mask & 1),
    story:           !!(mask & 2),
    legal_name:      !!(mask & 4),
    preset:          !!(mask & 8),
    prices:          (mask & 16) ? 1 : 0,
    policy:          !!(mask & 32),
    onb_fields:      (mask & 64) ? 1 : 0,
  };
}
const SPACE = [];
for (let mask = 0; mask < 128; mask++) for (const deck of [false, true]) SPACE.push([sigFromMask(mask), deck]);

const show = (sig, deck) => `deckPublished=${deck} ` + SIGNAL_KEYS.map((k) => `${k}=${sig[k]}`).join(" ");
const asMap = (defs) => Object.fromEntries(defs.map(([k, , ready]) => [k, ready]));

// ─── 1. the table itself: same rows, same order, same labels ─────────────────
//
// The labels are not cosmetic. They are the words in the Slack ping that tell a
// human which skill to go run, so a renamed row is a renamed instruction.
function checkTableShape() {
  const defs = chunkTriggerDefs(sigFromMask(0), false);
  if (!expect(Array.isArray(defs), "the table has the rows it always had", `chunkTriggerDefs returned ${typeof defs}, not an array`)) return;
  const got = defs.map(([k, label]) => `${k}|${label}`).join("\n");
  const want = EXPECTED.map(([k, label]) => `${k}|${label}`).join("\n");
  expect(got === want, "the table has the rows it always had",
    `the chunk rows or their labels changed.\n\n    got:\n${got}\n\n    want:\n${want}\n\n    Labels are what the Slack ping names, so this is a change to what staff are told to build.`);
  for (const [, , ready] of defs) {
    if (!expect(typeof ready === "boolean", "the table has the rows it always had",
      `a trigger answered with a non-boolean (${JSON.stringify(ready)}). A truthy object reads as ready and would fire a build.`)) break;
  }
}

// ─── 2. every row, over the complete signal space ────────────────────────────
//
// This is the check that covers the two bugs AND pins the four rows nobody
// touched. 256 cases per row; any loosened or tightened condition disagrees
// somewhere in here.
function checkEveryRowOverTheWholeSpace() {
  for (const [key, , want] of EXPECTED) {
    const wrong = [];
    for (const [sig, deck] of SPACE) {
      const got = asMap(chunkTriggerDefs(sig, deck))[key];
      if (got !== want(sig, deck)) wrong.push(`${show(sig, deck)}  ->  fired=${got}, should be ${want(sig, deck)}`);
    }
    expect(wrong.length === 0, `${key} fires on exactly its prerequisites`,
      `${wrong.length} of ${SPACE.length} signal combinations disagree with the pinned condition. First few:\n      ${wrong.slice(0, 5).join("\n      ")}`);
  }
}

// ─── 3. the three defects, named, as their own witnesses ───────────────────────
//
// Covered by the sweep above, and written out anyway: a failing line that says
// "the preset alone made the sales funnel ready" is the one a future reader needs
// to see, not "case 137 of 256".
function checkTheKnownDefectsStayFixed() {
  const only = (over) => ({ ...sigFromMask(0), ...over });

  const salesOnPreset = asMap(chunkTriggerDefs(only({ preset: true }), false));
  expect(salesOnPreset.sales === false, "the preset alone does not start the sales build",
    "an academy that has had a sales preset stamped, with NO published branding deck, was told the sales funnel was ready to build. The funnel and its emails are built on the deck's brand, so this sends staff to build on a brand that does not exist.");

  const deckOnly = asMap(chunkTriggerDefs(only({}), true));
  expect(deckOnly.templates === false, "the deck alone does not start the member emails",
    "a published branding deck with NO prices and NO policy was told the member email templates were ready to build. Those emails quote prices and state policy, so there is nothing to write them from.");

  const deckNoPolicy = asMap(chunkTriggerDefs(only({ prices: 2 }), true));
  expect(deckNoPolicy.templates === false, "the deck alone does not start the member emails",
    "deck + prices but no policy still read as ready. Policy is half of what the transactional emails state.");

  const deckNoPrices = asMap(chunkTriggerDefs(only({ policy: true }), true));
  expect(deckNoPrices.templates === false, "the deck alone does not start the member emails",
    "deck + policy but no prices still read as ready.");

  const onbNoDeck = asMap(chunkTriggerDefs(only({ prices: 2, policy: true, onb_fields: 3 }), false));
  expect(onbNoDeck.onboarding === false, "the onboarding inputs alone do not start that build",
    "prices + policy + onboarding fields, with NO published branding deck, was told the onboarding funnel was ready to build. Its emails are built on the published brand exactly like the sales ones, so this is the same defect a third time.");

  // ...and the positive half, so the tightening did not simply switch the rows off.
  const full = asMap(chunkTriggerDefs(only({ preset: true, prices: 2, policy: true, onb_fields: 3 }), true));
  expect(full.onboarding === true, "the real prerequisites still let the build start",
    "published deck + prices + policy + onboarding fields did NOT make the onboarding chunk ready.");
  expect(full.sales === true, "the real prerequisites still let the build start",
    "preset + published deck did NOT make the sales chunk ready. Tightening a trigger into something unreachable is the other way to break it.");
  expect(full.templates === true, "the real prerequisites still let the build start",
    "published deck + prices + policy did NOT make the templates chunk ready.");

  // prices/onb_fields are COUNTS, not flags: `> 0` has to survive a real count.
  const many = asMap(chunkTriggerDefs(only({ prices: 7, policy: true, onb_fields: 4 }), true));
  expect(many.templates === true && many.onboarding === true, "counts are read as counts",
    `a count of 7 prices / 4 onboarding fields did not read as present: ${JSON.stringify({ templates: many.templates, onboarding: many.onboarding })}`);
}

// ─── 4. promotion is one-way, so tightening cannot walk a chunk back ──────────
//
// The reason this suite can ship a tightened trigger without a migration. Ranked
// rather than eyeballed: whatever the condition now answers, no row's status ends
// lower than it started, and no row's ready_at is rewritten.
const RANK = { waiting: 0, ready: 1, building: 2, published: 3 };

function checkPromotionNeverDemotes() {
  const keys = EXPECTED.map(([k]) => k);
  // Every case runs. No early return, deliberately: the worst witness here is a
  // `published` chunk knocked back to `ready`, and an early exit on the first
  // smaller complaint is exactly how that one would never be reached.
  const demoted = [], rewritten = [], reannounced = [];
  for (const status of ["ready", "building", "published"]) {
    for (const answer of [true, false]) {
      const existing = Object.fromEntries(keys.map((k) => [k, { status, ready_at: "2026-01-01T00:00:00.000Z", note: k }]));
      const { chunks, fired } = promoteChunks(existing, keys.map((k) => [k, `L:${k}`, answer]));
      for (const k of keys) {
        const now = chunks[k] || {};
        if (RANK[now.status] === undefined || RANK[now.status] < RANK[status]) {
          demoted.push(`${k} at '${status}' with trigger=${answer} came back as '${now.status}'`);
        } else if (now.status !== status) {
          demoted.push(`${k} at '${status}' with trigger=${answer} was moved to '${now.status}'`);
        }
        if (now.ready_at !== "2026-01-01T00:00:00.000Z" || now.note !== k) {
          rewritten.push(`${k} at '${status}' with trigger=${answer} -> ${JSON.stringify(now)}`);
        }
      }
      if (fired.length) reannounced.push(`'${status}' with trigger=${answer} re-announced ${JSON.stringify(fired)}`);
    }
  }
  expect(demoted.length === 0, "an advanced chunk is never walked back",
    `a chunk that had already advanced was moved by promoteChunks:\n      ${demoted.slice(0, 6).join("\n      ")}\n\n    This is the property that lets a trigger be TIGHTENED without a migration. If it fails, tightening a condition undoes finished work.`);
  expect(rewritten.length === 0, "an advanced chunk is never walked back",
    `promoteChunks rewrote the stored fields of an already-advanced chunk:\n      ${rewritten.slice(0, 6).join("\n      ")}`);
  expect(reannounced.length === 0, "an advanced chunk is never walked back",
    `promoteChunks re-announced chunks that had already advanced:\n      ${reannounced.slice(0, 6).join("\n      ")}\n\n    Staff would be pinged again to build something already built.`);
}

function checkWaitingBehaviour() {
  const keys = EXPECTED.map(([k]) => k);

  // A false condition leaves a waiting chunk waiting, and still returns the row.
  const cold = promoteChunks({}, keys.map((k) => [k, `L:${k}`, false]));
  for (const k of keys) {
    expect(cold.chunks[k] && cold.chunks[k].status === "waiting", "a false trigger leaves the chunk waiting",
      `chunk ${k} came back as ${JSON.stringify(cold.chunks[k])} with a false trigger`);
  }
  expect(cold.fired.length === 0, "a false trigger leaves the chunk waiting", `fired ${JSON.stringify(cold.fired)} with every trigger false`);

  // A true condition promotes once, and only once: setup-status runs on every poll.
  const warm = promoteChunks({}, keys.map((k) => [k, `L:${k}`, true]));
  expect(warm.fired.length === keys.length, "a true trigger promotes exactly once",
    `expected ${keys.length} labels, got ${JSON.stringify(warm.fired)}`);
  const again = promoteChunks(warm.chunks, keys.map((k) => [k, `L:${k}`, true]));
  expect(again.fired.length === 0, "a true trigger promotes exactly once",
    `a second evaluation re-fired ${JSON.stringify(again.fired)}. setup-status is called on every poll, so this would ping Slack forever.`);
  for (const k of keys) {
    expect(again.chunks[k].ready_at === warm.chunks[k].ready_at, "a true trigger promotes exactly once",
      `chunk ${k}'s ready_at was rewritten on a later evaluation`);
  }

  // The caller's stored object is not mutated in place.
  const stored = { deck: { status: "published" } };
  promoteChunks(stored, keys.map((k) => [k, `L:${k}`, true]));
  expect(Object.keys(stored).length === 1 && stored.deck.status === "published", "the stored chunks object is not mutated in place",
    `promoteChunks mutated its input: ${JSON.stringify(stored)}`);
}

// ─── run ─────────────────────────────────────────────────────────────────────
const steps = [
  ["the table has the rows it always had", checkTableShape],
  ["every row fires on exactly its prerequisites", checkEveryRowOverTheWholeSpace],
  ["the three known defects stay fixed", checkTheKnownDefectsStayFixed],
  ["an advanced chunk is never walked back", checkPromotionNeverDemotes],
  ["waiting chunks promote once and only once", checkWaitingBehaviour],
];
for (const [label, fn] of steps) {
  const before = fails.length;
  try { fn(); }
  catch (e) { fail(label, `threw: ${e && e.stack ? e.stack : e}`); }
  console.log(`  ${fails.length > before ? "❌" : "✅"} ${label}`);
}

for (const f of fails) console.log(`\n── ${f.what} ──\n${f.detail}`);

if (MUTATE) {
  if (controlBroken) {
    console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fails.length > 0;
  console.log(caught
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
  process.exit(caught ? 0 : 1);
}
if (!fails.length) {
  console.log("\n✅ Every chunk trigger implies its prerequisites, and no chunk that already advanced can be walked back.\n");
  process.exit(0);
}
console.log(`\n❌ ${fails.length} failure(s).\n`);
process.exit(1);
