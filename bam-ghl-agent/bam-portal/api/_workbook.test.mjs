// THE OWNER-FACING WORKBOOK ROUTE: api/workbook.js, with no network and no
// database.
//
//   node api/_workbook.test.mjs
//
// WHAT THIS PROVES
//   1. THE THREE VALUES ARE NEVER CONFLATED. current_value is what the portal
//      stores today, proposed is what we showed the owner, answered is what came
//      back. Staff review compares current_value against ANSWERED - so a San
//      Jose card the owner merely CONFIRMS, without editing, records as
//      'changed' and gets `answered` written down. Three of his four plan names
//      differ between current and proposed; a confirm that recorded 'confirmed'
//      with a null answered would hide three renames.
//   2. CONFIRMATION IS A DELIBERATE ACT. 'confirmed' can only be produced by the
//      confirm action, and an autosave that merely echoes `proposed` back leaves
//      the card 'untouched'. The page prefills every field from proposed and
//      autosaves constantly, so without that rule an UNREAD card would flip to
//      'changed' by itself - and 'changed' satisfies the submit gate. An unread
//      card would then serialize exactly like an approved one.
//   3. NO PARTIAL SUBMIT, but a half-filled workbook still SAVES. Only the
//      submit transition is gated, and it is gated on states RECOMPUTED from the
//      live rows rather than trusted from the state column.
//   4. A SUBMITTED OR VOID WORKBOOK IS READ-ONLY - and a void one is a 404 that
//      is byte-identical to an unknown token, so a leaked link cannot be used to
//      learn that it was ever real.
//   5. THE TOKEN IS NEVER ECHOED: not in a success body, not in a refusal, not
//      in an error, not in a log line - including when the token arrives back
//      inside a message we did not write.
//   6. NO CREDENTIAL EVER REACHES A RESPONSE BODY. A service key with an
//      embedded line break is refused before it can become a header (undici
//      would throw a TypeError QUOTING THE WHOLE HEADER, and that error has no
//      .status), while a key whose only sin is a trailing newline is TRIMMED AND
//      USED - production's SUPABASE_SERVICE_KEY carries exactly that today, and
//      refusing it would turn a paste artifact into an outage.
//   7. Minting a second workbook of the same kind cannot silently orphan the
//      first: an OPEN one is voided and named, a SUBMITTED one refuses the mint.
//
// WHAT IT DOES NOT PROVE
//   - That any of this works against real Postgres. Supabase is an in-memory
//     PostgREST-shaped stub; RLS, constraints and the unique index on token are
//     the database's job and are not exercised here.
//   - That the page sends what this route expects. The contract is asserted from
//     this side only.
//   - Anything about applying a submitted workbook to live configuration. No
//     apply path exists yet.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks ONE guarantee; the suite must PRINT
// "NEGATIVE CONTROL PASSED". A silent non-zero exit is not a report.
//
//   MUTATE=partialsubmit       node api/_workbook.test.mjs
//       the submit gate is deleted, so a workbook with untouched cards is
//       accepted and enters staff review looking complete.
//   MUTATE=confirmblind        node api/_workbook.test.mjs
//       confirm stops comparing against current_value and always records
//       'confirmed' - the San Jose rename, confirmed without editing, recorded
//       as an untouched row. This is the exact bug the schema exists to prevent.
//   MUTATE=confirmnomaterialize node api/_workbook.test.mjs
//       confirm no longer writes `answered` from `proposed`, so staff review
//       opens the workbook and finds null where the owner's answer should be.
//   MUTATE=submittededitable   node api/_workbook.test.mjs
//       the read-only check is removed, so a late autosave rewrites an answer
//       under a reviewer after the owner pressed Send.
//   MUTATE=tokenecho           node api/_workbook.test.mjs
//       the workbook token is included in the GET response - the whole
//       credential, in the body, for a surface with no login.
//   MUTATE=rawcredential       node api/_workbook.test.mjs
//       all three layers removed at once - the credential guard, the fetch
//       sanitiser, and the catch that only forwards messages we wrote. The
//       runtime's TypeError, quoting the entire Authorization header, reaches
//       the response body exactly as it did the day this shipped. This is the
//       control that proves the two-part canary assertions are alive. Being a
//       THREE-EDIT control, "caught" says nothing about any single layer, which
//       is what the next one is for.
//   MUTATE=noguard             node api/_workbook.test.mjs
//       ONLY the credential guard is removed. Nothing leaks - the other two
//       layers hold - so what has to catch it is the assertion that the broken
//       credential was never handed to fetch at all. Refused BEFORE the wire and
//       refused BY the wire are indistinguishable without it.
//   MUTATE=echoacts            node api/_workbook.test.mjs
//       every save counts as acting on the card, so the page's own autosave
//       flips an unread card to 'changed' and it passes the submit gate.
//   MUTATE=voidreadable        node api/_workbook.test.mjs
//       a voided workbook resolves normally - revocation is the entire
//       mitigation for the no-login link, so this is that mitigation deleted.
//   MUTATE=crosscard           node api/_workbook.test.mjs
//       save silently skips an answer id it does not own instead of refusing.
//   MUTATE=orphanmint          node api/_workbook.test.mjs
//       create mints a second workbook of the same kind with no rule at all:
//       the open link stays live and a submitted one is orphaned behind a new
//       one nobody reviews.
//   MUTATE=metawritable        node api/_workbook.test.mjs
//       a save payload's `meta` is passed through to the write, so a computed
//       presentation fact becomes something an owner can author - and it comes
//       back out indistinguishable from something he confirmed.
//   MUTATE=dropnulls           node api/_workbook.test.mjs
//       the wire shape stops sending null fields. current_value null means "the
//       portal stores NOTHING for this row", which is what the page draws its
//       "new" badge from - and its only source where the meta column is absent.
//   MUTATE=latewrite           node api/_workbook.test.mjs
//       the check-after-write is deleted, so a save that was legal when its
//       status was checked and illegal by the time it wrote KEEPS its value
//       inside the submitted workbook. This is the ordering hole that
//       MUTATE=submittededitable cannot see: that one covers a save that
//       arrives late, this one covers a save already in flight.
//
//   MUTATE=emptycardsdontcount node api/_workbook.test.mjs
//       cardCounts goes back to "has answers", so the denominator GROWS when an
//       addition lands (0-of-7 becomes 5-of-8 under the owner's cursor) and the
//       empty add-a-plan card can ship with nobody able to tell "he was asked
//       and had nothing to add" from "he never looked". (The old
//       MUTATE=emptycardblocks was RETIRED by the D6 ruling: the behaviour it
//       reintroduced - every card counts - is now the correct one.)
//   MUTATE=countsflag          node api/_workbook.test.mjs
//       "does this card count" becomes writable by a card_key or a meta flag, so
//       seeding can make a REAL question invisible to the submit gate. The
//       no-partial-submit ruling defeated from the inside by the people it binds.
//   MUTATE=addkeepsconfirm     node api/_workbook.test.mjs
//       an addition made AFTER a confirm leaves the confirm standing, so an
//       unreviewed request for something we do not sell rides out on a card the
//       gate calls ready.
//   MUTATE=addforeign          node api/_workbook.test.mjs
//       the addition insert takes workbook_id/card_id/client_id from the
//       PAYLOAD, so a link to one academy's workbook drops a row into another's.
//   MUTATE=payloadtarget       node api/_workbook.test.mjs
//       the addition names its own target_table/target_id. That is the whole
//       distance between "he may ask for another rung on this plan" and "this
//       token may aim a write at any row in the database".
//   MUTATE=addcap              node api/_workbook.test.mjs
//       the per-card cap is deleted. A no-login link that can create rows
//       without end is a denial of service on our own database, written by us.
//   MUTATE=addsubmitted        node api/_workbook.test.mjs
//       an addition lands in a workbook the owner already sent.
//   MUTATE=addconfirmed        node api/_workbook.test.mjs
//       a card holding a request for something we do not sell reads "confirmed
//       by you" - the same lie as a rename recorded as an untouched row.
//   MUTATE=ghostremove         node api/_workbook.test.mjs
//       remove becomes a soft clear, so the row survives, still answers the
//       staff "needs creating" query, and gets built by hand later.
//   MUTATE=blankadd            node api/_workbook.test.mjs
//       the same ghost through the autosave door: an addition emptied by a save
//       rather than removed.
//   MUTATE=seeduntrimmed       node api/_workbook.test.mjs
//       the seed's class-twin mapper stops trimming, so a padded class value
//       ("9 ") seeds a padded `proposed`, the owner confirming unedited
//       materialises it as `answered`, and the apply-side translator then
//       rightly refuses " 9" - a refusal manufactured by our own seed. This
//       control pins scripts/seed-sj-age-rows.mjs, not api/workbook.js.
//
// TWENTY-TWO controls: twenty-one over the route in three families, plus the
// seed-side seeduntrimmed above. The route's: PRODUCT rules (partialsubmit,
// confirmblind, confirmnomaterialize, submittededitable, echoacts, orphanmint,
// metawritable, dropnulls, addconfirmed, ghostremove, blankadd), DISCLOSURE AND
// BLAST RADIUS (tokenecho, voidreadable, crosscard, rawcredential, noguard,
// addforeign, payloadtarget, addcap, addsubmitted) and ORDERING (latewrite,
// and the addition half of it inside section 12). A pin that no longer matches
// the source reports NEGATIVE CONTROL FAILED rather than passing quietly - which
// is not theoretical: rewriting a comment on the echo-is-not-an-act line broke
// echoacts' pin during this build, and that is how it was noticed.
//
// A control run exits ZERO when the mutation IS caught. CI greps for the banner
// and for the MUTATE= names above, not for the exit code.
//
// MEASURED CATCH COUNTS - controls added or re-pointed in the 2026-08-06
// remediation pass, each run and counted on that date (re-measure and update
// this block whenever one of THESE pins moves; the older controls keep their
// proof in CI, which runs every name and greps for the banner):
//   seeduntrimmed -> 4 failures (the padded, whitespace-only and newline/tab
//                    mapper pins, and the tAgeStrOrEmpty round trip)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── env, BEFORE the module import ────────────────────────────────────────────
const SB_BASE = "https://stub.supabase.test";
process.env.SUPABASE_URL = SB_BASE;
process.env.VITE_SUPABASE_URL = SB_BASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.SUPABASE_SERVICE_KEY;

let pass = 0, fail = 0;
const failures = [];
let controlBroken = null;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// Everything printed by the suite AND by the route is teed here; the token and
// credential assertions read it.
let consoleBuffer = "";
for (const m of ["log", "info", "warn", "error", "debug"]) {
  const real = console[m].bind(console);
  console[m] = (...args) => { consoleBuffer += args.map(String).join(" ") + "\n"; real(...args); };
}

// ── importing the route (real file, or a pinned mutant copy) ─────────────────
const tmpFiles = [];
const cleanup = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } };
process.on("exit", cleanup);

// api/workbook.js imports api/_sentry.js, which imports @sentry/node. A worktree
// has no node_modules, so when the package cannot be resolved the suite runs a
// copy with that ONE import replaced by an identity wrapper - and says so out
// loud, because a suite that quietly tests a different file than it claims is
// its own kind of leak. Everywhere node_modules exists, the real file is
// imported untouched.
let sentryOk = true;
try { await import("@sentry/node"); } catch (_) { sentryOk = false; }
const SENTRY_IMPORT = 'import { withSentryApiRoute } from "./_sentry.js";';
const SENTRY_STUB = 'const withSentryApiRoute = (h) => h; // (suite) @sentry/node is not installed here';

