---
name: Client Portal Mobile Layout
description: 2026-05-20 — phone layout pass for client-portal.html. Added a fixed bottom tab bar (the sidebar is hidden ≤768px) plus a comprehensive ≤768px stylesheet.
type: project
---

## What this is

`bam-portal/public/client-portal.html` had a viewport meta tag and a few
media queries, but at `≤768px` the sidebar (`.sidebar { display:none }`)
was hidden with **no replacement** — the sidebar held the only navigation,
so phone users were stuck on one view. This pass makes the portal fully
usable and well-spaced on a phone.

## The bottom tab bar

`<nav class="mobile-nav" id="mobileNav">` — fixed to the bottom, shown only
`≤768px`. Three buttons mirror the sidebar nav: **Messages / Systems /
Marketing**, each `<button class="mobile-nav-item" data-view="…">`.

- **`mobileSwitchView(name)`** — the click handler. Finds the matching
  `.sidebar .nav-item` and calls the existing `switchView(name, el)` so
  every view-switch side effect still fires. Does nothing for `marketing`
  when `!MARKETING_INCLUDED`.
- **`syncMobileNav(name)`** — toggles `.active` on the bottom-nav buttons.
  Called at the end of `switchView()`, so the bar stays correct no matter
  who triggers a view change (sidebar, tour, deep link).
- `applyMarketingNavState()` also toggles `.disabled` on the marketing
  bottom-nav button.
- `updateUnreadBadge()` also drives `#mnav-messages-badge` (mirrors the
  sidebar unread count onto the Messages tab).

## The mobile stylesheet

A dedicated `<style>` block, **last in the document** (right after the
3rd style block, before `#admin-fb-wrap`) so it wins the cascade. One
`@media (max-width: 768px)` block. Highlights:

- `--mobnav-h: 56px`; `html/body/.app` switch to `100dvh` (iOS chrome).
- Topbar / content / card padding tightened; `.content` gets
  `padding-bottom` that clears the fixed nav + `env(safe-area-inset-bottom)`.
- Ticket-type tiles (`.ticket-types`) stack to a single column.
- Modals become **bottom sheets**: `.modal-backdrop` `align-items:flex-end`
  + `z-index:10050` (above the feedback button); `.modal-card` full-width,
  `100%` max-width `!important`, `sheetIn` animation; `.modal-footer`
  stacks full-width with the primary action at the bottom.
- Chat fills the screen minus the nav; composer sits above the nav.
- All form inputs forced to `font-size:16px` to stop iOS zoom-on-focus.
- Feedback widget (`#admin-fb-wrap`) lifted above the nav, **hidden on the
  chat view** via `body:has(#view-messages.active)` so it never covers the
  send button.

## Tour interaction

Tour step 4 spotlights `.nav-item[onclick*="marketing"]` — hidden on
mobile. `_positionSpotlight()` now detects a zero-size target and falls
back to the matching `.mobile-nav-item[data-view="…"]`. The
`verify-client-portal-ui.mjs` selectors are untouched (still passes).

## Account / sign out (added 2026-06-10)

The sidebar (and its footer Sign out + Change password) is `display:none`
on mobile, which made the PWA impossible to log out of. Fix: an
**Account section at the bottom of the Home view** (`#home-account`) with
Change password + Sign out rows. Mobile-only — hidden on desktop, which
keeps using the sidebar footer. `signOut()` also now drops this device's
push token (via `window.__bamPushDeleteToken`, exposed from the push IIFE)
**before** `auth.signOut()` so the delete runs while RLS access is still
alive, with a 2s timeout so sign-out never hangs.

## Gotchas

- Desktop layout is unchanged — every rule is inside the `≤768px` query
  or is the base `.mobile-nav { display:none }`.
- The bottom nav is in the DOM always; the login overlay (`z-index:9999`)
  covers it while logged out.
- `:has()` is used for the chat-view widget hide — fine for 2026 browsers.

## Related notes

- [[project_client_portal_tour]] — the first-login tour
- [[project_session_2026_05_17_polish]] — the FullControl design system pass
