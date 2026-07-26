---
name: reference-deployments
description: Vercel auto-deploy rules for this repo, plus the ignoreCommand build-speed setup
type: reference
---

Moved out of CLAUDE.md 2026-07-25 (context diet).

## Auto-deploy on push to `main`

| App | Directory | Live URL |
|---|---|---|
| Prototype | `prototype/` | https://fullcontrol-prototype-six.vercel.app |
| Market Research Survey | `market-research/` | https://full-control-survey.vercel.app |
| Staff + client portal | `bam-ghl-agent/bam-portal/` | https://portal.byanymeansbusiness.com |

**Never deploy manually via CLI.** Push to `main` and Vercel handles it.

## Build speed

**2026-07-05:** every project's `vercel.json` has
`"ignoreCommand": "git diff --quiet HEAD^ HEAD -- ."` so a push only builds the
projects whose folder actually changed, instead of queueing every project.
**Add the same ignoreCommand to any new Vercel project in this repo.**

**2026-07-09:** `bam-ghl-agent/bam-portal/vercel.json` additionally skips ALL preview
builds (`[ "$VERCEL_ENV" != "production" ] || git diff ...`), so branch pushes no
longer eat the team's single build slot and only merges to `main` build.
Tradeoff: no Vercel preview links on bam-portal PRs, so test locally.
Also flip "Prioritize Production Builds" ON in the Vercel dashboard
(bam-portal -> Settings -> Git). That one is dashboard-only, not in git.
