---
name: Marketing + Content workflow (live in client + staff portals)
description: Two-stage ticket lifecycle — client submits raw assets → content team produces final creative → marketing team launches campaign. Tables, API, UI surfaces, round-trip revision flow, all the moving parts.
type: project
---

## The shift

Clients **don't** submit finished creatives. They submit **raw assets** (graphics, video, notes) and the **content team** turns them into the finished creative. Once the content team uploads finals and hits "Send to Marketing," the **marketing team** sees them and launches the campaign.

## Tables

### `marketing_tickets` (existing)
Ad-campaign requests that marketing team works on. Columns we added during this build:
- `awaiting_revision boolean default false` — true while sent back to content for a revision round, hidden from staff's Active tab
- `originated_from_content_ticket_id uuid → content_tickets(id)` — traceability

`content_check_status` column is now **vestigial** (always `not-required` for content-spawned marketing tickets). Don't surface it in UI.

### `content_tickets` (new this session)
Raw asset packages awaiting content team production.
- `type text` — `graphic` | `video` | `mixed` (mixed = mega-ticket from new-campaign wizard bundling multiple sub-creatives in `context.creatives`)
- `status text` — `active` | `client-dependent` | `completed` | `cancelled`
- `client_action_status text` — `none` | `requested` | `responded`
- `raw_files jsonb` — what the client uploaded
- `final_files jsonb` — what the content team produced
- `context jsonb` — campaign metadata for spawning the eventual marketing ticket: `{ source, campaign_title, offer, monthly_spend, landing_page, related_creative_name, creatives[] }`
- `marketing_ticket_id uuid → marketing_tickets(id)` — set when content team has sent to marketing (or, pre-set on revision spawns so the round-trip closes by UPDATING the original marketing ticket rather than INSERTing a new one)
- `messages jsonb` — activity feed
- `sent_to_marketing_at`, `resolved_at`, `submitted_at`, `updated_at`

RLS: clients scoped via `clients.auth_user_id`; staff via membership in `staff`.

## API — single file: `bam-portal/api/marketing.js`

Route by `?resource=`:
- `?resource=tickets` — marketing tickets (existing)
- `?resource=guide-cards` — guide cards
- `?resource=content-tickets` — content tickets (new)

Marketing tickets PATCH actions:
- `approve-content` (legacy, unused)
- `request-client-action`, `mark-completed`, `cancel`, `edit`, `respond`
- `request-content-revision` (new) — sets `awaiting_revision=true` on the marketing ticket AND inserts a new content ticket with `marketing_ticket_id` set to the original. When the content team sends THAT one back, the original marketing ticket is updated in-place (files replaced, `awaiting_revision=false`), not duplicated.

Content tickets PATCH actions:
- `upload-final` — append final files
- `send-to-marketing` — flow: if `marketing_ticket_id` is set (revision round), UPDATE that marketing ticket. Else INSERT a fresh marketing ticket. Accepts optional `marketing_notes`.
- `request-client-action`, `mark-completed`, `cancel`, `respond`

Vercel rewrites keep frontend URLs stable: `/api/marketing-tickets` and `/api/guide-cards` still work.

**Hobby plan cap**: max 12 serverless functions per deployment. Our merges to stay under: marketing-tickets + guide-cards + content-tickets all live in `api/marketing.js`; asana-import folded into `api/asana/tasks.js` via `?import=1`.

## Client portal (`bam-portal/public/client-portal.html`)

### Marketing tab → Change campaign
- Per-creative tile: `✕` button (delete) replaces old pencil + Replace/Remove submenu.
- `+ Add new creative` opens the "Input assets" modal → graphic/video toggle, multi-file, notes → creates a **content ticket** (not a marketing ticket).
- Delete (`✕`) + Budget change still go **straight to marketing** (skip content).

### + Add new campaign wizard
Step 3 lets the client stack multiple creative blocks (each with type/files/notes). Submit creates a SINGLE mega content ticket of type `mixed`, with all sub-creatives in `context.creatives`. Budget min $1 enforced.

### "Track what's in flight" tracker
Merges marketing tickets + content tickets. Row kinds:
- `marketing` — normal marketing tickets
- `content-in-production` — `content_tickets.status='active'`, no action needed
- `content-action-needed` — `content_tickets.client_action_status='requested'`

Each row shows a 3-letter code chip (first 3 chars of UUID), e.g. `E1F`. Completed/cancelled tickets never show the "Action needed" treatment.

### Detail page
Inline "Respond" form appears at the bottom when action is needed (marketing or content). Supports textarea + multi-file drop. Files are uploaded to Supabase Storage and referenced at the end of the response message body.

Header shows: `[CODE] · Campaign · Submitted [date] · Last activity [relative]`

## Staff portal (`bam-portal/src/`)

### MarketingView.jsx
Tabs: **Active** · **Client Dependent** · **Completed**. (Content Check Required tab was removed.)
- Active filter excludes tickets with `clientActionStatus='requested'` and `awaiting_revision=true`.
- Detail action buttons: **Request Client Action**, **Mark Completed**, and **↩ Request Content Revision** (only shown when ticket has files i.e. came from content). Revision opens a modal with notes, sends, ticket leaves Active.
- "Client Action Required" tab renamed to "Client Dependent."

### ContentView.jsx
Top-level tabs: **Tickets** (default) | **Guide cards**. Tickets tab has sub-tabs Active / Client Dependent / Completed. Ordered oldest first (FIFO).

Detail view: download raw files, upload finals (multi-file), **Send to Marketing** modal with optional notes for marketing team. Once sent, ticket completes and the marketing-side ticket is created (or updated for revision rounds).

## Auth quirks

- `staff.user_id` was NULL for several legacy rows. Backfilled by matching `staff.email` to `auth.users.email`.
- A single auth user can be BOTH staff and a client (e.g. Zoran owns `test_business` AND is admin staff). API takes a `?scope=staff` or `?scope=client` query param on GET to disambiguate. Client portal sends `scope=client`; staff portal sends `scope=staff`. PATCH actions are gated by which role is required.

## Storage

Bucket `ticket-files` has been expanded:
- 22 allowed MIME types (was 5) — adds video/mp4, video/quicktime, video/webm, audio, .psd, .ai, .zip
- 500MB file size limit (was 10MB)

Upload paths:
- Content ticket raw files: `marketing-tickets/...` (originally for marketing ticket files, name stuck)
- Content ticket finals: `content-tickets/{ticket_id}/...`
- Guide card example assets: `guide-cards/...`

## Pending (round 2)

- **Client-side edit of active tickets**: click an active ticket → edit all fields → changes show in activity feed. API already supports `action: 'edit'`. UI not wired yet.
- **Email/SMS notifications** when ticket state changes (Slack DM staff, email client). Pre-launch checklist.
- **Real-time updates**: ticket changes don't push to either portal — relies on user refresh or navigation. Could use Supabase Realtime subscriptions later.
- **Per-client storage isolation** (signed URLs). Bucket is public; URL paths random UUIDs. Tighten before scaling.

## Test data

- Client `test business` (id `71d01c0f-...`, auth user `543cc072-...`, email `zoransavic2000@gmail.com`) is the safe sandbox. Use this account on the client portal.
- Same user is also Zoran's admin staff row, so the dual-role scope logic kicks in. Sign in to bam-portal-tawny.vercel.app as staff with `zoran@byanymeansbball.com` / `systems` to access staff side as pure-admin.
