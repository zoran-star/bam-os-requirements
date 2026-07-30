// Test for the PUBLIC ticket intake's server side
// (api/_public-ticket-intake.js, used by api/public-ticket.js).
//
//   node api/_public-ticket-intake.test.mjs      # exits non-zero on any failure
//
// Plain node, house style: no dependencies, no network, no database.
//
// ─── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
//
// The public form has never created a ticket. #1652 made it FAIL honestly; this
// is the path that makes it succeed. It is an unauthenticated, world-reachable
// endpoint that writes into a staff queue, so there are three things worth
// guarding and they are not the same thing:
//
//   1. THE ROW THE DATABASE WILL ACCEPT. Every value tickets_* CHECKs is
//      decided from server constants. Get one wrong and the form is broken
//      again in exactly the way it was already broken twice.
//   2. WHAT A CALLER CANNOT CHOOSE. status, priority, source, client_id, the
//      tracking token and the ip_hash are ours. A public caller that can set
//      any of them can hide a ticket, attach itself to someone else's academy,
//      or pick its own tracking token.
//   3. WHAT A STRANGER HOLDING A TOKEN CAN READ. The tracking view is an
//      allow-list. staff_notes and denial_notes are in the same row.
//
// ─── NEGATIVE CONTROLS ──────────────────────────────────────────────────────
//
//   MUTATE=spreadlast    node api/_public-ticket-intake.test.mjs  # form answers overwrite our own bookkeeping keys
//   MUTATE=clientstatus  node api/_public-ticket-intake.test.mjs  # the caller picks its own status and priority
//   MUTATE=linkbyemail   node api/_public-ticket-intake.test.mjs  # the caller picks which academy the ticket lands in
//   MUTATE=nohoneypot    node api/_public-ticket-intake.test.mjs  # the honeypot is ignored
//   MUTATE=nocap         node api/_public-ticket-intake.test.mjs  # the per-answer size cap is dropped
//   MUTATE=offbyone      node api/_public-ticket-intake.test.mjs  # the throttle lets one extra through
//   MUTATE=noglobal      node api/_public-ticket-intake.test.mjs  # the global circuit breaker is removed
//   MUTATE=leakstaff     node api/_public-ticket-intake.test.mjs  # the tracking view returns the whole row
//   MUTATE=leakinternal  node api/_public-ticket-intake.test.mjs  # internal messages reach the tracking page
//   MUTATE=reftoken      node api/_public-ticket-intake.test.mjs  # a submit result is returned without a token

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE = process.env.MUTATE || "";

let pass = 0;
const fails = [];
const ok = (c, m) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { fails.push(m); console.log("  ❌ " + m); }
};

// A section that THROWS noticed something; it must not take the run down
// before the negative-control banner prints. Same reasoning as
// api/_public-ticket-submit.test.mjs.
async function section(label, fn) {
  console.log(`\n── ${label} ──`);
  try { await fn(); }
  catch (e) { ok(false, `${label}: threw instead of returning a result - ${e && e.message ? e.message : e}`); }
}

// ─── mutated copies, for the negative controls ──────────────────────────────
let controlBroken = null;
let mutantCount = 0;

function mutateText(src, label, edits) {
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in ${label}:\n\n${find}\n\nThe code it was written against has moved or been reformatted, so this control breaks NOTHING and proves nothing. Re-point it at the current code, or delete it - do not leave it, because a control that fails to apply looks exactly like a control that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  return src;
}

