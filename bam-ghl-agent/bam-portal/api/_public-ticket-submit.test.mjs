// Test for the PUBLIC support form's submit path
// (src/publicTicketSubmit.js, used by src/PublicTicket.jsx).
//
//   node api/_public-ticket-submit.test.mjs      # exits non-zero on any failure
//
// Plain node, same style as api/_sync-class.test.mjs: no dependencies, no
// network, no database. The database is a fake object whose insert() returns
// whatever this file tells it to.
//
// ─── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
//
// The public form told people their support request had been received, gave
// them a reference number and a tracking link, and saved nothing. Two bugs
// stacked:
//
//   1. status "New", which the tickets CHECK constraint has never allowed.
//   2. The result was never checked. supabase-js RESOLVES on a PostgREST error,
//      so the try/catch never fired and the code fell straight through to the
//      success screen.
//
// (1) is one outage. (2) is every future outage, invisibly - and (2) is what
// this suite mostly guards. The load-bearing assertion is not "the status
// string is right", it is A FAILED WRITE CANNOT PRODUCE A SUCCESS.
//
// ─── NEGATIVE CONTROLS ──────────────────────────────────────────────────────
//
// Each writes a mutated copy of the real file next to it, imports that, and the
// suite must NOTICE. A control pinned to text that no longer exists reports
// NEGATIVE CONTROL FAILED rather than passing quietly - a control that cannot
// find its target is not "caught".
//
//   MUTATE=statusnew     node api/_public-ticket-submit.test.mjs  # status goes back to "New"
//   MUTATE=swallow       node api/_public-ticket-submit.test.mjs  # a returned PostgREST error is ignored
//   MUTATE=norow         node api/_public-ticket-submit.test.mjs  # an empty insert result counts as success
//   MUTATE=refonfail     node api/_public-ticket-submit.test.mjs  # a failure hands out a ticket reference
//   MUTATE=emailfatal    node api/_public-ticket-submit.test.mjs  # a bounced confirmation email un-does the ticket
//   MUTATE=alwayssuccess node api/_public-ticket-submit.test.mjs  # the component shows screen 3 regardless
//   MUTATE=noselect      node api/_public-ticket-submit.test.mjs  # the component drops .select(), so no row comes back

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const MUTATE = process.env.MUTATE || "";

let pass = 0;
const fails = [];
const ok = (c, m) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { fails.push(m); console.log("  ❌ " + m); }
};

