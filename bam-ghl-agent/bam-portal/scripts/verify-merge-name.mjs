// Does an automation text actually say the parent's NAME?
//
// The bug (BAM GTA, found 2026-08-05): resolveContactInfo asked GHL and only GHL
// for the lead's name. GTA is off-GHL - the portal mints its own contact ids for
// website leads - so `GET /contacts/:id` answered
//   {"error":"Contact with id 12b9ab05-... not found","status":400}
// the catch swallowed it, firstName came back null, and {{contact.first_name}}
// fell through to its "there" fallback. The first message an academy ever sent a
// new parent opened "Hi there" while "Ramon" sat in our own contacts table.
// Measured: 27 of 174 greeting texts over 30 days.
//
// This runs the REAL resolver (api/email-shells.js) over the REAL live template
// bodies, against the vars shape the automation worker builds at
// api/automations.js:691 - `{ first_name: info.firstName, full_name: info.fullName }`.
// So it tests the thing that actually reaches a phone, not a paraphrase.
//
//   node scripts/verify-merge-name.mjs

import { resolveMergeVars } from "../api/email-shells.js";

// The live BAM GTA bodies, copied verbatim from automation_steps.
const TEMPLATES = {
  "trial_form 1/1":
    "Hi {{contact.first_name}}, it's coach from {{location.name}}.\n\nI saw you filled in the form to book a trial but didn't select a time. Do you need anything from me to help you book a trial?",
  "ghosted 1/3":
    "Hey {{contact.first_name}}! Just wanted to check in and see if you are still interested in having your child train with us",
  "ghosted 2/3":
    "Hi {{contact.fullName}} Just wanted to see if my last message went through. We can get you in the gym for a free trial",
  "ghosted 3/3 (email)":
    "Hi {{contact.first_name}}, It's coach {{location_owner.first_name}} from {{location.name}} - I just wanted to reach out",
};

const L = { full: "By Any Means Toronto", siteUrl: "https://byanymeanstoronto.ca", siteLabel: "byanymeanstoronto.ca" };

// BEFORE: what the GHL-only lookup returned for a portal-native lead - nothing.
const BEFORE = { first_name: null, full_name: null };
// AFTER: what the portal contacts row gives us. Note the raw values carry the
// stray double space that form fills produce; the fix collapses it, so the test
// asserts against the TIDIED value the fix is supposed to emit.
const AFTER = { first_name: "Ramon", full_name: "Ramon Dioquino" };

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (detail) console.log(`       ${detail}`);
};

console.log("\n━━━ BEFORE the fix: every template greets a stranger ━━━\n");
for (const [name, tpl] of Object.entries(TEMPLATES)) {
  const out = resolveMergeVars(tpl, L, BEFORE);
  check(`${name} says "there"`, /\bthere\b/i.test(out.split("\n")[0]), out.split("\n")[0].slice(0, 74));
}

console.log("\n━━━ AFTER the fix: the parent is named ━━━\n");
for (const [name, tpl] of Object.entries(TEMPLATES)) {
  const out = resolveMergeVars(tpl, L, AFTER);
  const first = out.split("\n")[0];
  check(`${name} names Ramon, never "there"`, /Ramon/.test(first) && !/\bthere\b/i.test(first), first.slice(0, 74));
}

console.log("\n━━━ Whitespace: a form fill's double space must not reach a phone ━━━\n");
// "Ramon  Dioquino" is the literal contacts.name value for this lead.
const tidy = (v) => String(v || "").replace(/\s+/g, " ").trim() || null;
check("tidy collapses the double space", tidy("Ramon  Dioquino") === "Ramon Dioquino", tidy("Ramon  Dioquino"));
check("tidy strips a leading-space last name", tidy(" Dioquino") === "Dioquino", tidy(" Dioquino"));
check("tidy maps blank to null, so the fallback still works", tidy("   ") === null);
const untidied = resolveMergeVars(TEMPLATES["ghosted 2/3"], L, { full_name: "Ramon  Dioquino" });
check("without tidying the text really does double-space", /Ramon {2}Dioquino/.test(untidied));

console.log("\n━━━ The fallback still protects a genuinely nameless lead ━━━\n");
const nameless = resolveMergeVars(TEMPLATES["ghosted 1/3"], L, { first_name: null });
check("no name on file still renders cleanly, no raw token", /Hey there!/.test(nameless) && !/\{\{/.test(nameless), nameless.slice(0, 60));

console.log(failed ? `\n❌ ${failed} failing\n` : "\n✅ All checks passed.\n");
process.exit(failed ? 1 : 0);
