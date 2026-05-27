<!--
  Open a PR by going to GitHub → your branch → "Compare & pull request".
  Fill out this checklist before requesting review.
-->

## What this changes

<!-- 1-2 sentences. What does this PR do? -->

## Why

<!-- What problem this fixes / what request this addresses. Link the Notion page or session if relevant. -->

## How to test

<!-- Steps a reviewer can follow to verify this works. -->

1.
2.

---

## ✅ Pre-merge checklist

- [ ] I pulled `main` before starting and there are no conflicts
- [ ] I tested this locally — the app actually runs, not just builds
- [ ] No secrets or `.env` files are in this PR (check Files Changed tab!)
- [ ] If I changed UI in `bam-portal/public/client-portal.html`, I ran:
       `node bam-ghl-agent/bam-portal/scripts/verify-client-portal-ui.mjs`
- [ ] If I changed the database schema, I updated the relevant memory note in `memories/`
- [ ] If I added a new project file/folder, I updated `CLAUDE.md` and `MEMORY.md`
- [ ] Commit messages describe what changed (not just "stuff" or "updates")

## ⚠️ Reminder

**Merging to `main` deploys to production immediately via Vercel.** If you're not confident this works, request review first or test the Vercel preview link that gets auto-posted to this PR.
