#!/usr/bin/env node
/**
 * THE PRICE WORKBOOK CONTRACT: public/workbook.html against api/workbook.js.
 *
 *     node bam-portal/scripts/verify-workbook-contract.mjs        # from bam-ghl-agent/
 *     MUTATE=feecasing node bam-portal/scripts/verify-workbook-contract.mjs
 *
 * Plain node. No dependencies, no network, no database. Exits 1 on failure.
 *
 * WHY THIS EXISTS, and why it is not more unit tests
 * api/_workbook.test.mjs has 165 assertions and 26 controls. public/workbook.html
 * was verified by hand. BOTH WERE GREEN WHILE THE FEATURE WAS BROKEN, because
 * each suite stubs the OTHER side: each half only ever proved that it agrees with
 * its own idea of the contract. Six real defects came from the two halves
 * disagreeing with each other, and not one of them was visible from inside
 * either half.
 *
 * The worst of them: a card the owner typed into and never confirmed satisfied
 * the Send gate. The server read "the answer differs" as approval; the page
 * required an actual confirm. Both suites passed. A real submit went through with
 * confirmed_at null, defeating the product owner's rule that every row must be
 * confirmed before anything is sent.
 *
 * So this file runs THE REAL PAGE CODE AGAINST THE REAL HANDLER. The only thing
 * stubbed is the database. Every number it compares is computed independently by
 * the two halves and then asserted equal:
 *
 *   A  SHAPE          every target_field the page's models read, and every
 *                     response key it reads, exists in what the API actually
 *                     sends. A field the page reads and the API never sends is a
 *                     silent blank on a money surface.
 *   B  VOCABULARY     the chip lists (CHARGE_W, YESNO_W, CYCLES_W, AFTER_W, DUR,
 *                     KIND, TYPES_W) against what the offer actually stores.
 *                     Real offer data is LOWERCASE ("waive"); the page's lists
 *                     are capitalised. A stored value must still select the right
 *                     chip, and what the page sends back must be a form the offer
 *                     accepts.
 *   C  TYPE FIDELITY  offer_prices stores prices as STRINGS, a number input
 *                     yields a NUMBER, and the API compares with ===. Answering
 *                     with the same value we showed him must record NO change.
 *   D  THE LADDER     the page's reading of a commitment length, checked against
 *                     the API's own data: the applies_to keys the API sends for a
 *                     discount code name the 3-month rung, so the page must be
 *                     able to offer that same key back.
 *   E  COUNTING       the page's counted() against the server's `counts`. An
 *                     empty add-a-plan card must not hold Send; a card holding
 *                     anything must.
 *   F  EVERY ACTION   save, confirm, add, remove driven through BOTH sides, with
 *                     the page's model and the server's rows compared after each.
 *   G  THE GATE       remaining, readiness and the submit refusal - the number
 *                     the owner reads on his own screen against the number the
 *                     server will actually enforce.
 *
 * AND THEN THE STAFF HALF, on the SAME workbook he just sent. api/workbook.js
 * grew five staff actions - review, approve-card, apply, publish, rollback - and
 * they carry the identical disagreement class: staff review RENDERS values the
 * API translates, the apply rehearsal DESCRIBES work the mint will do, and the
 * approval gate counts cards with the same "has answers" idea the submit gate
 * uses. Each of those can drift from the page while both halves' own suites stay
 * green, because each half stubs the other. The page object here is not rebuilt
 * from a fixture: it is the same live page, rebooted off the real read-only GET.
 *
 *   H1 THE TWO GATES  approvalGate (which cards staff must approve) against
 *                     counted() (which cards the owner must confirm), as SETS of
 *                     card keys, with the add-a-plan card asked twice - holding
 *                     an addition, and empty. A drift is staff approving a card
 *                     nobody was asked to confirm, or the reverse.
 *   H2 CONFIRMED = REVIEWED  every card the page shows as confirmed appears in
 *                     review, and is_change is true for exactly the rows whose
 *                     BOX ON HIS SCREEN differs from what the portal stores -
 *                     which is what makes a card he confirmed WITHOUT EDITING
 *                     read as a change. San Jose's renames, one by a word and one
 *                     by a letter case.
 *   H3 WILL_WRITE     the offer-vocabulary value review previews must select the
 *                     same chip he pressed, and must select one at all. Casing on
 *                     this exact path shipped a live defect.
 *   H4 APPROVE/APPLY  the refusal NAMES the unapproved card; every value review
 *                     previewed is the value the offer then holds; and the owner
 *                     is still locked out afterwards, proved on a row apply never
 *                     stamped so it is the SENT state doing the refusing.
 *   H5 THE REHEARSAL  every price the mint would create is a key the page can
 *                     name in applies_to (two independent length parsers), and
 *                     the parent price on HIS screen is the amount the mint would
 *                     charge, tax and all (two independent tax computations).
 *   H6 ROLLBACK       offer jsonb, the staff decision set, and his rendered page,
 *                     each byte-identical to a copy the HARNESS took before the
 *                     apply - never to the snapshot the restore read from, which
 *                     would only prove the copy loop ran.
 *
 * HOW IT WORKS
 * The whole <script> block of public/workbook.html is extracted and run as one
 * unit against a fake DOM - not a hand-picked list of functions, and nothing is
 * reimplemented here. The ONLY edit is that the trailing `boot();` call is
 * removed so the harness can await it; boot itself is the real one. api/workbook.js
 * is imported and called as the real handler. The page's fetch and the handler's
 * Supabase fetch are the same router: page -> real handler -> in-memory PostgREST.
 *
 * ONE DELIBERATE ASYMMETRY IS EXPECTED AND ALLOWED, and it is asserted as such
 * rather than waved through: counted() counts a card holding an addition even
 * when the server says counts:false. That can only ever ask for MORE review, and
 * the page says so in a comment. It is asserted one-way (page >= server), so the
 * guard cannot be quietly widened into "the page counts whatever it likes".
 *
 * NEGATIVE CONTROLS - one per real defect, and the part that proves this file has
 * teeth. Each reintroduces the disagreement exactly as it shipped. A control that
 * catches nothing prints NEGATIVE CONTROL FAILED and exits 1, because a
 * decorative control has already shipped twice on this project.
 *
 *   MUTATE=typingisapproving   API. The submit gate goes back onto the STATE
 *       STRING instead of the deliberate act, so a card the owner typed into and
 *       never confirmed counts as ready. The server's `remaining` drops below the
 *       page's, and the server accepts a submit the page is still holding back.
 *   MUTATE=pagecountsall       PAGE. counted() counts every card, including the
 *       empty add-a-plan card the server excludes. The page said 8, the server
 *       said 7, and the owner was told to confirm a card with nothing on it.
 *   MUTATE=feecasing           PAGE. idxOf matches vocabulary case-sensitively,
 *       so a stored "waive" falls through to the default - which on the sign-up
 *       fee is CHARGE. This one silently told the owner we take his $40 joining
 *       fee on every prepay option, the opposite of what his own Stripe does.
 *   MUTATE=addkeepsconfirm     API. An addition made after a confirm leaves the
 *       confirm standing, so an unreviewed request for something we do not sell
 *       rides out on a card the gate calls ready.
 *   MUTATE=numericprice        PAGE. The page answers with a NUMBER where the
 *       offer stores a STRING, so retyping the figure we showed him records a
 *       phantom 300 -> 300 change for a human to adjudicate on a money surface.
 *   MUTATE=monthsmisparse      PAGE. "3 Months (12 Weeks)" parses as 1 month, so
 *       every prepay option reads "no saving" when one saves $151 - and the
 *       page can no longer offer the |3_months key the API itself sent.
 *
 *   MUTATE=staffcountsanswered      API. The approval gate stops counting the
 *       cards the submit gate counts: a card counts only where an ANSWER was
 *       written down, so the card whose whole content is "nothing to add" drops
 *       out of the approval set the owner was still made to confirm.
 *   MUTATE=renameisnotachange       API. Review adopts the PAGE's flag rule ("a
 *       change is what he typed over what we showed") instead of the
 *       against-current rule, so a rename he confirmed WITHOUT EDITING reads as
 *       untouched and staff approve a rename nobody ever looked at.
 *   MUTATE=reviewdropscards         API. A card with nothing to SHOW is dropped
 *       from review while the gate still demands its approval, so the tax card,
 *       the add-a-plan card and the notes card vanish off the surface staff read.
 *   MUTATE=reviewshowsuntranslated  API. will_write becomes the raw answer, so
 *       the preview shows staff the page's "Charge" and the apply one call later
 *       writes the offer's "charge". Pinned across two lines with the anchor line
 *       reproduced unchanged, so exactly one line moves - and that line was
 *       verified to be caught on its own.
 *   MUTATE=staffgateoff             API. The every-card-approved gate is gone, so
 *       apply writes configuration nobody signed off.
 *   MUTATE=refusalnamescount        API. The refusal counts the unapproved cards
 *       instead of naming them, on the one surface whose job is telling a
 *       reviewer what is left.
 *   MUTATE=applyreopensediting      API. A submitted workbook is editable again,
 *       so a late autosave can rewrite an answer underneath the reviewer who
 *       already approved it.
 *   MUTATE=rollbackleavesoffers     API. Rollback still answers ok and still says
 *       what it restored; the offer simply stays where the apply left it.
 *   MUTATE=rollbackclearsanswers    API. Rollback clears the OWNER's answers with
 *       the applied stamps, so the read-only page he was promised would not change
 *       under him renders BAM's proposals back at him instead of what he sent.
 *   MUTATE=taxneverlands            API. The tax write never lands, so every
 *       amount the rehearsal prints is PRE-TAX while his own page told him what a
 *       parent pays with tax on. The defect the tax card exists to close, one
 *       write later.
 *
 * Measured 2026-08-06, unmutated ALL PASS (111 assertions).
 * typingisapproving -> 9 failures, pagecountsall -> 13, feecasing -> 5,
 * addkeepsconfirm -> 3, numericprice -> 5, monthsmisparse -> 5,
 * staffcountsanswered -> 4, renameisnotachange -> 2, reviewdropscards -> 1,
 * reviewshowsuntranslated -> 1, staffgateoff -> 4, refusalnamescount -> 1,
 * applyreopensediting -> 3, rollbackleavesoffers -> 1,
 * rollbackclearsanswers -> 2, taxneverlands -> 2.
 *
 * EVERY MULTI-LINE PIN IN THIS FILE WAS SPLIT AND EACH HALF RUN ON ITS OWN
 * (2026-08-06), because a control that patches two lines otherwise reports one
 * bit of information about two claims - which is how two decorative controls were
 * found on this project. feecasing's two halves catch 2 and 5 assertions
 * independently; addkeepsconfirm's catch 3 and 3; typingisapproving's behavioural
 * line catches 9 on its own (its other line only declares a constant);
 * reviewshowsuntranslated's one moving line catches 1 on its own. No half is
 * decorative. monthsmisparse replaces a whole function body and has no meaningful
 * split.
 *
 * WHAT THIS DOES NOT PROVE
 *   - Anything about real Postgres. RLS, constraints and the unique index on
 *     token are the database's job and are not exercised here.
 *   - Anything about layout. The DOM is a value-carrying double, not a browser:
 *     no CSS, no real event dispatch, no focus. Rendered STRINGS are asserted
 *     where the string is the claim ("saves $151"), never pixels.
 *   - Anything about the STAFF PAGE. There is no staff review front end yet, so
 *     H1-H6 hold the staff API against the OWNER's page and against the harness's
 *     own copies. When a staff surface ships, its render belongs on this side of
 *     the comparison the way public/workbook.html is on the other.
 *   - Anything about Stripe. Phase 3 is a preview built from the catalog table,
 *     and a call to api.stripe.com throws in the router rather than being mocked.
 *   - The staff-only door. api/_workbook-apply.test.mjs proves the owner's token
 *     opens none of the five actions (MUTATE=ownertoken); this file assumes it
 *     and only ever calls them with the staff bearer.
 *   - The deployment with no workbook_cards.meta column. The stub HAS the column,
 *     so the API's 42703 degradation path is not walked here; api/_workbook.test.mjs
 *     covers it from its own side.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PAGE = path.join(ROOT, "public", "workbook.html");
const API = path.join(ROOT, "api", "workbook.js");
const MUTATE = process.env.MUTATE || "";

let fails = 0, passes = 0;
const check = (ok, msg) => {
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
};
const die = (msg) => { console.log("\n" + msg); process.exit(1); };

// ═════════════════════════════════════════════════════════════════════════════
// 0. THE CONTROLS
//
// Each names the SIDE it breaks, because that is the whole point: a contract can
// be broken from either end and the file has to catch it from either end.
// A pin whose target text has moved reports NEGATIVE CONTROL FAILED rather than
// reverting nothing and passing quietly - which is how a decorative control was
// caught on this project before.
// ═════════════════════════════════════════════════════════════════════════════
const PAGE_CONTROLS = {
  // The page counts every card, so the empty add-a-plan card holds Send hostage
  // and the owner is told to confirm a card with nothing on it.
  pagecountsall: [[
    `  return c.counts!==false;`,
    `  return true; // (control pagecountsall) every card counts, empty or not`]],
  // Vocabulary matched case-sensitively. Stored "waive" no longer finds "Waive",
  // falls to the default, and the default on the sign-up fee is CHARGE.
  feecasing: [[
    `  const t=String(v).trim().toLowerCase();
  const i=list.findIndex(x=>String(x).trim().toLowerCase()===t);`,
    `  const t=String(v).trim();                                     // (control feecasing)
  const i=list.findIndex(x=>String(x).trim()===t);               // (control feecasing)`]],
  // The one line that stops the page answering in a different type than it was
  // asked in. Without it a number input answers a string-typed price.
  numericprice: [[
    `  if(typeof ref==='string'&&typeof v==='number')return String(v);`,
    `  // (control numericprice) a number is sent where the offer stores a string`]],
  // The parser as it was: first number in the string, then convert if the string
  // mentions weeks ANYWHERE. "3 Months (12 Weeks)" -> 3 -> /4.345 -> 1.
  monthsmisparse: [[
    `  const t=String(s==null?'':s);
  const mo=t.match(/(\\d+(?:\\.\\d+)?)\\s*(?:mo|mos|month|months)\\b/i);
  if(mo)return Math.max(1,Math.round(+mo[1]));
  const yr=t.match(/(\\d+(?:\\.\\d+)?)\\s*(?:yr|yrs|year|years)\\b/i);
  if(yr)return Math.max(1,Math.round(+yr[1]*12));
  const wk=t.match(/(\\d+(?:\\.\\d+)?)\\s*(?:wk|wks|week|weeks)\\b/i);
  if(wk)return Math.max(1,Math.round(+wk[1]/4.345));
  const any=t.match(/\\d+(?:\\.\\d+)?/);
  return any?Math.max(1,Math.round(+any[0])):1;`,
    `  const t=String(s==null?'':s);                                  // (control monthsmisparse)
  const n=parseFloat(t)||1;
  return /week|wk/i.test(t)?Math.max(1,Math.round(n/4.345)):Math.max(1,Math.round(n));`]],
};

const API_CONTROLS = {
  // The defect exactly as it shipped. `state` says WHAT the answer is; only
  // confirmed_at says WHETHER he approved it. Conflating them is how the gate
  // was defeated, and it was invisible to the API suite because the API suite
  // asserted it as correct.
  typingisapproving: [[
    `const cardIsReady = (card) => !!(card && card.confirmed_at);`,
    `const READY_STATES_BACK = new Set(["confirmed", "changed"]);   // (control typingisapproving)
const cardIsReady = (card) => READY_STATES_BACK.has(card && card.state);`]],
  // Pinned on the PAIR of lines, because doSave carries a near-identical retire
  // line and a control that patched both would report one bit of information
  // about two different claims.
  addkeepsconfirm: [[
    `  const retire = !!card.confirmed_at;
  const confirmedAt = retire ? null : card.confirmed_at;`,
    `  const retire = false;                          // (control addkeepsconfirm)
  const confirmedAt = card.confirmed_at;         // the approval survives the request`]],

  // ── THE STAFF HALF. Every one of these is a SINGLE LINE, because a control
  // that patches two lines reports one bit of information about two claims -
  // which is how two decorative controls were found on this project. Where a pin
  // needs a second line to be unique, that second line is reproduced UNCHANGED in
  // the replacement, so exactly one line still moves.

  // The staff gate stops counting the same cards the owner was asked to confirm:
  // it counts a card only where an ANSWER was written down. The notes card - the
  // one whose whole content is "nothing to add" - drops out of the approval set,
  // so staff are never asked to approve a card the owner was made to confirm.
  staffcountsanswered: [[
    `  const counted = cards.filter((c) => cardCounts(grouped.get(c.id)));`,
    `  const counted = cards.filter((c) => (grouped.get(c.id) || []).some((a) => a.answered != null));   // (control staffcountsanswered)`]],
  // Review adopts the PAGE's flag rule - "a change is what he typed over what we
  // showed" - instead of the against-current rule. San Jose's three renames were
  // confirmed WITHOUT editing, so every one of them reads as untouched and staff
  // approve a rename they never saw.
  renameisnotachange: [[
    `    is_change: !jsonEqual(eff, a.current_value),`,
    `    is_change: !!(a.answered != null && !jsonEqual(a.answered, a.proposed)),   // (control renameisnotachange)`]],
  // A card with nothing to SHOW is dropped from review even when the gate counts
  // it, so the tax card, the add-a-plan card and the notes card vanish from the
  // surface staff read while apply still demands their approval.
  reviewdropscards: [[
    `    if (!items.length && !cardCounts(mine)) continue;   // nothing to show for an empty card`,
    `    if (!items.length) continue;   // (control reviewdropscards)`]],
  // will_write stops being the TRANSLATED value and becomes the raw answer, so
  // the preview shows staff the page's own "Charge" while the apply one call
  // later writes the offer's "charge". The anchor line above it is reproduced
  // unchanged; only the assignment moves.
  reviewshowsuntranslated: [[
    `    const out = cls.t(eff);
    if (out.ok) entry.will_write = out.value;`,
    `    const out = cls.t(eff);
    if (out.ok) entry.will_write = eff;   // (control reviewshowsuntranslated)`]],
  // The every-card-approved gate is gone, so an apply with a card nobody signed
  // off writes configuration anyway.
  staffgateoff: [[
    `  if (unapproved.length) {`,
    `  if (false && unapproved.length) {   // (control staffgateoff)`]],
  // The refusal counts the unapproved cards instead of NAMING them. Staff are
  // told "1 card" and have to go looking for which one, on a surface whose whole
  // job is telling them what is left.
  refusalnamescount: [[
    "      `apply is refused: ${unapproved.length} card(s) are not approved yet (${unapproved.join(\", \")}). Approve every card first - partial apply does not exist.`,",
    "      `apply is refused: ${unapproved.length} card(s) are not approved yet (${unapproved.length} of them). Approve every card first - partial apply does not exist.`,   // (control refusalnamescount)"]],
  // Staff review reopens the owner's half: a submitted workbook is editable
  // again, so a late autosave can rewrite an answer underneath the reviewer who
  // already approved it.
  applyreopensediting: [[
    `const OPEN_STATES = new Set(["draft", "sent"]);`,
    `const OPEN_STATES = new Set(["draft", "sent", "submitted", "reviewed"]);   // (control applyreopensediting)`]],
  // Rollback stops restoring the offer jsonb. It still answers ok and still says
  // what it restored; the configuration simply stays where the apply left it.
  rollbackleavesoffers: [[
    `  for (const o of Array.isArray(snap.offers) ? snap.offers : []) {`,
    `  for (const o of []) {   // (control rollbackleavesoffers) nothing is put back`]],
  // Rollback clears the OWNER's answers along with the applied stamps, so the
  // read-only page he was promised would not change under him renders BAM's
  // proposals back at him instead of what he sent.
  rollbackclearsanswers: [[
    `    body: JSON.stringify({ applied_at: null, apply_error: null, updated_at: nowIso() }),`,
    `    body: JSON.stringify({ applied_at: null, apply_error: null, answered: null, updated_at: nowIso() }),   // (control rollbackclearsanswers)`]],
  // The tax write never lands, so every amount the mint rehearsal prints is
  // PRE-TAX while the owner's own page told him what a parent pays with tax on.
  // This is the defect the tax card exists to close, reintroduced one write later.
  taxneverlands: [[
    `      body: JSON.stringify({ tax_config: value }),`,
    `      body: JSON.stringify({ tax_config: null }),   // (control taxneverlands)`]],
};

const ALL_CONTROLS = { ...PAGE_CONTROLS, ...API_CONTROLS };
if (MUTATE && !Object.prototype.hasOwnProperty.call(ALL_CONTROLS, MUTATE)) {
  // An unknown control name used to die with a TypeError, which exits non-zero -
  // indistinguishable from a control that bit. Say it out loud instead, so a
  // stale name in the docs fails the build rather than looking like a catch.
  die(`❌ NEGATIVE CONTROL FAILED: no control named ${MUTATE}. Known controls: ${Object.keys(ALL_CONTROLS).join(", ")}`);
}

function applyPins(src, pins, where) {
  let out = src;
  for (const [find, repl] of pins) {
    if (!out.includes(find)) {
      die(`❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in ${where}:\n\n${find}\n\nRe-point it at the fix it is meant to break, or delete it. A pin that fails to apply looks exactly like a check that passed.`);
    }
    out = out.split(find).join(repl);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE PAGE, EXTRACTED WHOLE
//
// The entire <script> block, run as one unit. Not a hand-picked list of
// functions: a contract test that re-selects which halves of the page to trust
// is choosing its own answer. The ONE edit is the trailing `boot();`, removed so
// the harness can await the real boot instead of racing a floating promise.
// ═════════════════════════════════════════════════════════════════════════════
const html = fs.readFileSync(PAGE, "utf8");
const SCRIPT_OPEN = html.indexOf("<script>");
const SCRIPT_CLOSE = html.lastIndexOf("</script>");
if (SCRIPT_OPEN < 0 || SCRIPT_CLOSE < 0) die("could not find the <script> block in public/workbook.html");
let pageSrc = html.slice(SCRIPT_OPEN + "<script>".length, SCRIPT_CLOSE);
if (!/\nboot\(\);\s*$/.test(pageSrc)) {
  die("public/workbook.html no longer ends its script with boot(); - the harness removes that one line so it can await the real boot. Re-point it.");
}
pageSrc = pageSrc.replace(/\nboot\(\);\s*$/, "\n");

// Source-level reads used by section A. These pull the field names the page's
// own models ask for OUT OF THE PAGE, so the shape assertion cannot drift into a
// hand-kept list that agrees with nothing.
function grab(name) {
  let i = pageSrc.indexOf("\nfunction " + name + "(");
  if (i < 0) i = pageSrc.indexOf("\nasync function " + name + "(");
  if (i < 0) die(`function not found in public/workbook.html: ${name}`);
  i += 1;
  let k = pageSrc.indexOf("{", i), depth = 0;
  for (; k < pageSrc.length; k++) {
    if (pageSrc[k] === "{") depth++;
    else if (pageSrc[k] === "}") { depth--; if (!depth) break; }
  }
  return pageSrc.slice(i, k + 1);
}
// A literal field name, never a fragment of a concatenation: `val(c,'commitments.'+i...)`
// captures "commitments." and would assert a field nobody reads.
const NAMEY = /^[a-z_][a-z0-9_]*$/i;
const literals = (src, re) => [...new Set([...src.matchAll(re)].map((m) => m[1]).filter((s) => NAMEY.test(s)))];
const PLAN_SRC = grab("planModel");
const PLAN_FIELDS = literals(PLAN_SRC, /val\(c,'([^']+)'/g);
const RUNG_FIELDS = literals(PLAN_SRC, /\bg\('([^']+)'/g);
const CODE_FIELDS = literals(grab("codeModel"), /\bg\('([^']+)'/g);
const TAX_FIELDS = literals(grab("taxModel"), /val\(c,'([^']+)'/g);

if (MUTATE && PAGE_CONTROLS[MUTATE]) {
  pageSrc = applyPins(pageSrc, PAGE_CONTROLS[MUTATE], "public/workbook.html");
  console.log(`!! MUTATED (page): ${MUTATE}\n`);
}

// ── the fake DOM ────────────────────────────────────────────────────────────
// A VALUE-CARRYING DOUBLE, not a browser. Two properties make it faithful enough
// to hold a contract against, and both were learned the hard way here:
//
//   AN ELEMENT EXISTS ONLY IF SOMETHING RENDERED IT. The page is full of
//   `const el=document.getElementById(x); if(!el)return;` guards, and they carry
//   real meaning - drawLadder is called for the add-a-plan card, which has no
//   ladder, and the guard is what makes that a no-op. A double that hands back an
//   element for every id turns those guards into crashes and, worse, would let a
//   page that reads a control it never drew look correct. So the static shell's
//   ids are read out of workbook.html itself, and every id the page renders is
//   registered as it writes the markup that contains it.
//
//   .value ROUND-TRIPS AS A STRING, exactly as HTMLInputElement does, because
//   `+this.value||0` and `g(id)===''` are how the page reads money.
//
// What the owner reads - .textContent, .innerHTML, and aria-disabled on Send
// through the page's own sendBlocked() - is real and is what gets asserted.
const DOMBOX = new Map();
const OWNED = new Map();          // container id -> ids that container rendered
function El(id) {
  const cls = new Set();
  let value = "", inner = "", outer = "";
  const attr = {};
  const el = {
    id, textContent: "", title: "", disabled: false,
    style: { display: "", cssText: "", width: "" }, dataset: {}, offsetWidth: 0,
    get value() { return value; },
    set value(v) { value = String(v == null ? "" : v); },
    get innerHTML() { return inner; },
    set innerHTML(v) { inner = String(v == null ? "" : v); registerMarkup(id, inner); },
    get outerHTML() { return outer; },
    set outerHTML(v) { outer = String(v == null ? "" : v); registerMarkup(id, outer); },
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; },
      contains: (c) => cls.has(c),
    },
    setAttribute: (k, v) => { attr[k] = String(v); },
    getAttribute: (k) => (k in attr ? attr[k] : null),
    querySelectorAll: () => [],
    scrollIntoView: () => {},
    focus: () => {},
  };
  return el;
}
const mint = (id) => { if (!DOMBOX.has(id)) DOMBOX.set(id, El(id)); return DOMBOX.get(id); };
const byId = (id) => DOMBOX.get(id) || null;
// Whatever markup a container just wrote IS the set of elements it now holds.
// Ids it used to hold and no longer writes stop existing, which is how a control
// the page stopped drawing stops being readable.
function registerMarkup(containerId, markup) {
  const next = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const old of OWNED.get(containerId) || []) if (!next.has(old) && old !== containerId) DOMBOX.delete(old);
  OWNED.set(containerId, next);
  for (const id of next) mint(id);
}
// The static shell, read out of the real file rather than transcribed.
for (const m of html.slice(0, SCRIPT_OPEN).matchAll(/\bid="([^"]+)"/g)) mint(m[1]);
// What an element on his screen actually says. An id that does not exist reads
// as a sentinel rather than throwing, so a missing control is REPORTED by the
// assertion that reads it instead of taking the run down.
const txt = (id) => { const e = byId(id); return e ? String(e.textContent) : "(no such element)"; };
const inner = (id) => { const e = byId(id); return e ? String(e.innerHTML) : "(no such element)"; };
const fakeDocument = {
  title: "", visibilityState: "visible", body: mint("body"),
  getElementById: byId,
  querySelectorAll: () => [],
};

// ── timers the harness controls ─────────────────────────────────────────────
// The page autosaves on an 800ms debounce. Firing timers immediately would turn
// every keystroke into its own in-flight request and make the assertions race
// each other; never firing them would test a page that never saves. So they are
// QUEUED, and the harness drains them where a real 800ms would have elapsed.
const TIMERS = new Map();
let timerSeq = 0;
const fakeSetTimeout = (fn) => { const id = ++timerSeq; TIMERS.set(id, fn); return id; };
const fakeClearTimeout = (id) => { TIMERS.delete(id); };
async function runTimers() {
  for (let round = 0; round < 5 && TIMERS.size; round++) {
    const due = [...TIMERS.entries()];
    TIMERS.clear();
    for (const [, fn] of due) await fn();
  }
  await settle();
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

let ALERTS = [];
const fakeLocation = { search: "?t=" + encodeURIComponent("wbk_tok_contract"), origin: "https://portal.example", hash: "", pathname: "/workbook.html" };

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE DATABASE - the only thing stubbed
//
// A PostgREST-shaped double: eq / in / is.null / like filters, select projection
// with PostgREST's own 42703 for an unknown column, order, limit, and
// Prefer: return=representation. The projection is honoured on purpose - a select
// that forgets a column the route then reads has to break here rather than in
// production.
// ═════════════════════════════════════════════════════════════════════════════
const SB_BASE = "https://stub.supabase.test";
process.env.SUPABASE_URL = SB_BASE;
process.env.VITE_SUPABASE_URL = SB_BASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.SUPABASE_SERVICE_KEY;

const TOKEN = "wbk_tok_contract";
// The STAFF credential. Nothing the owner's page ever sends carries it, which is
// the point: the five review actions are reachable only from this side.
const STAFF_BEARER = "staff-session-" + "contract-Kp3";
const OFFER_ID = "off1";
const COLUMNS = {
  clients: ["id", "public_name", "business_name", "tax_config"],
  staff: ["id", "user_id", "name", "email"],
  offers: ["id", "client_id", "status", "title", "type", "data"],
  workbooks: ["id", "client_id", "kind", "token", "status", "submitted_at", "reviewed_at", "snapshot", "created_at", "updated_at"],
  workbook_cards: ["id", "workbook_id", "card_key", "title", "sort_order", "state", "confirmed_at", "approved_at", "approved_by", "meta", "created_at", "updated_at"],
  workbook_answers: ["id", "workbook_id", "card_id", "client_id", "target_kind", "target_table", "target_id", "target_field", "current_value", "proposed", "answered", "applied_at", "apply_error", "created_at", "updated_at"],
  pricing_catalog: ["id", "client_id", "stripe_price_id", "offer_price_key", "tier", "amount_cents", "interval", "currency", "display_name"],
  offer_prices: ["id", "tenant_id", "source_offer_id", "source_offer_price_key", "billing_cadence"],
};

// ── THE FIXTURE: San Jose's price workbook, in the shapes the offer really uses ──
//
// Every value here is chosen because it is the shape that broke something:
//   price / signup_fee are STRINGS, because offer_prices stores them that way
//     and the API compares primitives with ===.
//   taxable / signup_fee_on_base / once_per_customer are LOWERCASE, because the
//     offer stores "waive" and the page's chip lists say "Waive".
//   the plan title DIFFERS between current_value and proposed, because three of
//     San Jose's four plan names do - a card he merely confirms is a rename.
//   a commitment length reads "3 Months (12 Weeks)", because that string is what
//     made the page tell him a $749 prepay saved him nothing.
//   the codes card's applies_to NAMES the 3-month rung, which is the API's own
//     independent statement of what that length means.
//   the `plans` card has NO answers, because that is the card the product owner
//     kept as a home for additions and refused to make the eighth mandatory click.
let seq = 0;
let DB;
const ANS = [];
let ansSeq = 0;
function a(cardId, field, current, proposed, extra = {}) {
  ANS.push({
    id: `a${++ansSeq}`, workbook_id: "wb1", card_id: cardId, client_id: "sj",
    // THE ANSWERS AIM AT THE OFFER JSONB, because that is the only table the
    // apply step will write. A workbook whose rows aimed anywhere else could be
    // reviewed and approved and would then refuse at apply, which is a gate the
    // owner already walked through discovering itself one step too late.
    target_kind: "price_row", target_table: "offers", target_id: OFFER_ID,
    target_field: field, current_value: current, proposed: proposed === undefined ? current : proposed,
    answered: null, applied_at: null,
    created_at: `2026-08-04T00:00:${String(ansSeq).padStart(2, "0")}Z`,
    ...extra,
  });
}
// A whole plan card, every field the page's planModel asks for.
function planAnswers(cardId, o) {
  a(cardId, "title", o.currentTitle, o.title);
  a(cardId, "type", "membership");
  a(cardId, "whats_included", o.included);
  a(cardId, "price", o.price);
  a(cardId, "billing_cycle", "monthly");
  a(cardId, "billing_cycle_other", null);
  a(cardId, "taxable", "yes");
  a(cardId, "signup_fee", o.fee);
  a(cardId, "signup_fee_taxable", "yes");
  a(cardId, "signup_fee_on_base", o.feeOnBase);
  a(cardId, "sessions_included", null);
  a(cardId, "expires_after", null);
  a(cardId, "other_description", null);
  a(cardId, "description", null);
  // ARCHIVING IS A PROPOSAL LIKE ANY OTHER. currentArchived is what the offer
  // holds today; archived is what BAM proposed. Keeping them apart matters: a
  // card whose offering is ALREADY archived cannot be resolved at all, so a
  // fixture that pre-archived it would be testing the refusal, not the write.
  a(cardId, "archived", o.currentArchived === true, o.archived === true);
  (o.rungs || []).forEach((r, i) => {
    const f = (n) => `commitments.${i}.${n}`;
    a(cardId, f("length"), r.currentLength === undefined ? r.length : r.currentLength, r.length);
    a(cardId, f("price"), r.currentPrice === undefined ? r.price : r.currentPrice, r.price);
    a(cardId, f("after"), "Renews same length");
    a(cardId, f("after_other"), null);
    a(cardId, f("whats_included"), null);
    a(cardId, f("taxable"), "yes");
    a(cardId, f("signup_fee_charge"), "waive");
    a(cardId, f("discount_notes"), null);
    a(cardId, f("archived"), false);
  });
}
planAnswers("c-p1", {
  // THE SAN JOSE RENAME: the portal stores "2 Trainings/Week", the card shows Lij
  // his own Stripe name. Confirming without typing renames the plan.
  currentTitle: "2 Trainings/Week", title: "Academy 2x/week",
  included: "Two team trainings a week.", price: "300", fee: "40",
  // LOWERCASE, as the offer stores it. Capitalised "Charge" is the page's default,
  // and falling through to it tells him we take his $40 on every prepay option.
  feeOnBase: "waive",
  rungs: [
    // 300 x 3 = 900 against 749 -> saves $151, at $250/mo. Read as 1 month it is
    // $749/mo and "no saving".
    { length: "3 Months (12 Weeks)", price: "749" },
    { length: "6 Months (24 Weeks)", price: "1450" },
    // Proposed by BAM, never sold: current_value null is the ONLY source of the
    // "new" badge on a deployment with no meta column.
    // NINE months, not twelve, and the reason is worth keeping: misread as weeks,
    // twelve months rounds to 3 (12/4.345 = 2.76), which quietly re-supplied the
    // |3_months key that MUTATE=monthsmisparse is supposed to take away. The
    // control still bit on the money assertions, but the applies_to check passed
    // for a coincidence rather than because anything was right. Nine rounds to 2
    // and collides with nothing.
    { length: "9 Months (36 Weeks)", price: "2100", currentLength: null, currentPrice: null },
  ],
});
// A SECOND RENAME, and it is a WORD rather than a letter case, so the two shapes
// of "confirmed without editing is still a change" are both on the table.
planAnswers("c-p2", { currentTitle: "Academy Unlimited Pass", title: "Academy Unlimited", included: "Every session we run.", price: "425", fee: "40", feeOnBase: "charge", rungs: [] });
planAnswers("c-p3", { currentTitle: "Elementary 1x/Week", title: "Elementary 1x/week", included: "One session a week.", price: "180", fee: "40", feeOnBase: "waive", rungs: [] });
planAnswers("c-p4", { currentTitle: "Legacy Elite", title: "Legacy Elite", included: "Not sold to new families.", price: "500", fee: "0", feeOnBase: "charge", archived: true, rungs: [] });
// The tax card: one column, one answer, keys in a DIFFERENT order in `proposed`
// because jsonb does not preserve order and a stringifying comparison would
// report a change nobody made.
a("c-tax", "tax_config", { charges_tax: true, pct: 9.375, label: "CA sales tax" }, { label: "CA sales tax", pct: 9.375, charges_tax: true }, { target_kind: "academy_setting", target_table: "clients", target_id: "sj" });
// The discount code. applies_to is the API's OWN statement of which rung is the
// three-month one, which is what section D holds the page's parser against.
a("c-codes", "codes.0.code", "SIBLING10");
a("c-codes", "codes.0.kind", "Percent off");
a("c-codes", "codes.0.value", "10");
a("c-codes", "codes.0.duration", "Every payment");
a("c-codes", "codes.0.duration_months", null);
a("c-codes", "codes.0.applies_to", ["Academy 2x/week|monthly", "Academy 2x/week|3_months"]);
a("c-codes", "codes.0.expires_at", null);
a("c-codes", "codes.0.max_redemptions", null);
a("c-codes", "codes.0.once_per_customer", "yes");
a("c-notes", "notes", null);

// ── THE LIVE OFFER the workbook is a proposal ABOUT ──────────────────────────
//
// Written in the OFFER's vocabulary, not the page's: "waive" lowercase, "Monthly"
// and "Membership" capitalised, prices as STRINGS, once_per_customer as a
// BOOLEAN. Every offering's title is the current_value the matching plan card
// carries, because that title answer is the only thing that resolves a card to an
// offering - a plan whose title does not match is a refusal, never a create.
//
// It is deliberately BEHIND the workbook in three places, so apply has real work:
// the third commitment rung on the first plan does not exist here at all, the
// Elementary plan still charges its joining fee where the owner waived it, and
// two of the four plan names are the ones his Stripe shows rather than the ones
// BAM proposed.
const OFFER_DATA = () => ({
  pricing: {
    pricing_offerings: [
      {
        title: "2 Trainings/Week", type: "Membership", price: "300", billing_cycle: "Monthly",
        whats_included: "Two team trainings a week.", taxable: "Yes",
        signup_fee: "40", signup_fee_taxable: "Yes", signup_fee_on_base: "waive", archived: false,
        commitments: [
          { length: "3 Months (12 Weeks)", price: "749", after: "Renews same length", taxable: "Yes", signup_fee_charge: "waive", archived: false },
          { length: "6 Months (24 Weeks)", price: "1450", after: "Renews same length", taxable: "Yes", signup_fee_charge: "waive", archived: false },
        ],
      },
      {
        title: "Academy Unlimited Pass", type: "Membership", price: "425", billing_cycle: "Monthly",
        whats_included: "Every session we run.", taxable: "Yes",
        signup_fee: "40", signup_fee_taxable: "Yes", signup_fee_on_base: "charge", archived: false,
      },
      {
        title: "Elementary 1x/Week", type: "Membership", price: "180", billing_cycle: "Monthly",
        whats_included: "One session a week.", taxable: "Yes",
        signup_fee: "40", signup_fee_taxable: "Yes", signup_fee_on_base: "waive", archived: false,
      },
      {
        // STILL LIVE in the offer, and the workbook is the thing proposing to
        // retire it. An already-archived offering cannot be resolved by name at
        // all, so pre-archiving it here would test the refusal instead of the write.
        title: "Legacy Elite", type: "Membership", price: "500", billing_cycle: "Monthly",
        whats_included: "Not sold to new families.", taxable: "Yes",
        signup_fee: "0", signup_fee_taxable: "Yes", signup_fee_on_base: "charge", archived: false,
      },
    ],
    // once_per_customer is a BOOLEAN here and the string "yes" in the workbook.
    // That is not a typo: it is the shape the translation exists to bridge.
    discount_codes: [
      { code: "SIBLING10", kind: "Percent off", value: "10", duration: "Every payment", once_per_customer: true, applies_to: ["Academy 2x/week|monthly", "Academy 2x/week|3_months"] },
    ],
  },
});

function reset() {
  seq = 0;
  DB = {
    clients: [{ id: "sj", public_name: "By Any Means San Jose", business_name: "BAM San Jose", tax_config: null }],
    staff: [{ id: "staff-1", user_id: "user-1", name: "Zoran", email: "zoran@byanymeansbball.com" }],
    offers: [{ id: OFFER_ID, client_id: "sj", status: "active", title: "Training", type: "training", data: OFFER_DATA() }],
    pricing_catalog: [],
    offer_prices: [],
    workbooks: [{ id: "wb1", client_id: "sj", kind: "price", token: TOKEN, status: "sent", submitted_at: null, reviewed_at: null, snapshot: null, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z" }],
    workbook_cards: [
      { id: "c-tax", workbook_id: "wb1", card_key: "tax", title: "Sales tax", sort_order: 0, state: "untouched", confirmed_at: null, meta: {} },
      { id: "c-p1", workbook_id: "wb1", card_key: "plan:p1", title: "Academy 2x/week", sort_order: 1, state: "untouched", confirmed_at: null, meta: { fam: "two", live: true, members: "9 members pay this today", default_signup_fee: 40, commitments: [{ members: "4 members" }, {}, { fresh: true }] } },
      { id: "c-p2", workbook_id: "wb1", card_key: "plan:p2", title: "Academy Unlimited", sort_order: 2, state: "untouched", confirmed_at: null, meta: { fam: "unl", live: true } },
      { id: "c-p3", workbook_id: "wb1", card_key: "plan:p3", title: "Elementary 1x/week", sort_order: 3, state: "untouched", confirmed_at: null, meta: { fam: "one", live: false } },
      { id: "c-p4", workbook_id: "wb1", card_key: "plan:p4", title: "Legacy Elite", sort_order: 4, state: "untouched", confirmed_at: null, meta: { fam: "ele" } },
      // NO ANSWERS. The card exists because an addition needs a card to belong to,
      // and it must not become the eighth mandatory click by the back door.
      { id: "c-plans", workbook_id: "wb1", card_key: "plans", title: "Anything you sell that is not listed", sort_order: 5, state: "untouched", confirmed_at: null, meta: {} },
      { id: "c-codes", workbook_id: "wb1", card_key: "codes", title: "Discount codes", sort_order: 6, state: "untouched", confirmed_at: null, meta: {} },
      { id: "c-notes", workbook_id: "wb1", card_key: "notes", title: "Anything else", sort_order: 7, state: "untouched", confirmed_at: null, meta: {} },
    ],
    workbook_answers: ANS.map((r) => ({ ...r })),
  };
}
reset();

const httpErr = (code, message) => ({ status: 400, body: { code, message, details: null, hint: null } });
function applyFilters(table, params) {
  let rows = (DB[table] || []).slice();
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const s = String(v);
    if (s.startsWith("eq.")) { const val = s.slice(3); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) === val); }
    else if (s.startsWith("neq.")) { const val = s.slice(4); rows = rows.filter((r) => String(r[k] == null ? "" : r[k]) !== val); }
    else if (s.startsWith("in.(")) { const vals = s.slice(4, -1).split(","); rows = rows.filter((r) => vals.includes(String(r[k]))); }
    else if (s === "not.is.null") rows = rows.filter((r) => r[k] != null);
    else if (s.startsWith("is.null")) rows = rows.filter((r) => r[k] == null);
    else if (s.startsWith("like.")) {
      // PostgREST spells the wildcard `*` and translates it to SQL's `%`. The
      // delete that removes an addition leans on this filter for its safety, so
      // the stub has to mean the same thing by it that the database does.
      const pat = s.slice(5);
      const rx = new RegExp("^" + pat.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      rows = rows.filter((r) => rx.test(String(r[k] == null ? "" : r[k])));
    }
  }
  const ord = params.get("order");
  if (ord) {
    const keys = ord.split(",").map((t) => t.trim().split("."));
    rows.sort((x, y) => {
      for (const [k, dir] of keys) {
        const av = x[k], bv = y[k];
        if (av === bv) continue;
        const c = (av == null ? "" : av) < (bv == null ? "" : bv) ? -1 : 1;
        return dir === "desc" ? -c : c;
      }
      return 0;
    });
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

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE ROUTER - one fetch for both halves
//
// The page calls /api/workbook, which lands in the REAL handler, which calls
// Supabase, which lands in the stub above. Nothing between the page and the
// handler is faked, which is the entire point of this file.
// ═════════════════════════════════════════════════════════════════════════════
let HANDLER = null;
const API_CALLS = [];
async function router(url, init = {}) {
  const u = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  if (u.startsWith("/api/workbook")) {
    if (!HANDLER) throw new Error("the route was called before it was imported");
    const body = init.body ? JSON.parse(init.body) : null;
    API_CALLS.push({ method, url: u, body });
    let status = 200, out = null;
    const res = { status(c) { status = c; return this; }, json(b) { out = b; return this; } };
    // HEADERS ARE FORWARDED, and the page never sets any. That asymmetry is the
    // whole staff door: resolveStaff reads req.headers.authorization, and the
    // owner's page has nothing to put there.
    await HANDLER({ method, url: u, headers: init.headers || {}, query: {}, body }, res);
    return json(out, status);
  }
  // Staff auth. Only the one bearer the harness hands the STAFF calls resolves to
  // a user; anything else - including the owner's workbook token - is a 401 from
  // the auth service before the route ever reads a row.
  if (u.startsWith(`${SB_BASE}/auth/v1/`)) {
    const bearer = String((init.headers || {}).Authorization || "");
    return bearer === `Bearer ${STAFF_BEARER}`
      ? json({ id: "user-1", email: "zoran@byanymeansbball.com" })
      : json({ msg: "invalid" }, 401);
  }
  if (u.startsWith("https://api.stripe.com/")) throw new Error(`STRIPE WAS CALLED: ${method} ${u} - nothing in this pass may talk to Stripe`);
  if (!u.startsWith(`${SB_BASE}/rest/v1/`)) throw new Error(`UNSTUBBED CALL: ${method} ${u}`);
  // The runtime builds a Headers object out of init.headers and its validator
  // throws quoting the whole value; keeping that here means the credential guard
  // in api/_header-safe-credential.js is exercised rather than bypassed.
  new Headers(init.headers || {});

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
        const row = { id: `new-${++seq}`, status: "draft", submitted_at: null, applied_at: null, created_at: "2026-08-04T12:00:00Z", ...r };
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
}
globalThis.fetch = router;

// ── importing the real route ────────────────────────────────────────────────
// api/workbook.js imports api/_sentry.js, which imports @sentry/node. A worktree
// has no node_modules, so when the package cannot be resolved this runs a COPY
// with that ONE import replaced by an identity wrapper - and SAYS SO out loud,
// because a suite that quietly tests a different file than it claims is its own
// kind of leak. Where node_modules exists, the real file is imported untouched.
const tmp = [];
process.on("exit", () => { for (const f of tmp) { try { fs.unlinkSync(f); } catch { /* best effort */ } } });
let sentryOk = true;
try { await import("@sentry/node"); } catch { sentryOk = false; }
const SENTRY_IMPORT = 'import { withSentryApiRoute } from "./_sentry.js";';
const SENTRY_STUB = 'const withSentryApiRoute = (h) => h; // (contract suite) @sentry/node is not installed here';
if (!sentryOk) console.log("  (note) @sentry/node is not installed here, so the copy under test has its _sentry import replaced by an identity wrapper. Nothing else about api/workbook.js is changed.\n");

