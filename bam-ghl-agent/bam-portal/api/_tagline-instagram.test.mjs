// THE ACADEMY'S OWN TAGLINE AND INSTAGRAM, FROM ITS OWN ROW.
//
//   node api/_tagline-instagram.test.mjs
//
// Plain node. No network, no database, no dependencies.
//
// WHAT WAS WRONG. The black footer of every automation email carries two identity
// facts: the sentence under the wordmark ({{TAGLINE}}) and the "Instagram" link
// ({{INSTAGRAM_URL}}). There was NO COLUMN for either, so locFromVars() - the function
// that derives an academy's identity from its own clients row - hardcoded both to "".
// The only place they existed was the LOCATIONS map in api/email-shells.js, keyed by
// client id, with one entry: BAM GTA's (deleted 29 Jul 2026 - see section 5). So GTA's
// footer was complete and every other academy sent a footer with a blank line and no
// Instagram, with no field anywhere in the portal that could fix it.
//
// The fix is clients.tagline + clients.instagram_url (migration 20260729T230000), the
// two pinned fields deleted from GTA's entry, and both read through clientVars(). This
// suite is what says the values now come from the ROW and not from code. (The entry
// itself is gone as of the same day, once the last four fields had row-backed answers -
// api/_email-identity-from-the-row.test.mjs covers that.)
//
// WHY IT RENDERS INSTEAD OF GREPPING. Standing rule in this repo: a literal-grep leak
// audit gives false answers, because a string can be absent from the file it was moved
// out of and still reach the output through a fallback - and equally, present in a file
// and never rendered. So every assertion below builds a REAL email through renderEmail
// and inspects the bytes that come out.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. GTA's tagline and Instagram come from the ROW. Not "the output contains them" -
//      that was true before this change too, from the hardcode. The assertion is that
//      CHANGING THE ROW CHANGES THE OUTPUT, which a pin cannot satisfy.
//   2. An academy with neither renders no tagline sentence and NO Instagram link, and
//      does not borrow GTA's. Two real academies are also checked against each other
//      so neither can stand in for the other.
//   3. No dead anchor is left where a missing Instagram link was, and no raw
//      {{placeholder}} is left showing.
//   4. No per-client-id lookup answers for either field: rendering under GTA's real
//      client id with an EMPTY row produces neither value. That is the render-level
//      form of "the pin is gone" and it holds however a replacement is spelled.
//
// WHAT IT DOES NOT PROVE
//   - Much about the map's DELETION, which happened later the same day (29 Jul 2026)
//     once migration 20260729T235000 answered the last four pinned fields from
//     clients.public_name and clients.address. Section 5 used to record what the entry
//     still decided; it now holds the one guard that survives the deletion - locFor()
//     ignoring the client id - and the full treatment of the deletion, including the
//     visible change it made to GTA's emails, is in
//     api/_email-identity-from-the-row.test.mjs.
//   - That instagram_url points at a live profile, or that the tagline is any good.
//     Nothing here or anywhere else checks either.
//   - That the SEND path reads the two columns. It does not yet: they are absent from
//     the loadClient select lists in api/automations.js and api/agent-confirm.js until
//     the migration is applied, which is written up in that migration's "BEFORE YOU
//     DEPLOY". Section 6 asserts what that interim actually renders, so the degraded
//     state is a described outcome rather than a surprise.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=blank   node api/_tagline-instagram.test.mjs  # the row is ignored and both
//                                                        # fields resolve to "" again
//                                                        # (the pre-migration state)
//   MUTATE=borrow  node api/_tagline-instagram.test.mjs  # an academy with neither
//                                                        # inherits GTA's (the shape
//                                                        # the old fallback had)
//   MUTATE=pin     node api/_tagline-instagram.test.mjs  # a per-client-id map wins
//                                                        # over the row for GTA (the
//                                                        # hardcode, restored)
//
// The controls act on ONE seam: how a caller turns a client row into vars, which is
// the same seam api/_business-email.test.mjs uses and for the same reason - it is the
// only input renderEmail takes. `blank` produces byte-for-byte what locFromVars would
// produce if it went back to hardcoding "", because that function reads nothing else;
// `pin` produces byte-for-byte what a per-client-id entry carrying these two fields
// would produce, because they are read straight off the vars with no derivation in
// between. If either ever reports FAILED, this suite is decorative.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, clientVars, locFor } from "./email-shells.js";

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
// The same production snapshots the GTA locks read, so "what GTA looks like today" has
// one answer across every suite. GTA is deliberately not the only academy here: it was
// the one WITH a pinned entry, so for as long as that entry existed a bug in the
// row-derived path could hide behind it. It no longer can, and a second academy is
// still the cheapest way to keep proving that.
const snap = (f) => JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, f), "utf8"));
const GTA = snap("bam-gta.json").client;
const SJ = snap("bam-san-jose.json").client;

