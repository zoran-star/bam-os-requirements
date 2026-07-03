# Meta DM spine - Instagram + FB Messenger off GHL

**Status: increments 1-3 built 2026-07-03 (dormant). Waiting on Meta app dashboard config + staff token reconnect before wiring GTA.**

## Why
GTA's IG/FB DMs only lived in GHL. Phase 0 (same day) made them visible again via
a GHL passthrough in the store inbox ([[project_inbox_offghl_classify]]); this
spine replaces that passthrough with direct Meta - the social sibling of
[[project_twilio_messaging_spine]] (SMS) and [[project_email_spine]] (email).

## Built (increments 1-3 of 4)
1. **Migration `20260703170000_meta_dm_spine.sql`** (applied to prod):
   - `client_meta_messaging_config` - per-academy: page_id, ig_user_id,
     page_token_enc (AES via MESSAGING_ENC_KEY), status pending|active|disabled.
     Service-role only (RLS, no policies).
   - `dm_threads` / `dm_messages` - own-store, channel instagram|facebook,
     keyed on (client_id, channel, psid). psid = Meta page-scoped user id
     (IGSID/PSID). `meta_message_id` (mid) = idempotency key for webhook retries.
     `ghl_contact_id` nullable until increment 4 mints/matches contacts.
2. **`api/meta/inbound-webhook.js`** - GET = hub.challenge handshake
   (META_DM_VERIFY_TOKEN); POST = X-Hub-Signature-256 verified (raw body +
   META_APP_SECRET, bodyParser off). Stores messages incl. echoes
   (`sent_by='meta-native'` for staff replies from the IG app / Business
   Suite), best-effort profile lookup for names, owner notify on inbound.
   Only status='active' configs store (pending = still wiring, GHL
   passthrough remains the single source). Always 200s the batch.
3. **`api/meta/connect.js`** (staff-only POST): action=pages (picker) /
   wire (derive Page token + IG id from the staff ads token, encrypt, store
   pending, POST subscribed_apps) / activate / status.
4. **Scopes** added to META_OAUTH_SCOPES in marketing.js: pages_show_list,
   pages_manage_metadata, pages_messaging, instagram_basic,
   instagram_manage_messages. **Staff must reconnect Meta after deploy.**

## Env
- `META_DM_VERIFY_TOKEN` - set in Vercel prod 2026-07-03 (value in Vercel env;
  needed once in the Meta app dashboard webhook config).
- Reuses META_APP_SECRET, MESSAGING_ENC_KEY.

## One-time Meta app dashboard steps (Zoran/admin, app 2059912628202822)
1. Add products **Messenger** + **Instagram** → Webhooks.
2. Callback URL `https://portal.byanymeansbusiness.com/api/meta/inbound-webhook`,
   verify token = META_DM_VERIFY_TOKEN value, subscribe field **messages** on
   objects **page** AND **instagram**.
3. Staff Settings → reconnect Meta (token picks up messaging scopes).
4. POST /api/meta/connect action=wire for GTA (page "By Any Means GTA"), then
   send a test IG DM, check dm_threads, then action=activate.

## Remaining (increment 4 + inbox/send)
- Inbox read: list dm_threads in the store inbox; when config active, exclude
  ig/fb from the GHL passthrough (dedupe).
- Send: Graph API POST /{page_id}/messages via page_token_enc; 24h window;
  wire into send-message.js TYPE_MAP branch.
- Contact mint/match (resolveOrMintPortalContact) + pipeline bounce +
  cancel-drafts side-effects (copy twilio/inbound-webhook.js pattern).
- Agents channel-aware replies (they hardcode SMS today).
- GHL DM history import (mirror import-ghl-history.js).

## Gotchas
- Standard Access + app-role token user = works without App Review (same trick
  as ads). The `human_agent` tag (7-day reply window) WOULD need review; stay
  within 24h replies.
- Graph version pinned v22.0 in both new files - keep in step with
  marketing.js META_API_VERSION.
- Meta retries non-200 webhook deliveries aggressively - the webhook never
  500s a batch; per-entry try/catch.
