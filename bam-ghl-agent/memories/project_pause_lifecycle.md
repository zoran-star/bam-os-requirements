---
name: Pause lifecycle — actionPause + cron + scheduled pauses
description: 2026-05-30. Member pause is a single mode (start_date + end_date). Pause length is always added to the natural next-charge date. Future-scheduled pauses are queued and activated by an hourly cron that also auto-recovers paused members when end_date passes.
metadata:
  type: project
---

# Pause Lifecycle

The single source of truth for how Pause works on the Members tab.

## API contract — actionPause

**Endpoint:** `POST /api/members?id=<member_id>&action=pause`

**Body:** `{ start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD", reason? }`

**No other modes.** No `weeks`, no `until`, no `indefinite` — all collapsed into start_date + end_date.

### The formula

```
pause_length    = end_date − start_date     (seconds)
trial_end       = max(now, current_period_end) + pause_length
                  capped at now + 729 days  (Stripe's hard limit)
resume_date     = unixToDateStr(trial_end)
```

The trial_end represents the next-charge date in Stripe. Because we anchor on `max(now, current_period_end)`, the pause length is **always** added to whatever the next natural charge would have been — never pulling it in.

### Immediate vs future-scheduled

| `start_date` is... | Behavior |
|---|---|
| ≤ today + 1 day | **Immediate.** Stripe trial_end set right now. `members.status = 'paused'` immediately. `cancellations.activated_at = now`. |
| > today + 1 day | **Future-scheduled.** No Stripe call. cancellations row inserted with `activated_at = null`. `members.status` stays `live`. Cron activates it on `pause_start`. |

### Guard rails (rejected with 400)

- `member.status === 'payment_failed'` → "Fix the card via Payment Link first"
- `member.status === 'cancelling'` → "Member is being cancelled"
- `currentSub.status === 'past_due' || 'unpaid'` → "Fix the card first"
- `end_date <= start_date` → "end must be after start"
- `end_date <= now` → "end is in the past"
- Missing/malformed dates → "YYYY-MM-DD required"

### Re-pause (updating an existing pause)

Allowed. Old pause rows for the same member where `completed_at IS NULL` get
marked completed (with reason "superseded by pause update"), then a fresh
cancellations row is inserted. Frontend shows an "Update pause" confirm
dialog when the member is already paused.

## Schema additions

```sql
-- cancellations: lifecycle timestamps
ALTER TABLE public.cancellations
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN completed_at timestamptz;

CREATE INDEX idx_cancellations_pending_pause
  ON public.cancellations (pause_start)
  WHERE type = 'pause' AND activated_at IS NULL;

CREATE INDEX idx_cancellations_active_pause
  ON public.cancellations (pause_end)
  WHERE type = 'pause' AND activated_at IS NOT NULL AND completed_at IS NULL;

-- members: denormalized "future pause queued" date for cheap pill render
ALTER TABLE public.members
  ADD COLUMN pause_scheduled_for date;

CREATE INDEX idx_members_pause_scheduled_for
  ON public.members (pause_scheduled_for)
  WHERE pause_scheduled_for IS NOT NULL;
```

`members.pause_scheduled_for` is set by `actionPause` when a future-dated
pause is queued, cleared by cron Phase A (activation), `actionUnpause`,
and `actionCancel`. Frontend uses it to render a "🕐 Pause queued · DATE"
secondary pill without joining `cancellations` on every list render.

Pause row lifecycle states (derived):

| State | Condition |
|---|---|
| Pending | `activated_at IS NULL` (future-scheduled, not yet started) |
| Active | `activated_at IS NOT NULL AND completed_at IS NULL` |
| Completed | `completed_at IS NOT NULL` |

## The cron — `cron-process-scheduled-pauses`

**Schedule:** every hour at :15 (`15 * * * *`)
**Path:** `/api/members?action=cron-process-scheduled-pauses`
**Auth:** `Authorization: Bearer ${CRON_SECRET}` (same shared secret as the
invite-resend cron — already set in Vercel env). Comparison uses
`timingSafeEqual` to avoid timing leaks.

### Concurrency safety

Both phases use a **claim-first conditional PATCH** pattern: each row's
update is gated by a filter on the lifecycle column being `IS NULL`. If
two cron invocations race, only one PATCH returns a row — the other gets
an empty result and skips its post-claim work (member status flip, audit).

Every Stripe call uses an `Idempotency-Key` derived from `cancellations.id`
(`pause-activate-<row.id>`), so even if both runs reach the Stripe call,
Stripe collapses them into a single effect.

The endpoint returns **HTTP 500** when any row fails (so Vercel cron logs
surface the failure). On success, returns 200 with counters.

### Phase A — Activate

Finds rows where:
- `type = 'pause'`
- `activated_at IS NULL`
- `pause_start <= today`

For each: load member + connected account → fetch Stripe sub → compute
trial_end using the standard formula → PATCH Stripe → flip
`members.status = 'paused'` → set `activated_at = now`. Writes a
`cron-pause-activated` audit row.

If the member or sub is missing, the row is short-circuited
(`activated_at = completed_at = now`, reason = "skipped").

### Phase B — Complete

Finds rows where:
- `type = 'pause'`
- `activated_at IS NOT NULL`
- `completed_at IS NULL`
- `pause_end <= today`

For each: load member → only if `status === 'paused'`, flip to `'live'`
(safety against overriding `cancelling` or `payment_failed`) → set
`completed_at = now`. Writes a `cron-pause-completed` audit row.

This closes the previous gap where `members.status` stayed `paused` past
the user's intended end date because Stripe's invoice didn't fire until
the trial_end.

## Important: trial_end ≠ pause_end

The user's `pause_end` is **when the academy should let them train again**.
The Stripe `trial_end` is **when the next bill happens**.

These are usually different:
- pause_end = Jan 22 (user input)
- trial_end = Feb 12 (Feb 5 next-charge + 7 days pause length)

`members.status` flips back to `live` on **pause_end** (via cron Phase B).
Billing resumes on **trial_end** (Stripe charges automatically).

## Edge case decisions

| Case | Decision |
|---|---|
| Past-due sub | Reject — fix card first |
| Payment-failed member | Reject — fix card first |
| Cancelling member | Reject — un-cancel first |
| Already-paused (re-pause) | Allow, mark old row completed, insert new row |
| Pause > 730 days | Cap at 729 days, return `capped_to_stripe_max: true` |
| `end_date` in past | Reject |
| Plan change during pause | Allowed — new price kicks in at trial_end |
| Cancel during pause | Allowed — webhook deletes member at sub close |
| Stripe-Dashboard cancellation during pause | Handled by `subscription.deleted` webhook |

## Frontend (client-portal.html)

`mPause(memberId)` reads from `_MEMBERS_ALL` to detect re-pauses:
- If member is already `paused`, shows `confirm('Update the pause window?')` and the prompts say "Update pause —" instead of "Pause —"
- Three prompts: start_date (default = today), end_date, reason (optional)
- Returns a toast that includes scheduled flag, cap warning, and resume_date if available

## When to update this note

- Any new column on `cancellations` related to pause lifecycle
- Any change to the cron schedule or auth
- Any new pause mode or rejection rule in `actionPause`
- Any change to the recovery condition in Phase B
