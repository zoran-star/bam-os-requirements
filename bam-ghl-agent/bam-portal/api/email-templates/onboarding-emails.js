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

// one numbered quick-start item: bold "<n>. <lead>", then the body
const ITEM = (n, lead, body, mb) => P(`<b style="color:#0A0A0A;">${n}. ${lead}</b> ${body}`, mb);

// schedule row
const SCHED = (day, younger, older) => `          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#0A0A0A;">${day}</td>
            <td align="right" style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:14px;color:#444444;">Younger ${younger}&nbsp;&nbsp;&middot;&nbsp;&nbsp;Older ${older}</td>
          </tr>`;

// ─────────────────────────────────────────────────────────────────────────────
// 1) WELCOME  (immediate) — quick-start links + schedule + location
const WHATSAPP = "https://chat.whatsapp.com/J5tq7Sn5EF0DJ1rFsqBO9v?mode=gi_t";

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
// Facts read (both optional):
//   L.onlineProgramsUrl  - full URL of the academy's online-programs library
//   L.referralOffer      - { lead, body, merchUrl? }, the refer-a-friend perk
function quickStart(L) {
  const items = [
    ["Join the WhatsApp group", `for schedule updates and announcements: ${LINK(WHATSAPP, "tap to join")}.`],
  ];

  if (L && L.onlineProgramsUrl) {
    const url = String(L.onlineProgramsUrl);
    items.push(["Access the online programs", `any time at ${LINK(url, url.replace(/^https?:\/\//i, ""))}.`]);
  }

  items.push(["Follow along", `- Coach Zoran on ${LINK("https://www.instagram.com/byanymeanszoran/", "Instagram")}, Coach Adrian on ${LINK("https://www.instagram.com/byanymeansadrian/", "Instagram")}, and our ${LINK("https://www.instagram.com/byanymeanstoronto/", "general page")}.`]);

  // The merch shop is part of the same perk (it is the "plus some merch" half of it),
  // so it is nested inside the referral fact and drops with it - and drops on its own
  // if an academy runs a referral offer with no shop behind it.
  const ref = (L && L.referralOffer) || null;
  if (ref && ref.lead && ref.body) {
    const merch = ref.merchUrl ? ` (${LINK(ref.merchUrl, "check out the merch")})` : "";
    items.push([ref.lead, `${ref.body}${merch}.`]);
  }

  items.push(["Need anything?", `Reach the coaches at ${LINK("tel:+12898166569", "(289) 816-6569")}.`]);

  return items.map(([lead, body], i) => ITEM(i + 1, lead, body, i === items.length - 1 ? 26 : 14)).join("");
}

// A template may be a FUNCTION of the location config when its content depends on the
// sending academy's facts (renderEmail calls it with L). The rest stay plain strings.
const welcome = (L) => shellHead("You're in. Everything you need to get started with By Any Means GTA.", "By Any Means - Welcome")
  + EYEBROW("Welcome to the family")
  + H1("You're in.<br>Let's get to work.")
  + P("Hi {{contact.first_name}}, welcome to By Any Means Basketball. {{contact.athletes_full_name}} is all set, and we are pumped to have you both. Here is everything you need to hit the ground running.")
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">`
  + quickStart(L)
  + CTA(WHATSAPP, "Join the WhatsApp group")
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
          <td valign="middle" style="padding-right:14px;"><div style="width:32px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td>
          <td valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3.4px;text-transform:uppercase;color:#777777;">Weekly Schedule</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">`
  + SCHED("Mondays", "7-8pm", "8-9pm")
  + SCHED("Tuesdays", "7-8pm", "8-9pm")
  + SCHED("Wednesdays", "7-8pm", "8-9pm")
  + SCHED("Thursdays", "7-8pm", "8-9pm")
  + SCHED("Saturdays", "11:30-12:30pm", "12:30-1:30pm")
  + `        </table>
        <p style="margin:0 0 6px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#777777;">Location</p>
        <p style="margin:0 0 8px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;"><a href="https://maps.google.com/?q=1079+Linbrook+Rd+Oakville+ON+L6J+2L2" style="color:#0A0A0A;font-weight:600;text-decoration:none;">1079 Linbrook Rd, Oakville, ON L6J 2L2</a></p>
      </td></tr>
      <tr><td style="padding:18px 36px 8px;">`
  + P("See you on the court,<br><b style=\"color:#0A0A0A;\">The By Any Means GTA Team</b>", 4)
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
const review = shellHead("If training has been a win for your athlete, would you share it?", "By Any Means - A Quick Favour")
  + EYEBROW("A quick favour")
  + H1("Mind sharing<br>your story?")
  + P("Hi {{contact.first_name}}, we hope {{contact.athletes_full_name}} has been loving training with By Any Means. Watching our athletes get better every week is exactly why we do this.")
  + P("If you have a minute, a quick Google review would mean the world to us. It helps other families in the GTA find us, and it lets us keep growing the program for your athlete.", 26)
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">`
  + CTA("https://g.page/r/CfuIFvZGkfmaEBM/review", "Leave a Google review")
  + P("Thank you for being part of the family. It means more than you know.", 16)
  + P("With gratitude,<br><b style=\"color:#0A0A0A;\">The By Any Means GTA Team</b>", 4)
  + `      </td></tr>`
  + MEMBER_FOOT;

export const ONBOARDING_TEMPLATES = {
  "onboarding-welcome": welcome,
  "onboarding-training": training,
  "onboarding-review": review,
  // Onboarding-only copies of the nurture designs, with the free-trial CTA removed
  // (paying members, not leads). The onboarding automation points its brand-story /
  // "new era" / testimonials steps at these keys instead of nurture-1/2/3.
  "onboarding-story":        stripFreeTrial(NURTURE["nurture-1"]),
  "onboarding-era":          stripFreeTrial(NURTURE["nurture-2"]),
  "onboarding-testimonials": stripFreeTrial(NURTURE["nurture-3"]),
};
