---
name: Staff portal nav persistence
description: The staff portal remembers the active tab across reloads via localStorage, with a role-gated fallback to Inbox.
type: project
---

# Staff portal — active-tab persistence (2026-06-10)

**Why:** Ximena: "remember where I was when switching tabs/windows — right now it
reloads and I lose my place jumping BAM ↔ Meta." `App.jsx` kept the active tab
(`nav`) in memory only, defaulting to `inbox`, so any **full reload** (mobile
background-tab discard, the focus-triggered PWA update-reload, or an auth re-boot)
dropped staff back on Inbox.

**Fix (App.jsx):**
- `nav` now **lazy-inits from `localStorage.getItem("bam_nav")`** (fallback `inbox`).
- A `useEffect([nav])` **persists** `nav` to `localStorage` on every change.
- A guard effect falls back to `inbox` if the restored tab is **role-gated and not
  visible** (`systems/marketing/content/team/resources/feedback/financials`) or the
  hidden `dashboard`. Systems team keeps its existing redirect to `systems`.

**Notes:**
- Key is a plain `bam_nav` (one tab per browser — correct model; not per-user).
- Switching *browser* tabs alone never unmounts React, so this is really about
  surviving a full reload. `onAuthStateChange` still `setSession`s on every event
  (incl. focus TOKEN_REFRESHED) but that no longer loses the tab.
- If we later add deep-linkable tabs, move this to a URL query param instead.
