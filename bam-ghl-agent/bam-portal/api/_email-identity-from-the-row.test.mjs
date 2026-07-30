// EVERY ACADEMY'S EMAIL IDENTITY COMES FROM ITS OWN ROW. THERE IS NO EXCEPTION LEFT.
//
//   node api/_email-identity-from-the-row.test.mjs
//
// Plain node. No network, no database, no dependencies.
//
// WHAT WAS WRONG. api/email-shells.js carried a `LOCATIONS` object keyed by client id
// with exactly ONE entry, BAM GTA's, and locFor() spread it OVER the row so the pinned
// values won. It was the last academy-specific literal in the email layer: every other
// academy derived its identity from its own clients row via locFromVars(), and GTA did
// not. That meant a bug in the row-derived path was invisible on the one academy anyone
// ever looked at, and it meant the portal had no field that could fix GTA's email.
//
// It shrank one field at a time. `email` became clients.business_email (migration
// 20260729T210000). `tagline` and `instagram` became clients.tagline /
// clients.instagram_url (20260729T230000). The last four - suffix, full, locationTag,
// city - are what THIS suite is about, and they did not become four more columns.
// They all traced to two fields the row already had:
//
//   suffix + full   BOTH derive from public_name. GTA's was the bare brand "By Any
//                   Means Basketball", so the derived wordmark word was BASKETBALL
//                   while the pin said GTA and the pin's `full` said "By Any Means
//                   Toronto". Keeping BOTH of today's strings would have needed a
//                   pinned suffix column - a per-academy override, which is the
//                   hardcode again wearing a database column. Zoran's ruling
//                   (2026-07-29): ONE field drives everything, no overrides.
//                   public_name is now "By Any Means Toronto" and the wordmark reads
//                   TORONTO. He accepted that visible cost.
//   locationTag +   BOTH derive from cityFromAddress(clients.address), which returned
//   city            "" for the stored "2205 Rosemount Cres" - a street line with no
//                   city in it. The address is now "2205 Rosemount Cres, Oakville, ON".
//
// So the fix is migration 20260729T235000 (three guarded data updates: GTA's
// public_name, GTA's address, and San Jose's public_name) plus the DELETION of the map.
//
// WHY IT RENDERS INSTEAD OF GREPPING. Standing rule in this repo: a literal-grep leak
// audit gives false answers, because a string can be absent from the file it was moved
// out of and still reach the output through a fallback - and equally, present in a file
// and never rendered. So every assertion below builds a REAL email through renderEmail
// and inspects the bytes that come out. The two source-level checks in section 3 are
// belt and braces and are labelled as such.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. GTA's wordmark, full name, location tag and city all come from its ROW. Not
//      "the output contains them" - that was true from the pin too. The assertion is
//      that EDITING THE ROW CHANGES THE OUTPUT, which a pin cannot satisfy.
//   2. The four fields AGREE with each other now. Under the pin, {{location.name}}
//      resolved from the row ("By Any Means Basketball") while {{ACADEMY_FULL}} and
//      the <title> resolved from the pin ("By Any Means Toronto") - the same email
//      called the academy two different things. One field, one answer.
//   3. There is no per-client-id branch left. Rendering under GTA's REAL client id
//      with an EMPTY row produces NOTHING of GTA's: not its name, not its wordmark
//      word, not its city, not its domain, not its owner. That is the render-level
//      form of "the map is deleted" and it holds however a replacement is spelled.
//   4. An academy with an EMPTY public_name falls back to business_name (its own
//      internal label - honest, and unchanged behaviour) and borrows NOTHING from
//      another academy.
//   5. The city derives for BOTH real address shapes on file: GTA's Canadian
//      "street, city, province" and San Jose's US "street, city, ST zip".
//   6. San Jose is no longer a second academy named "By Any Means Basketball", so its
//      wordmark does not read BY ANY MEANS BASKETBALL. That was never GTA-specific -
//      SJ had no pinned entry and never did - which is why the migration fixes both.
//
// WHAT IT DOES NOT PROVE
//   - Nothing here depends on whether a migration is applied; the fixtures are the
//     committed snapshots. 20260729T235000 WAS applied on 2026-07-30 (see the APPLIED
//     table in supabase/PENDING_SQL.md), so production's GTA row now holds
//     "By Any Means Toronto" and the parsable address, and section 8's interim window
//     is closed. Section 8 is kept because it still describes what a row WITHOUT
//     those values renders, which is what any academy that has not filled in
//     public_name gets - it just is no longer GTA's present tense.
//   - That "By Any Means Toronto" is the right name or TORONTO the right word. That is
//     Zoran's call and nothing in the repo can check it.
//   - Anything about the templates' own copy. Section 9 covers the automation_steps
//     ROWS; a name hardcoded inside a shared email TEMPLATE is a different bug with a
//     different blast radius (every academy at once, not one), and it is
//     api/_shared-template-names.test.mjs that covers that.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=pin       node api/_email-identity-from-the-row.test.mjs  # a per-client-id
//                    # override wins over the row for GTA (the deleted map, restored)
//   MUTATE=borrow    node api/_email-identity-from-the-row.test.mjs  # every academy
//                    # that is not GTA inherits GTA's identity (the 2026-07-25 bug)
//   MUTATE=nocity    node api/_email-identity-from-the-row.test.mjs  # the address goes
//                    # back to the city-less street line, so city + tag vanish
//   MUTATE=internal  node api/_email-identity-from-the-row.test.mjs  # public_name is
//                    # ignored and the INTERNAL label reaches parents ("BAM GTA")
//
// THE SEAM. All four act on how a caller turns a client row into vars - the same seam
// api/_business-email.test.mjs and api/_tagline-instagram.test.mjs use, and the only
// input renderEmail takes. That makes them faithful rather than theatrical:
//   `pin` sets location_name + location_city to GTA's canonical values FOR GTA'S ID
//   ONLY, whatever the row says, which is exactly the shape locFor() gave a LOCATIONS
//   entry - an academy-specific value that the row cannot move.
//   `nocity` feeds the address production still holds, so it is not a hypothetical: it
//   is a byte-accurate model of this branch deployed before its migration is applied.
// If any of them ever reports FAILED, this suite is decorative.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, clientVars, locFor, renderStepMessage } from "./email-shells.js";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.resolve(HERE, "../../../scripts/snapshots");
const SHELLS_SRC = fs.readFileSync(path.join(HERE, "email-shells.js"), "utf8");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ─── fixtures ────────────────────────────────────────────────────────────────
// The same production snapshots every other lock reads, so "what GTA looks like today"
// has one answer across the repo. Both carry migration 20260729T235000's values ahead
// of production; each file's own `_note` says so and why.
const snap = (f) => JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, f), "utf8"));
const GTA = snap("bam-gta.json").client;
const SJ = snap("bam-san-jose.json").client;

