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
import { renderEmail, clientVars, resolveMergeVars, locFor, templateBody } from "./email-shells.js";
import { CANONICAL_DEFAULTS, canonicalSteps } from "./form-intro-automations.js";
import { seedAutomations, stepEnabled } from "./agent/seed-automations.js";
import { weeklySchedule } from "./_academy-facts.js";

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
  "onboarding-welcome": "shared",   // promoted 28 Jul 2026, the body facts now come from the sending academy
  "onboarding-training": "local",    // authored per academy (Zoran, 28 Jul 2026), not merely leaky
  "onboarding-review": "shared",    // promoted 28 Jul 2026, the review link is the academy's own
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
  "(289) 816-6569", "byanymeanszoran", "byanymeansadrian", "byanymeansgsc",
  // GTA's review link, identified by ITS path and not by the g.page domain. The bare
  // domain was on this list until 28 Jul 2026 and had to come off: g.page is Google's
  // short host for Google Business review links, so every academy's own legitimate
  // review link lives there. Flagging the domain would have made a correctly
  // templated review email unpromotable forever, for a reason that was never GTA.
  "g.page/r/CfuIFvZGkfmaEBM",
];
// Digits-only forms too, so a differently formatted phone (tel: link, dashes,
// no spaces) cannot slip past a string match on one formatting of it.
const GTA_DIGITS = ["2898166569"];

