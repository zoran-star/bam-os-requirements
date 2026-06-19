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
| 4 | **Auto-build**: labelled issue → Claude opens a PR → human merges | **PARKED** — needs repo admin (no one has it) |
| 5 | **Ship Queue**: approve+ship built PRs IN the portal, never on GitHub | **BUILT 2026-06-15** |

## Phase 5 — Ship Queue (built 2026-06-15)

Zoran said the GitHub PR flow was too much friction ("gotta go onto GitHub n
shit"). So approval moved INTO the staff portal — he never opens GitHub.

- **Where:** Feedback tab → **🚀 Ship queue** pill (admin-only).
- **Backend (`api/clients.js`):** `GET ?action=ship-queue` lists open PRs whose
  branch starts `feedback/` (the auto-build branches) with title + plain-English
  summary (PR body) + CI state (`shipChecksState` rolls up check-runs).
  `POST ?action=ship-merge&pr=<n>` squash-merges → Vercel auto-deploys. Both
  admin-only; inert without `GITHUB_TOKEN`/`GITHUB_REPO`. Helper `githubApi()`.
- **Frontend:** `ShipQueuePanel` in `FeedbackView.jsx` — one card per PR
  (summary + checks badge + "🚀 Approve & ship"). Tapping ships it; GitHub stays
  invisible. "view diff" link is there for Coleman, ignorable by Zoran.
- Decision (Zoran 2026-06-15): approve in the portal (not Slack, not GitHub).

**Engine choice (Zoran):** 2026-06-14 = "auto-spec → ready-to-build issue".
2026-06-15 upgraded to **also auto-build a PR** (Phase 4) via the Claude Code
GitHub Action — but the PR is **never auto-merged** (human approves), and you can
open the issue/PR in Claude Code on the web to take over and edit instead.

## Phase 4 — auto-build (PARKED 2026-06-15: needs repo admin)

Decision 2026-06-15: nobody has admin on `zoran-star/bam-os-requirements`
(Zoran can't grant Coleman admin), and installing the Claude GitHub App + adding
the `ANTHROPIC_API_KEY` Actions secret both REQUIRE admin. So unattended
auto-build is **parked**. The spec engine no longer adds the `auto-implement`
label, and the workflow file (`.github/workflows/auto-implement.yml`) stays in
the repo but dormant. **Builder = a human in Claude Code** on the spec'd issue;
the PR lands in the Ship Queue for Zoran to approve. To enable unattended builds
later: install the App + secret (one-time admin task) and re-add the label in
`specFeedbackToIssue`.

### (original Phase 4 design, for when it's unparked)

- `.github/workflows/auto-implement.yml`: triggers on an issue being labelled
  `auto-implement` → `anthropics/claude-code-action@v1` implements it on branch
  `feedback/issue-<n>` and opens a PR (`Closes #<n>`). Never merges. If the issue
  is too vague/large it comments instead of guessing. Scoped by the label so it
  doesn't run on every issue; `--max-turns 30 --model claude-sonnet-4-6`.
- The spec engine (`specFeedbackToIssue`) now adds the `auto-implement` label, so
  every spec'd issue (manual button + Phase 3 auto-safe) auto-builds a PR.
- **Setup REQUIRED (Zoran, one-time):** install the Claude GitHub App
  (github.com/apps/claude) on `zoran-star/bam-os-requirements` + add repo secret
  `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions). Inert until
  both exist. Slack "PR opened" notifications = the GitHub Slack app
  (`/github subscribe zoran-star/bam-os-requirements`), not built-in.
- Cost: ~cents per small build; bounded by max-turns + the label gate.

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
