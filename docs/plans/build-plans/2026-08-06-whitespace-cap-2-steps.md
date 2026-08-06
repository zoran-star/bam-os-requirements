Both findings verified against the current source (`looseCodesIn` at api/workbook.js:175-190 filters raw `Boolean`; `unrestrictedCodes` at api/offers/match-prices.js:303-309 same; `couponAppliesToKeys` at api/_coupon-guardrails.js trims and returns `null` = everything; the mint branch at api/workbook.js:730-767 has no cap and dedupes by exact `target_field` string, so `codes.00.applies_to` mints a twin of logical code 0; `classifyIndexed`'s `(\d+)` accepts leading zeros and `+m[1]` collapses them only for the bound check). One page fact the plan depends on, verified: **the real page can only emit canonical indexes** - `codeIndices` (public/workbook.html:622-626) does `s.add(+m[1])` on rows the API itself sent, and every codes `setA` builds its field as `'codes.'+i+'.'+f` from those numbers (workbook.html:1384, 1465, 1472-1475); `rungIndices` (line 617) is the same shape. Rejecting non-canonical indexes cannot break the page.

# Remediation plan: whitespace applies_to + uncapped mint

Paths relative to `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal`. Standing rules apply: kill the port listener (never pkill) after `api/` changes; no em dashes in person-facing copy; stub DB only; every check prints; controls are one-line with measured counts recorded in the header blocks.

---

## Step 1 (HIGH, Finding 1): one shared emptiness rule for applies_to, everywhere it is read

**Files:** `api/_coupon-guardrails.js`, `api/workbook.js`, `api/offers/match-prices.js`, `public/workbook.html`, plus the four gates that pin these files.

**Change 1a - the normalizer, extracted from the one reader that already gets it right.** `couponAppliesToKeys` already does trim-then-filter; hoist its body into a named export in `api/_coupon-guardrails.js` (a leaf module, no cycle risk - builder confirms with a grep of its imports before wiring):

```js
// The ONE definition of applies-to emptiness. `[" "]` and `["\t"]` are not a
// smaller discount: a key nobody can type into a chip restricts nothing.
const cleanAppliesTo = (v) =>
  (Array.isArray(v) ? v.map((k) => String(k == null ? "" : k).trim()).filter(Boolean) : []);
```

Rewire all three readers to it, none keeping a private copy:
- `couponAppliesToKeys` (same file) becomes `const keys = cleanAppliesTo(raw.applies_to); return keys.length ? keys : null;` - behavior identical, now definitionally shared.
- `looseCodesIn` (api/workbook.js:186): `const applies = cleanAppliesTo(c.applies_to);` - this makes the D3 confirm guard and the review warning refuse `[" "]`.
- `unrestrictedCodes` (api/offers/match-prices.js:307): `&& !cleanAppliesTo(c.applies_to).length` - this makes the fee withhold fire on `[" "]`.

Match the modules' existing import/export style (workbook.js already imports named exports from match-prices, per the comment at match-prices.js:327).

**Change 1b - canonicalize at the write.** `tStrArray` (api/workbook.js:1458) currently passes `[" "]` into the offer jsonb verbatim. Change it to translate to the cleaned list: `tOk(v.map(s => s.trim()).filter(Boolean))` (still refusing non-string entries with the existing sentence). Now review's `will_write` and the applied offer can never hold whitespace keys, so the three readers plus the stored value all agree. This is why refusing whitespace at the translator is NOT the chosen fix for emptiness overall: the confirm guard runs on `answered` values that were never translated, so the readers need the normalizer regardless; the translator change is depth, not the wall.

**Change 1c - the page guard agrees before the flush.** `confirmCard`'s codes check (public/workbook.html:897) tests `x.applies && x.applies.length`, so `[" "]` reads targeted on the page and the refusal would arrive only as the server's alert. Change the emptiness test to `!(x.applies||[]).some(k=>String(k).trim())` - sentence at line 898 stays byte-identical, and the server sentence stays its mirror.

**Change 1d - the whitespace-only code NAME, resolved as "no code", verified downstream.** Decision with the one-sentence justification: a lone `" "` is byte-reachable from the page's own code input (workbook.html:1404 uppercases but never trims, and `removeCode` semantics already render a whitespace name as removed), so refusing it at save would 400 the real page's autosave; instead every reader must agree a name that trims blank IS no code - which `looseCodesIn` (line 185), `unrestrictedCodes` (line 306) and the page (line 897 `String(x.code).trim()`) already do. What the builder must VERIFY and pin rather than assume: grep every consumer of `discount_codes[].code` on the coupon-mint path (`normalizeCoupon` and the iteration site that calls `stripeCouponBody`) and confirm a whitespace-only name is skipped before any Stripe body is built; if any site does not trim, add the trim filter at that site. Then pin it: a guardrails-gate assertion that a code named `"   "` with value 100 produces NO coupon body, printing what was skipped.

**Checks (all print what they caught):**
- `api/_workbook.test.mjs`, extend the codes-confirm-guard section (starts at line 1699): the tester's exact battery driven as a loop over `[[], [""], [" "], ["\t"], ""]` → confirm refuses 400 with the byte-identical sentence, each iteration printing the shape and the sentence; then `["  Academy 2x/week|monthly  "]` → confirms 200 (trim must not over-refuse a padded real key); then the whitespace-NAME case: code `"   "` with answered value content and empty applies_to → confirm 200 AND the review warnings list does NOT name it (it is no code), printed.
- Apply-side gate (`api/_workbook-apply.test.mjs`): offer fixture with `applies_to: [" "]` on a named code → `hasUnrestrictedDiscountCodes` true and the withheld_signup_fees entry fires, printing `because_codes`.
- Guardrails gate: `couponAppliesToKeys([" ", "\t"])` → `null` (everything, so the withhold above is what saves the fee - assert BOTH in one printed sentence so the pairing is the pinned claim), `couponAppliesToKeys(["a", " "])` → `["a"]`, `couponCoversKey` unchanged for real keys.
- Contract script: through the real page, inject `await type("codes","codes.0.applies_to",[" "])`, drive `page.confirmCard` → the PAGE guard now refuses before any network (captured alert === the server sentence for the same code, asserted byte-equal by also POSTing the confirm directly), card not confirmed, printed.
- **Control:** `MUTATE=blankkeysrestrict` - ONE line: `cleanAppliesTo`'s map/filter line reverts to `.filter(Boolean)` on the raw values. Because all three readers share the function, the single line must be caught from all three directions (confirm battery, withhold assertion, guardrails null assertion) plus the contract page check. Measure the count per gate and record it in each header block. The existing D3 control `MUTATE=serverconfirmsuntargeted` and the 1a rewiring touch the same region - re-run and re-measure every pre-existing control whose pinned text moved, re-pointing pins rather than deleting.

---

## Step 2 (MEDIUM, Finding 2): canonical indexes and a mint ceiling

**Files:** `api/workbook.js`, `api/_workbook.test.mjs`, `scripts/verify-workbook-contract.mjs`

**Change 2a - non-canonical indexes refuse in `classifyIndexed`** (api/workbook.js:1508-1518), after the own-property leaf check and before the bound check, so the two existing refusal sentences stay byte-identical and first in priority:

```js
if (String(index) !== m[1]) {
  return { kind: "unknown", why: `${JSON.stringify(m[0])} spells ${what} number ${index + 1} as ${JSON.stringify(m[1])} rather than ${JSON.stringify(String(index))}, and two spellings of one address are two rows for one answer` };
}
```

This closes the twin-mint hole at its root (`canMint` reuses `classifyField`, so `codes.00.applies_to` now 404s on the mint path with the unchanged "that answer does not belong to this card"), and it hardens review/apply for commitments the same way. `"200000"` round-trips, so the existing bound refusal still fires; `"0"`, `"1"` round-trip, so the real page (verified canonical above) is untouched.

**Change 2b - the mint ceiling, in the mint branch of `doSave`** (inside the `if (!row)` block after line 734, before the POST), with the ADD path's value cap applied at the same door:

```js
const MAX_MINT_ROWS_PER_CARD = 90;
if (mine.filter((a) => !isAddition(a)).length >= MAX_MINT_ROWS_PER_CARD) {
  throw bad("This card cannot take any more answers. Tell BAM directly and we will sort it out.");
}
if (JSON.stringify((item || {}).answered === undefined ? null : (item || {}).answered).length > MAX_ADD_CHARS) {
  throw bad("That is too long to add here. Please shorten it, or tell us the details directly.", 400, "add_too_long");
}
```

Why 90: the legitimate ceiling is codes on the card times the 9 `CODE_T` leaves. The ADD path already rules 6 additions per card the honest maximum, our largest real seed (San Jose) is 1 code at 5 rows, so 10 fully-answered codes (90 rows) is comfortably above any real card while sitting 20x below the ~1,800 rows the 200-index space would otherwise allow; counting `mine`'s non-addition rows (seeded plus minted) rather than a mint ledger keeps the bound recomputable from the DB alone. The size sentence reuses the ADD path's byte-for-byte (it is already em-dash-free and the page's D4 banner names the field regardless). Tax and plan mints are structurally bounded (1 and 2 fields) but sit under the same ceiling for free.

**Checks (all print):**
- `api/_workbook.test.mjs`, extend the mint sections (~1530-1697): (i) the tester's exact repro - null-id saves of `codes.0.applies_to`, `codes.00.applies_to`, `codes.000.applies_to` → first mints, other two refuse 404 byte-for-byte, and EXACTLY ONE row exists for logical code 0 afterward, printing the row count; (ii) one save call carrying 33 spelled-variant items refuses without minting 33 rows, printing before/after DB counts; (iii) the cap: seed a codes card to 89 non-addition rows, mint one more → 200, then the next → the cap sentence verbatim, DB count pinned at 90, printed; (iv) the size cap: a 2001-char answered value on a mintable field refuses with the ADD sentence verbatim; (v) the five pinned foreign-field refusals at lines 1686-1697 re-run UNCHANGED and green - extend that battery with `["codes", "codes.00.applies_to"]` and `["codes", "codes.01.code"]` rather than loosening anything.
- Contract script: (i) direct POST through the harness router of `codes.00.applies_to` → 404, printed; (ii) a positive pin that the REAL page's saves during the existing D1 mint section carried only canonical index strings - assert every `codes.*` target_field in the captured save payloads matches `/^codes\.(?:0|[1-9]\d*)\./`, printing the field list (this is the regression tripwire for change 2a against the page).
- **Controls, one line each:** `MUTATE=noncanonicalindex` - the new `String(index) !== m[1]` check becomes `if (false)` with the comment marker; must be caught by (i)/(ii) above and the contract 404. `MUTATE=mintuncapped` - the cap comparison becomes `>= Infinity`; caught by (iii). Measure both counts, record them in both harnesses' header blocks alongside the re-measured Step 1 counts, with the measurement date.

**Closeout:** all gates unmutated green with new totals recorded; full MUTATE sweep including the three new controls (`blankkeysrestrict`, `noncanonicalindex`, `mintuncapped`) and re-measured neighbors (`codesunmintable`, `codesmintany`, `serverconfirmsuntargeted`, `confirmuntargetedcode`); no production contact - the live SJ workbook needs nothing here (its one code's rows are canonical and its repair path is unchanged).

### Critical Files for Implementation
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/workbook.js (looseCodesIn ~175, canMint ~263, mint branch ~730, tStrArray ~1458, classifyIndexed ~1508)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/_coupon-guardrails.js (cleanAppliesTo home, couponAppliesToKeys, normalizeCoupon/stripeCouponBody trim verification)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/offers/match-prices.js (unrestrictedCodes ~303)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/public/workbook.html (confirmCard codes guard ~888-898, code input ~1404)
- /Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal/api/_workbook.test.mjs (mint + confirm-guard sections ~1530-1720, pinned refusals 1686-1697, control table)