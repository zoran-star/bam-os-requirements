// Branded email shell for portal-native automation emails. An automation EMAIL step
// carries ONLY the message text; the send layer (api/_send.js) wraps it in the
// academy's shell so every email is on-brand. Email clients strip external CSS and
// custom fonts, so the shell is table-based with FULLY INLINED styles, SOLID hex
// colors, and web-safe font fallbacks.
//
// Design source (Claude Design): bam-client-sites/emails/gta-shell.html. This is the
// portal copy: the fixed FRAME (header + footer) with a {{CONTENT}} slot, tokenized
// so every BAM location reuses the same design with its own name / site / handle.
// Brand: gold #E2DD9F, black #000000 / surface #0A0A0A, Anton (display) + Inter Tight.

import { FRAME, FOOTER_REASON, stripUnsubscribe } from "./email-templates/_shell.js";
import { TEMPLATES as NURTURE_TEMPLATES } from "./email-templates/nurture-emails.js";
import { ONBOARDING_TEMPLATES } from "./email-templates/onboarding-emails.js";

// All vendored designed emails, addressable by `template:<key>` from an
// automation_steps body: lead-nurture sequence + onboarding welcome sequence.
const TEMPLATES = { ...NURTURE_TEMPLATES, ...ONBOARDING_TEMPLATES };

// FRAME (the shell markup with its {{CONTENT}} slot) now lives in
// ./email-templates/_shell.js so the designed templates in that folder ride the SAME
// markup instead of each keeping a copy of the header/footer.

// THERE IS NO PER-ACADEMY MAP HERE ANY MORE, AND ADDING ONE BACK IS THE REGRESSION.
//
// Until 29 Jul 2026 this file carried a LOCATIONS object keyed by client id with
// exactly one entry, BAM GTA's, pinning its email identity. It was the last
// academy-specific literal in the email layer, and it shrank one field at a time:
// `email` became clients.business_email (migration 20260729T210000), `tagline` and
// `instagram` became clients.tagline / clients.instagram_url (20260729T230000), and
// the last four went the same way (20260729T235000) - not by growing four more
// columns, but because all four traced to ONE cause:
//
//   suffix       the gold wordmark word, derived by stripping "By Any Means" / "BAM "
//                off public_name. GTA's public_name was the bare brand "By Any Means
//                Basketball", so the derived word was BASKETBALL and the pin said GTA.
//   full         the parent-facing name. Also public_name. Pin said "By Any Means
//                Toronto"; the row said "By Any Means Basketball".
//   locationTag  the small line beside the wordmark, derived as the uppercased city.
//                Pin said "OAKVILLE &middot; GTA", hand-composed.
//   city         cityFromAddress() found none in the stored "2205 Rosemount Cres".
//
// suffix and full BOTH come from public_name, so keeping the old look exactly (a "GTA"
// wordmark AND a "By Any Means Toronto" full name) needed a pinned suffix - a
// per-academy override, which is this map again wearing a database column. Zoran's
// ruling: ONE field drives everything, no overrides. public_name is now "By Any Means
// Toronto", the wordmark reads TORONTO, the tag reads OAKVILLE, and the address carries
// its city. He accepted that visible cost; it is the price of no academy branch.
//
// So EVERY academy's identity is now derived from its own clients row by locFromVars()
// below, and identity fields fail to EMPTY - never to another academy's values. (The
// `|| LOCATIONS[GTA_ID]` fallback that predated even the one-entry map leaked GTA's
// site and owner into every unwired academy's sends: San Jose would have texted
// "byanymeanstoronto.ca" and signed "coach Zoran", 2026-07-25.)
//
// ⛔ DO NOT REINTRODUCE A PER-CLIENT-ID BRANCH HERE, in any spelling - a map, a
// switch, a `if (clientId === ...)`, a JSON file keyed by id. The whole point is that
// there is nowhere left for one academy's facts to hide from the rest.
// api/_email-identity-from-the-row.test.mjs fails if one appears, by rendering under
// GTA's real client id with an empty row and checking that NOTHING of GTA's comes out.
//
// The two OPTIONAL content facts that used to live in GTA's entry (the welcome email's
// "online programs" item and its "bring a friend" referral offer) are
// clients.online_programs_url and clients.referral_offer (migration 20260727150000,
// applied). They resolve through clientVars() like everything else, and an academy
// with neither simply sends a shorter email - no academy branch anywhere.