async function mutantModule(rel, edits) {
  const abs = path.join(HERE, rel);
  const src = mutateText(fs.readFileSync(abs, "utf8"), `api/${rel}`, edits);
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of api/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

const MODULE_EDITS = {
  // The submitter's answers land on top of our own keys, so a form field named
  // `ip_hash` or `unverified_contact` rewrites the row's bookkeeping.
  spreadlast: [[`      ...fields,\n      title: ticketTitleFor(path, fields),`,
                `      title: ticketTitleFor(path, fields),`],
               [`      ip_hash: ipHash || "",\n    },`,
                `      ip_hash: ipHash || "",\n      ...fields,\n    },`]],
  // Someone decides the caller may pick its own status and priority. Two edits,
  // because it takes both to be a real bug: normalizeSubmission has to carry
  // the value through AND ticketRowFor has to honour it. A control pinned to
  // only the second half was DECORATIVE on the first run - `submission.status`
  // was always undefined, so the mutated code produced the identical row.
  clientstatus: [
    [`  return { ok: true, submission: { clientName, clientEmail, path, fields } };`,
     `  return { ok: true, submission: { clientName, clientEmail, path, fields, status: trim(body.status), priority: trim(body.priority) } };`],
    [`    status: NEW_STATUS,\n    priority: NEW_PRIORITY,`,
     `    status: submission.status || NEW_STATUS,\n    priority: submission.priority || NEW_PRIORITY,`],
  ],
  // The ticket is attached to whatever academy the caller names. This is the
  // one that would put an unauthenticated stranger's ticket into a real
  // client's portal.
  linkbyemail: [
    [`  return { ok: true, submission: { clientName, clientEmail, path, fields } };`,
     `  return { ok: true, submission: { clientName, clientEmail, path, fields, clientId: trim(body.client_id) } };`],
    [`    client_id: null,`, `    client_id: submission.clientId || null,`],
  ],
  nohoneypot: [[`  if (trim(body[HONEYPOT_FIELD])) {`, `  if (false && trim(body[HONEYPOT_FIELD])) {`]],
  nocap: [[`    if (val.length > LIMITS.fieldValue) return bad("too_long", "One of your answers is too long. Please shorten it.");`,
           `    if (false) return bad("too_long", "One of your answers is too long. Please shorten it.");`]],
  // Every limit becomes "more than" instead of "at least", so exactly one extra
  // submission gets through each window. The quietest possible throttle bug.
  offbyone: [[`  if (globalCount >= limits.globalPerHour) {`, `  if (globalCount > limits.globalPerHour) {`],
             [`  if (ipCount >= limits.perIpPerHour) {`, `  if (ipCount > limits.perIpPerHour) {`],
             [`  if (emailCount >= limits.perEmailPerDay) {`, `  if (emailCount > limits.perEmailPerDay) {`]],
  noglobal: [[`  if (globalCount >= limits.globalPerHour) {`, `  if (false) {`]],
  leakstaff: [[`  return {\n    reference: publicReference(row.id),`, `  return {\n    ...row,\n    reference: publicReference(row.id),`]],
  leakinternal: [[`    .filter((m) => m && !m.internal && (m.direction === "staff_to_client" || m.direction === "client_to_staff"))`,
                  `    .filter((m) => m && (m.direction === "staff_to_client" || m.direction === "client_to_staff"))`]],
  reftoken: [[`  if (!row || !row.id || !row.public_token) return null;`, `  if (!row || !row.id) return null;`]],
};

async function loadModule() {
  const edits = MODULE_EDITS[MUTATE];
  if (edits) return mutantModule("_public-ticket-intake.js", edits);
  return import(pathToFileURL(path.join(HERE, "_public-ticket-intake.js")).href);
}

// ─── fixtures ───────────────────────────────────────────────────────────────
const GOOD = {
  client_name: "Marcus Reid",
  client_email: "Marcus@NorthsideHoops.example",
  path: "Bug/Change",
  fields: {
    "Describe the item": "Booking calendar",
    "Bug or Change": "Bug",
    "Description": "Parents cannot book a trial, the calendar shows no times.",
  },
};
const ROW_ID = "9d3f21ab-77c4-4f1e-b0a2-6e5c0f9d1234";
const NOW = "2026-07-30T12:00:00.000Z";

const rowFrom = (mod, body = GOOD, extra = {}) => {
  const parsed = mod.normalizeSubmission({ ...body, ...extra });
  if (!parsed.ok) throw new Error(`fixture did not validate: ${parsed.error}`);
  return mod.ticketRowFor({ submission: parsed.submission, token: "TOKEN123", ipHash: "abc123", now: NOW });
};

async function main() {
  console.log("\n── The public ticket intake ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const mod = await loadModule();
  const routeSrc = fs.readFileSync(path.join(HERE, "public-ticket.js"), "utf8");
  const migration = fs.readFileSync(
    path.join(HERE, "..", "supabase", "migrations", "20260730T120000_public_ticket_intake.sql"), "utf8");

  // ── 1. THE ROW THE DATABASE WILL ACTUALLY ACCEPT ──────────────────────────
  // Read from production 2026-07-30. The form has been broken twice by a value
  // outside one of these lists ("New", then "Medium"), so they are checked
  // against the constraint definitions themselves, not against intent.
  await section("Every value a CHECK constraint governs is one it permits", async () => {
    const CHECKS = {
      status: ["open", "delegated", "in_progress", "awaiting_client", "in_review",
               "final_review", "needs_rework", "approved", "done", "cancelled"],
      priority: ["urgent", "standard", "low"],
      type: ["error", "change", "build", "onboarding"],
      // 'public_form' only exists once the migration lands, which is why the
      // migration is asserted below rather than assumed.
      source: ["portal", "asana_import", "public_form"],
    };
    const row = rowFrom(mod);
    ok(CHECKS.status.includes(row.status), `status ${JSON.stringify(row.status)} passes tickets_status_check`);
    ok(row.status === "open", "...specifically `open`, the same status api/tickets.js gives a new staff ticket");
    ok(CHECKS.priority.includes(row.priority), `priority ${JSON.stringify(row.priority)} passes tickets_priority_check`);
    ok(row.priority !== "Medium", "`Medium`, which the old client payload sent, is not a priority this database has");
    ok(CHECKS.type.includes(row.type), `type ${JSON.stringify(row.type)} passes tickets_type_check`);
    ok(CHECKS.source.includes(row.source), `source ${JSON.stringify(row.source)} passes tickets_source_check`);

    for (const [name, list] of Object.entries(CHECKS)) {
      const mine = { status: mod.TICKET_STATUSES, priority: mod.TICKET_PRIORITIES, type: mod.TICKET_TYPES, source: mod.TICKET_SOURCES }[name];
      ok(mine.length === list.length && list.every(v => mine.includes(v)),
        `the module's copy of tickets_${name}_check matches the real one, value for value`);
    }

    // Every key must be a real column. This is the PGRST204 wall that stopped
    // the form dead: the old payload named 7 columns that do not exist.
    const REAL_COLUMNS = new Set([
      "id", "client_id", "type", "status", "priority", "fields", "files", "menu_item",
      "assigned_to", "staff_notes", "submitted_at", "updated_at", "resolved_at", "due_date",
      "submitted_by", "delegated_by", "delegated_at", "client_action_request",
      "client_action_response", "client_action_files", "user_guide", "denial_notes",
      "category", "source", "asana_gid", "messages", "submitted_by_staff",
      "public_token", // added by this feature's migration
    ]);
    const unknown = Object.keys(row).filter(k => !REAL_COLUMNS.has(k));
    ok(unknown.length === 0, `every key in the row is a real tickets column (unknown: ${JSON.stringify(unknown)})`);
    const GONE = ["ticket_id", "client_name", "client_email", "path", "description", "red_alert"];
    ok(GONE.every(k => !(k in row)), "none of the 6 phantom columns the old payload sent survive into the row");

    // The one column that is NOT in production yet has to arrive with a
    // migration, or this row 400s exactly like the old one.
    ok(/add column if not exists public_token/i.test(migration),
      "the migration adds public_token, the only column here production does not have yet");
    ok(/check \(source in \('portal', 'asana_import', 'public_form'\)\)/i.test(migration),
      "...and widens tickets_source_check to permit public_form");
  });

  // ── 2. WHAT A PUBLIC CALLER CANNOT CHOOSE ─────────────────────────────────
  // This endpoint takes a body from anyone on the internet.
  await section("A caller cannot set what is ours to set", async () => {
    const hostile = {
      ...GOOD,
      status: "done", priority: "urgent", source: "portal", type: "onboarding",
      client_id: "39875f07-0a4b-4429-a201-2249bc1f24df",
      public_token: "chosen-by-the-caller",
      submitted_by_staff: "someone",
      fields: { ...GOOD.fields, ip_hash: "not-mine", unverified_contact: false, title: "Looks internal", owner_name: "Someone Else" },
    };
    const parsed = mod.normalizeSubmission(hostile);
    ok(parsed.ok === true, "a hostile body still validates - the defence is what we ignore, not a rejection");
    const row = mod.ticketRowFor({ submission: parsed.submission, token: "SERVER-TOKEN", ipHash: "server-hash", now: NOW });

    ok(row.status === "open", "a caller asking for status `done` gets `open` (a done ticket is a hidden ticket)");
    ok(row.priority === "standard", "a caller asking for `urgent` gets `standard`");
    ok(row.source === "public_form", "a caller claiming source `portal` is still recorded as public_form");
    ok(row.type === "error", "the type comes from the form path, not from the body");
    ok(row.client_id === null, "a caller naming a real academy's client_id is not attached to it");
    ok(row.public_token === "SERVER-TOKEN", "the token is the server's, never the one the caller sent");
    ok(!("submitted_by_staff" in row), "a caller cannot claim a staff author");
    ok(row.fields.ip_hash === "server-hash", "a form field named ip_hash cannot overwrite the real one");
    ok(row.fields.unverified_contact === true, "...nor can one named unverified_contact clear the flag staff read");
    ok(row.fields.owner_name === "Marcus Reid", "...nor can one named owner_name replace the name they typed");
    ok(row.fields.title.startsWith("Public form:"), "...nor can one named title disguise it as an internal ticket");

    // The route must not hand PostgREST anything but the row this module built.
    ok(/ticketRowFor\(\{ submission,/.test(routeSrc) && !/JSON\.stringify\(req\.body/.test(routeSrc),
      "api/public-ticket.js inserts the row this module built, never the request body");
    // The wall RLS puts in front of an anonymous insert is walked around by
    // this route, not knocked down. A policy here would reopen it for every
    // caller forever, including ones this route never sees.
    ok(!/create\s+policy/i.test(migration) && !/to\s+anon\b/i.test(migration),
      "the migration creates no policy and grants nothing to `anon` - RLS stays shut and the route is the only door");
  });

  // ── 3. VALIDATION, INCLUDING THE SIZE CAPS ────────────────────────────────
  await section("Junk, floods and the honeypot are refused", async () => {
    const rejects = [
      ["no body at all", null],
      ["a name that is only spaces", { ...GOOD, client_name: "   " }],
      ["an address that is not one", { ...GOOD, client_email: "marcus at northside" }],
      ["a request type we do not have", { ...GOOD, path: "Something Else" }],
      ["a missing required answer", { ...GOOD, fields: { "Describe the item": "Calendar" } }],
      ["fields sent as an array", { ...GOOD, fields: ["nope"] }],
      ["a 6000 character answer", { ...GOOD, fields: { ...GOOD.fields, Description: "x".repeat(6000) } }],
      ["30 answers", { ...GOOD, fields: Object.fromEntries([...Array(30)].map((_, i) => [`q${i}`, "a"]).concat(Object.entries(GOOD.fields))) }],
      ["the honeypot filled in", { ...GOOD, [mod.HONEYPOT_FIELD]: "https://spam.example" }],
    ];
    for (const [label, body] of rejects) {
      const out = mod.normalizeSubmission(body);
      ok(out.ok === false, `${label} -> refused`);
      ok(out.status === 400 && !!out.error, `${label} -> a 400 with something a person can read`);
    }
    ok(mod.normalizeSubmission(GOOD).ok === true, "and a real submission is still accepted");

    // A honeypot trip is an honest refusal, not a fake success. A password
    // manager can autofill a hidden field, and telling a person their request
    // was received when it was not is the bug this whole feature undoes.
    const hp = mod.normalizeSubmission({ ...GOOD, [mod.HONEYPOT_FIELD]: "x" });
    ok(hp.ok === false, "the honeypot refuses rather than pretending to accept");

    const clean = mod.normalizeSubmission(GOOD);
    ok(clean.submission.clientEmail === "marcus@northsidehoops.example",
      "the email is lower-cased, so the per-email rate limit cannot be dodged with capital letters");
    const withBlanks = mod.normalizeSubmission({ ...GOOD, fields: { ...GOOD.fields, Extra: "   " } });
    ok(!("Extra" in withBlanks.submission.fields), "blank answers are dropped rather than stored as empty");
  });

  // ── 4. THE THROTTLE ───────────────────────────────────────────────────────
  // An open write endpoint with no throttle is how a support queue becomes
  // unusable. Checked at the exact boundary, because "roughly limited" is not
  // a limit.
  await section("The rate limits bite at the number they say", async () => {
    const L = mod.THROTTLE;
    ok(L.perIpPerHour > 0 && L.perEmailPerDay > 0 && L.globalPerHour > 0, "all three limits are real numbers");

    ok(mod.throttleDecision({ ipCount: L.perIpPerHour - 1 }).allowed === true,
      `the ${L.perIpPerHour}th submission from one IP in an hour is allowed`);
    const ipHit = mod.throttleDecision({ ipCount: L.perIpPerHour });
    ok(ipHit.allowed === false && ipHit.status === 429 && ipHit.scope === "ip",
      `...and the ${L.perIpPerHour + 1}th is a 429`);

    ok(mod.throttleDecision({ emailCount: L.perEmailPerDay - 1 }).allowed === true,
      `the ${L.perEmailPerDay}th submission from one address in a day is allowed`);
    const mailHit = mod.throttleDecision({ emailCount: L.perEmailPerDay });
    ok(mailHit.allowed === false && mailHit.scope === "email", "...and the next one is refused");

    // The one that matters against a flood from many addresses, where neither
    // of the other two ever trips.
    ok(mod.throttleDecision({ globalCount: L.globalPerHour - 1 }).allowed === true,
      `${L.globalPerHour - 1} public tickets in an hour still lets one through`);
    const globalHit = mod.throttleDecision({ globalCount: L.globalPerHour, ipCount: 0, emailCount: 0 });
    ok(globalHit.allowed === false && globalHit.scope === "global",
      "a distributed flood is stopped by the global limit even with a clean IP and a fresh address");

    for (const hit of [ipHit, mailHit, globalHit]) {
      ok(hit.code === "throttled", "a refusal is reported as `throttled`, distinctly from a broken write");
      // Unicode escape rather than the character, so this file is not the one
      // place in the repo carrying a literal em dash to test for it.
      ok(!/\u2014/.test(hit.error) && hit.error.length > 20, "...with plain-language copy and no em dash in it");
      ok(/email/i.test(hit.error), "...that points at the route to a human that is still open");
    }

    // The route has to actually consult it, or all of the above is a module
    // nobody calls.
    ok(/throttleDecision\(\{ ipCount, emailCount, globalCount \}\)/.test(routeSrc),
      "api/public-ticket.js asks throttleDecision before it inserts");
    ok(routeSrc.indexOf("throttleDecision") < routeSrc.indexOf('sb("tickets"'),
      "...and asks BEFORE the insert, not after");
    ok(/hashIp\(clientIpFrom/.test(routeSrc) && !/ip:\s*ip\b/.test(routeSrc),
      "the route counts by a hash of the IP, and never stores the address itself");
  });

  // ── 5. THE TRACKING PAGE ──────────────────────────────────────────────────
  // /ticket/<token> is read by anyone holding a URL that can be forwarded,
  // pasted into a chat, or sit in a browser history.
  await section("A token holder sees their ticket and nothing else", async () => {
    const dbRow = {
      id: ROW_ID,
      status: "in_progress",
      client_id: "39875f07-0a4b-4429-a201-2249bc1f24df",
      staff_notes: "SECRETNOTE this one is probably a duplicate of the Oakville thing",
      denial_notes: "SECRETDENIAL rejected once already",
      assigned_to: "SECRETSTAFFID",
      user_guide: "SECRETGUIDE",
      fields: {
        description: "Parents cannot book a trial.",
        path: "Bug/Change",
        email: "marcus@northsidehoops.example",
        ip_hash: "SECRETIPHASH",
        owner_name: "Marcus Reid",
      },
      messages: [
        { direction: "staff_to_client", body: "We are looking into it.", created_at: "2026-07-30T13:00:00Z" },
        { direction: "client_to_staff", body: "Thanks.", created_at: "2026-07-30T14:00:00Z" },
        { direction: "staff_to_client", body: "SECRETINTERNAL escalate to Cole", internal: true, created_at: "2026-07-30T15:00:00Z" },
      ],
      submitted_at: NOW,
      updated_at: NOW,
    };
    const view = mod.publicTicketView(dbRow);
    const json = JSON.stringify(view);

    ok(!!view && view.reference === "TKT-9D3F21AB", "the reference is derived from the row's own uuid");
    ok(view.stage === "In progress" && view.stageIndex === 1, "an in_progress ticket reads as In progress");
    ok(view.messages.length === 2, "the two client-facing messages come through");

    for (const secret of ["SECRETNOTE", "SECRETDENIAL", "SECRETSTAFFID", "SECRETGUIDE", "SECRETIPHASH", "SECRETINTERNAL"])
      ok(!json.includes(secret), `${secret} does not reach the tracking page`);
    ok(!json.includes("39875f07"), "neither does the client_id");
    ok(!json.includes("marcus@northsidehoops.example"), "neither does the submitter's email address");

    // Every real status maps to a stage, so the page can never render a
    // progress bar with nothing lit.
    for (const s of mod.TICKET_STATUSES) {
      const i = mod.publicStageIndex(s);
      ok(s === "cancelled" ? i === -1 : (i >= 0 && i < mod.PUBLIC_STAGES.length),
        `status \`${s}\` maps to a stage a person can read`);
    }
    ok(mod.publicTicketView({ ...dbRow, status: "cancelled" }).cancelled === true,
      "a cancelled ticket says so instead of showing a progress bar that implies work is moving");
    ok(mod.publicTicketView(null) === null && mod.publicTicketView({}) === null,
      "no row means no view, so the page shows `not found` rather than an empty shell");

    // The link handed out on the success screen must resolve, or it is the
    // same lie as a fake success one click later.
    ok(!!mod.submitResultFor({ id: ROW_ID, public_token: "abc", status: "open", submitted_at: NOW }),
      "a saved row yields a submit result");
    ok(mod.submitResultFor({ id: ROW_ID, status: "open" }) === null,
      "a row with no token yields NOTHING, so no tracking link is ever shown for a ticket that cannot be tracked");
    ok(mod.submitResultFor({ public_token: "abc" }) === null, "and neither does a row with no id");
    ok(mod.submitResultFor(null) === null, "nor does no row at all");
    ok(mod.submitResultFor({ id: ROW_ID, public_token: "abc" }).reference === "TKT-9D3F21AB",
      "the reference on the way out is the same one the tracking page will show");

    // A token that is not one we minted must never become a database query.
    ok(/\^\[A-Za-z0-9_-\]\+\$/.test(routeSrc), "the route rejects anything that is not a base64url token before querying");
    ok(/source=eq\.\$\{PUBLIC_TICKET_SOURCE\}/.test(routeSrc),
      "...and only ever serves public-form tickets, so a token cannot reach a client's ticket");
  });

  // ── 6. A TICKET FROM A STRANGER IS LEGIBLE TO STAFF ───────────────────────
  // client_id NULL is the right call and it is also how a ticket disappears.
  await section("A stranger's ticket is visible, not silently null", async () => {
    const row = rowFrom(mod);
    ok(row.client_id === null, "there is no academy, and none is guessed from the email they typed");
    ok(row.source === "public_form", "the source is what says where it came from");
    ok(row.fields.owner_name === "Marcus Reid" && row.fields.email === "marcus@northsidehoops.example",
      "the name and email land in fields.owner_name / fields.email");
    ok(row.fields.unverified_contact === true, "flagged unverified, because nothing checked either of them");
    ok(row.fields.title.startsWith("Public form:"), "the queue title says `Public form:` so a list row reads as public");

    // SystemsView is where staff actually look. These are the exact reads.
    const systems = fs.readFileSync(path.join(HERE, "..", "src", "views", "SystemsView.jsx"), "utf8");
    ok(/x\.source === "public_form"/.test(systems), "SystemsView knows what a public-form ticket is");
    ok(/Public form \(no academy\)/.test(systems), "...and prints that instead of the old `Unknown client`");
    ok(/Unverified contact/.test(systems), "...and marks the self-reported contact details as unverified");
    ok(/ticket\.fields\?\.owner_name/.test(systems) && /ticket\.fields\?\.email/.test(systems),
      "...and falls back to fields.owner_name / fields.email when there is no client row");
    ok(!/business_name \|\| "Unknown client"/.test(systems),
      "no path is left that still renders a public ticket as `Unknown client`");
  });

  // ── 7. THE ROUTE'S OWN SHAPE ──────────────────────────────────────────────
  await section("The route is the only door, and it is shut to the wrong things", async () => {
    ok(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/.test(routeSrc),
      "the route holds the service key, which is why it can write where the anon key cannot");
    ok(!/Access-Control-Allow-Origin/i.test(routeSrc),
      "there is no CORS header, so another site cannot make a browser submit this form");
    ok(/method not allowed/.test(routeSrc), "anything but GET and POST is refused");
    ok(/withSentryApiRoute/.test(routeSrc), "it is wrapped like every other route in this directory");
    // A 500 must not read as a success, and must not read as the person's fault.
    ok(/code: "no_row"/.test(routeSrc),
      "an insert that comes back without a row reports a failure rather than a reference");
    ok(!/create table[^;]*ticket_messages/i.test(migration),
      "the migration does not create the ticket_messages table the old page imagined - the thread is tickets.messages");
  });

  // ── report ────────────────────────────────────────────────────────────────
  if (MUTATE) {
    if (controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
    const caught = fails.length > 0;
    console.log(caught
      ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught (${fails.length} failure(s)).`
      : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} changed nothing this suite noticed. It is decorative here.`);
    process.exit(caught ? 0 : 1);
  }

  for (const f of fails) console.log(`\n── FAILED: ${f}`);
  console.log(`\n${fails.length ? "❌" : "✅ ALL PASS"}: ${pass} passed, ${fails.length} failed`);
  if (!fails.length) console.log("A stranger can file a ticket, staff can see it is a stranger, and nobody else can read it.\n");
  process.exit(fails.length ? 1 : 0);
}

try { await main(); }
catch (e) {
  if (MUTATE && controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  console.log(`\n❌ suite threw: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
