# V1.5 Inbox: SMS + Email tabs, and the import bug that starved them

2026-07-28. Zoran asked for email alongside SMS in the client portal: its own tab,
Read / Unread / Sent / Failed, mark-as-unread, newest first, **without changing V2**.

## What already existed (do not rebuild)

- Email store `email_threads` / `email_messages`, mirroring the SMS tables 1:1,
  including `unread` on threads and `status` + `last_direction` on messages.
- **Sending and replying to email from the portal already worked** in the V1.5
  composer: `_V15IB.type === 'Email'`, subject input `v15ib-subject`, POST to
  `/api/ghl/send-message` with `type: 'Email'`. It also replies on whatever
  channel the lead used (SMS / Email / IG / FB / WhatsApp).
- `unreadOnly` + `failedOnly` filters, most-recent sort, per-user `mark-read`.

## The import bug (PR #1622) - the real blocker

`api/ghl/cron-import-history` calls both importers with `Bearer CRON_SECRET`.
`import-ghl-history` (SMS) accepted it; **`email-import-ghl-history` did not**, so
every cron email import returned `401 "staff only"`. Since the stamp is
`sms.done && email.done`, `clients.ghl_history_imported_at` was **never** set for
anyone. The batch selects 3 candidates `WHERE imported_at IS NULL ORDER BY
ghl_connected_at DESC`, so the same 3 academies were retried forever and
positions 4-29 never ran once. Result: **0 of 26 V1.5 academies had any email
history**, for weeks.

**Gotcha for future audits:** a plain `select=client_id` over `sms_threads`
silently truncates at PostgREST's 1000-row default, which made it look like
V1.5 academies had zero SMS too. Use `Prefer: count=exact` per client.

## The allowlist gate (PR #1623)

`IMPORT_PILOT_CLIENT_IDS` (Vercel env, comma-separated uuids):
- the BATCH path considers ONLY those academies
- **a listed academy bypasses the V2/V1.5 tier filter**

The tier bypass is Zoran's explicit per-academy authorization to include a V1
academy (the hard rule requires an explicit instruction; naming an academy in the
env var is the auditable record of it). Currently set to HMS, GAME Winner, Sage,
Pro Precision, Basketball+. **Remove the env var to open the queue to the other
24 academies.**

## The tabs (PR #1624)

In `public/client-portal.html`, all behind `_v15ibChanTabsOn()` =
`V15_ACCESS && !V2_ACCESS`:
- channel tabs All / SMS / Email, which set `_V15IB.fChannels` so they reuse the
  SAME filter the Filters drawer already used. One filtering path, not two.
- status pills Read / Unread / Sent / Failed, mutually exclusive, counts scoped to
  the selected channel. `sentOnly` reads `lastMessageDirection`; `failedOnly`
  reuses `_V15IB_FAILED`.

**Persisted mark-unread:** `api/ghl/inbox?action=mark-unread` writes this user's
`ghl_conversation_reads` row with `last_read_at = 1970-01-01` (`MARK_UNREAD_AT`).
`applyReads` can never satisfy that against a real message date, and it forces
`unreadCount >= 1` so an outbound-only thread still shows a dot. Re-opening the
thread overwrites it via `mark-read`. Chosen over deleting the row (falls back to
GHL's count) and over a schema migration on the live DB.

## ⚠️ THE V1.5 INBOX CODE IS SHARED WITH V2

`_v15ib*` is not V1.5-only despite the name - V2 academies run the same inbox
(see `_v15ibVisibleChannels`, which branches on `isV2`). **Anything added there
must be tier-gated explicitly.** `_v15ibToggleMultiSelect` / `_v15ibBulkAction`
have no tier gate at all, so the read/unread persistence inside `_v15ibBulkAction`
is gated on `_v15ibChanTabsOn()` - V2 keeps the original local-only marking.
`applyReads`' new branch is inert unless a mark-unread row exists.

## State

| Academy | Tier | SMS threads | Email threads |
|---|---|---|---|
| Basketball+ | V1.5 | 271 | 96 |
| Pro Precision | V1.5 (flipped from V1 2026-07-28) | 33 | 33 |
| Sage Hoops | V1.5 | 29 | 28 |
| GAME Winner | V1.5 | 6 | 2 |
| Hoops Made Simple | V1.5 | 4 | 2 |
| BAM GTA | V2 | 1,253 | 518 |
| DETAIL Miami | V2 | 1,049 | 52 |

**Pro Precision was flipped to `v15_access = true`** so Nathan gets the Inbox
where the email composer lives. That visibly rearranges his portal: Inbox +
Contacts appear, Assets moves into Business Blueprint, Systems + Marketing
collapse under Support. Their `v15_config` is `{}` and contacts/pipelines were 0
at flip time, filling in via `cron-sync-contacts` / `cron-sync-pipeline`.

## Still open

- 24 academies fenced out by the allowlist.
- Inbound email is **not realtime**: `api/ghl/inbound-webhook.js` is SMS-only, so
  email arrives on the 10-minute `cron-import-history` tick.
- `status` is null on most outbound emails, so build "Sent" off `direction`, never
  off status. Failed is reliable.

See [[project_v15_rollout]], [[project_email_2way_mailbox_sync]].
