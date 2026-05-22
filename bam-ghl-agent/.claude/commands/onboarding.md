---
description: Resume the Onboarding Reloaded build — pull latest, show status, hand back the goal to set
---

Resume work on **Onboarding Reloaded** — the reworked BAM Business client onboarding flow.

## Step 1 — Pull + read state
- Run `git pull`.
- Read `bam-ghl-agent/memories/project_onboarding_reloaded.md` in full. That note is the source of truth for where this work stands.
- Open `bam-ghl-agent/bam-portal/public/onboarding-reloaded.html` if you need to inspect the flow itself.

## Step 2 — Summarize for Zoran
Short + visual. Tell him:
- What the flow is and where it lives (`bam-ghl-agent/onboarding-reloaded.html`)
- What's done
- The **open items** from the note — especially anything blocking

## Step 3 — Hand back the goal
Show Zoran this and tell him to set it by typing `/goal` then pasting the text:

```
finish and ship the onboarding-reloaded flow — get the Supabase onboarding_reloaded table created, verify the flow syncs to it end to end, apply any remaining changes Zoran asks for, and confirm it is working and approved
```

If the open items in the note have changed since it was written, adjust the goal text to match what is actually left.

## Step 4 — Begin
Once Zoran sets the goal (or says go), pick up the top open item.

**Working rule:** when you need Zoran's input or a decision, use AskUserQuestion — do not stall in a loop.
