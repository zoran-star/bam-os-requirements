---
name: testimonials
description: Collect an academy's own Google review link, rating and real parent quotes into the testimonials store. Run early in onboarding (the branding deck asks; the sales system and core site read). Use when setting up a new academy's social proof, when an academy says it has reviews, or when a testimonials email or free-trial reviews section is empty and should not be.
---

# Testimonials

Collect an academy's **own** social proof into the store that every other surface reads.

The branding deck skill asks for this. The core site build and the sales system build read it. Run it as early as possible in onboarding: **the review link is needed by the core website**, not just the emails, so asking late blocks the site.

## The one rule everything here serves

**An academy shows its own proof or it shows nothing.** No borrowed quotes, no invented names, no rating that nobody can check. An empty store is a correct, finished outcome, not a gap to fill.

This exists because it already went wrong. DETAIL Miami's free-trial page carries three quotes badged "Google review" with five stars and dates. They are BAM GTA's three, rewritten with Miami names and cities. Nothing in the system stopped it.

## What you collect, in this order

Ask for the link first. It unblocks the most downstream work.

| # | Fact | Lands in | Why it is first |
|---|---|---|---|
| 1 | Google review link | `clients.google_review_url` | The core site's review CTA and the review-ask email both need it. Asking late blocks the website. |
| 2 | Star rating + review count | `clients` aggregate columns | One publicly checkable number. Staff read it off the owner's dashboard. |
| 3 | The review text itself | `testimonials` rows | The quotes that appear in emails and on the free-trial page. |

Any of the three can come back empty. Record what you have and stop; do not fill a gap with something adjacent.

## Where to read the reviews from

**Use the owner's own dashboard: Manage your Business Profile → Reviews.** It shows full text.

**Do not use the public Google Maps listing.** It truncates most reviews behind "See more", and that control cannot be expanded programmatically: script clicks, real clicks and dispatched events have all been tried and all failed. Only short reviews come through complete, so the public page silently gives you a biased sample of the shortest reviews.

If you only have public-page access, collect the rating and count, leave the quotes empty, and say so.

## Writing the quotes

Each quote is one row in `testimonials` with `source = 'manual'`, `client_id` set to that academy, and nothing else invented.

- **Quote text:** verbatim. Trim only leading/trailing whitespace. Do not tidy grammar, shorten, merge two reviews, or translate.
- **Author:** the display name as written, or a first name plus last initial if the owner asks to shorten it. **If you are not certain who said it, write `Parent`.** Never guess a name, never construct one from context.
- **`starred`:** the ones the academy wants leading. Ask; do not choose for them.
- **Everything else stays null.** `rating`, `review_created_at`, `external_id` and `synced_at` belong to synced reviews. The database will raise if you try, and that error is correct: a typed quote must never be able to pass as a verified one.

### Under 4 stars

Do not type in a review below 4 stars. The hierarchy hides those from every display surface anyway, so a typed one is invisible content that only makes the store misleading to read.

## The rating is a fact, not a decoration

Zoran's ruling, 2026-07-29: **quotes stay plain, the rating is real.**

A hand-copied quote is real but unverifiable, so it never wears stars, a "Google review" badge or a date. The aggregate is different in kind: it is one number, published by Google, and anyone can check it in five seconds. So the rating and count may display even while the quotes stay plain.

Enter them from the owner's dashboard, and enter them exactly. Do not average anything yourself, do not round, and do not carry a stale number forward: if you cannot see the current figure, leave it empty.

## The hierarchy you are feeding

Tier 1, locked, identical for every academy. You cannot reorder it per academy.

1. Pinned Google reviews
2. Pinned typed quotes
3. Remaining Google reviews, highest rating down
4. Remaining typed quotes, newest first

A pinned typed quote still sits behind a pinned real review. Under 4 stars never leaves the owner's card.

## When the store is empty

**Empty means the testimonials email does not ship at all.** It is not shortened, and there is no quote-free variant. This is enforced when the sales system is seeded, not when the email renders, so an academy whose quotes arrive later needs its sequence re-seeded to pick the step up.

Two empty states are different and must not be collapsed:

- **Zero rows** means we never asked.
- **Rows but none starred** means they gave us quotes and chose not to feature any.

Both stop the email. Only the first is a reason to go back to the academy.

## What you must not do

- Copy another academy's quotes, in any form, however edited. Attributed content never travels between academies.
- Write a `source = 'google'` row. Only the sync job does that, and the database enforces it.
- Put a rating, date or sync field on a typed row.
- Invent an author, a city, or a date.
- Seed a new academy with anything at all. A new academy starts empty and stays empty until it has its own.
- Treat a thin result as failure. An academy with two real quotes is in a better position than one with six borrowed ones.

## Finishing

Report what landed and what did not: the link, the rating and count, how many quotes, how many starred, and anything you deliberately left empty and why.

If quotes landed for an academy whose sales system is already seeded, say so explicitly. The testimonials step was dropped at seed time and will not appear until the sequence is re-seeded.
