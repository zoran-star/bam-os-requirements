---
description: Get Coleman set up to edit the investor summary page — pulls latest, starts the local server, gives the mobile preview URL and a page map
---

You are setting Coleman up to edit `business/business/summary.html`. Run through these steps without stopping.

## Step 1 — Pull latest

```bash
git pull
```

Confirm it's up to date.

## Step 2 — Start the local preview server

Check if a server is already running on port 8765:

```bash
lsof -ti:8765
```

If nothing is running, start one:

```bash
cd /Users/$(whoami)/bam-os-requirements/business/business && python3 -m http.server 8765 &
```

## Step 3 — Get the local IP for mobile preview

```bash
ipconfig getifaddr en0
```

Tell Coleman: **"Open this on your phone: http://<IP>:8765/summary.html"**

If `en0` returns nothing, try `en1`.

## Step 4 — Show the page map

Tell Coleman the page is broken into these sections (top to bottom), so he can quickly find what he wants to edit:

```
SECTION MAP — business/business/summary.html

  Header          — Logo + "Text Coleman" CTA button
  Hero            — Main h1 title + sub-copy
  The Gap         — 5 gap boxes (Intuitive UI, Marketing, AI, Sales, Scheduling)
  Distribution    — 1M+ network stats + Phase 1 / Phase 2 / Phase 3 cards
  The Team        — Zoran, Coleman, Luka, Danny, Jacky, Cameron, Mike
  The Prototype   — Embedded iframe of the live prototype
  Moats           — 5 numbered moats
  Roadmap         — Timeline (Month 4-6, Month 8-10)
  Investment      — Developer Capacity + Hyper-Launch Marketing
  Footer          — "Text Coleman" CTA + copyright
```

## Step 5 — Mobile editing notes

Remind Coleman of a few things that matter for this page:

- **All mobile edits go inside `@media (max-width: 1024px)` blocks** — and they must appear **after** the desktop CSS for the same element, otherwise the desktop rule wins silently.
- **Images use relative paths** (`images/zoran.jpg`) — absolute paths don't work with the local server.
- **No em dashes anywhere** in copy or output.
- After editing, **hard-refresh on the phone** (hold reload button in Safari, or clear cache in Chrome) to see changes.
- When done, **commit and push** so Zoran gets the changes immediately.

## Step 6 — Ask what he wants to work on

Ask: "What part of the page are you working on?"

Then just help him do it.