function copyWith(edits) {
  let src = fs.readFileSync(path.join(HERE, "workbook.js"), "utf8");
  for (const [find, repl] of edits) {
    if (!src.includes(find)) {
      controlBroken = `MUTATE=${MUTATE} is pinned to text that is no longer in api/workbook.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    src = src.split(find).join(repl);
  }
  const copy = path.join(HERE, ".mutant-workbook.js");
  fs.writeFileSync(copy, src);
  tmpFiles.push(copy);
  return copy;
}

// ── the mutations ────────────────────────────────────────────────────────────
const PARTIALSUBMIT = [[
  `  if (remaining) {
    return {
      ok: false,
      error: remaining === 1`,
  `  if (false && remaining) {          // (control partialsubmit) the gate is gone
    return {
      ok: false,
      error: remaining === 1`]];

const CONFIRMBLIND = [[
  `  const state = cardState({ ...card, confirmed_at: confirmedAt }, mine, true);`,
  `  const state = "confirmed"; // (control confirmblind) current_value is never consulted`]];

const CONFIRMNOMATERIALIZE = [[
  `    if (isAddition(a) || !isBlank(a.answered)) continue;`,
  `    if (true) continue; // (control confirmnomaterialize) nothing is written down`]];

const SUBMITTEDEDITABLE = [[
  `function assertEditable(wb) {
  if (OPEN_STATES.has(wb.status)) return;`,
  `function assertEditable(wb) {
  if (true || OPEN_STATES.has(wb.status)) return; // (control submittededitable)`]];

const TOKENECHO = [[
  `      return res.status(200).json({
        ok: true,
        workbook: {
          id: wb.id,`,
  `      return res.status(200).json({
        ok: true,
        token,                          // (control tokenecho)
        workbook: {
          id: wb.id,`]];

// THREE LAYERS, REMOVED TOGETHER, because each one alone still holds the line
// and the point of this control is to prove the CANARY ASSERTIONS are alive
// rather than decorative: the guard that refuses a broken credential, the
// sanitiser that keeps the runtime's own message out of our errors, and the
// catch that only ever forwards a message we wrote. With all three gone, undici
// throws `Headers.append: "Bearer <the whole key>" is an invalid header value`
// and the route hands it to the caller - which is exactly what shipped once.
const RAWCREDENTIAL = [
  [`  return assertHeaderSafeCredential(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)"
  );`,
   `  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY; // (control rawcredential) guard removed`],
  ["  const res = await safeFetch(", "  const res = await fetch("],
  [`    console.error("workbook unexpected error:", scrub((e && e.stack) || String(e), token));
    return res.status(500).json({ ok: false, error: "something went wrong on our side. Please try again." });`,
   `    return res.status(500).json({ ok: false, error: e && e.message }); // (control rawcredential) the repeater is back`],
];

// ONE LAYER, ALONE. `rawcredential` removes three things at once, so "caught"
// from it is a single bit of information spread across three claims. This one
// removes ONLY the guard: the sanitiser still keeps the runtime's message out of
// the error and the catch still refuses to forward it, so nothing leaks - and
// the assertion that has to earn its keep is the one saying the broken
// credential was never handed to fetch in the first place. Without a control at
// this granularity, "refused BEFORE the wire" and "refused BY the wire" look
// identical from the outside.
const NOGUARD = [[
  `  return assertHeaderSafeCredential(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    "the Supabase service key (SUPABASE_SERVICE_ROLE_KEY)"
  );`,
  `  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY; // (control noguard) only the guard is gone`]];

const ECHOACTS = [[
  `    if (!jsonEqual(value, row.proposed)) actedNow = true;
    await sb(\`workbook_answers?id=eq.\${enc(row.id)}`,
  `    actedNow = true; // (control echoacts) any save counts as acting on the card
    await sb(\`workbook_answers?id=eq.\${enc(row.id)}`]];

const VOIDREADABLE = [[
  `  if (!wb || wb.status === "void") throw bad("not found", 404);`,
  `  if (!wb) throw bad("not found", 404); // (control voidreadable) a revoked link still opens`]];

const CROSSCARD = [[
  `    if (!row) throw bad("that answer does not belong to this card", 404);`,
  `    if (!row) continue; // (control crosscard) an id we do not own is silently skipped`]];

const ORPHANMINT = [
  [`  if (Array.isArray(blocked) && blocked[0]) {`, `  if (false && Array.isArray(blocked) && blocked[0]) { // (control orphanmint)`],
  [`      body: JSON.stringify({ status: "void", updated_at: nowIso() }),`,
   `      body: JSON.stringify({ updated_at: nowIso() }), // (control orphanmint) the old link stays live`],
];

// PRESENTATION BECOMING AN ANSWER. `meta` carries computed facts the page paints
// around a card - "9 members pay on this plan today" - and if a token-authored
// payload could write it, a computed number would come back out looking exactly
// like something the owner confirmed.
const METAWRITABLE = [[
  `      body: JSON.stringify({ answered: value === undefined ? null : value, updated_at: nowIso() }),`,
  `      body: JSON.stringify({ answered: value === undefined ? null : value, meta: (item || {}).meta, updated_at: nowIso() }), // (control metawritable)`]];

// The check-after-write is removed, so a save that lands after the owner pressed
// Send keeps its value inside the submitted workbook. MUTATE=submittededitable
// covers the refusal of a save that ARRIVES late; this covers the one that was
// already legal when it was checked and became illegal while it wrote - the
// interleaving a status check alone cannot see.
// PINNED THROUGH THE COMMENT ABOVE IT, because doConfirm carries a
// byte-identical settleWrites line and a control that silently patched both
// would report one bit of information about two claims.
const LATEWRITE = [[
  `  // since this is called constantly) costs exactly what it did before.
  let allNow = all;
  if (undo.length) ({ mine, all: allNow } = await settleWrites(wb, card, undo));`,
  `  // since this is called constantly) costs exactly what it did before.
  let allNow = all;   // (control latewrite) no check after the write, so a late save stays`]];

// THE TIDY-UP THAT DELETES A FACT. Omitting null fields from the wire shape
// looks like harmless hygiene and erases the difference between "the portal
// stores NOTHING for this row" and "the key was not sent" - which is what the
// page's "new" badge is derived from, and its only source on a deployment
// without the meta column.
const DROPNULLS = [[
  `  current_value: a.current_value,
  proposed: a.proposed,`,
  `  ...(a.current_value === null ? {} : { current_value: a.current_value }), // (control dropnulls)
  proposed: a.proposed,`]];

// ── the addition controls ────────────────────────────────────────────────────

// THE TOKEN AIMS ITS OWN WRITE. The insert takes workbook_id/card_id from the
// payload, so a link to one academy's workbook can drop a row into another's.
const ADDFOREIGN = [[
  `      workbook_id: wb.id,
      card_id: card.id,
      client_id: wb.client_id,`,
  `      workbook_id: body.workbook_id || wb.id,      // (control addforeign)
      card_id: body.card_id || card.id,
      client_id: body.client_id || wb.client_id,`]];

// THE PAYLOAD NAMES THE TARGET TABLE AND ROW. This is the difference between
// "the owner may ask for another rung on this plan" and "the token may aim a
// write at any row in the database".
const PAYLOADTARGET = [[
  `      target_kind: aim.target_kind,
      target_table: aim.target_table,
      target_id: null,`,
  `      target_kind: body.target_kind || aim.target_kind,   // (control payloadtarget)
      target_table: body.target_table || aim.target_table,
      target_id: body.target_id || null,`]];

// THE CAP IS GONE. A no-login link that can create rows without end is a denial
// of service on our own database, written by us.
const ADDCAP = [[
  `  if (mine.filter(isAddition).length >= MAX_ADD_PER_CARD) {`,
  `  if (false && mine.filter(isAddition).length >= MAX_ADD_PER_CARD) { // (control addcap)`]];

// An addition lands in a workbook the owner already sent.
const ADDSUBMITTED = [[
  `async function doAdd(wb, body) {
  assertEditable(wb);`,
  `async function doAdd(wb, body) {
  // (control addsubmitted) the read-only check is gone`]];

// A card holding a request for something we do not sell reads "confirmed by
// you" - the same lie as a rename recorded as an untouched row.
const ADDCONFIRMED = [[
  `  if (!acted) return "untouched";
  if (added) return "changed";`,
  `  if (!acted) return "untouched";
  // (control addconfirmed) an addition no longer forces 'changed'`]];

// REMOVE BECOMES A SOFT CLEAR. The row survives, still answers the staff
// "needs creating" query, and gets built by hand later - the ghost the ruling
// explicitly refuses.
const GHOSTREMOVE = [[
  `  await sb(
    \`workbook_answers?id=eq.\${enc(target.id)}&card_id=eq.\${enc(card.id)}&workbook_id=eq.\${enc(wb.id)}\`
    + \`&target_field=like.\${enc(ADD_PREFIX)}*&applied_at=is.null\`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } }
  );`,
  `  await sb(\`workbook_answers?id=eq.\${enc(target.id)}\`, {   // (control ghostremove) soft clear
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ answered: "", updated_at: nowIso() }),
  });`]];

// The same ghost through the autosave door: emptying an addition instead of
// removing it.
const BLANKADD = [[
  `    if (isAddition(row)) {
      const what = String(row.target_field).slice(ADD_PREFIX.length);`,
  `    if (false && isAddition(row)) {   // (control blankadd) an addition can be emptied by a save
      const what = String(row.target_field).slice(ADD_PREFIX.length);`]];

// MUTATE=typingisapproving  puts the gate back on the STATE STRING instead of on
// the deliberate act. This is the defect exactly as it shipped: a card the owner
// typed into and never confirmed satisfied "every row has to be confirmed", and
// a real submit went through with confirmed_at null. It was invisible to this
// suite because the suite ASSERTED it as correct, and invisible to the page
// because the page had its own stricter rule - the two halves disagreeing is
// what hid it. Only running the real page against the real database showed it.
const TYPINGISAPPROVING = [[
  `const cardIsReady = (card) => !!(card && card.confirmed_at);`,
  `const READY_STATES_BACK = new Set(["confirmed", "changed"]);   // (control typingisapproving)
const cardIsReady = (card) => READY_STATES_BACK.has(card && card.state);`]];

// MUTATE=confirmsurvivesedit  lets an earlier confirm carry over to a value the
// owner typed AFTERWARDS. He approved one thing and is recorded as approving a
// different one, while the pill on his screen still says "press confirm".
const CONFIRMSURVIVESEDIT = [[
  `  const retire = actedNow && !!card.confirmed_at;`,
  `  const retire = false && actedNow && !!card.confirmed_at;   // (control confirmsurvivesedit)`]];

// ── the counting rule, and the loophole it could become ──────────────────────

// THE DENOMINATOR GROWS AGAIN. cardCounts goes back to "has answers", which is
// the pre-D6 rule: an addition landing on the empty add-a-plan card grows the
// total mid-session, and "he was asked and had nothing to add" becomes
// unrecordable because the empty card never demands its confirm.
const EMPTYCARDSDONTCOUNT = [[
  `const cardCounts = (answers) => true;`,
  `const cardCounts = (answers) => (answers || []).length > 0; // (control emptycardsdontcount) empty cards stop counting`]];

// THE RULE KEYS ON SOMETHING WRITABLE. The moment "does this card count" can be
// set by seeding, a card_key or a meta flag, the no-partial-submit ruling is
// defeated from the inside by the people it binds - a REAL question can be made
// invisible to the gate.
const COUNTSFLAG = [[
  `const cardCounts = (answers) => true;`,
  `const cardCounts = (answers, card) => { // (control countsflag) an exemption anyone can write
  if (card && card.card_key === "plans") return false;
  if (card && card.meta && card.meta.counts === false) return false;
  return true;
};`],
  [`  for (const c of cards) {
    if (!cardCounts(grouped.get(c.id))) continue;`,
   `  for (const c of cards) {
    if (!cardCounts(grouped.get(c.id), c)) continue;`],
  [`    if (!cardCounts(answers)) continue;`,
   `    if (!cardCounts(answers, card)) continue;`]];

// AN ADDITION MADE AFTER A CONFIRM LEAVES THE CONFIRM STANDING, so an
// unreviewed request for something we do not sell rides out on a card the gate
// calls ready. The typing-is-approving defeat, through the door next to it.
const ADDKEEPSCONFIRM = [[
  `  const retire = !!card.confirmed_at;
  const confirmedAt = retire ? null : card.confirmed_at;`,
  `  const retire = false; // (control addkeepsconfirm) adding does not retire the approval
  const confirmedAt = card.confirmed_at;`]];

// The Other-cycle follow-up requirement is gone, so '$85 other' - a request
// staff cannot act on - stores as if it were complete.
const OTHERNOFOLLOWUP = [[
  `    : String(v.billing_cycle || "") === "Other" && !str(v.billing_cycle_other) ? "Please say how often this plan bills before adding it." : ""),`,
  `    : ""),   // (control othernofollowup) the follow-up requirement is gone`]];

const EDITS = {
  partialsubmit: PARTIALSUBMIT, confirmblind: CONFIRMBLIND,
  confirmnomaterialize: CONFIRMNOMATERIALIZE, submittededitable: SUBMITTEDEDITABLE,
  tokenecho: TOKENECHO, rawcredential: RAWCREDENTIAL, noguard: NOGUARD, echoacts: ECHOACTS,
  voidreadable: VOIDREADABLE, crosscard: CROSSCARD, orphanmint: ORPHANMINT,
  metawritable: METAWRITABLE, latewrite: LATEWRITE, dropnulls: DROPNULLS,
  addforeign: ADDFOREIGN, payloadtarget: PAYLOADTARGET, addcap: ADDCAP,
  addsubmitted: ADDSUBMITTED, addconfirmed: ADDCONFIRMED, ghostremove: GHOSTREMOVE,
  emptycardsdontcount: EMPTYCARDSDONTCOUNT, countsflag: COUNTSFLAG, addkeepsconfirm: ADDKEEPSCONFIRM,
  othernofollowup: OTHERNOFOLLOWUP,
  blankadd: BLANKADD, typingisapproving: TYPINGISAPPROVING,
  confirmsurvivesedit: CONFIRMSURVIVESEDIT,
  seeduntrimmed: [],   // pins scripts/seed-sj-age-rows.mjs, not workbook.js - see below
};

const edits = MUTATE
  ? (EDITS[MUTATE] || (() => { controlBroken = `unknown control MUTATE=${MUTATE}`; throw new Error(controlBroken); })())
  : [];
if (!sentryOk) console.log("  (note) @sentry/node is not installed here, so the copy under test has its _sentry import replaced by an identity wrapper. Nothing else is changed.");
const modulePath = (!MUTATE && sentryOk)
  ? path.join(HERE, "workbook.js")
  : copyWith(sentryOk ? edits : [...edits, [SENTRY_IMPORT, SENTRY_STUB]]);

// ── the seed mapper under test (R5) ─────────────────────────────────────────
// scripts/seed-sj-age-rows.mjs gates its script body on being invoked
// directly, so importing it runs NOTHING - the suite gets the pure mapper and
// no Supabase key is ever in sight. MUTATE=seeduntrimmed drops the trim, the
// exact regression that made our own seed manufacture a refusal at apply.
const SEED_PATH = path.join(HERE, "..", "scripts", "seed-sj-age-rows.mjs");
const SEEDUNTRIMMED = [[
  `    const s = String(v).trim();`,
  `    const s = String(v);   // (control seeduntrimmed) the paste artifact survives`]];
let seedModulePath = SEED_PATH;
if (MUTATE === "seeduntrimmed") {
  let seedSrc = fs.readFileSync(SEED_PATH, "utf8");
  for (const [find, repl] of SEEDUNTRIMMED) {
    if (!seedSrc.includes(find)) {
      controlBroken = `MUTATE=seeduntrimmed is pinned to text that is no longer in scripts/seed-sj-age-rows.mjs:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`;
      throw new Error(controlBroken);
    }
    seedSrc = seedSrc.split(find).join(repl);
  }
  seedModulePath = path.join(HERE, ".mutant-seed-sj-age-rows.mjs");
  fs.writeFileSync(seedModulePath, seedSrc);
  tmpFiles.push(seedModulePath);
}
const { proposedFromClass } = await import(pathToFileURL(seedModulePath).href);

// ═════════════════════════════════════════════════════════════════════════════
// ── the in-memory world ──────────────────────────────────────────────────────
//
// A PostgREST-shaped stub: eq / in filters, select projection, order, limit,
// Prefer: return=representation. The projection is honoured on purpose - a
// select that forgets a column the route then reads must break here rather than
// in production - and a select naming a column the table does not have answers
// 400 with PostgREST's own 42703, which is what the optional-`meta` degradation
// is built on.
const TOKEN = "wbk_" + "tok_" + "9Xq7SanJose";
const OTHER_TOKEN = "wbk_" + "tok_" + "otherAcademy";
const STAFF_BEARER = "staff-session-" + "bearer-Kp3";

const TAX_NOW = { charges_tax: true, pct: 9.375, label: "CA sales tax" };
// SAME VALUE, KEYS IN A DIFFERENT ORDER. jsonb does not preserve key order, so
// a comparison that stringified would report a change nobody made.
const TAX_SHOWN = { label: "CA sales tax", pct: 9.375, charges_tax: true };

const COLUMNS = {
  clients: ["id", "public_name", "business_name"],
  staff: ["id", "user_id", "name", "email"],
  workbooks: ["id", "client_id", "kind", "token", "status", "expires_at", "sent_at", "submitted_at", "reviewed_at", "applied_at", "created_by", "created_by_name", "created_at", "updated_at"],
  workbook_cards: ["id", "workbook_id", "card_key", "title", "sort_order", "state", "confirmed_at", "created_at", "updated_at"],
  workbook_answers: ["id", "workbook_id", "card_id", "client_id", "target_kind", "target_table", "target_id", "target_field", "current_value", "proposed", "answered", "applied_at", "apply_error", "created_at", "updated_at"],
};

let DB;
function reset() {
  DB = {
    // public_name is what the owner sees at the top of the page (Zoran, 2026-08-04).
    // business_name is DELIBERATELY different here so a regression back to it fails
    // loudly rather than passing on two columns that happen to match.
    clients: [{ id: "sj", public_name: "By Any Means San Jose", business_name: "BAM San Jose" }],
    staff: [{ id: "staff-1", user_id: "user-1", name: "Zoran", email: "zoran@byanymeansbball.com" }],
    workbooks: [
      { id: "wb1", client_id: "sj", kind: "price", token: TOKEN, status: "sent", submitted_at: null, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z" },
      { id: "wb2", client_id: "sj", kind: "member", token: OTHER_TOKEN, status: "sent", submitted_at: null, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z" },
    ],
    workbook_cards: [
      { id: "c-tax", workbook_id: "wb1", card_key: "tax", title: "Sales tax", sort_order: 0, state: "untouched", confirmed_at: null },
      { id: "c-p1", workbook_id: "wb1", card_key: "plan:p1", title: "Academy 2x/week", sort_order: 1, state: "untouched", confirmed_at: null },
      { id: "c-p2", workbook_id: "wb1", card_key: "plan:p2", title: "Academy Unlimited", sort_order: 2, state: "untouched", confirmed_at: null },
      { id: "c-other", workbook_id: "wb2", card_key: "roster", title: "Roster", sort_order: 0, state: "untouched", confirmed_at: null },
    ],
    workbook_answers: [
      { id: "a-tax", workbook_id: "wb1", card_id: "c-tax", client_id: "sj", target_kind: "academy_setting", target_table: "clients", target_id: "sj", target_field: "tax_config", current_value: TAX_NOW, proposed: TAX_SHOWN, answered: null, applied_at: null, created_at: "2026-08-04T00:00:01Z" },
      // THE SAN JOSE RENAME: the portal stores "2 Trainings/Week", the workbook
      // showed Lij his own Stripe name. Confirming this card without touching it
      // renames the plan.
      { id: "a-p1-title", workbook_id: "wb1", card_id: "c-p1", client_id: "sj", target_kind: "price_row", target_table: "offer_prices", target_id: "p1", target_field: "title", current_value: "2 Trainings/Week", proposed: "Academy 2x/week", answered: null, applied_at: null, created_at: "2026-08-04T00:00:02Z" },
      { id: "a-p1-price", workbook_id: "wb1", card_id: "c-p1", client_id: "sj", target_kind: "price_row", target_table: "offer_prices", target_id: "p1", target_field: "price", current_value: 226, proposed: 226, answered: null, applied_at: null, created_at: "2026-08-04T00:00:03Z" },
      { id: "a-p2-title", workbook_id: "wb1", card_id: "c-p2", client_id: "sj", target_kind: "price_row", target_table: "offer_prices", target_id: "p2", target_field: "title", current_value: "Academy Unlimited", proposed: "Academy Unlimited", answered: null, applied_at: null, created_at: "2026-08-04T00:00:04Z" },
      { id: "a-p2-price", workbook_id: "wb1", card_id: "c-p2", client_id: "sj", target_kind: "price_row", target_table: "offer_prices", target_id: "p2", target_field: "price", current_value: 306, proposed: 306, answered: null, applied_at: null, created_at: "2026-08-04T00:00:05Z" },
      { id: "a-other", workbook_id: "wb2", card_id: "c-other", client_id: "sj", target_kind: "member_row", target_table: "members", target_id: "m1", target_field: "plan", current_value: "Academy 2x/week", proposed: "Academy 2x/week", answered: null, applied_at: null, created_at: "2026-08-04T00:00:06Z" },
    ],
  };
}
reset();

let seq = 0;
const CALLS = [];          // every fetch: { method, url, headers, body }
const httpErr = (code, message) => ({ status: 400, body: { code, message, details: null, hint: null } });

function applyFilters(table, params) {
  let rows = (DB[table] || []).slice();
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const s = String(v);
    if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val); }
    else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter((r) => vals.includes(String(r[k]))); }
    else if (s.startsWith("is.null")) rows = rows.filter((r) => r[k] == null);
    else if (s.startsWith("like.")) {
      // PostgREST spells the wildcard `*` and translates it to SQL's `%`. The
      // delete that removes an addition leans on this filter for its safety, so
      // the stub has to mean the same thing by it that the database does.
      const pat = s.slice(5).split("*").join("%");
      const rx = new RegExp("^" + pat.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      rows = rows.filter((r) => rx.test(String(r[k] == null ? "" : r[k])));
    }
  }
  const lim = parseInt(params.get("limit") || "0", 10);
  return lim > 0 ? rows.slice(0, lim) : rows;
}

function project(table, rows, params) {
  const sel = params.get("select");
  if (!sel) return rows.map((r) => ({ ...r }));
  const cols = sel.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!COLUMNS[table].includes(c)) {
      const e = new Error("undefined column");
      e.pgrst = httpErr("42703", `column ${table}.${c} does not exist`);
      throw e;
    }
  }
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  // RECORDED BEFORE IT IS VALIDATED, and the order is load-bearing. "The
  // credential never reached the wire" means it was never HANDED TO FETCH, so a
  // call that arrives and then throws must still be counted - otherwise removing
  // the guard would look identical to the guard working, because undici's own
  // refusal would erase the evidence of the attempt.
  CALLS.push({ method, url: u, headers: init.headers || {}, body: init.body });
  // THE STUB VALIDATES HEADERS LIKE THE RUNTIME DOES. undici builds a Headers
  // object out of init.headers and its validator throws a TypeError QUOTING the
  // whole offending value - live credential and all. Without this line the
  // credential section below would pass for the wrong reason.
  new Headers(init.headers || {});
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith(`${SB_BASE}/auth/v1/`)) {
    const bearer = String((init.headers || {}).Authorization || "");
    if (bearer !== `Bearer ${STAFF_BEARER}`) return json({ msg: "invalid" }, 401);
    return json({ id: "user-1", email: "zoran@byanymeansbball.com" });
  }
  if (!u.startsWith(`${SB_BASE}/rest/v1/`)) throw new Error(`UNSTUBBED CALL: ${method} ${u}`);

  const [table, qs = ""] = u.slice(`${SB_BASE}/rest/v1/`.length).split("?");
  const params = new URLSearchParams(qs);
  const prefer = String((init.headers || {}).Prefer || "");
  try {
    if (method === "GET") return json(project(table, applyFilters(table, params), params));
    if (method === "PATCH") {
      const patch = init.body ? JSON.parse(init.body) : {};
      const hit = applyFilters(table, params);
      for (const r of hit) Object.assign(r, patch);
      return json(prefer.includes("return=representation") ? project(table, hit, params) : []);
    }
    if (method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      const made = (Array.isArray(rows) ? rows : [rows]).map((r) => {
        const row = { id: `new-${++seq}`, status: "draft", submitted_at: null, created_at: "2026-08-04T12:00:00Z", ...r };
        (DB[table] = DB[table] || []).push(row);
        return row;
      });
      return json(prefer.includes("return=representation") ? project(table, made, params) : []);
    }
    if (method === "DELETE") {
      const hit = applyFilters(table, params);
      const ids = new Set(hit.map((r) => r.id));
      DB[table] = (DB[table] || []).filter((r) => !ids.has(r.id));
      return json(prefer.includes("return=representation") ? hit : []);
    }
  } catch (e) {
    if (e.pgrst) return json(e.pgrst.body, e.pgrst.status);
    throw e;
  }
  return json([]);
};

const WB = await import(pathToFileURL(modulePath).href);

// ── calling the route ────────────────────────────────────────────────────────
async function call(req) {
  let status = 200, body = null;
  const res = {
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
  };
  await WB.default({ headers: {}, ...req }, res);
  return { status, body, text: JSON.stringify(body) };
}
const getWb = (token) => call({ method: "GET", url: `/api/workbook?token=${encodeURIComponent(token)}`, query: { token } });
const post = (body, headers) => call({ method: "POST", url: "/api/workbook", headers: headers || {}, body });
const row = (table, id) => (DB[table] || []).find((r) => r.id === id);
const stateOf = (id) => (row("workbook_cards", id) || {}).state;

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. GET by token: the three values arrive intact, the token does not ──");
{
  const r = await getWb(TOKEN);
  ok(r.status === 200 && r.body.ok === true, "a live token returns the workbook");
  ok(r.body.workbook.academy_name === "By Any Means San Jose" && r.body.workbook.kind === "price" && r.body.workbook.status === "sent",
    "with the academy name, kind and status the page renders from");
  ok(r.body.cards.length === 3 && r.body.cards.map((c) => c.card_key).join(",") === "tax,plan:p1,plan:p2",
    "cards come back in sort_order");
  ok(r.body.cards.every((c) => c.state === "untouched" && c.confirmed_at === null),
    "every card starts 'untouched' - nobody has acted on any of them");

  const title = r.body.cards[1].answers.find((a) => a.target_field === "title");
  ok(!!title && title.current_value === "2 Trainings/Week" && title.proposed === "Academy 2x/week" && title.answered === null,
    "an answer carries current_value, proposed AND answered as three separate fields");
  ok(!!title && title.target_kind === "price_row" && title.target_table === "offer_prices" && title.target_id === "p1",
    "plus the envelope staff review sorts on (target_kind first, blast radius differs)");
  ok(!r.text.includes(TOKEN), "and the TOKEN IS NOWHERE in the response body");
  // The workbook only carries wb2's answers if the token scoping is broken.
  ok(!r.text.includes("a-other") && !r.text.includes("roster"),
    "one token opens exactly one workbook - the academy's OTHER workbook is not in it");

  // A NULL current_value IS A FACT THE PAGE RENDERS, not an empty slot to tidy
  // away. It means the portal stores NOTHING for this row today - a rung BAM
  // proposed that the academy does not sell yet - and the page derives its "new"
  // badge from exactly that, which is how it keeps working on a deployment with
  // no workbook_cards.meta column. So the key must survive the wire present and
  // null: omitted or coerced to "" both erase the distinction between "we store
  // nothing" and "we store an empty value".
  // THE INVARIANT THIS RESTS ON, stated because it lives in the SEEDER, not
  // here: whoever creates the rows must populate current_value for every row
  // that does exist in the portal today, or a live plan silently badges as new.
  row("workbook_answers", "a-p2-price").current_value = null;
  const withNew = await getWb(TOKEN);
  const newRung = withNew.body.cards.find((c) => c.card_key === "plan:p2").answers.find((a) => a.target_field === "price");
  ok(!!newRung && "current_value" in newRung && newRung.current_value === null,
    "an answer the portal stores nothing for keeps current_value PRESENT and null - the page's 'new' badge reads that");
  reset();

  const unknown = await getWb("wbk_" + "no_such_token");
  ok(unknown.status === 404 && unknown.body.ok === false && unknown.body.error === "not found",
    "an unknown token is 404 {ok:false,error:'not found'}");

  row("workbooks", "wb1").status = "void";
  const voided = await getWb(TOKEN);
  ok(voided.status === 404 && JSON.stringify(voided.body) === JSON.stringify(unknown.body),
    "a VOID token answers byte-identically - revoking a link must not confirm it was ever real");
  reset();
}

console.log("\n── 2. save: autosave writes answers and moves nothing toward 'done' ──");
{
  // The page prefills every field from `proposed` and autosaves constantly. That
  // echo is not the owner acting on the card, and if it were, an unread card
  // would satisfy the submit gate by itself.
  const echo = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p1-title", answered: "Academy 2x/week" }] });
  ok(echo.status === 200 && echo.body.ok === true && echo.body.card.state === "untouched",
    "an autosave that merely ECHOES `proposed` back leaves the card 'untouched'");
  ok(row("workbook_answers", "a-p1-title").answered === "Academy 2x/week",
    "the answer is still persisted - a half-filled workbook must survive the owner closing the tab");
  ok(echo.body.remaining === 3, "and remaining still counts all three cards");

  const edit = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p1-title", answered: "Academy Two Sessions" }] });
  ok(edit.body.card.state === "changed" && stateOf("c-p1") === "changed",
    "a save that DIFFERS from what we showed is a real act, and records 'changed'");
  ok(edit.body.card.confirmed_at === null && row("workbook_cards", "c-p1").confirmed_at == null,
    "but a save NEVER stamps confirmed_at - 'confirmed' is only ever the confirm action");
  // THE GATE ASKS FOR THE DELIBERATE ACT, so an EDITED card is NOT ready. This
  // assertion used to say the opposite, and that reading is the defect that was
  // found by driving the real page against the real database: a submit went
  // through carrying a card the owner had typed into and never confirmed, with
  // confirmed_at null. Typing is not approving. The ruling is "every row has to
  // be confirmed", and the page's own pill tells him so - it reads "Changed,
  // press confirm" on exactly this card, so the old gate had the page asking for
  // something the server did not require.
  ok(edit.body.remaining === 3,
    `an edited card does NOT count as ready - he has not confirmed it (remaining ${edit.body.remaining})`);

  // Primitive strictness, on the money field where it matters most.
  const strict = await post({ token: TOKEN, action: "save", card_key: "plan:p2", answers: [{ id: "a-p2-price", answered: "306" }] });
  ok(strict.body.card.state === "changed",
    'the STRING "306" is not the NUMBER 306 - no coercion on a money surface');

  const writes = CALLS.filter((c) => c.method === "PATCH" && c.url.includes("workbook_answers")).map((c) => Object.keys(JSON.parse(c.body)).sort().join(","));
  ok(writes.length > 0 && writes.every((k) => k === "answered,updated_at"),
    "every answer write touches ONLY `answered` - current_value and proposed are ours, not his");

  const before = CALLS.length;
  const cross = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p2-title", answered: "hijacked" }] });
  ok(cross.status === 404 && cross.body.ok === false,
    "an answer id belonging to ANOTHER card is refused, not quietly skipped");
  ok(row("workbook_answers", "a-p2-title").answered === null,
    "and nothing was written to it");
  const otherWb = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-other", answered: "hijacked" }] });
  ok(otherWb.status === 404 && row("workbook_answers", "a-other").answered === null,
    "an id from another WORKBOOK is refused too - the token authorizes one workbook, an id authorizes nothing");
  ok(CALLS.slice(before).every((c) => c.method === "GET"),
    "neither refusal wrote anything at all");

  const noCard = await post({ token: TOKEN, action: "save", card_key: "plan:nope", answers: [] });
  ok(noCard.status === 404, "an unknown card_key is 404");
  reset();
}

console.log("\n── 3. confirm: the deliberate act, and the San Jose rename ──");
{
  // Nothing differs on the tax card: same object, keys in a different order.
  const tax = await post({ token: TOKEN, action: "confirm", card_key: "tax" });
  ok(tax.body.ok === true && tax.body.card.state === "confirmed",
    "a card whose proposal matches what we store records 'confirmed' (key order is not a change)");
  ok(!!tax.body.card.confirmed_at && !!row("workbook_cards", "c-tax").confirmed_at,
    "with confirmed_at stamped - the deliberate act is on the record");
  // Three counted cards; tax is the only one confirmed, so two still block.
  ok(tax.body.remaining === 2, "and remaining drops to 2");

  // THE ONE THAT MATTERS. Lij never touches this card. The portal stores
  // "2 Trainings/Week"; we showed him "Academy 2x/week". Confirming RENAMES the
  // plan, so it may not record as an untouched row.
  const p1 = await post({ token: TOKEN, action: "confirm", card_key: "plan:p1" });
  ok(p1.body.card.state === "changed",
    "a card CONFIRMED WITHOUT EDITING, whose proposal differs from what we store, records 'changed' - not 'confirmed'");
  ok(row("workbook_answers", "a-p1-title").answered === "Academy 2x/week",
    "and `answered` is MATERIALIZED from `proposed`, so staff review compares a value against a value, never against null");
  ok(row("workbook_answers", "a-p1-price").answered === 226,
    "every answer on the card is materialized, including the ones that did not change");
  ok(!!row("workbook_cards", "c-p1").confirmed_at,
    "'changed' still carries confirmed_at - he did act on the card");

  // AND AN EDIT AFTER THAT CONFIRM RETIRES IT. He approved one value, changed
  // his mind, and typed another. The approval was of the OLD value: carrying it
  // over would record him as approving something he never saw, and the pill on
  // his screen would read "Changed, press confirm" while the gate had stopped
  // asking. Found by driving the real page - confirm, then edit, gave remaining 0.
  {
    const after = await post({ token: TOKEN, action: "save", card_key: "plan:p1",
      answers: [{ id: "a-p1-title", answered: "Something else entirely" }] });
    ok(after.body.card.confirmed_at === null && row("workbook_cards", "c-p1").confirmed_at == null,
      "an edit AFTER a confirm retires it - the approval was of the value he replaced");
    ok(after.body.remaining >= 1,
      `and the card goes back to blocking Send until he confirms again (remaining ${after.body.remaining})`);
    // ...but a debounced autosave that changes nothing must NOT retire a real
    // confirm, or simply reopening the page would undo his work.
    await post({ token: TOKEN, action: "confirm", card_key: "plan:p1" });
    const stampedAt = row("workbook_cards", "c-p1").confirmed_at;
    const echo = await post({ token: TOKEN, action: "save", card_key: "plan:p1",
      answers: [{ id: "a-p1-title", answered: "Something else entirely" }] });
    ok(echo.body.card.confirmed_at === stampedAt && row("workbook_cards", "c-p1").confirmed_at === stampedAt,
      "while an autosave that changes nothing leaves the confirm exactly where it was");
  }

  const p2 = await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  ok(p2.body.card.state === "confirmed" && p2.body.remaining === 0,
    "the plan whose proposal matches what we store confirms clean, and remaining reaches 0");

  const gone = await post({ token: TOKEN, action: "confirm", card_key: "plan:nope" });
  ok(gone.status === 404, "confirming a card that does not exist is 404");
  reset();
}

console.log("\n── 4. NO PARTIAL SUBMIT, but a half-filled workbook still saves ──");
{
  await post({ token: TOKEN, action: "confirm", card_key: "tax" });
  await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p1-title", answered: "Academy Two Sessions" }] });

  const refused = await post({ token: TOKEN, action: "submit" });
  // TWO block now, not one: the untouched card, AND the card he edited without
  // confirming. That second one is the whole point - it used to sail through.
  ok(refused.body.ok === false && refused.body.remaining === 2,
    "submit is refused: the untouched card AND the one he edited but never confirmed");
  ok(refused.status === 200,
    "answered as 200 with ok:false, so the page can render `remaining` instead of a fetch wrapper throwing on a 4xx");
  ok(typeof refused.body.error === "string" && !refused.body.error.includes("—"),
    `and the refusal is owner-facing copy with no em dash ("${refused.body.error}")`);
  ok(row("workbooks", "wb1").status === "sent" && row("workbooks", "wb1").submitted_at == null,
    "and nothing moved: the workbook is still 'sent' with no submitted_at");

  const saveAfter = await post({ token: TOKEN, action: "save", card_key: "plan:p2", answers: [{ id: "a-p2-title", answered: "Academy Unlimited" }] });
  ok(saveAfter.body.ok === true, "a refused submit does not lock the workbook - saving still works");

  await post({ token: TOKEN, action: "confirm", card_key: "plan:p1" });
  await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  const sent = await post({ token: TOKEN, action: "submit" });
  ok(sent.body.ok === true && sent.body.remaining === 0, "with every card confirmed or changed, submit succeeds");
  ok(row("workbooks", "wb1").status === "submitted" && !!row("workbooks", "wb1").submitted_at,
    "and the workbook is 'submitted' with submitted_at stamped");
  ok(!sent.text.includes(TOKEN), "the success body still carries no token");

  // THE GATE IS RECOMPUTED FROM THE LIVE ROWS, never trusted from the state
  // column. Here every card is hand-set to 'confirmed' with NO confirmed_at -
  // the shape a bad backfill, a half-finished migration or a direct SQL edit
  // would leave. 'confirmed' cannot survive without the act that produces it, so
  // the two cards with nothing differing fall back to 'untouched' and block;
  // plan:p1 recomputes to 'changed' because its proposal really does differ.
  reset();
  for (const c of DB.workbook_cards) if (c.workbook_id === "wb1") { c.state = "confirmed"; c.confirmed_at = null; }
  const stale = await post({ token: TOKEN, action: "submit" });
  ok(stale.body.ok === false && stale.body.remaining === 3,
    `a 'confirmed' with no confirmed_at behind it blocks - the act is the record, not the label (remaining ${stale.body.remaining})`);
  ok(stateOf("c-tax") === "untouched" && stateOf("c-p2") === "untouched",
    "and the recomputed states are WRITTEN BACK, so staff review never reads the fiction either");
  reset();

  DB.workbook_cards = DB.workbook_cards.filter((c) => c.workbook_id !== "wb1");
  const empty = await post({ token: TOKEN, action: "submit" });
  ok(empty.body.ok === false && /nothing in this workbook/i.test(empty.body.error),
    "a workbook with no cards refuses to submit rather than sailing through with remaining 0");
  reset();
}

console.log("\n── 5. a submitted workbook is READ-ONLY ──");
{
  row("workbooks", "wb1").status = "submitted";
  row("workbooks", "wb1").submitted_at = "2026-08-04T11:00:00Z";
  const before = CALLS.length;

  const save = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p1-title", answered: "late edit" }] });
  ok(save.body.ok === false && save.status === 409, "save is refused on a submitted workbook");
  ok(row("workbook_answers", "a-p1-title").answered === null, "and the late edit was not written");
  const confirm = await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  ok(confirm.body.ok === false && stateOf("c-p2") === "untouched", "confirm is refused too, and the card is untouched");
  const again = await post({ token: TOKEN, action: "submit" });
  ok(again.body.ok === false, "and it cannot be submitted twice");
  ok(CALLS.slice(before).every((c) => c.method === "GET"), "not one write reached Supabase from any of the three");
  ok(!save.text.includes(TOKEN) && !confirm.text.includes(TOKEN) && !again.text.includes(TOKEN),
    "and no refusal echoed the token");

  const read = await getWb(TOKEN);
  ok(read.body.ok === true && read.body.workbook.status === "submitted" && !!read.body.workbook.submitted_at,
    "but it still READS - the owner can see what he sent");
  reset();
}

console.log("\n── 6. the token never reaches a body or a log, even inside a message we did not write ──");
{
  // PostgREST can quote its own filter back at us, and console.error is a sink
  // like any other. The route scrubs before logging rather than trusting the
  // message not to contain the one thing the log must never hold.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/rest/v1/workbooks?token=")) {
      return new Response(JSON.stringify({ code: "22P02", message: `invalid input syntax: "${TOKEN}"` }), { status: 400 });
    }
    return realFetch(url, init);
  };
  const bufAt = consoleBuffer.length;
  const r = await getWb(TOKEN);
  globalThis.fetch = realFetch;

  ok(r.status === 500 && r.body.ok === false, "a Supabase failure answers JSON, never a raw crash");
  ok(!r.text.includes(TOKEN), "the token PostgREST quoted back is not in the response body");
  ok(!/22P02|invalid input syntax/.test(r.text),
    "nor is the database's own sentence - only a message we wrote is ever echoed");
  const logged = consoleBuffer.slice(bufAt);
  ok(logged.includes("workbook unexpected error"), "the detail still reaches the server log");
  ok(!logged.includes(TOKEN) && logged.includes("<token>"), "with the token scrubbed out of it");
  reset();
}

console.log("\n── 7. no credential ever reaches a body: refuse the break, trim the artifact ──");
{
  // TWO-PART CANARY, split the way a real paste is. A "fix" that scrubs a
  // message for a key pattern stops dead at the break and leaves the tail on
  // screen, so both halves are asserted separately.
  const CANARY_HEAD = "sbp_FAKE_CANARY";
  const CANARY_TAIL = "SECOND_LINE_TAIL";
  const realKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_SERVICE_ROLE_KEY = `${CANARY_HEAD}\n${CANARY_TAIL}`;
  const wireBefore = CALLS.length;
  const bufAt = consoleBuffer.length;
  const broken = await getWb(TOKEN);
  ok(broken.status === 500 && broken.body.ok === false, "a service key with an embedded break answers a polite JSON error");
  ok(!broken.text.includes(CANARY_HEAD) && !broken.text.includes(CANARY_TAIL),
    "with NEITHER canary half anywhere in the response body");
  ok(CALLS.length === wireBefore, "and the unusable credential was never HANDED TO FETCH at all - refused before the wire, not by it");
  ok(!consoleBuffer.slice(bufAt).includes(CANARY_HEAD) && !consoleBuffer.slice(bufAt).includes(CANARY_TAIL),
    "nor either half in anything printed while it happened");

  // TRIM FIRST, THEN REFUSE. Production's SUPABASE_SERVICE_KEY carries a
  // trailing newline right now (`echo` instead of `printf` into `vercel env
  // add`). That is how the value was STORED, not a broken credential, and
  // refusing it would turn a cosmetic artifact into a hard outage.
  const CLEAN = "stub-service-" + "key-Kp3";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `${CLEAN}\n`;
  const at = CALLS.length;
  const fine = await getWb(TOKEN);
  ok(fine.status === 200 && fine.body.ok === true, "a service key with a TRAILING NEWLINE is used, not refused");
  // EXACT equality, never `contains`: a header built from the untrimmed value
  // still contains the key, and that is the check-one-value-send-another bug.
  const sent = CALLS[at] || { headers: {} };
  ok(String(sent.headers.Authorization || "") === `Bearer ${CLEAN}`,
    "and the Authorization header is exactly \"Bearer <trimmed>\" - no whitespace rides along");
  ok(String(sent.headers.apikey || "") === CLEAN, "with the trimmed value in the apikey header too");

  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  const missing = await getWb(TOKEN);
  ok(missing.status === 500 && !/configured|whitespace/.test(String(missing.body.error)),
    "a MISSING service key is our misconfiguration: refused, and the diagnosis stays in the log");

  process.env.SUPABASE_SERVICE_ROLE_KEY = realKey;
  reset();
}

console.log("\n── 8. staff mint: a second workbook cannot silently orphan the first ──");
{
  const auth = { authorization: `Bearer ${STAFF_BEARER}` };
  const anon = await post({ action: "create", client_id: "sj", kind: "price" });
  ok(anon.status === 401 && anon.body.ok === false, "create with no staff auth is 401");
  const wrong = await post({ action: "create", client_id: "sj", kind: "price" }, { authorization: "Bearer not-a-staff-session" });
  ok(wrong.status === 401, "and an unknown bearer is 401 - the owner's token cannot mint anything");

  const badKind = await post({ action: "create", client_id: "sj", kind: "prices" }, auth);
  ok(badKind.status === 400 && /kind must be one of/.test(badKind.body.error), "kind is checked against the schema's enum");

  // wb1 (price, 'sent') is OPEN: minting supersedes it, out loud.
  const made = await post({ action: "create", client_id: "sj", kind: "price" }, auth);
  ok(made.body.ok === true && made.body.workbook.status === "draft", "a staff mint creates a draft workbook");
  ok(typeof made.body.token === "string" && made.body.token.length >= 40 && /^[A-Za-z0-9_-]+$/.test(made.body.token),
    `the token is long, url-safe and crypto-random (${made.body.token.length} chars, base64url)`);
  ok(row("workbooks", "wb1").status === "void",
    "and the academy's previously OPEN price workbook is VOIDED - two live links means answers land in a row nobody reads");
  ok(made.body.superseded.length === 1 && made.body.superseded[0].id === "wb1" && made.body.superseded[0].was === "sent",
    "the response NAMES what it superseded rather than doing it quietly");
  ok(row("workbooks", "wb2").status === "sent", "the MEMBER workbook is untouched - the rule is per kind");

  const second = await post({ action: "create", client_id: "sj", kind: "price" }, auth);
  ok(second.body.token !== made.body.token, "two mints never produce the same token");

  // A SUBMITTED workbook is the owner's finished work. Minting over it would
  // orphan answers staff have not reviewed, so a human has to decide instead.
  reset();
  row("workbooks", "wb1").status = "submitted";
  const wbCount = DB.workbooks.length;
  const blocked = await post({ action: "create", client_id: "sj", kind: "price" }, auth);
  ok(blocked.status === 409 && /submitted/.test(blocked.body.error),
    "minting over a SUBMITTED workbook is refused, not silently superseded");
  ok(DB.workbooks.length === wbCount, "and no new workbook row was written");
  ok(row("workbooks", "wb1").status === "submitted", "the submitted one is left exactly as it was");

  const noAcademy = await post({ action: "create", client_id: "nope", kind: "price" }, auth);
  ok(noAcademy.status === 404, "an unknown academy is 404");
  reset();
}

console.log("\n── 9. per-card `meta`: BOTH branches pinned, and it is read-only by construction ──");
{
  // `workbook_cards.meta jsonb` IS LIVE IN PRODUCTION (applied 2026-08-05,
  // verified by reading information_schema and by running this route's exact
  // select list against the real table). Both branches are pinned anyway,
  // because "the column exists in prod" is not the same claim as "every
  // environment that runs this code has it" - a fresh local replay, a preview
  // branch or a rolled-back migration must still render a page WITHOUT the
  // context strip rather than erroring on every read.

  // ── branch A: column ABSENT ───────────────────────────────────────────────
  const plain = await getWb(TOKEN);
  ok(plain.body.ok === true && plain.body.cards.every((c) => !("meta" in c)),
    "column absent: PostgREST's 42703 is caught and cards come back with NO meta key at all");

  // ── branch B: column PRESENT, with the real shape ─────────────────────────
  COLUMNS.workbook_cards.push("meta");
  const REAL_META = { family: "two", family_color: "#D4B65C", live_in_stripe: true, members: 9, rungs: [{ months: 3, members: 4 }, { months: 12, members: 5 }] };
  row("workbook_cards", "c-p1").meta = REAL_META;
  row("workbook_cards", "c-p2").meta = null;          // jsonb is NULLABLE in prod
  const withMeta = await getWb(TOKEN);
  const p1 = withMeta.body.cards.find((c) => c.card_key === "plan:p1");
  const p2 = withMeta.body.cards.find((c) => c.card_key === "plan:p2");
  ok(!!p1 && JSON.stringify(p1.meta) === JSON.stringify(REAL_META),
    "column present: the whole jsonb value is passed through byte for byte, nested arrays and all");
  ok(!!p2 && "meta" in p2 && p2.meta === null,
    "a NULL meta comes back as the key with null - 'this card has none' is not the same as 'this deployment has none'");
  ok(!!withMeta.body.cards.find((c) => c.card_key === "tax"),
    "and the other cards are unaffected");

  // ── meta MUST NEVER BE WRITABLE THROUGH A TOKEN-AUTHENTICATED ACTION ──────
  // A computed fact that could be written by the owner would come back out
  // looking exactly like something he confirmed. That is the confusion these
  // three tables exist to prevent, so the payloads below carry `meta` at every
  // level they could and NONE of it may reach Supabase.
  const at = CALLS.length;
  await post({ token: TOKEN, action: "save", card_key: "plan:p1", meta: { live_in_stripe: false }, answers: [{ id: "a-p1-title", answered: "Renamed By Owner", meta: { members: 999 } }] });
  await post({ token: TOKEN, action: "confirm", card_key: "plan:p1", meta: { members: 999 } });
  await post({ token: TOKEN, action: "submit", meta: { members: 999 } });
  const writes = CALLS.slice(at).filter((c) => c.method !== "GET");
  ok(writes.length > 0 && writes.every((c) => !String(c.body || "").includes("meta")),
    `not one of the ${writes.length} writes those three payloads produced carries "meta" - the route never even asks`);
  ok(JSON.stringify(row("workbook_cards", "c-p1").meta) === JSON.stringify(REAL_META),
    "the card's meta is byte-identical afterwards");
  ok((DB.workbook_answers || []).every((a) => !("meta" in a)),
    "and no meta ever landed on workbook_answers, where it would read as an answer");

  COLUMNS.workbook_cards.pop();
  reset();
}

console.log("\n── 10. concurrency: a debounced autosave landing after Send ──");
{
  // THE ORDERING THE PAGE ACTUALLY PRODUCES. assertEditable reads the status and
  // the write happens a round trip later, so submit can land INSIDE that window:
  // the save was legal when checked and illegal when it wrote. PostgREST has no
  // cross-table conditional UPDATE and no transaction here, so the route cannot
  // claim atomicity - it checks AFTER the write and puts the value back.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("workbook_answers?id=eq.a-p1-title") && String(init.method || "").toUpperCase() === "PATCH") {
      // The owner pressed Send in another tab, between our status check and our
      // write. This is the exact interleaving, not a story about it.
      row("workbooks", "wb1").status = "submitted";
      row("workbooks", "wb1").submitted_at = "2026-08-04T11:30:00Z";
    }
    return realFetch(url, init);
  };
  const late = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: "a-p1-title", answered: "landed too late" }] });
  globalThis.fetch = realFetch;

  ok(late.status === 409 && late.body.ok === false,
    "a save that lands after Send is refused with the ordinary read-only answer");
  ok(row("workbook_answers", "a-p1-title").answered === null,
    "and the late value is PUT BACK - the submitted workbook does not keep it");
  ok(stateOf("c-p1") === "untouched",
    "no card state was written either - the refusal happens before that");
  ok(row("workbooks", "wb1").submitted_at === "2026-08-04T11:30:00Z",
    "and the submit that won is untouched by the loser");
  reset();

  // TWO OF THE OWNER'S OWN DEBOUNCED SAVES IN FLIGHT. The card's state must be
  // computed from the answers as they exist AFTER the writes, not from the
  // snapshot this request started with - otherwise the later save reports a
  // state the database does not hold.
  globalThis.fetch = async (url, init = {}) => {
    const res = await realFetch(url, init);
    if (String(url).includes("workbook_answers?id=eq.a-p2-price") && String(init.method || "").toUpperCase() === "PATCH") {
      row("workbook_answers", "a-p2-price").answered = 306;   // the other save lands last
    }
    return res;
  };
  const raced = await post({ token: TOKEN, action: "save", card_key: "plan:p2", answers: [{ id: "a-p2-price", answered: 400 }] });
  globalThis.fetch = realFetch;
  ok(raced.body.card.state === "untouched" && stateOf("c-p2") === "untouched",
    "the state reported is the one the ROWS support (the other save reverted it), not the one this request tried to write");
  reset();

  // TWO TABS PRESSING SEND TOGETHER. One conditional UPDATE on one row decides
  // it: the loser matches nothing, writes nothing, and reports the winner's
  // timestamp rather than inventing its own.
  for (const key of ["tax", "plan:p1", "plan:p2"]) await post({ token: TOKEN, action: "confirm", card_key: key });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/rest/v1/workbooks?id=eq.wb1") && String(init.method || "").toUpperCase() === "PATCH") {
      row("workbooks", "wb1").status = "submitted";
      row("workbooks", "wb1").submitted_at = "2026-08-04T09:00:00Z";   // the other tab got there first
    }
    return realFetch(url, init);
  };
  const loser = await post({ token: TOKEN, action: "submit" });
  globalThis.fetch = realFetch;
  ok(loser.body.ok === true && loser.body.workbook.submitted_at === "2026-08-04T09:00:00Z",
    "the losing submit reports the REAL submitted_at, never its own clock for a write that did not happen");

  // ...and the same interleaving with a VOID instead of a submit is not a
  // success at all.
  reset();
  for (const key of ["tax", "plan:p1", "plan:p2"]) await post({ token: TOKEN, action: "confirm", card_key: key });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/rest/v1/workbooks?id=eq.wb1") && String(init.method || "").toUpperCase() === "PATCH") {
      row("workbooks", "wb1").status = "void";
    }
    return realFetch(url, init);
  };
  const closed = await post({ token: TOKEN, action: "submit" });
  globalThis.fetch = realFetch;
  ok(closed.body.ok === false && row("workbooks", "wb1").status === "void",
    "a workbook voided mid-submit answers ok:false rather than reporting a send that never landed");
  reset();
}

