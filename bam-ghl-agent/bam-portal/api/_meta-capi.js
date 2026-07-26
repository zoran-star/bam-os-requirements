/* ============================================================
   Meta Conversions API - the server-side copy of the browser pixel.

   WHY
   ---
   Meta only counts a landing page view or a lead when the pixel fires in
   the visitor's browser, and on mobile ad traffic the pixel is blocked or
   fails for a large share of real people. BAM GTA's funnel showed 212 ad
   clicks -> 84 Meta "landing page views", while our own first-party beacon
   recorded 173 distinct fbclids over the same window. The visitors were
   real; the browser-only measurement was not.

   The fix is to send the same event from here as well. Every event carries
   an `event_id` that the browser pixel also used, so when both copies
   arrive Meta DEDUPES them into one - which is what makes it safe to send
   both rather than choosing.

   CONFIG (per client, so each academy reports into its own account):
     clients.meta_capi = {
       "pixels": [{ "id": "<pixel id>", "token": "<CAPI access token>" }],
       "test_event_code": "TEST12345"     // optional, Events Manager testing
     }
   No config = no calls. Nothing here is required for a page to work.

   NEVER let this break a request. Every entry point swallows its errors:
   losing an analytics event is fine, losing a lead is not.
   ============================================================ */
import { createHash } from "node:crypto";

const META_API_VERSION = "v22.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;
// Meta is on the critical path of a lead submit, so it gets a short leash.
const TIMEOUT_MS = 2500;

/* ---------- normalisation + hashing (Meta's rules) ---------- */
const sha = (v) => createHash("sha256").update(v).digest("hex");

const normEmail = (v) => String(v || "").trim().toLowerCase();
// Digits only, country code included, no leading +. A 10-digit North American
// number is assumed to be +1, which is what every academy we run ads for uses.
const normPhone = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  return d.length === 10 ? "1" + d : d;
};
const normName = (v) => String(v || "").trim().toLowerCase().replace(/[^a-zÀ-ɏ\s'-]/g, "");

const hashed = (raw, norm) => {
  const v = norm(raw);
  return v ? [sha(v)] : undefined;
};

/* ---------- config ---------- */
export function metaCapiPixels(client) {
  const cfg = client && client.meta_capi;
  if (!cfg || !Array.isArray(cfg.pixels)) return [];
  return cfg.pixels.filter((p) => p && p.id && p.token);
}

/* ---------- request context ---------- */
// Meta matches on IP + user agent when nothing better is available, so pull the
// real client IP rather than Vercel's edge address.
export function requestContext(req) {
  const h = req.headers || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    ip: fwd || String(h["x-real-ip"] || "") || undefined,
    userAgent: String(h["user-agent"] || "") || undefined,
  };
}

// The _fbc cookie is set by fbevents.js from the fbclid, but on the very first
// page view the beacon can fire before that happens. Meta's documented format
// lets us build the same value from the fbclid we already captured, so the
// click still attributes.
export function fbcFromClick(fbc, fbclid, whenMs) {
  if (fbc) return fbc;
  if (!fbclid) return undefined;
  return `fb.1.${whenMs || Date.now()}.${fbclid}`;
}

/* ---------- send ---------- */
/**
 * Fire one event to every pixel the client has configured.
 * Resolves to a small summary; never rejects.
 *
 * @param {{ meta_capi?: any }} client - the clients row (needs meta_capi)
 * @param {Object} event
 * @param {string} event.eventName - 'PageView', 'Lead', ...
 * @param {string} [event.eventId] - the id the browser pixel used, for dedup
 * @param {string} [event.eventSourceUrl]
 * @param {number} [event.eventTime] - ms since epoch; defaults to now
 * @param {string} [event.ip]
 * @param {string} [event.userAgent]
 * @param {string} [event.fbc]
 * @param {string} [event.fbp]
 * @param {string} [event.email]
 * @param {string} [event.phone]
 * @param {string} [event.firstName]
 * @param {string} [event.lastName]
 * @param {Object} [event.customData]
 */
export async function sendMetaEvent(client, {
  eventName,
  eventId,
  eventSourceUrl,
  eventTime,
  ip,
  userAgent,
  fbc,
  fbp,
  email,
  phone,
  firstName,
  lastName,
  customData,
}) {
  const pixels = metaCapiPixels(client);
  if (!pixels.length) return { sent: 0, skipped: "not configured" };

  const user_data = {
    client_ip_address: ip,
    client_user_agent: userAgent,
    fbc: fbc || undefined,
    fbp: fbp || undefined,
    em: hashed(email, normEmail),
    ph: hashed(phone, normPhone),
    fn: hashed(firstName, normName),
    ln: hashed(lastName, normName),
  };
  // Meta rejects an event with no way at all to identify the person.
  if (!Object.values(user_data).some(Boolean)) return { sent: 0, skipped: "no identifiers" };

  const event = {
    event_name: eventName,
    event_time: Math.floor((eventTime || Date.now()) / 1000),
    event_id: eventId || undefined,
    event_source_url: eventSourceUrl || undefined,
    action_source: "website",
    user_data,
    ...(customData ? { custom_data: customData } : {}),
  };
  const testCode = client && client.meta_capi && client.meta_capi.test_event_code;

  let sent = 0;
  await Promise.all(pixels.map(async (p) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(p.id)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          data: [event],
          access_token: p.token,
          ...(testCode ? { test_event_code: testCode } : {}),
        }),
      });
      if (res.ok) { sent++; return; }
      // Log the reason but never surface it: a rejected analytics event must
      // not change what the visitor sees.
      console.error(`[meta-capi] pixel ${p.id} ${eventName} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } catch (e) {
      console.error(`[meta-capi] pixel ${p.id} ${eventName} failed: ${e instanceof Error ? e.message : e}`);
    } finally { clearTimeout(timer); }
  }));

  return { sent, of: pixels.length };
}
