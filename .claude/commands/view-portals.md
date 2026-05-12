---
description: Spin up the BAM staff portal + client portal locally and return links for computer and phone
---

You are serving the BAM Business **staff portal** and **client portal** locally (single Vite dev server, both pages). Run through these steps without stopping.

## Step 1: Check if dev server is already running

```bash
lsof -ti:5173
```

If something is already running on `5173`, skip to Step 3.

If nothing is running, ensure deps are installed:

```bash
cd /Users/$(whoami)/bam-os-requirements/bam-ghl-agent/bam-portal && [ -d node_modules ] || npm install
```

Then start the dev server in the background (with `--host` so phone can reach it):

```bash
cd /Users/$(whoami)/bam-os-requirements/bam-ghl-agent/bam-portal && nohup npm run dev -- --host > /tmp/bam-portal-dev.log 2>&1 &
```

Poll until the port is bound (up to ~15s):

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do lsof -ti:5173 && break; sleep 1; done
```

## Step 2: Get local IP for phone access

```bash
ipconfig getifaddr en0
```

If that returns nothing, try:

```bash
ipconfig getifaddr en1
```

## Step 3: Return both portal links

Output exactly this (substituting the real IP):

```
Both portals are live:

  STAFF PORTAL
    Computer:  http://localhost:5173/
    Phone:     http://<IP>:5173/

  CLIENT PORTAL
    Computer:  http://localhost:5173/client-portal.html
    Phone:     http://<IP>:5173/client-portal.html

  (Phone must be on the same WiFi as the laptop)

Logs:  tail -f /tmp/bam-portal-dev.log
Stop:  lsof -ti:5173 | xargs kill
```

That's it. Done.
