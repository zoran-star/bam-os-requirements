// NO SHARED DEFAULT CARRIES A REAL ACADEMY'S IDENTITY.
//
// WHAT THIS GUARDS, AND WHY IT IS NOT ONE OF THE FIVE SUITES THAT ALREADY EXIST.
// Four identity leaks were found in one week and every one of them had the same
// shape: one academy's identity baked into a SHARED DEFAULT that every academy
// falls back to.
//
//   1. BAM GTA's Google review link in the agent prompt's `social_proof`
//      default. 0 of 47 academies overrode it.
//   2. GTA's gym address, its "near Oakville/GTA" qualification rule and a
//      "certified by By Any Means" coach-credential claim, in three more prompt
//      defaults. 32 of 47 academies were shipping all three.
//   3. GTA's name hardcoded in a shared nurture email template, reaching every
//      academy's footer.
//   4. GTA's door directions in the shared trial-confirmation SMS
//      (api/agent/confirm-automations.js), on the money path for any academy
//      with a booked trial.
//
// Every one survived every existing test, and the reason is precise:
//   api/_sync-class.test.mjs      render-leak gate, scoped to EMAIL TEMPLATES
//                                 declared `shared`. Prompt bodies are not
//                                 templates and the confirm SMS is not one either.
//   api/_social-proof.test.mjs    asserts the absence of ONE specific link.
//   api/_prompt-academy-neutral   a curated banned list of seven literals, for a
//                                 named set of prompt sections.
// Nothing asserted that the DEFAULT BODIES in prompt-structure.js and
// confirm-automations.js are free of ANY academy's identity. The check existed
// one literal wide, for a handful of sections. This file is the general form.
//
// TWO PROPERTIES MAKE IT DIFFERENT FROM WHAT IT REPLACES:
//
//   A. THE BANNED VALUES ARE DERIVED FROM DATA, NOT TYPED. A hand-written list
//      is the thing that rots: it catches the four we know about and misses the
//      fifth. The banned set is built at runtime from the two committed
//      production snapshots at the MONOREPO ROOT (outside bam-ghl-agent/):
//          scripts/snapshots/bam-gta.json
//          scripts/snapshots/bam-san-jose.json
//      Snapshot a third academy and this check widens the same day, with no edit
//      here. The exact fields it reads are listed at DERIVED_FROM below.
//
//   B. THE DEFAULTS ARE ENUMERATED BY WALKING THE REAL STRUCTURES, NOT NAMED. It
//      walks every exported value of both modules, every string inside them at
//      any depth, plus the reachable-but-unexported bodies (the total_only
//      pricing table via pricingDisclosureBody) and the real assembled artifacts
//      (assemblePrompt for all three agents, getConfirmAutomations for an
//      academy with no override, resolveApptTokens on each step). A section
//      added to SECTIONS tomorrow, or a fourth automation step, is covered the
//      day it lands without anyone remembering this file exists.
//
// HOW TO RUN
//
//   node api/_shared-default-identity.test.mjs
//
// NEGATIVE CONTROLS. Each re-plants a REAL leak in the REAL source file on disk,
// imports the mutated module, and restores the file through exit/signal handlers
// registered before the first write. Each was run and watched go RED before this
// list was written.
//
//   leak 1  MUTATE=review     GTA's review link back in the social_proof default
//           MUTATE=reviewnow  same, using the CURRENT link on GTA's row
//   leak 2  MUTATE=address    GTA's gym address + directions + booking link
//           MUTATE=oakville   the "in or near Oakville/GTA" qualification rule
//           MUTATE=coach      the "certified by By Any Means" credential claim
//   leak 3  MUTATE=footer     "The BAM GTA team" signed onto the shared confirm SMS
//   leak 4  MUTATE=door       GTA's door directions back in the same-day SMS
//
//   the checks that guard the checks
//           MUTATE=stale      empties booking_group, so its allowlist entry has
//                             nothing left to except. A stale entry must BREAK
//                             the run, never pass quietly.
//           MUTATE=blindstrip makes the comment stripper eat the whole file, so
//                             stripping cannot silently disable the source sweep.
//
// A control counts as caught ONLY if this file prints NEGATIVE CONTROL PASSED.
// And "caught" is measured as a DELTA: the suite runs its full battery twice in
// one process, once against the pristine modules and once against the mutated
// ones, and the control passes only if the mutation produces a failure that the
// pristine run did not have. A control that merely inherits an existing red
// proves nothing.
//
// THE DUPLICATE-KEY TRAP. A mutation that inserts a second `"body"` key above
// the real one changes the file bytes and changes NOTHING else, because JS keeps
// the LAST duplicate: the module goes on exporting "" and the control passes
// while proving nothing. That cost an agent a day. Every mutation here is
// verified against the EXPORTED VALUE after import (see mutationLanded), and a
// mutation that did not land aborts the run instead of scoring a pass.
//
// COMMENTS ARE STRIPPED BEFORE THE SOURCE SWEEP. Several bodies in these two
// files were emptied and their comments deliberately QUOTE the removed literal
// to record what must never return. A naive scan flags those and reports the fix
// as the bug, which cost two people time. Section 6 strips comments first. It
// then asserts, separately, that those comments DO still contain their literals,
// so a comment-stripping bug cannot quietly turn the whole sweep into a no-op.
//
// WHAT COUNTS AS CRAFT AND WHAT COUNTS AS IDENTITY. Not every literal in a
// shared default is a leak, and the distinction is written down at ALLOWLIST
// below rather than left to judgement at review time. The short version:
//   CRAFT       a rule about how to sell, phrased so it is true for any academy.
//               The confirm and closing behaviour sections are entirely this.
//               "We keep our pricing consistent to ensure equity for all of our
//               athletes" is BAM's method, shared on purpose, and correct.
//   IDENTITY    a value that belongs to one academy and is FALSE for the rest.
//               A name, an address, a link, a phone number, a class time, an age
//               band, a tax regime.
//   The hard middle is a literal whose ROLE is craft and whose CONTENT is one
//   academy's fact. RECEIPT is exactly that and is allowlisted with its reason.
//
// WHAT A GREEN RUN DOES NOT MEAN. Read this before trusting one.
//   * It sees the identity of TWO academies. The banned set is derived from the
//     two snapshotted rows. A default carrying CH3 Training's or DETAIL Miami's
//     address is invisible to the identity detector, and only the structural
//     detectors (a link, a phone number, an email, venue prose) would catch it.
//     The fix is to snapshot more academies, not to edit this file.
//   * It cannot see a value that belongs to nobody in the snapshots. GTA's
//     "Ages: 9 and up" and its "Pause and cancel anytime" are not on the clients
//     row or in the facts block, so they are not derivable here.
//     api/_prompt-academy-neutral.test.mjs section 8 is what covers that class,
//     and the two suites are not interchangeable.
//   * It says nothing about what a live agent EMITS. These are the default
//     bodies. Nothing here proves a model handed the RECEIPT example never
//     speaks $315.27 to a parent in California.
//   * It only reads two files. The nurture email templates that carried leak 3
//     live elsewhere; leak 3 is proved here by re-planting its SHAPE (an academy
//     name signed onto a shared body) in the money-path file this suite covers.
//   * Casing and spelling evasion: a body writing "ByAnyMeansToronto.ca" or
//     "Oakvile" is not caught. The matcher normalises punctuation and case for
//     multiword values, nothing more.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as REAL_PS from "./agent/prompt-structure.js";
import * as REAL_CA from "./agent/confirm-automations.js";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_PS = path.join(HERE, "agent", "prompt-structure.js");
const SRC_CA = path.join(HERE, "agent", "confirm-automations.js");
const ORIGINAL_PS = fs.readFileSync(SRC_PS, "utf8");
const ORIGINAL_CA = fs.readFileSync(SRC_CA, "utf8");

