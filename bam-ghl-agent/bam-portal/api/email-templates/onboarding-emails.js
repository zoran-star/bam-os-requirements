// Onboarding welcome-sequence emails (portal-native "onboarding" automation).
// Same email-safe design language as nurture-emails.js: LIGHT scheme, table layout,
// inlined styles, solid hex, web-safe fallbacks, Anton display + Inter Tight body,
// gold #E2DD9F accent, black #0A0A0A header/footer. NO em dashes anywhere.
//
// These are FULL HTML documents (renderEmail sends them as-is, only filling
// {{UNSUBSCRIBE}} / {{PREHEADER}} + resolveMergeVars tokens like {{contact.first_name}},
// {{contact.athletes_full_name}}, {{location.city}}, {{location_owner.first_name}}).
// Referenced from an automation_steps row via body = "template:<key>".

import { TEMPLATES as NURTURE } from "./nurture-emails.js";

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

const HEAD = (title, preheader) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<!--[if mso]><style>* {font-family: Arial, sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#EDEDEA;font-family:'Inter Tight',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EDEDEA" style="background:#EDEDEA;">
  <tr><td align="center" style="padding:34px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:600px;background:#FFFFFF;">
      <tr><td style="font-size:0;line-height:0;mso-line-height-rule:exactly;height:3px;background:#E2DD9F;">&nbsp;</td></tr>
      <tr><td bgcolor="#0A0A0A" style="padding:30px 36px 24px;background:#0A0A0A;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="left" valign="middle" style="font-family:'Anton',Impact,'Arial Narrow','Arial Black',Arial,sans-serif;font-weight:900;font-size:25px;line-height:1;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">GTA</span></td>
          <td align="right" valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#9A9A92;">OAKVILLE&nbsp;&middot;&nbsp;GTA</td>
        </tr></table>
      </td></tr>`;

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

const FOOT = `
      <tr><td style="padding:38px 36px 30px;"><div style="width:46px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td></tr>
      <tr><td bgcolor="#0A0A0A" style="padding:26px 36px 34px;background:#0A0A0A;">
        <p style="margin:0 0 12px;font-family:'Anton',Impact,'Arial Narrow','Arial Black',Arial,sans-serif;font-weight:900;font-size:18px;line-height:1;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">GTA</span></p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#9A9A92;">Youth and high-school basketball training in Oakville and across the GTA.</p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#9A9A92;">
          <a href="https://byanymeanstoronto.ca" style="color:#E2DD9F;text-decoration:none;font-weight:600;">byanymeanstoronto.ca</a>
          <span style="color:#555555;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="mailto:info@byanymeanstoronto.ca" style="color:#B8B8B0;text-decoration:none;">Email</a>
          <span style="color:#555555;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="https://instagram.com/byanymeanstoronto" style="color:#B8B8B0;text-decoration:none;">Instagram</a>
        </p>
        <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#888888;">
          You're receiving this because you joined By Any Means Toronto.
          <a href="{{UNSUBSCRIBE}}" style="color:#9A9A92;text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

// numbered "tip" block: gold number + bold title + body
const TIP = (n, title, body) => `        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
          <td valign="top" width="40" style="font-family:'Anton',Impact,Arial,sans-serif;font-size:30px;line-height:1;color:#E2DD9F;padding-right:8px;">${n}</td>
          <td valign="top">
            <p style="margin:0 0 5px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#0A0A0A;">${title}</p>
            <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#444444;">${body}</p>
          </td>
        </tr></table>`;

// schedule row
const SCHED = (day, younger, older) => `          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#0A0A0A;">${day}</td>
            <td align="right" style="padding:11px 0;border-bottom:1px solid #ECECEC;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:14px;color:#444444;">Younger ${younger}&nbsp;&nbsp;&middot;&nbsp;&nbsp;Older ${older}</td>
          </tr>`;

// ─────────────────────────────────────────────────────────────────────────────
// 1) WELCOME  (immediate) — quick-start links + schedule + location
const welcome = HEAD("By Any Means - Welcome", "You're in. Everything you need to get started with By Any Means GTA.")
  + EYEBROW("Welcome to the family")
  + H1("You're in.<br>Let's get to work.")
  + P("Hi {{contact.first_name}}, welcome to By Any Means Basketball. {{contact.athletes_full_name}} is all set, and we are pumped to have you both. Here is everything you need to hit the ground running.")
  + `      </td></tr>
      <tr><td style="padding:6px 36px 8px;">`
  + P("<b style=\"color:#0A0A0A;\">1. Join the WhatsApp group</b> for schedule updates and announcements: <a href=\"https://chat.whatsapp.com/J5tq7Sn5EF0DJ1rFsqBO9v?mode=gi_t\" style=\"color:#0A0A0A;font-weight:600;\">tap to join</a>.", 14)
  + P("<b style=\"color:#0A0A0A;\">2. Access the online programs</b> any time at <a href=\"https://byanymeanstoronto.ca/online-programs\" style=\"color:#0A0A0A;font-weight:600;\">byanymeanstoronto.ca/online-programs</a>.", 14)
  + P("<b style=\"color:#0A0A0A;\">3. Follow along</b> - Coach Zoran on <a href=\"https://www.instagram.com/byanymeanszoran/\" style=\"color:#0A0A0A;font-weight:600;\">Instagram</a>, Coach Adrian on <a href=\"https://www.instagram.com/byanymeansadrian/\" style=\"color:#0A0A0A;font-weight:600;\">Instagram</a>, and our <a href=\"https://www.instagram.com/byanymeanstoronto/\" style=\"color:#0A0A0A;font-weight:600;\">general page</a>.", 14)
  + P("<b style=\"color:#0A0A0A;\">4. Bring a friend</b> to training and you both get a free month plus some merch (<a href=\"https://byanymeansgsc.com\" style=\"color:#0A0A0A;font-weight:600;\">check out the merch</a>).", 14)
  + P("<b style=\"color:#0A0A0A;\">5. Need anything?</b> Reach the coaches at <a href=\"tel:+12898166569\" style=\"color:#0A0A0A;font-weight:600;\">(289) 816-6569</a>.", 26)
  + CTA("https://chat.whatsapp.com/J5tq7Sn5EF0DJ1rFsqBO9v?mode=gi_t", "Join the WhatsApp group")
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
  + FOOT;

// ─────────────────────────────────────────────────────────────────────────────
// 2) TRAINING  (+10 min) — three habits + Attention to Detail video
const VIDEO_ID = "jC1xir7Jngc";
const training = HEAD("By Any Means - Make Training Count", "Three habits that separate the players who improve fast from everyone else.")
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
  + FOOT;

// ─────────────────────────────────────────────────────────────────────────────
// 3) REVIEW  (+1 week after testimonials) — warm Google-review ask
const review = HEAD("By Any Means - A Quick Favour", "If training has been a win for your athlete, would you share it?")
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
  + FOOT;

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
