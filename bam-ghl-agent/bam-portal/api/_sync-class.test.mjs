// Test for the sync_class resolver (api/_sync-class.js).
//
// This test is the ONLY thing that detects a wrong answer here: the weekly
// drift checker was cancelled, so nothing else notices if a step carrying real
// parent testimonials starts resolving to 'shared' and gets copied to another
// academy.
//
//   node api/_sync-class.test.mjs        # exits non-zero on any failure
//
// Same plain-node style as api/_fees.test.mjs / api/_offer-schedule.test.mjs
// (vitest.config.ts only includes api/_runtime, api/runtime, api/parent,
// api/client - these api/*.test.mjs files are run directly).

import {
  resolveSyncClass,
  mayCopyToAnotherAcademy,
  strictest,
  normalizeSyncClass,
  templateRefKey,
  syncClassForTemplate,
  TEMPLATE_SYNC_CLASS,
} from "./_sync-class.js";
import { TEMPLATES as NURTURE } from "./email-templates/nurture-emails.js";
import { ONBOARDING_TEMPLATES } from "./email-templates/onboarding-emails.js";
import { renderEmail, clientVars } from "./email-shells.js";
import { CANONICAL_DEFAULTS, canonicalSteps } from "./form-intro-automations.js";
import { seedAutomations } from "./agent/seed-automations.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✅ " + m); } else { fail++; console.log("  ❌ " + m); } };

console.log("\n── THE RULE: strictest wins, attributed > local > shared ──");
// The load-bearing case: the step row says it's safe to copy, the template it
// points at is real parent quotes. The template must win.
ok(resolveSyncClass({ sync_class: "shared", body: "template:nurture-3" }) === "attributed",
  "step sync_class='shared' + body 'template:nurture-3' -> attributed");
ok(resolveSyncClass({ sync_class: "shared", body: "template:onboarding-testimonials" }) === "attributed",
  "step sync_class='shared' + body 'template:onboarding-testimonials' -> attributed");
ok(mayCopyToAnotherAcademy({ sync_class: "shared", body: "template:nurture-3" }) === false,
  "...and it may NOT be copied to another academy");

// Absent step value inherits the template.
ok(resolveSyncClass({ body: "template:nurture-3" }) === "attributed",
  "absent step value + attributed template -> attributed");
ok(resolveSyncClass({ sync_class: null, body: "template:nurture-3" }) === "attributed",
  "sync_class null + attributed template -> attributed");
ok(resolveSyncClass({ body: "template:nurture-4" }) === "shared",
  "absent step value + shared template -> shared");

// A step row can only make things STRICTER.
ok(resolveSyncClass({ sync_class: "local", body: "template:nurture-4" }) === "local",
  "step 'local' on a shared template -> local (row raises)");
ok(resolveSyncClass({ sync_class: "attributed", body: "template:nurture-4" }) === "attributed",
  "step 'attributed' on a shared template -> attributed (row raises)");
ok(resolveSyncClass({ sync_class: "shared", body: "template:nurture-4" }) === "shared",
  "step 'shared' on a shared template -> shared");
ok(resolveSyncClass({ sync_class: "local", body: "template:nurture-3" }) === "attributed",
  "step 'local' cannot lower an attributed template");
ok(resolveSyncClass({ sync_class: "shared", body: "template:onboarding-training" }) === "local",
  "step 'shared' cannot lower a local template");

// Literal bodies: the row's own value is the whole answer.
ok(resolveSyncClass({ sync_class: "shared", body: "Hey {{contact.first_name}}!" }) === "shared",
  "literal body + 'shared' -> shared");
ok(resolveSyncClass({ body: "Hey {{contact.first_name}}!" }) === "shared",
  "literal body, no value -> shared (column default)");
ok(resolveSyncClass({ sync_class: "attributed", body: "\"Best gym in town\" - a real parent" }) === "attributed",
  "literal body marked attributed stays attributed");