// Read off the snapshots rather than retyped, so this suite cannot pass against a
// fixture that has drifted.
const GTA_ID = GTA.id;
const GTA_NAME = GTA.public_name;              // "By Any Means Toronto"
const GTA_ADDRESS = GTA.address;               // "2205 Rosemount Cres, Oakville, ON"
const PRE_MIGRATION_NAME = "By Any Means Basketball";
const PRE_MIGRATION_ADDRESS = "2205 Rosemount Cres";

// An academy that has entered NO public_name. Shaped like the academies that really
// have not (DETAIL Miami, Johnson Bball): the internal label is all there is.
const BARE = {
  id: "bare-academy-0000-0000-000000000000",
  business_name: "Johnson Bball",
  owner_name: "Mike Johnson",
  email: "mike@byanymeansbball.com",
  business_email: "info@johnsonbball.example",
  address: "88 Court St, Fresno, CA 93721",
  website_setup: { domain: "johnsonbball.example" },
};

const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };
// A body that names the academy AND its city, so both tokens are under test in the
// same render as the shell's wordmark and tag.
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot at {{location.name}} in {{location.city}} is held for this week.\n\nSee you at training.";

// ─── the one seam the mutations act on ───────────────────────────────────────
function varsFor(client) {
  const v = { ...FAMILY, ...clientVars(client) };
  if (MUTATE === "pin" && client.id === GTA_ID) {
    // What the deleted LOCATIONS entry did: GTA's identity, whatever its row says.
    v.location_name = GTA_NAME;
    v.location_city = "Oakville";
  }
  if (MUTATE === "borrow" && client.id !== GTA_ID) {
    // The pre-2026-07-25 bug in its real shape: `LOCATIONS[clientId] ||
    // LOCATIONS[GTA_ID]`, so every academy WITHOUT an entry got GTA's whole config
    // over the top of its own row. Not "filled in where blank" - overridden.
    v.location_name = GTA_NAME;
    v.location_city = "Oakville";
  }
  if (MUTATE === "nocity" && client.id === GTA_ID) {
    v.location_city = clientVars({ ...client, address: PRE_MIGRATION_ADDRESS }).location_city;
  }
  if (MUTATE === "internal") v.location_name = client.business_name || "";
  return v;
}
const emailFor = (client, overrides = {}) =>
  renderEmail({ clientId: client.id, subject: "Your spot this week", body: BODY, vars: { ...varsFor(client), ...overrides } });

