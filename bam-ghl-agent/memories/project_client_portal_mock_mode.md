# Client portal mock mode (?mock=1) - local mobile styling loop

**What:** `bam-portal/public/client-portal.html` has a built-in demo mode for front-end work: append `?mock=1` and the portal renders FULLY with fake data - no login, no Supabase, no `/api` calls, no service worker. Built 2026-07-16 for the phone-on-WiFi mobile styling loop.

**How to run the loop:**
```bash
cd bam-ghl-agent/bam-portal && npm run dev -- --host --port 5174
# phone (same WiFi): http://<mac-lan-ip>:5174/client-portal.html?mock=1
# mac:               http://localhost:5174/client-portal.html?mock=1
```
`.claude/launch.json` "bam-portal" entry runs exactly this (upgraded from python http.server 2026-07-16).

**Safety:** activates only when `?mock=1` AND hostname is localhost / 127.0.0.1 / private-LAN (192.168.x, 10.x, 172.16-31.x, *.local). Can never fire on portal.byanymeansbusiness.com. Prod (V1 + V2) behavior untouched.

**Where the code lives (3 seams in client-portal.html):**
1. `MOCK MODE` script block in `<head>` (right after the supabase CDN tag) - the gate, fixtures, fake Supabase client (`window.__MockSb`), and `window.fetch` stub for `/api/*`
2. `const _sb = window.__MOCK__ ? window.__MockSb() : supabase.createClient(...)`
3. sw.js registration skipped when `window.__MOCK__` (stale caches would mask edits)

**Demo academy:** Northside Hoops Academy (v2_access=true, marketing + organic content, contact_provider ghl). Fixtures: 10 members (statuses live/paused/payment_failed/cancelling/pending), Training Pipeline with canonical V2 stage names (New Lead/Responded/Scheduled Trial/Done Trial/Interested/Won - `_plStageBot` maps them to agent lanes) + 12 opps, 8 inbox conversations, Talk-to-BAM thread, 5 tickets (incl. awaiting_client + final_review so both top banners show), 12 months meta-report periods. Unmocked `/api` routes get a generous empty-defaults JSON so no view hard-fails.

**Gotchas learned building it:**
- Pipeline board REQUIRES `opportunity.contact` object (`o.contact.name` throws otherwise) and stage names matching `_plStageBot` regexes.
- Talk-to-BAM conversations need `client_id` matching CLIENT_ID + `business_name`; messages use `author_staff_id` vs `author_auth_user_id` to pick bubble side.
- V2 boots into the command center one-pager; bottom tabs SCROLL to sections there. For programmatic view checks set `window._CC_BYPASS = true` before `switchView(...)`.
- After UI edits still run `node bam-portal/scripts/verify-client-portal-ui.mjs` (tour selectors).

**Extending:** add rows to the `T` table fixtures or a branch in `mockApi()` inside the MOCK MODE block.
