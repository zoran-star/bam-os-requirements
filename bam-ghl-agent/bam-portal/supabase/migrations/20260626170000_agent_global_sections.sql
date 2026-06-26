-- Global agent brain sections. Edits here apply to EVERY academy's agents: the
-- shared "MANAGED BY BAM (global)" sales-craft sections (the `general` + `goal`
-- layers - Role/Identity, Tone, Who qualifies, objection handling, etc.). Only BAM
-- staff or a designated global-editor academy (BAM GTA) may write these. Every agent
-- merges these UNDER its own per-academy (location/offer) overrides at prompt build
-- time, so a global edit propagates to all academies while local facts still win.
--
-- Separate table (not agent_prompt_sections) because that table's client_id has a
-- NOT-NULL FK to clients(id); globals have no owning client.
create table if not exists public.agent_global_sections (
  id          uuid primary key default gen_random_uuid(),
  section_key text not null unique,
  body        text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- Service-role only: the API reads/writes with the service key (which bypasses RLS).
-- No anon/authenticated policies on purpose - clients never hit this table directly.
alter table public.agent_global_sections enable row level security;