// The gold wordmark word, pulled out by its own markup rather than searched for in the
// whole document, so "the wordmark reads TORONTO" cannot be satisfied by the word
// appearing in body copy.
const wordmarkOf = (html) => {
  const m = /BY ANY MEANS(?:&nbsp;|\s)*<span style="color:#E2DD9F;">([\s\S]*?)<\/span>/.exec(String(html));
  return m ? m[1].trim() : null;
};
// The small line beside the wordmark.
const tagOf = (html) => {
  const m = /letter-spacing:3px;text-transform:uppercase;color:#8C8C82;">([\s\S]*?)<\/td>/.exec(String(html));
  return m ? m[1].trim() : null;
};
const titleOf = (html) => {
  const m = /<title>([\s\S]*?)<\/title>/.exec(String(html));
  return m ? m[1].trim() : null;
};
// The footer reason sentence, which is where {{ACADEMY_FULL}} lands.
const reasonOf = (html) => {
  const m = /You&#39;re receiving this because you ([\s\S]*?)\./.exec(String(html))
    || /You're receiving this because you ([\s\S]*?)\./.exec(String(html));
  return m ? m[1].trim() : null;
};

// ─── 1. GTA renders from its row, and editing the row moves the email ────────
console.log("\n── 1. BAM GTA's identity comes from its own clients row ──");
{
  const html = emailFor(GTA);
  ok(wordmarkOf(html) === "TORONTO", "the gold wordmark reads BY ANY MEANS TORONTO");
  ok(tagOf(html) === "OAKVILLE", "the line beside it reads OAKVILLE (the derived city, no composite)");
  ok(titleOf(html) === GTA_NAME, `the document title is the row's public_name (${JSON.stringify(GTA_NAME)})`);
  ok(html.includes(`Jordan&#39;s spot at ${GTA_NAME} in Oakville is held`)
    || html.includes(`Jordan's spot at ${GTA_NAME} in Oakville is held`),
    "{{location.name}} and {{location.city}} both resolve in the body copy");

  // THE ASSERTION THAT SEPARATES DATA FROM A HARDCODE. Everything above was already
  // true under the pin. This cannot be: edit the row and the email must follow.
  //
  // The tagline and the domain are edited along with the name and the address because
  // they are ALSO row facts that happen to name Oakville and Toronto (GTA's tagline is
  // literally "...in Oakville and across the GTA", its business_email is
  // info@byanymeanstoronto.ca). Leaving them would make the "no trace survives" check
  // below fail on facts that are correctly still coming from the row - a false positive
  // that says nothing about the pin.
  const moved = { ...GTA, public_name: "By Any Means Ottawa", address: "1 Elgin St, Ottawa, ON",
    tagline: "Basketball training in the capital.", instagram_url: "https://instagram.com/example",
    business_email: "info@example.ca",
    website_setup: { ...(GTA.website_setup || {}), domain: "example.ca" } };
  const h2 = emailFor(moved);
  ok(wordmarkOf(h2) === "OTTAWA", "editing public_name CHANGES the wordmark (a pin could not do this)");
  ok(titleOf(h2) === "By Any Means Ottawa", "and the document title");
  ok(tagOf(h2) === "OTTAWA", "editing the address CHANGES the location tag");
  ok(!h2.includes("TORONTO") && !h2.includes(GTA_NAME) && !h2.includes("Oakville") && !h2.includes("byanymeanstoronto"),
    "and NOTHING of the old identity survives alongside it");
}