console.log("\n── 11. owner ADDITIONS: a request staff act on by hand, never a write ──");
{
  // Zoran's ruling, 2026-08-05: the "+ Add" buttons stay, and what they produce
  // is a REQUEST - "ADDED BY OWNER - needs creating", with Create and Discard
  // next to it. Nothing auto-creates anything, which is what makes this safe on
  // a link with no login.
  const plansCard = () => DB.workbook_cards.push({ id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Anything missing?", sort_order: 3, state: "untouched", confirmed_at: null });
  const codesCard = () => DB.workbook_cards.push({ id: "c-codes", workbook_id: "wb1", card_key: "codes", title: "Discount codes", sort_order: 4, state: "untouched", confirmed_at: null });
  const A_PLAN = { title: "Summer 1x/week", price: 150, billing_cycle: "Every 4 weeks", type: "Membership" };
  const A_LENGTH = { months: 6, price: 210 };
  const additionsIn = (wbId) => DB.workbook_answers.filter((a) => a.workbook_id === wbId && String(a.target_field || "").startsWith("add:"));

  // ── what a card will accept is the SERVER's answer, not the page's guess ───
  plansCard();
  let r = await getWb(TOKEN);
  const canAdd = Object.fromEntries(r.body.cards.map((c) => [c.card_key, c.can_add.join(",")]));
  ok(canAdd["plan:p1"] === "length" && canAdd["plans"] === "plan" && canAdd.tax === "",
    `can_add comes from the server per card (plan:length, plans:plan, tax:NOTHING) - saw ${JSON.stringify(canAdd)}`);
  ok(r.body.cards.find((c) => c.card_key === "tax").add_left === 0
    && r.body.cards.find((c) => c.card_key === "plan:p1").add_left === 6,
    "add_left is on every card BEFORE he clicks, so a limit is never discovered by hitting it");

  // ── THE SERVER DECIDES THE TARGET. The payload does not get a vote. ────────
  const hostile = await post({
    token: TOKEN, action: "add", card_key: "plan:p1", what: "length", answered: A_LENGTH,
    target_table: "clients", target_id: "sj", target_kind: "academy_setting",
    client_id: "someone-else", workbook_id: "wb2", card_id: "c-other", meta: { members: 999 },
  });
  const made = row("workbook_answers", hostile.body.answer.id);
  ok(hostile.body.ok === true && !!made, "an addition is created and comes back with a server id");
  ok(made.target_table === "offer_prices" && made.target_kind === "price_row" && made.target_id === null,
    `the target is INHERITED from the card, not the payload (saw ${made.target_table}/${made.target_kind}/${JSON.stringify(made.target_id)})`);
  ok(made.workbook_id === "wb1" && made.card_id === "c-p1" && made.client_id === "sj",
    "and it lands in THIS workbook, on THIS card, for THIS academy - the payload's wb2/c-other/someone-else were ignored");
  ok(made.target_field === "add:length" && made.current_value === null && made.proposed === null,
    "marked add:length, with current_value and proposed null - we proposed nothing, he did");
  ok(!("meta" in made), "and no meta rode in on the addition path");
  ok(additionsIn("wb2").length === 0, "nothing was created in the other workbook");
  ok(hostile.body.card.state === "changed" && hostile.body.card.add_left === 5,
    "the card is 'changed' immediately and the allowance counts down");

  // ── an addition can NEVER read 'confirmed' ────────────────────────────────
  // ON A CARD WHERE NOTHING ELSE DIFFERS, which is the only place this rule can
  // actually be observed. plan:p1 carries the San Jose rename, so it would read
  // 'changed' with or without the addition rule - asserting it there is a tick
  // that survives its own subject being deleted. plan:p2's proposal matches what
  // we store exactly, so ONLY the addition can make it 'changed'.
  await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: A_LENGTH });
  const clean = await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  ok(clean.body.card.state === "changed" && stateOf("c-p2") === "changed",
    "confirming a card whose ONLY difference is an addition records 'changed' - a request for something we do not sell is not an approval");
  ok(!!row("workbook_cards", "c-p2").confirmed_at, "he did act on it, so confirmed_at is still stamped");

  const conf = await post({ token: TOKEN, action: "confirm", card_key: "plan:p1" });
  ok(conf.body.card.state === "changed" && stateOf("c-p1") === "changed",
    "and the same on a card that also carries a rename");

  // THE SHAPE THAT ISOLATES THE RULE. A populated addition differs from
  // current_value (null) anyway, so the ordinary difference rule would carry it
  // - safety borrowed from the add and save validators, in other functions. An
  // addition with a NULL answered, which a direct SQL write or a later
  // staff-side path can produce, differs from nothing at all. Without the
  // addition rule this card reads 'confirmed': "the owner approved this as-is",
  // about a request for something we do not sell.
  reset();
  plansCard();
  DB.workbook_answers.push({ id: "a-blank-add", workbook_id: "wb1", card_id: "c-p2", client_id: "sj", target_kind: "price_row", target_table: "offer_prices", target_id: null, target_field: "add:length", current_value: null, proposed: null, answered: null, applied_at: null, created_at: "2026-08-04T00:00:09Z" });
  const blankAdd = await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  ok(blankAdd.body.card.state === "changed" && stateOf("c-p2") === "changed",
    "a card holding an EMPTY addition still records 'changed' - the rule holds without borrowing from the validators");

  // ── the card whose whole purpose is additions has no siblings to inherit ──
  const onPlans = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: A_PLAN });
  const planRow = row("workbook_answers", onPlans.body.answer.id);
  ok(onPlans.body.ok === true && planRow.target_table === "offer_prices" && planRow.target_kind === "price_row",
    "a card with NO answers of its own derives its target from the workbook's other rows, never from an invented table name");

  // ── refusals ──────────────────────────────────────────────────────────────
  const onTax = await post({ token: TOKEN, action: "add", card_key: "tax", what: "plan", answered: A_PLAN });
  ok(onTax.body.ok === false && onTax.status === 409, "the tax card takes no additions - it fails CLOSED");
  ok(additionsIn("wb1").filter((a) => a.card_id === "c-tax").length === 0, "and nothing was written to it");

  const wrongKind = await post({ token: TOKEN, action: "add", card_key: "plan:p1", what: "plan", answered: A_PLAN });
  ok(wrongKind.body.ok === false, "a plan cannot be added to a single plan's card - only a length can");

  for (const [label, what, value, expect] of [
    ["a plan with no name", "plan", { price: 150 }, /name/i],
    ["a plan with no price", "plan", { title: "Summer 1x/week" }, /price/i],
    ["a length with no months", "length", { price: 210 }, /months/i],
    ["a length of 0 months", "length", { months: 0, price: 210 }, /months/i],
    ["a code with no code", "code", { amount: 10 }, /code/i],
  ]) {
    const cardKey = what === "length" ? "plan:p1" : what === "plan" ? "plans" : "codes";
    if (what === "code" && !row("workbook_cards", "c-codes")) codesCard();
    const bad = await post({ token: TOKEN, action: "add", card_key: cardKey, what, answered: value });
    ok(bad.body.ok === false && expect.test(String(bad.body.error)) && !String(bad.body.error).includes("—"),
      `${label} is refused in owner language ("${bad.body.error}")`);
  }

  const huge = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: "x".repeat(2100), price: 10 } });
  ok(huge.body.ok === false && huge.body.code === "add_too_long",
    "an oversized addition is refused with code add_too_long - a row cap is not a byte cap");
  reset();
}

