-- Direct-key Stripe transport: storage for academies whose Stripe cannot be
-- reached via Connect OAuth (platform-controlled accounts, e.g. CoachIQ).
-- Approved plan 2026-07-31 (Zoran): ONE member management system, two
-- transports; the ONLY files allowed to read these tables are
-- api/_stripe-transport.js (resolver), api/stripe/direct-key.js (staff key
-- entry) and api/stripe/ensure-academy-webhook.js (endpoint registration).
-- Anything else referencing them is a fork and fails the one-doorway scan in
-- api/_stripe-transport-parity.test.mjs.
--
-- INERT WHEN APPLIED: zero rows exist until staff saves a key, and no shipped
-- code path reads the tables until the transport build merges.

-- The academy's own restricted API key (encrypted) + everything the resolver
-- needs to route calls to their account without Connect.
CREATE TABLE IF NOT EXISTS public.client_stripe_direct (
  client_id            uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','disabled','invalid')),
  -- base64(iv[12] | tag[16] | ct), AES-256-GCM, key = env STRIPE_DIRECT_ENC_KEY
  -- (dedicated module api/_stripe-direct-crypto.js; NEVER MESSAGING_ENC_KEY, so
  -- a messaging key rotation can never brick Stripe or vice versa).
  secret_key_enc       text NOT NULL,
  secret_key_last4     text,          -- display only, never the key
  publishable_key      text,          -- pk_live_..., pasted by staff (not derivable from rk_)
  livemode             boolean NOT NULL DEFAULT true,
  stripe_account_id    text NOT NULL, -- acct_..., captured from GET /v1/account at save time
  capabilities         jsonb,         -- entry-time probe results {customers:true, payouts:false, ...}
  key_last_verified_at timestamptz,   -- stamped by resolver health reads + hourly cron-key-health
  created_by           uuid,
  created_by_name      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- The resolver reverse-looks-up by account id (call sites pass acct_..., not client_id).
CREATE UNIQUE INDEX IF NOT EXISTS client_stripe_direct_account_idx
  ON public.client_stripe_direct (stripe_account_id);

-- Service-role only: RLS enabled with NO policies. The browser anon key must
-- never be able to read an encrypted payment credential (the RLS-less receipts
-- table was caught by an adversarial tester 2026-07-30; not repeating it).
ALTER TABLE public.client_stripe_direct ENABLE ROW LEVEL SECURITY;

-- Per-academy webhook endpoints (direct academies only). Connect academies
-- keep the single platform endpoint; these rows exist because a direct
-- academy's events arrive at ITS endpoint signed with ITS whsec_ secret,
-- routed to us by the opaque token in the endpoint URL (?t=<token>).
CREATE TABLE IF NOT EXISTS public.stripe_academy_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  token            text NOT NULL UNIQUE,  -- crypto-random routing token carried in ?t=
  endpoint_id      text,                  -- we_... on the ACADEMY account (null = half-created, see ensure-academy-webhook crash recovery)
  secret_enc       text,                  -- whsec_..., AES-256-GCM via the same dedicated module (secret is returned ONCE at creation)
  enabled_events   jsonb,
  registered_at    timestamptz,
  last_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_academy_webhooks ENABLE ROW LEVEL SECURITY;
