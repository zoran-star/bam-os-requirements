-- Historical backfill: SM training tables were created before this local
-- migration chain was complete. Keep this before the staff RLS predicate swap
-- so that migration can replace the original authenticated-read policies.

create table if not exists public.sm_units (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  order_index integer not null,
  icon text,
  is_active boolean default true,
  unlock_after uuid references public.sm_units(id),
  created_at timestamptz default now(),
  sub_topics text[] default '{}'::text[]
);

create table if not exists public.sm_scenarios (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.sm_units(id) on delete cascade,
  type text not null check (type in ('quick_fire', 'deep_situation')),
  difficulty integer not null check (difficulty between 1 and 5),
  title text not null,
  prompt text not null,
  context text,
  visual_type text check (visual_type in ('none', 'chart', 'table', 'dashboard_mock', 'email', 'text_thread', 'pnl')),
  visual_data jsonb,
  ideal_response text,
  scoring_rubric jsonb,
  follow_ups jsonb,
  character_prompt text,
  source_transcript_id uuid,
  tags text[],
  is_active boolean default true,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.sm_transcripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_type text,
  raw_text text not null,
  summary text,
  tags text[],
  key_problems jsonb,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.sm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date date not null default current_date,
  quick_fire_target integer default 10,
  deep_situation_target integer default 3,
  quick_fire_completed integer default 0,
  deep_situation_completed integer default 0,
  is_complete boolean default false,
  created_at timestamptz default now(),
  unique (user_id, date)
);

create table if not exists public.sm_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sm_sessions(id) on delete cascade,
  scenario_id uuid references public.sm_scenarios(id),
  user_id uuid references auth.users(id) on delete cascade,
  response_text text not null,
  response_audio_url text,
  response_duration_seconds integer,
  ai_score integer check (ai_score between 1 and 10),
  ai_feedback text,
  ai_tldr text,
  ai_ideal_comparison text,
  ai_strengths text[],
  ai_gaps text[],
  mike_score integer check (mike_score between 1 and 5),
  mike_notes text,
  mike_reviewed_at timestamptz,
  conversation_history jsonb,
  type text not null check (type in ('quick_fire', 'deep_situation')),
  created_at timestamptz default now(),
  lead_score integer,
  lead_feedback text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  flagged boolean default false
);

create table if not exists public.sm_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  unit_id uuid references public.sm_units(id) on delete cascade,
  ai_competency_score numeric(5,2) default 0,
  mike_competency_score numeric(5,2),
  scenarios_completed integer default 0,
  scenarios_total integer default 0,
  status text default 'locked' check (status in ('locked', 'in_progress', 'completed', 'certified')),
  certified_at timestamptz,
  certified_by uuid references auth.users(id),
  weak_tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, unit_id)
);

create table if not exists public.sm_daily_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid references public.sm_sessions(id),
  scenario_id uuid references public.sm_scenarios(id),
  type text not null check (type in ('quick_fire', 'deep_situation')),
  queue_order integer not null,
  is_completed boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.sm_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('trainee', 'lead_sm', 'admin')),
  display_name text not null,
  created_at timestamptz default now(),
  unique (user_id)
);

create table if not exists public.sm_calibrations (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references public.sm_scenarios(id) on delete cascade,
  user_id uuid references auth.users(id),
  response_text text not null,
  score integer default 10,
  notes text,
  created_at timestamptz default now(),
  notion_synced boolean default false
);

create table if not exists public.sm_scenario_feedback (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.sm_scenarios(id) on delete cascade,
  user_id uuid not null,
  rating text not null check (rating in ('good', 'okay', 'bad')),
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (scenario_id, user_id)
);

create index if not exists idx_scenario_feedback_scenario on public.sm_scenario_feedback(scenario_id);
create index if not exists idx_scenario_feedback_user on public.sm_scenario_feedback(user_id);
create index if not exists idx_scenario_feedback_rating on public.sm_scenario_feedback(rating);

alter table public.sm_units enable row level security;
alter table public.sm_scenarios enable row level security;
alter table public.sm_transcripts enable row level security;
alter table public.sm_sessions enable row level security;
alter table public.sm_responses enable row level security;
alter table public.sm_progress enable row level security;
alter table public.sm_daily_queue enable row level security;
alter table public.sm_user_roles enable row level security;
alter table public.sm_calibrations enable row level security;
alter table public.sm_scenario_feedback enable row level security;

