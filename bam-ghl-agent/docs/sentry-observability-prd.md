# PRD: App Errors for BAM Portal

Status: Complete / MVP implemented
Last updated: 2026-06-08  
Primary app: `bam-portal`  
Related app: `bam-portal-app` Capacitor wrapper

## Summary

Add a production-only admin page called "App Errors" that gives admins a compact view of portal issues without mixing them into Feedback.

MVP data source: Sentry only.

Sentry surfaces:

- `bam-portal-web` project for browser/runtime errors from the staff web app, client portal, mobile WebView, and public BAM Portal pages.
- `bam-portal-api` project for exceptions from Vercel API Functions and scheduled Vercel cron routes.

Current decision: use Sentry for both frontend and backend in the MVP. Vercel Observability remains useful for deeper platform/log debugging, but the App Errors page should not integrate Vercel as a second provider.

## Background

The portal already has an admin-only Feedback area for human-submitted bugs/features and agent sessions. Operational error telemetry should live in its own admin page, not in the feedback database.

Relevant existing surfaces:

- `bam-portal/src/views/FeedbackView.jsx` is the current admin feedback and agent-session view.
- `bam-portal/src/App.jsx` gates feedback visibility with the admin role.
- `bam-portal/public/client-portal.html` is the public client portal loaded by browsers and by the Capacitor mobile wrapper.
- Public routes/pages include staff login, onboarding, support, ticket intake/status, training, and other unauthenticated flows.
- `bam-portal/api/*.js` files run as Vercel Functions and perform server-side portal work.
- `bam-portal/vercel.json` defines scheduled cron routes that also run as Vercel Functions.
- `bam-portal-app/capacitor.config.json` points the native app at the live hosted client portal URL via `server.url`.

## Goals

1. Give admins production error visibility inside the staff app.
2. Keep App Errors separate from Feedback.
3. Show top Sentry issue groups across staff app, client web, mobile WebView, and backend API/cron surfaces.
4. Support "View in Sentry" and "Copy Claude prompt" actions.
5. Avoid writing Sentry issue data into Supabase for the MVP.
6. Avoid exposing Sentry auth tokens to the browser.
7. Keep the first version small enough to ship on Sentry Developer while event volume is unknown.

## Non-Goals

- No "promote to Systems" action.
- No writing Sentry issues into `portal_feedback` or a new Supabase table.
- No assigning, resolving, muting, deleting, or otherwise mutating Sentry issues from BAM Portal.
- No native iOS/Android crash reporting in the MVP unless the Capacitor shell starts owning meaningful native behavior beyond push/device registration.
- No manual frontend `captureMessage`/`captureException` calls just because an API returned a 400 or 500.
- No Sentry Session Replay in MVP.
- No Sentry Logs, profiling, or high-volume tracing in MVP.
- No Vercel Observability/Runtime Logs integration in the App Errors page for MVP.

## Users

Primary user: admin staff, initially Zoran.

Admins should be able to answer:

- What are the hottest production app errors right now?
- Is this staff app, client web, mobile WebView, or backend API?
- Which Sentry project produced it?
- How many times did it happen in the current window?
- When was it last seen?
- Can I open the issue in Sentry?
- Can I copy a Claude/Codex prompt that points the agent at the right Sentry issue?

## Product Requirements

### Admin App Errors Page

- Add an admin-only page in the staff portal called "App Errors".
- Keep Feedback unchanged.
- Display one combined Sentry issue list.
- Add a shared time-window control with `Last 24h` and `Last 7d`.
- Default time window: `Last 24h`.
- Production only.
- Empty state: "No production errors in this window."
- Error state: explain the failure without exposing provider tokens or raw sensitive responses.

### Sentry Issues List

- Show at most 5 unresolved Sentry issues sorted by frequency.
- Query production only.
- Query the selected window: `Last 24h` or `Last 7d`.
- Include both Sentry projects: `bam-portal-web` and `bam-portal-api`.
- Rows with no matching events in the selected window should not appear.
- Sort by count descending, then last seen descending if needed.
- Show:
  - issue title
  - project chip: `bam-portal-web` or `bam-portal-api`
  - surface chip:
    - `staff-web`
    - `client-web`
    - `client-mobile-webview`
    - `vercel-api`
    - `vercel-cron`
  - count in the selected window
  - affected users if provided by Sentry
  - first seen
  - last seen
  - actions: `View in Sentry`, `Copy Claude prompt`