// The snapshots live at the MONOREPO ROOT, three levels above api/.
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const SNAPSHOT_DIR = path.join(REPO_ROOT, "scripts", "snapshots");
const SNAPSHOTS = ["bam-gta.json", "bam-san-jose.json"];

const die = (msg) => { console.error("FATAL: " + msg); process.exit(1); };

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE BANNED SET, DERIVED FROM THE SNAPSHOTS
// ─────────────────────────────────────────────────────────────────────────────
//
// DERIVED_FROM is the whole contract with the next person. Every field listed
// here contributes values; anything not listed is a known gap, and widening the
// check means adding a line here, not typing a literal into a banned array.
//
//   client.business_name          "BAM GTA"                 name + capitalised runs + tokens
//   client.public_name            "By Any Means Toronto"    name + runs + tokens
//   client.legal_name             "3D Prep LLC"             whole value only (too generic to split)
//   client.owner_name             "Zoran Savic"             name + surname
//   client.email                  full address + its domain
//   client.business_email         full address + its domain
//   client.phone                  as written + digits only + last 7 digits
//   client.address                whole + street + street without number + CITY
//   client.website_setup.domain   "byanymeanstoronto.ca" + the label "byanymeanstoronto"
//   client.tagline                whole + every capitalised run in it (this is
//                                 where "Oakville" and "GTA" come from twice over)
//   client.instagram_url          whole + host + the handle
//   client.google_review_url      whole + host + the review id in the path
//   client.community_group_url    whole + host + long path segments
//   client.online_programs_url    whole + host + long path segments
//   client.referral_offer.merch_url  whole + host
//   facts.location_venue          the gym address: whole + street + CITY. This is
//                                 the one that carries "1079 Linbrook Rd", which
//                                 is NOT on the clients row.
//   facts.location_schedule[]     each group NAME and each group TIME. This is
//                                 what makes GTA's operating week and its
//                                 "Group 1 (Elementary)" vocabulary detectable.
//   facts.location_coaches[]      coach name + instagram url + handle
//   facts.location_testimonials[] author full name + the opening of each quote
//
// NOT DERIVED, ON PURPOSE:
//   client.brand_data       free prose. Every useful fragment in it ("Oakville",
//                           "GTA") already arrives via address and tagline, and
//                           n-gramming marketing prose produces fragments like
//                           "basketball training" that appear legitimately in
//                           behaviour bodies. Prose in, false positives out.
//   client.id / time_zone   an id never appears in copy; America/Toronto is a
//                           documented FALLBACK constant, not GTA's stored zone
//                           (its row says America/New_York), so banning it would
//                           report a correct fallback as a leak.
//
// PINNED is the one place values are typed rather than derived, and it exists
// because the snapshots hold no pricing at all. See the constant for why each
// value is there and where it was verified.

// Capitalised words that identify nobody. A run containing only these
// contributes nothing.
const GENERIC_WORD = new Set([
  "Inc", "Inc.", "LLC", "Ltd", "Corp", "Co", "The", "And", "Group", "Groups",
  "Basketball", "Training", "Academy", "Prep", "Sports", "Club", "Team", "Free",
  "Trial", "Program", "Programs", "Youth", "High", "School", "Ave", "St", "Rd",
  "Dr", "Cres", "Blvd", "Way", "Suite", "Unit", "ON", "CA", "US", "USA",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays",
]);

