// ─────────────────────────────────────────────────────────────────────────
// api/_public-ticket-intake.js - everything the PUBLIC ticket form's intake
// decides, with no network and no database in it.
// ─────────────────────────────────────────────────────────────────────────
//
// WHY A SEPARATE MODULE. api/public-ticket.js is the Vercel route: it holds
// the service key and talks to PostgREST, so it cannot be imported by a
// plain-node test. Every judgement the route makes - is this submission
// acceptable, what row does it become, is this sender flooding us, what may a
// stranger holding a tracking token see - lives here instead, where
// api/_public-ticket-intake.test.mjs runs it for real.
//
// WHY THE ROUTE EXISTS AT ALL. The public form (src/PublicTicket.jsx) posted
// straight to PostgREST with the anon key. Three walls, all verified against
// production on 2026-07-30:
//
//   1. The payload named 7 columns `tickets` does not have, so the insert
//      returned 400 PGRST204 before the status value was even evaluated.
//   2. RLS is on and `tickets` has exactly ONE insert policy, scoped to role
//      `authenticated`. A logged-out visitor cannot insert, whatever the
//      payload says. This is the wall a payload fix cannot climb.
//   3. status "New", which tickets_status_check has never permitted (fixed
//      in #1652).
//
// So the write moves server-side onto the service key, which is the shape
// api/tickets.js already uses. NOTE WHAT THIS DOES NOT DO: it does not open
// an `anon` RLS policy on `tickets`. The table stays closed to the public
// role, and this route is the only door. That way the rules about what a
// stranger may write are code we can read and test, not a policy expression.
//
// 213 tickets existed when this was written. NONE came from this form.

import crypto from "node:crypto";

// ── What the database will actually accept ───────────────────────────────
// Read from production 2026-07-30. If a CHECK constraint changes, change the
// matching list here; the test compares the two.

// tickets_source_check. 'public_form' is ADDED by
// supabase/migrations/20260730T120000_public_ticket_intake.sql and does not
// exist in production until that migration is applied.
export const TICKET_SOURCES = Object.freeze(["portal", "asana_import", "public_form"]);
export const PUBLIC_TICKET_SOURCE = "public_form";

// tickets_type_check
export const TICKET_TYPES = Object.freeze(["error", "change", "build", "onboarding"]);
// tickets_priority_check. The old client payload sent "Medium", which is not
// in this list and never was.
export const TICKET_PRIORITIES = Object.freeze(["urgent", "standard", "low"]);
// tickets_status_check
export const TICKET_STATUSES = Object.freeze([
  "open", "delegated", "in_progress", "awaiting_client", "in_review",
  "final_review", "needs_rework", "approved", "done", "cancelled",
]);

// A public ticket is born exactly like a staff-created one (api/tickets.js
// POST) so it lands in the same delegation pool and nobody has to remember a
// second set of rules.
export const NEW_STATUS = "open";
export const NEW_PRIORITY = "standard";

// ── The three routes through the form (src/PublicTicket.jsx pathOptions) ──
export const TICKET_PATHS = Object.freeze(["Bug/Change", "Systems Menu", "Custom Build"]);

// Mirrors isFormValid() in the component. Validated again here because the
// component's copy is advice to a browser, not a rule.
const REQUIRED_FIELDS = Object.freeze({
  "Bug/Change": ["Describe the item", "Bug or Change", "Description"],
  "Systems Menu": ["Selected System"],
  "Custom Build": ["Category", "Problem", "Who it's for"],
});

// ── Size caps ────────────────────────────────────────────────────────────
// An unauthenticated write endpoint with no caps is a way to put a megabyte
// of someone else's text into a staff queue, 40 times an hour.
export const LIMITS = Object.freeze({
  name: 200,
  email: 200,
  fieldKey: 120,
  fieldValue: 5000,
  fieldCount: 20,
  totalChars: 20000,
});