// The tagline and Instagram GTA actually publishes. Read off the snapshot rather than
// retyped, so this suite cannot pass against a fixture that has drifted.
const GTA_TAGLINE = GTA.tagline;
const GTA_IG = GTA.instagram_url;

// A second academy WITH both facts, so section 1 is not a single-academy claim and the
// two can be checked for cross-contamination. San Jose's row has neither in production
// (nobody has written its tagline), so this is a synthetic row over its real identity -
// and that is stated rather than hidden: the fixture is honest about which fields are
// production and which are made up.
const SJ_FILLED = { ...SJ, tagline: "Skills training for San Jose athletes.",
  instagram_url: "https://instagram.com/byanymeanssanjose" };

// An academy that has entered nothing. Shaped like DETAIL Miami and Johnson Bball,
// which really do have neither fact on file.
const BARE = {
  id: "bare-academy-0000-0000-000000000000",
  business_name: "Johnson Bball",
  public_name: "Johnson Basketball",
  owner_name: "Mike Johnson",
  email: "mike@byanymeansbball.com",
  business_email: "info@johnsonbball.example",
  website_setup: { domain: "johnsonbball.example" },
};

const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };
const BODY = "Hi {{contact.first_name}},\n\nJordan's spot is held for this week.\n\nSee you at training.";

// The ONE seam the mutations act on. See the header for why each is a faithful model of
// the code path it stands in for.
const PIN = { tagline: GTA_TAGLINE, instagram_url: GTA_IG };
function varsFor(client) {
  const v = { ...FAMILY, ...clientVars(client) };
  if (MUTATE === "blank") { v.location_tagline = ""; v.location_instagram_url = ""; }
  if (MUTATE === "borrow") {
    v.location_tagline = v.location_tagline || GTA_TAGLINE;
    v.location_instagram_url = v.location_instagram_url || GTA_IG;
  }
  if (MUTATE === "pin" && client.id === GTA.id) {
    v.location_tagline = PIN.tagline;
    v.location_instagram_url = PIN.instagram_url;
  }
  return v;
}
const emailFor = (client) => renderEmail({ clientId: client.id, subject: "Your spot this week", body: BODY, vars: varsFor(client) });
// The footer tagline sits in one specific <p>; pulling it out by its style rather than
// searching the whole document means "the tagline rendered" cannot be satisfied by the
// same words appearing somewhere in the body copy.
const taglineOf = (html) => {
  const m = /color:#9A9A92;">([\s\S]*?)<\/p>/.exec(String(html));
  return m ? m[1].trim() : null;
};
const igHrefOf = (html) => {
  const m = /<a href="([^"]*)"[^>]*>Instagram<\/a>/.exec(String(html));
  return m ? m[1] : null;
};

// ─── 1. the ROW decides, which is the whole claim ────────────────────────────
console.log("\n── 1. both facts render, and they come from the client row ──");
for (const c of [GTA, SJ_FILLED]) {
  const html = emailFor(c);
  ok(!!c.tagline && !!c.instagram_url, `${c.business_name}: the row carries both facts`);
  ok(taglineOf(html) === c.tagline, `${c.business_name}: the footer tagline is the row's tagline`);
  ok(igHrefOf(html) === c.instagram_url, `${c.business_name}: the footer Instagram link is the row's URL`);
  ok(!html.includes("{{TAGLINE}}") && !html.includes("{{INSTAGRAM_URL}}"),
    `${c.business_name}: neither placeholder is left showing`);

  // THE ASSERTION THAT SEPARATES DATA FROM A HARDCODE. The two above were already true
  // before this change, from the pinned entry. This one cannot be: edit the row and the
  // email must follow.
  const edited = { ...c, tagline: "A different sentence entirely.", instagram_url: "https://instagram.com/someoneelse" };
  const html2 = emailFor(edited);
  ok(taglineOf(html2) === "A different sentence entirely.",
    `${c.business_name}: editing the row's tagline CHANGES the email (a pin could not do this)`);
  ok(igHrefOf(html2) === "https://instagram.com/someoneelse",
    `${c.business_name}: editing the row's instagram_url changes the footer link`);
  ok(!html2.includes(c.tagline) && !html2.includes(c.instagram_url),
    `${c.business_name}: and the old values are GONE, not rendered alongside`);
}
{
  // The two academies must not be interchangeable.
  const g = emailFor(GTA), s = emailFor(SJ_FILLED);
  ok(!s.includes(GTA_TAGLINE) && !s.includes(GTA_IG), "San Jose's email carries no trace of GTA's tagline or Instagram");
  ok(!g.includes(SJ_FILLED.tagline) && !g.includes(SJ_FILLED.instagram_url), "and GTA's carries none of San Jose's");
}