// Build a location config from runtime vars (see clientVars below). Everything
// unknown is EMPTY: the shell drops empty links/lines instead of borrowing
// another academy's identity.
function locFromVars(vars = {}) {
  const name = String(vars.location_name || "");
  const site = String(vars.location_website || "");
  // "BAM San Jose" / "By Any Means San Jose" -> gold wordmark suffix "SAN JOSE";
  // a name without the brand prefix keeps the plain "BY ANY MEANS" wordmark.
  //
  // THE WORDMARK AND THE FULL NAME ARE ONE FIELD, and that is a decision rather than a
  // limitation (29 Jul 2026, Zoran). An academy that wants a different word in gold
  // changes its public_name; there is no second field to disagree with the first. This
  // is what BAM GTA's pinned "GTA" suffix used to buy at the price of an academy
  // branch, and it is why its wordmark now reads TORONTO.
  const stripped = name.replace(/^\s*(?:by\s+any\s+means|bam)\s+/i, "");
  return {
    suffix: stripped !== name ? stripped.toUpperCase() : "",
    // The small line beside the wordmark: just the academy's own city, uppercased.
    // GTA's pin composed "OAKVILLE &middot; GTA" by hand; nothing on any row produces a
    // composite like that, so the derived form is what every academy including GTA now
    // renders. A row with no parseable city renders no tag at all.
    locationTag: vars.location_city ? String(vars.location_city).toUpperCase() : "",
    full: name,
    // The academy's own sentence under the wordmark, and its own Instagram. Both
    // hardcoded to "" until 29 Jul 2026, which is why they rendered for BAM GTA (the
    // one academy that had a pinned entry) and for nobody else. Now
    // clients.tagline / clients.instagram_url, migration 20260729T230000.
    //
    // ⚠️ A client row read before that migration is applied simply has no such
    // property, which reads as absent and renders as nothing: no tagline sentence, and
    // dropEmptyShellLinks removes the empty Instagram anchor with its separator rather
    // than shipping a link to nowhere. Nothing throws, nothing is borrowed - the
    // footer is two elements shorter. That state is QUIET, so it is written up in the
    // migration's "BEFORE YOU DEPLOY": the two columns must also join the loadClient
    // select lists in api/automations.js and api/agent-confirm.js once it is live, or
    // GTA keeps rendering without them.
    tagline: String(vars.location_tagline || ""),
    siteUrl: site,
    siteLabel: site.replace(/^https?:\/\//i, ""),
    email: String(vars.location_email || ""),
    instagram: String(vars.location_instagram_url || ""),
    city: String(vars.location_city || ""),
    ownerFirst: String(vars.location_owner || ""),
    // Optional content facts. Absent (no column yet, or a NULL) means EMPTY, and the
    // blocks that depend on them do not render at all. See onboarding-emails.js.
    onlineProgramsUrl: String(vars.online_programs_url || ""),
    referralOffer: normalizeReferral(vars.referral_offer),
    // Link facts. These never had any home but the academy's own row - not even back
    // when GTA had a pinned entry - so no academy can inherit another's group invite
    // or review link. Every field here is now on those terms.
    communityUrl: String(vars.location_community_url || ""),
    communityPlatform: String(vars.location_community_platform || ""),
    reviewUrl: String(vars.location_review_url || ""),
    // The academy's own Stripe billing portal, where a MEMBER manages the membership
    // they are paying for (clients.stripe_portal_url). Same terms as every other link
    // fact: empty means the welcome email's manage-membership sentence does not render
    // at all, and no academy can ever inherit another academy's billing portal - which
    // would send one academy's parents to a page listing somebody else's subscriptions.
    portalUrl: String(vars.location_portal_url || ""),
    // Member-facing facts. `phone` comes off the client row; `venue` and `schedule`
    // do NOT - they are separate tables, so a caller with database access fills
    // them in (see academyFacts in api/_academy-facts.js) exactly the way the
    // worker already fills next_session. A caller without them renders an email
    // with those blocks absent, which is correct: an academy that has entered no
    // sessions has no schedule to send.
    phone: String(vars.location_phone || ""),
    venue: String(vars.location_venue || ""),
    schedule: Array.isArray(vars.location_schedule) ? vars.location_schedule : [],
    // [{ name, instagram }] for the coaches an academy wants members to follow.
    // Empty means the "follow along" line does not render, which is the right
    // outcome: naming nobody is worse than not asking.
    coaches: Array.isArray(vars.location_coaches) ? vars.location_coaches : [],
    testimonials: Array.isArray(vars.location_testimonials) ? vars.location_testimonials : [],
  };
}

// A referral offer is {lead, body, merchUrl?} - the bold lead-in of the list item, the
// perk itself, and optionally the merch shop it mentions. Stored snake_case (jsonb),
// used camelCase. Anything missing lead or body is treated as no offer at all: a half
// a sentence is worse than no line.
function normalizeReferral(raw) {
  const r = raw && typeof raw === "object" ? raw : null;
  if (!r) return null;
  const lead = String(r.lead || "").trim();
  const body = String(r.body || "").trim();
  if (!lead || !body) return null;
  return { lead, body, merchUrl: String(r.merch_url || r.merchUrl || "").trim() };
}

// An academy's location config: entirely its own row, for every academy, with no
// exceptions and nowhere to put one.
//
// `clientId` IS STILL A PARAMETER AND IS DELIBERATELY NOT READ. That is not an
// oversight to tidy up - it is the guarantee, in a shape that can be tested. Callers
// pass the id (they all have it), and the fact that passing GTA's real id changes
// nothing about the result is exactly what "the pin is gone" means. Keeping the
// parameter is what lets api/_email-identity-from-the-row.test.mjs render under GTA's
// own client id against an empty row and assert that nothing of GTA's comes back; drop
// the parameter and that assertion becomes unexpressible.
//
// If you find yourself wanting to read it, read the ⛔ block at the top of this file
// first. A per-client-id lookup here is the one thing this whole change removed.
export function locFor(clientId, vars) {
  void clientId;
  return locFromVars(vars);
}

// The runtime identity vars for a clients row - the academy facts the resolver
// trusts. Callers that have the client row loaded (the automations worker, the
// confirm agent, previews) spread this into `vars` so every send renders the
// academy's OWN name / site / owner, or nothing at all.
export function clientVars(client) {
  const c = client || {};
  const domain = c.website_setup && c.website_setup.domain;
  return {
    // The name PARENTS see. `business_name` is the INTERNAL label ("BAM GTA"),
    // which is what this used to render - so parents read our own shorthand back
    // in their messages. `public_name` is the parent-facing one ("By Any Means
    // Toronto"); falling back to business_name keeps every academy that has not
    // filled it in rendering exactly what it rendered before.
    location_name: c.public_name || c.business_name || "",
    location_website: domain ? `https://${domain}` : "",
    // The SAME website with no protocol on the front ("byanymeanstoronto.ca"), for
    // copy that names the site rather than linking it. An SMS that reads
    // "https://byanymeanstoronto.ca" on its own line looks like a machine wrote it;
    // the bare domain is what a person types. Without this token that line had to
    // stay a hardcoded literal, which is the one thing keeping the row academy-specific.
    location_domain: domain || "",
    location_owner: c.owner_name ? String(c.owner_name).trim().split(/\s+/)[0] : "",
    // The email a PARENT sees, replies to and unsubscribes through. This used to read
    // `c.email`, which is the OWNER's address - so every academy published the person
    // WE contact as the address parents contact, and pointed the unsubscribe mailto at
    // it. BAM GTA's is zoran@byanymeansbball.com, a personal inbox; DETAIL Miami's and
    // Johnson Bball's are both Mike's. GTA only looked right because of the pinned
    // entry this file used to carry, which no other academy had.
    //
    // NO FALLBACK TO c.email. Not "for now", not "until academies fill it in". Falling
    // back is the bug, and it also hides the bug: a field that renders something reads
    // as configured. Empty here drops the footer contact line and the footer Email
    // link, and the send path HOLDS the email rather than shipping one with no
    // unsubscribe path (see unsubscribeFor below and api/_send.js).
    location_email: c.business_email || "",
    location_city: cityFromAddress(c.address),
    // The number a MEMBER reaches the coaches on. Not the same thing as
    // clients.address, which is the business address and not the gym - the venue
    // is a separate fact entirely (see academyFacts). Empty means the line that
    // carries it does not render.
    location_phone: c.phone || "",
    // Optional content facts (migration 20260727150000, not applied yet). A client row
    // read before that migration simply has no such property, which reads as absent -
    // the dependent blocks do not render and nothing throws.
    online_programs_url: c.online_programs_url || "",
    referral_offer: c.referral_offer || null,
    // Community group + review link. Both are LINK facts: empty means the line
    // or button that carries them disappears (see dropEmptyLinkMentions /
    // dropEmptyShellLinks), never renders dead.
    location_community_url: c.community_group_url || "",
    location_community_platform: communityPlatformLabel(c.community_group_platform),
    location_review_url: c.google_review_url || "",
    // The academy's Stripe billing portal (clients.stripe_portal_url, migration
    // 20260731T090000, applied BEFORE this code merged). It is named by all three main
    // select lists - CLIENT_COLS in api/automations.js and api/agent-confirm.js,
    // SENDER_COLS in api/_send.js - because a column read here and selected by nobody
    // arrives undefined and renders as nothing, silently, which is the 29 Jul 2026
    // regression. api/_email-select-coverage.test.mjs fails naming any list that
    // forgets it.
    //
    // Every academy's value is NULL today, and that is a real state rather than a gap
    // to fill in with something: no portal on file means the welcome email's
    // manage-membership sentence does not render at all. NO FALLBACK, for a sharper
    // reason than the other link facts here - a borrowed billing portal shows a parent
    // somebody else's subscriptions.
    location_portal_url: c.stripe_portal_url || "",
    // The footer's two identity facts (migration 20260729T230000, not applied yet).
    // Absent on a row read before it lands, which reads as "this academy has no
    // tagline / no Instagram" - the honest answer, and the same shape
    // online_programs_url had before its own migration. NO fallback of any kind: an
    // academy publishing another academy's Instagram is worse than publishing none.
    location_tagline: c.tagline || "",
    location_instagram_url: c.instagram_url || "",
  };
}

// The platform key -> the word that names the group in copy ("Join the WhatsApp
// group"). Stored normalized, rendered here, so the display wording lives in
// code and one academy's label can never be another's. An unknown or missing
// platform renders NOTHING rather than guessing, which leaves the surrounding
// copy reading "Join the group" - still correct, still not a placeholder.
const COMMUNITY_PLATFORMS = {
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  discord: "Discord",
  telegram: "Telegram",
};
function communityPlatformLabel(key) {
  return COMMUNITY_PLATFORMS[String(key || "").toLowerCase()] || "";
}

// Best-effort city from a street address ("1051 W San Fernando St, San Jose, CA
// 95126" -> "San Jose"). Second-to-last comma part, rejected if it carries a
// digit (street lines / postal codes). Empty when unsure - an empty city just
// drops its token, which beats a wrong one.
function cityFromAddress(address) {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const cand = parts[parts.length - 2];
  return /\d/.test(cand) ? "" : cand;
}

// A week's training, as plain text, for the SMS form of the schedule:
//
//   MONDAYS
//   Group 1 (Elementary): 7-8pm
//   Group 2 (High School): 8-9pm
//
// The value is the SAME structured week the welcome email builds its table from
// ([{ day, groups: [{ name, time }] }]), so the text a member is texted and the
// table a member is emailed can never disagree. Nothing on file renders "", which
// leaves the step with no schedule in it - and that step seeds OFF until an academy
// has entered its sessions, so nothing empty ever sends.
// The venue rides ALONG with the schedule here rather than being its own line in the
// message body, and that is the fix for a half-state that would otherwise ship: an
// academy with a gym but no sessions entered yet (San Jose, today) would have texted
// its members "LOCATION: 1051 W San Fernando St" and nothing else, five minutes after
// they paid. The all-empty case was handled and the half was not. This message IS the
// schedule; with no schedule there is nothing to say, so the venue goes with it and
// the whole body resolves to "" and is never sent.
//
// The same guards the email's table applies (skip a day with no groups, skip a group
// missing its name or time) are applied here too, so the texted week and the emailed
// week cannot disagree. They are unreachable through weeklySchedule, which already
// filters both - they are here so the claim stays true if anything else ever builds
// this value.
// The quote blocks for the testimonials email, built from THE resolver's rows.
// One fact, one presentation, never a second copy of the quotes in markup.
//
// Follows the same rule as everywhere else the store renders: a typed quote is
// PLAIN. No stars, no "Google review" label, no date - those belong to synced
// Google rows only, and manual rows do not even carry the fields. The email
// design's gold left-bar is preserved from the hand-built version so nothing
// about the look changes; only where the words come from.
//
// Empty list returns "", which makes "{{location.testimonials}}" a bare empty
// token, which drops its own line AND the dangling lead-in above it via
// DROP_WHEN_EMPTY - the same mechanism that stops "SCHEDULE:" shipping with
// nothing under it.
export function testimonialsHtml(list) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return "";
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return rows.map((t) => {
    const quote = esc(t.quote).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, " ");
    // Attribution is the author alone for a typed quote. A google row may name
    // its source, because that one IS verifiable.
    const who = t.source === "google"
      ? `${esc(t.author || "Parent")} &middot; Google review`
      : esc(t.author || "Parent");
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #E2DD9F;margin:0 0 18px;"><tr><td style="padding:2px 0 2px 18px;">\n' +
      `          <p style="margin:0 0 8px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;font-style:italic;">"${quote}"</p>\n` +
      `          <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#777777;font-weight:600;">${who}</p>\n` +
      "        </td></tr></table>";
  }).join("\n        ");
}

