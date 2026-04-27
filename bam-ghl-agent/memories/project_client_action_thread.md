---
name: Client Action Thread (multi-round)
description: Multi-round chat between staff and client on a ticket — schema, API, and UI mapping. Replaces single-shot client_action_request flow.
type: project
---

## Schema

`tickets.messages` (jsonb, default `[]`). Each entry:
```js
{
  direction: "staff_to_client" | "client_to_staff",
  body: "string (optional)",
  files: [{ name, url, size?, type? }],
  author_id: "staff.id (when staff)" | null,
  system: true | undefined,   // true for "(request cancelled)" markers
  created_at: "ISO timestamp"
}
```

GIN index `tickets_messages_gin` exists on the column.

## State machine

```
in_progress ──[Send to client]──► awaiting_client (status)
                                         │
                                         ├──[Cancel request]──► in_progress
                                         │   (system message appended)
                                         │
                                         └──[Client replies]───► in_progress
                                             (assigned_to preserved)
```

`assigned_to` is **not changed** by either request, cancel, or response — the originating staff member stays on the ticket.

## API actions (all under `/api/tickets`)

- `request_client` (staff PATCH, action=request_client) — appends staff_to_client message + sets status. Body: `{ client_action_request, files? }`. Keeps legacy `client_action_request` text column populated for back-compat.
- `cancel_client_request` (staff PATCH) — clears `client_action_request`, appends a system message, status → in_progress. Only works if current status is awaiting_client.
- `client_respond` (anon PATCH, public=1) — requires matching `client_id`; appends client_to_staff message, status → in_progress. Body: `{ client_id, client_action_response, client_action_files }`.

## UI

### Staff (SystemsView TicketModal)
- "Client conversation" section renders the messages array (oldest→newest), with a yellow "Awaiting client" banner + Cancel button when status=awaiting_client.
- Falls back to legacy `client_action_request`/`client_action_response` rendering if `messages` is empty (back-compat with pre-thread tickets).

### Staff (Overview tab)
- Awaiting_client tickets are pinned to the top of the list, get a yellow left border, gold background tint, "⏳ ACTION NEEDED" badge, and an inline "Cancel request" button.

### Client (`client-portal.html`)
- Live tickets list: action-required tickets get a yellow left border + "⏳ Action Needed" badge.
- Detail view: prominent yellow "Action needed" block at top with the latest staff question + a note textarea + file picker + "Send response" button. Below the form: ticket fields (read-only). Below that: full conversation thread.
- Response handler: `submitClientResponse()` — pulls note + files, hits `/api/tickets?action=client_respond&public=1`.

## Backward compatibility

- Old tickets without `messages` still render correctly (UI falls back to single `client_action_request` / `client_action_response` text fields).
- `request_client` and `client_respond` write BOTH the legacy text columns AND append to the new messages array, so a partial rollback (UI only) wouldn't lose data.

## Deferred TODOs

See `project_client_action_notifications_todo.md` — notifications (Slack/email/SMS) on send + reply.

## Files touched

- DB: migration `add_messages_to_tickets`
- `bam-portal/api/tickets.js` (extended request_client + client_respond, added cancel_client_request)
- `bam-portal/src/services/ticketsService.js` (added cancelClientRequest)
- `bam-portal/src/views/SystemsView.jsx` (thread render, Overview pin + badge + Cancel button)
- `bam-portal/public/client-portal.html` (action form, thread render, list badge)