console.log("\n── 12. the caps, the ghost, and the ordering, on the addition path ──");
{
  const plansCard = () => DB.workbook_cards.push({ id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Anything missing?", sort_order: 3, state: "untouched", confirmed_at: null });
  const codesCard = () => DB.workbook_cards.push({ id: "c-codes", workbook_id: "wb1", card_key: "codes", title: "Codes", sort_order: 4, state: "untouched", confirmed_at: null });
  const addLength = (n) => post({ token: TOKEN, action: "add", card_key: "plan:p1", what: "length", answered: { months: n, price: 100 + n } });
  const additions = () => DB.workbook_answers.filter((a) => String(a.target_field || "").startsWith("add:"));

  // ── 6 PER CARD ────────────────────────────────────────────────────────────
  let last = null;
  for (let i = 1; i <= 6; i++) last = await addLength(i);
  ok(last.body.ok === true && last.body.card.add_left === 0, "six additions fit on one card, and add_left reaches 0");
  const seventh = await addLength(7);
  ok(seventh.body.ok === false && seventh.body.code === "add_cap_card" && /up to 6/.test(seventh.body.error),
    `the seventh is refused with code add_cap_card and a sentence that names the number ("${seventh.body.error}")`);
  ok(additions().length === 6, "and nothing was written past the cap");

  // ── 20 PER WORKBOOK ───────────────────────────────────────────────────────
  plansCard(); codesCard();
  for (let i = 1; i <= 6; i++) await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: { months: i, price: 200 + i } });
  for (let i = 1; i <= 6; i++) await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: `Extra ${i}`, price: 99 } });
  for (let i = 1; i <= 2; i++) await post({ token: TOKEN, action: "add", card_key: "codes", what: "code", answered: { code: `SAVE${i}` } });
  ok(additions().length === 20, `twenty additions across four cards (saw ${additions().length})`);
  const twentyFirst = await post({ token: TOKEN, action: "add", card_key: "codes", what: "code", answered: { code: "ONEMORE" } });
  ok(twentyFirst.body.ok === false && twentyFirst.body.code === "add_cap_workbook" && /up to 20/.test(twentyFirst.body.error),
    "the twenty-first is refused with code add_cap_workbook - a no-login link cannot create rows without end");
  ok(additions().length === 20, "and the workbook still holds exactly twenty");
  reset();

  // ── REMOVE LEAVES NO GHOST ────────────────────────────────────────────────
  // A soft clear would still answer the staff query, and staff working a list
  // called "needs creating" create what is on it.
  const added = await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: { months: 3, price: 260 } });
  const addedId = added.body.answer.id;
  ok(stateOf("c-p2") === "changed", "adding flips the card to 'changed'");
  const gone = await post({ token: TOKEN, action: "remove", card_key: "plan:p2", id: addedId });
  ok(gone.body.ok === true && gone.body.removed.id === addedId, "remove answers with the id it removed");
  ok(!row("workbook_answers", addedId), "the row is GONE from the table, not emptied");
  ok(additions().length === 0, "so the staff 'needs creating' query returns nothing at all");
  const after = await getWb(TOKEN);
  ok(!after.text.includes(addedId), "and it is not in the workbook the page reads");
  ok(stateOf("c-p2") === "untouched" && after.body.cards.find((c) => c.card_key === "plan:p2").state === "untouched",
    "the card falls back to 'untouched' - an addition he took back never happened");

  // ── a save may not empty an addition (the ghost through the back door) ────
  const again = await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: { months: 3, price: 260 } });
  for (const [label, value] of [["null", null], ["an empty object", {}], ["an empty string", ""]]) {
    const blanked = await post({ token: TOKEN, action: "save", card_key: "plan:p2", answers: [{ id: again.body.answer.id, answered: value }] });
    ok(blanked.body.ok === false && /remove it rather than emptying it/.test(String(blanked.body.error)),
      `a save cannot empty an addition to ${label} - taking it back is its own act`);
  }
  ok(!!row("workbook_answers", again.body.answer.id).answered, "and the addition still carries what he asked for");

  // ── only an addition can be removed, and only inside this workbook ────────
  const notMine = await post({ token: TOKEN, action: "remove", card_key: "plan:p1", id: "a-p1-title" });
  ok(notMine.status === 404 && !!row("workbook_answers", "a-p1-title"),
    "an ORDINARY answer cannot be removed - the questions are ours, not his to delete");
  const foreign = await post({ token: OTHER_TOKEN, action: "remove", card_key: "roster", id: again.body.answer.id });
  ok(foreign.status === 404 && !!row("workbook_answers", again.body.answer.id),
    "and another workbook's token cannot remove this workbook's addition");
  reset();

  // ── read-only, on both new actions ────────────────────────────────────────
  row("workbooks", "wb1").status = "submitted";
  const at = CALLS.length;
  const lateAdd = await post({ token: TOKEN, action: "add", card_key: "plan:p1", what: "length", answered: { months: 9, price: 300 } });
  ok(lateAdd.status === 409 && additions().length === 0, "add is refused on a submitted workbook, and writes nothing");
  ok(CALLS.slice(at).every((c) => c.method === "GET"), "not one write reached Supabase");
  reset();

  // ── the ordering race, on the addition path ───────────────────────────────
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/rest/v1/workbook_answers") && String(init.method || "").toUpperCase() === "POST") {
      row("workbooks", "wb1").status = "submitted";     // Send lands mid-insert
    }
    return realFetch(url, init);
  };
  const raced = await post({ token: TOKEN, action: "add", card_key: "plan:p1", what: "length", answered: { months: 4, price: 240 } });
  globalThis.fetch = realFetch;
  ok(raced.status === 409 && raced.body.ok === false, "an add that lands after Send is refused");
  ok(additions().length === 0, "and the row it created is DELETED - a submitted workbook does not keep it");
  reset();

  // ...and the same for a remove, which has to put the row back verbatim.
  const doomed = await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: { months: 3, price: 260 } });
  const doomedId = doomed.body.answer.id;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/rest/v1/workbook_answers") && String(init.method || "").toUpperCase() === "DELETE") {
      row("workbooks", "wb1").status = "submitted";
    }
    return realFetch(url, init);
  };
  const lateRemove = await post({ token: TOKEN, action: "remove", card_key: "plan:p2", id: doomedId });
  globalThis.fetch = realFetch;
  const restored = row("workbook_answers", doomedId);
  ok(lateRemove.status === 409 && !!restored,
    "a remove that lands after Send is refused and the row is put BACK");
  ok(!!restored && restored.id === doomedId && restored.target_field === "add:length" && restored.answered.months === 3,
    "restored verbatim, with the SAME id the page is holding - not as a stranger");
  reset();
}

