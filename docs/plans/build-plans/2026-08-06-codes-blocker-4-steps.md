I have enough. Here is the plan.

# Build plan: workbook deployment-gap fixes (D1-D4)

All paths relative to `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal`.

Ops rules for the builder (non-negotiable): tester is a separate agent; after any `api/` change restart the local API harness by killing the port listener (`lsof -ti :<port> | xargs kill`), never pkill; no em dashes in any owner- or staff-facing string; stub DB only, no production contact; every new check PRINTS what it caught; every negative control is a ONE-LINE mutation with its measured catch count recorded in the harness header block.

---

## Step 1 (D1, BLOCKER): extend the mint allowlist to codes fields, indexed, fail-closed

**Decision: the allowlist, not a seed script.** Every future academy's seed has the same gap the moment a code exists (seed writes 5 rows per code; `applies_to`, `duration_months`, `expires_at`, `max_redemptions` have no rows), and the mint machinery already exists and derives targets safely from siblings. The live SJ workbook (4ad292a0..., draft) is then repaired purely through the page: the owner or staff opening the tokenized page and ticking a chip mints the row. No manual seeding. (`scripts/seed-sj-age-rows.mjs` is precedent for seeding, but it exists because age rows needed *proposed* values from class twins; `applies_to` carries no proposal, so the mint path is strictly better here.)

**Files:** `api/workbook.js`, `api/_workbook.test.mjs`, `scripts/verify-workbook-contract.mjs`

**Change (api/workbook.js):** The mint gate at line 685 is `mintableOn(card.card_key).includes(field)` - an exact-string match, so indexed `codes.<i>.<field>` names can never pass. Do NOT flatten codes fields into the array. Add a predicate beside `mintableOn` (line 217) and switch line 685 to it:

```js
function canMint(cardKey, field) {
  if (mintableOn(cardKey).includes(field)) return true;
  const k = String(cardKey || "");
  if (k === "codes" || k.startsWith("codes:")) {
    const cls = classifyField(field);          // hoisted; defined at line 1520
    return cls.kind === "code" && !!cls.t;     // own-property CODE_T leaf, index <= MAX_LIST_INDEX
  }
  return false;
}
```

Reusing `classifyField` buys three guards for free: own-property lookup against `CODE_T` (line 1431 - `constructor`/`__proto__` refuse), the `MAX_LIST_INDEX` (199) index bound, and the `codes.<i>.<leaf>` shape. Allow ALL `CODE_T` leaves, not just the four missing ones: that is what makes a NEW code index (`codes.1.code`, `codes.1.applies_to`, ...) mintable, and every leaf is one the apply translator already knows how to judge. Everything else in the mint block (lines 683-721) stays byte-identical: dedupe-by-field before minting, sibling-derived target (codes siblings all target the offer; a codes card with zero rows has no sibling and falls through to the existing 404 refusal - keep that), undo-on-close, "second null-id save lands on the SAME row".

**Fail-closed must not weaken.** The existing refusal tests stay green untouched: `_workbook.test.mjs` lines 1555-1558 (`sneaky_field` on tax, `tax_registration_number` on a plan card, `price` on a plan card) and lines 1587-1590 (`age_min` on the CODES card - `classifyField("age_min")` is kind `plan`, so `canMint` still refuses it there).

**Tests (extend, never loosen):**
- `api/_workbook.test.mjs`, new section after line 1592, with codes-card fixture rows seeded SJ-style (5 rows for code 0, targets on the offer):
  - null-id save of `codes.0.applies_to` → 200; exactly ONE minted row; target_kind/table/id equal the `codes.0.code` sibling's, never the payload; print the minted id.
  - second null-id save of the same field updates the SAME row, no twin.
  - NEW INDEX: null-id saves of `codes.1.code` then `codes.1.applies_to` → both mint, aimed at the same sibling-derived target; print both ids.
  - Refusals, byte-for-byte "that answer does not belong to this card" 404: `codes.0.hacker`, `codes.0.constructor`, `codes.200000.applies_to` (index bound), `codes.0.applies_to` on a PLAN card, and `applies_to` (unindexed) on the codes card.