// ─── 2. the four fields agree with each other ────────────────────────────────
// Under the pin they did not: {{location.name}} came from the row and {{ACADEMY_FULL}}
// / <title> came from the pinned `full`, so one email called the academy two things.
console.log("\n── 2. one field, one answer: the name is the same everywhere in the email ──");
{
  const html = emailFor(GTA);
  ok(titleOf(html) === GTA_NAME, "<title> is the row's name");
  ok((reasonOf(html) || "").endsWith(GTA_NAME), `the footer reason sentence names ${JSON.stringify(GTA_NAME)}`);
  ok(!html.includes(PRE_MIGRATION_NAME), `and the pre-migration name ${JSON.stringify(PRE_MIGRATION_NAME)} appears NOWHERE`);
  ok(wordmarkOf(html) === GTA_NAME.replace(/^By Any Means /, "").toUpperCase(),
    "the wordmark word is exactly public_name with the brand prefix stripped");
}

// ─── 3. no per-client-id branch is left, anywhere ────────────────────────────
// Rendered under GTA's REAL client id - the only key any per-academy map is keyed by -
// against a row that carries nothing. If ANYTHING still answers for GTA by id, this is
// what notices, however it is spelled.
console.log("\n── 3. GTA's real client id decides nothing ──");
{
  const EMPTY_ROW = { id: GTA_ID, business_name: "BAM GTA", business_email: "x@example.com" };
  const html = renderEmail({ clientId: GTA_ID, subject: "s", body: BODY, vars: { ...FAMILY, ...clientVars(EMPTY_ROW) } });
  ok(wordmarkOf(html) === "GTA", "an empty row under GTA's id derives its wordmark from business_name only");
  ok(tagOf(html) === "", "there is no location tag, because there is no address to parse");
  ok(!html.includes(GTA_NAME), `no ${JSON.stringify(GTA_NAME)} appears from anywhere`);
  ok(!html.includes("Oakville") && !html.includes("OAKVILLE"), "no Oakville appears from anywhere");
  ok(!html.includes("byanymeanstoronto"), "GTA's domain does not appear from anywhere");
  ok(!html.includes("Zoran"), "and neither does its owner");

  // Belt and braces, weaker on purpose: a source check only catches this exact
  // spelling, which is why the render checks above are the real assertion.
  ok(!/\bLOCATIONS\s*=/.test(SHELLS_SRC), "(source) no LOCATIONS map is declared in email-shells.js");
  ok(!SHELLS_SRC.split("\n").some((l) => l.includes(GTA_ID) && !l.trim().startsWith("//")),
    "(source) GTA's client id appears in no executable line of email-shells.js");
}

// ─── 4. an academy with no public_name borrows nothing ───────────────────────
console.log("\n── 4. an academy that has entered no public_name ──");
{
  const html = emailFor(BARE);
  ok(titleOf(html) === BARE.business_name, "the title falls back to business_name, its own internal label");
  ok(wordmarkOf(html) === "", "the wordmark keeps the plain BY ANY MEANS (no brand prefix to strip)");
  ok(!html.includes(GTA_NAME) && !html.includes("TORONTO") && !html.includes("Oakville"),
    "and NONE of BAM GTA's identity leaks in");
  ok(!html.includes("byanymeanstoronto") && !html.includes("Zoran"),
    "not its domain and not its owner either");
  ok(tagOf(html) === "FRESNO", "its own city is what its own tag reads");
  ok(html.includes("Jordan&#39;s spot at Johnson Bball in Fresno is held")
    || html.includes("Jordan's spot at Johnson Bball in Fresno is held"),
    "the message body still renders, with its own facts");
}

// ─── 5. the city derives for BOTH real address shapes ────────────────────────
// cityFromAddress() takes the comma part before the province and rejects a candidate
// containing a digit. Both academies' real stored addresses are checked, because they
// are different shapes: Canadian "street, city, province" and US "street, city, ST zip".
console.log("\n── 5. the city parses out of both academies' real addresses ──");
{
  for (const [label, address, city] of [
    ["GTA (street, city, province)", GTA_ADDRESS, "Oakville"],
    ["San Jose (street, city, ST zip)", SJ.address, "San Jose"],
  ]) {
    ok(clientVars({ address }).location_city === city, `${label}: ${JSON.stringify(address)} -> ${JSON.stringify(city)}`);
    const html = emailFor({ ...GTA, address });
    ok(tagOf(html) === city.toUpperCase(), `${label}: and the rendered tag reads ${city.toUpperCase()}`);
  }
  // The shape the migration exists to replace: no city in the string at all. Empty is
  // the honest answer and it drops the tag rather than guessing.
  ok(clientVars({ address: PRE_MIGRATION_ADDRESS }).location_city === "",
    `the city-less street line ${JSON.stringify(PRE_MIGRATION_ADDRESS)} still yields "" (unchanged, deliberate)`);
  ok(tagOf(emailFor({ ...GTA, address: PRE_MIGRATION_ADDRESS })) === "",
    "and renders no tag at all rather than a wrong one");
}