console.log("\n── 13. every card counts, and confirm-it-empty is a real answer ──");
{
  // D6 (2026-08-06): the gate counts CARDS, from first render. The previous
  // rule (a card with no answers cannot hold Send) grew the denominator when
  // an addition landed - the owner watched "0 of 7" become "5 of 8" - and let
  // the add-a-plan card ship with nobody able to tell "he was asked and had
  // nothing to add" from "he never looked", while the card's own hint promised
  // "confirm it empty and we will know you were asked".
  const plansCard = () => DB.workbook_cards.push({ id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Anything missing?", sort_order: 3, state: "untouched", confirmed_at: null });
  const confirmAll = async () => { for (const k of ["tax", "plan:p1", "plan:p2"]) await post({ token: TOKEN, action: "confirm", card_key: k }); };

  // ── the empty card COUNTS, and holds Send until confirmed empty ───────────
  plansCard();
  let r = await getWb(TOKEN);
  ok(r.body.cards.every((c) => c.counts === true),
    "every card reports counts:true - the empty add-a-plan card included");
  await confirmAll();
  const heldEmpty = await post({ token: TOKEN, action: "submit" });
  ok(heldEmpty.body.ok === false && heldEmpty.body.remaining === 1,
    `with the other three confirmed, Send still waits for the empty card (remaining ${heldEmpty.body.remaining})`);
  const emptyConfirm = await post({ token: TOKEN, action: "confirm", card_key: "plans" });
  ok(emptyConfirm.body.ok === true && !!row("workbook_cards", "c-plans").confirmed_at,
    "confirming it EMPTY is accepted - 'he was asked, nothing to add' now has a record");
  const sent = await post({ token: TOKEN, action: "submit" });
  ok(sent.body.ok === true && sent.body.remaining === 0,
    "and Send goes through with the deliberate act on every card");

  // ── an addition does not move the denominator ─────────────────────────────
  reset(); plansCard();
  await confirmAll();
  const preTotal = (await getWb(TOKEN)).body.cards.filter((c) => c.counts).length;
  const added = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: "Summer 1x/week", price: 150 } });
  const postTotal = (await getWb(TOKEN)).body.cards.filter((c) => c.counts).length;
  ok(preTotal === 4 && postTotal === 4 && added.body.card.counts === true,
    `the denominator is ${preTotal} before the add and ${postTotal} after - it cannot grow mid-session (the 0-of-7 -> 5-of-8 defect)`);
  ok(added.body.remaining === 1, `and remaining is 1 - the card holds Send for the request (saw ${added.body.remaining})`);
  const held = await post({ token: TOKEN, action: "submit" });
  ok(held.body.ok === false && held.body.remaining === 1,
    "Send is REFUSED until he confirms it - an unreviewed request is not a sent workbook");
  const okNow = await post({ token: TOKEN, action: "confirm", card_key: "plans" });
  ok(okNow.body.remaining === 0 && (await post({ token: TOKEN, action: "submit" })).body.ok === true,
    "confirming it releases Send, like any other card");

  // ── removing the addition does not un-count the card ──────────────────────
  reset(); plansCard();
  await confirmAll();
  const temp = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: "Never mind", price: 10 } });
  const back = await post({ token: TOKEN, action: "remove", card_key: "plans", id: temp.body.answer.id });
  ok(back.body.card.counts === true && back.body.remaining === 1,
    `emptied again, the card STILL counts and still waits for its confirm (remaining ${back.body.remaining})`);
  await post({ token: TOKEN, action: "confirm", card_key: "plans" });
  ok((await post({ token: TOKEN, action: "submit" })).body.ok === true,
    "and confirm-it-empty sends it");

  // ── THE LOOPHOLE: emptiness is the ONLY discriminator ──────────────────────
  // If seeding, a card_key or a payload could mark a card exempt, the
  // no-partial-submit ruling would be defeated from the inside by the people it
  // binds. A card with answers counts, whatever anything says about it.
  reset();
  COLUMNS.workbook_cards.push("meta");
  // Every lie we can tell about a real card, at once: a "special" key, an
  // exempting meta blob, and a payload that says so.
  const tax = row("workbook_cards", "c-tax");
  tax.card_key = "plans";                       // the key the rule must NOT key on
  tax.meta = { counts: false, optional: true, skip_gate: true };
  await post({ token: TOKEN, action: "confirm", card_key: "plan:p1" });
  await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  const lied = await post({ token: TOKEN, action: "submit", counts: false, skip: ["plans"], remaining: 0 });
  ok(lied.body.ok === false && lied.body.remaining === 1,
    "a card WITH ANSWERS still counts though its key says plans, its meta says counts:false and the payload says skip it");
  const seen = await getWb(TOKEN);
  ok(seen.body.cards.find((c) => c.id === undefined || c.card_key === "plans" && c.answers.length).counts === true,
    "and it reports counts:true on the wire, so the page cannot be told a different story either");
  COLUMNS.workbook_cards.pop();
  reset();
}

