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

import { FRAME, FOOTER_REASON } from "./email-templates/_shell.js";
import { TEMPLATES as NURTURE_TEMPLATES } from "./email-templates/nurture-emails.js";
import { ONBOARDING_TEMPLATES } from "./email-templates/onboarding-emails.js";

// All vendored designed emails, addressable by `template:<key>` from an
// automation_steps body: lead-nurture sequence + onboarding welcome sequence.
const TEMPLATES = { ...NURTURE_TEMPLATES, ...ONBOARDING_TEMPLATES };

// FRAME (the shell markup with its {{CONTENT}} slot) now lives in
// ./email-templates/_shell.js so the designed templates in that folder ride the SAME
// markup instead of each keeping a copy of the header/footer.

// Per-location strings. Same design, each location's own identity, keyed by
// client_id. An academy WITHOUT an entry here gets its identity derived from
// RUNTIME vars (the client row) via locFromVars - identity fields fail to EMPTY,
// never to another academy's config. (The old `|| LOCATIONS[GTA_ID]` fallback
// leaked GTA's site + owner into every unwired academy's sends - San Jose would
// have texted "byanymeanstoronto.ca" and signed "coach Zoran", 2026-07-25.)
const LOCATIONS = {
  // BAM GTA
  "39875f07-0a4b-4429-a201-2249bc1f24df": {
    suffix: "GTA",
    locationTag: "OAKVILLE &middot; GTA",
    full: "By Any Means Toronto",
    tagline: "Youth and high-school basketball training in Oakville and across the GTA.",
    siteUrl: "https://byanymeanstoronto.ca",
    siteLabel: "byanymeanstoronto.ca",
    email: "info@byanymeanstoronto.ca",
    instagram: "https://instagram.com/byanymeanstoronto",
    city: "Oakville",
    ownerFirst: "Zoran",
  },
};

// Build a location config from runtime vars (see clientVars below). Everything
// unknown is EMPTY: the shell drops empty links/lines instead of borrowing
// another academy's identity.
function locFromVars(vars = {}) {
  const name = String(vars.location_name || "");
  const site = String(vars.location_website || "");
  // "BAM San Jose" / "By Any Means San Jose" -> gold wordmark suffix "SAN JOSE";
  // a name without the brand prefix keeps the plain "BY ANY MEANS" wordmark.
  const stripped = name.replace(/^\s*(?:by\s+any\s+means|bam)\s+/i, "");
  return {
    suffix: stripped !== name ? stripped.toUpperCase() : "",
    locationTag: vars.location_city ? String(vars.location_city).toUpperCase() : "",
    full: name,
    tagline: "",
    siteUrl: site,
    siteLabel: site.replace(/^https?:\/\//i, ""),
    email: String(vars.location_email || ""),
    instagram: "",
    city: String(vars.location_city || ""),
    ownerFirst: String(vars.location_owner || ""),
  };
}

export function locFor(clientId, vars) { return LOCATIONS[clientId] || locFromVars(vars); }

// The runtime identity vars for a clients row - the academy facts the resolver
// trusts. Callers that have the client row loaded (the automations worker, the
// confirm agent, previews) spread this into `vars` so every send renders the
// academy's OWN name / site / owner, or nothing at all.
export function clientVars(client) {
  const c = client || {};
  const domain = c.website_setup && c.website_setup.domain;
  return {
    location_name: c.business_name || "",
    location_website: domain ? `https://${domain}` : "",
    location_owner: c.owner_name ? String(c.owner_name).trim().split(/\s+/)[0] : "",
    location_email: c.email || "",
    location_city: cityFromAddress(c.address),
  };
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

// Resolve GHL-style merge tokens (the ones our imported emails carry) to real values:
// location tokens from the academy config, contact tokens from `vars` (with friendly
// fallbacks so a missing name never sends as a raw {{token}}). Tolerates spaces inside
// the braces. Only touches these known tokens - the shell placeholders (UPPERCASE) are
// left for the caller to fill.
// Remove every reference to a website we do not have, at the SMALLEST unit that
// still reads correctly - so an academy with no domain yet sends a shorter
// message, never a broken one and never an empty one.
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
const WEBSITE_TOKEN = /\{\{\s*location\.website\s*\}\}/;
function dropWebsiteMentions(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (const line of lines) {
    if (!WEBSITE_TOKEN.test(line)) { out.push(line); continue; }
    // A bare link line: the whole line is the token plus its path, no prose.
    const bareLink = /^\s*\S*\{\{\s*location\.website\s*\}\}\S*\s*$/.test(line);
    let kept = "";
    if (!bareLink) {
      kept = line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !WEBSITE_TOKEN.test(sentence))
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
    // vars overrides first: for an academy without its own LOCATIONS entry, L is
    // already derived from these same vars (locFromVars), so identity can only
    // ever be the academy's own values - or EMPTY. Never another academy's.
    "location.city": vars.location_city || L.city || "",
    "location.name": vars.location_name || L.full || "",
    "location.website": vars.location_website || L.siteUrl || "",
    "location_owner.first_name": vars.location_owner || L.ownerFirst || "",
    // Filled at send time by the worker (e.g. "Our next session is Tue 6pm. ").
    // Empty string when no slot is known so the sentence just drops out.
    "next_session": vars.next_session || "",
  };
  let out = html;
  // A blank {{location.website}} must not leave a link pointing at nothing, but
  // it must ALSO not silently delete the message around it. Runs before
  // substitution, on plain-text bodies only (a full HTML document is skipped -
  // its links are shell placeholders, handled by dropEmptyShellLinks).
  if (!map["location.website"] && !/^\s*<(?:!doctype|html)/i.test(out)) {
    out = dropWebsiteMentions(out);
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
function fillShell(html, L, { pre, unsub, reason, title }) {
  return html
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
// instagram on file) must ship NO broken or borrowed links: drop empty footer
// anchors (with their dot separators) and any CTA table whose button href came
// out site-relative (the domain was blank).
function dropEmptyShellLinks(html) {
  const SEP = '<span[^>]*>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<\\/span>\\s*';
  const A = '<a href="(?:mailto:)?"[^>]*>(?:(?!<\\/a>)[\\s\\S])*?<\\/a>';
  html = html.replace(new RegExp('\\s*' + SEP + A, "g"), "");
  html = html.replace(new RegExp(A + '\\s*' + SEP, "g"), "");
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
//   renderEmail({ clientId, subject, body, preheader?, unsubscribeUrl?, vars?,
//                 footerReason?, docTitle? }) -> html
export function renderEmail({ clientId, subject, body, preheader, unsubscribeUrl, vars, footerReason, docTitle } = {}) {
  const L = locFor(clientId, vars);
  const pre = String(preheader || subject || "").replace(/[<>]/g, "").slice(0, 140);
  const unsub = unsubscribeUrl || (L.email ? `mailto:${L.email}?subject=Unsubscribe` : "");
  // A step body can be a short "template:<key>" reference to a vendored designed
  // email (api/email-templates/) so the DB holds a tiny ref, not 12KB of HTML.
  let raw = String(body || "");
  const tref = raw.match(/^\s*template:([\w/-]+)\s*$/);
  if (tref && TEMPLATES[tref[1]]) raw = TEMPLATES[tref[1]];
  // Resolve merge tokens BEFORE building markup: a resolved URL line becomes the
  // gold CTA in bodyToHtml, and an EMPTY {{location.website}} drops its line
  // while it is still a text line (inside markup it would be too late).
  raw = resolveMergeVars(raw, L, vars);
  const shellArgs = { pre, unsub, reason: footerReason, title: docTitle };
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