// ── Throttle ─────────────────────────────────────────────────────────────
// Three independent limits, because each stops a different thing:
//   perIpPerHour   - one machine hammering the form
//   perEmailPerDay - one person resubmitting in frustration (and a bot that
//                    rotates IPs but not its filler address)
//   globalPerHour  - a distributed flood, where neither of the above bites.
//                    Without this last one the queue is still drownable.
export const THROTTLE = Object.freeze({
  perIpPerHour: 3,
  perEmailPerDay: 5,
  globalPerHour: 40,
});

// The field a human never sees and never fills. Bots fill every input they
// find. See the note on `honeypot` in normalizeSubmission for why a trip is
// an honest refusal rather than a fake success.
export const HONEYPOT_FIELD = "company_website";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const trim = (v) => str(v).trim();

/**
 * Validate and clean what the browser posted.
 * Returns { ok: true, submission } or { ok: false, status, code, error }.
 *
 * Nothing here trusts the client: it re-checks the same rules the component
 * checks, plus the ones the component has no reason to care about (size,
 * shape, the honeypot).
 */
export function normalizeSubmission(body) {
  const bad = (code, error, status = 400) => ({ ok: false, status, code, error });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("bad_request", "We could not read your request.");
  }

  // Honeypot. A trip is refused, NOT silently accepted. The usual trick is to
  // show a bot a success screen so it stops retrying, but a browser password
  // manager can autofill a hidden field too, and telling a person their
  // request was received when it was not is the exact bug this whole route
  // exists to undo. A refused human sees the failure screen and the email
  // fallback, which costs them a click. A lied-to human loses the request.
  if (trim(body[HONEYPOT_FIELD])) {
    return bad("rejected", "This request looked automated, so it was not submitted.");
  }

  const clientName = trim(body.client_name ?? body.clientName);
  const clientEmail = trim(body.client_email ?? body.clientEmail).toLowerCase();
  const path = trim(body.path);

  if (!clientName) return bad("bad_request", "A name is required.");
  if (clientName.length > LIMITS.name) return bad("too_long", "That name is too long.");
  if (!clientEmail) return bad("bad_request", "An email address is required.");
  if (clientEmail.length > LIMITS.email) return bad("too_long", "That email address is too long.");
  if (!EMAIL_RE.test(clientEmail)) return bad("bad_request", "That email address does not look right.");
  if (!TICKET_PATHS.includes(path)) return bad("bad_request", "Pick one of the request types.");

  const raw = body.fields;
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    return bad("bad_request", "We could not read your answers.");
  }

  const fields = {};
  let total = clientName.length + clientEmail.length + path.length;
  let count = 0;
  for (const [k, v] of Object.entries(raw || {})) {
    const key = trim(k);
    const val = trim(v);
    if (!key || !val) continue;
    if (++count > LIMITS.fieldCount) return bad("too_long", "That is more answers than this form accepts.");
    if (key.length > LIMITS.fieldKey) return bad("too_long", "One of the answers has too long a label.");
    if (val.length > LIMITS.fieldValue) return bad("too_long", "One of your answers is too long. Please shorten it.");
    total += key.length + val.length;
    if (total > LIMITS.totalChars) return bad("too_long", "That request is too long to submit here. Please email it instead.");
    fields[key] = val;
  }

  for (const required of REQUIRED_FIELDS[path]) {
    if (!fields[required]) return bad("bad_request", `Please answer: ${required}`);
  }

  return { ok: true, submission: { clientName, clientEmail, path, fields } };
}

/** Which of the four ticket types a form path becomes. */
export function ticketTypeFor(path, fields = {}) {
  if (path === "Bug/Change") return trim(fields["Bug or Change"]).toLowerCase() === "change" ? "change" : "error";
  return "build";
}

/**
 * The title staff read in the queue. resolveTicketTitle() in
 * src/views/SystemsView.jsx prefers fields.title over everything else, so
 * this is what shows in every list row without touching more UI.
 *
 * The "Public form:" prefix is deliberate. These tickets have no academy
 * behind them and staff should be able to see that at a glance in a list,
 * not only after opening one.
 */
