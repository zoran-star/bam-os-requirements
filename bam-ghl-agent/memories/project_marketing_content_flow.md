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

## Shipped since round 1

- ✅ **Client-side edit of active tickets** (commit `9f0db36`)
- ✅ **Load More pagination** on tickets + marketing requests (commit `7e978f1`)
- ✅ **Uniform Slack notifs** across marketing + content + systems — 9 triggers, `{emoji} {Action} — {Type} [CODE]` template (commits `02b7a0a`, `b554c98`)
- ✅ **Internal message filter** — staff-team chatter (revision handoffs, upload-final, send-to-marketing notes) flagged `internal: true` and filtered out on client GET (commit `b554c98`)
- ✅ **500MB upload guard + Google Drive link fallback** — clients pick over-limit files → popup + Drive link input. Synthetic `{name: 'Google Drive link', mime: 'text/uri-list'}` entry in raw_files (commit `a109348`)
- ✅ **Revision tickets carry original raw_files** — when marketing requests revision, the spawned content ticket merges parent content ticket's raw_files with the marketing creative (commit `085d443`)
- ✅ **Snapshot files before modal close** (bug: `closeInputAssetsModal()` was wiping `_inputAssetsState.files` before upload — commit `9f2f42e`)
- ✅ **Systems modal refetches on open** so staff sees fresh client replies (commit `19cc6e2`)
- ✅ **Public self-serve onboarding** at `/onboarding.html` — see `[[project_public_onboarding]]`

## Pending (round 2)

