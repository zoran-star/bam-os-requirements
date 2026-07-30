// THE CORE ATHLETE FIELDS: ADD IF ABSENT, AND NOTHING ELSE.
//
// Guards api/offers/seed-core-fields.js, which runs against EVERY academy's
// custom_field_defs on every preset apply. A seeder with that reach has exactly
// two ways to be dangerous, and both are quiet:
//
//   1. IT OVERWRITES. An academy renamed "Athlete's Age" to "Age (years)", or
//      made it required, or archived it. A seeder that reconciles toward the
//      manifest undoes that on the next apply and nobody sees it happen - the
//      form just goes back to saying something the owner already changed.
//   2. IT DRIFTS OFF THE KEYS. The three keys are a contract with three other
//      files (api/website/offer.js's lead_fields, api/_contacts.js's key match,
//      api/website/checkout.js's literal `athlete_first_name`). Rename one and
//      nothing throws; answers simply stop landing.
//
//   3. IT FAILS SILENTLY. The seeder is chained off api/offers/apply-preset.js
//      fail-open, which is right - the pipeline rows are already written and a
//      red error over one field definition helps nobody. But fail-open with
//      nothing watching is worse than fail-closed, and here it is invisible from
//      every direction at once: the in-handler catch means withSentryApiRoute
//      never sees the throw, the wizard caller discards the response body, and
//      setup-status counts only section=sales/onboarding defs while these are
//      section:null. Green button, unread response, three fields missing
//      forever. Section 8 pins the telemetry that is the only signal.
//
// So the assertions here are mostly about what the seeder must NOT do.
//
// HOW TO RUN
//
//   node api/_core-fields.test.mjs         # exits non-zero on any failure
//
// Plain node, no deps, no network, no database - the planner is a pure function
// and the seeder takes its Supabase caller as an argument, so a fake records
// what it would have written. Same style as api/_fees.test.mjs and
// api/_offer-schedule.test.mjs (vitest.config.ts only includes api/_runtime,
// api/runtime, api/parent, api/client; these api/*.test.mjs run directly).
//
// NEGATIVE CONTROLS. A guard nobody has watched fail is decoration. Each control
// below reverts ONE rule in-process, re-runs the same battery, and passes only
// if a check goes red that was green on the pristine run:
//
//   MUTATE=overwrite   the planner reconciles an existing def toward the
//                      manifest instead of leaving it alone
//   MUTATE=resurrect   archived rows stop counting as present, so the seeder
//                      re-adds an archived key (and violates the unique index)
//   MUTATE=rename      one manifest key drifts (athlete_first_name ->
//                      athlete_firstname), the exact break that is silent in prod
//   MUTATE=archivedfilter
//                      the seeder's READ grows an `archived=eq.false` filter, so
//                      an archived key looks absent, the insert collides with the
//                      (client_id, key) unique index and the apply 500s. The URL
//                      assertion that forbids the filter is load-bearing enough
//                      to need its own control.
//   MUTATE=silentfail  the Sentry call is deleted from apply-preset.js's catch,
//                      restoring the undetectable fail-open described above.
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED,
// and "caught" is a DELTA: the whole battery runs twice in one process, once
// pristine and once mutated, and a control passes only by producing a failure
// the pristine run did not have. Every assertion in this file, including the
// query and telemetry ones, is inside that battery - a check outside it is a
// check no control is watching.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_FIELD_MANIFEST, manifestRows, planCoreFields, seedCoreFields } from "./offers/seed-core-fields.js";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY_PRESET_SRC = fs.readFileSync(path.join(HERE, "offers", "apply-preset.js"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// THE MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────
// In-process rather than on disk. The real source is never written, so a crashed
// run cannot leave a mutated seeder behind for the next person to commit - which
// is the failure mode a disk-mutating control trades for its extra realism, and
// there is no extra realism to buy here: the planner is a pure function of its
// arguments, so re-implementing its rule wrongly IS the mutation.
//
// Each mutation breaks exactly ONE rule and is otherwise a faithful copy,
// including the junk-row tolerance. A mutation that also throws on a null row
// would kill the process instead of producing a failing check, and a control
// that crashes is a control that proves nothing - it never reaches the delta.
const index = (defs) => new Map((defs || []).filter((d) => d && typeof d.key === "string").map((d) => [d.key, d]));

