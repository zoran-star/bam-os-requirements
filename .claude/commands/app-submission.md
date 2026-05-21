---
description: Resume the App Store + Google Play submission for the BAM client portal — load state, show a visual catch-up, continue the walkthrough
---

Resume the **BAM Portal app-store submission** — getting the BAM client
portal onto the **iOS App Store** and **Google Play** as a native app.

## Step 1 — Load state

Read these in order:
1. `bam-ghl-agent/bam-portal-app/app-store-submission.md` — the master
   guide: the 9-step plan, store listing copy, App Privacy / Data safety
   declaration, demo account spec, screenshots spec, approval-risk
   section, review notes, and the **Part 11 final checklist** (what's
   ticked = what's done).
2. `bam-ghl-agent/memories/project_app_store_launch.md` — decisions
   locked, what's done, what's outstanding.
3. `bam-ghl-agent/bam-portal-app/README.md` — native build mechanics.
4. The harness task list (TaskList) — prior-session tasks if any exist.

## Step 2 — Confirm connections

Run `git pull` first so the submission guide is current. Confirm GitHub.
Flag anything missing.

## Step 3 — Figure out where we are

Map progress against the 9 steps:

```
1 Assets   2 Feature approval   3 Phone testing   4 Demo account
5 Screenshots   6 iOS build   7 Android build
8 Submit → Apple   9 Submit → Google
```

Use Part 11 of the guide + the task list to see what's complete.

## Step 4 — Visual catch-up

Print a SHORT, visual catch-up (Zoran has ADHD + is a visual learner —
see the repo CLAUDE.md communication rules: tables, ASCII, bold, one
clear next action). Show a 9-step status board: ✅ done · ⬅️ current ·
⬜ pending. End with the single next action.

## Step 5 — Continue

Pick up at the first incomplete step and walk Zoran through it. Steps
marked **[Zoran]** need him (phone testing, the demo account, the Mac
compile, the store submissions) — coach him through those. Do everything
else yourself.

As steps complete: tick Part 11 of the guide, update
`project_app_store_launch.md`, and commit + push.

## Goal

Keep the session focused. If no submission goal is active, tell Zoran to
paste this:

```
/goal walk me through submitting the BAM portal to the iOS App Store and
Google Play — make sure I approve the features, maximize our approval
odds, and test everything on a phone before submitting
```

## Hard rules

- The app is a thin Capacitor wrapper around the LIVE portal — "what gets
  reviewed" = whatever the live portal does that day. Lock features
  before submitting.
- The Members tab is hidden in the native app on purpose (see the guide).
  Do not "fix" that.
- Maximizing approval odds is part of the job — re-read the approval-risk
  section of the guide and keep the review notes strong.