// ─── 2. an academy with neither borrows nobody's ─────────────────────────────
console.log("\n── 2. an academy with neither fact renders neither ──");
{
  const html = emailFor(BARE);
  ok(taglineOf(html) === "", "the footer tagline renders as nothing at all");
  ok(!html.includes(GTA_TAGLINE), "it does NOT inherit GTA's tagline");
  ok(!html.includes(GTA_IG) && !html.includes("byanymeanstoronto"), "and none of GTA's Instagram or domain leaks in");
  // A missing link fact must not leave a link. dropEmptyShellLinks takes the anchor out
  // with its dot separator rather than shipping one pointing nowhere.
  ok(igHrefOf(html) === null, "there is NO Instagram anchor at all");
  ok(!html.includes('href=""'), "and no dead empty href is rendered in its place");
  ok(!html.includes("{{TAGLINE}}") && !html.includes("{{INSTAGRAM_URL}}"), "no raw placeholder is left showing");
  // The email is otherwise fine: this is about two footer facts, not about breaking a send.
  ok(html.includes("Jordan&#39;s spot is held") || html.includes("Jordan's spot is held"),
    "the message body itself still renders");
  ok(html.includes(`<a href="mailto:${BARE.business_email}"`), "and the rest of the footer is intact");
  // HONEST ABOUT WHAT "no tagline line" MEANS: the <p> that would hold it is still in
  // the markup, empty. A parent reads no sentence, which is the outcome that matters,
  // but the element is there and this suite is not going to pretend otherwise. That is
  // unchanged, pre-existing behaviour for every academy without a tagline.
  ok(/color:#9A9A92;">\s*<\/p>/.test(html), "(the tagline <p> is present but empty, which is pre-existing behaviour)");
}

// ─── 3. locFor agrees with what was rendered ─────────────────────────────────
console.log("\n── 3. the resolved location config says the same thing ──");
{
  ok(locFor(GTA.id, varsFor(GTA)).tagline === GTA_TAGLINE, "GTA's resolved config carries the row's tagline");
  ok(locFor(GTA.id, varsFor(GTA)).instagram === GTA_IG, "and the row's Instagram URL");
  ok(locFor(BARE.id, varsFor(BARE)).tagline === "", "the bare academy's resolves to empty");
  ok(locFor(BARE.id, varsFor(BARE)).instagram === "", "for both fields");
}

// ─── 4. the pin is gone for THESE TWO fields ─────────────────────────────────
// (It is now gone for ALL of them - section 5 - but this is the check that was written
// when it was gone for only these two, and it still earns its place: it is the only one
// here that renders under GTA's OWN id against a row that carries nothing.)
// Rendered, not grepped, and rendered under GTA's REAL client id - the only key any
// per-academy map is keyed by. An EMPTY row must produce an empty footer even there. If
// anything anywhere still pins these two for GTA, this is what notices.
console.log("\n── 4. GTA's real client id no longer pins either fact ──");
{
  const EMPTY_ROW = { id: GTA.id, business_name: "BAM GTA", business_email: "info@byanymeanstoronto.ca" };
  const html = renderEmail({ clientId: GTA.id, subject: "s", body: BODY, vars: { ...FAMILY, ...clientVars(EMPTY_ROW) } });
  ok(taglineOf(html) === "", "under GTA's own id, an empty row renders an empty tagline");
  ok(!html.includes(GTA_TAGLINE), "GTA's tagline does not appear from anywhere else");
  ok(igHrefOf(html) === null, "and there is no Instagram link");
  ok(!html.includes(GTA_IG), "GTA's Instagram URL does not appear from anywhere else");
  // Belt and braces, and weaker on purpose: a source check only catches this exact
  // spelling, which is why the render checks above are the real assertion.
  ok(!/^\s*tagline:\s*"/m.test(SHELLS_SRC), "no tagline literal is left in email-shells.js");
  ok(!/^\s*instagram:\s*"http/m.test(SHELLS_SRC), "no instagram literal is left in email-shells.js");
  ok(!SHELLS_SRC.split("\n").some((l) => l.includes(GTA.id) && !l.trim().startsWith("//")),
    "(source) GTA's client id appears in no executable line of email-shells.js at all");
}

// ─── 5. the entry is GONE, and nothing may put one back ──────────────────────
// THIS SECTION USED TO ASSERT THE OPPOSITE, AND THAT IS THE POINT OF IT.
//
// Until 29 Jul 2026 it asserted that four fields (suffix, full, locationTag, city)
// STILL disagreed between the pinned entry and the row - deliberately, so that the day
// somebody resolved the disagreement this section would fail and force an update
// instead of quietly describing history. That day arrived in the same sitting: the map
// was deleted outright and migration 20260729T235000 answered all four from
// clients.public_name and clients.address. See
// api/_email-identity-from-the-row.test.mjs for the full treatment of that half.
//
// What is left here is the guard that OUTLIVES the change: locFor() must return the
// same config whatever client id it is handed. That is the render-level definition of
// "no per-academy override exists", it holds however a replacement is spelled (a map, a
// switch, a JSON file, an `overrides` column), and it is the exact regression this
// whole task removed. It is asserted for the two fields THIS suite owns and for the
// four that used to be pinned, because a reintroduced pin would most likely arrive by
// the same route it left.
console.log("\n── 5. locFor takes no notice of the client id, for any field ──");
{
  const v = varsFor(GTA);
  const underOwnId = locFor(GTA.id, v);
  const underOther = locFor("00000000-0000-0000-0000-000000000000", v);
  for (const [field, was] of [
    ["tagline", "the footer sentence, pinned until migration 20260729T230000"],
    ["instagram", "the footer Instagram link, pinned until the same migration"],
    ["suffix", 'the gold wordmark word, pinned "GTA" until 20260729T235000'],
    ["full", 'the parent-facing name, pinned "By Any Means Toronto" until the same'],
    ["locationTag", 'the header line, pinned "OAKVILLE &middot; GTA" until the same'],
    ["city", 'the city, pinned "Oakville" until the same'],
  ]) {
    ok(JSON.stringify(underOwnId[field]) === JSON.stringify(underOther[field]),
      `${field} is the row's, not the id's - ${was}`);
  }
  // And the whole config, not just the fields anybody thought to list.
  ok(JSON.stringify(underOwnId) === JSON.stringify(underOther),
    "and the ENTIRE resolved config is identical under GTA's id and a stranger's");
  // The two values this suite owns are the row's, positively - so the check above
  // cannot be satisfied by both sides being empty.
  ok(underOwnId.tagline === GTA_TAGLINE && underOwnId.instagram === GTA_IG,
    "(and both are GTA's real values, so the equality above is not two blanks agreeing)");
}

// ─── 6. the pre-select-list interim, described rather than discovered ────────
// The two columns are NOT in the loadClient select lists yet (they cannot be: naming a
// column before its migration is applied 400s the whole select and stops every
// automation). So until that follow-up lands, a send reads a row without them. This is
// what that renders - asserted, so it is a known outcome and not a surprise in
// somebody's inbox.
console.log("\n── 6. what a send renders before the columns join the select lists ──");
{
  // GTA's row as loadClient returns it TODAY: every column that list names, and neither
  // of the two new ones.
  const asLoaded = { ...GTA };
  delete asLoaded.tagline;
  delete asLoaded.instagram_url;
  const html = renderEmail({ clientId: GTA.id, subject: "s", body: BODY, vars: { ...FAMILY, ...clientVars(asLoaded) } });
  ok(taglineOf(html) === "", "no tagline sentence (the documented interim regression)");
  ok(igHrefOf(html) === null, "and no footer Instagram link");
  ok(!html.includes('href=""') && !html.includes("{{TAGLINE}}"), "but nothing dead or raw ships in their place");
  ok(html.includes(`href="mailto:${GTA.business_email}?subject=Unsubscribe"`),
    "and the send is NOT held: everything else about the email is unaffected");
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