export function scheduleText(week, venue) {
  const days = (Array.isArray(week) ? week : [])
    .map((d) => ({ day: String((d && d.day) || "").trim(), groups: ((d && d.groups) || []).filter((g) => g && g.name && g.time) }))
    .filter((d) => d.day && d.groups.length);
  if (!days.length) return "";
  const out = days
    .map((d) => [d.day.toUpperCase(), ...d.groups.map((g) => `${g.name}: ${g.time}`)].join("\n"))
    .join("\n\n");
  const where = String(venue || "").trim();
  return where ? `${out}\n\nLOCATION: ${where}` : out;
}

// Resolve GHL-style merge tokens (the ones our imported emails carry) to real values:
// location tokens from the academy config, contact tokens from `vars` (with friendly
// fallbacks so a missing name never sends as a raw {{token}}). Tolerates spaces inside
// the braces. Only touches these known tokens - the shell placeholders (UPPERCASE) are
// left for the caller to fill.
// Remove every reference to a LINK we do not have, at the SMALLEST unit that
// still reads correctly - so an academy missing a link sends a shorter message,
// never a broken one and never an empty one.
//
//   line that is a BARE LINK ("{{location.website}}/free-trial")
//       -> drop the line, plus a lead-in line above it ending in ":"
//          ("feel free to book in using this link:" must not dangle).
//   link INSIDE a sentence ("Here's the calendar: {{location.website}}/x")
//       -> drop only that SENTENCE, keep the rest of the line.
//
// Why sentence-level (2026-07-26): dropping the whole line took the message with
// it. missed_trial is a single line, so a domain-less academy rendered "" - and
// an empty body reached the SMS provider, got rejected, and burned all 3 retry
// attempts silently. Ghosted step 2 lost its entire value proposition the same
// way. Sentence-level keeps both messages intact and sending.
//
// Generalized 2026-07-27 from website-only to EVERY link fact an academy may not
// have yet: the website, the community group invite, and the Google review link.
// One rule for all of them - no fact, no output.
// `location.domain` is the bare-domain form of location.website and belongs here for
// the same reason: no domain on file means the academy has no site to name, so the
// mention goes rather than rendering a naked "" where a web address should be.
// `location.portal_link` joined on 31 Jul 2026 for the same reason as the review link:
// it is a per-academy URL that most academies do not have on file yet, so its mention
// has to leave with it.
const LINK_TOKENS = ["location.website", "location.domain", "location.community_link", "location.review_link", "location.portal_link"];

