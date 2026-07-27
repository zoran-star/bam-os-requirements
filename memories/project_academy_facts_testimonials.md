# Academy parent-facing facts + testimonials table

Built 2026-07-27. Migration **written, NOT applied**:
`bam-ghl-agent/bam-portal/supabase/migrations/20260727140000_academy_public_facts_and_testimonials.sql`

## What was added

| Field | Where the owner fills it | What happens when empty |
|---|---|---|
| `clients.public_name` | Business Basics > **Name parents see** | Falls back to `business_name`. Nothing breaks. |
| `clients.community_group_url` + `community_group_platform` | Training offer > Onboarding > **Community group** | The whole "join the group" line disappears from the message. |
| `clients.google_review_url` | Training offer > Onboarding > **Google review link** | No button at all. Not a disabled one. |
| `public.testimonials` | (no UI yet) | No rows means no quote block and no testimonials email. |

## The rules that must not be broken

- **`business_name` is INTERNAL** ("BAM GTA"). `public_name` is what parents see.
  `{{location.name}}` renders `public_name || business_name` via `clientVars` in
  `api/email-shells.js`. Any new server query that feeds `clientVars` **must select
  `public_name`** or messages silently revert to the internal label.
- **No fact, no output.** `dropEmptyLinkMentions` (was `dropWebsiteMentions`) covers
  every link token; `dropEmptyShellLinks` removes a whole gold CTA table when its href
  came out empty. Never a placeholder, empty anchor, dead link, or dangling lead-in.
- **`testimonials` is seeded for NOBODY.** Presetting a new academy with quotes is how
  one academy previously shipped another's testimonials with the names swapped and an
  invented 5.0 rating. Empty is correct.
- **ONE table for manual quotes AND Google reviews.** Do not create a `google_reviews`
  table. `source` ('manual' | 'google') splits them.
- **An academy CANNOT write its own Google reviews.** Manual rows are fully theirs.
  Google rows are service-role written, read-only to the academy **except `starred`**.
  Enforced in two places: `testimonials_academy_insert` / `testimonials_academy_delete`
  PIN `source = 'manual'` (kept as separate policies from the staff ones so the pin is
  legible, not buried in an `is_staff() OR ...`), and the `testimonials_guard_source`
  trigger (before insert or update, NOT `security definer` so it sees the real
  `current_user`) blocks any column but `starred` changing on a google row and blocks
  relabelling a manual row as google. A policy alone cannot do the column-level half:
  it sees the old row or the new one, never both. Do not move this into application
  code - the application is exactly what is not trusted here.
- **Zero rows and rows-but-none-starred are DIFFERENT.** Zero rows = we never asked
  (onboarding step incomplete). Rows but none starred = they answered and featured none
  (step done). Both mean "don't send the testimonials email", but never collapse them
  into one empty result via a view or helper.
- **A TYPED QUOTE CARRIES NO REVIEW EVIDENCE, enforced by the trigger.** A non-staff
  caller cannot set `rating`, `external_id`, `review_created_at` or `synced_at` on a
  manual row - not on insert (must be null), not on update (must be unchanged). Pinning
  `source` alone only locked the LABEL: `source='manual', rating=5` with a forged
  external_id was a fully reachable fabricated 5.0. A typed quote never wears a star
  rating, never wears a "Google review" badge or date, never moves the aggregate.
- **NEVER write `testimonials` from a `SECURITY DEFINER` function.** The guard trusts
  `current_user`, which inside a postgres-owned definer function IS postgres - so such an
  RPC bypasses both the trigger AND RLS, and an academy calling it could write
  `source='google', rating=5`. This repo writes SECURITY DEFINER RPCs by habit
  (`update_client_basics`), so watch for it. Use RLS, or SECURITY INVOKER.
- **Curation is rating-first, not newest-first.** Order:
  `(client_id, starred desc, rating desc nulls last, review_created_at desc)`.
  Below 4 stars never displays outside the owner's own card - that is a RENDER rule, the
  owner must still see bad reviews. `rating` is null for manual quotes and must never be
  rendered as if it had one.
- **`review_created_at` is when the PARENT left the review; `created_at` is when we wrote
  the row.** Never use `created_at` for a displayed review date - a first sync would stamp
  every historical review as arriving today. `synced_at` reconciles upstream edits/deletes.
- **Not** `onboarding_feedback.testimonial` - that is the academy OWNER reviewing BAM's
  onboarding. Opposite direction. Do not join them.
- Community **platform is a normalized key** (`whatsapp`/`facebook`/…), never a display
  label. The word is rendered in code (`COMMUNITY_PLATFORMS` in `email-shells.js`,
  `_BB_COMMUNITY_PLATFORMS` in `client-portal.html`).

## Not done in this build

- GTA testimonials NOT seeded. The three quotes on the live site
  (`bam-client-sites/clients/bam-gta/gta/components.jsx` `TST` and `freetrial.jsx`
  `FT_TST`) exist in two different wordings, carry invented-looking dates and a
  hardcoded "5.0 average across Google reviews". They could not be confirmed as real
  sourced parent quotes, so nothing was seeded. Zoran to supply the real ones.
- The vendored email templates still hardcode GTA's WhatsApp and Google review links.
  Swapping them to `{{location.community_link}}` / `{{location.review_link}}` belongs
  to the onboarding email re-shell + automation seeding items.
- No testimonials UI yet (the table feeds free-trial page cards later).
