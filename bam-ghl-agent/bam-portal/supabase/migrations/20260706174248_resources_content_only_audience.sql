-- Content-only clients (organic_content ON, marketing_included OFF, e.g.
-- Schmidt Performance) see ONLY resource categories marked audience='content'.
-- Full/scaling clients keep seeing everything. Protects scaling-system IP
-- (Sales scripts, Strategy playbooks, HR docs) from content-accelerator
-- clients being upsold on the full system.
-- Applied to prod 2026-07-06 via Supabase MCP as version 20260706174248.

alter table public.resource_categories
  add column if not exists audience text not null default 'all'
  check (audience in ('all','content'));

-- TRUE only when every client the caller belongs to is content-only.
-- Staff and full-client users always pass the RLS below via the OR branches.
create or replace function public.is_content_only_user()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select bool_and(c.organic_content and not c.marketing_included)
       from public.clients c
      where c.id in (select public.my_client_ids())
        and exists (select 1)),
    false)
$$;

-- New Content category (sorted after Marketing) + move the 6 agreed
-- content-side resources out of Marketing.
insert into public.resource_categories (name, slug, color, audience, sort_order)
select 'Content', 'content', '#7BC47F', 'content',
       coalesce((select sort_order from public.resource_categories where slug = 'marketing'), 0) + 1
where not exists (select 1 from public.resource_categories where slug = 'content');

update public.resources r
set category_id = (select id from public.resource_categories where slug = 'content')
where r.title in (
  'Content Starter Pack',
  'Organic Content Flow Walkthrough',
  'Pillars Guide',
  'Repurposing Playbook',
  'The Perfect Testimonial',
  'Starter Campaign Content Capture Checklist'
)
and r.category_id = (select id from public.resource_categories where name = 'Marketing');

-- RLS: content-only users only read content-audience rows. Everyone else
-- (staff, full clients) unchanged.
drop policy if exists "resource_categories_select_authed" on public.resource_categories;
create policy "resource_categories_select_authed"
  on public.resource_categories for select to authenticated
  using (
    is_staff()
    or not is_content_only_user()
    or audience = 'content'
  );

drop policy if exists "resources_select_authed" on public.resources;
create policy "resources_select_authed"
  on public.resources for select to authenticated
  using (
    is_staff()
    or not is_content_only_user()
    or exists (
      select 1 from public.resource_categories rc
      where rc.id = resources.category_id and rc.audience = 'content'
    )
  );

drop policy if exists "resource_files_select_authed" on public.resource_files;
create policy "resource_files_select_authed"
  on public.resource_files for select to authenticated
  using (
    is_staff()
    or not is_content_only_user()
    or exists (
      select 1 from public.resources r
      join public.resource_categories rc on rc.id = r.category_id
      where r.id = resource_files.resource_id and rc.audience = 'content'
    )
  );
