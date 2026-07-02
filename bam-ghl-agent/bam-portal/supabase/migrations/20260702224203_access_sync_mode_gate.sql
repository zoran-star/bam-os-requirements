-- Phase 5 access sync gate (offer tie-in step C). Per-academy rollout switch
-- for mirroring Stripe payment lifecycle into typed access
-- (api/_runtime/access-sync.ts, called from api/stripe/webhook.js).
--   off (default) - dormant, webhook behavior unchanged
--   shadow        - full read path, no writes, audit-only
--   on            - writes; webhook returns 5xx on sync failure so Stripe retries
alter table public.clients
  add column if not exists access_sync_mode text not null default 'off'
  check (access_sync_mode in ('off','shadow','on'));