export function ticketTitleFor(path, fields = {}) {
  const subject =
    path === "Bug/Change" ? trim(fields["Describe the item"]) :
    path === "Systems Menu" ? trim(fields["Selected System"]) :
    trim(fields["Category"]);
  const tail = subject ? subject.slice(0, 70) : path;
  return `Public form: ${tail}`;
}

/** The one-line description staff see, and the subject on the tracking page. */
export function describeSubmission(path, fields = {}) {
  if (path === "Bug/Change") return trim(fields["Description"]) || "Support request";
  if (path === "Systems Menu") return `Systems menu request: ${trim(fields["Selected System"]) || "not specified"}`;
  return trim(fields["Problem"]) || "Custom build request";
}

/** A token nobody can guess and nobody but this server can choose. */
export function mintPublicToken(randomBytes = crypto.randomBytes) {
  return randomBytes(24).toString("base64url");
}

/**
 * The human-facing reference, derived from the uuid Postgres generated.
 *
 * The old client-side generator was `TKT-${100..999}` - 900 values for 213
 * existing tickets, so two people would routinely be handed the same
 * "reference". This one is minted from the row itself, after the insert, so
 * it is unique by construction and it names a row that provably exists.
 */
export function publicReference(id) {
  const hex = str(id).replace(/-/g, "").toUpperCase();
  return hex ? `TKT-${hex.slice(0, 8)}` : "";
}

/** Salted one-way hash. The raw IP is never written to the database. */
export function hashIp(ip, salt) {
  const clean = trim(ip);
  if (!clean) return "";
  return crypto.createHash("sha256").update(`${str(salt)}|${clean}`).digest("hex").slice(0, 32);
}

/** First hop of x-forwarded-for, which is the caller on Vercel. */
export function clientIpFrom(headers = {}) {
  const get = (k) => str(headers[k] ?? headers[k.toLowerCase()]);
  const fwd = get("x-forwarded-for");
  if (fwd) return trim(fwd.split(",")[0]);
  return trim(get("x-real-ip"));
}

/**
 * Build the ticket row. Every value the database CHECKs is decided HERE, from
 * the server's own constants - never from the request body. A public caller
 * cannot choose its status, its priority, its source, its client, its token
 * or its ip_hash, and the test proves each one.
 */
export function ticketRowFor({ submission, token, ipHash, now }) {
  const { clientName, clientEmail, path, fields } = submission;
  const at = now || new Date().toISOString();
  return {
    // A public submitter is not a client. Nothing verifies that the name and
    // email belong to anyone, so this ticket is attached to no academy on
    // purpose - see the note in api/public-ticket.js.
    client_id: null,
    type: ticketTypeFor(path, fields),
    status: NEW_STATUS,
    priority: NEW_PRIORITY,
    source: PUBLIC_TICKET_SOURCE,
    menu_item: path === "Systems Menu" ? trim(fields["Selected System"]) || null : null,
    fields: {
      // The submitter's own answers go FIRST so the trusted keys below
      // overwrite them. Otherwise someone could name a form field `ip_hash`
      // or `unverified_contact` and rewrite our own bookkeeping.
      ...fields,
      title: ticketTitleFor(path, fields),
      description: describeSubmission(path, fields),
      path,
      // SystemsView already falls back to fields.owner_name / fields.email
      // when there is no client row, so these two make a stranger's ticket
      // legible on the staff side with no UI change at all.
      owner_name: clientName,
      email: clientEmail,
      submitted_via: PUBLIC_TICKET_SOURCE,
      // The flag the staff UI reads to say "nobody checked that this name and
      // email are real" out loud, instead of showing "Unknown client".
      unverified_contact: true,
      ip_hash: ipHash || "",
    },
    files: [],
    messages: [],
    public_token: token,
    submitted_at: at,
    updated_at: at,
  };
}

/**
 * Decide whether this submission is allowed through, given counts the caller
 * read from the database. Pure so the limits can be tested at their exact
 * boundaries without inserting 40 tickets.
 */
