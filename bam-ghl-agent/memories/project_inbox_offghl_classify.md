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

## Gotchas

- The V1.5 inbox is a separate view (`#view-v15inbox`, `.v15ib-*`) — untouched.
- `tagConfig` is returned but not consumed client-side (vestigial).
- Store threads key on `ghl_contact_id`, which for portal-contacts academies is
  the minted portal uuid (see [[project_contacts_offghl]]) — the members-table
  join still works.

## Related

- [[project_v2_sales_inbox_ui]], [[project_sales_comms]] — the inbox UI
- [[project_twilio_messaging_spine]], [[project_email_spine]] — the own-stores
- [[project_contacts_offghl]] — the contact-id join key
