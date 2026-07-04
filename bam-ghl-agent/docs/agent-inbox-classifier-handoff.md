# Inbox Classifier Agent - Handoff

The client portal inbox now renders agent classification data. This doc specs exactly what the classifier agent needs to produce and where, so it wires directly into the existing frontend.

## What the frontend expects

The inbox fetches conversations from `GET /api/ghl/inbox?client_id=X`. Each conversation object in the `conversations[]` array can include these agent-populated fields:

```js
{
  // Existing GHL fields (already present)
  id: "conv_abc123",
  contactId: "contact_xyz",
  contactName: "John Smith",
  phone: "+15551234567",
  email: "john@example.com",
  lastMessageBody: "Hey I saw your ad...",
  lastMessageDate: "2026-07-04T14:30:00Z",
  lastMessageDirection: "inbound",    // "inbound" or "outbound"
  lastMessageStatus: "delivered",     // "sent", "delivered", "read", "failed", "undelivered"
  unreadCount: 1,

  // NEW: Agent classification fields
  classification: "lead",            // "lead" | "member" | "member_family" | "spam"
  offer_key: "youth_academy",        // machine key for the offer (optional)
  offer_label: "Youth Academy",      // display label shown as pill on the row (optional)
  matched_member_id: null,           // UUID from members table (when classification = "member_family")
  matched_member_name: null,         // display name e.g. "Marcus Johnson" (when member_family)
  agent_confidence: 0.92,            // 0-1 how sure the classifier is (shown in sidebar)
  spam_reason: null                  // brief reason if spam, e.g. "Auto-reply from Facebook"
}
```

## How the frontend uses each field

| Field | Where it shows | Behavior |
|---|---|---|
| `classification` | Segmented filter (All / Members / Leads / Spam) | Spam hidden from "All" by default, only visible when "Spam" filter tapped. "Members" filter includes both `member` and `member_family`. |
| `offer_label` | Gold pill badge on conversation row, next to name | Only renders if non-empty. Keep it short (1-3 words). |
| `offer_key` | Not rendered directly | For programmatic use (filtering, routing). |
| `matched_member_id` | Not rendered directly | For linking to member profile when clicked. |
| `matched_member_name` | Purple pill badge: "[Name]'s family" | Only shown when `classification = "member_family"`. |
| `agent_confidence` | Contact sidebar (right panel in thread view) | Shows as "AI confidence: 92%". Only in sidebar, not on list rows. |
| `spam_reason` | Not rendered yet (future: tooltip on spam pill) | Store it, frontend will use it later. |
| `lastMessageDirection` | Arrow icon on list row | Inbound = gold left arrow (they're waiting). Outbound = muted right arrow (you replied). |
| `lastMessageStatus` | Checkmark icons on outbound message bubbles | `sent` = single gray check. `delivered` = single check. `read` = green double check. `failed` = red X circle. |

## Where to write the data

Option A (recommended): Enrich the GHL inbox API response. The agent runs as a post-processor on `api/ghl/inbox.js` - after fetching conversations from GHL, loop through and classify each one, then attach the fields above before returning.

Option B: Write classifications to a Supabase table (e.g., `conversation_classifications`) keyed by `(client_id, conversation_id)`, and have the inbox API join them in.

Either way, the frontend just reads whatever fields are on the conversation objects in the `conversations[]` array.

## Classification logic the agent should implement

### 1. Member detection
- Match `contactId`, `phone`, or `email` against the `members` table
- If direct match: `classification = "member"`
- If no direct match but a member shares the same `last_name` and the phone is from the same area code, or the message mentions a member by name: `classification = "member_family"`, populate `matched_member_id` and `matched_member_name`

### 2. Lead detection
- Not a member or member_family
- Has a real conversation (not auto-generated)
- Try to match the message content to an offer:
  - Keywords like "training", "sessions", "academy" -> youth_academy
  - "camp", "clinic", "summer" -> camps
  - "rent", "space", "court" -> rental
  - "tournament", "league" -> tournament
  - etc.
- Set `offer_key` and `offer_label` if a match is found

### 3. Spam detection
- Auto-replies from platforms (Facebook, Google, Instagram system messages)
- Marketing emails / newsletters
- Messages with no real content (just links, empty)
- Automated notifications from payment processors
- Set `spam_reason` to explain why

## Message direction and status

The frontend now renders `lastMessageDirection` and `lastMessageStatus` from the GHL conversation object. These should already be present in GHL's API response. If not:

- `lastMessageDirection`: Derive from the most recent non-activity message. Check `message.direction` field.
- `lastMessageStatus`: GHL tracks delivery status per message. Map to one of: `sent`, `delivered`, `read`, `failed`, `undelivered`, `error`.

## Typing indicator

The frontend checks `window._ibAgentTyping` (boolean). When the agent is actively processing/drafting for a conversation, set this to `true` via a Supabase Realtime subscription or polling endpoint. The thread view shows a "..." animation.

## Browser notifications

When a new inbound message arrives (via Realtime or polling), the frontend will:
1. Play the chime sound (unless muted)
2. Show a browser notification (if permission granted and tab not focused)
3. Update the page title with unread count: "(3) BAM Business"

The agent doesn't need to trigger these - they fire automatically when the conversation list refreshes with new unread items.

## Sound triggers (already wired)

| Sound | Trigger | Function |
|---|---|---|
| `_SFX.chime()` | New unread messages on inbox load | Automatic |
| `_SFX.whoosh()` | Message sent successfully | Automatic |
| `_SFX.buzz()` | Failed messages detected | Automatic |
| `_SFX.pop()` | Trial booked (available for agent to call) | Call from agent |
| `_SFX.pulse()` | Overdue action items | Automatic |
| `_SFX.kaching()` | Revenue milestone | Automatic |
| `_SFX.levelUp()` | Tier milestone | Automatic |
| `_SFX.fanfare()` | Personal record beaten | Automatic |

## Testing

To test the frontend rendering without the agent, manually add fields to a conversation object in `api/ghl/inbox.js` before returning:

```js
// Temporary test - add to first conversation
if (conversations[0]) {
  conversations[0].classification = 'lead';
  conversations[0].offer_label = 'Youth Academy';
  conversations[0].lastMessageDirection = 'inbound';
  conversations[0].agent_confidence = 0.88;
}
```

The segmented filter, pills, sidebar, direction arrows, and timestamp urgency will all render immediately.
