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
| 2 | "Build spec" → Claude writes a spec → opens a GitHub **issue** | **SHIPPED 2026-06-14** |
| 3 | Auto-spec safe items in the digest → 📋 issue links | **SHIPPED 2026-06-14** |

**Engine choice (Zoran, 2026-06-14):** "auto-spec → ready-to-build issue", NOT
autonomous codegen. One tap (or auto for safe items) turns feedback into a
GitHub issue with an AI-written spec; the actual build happens via Claude Code
web on that issue. No unsupervised codegen, no auto-merge.

## Phase 2/3 — how it works (shipped)

- **Manual (Phase 2):** "✨ Build spec" button on each item in the Feedback tab →
  `POST /api/clients?action=feedback-spec&id=…` (admin-only) → `specFeedbackItem()`
  (Claude haiku writes title + markdown spec: Problem / Approach / Likely files /
  Acceptance / Effort) → `createGithubIssue()` files it (labels `feedback` +
  `bug`/`enhancement`) → URL saved to `portal_feedback.github_issue_url`. Button
  flips to "📋 View build spec".
- **Auto (Phase 3):** the digest cron triages each item with an extra
  `auto_safe` flag (small + clearly-scoped + low-risk). For up to 3 safe items
  with no issue yet, it auto-files the spec issue and shows 📋 links + an
  "auto-drafted N specs" note in the Slack digest. **Never builds or merges code.**
- Dedup via `portal_feedback.github_issue_url` (migration
  `20260614223000_feedback_github_issue.sql`, + `spec_created_at`). Cron select
  falls back gracefully if the column isn't migrated yet.

### Env (Phase 2/3)
- `GITHUB_TOKEN` (fine-grained PAT, **Issues: write** on the repo) — REQUIRED
- `GITHUB_REPO` = `zoran-star/bam-os-requirements` — REQUIRED
- Inert without both: button returns `github_not_configured`; cron skips auto-spec.
- ⚠️ **Untested until those secrets exist + a first run** — no creds in this session.

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