// ─── 6. San Jose is its own academy ─────────────────────────────────────────
// Its public_name was the identical bare brand, so the moment the pin went its wordmark
// would have read BY ANY MEANS BASKETBALL. It never had a pinned entry, so this was
// never a GTA bug - it is what any academy leaving public_name as the brand gets.
console.log("\n── 6. BAM San Jose renders as San Jose, not as the bare brand ──");
{
  const sj = emailFor(SJ);
  const gta = emailFor(GTA);
  ok(SJ.public_name === "By Any Means San Jose", "the snapshot carries San Jose's own parent-facing name");
  ok(wordmarkOf(sj) === "SAN JOSE", "its wordmark reads BY ANY MEANS SAN JOSE");
  ok(wordmarkOf(sj) !== "BASKETBALL", "NOT BY ANY MEANS BASKETBALL, which the bare brand produced");
  ok(tagOf(sj) === "SAN JOSE", "and its tag is its own city");
  ok(!sj.includes("TORONTO") && !sj.includes(GTA_NAME) && !sj.includes("Oakville") && !sj.includes("byanymeanstoronto"),
    "nothing of GTA's is in San Jose's email");
  ok(!gta.includes("SAN JOSE") && !gta.includes(SJ.public_name), "and nothing of San Jose's is in GTA's");
  ok(wordmarkOf(sj) !== wordmarkOf(gta) && titleOf(sj) !== titleOf(gta),
    "the two academies are no longer interchangeable in either field");
}

// ─── 7. locFor resolves the same thing, and takes no notice of the id ───────
console.log("\n── 7. the resolved location config agrees, for any id at all ──");
{
  const v = varsFor(GTA);
  const under = (id) => locFor(id, v);
  const real = under(GTA_ID);
  ok(real.suffix === "TORONTO" && real.full === GTA_NAME && real.city === "Oakville" && real.locationTag === "OAKVILLE",
    "locFor under GTA's own id returns the row's four fields");
  for (const id of ["00000000-0000-0000-0000-000000000000", SJ.id, "", null, undefined]) {
    ok(JSON.stringify(under(id)) === JSON.stringify(real),
      `and returns the IDENTICAL config under id ${JSON.stringify(id)}`);
  }
}

// ─── 8. a row WITHOUT the migration's values, described not discovered ───────
// 20260729T235000 was applied on 2026-07-30, so this is no longer GTA's present tense.
// It is kept because it is still a live shape: an academy holding the bare brand as its
// public_name and a city-less street address renders exactly this, and that is what
// every academy that has not filled those in would get.
console.log("\n── 8. what a send renders from a row WITHOUT the migration's values ──");
{
  const asProdHoldsIt = { ...GTA, public_name: PRE_MIGRATION_NAME, address: PRE_MIGRATION_ADDRESS };
  const html = renderEmail({ clientId: GTA_ID, subject: "s", body: BODY, vars: { ...FAMILY, ...clientVars(asProdHoldsIt) } });
  ok(wordmarkOf(html) === "BASKETBALL", "the wordmark reads BY ANY MEANS BASKETBALL (the documented interim cost)");
  ok(tagOf(html) === "", "there is no location tag");
  // The copy that names the city loses it. Asserted on the SENTENCE rather than on the
  // whole document, because GTA's tagline is a row fact that says "Oakville" itself and
  // is unaffected by this migration - a whole-document check would pass or fail on that
  // instead of on the token under test.
  // Note the single space: an empty token swallows one space in front of it, so the
  // sentence reads "in is held" rather than "in  is held". That is pre-existing
  // resolveMergeVars behaviour and it is pinned here so the interim is described
  // exactly, down to the whitespace a parent would see.
  ok(html.includes("Jordan&#39;s spot at By Any Means Basketball in is held")
    || html.includes("Jordan's spot at By Any Means Basketball in is held"),
    "and the sentence that names the city renders it as nothing");
  ok(titleOf(html) === PRE_MIGRATION_NAME, "the title is the bare brand");
  ok(!html.includes("{{WORDMARK_SUFFIX}}") && !html.includes("{{LOCATION_TAG}}") && !html.includes("{{location.city}}"),
    "but nothing raw or dead ships in their place");
  ok(html.includes(`href="mailto:${GTA.business_email}?subject=Unsubscribe"`),
    "and the send is NOT held: everything else about the email is unaffected");
}

