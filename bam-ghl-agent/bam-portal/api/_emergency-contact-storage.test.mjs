// THE EMERGENCY CONTACT IS ASKED FOR, REQUIRED, AND ACTUALLY KEPT.
//
// WHAT WENT WRONG, AND WHY NO TEST SAW IT. The enroll form has asked every parent
// for an emergency contact name and phone since 2026-07-24, and REQUIRED both.
// The answer was written to nothing. Not by an error - by a gap between two
// correct-looking halves:
//
//   api/website/offer.js   renders those two questions from a CODE BLOCK
//                          (EMERGENCY_CONTACT), not from custom_field_defs.
//   api/_contacts.js       writePortalFieldValues resolves a submitted answer to
//                          a def BY KEY, and skips what it cannot resolve.
//
// No academy had the key, so every answer fell through the join. Production,
// 2026-07-31: 0 emergency defs across all academies, and 18 enrollments / 13
// members whose answers live only in member_audit_log.args.intake.
//
// Every existing test passed throughout, and the reason is worth stating because
// it is the lesson: the form was tested (it renders, it is required) and the
// writer was tested (given a def, it writes), and NOBODY TESTED THE JOIN. Each
// half was correct about itself. This file tests the seam - it follows one real
// answer from the rendered field key to the row it lands in.
//
// HOW TO RUN
//
//   node api/_emergency-contact-storage.test.mjs      # exits non-zero on failure
//
// Plain node, no deps, no network, no database: buildFields is pure, and the
// storage functions take their Supabase caller as an argument so a fake records
// what they would have written. Same style as api/_fees.test.mjs.
//
// NEGATIVE CONTROLS. All in-process; nothing is written to disk, so a crashed run
// cannot leave a mutated source behind.
//
//   MUTATE=render        the storage-only skip in buildFields is removed, which
//                        is the state of the code before this build plus a def.
//                        Fires the REQUIRED-OVERRIDE and LEAD-FORM-LEAK
//                        assertions, and the byte-identical one.
//                        It does NOT fire the position or count assertions, and
//                        that is a fact about the code rather than a gap in the
//                        control: a def carrying the SAME label as the code block
//                        wins the label de-dupe and replaces it IN PLACE, so the
//                        field count and every index are unchanged and only the
//                        required flag moves. Relocation needs a def whose label
//                        DIFFERS, which is the relabel case below and the thing
//                        MUTATE=labeldedupe fires. Both assertions are kept
//                        because both futures are real; neither is claimed to be
//                        caught by a control that does not catch it.
//   MUTATE=labeldedupe   the skip becomes label-based instead of key-based, so an
//                        academy that RELABELLED its stored field starts
//                        rendering it again. The subtle version of MUTATE=render.
//   MUTATE=neverminted   ensureStorageOnlyDefs becomes a no-op that reports
//                        success. The write then silently stores nothing, which
//                        is EXACTLY the shipped bug - so the suite has to catch
//                        the bug it was written for.
//   MUTATE=unwired       the checkout call site drops its ensureStorageOnlyDefs
//                        call. The storage path is defined, correct, tested and
//                        never reached: a green suite over dead code.
//   MUTATE=keydrift      the form's LABEL is renamed, so the submitted key stops
//                        matching the stored def. The rename looks cosmetic and
//                        orphans every future answer.
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED,
// and "caught" is a DELTA: the whole battery runs twice in one process and a
// control passes only by producing a failure the pristine run did not have.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SUPABASE CREDENTIALS ARE SET BEFORE THE MODULES LOAD, AND THAT ORDERING IS THE
// WHOLE REASON THESE TWO IMPORTS ARE DYNAMIC.
//
// api/_contacts.js reads SB_URL / SB_KEY at MODULE SCOPE, and every write in it
// begins `if (!SB_URL || !SB_KEY) return;`. With no credentials in the
// environment the storage half returns early and does nothing - so a suite that
// imported normally would watch both functions no-op and report... exactly the
// bug it exists to catch, as a pass. (It did, first run: seven assertions red
// for the wrong reason, and had they been written the other way round they would
// have been GREEN for the wrong reason.)
//
// ESM hoists static imports above every statement, so process.env assignments in
// the file body happen too late. Hence: set first, import second.
//
// The values are deliberate nonsense. Nothing here reaches a network:
// ensureStorageOnlyDefs takes its poster as an argument, and
// writePortalFieldValues is driven through a fetch stub. If either ever DID try
// to dial out, a hostname that does not resolve is the failure everyone wants.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key-not-real";

