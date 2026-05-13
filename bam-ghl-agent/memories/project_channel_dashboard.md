---
name: Channel Dashboard (basketball acquisition test)
description: Internal-only dashboard tracking the 6-week basketball channel test (May 2026). Answers 3 questions — is the channel working / are we on track to kill basketball / where's the funnel breaking. Locked to Cole/Mike/Zoran.
type: project
---

## Why it exists

Six-week test on the new offer stack (SS Full / SS Partner / SS Core downsell) using paid Meta ads as acquisition channel. Dashboard exists so the three of us see results in real time and **pre-commit to decision rules at Day 42** instead of relitigating strategy every week.

## Who has access (allowlist)

Hardcoded in two places — keep in sync:

- `src/services/channelService.js` → `ALLOWLIST`
- `src/App.jsx` → `CHANNEL_ALLOWLIST`
- `supabase/bam_channel_schema.sql` → `is_channel_viewer()` function
- `api/stripe/overview.js` → `CHANNEL_ALLOWLIST`

Emails: `zoran@byanymeansbball.com`, `mike@byanymeansbball.com`, `coleman@byanymeansbball.com`

Anyone else who hits the Channel nav item just gets a "No access" message; the nav tile only renders for allowlisted users anyway.

## Data model

### `bam_channel_settings` (singleton, id=1)
All thresholds, kill criteria, scenario assumptions, SKU classification patterns, and campaign start date. **Defaults are seeded** — change them via Supabase SQL editor or future settings UI.

Default `campaign_start_date` is `2026-05-08`. Test window = 42 days.

### `bam_channel_snapshots` (one row per day)
Denormalized. Two ingest paths:
- **Stripe auto** (`ingested_by='stripe-auto'`) — pulled by `POST /api/stripe/overview?section=channel-ingest`. Fills active counts, MRR, new-close mix, classifies subs into Full/Partner/Core by `sku_*_pattern` matching, falls back to amount band ($1200+/$600+/$300+).
- **Manual** (`ingested_by='manual'`) — funnel data (ad spend, leads, booked, showed, closed, new MRR). Edited from the dashboard via the "Edit funnel" modal until Meta API ingest lands.

`daily_ratio` is a **generated column** = `new_mrr_60d / ad_spend_60d`.

`consecutive_days_above_3to1` and `consecutive_days_above_spend_threshold` are stored ints — must be incremented/reset by the ingest job (not yet wired; manual for now).

## API

Folded into `api/stripe/overview.js` to stay under Vercel Hobby's 12-function cap.

- `POST /api/stripe/overview?section=channel-ingest` — requires Bearer auth, verifies the caller is on the email allowlist, pulls Stripe, classifies, upserts today's snapshot.

All reads happen client-side via Supabase JS (RLS enforces allowlist).

## Flow

```
User opens Channel tab
  → fetchChannelSettings() + fetchLatestSnapshot() from Supabase
  → ChannelView renders 3 question cards, funnel, kill progress, trajectory chart
  → User clicks "Sync Stripe" → POST /api/stripe/overview?section=channel-ingest
  → Stripe data lands in today's snapshot row
  → User clicks "Edit funnel" → manual fields (ad spend, leads, etc.) into same row
  → Composite kill % + diagnosis + trajectory all recompute from snapshot
```

## Files

| File | Purpose |
|---|---|
| `bam-portal/supabase/bam_channel_schema.sql` | tables, RLS, `is_channel_viewer()` helper |
| `bam-portal/api/stripe/overview.js` | extended with `channel-ingest` section + SKU classifier |
| `bam-portal/src/services/channelService.js` | client-side fetch + all derived-metric helpers (diagnoseFunnel, computeKillProgress, projectTrajectory, estimateKillDate) |
| `bam-portal/src/views/ChannelView.jsx` | the view; matches the HTML spec, uses portal tokens + Recharts |
| `bam-portal/src/App.jsx` | nav item + route + allowlist gate |

## Funnel diagnosis (auto-computed)

`diagnoseFunnel()` returns the worst-performing stage relative to target across CPL / lead→book / show / close. Generates the "if X hit target, closes would be Y, MRR would be ~$Z" counterfactual using actual averages from the snapshot — **not hardcoded**.

## Trajectory scenarios

`projectTrajectory(key, settings, snapshot)` → 13-month MRR array. Scenarios hardcoded in `bam_channel_settings.scenarios`:
- Bear: $1.50:1 @ $2K/mo
- Base: $3:1 @ $5K/mo
- Bull: $5:1 @ $15K/mo

Adds channel MRR (monthly_ad_spend × ratio) per month on top of starting MRR. Partner growth-share ramp linear 0 → $300 (m6) → $600 (m12).

## Deferred TODOs (in code as comments)

- Slack alerts when ratio drops below threshold
- Week-over-week delta view
- Per-client drill-down
- Email digests
- Meta Ads API ingest (Zoran handling tomorrow)
- GHL ingest for booked/showed/closed (need field names from Mike)
- Sustained-day counter cron (currently the int columns are static)

## Gotchas

- **Function cap**: we're at exactly 12 Vercel functions. Don't add a new `api/channel.js` — fold into `stripe/overview.js`.
- **SKU classification fallback** uses monthly amount bands. If a sub has product/price names that don't match the patterns AND falls in the wrong amount band, it gets misclassified. Update `sku_*_pattern` in `bam_channel_settings` to fix.
- **Date math**: Day counter uses `new Date(campaign_start_date)` — make sure the DB date is YYYY-MM-DD format so it parses as UTC midnight.
