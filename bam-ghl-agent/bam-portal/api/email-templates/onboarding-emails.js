// Onboarding welcome-sequence emails (portal-native "onboarding" automation).
// Same email-safe design language as nurture-emails.js: LIGHT scheme, table layout,
// inlined styles, solid hex, web-safe fallbacks, Anton display + Inter Tight body,
// gold #E2DD9F accent, black #0A0A0A header/footer. NO em dashes anywhere.
//
// These are FULL HTML documents (renderEmail sends them as-is, only filling
// {{UNSUBSCRIBE}} / {{PREHEADER}} + resolveMergeVars tokens like {{contact.first_name}},
// {{contact.athletes_full_name}}, {{location.city}}, {{location_owner.first_name}}).
// Referenced from an automation_steps row via body = "template:<key>".
//
// The header/footer come from ./_shell.js (shellHead + shellFoot), the SAME shell
// renderEmail wraps a plain step body in, so wordmark / location tag / site / support
// email / Instagram / academy name all fill from the sending academy's own record.
// Do not reintroduce a local header or footer here.
//
// STILL HARDCODED TO GTA, deliberately, because no merge token resolves them yet and an
// unknown {{token}} would reach a parent as literal text:
//   - the WhatsApp group invite  (welcome: the item-1 link AND the gold CTA below it)
//   - the Google review URL      (review: the gold CTA)
// Add resolver tokens first, then swap. Separate follow-up.
//
// Welcome's "online programs" and "bring a friend" items are NOT hardcoded: each is
// gated on a per-academy fact (L.onlineProgramsUrl / L.referralOffer) and renders only
// for an academy that has it. See quickStart() below.
//
// The BODY copy of these three is still GTA-specific in places (coach Instagram
// handles, the GTA phone number, the Oakville address and Google Maps link, the GTA
// weekly schedule, "The By Any Means GTA Team" sign-off, and welcome's preheader).
// That is copy work, not shell plumbing, and is NOT done here.

import { TEMPLATES as NURTURE } from "./nurture-emails.js";
import { shellHead, shellFoot, FOOTER_REASON } from "./_shell.js";

// These go to people who have already PAID and joined, never to a lead, so the shell's
// footer reason must say "joined" - "enquired about" is a lead sentence and is simply
// untrue of a member. The shell takes it as a parameter (FOOTER_REASON), so this is a
// declaration of audience, not a fork of the shell.
const MEMBER_FOOT = shellFoot(FOOTER_REASON.joined);

// The onboarding sequence reuses the designed nurture emails, but its recipients
// are PAYING members - so any "Book a free trial" call-to-action (right for a lead,
// wrong for a member who already trains) is stripped for the onboarding-only copies.
// The shared nurture templates are left untouched so the lead-nurture sequence keeps
// its trial CTA. Two strips: the gold CTA button table, and any paragraph whose text
// mentions "free trial".
function stripFreeTrial(html) {
  return String(html)
    // gold CTA button table that links to /free-trial (one per template, no nesting)
    .replace(/\s*<table[^>]*>(?:(?!<\/table>)[\s\S])*?\/free-trial[\s\S]*?<\/table>/gi, "")
    // any text-only paragraph that mentions a free trial (e.g. "Come in for a free trial session.")
    .replace(/\s*<p[^>]*>[^<]*free trial[^<]*<\/p>/gi, "");
}

