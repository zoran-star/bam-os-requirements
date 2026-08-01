# SJ Contact Link-Up: result (2026-08-01)

Room: SJ CONTACT LINK-UP. Completed OFFLINE from MM II's customer snapshot
(`docs/workbook/sj-stripe-customers-2026-08-01.json`, all 147 customers) because the
direct-key transport (PR #1703) was not yet deployed. All decisions follow the locked
rules C1-C4; everything is idempotent under the real sweep.

## Final tally: 147 of 147 accounted for

| Outcome | Count | How |
|---|---|---|
| Linked, roster pre-link | 20 | Live members, exact email (C2), from `sj-roster-2026-07-31.json` |
| Linked, exact email | 113 | C2 single-match, offline run in sweep order |
| Linked, minted contact | 3 | No portal match; minted via `resolveOrMintPortalContact`, source='stripe-import' (Jaycob Amistoso, hailin xu, jordan rivera) |
| Linked, review decision | 6 | Phone matches confirmed by Zoran (Darren Yasutake, Mayank Agrawal, Rodel Baldoz + 3 anonymous POS-style customers to david/van/chu contacts) |
| Skipped, review decision | 5 | ALL duplicate Stripe customers of already-linked people: Nancy Nguyen yahooo-typo (cus_Sb8QIQy6K2jSEy), Eric Rebugio 2nd (cus_SXKhV8zvXOSolC), BAM Mike 2nd (cus_SZqcgs3dd2oOta), Fernandez household 2nd (cus_So4zfIMSHmPecC), Basu +82-phone anon (cus_U5XEnrx8JwrvP8) |

DB state (verified directly, not from script output): 559 contacts for SJ,
142 with stripe_customer_id (142 distinct), stripe_link_reviews 6 linked + 5 skipped +
0 pending. Audit rows in member_audit_log: action_type='stripe-contact-prelink' x2.

## Prep work that made it possible

- `scripts/refresh-portal-contacts.mjs` (PR #1704): SJ's portal contacts were a stale
  Jun 30 one-off (v2 academies get NO cron contact sync - the mirror is v15-gated).
  Refresh applied 2026-08-01: 555 GHL contacts, 20 new July leads, store at 556 before
  minting. Re-run it before the live sweep if days pass.
- PR #1704 also fixes silent PGRST102 batch loss in `bulkUpsertPortalContacts`
  (production bug, hits the v15 cron dual-write; merge-soon flagged by MM II).

## For the workbook / member-seeding chat

- Every one of the 20 live members has a linked portal contact (join key:
  `contacts.stripe_customer_id` -> `ghl_contact_id` is the system-wide contact key).
- The 5 skips are safe: each person's PRIMARY customer is linked; the skipped ids are
  their duplicate/typo/anon second customers. If payment history from a skipped id
  matters, resolve via the linked person's contact.
- Merge-tool candidates spotted (C4, not blocking): thin contact "basu"
  (ghl_contact_id fNQxE3ZcgbswMWlT77kj, dup of the Eshaan Basu household), and the
  Fernandez/Nolasco household shares one email across two people.
- "Test Customer" (cus_SL1q4jR8hWPCHu, elijahdeguzman23@gmail.com) email-linked to
  the contact "elijah deguzman". Lij's real self-customer (elijah@3dsportsprep.com)
  linked separately. Flag to Lij if he wants the test customer ignored instead.

## What remains for transport day (MM II sends the go)

1. Save Lij's write key (fills stripe_connect_account_id, flips status to connected).
2. Re-run `refresh-portal-contacts.mjs --apply` if the offline run is more than a few
   days old.
3. Run the REAL sweep in the Stripe Link-Up view: expected result is scanned=147+,
   already_linked=142, review_existing=5, plus whatever customers Stripe minted since
   2026-08-01. Anything new follows C2-C4 as normal. That run is the production proof;
   this file records the offline run it verifies against.
