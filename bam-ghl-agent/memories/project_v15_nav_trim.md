# V1.5 nav: Assets back in, Inbox and Sales out

2026-07-28. Requested change to the **V1.5 tier only**. V2 and V1 are untouched.

| Nav item | V1 | **V1.5** | V2 |
|---|---|---|---|
| Assets (standalone) | shown | **shown again** | hidden (lives in Content Library card + orb fan) |
| Inbox | hidden | **hidden** | shown |
| Sales / Pipeline | hidden | **hidden** | shown |
| Contacts | hidden | **shown, standalone** | shown |

## How it is gated

`applyV15NavTrim()` in `public/client-portal.html`, called at the end of
`applyV15NavState()` **after** `applyCrmSupersetNav()` so it wins. It returns
immediately unless `V15_ACCESS === true && V2_ACCESS !== true`, so there is no
code path where it touches V2 or V1. It hides `nav-v15inbox` and
`nav-v15pipelines` (an id added to the previously id-less V1.5 pipelines nav
item), hides the matching `.mobile-nav-item[data-view=...]` entries in the
bottom bar, and calls `switchView('home')` if a deep link has already put the
user on `view-v15inbox` or `view-pipelines`.

## The coupling that nearly broke Contacts

On V1.5, **Contacts had no nav item of its own**: `applyV15ContactsPlacement()`
hid it and surfaced Contacts as a button INSIDE the Inbox. Removing the Inbox
without touching that would have left V1.5 with **no route to Contacts at all**.
So that function now leaves the standalone item visible for V1.5 and switches the
in-inbox button off. **If the Inbox is ever restored for V1.5, revisit both.**

## What this means for the inbox work shipped earlier the same day

The SMS/Email tabs, the Read/Unread/Sent/Failed filters and the persisted
mark-unread all still exist and still run, but **V1.5 academies can no longer
reach them** - they are V2-only in practice now. Nothing was deleted; the entry
point was removed. Re-showing it is a one-line change in `applyV15NavTrim()`.
Detail on that build lives in `project_v15_inbox_email_tabs.md` (which arrives
with PR #1625).

The GHL email import keeps running for the allowlisted academies regardless, so
`email_threads` keeps filling even while the tab is hidden.