console.log("\n── FAIL CLOSED on anything unknown ──");
ok(resolveSyncClass({ body: "template:does-not-exist" }) === "attributed",
  "undeclared template key -> attributed (not shared)");
ok(resolveSyncClass({ sync_class: "Shared ", body: "template:nurture-4" }) === "shared",
  "case/whitespace is normalized, not rejected ('Shared ' -> shared)");
ok(resolveSyncClass({ sync_class: "sharedd", body: "template:nurture-4" }) === "attributed",
  "typo'd class value -> attributed (a typo is never permission)");
ok(resolveSyncClass(null) === "attributed", "missing step row -> attributed");
ok(resolveSyncClass(undefined) === "attributed", "undefined step -> attributed");
ok(normalizeSyncClass("") === "shared" && normalizeSyncClass(undefined) === "shared",
  "empty/absent normalizes to the column default 'shared'");
ok(strictest("shared", "local", "shared") === "local" && strictest() === "shared",
  "strictest() picks the highest rank, empty -> shared");

console.log("\n── Template-ref matcher agrees with what renderEmail actually sends ──");
// If this matcher and renderEmail's disagree, a body could SEND a testimonial
// template while CLASSIFYING as plain text. Verified against real output.
const REF_CASES = [
  "template:nurture-3",
  "  template:nurture-3  ",
  "template:onboarding-testimonials",
  "template:nurture-3 and more text",
  "Please see template:nurture-3",
  "Hey {{contact.first_name}}!",
];
for (const body of REF_CASES) {
  const key = templateRefKey(body);
  const html = renderEmail({ clientId: "x", subject: "s", body });
  // A real parent quote from the nurture-3 design. Its presence in the rendered
  // output proves the template was expanded and the testimonial actually went
  // out. (Checked against the quote, not the headline: the headline has a
  // typographic apostrophe and matching on it silently never fires.)
  const sentTemplate = html.includes("The style of training is like no other");
  ok(!!key === sentTemplate,
    `matcher agrees with renderEmail for ${JSON.stringify(body.slice(0, 34))} (ref=${key || "none"}, sent template=${sentTemplate})`);
}

console.log("\n── Every live template key is declared (no silent fail-closed) ──");
const liveKeys = [...Object.keys(NURTURE), ...Object.keys(ONBOARDING_TEMPLATES)];
const undeclared = liveKeys.filter((k) => !TEMPLATE_SYNC_CLASS[k]);
ok(undeclared.length === 0,
  `all ${liveKeys.length} template keys declared in email-templates/sync-classes.js${undeclared.length ? " - MISSING: " + undeclared.join(", ") : ""}`);
const stale = Object.keys(TEMPLATE_SYNC_CLASS).filter((k) => !liveKeys.includes(k));
ok(stale.length === 0, `no stale declarations${stale.length ? " - " + stale.join(", ") : ""}`);
ok(syncClassForTemplate("nurture-3") === "attributed" && syncClassForTemplate("onboarding-testimonials") === "attributed",
  "the two testimonial templates are declared attributed");

console.log("\n── The authoritative classification (Zoran, 27 Jul 2026) ──");
// Pinned so a future edit to sync-classes.js has to be a DECISION, not a drift.
// If you are changing a line here, you are overriding a human call - be sure.
const DECIDED = {
  "nurture-1": "local",
  "nurture-2": "local",
  "nurture-3": "attributed",
  "nurture-4": "shared",
  "onboarding-welcome": "local",
  "onboarding-training": "local",
  "onboarding-review": "local",
  "onboarding-story": "local",
  "onboarding-era": "local",
  "onboarding-testimonials": "attributed",
};
for (const [key, want] of Object.entries(DECIDED)) {
  ok(syncClassForTemplate(key) === want, `${key.padEnd(24)} ${want} (got ${syncClassForTemplate(key)})`);
}
// The two onboarding copies must never be looser than the nurture designs they
// are made from - one copy marked looser leaks what the other blocks.
ok(syncClassForTemplate("onboarding-story") === syncClassForTemplate("nurture-1")
  && syncClassForTemplate("onboarding-era") === syncClassForTemplate("nurture-2")
  && syncClassForTemplate("onboarding-testimonials") === syncClassForTemplate("nurture-3"),
  "onboarding story/era/testimonials match their nurture-1/2/3 sources");

