// The submit path behind the PUBLIC support form (src/PublicTicket.jsx, served
// at /ticket by src/main.jsx). Plain JS on purpose: the component is JSX and cannot be
// imported by the plain-node test runner, so everything that decides whether a
// person is told "we got it" lives here, where api/_public-ticket-submit.test.mjs
// can run it for real.
//
// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// The form used to do this:
//
//     try { await supabase.from("tickets").insert([row]); } catch (err) { ... }
//     setStep(3);   // <- the success screen. Unconditionally.
//
// Two failures stacked on top of each other:
//
//   1. The row was rejected. It carried status "New", which the tickets table's
//      CHECK constraint has never permitted (open, delegated, in_progress,
//      awaiting_client, in_review, final_review, needs_rework, approved, done,
//      cancelled). Verified against production 2026-07-30: 213 tickets exist,
//      zero with status "New", so this form has never created one.
//
//   2. Nobody could tell. supabase-js RESOLVES on a PostgREST error - it returns
//      { data, error } rather than throwing - so the catch never ran, the
//      console.error never printed, and the code fell through to a success
//      screen handing out a ticket reference and a /ticket/<token> tracking link
//      for a ticket that did not exist. Someone asking for help was told they
//      had been heard, and nothing was saved.
//
// (2) is the bug that matters. A wrong status value is one outage; a submit path
// that reports success without checking is every future outage, silently. So the
// rule this module enforces is: A REFERENCE IS MINTED ONLY FROM A ROW THE
// DATABASE HANDED BACK. Not from a resolved promise, not from an absent
// exception - from data.
//
// ─── AND THEN HOW IT WAS MADE TO WORK ───────────────────────────────────────
//
// #1652 (the paragraph above) made the failure honest without making the form
// work. Two further walls stood behind the status value, both verified against
// production:
//
//   * The payload named columns the tickets table does not have: ticket_id,
//     public_token, client_name, client_email, path, description, red_alert.
//     An anon POST returned HTTP 400 PGRST204 before the status was evaluated.
//     `priority: "Medium"` also fails its own CHECK (urgent, standard, low).
//   * RLS is enabled on tickets and every INSERT policy is scoped to role
//     `authenticated`. There is no anon policy, so a logged-out visitor cannot
//     insert at all, whatever the payload says. THAT is the wall a payload fix
//     cannot climb.
//
// So the write moved server-side. This module no longer talks to PostgREST: it
// POSTs to /api/public-ticket, which holds the service key (the shape
// api/tickets.js already uses) and decides every value the database CHECKs.
// `db` is now built by makeIntakeDb() below, and the rule is unchanged and, if
// anything, stricter than it was: A REFERENCE AND A TRACKING LINK COME OFF THE
// SAVED ROW OR THEY ARE NOT SHOWN AT ALL. The failure screen #1652 built stays
// exactly where it was, and is still the only thing a failed write can reach.

// Mirrors tickets_status_check in production. If the DB constraint ever changes,
// this list is what the test compares against, so change both together.
export const TICKET_STATUS_VALUES = Object.freeze([
  "open", "delegated", "in_progress", "awaiting_client", "in_review",
  "final_review", "needs_rework", "approved", "done", "cancelled",
]);

// A new ticket starts `open`. Not a guess: api/tickets.js POST writes
// status: "open" for a staff-created ticket ("Lands in 'open' status (delegation
// pool)"), and production currently holds 4 rows in `open` and none in any
// invented status.
export const NEW_TICKET_STATUS = "open";

// Where someone goes when the write fails. This address is already the
// client-facing fallback in public/onboarding.html.
export const SUPPORT_EMAIL = "support@byanymeansbball.com";

export function isAllowedTicketStatus(status) {
  return TICKET_STATUS_VALUES.includes(status);
}

export function describeRequest(path, fields = {}) {
  if (path === "Bug/Change") {
    return fields["Description"] || fields["Describe the item"] || "Support request";
  }
  if (path === "Systems Menu") {
    return `Systems Menu: ${fields["Selected System"] || "not specified"}`;
  }
  return fields["Problem"] || "Custom build request";
}

