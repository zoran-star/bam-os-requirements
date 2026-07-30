// THE MANAGE-MEMBERSHIP LINK IN THE WELCOME EMAIL.
//
//     node api/_manage-membership-link.test.mjs      # exits non-zero on any failure
//
// Plain node. No network, no database, no dependencies beyond the repo's own modules.
//
// WHAT IT IS. Zoran, 31 Jul 2026: the member welcome email gains ONE line pointing a
// parent at the academy's own Stripe billing portal, so nobody has to email us to
// change a card. It lives in the MASTER template (api/email-templates/
// onboarding-emails.js), it resolves from a per-academy fact (clients.stripe_portal_url
// -> clientVars -> L.portalUrl), and there is no academy literal anywhere in it.
//
// WHY IT NEEDS A SUITE OF ITS OWN, given the two GTA locks already exist. The locks are
// byte-for-byte anchors on BAM GTA's render, and GTA has no portal URL on file today -
// the column is not even applied yet. So the locks say exactly one thing about this
// line: that it correctly does NOT appear for an academy without the fact. Every other
// claim (that it appears for one WITH the fact, that it is the academy's OWN URL, that
// the column is actually ASKED FOR so the fact can ever arrive) is invisible to them,
// and would stay invisible right up until the migration landed and a live welcome email
// either carried a link or quietly did not.
//
// THE FAILURE SHAPE THIS IS AIMED AT is the one this repo keeps hitting: a thing whose
// purpose is confidence, trusted because it exists, never wired to the outcome. A
// template line that renders beautifully in a unit test while the column it reads is in
// no select list is exactly that - it was the 29 Jul regression (business_email,
// tagline, instagram_url: read by clientVars, named by no select, rendered as nothing,
// every suite green). Section 5 is the wire, and it is the section that matters.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. WITH a portal URL on the row: the sentence renders through the REAL send path
//      (renderStepMessage on the real `template:onboarding-welcome` body, which is what
//      api/_send.js calls and what the owner's approval surface shows), the anchor
//      points at THAT ROW's URL, and a parent can read the words.
//   2. WITHOUT one (NULL or ""): the WHOLE sentence is gone. Not a dead anchor, not an
//      orphan "Manage your membership or update your card any time in your ." - gone.
//      And the rest of the email is untouched, so dropping the line dropped only it.
//   3. A V1-STYLE ROW - a clients row that does not carry the column AT ALL, which is
//      every academy in production today because the migration has not landed - behaves
//      exactly like (2) and throws nothing.
//   4. It is DATA, not a pin: a second academy renders ITS OWN portal, GTA's appears
//      nowhere in it, and editing a row changes the link.
//   5. THE WIRE. The real loadClient in api/automations.js actually ASKS Postgres for
//      stripe_portal_url, so the fact will arrive the day the migration lands - and
//      against a schema that does NOT have it (production today) the select survives on
//      the pending-column retry and the academy simply sends the shorter email.
//   6. The plain-text form of the same fact, {{location.portal_link}}, is in
//      DROP_WHEN_EMPTY, so an academy with no portal drops the mention rather than
//      texting a member a bare gap where a link should be.
//
// WHAT IT DOES NOT PROVE
//   - That clients.stripe_portal_url exists. It does not, yet; its migration belongs to
//     the member-management build. Everything here is about behaving correctly on both
//     sides of that migration, which is the only thing this build can be responsible
//     for. The day it lands, section 5's stub schema is what stops describing reality -
//     and api/_pending-client-column.test.mjs section 1 is where the column being left
//     in the pending list after that shows up.
//   - That the URL is a real Stripe portal, or that it belongs to the academy whose row
//     it is on. Nothing in the render can know that; it is an owner-entered fact.
//   - Anything about BAM GTA's live welcome email today. GTA has no portal URL, so the
//     line does not render for it and the GTA locks are unchanged - deliberately. See
//     the note in api/email-templates/onboarding-emails.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing in a throwaway copy of the REAL source and
// must print NEGATIVE CONTROL PASSED, meaning this suite CAUGHT it. A control whose pin
// no longer applies is reported as NEGATIVE CONTROL FAILED, never as a pass - a pin that
// fails to apply looks exactly like a check that passed.
//
//   MUTATE=hardcode  node api/_manage-membership-link.test.mjs
//        the template stops reading the fact and carries a literal URL, which is the
//        academy-branch this whole email layer exists to forbid. Every academy would
//        send parents to one academy's billing portal.
//   MUTATE=nodrop    node api/_manage-membership-link.test.mjs
//        the fact stops GATING the sentence, so an academy without a portal ships the
//        words with an empty href - the dead anchor and the orphan sentence.
//   MUTATE=borrow    node api/_manage-membership-link.test.mjs
//        clientVars falls back to a shared portal when the row has none. This is the
//        worst outcome available here and the reason there is no fallback: a parent
//        would land on a billing page that is not their academy's.
//   MUTATE=noselect  node api/_manage-membership-link.test.mjs
//        stripe_portal_url leaves the pending list in api/automations.js, so the column
//        is never asked for. The template is perfect and the fact never arrives - the
//        29 Jul regression, restored, and the one this suite exists for.
//   MUTATE=notoken   node api/_manage-membership-link.test.mjs
//        location.portal_link leaves DROP_WHEN_EMPTY, so a plain-text body keeps the
//        mention after the link resolves to nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GTA, FACTS, wordsOf } from "./_gta-message-lock.test.mjs";

