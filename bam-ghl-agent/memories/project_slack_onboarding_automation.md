---
name: Slack onboarding automation
description: Requirement to auto-create Slack channels and add new clients during the onboarding process
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
When a new client completes onboarding, their Slack channel should be created automatically and linked to their clients row.

**Why:** Currently done manually — staff create the channel, then someone has to add the channel ID to Supabase. This will be part of the onboarding automation when that flow is built.

**How to apply:**
- This is a future onboarding step, not yet designed
- When designing the redefined onboarding checklist (using the 14 checkpoint memory as baseline), include a step for Slack channel creation
- The Slack app already has the right scopes (channels:read, groups:read, chat:write) — will also need `channels:create` or `groups:create` scope to automate creation
- On completion: write the new channel ID to `clients.slack_channel_id`
