---
name: Feedback → Action system
description: Turning "Ask Zoran" feedback (portal_feedback) into shipped work with minimal founder activation energy. Phase 1 = daily AI-triaged Slack digest. End state = feedback auto-drafts PRs Zoran approves from his phone.
type: project
---

## Why

Feedback lands in the Feedback tab (`portal_feedback`) but stalls: acting on it
needs Zoran to (1) remember to check, (2) decide what to build, (3) context-shift
into building. Each step leaks days. The system flips it: **push to him,
pre-chewed, ready to approve.**

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Daily AI-triaged Slack digest of open feedback | **SHIPPED 2026-06-14** |
| 2 | One-tap "Build this" → kicks a Claude session → drafts a PR | planned |
| 3 | Auto-pilot: safe items auto-built → "Merge?" ping | planned |

## Phase 1 — how it works (shipped)

- Cron: `GET /api/clients?action=cron-feedback-digest` (vercel.json, **30 13 * * ***),
  auth = `Bearer CRON_SECRET`.
- `cronFeedbackDigest()` (in `api/clients.js`): pulls open feedback
  (`portal_feedback` where `resolved_at is null`, newest first, cap 15) →
  `triageFeedback()` makes ONE Claude call (`claude-haiku-4-5-20251001`) returning
  `{id → {effort S/M/L, action}}` → posts a scannable digest to
  `FEEDBACK_SLACK_CHANNEL` via `SLACK_BOT_TOKEN`.
- Degrades gracefully: no `ANTHROPIC_API_KEY` → digest still posts without
  suggestions; no Slack env → no-op (returns `posted:false`). Empty open list →
  no Slack (no nagging when clear).
- Nags daily until items are resolved (resolving = `resolved_at` set via the
  Feedback tab) — repetition is intentional so nothing rots.

### Env
- `CRON_SECRET` (Vercel cron auth — already used by other crons)
- `FEEDBACK_SLACK_CHANNEL` (channel id — reused from the per-submission notifier)
- `ANTHROPIC_API_KEY` (optional — enables the action/effort suggestions)

## `portal_feedback` shape (relevant cols)
`id, body, kind (bug|feature|idea|other), source, page, file_url, file_name,
submitter_email, author_id, portal, status (pending…), resolved_at, resolved_by,
created_at`. Open filter = `resolved_at is null`. Admin Feedback tab is the
resolve UI (`/?nav=feedback`).