let modulePath = API;
if (!sentryOk || API_CONTROLS[MUTATE]) {
  let src = fs.readFileSync(API, "utf8");
  if (API_CONTROLS[MUTATE]) {
    src = applyPins(src, API_CONTROLS[MUTATE], "api/workbook.js");
    console.log(`!! MUTATED (api): ${MUTATE}\n`);
  }
  if (!sentryOk) src = applyPins(src, [[SENTRY_IMPORT, SENTRY_STUB]], "api/workbook.js");
  modulePath = path.join(ROOT, "api", ".mutant-contract-workbook.js");
  fs.writeFileSync(modulePath, src);
  tmp.push(modulePath);
}
HANDLER = (await import(pathToFileURL(modulePath).href)).default;

// A direct call to the route, for the places where the SERVER's own opinion has
// to be read without the page in the middle.
async function callApi(body) {
  const r = await router("/api/workbook", { method: "POST", body: JSON.stringify({ token: TOKEN, ...body }) });
  return r.json();
}
async function getApi() {
  const r = await router(`/api/workbook?token=${encodeURIComponent(TOKEN)}`, { method: "GET" });
  return r.json();
}
// THE STAFF DOOR. Same router, same handler; the only difference is a header the
// owner's page cannot produce.
async function staffApi(body) {
  const r = await router("/api/workbook", {
    method: "POST",
    headers: { authorization: `Bearer ${STAFF_BEARER}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const dbCard = (id) => DB.workbook_cards.find((c) => c.id === id);
const dbAnswer = (cardId, field) => DB.workbook_answers.find((r) => r.card_id === cardId && r.target_field === field);

// ═════════════════════════════════════════════════════════════════════════════
// 4. BUILDING THE PAGE
// ═════════════════════════════════════════════════════════════════════════════
const RETURNS = [
  "ingest", "render", "boot", "reload", "card", "counted", "countedCards", "remainingCount",
  "isReady", "flaggedCount", "updProg", "isChanged", "setA", "confirmCard", "doSubmit",
  "submitAdd", "removeAddition", "flushAll", "idxOf", "monthsOf", "sameShape", "val", "ansOf",
  "planModel", "taxModel", "codeModel", "priceKeys", "addSummary", "readAdd", "addProblem",
  "capReason", "pillOf", "additionsOf", "hasAdditionFields", "sendBlocked", "drawPlan",
  "openAdd",
  "drawLadder", "prevOpts", "TYPES", "TYPES_W", "CYCLES", "CYCLES_W", "AFTER", "AFTER_W",
  "YESNO_W", "CHARGE_W", "DUR", "KIND", "ADDOPEN", "MAX_ADD_PER_CARD",
].join(", ");
const pageBody = pageSrc + `\nreturn { ${RETURNS}, get CARDS(){return CARDS}, get MODEL(){return MODEL}, get WB(){return WB}, get RO(){return RO}, get SAVE(){return SAVE} };\n`;
const pageGlobals = {
  document: fakeDocument, location: fakeLocation, fetch: router, console,
  setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
  addEventListener: () => {}, removeEventListener: () => {},
  alert: (m) => { ALERTS.push(String(m)); },
  scrollTo: () => {}, requestAnimationFrame: (f) => { f(); return 1; },
  // The static shell really does contain each of these ids, and the page reads
  // them as bare globals the way a browser exposes them. Same objects the fake
  // document hands out, so an assertion on ncf.textContent is reading exactly
  // what the owner would see.
  ncf: mint("ncf"), ncf2: mint("ncf2"), ntot: mint("ntot"), ntot2: mint("ntot2"),
  nflag: mint("nflag"), nflagword: mint("nflagword"), pfill: mint("pfill"),
  lefttxt: mint("lefttxt"), sendbtn: mint("sendbtn"), sendwhy: mint("sendwhy"),
  sendwrap: mint("sendwrap"),
};
let page;
try {
  page = new Function(...Object.keys(pageGlobals), pageBody)(...Object.values(pageGlobals));
} catch (e) {
  die("the page script would not run in the harness: " + (e && e.message));
}

// ── driving the page the way the owner does ─────────────────────────────────
const lidOf = (key) => (page.CARDS.find((c) => c.card_key === key) || {}).lid;
const cardOf = (key) => page.CARDS.find((c) => c.card_key === key);
// A keystroke, then the debounce elapsing. flushAll is the page's own function
// and is what confirm and submit call, so this is the real save path.
async function type(key, field, value) {
  page.setA(lidOf(key), field, value);
  TIMERS.clear();                 // the debounce would have coalesced these
  await page.flushAll();
  await settle();
}
async function confirm(key) { await page.confirmCard(lidOf(key)); await settle(); }

// THE COMPARISON THIS FILE EXISTS FOR. `remaining` is the number the page prints
// to the owner as "Confirm the remaining N cards to send"; the server computes
// its own from the live rows and enforces it at submit. A disagreement is a lie
// on his screen in one direction and a defeated gate in the other.
function agree(label, serverRemaining) {
  page.updProg();
  const pageN = page.remainingCount();
  check(pageN === serverRemaining, `${label}: remaining agrees (page ${pageN}, server ${serverRemaining})`);
  const shown = txt("lefttxt");
  const inShown = /(\d+)/.test(shown) ? +RegExp.$1 : (shown.includes("all done") ? 0 : -1);
  check(inShown === serverRemaining, `${label}: and the sentence on his screen says the server's number ("${shown}")`);
}

console.log("\n══ WORKBOOK CONTRACT: the real page against the real handler ══");

// ═════════════════════════════════════════════════════════════════════════════
// A. SHAPE - a field the page reads and the API never sends is a silent blank
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── A. shape: everything the page reads is something the API sends ──");
const wire = await getApi();
check(wire.ok === true && Array.isArray(wire.cards) && wire.cards.length === 8, "the API answers the GET the page boots with");

// Keys read straight off the response by ingest/applyCard/render/pillOf.
const WB_KEYS = ["id", "kind", "status", "academy_name", "submitted_at"];
const CARD_KEYS = ["card_key", "title", "sort_order", "state", "confirmed_at", "can_add", "add_left", "counts", "answers"];
const ANSWER_KEYS = ["id", "target_kind", "target_table", "target_id", "target_field", "current_value", "proposed", "answered"];
check(WB_KEYS.every((k) => k in wire.workbook), `every workbook key the page reads is present (${WB_KEYS.join(", ")})`);
check(wire.cards.every((c) => CARD_KEYS.every((k) => k in c)), `every card key the page reads is present (${CARD_KEYS.join(", ")})`);
const everyAnswer = wire.cards.flatMap((c) => c.answers);
check(everyAnswer.every((x) => ANSWER_KEYS.every((k) => k in x)), `every answer key the page reads is present (${ANSWER_KEYS.join(", ")})`);
// PRESENT AND NULL, not omitted. current_value null means "the portal stores
// NOTHING for this row", which is the only source of the page's "new" badge on a
// deployment with no meta column.
const newRung = wire.cards.find((c) => c.card_key === "plan:p1").answers.find((x) => x.target_field === "commitments.2.length");
check(!!newRung && "current_value" in newRung && newRung.current_value === null, "a row the portal stores nothing for keeps current_value PRESENT and null");

// The field names are pulled out of the page's own models, so this cannot drift
// into a hand-kept list that agrees with nobody.
const fieldsOf = (key) => new Set(wire.cards.find((c) => c.card_key === key).answers.map((x) => x.target_field));
const p1Fields = fieldsOf("plan:p1");
const missingPlan = PLAN_FIELDS.filter((f) => !p1Fields.has(f));
check(missingPlan.length === 0, `every field planModel reads is sent for a plan card (${PLAN_FIELDS.length} fields${missingPlan.length ? ", MISSING " + missingPlan.join(", ") : ""})`);
const missingRung = RUNG_FIELDS.filter((f) => !p1Fields.has(`commitments.0.${f}`));
check(missingRung.length === 0, `every field a commitment rung reads is sent (${RUNG_FIELDS.length} fields${missingRung.length ? ", MISSING " + missingRung.join(", ") : ""})`);
const codeFields = fieldsOf("codes");
const missingCode = CODE_FIELDS.filter((f) => !codeFields.has(`codes.0.${f}`));
check(missingCode.length === 0, `every field a discount code reads is sent (${CODE_FIELDS.length} fields${missingCode.length ? ", MISSING " + missingCode.join(", ") : ""})`);
check(TAX_FIELDS.every((f) => fieldsOf("tax").has(f)), `every field the tax card reads is sent (${TAX_FIELDS.join(", ")})`);

// Now boot the REAL page against that REAL response.
await page.boot();
await settle();
check(page.CARDS.length === 8 && page.WB.academy_name === "By Any Means San Jose", "the page boots off it and renders 8 cards");
check(page.CARDS.map((c) => c.card_key).join(",") === wire.cards.map((c) => c.card_key).join(","), "in the order the server sent them");

// CREATION GOES THROUGH `add`, NEVER THROUGH `save`, and both halves have to
// agree about that or the owner loses typing. The page writes a null id for a
// field with no row; the server refuses an id it does not own rather than
// inventing a row, and the page has a sentence ready for exactly that.
{
  const before = DB.workbook_answers.length;
  page.setA(lidOf("plan:p1"), "commitments.9.length", "9 Months");
  TIMERS.clear();
  await page.flushAll();
  await settle();
  check(DB.workbook_answers.length === before, "a save that would CREATE a row writes nothing (creation is the add action, on both sides)");
  check(page.SAVE.state === "error" && /cannot add brand new items yet/.test(page.SAVE.msg), "and the page says so in its own words instead of showing him a validation string");
}
await page.boot();          // back to a clean page; nothing was written
await settle();
ALERTS = [];

// ═════════════════════════════════════════════════════════════════════════════
// B. VOCABULARY - the offer stores lowercase, the page's chips are capitalised
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── B. vocabulary round trip: stored 'waive' must select Waive ──");
{
  const p1 = page.MODEL[lidOf("plan:p1")];
  const stored = dbAnswer("c-p1", "signup_fee_on_base").current_value;
  const want = page.CHARGE_W.findIndex((x) => String(x).toLowerCase() === String(stored).toLowerCase());
  check(stored === "waive", `the offer really does store it lowercase ("${stored}")`);
  // MUTATE=feecasing: this falls to 0, which is CHARGE, on a money field.
  check(p1.feeOnBase === want, `a stored "${stored}" selects the ${page.CHARGE_W[want]} chip, not the default`);
  // The sentence the owner reads. Under the casing defect the parent preview
  // gains "Plus a one-time $40 joining fee." on a plan whose fee is waived.
  page.prevOpts(lidOf("plan:p1"));
  const preview = txt("pv_fee_" + lidOf("plan:p1"));
  check(!/joining fee/.test(preview), `and the parent preview does NOT claim the $40 is charged ("${preview}")`);

  // EVERY list, both directions: what the offer stores must find a chip, and the
  // chip the page sends back must find the same chip again. A one-way match would
  // let the page answer in a vocabulary it cannot itself read.
  const LISTS = { CHARGE_W: page.CHARGE_W, YESNO_W: page.YESNO_W, CYCLES_W: page.CYCLES_W, AFTER_W: page.AFTER_W, DUR: page.DUR, KIND: page.KIND, TYPES_W: page.TYPES_W };
  let bad = [];
  for (const [name, list] of Object.entries(LISTS)) {
    list.forEach((word, i) => {
      if (page.idxOf(list, String(word).toLowerCase(), -1) !== i) bad.push(`${name}: stored "${String(word).toLowerCase()}" does not select ${word}`);
      if (page.idxOf(list, word, -1) !== i) bad.push(`${name}: the page's own "${word}" does not round trip`);
    });
  }
  check(bad.length === 0, `all 7 chip lists round trip in offer casing and in their own${bad.length ? " - " + bad[0] : ""}`);

  // Values the offer really holds today, read through the real model.
  // ── A REAL DISAGREEMENT, MEASURED AND REPORTED RATHER THAN ASSERTED AWAY ────
  // The page reads vocabulary case-INSENSITIVELY and writes it back CAPITALISED,
  // while the API compares primitives with === and no coercion. So pressing the
  // chip that is ALREADY SELECTED sends "Waive" over a stored "waive": a click
  // that changes nothing is recorded as a change on a money field, and (because a
  // real edit retires an earlier confirm) it would un-confirm a card he had
  // approved. This is printed rather than asserted because the fix belongs in
  // public/workbook.html, which this script does not own - and it is MEASURED
  // rather than described, so nobody has to take the claim on trust. The probe is
  // undone immediately so nothing downstream reads a workbook it disturbed.
  const P3 = "plan:p3";
  const keepAnswer = { ...dbAnswer("c-p3", "signup_fee_on_base") };
  const keepCard = { ...dbCard("c-p3") };
  const already = page.CHARGE_W[page.MODEL[lidOf(P3)].feeOnBase];      // the chip already lit
  await type(P3, "signup_fee_on_base", already);
  const land = dbAnswer("c-p3", "signup_fee_on_base");
  console.log(`  NOTE  pressing the chip that is ALREADY selected sent ${JSON.stringify(land.answered)} over a stored ${JSON.stringify(keepAnswer.current_value)}, and the server now calls that card '${dbCard("c-p3").state}'.`);
  console.log(`  NOTE  ${dbCard("c-p3").state === "changed" ? "A no-op click on a money field is recorded as a change staff must adjudicate, and a later one would retire a confirm. REPORTED, not fixed here - this script does not own public/workbook.html." : "No change recorded, so the two halves agree on casing after all."}`);
  Object.assign(dbAnswer("c-p3", "signup_fee_on_base"), keepAnswer);
  Object.assign(dbCard("c-p3"), keepCard);
  await page.boot(); await settle();

  check(p1.type === page.TYPES_W.indexOf("Membership"), 'a stored "membership" selects Membership');
  check(p1.cad === page.CYCLES_W.indexOf("Monthly"), 'a stored "monthly" selects Monthly');
  check(p1.tax === page.YESNO_W.indexOf("Yes"), 'a stored "yes" selects Yes');
}

// ═════════════════════════════════════════════════════════════════════════════
// C. TYPE FIDELITY - offer_prices holds strings, a number input yields a number
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── C. retyping the figure we showed him is not a change ──");
{
  const shown = page.MODEL[lidOf("plan:p1")].price;      // what the number input holds
  check(shown === 300 && dbAnswer("c-p1", "price").current_value === "300", "the input holds the NUMBER 300 for a stored STRING \"300\"");
  await type("plan:p1", "price", shown);                 // he opens the box and types it back
  const row = dbAnswer("c-p1", "price");
  // MUTATE=numericprice: 300 !== "300", so the server records a change and staff
  // are handed a was/now pair reading 300 -> 300 to adjudicate.
  check(row.answered === null || row.answered === "300", `answering with the same value records no different value (answered ${JSON.stringify(row.answered)})`);
  check(dbCard("c-p1").state === "untouched", "the card stays untouched: an echo of our own prefill is not an act");
  check(page.flaggedCount() === 0, "and the page flags nothing, so the footer does not invent a change");
  check(txt("nflag") === "0", `the footer really prints it ("${txt("nflag")} changes flagged")`);
}

// ═════════════════════════════════════════════════════════════════════════════
// D. THE LADDER - the page's reading of a length, against the API's own data
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── D. \"3 Months (12 Weeks)\": what the page reads it as ──");
{
  const lid = lidOf("plan:p1");
  page.drawLadder(lid);
  const ladder = inner("ladder_" + lid);
  // 300 x 3 = 900 against 749. Read as one month it is $749/mo and no saving,
  // which is the page telling the owner his prepay option is pointless.
  check(page.monthsOf("3 Months (12 Weeks)") === 3, "a label carrying BOTH units is read in months, not weeks");
  check(/saves \$151/.test(ladder), `the rung says it saves $151${/saves \$151/.test(ladder) ? "" : " - it says: " + (ladder.match(/rsave[^>]*>([^<]*)/) || [])[1]}`);
  check(/\$250\/mo/.test(ladder), "and $250 a month, not $749");

  // THE INDEPENDENT ANCHOR. applies_to is the API's own statement of which rung
  // is the three-month one: it named "Academy 2x/week|3_months" before the page
  // ever parsed anything. Every key the API sends must be one the page can offer
  // back, or the owner is looking at a code whose scope he cannot see or restore.
  const stored = dbAnswer("c-codes", "codes.0.applies_to").current_value;
  const offered = page.priceKeys();
  const orphan = stored.filter((k) => !offered.includes(k));
  check(orphan.length === 0, `every applies_to key the API sent is one the page can offer back${orphan.length ? " - ORPHANED: " + orphan.join(", ") : ""}`);
  check(offered.includes("Academy 2x/week|signup_fee"), "and the joining fee is offered as its own scope");
}

// ═════════════════════════════════════════════════════════════════════════════
// E. COUNTING - which cards hold Send
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── E. which cards the gate counts ──");
{
  const fresh = await getApi();
  const serverCounts = new Map(fresh.cards.map((c) => [c.card_key, c.counts]));
  check(serverCounts.get("plans") === false, "the server does not count the empty add-a-plan card");
  check([...serverCounts.values()].filter(Boolean).length === 7, "so 7 of the 8 cards count");
  let wrong = [];
  for (const c of page.CARDS) {
    const mine = page.counted(c), theirs = serverCounts.get(c.card_key);
    if (mine === theirs) continue;
    // The ONE allowed asymmetry, and it is one-way on purpose: a card holding a
    // request always counts on the page whatever the server says, which can only
    // ever ask for MORE review. The page says so in a comment; this asserts it
    // stays that narrow rather than becoming "the page counts what it likes".
    if (mine === true && theirs === false && page.hasAdditionFields(c)) continue;
    wrong.push(`${c.card_key}: page ${mine}, server ${theirs}`);
  }
  check(wrong.length === 0, `every card is counted the same way by both${wrong.length ? " - " + wrong.join("; ") : ""}`);
  check(page.countedCards().length === 7, `the page counts 7 too (it counts ${page.countedCards().length})`);
  check(txt("ntot") === "7", `and prints 7 as the total on his screen ("${txt("ncf")} of ${txt("ntot")} confirmed")`);
}

// The server's own number, read without the page in the middle: an empty save is
// a no-op on the rows and still returns `remaining` computed from the live table.
async function serverRemaining() {
  const before = JSON.stringify(DB.workbook_answers);
  const r = await callApi({ action: "save", card_key: "notes", answers: [] });
  if (JSON.stringify(DB.workbook_answers) !== before) die("the no-op probe wrote to the answers table - it is not a probe any more");
  return r.remaining;
}

// ═════════════════════════════════════════════════════════════════════════════
// F. EVERY ACTION, DRIVEN THROUGH BOTH SIDES
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F. save / confirm / add / remove, compared after each ──");
agree("after load", await serverRemaining());

// SAVE a real edit.
await type("plan:p1", "title", "Academy 2x per week");
check(dbAnswer("c-p1", "title").answered === "Academy 2x per week", "save: the server stored what he typed");
check(dbCard("c-p1").state === "changed" && cardOf("plan:p1").state === "changed", "save: both halves call the card changed");
check(page.flaggedCount() === 1, "save: exactly one change is flagged, not one per keystroke");
agree("after a save", await serverRemaining());

// A CHIP PRESSED IN THE PAGE'S OWN VOCABULARY, deliberately kept for the staff
// half. Elementary stores "waive"; he presses Charge, and what lands is the
// page's capitalised word. Section H holds the staff surface against it: a value
// only the offer's own casing may reach configuration in.
await type("plan:p3", "signup_fee_on_base", page.CHARGE_W[0]);
check(dbAnswer("c-p3", "signup_fee_on_base").answered === "Charge",
  `a chip press answers in the PAGE's casing (${JSON.stringify(dbAnswer("c-p3", "signup_fee_on_base").answered)} over a stored ${JSON.stringify(dbAnswer("c-p3", "signup_fee_on_base").current_value)})`);

// CONFIRM. The server materializes `answered` from `proposed` for every row he
// never touched, so staff review compares a value against a value.
await confirm("plan:p1");
check(!!dbCard("c-p1").confirmed_at, "confirm: the server stamped confirmed_at");
check(page.isReady(cardOf("plan:p1")) === !!dbCard("c-p1").confirmed_at, "confirm: the page's isReady and the server's stamp are the same fact");
check(dbAnswer("c-p1", "signup_fee_on_base").answered === "waive", "confirm: an untouched row is written down from proposed, not left null");
check(/Confirmed by you/.test(page.pillOf(lidOf("plan:p1"))), "confirm: and the pill says so rather than still asking");
agree("after a confirm", await serverRemaining());

// A REAL EDIT AFTER A CONFIRM retires the confirm: the approval was of the old
// value. Both halves have to agree, or the pill says "press confirm" while the
// gate no longer asks for it.
await type("plan:p1", "title", "Academy twice a week");
check(dbCard("c-p1").confirmed_at === null, "a later edit retires the confirm on the server");
check(cardOf("plan:p1").confirmed_at === null && page.isReady(cardOf("plan:p1")) === false, "and the page reads it back as no longer ready");
agree("after an edit retires a confirm", await serverRemaining());
await confirm("plan:p1");

// ADD, on the card whose whole purpose is additions. It is the empty one, so it
// also proves an addition turns a card the gate ignored into one it counts.
console.log("\n── F2. an addition: a request, never a write ──");
{
  const plansLid = lidOf("plans");
  page.openAdd(plansLid);                       // the real "+ Add a plan" button
  byId("af_title_" + plansLid).value = "Summer 1x/week";
  byId("af_price_" + plansLid).value = "150";
  await page.submitAdd(plansLid, "plan");
  await settle();
  const created = DB.workbook_answers.filter((r) => r.card_id === "c-plans");
  check(created.length === 1 && created[0].target_field === "add:plan", "add: the server minted one add:plan row");
  check(created[0].target_id === null && created[0].target_table === "offers", "add: with the target derived by the server, not named by the page");
  check(created[0].answered && created[0].answered.title === "Summer 1x/week" && created[0].answered.price === 150, "add: carrying what he typed, with the price as a NUMBER the validator accepts");
  check(page.additionsOf(cardOf("plans")).length === 1, "add: and the page lists it back");
  const fresh = await getApi();
  check(fresh.cards.find((c) => c.card_key === "plans").counts === true, "add: the empty card now COUNTS on the server");
  check(page.counted(cardOf("plans")) === true, "add: and on the page - it holds Send now, with an unreviewed request in it");
  agree("after an addition", await serverRemaining());

  // AN ADDITION AFTER A CONFIRM RETIRES THAT CONFIRM. He approved a card that did
  // not carry this request. MUTATE=addkeepsconfirm leaves it standing, and then
  // the server calls the card ready while the page does not.
  await confirm("plans");
  check(!!dbCard("c-plans").confirmed_at, "the add-a-plan card can be confirmed with a request on it");
  page.openAdd(plansLid);
  byId("af_title_" + plansLid).value = "Winter camp";
  byId("af_price_" + plansLid).value = "220";
  await page.submitAdd(plansLid, "plan");
  await settle();
  check(page.additionsOf(cardOf("plans")).length === 2, "a second request is added");
  agree("after adding to a confirmed card", await serverRemaining());
  check(page.isReady(cardOf("plans")) === false, "and the card is NOT ready: he never reviewed the card with that request on it");
  // THE SAME FACT, ASKED OF BOTH HALVES DIRECTLY. `remaining` above catches the
  // aggregate; this names the card. MUTATE=addkeepsconfirm leaves the server's
  // stamp standing while the page has retired it, which is the two halves holding
  // opposite opinions about whether a request was ever approved.
  check(page.isReady(cardOf("plans")) === !!dbCard("c-plans").confirmed_at,
    `page and server agree on whether that card is approved (page ${page.isReady(cardOf("plans"))}, server ${!!dbCard("c-plans").confirmed_at})`);

  // REMOVE. Deliberately not symmetric: taking a request back leaves him holding
  // less than he already approved, so it retires nothing.
  const gone = page.additionsOf(cardOf("plans"))[1].id;
  await page.removeAddition(plansLid, gone);
  await settle();
  check(!DB.workbook_answers.some((r) => r.id === gone), "remove: a hard delete, so nothing survives on the staff 'needs creating' list");
  check(page.additionsOf(cardOf("plans")).length === 1, "remove: and the page drops it only because the server said it was gone");
  agree("after a removal", await serverRemaining());
}

// ═════════════════════════════════════════════════════════════════════════════
// G. THE GATE - the number on his screen against the number that is enforced
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── G. the submit gate ──");
{
  // Confirm everything except one card, so the refusal has a number in it that
  // both halves have to agree about.
  for (const key of ["tax", "plan:p2", "plan:p3", "plan:p4", "codes", "plans"]) await confirm(key);
  const left = page.remainingCount();
  check(left === 1, `one card is left unconfirmed (page says ${left})`);
  check(page.sendBlocked() === true, "the page holds the Send button off");
  const refused = await callApi({ action: "submit" });
  check(refused.ok === false && refused.remaining === left, `the server refuses with the SAME number (server ${refused.remaining}, page ${left})`);
  const nPage = +(txt("sendwhy").match(/\d+/) || [])[0];
  const nServer = +(refused.error.match(/\d+/) || [])[0];
  check(nPage === nServer, `and both sentences say ${nServer} ("${txt("sendwhy")}" / "${refused.error}")`);
  check(DB.workbooks[0].status === "sent", "nothing was submitted");

  // And with nothing left, the page lets go and the server takes it. If the two
  // disagree about the empty card, one of these two lines is a trap: either the
  // owner is stuck on a card with nothing on it, or Send goes through with a card
  // he never confirmed.
  await confirm("notes");
  check(page.remainingCount() === 0 && page.sendBlocked() === false, "with every counted card confirmed, the page releases Send");
  check(await serverRemaining() === 0, "and the server agrees there is nothing left");
  ALERTS = [];
  await page.doSubmit();
  await settle();
  check(DB.workbooks[0].status === "submitted", `Send actually sends${ALERTS.length ? " (alerts: " + ALERTS.join(" | ") + ")" : ""}`);
  check(page.RO === true && page.WB.status === "submitted", "and the page goes read only off the server's answer");
  // THE RULE THE WHOLE SCHEMA EXISTS FOR: nothing reaches staff review unconfirmed.
  const unconfirmed = DB.workbook_cards.filter((c) => DB.workbook_answers.some((r) => r.card_id === c.id) && !c.confirmed_at);
  check(unconfirmed.length === 0, `every card carrying anything was confirmed before it sent${unconfirmed.length ? " - NOT: " + unconfirmed.map((c) => c.card_key).join(", ") : ""}`);
  // Staff review compares current_value against ANSWERED, so a row we PROPOSED
  // something for must come back carrying an answer. A row where we proposed
  // nothing and the portal stores nothing has nothing to write down - null and
  // absent are the same thing by the API's own rule - so it is excluded here
  // rather than papered over with an empty string.
  const unanswered = DB.workbook_answers.filter((r) => r.answered === null && r.proposed !== null && !String(r.target_field).startsWith("add:"));
  check(unanswered.length === 0, `every row we proposed something for carries a written-down answer for staff to compare against${unanswered.length ? " - NOT: " + unanswered.slice(0, 3).map((r) => r.target_field).join(", ") : ""}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// H. THE STAFF HALF, against the same page
//
// Everything above proved the owner's page and the API agree about what he was
// asked and what he sent. From here the SAME workbook - the real one he just
// submitted, not a fixture written to look like it - is driven through review,
// approve-card, apply(dry) and rollback, and every claim the staff surface makes
// is held against what the owner's page actually showed him.
//
// The disagreement class is identical to the one that produced six defects in
// the owner half: staff review RENDERS values the API translates, the preview
// DESCRIBES work the mint will do, and the approval gate counts cards with the
// same "has answers" idea the submit gate uses. Any of those three can drift from
// the page without either side's own suite noticing, because each side stubs the
// other.
//
// The page object is deliberately NOT rebuilt from a fixture here. It is the same
// live page, rebooted off the real read-only GET, so "what the owner sees" is
// read out of the same DOM the assertions above read.
// ═════════════════════════════════════════════════════════════════════════════

// jsonb equality for the harness to READ results with: key order does not
// survive a jsonb round trip, so a stringify that respects it would report
// differences the database cannot even represent. Only the VALUES compared with
// it are derived independently - this is the harness's ruler, not either half's.
const norm = (v) => (Array.isArray(v) ? v.map(norm)
  : (v && typeof v === "object")
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
    : v);
const jsonEq = (a, b) => JSON.stringify(norm(a === undefined ? null : a)) === JSON.stringify(norm(b === undefined ? null : b));
const setOf = (xs) => [...new Set(xs)].sort().join(", ");

// EVERYTHING ON HIS SCREEN, as one string. The three card containers, every
// ladder, every pill and the footer. Local card ids are minted fresh on each
// boot, so they are replaced by the card_key they belong to (longest first, so a
// 'c9' can never eat the front of a 'c90'); without that, "byte-identical" would
// only ever mean "the same boot".
function pageSurface() {
  let out = ["taxcard", "cards", "extras"].map((id) => `~~~${id}\n${inner(id)}`).join("\n");
  for (const c of page.CARDS) out += `\n~~~ladder ${c.card_key}\n${inner("ladder_" + c.lid)}`;
  for (const c of page.CARDS) out += `\n~~~pill ${c.card_key}\n${page.pillOf(c.lid)}`;
  out += `\n~~~footer\n${txt("ncf")} of ${txt("ntot")} confirmed, ${txt("nflag")} ${txt("nflagword")}, "${txt("lefttxt")}"`;
  for (const lid of page.CARDS.map((c) => c.lid).sort((a, b) => b.length - a.length)) {
    const c = page.CARDS.find((x) => x.lid === lid);
    out = out.split(lid).join("#" + c.card_key);
  }
  return out;
}

await page.boot();               // the read-only page, off the real submitted GET
await settle();

console.log("\n── H1. the approval gate and the confirm gate select the same cards ──");
const firstReview = await staffApi({ action: "review", workbook_id: "wb1" });
check(firstReview.status === 200 && firstReview.body.ok === true, "staff review answers on the workbook the owner just sent");
check(firstReview.body.gate.approved === 0, `and nothing is approved yet, so unapproved_card_keys IS the counted set (${firstReview.body.gate.approved} approved)`);
{
  // THE SAME QUESTION ASKED OF BOTH HALVES. approvalGate decides which cards
  // staff must approve; counted() decides which cards the owner must confirm.
  // They are two implementations of one idea, and a drift either way is either
  // staff approving a card nobody was asked to confirm, or an owner confirming a
  // card nobody will ever be asked to approve.
  const serverSet = setOf(firstReview.body.gate.unapproved_card_keys);
  const pageSet = setOf(page.countedCards().map((c) => c.card_key));
  check(serverSet === pageSet, `the same cards, named: page [${pageSet}] / staff gate [${serverSet}]`);
  check(firstReview.body.gate.unapproved_card_keys.includes("plans") && page.counted(cardOf("plans")) === true,
    "a card holding ONLY an addition is counted by both - the request needs an owner confirm and a staff approval");
}
{
  // THE EMPTY ADD-A-PLAN CARD, which is the whole reason the gate is not simply
  // "every card". Its addition is lifted out and both halves are asked again.
  const stash = DB.workbook_answers.filter((r) => r.card_id === "c-plans");
  DB.workbook_answers = DB.workbook_answers.filter((r) => r.card_id !== "c-plans");
  await page.boot(); await settle();
  const r = await staffApi({ action: "review", workbook_id: "wb1" });
  const serverSet = setOf(r.body.gate.unapproved_card_keys);
  const pageSet = setOf(page.countedCards().map((c) => c.card_key));
  check(serverSet === pageSet, `with the request taken back off it, still the same cards: page [${pageSet}] / staff gate [${serverSet}]`);
  check(!r.body.gate.unapproved_card_keys.includes("plans") && page.counted(cardOf("plans")) === false,
    "and NEITHER half counts the empty add-a-plan card - it holds neither Send nor apply");
  DB.workbook_answers.push(...stash);
  await page.boot(); await settle();
}

console.log("\n── H2. what he confirmed is what staff review ──");
const REVIEW_ITEMS = (body) => [
  ...body.review.academy_settings,
  ...body.review.cards.flatMap((c) => c.items),
  ...body.review.additions,
  ...body.review.notes,
];
{
  const pageConfirmed = setOf(page.CARDS.filter((c) => page.isReady(c)).map((c) => c.card_key));
  const inReview = setOf(firstReview.body.review.cards.map((c) => c.card_key));
  check(pageConfirmed === inReview, `every card the page shows as confirmed is a card review shows: page [${pageConfirmed}] / review [${inReview}]`);

  // IS IT A CHANGE, asked of the two halves independently. The page's side of it
  // is the VALUE IN THE BOX ON HIS SCREEN, read through the page's own val()
  // precedence; the server's side is is_change. A row where the box shows
  // something other than what the portal stores IS a change, whatever route the
  // value took to get into the box - which is exactly what makes a confirm
  // without an edit a change.
  const drift = [];
  for (const it of REVIEW_ITEMS(firstReview.body)) {
    if (String(it.target_field).startsWith("add:")) continue;   // an addition has no current value to differ from
    const c = cardOf(it.card_key);
    if (!c) { drift.push(`${it.card_key}: review names a card the page does not have`); continue; }
    const shown = page.val(c, it.target_field, null);
    const differs = !jsonEq(shown, it.current_value);
    if (differs !== it.is_change) {
      drift.push(`${it.card_key}/${it.target_field}: his box shows ${JSON.stringify(shown)} over a stored ${JSON.stringify(it.current_value)}, so the page shows a ${differs ? "change" : "match"} while review calls it ${it.is_change ? "a change" : "unchanged"}`);
    }
  }
  check(drift.length === 0, `is_change is true for exactly the rows whose box differs from what the portal stores (${REVIEW_ITEMS(firstReview.body).length} rows${drift.length ? " - " + drift[0] : ""})`);

  // THE SINGLE MOST IMPORTANT ROW IN THE REVIEW: a plan the owner confirmed and
  // never typed into, whose proposed name differs from the one his portal stores.
  // Two of them here, one differing by a WORD and one only by a LETTER CASE,
  // because San Jose has three of these and a review that showed them as
  // untouched would have staff approve renames nobody ever looked at.
  const silent = [];
  for (const key of ["plan:p2", "plan:p3"]) {
    const it = firstReview.body.review.cards.find((c) => c.card_key === key).items.find((i) => i.target_field === "title");
    const box = page.val(cardOf(key), "title", null);
    const untouched = jsonEq(it.answered, it.proposed);            // he never typed over it
    const renames = !jsonEq(it.proposed, it.current_value);        // and it is a rename anyway
    if (!(untouched && renames && it.is_change === true && jsonEq(box, it.proposed))) {
      silent.push(`${key}: box ${JSON.stringify(box)}, stored ${JSON.stringify(it.current_value)}, proposed ${JSON.stringify(it.proposed)}, answered ${JSON.stringify(it.answered)}, is_change ${it.is_change}`);
    }
  }
  check(silent.length === 0, `a card CONFIRMED WITHOUT EDITING whose name differs from the portal's reads as a CHANGE, by a word and by a case${silent.length ? " - " + silent.join("; ") : ""}`);
}

console.log("\n── H3. the value staff see is a value the page can read back ──");
{
  // Every chip field, both ways: the offer-vocabulary value review previews must
  // select the SAME chip the owner was looking at, and it must select one at all.
  // A will_write the page cannot read back is a value staff approved and the
  // owner can never be shown again - that is the sign-up-fee casing defect,
  // arriving from the other end.
  const listFor = (field) => {
    const leaf = String(field).replace(/^(?:commitments|codes)\.\d+\./, "");
    if (leaf === "type") return ["TYPES_W", page.TYPES_W];
    if (leaf === "billing_cycle") return ["CYCLES_W", page.CYCLES_W];
    if (leaf === "taxable" || leaf === "signup_fee_taxable") return ["YESNO_W", page.YESNO_W];
    if (leaf === "signup_fee_on_base" || leaf === "signup_fee_charge") return ["CHARGE_W", page.CHARGE_W];
    if (leaf === "after") return ["AFTER_W", page.AFTER_W];
    if (leaf === "kind") return ["KIND", page.KIND];
    if (leaf === "duration") return ["DUR", page.DUR];
    return null;
  };
  const bad = [];
  let chips = 0;
  for (const it of REVIEW_ITEMS(firstReview.body)) {
    const L = listFor(it.target_field);
    if (!L || it.will_write === undefined) continue;
    if (typeof it.will_write !== "string") continue;      // the boolean field is measured separately below
    chips++;
    const shownIdx = page.idxOf(L[1], page.val(cardOf(it.card_key), it.target_field, null), -1);
    const writeIdx = page.idxOf(L[1], it.will_write, -1);
    if (writeIdx < 0 || writeIdx !== shownIdx) {
      bad.push(`${it.card_key}/${it.target_field}: his chip was ${JSON.stringify(L[1][shownIdx])} (index ${shownIdx} of ${L[0]}) and will_write ${JSON.stringify(it.will_write)} reads back as index ${writeIdx}`);
    }
  }
  check(chips > 0 && bad.length === 0, `every chip value staff will approve reads back to the chip he pressed (${chips} chip answers${bad.length ? " - " + bad[0] : ""})`);

  // MEASURED, NOT ASSERTED, because the fix belongs in public/workbook.html which
  // this script does not own. once_per_customer is the one field whose offer form
  // is a BOOLEAN, and idxOf stringifies before it matches, so `true` finds no
  // chip at all and falls to the default.
  const once = REVIEW_ITEMS(firstReview.body).find((i) => /once_per_customer$/.test(i.target_field));
  if (once) {
    const idx = page.idxOf(page.YESNO_W, once.will_write, -1);
    console.log(`  NOTE  once_per_customer previews as ${JSON.stringify(once.will_write)} (the offer's boolean form) and the page reads that back as chip index ${idx}${idx < 0 ? ", i.e. NOT AT ALL - a re-opened workbook would show the DEFAULT chip over a stored boolean, which is the sign-up-fee casing defect in a different field. REPORTED, not fixed here." : "."}`);
  }
}

console.log("\n── H4. approve, refuse, apply ──");
// Which offering in the live offer each plan card means, resolved BEFORE apply -
// apply renames two of them, so a title lookup afterwards would be looking for
// names that no longer exist.
const offerRow = () => DB.offers.find((o) => o.id === OFFER_ID);
const OFFERING_IX = new Map();
for (const c of firstReview.body.review.cards) {
  const t = (c.items || []).find((i) => i.target_field === "title");
  if (!t) continue;
  const ix = offerRow().data.pricing.pricing_offerings.findIndex((o) => o.title === t.current_value);
  if (ix >= 0) OFFERING_IX.set(c.card_key, ix);
}
function offerValueAt(cardKey, field) {
  const pricing = offerRow().data.pricing || {};
  let m = /^codes\.(\d+)\.(.+)$/.exec(field);
  if (m) return ((pricing.discount_codes || [])[+m[1]] || {})[m[2]];
  const off = (pricing.pricing_offerings || [])[OFFERING_IX.get(cardKey)];
  if (!off) return undefined;
  m = /^commitments\.(\d+)\.(.+)$/.exec(field);
  if (m) return ((off.commitments || [])[+m[1]] || {})[m[2]];
  return off[field];
}

const ALL_KEYS = firstReview.body.gate.unapproved_card_keys.slice();
const HELD = ALL_KEYS[ALL_KEYS.length - 1];
for (const k of ALL_KEYS.slice(0, -1)) await staffApi({ action: "approve-card", workbook_id: "wb1", card_key: k });
{
  const before = JSON.stringify([DB.offers, DB.clients, DB.workbooks[0].snapshot]);
  const refused = await staffApi({ action: "apply", workbook_id: "wb1" });
  check(refused.status === 409 && refused.body.code === "unapproved_cards"
    && JSON.stringify([DB.offers, DB.clients, DB.workbooks[0].snapshot]) === before,
    `apply with one card unapproved is refused and writes nothing - no snapshot, no tax, no offer edit (${refused.status} ${refused.body.code})`);
  // AND IT SAYS WHICH ONE. The reviewer's next action is opening that card; a
  // count sends them looking. Held against the gate's own list rather than
  // against the key the harness withheld, so the two staff surfaces have to
  // agree with each other as well as with the truth.
  const gateSays = setOf((await staffApi({ action: "review", workbook_id: "wb1" })).body.gate.unapproved_card_keys);
  const named = setOf(String((String(refused.body.error).match(/not approved yet \(([^)]*)\)/) || [])[1] || "").split(",").map((s) => s.trim()).filter(Boolean));
  check(named === gateSays && named === HELD, `the refusal NAMES the card that is missing: refusal [${named}] / gate [${gateSays}] / withheld [${HELD}]`);
}

await staffApi({ action: "approve-card", workbook_id: "wb1", card_key: HELD });
const beforeApply = await staffApi({ action: "review", workbook_id: "wb1" });
check(beforeApply.body.gate.ready_to_apply === true, "with the last card approved the gate opens");

// THE STATE TO COME BACK TO. Copied out of the stub, not read off the workbook's
// own snapshot - a rollback compared against the photograph it restored from
// proves only that the copy loop ran.
// The offer ROWS as configuration - id and data. The stub, like PostgREST, lets a
// PATCH add updated_at to a row it touches, and a timestamp moving is not the
// question being asked here.
const offerConfig = () => JSON.stringify(DB.offers.map((o) => ({ id: o.id, data: o.data })));
const OFFERS_BEFORE = offerConfig();
const TAX_BEFORE = JSON.stringify(DB.clients[0].tax_config);
const REVIEW_BEFORE = JSON.stringify(beforeApply.body.review);
const SURFACE_BEFORE = pageSurface();
check(SURFACE_BEFORE.length > 2000, `and his read-only page is rendering something to compare against later (${SURFACE_BEFORE.length} chars)`);

const applied = await staffApi({ action: "apply", workbook_id: "wb1" });
check(applied.status === 200 && applied.body.ok === true && applied.body.dry_run === true,
  `apply runs dry by default${applied.body.ok ? "" : " - it said: " + JSON.stringify(applied.body.failures || applied.body.error)}`);
{
  // WHAT STAFF WERE SHOWN IS WHAT LANDED. will_write was printed on the review
  // screen BEFORE the approval; this reads the offer jsonb afterwards and asks
  // whether the two are the same value. A drift here is a human approving one
  // thing and a money surface receiving another.
  const gap = [];
  let previewed = 0;
  for (const it of REVIEW_ITEMS(beforeApply.body)) {
    if (it.will_write === undefined || it.target_table !== "offers") continue;
    previewed++;
    const landed = offerValueAt(it.card_key, it.target_field);
    if (!jsonEq(landed, it.will_write)) gap.push(`${it.card_key}/${it.target_field}: review previewed ${JSON.stringify(it.will_write)}, the offer now holds ${JSON.stringify(landed)}`);
  }
  check(previewed > 0 && gap.length === 0, `every value review previewed is the value the offer now holds (${previewed} previewed${gap.length ? " - " + gap[0] : ""})`);

  const taxItem = beforeApply.body.review.academy_settings.find((i) => i.target_field === "tax_config");
  check(!!taxItem && jsonEq(DB.clients[0].tax_config, taxItem.will_write),
    `and the academy setting too: review previewed ${JSON.stringify(taxItem && taxItem.will_write)}, clients.tax_config now holds ${JSON.stringify(DB.clients[0].tax_config)}`);
}
{
  // THE OWNER'S HALF DID NOT REOPEN. Staff reviewing, approving and applying must
  // leave him exactly as read-only as the moment he pressed Send - through his
  // own page AND through the route his page would call.
  await page.boot(); await settle();
  const before = JSON.stringify(DB.workbook_answers);
  page.setA(lidOf("plan:p1"), "price", 111);
  TIMERS.clear();
  await page.flushAll();
  await settle();
  check(page.RO === true && JSON.stringify(DB.workbook_answers) === before,
    "after apply his page is still read only, and a keystroke on it writes nothing");
  // AND THROUGH THE ROUTE, ON A ROW APPLY NEVER TOUCHED. His free text is skipped
  // by apply, so it carries no applied_at and the applied-stamp guard has nothing
  // to say about it: the only thing between a late autosave and the copy the
  // reviewer already approved is the workbook's own status. Probing an APPLIED row
  // instead would pass on the other guard and prove nothing about this one.
  const notesRow = dbAnswer("c-notes", "notes");
  check(notesRow.applied_at == null, "the free-text row really is one apply left alone, so this probe tests the status rule and nothing else");
  const direct = await callApi({ action: "save", card_key: "notes", answers: [{ id: notesRow.id, answered: "changed my mind" }] });
  check(direct.ok === false && JSON.stringify(DB.workbook_answers) === before,
    `and the route refuses a save on it, so it is the SENT state doing the refusing ("${direct.error}")`);

  const afterApply = await staffApi({ action: "review", workbook_id: "wb1" });
  check(afterApply.body.gate.approved === afterApply.body.gate.counted && afterApply.body.gate.ready_to_apply === true,
    `the gate still reads every counted card as approved (${afterApply.body.gate.approved} of ${afterApply.body.gate.counted})`);
  page.updProg();
  check(+txt("ntot") === afterApply.body.gate.counted,
    `the total on HIS screen is the number the staff gate counts (page "${txt("ntot")}", gate ${afterApply.body.gate.counted})`);
  check(+txt("ncf") === afterApply.body.gate.approved && page.remainingCount() === 0,
    `and the count he confirmed is the count staff approved (page "${txt("ncf")}", gate ${afterApply.body.gate.approved})`);
}

console.log("\n── H5. the rehearsal describes work in the page's own key vocabulary ──");
{
  // The mint preview names each price `<plan title>|<term>`. That is the SAME key
  // vocabulary the page offers the owner when he scopes a discount code, and the
  // two sides parse the commitment length with two different parsers. A key phase
  // 3 would mint that the page cannot name is a price nobody can ever attach a
  // coupon to.
  const p3keys = (applied.body.phase3.targets || []).map((t) => t.key);
  const offered = new Set(page.priceKeys());
  const orphan = p3keys.filter((k) => !offered.has(k));
  check(p3keys.length > 0 && orphan.length === 0,
    `every price the mint would create is one the page can name in applies_to (${p3keys.length} targets${orphan.length ? " - ORPHANED: " + orphan.join(", ") : ""})`);

  // THE MONEY, computed twice and compared once. The page multiplies the plan
  // price by the tax he entered and prints a sentence; the rehearsal takes the
  // tax it just wrote to clients and mints cents through _fees.applyFee. Nothing
  // is shared between those two paths except the workbook.
  const byKey = new Map((applied.body.phase3.targets || []).map((t) => [t.key, t]));
  const money = [];
  let priced = 0;
  for (const c of page.CARDS.filter((x) => x.type === "plan")) {
    const m = page.MODEL[c.lid];
    if (!m || m.archived) continue;
    page.prevOpts(c.lid);
    const said = txt("pv_fee_" + c.lid);
    const t = byKey.get(m.title + "|monthly");
    if (!t) { money.push(`${c.card_key}: the rehearsal has no monthly target for ${JSON.stringify(m.title)}`); continue; }
    priced++;
    const his = (said.match(/a parent pays (\$[\d,]+)/) || [])[1];
    const mint = "$" + Math.round(t.allin_cents / 100).toLocaleString();
    if (his !== mint) money.push(`${c.card_key}: his page says a parent pays ${his} for ${JSON.stringify(m.title)} and the mint would charge ${mint} ("${said}")`);
  }
  check(priced > 0 && money.length === 0, `the parent price on his screen is the amount the mint would charge, tax and all (${priced} plans${money.length ? " - " + money[0] : ""})`);
}

console.log("\n── H6. rollback puts back exactly what he was looking at ──");
{
  const rolled = await staffApi({ action: "rollback", workbook_id: "wb1" });
  check(rolled.status === 200 && rolled.body.ok === true && rolled.body.status === "submitted",
    "rollback answers and lands the workbook back on 'submitted'");
  check(offerConfig() === OFFERS_BEFORE && JSON.stringify(DB.clients[0].tax_config) === TAX_BEFORE,
    "the offer jsonb and the academy tax setting are byte-identical to what the harness copied out before the apply");

  const after = await staffApi({ action: "review", workbook_id: "wb1" });
  check(JSON.stringify(after.body.review) === REVIEW_BEFORE,
    "and the whole decision set staff read is byte-identical to what it was before the apply - every stamp cleared, every value back");

  await page.boot(); await settle();
  const surface = pageSurface();
  check(surface === SURFACE_BEFORE,
    `his read-only page renders byte-identically to before the apply${surface === SURFACE_BEFORE ? "" : " - first difference at char " + [...surface].findIndex((ch, i) => ch !== SURFACE_BEFORE[i])}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(fails ? `\nRESULT: ${fails} FAILURE(S) out of ${fails + passes}` : `\nRESULT: ALL PASS (${passes} assertions)`);

// Under a control, report in the SAME language as the api/_*.test.mjs suites and
// verify-bb-hydration.mjs, so CI can apply one rule everywhere: a control counts
// as caught only if the run SAYS it was caught. Exit status alone cannot carry
// that, because this script also exits non-zero when a control is missing or its
// pin has moved.
if (MUTATE) {
  console.log(fails
    ? `\n✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fails} assertion(s).`
    : `\n❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} reintroduced a real defect and every assertion still passed. That control is decorative - fix the control or the coverage, do not ship it green.`);
  process.exit(fails ? 0 : 1);
}
process.exit(fails ? 1 : 0);