// A mutation supplies a replacement for ONE of the three things the battery runs
// against: the PLANNER (the rules), the SEEDER (the query around them), or the
// SOURCE of apply-preset.js (the telemetry on the failure path). Everything it
// does not name is the real thing.
const PLANNERS = {
  // Rule broken: "never overwrite an existing def". Reconciles instead.
  overwrite: (clientId, defs) => {
    const byKey = index(defs);
    const created = [], existing = [], skipped = [];
    for (const row of manifestRows(clientId)) {
      const found = byKey.get(row.key);
      if (!found) { created.push(row); continue; }
      if (found.archived === true) { skipped.push({ key: row.key, reason: "archived" }); continue; }
      // The bug: the manifest's label wins over the academy's own.
      existing.push({ key: row.key, label: row.label });
    }
    return { created, existing, skipped };
  },
  // Rule broken: "an archived row counts as present". Treats archived as absent.
  resurrect: (clientId, defs) => {
    const byKey = index((defs || []).filter((d) => d && d.archived !== true));
    const created = [], existing = [], skipped = [];
    for (const row of manifestRows(clientId)) {
      const found = byKey.get(row.key);
      if (!found) created.push(row);
      else existing.push({ key: row.key, label: found.label });
    }
    return { created, existing, skipped };
  },
  // Rule broken: "the keys are GTA's, byte for byte".
  rename: (clientId, defs) => {
    const bent = manifestRows(clientId).map((r) =>
      r.key === "athlete_first_name" ? { ...r, key: "athlete_firstname" } : r);
    const byKey = index(defs);
    const created = [], existing = [], skipped = [];
    for (const row of bent) {
      const found = byKey.get(row.key);
      if (!found) { created.push(row); continue; }
      if (found.archived === true) { skipped.push({ key: row.key, reason: "archived" }); continue; }
      existing.push({ key: row.key, label: found.label });
    }
    return { created, existing, skipped };
  },
};

// Rule broken: "the read must not filter archived=false". A faithful copy of
// seedCoreFields with one character class added to the URL - which is exactly how
// this bug would arrive, since `archived=eq.false` is the filter every OTHER
// query against this table carries (api/_contacts.js, api/custom-fields.js), so
// adding it here reads like consistency. It is not: an archived key then looks
// absent, the insert hits the (client_id, key) unique index, and the apply 500s.
async function seedWithArchivedFilter(clientId, db) {
  const defs = await db(`custom_field_defs?client_id=eq.${encodeURIComponent(clientId)}&archived=eq.false&select=key,label,archived`) || [];
  const plan = planCoreFields(clientId, (defs || []).filter((d) => d && d.archived !== true));
  if (plan.created.length) {
    await db(`custom_field_defs`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(plan.created) });
  }
  return { created: plan.created.map((r) => r.key), existing: plan.existing.map((r) => r.key), skipped: plan.skipped };
}

// Rule broken: "the fail-open path tells somebody". Deletes the Sentry call from
// apply-preset.js's catch and leaves everything else, comments included - which
// is what makes it a real control: the file still READS as though it reports the
// failure, and only the executable line is gone.
function stripTelemetry(src) {
  const out = src.replace(/\n\s*captureApiMessage\([\s\S]*?\n\s*\}\);/, "");
  if (out === src) {
    console.error("MUTATE=silentfail: no captureApiMessage(...) call found to strip. The control is stale - fix the control rather than deleting it.");
    process.exit(1);
  }
  return out;
}