// offer.js imports _contacts.js, so it must be dynamic too - a static import of
// it would load _contacts.js at hoist time and undo the ordering above.
const { buildFields, EMERGENCY_CONTACT, fieldKey } = await import("./website/offer.js");
const { STORAGE_ONLY_INTAKE_DEFS, STORAGE_ONLY_DEF_KEYS, ensureStorageOnlyDefs, writePortalFieldValues } = await import("./_contacts.js");

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKOUT_SRC = fs.readFileSync(path.join(HERE, "website", "checkout.js"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION FIXTURES
// ─────────────────────────────────────────────────────────────────────────────
// A REAL intake payload, copied from member_audit_log on 2026-07-31. It is here
// rather than invented because the thing this build turns on is key matching,
// and the exact shape of a submitted key is the whole question.
//
// NOTE THE INDICES. This row says __3 / __4. An earlier render of the same form
// produced __6 / __7, because the suffix is the field's POSITION and the
// academy's other fields moved around it. Anything that matches on a literal
// index is wrong for half of production, which is why writePortalFieldValues
// strips it - and why section 3 asserts a shifted payload resolves identically.
const REAL_INTAKE = {
  athlete_age__8: "15",
  player_grade__9: "10",
  athlete_last_name__7: "Bjelanovic",
  athlete_first_name__6: "Konstantin",
  emergency_contact_name__3: "Dejan",
  emergency_contact_phone__4: "416-825-2353",
};

// BAM GTA's three live academy-level defs, plus the two this build adds.
const GTA_DEFS = [
  { id: "d1", key: "athlete_first_name", label: "Athlete's First Name", type: "text", offer_id: null, required: false },
  { id: "d2", key: "athlete_last_name", label: "Athlete's Last Name", type: "text", offer_id: null, required: false },
  { id: "d3", key: "athlete_age", label: "Athlete's Age", type: "number", offer_id: null, required: false },
];
const STORAGE_DEFS = STORAGE_ONLY_INTAKE_DEFS.map((d, i) => ({
  id: `s${i + 1}`, key: d.key, label: d.label, type: d.type, offer_id: null, required: false, archived: false,
}));
const OFFER = { id: "off-1", data: { onboarding: {} } };

// ─────────────────────────────────────────────────────────────────────────────
// THE MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE TWO RENDERING CONTROLS DEFEAT THE SKIP, AND WHY IT IS FAITHFUL.
//
// The skip lives inside buildFields and cannot be swapped from outside. The first
// attempt here WRAPPED buildFields and pre-filtered its def list, which was a
// no-op: the real skip still ran underneath and both controls reported "no new
// failure". A control that cannot fail is worse than no control, so it is worth
// naming what went wrong - a mutation must break the thing under test, not
// something upstream of it.
//
// What actually defeats it: the skip matches `def.key`, and cfDefToField falls
// back to `fieldKey(label)` when a def carries no key of its own. So a storage
// def with its key blanked slips past the skip and renders with EXACTLY the field
// a non-skipped storage def would produce - same label, same derived key, same
// required flag off the row. The rendered form is byte-identical to the pre-fix
// output, which is the only property a control here needs.
const mangleFor = {
  // "the skip is gone": no storage def is matched, so every one of them renders.
  render: (defs) => (defs || []).map((d) =>
    STORAGE_ONLY_DEF_KEYS.includes(d.key) ? { ...d, key: "" } : d),
  // "the skip matches LABEL instead of key": a def still carrying its canonical
  // label is caught, and a RELABELLED one is missed and renders. Note this is
  // correctly a no-op for the un-relabelled fixtures - a label-based skip works
  // fine until an academy renames its own field, which is exactly what makes it
  // the subtle version of MUTATE=render.
  labeldedupe: (defs) => (defs || []).map((d) =>
    (STORAGE_ONLY_DEF_KEYS.includes(d.key)
      && !STORAGE_ONLY_INTAKE_DEFS.some((s) => s.label.toLowerCase() === String(d.label || "").toLowerCase()))
      ? { ...d, key: "" } : d),
};

const MUTATIONS = {
  render: { build: (offer, defs, section) => buildFields(offer, mangleFor.render(defs), section) },
  labeldedupe: { build: (offer, defs, section) => buildFields(offer, mangleFor.labeldedupe(defs), section) },
  // Minting is a lie: it reports success and creates nothing.
  neverminted: { ensure: async () => true, mintsNothing: true },
  // The checkout call site never calls it.
  unwired: { srcFn: () => {
    const out = CHECKOUT_SRC.replace(/\n\s*await ensureStorageOnlyDefs\(clientId\);/, "");
    if (out === CHECKOUT_SRC) {
      console.error("MUTATE=unwired: no `await ensureStorageOnlyDefs(clientId);` found to remove. The control is stale - fix the control rather than deleting it.");
      process.exit(1);
    }
    return out;
  } },
  // The form label is renamed, so the submitted key stops matching the def.
  keydrift: { labels: ["Emergency contact person", "Emergency contact number"] },
};
if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(`unknown MUTATE=${MUTATE}. Known: ${Object.keys(MUTATIONS).join(", ")}`);
  process.exit(1);
}

// A fake Supabase for the storage half.
function fakeStore({ defs = [], mintsNothing = false } = {}) {
  const table = [...defs];
  const calls = { defInserts: [], valueRows: [], reads: [] };
  // The shape ensureStorageOnlyDefs expects (post(path, body, prefer)).
  const sbPost = async (_path, body) => {
    calls.defInserts.push(...body);
    if (mintsNothing) return null;
    for (const row of body) {
      if (!table.some((d) => d.key === row.key)) table.push({ ...row, id: `minted-${row.key}` });
    }
    return null;
  };
  return { table, calls, sbPost };
}

// writePortalFieldValues talks to the network through module-private helpers, so
// the seam is stubbed at fetch: this is the REAL function, reading the REAL defs
// table and producing the REAL rows. Stubbing the function itself would test the
// stub.
function withFetchStub(defsTable, captured) {
  const real = globalThis.fetch;
  // Both `text()` AND `json()`: the read helper in _contacts.js uses res.json()
  // and the write helper uses res.text(). A stub that answers only one of them
  // makes the other throw, and writePortalFieldValues SWALLOWS its own errors -
  // so the failure arrives as "nothing was stored", indistinguishable from the
  // bug under test. That cost a run here; it is why both are implemented.
  const reply = (payload) => ({
    ok: true, status: 200,
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
    json: async () => payload,
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("custom_field_defs")) {
      // Mirror the real filter: archived=false only.
      return reply(defsTable.filter((d) => d.archived !== true)
        .map((d) => ({ id: d.id, type: d.type, key: d.key, ghl_field_id: d.ghl_field_id || null })));
    }
    if (u.includes("contact_field_values")) {
      captured.push(...JSON.parse(init.body || "[]"));
      return reply(undefined);
    }
    return reply([]);
  };
  return () => { globalThis.fetch = real; };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE
// ─────────────────────────────────────────────────────────────────────────────
async function runSuite({ build, ensure, mintsNothing, src, labels }) {
  const results = [];
  const ok = (c, label) => { results.push({ ok: !!c, label }); return !!c; };

  // The labels the form renders. MUTATE=keydrift renames them.
  const FORM_LABELS = labels || EMERGENCY_CONTACT;
  const submittedKeys = FORM_LABELS.map(fieldKey);

  // ── 1. THE FORM IS UNCHANGED ──────────────────────────────────────────────
  // With the storage defs present, the enroll form must look EXACTLY as it did
  // before they existed. That is the whole promise of a storage-only def, and
  // each of the four consequences gets its own assertion so a failure names
  // which one broke rather than "the form changed".
  const withStorage = build(OFFER, [...GTA_DEFS, ...STORAGE_DEFS], "onboarding");
  const withoutStorage = buildFields(OFFER, GTA_DEFS, "onboarding");
  const shape = (fs2) => fs2.map((f) => `${f.label}|${f.required}|${f.type}`).join(" >> ");

  ok(shape(withStorage) === shape(withoutStorage),
    `the enroll form is byte-identical with and without the storage defs\n       with:    ${shape(withStorage)}\n       without: ${shape(withoutStorage)}`);

  const labelsOf = withStorage.map((f) => String(f.label).toLowerCase());
  // (1) RELOCATION: the block stays after the athlete fields, not before them.
  // HONEST SCOPE, so nobody reads more into a green than it carries: a def
  // carrying the SAME label as the code block replaces it in place (the de-dupe
  // is by lowercased label), so this position check does NOT move when the skip
  // is removed - see MUTATE=render in the header. It guards the other shape: a
  // def whose label differs is pushed as an EXTRA field ahead of the block, and
  // that is caught here and by the relabel assertion further down.
  const firstEmergency = labelsOf.findIndex((l) => l.startsWith("emergency"));
  const lastAthlete = labelsOf.map((l, i) => (l.includes("athlete") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  ok(firstEmergency > lastAthlete && lastAthlete >= 0,
    `RELOCATION: the emergency block still sits AFTER the athlete fields (emergency at ${firstEmergency}, last athlete at ${lastAthlete}) - a rendered academy-level def would be pushed BEFORE it and win the label de-dupe`);

  // (2) REQUIRED OVERRIDE: still required, from the code list not the def row.
  const emergencyFields = withStorage.filter((f) => String(f.label).toLowerCase().startsWith("emergency"));
  ok(emergencyFields.length === 2, `the block renders exactly TWICE, once per question (got ${emergencyFields.length})`);
  ok(emergencyFields.every((f) => f.required === true),
    `REQUIRED OVERRIDE: both emergency fields are still required=true (got ${JSON.stringify(emergencyFields.map((f) => f.required))}) - the storage defs carry required:false, so a rendered def would silently make a REQUIRED question optional`);

  // (3) LEAD-FORM LEAK: the free trial form never asks a stranger for this.
  const lead = build(OFFER, [...GTA_DEFS, ...STORAGE_DEFS], "sales");
  ok(!lead.some((f) => /emergency/i.test(String(f.label)) || /emergency/i.test(String(f.key))),
    `LEAD-FORM LEAK: the free-trial lead form carries NO emergency contact field (got ${JSON.stringify(lead.map((f) => f.label))})`);

  // (4) REORDER: nothing new appears anywhere, at any position.
  ok(withStorage.length === withoutStorage.length,
    `REORDER: the field COUNT is unchanged (${withStorage.length} vs ${withoutStorage.length}) - an extra field shifts every "__<index>" suffix after it`);
  ok(withStorage.map((f) => f.key).join(",") === withoutStorage.map((f) => f.key).join(","),
    "...and every indexed key is identical, so a form already in a parent's browser keeps submitting keys the server still understands");

  // An academy that RELABELLED its stored def must not start rendering it: the
  // skip is by key. MUTATE=labeldedupe is the control for this one.
  {
    const relabelled = STORAGE_DEFS.map((d) => ({ ...d, label: `${d.label} (office use)` }));
    const f = build(OFFER, [...GTA_DEFS, ...relabelled], "onboarding");
    ok(f.length === withoutStorage.length && !f.some((x) => /office use/i.test(String(x.label))),
      `a RELABELLED storage def still does not render (got ${JSON.stringify(f.map((x) => x.label))}) - the skip is keyed, because an academy may rename its own field and the form must not care`);
  }

  // ── 2. THE FORM'S KEY IS THE DEF'S KEY ────────────────────────────────────
  // The seam nobody tested. The form submits a key; the store looks a def up by
  // that key. If those two ever stop agreeing, nothing throws and every answer
  // is dropped - which is precisely what shipped.
  ok(submittedKeys.join(",") === STORAGE_ONLY_DEF_KEYS.join(","),
    `the keys the FORM submits (${submittedKeys.join(",")}) are exactly the keys the STORE defines (${STORAGE_ONLY_DEF_KEYS.join(",")}). `
    + `Rename a label in offer.js and this fails - which is the point: the rename is silent in production and orphans every answer`);
  ok(withStorage.filter((f) => /^emergency/.test(f.key)).every((f) => submittedKeys.includes(f.key.replace(/__\d+$/, ""))),
    "...and the keys the RENDERED form actually carries strip to those same keys");

  // ── 3. AN ANSWER SURVIVES THE ROUND TRIP ──────────────────────────────────
  // The real writePortalFieldValues, the real def table, a real production
  // payload. This is the assertion that would have failed before the build.
  {
    const store = fakeStore({ defs: [...GTA_DEFS], mintsNothing });
    await (ensure || ensureStorageOnlyDefs)("client-1", store.sbPost);
    const captured = [];
    const restore = withFetchStub(store.table, captured);
    try {
      await writePortalFieldValues("client-1", "contact-1", null, REAL_INTAKE);
    } finally { restore(); }

    const storedFor = (key) => {
      const def = store.table.find((d) => d.key === key);
      return def ? captured.find((r) => r.field_id === def.id) : null;
    };
    const nameRow = storedFor("emergency_contact_name");
    const phoneRow = storedFor("emergency_contact_phone");
    ok(nameRow && nameRow.value === "Dejan",
      `a REAL production intake payload lands: emergency_contact_name = "Dejan" (got ${nameRow ? JSON.stringify(nameRow.value) : "NOTHING STORED"})`);
    ok(phoneRow && phoneRow.value === "416-825-2353",
      `...and emergency_contact_phone = "416-825-2353" (got ${phoneRow ? JSON.stringify(phoneRow.value) : "NOTHING STORED"})`);
    ok(captured.some((r) => r.contact_id === "contact-1"),
      "...onto the enrolling parent's own contact");
    // The athlete answers still land: this build must not have cost anything.
    const athleteRow = captured.find((r) => r.field_id === "d3");
    ok(athleteRow && String(athleteRow.value) === "15",
      `the athlete answers in the same payload still land (athlete_age = 15, got ${athleteRow ? JSON.stringify(athleteRow.value) : "NOTHING"})`);
  }

  // THE INDEX IS NOT STABLE. The same questions on a differently-shaped form
  // submit __6/__7 instead of __3/__4, and both are real production shapes.
  {
    const shifted = { emergency_contact_name__6: "Priya Aiyer", emergency_contact_phone__7: "5164350044" };
    const store = fakeStore({ defs: [...GTA_DEFS], mintsNothing });
    await (ensure || ensureStorageOnlyDefs)("client-1", store.sbPost);
    const captured = [];
    const restore = withFetchStub(store.table, captured);
    try { await writePortalFieldValues("client-1", "contact-2", null, shifted); }
    finally { restore(); }
    ok(captured.length === 2,
      `a form with DIFFERENT indices (__6/__7) stores the same two answers (got ${captured.length} rows) - the suffix is a position, not an identity`);
  }

  // ── 4. MINTING IS SAFE TO REPEAT AND NEVER OVERWRITES ─────────────────────
  {
    const store = fakeStore({ defs: [] });
    await (ensure || ensureStorageOnlyDefs)("client-1", store.sbPost);
    const first = store.calls.defInserts.length;
    await (ensure || ensureStorageOnlyDefs)("client-1", store.sbPost);
    ok(first === 2, `the first mint offers both defs (got ${first})`);
    ok(store.table.filter((d) => STORAGE_ONLY_DEF_KEYS.includes(d.key)).length === 2,
      "...and after two calls the academy holds exactly 2 storage defs, not 4 - the insert is ignore-duplicates on (client_id, key)");
    ok(store.calls.defInserts.every((r) => r.offer_id === null && r.section === null),
      "every minted def is ACADEMY-level (offer_id null, section null), so it shows on every contact regardless of which offer they bought");
    ok(store.calls.defInserts.every((r) => r.archived === false && r.required === false),
      "...and carries required:false - the enroll form's requirement is enforced in code, and these rows are never rendered as fields");
  }
  // An academy that ARCHIVED the field keeps it archived: the conflict is on the
  // key, so its own row wins and this must not resurrect it.
  {
    const archived = [{ id: "a1", key: "emergency_contact_name", label: "Emergency contact name", type: "text", archived: true }];
    const store = fakeStore({ defs: archived });
    await (ensure || ensureStorageOnlyDefs)("client-1", store.sbPost);
    ok(store.table.find((d) => d.key === "emergency_contact_name").archived === true,
      "an ARCHIVED storage def stays archived - archiving is a deliberate owner act and a money-path helper must not silently undo it");
  }

  // ── 5. THE WIRING PIN ─────────────────────────────────────────────────────
  // Everything above can be perfect while nothing calls it. The storage path is
  // reached from exactly one place - the enrollment write block in
  // api/website/checkout.js - so that call is asserted on the source, comments
  // stripped, and ORDER is asserted too: minting after the write stores nothing
  // until the next enrollment, which would look like it worked.
  {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
    ok(/import\s*\{[^}]*ensureStorageOnlyDefs[^}]*\}\s*from\s*["']\.\.\/_contacts\.js["']/.test(code),
      "checkout.js imports ensureStorageOnlyDefs from _contacts.js");
    const ensureAt = code.indexOf("ensureStorageOnlyDefs(clientId)");
    const writeAt = code.indexOf("writePortalFieldValues(");
    ok(ensureAt > 0,
      "checkout.js's enrollment write path CALLS ensureStorageOnlyDefs(clientId) - a storage path nothing calls is a green suite over dead code, which is how the original bug shipped past a passing test run");
    ok(ensureAt > 0 && writeAt > ensureAt,
      `...and calls it BEFORE writePortalFieldValues (ensure at ${ensureAt}, write at ${writeAt}) - writePortalFieldValues resolves keys against the defs that exist when it reads, so minting after it stores nothing until the NEXT enrollment`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN, PRISTINE THEN MUTATED
// ─────────────────────────────────────────────────────────────────────────────
const PRISTINE = { build: buildFields, ensure: ensureStorageOnlyDefs, mintsNothing: false, src: CHECKOUT_SRC, labels: null };
const baseline = await runSuite(PRISTINE);
const baselineRed = new Set(baseline.filter((r) => !r.ok).map((r) => r.label));

let shown = baseline;
if (MUTATE) {
  const m = MUTATIONS[MUTATE];
  shown = await runSuite({
    build: m.build || PRISTINE.build,
    ensure: m.ensure || PRISTINE.ensure,
    mintsNothing: m.mintsNothing || false,
    src: m.srcFn ? m.srcFn() : (m.src || PRISTINE.src),
    labels: m.labels || null,
  });
}

for (const r of shown) console.log((r.ok ? "  ✅ " : "  ❌ ") + r.label);

const fail = shown.filter((r) => !r.ok).length;
const pass = shown.filter((r) => r.ok).length;

if (MUTATE) {
  const nw = shown.filter((r) => !r.ok && !baselineRed.has(r.label));
  console.log("");
  console.log(nw.length
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} produced ${nw.length} failure(s) the pristine run did not have:\n   - ${nw.slice(0, 4).map((r) => r.label.split("\n")[0].slice(0, 130)).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and added no new failure. That check is decorative.`);
  process.exit(nw.length ? 0 : 1);
}

console.log("");
console.log(fail ? `❌ ${pass} passed, ${fail} failed` : `✅ ALL PASS: ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