console.log("\n── 14. an addition made AFTER a confirm ──");
{
  // The gate now asks confirmed_at, and a save that really edits a value retires
  // it. ADDING something is no less a change to what the card says: he approved
  // a card, then asked for a plan we do not sell. If that approval survives, an
  // unreviewed request rides out on a card marked ready - the same defeat the
  // typing-is-approving fix just closed, through the door next to it.
  const confirmAll = async () => { for (const k of ["tax", "plan:p1", "plan:p2"]) await post({ token: TOKEN, action: "confirm", card_key: k }); };
  await confirmAll();
  const before = await post({ token: TOKEN, action: "submit" });
  ok(before.body.ok === true, "baseline: all three confirmed, Send goes through");

  reset();
  await confirmAll();
  const add = await post({ token: TOKEN, action: "add", card_key: "plan:p1", what: "length", answered: { months: 6, price: 210 } });
  ok(add.body.card.confirmed_at === null && row("workbook_cards", "c-p1").confirmed_at === null,
    "adding to a CONFIRMED card retires the confirm - the approval was of a card that did not carry this request");
  ok(add.body.remaining === 1, `and remaining goes back to 1 (saw ${add.body.remaining})`);
  const blocked = await post({ token: TOKEN, action: "submit" });
  ok(blocked.body.ok === false && blocked.body.remaining === 1,
    "so Send is refused until he confirms the card again");

  // The mirror, which is NOT symmetric and must not be: removing an addition
  // leaves the card holding LESS than he approved, and everything still on it
  // was covered by that approval. Retiring there would demand a re-confirm for
  // taking something back, which is a click that teaches us nothing.
  reset();
  const temp = await post({ token: TOKEN, action: "add", card_key: "plan:p2", what: "length", answered: { months: 3, price: 260 } });
  await post({ token: TOKEN, action: "confirm", card_key: "plan:p2" });
  const removed = await post({ token: TOKEN, action: "remove", card_key: "plan:p2", id: temp.body.answer.id });
  ok(!!removed.body.card.confirmed_at && !!row("workbook_cards", "c-p2").confirmed_at,
    "removing an addition does NOT retire the confirm - what remains is what he already approved");
  reset();
}