// The same rule, widened past links: any fact whose absence must take its mention
// with it. The schedule and the venue joined on 28 Jul 2026 when the schedule SMS
// stopped being hand-typed. Without them here, an academy with no sessions on file
// texts its members "SCHEDULE:" followed by nothing, which is worse than the silence
// it replaced - and it would not be caught by the empty-body guard in api/_send.js,
// because "SCHEDULE:" and "LOCATION:" are not nothing.
//
// The existing shapes do the work unchanged: "{{location.schedule}}" alone on its line
// is a BARE mention, so it goes and takes the dangling "SCHEDULE:" lead-in above it;
// "LOCATION: {{location.venue}}" is a mention inside prose, so that sentence goes. An
// academy with neither sends nothing at all, which _send.js then declines to send.
const DROP_WHEN_EMPTY = [...LINK_TOKENS, "location.schedule", "location.venue", "location.testimonials"];
const tokenRe = (name, flags) => new RegExp("\\{\\{\\s*" + name.replace(/\./g, "\\.") + "\\s*\\}\\}", flags);
function dropEmptyLinkMentions(text, emptyTokens) {
  if (!emptyTokens.length) return String(text);
  const EMPTY = new RegExp(emptyTokens.map((t) => tokenRe(t).source).join("|"));
  const BARE = new RegExp("^\\s*\\S*(?:" + emptyTokens.map((t) => tokenRe(t).source).join("|") + ")\\S*\\s*$");
  const lines = String(text).split("\n");
  const out = [];
  for (const line of lines) {
    if (!EMPTY.test(line)) { out.push(line); continue; }
    // A bare link line: the whole line is the token plus its path, no prose.
    const bareLink = BARE.test(line);
    let kept = "";
    if (!bareLink) {
      kept = line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !EMPTY.test(sentence))
        .join(" ")
        .trim();
    }
    if (kept) { out.push(kept); continue; }
    // Nothing survives on this line: drop it, and drop a dangling lead-in
    // ("Here's the link:") immediately above it.
    let j = out.length - 1;
    while (j >= 0 && !out[j].trim()) j--;
    if (j >= 0 && /:\s*$/.test(out[j])) out.splice(j, out.length - j);
  }
  return out.join("\n");
}