console.log("\n── Canonical preset defaults: what would travel today ──");
// Informational + a hard assertion: the seeded nurture default DOES include the
// attributed testimonial step, so any copier must consult the resolver.
const nurtureSteps = canonicalSteps(CANONICAL_DEFAULTS.nurture);
const resolved = nurtureSteps.map((s) => `${s.body} -> ${resolveSyncClass(s)}`);
for (const line of resolved) console.log("     " + line);
ok(nurtureSteps.some((s) => resolveSyncClass(s) === "attributed"),
  "the canonical 'nurture' default contains an attributed step (template:nurture-3)");

console.log("\n── RENDER-LEAK GATE: nothing declared `shared` may carry GTA identity ──");
//
// THIS IS THE GATE FOR RAISING A TEMPLATE TO `shared`. Do not delete it as
// redundant with the declaration table - it is the thing that makes the table
// trustworthy.
//
// Why it exists: every wrong class in this system's short history came from an
// ASSERTION about what a template contains ("the re-shell fixed it", "that's
// just the frame") rather than from looking at output. One such assertion said
// onboarding-welcome was safe to copy while its body still carried GTA's coach
// phone number and gym address. Human judgement, however senior, is not a
// control. Rendered bytes are.
//
// So: render every `shared` template through the REAL send path (renderEmail)
// for a synthetic NON-GTA academy, and fail if any GTA-identity literal
// survives. Promoting a template to `shared` is then safe by construction -
// the test either passes, or it names the literal still in there.
const GTA_LITERALS = [
  "byanymeanstoronto", "Linbrook", "Oakville", "By Any Means GTA", "BAM GTA",
  "(289) 816-6569", "byanymeanszoran", "byanymeansadrian", "byanymeansgsc", "g.page",
];
// Digits-only forms too, so a differently formatted phone (tel: link, dashes,
// no spaces) cannot slip past a string match on one formatting of it.
const GTA_DIGITS = ["2898166569"];

// A synthetic academy that is NOT BAM GTA. The clientId is deliberately not
// GTA's uuid, so email-shells derives identity from these vars (locFromVars)
// exactly as it would for a real unwired academy.
const NON_GTA = {
  business_name: "BAM San Jose",
  website_setup: { domain: "byanymeanssanjose.com" },
  owner_name: "Sample Owner",
  email: "info@byanymeanssanjose.com",
  address: "1051 W San Fernando St, San Jose, CA 95126",
};
function gtaLeaksIn(templateKey) {
  const html = renderEmail({
    clientId: "00000000-0000-4000-8000-00000000cafe",
    subject: "Test",
    body: `template:${templateKey}`,
    vars: clientVars(NON_GTA),
  });
  const hay = html.toLowerCase();
  const digits = html.replace(/\D+/g, "");
  return [
    ...GTA_LITERALS.filter((s) => hay.includes(s.toLowerCase())),
    ...GTA_DIGITS.filter((d) => digits.includes(d)),
  ];
}

const sharedKeys = liveKeys.filter((k) => syncClassForTemplate(k) === "shared");
ok(sharedKeys.length > 0, `there is at least one shared template to check (${sharedKeys.join(", ") || "none"})`);
for (const key of sharedKeys) {
  const leaks = gtaLeaksIn(key);
  ok(leaks.length === 0, `${key} renders clean for a non-GTA academy${leaks.length ? " - LEAKS: " + leaks.join(", ") : ""}`);
}