console.log("\n── 15. the shapes the page is built against, pinned ──");
{
  const r = await getWb(TOKEN);
  ok(Object.keys(r.body).sort().join(",") === "cards,ok,workbook", "GET: {ok, workbook, cards}");
  ok(Object.keys(r.body.workbook).sort().join(",") === "academy_name,id,kind,status,submitted_at",
    "workbook: {id, kind, status, academy_name, submitted_at}");
  // `counts` joined this shape deliberately: the submit gate must have ONE
  // definition, and it lives on the server. If the page re-derived it from
  // answers.length instead, the owner's "Confirm the remaining N cards" and the
  // server's refusal could disagree, and he would be told two different numbers
  // about the same workbook. The pin is updated rather than relaxed - it caught
  // this addition, which is exactly what it is for.
  ok(Object.keys(r.body.cards[0]).sort().join(",") === "add_left,answers,can_add,card_key,confirmed_at,counts,sort_order,state,title",
    "card: {card_key, title, sort_order, state, confirmed_at, can_add, add_left, counts, answers}");
  ok(Object.keys(r.body.cards[0].answers[0]).sort().join(",") === "answered,current_value,id,proposed,target_field,target_id,target_kind,target_table",
    "answer: {id, target_kind, target_table, target_id, target_field, current_value, proposed, answered}");

  const s = await post({ token: TOKEN, action: "save", card_key: "tax", answers: [] });
  // `counts` joined the ACTION card too, not just the GET card: the page updates
  // a card from the response to the action it just performed, and a field that
  // only exists on the full read makes the page remember the gate rule instead
  // of being told it. The pin caught its absence, which is what it is for.
  ok(Object.keys(s.body).sort().join(",") === "card,ok,remaining" && Object.keys(s.body.card).sort().join(",") === "add_left,card_key,confirmed_at,counts,state",
    "save: {ok, card:{card_key,state,confirmed_at,add_left,counts}, remaining}");
  const c = await post({ token: TOKEN, action: "confirm", card_key: "tax" });
  ok(Object.keys(c.body).sort().join(",") === "card,ok,remaining", "confirm: {ok, card, remaining}");
  const bogus = await post({ token: TOKEN, action: "frobnicate" });
  ok(bogus.status === 400 && bogus.body.ok === false, "an unknown action is a 400 with ok:false, never a crash");
  const wrongMethod = await call({ method: "DELETE", url: "/api/workbook" });
  ok(wrongMethod.status === 405 && wrongMethod.body.ok === false, "and an unsupported method is 405 with a JSON body");
  reset();
}