- `scripts/verify-workbook-contract.mjs`, new owner-half section (place near the existing Variant A section at ~line 1572, before submit): snapshot `db.workbook_answers` + card state, splice out the fixture's `codes.0.{applies_to,duration_months,expires_at,max_redemptions}` rows (lines 789-792) so the DB is exactly SJ-shaped, re-instantiate the page (`new Function(...pageGlobals)` + `await page.boot()`), then drive the REAL page: `page.applyEverything(codesLid, 0)` → flush → assert the save returned ok (this is the exact call that 404'd in production), assert the minted row exists with the sibling's target, then `page.confirmCard(codesLid)` succeeds end to end. Print the minted row id and saved key count. Then restore the snapshot and reboot the page for later sections.
- **Controls (one line each, in both harnesses' control tables):**
  - `MUTATE=codesunmintable`: the codes branch of `canMint` returns false (fix reverted). Must reproduce the live defect: page save 404s, confirm blocks forever.
  - `MUTATE=codesmintany`: `return cls.kind === "code" && !!cls.t;` → `return true;` (allowlist gutted). The refusal assertions must catch it.
  - Measure each catch count with the harness run and record it in both header blocks (`_workbook.test.mjs` lines ~150, contract script lines ~174-202).

---## Step 2 (D3): server-side confirm guard for untargeted codes

**Files:** `api/workbook.js`, `api/_workbook.test.mjs`, `scripts/verify-workbook-contract.mjs`, `public/workbook.html` (comment only)

**Change (api/workbook.js):** Extract the per-code effective extraction the review warnings already use (lines 1712-1724: the `/^codes\.(\d+)\.(code|applies_to)$/` byIdx loop over `effective(a)` - line 166's answered-else-proposed helper) into a small named helper, e.g. `looseCodesIn(mine)` returning `[{ index, code }]`, and use it in BOTH places so the confirm rule and the review warning can never drift. In `doConfirm` (line 935), after loading `mine` (line 945) and only when `cardKey === "codes" || cardKey.startsWith("codes:")`, refuse BEFORE the materialize loop:

```js
const loose = looseCodesIn(mine);
if (loose.length) throw bad('Say what ' + loose[0].code + ' applies to first. Tick the prices it covers, or choose "Everything, including the joining fee".');
```

The sentence must be BYTE-IDENTICAL to the page's alert at `public/workbook.html:898` (the page promises the API's own sentences). Note the materialize loop would have written `proposed` into `answered` anyway, and `effective` already reads `proposed`, so checking before the loop is equivalent and leaves no half-stamped card. Update the now-false page comment at `workbook.html:895-896` ("The server stays permissive on confirm") to say the server refuses too - comment only, no behavior.

**Tests:**
- `_workbook.test.mjs`: codes fixture with a named code and blank effective `applies_to` → direct `POST {action:"confirm", card_key:"codes"}` refuses 400, error string asserted verbatim (print it); with `applies_to` filled → 200; codes card with NO named code (confirm-it-empty) → still 200.
- Contract script: (a) direct API confirm against the untargeted state refuses - this is exactly what the dress rehearsal found succeeding; (b) byte-identity: stub `alert` to capture, drive `page.confirmCard` on the untargeted state, and assert the captured page sentence `===` the server's error string for the same code name; (c) positive control: the existing Variant A section (~line 1572-1602, Everything-chip flow) still confirms end to end - re-run it unmodified as the pin.
- **Control:** `MUTATE=serverconfirmsuntargeted` - one line, `if (loose.length)` → `if (false && loose.length)`, printing. Measure and record. Also RE-MEASURE the existing page-side `MUTATE=confirmuntargetedcode` (contract line 288, currently 2 catches): with the server guard in place its failure signature changes; update the recorded count honestly.

---

## Step 3 (D2): a refused add keeps the owner's typing

**Files:** `public/workbook.html`, `scripts/verify-workbook-contract.mjs`

**Root cause:** `submitAdd` (line 1640) on every refusal path (`capReason` line 1643, `addProblem` line 1648, too-long line 1651, server catch → trailing line 1680) calls `redrawAdds(lid)`, which re-renders `addFieldsHTML` with fresh, empty inputs. `pickCyc` (lines 1537-1542) already solved this exact problem with a snapshot/restore.

**Change:** Generalize pickCyc's pattern into one helper and use it wherever the add box redraws while still open:

```js
function redrawAddsKeep(lid){
  const keep={};
  ['af_title_','af_price_','af_cycother_','af_months_','af_code_'].forEach(p=>{
    const e=document.getElementById(p+lid); if(e)keep[p+lid]=e.value;
  });
  redrawAdds(lid);
  Object.entries(keep).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.value=v});
}
```

Swap the three early-return `redrawAdds(lid)` calls in `submitAdd` and the trailing one (line 1680) to `redrawAddsKeep(lid)` (harmless on success: `ADDOPEN=0`, inputs gone). Rewrite `pickCyc`'s inline keep block to call it too, so the pattern lives once.

**Test (contract, through the real page):** open the plans add box, set `af_title` = "Skills clinic" and `af_price` = "85" via the fake DOM, `pickCyc(lid, 6)` (Other), leave the follow-up empty, `submitAdd` → assert `ADDERR` holds the refusal sentence AND `getElementById('af_title_'+lid).value === 'Skills clinic'` and price still `'85'` - PRINT both surviving values. Then fill the follow-up and assert the add succeeds with the preserved values (nothing was silently stale).
- **Control:** `MUTATE=refusedaddwipes` - one line: the restore loop in `redrawAddsKeep` becomes a no-op comment. Measure, record in the contract header block.

---

## Step 4 (D4): the save-failure banner claims only what it knows

**Files:** `public/workbook.html`, `scripts/verify-workbook-contract.mjs`

**Change:** In `flush()` (line 791-798), the `creating` branch's guessed sentence ("This page cannot add brand new items yet...") is replaced with copy built from what the code actually has in hand - the `fields` array of the failed batch:

- Keep the `offline` branch byte-identical.
- Replace the `creating` message with one that names the field(s) and states only that the change is not stored, e.g.: `'We could not save your answer for '+fields.join(', ')+'. That change is not stored yet. Try again, or tell BAM directly.'` (exact copy is the builder's, subject to: names the field(s), claims no cause, no em dashes, works with the existing "Try again" button in `paintSave`).
- The non-creating branch keeps `e.message` (the API's own sentence) unchanged.

**Test (contract):** after D1, a genuinely foreign null-id field is still the reachable 404: drive `page.setA(codesLid,'codes.0.hacker','x')` + flush, assert the flush fails, `SAVE.state==='error'`, `SAVE.msg` CONTAINS `codes.0.hacker` and does NOT contain "cannot add brand new items" - print the banner text verbatim. (This doubles as the contract-side pin that D1's fail-closed refusal still fires through the real page.)
- **Control:** `MUTATE=bannerblamesadds` - one line restoring the old guessed sentence. Measure, record.

---

## Gates and closeout

Every step lands in the three existing gates: `node api/_workbook.test.mjs`, `node api/_workbook-apply.test.mjs` (run it after the Step 2 helper refactor - it pins the withhold/warning sentence that `looseCodesIn` now feeds), `node scripts/verify-workbook-contract.mjs`. Full closeout: unmutated all-green with the new assertion totals recorded, then the full MUTATE sweep (all pre-existing controls plus the six new ones: `codesunmintable`, `codesmintany`, `serverconfirmsuntargeted`, `refusedaddwipes`, `bannerblamesadds`, and the re-measured `confirmuntargetedcode`), header blocks in both harnesses updated with measured counts and the measurement date. A pinned control whose target text moved must be re-pointed, never deleted quietly. SJ live repair is verified by the tester on the deployed page only through the mint path: open the owner link, tick the Everything chip, watch the save go 200 and confirm unblock.

### Critical Files for Implementation
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/workbook.js (mintableOn/canMint ~217+685, doConfirm ~935, warnings extraction ~1704-1748, classifyField ~1520)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/public/workbook.html (flush banner ~791, confirmCard guard ~888-902, submitAdd/redrawAdds ~1604-1681, pickCyc ~1530)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/scripts/verify-workbook-contract.mjs (controls table ~259-450, codes fixture ~783-793, Variant A section ~1572)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/_workbook.test.mjs (mint whitelist sections ~1530-1592, EDITS control table)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/_workbook-apply.test.mjs (warning-sentence pins affected by the Step 2 refactor)