---
name: V2 Sales drawer + Inbox + mobile UI pass
description: 2026-06-18/20 — Sales pipeline drawer/cards, missed-trial automation, Won/Lost removal, email-off (SMS only), inbox cleanup + boxed list, CAC KPI, member-card mobile, V2 mobile bottom bar. All in client-portal.html unless noted.
metadata:
  type: project
---

# V2 Sales / Inbox / mobile pass

All in `bam-portal/public/client-portal.html` unless noted. Shipped 2026-06-18→20.

## Sales board (Pipelines view)
- **Summer special** button on EVERY card, top-right (`📨 Special`) + in the card
  drawer. `_plEnrollSpecial(oppId)` now: styled confirm modal (`_plConfirmModal`,
  replaced native confirm) → enroll-workflow → **auto-move the card to the
  "Interested" stage** (portal-side PATCH, no GHL automation) → optimistic local
  move + re-render.
- **Won / Lost / Abandoned** now actually work + **remove the card from the board**
  (`_plRemoveOppLocal`). Won = instant (no modal); Lost/Abandoned keep the reason
  modal (Lost's GHL automation still runs). Board + tab counts filter out
  won/lost/abandoned (`_PL_CLOSED`).
- **Today's trials**: `_plIsTrialToday()` sorts them to the TOP of their stage +
  a gold glow (`pl-card-today`).
- Drawer: removed **Convert to member**; added the Summer special button; the
  "👤 Open contact in GHL" link sources `location_id` from the pipelines API
  (`/api/ghl/pipelines` now returns `location_id`) so it works without visiting
  Members first.
- Single pipeline → the pipeline selector tab is hidden (redundant).

## Missed-trial automation (offer-configured, no GHL automation needed)
- New offer field type **`ghl_workflow`** (Sales step → "Missed-trial automation").
  Picks a GHL workflow; stored at `offers.data.missed_trial_workflow`. Picker
  lazy-loads via new `GET /api/ghl/workflows`. Hidden for V1 (`_V1_HIDE_TYPES`).
- `api/ghl/post-trial.js`: on `showed_up === false`, fires the chosen workflow
  (`POST /contacts/{id}/workflow/{wfId}`) — same offer-data pattern as `signup_url`.
- See [[project_offer_architecture]] (ghl_workflow field type) + [[project_sales_comms]].

## Email OFF — text only (everywhere)
Email-to-clients removed from all composers (drawer, v15 inbox, V2 inbox reply +
compose). SMS only. v15 inbox forces `_V15IB.type='SMS'`, Email pill dropped.

## Inbox (v15inbox)
- **Activity entries hidden**: GHL "Opportunity updated" / activity-type messages
  (`_ibIsActivity`, types 25-28 / TYPE_ACTIVITY_*) are filtered from threads — they
  are GHL logs, NOT messages sent to the client.
- **Clean previews**: `_ibCleanPreview()` strips attachment URLs (storage.googleapis
  /msgsndr…) → "📎 Attachment" fallback.
- **Boxed list**: each conversation is its own rounded box, colored avatars
  (`_ibAvatarStyle`), hover + unread tint, status-dot pipeline chip. ⚠️ GOTCHA: the
  v15 inbox lives in **`#view-v15inbox`** (NOT `#view-inbox` — that's the old V2
  inbox); the `.v15ib-*` CSS had to be UNSCOPED (was `#view-inbox`-scoped → broke).
- **Toolbar cleanup**: removed Unread/Failed pills + ⚙ Setup (kept ✉ Mass send).
- **Pipeline filter = LIVE only**: `_V15IB.contactPipe` skips won/lost/abandoned
  opps, so filtering by a pipeline/stage shows only people actually in it.
- **Thread**: hides the list filters when open; full history (`?limit=100` on the
  GHL messages call); taller scroll; pill "← All conversations" back button.
- **"Talk to BAM Business"** button is **owner-only** (`.inbox-talk-btn` +
  `applyTalkToBamInboxState()`, gated on `_effTabRole()==='owner'`, respects preview).

## KPIs
- Sales section: **CAC** added (ad spend ÷ new payments, per offer).
- Members section: **Live + Paused member counts** (`api/kpis-v15.js` section=members
  returns `roster:{live,paused}` from the members table).

## Mobile pass
- **V2 bottom bar** = Members · Sales · Inbox · KPIs · More (`is-v2` class +
  `mnav-v2` items; `_mobileBarViews()` returns the V2 set). V1.5 keeps its own
  (`is-v15`). The **More** sheet lists the rest + "Nothing else here yet" when empty.
- Member detail drawer: full-screen + scrollable (room for bottom nav/safe area).
- Members filter popover → bottom sheet w/ backdrop.
- Member cards cleaned: price label shows just `$316/4wk` (long plan name → tooltip);
  mobile shows only status + price (`.member-pills-extra` hidden); search re-renders
  ONLY the cards (`_membersRenderCardsOnly` / `_memberCardHtml`) so the input keeps
  focus. Removed Stripe/GHL "connected" pills, "Your Roster" title, "X shown".
- **Stripe links open the Stripe app on mobile**: `_openStripeUrl()` + a global
  click interceptor navigate dashboard.stripe.com SAME-TAB on mobile (universal
  links route to the app; new-tab forced the browser).

See [[project_staff_permissions]] for the access-control work shipped alongside.

## Instagram / Facebook DMs in the inbox (2026-06-23)
The V1.5 inbox (shared by V2 — `#nav-v2inbox` is retired) reads GHL conversations
generically, so **IG/FB/WhatsApp DMs already show** if the academy connected that
channel in GHL (type map in `_ghlChannelLabel`: 18=Instagram, 11/12=Facebook, 19=WhatsApp).

**Channel-aware reply (Route A — through GHL, no Meta app review).** Previously the
inbox sent EVERY reply as SMS. Now:
- `_v15ibOpen(...)` takes the conversation's channel; `_ghlSendType()` maps it →
  GHL send `type` (IG/FB/WhatsApp/Live_Chat/GMB/SMS). Stored on `_V15IB.active.channel`
  + `_V15IB.type`. The composer shows "Replying on <Channel>" + a 24h-window note for IG/FB,
  and only shows the no-phone warning for SMS.
- `api/ghl/send-message.js` — `TYPE_MAP` normalizes the requested channel; sendBody is
  `{ type, contactId, message }` for any non-Email channel (was hardcoded SMS). Social
  sends use `contact_id` (no phone lookup). Meta's 24h messaging window applies to IG/FB
  (outside it GHL errors, surfaced to the UI).

**Channel filter.** Inbox filter bar has a channel `<select>` (All / 📸 Instagram /
💬 Facebook) → `_V15IB.fChannel` + `_v15ibSetChannel`; `_v15ibFiltered` matches via
`_ibChannelKey(c)` (= `_ghlChannelLabel(...).toLowerCase()`).

Requires: academy's IG = Professional acct linked to a FB Page, and Instagram connected
in GHL (Settings → Integrations). No portal-side Meta integration / app review.
