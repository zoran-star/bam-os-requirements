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
// ─── WHAT THIS FIX DOES NOT DO ──────────────────────────────────────────────
//
// It does not make the form work. Verified against production, two further walls
// stand behind the status value, and neither is a one-line fix:
//
//   * The payload names columns the tickets table does not have: ticket_id,
//     public_token, client_name, client_email, path, description, red_alert.
//     An anon POST of the current payload returns HTTP 400 PGRST204 "Could not
//     find the 'client_email' column of 'tickets' in the schema cache" - the
//     status value is never even reached. The table also has type and source as
//     NOT NULL, which the payload omits, and priority "Medium" fails its own
//     CHECK (urgent, standard, low).
//   * RLS is enabled on tickets and every INSERT policy is scoped to role
//     `authenticated` with client_id IN my_client_ids(). There is no anon policy.
//     A logged-out visitor cannot insert at all, whatever the payload says.
//
// Making this form create real tickets therefore needs a server-side route
// holding the service key (the shape api/tickets.js already uses) plus a
// migration for the tracking columns and the missing ticket_messages table.
// That is a data-model build, not a bug fix, and it is deliberately not done
// here. Until it lands, this module's job is to make the failure HONEST: the
// person is told plainly that it did not save, and handed a route to a human
// that does not depend on any of the above working.

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

export function buildTicketRow({ ref, token, clientName, clientEmail, path, fields = {}, submittedAt }) {
  return {
    ticket_id: ref,
    public_token: token,
    client_name: clientName,
    client_email: clientEmail,
    path,
    status: NEW_TICKET_STATUS,
    priority: "Medium",
    description: describeRequest(path, fields),
    fields,
    submitted_at: submittedAt || new Date().toISOString(),
    red_alert: false,
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
};

export function failureMessage(reason) {
  return FAILURE_COPY[reason] || FAILURE_COPY.no_row;
}

/**
 * Run the submit. Returns { ok, ticketRef, publicToken, reason, detail, row }.
 *
 * `ok: true` is returned ONLY when the database handed back a row. The caller
 * must show the success screen on `ok` and nothing else - a reference or a
 * tracking link shown on any other branch is a lie about saved data.
 *
 * @param {object|null} db  - null when Supabase is not configured. Otherwise
 *   { insert(row) -> { data, error }, sendConfirmation?(args) }. `insert` must
 *   select the inserted row back, or there is no proof it exists.
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
  });

  const failed = (reason, detail) => ({ ok: false, reason, detail: detail || "", row, ticketRef: "", publicToken: "" });

  if (!db) return failed("not_configured");

  let res;
  try {
    res = await db.insert(row);
  } catch (err) {
    return failed("threw", (err && err.message) || String(err));
  }

  // supabase-js resolves on a PostgREST error instead of throwing. This branch,
  // not the catch above, is the one that fires in production today.
  if (res && res.error) {
    return failed("rejected", (res.error && (res.error.message || res.error.code)) || "rejected");
  }

  // No row came back means no row was written that we can prove. `.insert()`
  // without `.select()` also lands here, which is correct: an unproven write
  // must not mint a reference.
  const rows = res && res.data;
  if (!Array.isArray(rows) || rows.length === 0) return failed("no_row");

  // The confirmation email is best effort and NEVER decides the outcome. The
  // ticket exists at this point; a bounced email does not un-write it.
  if (typeof db.sendConfirmation === "function") {
    try {
      await db.sendConfirmation({ email: form.clientEmail, ticketId: ref, token, clientName: form.clientName });
    } catch (_) { /* best effort */ }
  }

  return { ok: true, ticketRef: ref, publicToken: token, reason: "", detail: "", row, saved: rows[0] };
}
