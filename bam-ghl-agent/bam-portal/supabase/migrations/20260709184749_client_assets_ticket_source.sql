-- Option B of the media-library plan (Zoran: do both): ticket uploads mirror
-- into the per-academy asset library as LINK rows (no object copies - the
-- files stay in ticket-files; client_assets.link_url points at them).
-- source='ticket' rows are VIEW-ONLY for clients (Cam 2026-07-09): the ticket
-- owns the file; deleting could yank b-roll from an in-flight creative.
-- Applied to prod 2026-07-09 via Supabase MCP as version 20260709184749.
-- The one-time backfill (152 historical files from raw_files + response
-- attachment bullets) was run directly via MCP - see
-- memories/project_asset_library.md; it is not replayed here.

alter table public.client_assets
  add column if not exists source text not null default 'manual'
  check (source in ('manual','ticket'));

alter table public.client_assets
  add column if not exists source_ticket_id uuid references public.content_tickets(id) on delete set null;

-- Dedupe key for the write-through + backfill (verified 0 existing dupes).
create unique index if not exists client_assets_client_link_url
  on public.client_assets (client_id, link_url) where link_url is not null;

-- Clients can't delete or retag ticket-sourced rows; staff unrestricted.
drop policy if exists client_assets_delete on public.client_assets;
create policy client_assets_delete on public.client_assets for delete
  using (is_staff() or (client_id in (select my_client_ids()) and source <> 'ticket'));

drop policy if exists client_assets_update on public.client_assets;
create policy client_assets_update on public.client_assets for update
  using (is_staff() or (client_id in (select my_client_ids()) and source <> 'ticket'));