/** value -> [source labels]. Sources are printed on a hit so a finding names its own provenance. */
const BANNED = new Map();
function ban(value, source) {
  if (typeof value !== "string") return;
  const v = value.trim();
  if (!v || v.length < 3) return;
  // A multiword value must carry at least one substantial, non-generic token, or
  // it matches noise. "By Any" and "W San" die here; "By Any Means", "BAM GTA"
  // and "HST (13%)" survive, because a three-letter ALL-CAPS token identifies as
  // hard as a longer word does. The three-token clause keeps short legal names
  // like "3D Prep LLC", where every token is either tiny or generic.
  if (/\s/.test(v)) {
    const tokens = v.split(/\s+/);
    const substantial = (t) => {
      const w = t.replace(/[^A-Za-z0-9]/g, "");
      if (GENERIC_WORD.has(t) || GENERIC_WORD.has(w)) return false;
      return w.length >= 4 || (/^[A-Z0-9]+$/.test(w) && w.length >= 3);
    };
    const alnum = v.replace(/[^A-Za-z0-9]/g, "").length;
    if (!tokens.some(substantial) && !(tokens.length >= 3 && alnum >= 8)) return;
  }
  if (!BANNED.has(v)) BANNED.set(v, []);
  const list = BANNED.get(v);
  if (!list.includes(source)) list.push(source);
}

/** Maximal runs of capitalised words, e.g. "...in Oakville and across the GTA." -> [["Oakville"],["GTA"]]. */
function capitalisedRuns(s) {
  const out = [];
  let run = [];
  for (const w of String(s || "").split(/[^A-Za-z0-9'&.-]+/).filter(Boolean)) {
    if (/^[A-Z0-9]/.test(w) && /[A-Za-z]/.test(w)) run.push(w);
    else { if (run.length) out.push(run); run = []; }
  }
  if (run.length) out.push(run);
  return out;
}

/** A name-shaped field: the whole value, every multiword prefix of each run, and each substantial token. */
function banName(value, source) {
  ban(value, source);
  for (const run of capitalisedRuns(value)) {
    for (let n = 2; n <= run.length; n++) ban(run.slice(0, n).join(" "), source);
    for (const w of run) {
      if (GENERIC_WORD.has(w)) continue;
      // All-caps initialisms ("BAM", "GTA") are identifying at three characters.
      if (/^[A-Z0-9]+$/.test(w) && w.length >= 3) ban(w, source);
      else if (w.length >= 5) ban(w, source);
    }
  }
}

function banUrl(value, source) {
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) return;
  ban(value, source);
  try {
    const u = new URL(value);
    ban(u.host.replace(/^www\./, ""), source);
    // Long path segments are ids and handles. Short ones ("review", "r") are words.
    for (const seg of u.pathname.split("/").filter(Boolean)) if (seg.length >= 8) ban(seg, source);
  } catch { /* a malformed url in a snapshot contributes its whole value only */ }
}

function banAddress(value, source) {
  if (typeof value !== "string" || !value.trim()) return;
  ban(value, source);
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts[0]) { ban(parts[0], source); banName(parts[0].replace(/^\d+\s*/, ""), source); }
  if (parts[1]) banName(parts[1], source);   // the city
}

for (const file of SNAPSHOTS) {
  const full = path.join(SNAPSHOT_DIR, file);
  if (!fs.existsSync(full)) {
    die(`snapshot ${full} is missing. The banned set is DERIVED from these files, so a moved or ` +
        `renamed snapshot silently empties it and every scan below goes green. Fix the path, ` +
        `never delete the requirement.`);
  }
  let snap;
  try { snap = JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) { die(`snapshot ${file} is not valid JSON (${e.message})`); }
  const c = snap.client || {};
  const facts = snap.facts || {};
  const S = (field) => `${file}:${field}`;

  banName(c.business_name, S("client.business_name"));
  banName(c.public_name, S("client.public_name"));
  ban(c.legal_name, S("client.legal_name"));
  banName(c.owner_name, S("client.owner_name"));
  for (const k of ["email", "business_email"]) {
    const v = c[k];
    if (typeof v === "string" && v.includes("@")) { ban(v, S("client." + k)); ban(v.split("@")[1], S("client." + k)); }
  }
  if (typeof c.phone === "string" && c.phone.trim()) {
    ban(c.phone, S("client.phone"));
    const digits = c.phone.replace(/\D/g, "");
    if (digits.length >= 7) { ban(digits, S("client.phone")); ban(digits.slice(-7), S("client.phone")); }
  }
  banAddress(c.address, S("client.address"));
  const domain = c.website_setup && c.website_setup.domain;
  if (typeof domain === "string" && domain) { ban(domain, S("client.website_setup.domain")); ban(domain.split(".")[0], S("client.website_setup.domain")); }
  banName(c.tagline, S("client.tagline"));
  banUrl(c.instagram_url, S("client.instagram_url"));
  banUrl(c.google_review_url, S("client.google_review_url"));
  banUrl(c.community_group_url, S("client.community_group_url"));
  banUrl(c.online_programs_url, S("client.online_programs_url"));
  if (c.referral_offer && c.referral_offer.merch_url) banUrl(c.referral_offer.merch_url, S("client.referral_offer.merch_url"));

  banAddress(facts.location_venue, S("facts.location_venue"));
  for (const day of facts.location_schedule || []) {
    for (const g of day.groups || []) {
      ban(g && g.name, S("facts.location_schedule[].groups[].name"));
      ban(g && g.time, S("facts.location_schedule[].groups[].time"));
    }
  }
  for (const coach of facts.location_coaches || []) {
    banName(coach && coach.name, S("facts.location_coaches[].name"));
    banUrl(coach && coach.instagram, S("facts.location_coaches[].instagram"));
  }
  for (const t of facts.location_testimonials || []) {
    // Author FULL names only. A single first name ("Wendy") collides with the
    // invented names in the prompt examples, and a real parent's full name in a
    // shared default is the leak worth catching anyway.
    if (typeof t?.author === "string" && /\s/.test(t.author.trim())) ban(t.author.trim(), S("facts.location_testimonials[].author"));
    if (typeof t?.quote === "string" && t.quote.length >= 40) ban(t.quote.slice(0, 60), S("facts.location_testimonials[].quote"));
  }
}

