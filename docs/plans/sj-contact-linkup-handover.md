# SJ CONTACT LINK-UP: final handover (room wound down 2026-08-01)

Room closed when Zoran consolidated the track into MEMBER MANAGEMENT II. Everything
below is committed on branch `claude/keen-banach-69618e`. Nothing here is lost, but
some of it is only written down HERE, so read this before assuming a file is
self-explanatory.

## 1. What is DONE and live in production

| Thing | State |
|---|---|
| SJ portal contact store refreshed from GHL | DONE, 559 contacts, verified in the DB |
| All 147 SJ Stripe customers resolved | DONE: 142 linked, 5 conscious skips, 0 pending reviews |
| Contact refresh CLI + PGRST102 bulk-write fix | MERGED + DEPLOYED (PR #1704) |

Detail: `docs/plans/sj-contact-linkup-result.md` (counts, the 5 skipped customer ids,
merge-tool candidates, transport-day checklist).
Skill material: `docs/plans/sj-contact-linkup-learnings.md` (the step-1 field report:
recipe, C1-C4 measured, 7 real edge cases, the offline-prelink pattern).

## 2. What is HALF-BUILT (the only unfinished thing)

`bam-ghl-agent/bam-portal/scripts/save-direct-key.mjs` + `api/_direct-key-cli.test.mjs`

Purpose: save a platform-locked academy's Stripe restricted key from a terminal
instead of the staff web panel, so future CoachIQ-style academies are a one-command
job. Imports `probeKey` + `saveDirectKey` from `api/stripe/direct-key.js`.

STATE: **built, self-tested, NOT adversarially tested.** Version 1 was adversarially
tested and FAILED on a live-key leak (section 4). The committed version is the rebuild
that addresses every finding: the strip, the shape guard, the flag-eating `--as` fix,
the `PORTAL_BASE_URL` + `CRON_SECRET` pre-checks, and the required production
read-back. Its own suite is green (93 assertions, 5 negative controls all firing) and
it was runtime-verified against fake endpoints, but the wind-down landed before a
SEPARATE tester could attack it, and this repo's house rule is builder/tester
separation. **Treat it as unproven until someone who did not write it tries to break
it.** Priority attacks: re-run the canary leak hunt against the rebuilt version, and
the read-back's three-outcome split.

Known-unsafe items the builder itself flagged and did not fix:
- Nothing verifies that `PORTAL_BASE_URL` points at PRODUCTION rather than a preview
  deployment. If it points at a preview, the read-back proves the preview, not prod.
  The URL is printed in the preflight, but a human has to read it.
- It could not be run end to end in the worktree (no `node_modules`), so the only
  live-fire exercise it has had is against fake endpoints.

Command shape (once verified):

    pbpaste | node scripts/save-direct-key.mjs --client <uuid> --pk pk_live_... --as "CLI: zoran" [--save]

Probe-only by default; `--save` commits. Secret is read from STDIN ONLY, never a flag.

## 3. TRAPS AND GOTCHAS NOT WRITTEN DOWN ANYWHERE ELSE

1. **Local env has none of the required secrets.** `CRON_SECRET`,
   `STRIPE_DIRECT_ENC_KEY`, `PORTAL_BASE_URL` are ABSENT from Zoran's
   `bam-portal/.env.local`. Pull them from Vercel PRODUCTION (`vercel env pull`),
   never hand-copy: a typo in the enc key is silent until a payment fails.
2. **`.env.local` values are quoted WITH a literal `\n` inside the quotes** (the classic
   `echo`-into-`vercel env add` artefact). Sourcing that file breaks; extract per-var
   and strip quotes and the trailing `\n`. This cost a debugging cycle already.
3. **The worktree has no `node_modules`.** These scripts transitively import
   `@sentry/node` and die on a bare `ERR_MODULE_NOT_FOUND` otherwise. Run from an
   installed `bam-portal` (or symlink node_modules and remove it after).
4. **Presence is not correctness for the enc key.** A local enc key that differs from
   production encrypts the academy's live key into a blob production cannot decrypt,
   while the CLI reports SAVED, and payments break silently later. A local
   encrypt-then-decrypt round trip PROVES NOTHING (both halves use the same possibly
   wrong key). The only real proof is a PRODUCTION READ-BACK after the save.
5. **The read-back surface is compromised on purpose.** `direct-key.js`'s `status`
   action needs a staff bearer token a CLI does not have, so the read-back uses
   `POST {PORTAL_BASE_URL}/api/stripe/cron-key-health` with `Bearer CRON_SECRET`.
   That endpoint has NO per-academy scope: it probes EVERY direct-key academy, stamps
   `key_last_verified_at` on each, and can self-heal an `invalid` row. Harmless at one
   academy, wrong at twenty. MM II has a scoped read-back queued.
6. **The "refused, nothing happened" invariant.** The CLI reports every error carrying
   `.status` as a refusal, which an operator reads as "nothing was written". That is
   only true while every `.status` throw in `saveDirectKey` happens BEFORE the first
   write. If a post-write failure ever gains a `.status`, the CLI will tell an operator
   nothing changed while a live credential sits in the table. Pinned by assertions on
   both sides of the contract; do not unpin.
7. **CI harvests negative-control names from test-file HEADER COMMENTS.** Deleting a
   control's code without deleting its `MUTATE=` line from the header makes CI go red
   with `NEGATIVE CONTROL FAILED`. Code and docs must change in the same edit.
8. **`pbpaste` leaves the live key in the macOS clipboard** after the run. Clear it.
9. **`saveDirectKey` carries no auth of its own** (the route's 401/403 lived outside
   it). Safe for a local CLI holding the service-role key; any future HTTP caller
   importing it inherits ZERO auth.

## 4. The leak the canary hunt found (fixed by MM II, commit ecd5894)

Piping a key containing an embedded newline/CR/NUL made Node/undici throw BEFORE any
response existed, with the ENTIRE header value (`Bearer <the whole key>`) in the
message. It carried no `.status`, so it reached the operator raw. The same `probeKey`
path is behind the STAFF WEB PANEL, which returned the live key in an HTTP response
body to the browser.

Two things worth carrying forward:

- **A regex scrub does not fix it.** The newline splits the key, so a key-shaped
  pattern stops at the break and leaves the tail on screen. Refuse by SHAPE
  (printable-ASCII only) before the value can ever become a header.
- **The false assurance was the real finding.** `_stripe-transport.js` claimed the key
  could never appear in any error property and cited a leak probe as proof. The probe
  only tested errors the transport CONSTRUCTS, never errors the runtime THROWS. The
  claim read true while being false. Whenever a comment cites a test as a guarantee,
  check what the test actually exercises.

## 5. What I was about to do next

1. Merge `ecd5894`, finish + re-test the CLI, hand MM II the diff.
2. SJ key save via the CLI, with the production read-back as a required step.
3. The verification sweep: expected `already_linked=142`, `review_existing=5`, plus
   only customers created after 2026-08-01. Then close out the result file.
4. Open item for a Lij call (via Zoran only): "Test Customer" `cus_SL1q4jR8hWPCHu`
   is email-linked to the contact "elijah deguzman"; it is now a rejectable row in the
   member workbook rather than a question.

## 6. The recommendation nobody has picked up yet

Zoran asked how to make the platform-locked path repeatable. The key save is the
SMALLEST part. What cost days on SJ was **discovering the account was locked at all**:
try Connect, fail, open a Stripe support ticket, wait. The highest-value unbuilt piece
is making that failure self-diagnose - when Stripe rejects the OAuth because another
platform controls the account, say so on screen ("locked by another platform, use the
key route") instead of leaving a human to investigate. Second is a fixed, operator-facing
permission recipe. Third is the rule this room proved twice: **verify capability, never
inherit a claim about it** - the "read-only key" belief was wrong and nearly cost an
unnecessary key mint, and the probe answered it in seconds.
