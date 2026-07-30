import { withSentryApiRoute } from "./_sentry.js";
// ─────────────────────────────────────────────────────────────────────────
// Vercel Serverless Function - PUBLIC support ticket intake
//
//   POST /api/public-ticket            submit the form at /ticket
//   GET  /api/public-ticket?token=...  read the tracking page at /ticket/<token>
//
// UNAUTHENTICATED. World reachable. Writes into the staff queue. Read the
// anti-abuse section below before changing anything here.
// ─────────────────────────────────────────────────────────────────────────
//
// WHY THIS ROUTE EXISTS. The form posted straight to PostgREST with the anon
// key, and RLS on `tickets` has exactly one insert policy, scoped to role
// `authenticated`. A logged-out visitor could never insert. Rather than open
// an `anon` policy - which would let anyone write any row the policy's WITH
// CHECK failed to forbid - the table stays closed and this route is the only
// door. Everything a public caller may set is decided in
// api/_public-ticket-intake.js, in code that is read and tested.
//
// The shape (service key, sb() helper, withSentryApiRoute) is copied from
// api/tickets.js, which is the path that has actually created all 213
// existing tickets.
//
// ── ANTI-ABUSE ──────────────────────────────────────────────────────────
//
// An open write endpoint with no throttle is how a support queue becomes
// unusable. What is in place:
//
//   * Three rate limits (api/_public-ticket-intake.js THROTTLE): 3 per hour
//     per IP, 5 per day per email address, and 40 per hour globally. The
//     global one is the one that matters against a distributed flood, where
//     neither of the other two ever trips. Counted by querying the rows this
//     route itself wrote, so there is no second store to keep in sync.
//   * A honeypot field, refused honestly rather than fake-accepted.
//   * Hard size caps: 20 answers, 5000 chars each, 20000 chars total.
//   * Same-origin only. There is deliberately NO CORS header here, so a page
//     on another domain cannot make a browser submit this form.
//   * The raw IP is never stored. Only a salted SHA-256, so the throttle can
//     count without the database holding visitors' addresses.
//
// What is NOT in place, said plainly: no CAPTCHA and no proof-of-work. Both
// need a third-party script and a key, this repo's committed tests run with
// no dependencies and no network, and neither call was mine to make alone.
// The rate limits are the first lever; a CAPTCHA is the next one if they
// prove insufficient. A determined attacker with rotating IPs can still burn
// the global budget of 40/hour - at which point this route refuses everyone
// and says so, rather than filling the queue.
//
// ── A TICKET FROM A STRANGER ────────────────────────────────────────────
//
// Every existing ticket has a client_id. A public submitter may map to no
// academy at all, and nothing here verifies the name or email they typed.
//
// So client_id is left NULL, deliberately, and the ticket is NOT auto-linked
// to an academy by matching the typed email against clients.email. That
// match would be an unauthenticated write into an authenticated tenant's
// queue: anyone who knows an academy's email could put a ticket into that
// academy's portal (api/tickets.js serves the client portal by
// client_id=eq.X). A NULL client_id is also what keeps these tickets out of
// every client's portal view.
//
// NULL must not mean invisible, so the row carries its own identity instead:
//   source           = 'public_form'  (filterable, and new: see the migration)
//   fields.owner_name / fields.email  the name and address they typed, which
//                                     SystemsView already falls back to
//   fields.unverified_contact = true  the staff UI turns this into an
//                                     "unverified" pill rather than the old
//                                     silent "Unknown client"
//   fields.title     = "Public form: ..."  so it reads as public in a list
//
// ── NOT DONE HERE ───────────────────────────────────────────────────────
//
// No confirmation email. The form used to call a Supabase edge function named
// `send-ticket-confirmation`; that function does not exist in this project
// (checked 2026-07-30 - only slack-digest and one-time-media-upload are
// deployed), so it has never sent anything. Wiring Resend instead needs a
// from-address decision: the only configured sender (RESEND_FROM) is one
// academy's address, which is the wrong signature on a generic BAM support
// reply. Left out rather than guessed at. The person still gets their
// reference and their tracking link on screen, and the ticket is real.
// ─────────────────────────────────────────────────────────────────────────

