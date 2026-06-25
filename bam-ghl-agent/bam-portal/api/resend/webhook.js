// Resend event webhook - records email delivery events and maintains the
// suppression list. Resend signs webhooks with Svix; we verify the signature,
// upsert an email_events row, and on a hard bounce / complaint / unsubscribe add
// the recipient to email_suppressions so api/_email.js never emails them again.
//
//   POST /api/resend/webhook   (Svix-signed by Resend)
//
// Env: RESEND_WEBHOOK_SECRET = the signing secret from the Resend dashboard
// (format "whsec_<base64>"). If unset, we accept + log "unverified" so the
// endpoint doesn't hard-fail before it's configured; if set, a bad signature is 401.

import crypto from "crypto";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET       = process.env.RESEND_WEBHOOK_SECRET;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Svix signature verification. The signed content is `${id}.${timestamp}.${body}`,
// HMAC-SHA256'd with the base64-decoded secret (minus the "whsec_" prefix), then
// base64-encoded. The svix-signature header is a space-separated list of
// "v1,<sig>" entries; a match against any one passes.
function verifySvix(rawBody, headers, secret) {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader || !secret) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${rawBody}`).digest("base64");
  const expectedBuf = Buffer.from(expected);
  for (const part of String(sigHeader).split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) return true;
  }
  return false;
}

const norm = (e) => String(e || "").trim().toLowerCase();

// Pull recipient address(es) from a Resend event payload, defensively.
function recipientsOf(data) {
  if (!data) return [];
  const out = [];
  if (Array.isArray(data.to)) out.push(...data.to);
  else if (data.to) out.push(data.to);
  if (data.email) out.push(data.email);
  return [...new Set(out.map(norm).filter(Boolean))];
}

// A bounce we should suppress on: hard / permanent. If the type is missing we
// suppress anyway (a bounce is a strong negative signal for deliverability).
function isHardBounce(data) {
  const t = norm(data && (data.bounce?.type || data.bounceType || data.type));
  if (!t) return true;
  return /permanent|hard|block|suppress/.test(t);
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const rawBody = await readRawBody(req);

  if (WEBHOOK_SECRET) {
    if (!verifySvix(rawBody, req.headers, WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "invalid signature" });
    }
  } else {
    console.warn("[resend/webhook] RESEND_WEBHOOK_SECRET unset - accepting event UNVERIFIED");
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch (_) { return res.status(400).json({ error: "bad JSON" }); }

  const type = event.type || event.event || "unknown";   // e.g. "email.bounced"
  const data = event.data || event;
  const emails = recipientsOf(data);
  const providerId = data.email_id || data.id || null;

  // Record one event row per recipient (usually one).
  try {
    const rows = (emails.length ? emails : [null]).map(email => ({
      email, provider_message_id: providerId, type, payload: event,
    }));
    await sb(`email_events`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  } catch (e) { console.error("[resend/webhook] event insert failed:", e.message); }

  // Suppress on hard bounce / complaint / unsubscribe.
  const suppress =
    (type === "email.bounced" && isHardBounce(data)) ||
    type === "email.complained" ||
    /unsubscrib|spam|complaint/.test(norm(type));
  if (suppress && emails.length) {
    try {
      const reason = type.replace(/^email\./, "");
      await sb(`email_suppressions?on_conflict=email`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(emails.map(email => ({ email, reason }))),
      });
    } catch (e) { console.error("[resend/webhook] suppression upsert failed:", e.message); }
  }

  return res.status(200).json({ ok: true });
}

export default handler;
