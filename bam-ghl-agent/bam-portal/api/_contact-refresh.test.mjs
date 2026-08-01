// CONTACT REFRESH: the one GHL-contact -> mirror-row mapping, shared by the
// sync cron and the manual refresh CLI.
//
//   node api/_contact-refresh.test.mjs
//
// WHAT THIS IS ABOUT.
// api/ghl/cron-sync-contacts.js maps each GHL contact into a ghl_contacts
// mirror row (and, minus synced_at, into the portal contacts store). That
// mapping used to live inline in the cron's v15 block; it was extracted as
// ghlContactToMirrorRow so scripts/refresh-portal-contacts.mjs (the one-shot
// per-academy refresh for v2/ghl academies the cron never mirrors, e.g. BAM
// San Jose) can reuse it VERBATIM. Two writers, one mapping - the entire value
// of the extraction is that neither can silently fork.
//
// WHAT IT PROVES
//   1. THE MAPPING, in bytes. A fixture GHL contact (customFields array, tags
//      as mixed strings/objects, dndSettings, firstName/lastName) produces the
//      exact declared row: email lowercased+trimmed, the name join fallback
//      chain, athlete_name resolved from v15_config.athlete_name_field_ids,
//      custom_fields keyed by field id, dnd true when any dndSettings status
//      is active, null when the contact has no id at all.
//   2. THE WIRING. The cron still CALLS ghlContactToMirrorRow (and no longer
//      holds an inline copy), and the script IMPORTS the same function from
//      the cron file and calls it - so neither writer can fork the mapping.
//
// HOW IT RUNS. No network, no database, no node_modules. Importing the cron at
// module level pulls @sentry/node (via _sentry.js) plus _core.js/_contacts.js
// env plumbing, none of which exists on CI's plain-node step. So the exact
// source text of ghlContactToMirrorRow is CUT OUT of the shipped file by its
// own declaration line and imported as a temporary module: what executes below
// is the shipped code byte for byte, and a renamed or moved declaration makes
// the extraction FAIL LOUDLY rather than quietly test nothing.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing; the run must print
// NEGATIVE CONTROL PASSED (and "control caught: ..."), exit 0 only when caught:
//
//   MUTATE=fork   node api/_contact-refresh.test.mjs
//                 # simulates the script defining its own LOCAL mapping instead
//                 # of importing the cron's - the wiring pins must catch it
//   MUTATE=email  node api/_contact-refresh.test.mjs
//                 # the mapping stops lowercasing email - the byte pin on the
//                 # fixture row must catch it

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
// Key-order-insensitive deep compare (custom_fields mixes integer-like and
// string keys, whose JS enumeration order differs from insertion order).
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  }
  return v;
};
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ─── cutting the shipped mapping out of the shipped file ─────────────────────
function cut(src, pin, where) {
  const at = src.indexOf(pin);
  if (at === -1) {
    controlBroken = `This suite is pinned to text that is no longer in ${where}:\n\n${pin}\n\nThe code it was written against has moved or been renamed, so it proves nothing. Re-point it, or delete it.`;
    throw new Error(controlBroken);
  }
  let i = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1) + ";\n"; }
  }
  controlBroken = `unbalanced braces after ${pin} in ${where}`;
  throw new Error(controlBroken);
}

const CRON_PATH = path.join(HERE, "ghl", "cron-sync-contacts.js");
const SCRIPT_PATH = path.join(HERE, "..", "scripts", "refresh-portal-contacts.mjs");
const CRON = fs.readFileSync(CRON_PATH, "utf8");
let SCRIPT = fs.readFileSync(SCRIPT_PATH, "utf8");

const MAP_PIN = "export function ghlContactToMirrorRow(client, c, nowIsoStr) {";
let mapSrc = cut(CRON, MAP_PIN, "api/ghl/cron-sync-contacts.js");