// The three values in the RECEIPT example, which no snapshot can supply because
// neither holds an offer_prices row. Verified against production and recorded in
// prompt-structure.js's own 2026-07-30 audit comment: $279.00 is BAM GTA's
// pre-tax base for `Summer Unlimited - Monthly`, $315.27 is that row's live
// all-in price to the cent, and "HST (13%)" is GTA's clients.tax_config verbatim.
// They are PINNED rather than derived so the detector can see them at all; the
// judgement about whether they may stay is made once, at ALLOWLIST.
const PINNED = {
  "$315.27": "BAM GTA offer_prices: Summer Unlimited - Monthly, all-in",
  "$279.00": "BAM GTA offer_prices: Summer Unlimited - Monthly, pre-tax base",
  "$36.27": "BAM GTA offer_prices: the HST component of that row",
  "HST (13%)": "BAM GTA clients.tax_config, an Ontario tax regime",
};
for (const [v, why] of Object.entries(PINNED)) ban(v, `PINNED:${why}`);

// A derivation that silently produced nothing would make every scan below green.
// Anchor it: these are values the two snapshots definitely contain.
const BANNED_ANCHORS = ["BAM GTA", "BAM San Jose", "Oakville", "San Jose", "byanymeanstoronto.ca", "Linbrook", "Group 1 (Elementary)"];

// ─────────────────────────────────────────────────────────────────────────────
// 2. MATCHING
// ─────────────────────────────────────────────────────────────────────────────
// Single-token values are matched RAW and CASE-SENSITIVELY, with word
// boundaries. That is what keeps "Means" (from "By Any Means") off the entirely
// innocent "unqualified means they cannot be a customer".
// Multiword values are matched against a NORMALISED copy of the body, where case
// and all punctuation collapse. That is what lets the snapshot's
// "Group 1 (Elementary)" match the prompt's "Group 1 (Elementary / younger)",
// and it is why a rename to "BAM  gta" cannot slip past.
const norm = (s) => " " + String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";

// An IANA timezone identifier is not an academy's identity, even though it
// contains a city. `DEFAULT_TZ = "America/Toronto"` in confirm-automations.js is
// a documented FALLBACK, the live value comes from clients.time_zone, and it is
// not even GTA's stored zone (its row says America/New_York). Scanning it as
// prose reports a correct fallback as a leak, so zone identifiers are blanked
// before matching. Only the IANA SHAPE is blanked: a body that says "Toronto"
// in a sentence is still caught.
const IANA = /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc|UTC)\/[A-Za-z_+-]+/g;
const deIana = (s) => String(s).replace(IANA, " ");

