# Hawkeye inbox routing: a flagged lead's reply belongs in the deck

**Built 2026-07-29** (branch `claude/hawkeye-inbox-routing-f75e37`). Two layers, client + server.

## The problem it fixes

A lead with a **pending** Hawkeye card could be answered from the regular inbox. When that happened:

| Lost | Why |
|---|---|
| Teach-on-edit (`agent_lessons`) | only fires inside the deck |
| Draft-vs-final audit (`agent_approvals`) | same |
| Card freshness | the card sat pending on a conversation a human had already handled |
| Double-text safety | a quiet-hours **parked** agent send (approved, `send_after` set) still fired later |

## Layer 1: client routing (`public/client-portal.html`)

- `_hawkIdxEnsure(maxAge=30000)` - 30s-TTL cache on `window._hawkIdx = { byContact, byConv, at }`, wrapping the EXISTING `_hmHawkFetch()` + `_hmHawkIndex()`. Home's inbox preview reads the same cache, so Home and the inbox can never disagree.
- `_hawkIdxClear()` - also nulls `_hmHawkP`. Called from `_hawkFlush()` (deck actions change the queues) and on every 409.
- `_hawkPendingFor(contactId, convId)` - sync read, returns the agent name or null.
- `_hawkGate409(status, j, contactId)` - shared 409 handler: clear index, toast, `_hk2Open(agent, contactId)`. Returns true when consumed.

**Instant redirect** (Zoran's call: redirect, not a warning) on the 3 conversation-open surfaces: `_v15ibOpenSplit` (desktop), `_v15ibOpen` (mobile), `_hmMsgPeek` (Home peek). Plus a gold eye chip (`.v15ib-hawk`, pixel-identical to Home's `.hm-ib-hawk`) on every flagged inbox row. `openV15Inbox` warms the index and repaints; `_v15ibPollTick` keeps it warm.

All 13 reply surfaces consume the 409 through `_hawkGate409`, with 3 deliberate exceptions:
- `_sendQueueFlush` - toast + DROP the queued text. A background offline flush must not open a popup, and re-queueing would retry forever.
- `_plSend` (payment link) - uses its own `_plStatus` line instead of a toast.
- `_memberCareSendReply` - NOT gated; sends `hawkeye_ack: true`. It IS a human-approved card send riding send-message, so gating it would deadlock.

## Layer 2: server backstop

`api/agent/_hawk-gate.js` (modeled on `_cancel-outbound.js`, deliberately NOT reusing `cancelAllSalesOutbound` - that sweep is far broader):

- `pendingHawkeyeCard(clientId, { contactId, phone })` -> `{ agent, card_id, contact_id } | null`. Booking -> confirm -> closing priority. Resolves a contact from `contacts.phone10`. **1200ms `Promise.race` ceiling, every error path returns null.**
- `cancelParkedHawkeye(clientId, contactId, reason)` -> count. PATCHes `status='canceled'` (the ONLY status it ever writes) where `status=approved & sent_at is null & send_after not null`. Never throws.

Wired into `api/ghl/send-message.js` after client load + validation, **before** the Meta/Twilio provider gates (they run before the GHL contact lookup, so this is the only spot covering all provider paths).

### The 409 contract

```
POST /api/ghl/send-message -> 409
{ "error": "hawkeye_pending", "agent": "booking"|"confirm"|"closing",
  "card_id": "<uuid>", "contact_id": "<ghl_contact_id>" }
```
- **SMS only.** Email and DM sends are never blocked (the UI redirect still steers staff).
- `hawkeye_ack: true` in the body skips the pending block (still cancels parked).
- Success bodies carry `canceled_parked: <n>` when n > 0. Cancel-parked runs on **all** channels, through a local `sendOk(payload, cid)` that all 6 success returns use, awaited (Vercel kills post-response work).

## Non-negotiables baked in

- **Fails open everywhere.** Unloaded index -> no redirect. Supabase blip or slow query -> no 409. Staff never get trapped behind an unsendable message.
- **Parked cards never 409.** They are invisible in the deck (`_hk2Load` filters `pending`), so a 409 would dead-end staff at an empty queue.
- The three agent APIs (`agent-approvals`, `agent-confirm`, `agent-closing`) send directly and bypass send-message on purpose. Do not gate them: no loop risk, and gating them would break the deck.
- V1 academies have zero agent rows, so the whole thing is inert for them.

## Bug fixed in the same pass

`#ib-approve-btn` and `#v15ib-approve-btn` hardcoded `onclick="_apxOpen()"`, so a V2 academy's own Hawkeye button opened the OLD approvals popup instead of the V2 deck. Both now call `_hk2Open()`, which self-falls-back to `_apxOpen` for V1/V1.5.

## Mock rig (`?mock=1`)

The mock `fetch` override now honors a `__status` field from a handler, and `mockApi` mirrors the gate for `/api/ghl/send-message`. Fixture conversations `cv-10` (`lead-3`, booking) and `cv-11` (`lead-9`, closing) are the flagged rows; everything else sends normally. Verified offline: chips render, all 3 open surfaces redirect, desktop + mobile forced sends 409 -> toast + deck with the draft kept, email + `hawkeye_ack` pass, cleared index = fail-open thread open.

## Known, out of scope

The deck's own render puts escalation cards first, so a redirect can land with the focused lead's card second on screen even though `_HK2.focusContact` moved it to the front of the queue. Pre-existing `_hk2Render` behavior, untouched here.