const MUTATE = process.env.MUTATE || "";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "stub-resend-key";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};
let controlBroken = null;

// ─── the sentence, named once ────────────────────────────────────────────────
// The words a parent reads, and the words this suite hunts for. Deliberately NOT
// imported from the template: a check that reads its expectation out of the thing it is
// checking passes whatever the thing says. If the copy is reworded, this fails and
// somebody re-reads the sentence, which is the correct amount of friction for a line
// that goes to paying members.
const LEAD = "Manage your membership or update your card any time in your";
const LABEL = "billing portal";

// ─── fixtures ────────────────────────────────────────────────────────────────
// GTA's real row from the production snapshot, so "an academy row" here means the shape
// production actually returns rather than a convenient invention. The portal URL is
// ADDED on top, because the column does not exist yet and GTA has no value for it - that
// is precisely the with/without pair this suite needs.
const GTA_PORTAL = "https://billing.stripe.com/p/login/gta_portal_fixture";
const ALT_PORTAL = "https://billing.stripe.com/p/login/northside_portal_fixture";

const WITH_PORTAL = { ...GTA, stripe_portal_url: GTA_PORTAL };
const NULL_PORTAL = { ...GTA, stripe_portal_url: null };
const EMPTY_PORTAL = { ...GTA, stripe_portal_url: "" };
// THE PRODUCTION SHAPE OF TODAY: the column does not exist, so loadClient's projection
// returns a row with no such key at all. Absent is a third state and it is the one every
// academy is in right now, so it gets its own fixture rather than being assumed
// equivalent to null.
const V1_ROW = { ...GTA };
delete V1_ROW.stripe_portal_url;
// A row from before any of the V2 email columns: no public name, no business email, no
// site, no portal. It must render no manage line and throw nothing.
const V1_THIN = { id: GTA.id, business_name: "Old Academy" };

// A DIFFERENT academy, with its own portal, so "the link is the row's" can be shown by
// changing the row rather than asserted about one.
const ALT = {
  ...GTA,
  id: "alt-academy-0000-0000-000000000000",
  public_name: "Northside Hoops",
  stripe_portal_url: ALT_PORTAL,
};

const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };

