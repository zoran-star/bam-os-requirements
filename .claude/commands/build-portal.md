---
description: Safely start building on the BAM portal — pulls latest, creates a branch, checks env setup, and points you at the right file
---

# /build-portal — safe start sequence

When the user invokes this, walk them through a build session that won't break `main`.

## Step 1 — Pull latest

```bash
cd /Users/zoransavic
git checkout main
git pull
```

If pull fails with merge conflicts or "untracked files would be overwritten", **stop and ask** — don't force anything. The recovery process is in `git-workflow.md` at the repo root.

## Step 2 — Ask what they're building

Use AskUserQuestion with these options:

- **Fix a bug** — `bam-ghl-agent/bam-portal/src/`
- **Add a feature to the staff portal** — `bam-ghl-agent/bam-portal/src/views/`
- **Edit the client portal HTML** — `bam-ghl-agent/bam-portal/public/client-portal.html`
- **Edit onboarding flow** — `bam-ghl-agent/bam-portal/public/onboarding-reloaded.html`
- **Edit BAM GTA app** — `bam-ghl-agent/bam-gta-staff/`
- **Other** — ask them

## Step 3 — Create a branch

NEVER let them edit `main` directly. Create a branch named after the work:

```bash
# Branch name format: <category>/<short-description>
# Examples:
#   fix/cancel-button-loading-state
#   feat/promo-tile-on-menu
#   copy/onboarding-section-3-rewrite
git checkout -b <category>/<short-description>
```

If they're not sure what to name it, suggest one based on their answer in Step 2.

## Step 4 — Verify env setup

Confirm these exist:

```bash
ls bam-ghl-agent/env/.env.local 2>/dev/null && echo "✅ .env.local exists" || echo "❌ MISSING .env.local — ask Zoran"
ls bam-ghl-agent/bam-portal/.env.local 2>/dev/null && echo "✅ bam-portal .env.local exists" || echo "⚠️  bam-portal/.env.local missing — may need it"
```

If env files are missing, tell them to ask Zoran for the values — never invent or guess.

## Step 5 — Brief them on the rules

Display this reminder in the chat:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚧 YOU'RE ON A BRANCH — SAFE TO EXPERIMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ DO:
  • Edit, save, commit small chunks ("git add . && git commit -m 'note'")
  • Push your branch ("git push -u origin <branch-name>")
  • Open a PR on GitHub when ready — DO NOT merge yourself
  • Test locally before pushing ("npm run dev" in bam-portal/)

❌ DO NOT:
  • Push directly to main (branch protection will block you anyway)
  • Commit any .env files (they're gitignored — keep it that way)
  • Hard-delete or force-push without asking
  • Merge your own PR — wait for review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 6 — Load context for their task

Based on their Step 2 answer, read the relevant memory notes in `bam-ghl-agent/memories/` so they have the right context loaded. For example:
- Editing onboarding → read `project_onboarding_reloaded.md`, `project_public_onboarding.md`
- Editing client portal → read `project_client_portal_flow.md`, `project_client_portal_tour.md`
- Editing offers → read `project_offer_architecture.md`

## Step 7 — Hand off

Tell them: **"You're on branch `<name>`. Make your changes, commit small, and push when ready. I'll help review before you open a PR."**

---

## Important reminders for you (the assistant)

- If a UI change touches `client-portal.html`, **run `verify-client-portal-ui.mjs` before they commit** (catches removed tour selectors)
- If they edit a Supabase schema, **update the relevant memory note in the same change**
- If they accidentally land back on `main` and start editing, stop them — make a branch first
- After their PR is merged on GitHub, remind them to `git checkout main && git pull` to sync
