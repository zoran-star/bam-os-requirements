# Meta DM spine - Instagram + FB Messenger off GHL

**Status 2026-07-03 EOD: GTA WIRED + ACTIVE. FB Messenger PROVEN end-to-end
(real inbound stored in dm_threads). Instagram blocked on Meta App Review
(Advanced Access) - that's the next session's job. Leads' IG DMs meanwhile
still visible via the GHL passthrough in the inbox.**

## Session results (2026-07-03 evening)
- GTA config ACTIVE: page 130045040185267 "By Any Means GTA",
  ig_user_id 17841465712982249 (@byanymeansgta), page token encrypted+stored.
- App dashboard done by Zoran: Messenger + Instagram products, webhook
  callback verified (both objects), page connected, **App Mode = LIVE**,
  privacy policy URL = https://www.byanymeansbball.com/privacy-policy,
  Facebook Login redirect whitelisted:
  `https://staff.byanymeansbusiness.com/api/auth/staff-meta/callback`.
- Staff Meta token is now ZORAN's (all ads + messaging scopes, expires
  2026-09-01). Ximena's old token (ads_read only) EXPIRES 2026-07-13 - fine,
  Zoran's is the newest team token and sees the 27 ad accounts.
- **PROOF:** FB Messenger message from Zoran ("yo") delivered → dm_threads
  row channel=facebook with contact_name resolved. Webhook self-test with a
  signed fake IG payload also stored fine. The spine WORKS.

## Gotchas discovered (important)
1. **Dashboard "Verify and save" does NOT subscribe fields.** App-level
   subscriptions existed with NO fields → zero deliveries. Fixed via
   `POST /{app-id}/subscriptions` (object=instagram|page, fields=messages,
   app token `id|secret`). Check with
   `GET /{app-id}/subscriptions?fields=object,callback_url,active,fields`.
2. **Standard Access only delivers app-role senders.** Zoran's FB = app
   admin → FB message delivered. His personal IG = no app role → IG DM
   silently dropped. The old IG "connected tools" toggle no longer exists
   (default-on for pro accounts). For the public (real leads) we need
   **Advanced Access via App Review** for `instagram_manage_messages` +
   `pages_messaging` (likely + Business Verification).
   Interim IG test option: App Roles → Instagram Testers → add a personal
   IG handle → accept in IG app → that account's DMs then deliver.
3. `vercel logs <deployment-url>` attached to a stale deployment shows
   nothing - trust the DB, or fetch the current URL first.
4. `vercel env pull` values can carry a trailing literal `\n` - strip it
   before using pulled values in scripts.
5. GHL is NOT in the page's subscribed_apps list (only BAMPORTAL) - GHL
   receives IG via its own app-level plumbing; unaffected by ours.

## NEXT SESSION: Meta App Review submission
Goal: Advanced Access for `instagram_manage_messages` + `pages_messaging`
(check `pages_manage_metadata` too) on app 2059912628202822.
Prep needed:
- App Review → Permissions and Features → request Advanced Access on those
- Screencast: staff portal inbox receiving + replying to an IG DM (can film
  after adding an Instagram Tester so the DM actually flows), plus a written
  use-case ("academy staff answer their own customers' DMs in our portal")
- Settings → Basic completeness: icon, category, privacy policy (done),
  data deletion instructions URL (may need to add)
- Business Verification in Business Manager if Meta asks
- While waiting: build increment 4 (inbox reads dm_threads + Graph send +
  passthrough dedupe) so everything ships the moment review passes.

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