// NEGATIVE CONTROL. A leak detector that detects nothing passes everything.
// These three are `local` precisely because their bodies still carry GTA
// identity; the gate must SEE that. If one ever renders clean, the body swap
// has landed and it becomes a candidate for `shared` - promote it deliberately,
// do not delete this assertion.
for (const key of ["onboarding-welcome", "onboarding-review", "onboarding-training"]) {
  const leaks = gtaLeaksIn(key);
  ok(leaks.length > 0,
    `detector sees GTA identity in ${key} (${leaks.join(", ") || "NOTHING - detector may be broken"}), so flipping it to shared FAILS the gate`);
}

console.log("\n── SEEDER WIRING: an attributed step is seeded, but OFF ──");
// The marking only does anything because seedAutomations consults the resolver.
// Fake sb() so this runs with no database: record what the seeder would POST.
// Steps are tracked PER automation_id (a shared bucket would make the second
// automation look already-seeded and silently skip - it did, first try).
function fakeSb({ existingSteps = [] } = {}) {
  const calls = { stepInserts: [], automationInserts: [], patches: [] };
  const byAutomation = new Map();
  let n = 0;
  const sb = async (path, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    if (path.startsWith("automations?")) {
      if (method === "POST") {
        calls.automationInserts.push(JSON.parse(opts.body));
        const id = `auto-${++n}`;
        byAutomation.set(id, [...existingSteps]);
        return [{ id }];
      }
      return []; // no existing automation row -> the seeder creates one
    }
    if (path.startsWith("automation_steps")) {
      if (method === "POST") {
        const rows = JSON.parse(opts.body);
        calls.stepInserts.push(...rows);
        for (const r of rows) byAutomation.get(r.automation_id).push(r);
        return null;
      }
      if (method === "PATCH") { calls.patches.push(path); return null; }
      const id = (path.match(/automation_id=eq\.([\w-]+)/) || [])[1];
      return (byAutomation.get(id) || []).map((_, i) => ({ id: `step-${i}` }));
    }
    return [];
  };
  return { sb, calls };
}

{
  const { sb, calls } = fakeSb();
  await seedAutomations({ clientId: "client-1", keys: ["nurture"], sb });
  const seeded = calls.stepInserts;
  ok(seeded.length === 4, `nurture seeds 4 steps (got ${seeded.length})`);
  const flags = seeded.map((s) => `${s.body}=${s.enabled ? "on" : "OFF"}`);
  for (const f of flags) console.log("     " + f);
  ok(seeded[2] && seeded[2].body === "template:nurture-3" && seeded[2].enabled === false,
    "step 3 (template:nurture-3, attributed) is seeded DISABLED");
  ok([0, 1, 3].every((i) => seeded[i] && seeded[i].enabled === true),
    "steps 1, 2 and 4 are seeded enabled");
  ok(seeded.every((s) => s.body && s.position != null),
    "the attributed step is still CREATED, not skipped (sequence keeps its shape)");
  ok(seeded.every((s) => !("sync_class" in s)),
    "no sync_class column is written yet (its migration is unapplied; an unknown column 400s the insert)");
}

{
  // Edit-safety, unchanged: an academy that already has steps - including one it
  // deliberately disabled by hand - is not touched by a re-seed.
  const { sb, calls } = fakeSb({ existingSteps: [{ id: "old-1" }, { id: "old-2" }] });
  await seedAutomations({ clientId: "client-1", keys: ["nurture"], sb });
  ok(calls.stepInserts.length === 0 && calls.patches.length === 0,
    "re-seeding an automation that already has steps writes nothing (no flag is flipped back)");
}

// Every canonical default: nothing attributed is ever seeded ON.
{
  const { sb, calls } = fakeSb();
  await seedAutomations({ clientId: "client-1", sb });
  const wrong = calls.stepInserts.filter((s) => resolveSyncClass(s) === "attributed" && s.enabled);
  ok(wrong.length === 0,
    `no attributed step in ANY canonical default seeds enabled (checked ${calls.stepInserts.length} steps)`);
}

console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