// ─── the mutations, expressed against the real source text ───────────────────
if (MUTATE === "email") {
  const pin = '(c.email || "").toLowerCase().trim() || null';
  if (!mapSrc.includes(pin)) {
    console.log(`\n❌ NEGATIVE CONTROL FAILED: the email control is pinned to text no longer in the mapping:\n${pin}`);
    process.exit(1);
  }
  mapSrc = mapSrc.split(pin).join('(c.email || "").trim() || null');   // MUTATED: lowercasing dropped
}
if (MUTATE === "fork") {
  // The script stops importing the shared mapping and grows a local one.
  const pin = "ghlContactToMirrorRow, ghlFetchWithBackoff } from \"../api/ghl/cron-sync-contacts.js\";";
  if (!SCRIPT.includes(pin)) {
    console.log(`\n❌ NEGATIVE CONTROL FAILED: the fork control is pinned to an import line no longer in the script:\n${pin}`);
    process.exit(1);
  }
  SCRIPT = SCRIPT.replace(pin,
    "ghlFetchWithBackoff } from \"../api/ghl/cron-sync-contacts.js\";\n" +
    "function ghlContactToMirrorRow(client, c, nowIsoStr) { return null; }   // MUTATED: local fork");
}

const TMP = path.join(HERE, ".contact-refresh-under-test.mjs");
fs.writeFileSync(TMP, mapSrc);
let ghlContactToMirrorRow;
try { ({ ghlContactToMirrorRow } = await import(pathToFileURL(TMP).href)); }
finally { try { fs.unlinkSync(TMP); } catch (_) { /* best effort */ } }

// ─── 1. the mapping, pinned in bytes ─────────────────────────────────────────
console.log("\n── 1. a fixture GHL contact maps to the exact declared row ──");
const NOW = "2026-07-31T12:00:00.000Z";
const CLIENT = {
  id: "client-1",
  v15_config: { athlete_name_field_ids: ["fld_ath_1", "fld_ath_2"] },
};
const FIXTURE = {
  id: "ghl-abc",
  firstName: "Dana",
  lastName: "Petrov",
  email: "  Dana.Petrov@Example.COM ",
  phone: "+14085551234",
  tags: ["lead", { name: "member" }, { tag: "vip" }, {}, ""],
  customFields: [
    { id: "fld_ath_1", value: "" },              // mapped athlete field, blank: skipped
    { id: "fld_ath_2", value: "  Luka  " },      // resolves, trimmed
    { id: "fld_src", field_value: "instagram" }, // alt value key
    { id: 77, fieldValue: "seventy-seven" },     // numeric id becomes a string key
    { value: "orphan" },                          // no id: dropped
  ],
  dndSettings: { SMS: { status: "inactive" }, Email: { status: "active" } },
  dateAdded: "2026-06-30T10:00:00.000Z",
};
// Declared HERE, not derived from the code - otherwise the code is only ever
// checked against itself.
const EXPECTED = {
  client_id: "client-1", ghl_contact_id: "ghl-abc",
  first_name: "Dana", last_name: "Petrov", name: "Dana Petrov",
  email: "dana.petrov@example.com", phone: "+14085551234",
  tags: ["lead", "member", "vip"],
  athlete_name: "Luka",
  custom_fields: { fld_ath_1: "", fld_ath_2: "  Luka  ", fld_src: "instagram", "77": "seventy-seven" },
  dnd: true,
  date_added: "2026-06-30T10:00:00.000Z", synced_at: NOW,
};
{
  const row = ghlContactToMirrorRow(CLIENT, FIXTURE, NOW);
  ok(!!row, "the fixture maps to a row at all");
  ok(same(row, EXPECTED), "the WHOLE row matches the declared expectation, key for key");
  ok(row?.email === "dana.petrov@example.com", "email is lowercased AND trimmed");
  ok(same(row?.tags, ["lead", "member", "vip"]), "mixed string/object tags normalize to names, junk dropped");
  ok(row?.athlete_name === "Luka", "athlete_name resolves from v15_config.athlete_name_field_ids (first non-blank), trimmed");
  ok(same(canon(row?.custom_fields), canon(EXPECTED.custom_fields)), "custom_fields is keyed by field id, numeric ids stringified, no-id entries dropped");
  ok(row?.dnd === true, "dnd is true when ANY dndSettings status is active");
  ok(row?.synced_at === NOW, "synced_at is exactly the nowIsoStr the caller passed");
}
{
  // The name fallback chain: first+last join, then contactName, then name, then null.
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", contactName: "Solo Contact" }, NOW)?.name === "Solo Contact",
    "no first/last: name falls back to contactName");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", name: "Bare Name" }, NOW)?.name === "Bare Name",
    "no first/last/contactName: name falls back to name");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x" }, NOW)?.name === null, "no name anywhere: null, not empty string");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", firstName: "Only" }, NOW)?.name === "Only",
    "first name alone joins without a trailing space");
}
{
  ok(ghlContactToMirrorRow(CLIENT, { email: "x@y.z", phone: "+1" }, NOW) === null,
    "a contact with NO id (neither id nor contactId) maps to null");
  ok(ghlContactToMirrorRow(CLIENT, { contactId: "cid-2" }, NOW)?.ghl_contact_id === "cid-2",
    "contactId is accepted as the id fallback");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", email: "   " }, NOW)?.email === null,
    "a whitespace-only email stores null, not an empty string");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", dndSettings: { SMS: { status: "inactive" } } }, NOW)?.dnd === false,
    "dnd is false when no dndSettings status is active");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", dnd: true }, NOW)?.dnd === true,
    "a bare dnd:true flag also counts");
  ok(ghlContactToMirrorRow({ id: "c2" }, FIXTURE, NOW)?.athlete_name === null,
    "a client with NO v15_config (the v2/ghl refresh case) resolves no athlete_name and does not throw");
  ok(ghlContactToMirrorRow(CLIENT, { id: "x", customField: [{ id: "a", value: "1" }] }, NOW)?.custom_fields?.a === "1",
    "the singular customField key is read too");
}