import {
  normalizeSubmission,
  throttleDecision,
  ticketRowFor,
  submitResultFor,
  publicTicketView,
  mintPublicToken,
  hashIp,
  clientIpFrom,
  THROTTLE,
  PUBLIC_TICKET_SOURCE,
} from "./_public-ticket-intake.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Falls back to the service key so the hash is never unsalted, even before
// anyone sets PUBLIC_TICKET_IP_SALT. Rotating the salt only resets the
// throttle window, which is harmless.
const IP_SALT = process.env.PUBLIC_TICKET_IP_SALT || SUPABASE_SERVICE_KEY || "bam-public-ticket";

const HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Count by asking for one row more than the cap and measuring what comes
// back. Cheaper than an exact count and all the decision needs to know is
// "at or over the line".
async function countSince(filter, cap) {
  const rows = await sb(`tickets?source=eq.${PUBLIC_TICKET_SOURCE}&${filter}&select=id&limit=${cap + 1}`);
  return Array.isArray(rows) ? rows.length : 0;
}

async function handleSubmit(req, res) {
  const parsed = normalizeSubmission(req.body);
  if (!parsed.ok) {
    return res.status(parsed.status).json({ error: parsed.error, code: parsed.code });
  }
  const { submission } = parsed;

  const ipHash = hashIp(clientIpFrom(req.headers || {}), IP_SALT);
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [ipCount, emailCount, globalCount] = await Promise.all([
    ipHash
      ? countSince(`fields->>ip_hash=eq.${encodeURIComponent(ipHash)}&submitted_at=gte.${hourAgo}`, THROTTLE.perIpPerHour)
      : Promise.resolve(0),
    countSince(
      `fields->>email=eq.${encodeURIComponent(submission.clientEmail)}&submitted_at=gte.${dayAgo}`,
      THROTTLE.perEmailPerDay,
    ),
    countSince(`submitted_at=gte.${hourAgo}`, THROTTLE.globalPerHour),
  ]);

  const verdict = throttleDecision({ ipCount, emailCount, globalCount });
  if (!verdict.allowed) {
    console.warn(`public-ticket throttled (${verdict.scope}) ip=${ipHash.slice(0, 8)} counts=${ipCount}/${emailCount}/${globalCount}`);
    return res.status(verdict.status).json({ error: verdict.error, code: verdict.code });
  }

  const row = ticketRowFor({ submission, token: mintPublicToken(), ipHash, now: now.toISOString() });

  const inserted = await sb("tickets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const saved = Array.isArray(inserted) ? inserted[0] : inserted;
  const result = submitResultFor(saved);

  // The insert came back without a usable row. Report the failure rather than
  // a reference, which is the whole rule this feature is built on.
  if (!result) {
    console.error("public-ticket insert returned no usable row:", JSON.stringify(saved || null).slice(0, 300));
    return res.status(502).json({ error: "We could not confirm your request was saved.", code: "no_row" });
  }

  return res.status(200).json({ data: result });
}

async function handleTrack(req, res) {
  const token = String(req.query.token || "");
  // base64url, as minted by mintPublicToken. Anything else is not a token we
  // ever issued, so it never reaches the database.
  if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return res.status(404).json({ error: "not found" });
  }
  const rows = await sb(
    `tickets?public_token=eq.${encodeURIComponent(token)}&source=eq.${PUBLIC_TICKET_SOURCE}` +
    `&select=id,status,fields,messages,submitted_at,updated_at&limit=1`,
  );
  const view = publicTicketView(Array.isArray(rows) ? rows[0] : rows);
  if (!view) return res.status(404).json({ error: "not found" });
  return res.status(200).json({ data: view });
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(503).json({ error: "Support intake is not configured.", code: "not_configured" });
    }
    if (req.method === "POST") return await handleSubmit(req, res);
    if (req.method === "GET") return await handleTrack(req, res);
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("public-ticket api error:", err?.message || err);
    return res.status(500).json({ error: "We could not save your request.", code: "server_error" });
  }
}

export default withSentryApiRoute(handler);
