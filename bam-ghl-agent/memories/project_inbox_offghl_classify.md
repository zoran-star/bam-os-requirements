---
name: Inbox member/lead classification off GHL + mobile toolbar
description: 2026-07-02 — the off-GHL (own-store) inbox now classifies member/lead + returns counts, random inbound folds into Leads, and the toolbar has a mobile layout.
type: project
---

## The bug (why GTA's inbox filters felt broken)

`api/ghl/inbox.js` is provider-aware: academies on `messaging_provider='twilio'`
and/or `email_provider='resend'` (BAM GTA) get their inbox LIST from the portal
store (`sms_threads` + `email_threads` via `listStoreThreads` /
`listEmailStoreThreads`), NOT from GHL. That store branch used to return
conversations with **no `classification` and no member/lead counts** — the
member/lead logic only ran on the legacy GHL path. So on GTA the **Members /
Leads filter tabs filtered to empty and the counts were blank.** The filters
weren't just ugly, they were backed by nothing.

## The fix (fully off GHL)

`classifyStoreConversations(clientId, conversations)` (new helper in
`api/ghl/inbox.js`, above `handler`): loads the portal `members` table and marks
a conversation **member** if its contact matches by portal contact id
(`ghl_contact_id`), normalized phone, or email; **everyone else is a lead**.
Zero GHL calls. The store list branch now runs every conversation through it and
returns `counts { all, members, leads, unread }`.

## Random inbound → Leads (decision 2026-07-02)

Classification is now binary: **member = matches the members table; lead =
everyone else** (funnel leads AND random walk-up inbound). Nothing hides in
"All" only. On the legacy GHL path the old `"other"` bucket is gone
(`isMember ? "member" : "lead"`), and the per-lead-tag GHL `/contacts/search`
calls were deleted (only the member-tag search remains) — less GHL reliance +
fewer rate-limit hits. `lead_tags` is kept in `tagConfig` for reference only.

## Mobile toolbar (client-portal.html #view-inbox)

The `.ib-toolbar` crammed 4 filter tabs + search + 5 action buttons into one
`flex-wrap` row → an indistinct pile on a phone. Restructured into
`.ib-filters` (the 4 tabs) + `.ib-actions` (Hawkeye/Confirm/Closing/New/Refresh),
both `display:contents` on desktop so **desktop is byte-identical**. A
`@media (max-width:768px)` block turns filters into a segmented control (Bot tab
shows `.ib-tab-short` 🤖-only to fit 4 across), search full-width @16px, actions
on their own row (Hawkeye flex-prominent, New/Refresh icon-only). Verified via
Playwright at 390px + 1100px; tour verifier still passes.

## ⚠️ Which inbox GTA actually shows (learned the hard way)

The first mobile pass styled `#view-inbox` (`.ib-toolbar`) — but **GTA renders
`#view-v15inbox`** (the `_v15ibRenderAll()` inbox with Mass send + the pipeline
dropdown; it's what V1.5 AND V2 academies see). Zoran's PWA screenshot proved
it. The `#view-inbox` styling is live but dead code for GTA. Both views read the
same `/api/ghl/inbox` list, so the classification/counts work feeds both.

## Read/unread sync (Zoran, same day) - the model

Zoran reported read state not sticking. Root causes found by tracing the whole
flow:

1. **Store list ignored read receipts.** `mark-read` saves a per-user receipt
   in `ghl_conversation_reads` (keyed by the store thread uuid), and the GHL
   list path applies them via `applyReads` - but the store list branch returned
   raw `sms_threads.unread`/`email_threads.unread`. Reads only "stuck" in the
   session-local `_V15IB.readAt` map, so a reload/other device showed
   everything unread again. FIX: store list now runs
   `sortByUnreadThenDate(applyReads(classified, loadUserReads(...)))` - same as
   the GHL path (also gives unread-first ordering).
2. **Nothing ever cleared `unread` in the DB.** Inbound webhooks set
   `unread:true`; no writer set it false, so once a thread got an inbound it
   stayed flagged forever at the DB level. FIX: the outbound send touch in
   `messaging/provider.js` (SMS) + `messaging/email-provider.js` (email) now
   sets `unread:false` - a reply means handled.

THE MODEL now: inbound → `unread=true` (global, per-thread) · open the thread →
per-user receipt (read for YOU, teammates still see unread) · reply (human or
approved agent send) → `unread=false` for everyone. Imports default to read
(`unread` column default false). `_voice.js` only reads sms_threads.

## Names, not numbers (Zoran, same day)

`sms_threads.contact_name` is often empty, so store threads showed bare phone
numbers. `classifyStoreConversations` now also resolves a display name at read
time for any thread whose name is phone-only or email-only (`_nameless` test):
**contacts store first** (`contacts` by `ghl_contact_id`, batched `in.()` x100),
**members table second** (`parent_name || athlete_name`). Zero GHL calls, fixes
list rows + thread header (which reads the convo's contactName). Thread header
also shows the phone as a small muted sub-line under a real name.

## One Hawkeye button (Zoran, same day)

The inbox toolbars (both `#view-v15inbox` and `#view-inbox`) now show ONE
approval button: **👁 Hawkeye**. The ✅ Confirm and 🎯 Closing toolbar buttons
were removed - those queues live as tabs INSIDE the Hawkeye overlay
(`_agentTabsBar` always renders all 3 pills with counts). `_acxRefreshCount` /
`_aclxRefreshCount` no-op safely without their buttons; dead `_agentTabVisible`
deleted. 📼 Voicemail + ✉ Mass send untouched.

## V15 inbox follow-up (same day)

`_v15ibRenderAll()` got a **segmented All / ★ Members / Leads filter row**
(`.v15ib-cls-row`, state `_V15IB.fClass`, setter `_v15ibSetClass`, clause in
`_v15ibFiltered`) driven by the conversation `classification` — hidden if the
payload has no classified convos (stale cache). Mobile (`≤640px` media block):
`.v15ib-bar` goes column-flex with `order` so FILTERS come first (segmented →
channel chips → pipeline dropdown), ACTIONS (Hawkeye/Mass send, full-width
44px) sit on their own row below, count last. Desktop keeps its original
layout + gains the compact (max-width 420px) segmented row.

## Gotchas

- The V1.5 inbox is a separate view (`#view-v15inbox`, `.v15ib-*`) — and it is
  THE inbox GTA sees (see above).
- `tagConfig` is returned but not consumed client-side (vestigial).
- Store threads key on `ghl_contact_id`, which for portal-contacts academies is
  the minted portal uuid (see [[project_contacts_offghl]]) — the members-table
  join still works.

## Related

- [[project_v2_sales_inbox_ui]], [[project_sales_comms]] — the inbox UI
- [[project_twilio_messaging_spine]], [[project_email_spine]] — the own-stores
- [[project_contacts_offghl]] — the contact-id join key