// Same audience problem as MEMBER_FOOT, one layer further out. The nurture designs
// still carry their own inline copy of the frame, with the shell's DEFAULT reason
// ("you enquired about ...") baked into it - correct for a lead, untrue of a member.
// welcome / training / review pick their reason by calling shellFoot(); these three
// cannot, because they inherit a rendered frame rather than build one. So swap that
// one sentence for the shell's OTHER reason. Both sides are FOOTER_REASON constants
// from _shell.js, so this reuses the existing parameter - it is not a fourth footer,
// and the nurture templates themselves are untouched and keep saying "enquired".
//
// It throws rather than no-ops if the sentence is not found exactly once: if the
// nurture frame is ever re-shelled or reworded, this must fail loudly at import
// instead of silently telling a paying member they enquired about us.
function memberFooterReason(html, key) {
  const parts = String(html).split(FOOTER_REASON.enquired);
  if (parts.length !== 2) {
    throw new Error(
      `onboarding-emails: expected exactly one FOOTER_REASON.enquired in ${key}, found ${parts.length - 1}`,
    );
  }
  return parts.join(FOOTER_REASON.joined);
}

// stripFreeTrial + the member footer reason: the two things that turn a lead-nurture
// design into its onboarding copy.
const forMembers = (key) => memberFooterReason(stripFreeTrial(NURTURE[key]), key);

const EYEBROW = (label) => `
      <tr><td style="padding:50px 36px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>
          <td valign="middle" style="padding-right:14px;"><div style="width:32px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td>
          <td valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3.4px;text-transform:uppercase;color:#777777;">${label}</td>
        </tr></table>`;

const H1 = (html) => `        <h1 style="margin:0 0 24px;font-family:'Anton',Impact,'Arial Narrow','Arial Black',Arial,sans-serif;font-weight:400;font-size:50px;line-height:0.92;letter-spacing:-0.5px;text-transform:uppercase;color:#0A0A0A;">${html}</h1>`;

const P = (html, mb = 18) => `        <p style="margin:0 0 ${mb}px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.62;color:#333333;">${html}</p>`;

const CTA = (href, label) => `        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 30px;"><tr>
          <td bgcolor="#E2DD9F" style="background:#E2DD9F;">
            <a href="${href}" style="display:inline-block;padding:16px 30px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#0A0A0A;text-decoration:none;">${label}&nbsp;&nbsp;&rarr;</a>
          </td>
        </tr></table>`;


// numbered "tip" block: gold number + bold title + body
const TIP = (n, title, body) => `        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
          <td valign="top" width="40" style="font-family:'Anton',Impact,Arial,sans-serif;font-size:30px;line-height:1;color:#E2DD9F;padding-right:8px;">${n}</td>
          <td valign="top">
            <p style="margin:0 0 5px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#0A0A0A;">${title}</p>
            <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#444444;">${body}</p>
          </td>
        </tr></table>`;

// inline gold-on-black link, the one anchor style used inside body copy
const LINK = (href, label) => `<a href="${href}" style="color:#0A0A0A;font-weight:600;">${label}</a>`;

// An address as a Google Maps query. Commas dropped and spaces as "+", which is the
// form these links were hand-written in and the form Maps has always taken - so
// generating the link does not change where a member who taps it ends up, nor the
// URL they see.
const mapsQuery = (address) => encodeURIComponent(String(address || "").replace(/,/g, "")).replace(/%20/g, "+");

