# Resources Library

Admin-published content library shown to **all clients** (global, not per-client). Staff (admin role only) publishes resources from `bam-portal/`; clients browse via the Resources tile in `client-portal.html`.

## Tables (Supabase, project ref `jnojmfmpnsfmtqmwhopz`)

- `resource_categories` — `id`, `name` (unique), `slug` (unique), `color` (#hex), `sort_order`, `created_at`. Seeded with 5: Sales / Marketing / Systems / HR / Strategy.
- `resources` — `id`, `title`, `description` (nullable), `category_id` FK (RESTRICT delete), `created_by` FK → `staff.id` (SET NULL), timestamps. Trigger keeps `updated_at` fresh.
- `resource_files` — `id`, `resource_id` FK (CASCADE delete), `filename`, `storage_path`, `mime_type`, `size_bytes`, `sort_order`, `created_at`.

## Storage

Bucket `resources` — public, 500 MB per file. Same pattern as `ticket-files`.

## RLS

- SELECT: open to anon + auth (`USING (true)`) on all three tables + storage bucket.
- INSERT/UPDATE/DELETE: gated by `public.is_admin_staff()` SECURITY DEFINER fn (`staff.user_id = auth.uid() AND role = 'admin'`).

## Frontend

**Staff** — `bam-portal/src/views/ResourcesView.jsx`. Lazy-loaded in `App.jsx`. Nav gated by `canSeeResources = me?.role === "admin"`. Self-contained: list + form modal + category manager modal. Uses the shared `T` tokens.

**Client** — `bam-portal/public/client-portal.html`. New `view-resources` section between `view-marketing` and `view-team`. Desktop sidebar nav + mobile bottom nav both wired. JS lives just above `fetchAndRenderTeam` (search `// RESOURCES VIEW`). Grid of tiles, newest-first, category filter pills, search by title/description. Detail page is hash-routed (`#resource=<uuid>`) — shareable URL. Inline preview for image / video / PDF; download for everything.

## Hooks / verifiers

`bam-portal/scripts/verify-client-portal-ui.mjs` still passes — none of the 6 tour selectors touched.

## Quirks

- Public bucket means anyone with a file URL can fetch it without auth. Matches existing `ticket-files` pattern. If signed URLs ever land, gate this bucket the same way.
- Category delete will fail if any resource still references it (ON DELETE RESTRICT). UX surfaces "couldn't delete — likely still in use" message.
- `is_admin_staff()` is SECURITY DEFINER and reads `staff.user_id`. If a non-admin tries to publish through dev tools the policy blocks it.
- Multi-file: `resource_files` rows ordered by `sort_order` (`created_at` order on upload). No drag-reorder UI yet.