- **Email/SMS notifications** when ticket state changes. Slack ✅ done; email/SMS still needed for clients without Slack. Pre-launch checklist.
- **Real-time updates** (Supabase Realtime subscriptions) so both portals refresh without manual reload.
- **Per-client storage isolation** (signed URLs) on `ticket-files` bucket — currently public.
- **Cleanup orphaned test tickets/files** for DETAIL Miami (~4 empty content tickets, ~8 orphan files from Mike's testing 2026-05-15).

## Cam marketing flow — priority, deadline, assignment, DMs (added 2026-06-16)

From a team call with Cam. Goal: each marketing ticket is a complete brief + real alerts, so Cam stops chasing Mike for offers and Google Drive for files. Option A ("V1 lite" — surface what exists + add light collection; full offer-pairing is V2). Lives on branch `feat/marketing-content-flow`.

**Priority** — stored on `marketing_tickets.fields.priority` = `high` | `normal` (jsonb, no schema change; absent → normal).
- Client sets it via an **"⚡ Mark as urgent"** checkbox on the new-campaign wizard's final step → rides in content-ticket `context.priority` → copied into `mktFields.priority` on send-to-marketing handoff.
- SLA turnaround: **High = 3 business days, Normal = 5** (`PRIORITY_META`/`deadlineInfo`/`bizDaysUntil` in `MarketingView.jsx`). Staff view shows a priority chip + auto "Due in N biz days / Overdue", a red left-border on urgent rows, and a **"Priority (urgent first)"** sort (now the default).

**Assigned SM** — `marketing_tickets.assigned_to` (uuid → staff). Auto-set to the client's `scaling_manager_id` on every new marketing ticket (both direct create + content handoff). `enrichWithClient` resolves it → `assigned_to_name`; the staff detail's **Client card** shows "Assigned SM". Decision: SM = the client's assigned manager.

**Client card (staff detail)** — `renderClientInfo` surfaces client site (`clients.brand_data.website_url`), landing page (`fields.landing_page`), offer name. No landing page → one-tap **"Ask SM for landing page"** copies a Slack-ready message (the V1 stopgap from the call). API client join widened to return `brand_data, scaling_manager_id`.

**Alerts (Slack)** — `postStaffSlackDM(slackUserId, …)` DMs a staff member (Slack accepts a user ID as `channel`).
- New marketing ticket → DM **Cam** (`pingMarketingOnNewTicket`). Cam's id from env `MARKETING_DM_SLACK_ID`, else `staff` row by email (`MARKETING_MANAGER_EMAIL`, default `cameron@byanymeansbusiness.com`).
- Completion → client pinged in-channel (existing) **+ assigned SM gets a DM**.
- ⚠️ **No `staff.slack_user_id` is populated yet** (all rows null) — DMs no-op silently until Cam's Slack ID is set (env var or his staff row). This is the one thing blocking alerts from firing.

Not done (deferred): stale-ticket nudge cron; urgency toggle on budget/remove flows (default normal); linking tickets to the real `offers` record (= V2); merging Content+Marketing into one page (open question, kept separate for V1).

## Folder uploads + content-drop redesign (2026-06-18)

- **Folder-first content drop:** the new-campaign wizard's "Input assets" step is now **named folder blocks** (not "Creative 1/2/3"). Each block: a folder name, an "Upload assets or folder" zone (webkitdirectory; **flattened — no nesting**), a link, optional notes. Starts with one. `+ Create new folder` adds blocks. `wizardSetFolderName`. At submit each block's files get `file._folder = block.name`.
- **raw_files carry `folder`:** `_mreqUploadFiles` reads `_assetFolderOf(file)` (file._folder OR top dir of webkitRelativePath) → stores `folder` on each raw_file + nests the storage path. The Add Creative modal also has folder support.
- **Staff sees folders grouped + collapsible:** `ContentView.FilesByFolder` groups raw files by `folder` under `<details>` (collapsed by default on staff; client staging open).
- **Asset type toggle REMOVED** (wizard + Add Creative modal). Type auto-derived from files via `_deriveAssetType` (graphic/video/mixed).
- **Video thumbnails:** staff `FilePreviewTile` + MarketingView final-creatives render videos as a `<video src=…#t=0.5 preload=metadata>` poster frame + ▶ badge (no server processing).
- **🎨 Brand card on content tickets:** `ContentView` shows a collapsible Brand card (`BrandCard`) reading `ticket.client.brand_data` — colors (`color_primary/secondary/accent`), fonts (`font_display/body`), logos (`logo_dark/light_url`, `icon_url`), website, notes/stats.
- **Organic content** is a whole separate pipeline now — see [[project_organic_content]].

## Resource guide cards (PDF placeholders) — 2026-06-23

- 3 client-facing PDF guides ship as static assets in **`bam-portal/public/resources/`**:
  `bam-paid-ads-explained.pdf`, `bam-organic-content-explained.pdf`, `bam-first-campaign.pdf`.
  Source/editable copies live outside the repo in `~/Documents/BAM Business/Resources/Content/Content Starter Pack/Portal Guides/`
  (built via the `bam-business-design` brand from the 3 walkthrough scripts). PLACEHOLDERS until Cam edits the walkthrough videos.
- Rendered as default-collapsed `<details class="guide-card">` cards in `client-portal.html`:
  **Ads screen** (top of `#marketing-list .content`) = Paid Ads card then First Campaign card; **Organic screen** (top of `#marketing-organic`, after the back btn) = Organic card.
  `.guide-card` CSS sits just above the `#marketing-channel-split` styles. Cards only show where the screen shows (ads need `MARKETING_INCLUDED`, organic needs `ORGANIC_CONTENT`).
- Update (2026-06-23, gating): the 3 static PDFs were REMOVED from `public/resources/`.
  Each guide card's "Open guide" button now calls `_openGuideResource('<keyword>')`
  (paid ad / first campaign / organic) which opens the matching Resources-tab entry
  in-portal (login-gated). Cam added the 3 guides to the Resources tab manually.
- Update (2026-06-24, Zoran): cards now expand to the **full walkthrough INLINE**
  (`.gc-step` numbered steps in the card body) so clients read how-to-get-started without
  clicking away from the Marketing/Organic flow. Pill relabeled `GUIDE`; `_openGuideResource`
  is now a small secondary "Open the printable PDF" link at the bottom of each card.

## Resources gated behind login — 2026-06-23

- The **`resources` bucket is now PRIVATE** (migration `20260623210000_resources_private_gate.sql`).
  Storage + table SELECT are **authenticated-only**, so files no longer open for "just anyone."
- Client portal serves resource files via **short-lived signed URLs** (`createSignedUrls`, 1h):
  `_signResourceFiles(paths)` fills `_resourceSignedUrls` cache before `renderResourceDetail`
  (now async); `_resourceFileUrl(path)` is a sync cache lookup. Deep link `#resource=<id>`
  routes to the Resources view on boot (added to `boot()`), opening that resource.
- **Share link** = login-gated deep link `https://portal.byanymeansbusiness.com/client-portal.html#resource=<id>`
  (staff ResourcesView `shareUrlFor`). Opening it requires the client to be logged in.
- **Decorative content-block images** moved to a separate PUBLIC bucket **`resource-block-images`**
  (`BlockImageUpload`), since they need a stable public URL and aren't the gated deliverable.
  ⚠️ Any PRE-existing image-block uploaded into the old private `resources/_blocks/` path will
  404 - re-upload it (likely none exist; Convert makes text blocks only).

## Multi-format guide cards (angles) — Phase 1, 2026-06-25

`guide_cards` (1 per offer; shown in the client new-campaign wizard) is going **multi-format**.
- **Schema** (migration `20260625120000_guide_cards_angles.sql`): added `angles jsonb default '[]'`
  + `is_default bool`. **Legacy columns kept** (purpose/filming_tips/example_script/example_assets).
  Backfill wrapped each card's old content into `angles[0].video`.
- **Model:** `angles[] = { name, purpose(shared), video|null, graphic|null }`; each execution =
  `{ segments:[{label,text}], tips, example_assets[] }`. Leaf a client/ticket cares about = **angle × medium**.
  Depth rule: 1 accordion (angle) + 1 toggle (medium); beats/examples flat-labeled. Never a 3rd collapse.
- **`is_default`** flags the one card the "First Campaign" top card will render (Phase 2). API enforces
  only-one-default (clears others on set). API GET/POST/PATCH accept `angles`+`is_default`.
- **Phase 1 (done):** staff editor in `ContentView.jsx` `GuideEditor` rebuilt — angle repeater
  (`+ Add angle`, preset chips, Video/Graphic toggle, per-execution segment beats + tips + `ExecAssetGrid`).
  On save it ALSO writes flattened legacy fields (`flattenAnglesToLegacy`) so the current client wizard
  render (reads legacy) keeps working untouched.
- **Phase 2 (next):** client wizard renders the angle-accordion; "First Campaign" top card reads `is_default`.
- **Phase 3:** "Recommended angles → creative blocks" — each angle×medium pre-seeds a creative block
  tagged `guide_card_id`+`angle`+`medium` on the content ticket. **Decision: Ads-only for now** (organic
  flow unchanged; model future-proofs extending it later).

## Slack DMs to staff — blocked on a scope (2026-06-18)

- New marketing/content tickets DM **Cam**; on completion the assigned SM is DM'd. `postStaffSlackDM` posts to a Slack user id; Cam = `marketingManagerSlackId()` (env `MARKETING_DM_SLACK_ID` else staff row by email `cameron@byanymeansbusiness.com`).
- **Cam's Slack id IS set:** `staff.slack_user_id = 'U09A66BCBNJ'` (Cam Wells).
- ⚠️ **STILL DORMANT — the bam_portal Slack app is missing the `im:write` scope.** `chat.postMessage` to a user fails `missing_scope` (verified via conversations.open). Client-CHANNEL notifications work (chat:write present). **Fix: add `im:write` to the app's Bot Token Scopes at api.slack.com/apps → reinstall.** Until then NO person-to-person DM fires.

## Cam marketing guide (sendable HTML)

- Live: `https://portal.byanymeansbusiness.com/cam-marketing-guide.html` (from `bam-portal/public/cam-marketing-guide.html`). Has a 6-screen fake-data walkthrough. Roles in it: **content team = Cam (uploads/sends) → Ximena = marketing (posts on Meta)**.
- OPEN TODO: Zoran flagged the guide's "Start to finish" flow as "wrong" but didn't say what; unresolved. Best guess: drop the "build the ad" box.

## Test data

- Client `test business` (id `71d01c0f-...`, auth user `543cc072-...`, email `zoransavic2000@gmail.com`) is the safe sandbox. Use this account on the client portal.
- Same user is also Zoran's admin staff row, so the dual-role scope logic kicks in. Sign in to portal.byanymeansbusiness.com as staff with `zoran@byanymeansbball.com` / `systems` to access staff side as pure-admin.