## Access Control

- Navigation and API access must be limited to users with `role=admin`.
- All `admin` role users can view the page.
- Scaling managers, systems roles, marketing roles, and other staff roles are excluded in the MVP.
- Non-admin users should not see the page.
- Non-admin API calls should return 403.
- Sentry provider tokens must exist only in server-side environment variables.

## Persistence

- Do not persist Sentry issues in Supabase for the MVP.
- Do not add dismissed/seen/assignment state in the MVP.
- Short server-side caching is acceptable to reduce Sentry API calls.

## Technical Approach

### 1. Sentry Projects

Create two Sentry projects:

- `bam-portal-web`
  - Platform: React / Browser JavaScript.
  - Captures staff web, client web, mobile WebView, and public web errors.
  - Public DSN used in browser code.
  - Sentry project ID: `4511527624638464`.
- `bam-portal-api`
  - Platform: Node.js.
  - Captures Vercel API Function and Vercel cron route exceptions.
  - DSN is server-side only.
  - Sentry project ID: `4511527636828160`.

Sentry organization slug: `full-control`.
Sentry region/base URL: `https://us.sentry.io`.

Do not commit DSNs or auth tokens into repo files. Store DSNs and Sentry auth tokens in Vercel environment variables.

Why two projects:

- The web and API SDKs are different.
- Source maps/release handling are cleaner.
- Backend noise can be filtered separately from browser noise.
- The App Errors UI can still show one combined list by querying both project IDs.
- Project count should not be the primary cost driver; captured event volume is.

### 2. Read-Only App Errors API

Add a server-side endpoint behind admin auth:

- `bam-portal/api/app-errors.js?action=sentry-issues`

The browser should call the portal API only. It should never call Sentry directly with provider tokens.

Call Sentry's organization issues endpoint:

- `GET /api/0/organizations/{org_slug}/issues/`
- `environment=production`
- `query=is:unresolved`
- `sort=freq`
- `statsPeriod=24h` or `statsPeriod=7d`, based on the selected window
- `limit=5`
- `project=<web_project_id>&project=<api_project_id>`

Note: Sentry's organization issues API filters by numeric project IDs, not project slugs. Append each project ID as its own `project=` query parameter.

Server-only env vars:

- `SENTRY_ISSUES_AUTH_TOKEN` for the read-only admin page, or `SENTRY_AUTH_TOKEN` if the project standardizes on that name.
- `SENTRY_ORG=full-control`.
- `SENTRY_BASE_URL=https://us.sentry.io`.
- `SENTRY_ISSUES_PROJECT_IDS=4511527624638464,4511527636828160`.
- `SENTRY_ENVIRONMENT=production`.

### 3. Staff Web App Sentry

Add Sentry to the Vite/React staff app.

Likely implementation:

- Install `@sentry/react`.
- Create `bam-portal/src/lib/sentry.js`.
- Import it first in `bam-portal/src/main.jsx`.
- Initialize only when `import.meta.env.PROD` and `VITE_SENTRY_DSN` are present.
- Use `environment=production`.
- Set `surface=staff-web` for the staff React app, including unauthenticated staff shell/login errors.
- Wrap the app in a Sentry error boundary or use React root error handlers depending on the React version.
- Configure source map upload in the Vercel build pipeline with Sentry's Vite/source-map tooling. Staff React source maps are required for MVP.
- Do not add manual capture for failed API responses in the staff frontend.

Public env vars:

- `VITE_SENTRY_DSN` from `bam-portal-web`.
- `VITE_SENTRY_ENVIRONMENT=production`.
- `VITE_SENTRY_RELEASE` or a Vercel/git-derived release value.

Do not set `sendDefaultPii: true`; keep default PII disabled unless a separate privacy decision changes this.

### 4. Client Portal and Mobile WebView Sentry

Instrument `bam-portal/public/client-portal.html`, because it is the UI that clients use in browsers and the URL loaded by `bam-portal-app`.

Likely implementation options:

