# Contact link-up learnings for SKILL 1 (from the completed SJ run)

Source: SJ CONTACT LINK-UP room, run completed 2026-08-01. This is the field report
for the skill's step 1 (stripe-to-contacts sync). Companion file with the raw counts
and skip ids: `docs/plans/sj-contact-linkup-result.md`.

## The step-1 recipe as it actually ran (SJ, 147 customers)

1. **Refresh the contact store FIRST, always.** v2 academies get NO ongoing contact
   sync: the sync cron's contact mirror is gated on `v15_access === true`, while
   `ghl_contacts_last_synced_at` keeps stamping - the freshness signal lies. SJ's
   store was a month stale; the refresh surfaced 20 July leads, one of which turned a
   would-be review case (Prakash) into a silent auto-link. Tool:
   `scripts/refresh-portal-contacts.mjs --client <id> [--apply]` (PR #1704), dry-run
   default, reuses the cron's own mapping (`ghlContactToMirrorRow`) so nothing forks.
2. **Classify before you write.** One read-only pass bucketed all 147: already-linked
   / email-single / email-conflict / email-multi / phone-match / no-match. Showing the
   academy operator the bucket counts BEFORE any write made the approval conversation
   trivial (Zoran approved in one popup).
3. **Then execute in sweep order with the locked rules.**

## C1-C4 as they played out

- **C1 (staff side)**: every judgment call went through Zoran; decisions carry his
  name in `stripe_link_reviews.decided_by`. No owner involvement needed for step 1.
- **C2 (exact-email single match links silently)**: carried 133 of 147 (20 roster +
  113 offline). Email is by far the dominant join key: 140/147 customers had one.
- **C3 (no match mints, source='stripe-import')**: only 3 of 147. Mint through
  `resolveOrMintPortalContact` - it re-checks email AND phone10 (household rule,
  athlete-mismatch block) before minting, so a "mint" can still resolve to a person
  the classifier missed.
- **C4 (duplicates to the merge tool)**: the review list is where duplicate STRIPE
  customers surface (see edge cases). Skip is a first-class outcome: 5 of 147 ended
  "consciously skipped", each a second customer id for an already-linked person.

## Edge cases the skill MUST expect (all real, all from one 147-customer academy)

| Case | Example | Correct handling |
|---|---|---|
| Typo-domain duplicate customer | nancyn08@yahoo.com AND nancyn08@yahooo.com, same phone | First links by email; second surfaces as phone-match review -> SKIP (dup customer, not a new person) |
| Second-parent household email | carolynn.glennf@gmail.com on two customers (Nolasco/Fernandez) | First claims the contact; second -> conflict review -> SKIP unless a real second contact exists |
| Same person, two email providers | charleskwwong@gmail.com + charleskwwong@yahoo.com | Different strings = two contacts if both exist in GHL; they linked separately. Merge-tool candidate, not a blocker |
| Anonymous POS-style customers | 4 customers, no name/email, phone only, created same week | Phone-match review; 3 linked to obvious household contacts on approval, 1 revealed itself as a dup (below) |
| Foreign-format phone dup | +825105180044 vs +15105180044 - same last-10 | phone10 matching catches it; the already-linked guard REFUSED the steal and exposed it as a dup customer -> SKIP |
| Owner's own rows | Lij appears as a customer; so does BAM's Mike | Link them like anyone; second Mike customer -> SKIP |
| Test customers | "Test Customer" cus_SL1q4jR8hWPCHu, elijahdeguzman23@gmail.com | Email-links to a real-looking contact. Queue a keep-or-unlink question for the owner (via MM II) |

## Patterns that belong IN the skill

- **Offline pre-link from a snapshot collapses go-live day.** With a customers
  snapshot ({customer_id, name, email, phone, created}), the whole link-up runs
  before the transport exists; the live sweep becomes a VERIFICATION pass with known
  expected numbers (SJ: already_linked=142, review_existing=5). Everything is
  idempotent under the real sweep by construction: same tables, same row shapes,
  same rules.
- **Never trust the success line - verify in the DB.** The first refresh --apply
  printed "upserted 555" while the table took 0 rows. Every phase of the SJ run ended
  with a direct SQL count, and that habit caught a production bug (next point).
- **The PGRST102 mixed-batch bug** (fixed in PR #1704, unmerged as of this writing):
  PostgREST rejects a bulk upsert whose rows do not share identical keys and rejects
  the WHOLE batch; `clean()` strips empty fields per row so mixed batches are the
  norm; `bulkUpsertPortalContacts` swallowed the error. Any skill code doing bulk
  contact writes must bucket rows by exact key set (the fixed helper now does) and
  check the returned posted-count.
- **Claim-then-review sequencing.** When two customers share one contact (email or
  phone), order matters: first claims, second must drop to review. A batch classifier
  OVERCOUNTS links because it cannot see intra-run claims - execute sequentially with
  fresh reads, or expect dry-run counts to differ from apply counts (SJ: 116 dry ->
  113 + 3 conflict reviews on apply, exactly the 3 shared-email pairs).
- **The already-linked guard is the dup detector.** Refusing to overwrite an existing
  `stripe_customer_id` is what surfaced every duplicate-customer case. The skill
  should treat a refused link as a SIGNAL (probable dup customer), not an error.
- **Env gotcha for CLI legs**: `.env.local` values can be quoted with a literal \n
  inside (the echo-into-env bug); extract per-var and strip, never `source` the file.

## Numbers for calibration (one mature academy, ~2.5 years of Stripe history)

147 customers -> 91% linked by exact email alone, 4% linked after human review, 2%
minted, 3% skipped as duplicate customers. Review burden on the operator: 11 rows,
2 popup decisions, under 5 minutes. Zero rows left pending.