// ─── the modules, as themselves (or as one mutated copy of themselves) ───────
// Same contract as api/_pending-client-column.test.mjs and
// api/_email-select-coverage.test.mjs: the file that runs is the real file byte for
// byte, plus at most one pinned edit and at most one appended export.
let copyCount = 0;
const tmpFiles = [];
function copyFile(rel, edits, append) {
  const abs = path.join(HERE, rel);
  let src = fs.readFileSync(abs, "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `${MUTATE ? `MUTATE=${MUTATE}` : "This suite"} is pinned to text that is no longer in api/${rel}:\n\n${find}\n\n`
        + "Re-point it at the current code or delete it - a pin that fails to apply looks exactly like a check that passed.";
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  if (append) src += `\nexport { ${append} as __probe };\n`;
  const tmp = path.join(path.dirname(abs), `.mml-${++copyCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  tmpFiles.push(tmp);
  return tmp;
}
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };

// ── the mutations, expressed against the real source text ────────────────────
const HARDCODE = [[
  "L && L.portalUrl ? P(`Manage your membership or update your card any time in your ${LINK(L.portalUrl,",
  "true ? P(`Manage your membership or update your card any time in your ${LINK(\"https://billing.stripe.com/p/login/bam_one_portal_for_everyone\","]];
const NODROP = [[
  "(L && L.portalUrl ? P(",
  "(true ? P("]];
const BORROW = [[
  `location_portal_url: c.stripe_portal_url || "",`,
  `location_portal_url: c.stripe_portal_url || "https://billing.stripe.com/p/login/bam_shared_portal",`]];
const NOTOKEN = [[
  `"location.review_link", "location.portal_link"]`,
  `"location.review_link"]`]];
const NOSELECT = [[
  `const CLIENT_COLS_PENDING = ["stripe_portal_url"];`,
  `const CLIENT_COLS_PENDING = [];`]];

// email-shells.js is the door to the template, so a template mutation needs BOTH files
// copied: the template, and a shells copy whose import points at that copy. Anything
// else would render the real template and report a control that changed nothing.
async function loadShells() {
  const tplEdits = MUTATE === "hardcode" ? HARDCODE : MUTATE === "nodrop" ? NODROP : [];
  const shellEdits = MUTATE === "borrow" ? BORROW : MUTATE === "notoken" ? NOTOKEN : [];
  if (!tplEdits.length && !shellEdits.length) return import("./email-shells.js");
  const edits = [...shellEdits];
  if (tplEdits.length) {
    const tpl = copyFile("email-templates/onboarding-emails.js", tplEdits, null);
    edits.push(["./email-templates/onboarding-emails.js", `./email-templates/${path.basename(tpl)}`]);
  }
  return import(pathToFileURL(copyFile("email-shells.js", edits, null)).href);
}

let SHELLS, AUTOMATIONS;
try {
  SHELLS = await loadShells();
  AUTOMATIONS = await import(pathToFileURL(copyFile("automations.js", MUTATE === "noselect" ? NOSELECT : [], "loadClient")).href);
} catch (e) {
  cleanup();
  console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken || (e && e.message)}`);
  process.exit(1);
}
const { renderEmail, renderStepMessage, clientVars, resolveMergeVars, locFor } = SHELLS;

// ─── the render seam ─────────────────────────────────────────────────────────
// THROUGH THE REAL SEND PATH, not through the template function. renderStepMessage is
// what api/_send.js puts on the wire and what the owner's approval surface shows, and
// the body is the real automation row's ("template:onboarding-welcome"), so what is
// measured below is the email a member receives rather than a nearby approximation.
const varsFor = (row) => ({ ...clientVars(row), ...FACTS, ...FAMILY });
function welcomeFor(row, renderAs) {
  const m = renderStepMessage({
    channel: "email",
    clientId: renderAs || row.id,
    subject: "Welcome to {{location.name}} 🏀",
    body: "template:onboarding-welcome",
    vars: varsFor(row),
  });
  return m.html || "";
}
// The parent-visible words, from the same reducer the GTA locks use, so "a parent can
// read this" means the same thing here as it does there.
const readable = (html) => wordsOf(html);
const hrefsOf = (html) => [...String(html).matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((m) => m[1]);

// ─── 1. WITH a portal URL ────────────────────────────────────────────────────
console.log("\n── 1. an academy WITH a billing portal on its row ──");
const withHtml = welcomeFor(WITH_PORTAL);
{
  ok(withHtml.includes(LEAD), `the sentence renders: "${LEAD} ${LABEL}."`);
  ok(withHtml.includes(`<a href="${GTA_PORTAL}"`), `the anchor points at THAT ROW's portal (${GTA_PORTAL})`);
  ok(hrefsOf(withHtml).includes(GTA_PORTAL), "and it is a real link target, not text that looks like one");
  const words = readable(withHtml);
  ok(words.includes(LEAD) && words.includes(LABEL), "a parent reads the words, so this is not markup nobody sees");
  ok(!/—/.test(withHtml.slice(withHtml.indexOf(LEAD), withHtml.indexOf(LEAD) + 200)), "and there is no em dash in it");
  // The email around it still works. A line that renders by breaking the sign-off is
  // not a line that renders.
  ok(withHtml.includes("See you on the court,"), "the sign-off below it is intact");
  ok(withHtml.includes(FACTS.location_venue), "and the venue block above it is intact");
}

// ─── 2. WITHOUT one ──────────────────────────────────────────────────────────
console.log("\n── 2. NULL and EMPTY drop the WHOLE sentence, not just the link ──");
for (const [what, row] of [["NULL", NULL_PORTAL], ["an empty string", EMPTY_PORTAL]]) {
  const html = welcomeFor(row);
  ok(!html.includes(LEAD), `${what}: the sentence is absent - no orphan lead-in`);
  ok(!html.includes(LABEL), `${what}: and the words "${LABEL}" appear nowhere`);
  ok(!html.includes('href=""'), `${what}: nothing dead shipped in its place`);
  ok(!hrefsOf(html).some((h) => !h.trim()), `${what}: no anchor with a blank target at all`);
  ok(html.includes("See you on the court,"), `${what}: and the rest of the email is unharmed`);
}

// ─── 3. the V1-style row: the column is not there AT ALL ─────────────────────
// This is production today for every academy, because the migration has not landed. It
// is a THIRD state (absent, not null) and it is the one that actually ships, so it is
// asserted rather than assumed equivalent.
console.log("\n── 3. a row that does not carry the column at all ──");
for (const [what, row] of [["a V1-style row (no such key)", V1_ROW], ["a thin pre-V2 row", V1_THIN]]) {
  let html = null, threw = null;
  try { html = welcomeFor(row); } catch (e) { threw = e; }
  ok(!threw, `${what}: renders without throwing${threw ? ` (threw ${threw.message})` : ""}`);
  ok(html !== null && !html.includes(LEAD), `${what}: and carries no manage-membership sentence`);
  ok(html !== null && !html.includes('href=""'), `${what}: and nothing dead`);
}
{
  // clientVars must report the honest answer for all three, or the render above is
  // right by accident.
  ok(clientVars(V1_ROW).location_portal_url === "", "clientVars resolves an ABSENT column to empty");
  ok(clientVars(NULL_PORTAL).location_portal_url === "", "and a NULL to empty");
  ok(clientVars(WITH_PORTAL).location_portal_url === GTA_PORTAL, "and a real value to itself");
  ok(locFor(GTA.id, varsFor(V1_ROW)).portalUrl === "", "and locFor under GTA's own id resolves nothing from nowhere");
}

// ─── 4. it is DATA, not a pin ────────────────────────────────────────────────
console.log("\n── 4. every academy renders its OWN portal, and never another's ──");
{
  const altHtml = welcomeFor(ALT);
  ok(altHtml.includes(`<a href="${ALT_PORTAL}"`), "a second academy renders its own portal");
  ok(!altHtml.includes(GTA_PORTAL), "with no trace of the first academy's in it");
  // Rendered under BAM GTA's REAL client id, which is the id any surviving per-academy
  // branch would be keyed by. Same trick api/_email-identity-from-the-row.test.mjs uses.
  const underGta = welcomeFor(ALT, GTA.id);
  ok(underGta.includes(`<a href="${ALT_PORTAL}"`) && !underGta.includes(GTA_PORTAL),
    "and rendering it under GTA's own client id changes nothing, so no branch is hiding behind the id");
  // Editing the row moves the link.
  const edited = welcomeFor({ ...WITH_PORTAL, stripe_portal_url: "https://billing.stripe.com/p/login/edited" });
  ok(edited.includes('<a href="https://billing.stripe.com/p/login/edited"') && !edited.includes(GTA_PORTAL),
    "editing the row changes where the link goes, so this is a fact and not a literal");
  // And an academy with no portal is not quietly given one by an academy that has one.
  ok(!welcomeFor(NULL_PORTAL).includes("billing.stripe.com"),
    "an academy without a portal is offered no portal, borrowed or otherwise");
}

// ─── 5. THE WIRE: is the column actually asked for? ──────────────────────────
// The section this suite exists for. Everything above passes with the column in no
// select list, because everything above hands clientVars a row that already has it.
// Production does not. So this drives the REAL loadClient against a stubbed wire and
// measures the select that reached it, then renders the row that came back.
console.log("\n── 5. the real loadClient asks Postgres for the column, and survives not having it ──");
{
  let SELECTS = [];
  let MISSING = [];
  const pgUndefinedColumn = (col) => new Response(JSON.stringify({
    code: "42703", details: null, hint: null, message: `column clients.${col} does not exist`,
  }), { status: 400, headers: { "content-type": "application/json" } });

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/rest/v1/clients?")) {
      const sel = new URL(u).searchParams.get("select") || "";
      SELECTS.push(sel);
      const cols = sel.split(",").map((s) => s.trim()).filter(Boolean);
      const missing = cols.find((c) => MISSING.includes(c));
      if (missing) return pgUndefinedColumn(missing);
      // PROJECTED: a column the select did not name is not on the row that comes back.
      // That projection is the entire mechanism of the 29 Jul regression and the only
      // reason this section can see anything.
      return json([Object.fromEntries(cols.filter((c) => c in WITH_PORTAL).map((c) => [c, WITH_PORTAL[c]]))]);
    }
    throw new Error(`UNSTUBBED CALL: ${u}`);
  };

  // (a) THE MIGRATION HAS LANDED. The column exists, so the first read succeeds and the
  //     value has to travel row -> select -> vars -> email with nobody carrying it by
  //     hand. This is the day-it-lands rehearsal.
  SELECTS = []; MISSING = [];
  let row = null, threw = null;
  try { row = await AUTOMATIONS.__probe(GTA.id); } catch (e) { threw = e; }
  ok(!threw, `loadClient succeeds${threw ? ` (threw ${threw.message})` : ""}`);
  ok(String(SELECTS[0] || "").split(",").map((s) => s.trim()).includes("stripe_portal_url"),
    "the select NAMES stripe_portal_url, so the fact can actually arrive");
  ok(!!row && row.stripe_portal_url === GTA_PORTAL, "and it lands on the row loadClient returns");
  const live = welcomeFor(row);
  ok(live.includes(`<a href="${GTA_PORTAL}"`),
    "END TO END: the row loadClient returns renders the link, with nothing hand-fed in between");

  // (b) PRODUCTION TODAY. The column does not exist. The select must NOT go down - that
  //     read feeds every channel, so an unhandled 400 stops SMS too - and the email must
  //     simply be shorter.
  SELECTS = []; MISSING = ["stripe_portal_url"];
  row = null; threw = null;
  try { row = await AUTOMATIONS.__probe(GTA.id); } catch (e) { threw = e; }
  ok(!threw, `with the column absent from the schema the select still succeeds${threw ? ` (threw ${threw.message})` : ""}`);
  ok(!!row, "a row still comes back, so the worker and the SMS path stay up");
  ok(!!row && !("stripe_portal_url" in row), "the column is ABSENT from it rather than faked as null");
  ok(SELECTS.length === 2, `one read plus exactly one pending-column retry (saw ${SELECTS.length})`);
  const today = row ? welcomeFor(row) : "";
  ok(!today.includes(LEAD) && !today.includes('href=""'),
    "and today's email is simply the shorter one: no sentence, no dead anchor");
}

// ─── 6. the plain-text form drops its mention ────────────────────────────────
// The designed email gates its own sentence. A step body an owner types is plain text,
// and there the rule is DROP_WHEN_EMPTY: no portal means the mention goes with it.
console.log("\n── 6. {{location.portal_link}} in a plain-text body ──");
{
  const BODY = "Hi {{contact.first_name}}, you're all set.\n\nManage your membership here:\n{{location.portal_link}}\n\nSee you Tuesday.";
  const filled = resolveMergeVars(BODY, locFor(GTA.id, varsFor(WITH_PORTAL)), varsFor(WITH_PORTAL));
  ok(filled.includes(GTA_PORTAL), "with a portal on file the link is substituted");
  const dropped = resolveMergeVars(BODY, locFor(GTA.id, varsFor(V1_ROW)), varsFor(V1_ROW));
  ok(!dropped.includes("{{location.portal_link}}"), "with none, no raw token is left showing");
  ok(!/Manage your membership here:/.test(dropped), "and the dangling lead-in above it goes too");
  ok(/See you Tuesday\./.test(dropped) && /you're all set\./.test(dropped),
    "while the rest of the message survives - a missing link shortens a message, it never empties one");
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
