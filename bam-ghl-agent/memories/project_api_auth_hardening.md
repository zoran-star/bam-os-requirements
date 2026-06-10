---
name: API auth hardening
description: Closed unauthenticated API endpoints that exposed GHL CRM data and Stripe financials; lists what's fixed vs still-deferred.
type: project
---

# API auth hardening (2026-06-10)

A functionality audit found several endpoints with **no auth gate**. The service-role key
bypasses RLS, so an ungated handler = full data to **anonymous** callers. Fixed the two real
data-exposure leaks + a fail-open webhook.

## Fixed

- **`api/ghl.js`** — every GET data action (`locations`, `contacts`, `conversations`,
  `pipelines`, `contact`, `messages`, `forms`, `calendars`, `form-activity`,
  `calendar-activity`) now requires a **staff** login via a new `requireStaff(req)` (token →
  `staff` row by email). Previously exposed live GHL CRM PII for any location by query param.
  `webhook` (secret) + `refresh-funnel` (`requireUser`) keep their own gates. The client portal
  uses the separately-gated `/api/ghl/inbox` + `/api/ghl/pipelines`, NOT these.
  - **Caller updates (had to, or the live tools 401):** `services/ghlService.js` (auth header in
    `fetchWithRetry`), `components/GhlKpiDiscovery.jsx` (6 fetches — the Sales tab),
    `views/SettingsView.jsx` (the integration connection-test loop, now async + token).
- **`api/stripe/overview.js`** — added the same `requireStaff` gate. Previously returned MRR /
  revenue / customer list / invoices unauthenticated. Caller: `services/stripeService.js` (auth
  header on all 5 section fetches; used by FinancialsView + the App alerts panel).
- **`api/ghl.js` funnel webhook** — was **fail-open** (`if (secret && key !== secret)`): with
  `GHL_WEBHOOK_SECRET` unset, anyone could POST funnel events. Now **fail-closed** (503 if no
  secret configured).

## Fixed — round 2 (2026-06-10, same day)

- **`api/ai/search.js`** + **`api/training.js`** — now **staff-gated** (`requireStaff`). Closes
  unauth Anthropic spend (search) and anonymous Claude + Notion/Supabase **writes**
  (`seed-scenarios`, `sync-notion`) via the service key.
- New shared client helper **`src/lib/authFetch.js`** — `fetch()` that attaches the Supabase
  token from the browser client (no need to thread a session prop). All 9 callers switched to it:
  `SearchOverlay`, `KnowledgeBaseView` (x3), `MeetingPrepModal`,
  `training/services/trainingService.js` (x2), `CalibrationMode`, `AddScenario`.

## Still DEFERRED

- **OAuth state secrets fall back to the Supabase service key** when unset
  (`messaging/connect.js`, `stripe/connect.js`). Left the code as-is to avoid breaking prod
  OAuth — **config fix**: set `META_OAUTH_STATE_SECRET` / `GHL_OAUTH_STATE_SECRET` /
  `STRIPE_CONNECT_STATE_SECRET` in Vercel, then the fallback never triggers.
- Most endpoints still do ad-hoc `isStaff` checks instead of importing `_roles.js` — broader
  consistency pass is future work.

## Gotcha for future callers
The `/api/ghl?action=*` proxy is now **staff-only**. Any new caller must send
`Authorization: Bearer <staff token>` or it gets 401.