export function throttleDecision({ ipCount = 0, emailCount = 0, globalCount = 0, limits = THROTTLE } = {}) {
  if (globalCount >= limits.globalPerHour) {
    return {
      allowed: false, code: "throttled", status: 429, scope: "global",
      error: "We are receiving an unusual number of requests right now, so this one was not submitted. Please email us instead.",
    };
  }
  if (ipCount >= limits.perIpPerHour) {
    return {
      allowed: false, code: "throttled", status: 429, scope: "ip",
      error: "You have sent several requests in the last hour, so this one was not submitted. Please email us instead.",
    };
  }
  if (emailCount >= limits.perEmailPerDay) {
    return {
      allowed: false, code: "throttled", status: 429, scope: "email",
      error: "This address has sent several requests today, so this one was not submitted. Please email us instead.",
    };
  }
  return { allowed: true };
}

// ── The tracking page ────────────────────────────────────────────────────
//
// /ticket/<token> used to read a `public_token` column and a `ticket_messages`
// table. Neither existed - the column is added by this feature's migration and
// the table never existed at all, so the page has never shown a real ticket.
// The thread it wanted is already in `tickets.messages` (jsonb), which is what
// api/tickets.js and the client portal both use, so there is no new table.

export const PUBLIC_STAGES = Object.freeze(["Received", "In progress", "Waiting on you", "Complete"]);

const STAGE_BY_STATUS = Object.freeze({
  open: 0, delegated: 0,
  in_progress: 1, in_review: 1, needs_rework: 1,
  awaiting_client: 2, final_review: 2,
  done: 3, approved: 3,
});

/** -1 means the ticket is closed without completing (cancelled). */
export function publicStageIndex(status) {
  if (status === "cancelled") return -1;
  const i = STAGE_BY_STATUS[status];
  return i === undefined ? 0 : i;
}

/**
 * What a stranger holding a tracking token is allowed to see.
 *
 * ALLOW-LIST, never a redaction pass. The row carries staff_notes,
 * denial_notes, assignee ids, the client_id, and the submitter's own hashed
 * IP; a token in a URL can be forwarded, pasted into a support chat or sit in
 * a browser history, so this returns only fields chosen one at a time. The
 * test asserts that none of the sensitive values survive JSON.stringify of
 * the result.
 */
export function publicTicketView(row) {
  if (!row || !row.id) return null;
  const fields = (row.fields && typeof row.fields === "object") ? row.fields : {};
  const stageIndex = publicStageIndex(row.status);
  const messages = (Array.isArray(row.messages) ? row.messages : [])
    // Only the two directions that are part of the conversation, and never a
    // message flagged internal.
    .filter((m) => m && !m.internal && (m.direction === "staff_to_client" || m.direction === "client_to_staff"))
    .filter((m) => trim(m.body))
    .map((m) => ({
      from: m.direction === "staff_to_client" ? "BAM" : "You",
      body: trim(m.body),
      at: str(m.created_at),
    }));

  return {
    reference: publicReference(row.id),
    subject: trim(fields.description) || "Support request",
    path: trim(fields.path),
    stages: PUBLIC_STAGES.slice(),
    stageIndex,
    stage: stageIndex < 0 ? "Closed" : PUBLIC_STAGES[stageIndex],
    cancelled: row.status === "cancelled",
    complete: stageIndex === PUBLIC_STAGES.length - 1,
    submittedAt: str(row.submitted_at),
    updatedAt: str(row.updated_at),
    messages,
  };
}

/**
 * What the browser gets back from a successful submit. The reference and the
 * token both come off the SAVED row, so the client physically cannot show a
 * reference or a tracking link for a ticket that was not written.
 */
export function submitResultFor(row) {
  if (!row || !row.id || !row.public_token) return null;
  return {
    id: row.id,
    reference: publicReference(row.id),
    public_token: row.public_token,
    status: row.status,
    submitted_at: str(row.submitted_at),
  };
}
