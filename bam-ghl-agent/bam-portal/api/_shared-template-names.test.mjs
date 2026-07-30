// A SHARED EMAIL TEMPLATE MUST NEVER CARRY ONE ACADEMY'S NAME.
//
//   node api/_shared-template-names.test.mjs
//
// Plain node. No network, no database, no dependencies.
//
// WHAT WAS WRONG. api/email-templates/nurture-emails.js is SHARED - every academy's
// nurture-1 renders from the same string - and its identity kicker was typed in:
//
//   By Any Means Basketball &middot; Est. 2015
//
// So every academy's nurture-1 footer carried BAM's name. It was found by rendering
// San Jose's, whose kicker read "By Any Means Basketball - Est. 2015" while the gold
// wordmark two lines above it read SAN JOSE. It is now {{ACADEMY_FULL}}.
//
// WHY THIS BUG NEEDS ITS OWN SUITE. It is a different shape from the automation_steps
// hardcodes that api/_email-identity-from-the-row.test.mjs section 9 covers, and the
// difference is blast radius. A typed name in a step row is ONE academy's row, wrong
// for that academy alone, and its owner can edit it. A typed name in a shared template
// is wrong for EVERY academy at once, including academies that do not exist yet, and no
// owner can reach it. The GTA goldens cannot catch it either: GTA is the academy whose
// name was typed, so its render was correct and its goldens were green. The leak was
// only visible from a SECOND academy, which is why this suite always renders two.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT PROVES
//   1. nurture-1 rendered for two unrelated academies gives each its OWN name, and
//      neither one sees the other's - the check the brief asked for, extended to all
//      ten shared templates because the bug class is not specific to one.
//   2. THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. Render a template for both
//      academies and keep the lines that are IDENTICAL in both. Those lines are, by
//      construction, the parts of the email that do not depend on which academy is
//      sending. An academy name on such a line is a hardcode, necessarily - that is
//      what "same for everyone" means. Section 1 alone does NOT catch this: with the
//      old kicker restored, academy A's render still contained A's name (from the
//      footer reason) and still did not contain B's, so section 1 passed. MUTATE
//      =hardcode proves exactly that, and it is why section 2 exists.
//   3. The two allowed exceptions are named, and they cannot rot: each must still
//      match something or the run fails.
//
// THE TWO ALLOWED EXCEPTIONS, AND WHY THEY ARE NOT THE BUG. nurture-1 is deliberately
// the GLOBAL-BRAND email ("you're not joining a local program, you're plugging into a
// basketball brand the world already knows"). Two of its invariant lines name
// "By Any Means Basketball" and both are the proper name of the YouTube CHANNEL, sat
// beside @ByAnyMeansBasketball, 502K subscribers and 639 videos. Tokenising those would
// render "By Any Means Toronto" next to a handle reading @ByAnyMeansBasketball, which
// is not a fix - it is a false statement, because no Toronto channel exists. A channel's
// name is not the academy's name and is correctly typed.
//
// WHAT IT DOES NOT PROVE
//   - That nurture-1 is TRUE for a non-BAM academy. It is not, and this suite cannot
//     make it so. Beyond the two channel lines the email also asserts a founder, a
//     founding year, 50+ countries, 502K subscribers, camps on six continents and
//     byanymeansbball.com/locations - all real facts about the By Any Means brand and
//     all false for, say, DETAIL Miami. Only the two BAM academies send it today (GTA
//     and San Jose, verified against production 2026-07-30), and for them those claims
//     are true. If a non-BAM academy is ever given a nurture sequence, this suite going
//     green means its NAME is right, NOT that the email is honest. That is a content
//     decision, and no assertion here should be mistaken for it.
//   - Anything about the automation_steps rows. That is section 9 of
//     api/_email-identity-from-the-row.test.mjs.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE thing and must print NEGATIVE CONTROL PASSED:
//
//   MUTATE=hardcode   node api/_shared-template-names.test.mjs  # the original bug,
//                     # byte for byte: nurture-1's kicker goes back to the typed
//                     # "By Any Means Basketball &middot; Est. 2015"
//   MUTATE=crossleak  node api/_shared-template-names.test.mjs  # academy A renders
//                     # with academy B's name (the deleted LOCATIONS map's shape)
//   MUTATE=noslot     node api/_shared-template-names.test.mjs  # nurture-1's identity
//                     # token is deleted, so no academy name appears at all - a
//                     # template that names nobody must not pass by being empty
//   MUTATE=staleallow node api/_shared-template-names.test.mjs  # an allowlist entry
//                     # that matches nothing, i.e. the exceptions rotting into a
//                     # blanket exemption
//
// `hardcode` and `noslot` mutate the TEMPLATE STRING before api/email-shells.js is
// imported, so its `{ ...NURTURE_TEMPLATES }` spread picks the mutation up and the
// render path is the real one, untouched. `crossleak` acts on the vars seam - the same
// seam api/_email-identity-from-the-row.test.mjs uses - so it models an identity
// override rather than a text edit.

