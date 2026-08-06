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
 * COUNTING IS SYMMETRIC SINCE THE D6 RULING: every card counts on both halves,
 * from first render, and section E asserts the two sets are identical. The
 * page keeps its addition guard (a card holding a request counts whatever a
 * future wire value says) as a trivial pass - it can only ever ask for MORE
 * review, and the guard's direction is still the safe one.
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
 *   MUTATE=pagedenominatorgrows PAGE. counted() goes back to trusting the wire
 *       flag, so the total can move mid-session. (Replaced MUTATE=pagecountsall,
 *       retired when the D6 ruling made every-card-counts the correct rule.)
 *   MUTATE=emptycardsdontcount API. cardCounts goes back to "has answers", so
 *       the server's denominator grows on an add while the page's stays fixed.
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
 *   MUTATE=onepagestripe            API. The live-Stripe price read stops
 *       paginating, so it reads only the fixture's 100 page-one fillers and
 *       never sends the starting_after cursor - in production, exists:false
 *       past price #100 and the mint duplicates real prices.
 *   MUTATE=monthsunbounded          API. CODE_T.duration_months goes back to
 *       the unbounded tIntOrNull, so the 25 months section J types on the
 *       real page reviews clean and applies with ok:true - a claim about
 *       billing months this build can never sell.
 *   MUTATE=blankkeysrestrict        API (via api/_coupon-guardrails.js). The
 *       shared emptiness rule loses its trim, so a direct POST of
 *       `applies_to: [" "]` confirms on the server while the page promised a
 *       refusal - the coupon it scopes still applying to EVERYTHING. F7.
 *   MUTATE=noncanonicalindex        API. classifyIndexed's one-spelling check
 *       becomes `if (false)`, so a direct POST of `codes.00.applies_to` mints
 *       a TWIN row for logical code 0. F5's direct-404 pin catches it; the
 *       page-side positive pin proves the real page only ever emits canonical
 *       spellings, so the refusal can never refuse the page.
 *
 * Measured 2026-08-06, after the full rehearsal-round-1 build (Steps 1-12:
 * withheld fee report, Variant A codes guard, confirmed-no tax, registration
 * number, duration scope sentence, every-card-counts, live-Stripe dry run,
 * fee-line truth, Other-cadence follow-up, stale-note clear, approve-card
 * vocabulary, per-plan age bands). Unmutated ALL PASS (184 assertions;
 * was 148 before the Step 12 age sections D3/G/H4 joined, 161 before the
 * R3 pagination pin, 167 before the 2026-08-06 D1-D4 fix pass - the header
 * previously said 162 while the run printed 167; the recorded total had
 * drifted and is trued up here. That pass took it 167 -> 174 (F5, D1) ->
 * 176 (D3) -> 179 (F6, D2) -> 181 (D4); the 2026-08-06 whitespace pass took
 * it 181 -> 184 (F7), and its Step 2 (canonical indexes + mint ceiling)
 * 184 -> 186 (F5's direct-404 and page-canonical pins)).
 * typingisapproving -> 18 failures, pagedenominatorgrows -> 7,
 * emptycardsdontcount -> 7, feecasing -> 10, addkeepsconfirm -> 5,
 * numericprice -> 5, monthsmisparse -> 5, staffcountsanswered -> 5,
 * renameisnotachange -> 2, reviewdropscards -> 2,
 * reviewshowsuntranslated -> 1, staffgateoff -> 5, refusalnamescount -> 1,
 * applyreopensediting -> 3, rollbackleavesoffers -> 1,
 * rollbackclearsanswers -> 2, taxneverlands -> 5, feewithheldsilently -> 1,
 * confirmuntargetedcode -> 3 (RE-MEASURED 2026-08-06, whitespace pass: was 1
 * after the D3 fix pass - with the server guard in place a page whose own
 * guard is deleted has its confirm REFUSED by the server in the same
 * sentence, so F3's original two checks pass and the catch was F5's
 * byte-identity assertion, the page relaying the server sentence prefixed
 * with "We could not save that confirmation.", which is not the page's own
 * promised alert; F7's before-any-network and byte-identity pins then
 * joined the same door and catch 2 more),
 * serverconfirmsuntargeted -> 4 (RE-MEASURED 2026-08-06, whitespace pass:
 * was 2 - F5's direct-API refusal and byte-identity pins; F7's direct-API
 * refusal and byte-identity pins joined the same guard; the same pin
 * catches 7 in api/_workbook.test.mjs), noisnull -> 3, taxregnowhere -> 16,
 * firstbillalways -> 1, feelineflat -> 4, othernofollowup -> 4 (was 3;
 * gained one when section F6 joined - re-measured in the 2026-08-06 closeout
 * sweep),
 * agesunknownfield -> 19, agenotegone -> 1 (taxregnowhere and
 * agesunknownfield each gained one catch on 2026-08-06 when the remediation
 * sections joined; re-measured in the full sweep that date),
 * onepagestripe -> 1 (measured
 * 2026-08-06, R3: the H5 read-pattern assertion; the existence assertions it
 * also breaks live in api/_workbook-apply.test.mjs, where the same pin
 * catches 4), monthsunbounded -> 3 (measured 2026-08-06, R4: section J's
 * review refusal, apply refusal and untouched-offer pins; the same pin
 * catches 2 in api/_workbook-apply.test.mjs),
 * codesunmintable -> 6 (RE-MEASURED 2026-08-06, Step 2 pass: was 5 - F5's
 * save/mint/target/keys/confirm pins, the live defect reproduced end to
 * end; the Step 2 one-row pin joined the same door; the same pin catches 18
 * in api/_workbook.test.mjs),
 * codesmintany -> 4 (RE-MEASURED 2026-08-06, Step 2 pass: was 1 until the D4
 * banner pins joined F5 - with the allowlist gutted, codes.0.hacker MINTS,
 * the page's flush succeeds, and both failure-banner assertions trip too -
 * then 3, and F5's Step 2 direct-404 pin joined (codes.00 MINTS under it);
 * the same pin catches 10 in api/_workbook.test.mjs),
 * refusedaddwipes -> 6 (measured 2026-08-06, D2 fix pass: F6's survive and
 * succeed-with-preserved-values pins plus F4's carry-across and its
 * downstream follow-up pins - the wipe breaks the F4 flow too, which is why
 * both probe cleanups are guarded so the banner still prints),
 * bannerblamesadds -> 2 (measured 2026-08-06, D4 fix pass: section A's and
 * F5's names-the-field banner pins),
 * blankkeysrestrict -> 2 (measured 2026-08-06, whitespace pass: F7's
 * direct-API refusal and byte-identity pins - the page's own inline guard
 * still refuses, so the catch is the server accepting what the page
 * promised it would refuse; the same pin catches 4 in
 * api/_coupon-guardrails.test.mjs, 2 in api/_workbook.test.mjs and 4 in
 * api/_workbook-apply.test.mjs),
 * noncanonicalindex -> 1 (measured 2026-08-06, Step 2 pass: F5's direct-404
 * pin - the page-canonical positive pin stays green because the real page
 * cannot emit the spelling; the same pin catches 6 in
 * api/_workbook.test.mjs. MUTATE=mintuncapped, the mint ceiling's control,
 * lives ONLY in api/_workbook.test.mjs, where it catches 1 - this flow has
 * no 90-row card).
 * (MUTATE=agebandunchecked lives ONLY in api/_workbook-apply.test.mjs - this
 * flow never submits an inverted band because the page guard refuses it in
 * D3 - where it catches 2; agesunknownfield and agenotegone are pinned in
 * both files and catch 4 and 1 there.)
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
  // The page's denominator grows again: counted() goes back to deriving the
  // total from what the card HOLDS, so an add moves the total under the
  // owner's cursor - the 0-of-7 -> 5-of-8 defect. (The plan's suggested pin,
  // `c.counts !== false`, is DECORATIVE now that the server sends counts:true
  // for every card - a wire-trusting page cannot diverge from a wire that
  // agrees - so the control reintroduces the page's real old rule instead.
  // The old MUTATE=pagecountsall was retired by the same D6 ruling: every
  // card counting is the correct behaviour on both halves.)
  pagedenominatorgrows: [[
    `  return true;                       // every card counts, empty or not`,
    `  return (c.answers||[]).length>0;   // (control pagedenominatorgrows) the denominator moves with the rows`]],
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
  // The codes-card confirm guard is gone, so a named code with nothing ticked
  // confirms straight through - and the everything-scope goes back to being a
  // default the owner inherited rather than a choice he made.
  confirmuntargetedcode: [[
    `    if(untargeted){alert('Say what '+untargeted.code+' applies to first. Tick the prices it covers, or choose "Everything, including the joining fee".');return}`,
    `    // (control confirmuntargetedcode) the guard is gone`]],
  // The scope sentence goes back to the hardcoded first-bill claim, so a code
  // whose duration chips say Every payment is described as first-bill-only - a
  // wrong claim about money on the page whose job is checking the money.
  firstbillalways: [[
    `      const scope=c.dur===2?'on every bill':c.dur===1?('on the first '+(c.durMonths||'?')+' months of bills'):'on the first bill';`,
    `      const scope='on the first bill';   // (control firstbillalways)`]],
  // The fee line goes back to the flat sentence: "Plus a one-time $40 joining
  // fee." whenever the base charges, with the per-rung waivers - San Jose's
  // real state - omitted from the one fee sentence a parent would read.
  feelineflat: [[
    `    const FR=liveRungs(p);
    const charged=FR.filter(r=>r.fee===0),waivedR=FR.filter(r=>r.fee===1);
    const lens=a=>a.map(r=>r.len).join(' and ');
    if(p.feeOnBase===0&&FR.length&&charged.length===0)
      bits.push(\`Plus a one-time \${money(p.feeAmt)} joining fee on the \${CYCLES[p.cad]} option. Pay up front and the joining fee is waived.\`);
    else if(p.feeOnBase===0)
      bits.push(\`Plus a one-time \${money(p.feeAmt)} joining fee.\`+(waivedR.length?\` Waived on \${lens(waivedR)}.\`:''));
    else if(charged.length)
      bits.push(\`Plus a one-time \${money(p.feeAmt)} joining fee when you pay up front for \${lens(charged)}.\`);`,
    `    if(p.feeOnBase===0)bits.push(\`Plus a one-time \${money(p.feeAmt)} joining fee.\`);   // (control feelineflat)`]],
  // The save-failure banner goes back to its guessed cause: "this page cannot
  // add brand new items yet" - a wrong claim now that the mint whitelist
  // accepts most null-id saves - instead of naming the fields it failed on.
  bannerblamesadds: [[
    `        ? 'We could not save your answer for '+fields.join(', ')+'. That change is not stored yet. Try again, or tell BAM directly.'`,
    `        ? 'This page cannot add brand new items yet, so the one you just added is not stored. Everything you changed on the questions we asked you is saved. Tell BAM what you wanted to add and we will add it for you.'   // (control bannerblamesadds)`]],
  // The restore half of redrawAddsKeep is a no-op again, so every refusal
  // redraw wipes the owner's typed name and price - the D2 defect back.
  refusedaddwipes: [[
    `  Object.entries(keep).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.value=v});
}`,
    `  // (control refusedaddwipes) the typing is not restored
}`]],
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
  // A card with nothing to SHOW is dropped from review even though the gate
  // counts it, so the empty add-a-plan card vanishes from the surface staff
  // read while apply still demands its approval - an approval nobody can give
  // for a card nobody can see.
  reviewdropscards: [[
    `    cardGroups.push({`,
    `    if (!items.length) continue;   // (control reviewdropscards) the empty card vanishes
    cardGroups.push({`]],
  // The API's counting rule goes back to "has answers": the server's total
  // grows when an addition lands and drops when one is removed, while the
  // page's denominator stays fixed - the two halves telling the owner two
  // different numbers about the same workbook.
  emptycardsdontcount: [[
    `const cardCounts = (answers) => true;`,
    `const cardCounts = (answers) => (answers || []).length > 0;   // (control emptycardsdontcount)`]],
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
  // The withheld-fee report is dropped from the apply response, so a joining
  // fee the RISK 4 gate leaves out of the mint targets goes back to being a
  // console.warn in a server log - invisible to the reviewer whose rehearsal
  // just lost a target the page still promises.
  feewithheldsilently: [[
    `    withheld_signup_fees: withheld,`,
    `    // (control feewithheldsilently) the withhold is dropped from the response`]],
  // The deliberate No collapses back into never-asked: canonicalTax stores
  // null again for { charges_tax: false }, so a future workbook renders the
  // tax card as unanswered over a question the owner already answered.
  noisnull: [[
    `  if (v.charges_tax === false) return tOk({ charges_tax: false });`,
    `  if (v.charges_tax === false) return tOk(null);   // (control noisnull)`]],
  // The registration number loses its classifyField home, so the row the page
  // really produced must REFUSE the apply (fail closed) rather than land on a
  // guessed column.
  taxregnowhere: [[
    `  if (f === "tax_registration_number") return { kind: "taxreg" };`,
    `  // (control taxregnowhere) the field has no home`]],
  // age_min loses its home in the plan whitelist, so the age row the page
  // really produced must REFUSE the whole apply (fail closed) - and every
  // downstream check on the offer jsonb trips because nothing landed.
  agesunknownfield: [[
    `  age_min: tAgeStrOrEmpty, age_max: tAgeStrOrEmpty,`,
    `  age_max: tAgeStrOrEmpty,   // (control agesunknownfield) age_min has no home`]],
  // (MUTATE=agebandunchecked - the deleted min>max refusal - lives in
  // api/_workbook-apply.test.mjs: this flow never submits an inverted band,
  // because the page's own confirm guard refuses it in section D3.)
  // The stored-for-later note is dropped from the apply response, so an apply
  // that wrote plan ages stops saying that nothing consumes them yet.
  agenotegone: [[
    `    ...(wroteAges ? { age_note: "Plan ages were stored on the offer for later use. Nothing reads plan ages yet: class age routing still reads the class list, so no routing changed." } : {}),`,
    `    // (control agenotegone) the note is gone`]],
  // CODE_T.duration_months goes back to the unbounded tIntOrNull, so the 25
  // months section J types on the real page reviews clean and applies with
  // ok:true - a claim about billing months this build can never sell.
  monthsunbounded: [[
    `  duration: tChip(V_DUR, "duration"), duration_months: tMonths1to24,`,
    `  duration: tChip(V_DUR, "duration"), duration_months: tIntOrNull,   // (control monthsunbounded)`]],
  // The live-Stripe price read stops paginating, so it reads only the fixture's
  // 100 fillers and never sends the starting_after cursor - which H5's
  // read-pattern assertion has to catch (the existence assertions live in
  // api/_workbook-apply.test.mjs, whose fixture keeps its real hits on page two).
  onepagestripe: [[
    `      for (let page = 0; page < 10; page++) {   // cap ~1000 prices; an academy past that is a conversation`,
    `      for (let page = 0; page < 1; page++) {    // (control onepagestripe) the first page is the whole truth`]],
  // The codes branch of canMint returns false - the D1 fix reverted, which IS
  // the live defect: the Everything chip's null-id save of codes.0.applies_to
  // 404s and the codes card can never confirm. F5 must reproduce it.
  codesunmintable: [[
    `    return cls.kind === "code" && !!cls.t;`,
    `    return false; // (control codesunmintable) the codes branch is gone - the live SJ defect`]],
  // The codes branch stops consulting classifyField and mints ANY field name on
  // the codes card. F5's byte-for-byte refusal of codes.0.hacker has to catch it.
  codesmintany: [[
    `    return cls.kind === "code" && !!cls.t;`,
    `    return true; // (control codesmintany) the allowlist is gutted`]],
  // The server-side codes confirm guard is gone, so a direct POST confirms a
  // named code with no applies-to list - exactly what the dress rehearsal
  // found succeeding while the page promised a refusal. F5's direct-confirm
  // refusal and the byte-identity assertion have to catch it.
  serverconfirmsuntargeted: [[
    `      if (loose.length) throw bad('Say what ' + loose[0].code + ' applies to first. Tick the prices it covers, or choose "Everything, including the joining fee".');`,
    `      if (false && loose.length) throw bad("unreachable");   // (control serverconfirmsuntargeted) the server confirms it anyway`]],
  // The server drops the Other-cycle follow-up requirement, so the two halves
  // stop refusing in the same sentence - the page refuses, the API stores the
  // riddle.
  othernofollowup: [[
    `    : String(v.billing_cycle || "") === "Other" && !str(v.billing_cycle_other) ? "Please say how often this plan bills before adding it." : ""),`,
    `    : ""),   // (control othernofollowup) the follow-up requirement is gone`]],
  // The ONE emptiness rule (cleanAppliesTo, api/_coupon-guardrails.js) loses
  // its trim, so a direct POST of `applies_to: [" "]` confirms on the server
  // while the page promised a refusal - the adversarial finding exactly as it
  // shipped. The pinned line lives in the guardrails module: this entry
  // repoints the workbook copy's import at a mutant guardrails copy the
  // harness writes below. Section F7's direct-refusal and byte-identity pins
  // are what have to catch it. The SAME pin is carried by
  // api/_coupon-guardrails.test.mjs, api/_workbook.test.mjs and
  // api/_workbook-apply.test.mjs.
  blankkeysrestrict: [[
    `import { cleanAppliesTo } from "./_coupon-guardrails.js";`,
    `import { cleanAppliesTo } from "./.mutant-contract-guardrails.js";   // (control blankkeysrestrict)`]],
  // classifyIndexed's one-spelling check becomes `if (false)`, so a direct
  // POST of `codes.00.applies_to` mints a TWIN row for logical code 0 again.
  // F5's direct-404 pin has to catch it; the page-side positive pin proves
  // the real page never emits a non-canonical spelling, so the refusal can
  // never refuse the page. (MUTATE=mintuncapped, the mint ceiling's control,
  // lives ONLY in api/_workbook.test.mjs - this flow has no 90-row card, and
  // building one would prove nothing the direct gate does not already pin.)
  noncanonicalindex: [[
    `  if (String(index) !== m[1]) {`,
    `  if (false) {   // (control noncanonicalindex) every spelling is an address`]],
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
  // A RE-RENDERED INPUT COMES BACK EMPTY, exactly as innerHTML re-creation
  // does in a browser: a fresh input carries only its markup value, and the
  // add box's inputs carry none. Object identity is kept (held references
  // stay valid); only .value resets. Without this the double quietly preserved
  // typing across a redraw a real browser wipes, which is how the D2 defect -
  // a refused add eating the owner's typing - was invisible from in here.
  for (const id of next) { const e = DOMBOX.get(id); if (e && id !== containerId) e.value = ""; mint(id); }
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
// The rehearsal's live-Stripe read routes through the transport seam; with no
// client_stripe_direct row in the stub it takes the Connect path, which needs
// a platform key in env.
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_stub_platform_key";

const TOKEN = "wbk_tok_contract";
// The STAFF credential. Nothing the owner's page ever sends carries it, which is
// the point: the five review actions are reachable only from this side.
const STAFF_BEARER = "staff-session-" + "contract-Kp3";
const OFFER_ID = "off1";
const COLUMNS = {
  clients: ["id", "public_name", "business_name", "tax_config", "tax_registration_number", "stripe_connect_account_id"],
  client_stripe_direct: ["client_id", "status", "secret_key_enc", "secret_key_last4", "publishable_key", "stripe_account_id", "capabilities", "key_last_verified_at"],
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
  // Per-plan age bands (Step 12). PREFILL IS A CLAIM: only the Elementary card
  // carries proposed values (from its class twin in schedule.classes on the
  // live workbook); every other plan proposes NOTHING, because a prefill the
  // owner confirms without editing lands in configuration.
  a(cardId, "age_min", null, o.ageMin === undefined ? null : o.ageMin);
  a(cardId, "age_max", null, o.ageMax === undefined ? null : o.ageMax);
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
planAnswers("c-p3", { currentTitle: "Elementary 1x/Week", title: "Elementary 1x/week", included: "One session a week.", price: "180", fee: "40", feeOnBase: "waive", ageMin: "9", ageMax: "12", rungs: [] });
planAnswers("c-p4", { currentTitle: "Legacy Elite", title: "Legacy Elite", included: "Not sold to new families.", price: "500", fee: "0", feeOnBase: "charge", archived: true, rungs: [] });
// The tax card: one column, one answer, keys in a DIFFERENT order in `proposed`
// because jsonb does not preserve order and a stringifying comparison would
// report a change nobody made.
a("c-tax", "tax_config", { charges_tax: true, pct: 9.375, label: "CA sales tax" }, { label: "CA sales tax", pct: 9.375, charges_tax: true }, { target_kind: "academy_setting", target_table: "clients", target_id: "sj" });
// The optional registration number (G2): seeded with nothing stored and
// nothing proposed, the shape a freshly minted workbook carries. Older
// workbooks grow this row through doSave's mint whitelist instead;
// api/_workbook.test.mjs covers that door.
a("c-tax", "tax_registration_number", null, null, { target_kind: "academy_setting", target_table: "clients", target_id: "sj" });
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
    clients: [{ id: "sj", public_name: "By Any Means San Jose", business_name: "BAM San Jose", tax_config: null, stripe_connect_account_id: "acct_1RDtSMK6ZS1cqefu" }],
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
// The Stripe fixture (R3): page one of the price list is 100 fillers whose
// amounts (1-100 cents) can match no target, page two - reachable only through
// the starting_after cursor - is the empty end of the list. STRIPE_GETS records
// every Stripe GET so H5 can assert the cursor request really happened.
const STRIPE_FILLERS = Array.from({ length: 100 }, (_, i) => ({
  id: `price_filler_${i + 1}`, object: "price", unit_amount: i + 1, currency: "usd",
  product: "prod_filler", recurring: { interval: "week", interval_count: 4 },
}));
const STRIPE_CURSOR = STRIPE_FILLERS[STRIPE_FILLERS.length - 1].id;
const STRIPE_GETS = [];
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
  // The rehearsal may READ Stripe (D7); anything else still throws, so the
  // no-writes gate survives, sharper. This harness serves NO real hits -
  // existence assertions live in api/_workbook-apply.test.mjs, whose fixture
  // carries live prices; here the claim is that the read happens, is a GET,
  // fails loud when it cannot - and PAGINATES (R3): page one is 100 fillers
  // whose 1-100 cent amounts match no target, has_more:true, and page two
  // (behind the starting_after cursor) is the empty end of the list. Every
  // GET is recorded so H5 can assert the cursor request really arrived.
  // MUTATE=onepagestripe.
  if (u.startsWith("https://api.stripe.com/")) {
    if (method !== "GET") throw new Error(`STRIPE WAS WRITTEN TO: ${method} ${u} - the rehearsal may READ Stripe, never write it`);
    STRIPE_GETS.push(u);
    if (u.includes("/v1/prices")) {
      const after = new URL(u).searchParams.get("starting_after");
      if (!after) return json({ object: "list", data: STRIPE_FILLERS, has_more: true });
      if (after === STRIPE_CURSOR) return json({ object: "list", data: [], has_more: false });
      return json({ object: "list", data: [], has_more: false });
    }
    return json({ object: "list", data: [], has_more: false });
  }
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
// The guardrails half of blankkeysrestrict: the pinned line IS the emptiness
// rule and lives in api/_coupon-guardrails.js, so a mutant copy is written for
// the (also-pinned) workbook import above to point at.
if (MUTATE === "blankkeysrestrict") {
  const G_PATH = path.join(ROOT, "api", "_coupon-guardrails.js");
  const gMutant = applyPins(fs.readFileSync(G_PATH, "utf8"), [[
    `const cleanAppliesTo = (v) =>
  (Array.isArray(v) ? v.map((k) => String(k == null ? "" : k).trim()).filter(Boolean) : []);`,
    `const cleanAppliesTo = (v) =>
  (Array.isArray(v) ? v.filter(Boolean) : []);   // (control blankkeysrestrict) raw values, no trim`]],
  "api/_coupon-guardrails.js");
  const gCopy = path.join(ROOT, "api", ".mutant-contract-guardrails.js");
  fs.writeFileSync(gCopy, gMutant);
  tmp.push(gCopy);
}
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
  "openAdd", "applyEverything", "appliesEverything", "setTax", "drawCodes", "pickCyc",
  "drawLadder", "prevOpts", "TYPES", "TYPES_W", "CYCLES", "CYCLES_W", "AFTER", "AFTER_W",
  "YESNO_W", "CHARGE_W", "DUR", "KIND", "ADDOPEN", "ADDERR", "MAX_ADD_PER_CARD",
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
  // D4: the banner claims only what the code has in hand - the failed fields -
  // never a guessed cause. The old sentence ("cannot add brand new items yet")
  // became a wrong claim the moment the mint whitelist started accepting most
  // null-id saves. MUTATE=bannerblamesadds.
  console.log(`  NOTE  the banner reads: "${page.SAVE.msg}"`);
  check(page.SAVE.state === "error" && /commitments\.9\.length/.test(page.SAVE.msg) && !/cannot add brand new items/.test(page.SAVE.msg),
    `and the banner names the field it could not save, claiming no cause ("${page.SAVE.msg}")`);
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
// D2. THE PARENT PREVIEW TELLS THE TRUTH ABOUT THE JOINING FEE
// The old line said only "Plus a one-time $40 joining fee." whenever the base
// charged, while San Jose's real state is base charges, EVERY prepay waives -
// so the one fee sentence a parent would read omitted that paying up front
// skips the fee. Driven through the real chips, read off the real preview.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── D2. the fee line carries the per-rung truth ──");
{
  const lid = lidOf("plan:p1");
  const feeLine = () => { page.prevOpts(lid); return txt("pv_fee_" + lid); };

  // San Jose's real state: base charges, every prepay waives.
  await type("plan:p1", "signup_fee_on_base", page.CHARGE_W[0]);
  let said = feeLine();
  check(/joining fee on the every month option/.test(said) && /waived/i.test(said),
    `base charges + every rung waives: the line names the charged option AND says prepay waives it ("${said}")`);
  check(!/joining fee\.$/.test(said.trim()),
    "and it is not the old bare sentence that stopped at the fee and omitted the waiver");

  // One rung flips to Charge: the line names what still waives.
  await type("plan:p1", "commitments.0.signup_fee_charge", page.CHARGE_W[0]);
  said = feeLine();
  check(/Waived on .*6 Months \(24 Weeks\)/.test(said),
    `some rungs charge too: the waived lengths are named ("${said}")`);

  // Base waives while a rung charges: the fee is a prepay-only fact.
  await type("plan:p1", "signup_fee_on_base", page.CHARGE_W[1]);
  said = feeLine();
  check(/joining fee when you pay up front for 3 Months \(12 Weeks\)/.test(said),
    `base waives + a rung charges: the line names the charged length ("${said}")`);

  // Nothing charges: no line at all.
  await type("plan:p1", "commitments.0.signup_fee_charge", page.CHARGE_W[1]);
  said = feeLine();
  check(!/joining fee/.test(said), `nothing charges: no fee line at all ("${said}")`);

  // Put the probes back to unanswered so the rest of the flow reads the
  // fixture's own state.
  await type("plan:p1", "signup_fee_on_base", null);
  await type("plan:p1", "commitments.0.signup_fee_charge", null);
}

console.log("\n── D3. the age band: the preview claims only the bound that exists ──");
{
  // PREFILL IS A CLAIM. Only the Elementary card carries one (its class twin
  // in schedule.classes is the one thing to point at); every other plan
  // renders the age boxes EMPTY, because a prefill the owner confirms without
  // editing lands in configuration.
  const pre = Object.fromEntries(["plan:p1", "plan:p2", "plan:p3", "plan:p4"].map((k) => {
    const m = page.MODEL[lidOf(k)] || {};
    return [k, `${m.ageMin}|${m.ageMax}`];
  }));
  check(pre["plan:p3"] === "9|12" && pre["plan:p1"] === "|" && pre["plan:p2"] === "|" && pre["plan:p4"] === "|",
    `the proposed prefill exists ONLY on the Elementary card (${JSON.stringify(pre)})`);

  const lid = lidOf("plan:p1");
  const ages = () => { page.prevOpts(lid); return txt("pv_fee_" + lid); };
  await type("plan:p1", "age_min", "9");
  let said = ages();
  check(/Ages 9 and up\./.test(said), `min only: the parent preview says "Ages 9 and up." ("${said}")`);
  await type("plan:p1", "age_max", "12");
  said = ages();
  check(/Ages 9 to 12\./.test(said), `both bounds: "Ages 9 to 12." ("${said}")`);
  await type("plan:p1", "age_min", "");
  said = ages();
  check(/Ages 12 and under\./.test(said) && !/Ages 9/.test(said), `max only: "Ages 12 and under." ("${said}")`);
  await type("plan:p1", "age_max", "");
  said = ages();
  check(!/Ages /.test(said), `neither: no age line at all ("${said}")`);

  // The ONE page-side guard, same direction as the apply's refusal: an
  // inverted band cannot be confirmed. Blank never blocks - blank means the
  // plan is for everyone, and the empty-age confirms in section G prove it.
  await type("plan:p1", "age_min", "14");
  await type("plan:p1", "age_max", "9");
  ALERTS = [];
  await confirm("plan:p1");
  check(ALERTS.length === 1 && /youngest age is above the oldest/.test(ALERTS[0]) && !dbCard("c-p1").confirmed_at,
    `an inverted band cannot be confirmed ("${ALERTS[0]}")`);
  ALERTS = [];
  // Back to unanswered so the rest of the flow reads the fixture's own state.
  await type("plan:p1", "age_min", null);
  await type("plan:p1", "age_max", null);
}

// ═════════════════════════════════════════════════════════════════════════════
// E. COUNTING - which cards hold Send
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── E. which cards the gate counts: every card, from first render ──");
{
  // D6: one definition, both halves - every card counts, empty or not, and the
  // denominator is fixed the moment the page paints. The empty add-a-plan card
  // is no longer the exception; "confirm it empty" is a real answer.
  const fresh = await getApi();
  const serverCounts = new Map(fresh.cards.map((c) => [c.card_key, c.counts]));
  check(serverCounts.get("plans") === true, "the server counts the EMPTY add-a-plan card");
  check([...serverCounts.values()].every(Boolean) && serverCounts.size === 8, "so all 8 of 8 cards count");
  let wrong = [];
  for (const c of page.CARDS) {
    const mine = page.counted(c), theirs = serverCounts.get(c.card_key);
    if (mine !== theirs) wrong.push(`${c.card_key}: page ${mine}, server ${theirs}`);
  }
  check(wrong.length === 0, `every card is counted the same way by both${wrong.length ? " - " + wrong.join("; ") : ""}`);
  check(page.countedCards().length === 8, `the page counts 8 too (it counts ${page.countedCards().length})`);
  check(txt("ntot") === "8", `and prints 8 as the total on his screen ("${txt("ncf")} of ${txt("ntot")} confirmed")`);

  // THE GATE HOLDS ON THE EMPTY CARDS TOO, and both halves refuse with the
  // same number before a single confirm has happened.
  const refused0 = await callApi({ action: "submit" });
  page.updProg();
  check(refused0.ok === false && refused0.remaining === page.remainingCount(),
    `with nothing confirmed, submit refuses and remaining agrees (server ${refused0.remaining}, page ${page.remainingCount()})`);
  // "Confirm it empty" takes the deliberate act with nothing on the card, so
  // "he was asked and had nothing to add" finally has a record.
  ALERTS = [];
  await confirm("plans");
  check(!!dbCard("c-plans").confirmed_at && ALERTS.length === 0,
    "the EMPTY add-a-plan card can be confirmed - he was asked, nothing to add");
  agree("after confirming an empty card", await serverRemaining());
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
  page.updProg();
  const denomBefore = { tot: txt("ntot"), set: (await getApi()).cards.filter((c) => c.counts).map((c) => c.card_key).join(",") };
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
  page.updProg();
  const denomAfter = { tot: txt("ntot"), set: fresh.cards.filter((c) => c.counts).map((c) => c.card_key).join(",") };
  check(denomBefore.tot === "8" && denomAfter.tot === "8" && denomBefore.set === denomAfter.set,
    `add: the card counted all along and the add did not move the denominator (page ${denomBefore.tot} -> ${denomAfter.tot}) - the 0-of-7 -> 5-of-8 defect, pinned`);
  check(page.counted(cardOf("plans")) === true && fresh.cards.find((c) => c.card_key === "plans").counts === true,
    "add: it holds Send through the confirm it retired, not through a denominator change");
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
// F4. THE "SOMETHING ELSE" CADENCE GETS ITS FOLLOW-UP (G1)
// A plan added with billing_cycle Other and no follow-up is a request staff
// cannot act on - '$85 other' is a riddle. Both halves must refuse it in the
// SAME sentence, and the summary must render the typed cadence, never 'other'.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F4. 'something else' asks how often, on both halves ──");
{
  const plansLid = lidOf("plans");
  page.openAdd(plansLid);
  byId("af_title_" + plansLid).value = "Skills clinic";
  byId("af_price_" + plansLid).value = "85";
  page.pickCyc(plansLid, 6);                      // the real "something else" chip
  check(!!byId("af_cycother_" + plansLid), "picking 'something else' makes the follow-up box exist");
  check(byId("af_title_" + plansLid).value === "Skills clinic" && byId("af_price_" + plansLid).value === "85",
    "and the redraw carried his typed name and price across");

  const attempt = page.readAdd(plansLid, "plan");
  const pageSentence = page.addProblem("plan", attempt);
  const direct = await callApi({ action: "add", card_key: "plans", what: "plan", answered: attempt });
  check(pageSentence === "Please say how often this plan bills before adding it."
    && direct.ok === false && direct.error === pageSentence,
    `both halves refuse with the SAME sentence ("${pageSentence}" / "${direct.error}")`);

  byId("af_cycother_" + plansLid).value = "every 6 weeks";
  await page.submitAdd(plansLid, "plan");
  await settle();
  const stored = DB.workbook_answers.filter((r) => r.card_id === "c-plans").map((r) => r.answered)
    .find((v) => v && v.title === "Skills clinic");
  check(!!stored && stored.billing_cycle === "Other" && stored.billing_cycle_other === "every 6 weeks",
    `the stored request carries the follow-up (${JSON.stringify(stored)})`);
  const summary = page.addSummary(stored || {});
  check(/every 6 weeks/.test(summary.d) && !/\bother\b/i.test(summary.d),
    `and the rendered summary says the cadence, never 'other' ("${summary.d}")`);
  check(/every 6 weeks/.test(byId("card_" + plansLid).outerHTML),
    "the addition list on his screen renders the follow-up text");

  // Take the probe back so the flow's counts stay the fixture's own. Guarded,
  // because under MUTATE=refusedaddwipes the add above never succeeds and a
  // crash here would end the run without its NEGATIVE CONTROL banner.
  const probe = page.additionsOf(cardOf("plans")).find((a) => a.answered && a.answered.title === "Skills clinic");
  if (probe) { await page.removeAddition(plansLid, probe.id); await settle(); }
}

// ═════════════════════════════════════════════════════════════════════════════
// F6. A REFUSED ADD KEEPS THE OWNER'S TYPING (D2)
// Every refusal path in submitAdd redraws the add box (the error line lives
// inside it), and a redrawn input is EMPTY in a real browser - so the refusal
// wiped the plan name and price he had just typed, and correcting one missing
// answer meant retyping everything. redrawAddsKeep carries the typing across,
// the same pattern pickCyc already used for its own redraw.
// MUTATE=refusedaddwipes.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F6. a refused add keeps the owner's typing ──");
{
  const plansLid = lidOf("plans");
  page.openAdd(plansLid);
  byId("af_title_" + plansLid).value = "Skills clinic";
  byId("af_price_" + plansLid).value = "85";
  page.pickCyc(plansLid, 6);                      // "something else", follow-up left empty
  await page.submitAdd(plansLid, "plan");
  await settle();
  const survivedTitle = byId("af_title_" + plansLid) ? byId("af_title_" + plansLid).value : "(no such element)";
  const survivedPrice = byId("af_price_" + plansLid) ? byId("af_price_" + plansLid).value : "(no such element)";
  console.log(`  NOTE  after the refusal the box still holds title ${JSON.stringify(survivedTitle)} and price ${JSON.stringify(survivedPrice)}`);
  check(page.ADDERR[plansLid] === "Please say how often this plan bills before adding it.",
    `the refusal is on the box ("${page.ADDERR[plansLid]}")`);
  check(survivedTitle === "Skills clinic" && survivedPrice === "85",
    "and his typed name and price SURVIVED the refusal redraw");

  // Fill in only what was missing: the add must succeed with the preserved
  // values, proving nothing restored was silently stale.
  byId("af_cycother_" + plansLid).value = "every 6 weeks";
  await page.submitAdd(plansLid, "plan");
  await settle();
  const stored = DB.workbook_answers.filter((r) => r.card_id === "c-plans").map((r) => r.answered)
    .find((v) => v && v.title === "Skills clinic");
  check(!!stored && stored.price === 85 && stored.billing_cycle === "Other" && stored.billing_cycle_other === "every 6 weeks",
    `the add then succeeds carrying the preserved values (${JSON.stringify(stored)})`);

  // Take the probe back so the flow's counts stay the fixture's own. Guarded
  // for the same reason as F4's cleanup: under MUTATE=refusedaddwipes the add
  // never succeeds, and the banner must still print.
  const probe = page.additionsOf(cardOf("plans")).find((a) => a.answered && a.answered.title === "Skills clinic");
  if (probe) { await page.removeAddition(plansLid, probe.id); await settle(); }
}

// ═════════════════════════════════════════════════════════════════════════════
// F5. THE SJ-SHAPED CODES CARD: the missing rows grow back through the page
// (D1, the deployment blocker). The live San Jose workbook was seeded with 5
// rows per code and NONE for applies_to / duration_months / expires_at /
// max_redemptions, so the page's null-id save of the MANDATORY applies-to
// answer 404'd and confirm blocked forever. Here the fixture is cut down to
// exactly that shape, a fresh page is booted against it, and the REAL page
// call that failed in production - the Everything chip's save - must mint the
// row (aimed by the card's own sibling, never the payload) and confirm must
// unblock. MUTATE=codesunmintable / MUTATE=codesmintany.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F5. the SJ-shaped codes card grows its missing rows through the page ──");
{
  const SPLICED = ["codes.0.applies_to", "codes.0.duration_months", "codes.0.expires_at", "codes.0.max_redemptions"];
  const snapAnswers = structuredClone(DB.workbook_answers);
  const snapCards = structuredClone(DB.workbook_cards);
  DB.workbook_answers = DB.workbook_answers.filter((r) => !(r.card_id === "c-codes" && SPLICED.includes(r.target_field)));
  check(DB.workbook_answers.length === snapAnswers.length - 4,
    "the fixture is cut to the live SJ shape: 5 rows for code 0, the 4 late-question rows gone");

  // A fresh page, booted against the SJ-shaped database - the same script, the
  // same fake DOM, the same router.
  const sjPage = new Function(...Object.keys(pageGlobals), pageBody)(...Object.values(pageGlobals));
  await sjPage.boot();
  await settle();
  const codesLid = (sjPage.CARDS.find((c) => c.card_key === "codes") || {}).lid;

  // ── D3 first, on the untargeted state: the server refuses the confirm ─────
  // A direct POST - no page in the middle - is exactly what the dress
  // rehearsal found SUCCEEDING while the page promised a refusal.
  // MUTATE=serverconfirmsuntargeted.
  const refusedConfirm = await callApi({ action: "confirm", card_key: "codes" });
  check(refusedConfirm.ok === false && !dbCard("c-codes").confirmed_at,
    `a direct API confirm of the untargeted code is refused ("${refusedConfirm.error}")`);
  // And the sentence is the PAGE's OWN, byte for byte: the page promises the
  // API's sentences, so the two refusals must be one wording.
  ALERTS = [];
  await sjPage.confirmCard(codesLid);
  await settle();
  check(ALERTS.length === 1 && ALERTS[0] === refusedConfirm.error,
    `and the page's alert is BYTE-IDENTICAL to the server's refusal ("${ALERTS[0]}")`);

  // The exact call that 404'd in production: the owner ticks the Everything
  // chip, the page saves codes.0.applies_to with a null id.
  sjPage.applyEverything(codesLid, 0);
  TIMERS.clear();
  const saved = await sjPage.flushAll();
  await settle();
  check(saved === true && sjPage.SAVE.state !== "error",
    "the Everything chip's save goes through (this exact save 404'd on the live workbook)");
  const mintedRow = dbAnswer("c-codes", "codes.0.applies_to");
  const sibRow = dbAnswer("c-codes", "codes.0.code");
  check(!!mintedRow && DB.workbook_answers.filter((r) => r.card_id === "c-codes" && r.target_field === "codes.0.applies_to").length === 1,
    `the row was MINTED, exactly once (id ${mintedRow && mintedRow.id})`);
  check(!!mintedRow && mintedRow.target_kind === sibRow.target_kind && mintedRow.target_table === sibRow.target_table && mintedRow.target_id === sibRow.target_id,
    `aimed by the card's own codes.0.code sibling (${sibRow.target_kind}/${sibRow.target_table}/${sibRow.target_id}), never by the page's payload`);
  const savedKeys = Array.isArray(mintedRow && mintedRow.answered) ? mintedRow.answered.length : 0;
  check(savedKeys > 0 && savedKeys === sjPage.priceKeys().length,
    `carrying the page's whole materialized key list (${savedKeys} keys saved)`);

  // And the deliberate act the blocker was blocking: confirm succeeds end to end.
  ALERTS = [];
  await sjPage.confirmCard(codesLid);
  await settle();
  check(!!dbCard("c-codes").confirmed_at && ALERTS.length === 0,
    "and the codes card CONFIRMS - the mandatory applies-to answer finally has a row to live in");

  // FAIL-CLOSED DID NOT WEAKEN: a field CODE_T does not know keeps the refusal,
  // byte for byte, on the same door.
  const foreign = await callApi({ action: "save", card_key: "codes", answers: [{ id: null, target_field: "codes.0.hacker", answered: "x" }] });
  check(foreign.ok === false && foreign.error === "that answer does not belong to this card",
    `a null-id save of codes.0.hacker still refuses byte-for-byte ("${foreign.error}")`);

  // ── Step 2 (2026-08-06): one spelling per address, same direct-POST door ──
  // `+m[1]` collapses "00" and "0" into one number but the mint dedupes rows
  // by the exact target_field string, so `codes.00.applies_to` used to mint a
  // TWIN row for logical code 0. MUTATE=noncanonicalindex.
  // The save-payload log is SNAPSHOTTED first: everything in it so far came
  // from the real page or from canonical harness probes, and the deliberately
  // non-canonical direct POST below must not end up inside its own tripwire.
  const savedCodeFields = [...new Set(API_CALLS
    .filter((c) => c.body && c.body.action === "save" && Array.isArray(c.body.answers))
    .flatMap((c) => c.body.answers.map((a) => String((a || {}).target_field || "")))
    .filter((f) => f.startsWith("codes.")))];
  const twinSave = await callApi({ action: "save", card_key: "codes", answers: [{ id: null, target_field: "codes.00.applies_to", answered: ["x"] }] });
  check(twinSave.ok === false && twinSave.error === "that answer does not belong to this card"
    && DB.workbook_answers.filter((r) => r.card_id === "c-codes" && /^codes\.0+\.applies_to$/.test(r.target_field)).length === 1,
    `a direct POST of codes.00.applies_to refuses 404 and logical code 0 keeps ONE row ("${twinSave.error}")`);

  // ── D4, through the REAL page: the failure banner claims only what it knows.
  // After D1 a genuinely foreign field is still the reachable 404, and the
  // banner must name the field rather than guess a cause. This doubles as the
  // contract-side pin that D1's fail-closed refusal still fires through the
  // page. Driven on the throwaway SJ page, so the stuck-dirty field it leaves
  // behind is discarded with it. MUTATE=bannerblamesadds.
  sjPage.setA(codesLid, "codes.0.hacker", "x");
  TIMERS.clear();
  const failedFlush = await sjPage.flushAll();
  await settle();
  console.log(`  NOTE  the banner reads: "${sjPage.SAVE.msg}"`);
  check(failedFlush === false && sjPage.SAVE.state === "error",
    "a save the server refuses fails loud through the real page");
  check(/codes\.0\.hacker/.test(sjPage.SAVE.msg) && !/cannot add brand new items/.test(sjPage.SAVE.msg),
    `and the banner names the field it could not save, claiming no cause ("${sjPage.SAVE.msg}")`);

  // ── Step 2's regression tripwire against the PAGE: every codes.* field the
  // real page ever put in a save payload (snapshotted above, before the
  // deliberately non-canonical harness probe) is canonically spelled, so
  // refusing non-canonical spellings can never refuse the page. codeIndices
  // does `s.add(+m[1])` on rows the API itself sent and setA builds
  // 'codes.'+i+'.'+f from those numbers - this asserts that stays true.
  check(savedCodeFields.length > 0 && savedCodeFields.every((f) => /^codes\.(?:0|[1-9]\d*)\./.test(f)),
    `every codes.* field the REAL page ever saved is canonically spelled (${savedCodeFields.join(", ")})`);

  // Put the fixture back and reboot the main page off it, so every later
  // section reads the state it always did.
  DB.workbook_answers = snapAnswers;
  DB.workbook_cards = snapCards;
  await page.boot();
  await settle();
}

// ═════════════════════════════════════════════════════════════════════════════
// F3. THE CODES CARD REFUSES CONFIRM UNTIL EVERY CODE STATES ITS TARGETS
// (D1 Variant A). An empty applies_to means Stripe discounts every line of the
// first invoice by default - and the mint withholds the fee target in response
// - so the page refuses the deliberate act until the scope is a choice. The
// explicit choice is the "Everything, including the joining fee" chip, which
// MATERIALIZES the full key list rather than storing a sentinel.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F3. a code with no stated targets cannot be confirmed ──");
{
  const codesLid = lidOf("codes");
  // Take the fixture code's list away through the page's own write path.
  await type("codes", "codes.0.applies_to", []);
  ALERTS = [];
  await confirm("codes");
  check(!dbCard("c-codes").confirmed_at && !cardOf("codes").confirmed_at,
    "confirm on a named code with nothing ticked is refused - the card stays unconfirmed on both halves");
  check(ALERTS.length === 1 && /applies to first/.test(ALERTS[0]) && /Everything, including the joining fee/.test(ALERTS[0]),
    `and the refusal offers the explicit choice ("${ALERTS[0]}")`);

  // The Everything chip: the saved list is the page's whole materialized key
  // vocabulary, the joining-fee keys included - real keys, not a sentinel.
  page.applyEverything(codesLid, 0);
  TIMERS.clear(); await page.flushAll(); await settle();
  ALERTS = [];
  await confirm("codes");
  check(!!dbCard("c-codes").confirmed_at && ALERTS.length === 0,
    "choosing Everything and confirming succeeds");
  const savedList = dbAnswer("c-codes", "codes.0.applies_to").answered;
  const want = page.priceKeys();
  const sameSet = Array.isArray(savedList) && savedList.length === want.length && want.every((k) => savedList.includes(k));
  check(sameSet && savedList.some((k) => /\|signup_fee$/.test(k)),
    `and the saved applies_to equals the page's own key list, fee keys included (${Array.isArray(savedList) ? savedList.length : "?"} keys)`);
  check(page.appliesEverything((page.MODEL[codesLid] || [])[0] || {}) === true,
    "which the page reads back as the Everything state, so the chip stays lit");

  // ── D3: the scope sentence tracks the DURATION the owner picked ───────────
  // Driven through the same write path the duration chips use, then the card
  // is redrawn and its rendered copy read - the sentence is the claim.
  const cardMarkup = () => byId("card_" + codesLid).outerHTML;
  page.setA(codesLid, "codes.0.duration", page.DUR[0]);   // First payment only
  page.drawCodes();
  let said = cardMarkup();
  check(/on the first bill/.test(said) && !/on every bill/.test(said),
    "a first-payment code says its discount rides the first bill only");
  check(/including the joining fee(?! on the first one)/.test(said),
    "and the fee clause claims the fee plainly - the fee rides that same first invoice");
  page.setA(codesLid, "codes.0.duration", page.DUR[2]);   // Every payment
  page.drawCodes();
  said = cardMarkup();
  check(/on every bill/.test(said) && !/on the first bill/.test(said),
    "an every-payment code says every bill, not the hardcoded first-bill claim");
  check(/including the joining fee on the first one/.test(said),
    "while the fee clause still claims only the first invoice - the fee never recurs");
}

// ═════════════════════════════════════════════════════════════════════════════
// F7. THE WHITESPACE KEY: applies-to emptiness is ONE rule on both halves
// (Step 1, 2026-08-06 whitespace remediation). `[" "]` is byte-reachable by a
// direct POST, and it used to read TARGETED to the guards' raw length checks
// while couponAppliesToKeys trimmed it to "everything" for the Stripe coupon.
// Both halves now read it through the same emptiness rule (the page inline,
// the server via cleanAppliesTo), refusing in ONE sentence.
// MUTATE=blankkeysrestrict.
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── F7. a whitespace-only applies_to reads untargeted on both halves ──");
{
  const codesLid = lidOf("codes");
  await type("codes", "codes.0.applies_to", [" "]);
  // The page refuses at the deliberate act, BEFORE any network: no confirm
  // call may leave the page.
  const confirmsBefore = API_CALLS.filter((c) => c.body && c.body.action === "confirm").length;
  ALERTS = [];
  await page.confirmCard(codesLid);
  await settle();
  const confirmsAfter = API_CALLS.filter((c) => c.body && c.body.action === "confirm").length;
  check(ALERTS.length === 1 && confirmsAfter === confirmsBefore && !cardOf("codes").confirmed_at,
    `the page reads [" "] as untargeted and refuses before any network ("${ALERTS[0]}")`);
  // And the server, POSTed directly the way the tester did, refuses the same
  // confirm - in the byte-identical sentence the page just promised.
  const refusedWs = await callApi({ action: "confirm", card_key: "codes" });
  check(refusedWs.ok === false && !dbCard("c-codes").confirmed_at,
    `a direct API confirm of the whitespace-keyed code is refused, card unconfirmed ("${refusedWs.error}")`);
  check(ALERTS[0] === refusedWs.error,
    "and the two refusals are BYTE-IDENTICAL - one sentence, two doors");
  // Put the card back the way F3 left it, so the gate below reads the state
  // it always did.
  page.applyEverything(codesLid, 0);
  TIMERS.clear(); await page.flushAll(); await settle();
}

// ═════════════════════════════════════════════════════════════════════════════
// G. THE GATE - the number on his screen against the number that is enforced
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n── G. the submit gate ──");
{
  // G2 first: the optional tax registration number, typed through the real
  // input path before the tax card is confirmed. The stub's clients row is
  // checked after the staff apply in H4.
  await type("tax", "tax_registration_number", "77-880 CA");
  check(dbAnswer("c-tax", "tax_registration_number").answered === "77-880 CA",
    "the tax registration number saves through the ordinary answer path");

  // Step 12: the age band, typed through the real inputs. The stub's offer
  // jsonb is checked after the staff apply in H4.
  await type("plan:p1", "age_min", "9");
  await type("plan:p1", "age_max", "12");
  check(dbAnswer("c-p1", "age_min").answered === "9" && dbAnswer("c-p1", "age_max").answered === "12",
    "the ages save through the ordinary answer path, as strings");

  // Confirm everything except one card, so the refusal has a number in it that
  // both halves have to agree about. plan:p1 is re-confirmed here because the
  // age edit above rightly RETIRED its earlier confirm - an approval does not
  // survive the answer changing underneath it.
  for (const key of ["tax", "plan:p1", "plan:p2", "plan:p3", "plan:p4", "codes", "plans"]) await confirm(key);
  // Blank never blocks: p2 and p4 carry NO ages and confirmed anyway - being
  // for everyone is an answer, not an omission.
  check(!!dbCard("c-p2").confirmed_at && !!dbCard("c-p4").confirmed_at,
    "a card with blank ages confirms - blank means the plan is for everyone");
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
  // THE EMPTY ADD-A-PLAN CARD counts on BOTH halves now (D6). Its addition is
  // lifted out and both halves are asked again: the denominator must not move,
  // review must still SHOW the card, and staff must be able to approve the
  // owner's "nothing to add".
  const stash = DB.workbook_answers.filter((r) => r.card_id === "c-plans");
  DB.workbook_answers = DB.workbook_answers.filter((r) => r.card_id !== "c-plans");
  await page.boot(); await settle();
  const r = await staffApi({ action: "review", workbook_id: "wb1" });
  const serverSet = setOf(r.body.gate.unapproved_card_keys);
  const pageSet = setOf(page.countedCards().map((c) => c.card_key));
  check(serverSet === pageSet, `with the request taken back off it, still the same cards: page [${pageSet}] / staff gate [${serverSet}]`);
  check(r.body.gate.unapproved_card_keys.includes("plans") && page.counted(cardOf("plans")) === true,
    "and BOTH halves still count the empty card - the denominator does not move when a card empties");
  const shownEmpty = r.body.review.cards.find((c) => c.card_key === "plans");
  check(!!shownEmpty && Array.isArray(shownEmpty.items) && shownEmpty.items.length === 0,
    "review SHOWS the empty card with items: [], so staff can see he was asked and had nothing to add");
  const approvedEmpty = await staffApi({ action: "approve-card", workbook_id: "wb1", card_key: "plans" });
  check(approvedEmpty.status === 200 && approvedEmpty.body.ok === true,
    `an empty confirmed card can be approve-carded - no 409 (status ${approvedEmpty.status})`);
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

  // G2: the number he typed on the tax card is now on the academy row, exactly
  // as review previewed it. MUTATE=taxregnowhere takes away its classifyField
  // home, and the whole apply must then refuse rather than write it anywhere.
  const regItem = beforeApply.body.review.academy_settings.find((i) => i.target_field === "tax_registration_number");
  check(!!regItem && regItem.will_write === "77-880 CA",
    `review previews the registration number as the text he typed (${JSON.stringify(regItem && regItem.will_write)})`);
  check(DB.clients[0].tax_registration_number === "77-880 CA",
    `and apply landed it on clients.tax_registration_number (saw ${JSON.stringify(DB.clients[0].tax_registration_number)})`);

  // Step 12: the age band. Review previews the STRING the translator will
  // write - MUTATE=agesunknownfield takes away its PLAN_T home, and the whole
  // apply must then refuse rather than land it on a guessed key.
  const ageItem = (beforeApply.body.review.cards.find((c) => c.card_key === "plan:p1") || { items: [] })
    .items.find((i) => i.target_field === "age_min");
  check(!!ageItem && ageItem.will_write === "9",
    `review previews age_min as the STRING "9" (${JSON.stringify(ageItem && ageItem.will_write)})`);
  const offP1 = offerRow().data.pricing.pricing_offerings[OFFERING_IX.get("plan:p1")] || {};
  check(offP1.age_min === "9" && offP1.age_max === "12" && typeof offP1.age_min === "string",
    `and the ages he typed landed on the offering as strings (age_min ${JSON.stringify(offP1.age_min)}, age_max ${JSON.stringify(offP1.age_max)})`);
  const offP3 = offerRow().data.pricing.pricing_offerings[OFFERING_IX.get("plan:p3")] || {};
  check(offP3.age_min === "9" && offP3.age_max === "12",
    `the Elementary prefill he confirmed landed too (age_min ${JSON.stringify(offP3.age_min)}, age_max ${JSON.stringify(offP3.age_max)})`);
  const offP2 = offerRow().data.pricing.pricing_offerings[OFFERING_IX.get("plan:p2")] || {};
  check(!("age_min" in offP2) && !("age_max" in offP2),
    "while the blank-age plan grew NO age keys at all");
  // Stored-for-later is said OUT LOUD: nothing consumes plan ages yet, and an
  // apply that wrote them must say no routing changed. MUTATE=agenotegone.
  check(typeof applied.body.age_note === "string" && /Nothing reads plan ages yet/.test(applied.body.age_note),
    `the apply response says plan ages are stored for later and no routing changed ("${applied.body.age_note}")`);
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
  // Read defensively: under an API control that makes apply REFUSE, phase3 is
  // absent, and a harness that crashes exits without its banner - the H4
  // assertions above are the ones that report the refusal.
  const PH3 = (applied.body && applied.body.phase3) || {};
  const p3keys = (PH3.targets || []).map((t) => t.key);
  const offered = new Set(page.priceKeys());
  const orphan = p3keys.filter((k) => !offered.has(k));
  check(p3keys.length > 0 && orphan.length === 0,
    `every price the mint would create is one the page can name in applies_to (${p3keys.length} targets${orphan.length ? " - ORPHANED: " + orphan.join(", ") : ""})`);

  // THE MONEY, computed twice and compared once. The page multiplies the plan
  // price by the tax he entered and prints a sentence; the rehearsal takes the
  // tax it just wrote to clients and mints cents through _fees.applyFee. Nothing
  // is shared between those two paths except the workbook.
  const byKey = new Map((PH3.targets || []).map((t) => [t.key, t]));
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

  // THE WITHHELD-FEE REPORT AGREES WITH THE PAGE'S OWN CODES MODEL. The page
  // computes "loose" (a named code with nothing ticked, while some plan charges
  // a joining fee) to warn the owner; the apply response computes the same state
  // off the offer as it really landed and WITHHOLDS the fee target when it
  // holds. The two halves must agree on WHEN that state exists, or the owner is
  // warned about a withhold that never happens - or worse, not warned about one
  // that does. MUTATE=feewithheldsilently.
  const whs = PH3.withheld_signup_fees;
  const codesModel = page.MODEL[lidOf("codes")] || [];
  const anyFee = page.CARDS.filter((c) => c.type === "plan")
    .some((c) => page.MODEL[c.lid] && !page.MODEL[c.lid].archived && page.MODEL[c.lid].fee === 1);
  const pageLoose = codesModel.some((c) => String(c.code).trim() && !(c.applies && c.applies.length)) && anyFee;
  check(Array.isArray(whs), `the apply response carries withheld_signup_fees as DATA (saw ${JSON.stringify(whs)})`);
  check((Array.isArray(whs) && whs.length > 0) === pageLoose,
    `and its presence matches the page's own loose-code state (page loose ${pageLoose}, withheld ${Array.isArray(whs) ? whs.length : "MISSING"})`);

  // D7: the live-Stripe read happened, read-only, and with this harness's
  // empty account every target honestly reads as would-mint.
  check(PH3.stripe_check === "read" && PH3.exists_in_stripe === 0 && PH3.would_mint_new === (PH3.targets || []).length,
    `the rehearsal read LIVE Stripe (stripe_check ${JSON.stringify(PH3.stripe_check)}, ${PH3.exists_in_stripe} exist, ${PH3.would_mint_new} to mint of ${(PH3.targets || []).length})`);
  // R3: and the read PAGINATED. The fixture's first page is 100 fillers with
  // has_more:true, so a read that never sends the starting_after cursor never
  // saw the whole account - in production that reports exists:false past
  // price #100 and the mint duplicates real prices. MUTATE=onepagestripe.
  const cursorReq = STRIPE_GETS.find((g) => g.includes("/v1/prices") && g.includes(`starting_after=${STRIPE_CURSOR}`));
  check(!!cursorReq,
    `the price read paginated: a request carried starting_after=${STRIPE_CURSOR} (${STRIPE_GETS.filter((g) => g.includes("/v1/prices")).length} price GETs recorded)`);
  check((PH3.targets || []).length > 0 && (PH3.targets || []).every((t) => t.billing_rhythm && typeof t.billing_rhythm.sentence === "string" && t.billing_rhythm.recurring !== undefined),
    "and every target states its real billing rhythm with a source, no hedge");
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

console.log("\n── I. a confirmed No to tax survives as a value the next workbook reads ──");
{
  // A FRESH RUN in the same harness: the stub world is reset wholesale and a
  // NEW page instance is built, because the real page never un-submits (RO is
  // one-way by design) and this section needs an editable workbook. Everything
  // else - the router, the handler, the DOM double - is the same machinery.
  reset();
  page = new Function(...Object.keys(pageGlobals), pageBody)(...Object.values(pageGlobals));
  await page.boot(); await settle();
  page.setTax(0);                                   // the real "No, my prices are the full amount" chip
  TIMERS.clear(); await page.flushAll(); await settle();
  for (const key of ["tax", "plan:p1", "plan:p2", "plan:p3", "plan:p4", "codes", "plans", "notes"]) await confirm(key);
  ALERTS = [];
  await page.doSubmit(); await settle();
  check(DB.workbooks[0].status === "submitted", `the No workbook sends${ALERTS.length ? " (alerts: " + ALERTS.join(" | ") + ")" : ""}`);
  const rvI = await staffApi({ action: "review", workbook_id: "wb1" });
  for (const k of rvI.body.gate.unapproved_card_keys) await staffApi({ action: "approve-card", workbook_id: "wb1", card_key: k });
  const apI = await staffApi({ action: "apply", workbook_id: "wb1" });
  check(apI.body.ok === true && JSON.stringify(DB.clients[0].tax_config) === JSON.stringify({ charges_tax: false }),
    `apply stores the No as { charges_tax: false }, never null (saw ${JSON.stringify(DB.clients[0].tax_config)})`);
  // Read defensively: under an API control that makes apply REFUSE, phase3 is
  // absent, and a harness that crashes exits without its banner.
  check((apI.body.phase3 || {}).tax_state === "confirmed_no",
    `and the rehearsal reports it (tax_state ${JSON.stringify((apI.body.phase3 || {}).tax_state)})`);

  // THE DISTINGUISHABILITY THE PAGE COPY PROMISES ("Answering No is a real
  // answer, not a skip"): a future workbook minted over this academy carries
  // the stored config as current_value, and the page must render the card as
  // ANSWERED No - not as never asked. MUTATE=noisnull collapses exactly this.
  const taxRowI = dbAnswer("c-tax", "tax_config");
  taxRowI.current_value = DB.clients[0].tax_config;
  taxRowI.proposed = null;
  taxRowI.answered = null;
  DB.workbooks[0].status = "sent";                  // a fresh link over the same rows
  page = new Function(...Object.keys(pageGlobals), pageBody)(...Object.values(pageGlobals));
  await page.boot(); await settle();
  const TI = page.MODEL[lidOf("tax")];
  check(TI.on === 0,
    `the next workbook renders the tax card as ANSWERED No (on ${JSON.stringify(TI.on)}), not as never asked (null)`);
}

console.log("\n── J. 25 months on the real page is refused where staff read, and cannot apply ──");
{
  // R4: duration_months is bounded 1-24 (the term vocabulary's own ceiling).
  // A fresh run, section I's pattern: the owner picks "a set number of
  // months" and types 25 through the page's real input path - there is no
  // confirm-gate block, the translator refusal IS the enforcement, so it must
  // print in review AND refuse the apply. MUTATE=monthsunbounded.
  reset();
  page = new Function(...Object.keys(pageGlobals), pageBody)(...Object.values(pageGlobals));
  await page.boot(); await settle();
  await type("codes", "codes.0.duration", page.DUR[1]);        // For a set number of months
  await type("codes", "codes.0.duration_months", 25);          // the page's number input sends a NUMBER
  check(dbAnswer("c-codes", "codes.0.duration_months").answered === 25,
    "typing 25 months saves through the ordinary answer path");
  for (const key of ["tax", "plan:p1", "plan:p2", "plan:p3", "plan:p4", "codes", "plans", "notes"]) await confirm(key);
  ALERTS = [];
  await page.doSubmit(); await settle();
  check(DB.workbooks[0].status === "submitted", `the workbook sends${ALERTS.length ? " (alerts: " + ALERTS.join(" | ") + ")" : ""}`);

  const rvJ = await staffApi({ action: "review", workbook_id: "wb1" });
  const monthsItem = REVIEW_ITEMS(rvJ.body).find((i) => i.target_field === "codes.0.duration_months") || {};
  check(/a set number of months must be a whole number from 1 to 24/.test(String(monthsItem.translation_error))
    && monthsItem.will_write === undefined,
    `review carries the refusal where staff read ("${monthsItem.translation_error}")`);

  for (const k of rvJ.body.gate.unapproved_card_keys) await staffApi({ action: "approve-card", workbook_id: "wb1", card_key: k });
  const offersBeforeJ = JSON.stringify(DB.offers.map((o) => ({ id: o.id, data: o.data })));
  const apJ = await staffApi({ action: "apply", workbook_id: "wb1" });
  const fJ = (Array.isArray((apJ.body || {}).failures) ? apJ.body.failures : [])
    .find((f) => f.target_field === "codes.0.duration_months") || {};
  check(apJ.body.ok === false && /a set number of months must be a whole number from 1 to 24/.test(String(fJ.error)),
    `and apply refuses the workbook with the same sentence ("${fJ.error}")`);
  check(JSON.stringify(DB.offers.map((o) => ({ id: o.id, data: o.data }))) === offersBeforeJ,
    "so the 25-month claim never reached the offer jsonb");
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