create or replace function public.get_sm_role(uid uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.sm_user_roles where user_id = uid limit 1;
$$;

drop policy if exists "Units readable by staff" on public.sm_units;
drop policy if exists "Units readable by authenticated" on public.sm_units;
create policy "Units readable by authenticated" on public.sm_units
  for select to authenticated using (true);

drop policy if exists "Units manageable by admin" on public.sm_units;
create policy "Units manageable by admin" on public.sm_units
  for all to authenticated using (public.get_sm_role(auth.uid()) = 'admin');

drop policy if exists "Scenarios readable by staff" on public.sm_scenarios;
drop policy if exists "Scenarios readable by authenticated" on public.sm_scenarios;
create policy "Scenarios readable by authenticated" on public.sm_scenarios
  for select to authenticated using (true);

drop policy if exists "Scenarios manageable by admin/lead" on public.sm_scenarios;
create policy "Scenarios manageable by admin/lead" on public.sm_scenarios
  for all to authenticated using (public.get_sm_role(auth.uid()) in ('admin', 'lead_sm'));

drop policy if exists "Transcripts for lead/admin" on public.sm_transcripts;
create policy "Transcripts for lead/admin" on public.sm_transcripts
  for select to authenticated using (public.get_sm_role(auth.uid()) in ('admin', 'lead_sm'));

drop policy if exists "Transcripts manageable by admin/lead" on public.sm_transcripts;
create policy "Transcripts manageable by admin/lead" on public.sm_transcripts
  for all to authenticated using (public.get_sm_role(auth.uid()) in ('admin', 'lead_sm'));

drop policy if exists "Sessions own read" on public.sm_sessions;
create policy "Sessions own read" on public.sm_sessions
  for select to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Sessions own insert" on public.sm_sessions;
create policy "Sessions own insert" on public.sm_sessions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Sessions own update" on public.sm_sessions;
create policy "Sessions own update" on public.sm_sessions
  for update to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Responses own read" on public.sm_responses;
create policy "Responses own read" on public.sm_responses
  for select to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Responses own insert" on public.sm_responses;
create policy "Responses own insert" on public.sm_responses
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Responses update by lead/admin" on public.sm_responses;
create policy "Responses update by lead/admin" on public.sm_responses
  for update to authenticated using (public.get_sm_role(auth.uid()) in ('admin', 'lead_sm'));

drop policy if exists "Progress own read" on public.sm_progress;
create policy "Progress own read" on public.sm_progress
  for select to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Progress own insert" on public.sm_progress;
create policy "Progress own insert" on public.sm_progress
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Progress update" on public.sm_progress;
create policy "Progress update" on public.sm_progress
  for update to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Queue own read" on public.sm_daily_queue;
create policy "Queue own read" on public.sm_daily_queue
  for select to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Queue insert" on public.sm_daily_queue;
create policy "Queue insert" on public.sm_daily_queue
  for insert to authenticated with check (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Queue update" on public.sm_daily_queue;
create policy "Queue update" on public.sm_daily_queue
  for update to authenticated using (
    user_id = auth.uid() or public.get_sm_role(auth.uid()) in ('admin', 'lead_sm')
  );

drop policy if exists "Roles readable by staff" on public.sm_user_roles;
drop policy if exists "Roles readable" on public.sm_user_roles;
create policy "Roles readable" on public.sm_user_roles
  for select to authenticated using (true);

drop policy if exists "Roles manageable by admin" on public.sm_user_roles;
create policy "Roles manageable by admin" on public.sm_user_roles
  for all to authenticated using (public.get_sm_role(auth.uid()) = 'admin');

drop policy if exists "Admins can manage calibrations" on public.sm_calibrations;
create policy "Admins can manage calibrations" on public.sm_calibrations
  for all using (
    exists (
      select 1 from public.sm_user_roles
      where user_id = auth.uid() and role in ('admin', 'lead_sm')
    )
  );

drop policy if exists "Admins can manage all feedback" on public.sm_scenario_feedback;
create policy "Admins can manage all feedback" on public.sm_scenario_feedback
  for all using (
    exists (
      select 1 from public.sm_user_roles
      where user_id = auth.uid() and role in ('admin', 'lead_sm')
    )
  );

drop policy if exists "Users can read own feedback" on public.sm_scenario_feedback;
create policy "Users can read own feedback" on public.sm_scenario_feedback
  for select using (user_id = auth.uid());

drop policy if exists "Users can insert own feedback" on public.sm_scenario_feedback;
create policy "Users can insert own feedback" on public.sm_scenario_feedback
  for insert with check (user_id = auth.uid());

drop policy if exists "Users can update own feedback" on public.sm_scenario_feedback;
create policy "Users can update own feedback" on public.sm_scenario_feedback
  for update using (user_id = auth.uid());
