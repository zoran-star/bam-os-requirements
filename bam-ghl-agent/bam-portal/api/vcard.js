import { withSentryApiRoute } from "./_sentry.js";
// Public contact card (.vcf) for an academy - "save our number" branding.
//
//   GET /api/vcard?c=<client_id>  →  text/vcard download
//
// Tapping the link on a phone offers "Add contact", so the academy's name
// shows on ALL future calls/texts from its number - on every carrier and
// device (this is the 100%-coverage complement to network branded calling,
// which Canada only has in beta on Rogers/Bell). Linked from the missed-call
// text-back. Public by design: it only exposes the academy's business name
// and its own public phone number, and only for academies with an active
// Twilio config.

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

// vCard text escaping per RFC 6350 (commas/semicolons/backslashes/newlines).
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");

async function handler(req, res) {
  const clientId = String(req.query.c || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: "bad id" });

  const cfgs = await sb(
    `client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=from_number&limit=1`
  ).catch(() => []);
  const number = cfgs && cfgs[0] && cfgs[0].from_number;
  if (!number) return res.status(404).json({ error: "not found" });

  const rows = await sb(
    `clients?id=eq.${encodeURIComponent(clientId)}&select=business_name&limit=1`
  ).catch(() => []);
  const name = (rows && rows[0] && rows[0].business_name) || "Our academy";

  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(name)}`,
    `ORG:${esc(name)}`,
    `TEL;TYPE=CELL,VOICE:${esc(number)}`,
    "END:VCARD",
  ].join("\r\n") + "\r\n";

  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contact";
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.vcf"`);
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).send(vcf);
}

export default withSentryApiRoute(handler);