// A displayed phone number as a dialable tel: target. Anything already in
// international form is kept as-is; a bare 10-digit North American number gets its
// +1. Anything else is passed through as digits rather than guessed at, because a
// wrong country code is worse than an unprefixed one.
const telHref = (phone) => {
  const raw = String(phone || "").trim();
  if (raw.startsWith("+")) return "+" + raw.slice(1).replace(/\D+/g, "");
  const d = raw.replace(/\D+/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d;
};

// one numbered quick-start item: bold "<n>. <lead>", then the body
const ITEM = (n, lead, body, mb) => P(`<b style="color:#0A0A0A;">${n}. ${lead}</b> ${body}`, mb);

// schedule row. `groups` is [{name, time}] for that day, in the order they run, so
// however an academy splits its sessions - by age, by level, by anything - the row
// says what the academy's own sessions are actually called.
const SCHED = (day, groups) => `          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#0A0A0A;">${day}</td>
            <td align="right" style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:14px;color:#444444;">${groups.map((g) => `${g.name} ${g.time}`).join("&nbsp;&nbsp;&middot;&nbsp;&nbsp;")}</td>
          </tr>`;

// ─────────────────────────────────────────────────────────────────────────────
// 1) WELCOME  (immediate) — quick-start links + schedule + location

// The quick-start list, built PER ACADEMY.
//
// Two of these items only make sense for an academy that actually has the thing they
// point at: an online-programs library, and a refer-a-friend offer. They are not
// hardcoded and they are not special-cased by academy - each one is gated on its FACT
// being present on the location config (L, see api/email-shells.js). No fact, no line.
// Same rule as dropEmptyShellLinks and the empty-merge-token pass: an academy without
// the fact sends a SHORTER email, never a broken or a borrowed one.
//
// The numbers are assigned here, from each item's position in the list that survived,
// so a dropped item leaves no gap and no "1, 3, 4" - the rest renumber cleanly. The
// last surviving item carries the wider bottom margin before the CTA.
//
// Facts read (all optional):
//   L.communityUrl       - the group-chat invite, and L.communityPlatform names it
//   L.onlineProgramsUrl  - full URL of the academy's online-programs library
//   L.referralOffer      - { lead, body, merchUrl? }, the refer-a-friend perk
//   L.phone              - the number that reaches the coaches
function quickStart(L) {
  const items = [];

  // The group chat. The PLATFORM only names it, the LINK gates it: with no platform
  // on file this reads "Join the group", which is still correct, and with no invite
  // the item disappears rather than offering a member a link to nowhere.
  if (L && L.communityUrl) {
    const platform = L.communityPlatform ? `${L.communityPlatform} ` : "";
    items.push([`Join the ${platform}group`, `for schedule updates and announcements: ${LINK(L.communityUrl, "tap to join")}.`]);
  }

  if (L && L.onlineProgramsUrl) {
    const url = String(L.onlineProgramsUrl);
    items.push(["Access the online programs", `any time at ${LINK(url, url.replace(/^https?:\/\//i, ""))}.`]);
  }

  // Coaches to follow, from the academy's own team list (client_users.instagram).
  // No handles on file means no line at all - a "follow along" item naming nobody is
  // worse than not asking. The academy's general page rides on the end when it has one.
  const coaches = (L && Array.isArray(L.coaches) ? L.coaches : []).filter((c) => c && c.name && c.instagram);
  if (coaches.length || (L && L.instagram)) {
    const bits = coaches.map((c) => `Coach ${c.name} on ${LINK(c.instagram, "Instagram")}`);
    if (L && L.instagram) bits.push(`our ${LINK(L.instagram, "general page")}`);
    const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}` : bits[0];
    items.push(["Follow along", `- ${list}.`]);
  }

  // The merch shop is part of the same perk (it is the "plus some merch" half of it),
  // so it is nested inside the referral fact and drops with it - and drops on its own
  // if an academy runs a referral offer with no shop behind it.
  const ref = (L && L.referralOffer) || null;
  if (ref && ref.lead && ref.body) {
    const merch = ref.merchUrl ? ` (${LINK(ref.merchUrl, "check out the merch")})` : "";
    items.push([ref.lead, `${ref.body}${merch}.`]);
  }

  // The coach contact line. Gated like the rest: an academy with no number on file
  // does not tell a member to call one.
  if (L && L.phone) {
    items.push(["Need anything?", `Reach the coaches at ${LINK(`tel:${telHref(L.phone)}`, L.phone)}.`]);
  }

  return items.map(([lead, body], i) => ITEM(i + 1, lead, body, i === items.length - 1 ? 26 : 14)).join("");
}

// A template may be a FUNCTION of the location config when its content depends on the
// sending academy's facts (renderEmail calls it with L). The rest stay plain strings.
// The weekly schedule block, generated from the academy's REAL sessions
// (schedule_slots, collapsed into one typical week by api/_academy-facts.js) plus its
// training venue (the locations table). Both were hand-typed here until 28 Jul 2026,
// which is what made this email uncopyable: transcribing them into another academy's
// welcome email would text one academy's training times and gym address to another
// academy's members.
//
// No sessions on file means no schedule block, and no venue means no location block.
// Neither renders empty and neither renders somebody else's.
//
// NOTE the venue is NOT clients.address. That is the BUSINESS address - GTA's is
// 2205 Rosemount Cres, while members train at 1079 Linbrook Rd.
function scheduleBlock(L) {
  const week = (L && Array.isArray(L.schedule) ? L.schedule : []).filter((d) => d && d.day && (d.groups || []).length);
  const venue = (L && L.venue) || "";
  if (!week.length && !venue) return "";
  const sched = week.length
    ? `        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
          <td valign="middle" style="padding-right:14px;"><div style="width:32px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td>
          <td valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3.4px;text-transform:uppercase;color:#777777;">Weekly Schedule</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
${week.map((d) => SCHED(d.day, d.groups)).join("\n")}
        </table>`
    : "";
  const loc = venue
    ? `        <p style="margin:0 0 6px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#777777;">Location</p>
        <p style="margin:0 0 8px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;"><a href="https://maps.google.com/?q=${mapsQuery(venue)}" style="color:#0A0A0A;font-weight:600;text-decoration:none;">${venue}</a></p>`
    : "";
  return `      <tr><td style="padding:6px 36px 8px;">
${[sched, loc].filter(Boolean).join("\n")}
      </td></tr>`;
}

const welcome = (L) => shellHead("You're in. Everything you need to get started with {{location.name}}.", "By Any Means - Welcome")
  + EYEBROW("Welcome to the family")
  + H1("You're in.<br>Let's get to work.")
  + P("Hi {{contact.first_name}}, welcome to {{location.name}}. {{contact.athletes_full_name}} is all set, and we are pumped to have you both. Here is everything you need to hit the ground running.")
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">`
  + quickStart(L)
  // The group-chat button carries the same fact as the quick-start item above it, so
  // it appears and disappears with it. An empty href would leave a gold box that goes
  // nowhere; dropEmptyShellLinks would strip it, but not offering it is clearer.
  + (L && L.communityUrl ? CTA(L.communityUrl, `Join the ${L.communityPlatform ? `${L.communityPlatform} ` : ""}group`) : "")
  + `      </td></tr>
`
  + scheduleBlock(L)
  + `      <tr><td style="padding:18px 36px 8px;">`
  // Self-serve billing. Zoran's order, 31 Jul 2026: a member should never have to email
  // us to change a card. The destination is the ACADEMY's own Stripe billing portal
  // (clients.stripe_portal_url), so this is one line in the master template that every
  // academy renders with its own link - there is no BAM GTA literal here and there is
  // nowhere to put one.
  //
  // GATED ON THE FACT, exactly like quickStart's optional items and the group-chat CTA
  // above: no URL on file means the WHOLE sentence is absent, not a sentence with a dead
  // anchor in it and not an orphan lead-in. dropEmptyShellLinks would strip a bare empty
  // anchor if one ever got this far, but it cannot know that the words around it stop
  // making sense without their link, so the fact gates the sentence and the sweep stays
  // the backstop it already is.
  + (L && L.portalUrl ? P(`Manage your membership or update your card any time in your ${LINK(L.portalUrl, "billing portal")}.`) : "")
  + P("See you on the court,<br><b style=\"color:#0A0A0A;\">The {{location.name}} Team</b>", 4)
  + `      </td></tr>`
  + MEMBER_FOOT;

// ─────────────────────────────────────────────────────────────────────────────
// 2) TRAINING  (+10 min) — three habits + Attention to Detail video
const VIDEO_ID = "jC1xir7Jngc";
const training = shellHead("Three habits that separate the players who improve fast from everyone else.", "By Any Means - Make Training Count")
  + EYEBROW("Get the most out of it")
  + H1("How to make<br>training count.")
  + P("Hi {{contact.first_name}}, now that {{contact.athletes_full_name}} is part of the By Any Means family, here is how to get the absolute most out of every single session.")
  + `      </td></tr>
      <tr><td style="padding:10px 36px 8px;">`
  + TIP("1", "Talk to coach.", "Every player can reach our coaches anytime, about anything - basketball, school, or life. Before practice, tell coach what you want to work on and we will build the session around it.")
  + TIP("2", "Learn your weaknesses.", "Come ready to share what you want to improve. The more honest you are about the weak spots, the faster the growth.")
  + TIP("3", "Do the extra work.", "Treat training like a class - there is homework too. Stay consistent with the online programs and notebook work, even 20 minutes a day moves the needle.")
  + `      </td></tr>
      <tr><td style="padding:18px 36px 8px;">`
  + P("Want to level up faster? Watch as many By Any Means videos as you can. Here is one of our most popular from the Attention to Detail series:", 16)
  + `        <a href="https://www.youtube.com/watch?v=${VIDEO_ID}" style="text-decoration:none;"><img src="https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg" width="528" alt="Attention to Detail - watch on YouTube" style="display:block;width:100%;max-width:528px;height:auto;border:0;margin:0 0 4px;"></a>
      </td></tr>
      <tr><td style="padding:8px 36px 8px;">`
  + CTA(`https://www.youtube.com/watch?v=${VIDEO_ID}`, "Watch the video")
  + P("See you on the court,<br><b style=\"color:#0A0A0A;\">The By Any Means GTA Team</b>", 4)
  + `      </td></tr>`
  + MEMBER_FOOT;

// ─────────────────────────────────────────────────────────────────────────────
// 3) REVIEW  (+1 week after testimonials) — warm Google-review ask
// The review link is the whole point of this email, so with no link on file the email
// does not exist: it returns "" and api/_send.js skips the send. Dropping only the
// BUTTON was not enough and was actively worse - it left three paragraphs asking a
// parent for a Google review with no way to leave one. An academy gets this email the
// day it has somewhere to send people, and not before.
// "other families nearby" replaced "other families in the GTA":
// the sentence needed to be true for every academy, and {{location.city}} was the
// wrong fix - it narrows an academy that serves a region down to one town.
const review = (L) => (!L || !L.reviewUrl ? "" : shellHead("If training has been a win for your athlete, would you share it?", "By Any Means - A Quick Favour")
  + EYEBROW("A quick favour")
  + H1("Mind sharing<br>your story?")
  + P("Hi {{contact.first_name}}, we hope {{contact.athletes_full_name}} has been loving training with {{location.name}}. Watching our athletes get better every week is exactly why we do this.")
  + P("If you have a minute, a quick Google review would mean the world to us. It helps other families nearby find us, and it lets us keep growing the program for your athlete.", 26)
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">`
  + CTA("{{location.review_link}}", "Leave a Google review")
  + P("Thank you for being part of the family. It means more than you know.", 16)
  + P("With gratitude,<br><b style=\"color:#0A0A0A;\">The {{location.name}} Team</b>", 4)
  + `      </td></tr>`
  + MEMBER_FOOT);

export const ONBOARDING_TEMPLATES = {
  "onboarding-welcome": welcome,
  "onboarding-training": training,
  "onboarding-review": review,
  // Onboarding-only copies of the nurture designs, with the free-trial CTA removed
  // (paying members, not leads). The onboarding automation points its brand-story /
  // "new era" / testimonials steps at these keys instead of nurture-1/2/3.
  "onboarding-story":        forMembers("nurture-1"),
  "onboarding-era":          forMembers("nurture-2"),
  "onboarding-testimonials": forMembers("nurture-3"),
};