const MUTATE = process.env.MUTATE || "";

// ─── the mutation that must happen BEFORE email-shells.js loads ──────────────
// email-shells.js builds its template map with a spread at module-load time, so the
// nurture module has to be imported and edited first. Importing it here rather than at
// the top of the file is what makes that ordering explicit instead of accidental.
const nurtureMod = await import("./email-templates/nurture-emails.js");
const ORIGINAL_KICKER = "{{ACADEMY_FULL}}</td>";
if (MUTATE === "hardcode" || MUTATE === "noslot") {
  const t = nurtureMod.TEMPLATES["nurture-1"];
  if (!t.includes(ORIGINAL_KICKER)) {
    console.log(`❌ MUTATE=${MUTATE} could not find the kicker slot to break. Fix the mutation, not the suite.`);
    process.exit(1);
  }
  nurtureMod.TEMPLATES["nurture-1"] = t.replace(
    ORIGINAL_KICKER,
    // `hardcode` restores the exact string that was there before 2026-07-30.
    MUTATE === "hardcode" ? "By Any Means Basketball &middot; Est. 2015</td>" : "</td>",
  );
}

const { renderEmail, clientVars } = await import("./email-shells.js");
const { ONBOARDING_TEMPLATES } = await import("./email-templates/onboarding-emails.js");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ─── two academies that share no words ───────────────────────────────────────
// Deliberately unrelated names, cities, domains and emails. If any part of one shows up
// in the other's email there is nothing to argue about - no shared word can excuse it.
// Neither is a real academy: a fixture named after a real one could pass by coincidence
// when the template names THAT one.
const academy = (id, name, domain, city) => ({
  id,
  business_name: name,
  public_name: name,
  owner_name: "Sam Reed",
  business_email: `info@${domain}`,
  address: `12 Main St, ${city}, ON`,
  website_setup: { domain },
  tagline: `Where ${city} gets better`,
  instagram_url: `https://instagram.com/${domain.split(".")[0]}`,
  // Not a column; carried alongside so the leak check in section 1 can name the city it
  // is looking for without re-deriving it from the address.
  _city: city,
});
const A = academy("aaaaaaaa-0000-0000-0000-000000000001", "Northside Hoops Academy", "northsidehoops.example", "Hamilton");
const B = academy("bbbbbbbb-0000-0000-0000-000000000002", "Riverside Ball Club", "riversideball.example", "Fresno");

const FAMILY = { first_name: "Maya", full_name: "Maya Alvarez", athlete: "Jordan Alvarez" };

// The one seam MUTATE=crossleak acts on: how a client row becomes vars.
function varsFor(client) {
  const v = { ...FAMILY, ...clientVars(client) };
  if (MUTATE === "crossleak" && client.id === A.id) v.location_name = B.public_name;
  return v;
}

const render = (client, key) =>
  renderEmail({ clientId: client.id, subject: key, body: `template:${key}`, vars: varsFor(client) });

// Every shared template, read off the modules rather than listed here, so a NEW
// template is covered the moment it exists instead of when somebody remembers.
const KEYS = [...Object.keys(nurtureMod.TEMPLATES), ...Object.keys(ONBOARDING_TEMPLATES)].sort();

// Names that must never appear on a line that is the same for every academy. The two
// fixtures, plus the real strings this bug has actually involved: the literal that was
// typed into the template, and the two academies whose public_name it collided with.
const ACADEMY_NAMES = [
  "By Any Means Basketball",
  "By Any Means Toronto",
  "By Any Means San Jose",
  A.public_name,
  B.public_name,
];

// ─── the two allowed exceptions ──────────────────────────────────────────────
// Matched as exact substrings of the offending line, so each covers ONE occurrence in
// ONE context and cannot quietly widen. Both are the YouTube channel's proper name.
// Every entry must still match something (asserted in section 3), so an exception that
// stops applying fails the run instead of rotting into a blanket exemption.
const GLOBAL_BRAND_ALLOWED = [
  {
    find: ">By Any Means Basketball</p>",
    why: "the YouTube channel's name in the Channel card, beside @ByAnyMeansBasketball and its subscriber count. Not the academy.",
  },
  {
    find: "2 min &middot; By Any Means Basketball</span>",
    why: "the attribution on the 'Watch the story' video card, naming the same channel.",
  },
];
// A real stale entry, added the way one actually appears: left behind after the line it
// excused was rewritten. Pushed into the SAME list the run uses, so nothing about the
// check below is special-cased for it.
if (MUTATE === "staleallow") {
  GLOBAL_BRAND_ALLOWED.push({
    find: ">By Any Means Basketball</td>",
    why: "the kicker line as it was typed before 2026-07-30, which no longer exists.",
  });
}
const allowHits = new Map(GLOBAL_BRAND_ALLOWED.map((e) => [e.find, 0]));
const allowedLine = (line) => {
  for (const e of GLOBAL_BRAND_ALLOWED) {
    if (line.includes(e.find)) { allowHits.set(e.find, allowHits.get(e.find) + 1); return true; }
  }
  return false;
};

