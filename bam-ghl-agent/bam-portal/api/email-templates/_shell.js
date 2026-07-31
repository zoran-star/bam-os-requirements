// THE branded email shell, in one place.
//
// This is the exact FRAME that used to live inline in api/email-shells.js, moved here
// so the designed templates in this folder can ride the SAME markup instead of keeping
// their own copy of it. api/email-shells.js imports FRAME from here; the onboarding
// templates import shellHead() / shellFoot() (the same string, split at the content slot)
// because their content is a run of full <tr> rows rather than one block of prose.
//
// Two things are PARAMETERS of the shell rather than fixed strings, because the same
// shell serves two audiences and one fixed value would be a lie to one of them: the
// document <title> ({{DOC_TITLE}}) and the footer reason ({{FOOTER_REASON}}). See
// FOOTER_REASON at the bottom. Anything a template leaves unfilled is defaulted by
// fillShell() in api/email-shells.js.
//
// Why it lives in email-templates/ and not next to renderEmail: api/email-shells.js
// imports the templates, so a template importing email-shells.js back would be a cycle
// and FRAME would still be in its temporal dead zone when the templates evaluate. A
// leaf module both sides import has no cycle.
//
// Every identity string is a {{PLACEHOLDER}} filled per-academy by fillShell() from the
// academy's own record. Nothing in here may name a location. Email clients strip
// external CSS and custom fonts, so it is table-based with FULLY INLINED styles, SOLID
// hex colors, and web-safe font fallbacks.
// Brand: gold #E2DD9F, black #000000 / surface #0A0A0A, Anton (display) + Inter Tight.

// Everything above the content: doc head, preheader, outer tables, gold accent, and the
// black header bar. Ends on the header row's </td></tr>, so a template can follow it
// with its own content <tr> rows.
export const SHELL_HEAD = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{DOC_TITLE}}</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<!--[if mso]><style>* {font-family: Arial, sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#EDEDEA;font-family:'Inter Tight',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">{{PREHEADER}}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EDEDEA" style="background:#EDEDEA;">
  <tr><td align="center" style="padding:34px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:600px;background:#FFFFFF;">

      <!-- thin gold top accent -->
      <tr><td style="font-size:0;line-height:0;mso-line-height-rule:exactly;height:3px;background:#E2DD9F;">&nbsp;</td></tr>

      <!-- HEADER (black bar) -->
      <tr><td bgcolor="#0A0A0A" style="background:#0A0A0A;padding:30px 36px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="left" valign="middle" style="font-family:'Anton',Impact,'Arial Narrow','Arial Black',Arial,sans-serif;font-weight:900;font-size:25px;line-height:1;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">{{WORDMARK_SUFFIX}}</span></td>
          <td align="right" valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#8C8C82;">{{LOCATION_TAG}}</td>
        </tr></table>
      </td></tr>
`;

// The single-block content slot renderEmail uses for a plain step body.
const CONTENT_SLOT = `
      <!-- CONTENT (white) -->
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:46px 36px 8px;">
        {{CONTENT}}
      </td></tr>
`;

// Everything below the content: the gold rule, the black footer bar, and the close.
export const SHELL_FOOT = `
      <!-- gold rule -->
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:30px 36px 32px;"><div style="width:46px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td></tr>

      <!-- FOOTER (black bar) -->
      <tr><td bgcolor="#0A0A0A" style="background:#0A0A0A;padding:26px 36px 32px;">
        <p style="margin:0 0 12px;font-family:'Anton',Impact,'Arial Narrow','Arial Black',Arial,sans-serif;font-weight:900;font-size:18px;line-height:1;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">{{WORDMARK_SUFFIX}}</span></p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#9A9A92;">{{TAGLINE}}</p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#8C8C82;">
          <a href="{{SITE_URL}}" style="color:#E2DD9F;text-decoration:none;font-weight:600;">{{SITE_LABEL}}</a>
          <span style="color:#3a3a32;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="mailto:{{SUPPORT_EMAIL}}" style="color:#B8B8B0;text-decoration:none;">Email</a>
          <span style="color:#3a3a32;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="{{INSTAGRAM_URL}}" style="color:#B8B8B0;text-decoration:none;">Instagram</a>
        </p>
        <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#6E6E66;">
          {{FOOTER_REASON}}
          <a href="{{UNSUBSCRIBE}}" style="color:#8C8C82;text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

// The whole shell with a single {{CONTENT}} slot, for a plain-text step body.
export const FRAME = SHELL_HEAD + CONTENT_SLOT + SHELL_FOOT;

// WHY the footer reason is a parameter and not one fixed sentence:
// the shell is shared by two audiences, and only one of the two sentences is TRUE of
// each. A lead-nurture email goes to someone who asked about us; an ONBOARDING email
// goes to someone who has already paid and joined, so "you enquired about" would be a
// false statement to a member. Saying it right is not GTA-specific - every academy
// sends both kinds - so the shell takes the reason rather than any academy forking it.
export const FOOTER_REASON = {
  // Lead nurture: they filled in a form / asked about us. The default.
  enquired: "You're receiving this because you enquired about {{ACADEMY_FULL}}.",
  // Onboarding: they have PAID and joined. Anything else is untrue for a member.
  joined: "You're receiving this because you joined {{ACADEMY_FULL}}.",
};

// A designed template's own preheader line + <title>, dropped into the shell head.
// Templates that pass nothing leave {{PREHEADER}} / {{DOC_TITLE}} in place for
// renderEmail's fillShell to fill (from the subject, and from the academy name).
// The title is the email's OWN name ("By Any Means - Welcome"), not the academy's:
// it is what a browser tab / "view in browser" shows, and every email of a sequence
// carrying the same academy name there tells the reader nothing.
export function shellHead(preheader, title) {
  let out = SHELL_HEAD;
  if (preheader) out = out.replace("{{PREHEADER}}", preheader);
  if (title) out = out.replace("{{DOC_TITLE}}", title);
  return out;
}

// The footer with its reason baked in. A template declares its own audience here;
// anything left unfilled falls back to `enquired` in fillShell.
export function shellFoot(reason = FOOTER_REASON.enquired) {
  return SHELL_FOOT.replace("{{FOOTER_REASON}}", reason);
}

// ── the unsubscribe, and the one kind of email that must not carry it ────────
//
// A TRANSACTIONAL email - a receipt for money that already moved - is not a
// commercial message and gets no unsubscribe link. CAN-SPAM exempts transactional
// and relationship messages from the opt-out requirement, and CASL does not treat a
// receipt for a completed transaction as a commercial electronic message. Offering
// to unsubscribe somebody from the record of their own payment is not a courtesy:
// it implies the document is marketing, and it implies there is something to opt out
// of that we would then have to honour by NOT sending a receipt.
//
// This is a whole-anchor removal, not an empty href. Leaving `<a href="">` behind
// would put a dead, underlined "Unsubscribe" in the footer, which is the same claim
// with the link broken. The leading \s* takes the newline and indent that exist only
// to separate the anchor from the reason sentence, so the paragraph closes straight
// after the sentence with nothing dangling.
//
// Matched on the PLACEHOLDER, so it must run BEFORE {{UNSUBSCRIBE}} is filled - see
// fillShell() in api/email-shells.js. That is deliberate: it can only ever match the
// shell's own anchor, never a link a template or a staff-written body put there.
export const UNSUBSCRIBE_ANCHOR = /\s*<a href="\{\{UNSUBSCRIBE\}\}"[^>]*>Unsubscribe<\/a>/g;

export function stripUnsubscribe(html) {
  return String(html).replace(UNSUBSCRIBE_ANCHOR, "");
}