export function resolveMergeVars(html, L, vars = {}) {
  // Athlete first name for casual copy ("Hey Jordan!"). Prefer an explicit
  // athlete_first; else take the first token of the resolved athlete full name.
  const _athFirst = vars.athlete_first || (vars.athlete ? String(vars.athlete).trim().split(/\s+/)[0] : "");
  const map = {
    "contact.first_name": vars.first_name || "there",
    "contact.fullName": vars.full_name || vars.first_name || "there",
    "contact.full_name": vars.full_name || vars.first_name || "there",
    "contact.name": vars.full_name || vars.first_name || "there",
    "contact.athletes_full_name": vars.athlete || "your athlete",
    "contact.athlete_full_name": vars.athlete || "your athlete",
    "contact.athlete_first_name": _athFirst || "your athlete",
    "contact.athletes_first_name": _athFirst || "your athlete",
    // vars first, then L - and since 29 Jul 2026 the two can no longer disagree: L is
    // derived from these same vars (locFromVars) for EVERY academy, with no per-client
    // map left to override them. Identity can only ever be the academy's own values, or
    // EMPTY. Never another academy's.
    "location.city": vars.location_city || L.city || "",
    "location.name": vars.location_name || L.full || "",
    "location.website": vars.location_website || L.siteUrl || "",
    // Bare domain, no protocol. Falls back to L.siteLabel, which is already the
    // stripped form of the same site, so the two tokens can never name different
    // places - they are one fact rendered two ways.
    "location.domain": vars.location_domain || L.siteLabel || "",
    // Community group: the LINK gates the line, the PLATFORM only names it.
    // Copy reads "Join the {{location.community_platform}} group:
    // {{location.community_link}}" - with no platform on file that renders
    // "Join the group", and with no link the whole line goes.
    "location.community_link": vars.location_community_url || L.communityUrl || "",
    "location.community_platform": vars.location_community_platform || L.communityPlatform || "",
    // Review ask. No link on file means the CTA is removed outright, in plain
    // text here and as a button by dropEmptyShellLinks.
    "location.review_link": vars.location_review_url || L.reviewUrl || "",
    // Self-serve billing. The designed welcome email gates its own sentence on the fact
    // (see onboarding-emails.js); this token is the SAME fact for a plain-text step body,
    // and it is in DROP_WHEN_EMPTY below so an academy with no portal on file drops the
    // mention rather than texting a member a bare "" where a link should be.
    "location.portal_link": vars.location_portal_url || L.portalUrl || "",
    "location_owner.first_name": vars.location_owner || L.ownerFirst || "",
    // Member-facing facts, for the welcome sequence. The schedule renders as plain
    // lines here (the SMS form); the welcome EMAIL builds a table from the same
    // structured value off L. One fact, two presentations, never two sources.
    "location.phone": vars.location_phone || L.phone || "",
    "location.venue": vars.location_venue || L.venue || "",
    "location.schedule": scheduleText(vars.location_schedule || L.schedule, vars.location_venue || L.venue),
    // The academy's own approved quotes. EMPTY when it has none, which drops the
    // block and its lead-in rather than shipping a quote-shaped hole.
    "location.testimonials": testimonialsHtml(vars.location_testimonials || L.testimonials),
    // Filled at send time by the worker (e.g. "Our next session is Tue 6pm. ").
    // Empty string when no slot is known so the sentence just drops out.
    "next_session": vars.next_session || "",
  };
  let out = html;
  // A blank link token must not leave a link pointing at nothing, but it must
  // ALSO not silently delete the message around it. Runs before substitution, on
  // plain-text bodies only (a full HTML document is skipped - its links are
  // shell placeholders, handled by dropEmptyShellLinks).
  if (!/^\s*<(?:!doctype|html)/i.test(out)) {
    const missing = DROP_WHEN_EMPTY.filter((t) => !map[t]);
    out = dropEmptyLinkMentions(out, missing);
    // Tidy the hole a dropped block leaves: a message that lost its opening lines
    // must not start on a blank one, and two dropped blocks must not leave a gap
    // three lines wide. Guarded on something ACTUALLY being missing, so a message
    // with every fact on file is passed through untouched and this can never
    // reformat copy that was fine.
    if (missing.length) out = out.replace(/^\s*\n/, "").replace(/\n{3,}/g, "\n\n");
  }
  for (const [k, val] of Object.entries(map)) {
    const token = "\\{\\{\\s*" + k.replace(/\./g, "\\.") + "\\s*\\}\\}";
    if (val) out = out.replace(new RegExp(token, "g"), val);
    // Empty token: swallow one leading space with it ("coach {{location_owner.
    // first_name}} from" -> "coach from") so no double space is left behind.
    else out = out.replace(new RegExp("[^\\S\\n]?" + token, "g"), "");
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

// Dark-mode LOCK. Email clients (Gmail's mobile app especially) auto-"dark mode" a
// message and can INVERT a dark design into a broken light one. This forces our
// palette to hold: a color-scheme signal, [bgcolor] attribute selectors that pin our
// dark surfaces + the gold button, and small classes (added by color) that restore the
// text Gmail darkens (Gmail tags recolored nodes with data-ogsc / data-ogsb). Idempotent.
const DARK_LOCK = `<style type="text/css">
  :root { color-scheme: dark; supported-color-schemes: dark; }
  u + .body, .body { background-color:#000000 !important; }
  [bgcolor="#000000"], [data-ogsb] [bgcolor="#000000"] { background-color:#000000 !important; }
  [bgcolor="#0A0A0A"], [data-ogsb] [bgcolor="#0A0A0A"] { background-color:#0A0A0A !important; }
  [bgcolor="#141414"], [data-ogsb] [bgcolor="#141414"] { background-color:#141414 !important; }
  [bgcolor="#E2DD9F"], [data-ogsb] [bgcolor="#E2DD9F"] { background-color:#E2DD9F !important; }
  .dw, [data-ogsc] .dw { color:#ffffff !important; }
  .db, [data-ogsc] .db { color:#C9C9C3 !important; }
  .dm, [data-ogsc] .dm { color:#8C8C82 !important; }
  .dg, [data-ogsc] .dg { color:#E2DD9F !important; }
</style>`;
function applyDarkLock(html) {
  if (!html.includes(":root { color-scheme: dark") && html.includes("</head>")) {
    html = html.replace("</head>", DARK_LOCK + "\n</head>");
  }
  const add = (hex, cls) => {
    html = html.replace(new RegExp('(<(?:p|h1|span|a|div|td)\\b)((?:(?!class=)[^>])*?)(style="[^"]*color:' + hex.replace(/#/g, "\\$&") + '[^"]*")', "gi"), `$1 class="${cls}"$2$3`);
  };
  add("#ffffff", "dw"); add("#C9C9C3", "db"); add("#D6D6D0", "db");
  add("#9A9A92", "dm"); add("#8C8C82", "dm"); add("#6E6E66", "dm");
  add("#E2DD9F", "dg");
  return html;
}

// Convert a step's plain-text body into inline-styled HTML on the dark shell. Staff
// content is trusted (may carry a link or {{merge}} var), so we don't escape - blank
// lines become paragraphs, single newlines become <br>, and a bare URL on its own
// line becomes the gold square CTA so the call-to-action stands out.
function bodyToHtml(body) {
  const P = "margin:0 0 18px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.62;color:#333333;";
  return String(body || "").trim().split(/\n{2,}/).map((blk) => {
    const t = blk.trim();
    if (/^https?:\/\/\S+$/.test(t)) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;"><tr><td bgcolor="#E2DD9F" style="background:#E2DD9F;"><a href="${t}" style="display:inline-block;padding:16px 30px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0A0A0A;text-decoration:none;">Get started&nbsp;&nbsp;&rarr;</a></td></tr></table>`;
    }
    return `<p style="${P}">${t.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

// Fill the shell identity placeholders (UPPERCASE) in a frame or a full designed
// template - both carry the same placeholder set since the templates were
// tokenized (2026-07-25, the canonical no-hardcode build).
function fillShell(html, L, { pre, unsub, reason, title, noUnsubscribe }) {
  // BEFORE the placeholder pass, because the anchor is matched on {{UNSUBSCRIBE}}
  // itself - see stripUnsubscribe in email-templates/_shell.js. Unset (every caller
  // that existed before receipts) this is a no-op and the output is unchanged.
  const src = noUnsubscribe ? stripUnsubscribe(html) : html;
  return src
    // Both of these are only still here if the template did NOT declare its own.
    // {{FOOTER_REASON}} goes first: the sentence it expands to itself contains
    // {{ACADEMY_FULL}}, which the pass below then fills.
    .replace(/\{\{FOOTER_REASON\}\}/g, reason || FOOTER_REASON.enquired)
    .replace(/\{\{DOC_TITLE\}\}/g, title || L.full)
    .replace(/\{\{PREHEADER\}\}/g, pre)
    .replace(/\{\{WORDMARK_SUFFIX\}\}/g, L.suffix)
    .replace(/\{\{LOCATION_TAG\}\}/g, L.locationTag)
    .replace(/\{\{TAGLINE\}\}/g, L.tagline)
    .replace(/\{\{SITE_URL\}\}/g, L.siteUrl)
    .replace(/\{\{SITE_LABEL\}\}/g, L.siteLabel)
    .replace(/\{\{SUPPORT_EMAIL\}\}/g, L.email)
    .replace(/\{\{INSTAGRAM_URL\}\}/g, L.instagram)
    .replace(/\{\{ACADEMY_FULL\}\}/g, L.full)
    .replace(/\{\{UNSUBSCRIBE\}\}/g, unsub);
}

// An academy with identity fields still empty (no domain / support email /
// instagram / review link on file) must ship NO broken or borrowed links: drop
// empty footer anchors (with their dot separators) and any CTA table whose
// button href came out empty or site-relative (the fact was blank).
function dropEmptyShellLinks(html) {
  const SEP = '<span[^>]*>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<\\/span>\\s*';
  const A = '<a href="(?:mailto:)?"[^>]*>(?:(?!<\\/a>)[\\s\\S])*?<\\/a>';
  html = html.replace(new RegExp('\\s*' + SEP + A, "g"), "");
  html = html.replace(new RegExp(A + '\\s*' + SEP, "g"), "");
  // The gold CTA button, when its link fact is missing: take the WHOLE table, not
  // just the anchor. Stripping the anchor alone would leave a gold box with no
  // label and no destination, which is exactly the "dead button" this forbids.
  // Must run BEFORE the bare-anchor sweep below, which would otherwise eat the
  // <a> first. Pinned to the gold cell so it can only ever match a real CTA.
  const GOLD = '(?:(?!<table)(?!<\\/table>)[\\s\\S])*?bgcolor="#E2DD9F"(?:(?!<table)(?!<\\/table>)[\\s\\S])*?';
  html = html.replace(new RegExp('\\s*<table[^>]*>' + GOLD + '<a href=""[^>]*>(?:(?!<table)[\\s\\S])*?<\\/table>', "g"), "");
  html = html.replace(new RegExp(A, "g"), "");
  html = html.replace(/<table[^>]*>(?:(?!<table)(?!<\/table>)[\s\S])*?<a href="\/[^"]*"(?:(?!<table)[\s\S])*?<\/table>/g, "");
  return html;
}

// Render a full branded email: drop the step body into the academy's shell - OR,
// if the body is already a FULL designed email (a complete HTML document, e.g.
// exported from Claude Design), send it AS-IS and only fill its placeholders (it
// has its own frame; wrapping it again would double the header/footer).
// `footerReason` / `docTitle` are the shell's two per-message parameters, for a caller
// sending a plain body through FRAME. A DESIGNED template declares its own (see
// _shell.js shellHead/shellFoot) and those win - the template knows its audience.
// Unset, they fall back to what production has always sent: the "enquired about"
// reason and the academy name as the title.
// `noUnsubscribe` is the third, and it is for TRANSACTIONAL mail only: a receipt for
// money that already moved carries no opt-out link at all (the reasoning is written
// out at stripUnsubscribe in email-templates/_shell.js). Unset, the footer is exactly
// what it has always been - the flag has no effect anywhere it is not passed.
//   renderEmail({ clientId, subject, body, preheader?, unsubscribeUrl?, vars?,
//                 footerReason?, docTitle?, noUnsubscribe? }) -> html
// The message CONTENT a body resolves to, before any shell is wrapped around it:
// the template expanded if the body is a "template:<key>" ref, then merge tokens
// filled. Separated out so the send path can ask "does this resolve to anything at
// all" and get the same answer renderEmail would - see isEmptyAfterMerge in
// api/_send.js. Asking that question of the raw body instead was wrong for a
// template ref: "template:onboarding-review" is never an empty string, however
// empty the email behind it turns out to be.
export function templateBody({ clientId, body, vars } = {}) {
  const L = locFor(clientId, vars);
  let raw = String(body || "");
  const tref = raw.match(/^\s*template:([\w/-]+)\s*$/);
  // A template is normally a plain string. It may also be a FUNCTION of the location
  // config, for a template whose content depends on facts the academy either has or
  // does not (onboarding-welcome's online-programs and refer-a-friend items). Such a
  // template may return "" to mean "this academy has nothing to say here", and the
  // whole email is then not sent rather than sent hollow.
  if (tref && TEMPLATES[tref[1]]) {
    const t = TEMPLATES[tref[1]];
    raw = typeof t === "function" ? t(L, vars) : t;
  }
  // Resolve merge tokens BEFORE building markup: a resolved URL line becomes the
  // gold CTA in bodyToHtml, and an EMPTY {{location.website}} drops its line
  // while it is still a text line (inside markup it would be too late).
  return resolveMergeVars(raw, L, vars);
}

// ── THE ONE RENDER PATH ──────────────────────────────────────────────────────
// The message an automation step will actually put on the wire, rendered.
//
// api/_send.js sends EXACTLY this, and the owner's approval surface (the
// `approval-queue` action in api/automations.js, behind the onboarding wizard's
// "Approve your sales messages" step) SHOWS exactly this. Same function, same
// vars, so a message an owner approved cannot disagree with the one a parent gets.
//
// That is a claim about RENDERING, not about coverage: it says the surface shows
// the true text of the steps it renders, not that every message an academy can send
// passes through the surface. It does not - see api/_sales-approval.js.
//
// DO NOT WRITE A SECOND RENDERER FOR PREVIEWS. One existed and quietly
// disagreed with the send (it rendered the welcome email without the academy's
// venue, weekly schedule and coaches - most of what an owner is actually
// checking).
//
// EXACTLY THREE CALLERS render an automation step's message, and all three are
// this function - no more, no fewer:
//   1. api/_send.js sendOn()                        - the send itself
//   2. api/automations.js `approval-queue`          - the onboarding approval step
//   3. api/automations.js `preview-email`           - the Sales step editor preview
// (3) called renderEmail directly until 29 Jul 2026, with its own sample family and
// an unresolved subject. It is the screen the approval step sends owners to ("edit
// any message in Sales"), so the two owner-facing surfaces disagreed about the same
// message. If you add a fourth caller, it comes through here too.
//
// TWO LOCKS, and they cover different things - keep both:
//   api/_approval-render.test.mjs drives the real sendOn() against a stubbed
//   transport and proves the approval surface AGREES with it. That is a relative
//   anchor: a bug inside THIS function moves both sides together and is invisible
//   to it.
//   api/_gta-step-lock.test.mjs holds the ABSOLUTE anchor - committed goldens of the
//   subject, the empty flag and the body this function returns for BAM GTA's real
//   rows, plus two probes that carry EMPTY: true. Deleting the subject merge or
//   forcing `empty` false passes the agreement test and fails that one.
//
//   renderStepMessage({ channel, clientId, subject, body, vars })
//     -> { channel:'sms',   text,          empty }
//     -> { channel:'email', subject, html, empty }
//
// `empty` means the copy resolved to NOTHING once this academy's own facts were
// filled in - every sentence it had depended on a fact nobody has entered yet.
// The send path skips such a step (it is a no-op, not a failure); the approval
// surface shows it as "nothing to send yet" instead of an empty bubble.
// `footerReason` / `noUnsubscribe` are carried straight through to renderEmail for a
// caller whose message is not lead nurture - today that is the member receipts in
// api/_member-receipts.js and nothing else. BOTH DEFAULT TO UNSET, and unset means
// byte-for-byte the email production has always sent: a step row that passes neither
// (every sales drip, every confirmation, the welcome email) cannot move.
export function renderStepMessage({ channel, clientId, subject, body, vars, footerReason, noUnsubscribe } = {}) {
  const v = vars || {};
  // The same trim the send path has always applied before rendering.
  const text = String(body || "").trim();
  const L = locFor(clientId, v);
  if (channel === "email") {
    // The subject carries merge tokens too, and it is the resolved one that both
    // reaches the inbox and seeds the preheader inside renderEmail.
    const subj = resolveMergeVars(String(subject || ""), L, v);
    const empty = !templateBody({ clientId, body: text, vars: v }).trim();
    return { channel: "email", subject: subj, empty, html: empty ? "" : renderEmail({ clientId, subject: subj, body: text, vars: v, footerReason, noUnsubscribe }) };
  }
  if (channel === "sms") {
    // GHL does not process merge tokens on raw /conversations/messages sends, so
    // SMS tokens resolve here (email tokens resolve inside renderEmail).
    const msg = resolveMergeVars(text, L, v);
    return { channel: "sms", text: msg, empty: !msg.trim() };
  }
  throw new Error(`renderStepMessage: unknown channel '${channel}'`);
}

// The unsubscribe destination this email WILL carry, resolved the one way, so the
// send path can ask the question before it sends and get the same answer the render
// gives. Empty means the rendered email has NO unsubscribe path at all - which is
// worse than one pointing at the wrong inbox, so api/_send.js HOLDS on empty rather
// than sending. Asking that question of `clients.business_email` directly instead of
// through here would be a second opinion about the same email, and the two would
// drift the first time an explicit unsubscribeUrl was passed.
export function unsubscribeFor({ clientId, unsubscribeUrl, vars } = {}) {
  const explicit = String(unsubscribeUrl || "").trim();
  if (explicit) return explicit;
  const L = locFor(clientId, vars);
  return L.email ? `mailto:${L.email}?subject=Unsubscribe` : "";
}

export function renderEmail({ clientId, subject, body, preheader, unsubscribeUrl, vars, footerReason, docTitle, noUnsubscribe } = {}) {
  const L = locFor(clientId, vars);
  const pre = String(preheader || subject || "").replace(/[<>]/g, "").slice(0, 140);
  const unsub = unsubscribeFor({ clientId, unsubscribeUrl, vars });
  const raw = templateBody({ clientId, body, vars });
  const shellArgs = { pre, unsub, reason: footerReason, title: docTitle, noUnsubscribe };
  let html;
  if (/^\s*<(?:!doctype|html)/i.test(raw)) {
    html = fillShell(raw, L, shellArgs);
  } else {
    html = fillShell(FRAME.replace(/\{\{CONTENT\}\}/g, bodyToHtml(raw)), L, shellArgs);
  }
  // Emails are LIGHT now (white body, black header/footer) so they render the same
  // in light + dark mode everywhere - no dark-mode lock needed (and signaling dark
  // on a light email would be wrong). applyDarkLock is kept for reference only.
  return dropEmptyShellLinks(resolveMergeVars(html, L, vars));
}
