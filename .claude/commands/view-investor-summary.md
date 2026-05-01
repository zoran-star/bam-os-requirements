---
description: Spin up a local server for the investor summary page and return links for both computer and phone
---

You are serving the investor summary page locally. Run through these steps without stopping.

## Step 1 — Check if server is already running

```bash
lsof -ti:8765
```

If something is already running on 8765, skip to Step 3.

If nothing is running, start the server:

```bash
cd /Users/$(whoami)/bam-os-requirements/business/business && python3 -m http.server 8765 &
```

Wait 1 second, then confirm it started by checking again:

```bash
lsof -ti:8765
```

## Step 2 — Get local IP for phone access

```bash
ipconfig getifaddr en0
```

If that returns nothing, try:

```bash
ipconfig getifaddr en1
```

## Step 3 — Return both links

Output exactly this (substituting the real IP):

```
Investor summary is live:

  Computer:  http://localhost:8765/summary.html
  Phone:     http://<IP>:8765/summary.html  (must be on same WiFi)
```

That's it — done.
