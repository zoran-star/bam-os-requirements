# BUILD: Add a one-time sign-up fee to the pricing wizard

You are picking up a scoped build in the **bam-os-requirements** repo, portal app at
`bam-ghl-agent/bam-portal/`. Supabase project: `jnojmfmpnsfmtqmwhopz` (Supabase MCP).
Surfaced during BAM San Jose's V2 onboarding.

## ⛔ Read this first
Owner onboarding lives in **one** place: the paged wizard in
`bam-portal/public/client-portal.html` (the `_obf*` functions, `_OBF_STEPS` +
`_OBF_SECTIONS`). Do not build this anywhere else. See `bam-ghl-agent/CLAUDE.md`.

## The problem

Academies commonly charge a **one-time sign-up / registration fee**, often waived on
longer commitments. The pricing intake has no way to express that.

Real case - BAM San Jose (`client_id 5576acf0-acd3-4c05-9f9f-ebfde8618154`) charges
**$40 sign-up, on the 1-month commitment only, waived on the 3-month and 6-month**:

| Tier | 1-Month | 3-Month | 6-Month |
|---|---|---|---|
| 1 training/wk | $175 + $40 signup | $425 | $875 |
| 2 trainings/wk | $250 + $40 signup | $599 | $1150 |
| Unlimited | $300 + $40 signup | $749 | $1399 |

Today the only place to put it is `added_fees` (a free-text field on `pricing_offerings`,
hinted as `"+13% HST"` or `"$25"`) with `added_fees_description`. That field is
semantically a **recurring surcharge on every billing cycle**. Stuffing a one-time fee in
there means checkout, Stripe price matching, and the generated agreement cannot tell the
two apart - so a $40 one-time fee risks being modeled as $40 every 4 weeks.

Note the Stripe side already understands one-time prices (`is_one_time` /
`one_time` interval, e.g. `client-portal.html` ~lines 43232, 36099). **The gap is on the
intake side only.**

## What to build

1. Add to the `pricing_offerings` block builder (`client-portal.html` ~line 29680):
   - `signup_fee` (type `currency`) - "One-time sign-up fee"
   - `signup_fee_description` (type `text`) - what it covers
   - a way to express **waiver by commitment**. Simplest that fits the existing shape:
     a `signup_fee_waived` checkbox on each entry in the nested `commitments`
     block builder (~line 29707), defaulting to waived, since that is the common pattern.
2. Flow it to checkout as a **one-time Stripe price** alongside the recurring one, and
   only when the chosen commitment does not waive it.
3. Surface it in the price-matching / sorter UI so staff can see a one-time fee is expected.
4. Make sure the generated agreement and any pricing copy render it as one-time, not recurring.

## Acceptance criteria
- An owner can enter "$40 one-time sign-up fee, waived on 3-month and 6-month" without
  free-text hacks.
- Checkout on a 1-month commitment charges $40 once plus the recurring price; checkout on
  a 3-month or 6-month charges no sign-up fee.
- The fee never appears as a recurring line item anywhere.
- Existing offers with no sign-up fee are completely unaffected.

## Relevant files
- `bam-portal/public/client-portal.html`
  - `pricing_offerings` block builder ~line 29680 (subFields, `added_fees`, nested
    `commitments` builder ~line 29707)
  - one-time price handling ~lines 36099, 43232 (`is_one_time`)
  - wizard registry: `_OBF_STEPS` (~line 17613 for the `pricing` step) + `_OBF_SECTIONS`
- `api/offers/setup-status.js` - staff-side status backend
- Spec to update in the SAME commit: `bam-ghl-agent/docs/onboarding-wizard-spec.md`,
  `bam-ghl-agent/memories/project_offer_architecture.md`

## Ground rules
- A wizard step renders only if its key is in **both** `_OBF_STEPS` and a section's `keys`
  in `_OBF_SECTIONS`. This is a known trap - check both.
- After any UI edit to `client-portal.html`, run:
  `node bam-portal/scripts/verify-client-portal-ui.mjs`
- V2 design system is mandatory: read `bam-portal/design-system/DESIGN.md` first. One gold
  `var(--gold)`. **No emojis in product UI.**
- **Never use an em dash** in any output, code comment, or UI copy. Hyphens only.
- Work in a **git worktree** (`scripts/wt <name>`).
- Do not change V1 behavior - gate to V1.5/V2 (see `bam-ghl-agent/CLAUDE.md` hard rule).
- Commit and push with a descriptive message when done.

## First step
Confirm the field shape you plan to add (especially how the per-commitment waiver is
modeled) before implementing.
