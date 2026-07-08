# Onboarding Data Points DB - integration rows backfill (PARKED)

**Status 2026-07-08: PARKED - Zoran said "don't worry about the notion db" when
pausing the session. The 5 backfills below were drafted and approved earlier
the same day but never written. Only pick this up if Zoran asks for it; the
approved values are kept so nothing needs re-drafting.**

## Context
- DB: Onboarding Data Points `49be4ce65ada4d45b736070e11452edb`
- Same session already ADDED the row **Instagram DM Connection**
  (page `3975aca8-ac0f-81eb-b47d-f6b51e4e34b1`) - fully specced (Category:
  Business Info, Phase: First Week, Input Type: OAuth Connect, Blocks + FC
  Modules filled). That row is the template for detail level.
- The 5 existing integration rows have EMPTY Input Type / Blocks / FC Modules -
  this backfill fills them so the future onboarding wizard can say what breaks
  when a step is skipped.
- Write via Notion API PATCH `/v1/pages/{id}` with token from
  `whiteboard/.env.production` (NOTION_TOKEN; main checkout, gitignored -
  worktrees don't have it). Notion auto-creates new select options.

## The approved values (write exactly these)

| Row (page id) | Input Type (select) | Blocks (rich_text) | FC Modules (multi_select) |
|---|---|---|---|
| Stripe Account (`3315aca8-ac0f-8121-a183-c8778911c6ec`) | OAuth Connect | Nobody can pay you: no subscriptions, no checkout links, no member billing, no failed-payment recovery, revenue KPIs empty | Members, Sales, KPIs |
| GoHighLevel Account (`3315aca8-ac0f-818d-b0eb-df752d8a435a`) | OAuth Connect | No contact sync, no pipelines, no SMS/email sending, no conversation history import | Inbox, Sales, Contacts |
| Meta Business Manager (`3315aca8-ac0f-8126-a0f5-fc04d2270e37`) | OAuth Connect | No ad campaign visibility or KPIs, Marketing dashboard empty, no Pixel/CAPI conversion tracking, can't launch creatives | Marketing, KPIs |
| Social Media Links (`3315aca8-ac0f-8179-8df8-f51ebd6fa381`) | Text (URLs) | Website/funnel social links missing, brand profile incomplete, content team doesn't know where you post | Marketing |
| AI Conversation Channels (`3315aca8-ac0f-813b-8023-c64eb454eed2`) | Multi-select | AI agent defaults to SMS only - won't reply on IG/FB/WhatsApp even when those are connected | AI Agents, Inbox |

## After writing
- Confirm each PATCH returned 200, show Zoran the 5 updated rows, delete this
  note (or mark DONE) + update MEMORY.md.

## Related from the same session (already done, context only)
- PR #1271: Instagram self-serve connect wizard + per-academy inbox IG/FB
  toggle gating in bam-portal (details in
  [[bam-ghl-agent/memories/project_meta_dm_spine]]).
- Zoran's 2 manual steps still pending: add
  `https://portal.byanymeansbusiness.com/api/meta/ig-callback` to the Meta
  app's Valid OAuth Redirect URIs + submit Meta App Review.
