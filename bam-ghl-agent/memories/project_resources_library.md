# Resources Library

Content library shown to clients (global, not per-client). Staff publish from `bam-portal/`; clients browse via the Resources tile in `client-portal.html`.

> **2026-07-06 — audience gating for content-only clients.** `resource_categories.audience` ('all' default | 'content') + new SECURITY DEFINER fn `public.is_content_only_user()` (TRUE when every client the caller belongs to has `organic_content AND NOT marketing_included`). RLS on resources/resource_files/resource_categories now hides everything except audience='content' categories from content-only clients (e.g. Schmidt Performance) - protects Sales scripts/Strategy playbooks/HR docs from content-accelerator clients Mike is upselling. Migration `20260706174248_resources_content_only_audience.sql` (applied). Also created the **Content** category (audience='content') and moved 6 resources into it from Marketing: Content Starter Pack, Organic Content Flow Walkthrough, Pillars Guide, Repurposing Playbook, The Perfect Testimonial, Starter Campaign Content Capture Checklist (4 stayed: Paid Ads Flow Walkthrough, Setting Up Your First Campaign, Ad Video Examples, Graphic Ad Examples). Staff toggle = "Content clients: visible/hidden" pill per category in the Manage categories modal. Client portal needs no filter code - RLS does it. Full clients see zero change.

> **2026-06-14 — content team can now manage it (not just admins).** Feedback
> from Cam ("content category + I have some ready to upload") surfaced that the
> Resources tab + writes were admin-only, so the content team couldn't upload.
> Now **admin + marketing_manager + marketing_executor** can see the tab
> (`canSeeResources` in App.jsx, `isEditor` in ResourcesView) AND write, via new
> RLS fn `public.is_resource_editor()` (migration
> `20260614220000_resources_content_team_access.sql`). **DELETE stays
> admin-only.** Additive change. ⚠️ Migration must be applied (Supabase) for
> uploads/category-adds by non-admins to work — until then they see the tab but
> writes 403.

## Tables (Supabase, project ref `jnojmfmpnsfmtqmwhopz`)

- `resource_categories` — `id`, `name` (unique), `slug` (unique), `color` (#hex), `sort_order`, `created_at`. Seeded with 5: Sales / Marketing / Systems / HR / Strategy.
- `resources` — `id`, `title`, `description` (nullable), `category_id` FK (RESTRICT delete), `created_by` FK → `staff.id` (SET NULL), timestamps. Trigger keeps `updated_at` fresh.
- `resource_files` — `id`, `resource_id` FK (CASCADE delete), `filename`, `storage_path`, `mime_type`, `size_bytes`, `sort_order`, `created_at`.

## Storage

Bucket `resources` — public, 500 MB per file. Same pattern as `ticket-files`.

## RLS

- SELECT: open to anon + auth (`USING (true)`) on all three tables + storage bucket.
- SELECT: open. DELETE: `public.is_admin_staff()` (admin only).
- INSERT/UPDATE (tables + `resources` storage bucket): `public.is_resource_editor()` SECURITY DEFINER fn (`staff.user_id = auth.uid() AND role IN ('admin','marketing_manager','marketing_executor')`). Original admin-only INSERT/UPDATE policies remain (additive; permissive OR).

## Frontend

**Staff** — `bam-portal/src/views/ResourcesView.jsx`. Lazy-loaded in `App.jsx`. Nav gated by `canSeeResources = me?.role === "admin"`. Self-contained: list + form modal + category manager modal. Uses the shared `T` tokens.

**Client** — `bam-portal/public/client-portal.html`. New `view-resources` section between `view-marketing` and `view-team`. Desktop sidebar nav + mobile bottom nav both wired. JS lives just above `fetchAndRenderTeam` (search `// RESOURCES VIEW`). Grid of tiles, newest-first, category filter pills, search by title/description. Detail page is hash-routed (`#resource=<uuid>`) — shareable URL. Inline preview for image / video / PDF; download for everything.

## Hooks / verifiers

`bam-portal/scripts/verify-client-portal-ui.mjs` still passes — none of the 6 tour selectors touched.

## Content blocks — interactive authored display (2026-06-05)

Resources are now authored as **ordered content blocks**, not just file dumps.
A raw PDF no longer loads as the primary view — PDFs become downloadable
attachments below the content.

- **Schema:** `resources.content_blocks jsonb not null default '[]'`. Migration
  `bam-portal/scripts/migration/resource-content-blocks.sql` — **must be run in
  the Supabase SQL editor before the editor can save blocks** (column won't
  exist otherwise). Backward compatible: legacy resources have `[]`.
- **Block types** (shared contract editor ↔ renderer): `heading`, `text`
  (markdown-lite: `**b**` `*i*` `[link](url)` `- bullets`), `callout`
  (variant tip/warn/info), `checklist` (title + items[] — **tickable, state
  persisted in localStorage** per resource+block), `accordion` (title + body,
  collapsible), `image` (url + caption), `video` (url + caption; mp4/YouTube/
  Vimeo auto-embed), `divider`.
- **Client renderer:** `client-portal.html` — `_renderResourceBlock()` +
  `_resMdLite()` + `_resVideoEmbed()` + checklist persistence
  (`_resToggleCheck`). `renderResourceDetail()` renders blocks when present,
  else falls back to the LEGACY files-only inline-viewer path (incl. the old
  PDF iframe) so existing resources are unchanged. CSS scoped under
  `#view-resources .rb-*`.
- **Staff editor:** `ResourcesView.jsx` — `BlockEditor`/`BlockCard`/
  `BlockImageUpload` in the resource form modal (add/remove/reorder blocks).
  Image blocks can upload to the `resources` bucket under `_blocks/` (returns
  public URL). `content_blocks` saved on insert/update. A resource can now be
  blocks-only (no file required).

## PDF → content-block converter (AI, 2026-06-05)

`api/resources/convert.js` (admin-gated) turns legacy PDF resources into
`content_blocks` so they render as interactive pages instead of an embed.
- Reads the resource's PDF attachment (public bucket URL) → base64 → Claude
  (`claude-sonnet-4-6`) with a forced `emit_blocks` tool (structured JSON,
  avoids the prefill footgun) → `sanitizeBlocks()` clamps to valid types →
  PATCH `resources.content_blocks`. PDF stays as a download.
- Actions: `GET ?action=eligible` (count), `POST ?action=convert` `{resourceId}`,
  `POST ?action=convert-all` (batched `BATCH_CAP=6`/call, returns `remaining`).
  `maxDuration=300`. PDFs capped at 24MB (Claude ~32MB ceiling).
- Staff UI (`ResourcesView.jsx`): per-row **Convert** button (only when
  `isLegacyPdf` = empty content_blocks + a PDF) + a top **Convert N PDFs**
  button that loops convert-all until `remaining=0` (breaks if a batch fully
  fails). Needs `ANTHROPIC_API_KEY` (already in Vercel).

## Quirks

- Public bucket means anyone with a file URL can fetch it without auth. Matches existing `ticket-files` pattern. If signed URLs ever land, gate this bucket the same way.
- Category delete will fail if any resource still references it (ON DELETE RESTRICT). UX surfaces "couldn't delete — likely still in use" message.
- `is_admin_staff()` is SECURITY DEFINER and reads `staff.user_id`. If a non-admin tries to publish through dev tools the policy blocks it.
- Multi-file: `resource_files` rows ordered by `sort_order` (`created_at` order on upload). No drag-reorder UI yet.