- Use Sentry's browser SDK through a small checked-in script loaded by `client-portal.html`.
- Or use Sentry's CDN/browser bundle if keeping the static HTML flow is more practical.

The script should:

- Initialize only in production and only when a public DSN is configured.
- Use the `bam-portal-web` DSN.
- Set `surface=client-web` in normal browsers.
- Set `surface=client-mobile-webview` when Capacitor is detected.
- Attach client/user IDs only as IDs, not names, emails, phone numbers, or form payloads.
- Do not add manual capture for failed API responses in the client portal.

Source maps for static client/public pages are best-effort and should be timeboxed. Do not let static-page source-map complexity block the MVP.

MVP recommendation: do not add native `@sentry/capacitor` yet. The app's native shell is intentionally thin, and most runtime behavior is the hosted portal in a WebView.

### 5. Vercel API Function Sentry

Add Sentry to backend Vercel API functions.

Likely implementation:

- Install `@sentry/node`.
- Add a shared helper such as `bam-portal/api/_sentry.js`.
- Initialize from `SENTRY_DSN` only in production.
- Use `environment=production`.
- Use `surface=vercel-api` for normal API routes.
- Use `surface=vercel-cron` for scheduled cron route actions.
- Capture backend exceptions through a shared route wrapper or centralized handler-level catch before returning 500 responses.
- Include tags like route, action, client ID, and integration name when safe.
- Flush briefly before a function exits after capturing an exception.

Important nuance: many existing API routes catch exceptions and return JSON 500 responses. Sentry will not reliably see those backend errors unless the backend catch path reports them. The desired implementation is centralized backend instrumentation, not frontend manual reporting.

Server-only env vars:

- `SENTRY_DSN` from `bam-portal-api`.
- `SENTRY_ENVIRONMENT=production`.
- `SENTRY_RELEASE` or a Vercel/git-derived release value.

Do not set `sendDefaultPii: true`; keep default PII disabled unless a separate privacy decision changes this.

### 6. Supabase Monitoring Boundary

Sentry may show:

- frontend errors thrown by the Supabase JavaScript client
- backend exceptions caused by Supabase REST/RPC/service-role calls
- server 500 paths where the Vercel API function captured the backend exception

This does not directly monitor Supabase's hosted Postgres/Auth internals. Supabase dashboard logs and Supabase telemetry remain the source of truth for platform-level database, auth, storage, and realtime failures.

## Copy Claude Prompt

Each row should include a copy-only prompt action. Do not try to launch Claude.

Prompt intent: diagnose and propose only. The copied prompt should not instruct the agent to implement changes by default.

Assume the engineer has Sentry MCP connected.

```text
Investigate this production BAM Portal Sentry issue using the Sentry MCP.

Issue: <title>
Sentry URL: <permalink>
Project: <project>
Surface: <surface>
Frequency: <count> events in the selected window
Last seen: <timestamp>

Diagnose the root cause from Sentry event details and the local repo. If this requires a code fix, propose the smallest safe fix and verification steps. Do not implement until asked.
```

## Data and Privacy

- Keep Sentry event payloads minimal.
- Leave `sendDefaultPii` off unless there is a deliberate privacy decision to enable it.
- Prefer IDs over emails/names in user context.
- Staff portal events may attach staff/user ID and role, but not raw staff email.
- Client portal events may attach client ID and client-user ID, but not academy name, raw email, phone number, or form payloads.
- API events may attach route, action, integration, client ID, and staff ID where safe; do not attach request bodies or raw secrets.
- Public web events should attach no user context unless a safe non-PII token/client ID already exists in that flow.
- Scrub query params that may include auth tokens or customer details.
- Treat source map upload tokens as CI/build secrets.
- Prefer a separate source-map/release token from the read-only issues token.

## Cost and Quota Guidance

Initial Sentry plan decision: start on Sentry Developer while event volume is unknown. Upgrade to Team when the portal needs more Sentry seats, more included monthly errors, or paid-plan integrations/admin features.

Sentry's public pricing, checked on 2026-06-08, lists:

- Developer: $0, one user, 5k errors/month.
- Team: $26/month when billed annually with default prepaid data, unlimited users, 50k errors/month.
- Business: $80/month when billed annually with default prepaid data, 50k errors/month plus stronger admin/quota controls.
- Logs, metrics, spans, replays, profiling, cron, uptime, and attachments have their own quotas or add-on costs.

