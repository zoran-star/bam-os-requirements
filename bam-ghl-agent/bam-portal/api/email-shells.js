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

import { TEMPLATES } from "./email-templates/nurture-emails.js";

const FRAME = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{ACADEMY_FULL}}</title>
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
          <td align="left" valign="middle" style="font-family:'Anton','Arial Black',Arial,sans-serif;font-size:25px;line-height:1;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">{{WORDMARK_SUFFIX}}</span></td>
          <td align="right" valign="middle" style="font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#8C8C82;">{{LOCATION_TAG}}</td>
        </tr></table>
      </td></tr>

      <!-- CONTENT (white) -->
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:46px 36px 8px;">
        {{CONTENT}}
      </td></tr>

      <!-- gold rule -->
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:30px 36px 32px;"><div style="width:46px;height:2px;background:#E2DD9F;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</div></td></tr>

      <!-- FOOTER (black bar) -->
      <tr><td bgcolor="#0A0A0A" style="background:#0A0A0A;padding:26px 36px 32px;">
        <p style="margin:0 0 12px;font-family:'Anton','Arial Black',Arial,sans-serif;font-size:18px;line-height:1;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">BY ANY MEANS&nbsp;<span style="color:#E2DD9F;">{{WORDMARK_SUFFIX}}</span></p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#9A9A92;">{{TAGLINE}}</p>
        <p style="margin:0 0 16px;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#8C8C82;">
          <a href="{{SITE_URL}}" style="color:#E2DD9F;text-decoration:none;font-weight:600;">{{SITE_LABEL}}</a>
          <span style="color:#3a3a32;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="mailto:{{SUPPORT_EMAIL}}" style="color:#B8B8B0;text-decoration:none;">Email</a>
          <span style="color:#3a3a32;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
          <a href="{{INSTAGRAM_URL}}" style="color:#B8B8B0;text-decoration:none;">Instagram</a>
        </p>
        <p style="margin:0;font-family:'Inter Tight',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#6E6E66;">
          You're receiving this because you enquired about {{ACADEMY_FULL}}.
          <a href="{{UNSUBSCRIBE}}" style="color:#8C8C82;text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

// Per-location strings. Same design, each location's own identity. GTA is the base
// every new BAM location inherits until it gets its own entry (keyed by client_id).
const LOCATIONS = {
  // BAM GTA
  "39875f07-0a4b-4429-a201-2249bc1f24df": {
    suffix: "GTA",
    locationTag: "OAKVILLE &middot; GTA",
    full: "By Any Means Toronto",
    tagline: "Youth and high-school basketball training in Oakville and across the GTA.",
    siteUrl: "https://byanymeanstoronto.ca",
    siteLabel: "byanymeanstoronto.ca",
    email: "info@byanymeanstoronto.com",
    instagram: "https://instagram.com/byanymeanstoronto",
    city: "Oakville",
    ownerFirst: "Zoran",
  },
};
const GTA_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
function locFor(clientId) { return LOCATIONS[clientId] || LOCATIONS[GTA_ID]; }

// Resolve GHL-style merge tokens (the ones our imported emails carry) to real values:
// location tokens from the academy config, contact tokens from `vars` (with friendly
// fallbacks so a missing name never sends as a raw {{token}}). Tolerates spaces inside
// the braces. Only touches these known tokens - the shell placeholders (UPPERCASE) are
// left for the caller to fill.
function resolveMergeVars(html, L, vars = {}) {
  const map = {
    "contact.first_name": vars.first_name || "there",
    "contact.athletes_full_name": vars.athlete || "your athlete",
    "contact.athlete_full_name": vars.athlete || "your athlete",
    "location.city": L.city || "",
    "location.name": L.full || "",
    "location_owner.first_name": L.ownerFirst || "",
  };
  let out = html;
  for (const [k, val] of Object.entries(map)) {
    out = out.replace(new RegExp("\\{\\{\\s*" + k.replace(/\./g, "\\.") + "\\s*\\}\\}", "g"), val);
  }
  return out;
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

// Render a full branded email: drop the step body into the academy's shell - OR,
// if the body is already a FULL designed email (a complete HTML document, e.g.
// exported from Claude Design), send it AS-IS and only fill its placeholders (it
// has its own frame; wrapping it again would double the header/footer).
//   renderEmail({ clientId, subject, body, preheader?, unsubscribeUrl? }) -> html
export function renderEmail({ clientId, subject, body, preheader, unsubscribeUrl, vars } = {}) {
  const L = locFor(clientId);
  const pre = String(preheader || subject || "").replace(/[<>]/g, "").slice(0, 140);
  const unsub = unsubscribeUrl || `mailto:${L.email}?subject=Unsubscribe`;
  // A step body can be a short "template:<key>" reference to a vendored designed
  // email (api/email-templates/) so the DB holds a tiny ref, not 12KB of HTML.
  let raw = String(body || "");
  const tref = raw.match(/^\s*template:([\w/-]+)\s*$/);
  if (tref && TEMPLATES[tref[1]]) raw = TEMPLATES[tref[1]];
  let html;
  if (/^\s*<(?:!doctype|html)/i.test(raw)) {
    html = raw.replace(/\{\{UNSUBSCRIBE\}\}/g, unsub).replace(/\{\{PREHEADER\}\}/g, pre);
  } else {
    html = FRAME
      .replace(/\{\{CONTENT\}\}/g, bodyToHtml(body))
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
  // Emails are LIGHT now (white body, black header/footer) so they render the same
  // in light + dark mode everywhere - no dark-mode lock needed (and signaling dark
  // on a light email would be wrong). applyDarkLock is kept for reference only.
  return resolveMergeVars(html, L, vars);
}