const MUTATIONS = {
  overwrite:      { plan: PLANNERS.overwrite },
  resurrect:      { plan: PLANNERS.resurrect },
  rename:         { plan: PLANNERS.rename },
  archivedfilter: { seed: seedWithArchivedFilter },
  // Lazy: only the silentfail run strips. Evaluated eagerly, a stale stripper
  // would exit(1) on EVERY run, including the ones that have nothing to do with
  // it, and the pristine suite would stop reporting its own result.
  silentfail:     { srcFn: () => stripTelemetry(APPLY_PRESET_SRC) },
};
if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(`unknown MUTATE=${MUTATE}. Known: ${Object.keys(MUTATIONS).join(", ")}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// BAM GTA'S THREE ROWS, AS PRODUCTION HOLDS THEM
// ─────────────────────────────────────────────────────────────────────────────
// Read 2026-07-31 from custom_field_defs joined to clients where
// business_name = 'BAM GTA' and key like 'athlete%'. This is the byte-for-byte
// reference the manifest is checked against, and it is written out in full here
// rather than imported from the manifest - a check that compares the manifest to
// itself passes for any manifest at all.
//
// These same three keys also drive the FREE-TRIAL LEAD form. That is why the
// key assertion below is the strictest one in the file.
const GTA_LIVE = [
  { key: "athlete_first_name", label: "Athlete's First Name", type: "text",   offer_id: null, archived: false },
  { key: "athlete_last_name",  label: "Athlete's Last Name",  type: "text",   offer_id: null, archived: false },
  { key: "athlete_age",        label: "Athlete's Age",        type: "number", offer_id: null, archived: false },
];

// A fake Supabase that records what the seeder would have read and written.
function fakeDb(rows) {
  const calls = { reads: [], inserts: [] };
  const db = async (path, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    if (method === "POST") { calls.inserts.push(...JSON.parse(opts.body)); return null; }
    calls.reads.push(path);
    return rows;
  };
  return { db, calls };
}

// Comments stripped before any structural assertion on source. A check that a
// file "contains captureApiMessage" is satisfied by a comment saying the call was
// removed, which is the opposite of what it means to assert.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE, AS A FUNCTION OF THE PLANNER, THE SEEDER AND apply-preset's SOURCE
// ─────────────────────────────────────────────────────────────────────────────
// Written as a function so it runs twice in one process: once against the real
// three and once with one of them mutated. A control passes on the DELTA only, so
// a mutation cannot inherit an existing red and call itself caught.
//
// EVERY assertion lives in here, including the query and telemetry ones. A check
// left outside this function is a check no negative control is watching, which is
// how a load-bearing assertion quietly becomes decorative.
async function runSuite({ plan, seed, src }) {
  const results = [];
  const ok = (cond, label) => { results.push({ ok: !!cond, label }); return !!cond; };
  const C = "client-1";

  // ── 1. the manifest IS GTA's three rows ───────────────────────────────────
  ok(CORE_FIELD_MANIFEST.length === 3, `the manifest is exactly 3 fields (got ${CORE_FIELD_MANIFEST.length})`);
  ok(CORE_FIELD_MANIFEST.map((f) => f.key).join(",") === GTA_LIVE.map((f) => f.key).join(","),
    `the manifest KEYS match BAM GTA's live rows byte for byte, in order `
    + `(want ${GTA_LIVE.map((f) => f.key).join(",")}, got ${CORE_FIELD_MANIFEST.map((f) => f.key).join(",")}). `
    + `These keys are also the free-trial LEAD form's and checkout.js's - a rename here breaks both in silence`);
  for (const want of GTA_LIVE) {
    const got = CORE_FIELD_MANIFEST.find((f) => f.key === want.key);
    ok(got && got.label === want.label && got.type === want.type,
      `${want.key}: label ${JSON.stringify(want.label)} / type ${want.type} (got ${got ? JSON.stringify(got.label) + " / " + got.type : "MISSING"})`);
  }
  ok(manifestRows(C).every((r) => r.offer_id === null),
    "every seeded row is ACADEMY-level (offer_id null), so buildFields puts it next to the athlete's name and not at the end with the offer's extras");
  ok(manifestRows(C).every((r) => r.required === false && r.archived === false),
    "seeded rows copy GTA's required:false rather than legislating the form");
  ok(manifestRows(C).every((r) => r.client_id === C),
    "every row is stamped with the academy it is being seeded for");

  // THE RULING, PINNED. Owner, 2026-07-31: the core athlete field is AGE ONLY.
  // An academy whose agreement legally needs a date of birth adds its own def.
  // Pinned so adding one has to be a decision that edits this line.
  ok(!CORE_FIELD_MANIFEST.some((f) => /\b(dob|date_of_birth|birth)\b/.test(f.key) || /birth/i.test(f.label)),
    "NO date-of-birth field in the core manifest (owner ruling 2026-07-31: age only)");

  // Emergency contact is required for every academy and is a CODE block in
  // buildFields, not a def. In the manifest it would win buildFields' de-dupe by
  // label, move up into the athlete section, and leak onto the LEAD form.
  ok(!CORE_FIELD_MANIFEST.some((f) => /emergency/i.test(f.key) || /emergency/i.test(f.label)),
    "NO emergency-contact field in the core manifest - it is a code block in buildFields, and a def here would de-dupe past it and reach the free-trial lead form");

  // ── 2. a brand-new academy gets all three ─────────────────────────────────
  {
    const r = plan(C, []);
    ok(r.created.length === 3 && r.existing.length === 0 && r.skipped.length === 0,
      `an academy with no defs at all gets all 3 created (got created=${r.created.length} existing=${r.existing.length} skipped=${r.skipped.length})`);
    ok(r.created.map((x) => x.key).join(",") === GTA_LIVE.map((f) => f.key).join(","),
      "...and they are the manifest's three keys, in the manifest's order");
  }

  // ── 3. ADD IF ABSENT: an existing def is never touched, even when its label
  //       differs. This is the assertion the whole file exists for. ───────────
  {
    const renamed = [
      { key: "athlete_first_name", label: "Player first name", archived: false },
      { key: "athlete_age",        label: "Age (years)",       archived: false },
    ];
    const r = plan(C, renamed);
    ok(r.created.length === 1 && r.created[0].key === "athlete_last_name",
      `only the genuinely missing key is created (got ${r.created.map((x) => x.key).join(",") || "none"})`);
    ok(!r.created.some((x) => x.key === "athlete_first_name" || x.key === "athlete_age"),
      "the two keys that already exist are NOT re-created");
    const first = r.existing.find((x) => x.key === "athlete_first_name");
    const age = r.existing.find((x) => x.key === "athlete_age");
    ok(first && first.label === "Player first name",
      `the academy's own label survives untouched: athlete_first_name stays ${JSON.stringify("Player first name")} (got ${first ? JSON.stringify(first.label) : "REPORTED AS MISSING"})`);
    ok(age && age.label === "Age (years)",
      `...and so does athlete_age's ${JSON.stringify("Age (years)")} (got ${age ? JSON.stringify(age.label) : "REPORTED AS MISSING"})`);
  }

  // A def whose TYPE or REQUIRED flag was changed is equally untouched: the plan
  // has one output for an existing key, and it is "leave it".
  {
    const changed = CORE_FIELD_MANIFEST.map((f) => ({ key: f.key, label: f.label, type: "textarea", required: true, archived: false }));
    const r = plan(C, changed);
    ok(r.created.length === 0,
      `an academy that changed every type and made every field required gets NOTHING written (got ${r.created.length} inserts)`);
  }

  // ── 4. an ARCHIVED def is not resurrected ─────────────────────────────────
  {
    const r = plan(C, [{ key: "athlete_age", label: "Athlete's Age", archived: true }]);
    ok(!r.created.some((x) => x.key === "athlete_age"),
      "an ARCHIVED def is not re-created (archiving is a deliberate act, and the (client_id, key) unique index would reject the insert anyway)");
    ok(r.skipped.some((x) => x.key === "athlete_age"),
      "...and it is reported as `skipped` rather than silently omitted, so the caller can see why it did not appear");
    ok(r.created.length === 2,
      `the other two are still created around it (got ${r.created.length})`);
  }

  // ── 5. the second run writes nothing ──────────────────────────────────────
  {
    const first = plan(C, []);
    // What the academy's table looks like after run one.
    const after = first.created.map((r2) => ({ key: r2.key, label: r2.label, archived: false }));
    const second = plan(C, after);
    ok(second.created.length === 0,
      `re-applying the preset writes NOTHING (got ${second.created.length} inserts on run two)`);
    ok(second.existing.length === 3,
      `...and reports all 3 as existing (got ${second.existing.length})`);
    ok(second.skipped.length === 0, "...with nothing skipped");
    // Run three, for the same reason a second run is checked at all: idempotence
    // that holds once can still be a coincidence of the first insert's shape.
    const third = plan(C, after);
    ok(third.created.length === 0 && third.existing.length === 3, "run three is identical to run two");
  }

  // ── 6. the academy's OTHER fields are none of the seeder's business ───────
  {
    const own = [
      { key: "athlete_grade",  label: "Grade",      archived: false },
      { key: "tshirt_size",    label: "Shirt size", archived: false },
      { key: "athlete_age",    label: "Athlete's Age", archived: false },
    ];
    const r = plan(C, own);
    ok(r.created.length === 2 && !r.created.some((x) => ["athlete_grade", "tshirt_size"].includes(x.key)),
      "an academy's own extra fields are neither touched nor counted - the seeder only ever looks up its own three keys");
    ok(!r.skipped.some((x) => ["athlete_grade", "tshirt_size"].includes(x.key)),
      "...and are never reported as skipped either");
  }

  // ── 7. junk in the existing rows does not crash the plan ──────────────────
  {
    const r = plan(C, [null, undefined, {}, { key: null }, { key: "athlete_age", archived: false }]);
    ok(r.created.length === 2, `null / keyless rows are ignored rather than throwing (got ${r.created.length} creates)`);
  }

  // ── 8. THE SEEDER'S OWN QUERY ─────────────────────────────────────────────
  // The planner being right proves nothing about the query that feeds it, and
  // one line of that query is load-bearing: the read must NOT filter
  // archived=false. Every other query against this table does filter it
  // (api/_contacts.js, api/custom-fields.js), so adding it here would read like
  // consistency - and it would make an archived key look absent, collide the
  // insert with the (client_id, key) unique index, and 500 the whole apply.
  // MUTATE=archivedfilter is the control that watches this.
  {
    const { db, calls } = fakeDb([]);
    const r = await seed(C, db);
    ok(calls.reads.length === 1 && calls.reads[0].startsWith("custom_field_defs?"),
      `it reads custom_field_defs once (${calls.reads[0] || "NO READ"})`);
    ok(!/archived=eq\.false/.test(calls.reads[0] || ""),
      `the read does NOT filter archived=false - an archived key must look PRESENT, or the insert violates the (client_id, key) unique index and the whole apply 500s (read: ${calls.reads[0] || "NONE"})`);
    ok(/client_id=eq\.client-1/.test(calls.reads[0] || ""),
      "...and it is scoped to one academy");
    ok(calls.inserts.length === 3, `an empty academy gets 3 inserts (got ${calls.inserts.length})`);
    ok(calls.inserts.every((row) => row.client_id === C && row.offer_id === null),
      "every inserted row carries the academy id and offer_id null");
    ok(r.created.length === 3 && r.existing.length === 0 && r.skipped.length === 0,
      `the return shape is { created, existing, skipped } (got created=${JSON.stringify(r.created)})`);
  }
  {
    // The end-to-end consequence of the filter, asserted through the seeder and
    // not only on the URL: an academy holding an ARCHIVED core key must be
    // written to zero times. The URL check says why; this one says what happens.
    const seeded = [
      { key: "athlete_first_name", label: "Player first name", archived: false },
      { key: "athlete_last_name", label: "Athlete's Last Name", archived: false },
      { key: "athlete_age", label: "Athlete's Age", archived: true },
    ];
    const { db, calls } = fakeDb(seeded);
    const r = await seed(C, db);
    ok(calls.inserts.length === 0,
      `an academy holding all three keys (one archived) is written to ZERO times (got ${calls.inserts.length} inserts)`);
    ok(r.existing.length === 2 && r.skipped.length === 1 && r.skipped[0] && r.skipped[0].key === "athlete_age",
      `...and it reports 2 existing + the archived one skipped (got existing=${JSON.stringify(r.existing)} skipped=${JSON.stringify(r.skipped.map((s) => s.key))})`);
    ok(r.created.length === 0, "...and claims nothing was created");
  }

  // ── 9. THE FAIL-OPEN PATH TELLS SOMEBODY ──────────────────────────────────
  // apply-preset.js chains this seeder fail-open, which is correct: the pipeline
  // rows are already written and a red error over one field definition helps
  // nobody. Fail-open with NOTHING WATCHING is a different thing, and here the
  // silence is total - the in-handler catch means withSentryApiRoute never sees
  // the throw, the wizard caller (_obfApplyPreset) discards the response body,
  // and setup-status counts only section=sales/onboarding defs while these are
  // section:null. A failed insert would leave a green button, an unread response
  // and an enroll form missing all three fields forever: the exact silent gap
  // this build exists to close, reintroduced one level up.
  //
  // So the Sentry message is not decoration, it is the ONLY signal, and it is
  // pinned here both TEXTUALLY (the call is present, tagged with the academy)
  // and STRUCTURALLY (it is inside the catch, not merely somewhere in the file).
  // Comments are stripped first: a check satisfied by a comment about the call is
  // the opposite of a check on the call.
  {
    const code = stripComments(src);
    ok(/import\s*\{[^}]*captureApiMessage[^}]*\}\s*from\s*["']\.\.\/_sentry\.js["']/.test(code),
      "apply-preset.js imports captureApiMessage from _sentry.js");

    // The fail-open region: from the seedCoreFields call to the response it
    // returns. Anchored on real code so a reorder moves the window with it.
    const from = code.indexOf("seedCoreFields(clientId");
    const to = code.indexOf("res.status(200)", from);
    const region = from >= 0 && to > from ? code.slice(from, to) : "";
    ok(!!region, "the fail-open region around the seedCoreFields call is locatable in apply-preset.js");
    ok(/catch\s*\([\s\S]*?captureApiMessage\s*\(/.test(region),
      "the catch that swallows a seeding failure CALLS captureApiMessage - without it the failure is invisible from every direction: no Sentry, no response read, no setup-status counter");
    // Scoped to the CALL, not the region. `error:` also appears in the line that
    // builds the response payload, so asserting it region-wide would pass for an
    // untelemetried catch - which it did, until this was narrowed.
    const callAt = region.indexOf("captureApiMessage");
    const call = callAt >= 0 ? region.slice(callAt) : "";
    ok(/client_id\s*:\s*clientId/.test(call),
      "...and tags the message with client_id, because an alert that does not name the academy is an alert nobody can act on");
    ok(/error\s*:/.test(call),
      "...and carries the underlying error, not just the fact that something failed");
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN, PRISTINE THEN MUTATED
// ─────────────────────────────────────────────────────────────────────────────
const PRISTINE = { plan: planCoreFields, seed: seedCoreFields, src: APPLY_PRESET_SRC };
const baseline = await runSuite(PRISTINE);
const baselineRed = new Set(baseline.filter((r) => !r.ok).map((r) => r.label));

let shown = baseline;
if (MUTATE) {
  const m = MUTATIONS[MUTATE];
  shown = await runSuite({
    plan: m.plan || PRISTINE.plan,
    seed: m.seed || PRISTINE.seed,
    src: m.srcFn ? m.srcFn() : (m.src || PRISTINE.src),
  });
}

for (const r of shown) console.log((r.ok ? "  ✅ " : "  ❌ ") + r.label);

// ─────────────────────────────────────────────────────────────────────────────
// RESULT
// ─────────────────────────────────────────────────────────────────────────────
const fail = shown.filter((r) => !r.ok).length;
const pass = shown.filter((r) => r.ok).length;

if (MUTATE) {
  const nw = shown.filter((r) => !r.ok && !baselineRed.has(r.label));
  console.log("");
  console.log(nw.length
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} produced ${nw.length} failure(s) the pristine run did not have:\n   - ${nw.slice(0, 3).map((r) => r.label.split("\n")[0].slice(0, 120)).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real rule and added no new failure. That check is decorative.`);
  process.exit(nw.length ? 0 : 1);
}

console.log("");
console.log(fail ? `❌ ${pass} passed, ${fail} failed` : `✅ ALL PASS: ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