// A section that THROWS is a section that noticed something, not a suite that
// died. Without this a mutation which makes the real code blow up (MUTATE=norow
// dereferences a null result) takes the whole run down before the report is
// printed - and CI, which requires the NEGATIVE CONTROL PASSED banner and
// deliberately does not accept a non-zero exit as proof, would then call a
// working control decorative.
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
  const abs = path.join(SRC, rel);
  const src = mutateText(fs.readFileSync(abs, "utf8"), `src/${rel}`, edits);
  const tmp = path.join(path.dirname(abs), `.mutant-${++mutantCount}-${path.basename(abs)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); }
  catch (e) {
    controlBroken = `MUTATE=${MUTATE} produced a copy of src/${rel} that does not import: ${e && e.message}. The control is testing the mutation, not the code.`;
    throw e;
  }
  finally { try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ } }
}

// Each edit is pinned to the real line it reverts, so it breaks loudly if that
// line is rewritten rather than silently testing nothing.
const MODULE_EDITS = {
  statusnew: [[`export const NEW_TICKET_STATUS = "open";`,
               `export const NEW_TICKET_STATUS = "New";`]],
  swallow:   [[`  if (res && res.error) {\n    return failed("rejected", (res.error && (res.error.message || res.error.code)) || "rejected");\n  }`,
               `  if (false && res && res.error) {\n    return failed("rejected", "rejected");\n  }`]],
  norow:     [[`  if (!Array.isArray(rows) || rows.length === 0) return failed("no_row");`,
               `  if (false) return failed("no_row");`]],
  refonfail: [[`  const failed = (reason, detail) => ({ ok: false, reason, detail: detail || "", row, ticketRef: "", publicToken: "" });`,
               `  const failed = (reason, detail) => ({ ok: false, reason, detail: detail || "", row, ticketRef: ref, publicToken: token });`]],
  emailfatal:[[`    } catch (_) { /* best effort */ }`,
               `    } catch (e) { return failed("threw", (e && e.message) || String(e)); }`]],
};

async function loadModule() {
  const edits = MODULE_EDITS[MUTATE];
  if (edits) return mutantModule("publicTicketSubmit.js", edits);
  return import(pathToFileURL(path.join(SRC, "publicTicketSubmit.js")).href);
}

// The component is JSX and cannot be imported here, so the two things it alone
// controls - branching on the outcome, and asking for the row back - are checked
// as text against the real file.
const COMPONENT_EDITS = {
  alwayssuccess: [[`    if (!outcome.ok) {`, `    if (false && !outcome.ok) {`]],
  noselect:      [[`      insert: (row) => supabase.from("tickets").insert([row]).select(),`,
                   `      insert: (row) => supabase.from("tickets").insert([row]),`]],
};

function loadComponent() {
  const src = fs.readFileSync(path.join(SRC, "PublicTicket.jsx"), "utf8");
  const edits = COMPONENT_EDITS[MUTATE];
  return edits ? mutateText(src, "src/PublicTicket.jsx", edits) : src;
}

// ─── fakes ──────────────────────────────────────────────────────────────────
const FORM = {
  clientName: "Marcus Reid",
  clientEmail: "marcus@northsidehoops.example",
  path: "Bug/Change",
  fields: {
    "Describe the item": "Booking calendar",
    "Bug or Change": "Bug",
    "Description": "Parents cannot book a trial, the calendar shows no times.",
  },
};

const REF = "TKT-404";
const TOKEN = "11111111-2222-4333-8444-555555555555";
const submit = (mod, db, form = FORM) => mod.runTicketSubmit({
  db, form, makeRef: () => REF, makeToken: () => TOKEN,
  submittedAt: "2026-07-30T12:00:00.000Z",
});

// What supabase-js actually returns when PostgREST rejects the row. Not a
// throw - a RESOLVED promise carrying an error. Reproduced against production
// on 2026-07-30 with the real anon key and the payload this form sends:
// HTTP 400, PGRST204, "Could not find the 'client_email' column of 'tickets'".
const REJECTED = {
  data: null,
  error: { code: "PGRST204", message: "Could not find the 'client_email' column of 'tickets' in the schema cache" },
};
const CONSTRAINT_VIOLATION = {
  data: null,
  error: { code: "23514", message: 'new row for relation "tickets" violates check constraint "tickets_status_check"' },
};
const RLS_DENIED = {
  data: null,
  error: { code: "42501", message: 'new row violates row-level security policy for table "tickets"' },
};
const ACCEPTED = { data: [{ id: "row-uuid", status: "open" }], error: null };

async function main() {
  console.log("\n── The public support form's submit path ──");
  if (MUTATE) console.log(`   MUTATE=${MUTATE} - this run is a negative control and MUST be caught.\n`);

  const mod = await loadModule();
  const component = loadComponent();

  // ── 1. A FAILED WRITE CANNOT PRODUCE A SUCCESS ────────────────────────────
  // The bug that matters. Every one of these is a real thing the database does.
  await section("A failed write is never a success", async () => {
  for (const [label, result] of [
    ["a rejected column (PGRST204, what production returns today)", REJECTED],
    ["a violated status CHECK constraint", CONSTRAINT_VIOLATION],
    ["an RLS policy refusing an anonymous insert", RLS_DENIED],
  ]) {
    const out = await submit(mod, { insert: async () => result });
    ok(out.ok === false, `${label} -> ok:false`);
    ok(!out.ticketRef, `${label} -> hands out NO ticket reference`);
    ok(!out.publicToken, `${label} -> hands out NO tracking token`);
    // A RETURNED error must be recognised AS an error, not merely survived. The
    // row check downstream happens to catch these too, so without this the
    // error branch could be deleted and everything above would still pass while
    // the console and the person's diagnostic lost the actual reason.
    ok(out.reason === "rejected", `${label} -> reported as \`rejected\`, not guessed at`);
    ok(String(out.detail || "").includes(result.error.code) || String(out.detail || "").includes(result.error.message),
      `${label} -> the database's own words are kept for the console`);
  }
  });

  await section("The other ways it can fail", async () => {
  {
    // The original code's whole failure model: it only handled a throw. This is
    // still checked, but it was never the branch that fired.
    const out = await submit(mod, { insert: async () => { throw new Error("network down"); } });
    ok(out.ok === false && !out.ticketRef, "the client throwing outright -> ok:false, no reference");
    ok(out.reason === "threw", "...and is reported as `threw`, distinctly from a refusal");
  }
  {
    // No error, but no row either - an unproven write. Must not mint anything.
    const out = await submit(mod, { insert: async () => ({ data: [], error: null }) });
    ok(out.ok === false && !out.ticketRef, "no error but zero rows back -> ok:false, no reference");
  }
  {
    const out = await submit(mod, { insert: async () => ({ data: null, error: null }) });
    ok(out.ok === false && !out.ticketRef, "no error and data null (an insert with no .select()) -> ok:false");
  }
  {
    // Supabase not configured at all. The old code showed the success screen
    // here too, on every environment with the env vars missing.
    const out = await submit(mod, null);
    ok(out.ok === false && !out.ticketRef, "Supabase not configured -> ok:false, no reference");
    ok(out.reason === "not_configured", "...reported as `not_configured`");
  }
  });

  // ── 2. A REAL WRITE STILL SUCCEEDS ────────────────────────────────────────
  await section("...and a real write still succeeds", async () => {
  {
    const seen = [];
    const out = await submit(mod, { insert: async (row) => { seen.push(row); return ACCEPTED; } });
    ok(out.ok === true, "a row the database accepts -> ok:true");
    ok(out.ticketRef === REF && out.publicToken === TOKEN, "...and only then are the reference and token handed out");
    ok(seen.length === 1, "...from exactly one insert");
  }
  {
    // The confirmation email is best effort. A bounced email is not a lost
    // ticket, and must not be reported as one.
    let called = 0;
    const out = await submit(mod, {
      insert: async () => ACCEPTED,
      sendConfirmation: async () => { called++; throw new Error("edge function 500"); },
    });
    ok(called === 1, "the confirmation email is attempted on success");
    ok(out.ok === true && out.ticketRef === REF, "...and a failing confirmation email does NOT un-do a saved ticket");
  }
  {
    let called = 0;
    await submit(mod, { insert: async () => REJECTED, sendConfirmation: async () => { called++; } });
    ok(called === 0, "no confirmation email is sent for a ticket that was not saved");
  }

  });

  // ── 3. THE STATUS VALUE ───────────────────────────────────────────────────
  // Mirrors tickets_status_check as read from production on 2026-07-30.
  await section("The status the row is born with", async () => {
  const DB_CHECK =["open", "delegated", "in_progress", "awaiting_client", "in_review",
                    "final_review", "needs_rework", "approved", "done", "cancelled"];
  {
    const row = mod.buildTicketRow({ ref: REF, token: TOKEN, ...FORM, submittedAt: "2026-07-30T12:00:00.000Z" });
    ok(DB_CHECK.includes(row.status), `the row's status (${JSON.stringify(row.status)}) is one the CHECK constraint permits`);
    ok(row.status === "open", "...specifically `open`, which is what api/tickets.js POST writes for a new ticket");
    ok(!DB_CHECK.includes("New"), "`New` is not a status this database has ever accepted");
    ok(mod.TICKET_STATUS_VALUES.length === DB_CHECK.length &&
       DB_CHECK.every((s) => mod.TICKET_STATUS_VALUES.includes(s)),
      "the module's copy of the constraint matches the real one, value for value");
  }
  {
    // The source of truth is the API that creates tickets the staff side can
    // actually see. If it ever stops starting them at `open`, this form is wrong
    // again and should be told so here.
    const api = fs.readFileSync(path.join(HERE, "tickets.js"), "utf8");
    ok(api.includes(`status: "open"`),
      "api/tickets.js still creates new tickets as `open`, so this form agreeing with it is still correct");
  }

  });

  // ── 4. NOTHING THE PERSON TYPED IS LOST ───────────────────────────────────
  await section("The person keeps a route to a human", async () => {
  {
    const out = await submit(mod, { insert: async () => REJECTED });
    const link = mod.supportMailto({ ...FORM, ref: out.row.ticket_id, reason: out.reason });
    ok(link.startsWith("mailto:"), "the failure screen's escape hatch is a mailto:, which needs nothing we just failed at");
    const body = decodeURIComponent(link);
    for (const v of [FORM.clientName, FORM.clientEmail, FORM.fields["Description"], FORM.fields["Bug or Change"]])
      ok(body.includes(v), `the email carries what they typed: ${JSON.stringify(v.slice(0, 32))}`);
    // The check uses a unicode escape rather than the character itself:
    // the house rule bans the em dash from person-facing copy, and this file
    // should not be the one place in the repo carrying a literal one to test for it.
    ok(mod.failureMessage(out.reason).length > 0 && !/\u2014/.test(mod.failureMessage(out.reason)),
      "there is plain-language copy for the failure, with no em dash in it");
  }

  });

  // ── 5. THE COMPONENT ACTUALLY USES ALL THIS ───────────────────────────────
  // Otherwise everything above is a module nobody calls.
  await section("The component is wired to the outcome", async () => {
  {
    ok(/runTicketSubmit\(/.test(component),
      "PublicTicket.jsx submits through runTicketSubmit rather than its own inline insert");
    ok(/\.insert\(\[row\]\)\.select\(\)/.test(component),
      "...and asks for the inserted row back with .select(), or nothing could ever prove a write happened");
    ok(/if \(!outcome\.ok\) \{[\s\S]{0,400}?setStep\(4\);\s*\n\s*return;/.test(component),
      "a failed outcome routes to the not-saved screen and returns");
    // The single most important line in the component: setStep(3) must be
    // unreachable when the outcome is not ok.
    const afterGuard = component.slice(component.indexOf("if (!outcome.ok)"));
    const successHop = afterGuard.indexOf("setStep(3)");
    const guardReturn = afterGuard.indexOf("return;");
    ok(successHop > -1 && guardReturn > -1 && guardReturn < successHop,
      "the success screen sits AFTER the failure branch returns, so it cannot be reached by a failed write");
    ok((component.match(/setStep\(3\)/g) || []).length === 1,
      "there is exactly one way to reach the success screen");
    ok(/setTicketRef\(outcome\.ticketRef\)/.test(component) && !/setTicketRef\(ref\)/.test(component),
      "the reference shown comes from the outcome, not from an id minted before the insert was attempted");
  }
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
  if (!fails.length) console.log("Nobody is told their support request was received unless a row came back.\n");
  process.exit(fails.length ? 1 : 0);
}

try { await main(); }
catch (e) {
  if (MUTATE && controlBroken) { console.log(`\n❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  console.log(`\n❌ suite threw: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
