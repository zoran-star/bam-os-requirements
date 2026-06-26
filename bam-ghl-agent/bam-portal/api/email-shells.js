// Branded email shell(s) for portal-native automation emails. An automation EMAIL
// step carries ONLY the message text; the send layer (api/_send.js) wraps that text
// in the academy's shell so every email is on-brand. Email clients strip external
// CSS and custom fonts, so the shell is table-based with FULLY INLINED styles and
// web-safe font fallbacks.
//
// GTA brand: gold #E2DD9F, black #0A0A0A, Anton (display) + Inter Tight (body).
// FROM: By Any Means Toronto <info@byanymeanstoronto.com>. One shell for now (GTA);
// keyed per academy later via shellFor().

const GTA_SHELL = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>By Any Means</title>
</head>
<body style="margin:0;padding:0;background:#111111;font-family:'Inter Tight',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">{{PREHEADER}}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;">
      <tr><td style="background:#0A0A0A;padding:22px 28px;border-bottom:4px solid #E2DD9F;">
        <span style="font-family:'Anton','Arial Black',Arial,sans-serif;font-size:26px;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">BY ANY MEANS</span><span style="font-family:'Anton','Arial Black',Arial,sans-serif;font-size:26px;color:#E2DD9F;">.</span>
      </td></tr>
      <tr><td style="padding:34px 28px 10px;color:#1a1a1a;font-size:16px;line-height:1.6;font-family:'Inter Tight',Arial,Helvetica,sans-serif;">
        {{CONTENT}}
      </td></tr>
      <tr><td style="padding:6px 28px 30px;"><div style="height:3px;width:46px;background:#E2DD9F;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="background:#0A0A0A;padding:22px 28px;color:#8a8a8a;font-size:12px;line-height:1.6;font-family:'Inter Tight',Arial,Helvetica,sans-serif;">
        <strong style="color:#E2DD9F;">By Any Means Toronto</strong><br>
        Youth and high-school basketball training in Oakville and the GTA.<br>
        <a href="https://byanymeanstoronto.ca" style="color:#bdbdbd;text-decoration:underline;">byanymeanstoronto.ca</a>
        &nbsp;&middot;&nbsp;
        <a href="{{UNSUBSCRIBE}}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

// Pick the shell for an academy. One brand for now; extend the map per client_id.
export function shellFor(/* clientId */) {
  return GTA_SHELL;
}

// Convert a step's plain-text body into simple inline-styled HTML. Staff-authored
// content is trusted (it may carry a link or {{merge}} var), so we do NOT escape -
// we just turn blank lines into paragraphs and single newlines into <br>. A bare
// URL on its own line becomes a gold button so the call-to-action stands out.
function bodyToHtml(body) {
  const P = `margin:0 0 16px;color:#1a1a1a;font-size:16px;line-height:1.6;`;
  const blocks = String(body || "").trim().split(/\n{2,}/);
  return blocks.map((blk) => {
    const t = blk.trim();
    if (/^https?:\/\/\S+$/.test(t)) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;"><tr><td style="background:#E2DD9F;"><a href="${t}" style="display:inline-block;padding:13px 26px;font-family:'Anton','Arial Black',Arial,sans-serif;font-size:15px;letter-spacing:.5px;text-transform:uppercase;color:#0A0A0A;text-decoration:none;">Get started &rarr;</a></td></tr></table>`;
    }
    return `<p style="${P}">${t.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

// Render a full branded email: wrap the step body in the academy's shell.
//   renderEmail({ clientId, subject, body, preheader?, unsubscribeUrl? }) -> html
export function renderEmail({ clientId, subject, body, preheader, unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl || "mailto:info@byanymeanstoronto.com?subject=Unsubscribe";
  return shellFor(clientId)
    .replace("{{CONTENT}}", bodyToHtml(body))
    .replace("{{PREHEADER}}", String(preheader || subject || "").slice(0, 140))
    .replace("{{UNSUBSCRIBE}}", unsub);
}