// A synthetic academy that is NOT BAM GTA. The clientId is deliberately not
// GTA's uuid, so email-shells derives identity from these vars (locFromVars)
// exactly as it would for a real unwired academy.
// public_name is DELIBERATELY the same string GTA renders. From 28 Jul 2026 that is
// production: Zoran ruled the parent-facing name is the BRAND and the city lives in
// the domain, so BAM GTA and BAM San Jose render the identical name to a parent.
//
// That makes this fixture harder, not softer. The name has stopped being a way to
// tell the two academies' output apart, so nothing in this gate may lean on it - and
// with the two names identical, every assertion below is forced to prove itself on
// the details that DO differ: the domain, the owner, the city, the gym, the phone.
// If this line is ever "simplified" back to a distinct name, the gate quietly starts
// passing for the easy reason again.
const NON_GTA = {
  business_name: "BAM San Jose",
  public_name: "By Any Means Basketball",
  website_setup: { domain: "byanymeanssanjose.com" },
  owner_name: "Elijah De Guzman",
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
for (const key of ["onboarding-training"]) {
  const leaks = gtaLeaksIn(key);
  ok(leaks.length > 0,
    `detector sees GTA identity in ${key} (${leaks.join(", ") || "NOTHING - detector may be broken"}), so flipping it to shared FAILS the gate`);
}
// onboarding-welcome and onboarding-review were on this list until 28 Jul 2026 and
// came off it the way the comment above says they should: they started rendering
// clean, so they were promoted deliberately. onboarding-training stays, and stays
// `local` for a different reason - it is authored per academy, not merely leaky.

// THE FACTS PASS. Everything above renders a template for an academy with NO facts
// on file, which proves the blocks drop rather than leaking. It cannot prove the
// opposite case, which is the one this build created: an academy WITH its own venue,
// schedule, coaches, group chat and phone must render THOSE and never GTA's. A
// template that ignored its inputs and printed GTA's gym would sail through the bare
// pass, because with no facts the block is absent either way.
{
  const OWN = {
    location_venue: "500 Innovation Way, San Jose, CA 95110",
    location_schedule: [{ day: "Fridays", groups: [{ name: "Varsity", time: "6-7pm" }] }],
    location_coaches: [{ name: "Elijah", instagram: "https://www.instagram.com/bamsanjose/" }],
    location_community_url: "https://chat.whatsapp.com/SANJOSEINVITE",
    location_community_platform: "WhatsApp",
    location_review_url: "https://g.page/r/SANJOSEREVIEW/review",
    location_phone: "(408) 597-4327",
  };
  for (const key of liveKeys.filter((k) => syncClassForTemplate(k) === "shared")) {
    const html = renderEmail({
      clientId: "00000000-0000-4000-8000-00000000cafe",
      subject: "Test",
      body: `template:${key}`,
      vars: { ...clientVars(NON_GTA), ...OWN },
    });
    const hay = html.toLowerCase();
    const digits = html.replace(/\D+/g, "");
    const leaks = [
      ...GTA_LITERALS.filter((s) => hay.includes(s.toLowerCase())),
      ...GTA_DIGITS.filter((d) => digits.includes(d)),
      // GTA's typed schedule and its group labels, which are not identity strings
      // but are just as much one academy's content as its address is.
      ...["Younger 7-8pm", "Older 8-9pm", "Group 1 (Elementary)"].filter((s) => html.includes(s)),
    ];
    ok(leaks.length === 0,
      `${key} renders a fact-carrying non-GTA academy without leaking GTA${leaks.length ? " - LEAKS: " + leaks.join(", ") : ""}`);
  }
  // And the facts it was GIVEN actually reach the page, or the check above is
  // passing because the template renders nothing at all.
  const welcome = renderEmail({
    clientId: "00000000-0000-4000-8000-00000000cafe", subject: "Test",
    body: "template:onboarding-welcome", vars: { ...clientVars(NON_GTA), ...OWN },
  });
  for (const [what, needle] of [
    ["its own venue", "500 Innovation Way"],
    ["its own schedule", "Varsity 6-7pm"],
    ["its own coach", "Coach Elijah"],
    ["its own group invite", "SANJOSEINVITE"],
    ["its own phone", "(408) 597-4327"],
  ]) ok(welcome.includes(needle), `the welcome email renders ${what} (${needle})`);
}

console.log("\n── SEEDER WIRING: anything not `shared` is seeded, but OFF ──");
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

// THE SEED CONTRACT (api/agent/seed-automations.js stepEnabled): ONLY `shared`
// seeds ON. `local` and `attributed` are both CREATED - so the sequence keeps
// its shape and the slot is visible in the portal - and both seeded OFF, until
// that academy's own content is written into the slot and a human turns it on.
//
// The unit assertion first, so a failure points at the rule and not at whatever
// step ordering a default happens to have today.
console.log("\n── THE SEED CONTRACT: only `shared` seeds ON ──");
ok(stepEnabled({ body: "template:nurture-4" }) === true,
  "shared step seeds ON");
ok(stepEnabled({ body: "template:onboarding-welcome" }) === true,
  "onboarding-welcome seeds ON now that every fact in it comes from the sending academy");
ok(stepEnabled({ body: "template:onboarding-training" }) === false,
  "LOCAL step seeds OFF (an academy-authored email must not send as another academy's)");
ok(stepEnabled({ sync_class: "local", body: "SCHEDULE: ..." }) === false,
  "a literal body the ROW marks 'local' seeds OFF");
ok(stepEnabled({ body: "template:nurture-3" }) === false,
  "attributed step seeds OFF");
ok(stepEnabled({ body: "template:does-not-exist" }) === false,
  "an unclassifiable step seeds OFF (fail closed)");
ok(stepEnabled(null) === false, "a missing step row seeds OFF");

{
  const { sb, calls } = fakeSb();
  await seedAutomations({ clientId: "client-1", keys: ["nurture"], sb });
  const seeded = calls.stepInserts;
  ok(seeded.length === 4, `nurture seeds 4 steps (got ${seeded.length})`);
  const flags = seeded.map((s) => `${s.body}=${s.enabled ? "on" : "OFF"}`);
  for (const f of flags) console.log("     " + f);
  ok(seeded[2] && seeded[2].body === "template:nurture-3" && seeded[2].enabled === false,
    "step 3 (template:nurture-3, attributed) is seeded DISABLED");
  // nurture-1 and nurture-2 are `local` - each academy's own story and its own
  // account of how it trains. They seed OFF too, and that is the intended
  // contract, not a regression: the academy authors them, then turns them on.
  ok([0, 1].every((i) => seeded[i] && seeded[i].enabled === false),
    "steps 1 and 2 (nurture-1/nurture-2, local) are seeded DISABLED");
  ok(seeded[3] && seeded[3].body === "template:nurture-4" && seeded[3].enabled === true,
    "step 4 (template:nurture-4, shared) is the only one seeded ON");
  ok(seeded.every((s) => s.body && s.position != null),
    "the disabled steps are still CREATED, not skipped (sequence keeps its shape)");
  // REVERSED 2026-07-29, deliberately. This used to assert the OPPOSITE - that no
  // sync_class was written, because the migration was unapplied and an unknown
  // column 400s the whole insert. The migration is applied now, and leaving the
  // column unwritten turned out to be a live hole: with nothing on the row, a body
  // edit silently declassified a step from `attributed` to `shared`. The seeder
  // stamps the resolved class, and it must keep stamping it.
  ok(seeded.every((s) => typeof s.sync_class === "string" && s.sync_class),
    "every seeded step carries its resolved sync_class on the row");
  ok(seeded[0].sync_class === "local" && seeded[2].sync_class === "attributed" && seeded[3].sync_class === "shared",
    "and the stamped class is the RESOLVED one per step (local / attributed / shared), not a blanket default");
}

{
  // Edit-safety, unchanged: an academy that already has steps - including one it
  // deliberately disabled by hand - is not touched by a re-seed.
  const { sb, calls } = fakeSb({ existingSteps: [{ id: "old-1" }, { id: "old-2" }] });
  await seedAutomations({ clientId: "client-1", keys: ["nurture"], sb });
  ok(calls.stepInserts.length === 0 && calls.patches.length === 0,
    "re-seeding an automation that already has steps writes nothing (no flag is flipped back)");
}

// Every canonical default: nothing that is not `shared` is ever seeded ON.
{
  const { sb, calls } = fakeSb();
  await seedAutomations({ clientId: "client-1", sb });
  const wrong = calls.stepInserts.filter((s) => resolveSyncClass(s) !== "shared" && s.enabled);
  ok(wrong.length === 0,
    `no non-shared step in ANY canonical default seeds enabled (checked ${calls.stepInserts.length} steps)`
    + (wrong.length ? " - ON but not shared: " + wrong.map((s) => s.body.slice(0, 40)).join(" | ") : ""));
}

console.log("\n── THE CLASS SURVIVES A BODY EDIT (the laundering hole, closed 2026-07-29) ──");
// FOUND BY AN ADVERSARIAL TESTER, and it was live in production.
//
// resolveSyncClass takes the strictest of the ROW's class and the class of the
// TEMPLATE its body references. Until 2026-07-29 the seeder wrote no class on the
// row, so the template ref carried the entire answer - and the moment a body
// stopped being exactly `template:<key>`, the step silently DECLASSIFIED. Real
// parent testimonials went from `attributed` (never copy) to `shared` (copy
// freely) because somebody edited the words, and nothing anywhere noticed.
//
// The seeder now persists the resolved class, and existing rows were backfilled.
// These assertions are what stops it coming back: a body may only ever make a
// step STRICTER, never looser.
{
  const EDITS = [
    ["a literal body", "What families are saying about us"],
    ["an empty body", ""],
    ["a null body", null],
    ["a near-miss ref (capital T)", "Template:nurture-3"],
  ];
  for (const [label, body] of EDITS) {
    ok(resolveSyncClass({ sync_class: "attributed", body }) === "attributed",
      `an attributed row stays attributed after ${label}`);
    ok(mayCopyToAnotherAcademy({ sync_class: "attributed", body }) === false,
      `...and still may not be copied to another academy after ${label}`);
  }
  // The hole itself, asserted directly, so the reason for the fix is legible:
  // WITHOUT a class on the row, every one of those edits resolves `shared`.
  for (const [label, body] of EDITS) {
    ok(resolveSyncClass({ body }) === "shared",
      `(the hole: with NO class on the row, ${label} resolves shared - which is why the seeder must persist it)`);
  }
  // And the seeder does persist it now. Class comes from the step, not a default.
  ok(resolveSyncClass({ body: "template:nurture-3" }) === "attributed"
    && resolveSyncClass({ body: "template:nurture-1" }) === "local"
    && resolveSyncClass({ body: "template:nurture-4" }) === "shared",
    "the class the seeder stamps is the resolved class of the canonical step, not a blanket default");
}

console.log("\n── THE PROMOTED ONBOARDING DEFAULT: 7 steps, GTA's shape minus testimonials ──");
// The welcome drip a brand-new PAYING member gets. It shipped at 3 plain SMS
// against GTA's 8 steps; promoted to 7 on 2026-07-27. The 8th (testimonials) is
// deliberately absent - it carries real GTA parents' quotes. See the comment on
// ONBOARDING_DEFAULT.
{
  const onboarding = canonicalSteps(CANONICAL_DEFAULTS.onboarding);
  ok(onboarding.length === 7, `onboarding default has 7 steps (got ${onboarding.length})`);

  // Shape, pinned. Channel + wait, in order. A silent reorder or retiming of a
  // paying member's first month is a change someone has to make on purpose.
  const SHAPE = [
    ["sms",   0,  "minutes"],
    ["email", 0,  "minutes"],
    ["sms",   5,  "minutes"],
    ["email", 5,  "minutes"],
    ["email", 3,  "days"],
    ["email", 7,  "days"],
    // +14, NOT +7: with the testimonials step absent, +7 would land the review
    // ask a week earlier in a member's life than the sequence GTA proved. When
    // testimonials is inserted at position 6 (+7), this returns to +7.
    ["email", 14, "days"],
  ];
  SHAPE.forEach(([ch, amt, unit], i) => {
    const s = onboarding[i];
    ok(!!s && s.channel === ch && s.wait_amount === amt && s.wait_unit === unit && s.position === i,
      `step ${i + 1}: ${ch} +${amt} ${unit} (got ${s ? `${s.channel} +${s.wait_amount} ${s.wait_unit} pos=${s.position}` : "MISSING"})`);
  });

  // The 6 designed emails GTA runs, minus testimonials.
  const emailBodies = onboarding.filter((s) => s.channel === "email").map((s) => s.body);
  ok(emailBodies.join("|") === [
    "template:onboarding-welcome", "template:onboarding-training",
    "template:onboarding-story", "template:onboarding-era", "template:onboarding-review",
  ].join("|"), `the 5 designed emails, in order (got ${emailBodies.join(", ")})`);

  // THE DIVERGENCE, ASSERTED. If someone closes the gap by pasting the template
  // key in, this fails and points them at why.
  ok(!onboarding.some((s) => templateRefKey(s.body) === "onboarding-testimonials"),
    "the testimonials step is ABSENT - it carries real GTA parents' quotes ({{location.city}} "
    + "re-attributes them to the sender). Only a per-academy testimonial connection may close this gap.");

  // Seeded pattern.
  const { sb, calls } = fakeSb();
  await seedAutomations({ clientId: "client-1", keys: ["onboarding"], sb });
  const seeded = calls.stepInserts;
  for (const s of seeded) console.log(`     ${s.channel.padEnd(5)} ${String(s.body).slice(0, 44).replace(/\n/g, " ⏎ ").padEnd(46)} ${s.enabled ? "on" : "OFF"}`);
  ok(seeded.length === 7, `all 7 steps are created (got ${seeded.length})`);
  // welcome (2) and review (7) seed ON: every fact in them is now the sending
  // academy's own. The schedule SMS and the three authored emails stay OFF.
  ok(seeded.map((s) => (s.enabled ? "1" : "0")).join("") === "1110001",
    `enabled pattern is on,on,on,OFF,OFF,OFF,on (got ${seeded.map((s) => (s.enabled ? "on" : "OFF")).join(",")})`);
  ok(seeded[0].enabled === true && seeded[0].channel === "sms",
    "step 1 (the tokenized welcome SMS) is the only one that seeds ON - it is `shared`");
  // The schedule SMS seeds ON since 28 Jul 2026 because it is GENERATED now - it
  // carries {{location.schedule}} and {{location.venue}}, not one academy's typed
  // times. Its safety moved from "never send it" to "there is nothing to send": an
  // academy with no sessions and no venue resolves it to an empty string, which
  // api/_send.js declines to send. Asserted directly below rather than trusted.
  ok(seeded[2].enabled === true && seeded[2].channel === "sms",
    "step 3 (the schedule SMS) seeds ON now that it generates from the academy's own sessions");
  {
    const bare = { id: "x", business_name: "Nobody Academy" };
    const V = (extra) => ({ ...clientVars(bare), ...extra });
    const render = (extra) => resolveMergeVars(seeded[2].body, locFor("x", V(extra)), V(extra));
    const WEEK = [{ day: "Fridays", groups: [{ name: "Varsity", time: "6-7pm" }] }];

    ok(render({}).trim() === "",
      `an academy with no sessions and no venue resolves the schedule SMS to nothing, so nothing sends (got ${JSON.stringify(render({}))})`);

    // THE HALF-EMPTY CASE, and the one that would actually have shipped. San Jose has
    // a gym and zero sessions entered, so a venue-only render would have texted its
    // members "LOCATION: 1051 W San Fernando St" and nothing else, five minutes after
    // they paid. The all-empty case was handled and this one was not.
    const venueOnly = render({ location_venue: "1051 W San Fernando St, San Jose, CA 95126" });
    ok(venueOnly.trim() === "",
      `an academy with a venue but NO sessions still sends nothing - the venue rides with the schedule, it is not its own message (got ${JSON.stringify(venueOnly)})`);

    const both = render({ location_schedule: WEEK, location_venue: "500 Innovation Way" });
    ok(both.includes("FRIDAYS") && both.includes("Varsity: 6-7pm") && both.includes("LOCATION: 500 Innovation Way"),
      `with sessions and a venue the schedule SMS carries both (got ${JSON.stringify(both)})`);

    const noVenue = render({ location_schedule: WEEK });
    ok(noVenue.includes("Varsity: 6-7pm") && !noVenue.includes("LOCATION:"),
      `with sessions but no venue it sends the week and no empty location line (got ${JSON.stringify(noVenue)})`);
  }

  // AN UNRECOGNISED TIME ZONE MUST NOT PRODUCE A SCHEDULE. Computing in UTC instead
  // gives a plausible-looking timetable on the wrong days, which a member cannot tell
  // from a right one. No schedule is visibly missing and stops the message sending.
  {
    const slots = [{ name: "Varsity", start_time: "2026-07-03T02:00:00Z", end_time: "2026-07-03T03:00:00Z", is_cancelled: false }];
    const good = weeklySchedule(slots, "America/Los_Angeles");
    ok(good.length === 1 && good[0].day === "Thursdays" && good[0].groups[0].time === "7-8pm",
      `a real zone reads the session in the academy's own local time (got ${JSON.stringify(good)})`);
    const warn = console.warn; let warned = ""; console.warn = (m) => { warned = String(m); };
    const bad = weeklySchedule(slots, "Eastern Time (US & Canada)");
    console.warn = warn;
    ok(bad.length === 0, `an unrecognised time zone yields NO schedule rather than a wrong one (got ${JSON.stringify(bad)})`);
    ok(/time zone/i.test(warned), "...and says so out loud rather than emptying silently");
    const none = weeklySchedule(slots, "");
    ok(none.length === 1, "an EMPTY time zone is not an error - it falls back to UTC and still builds");
  }

  // THE REVIEW ASK WITHOUT A REVIEW LINK. It seeds ON, so an academy with no Google
  // review URL on file would have received three paragraphs asking for a review with
  // no way to leave one: dropEmptyShellLinks correctly removes the dead button and
  // nothing removed the sentences around it. The template returns "" instead, and the
  // send path asks the RESOLVED content whether there is anything to send.
  {
    const noLink = { id: "y", business_name: "Nobody Academy" };
    const withLink = { ...noLink, google_review_url: "https://g.page/r/NOBODYACADEMY/review" };
    const body = "template:onboarding-review";
    const empty = templateBody({ clientId: "y", body, vars: clientVars(noLink) });
    ok(empty.trim() === "",
      "the review email renders to NOTHING for an academy with no review link, so no review ask goes out without one");
    const full = templateBody({ clientId: "y", body, vars: clientVars(withLink) });
    ok(full.includes("NOBODYACADEMY") && full.includes("Leave a Google review"),
      "...and renders in full, with that academy's own link, as soon as there is one");
  }
  ok([3, 4, 5].every((i) => seeded[i].enabled === false),
    "the three AUTHORED emails (-training/-story/-era) still seed OFF - a human writes those");
  ok(seeded[1].enabled === true && seeded[6].enabled === true,
    "the welcome and review emails seed ON - both are `shared` and carry no academy's facts but the sender's");
}

console.log("\n── NO GTA LITERAL IN ANY CANONICAL DEFAULT (bodies + subjects) ──");
// The templates are gated by the render-leak gate above. This gates the OTHER
// half - the step bodies and subjects written by hand in
// api/form-intro-automations.js, where the schedule SMS trap lives: GTA's
// version of that step is its literal training times and Oakville gym address,
// and pasting it into the master would text it to every academy.
{
  const offenders = [];
  for (const [key, def] of Object.entries(CANONICAL_DEFAULTS)) {
    for (const s of canonicalSteps(def)) {
      const text = `${s.subject || ""}\n${s.body || ""}`;
      if (templateRefKey(s.body)) continue;  // template bodies: covered by the render-leak gate
      const hay = text.toLowerCase();
      const digits = text.replace(/\D+/g, "");
      const hits = [
        ...GTA_LITERALS.filter((l) => hay.includes(l.toLowerCase())),
        ...GTA_DIGITS.filter((d) => d && digits.includes(d)),
      ];
      if (hits.length) offenders.push(`${key} pos ${s.position}: ${hits.join(", ")}`);
    }
  }
  ok(offenders.length === 0,
    `no literal step body or subject carries GTA identity${offenders.length ? " - " + offenders.join(" | ") : ""}`);
}

console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
