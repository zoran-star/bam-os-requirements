# REMEDIATION PLAN - five scoped steps, nothing that held gets re-planned

**Working directory:** `/Users/zoransavic/bam-os-requirements/.claude/worktrees/mike-sandu-scheduled-messages-3862a6/bam-ghl-agent/bam-portal`

Global rules unchanged: run all five gates after every step (`node --test api/_workbook.test.mjs`, `node --test api/_workbook-apply.test.mjs`, `node scripts/verify-workbook-contract.mjs`, `api/_term-vocab.test.mjs`, `api/_billing-cadence.test.mjs` - baseline 180/173/161 green); restart the local API harness after every `api/` change by killing the PORT LISTENER (`lsof -ti tcp:<PORT> | xargs kill`), never `pkill`; no em dashes in any owner- or staff-facing copy; every control is a ONE-LINE mutation that PRINTS what it caught; after each step, re-measure every `MUTATE=` you added or moved and update the measured-catch-counts header block of the file that hosts it. No production contact.

---

## Step R1 - Pin `tAgeStrOrEmpty` (the tester's worst finding)

**Files:** `api/_workbook-apply.test.mjs` (assertions), `api/workbook.js` (control target only - no behavior change).

The translator at `api/workbook.js:1395` refuses correctly today but nothing pins it: replacing its body with `return tOk(String(v))` passes all gates. Add a table-driven case set driven through the REAL handler (save the value on a plan card's `age_min`, then assert on review's `translation_error` / apply's refusal - the same surfaces staff read):

- MUST REFUSE, one assertion each, each printing the value and the refusal sentence it got: `"12; drop table"` (injection shape), `-3` (negative), `4.5` (fraction), `"٩"` (unicode digit), `"0"` (below range), `"100"` (above range), `" 9"` (padded - a value nobody typed must not silently normalise), `true` (boolean).
- MUST ACCEPT, printing the stored value: `"012"` -> `will_write === "12"` (normalisation pinned as deliberate, not accidental); range is 1-99 per Step 12 spec, so `"99"` accepts and `"100"` refuses - assert both edges plus `"1"`; `""` -> ok, writes nothing; `min === max` (`"9"`/`"9"`) -> passes confirm and apply.

**Control:** `MUTATE=agesanythinggoes` - ONE line: the body of `tAgeStrOrEmpty` becomes `return tOk(String(v));`. Must trip every MUST-REFUSE assertion (expect 8+); record the count in the header block. (`MUTATE=agesunknownfield` stays as-is; it covers a different line.)

**Gate:** `_workbook-apply.test.mjs`.

---

## Step R2 - Repair the broken `MUTATE=vocabdrift` control

**Files:** `api/_workbook-apply.test.mjs`.

The control errors with "pinned to text that is no longer in api/workbook.js" because Step 12's blank-age skip landed inside its pinned anchor (`api/workbook.js:1940-1950`). Do NOT change `api/workbook.js`. Re-point the pin: copy the CURRENT source lines into the control's anchor text, keeping the mutation itself one line (the same vocabulary-drift line it always patched; if the pin spans the moved region, split so exactly one line moves and the anchor line is reproduced unchanged - the repo's established multi-line-pin rule). Then: run `MUTATE=vocabdrift`, confirm it TRIPS (prints failures, exits 1) rather than erroring; run it unmutated green; update the header's measured count for it. A control that errors instead of failing is a decorative control, which is the exact thing the header block exists to prevent.

**Gate:** `_workbook-apply.test.mjs` (unmutated green + vocabdrift trips).

---

## Step R3 - Pin multi-page Stripe pagination in the dry run

**Files:** `api/_workbook-apply.test.mjs` and `scripts/verify-workbook-contract.mjs` (fixture routers), `api/workbook.js:2453` (control target only).

`page < 10 -> page < 1` survives all gates because the fixture serves one page; in production that regression reports `exists: false` past price #100 and the mint duplicates real prices. In BOTH harnesses' `api.stripe.com` GET branch, make `/v1/prices` paginated: page 1 = 100 filler prices (amounts matching no target) with `has_more: true` and a last-id cursor; page 2 (served only when the request carries `starting_after=<that id>`) = the existing fixture hits. Assertions, printing what they saw: (1) at least one target whose Stripe twin now lives on page 2 reports `stripe.exists === true` with its `price_id`; (2) the harness records that a request with `starting_after` actually arrived (assert on the recorded request list, printed) - so the pin is on the READ pattern, not just the result; (3) `exists_in_stripe` count unchanged from before this step (the fillers matched nothing).

**Control:** `MUTATE=onepagestripe` - ONE line at `api/workbook.js:2453`: `page < 10` -> `page < 1`. Must trip assertions (1) and (2). Record the count. Keep the non-GET "STRIPE WAS WRITTEN TO" throw untouched.

**Gate:** `_workbook-apply.test.mjs` + contract script.

---

## Step R4 - Bound discount `duration_months` to 1-24

**Files:** `api/workbook.js` (`CODE_T`), `public/workbook.html` (`:~1350`), `api/_workbook-apply.test.mjs`, `scripts/verify-workbook-contract.mjs`.

Decision: bound it 1-24, consistent with `TERM_MAX_MONTHS = 24` from the adjustable-prepay vocabulary work - a code that outlives the longest commitment this build can sell is a claim about billing months that cannot exist, and `0` months is not "a set number of months". Change `CODE_T.duration_months` from `tIntOrNull` to a new `tMonths1to24`: `null`/`""` -> `tOk(null)`; integer (number or numeric string) 1-24 -> `tOk(n)`; else refuse with: `a set number of months must be a whole number from 1 to 24, the longest commitment this build can sell: <value>`. Page: the months input gains `min="1" max="24"` and the inline hint `1 to 24 months` next to it (no em dash). No confirm-gate block; the translator refusal is the enforcement and it prints in review and apply.

**Tests:** `_workbook-apply.test.mjs`: `0` and `25` refuse (sentence printed), `24` and `1` accept, blank stays `null`. Contract script: type `25` on the real page, `check` review's `translation_error` carries the sentence and apply refuses the workbook (printed).

**Control:** `MUTATE=monthsunbounded` - ONE line: the `CODE_T.duration_months` entry back to `tIntOrNull`. Must trip the 0/25 assertions. Record the count.

**Gate:** `_workbook-apply.test.mjs` + contract script + `_term-vocab.test.mjs` (untouched, prove it).

---

## Step R5 - Trim the seed's class-twin values

**Files:** `scripts/seed-sj-age-rows.mjs` (`:97-98`), `api/_workbook.test.mjs`.

A padded class value (`"9 "`) currently seeds a padded `proposed`; the owner confirming unedited materialises it as `answered`, and R1's translator then rightly refuses `" 9"` at apply - a refusal manufactured by our own seed. Fix at the seed: wrap both reads as `v == null ? null : String(v).trim()`, and treat a value that trims to `""` as `null` (no proposal, matching the prefill-is-a-claim rule). Structure the mapping as an exported pure function `proposedFromClass(cls)` (guard the script's main with an `import.meta.url` check so importing it runs nothing). Add to `_workbook.test.mjs`: `proposedFromClass({ age_min: "9 ", age_max: " 12" })` yields `{ age_min: "9", age_max: "12" }` (printed), and the round-trip assertion that closes the loop with R1: every value the seed can propose passes `tAgeStrOrEmpty` - i.e. a seeded proposal can never refuse its own apply.

**Control:** `MUTATE=seeduntrimmed` - ONE line: drop the `.trim()`. Must trip both assertions. Record the count.

**Gate:** `_workbook.test.mjs`. No production contact: the seed script is not run anywhere in this step; only its exported mapper is tested.

---

**Finish:** run all five gates unmutated, record the new totals (they will exceed 180/173/161), then run every `MUTATE` name in both test files and the contract script end to end, confirm each prints failures and exits 1, and update both measured-count header blocks in the same commit as the step that moved them.
