-- Optional client-facing creative name shown in staff lists and the ticket
-- header ("August camp promo | Graphic"). NULL = untitled, UI falls back to
-- the type/notes preview. Set by the client at submit or staff via edit-context.
-- Applied to prod 2026-07-05 via Supabase MCP as version 20260705204424.
alter table public.content_tickets
  add column if not exists title text;