// ─── 9. no step row hand-types the brand name any more ───────────────────────
// This section used to assert the OPPOSITE. Three of GTA's automation_steps rows typed
// "By Any Means Basketball" into their copy, so after 20260729T235000 the shell said
// "By Any Means Toronto" while the message inside said Basketball - worst of all on
// onboarding step 2, whose email BODY header and SUBJECT LINE disagreed with each other
// in the same inbox. It was recorded rather than fixed because editing live copy is an
// owner-visible change. Zoran asked for it on 2026-07-30; migration 20260730T120000 is
// the data half and this section is now its proof.
//
// The claim is NOT "the rows contain a token". It is that the NAME FOLLOWS THE ROW:
// renaming the academy moves all three messages, which is the only thing that makes
// this a repair rather than a re-typing.
console.log("\n── 9. the step rows merge the academy name instead of typing it ──");
{
  const gtaSnap = snap("bam-gta.json");
  const steps = [];
  for (const a of gtaSnap.automations || []) {
    for (const s of a.steps || []) steps.push({ key: `${a.automation_key}-${s.position}`, ...s });
  }
  // 1) NOTHING types it any more. Whole-fixture sweep, not a check of three known rows,
  //    so a fourth row acquiring the literal tomorrow fails here too.
  const typed = steps.filter((s) => `${s.subject || ""}|${s.body || ""}`.includes(PRE_MIGRATION_NAME))
    .map((s) => s.key);
  ok(typed.length === 0,
    `no step row hand-types ${JSON.stringify(PRE_MIGRATION_NAME)} any more${typed.length ? `: ${typed.join(", ")}` : ""}`);

  // 2) The three that used to type it now carry the merge token. Asserted per row and
  //    NOT as "these are the only rows with the token" - contact_form-0, ghosted-2 and
  //    trial_form-0 already merged it before any of this, and they are the pattern
  //    these three are joining rather than an exception to it.
  const tokenised = new Set(steps
    .filter((s) => `${s.subject || ""}|${s.body || ""}`.includes("{{location.name}}"))
    .map((s) => s.key));
  for (const key of ["onboarding-1", "onboarding-2", "summer_special-0"]) {
    ok(tokenised.has(key), `${key} carries {{location.name}} instead of a typed name`);
  }

  // 3) THE ACTUAL GUARANTEE: rendered through the real send path, each of the three
  //    says GTA's row name - and renaming the row moves all three. A hardcode cannot
  //    satisfy the second half, which is why both halves are asserted.
  //    onboarding-2's name lives in its SUBJECT, so it is rendered through
  //    renderStepMessage (what api/_send.js sendOn() calls) rather than renderEmail:
  //    a subject is not a body and does not have to behave like one.
  const RENAMED = "Northside Hoops Academy";
  const stepOf = (key) => steps.find((s) => s.key === key);
  const renderedFor = (client, key) => {
    const s = stepOf(key);
    const m = renderStepMessage({ channel: s.channel, clientId: client.id, subject: s.subject, body: s.body, vars: varsFor(client) });
    return m.channel === "sms" ? m.text : `${m.subject}\n${m.html}`;
  };
  for (const key of ["onboarding-1", "onboarding-2", "summer_special-0"]) {
    const asIs = renderedFor(GTA, key);
    ok(asIs.includes(GTA_NAME) && !asIs.includes(PRE_MIGRATION_NAME),
      `${key} renders ${JSON.stringify(GTA_NAME)} and not the old name`);
    const renamed = renderedFor({ ...GTA, public_name: RENAMED }, key);
    ok(renamed.includes(RENAMED) && !renamed.includes(GTA_NAME),
      `${key} follows the row: renaming it to ${JSON.stringify(RENAMED)} moves the message`);
  }

  // 4) onboarding step 5's subject, "Where By Any Means came from", is deliberately
  //    NOT tokenised - it names the brand family the origin story is about, not the
  //    academy. "Where Northside Hoops Academy came from" would be a different and
  //    false claim. Pinned so the exception is a decision on the record rather than
  //    a row somebody missed.
  const story = stepOf("onboarding-5");
  ok(story.subject === "Where By Any Means came from",
    "onboarding step 5's subject still names the brand family, on purpose");
}

console.log("");
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
