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
import { renderEmail } from "./email-shells.js";
import { CANONICAL_DEFAULTS, canonicalSteps } from "./form-intro-automations.js";

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
ok(resolveSyncClass({ body: "template:nurture-1" }) === "shared",
  "absent step value + shared template -> shared");

// A step row can only make things STRICTER.
ok(resolveSyncClass({ sync_class: "local", body: "template:nurture-1" }) === "local",
  "step 'local' on a shared template -> local (row raises)");
ok(resolveSyncClass({ sync_class: "attributed", body: "template:nurture-1" }) === "attributed",
  "step 'attributed' on a shared template -> attributed (row raises)");
ok(resolveSyncClass({ sync_class: "shared", body: "template:nurture-1" }) === "shared",
  "step 'shared' on a shared template -> shared");
ok(resolveSyncClass({ sync_class: "local", body: "template:nurture-3" }) === "attributed",
  "step 'local' cannot lower an attributed template");
ok(resolveSyncClass({ sync_class: "shared", body: "template:onboarding-welcome" }) === "local",
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
ok(resolveSyncClass({ sync_class: "Shared ", body: "template:nurture-1" }) === "shared",
  "case/whitespace is normalized, not rejected ('Shared ' -> shared)");
ok(resolveSyncClass({ sync_class: "sharedd", body: "template:nurture-1" }) === "attributed",
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

console.log("\n── Canonical preset defaults: what would travel today ──");
// Informational + a hard assertion: the seeded nurture default DOES include the
// attributed testimonial step, so any copier must consult the resolver.
const nurtureSteps = canonicalSteps(CANONICAL_DEFAULTS.nurture);
const resolved = nurtureSteps.map((s) => `${s.body} -> ${resolveSyncClass(s)}`);
for (const line of resolved) console.log("     " + line);
ok(nurtureSteps.some((s) => resolveSyncClass(s) === "attributed"),
  "the canonical 'nurture' default contains an attributed step (template:nurture-3)");

console.log(`\n${fail ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