console.log("\n── the mint whitelist: a question added after seeding can grow its row ──");
{
  reset();
  // The page's setA creates { id: null } rows for fields the seed never made,
  // and doSave refuses unknown ids - so the live San Jose workbook could not
  // store a tax registration number at all. mintableOn() is the narrow
  // exception: the tax card may grow exactly that one row.
  const before = DB.workbook_answers.length;
  const r1 = await post({ token: TOKEN, action: "save", card_key: "tax", answers: [{ id: null, target_field: "tax_registration_number", answered: "123-456-789" }] });
  ok(r1.status === 200 && r1.body.ok === true, "a null-id save of tax_registration_number on the tax card is accepted");
  const minted = DB.workbook_answers.filter((a) => a.card_id === "c-tax" && a.target_field === "tax_registration_number");
  ok(minted.length === 1 && DB.workbook_answers.length === before + 1 && minted[0].answered === "123-456-789",
    `exactly ONE row is minted, carrying the answer (id ${minted[0] && minted[0].id})`);
  ok(minted.length === 1 && minted[0].target_kind === "academy_setting" && minted[0].target_table === "clients" && minted[0].target_id === "sj",
    "aimed by the card's own tax_config sibling - academy_setting on clients - never by the payload");

  // The save reply carries no answer ids, so the page's next autosave sends
  // null again: it must land on the SAME row, never mint a twin.
  const r2 = await post({ token: TOKEN, action: "save", card_key: "tax", answers: [{ id: null, target_field: "tax_registration_number", answered: "987-654" }] });
  const again = DB.workbook_answers.filter((a) => a.card_id === "c-tax" && a.target_field === "tax_registration_number");
  ok(r2.body.ok === true && again.length === 1 && again[0].id === minted[0].id && again[0].answered === "987-654",
    `a second null-id save updates the SAME row (${again[0] && again[0].id}), not a twin`);

  // Everything else keeps today's refusal, byte for byte - the whitelist is
  // the whole of the exception and it fails closed.
  for (const [key, field] of [["tax", "sneaky_field"], ["plan:p1", "tax_registration_number"], ["plan:p1", "price"]]) {
    const r = await post({ token: TOKEN, action: "save", card_key: key, answers: [{ id: null, target_field: field, answered: "x" }] });
    ok(r.status === 404 && /does not belong to this card/.test(String(r.body.error)),
      `a null-id save of ${field} on the ${key} card still refuses with the existing sentence ("${r.body.error}")`);
  }
  reset();
}

console.log("\n── the mint whitelist, plan cards: the age question can grow its rows ──");
{
  reset();
  // Step 12: plan cards seeded before the per-plan age question existed have no
  // age_min/age_max rows for the page to save into. mintableOn("plan:*") allows
  // exactly those two fields, aimed by the card's own siblings.
  const before = DB.workbook_answers.length;
  const r1 = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: null, target_field: "age_min", answered: "9" }] });
  ok(r1.status === 200 && r1.body.ok === true, "a null-id save of age_min on a plan card is accepted");
  const minted = DB.workbook_answers.filter((a) => a.card_id === "c-p1" && a.target_field === "age_min");
  ok(minted.length === 1 && DB.workbook_answers.length === before + 1 && minted[0].answered === "9",
    `exactly ONE row is minted, carrying the answer as a STRING (id ${minted[0] && minted[0].id}, answered ${JSON.stringify(minted[0] && minted[0].answered)})`);
  ok(minted.length === 1 && minted[0].target_kind === "price_row" && minted[0].target_table === "offer_prices" && minted[0].target_id === "p1",
    "aimed at the plan's own offer row by the card's title sibling - never by the payload");

  // The save reply carries no answer ids, so the page's next autosave sends
  // null again: it must land on the SAME row, never mint a twin.
  const r2 = await post({ token: TOKEN, action: "save", card_key: "plan:p1", answers: [{ id: null, target_field: "age_min", answered: "10" }] });
  const again = DB.workbook_answers.filter((a) => a.card_id === "c-p1" && a.target_field === "age_min");
  ok(r2.body.ok === true && again.length === 1 && again[0].id === minted[0].id && again[0].answered === "10",
    `a second null-id save updates the SAME row (${again[0] && again[0].id}), not a twin`);

  // The whitelist is per card: the codes card grows nothing, so the same
  // null-id age_min save there keeps today's refusal, byte for byte.
  DB.workbook_cards.push({ id: "c-codes", workbook_id: "wb1", card_key: "codes", title: "Discount codes", sort_order: 3, state: "untouched", confirmed_at: null });
  const r3 = await post({ token: TOKEN, action: "save", card_key: "codes", answers: [{ id: null, target_field: "age_min", answered: "9" }] });
  ok(r3.status === 404 && /does not belong to this card/.test(String(r3.body.error)),
    `a null-id save of age_min on the CODES card still refuses with the existing sentence ("${r3.body.error}")`);
  reset();
}

console.log("\n── the add-a-plan cadence follow-up: 'Other' must say how often ──");
{
  reset();
  DB.workbook_cards.push({ id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Anything missing?", sort_order: 3, state: "untouched", confirmed_at: null });
  // A plan billed on a cadence the chip list cannot name, with the follow-up
  // missing: staff cannot create '$85 other' by hand, so it is a riddle, not
  // a request, and it refuses in the page's own promised sentence.
  const bad = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: "Skills clinic", price: 85, billing_cycle: "Other" } });
  ok(bad.status === 400 && bad.body.error === "Please say how often this plan bills before adding it.",
    `an Other cycle with no follow-up refuses, sentence verbatim ("${bad.body.error}")`);
  const good = await post({ token: TOKEN, action: "add", card_key: "plans", what: "plan", answered: { title: "Skills clinic", price: 85, billing_cycle: "Other", billing_cycle_other: "every 6 weeks" } });
  ok(good.status === 200 && good.body.ok === true && good.body.answer.answered.billing_cycle_other === "every 6 weeks",
    `with the follow-up it stores, carrying the text (${JSON.stringify(good.body.answer && good.body.answer.answered)})`);
  reset();
}

console.log("\n── the seed's class-twin prefill: trimmed, and never refusing its own apply ──");
{
  // R5. A padded class value ("9 ") used to seed a padded `proposed`; the
  // owner confirming unedited materialises it as `answered`, and the
  // apply-side translator then rightly refuses " 9" - a refusal manufactured
  // by our own seed. The mapper trims, treats whitespace-only as NO proposal
  // (null, the prefill-is-a-claim rule), and the round trip below closes the
  // loop with the translator pin in api/_workbook-apply.test.mjs section 22:
  // every value the seed can propose passes tAgeStrOrEmpty.
  // MUTATE=seeduntrimmed.
  const battery = [
    [{ age_min: "9 ", age_max: " 12" }, { age_min: "9", age_max: "12" }],
    [{ age_min: 9, age_max: 12 }, { age_min: "9", age_max: "12" }],
    [{ age_min: "", age_max: "14" }, { age_min: null, age_max: "14" }],
    [{ age_min: "   ", age_max: null }, { age_min: null, age_max: null }],
    [{}, { age_min: null, age_max: null }],
    [{ age_min: "9\n", age_max: "\t12" }, { age_min: "9", age_max: "12" }],
  ];
  for (const [input, want] of battery) {
    const got = proposedFromClass(input);
    ok(JSON.stringify(got) === JSON.stringify(want),
      `proposedFromClass(${JSON.stringify(input)}) -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }

  // THE ROUND TRIP. The translator is extracted from api/workbook.js SOURCE
  // (the real one, not this suite's mutant copy), so this holds the seed
  // against the refusal rule as it actually ships - a hand-kept copy here
  // could agree with nothing.
  const wbSrc = fs.readFileSync(path.join(HERE, "workbook.js"), "utf8");
  const mAge = wbSrc.match(/const tAgeStrOrEmpty = \(v\) => \{[\s\S]*?\n\};/);
  ok(!!mAge, "tAgeStrOrEmpty is still extractable from api/workbook.js source (re-point this extraction if it moved)");
  if (mAge) {
    const tOk = (value) => ({ ok: true, value });
    const tErr = (error) => ({ ok: false, error });
    const tAgeStrOrEmpty = new Function("tOk", "tErr", `${mAge[0]}\nreturn tAgeStrOrEmpty;`)(tOk, tErr);
    const proposals = battery
      .flatMap(([input]) => { const p = proposedFromClass(input); return [p.age_min, p.age_max]; })
      .filter((v) => v != null);
    const refused = proposals.filter((v) => !tAgeStrOrEmpty(v).ok);
    ok(proposals.length > 0 && refused.length === 0,
      `every value the seed can propose passes tAgeStrOrEmpty - a seeded proposal can never refuse its own apply (${proposals.length} proposals ${JSON.stringify(proposals)}${refused.length ? ", REFUSED: " + JSON.stringify(refused) : ""})`);
  }
}

// ─── report ──────────────────────────────────────────────────────────────────
cleanup();
console.log("");
if (MUTATE) {
  if (controlBroken) { console.log(`❌ NEGATIVE CONTROL FAILED: ${controlBroken}`); process.exit(1); }
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