// ─── 1. each academy sees its own name and never the other's ─────────────────
// nurture-1 first and by name, because it is the template the bug was in, then the
// other nine on the same rule.
console.log("\n── 1. two academies, ten shared templates, no borrowed names ──");
{
  const nA = render(A, "nurture-1");
  const nB = render(B, "nurture-1");
  ok(nA.includes(A.public_name), `nurture-1 for ${A.public_name} names it`);
  ok(!nA.includes(B.public_name), `nurture-1 for ${A.public_name} does NOT contain ${JSON.stringify(B.public_name)}`);
  ok(nB.includes(B.public_name), `nurture-1 for ${B.public_name} names it`);
  ok(!nB.includes(A.public_name), `nurture-1 for ${B.public_name} does NOT contain ${JSON.stringify(A.public_name)}`);

  // THE KICKER LINE ITSELF, pulled out by its own markup rather than searched for in
  // the whole document. "the render contains the academy's name" is too weak to pin
  // this line: nurture-1 names the academy three more times (the body copy and the
  // footer reason), so deleting this one slot leaves that assertion green - MUTATE
  // =noslot proved exactly that and is why this check exists. The kicker is where the
  // hardcode was, so it gets an assertion of its own.
  const kickerOf = (html) => {
    const m = /letter-spacing:3\.6px;text-transform:uppercase;color:#777777;">([^<]*)<\/td>/.exec(String(html));
    return m ? m[1].trim() : null;
  };
  for (const [key, self] of [["nurture-1", A], ["nurture-1", B], ["onboarding-story", A], ["onboarding-story", B]]) {
    ok(kickerOf(render(self, key)) === self.public_name,
      `${key}: the identity kicker reads ${JSON.stringify(self.public_name)}, got ${JSON.stringify(kickerOf(render(self, key)))}`);
  }

  // The rest of each academy's identity, not just its name: a leak through the city,
  // the domain or the support address is the same bug wearing a different field.
  for (const [self, other] of [[A, B], [B, A]]) {
    const html = render(self, "nurture-1");
    const leaked = [other.public_name, other.business_email, other.website_setup.domain, other._city]
      .filter((s) => html.includes(s));
    ok(leaked.length === 0, `nurture-1 for ${self.public_name} leaks none of the other academy's identity fields${leaked.length ? `: ${leaked.join(", ")}` : ""}`);
  }

  // All ten, so this is a property of the template layer rather than of one file.
  for (const key of KEYS) {
    const hA = render(A, key);
    const hB = render(B, key);
    ok(!hA.includes(B.public_name) && !hB.includes(A.public_name),
      `${key}: neither academy's render contains the other's name`);
  }
}

// ─── 2. no invariant line names an academy ───────────────────────────────────
// The check that would have caught the original bug. A line identical in both academies'
// renders does not depend on who is sending, so an academy name on it is hardcoded.
console.log("\n── 2. lines that are the same for BOTH academies carry no academy name ──");
{
  let offenders = 0;
  for (const key of KEYS) {
    const linesA = render(A, key).split("\n");
    const inB = new Set(render(B, key).split("\n"));
    const invariant = linesA.filter((l) => inB.has(l));
    const bad = invariant
      .filter((l) => ACADEMY_NAMES.some((n) => l.includes(n)))
      .filter((l) => !allowedLine(l));
    if (bad.length) {
      offenders += bad.length;
      for (const l of bad) console.log(`     ${key}: ${l.trim().slice(0, 160)}`);
    }
    ok(bad.length === 0, `${key}: ${invariant.length} invariant line(s), none naming an academy`);
  }
  ok(offenders === 0, `no shared template hardcodes an academy name (${offenders} offending line(s))`);
}

// ─── 3. the exceptions still apply ───────────────────────────────────────────
// An allowlist nobody checks is how a waiver becomes an exemption. Each entry must have
// matched at least one real line above.
console.log("\n── 3. both global-brand exceptions still match something ──");
{
  for (const e of GLOBAL_BRAND_ALLOWED) {
    ok(allowHits.get(e.find) > 0,
      `still applies (${allowHits.get(e.find)} line(s)): ${JSON.stringify(e.find)} - ${e.why}`);
  }
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
