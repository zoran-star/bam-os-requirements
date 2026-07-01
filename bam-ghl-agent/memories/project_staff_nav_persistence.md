---
name: Staff portal nav persistence
description: Staff portal view state (page, open client, sub-tabs) lives in the URL so reload + Back/Forward restore your exact spot. localStorage is now just a fallback.
type: project
---

# Staff portal — URL-backed navigation (2026-06-30, supersedes the 2026-06-10 localStorage-only model)

**Why (2026-06-30, Cam):** "I hit Back or refresh and get taken to a completely
different page." The old model tracked the page in React state + `localStorage`
and **never touched the URL**, so the browser **Back button left the app entirely**
(no history entries were ever pushed) and a reload restored only the top-level
page — the open client and every sub-tab were lost.

**Fix — view state now lives in the URL (PR #904):**
- **New hook `src/hooks/useUrlState.js`** — a `useState` drop-in that mirrors ONE
  query param and re-syncs on `popstate` (Back/Forward). `push:false` default
  (replaceState) for sub-tabs so flipping tabs doesn't spam history; `push:true`
  for page-level nav.
- **`App.jsx`:** `nav` seeds from `?p=` (canonical) / `?nav=` (legacy Slack
  deep-link) / `localStorage` / `inbox`. `goNav(page, clientId?)` **pushState**s a
  fresh `?p=` on every sidebar/nav click (so Back walks between pages). A URL-sync
  effect (`[nav, clientsOpenId]`) replaceState-mirrors `?p=`+`?client=`, and a
  `popstate` listener restores page + open client on Back/reload.
- **Open client** rides in `?client=<id>` — `ClientsCombinedView` now reports the
  selected id up via `onDetailChange(selectedId|null)` (was a boolean).
- **Sub-tab URL keys:** `msec`/`mtab` (Marketing), `csec`/`csub` (Content), `ctab`
  (client-detail's 11 tabs), `ftab` (Financials), `ktab` (Knowledge), `atab`
  (Action Items).
- `localStorage bam_nav` **kept as a fallback** for fresh opens with no URL state;
  the role-gated fallback-to-Inbox guard is unchanged.

**Gotchas / caveats:**
- `useUrlState`'s setter takes a **direct value only** (no functional-updater form)
  — none of the swapped tab setters used one.
- Sub-tab params linger in the URL after closing a client detail, so opening a
  *different* client can inherit the previous tab (sticky-tab; harmless).
- **Compile-verified only at ship** — the authenticated nav couldn't be
  click-tested locally (login-gated). Flagged for a manual pass on the Vercel
  preview.

---

# (historical) Staff portal — active-tab persistence (2026-06-10)

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
