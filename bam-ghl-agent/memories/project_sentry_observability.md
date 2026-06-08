# App Errors Observability

2026-06-08: Draft PRD added at `docs/sentry-observability-prd.md`.

Decision baseline:

- Admin-only, read-only App Errors page separate from Feedback.
- Access is all `role=admin` users only for MVP.
- Sentry-only MVP: App Errors reads Sentry issues across web + API projects, no Vercel Observability provider integration.
- Shared window control: `Last 24h` default plus `Last 7d`; rows disappear when they have no matching errors in the selected window.
- Do not write Sentry issues into Supabase for MVP.
- No "promote to Systems" workflow.
- Instrument production frontend/mobile with Sentry: staff Vite app, public client portal HTML, mobile WebView via hosted client portal.
- Instrument Vercel API Functions + cron routes with Sentry Node in MVP.
- Sentry MVP uses one `bam-portal-web` project separated by `surface` tags (`staff-web`, `client-web`, `client-mobile-webview`), not separate staff/client/mobile projects. Staff login/unauthenticated shell errors are pooled into `staff-web`.
- Sentry backend uses a separate `bam-portal-api` project with `surface=vercel-api` and `surface=vercel-cron`.
- Sentry org/project IDs: org `full-control`; base URL `https://us.sentry.io`; web project ID `4511527624638464`; API project ID `4511527636828160`. Store DSNs/tokens in Vercel env, not repo docs/code.
- App Errors shows top 5 combined across web/API for MVP.
- Do not add native Capacitor Sentry in MVP unless native plugin/lifecycle crashes become a real incident source.
- Supabase boundary: capture errors thrown by app/API code around Supabase calls; do not treat this as direct monitoring of hosted Supabase internals.
- Cost posture: start on Sentry Developer while event volume is unknown; upgrade when seats, volume, or paid-plan controls require it.
- Vercel cost posture: Pro has Observability Plus available/included with `$1.20 / 1M` extra events; events are request-driven, not error-only. App Errors querying should be negligible versus normal portal traffic.
- Sentry context: IDs only. No raw staff/client emails, academy names, phone numbers, or form payloads.
- Do not set `sendDefaultPii: true` in web or API Sentry init.
- No Sentry Session Replay in MVP.
- Source maps: required for staff React, best-effort/timeboxed for static client/public pages.
- Do not manually capture frontend HTTP 400/500 responses. Frontend SDK captures runtime errors; backend Sentry captures API/cron exceptions.
- Copy Claude prompt assumes Sentry MCP for all rows; diagnose and propose only, no default implementation instruction.

Read the PRD before implementing Sentry or changing the admin feedback/observability area.