function bodyContains(raw, value) {
  const body = deIana(raw);
  if (/\s/.test(value)) return norm(body).includes(norm(value));
  if (/^[A-Za-z0-9]+$/.test(value)) return new RegExp("\\b" + value + "\\b").test(body);
  return body.includes(value);   // domains, emails, "$315.27"
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE ALLOWLIST
// ─────────────────────────────────────────────────────────────────────────────
// Two KINDS, and the difference between them is the point. Collapsing them into
// one "ignore this" list is how a deferred leak turns into an accepted one.
//
//   NOT_A_LEAK  the literal is shared craft. It stays. Nothing is owed.
//   DEFERRED    it IS one academy's identity, in a shared default, shipping to
//               everyone today. It is knowingly deferred because removing it
//               breaks something worse. Every DEFERRED entry must say what would
//               clear it, and the suite PRINTS them on every run, including a
//               green one, so a green run can never be read as "no leaks".
//
// STALENESS. After the scan, every entry must have matched at least one real
// body. An entry whose target no longer exists, or whose value is gone, FAILS
// the run rather than passing quietly. That is deliberate: when someone finally
// makes booking_group derivable, this file has to be updated in the same change,
// not left holding a permission for something that no longer happens.
const ALLOWLIST = [
  {
    id: "booking_group/gta-group-vocabulary",
    kind: "DEFERRED",
    value: "Group 1 (Elementary)",
    path: /SECTIONS\[key=booking_group\]\.body|assemblePrompt\(booking\)/,
    reason:
      "booking_group is BAM GTA's grouping wearing machinery's clothes. The body also states GTA's " +
      "age bands (ages 9 to 13, ages 14 and up) and ships to every academy. It is the ONE fact " +
      "section with no renderer: it is not in FACT_KEYS, so an academy filling in its offer can " +
      "never clear it. Emptying it is worse than leaving it, because 'Group 1'/'Group 2' are the " +
      "literal argument values of check_availability and book_group and the only prose that teaches " +
      "them, so an emptied body deletes routing while the same bands stay written into three tool " +
      "schemas in api/agent-approvals.js.",
    clears_when:
      "a per-calendar age band exists on the calendar row (or a class-to-calendar link), after which " +
      "this section renders from the academy's own groups and the tool schemas generate from the same " +
      "source. Tracked as a separate build. Until then this is a named gap, not a clean result.",
  },
  {
    id: "booking_group/gta-group-vocabulary-2",
    kind: "DEFERRED",
    value: "Group 2 (High School)",
    path: /SECTIONS\[key=booking_group\]\.body|assemblePrompt\(booking\)/,
    reason: "The second half of the same body. Same reasoning, same tracked build.",
    clears_when: "see booking_group/gta-group-vocabulary.",
  },
  ...["$315.27", "$279.00", "$36.27", "HST (13%)"].map((value, i) => ({
    id: `pricing_disclosure/receipt-${i + 1}`,
    kind: "NOT_A_LEAK",
    value,
    path: /PRICING_DISCLOSURE|pricingDisclosureBody|SECTIONS\[key=pricing_disclosure\]|assemblePrompt/,
    reason:
      "The RECEIPT constant, audited 2026-07-30 and left in place by decision. Its ROLE is to " +
      "demonstrate a SHAPE - three lines, total last - which is the entire point of the BREAKDOWN " +
      "axis, is academy-agnostic, and is not derivable from any academy's data because it is a " +
      "layout rather than a value. It is guarded by rules ADJACENT to it: ITEMIZE_RULES on the next " +
      "line forbids arithmetic and requires every line to come from the pricing section as written, " +
      "and an academy with no catalog renders PRICING_NOT_CONFIGURED, which says quote nothing. Two " +
      "independent instructions must fail before a number here is spoken. RESIDUAL RISK, stated " +
      "rather than waved off: the CONTENT is GTA's real row, and HST does not exist in California, " +
      "so a San Jose agent imitating the label rather than the layout would state a foreign tax " +
      "regime confidently. Nothing here tests what a live agent emits.",
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. ENUMERATING EVERY SHARED DEFAULT
// ─────────────────────────────────────────────────────────────────────────────
// Walked, never named. Anything exported and string-bearing is in scope at any
// depth, plus the bodies that are reachable without being exported, plus the
// real assembled artifacts.
function collectBodies(PS, CA) {
  const bodies = [];
  const push = (p, v) => { if (typeof v === "string" && v.trim()) bodies.push({ path: p, body: v }); };
  const walk = (v, p) => {
    if (typeof v === "string") return push(p, v);
    if (typeof v === "function") return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };

  // SECTIONS is walked by KEY rather than by index so a finding names the
  // section a human can go and look at, and so reordering does not churn paths.
  for (const s of PS.SECTIONS || []) {
    for (const k of Object.keys(s)) walk(s[k], `prompt-structure:SECTIONS[key=${s.key}].${k}`);
  }
  for (const k of Object.keys(PS)) {
    if (k === "SECTIONS" || typeof PS[k] === "function") continue;
    walk(PS[k], `prompt-structure:${k}`);
  }
  // The total_only disclosure table is NOT exported and is still shipped: it is
  // one line of AGENT_TEMPLATES away from being every academy's live body.
  for (const mode of Object.keys(PS.PRICING_DISCLOSURE || {})) {
    for (const breakdown of ["itemized", "total_only"]) {
      push(`prompt-structure:pricingDisclosureBody(${mode},${breakdown})`, PS.pricingDisclosureBody(mode, breakdown));
    }
  }
  // The real artifact: what an academy with nothing configured actually ships.
  for (const agent of ["booking", "confirm", "closing"]) {
    push(`prompt-structure:assemblePrompt(${agent})`, PS.assemblePrompt({}, agent));
  }

  for (const k of Object.keys(CA)) {
    if (typeof CA[k] === "function") continue;
    walk(CA[k], `confirm-automations:${k}`);
  }
  // The merged defaults an academy with no override row receives.
  walk(CA.getConfirmAutomations({}), "confirm-automations:getConfirmAutomations({})");
  walk(CA.getConfirmAutomations({ ghl_kpi_config: {} }), "confirm-automations:getConfirmAutomations(empty config)");

  return bodies;
}

// The rendered SMS, not the template. Render over grep is a standing rule here:
// a string can be absent from a template and still reach a parent through a
// fallback, and the message that actually sends is the only one worth scanning.
//
// The context deliberately belongs to NO real academy. Rendering with BAM San
// Jose's own row would put San Jose's address in the output and the scan would
// report the academy's own correct venue as a leak, which is noise, not a
// finding. With a venue nobody owns, every snapshot value that survives into
// the output can only have come from the shared default itself.
function collectRendered(CA) {
  const out = [];
  const nobody = {
    location: "500 Nowhere Loop, Placeholderton, ZZ 00000",
    entryNote: "Take the stairs to level two and turn right.",
    startMs: Date.UTC(2026, 7, 4, 2, 0),
    endMs: Date.UTC(2026, 7, 4, 3, 0),
    tz: "America/Los_Angeles",
  };
  for (const step of CA.DEFAULT_CONFIRM_AUTOMATIONS.steps || []) {
    out.push({ path: `confirm-automations:resolveApptTokens(${step.key}, unowned-venue)`, body: CA.resolveApptTokens(step.template, nobody) });
    // No context at all: every token resolves empty. This is the shape an
    // academy with nothing configured sends, and it is where a hardcoded
    // sentence stands out with nothing around it to hide behind.
    out.push({ path: `confirm-automations:resolveApptTokens(${step.key}, no-context)`, body: CA.resolveApptTokens(step.template, {}) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE STRUCTURAL DETECTORS
// ─────────────────────────────────────────────────────────────────────────────
// These are data-INDEPENDENT and exist to cover the academies no snapshot knows
// about. A shared default has no business carrying a way to contact or find one
// specific place, whoever that place belongs to.
const CONTACT_SHAPES = [
  [/https?:\/\/\S+/, "a URL"],
  [/\b[a-z0-9][a-z0-9-]*\.(?:com|ca|net|org|io|co|us|biz)\b/i, "a bare domain"],
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, "an email address"],
  [/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, "a phone number"],
];

// The one hand-maintained input in this file, and it is here for a specific
// reason: leak 4 (the door directions) contained NO identity value at all. It
// named no academy, no city and no link, so the data-derived half structurally
// could not see it, and it still told every academy's parents which side of a
// building in Oakville to walk to. Venue access is per-venue by definition, so a
// shared default may only reach it through a token. A sentence carrying one of
// these and no {{token}} is asserting a physical place it cannot know.
// This list rots. That is its known weakness, stated rather than hidden.
const VENUE_PROSE = [
  [/\bentrances?\b/i, "an entrance"],
  [/\bthe building\b/i, "the building"],
  [/\bparking lot\b/i, "a parking lot"],
  [/\bbuzzer\b/i, "a buzzer"],
  [/\bfront desk\b/i, "a front desk"],
  [/\b(?:side|back|double) doors?\b/i, "a specific door"],
  [/\bloading dock\b/i, "a loading dock"],
];

const sentences = (body) => String(body).split(/(?<=[.!?\n])\s+/).filter((s) => s.trim());

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE SUITE, AS A PURE FUNCTION OF THE LOADED MODULES
// ─────────────────────────────────────────────────────────────────────────────
// Written as a function so it can be run twice in one process: once against the
// pristine modules and once against the mutated ones. A control passes only on
// the DELTA, which is what stops a mutation from inheriting somebody else's red
// and calling itself caught.
function stripComments(src, blind) {
  if (blind) return "";   // MUTATE=blindstrip: the stripper eats everything
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Requires start-of-line or whitespace before //, so "https://x" survives.
    .split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
}

// Literals that exist in these two files ONLY inside comments, where they record
// what was removed and why it must never return. Each is asserted twice: present
// in the raw source (the warning still stands) and absent after stripping (the
// stripper works). Break either and the source sweep is not to be trusted.
const COMMENT_ONLY = [
  ["prompt-structure.js", "Linbrook"],
  ["prompt-structure.js", "Oakville"],
  ["prompt-structure.js", "share.google"],
  ["prompt-structure.js", "byanymeanstoronto.ca"],
  ["confirm-automations.js", "Linbrook"],
];

// The other half of the same guarantee, and the half that is easy to forget.
// COMMENT_ONLY above proves the stripper removes ENOUGH. On its own that is
// satisfied by a stripper that removes EVERYTHING, and a stripper that returns
// "" turns the whole source sweep into a check that can never fail. MUTATE=
// blindstrip is the control for it, and it caught precisely that hole here.
// These anchors are code and copy that must survive stripping.
const MUST_SURVIVE_STRIPPING = [
  ["prompt-structure.js", "export const SECTIONS"],
  ["prompt-structure.js", "export function assemblePrompt"],
  ["prompt-structure.js", "Pick the group by the athlete's age"],
  ["confirm-automations.js", "export const DEFAULT_CONFIRM_AUTOMATIONS"],
  ["confirm-automations.js", "{{appointment.entry_note}}"],
];

function runSuite({ PS, CA, srcPS, srcCA, blindStrip }) {
  const results = [];
  const ok = (cond, label) => { results.push({ ok: !!cond, label }); return !!cond; };

  // ── 1. the derivation itself ──────────────────────────────────────────────
  ok(BANNED.size >= 40, `the banned set derived ${BANNED.size} values from ${SNAPSHOTS.length} snapshots (an empty set makes every scan below meaningless)`);
  for (const anchor of BANNED_ANCHORS) {
    ok(BANNED.has(anchor), `derivation still produces "${anchor}" (a field rename in a snapshot must break this, not quietly narrow the check)`);
  }

  // ── 2. enumeration ────────────────────────────────────────────────────────
  const bodies = collectBodies(PS, CA).concat(collectRendered(CA));
  ok(bodies.length >= 60, `walked ${bodies.length} shared default bodies out of the two modules`);
  const paths = bodies.map((b) => b.path);
  for (const s of PS.SECTIONS || []) {
    if (!String(s.body || "").trim()) continue;   // an emptied body has nothing to walk
    ok(paths.includes(`prompt-structure:SECTIONS[key=${s.key}].body`), `enumeration reached SECTIONS[${s.key}].body without being told it exists`);
  }
  for (const step of CA.DEFAULT_CONFIRM_AUTOMATIONS.steps || []) {
    ok(paths.some((p) => p.startsWith("confirm-automations:getConfirmAutomations({})") && p.includes("template")),
      `enumeration reached the merged confirm automation templates (step "${step.key}" is in the walked set)`);
  }

  // ── 3. no default carries a real academy's identity ───────────────────────
  const used = new Set();
  const leaks = [];
  for (const { path: p, body } of bodies) {
    for (const [value, sources] of BANNED) {
      if (!bodyContains(body, value)) continue;
      const entry = ALLOWLIST.find((a) => a.value === value && a.path.test(p));
      if (entry) { used.add(entry.id); continue; }
      leaks.push({ p, value, sources });
    }
  }
  const byPath = new Map();
  for (const l of leaks) {
    if (!byPath.has(l.p)) byPath.set(l.p, []);
    byPath.get(l.p).push(`${JSON.stringify(l.value)} <- ${l.sources.join(", ")}`);
  }
  ok(leaks.length === 0,
    `no shared default carries an academy identity value${leaks.length ? "\n       " + [...byPath].map(([p, vs]) => `${p}\n         ${vs.join("\n         ")}`).join("\n       ") : ""}`);

  // ── 4. no default carries a way to contact or find one place ──────────────
  // Applied to the STATIC defaults only. A rendered body legitimately contains
  // the calendar links we build for the booked slot.
  const staticBodies = collectBodies(PS, CA);
  const handles = [];
  for (const { path: p, body } of staticBodies) {
    for (const [re, what] of CONTACT_SHAPES) {
      const m = body.match(re);
      if (m) handles.push(`${p}: ${what} (${JSON.stringify(m[0].slice(0, 60))})`);
    }
  }
  ok(handles.length === 0,
    `no shared default carries a URL, domain, email or phone number${handles.length ? "\n       " + handles.join("\n       ") : ""}`);

  // ── 5. no default describes a physical place outside a token ──────────────
  // STATIC bodies only, on purpose. In a template the token is still visible, so
  // "{{appointment.entry_note}}" is recognisably the venue's own fact. After
  // rendering, an academy's real entry note is indistinguishable from a
  // hardcoded one, and flagging it would punish exactly the fix this rule wants.
  const venue = [];
  for (const { path: p, body } of staticBodies) {
    for (const s of sentences(body)) {
      if (/\{\{[^}]+\}\}/.test(s)) continue;   // token-driven, so it is the venue's own fact
      for (const [re, what] of VENUE_PROSE) {
        if (re.test(s)) venue.push(`${p}: ${what} in ${JSON.stringify(s.trim().slice(0, 100))}`);
      }
    }
  }
  ok(venue.length === 0,
    `no shared default states venue access outside a token${venue.length ? "\n       " + venue.join("\n       ") : ""}`);

  // ── 6. the source sweep, with comments stripped, and the stripper checked ──
  for (const [name, src] of [["prompt-structure.js", srcPS], ["confirm-automations.js", srcCA]]) {
    const stripped = stripComments(src, blindStrip);
    const found = [];
    for (const [value] of BANNED) {
      if (!bodyContains(stripped, value)) continue;
      if (ALLOWLIST.some((a) => a.value === value)) continue;   // judged already, at body level
      found.push(JSON.stringify(value));
    }
    ok(found.length === 0, `no executable line in ${name} contains an academy identity value${found.length ? " (found: " + found.join(", ") + ")" : ""}`);
  }
  for (const [name, anchor] of MUST_SURVIVE_STRIPPING) {
    const src = name === "prompt-structure.js" ? srcPS : srcCA;
    ok(stripComments(src, blindStrip).includes(anchor),
      `${name}: ${JSON.stringify(anchor)} SURVIVES comment stripping. A stripper that eats too much cannot fail the sweep above, so it has to fail here instead`);
  }
  for (const [name, literal] of COMMENT_ONLY) {
    const src = name === "prompt-structure.js" ? srcPS : srcCA;
    ok(src.includes(literal), `${name} STILL records "${literal}" in a comment (the comment explaining why it must never return is the thing a future edit is most likely to delete along with the check)`);
    ok(!stripComments(src, blindStrip).includes(literal), `${name}: "${literal}" is gone once comments are stripped, which is what proves the stripper strips and the literal really is comment-only`);
  }

  // ── 7. the allowlist cannot go stale ──────────────────────────────────────
  for (const entry of ALLOWLIST) {
    ok(used.has(entry.id),
      `allowlist entry ${entry.id} still has a target: some body matching its path contains ${JSON.stringify(entry.value)}. ` +
      `An entry whose target is gone is a permission for something that no longer happens, so it FAILS rather than passing quietly`);
    if (entry.kind === "DEFERRED") ok(!!entry.clears_when, `DEFERRED entry ${entry.id} says what would clear it`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE NEGATIVE CONTROLS: MUTATING THE REAL SOURCE ON DISK
// ─────────────────────────────────────────────────────────────────────────────
let dirty = false;
const restore = () => {
  if (!dirty) return;
  fs.writeFileSync(SRC_PS, ORIGINAL_PS);
  fs.writeFileSync(SRC_CA, ORIGINAL_CA);
  dirty = false;
};
process.on("exit", restore);
process.on("SIGINT", () => { restore(); process.exit(130); });
process.on("SIGTERM", () => { restore(); process.exit(143); });
process.on("uncaughtException", (e) => { restore(); console.error(e); process.exit(1); });

const bail = (msg) => { console.log(`  ⚠️  MUTATE=${MUTATE}: ${msg} - the control is stale, fix the control rather than deleting it.`); restore(); process.exit(1); };

// Refill an emptied `"body": ""` by anchoring on its label and taking the NEXT
// empty body. Anchoring this way is what makes the edit land on the body the
// module actually exports. Inserting a second "body" key instead would change
// the file and nothing else, because JS keeps the LAST duplicate.
function refill(src, label, body) {
  const at = src.indexOf(`"label": "${label}",`);
  if (at < 0) bail(`no section labelled "${label}"`);
  const b = src.indexOf(`"body": ""`, at);
  if (b < 0) bail(`the "${label}" entry has no empty body to refill`);
  return src.slice(0, b) + `"body": ${JSON.stringify(body)}` + src.slice(b + `"body": ""`.length);
}
function replaceOnce(src, needle, replacement, what) {
  const i = src.indexOf(needle);
  if (i < 0) bail(`${what}: anchor ${JSON.stringify(needle.slice(0, 60))} not found`);
  if (src.indexOf(needle, i + 1) >= 0) bail(`${what}: anchor ${JSON.stringify(needle.slice(0, 60))} is not unique`);
  return src.slice(0, i) + replacement + src.slice(i + needle.length);
}

// Each control: which file it edits, the edit, and the string that MUST appear
// in the exported value afterwards. The last part is the duplicate-key guard.
const REPLANT = {
  review: {
    file: "ps",
    edit: (s) => refill(s, "Social proof", "Google Reviews: https://share.google/yel2SPxIMKzjsJG9c"),
    landed: (PS) => (PS.SECTIONS.find((x) => x.key === "social_proof")?.body || "").includes("share.google"),
  },
  reviewnow: {
    file: "ps",
    edit: (s) => refill(s, "Social proof", "Google Reviews: https://g.page/r/CfuIFvZGkfmaEBM/review"),
    landed: (PS) => (PS.SECTIONS.find((x) => x.key === "social_proof")?.body || "").includes("g.page"),
  },
  address: {
    file: "ps",
    edit: (s) => refill(s, "Business info",
      "Name: By Any Means Basketball (BAM GTA)\nLocation: 1079 Linbrook Rd, Oakville, ON L6J 2L2\n" +
      "Directions: The doors are on the front of the building to the left.\n" +
      "Trial booking link: byanymeanstoronto.ca/free-trial"),
    landed: (PS) => (PS.SECTIONS.find((x) => x.key === "business_info")?.body || "").includes("Linbrook"),
  },
  oakville: {
    file: "ps",
    edit: (s) => refill(s, "Who qualifies", "Qualify leads on these dimensions:\n- Location proximity: Are they in or near Oakville/GTA?"),
    landed: (PS) => (PS.SECTIONS.find((x) => x.key === "qualification_config")?.body || "").includes("Oakville"),
  },
  coach: {
    file: "ps",
    edit: (s) => refill(s, "Coaches", "All coaches are certified by By Any Means and have played at the college or professional level."),
    landed: (PS) => (PS.SECTIONS.find((x) => x.key === "coaches")?.body || "").includes("By Any Means"),
  },
  // Leak 3's SHAPE: an academy's name signed onto a shared body. The real one
  // was a nurture email footer, in a file this suite does not read; re-planted
  // here on the money path, in the file it does.
  footer: {
    file: "ca",
    edit: (s) => replaceOnce(s,
      `"Google: {{appointment.add_to_google_calendar}}",`,
      `"Google: {{appointment.add_to_google_calendar}}\\n\\n" +\n"- The BAM GTA team",`,
      "footer"),
    landed: (CA) => (CA.DEFAULT_CONFIRM_AUTOMATIONS.steps.find((x) => x.key === "confirm")?.template || "").includes("BAM GTA"),
  },
  // Leak 4, exactly as it shipped, put back where it lived: the same-day SMS,
  // in place of the token that replaced it.
  door: {
    file: "ca",
    edit: (s) => replaceOnce(s,
      `"{{appointment.entry_note}}",`,
      `"F.Y.I the gym entrance we use is at the front of the building, on the left side.",`,
      "door"),
    landed: (CA) => (CA.DEFAULT_CONFIRM_AUTOMATIONS.steps.find((x) => x.key === "same_day")?.template || "").includes("gym entrance"),
  },
  // Not a leak: the allowlist's own guard. Emptying booking_group leaves its two
  // DEFERRED entries with nothing to except, and a stale entry must break the run.
  stale: {
    file: "ps",
    edit: (s) => {
      const at = s.indexOf(`"label": "Booking - which group / calendar",`);
      if (at < 0) bail("no booking_group section");
      const b = s.indexOf(`"body": "Pick the group by the athlete's age`, at);
      if (b < 0) bail("booking_group's body no longer matches the anchor");
      const end = s.indexOf(`"\n  }`, b);
      if (end < 0) bail("could not find the end of booking_group's body");
      return s.slice(0, b) + `"body": ""` + s.slice(end + 1);
    },
    landed: (PS) => String(PS.SECTIONS.find((x) => x.key === "booking_group")?.body || "").trim() === "",
  },
  // In-process, not on disk: the comment stripper eats the whole file.
  blindstrip: { inProcess: true },
};

async function loadMutated() {
  const plan = REPLANT[MUTATE];
  if (!plan) { console.error(`unknown MUTATE=${MUTATE}. Known: ${Object.keys(REPLANT).join(", ")}`); process.exit(1); }
  if (plan.inProcess) return { PS: REAL_PS, CA: REAL_CA, srcPS: ORIGINAL_PS, srcCA: ORIGINAL_CA, blindStrip: true };

  const bust = "?mutate=" + Date.now();
  let PS = REAL_PS, CA = REAL_CA, srcPS = ORIGINAL_PS, srcCA = ORIGINAL_CA;
  if (plan.file === "ps") {
    srcPS = plan.edit(ORIGINAL_PS);
    fs.writeFileSync(SRC_PS, srcPS); dirty = true;
    PS = await import(pathToFileURL(SRC_PS).href + bust);
    if (!plan.landed(PS)) bail("the edit changed the file but NOT the exported value (the duplicate-key trap). A control that does not move the export proves nothing");
  } else {
    srcCA = plan.edit(ORIGINAL_CA);
    fs.writeFileSync(SRC_CA, srcCA); dirty = true;
    CA = await import(pathToFileURL(SRC_CA).href + bust);
    if (!plan.landed(CA)) bail("the edit changed the file but NOT the exported value (the duplicate-key trap). A control that does not move the export proves nothing");
  }
  return { PS, CA, srcPS, srcCA, blindStrip: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. RUN
// ─────────────────────────────────────────────────────────────────────────────
const PRISTINE = { PS: REAL_PS, CA: REAL_CA, srcPS: ORIGINAL_PS, srcCA: ORIGINAL_CA, blindStrip: false };
const baseline = runSuite(PRISTINE);
const baselineRed = new Set(baseline.filter((r) => !r.ok).map((r) => r.label));

const shown = MUTATE ? runSuite(await loadMutated()) : baseline;
restore();

for (const r of shown) console.log((r.ok ? "  ✅ " : "  ❌ ") + r.label);

console.log("\n── knowingly deferred, printed on every run including a green one ──");
for (const e of ALLOWLIST.filter((a) => a.kind === "DEFERRED")) {
  console.log(`  ⚠️  ${e.id}: ${JSON.stringify(e.value)} ships to every academy.\n      why it stays: ${e.reason}\n      clears when: ${e.clears_when}`);
}

const fail = shown.filter((r) => !r.ok).length;
const pass = shown.length - fail;

if (MUTATE) {
  const nw = shown.filter((r) => !r.ok && !baselineRed.has(r.label));
  const caught = nw.length > 0;
  console.log("");
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} produced ${nw.length} failure(s) the pristine run did not have:\n   - ${nw.slice(0, 3).map((r) => r.label.split("\n")[0]).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and added no new failure. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}

console.log("");
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