// The intake route. Same origin, so there is no CORS to configure and no page
// on another domain can make a browser submit this form.
export const INTAKE_ENDPOINT = "/api/public-ticket";

// The input a person never sees and never fills, and a bot fills because it
// fills everything. Must match HONEYPOT_FIELD in api/_public-ticket-intake.js.
// A trip is REFUSED, not fake-accepted: a browser password manager can autofill
// a hidden field too, and telling a human their request was received when it
// was not is the exact bug this whole file exists to undo.
export const HONEYPOT_FIELD = "company_website";

// What goes over the wire to INTAKE_ENDPOINT.
//
// This is a REQUEST, not a row. api/_public-ticket-intake.js builds the actual
// database row from its own constants and ignores anything here that the
// database CHECKs - status, priority, source, client_id and the token are all
// server decisions, and api/_public-ticket-intake.test.mjs proves a caller
// cannot set them. They are still sent, because what this form ASKS for should
// be readable in one place: a new public ticket is `open` and `standard`, the
// same as the staff-created ones in api/tickets.js.
//
// `ticket_id` and `public_token` are the locally minted pair, kept ONLY so the
// failure screen's mailto can quote an attempted reference. The real reference
// is derived from the row's uuid after the insert and the real token is 24
// random bytes from the server; neither is ever this one. `red_alert` is gone
// (no such column, nothing read it) and `priority` is no longer "Medium",
// which was never a value tickets_priority_check allowed.
export function buildTicketRow({ ref, token, clientName, clientEmail, path, fields = {}, submittedAt, honeypot = "" }) {
  return {
    ticket_id: ref,
    public_token: token,
    client_name: clientName,
    client_email: clientEmail,
    path,
    status: NEW_TICKET_STATUS,
    priority: "standard",
    description: describeRequest(path, fields),
    fields,
    submitted_at: submittedAt || new Date().toISOString(),
    [HONEYPOT_FIELD]: honeypot,
  };
}

/**
 * The `db` runTicketSubmit talks to, backed by the intake route.
 *
 * Its whole job is to answer one question honestly: did the server save a row?
 * So the returned data is built from the RESPONSE and never from the request -
 * echoing the row back would make every failure look like a success again,
 * which is the exact bug this file was created for.
 *
 * @param {function} fetchImpl - injected so the test can drive it without a network.
 */
export function makeIntakeDb({ fetchImpl, endpoint = INTAKE_ENDPOINT } = {}) {
  if (typeof fetchImpl !== "function") return null;
  return {
    insert: async (payload) => {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let json = null;
      // A body we cannot read is no proof of anything either way.
      try { json = await res.json(); } catch { json = null; }

      if (!res.ok) {
        return { data: null, error: {
          code: (json && json.code) || `http_${res.status}`,
          message: (json && json.error) || `HTTP ${res.status}`,
        } };
      }
      // 200 with nothing usable in it. Not an error the server reported, but
      // not a row either, so it must land on the no_row branch rather than
      // mint anything.
      const saved = json && json.data;
      if (!saved || !saved.id) return { data: [], error: null };
      return { data: [saved], error: null };
    },
  };
}

