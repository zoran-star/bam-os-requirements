# Conversation-history import (plan)

**PLAN 2026-07-21 (Zoran).** Full detail: [`docs/conversation-import-plan.md`](../docs/conversation-import-plan.md).

**Gap:** `api/ghl/inbox.js` reads GHL conversations/messages LIVE every open; only the inbox-list is cached 12s (`ghl_inbox_cache`). Messages are never persisted, so the Twilio cutover (`contact_provider='portal'`) would lose all history.

**Fix:** portal-owned `ghl_conversations` + `ghl_messages` tables + `api/ghl/import-conversations.js` (backfill + incremental, resumable cursor, mirrors `api/ghl/cron-sync-contacts.js` rate-limit guards). Fire the conversation import **alongside** the contacts import on GHL connect (onboarding Contacts step - no new owner step). Inbox reads the store with GHL live fallback; **Twilio cutover gated on backfill complete**.

**Open Qs before build:** attachment media (GHL URLs expire), backfill depth (recent-first vs all), new tables (recommended) vs reuse. See [[project_detail_portal_native_plan]].

**BUILT 2026-07-21 (small):** the store + import + inbox-read + cutover catch-up ALL already existed (`sms_/email_` tables, `api/messaging/import-ghl-history.js` + email variant, inbox live-fallback, `migration-watch.js`). Only gap: it fired at Twilio-cutover, not on connect. Fix = migration `clients.ghl_history_imported_at` + new `api/ghl/cron-import-history.js` (V2/V1.5 GHL academies with marker NULL -> runs the existing imports, stamps when done; `?client_id=` forces one) + `vercel.json` cron `5-55/10` (offset from contacts cron). Connect GHL -> both land together within ~10 min; existing academies backfill automatically. V1 untouched. Activates on merge.