// ─── 2. the wiring: two writers, one mapping ─────────────────────────────────
// Comment lines are excluded before matching, so prose ABOUT the function is
// never mistaken for a CALL to it.
console.log("\n── 2. the cron and the script are both wired to the SAME mapping ──");
const codeLines = (src) => src.split("\n").filter((l) => !l.trim().startsWith("//"));
{
  ok(codeLines(CRON).some((l) => l.includes("contacts.map(c => ghlContactToMirrorRow(client, c, nowIso()))")),
    "the CRON's v15 mirror block calls ghlContactToMirrorRow per contact");
  ok(!codeLines(CRON).some((l) => l.includes("mirrorRows = contacts.map(c => {")),
    "and the old inline mapping body is GONE from the cron (no second copy)");
  ok(/import \{[^}]*\bghlContactToMirrorRow\b[^}]*\} from "\.\.\/api\/ghl\/cron-sync-contacts\.js"/.test(SCRIPT),
    "the SCRIPT imports ghlContactToMirrorRow from the cron file, not a copy");
  ok(codeLines(SCRIPT).some((l) => l.includes("ghlContactToMirrorRow(client, c,")),
    "and the script actually CALLS it per contact");
  ok(!codeLines(SCRIPT).some((l) => /function ghlContactToMirrorRow|const ghlContactToMirrorRow\s*=/.test(l)),
    "the script defines NO local mapping of its own - a fork here is exactly the drift the extraction exists to prevent");
  ok(/import \{[^}]*\bghlFetchWithBackoff\b[^}]*\} from "\.\.\/api\/ghl\/cron-sync-contacts\.js"/.test(SCRIPT),
    "the script reuses the cron's 429 backoff too, rather than forking it");
  ok(codeLines(SCRIPT).some((l) => l.includes('params.set("startAfterId"')) &&
     codeLines(SCRIPT).some((l) => l.includes('params.set("startAfter"')),
    "the script pages with BOTH startAfterId and startAfter (id-only stalls after the first page)");
  ok(codeLines(SCRIPT).some((l) => l.includes('contact_provider === "portal"')),
    "the script guards against contact_provider='portal' academies (their store is the source of truth)");
}

// ─── footer ──────────────────────────────────────────────────────────────────
console.log("");
if (MUTATE) {
  if (controlBroken) {
    console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`);
    process.exit(1);
  }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: control caught: the ${MUTATE} mutation tripped ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: the ${MUTATE} mutation changed nothing this suite noticed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