// Everything the person typed, in a form a human can act on without the database.
// Used to build the mailto: on the failure screen so a failed write costs them a
// click, not their whole request.
export function supportMailto({ ref, clientName, clientEmail, path, fields = {}, reason }) {
  const lines = [
    "My support request did not save on the website, so I am sending it by email.",
    "",
    `Name: ${clientName || "(not given)"}`,
    `Email: ${clientEmail || "(not given)"}`,
    `Request type: ${path || "(not given)"}`,
    "",
  ];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") lines.push(`${k}: ${v}`);
  }
  lines.push("", `[diagnostic: ${reason || "unknown"}${ref ? ` / attempted ref ${ref}` : ""}]`);
  const subject = `Support request (website submit failed)${clientName ? ` - ${clientName}` : ""}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

// Plain-language copy for each way the write can fail. Never mentions a ticket
// reference, because in every one of these branches there is no ticket.
const FAILURE_COPY = {
  not_configured: "This form could not reach our support system, so nothing was saved.",
  threw: "We could not reach our support system, so your request was not saved.",
  rejected: "Our support system refused to save your request, so nothing was saved.",
  no_row: "We could not confirm your request was saved, so you should assume it was not.",
  no_reference: "We could not confirm your request was saved, so you should assume it was not.",
  // A rate limit. The server already explained which limit in its own words;
  // this is the fallback if it did not.
  throttled: "This request was not submitted because too many have come through recently.",
};

export function failureMessage(reason) {
  return FAILURE_COPY[reason] || FAILURE_COPY.no_row;
}

/**
 * Run the submit. Returns { ok, ticketRef, publicToken, reason, detail, row }.
 *
 * `ok: true` is returned ONLY when the database handed back a row THAT NAMES
 * ITSELF - a reference and a tracking token the server minted. The caller must
 * show the success screen on `ok` and nothing else; a reference or a tracking
 * link shown on any other branch is a lie about saved data.
 *
 * `makeRef` and `makeToken` no longer decide anything a person is shown. They
 * mint a local pair used only for the failure screen's diagnostic, because the
 * server mints the real ones (a uuid-derived reference and 24 random bytes)
 * and only it can prove they exist.
 *
 * @param {object|null} db  - null when there is no way to reach the intake
 *   route at all. Otherwise { insert(payload) -> { data, error },
 *   sendConfirmation?(args) }, as built by makeIntakeDb.
 */
export async function runTicketSubmit({ db, form, makeRef, makeToken, submittedAt }) {
  const ref = makeRef();
  const token = makeToken();
  const row = buildTicketRow({
    ref, token,
    clientName: form.clientName,
    clientEmail: form.clientEmail,
    path: form.path,
    fields: form.fields,
    submittedAt,
    honeypot: form.honeypot,
  });

  const failed = (reason, detail) => ({ ok: false, reason, detail: detail || "", row, ticketRef: "", publicToken: "" });

  if (!db) return failed("not_configured");

  let res;
  try {
    res = await db.insert(row);
  } catch (err) {
    return failed("threw", (err && err.message) || String(err));
  }

  // A rate limit is a refusal like any other - nothing was saved - but it
  // deserves its own copy, because "try again in a minute" is true here and is
  // not true of a rejected write.
  if (res && res.error && res.error.code === "throttled") {
    return failed("throttled", (res.error.message || "throttled"));
  }

  // supabase-js resolves on a PostgREST error instead of throwing. This branch,
  // not the catch above, is the one that fires in production today.
  if (res && res.error) {
    return failed("rejected", (res.error && (res.error.message || res.error.code)) || "rejected");
  }

  // No row came back means no row was written that we can prove. A response
  // the server sent without a usable row lands here too, which is correct: an
  // unproven write must not mint a reference.
  const rows = res && res.data;
  if (!Array.isArray(rows) || rows.length === 0) return failed("no_row");

  // The row has to NAME ITSELF. A reference the server did not mint points at
  // no ticket anyone can look up, and a tracking link built from a token the
  // server did not mint is a link that 404s - which is the same lie as a fake
  // success, just one click later.
  const saved = rows[0];
  const savedRef = saved && saved.reference;
  const savedToken = saved && saved.public_token;
  if (!savedRef || !savedToken) return failed("no_reference");

  // The confirmation email is best effort and NEVER decides the outcome. The
  // ticket exists at this point; a bounced email does not un-write it.
  if (typeof db.sendConfirmation === "function") {
    try {
      await db.sendConfirmation({ email: form.clientEmail, ticketId: savedRef, token: savedToken, clientName: form.clientName });
    } catch (_) { /* best effort */ }
  }

  return { ok: true, ticketRef: savedRef, publicToken: savedToken, reason: "", detail: "", row, saved };
}