MVP cost posture:

- Capture production error events only.
- Do not enable Session Replay.
- Do not enable Sentry Logs.
- Do not enable profiling.
- Keep tracing/performance either off or very low-sampled until there is a specific debugging need.
- Do not manually report frontend HTTP 400/500 responses as Sentry errors.
- Keep production-only initialization.
- Add inbound filters for known noisy browser extension errors and non-portal script URLs.
- Set Sentry spend/quota notifications before enabling production DSNs.

Risk: one noisy client-side loop, backend exception loop, or bad deploy can generate many repeated Sentry events. Sentry grouping helps make this usable, but billing still counts captured events. The safe rollout is to instrument production, watch the first few days of event volume, and then decide whether Developer is enough.

## Implementation Plan

1. Create `bam-portal-web` Sentry project and production DSN.
2. Create `bam-portal-api` Sentry project and production DSN.
3. Add production Sentry env vars in Vercel.
4. Add `api/app-errors.js?action=sentry-issues` with admin-only server-side Sentry API proxy.
5. Add the admin-only App Errors page with one combined Sentry issues list.
6. Add staff React Sentry SDK initialization.
7. Add client portal browser Sentry initialization.
8. Add Vercel API function Sentry helper/wrapper and apply it to API routes and cron actions.
9. Add source map upload for staff React; attempt static client/public page source maps only if it stays low-effort.
10. Verify Sentry ingestion without leaving persistent test triggers in the app.

## Open Questions

- Which Sentry organization slug, web project ID, and API project ID should the portal query?
- Which Sentry token names should be standardized in Vercel?
- App Errors page shows top 5 combined across web/API for MVP.
- Which API routes should receive the Sentry wrapper first if implementation is phased? Recommendation: wrap shared entrypoints broadly, then verify clients, tickets, Stripe/GHL, Slack/push, and cron routes.
- What is the allowed user context in Sentry? Decision: IDs only for MVP.
- Is native Capacitor crash reporting needed before app store launch? Recommendation: no for MVP unless native push/device-token issues become common.

## Acceptance Criteria

- Admin users can open an App Errors page in the staff portal.
- Non-admin users cannot see the page and receive 403 from provider proxy APIs.
- The page supports `Last 24h` and `Last 7d`, and rows disappear from a view when they have no matching errors in that selected window.
- The App Errors list shows at most 5 unresolved production Sentry issues sorted by frequency across `bam-portal-web` and `bam-portal-api`.
- Rows show project and surface chips so admins can tell staff app/client/mobile/API/cron apart.
- Sentry provider tokens are never exposed to browser code.
- Production staff-web errors include environment, release, and `surface=staff-web`.
- Production client-portal errors include `surface=client-web` in browsers and `surface=client-mobile-webview` in the Capacitor WebView.
- Production Vercel API exceptions include `surface=vercel-api`.
- Production Vercel cron route exceptions include `surface=vercel-cron`.
- A frontend API 400 or 500 response does not create a separate manually reported frontend Sentry issue unless it also causes a real frontend runtime error.
- Staff React source maps are available in Sentry. Static client/public source maps are best-effort and not required to ship MVP.

## References

- Sentry React SDK: https://docs.sentry.io/platforms/javascript/guides/react/
- Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
- Sentry JavaScript configuration options: https://docs.sentry.io/platforms/javascript/configuration/options/
- Sentry organization issues API: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Sentry API scopes: https://docs.sentry.io/api/permissions/
- Sentry Capacitor SDK: https://docs.sentry.io/platforms/javascript/guides/capacitor/
- Supabase Sentry client integration: https://supabase.com/docs/guides/telemetry/sentry-monitoring
- Supabase Edge Functions Sentry example: https://supabase.com/docs/guides/functions/examples/sentry-monitoring
- Vercel Functions overview: https://vercel.com/docs/functions/
- Sentry pricing: https://sentry.io/pricing/
- Sentry product trial help: https://sentry.zendesk.com/hc/en-us/articles/27815756501531-I-accidentally-started-a-Product-Trial-Spans-Replays-Profiles-or-Logs-what-happens-now
