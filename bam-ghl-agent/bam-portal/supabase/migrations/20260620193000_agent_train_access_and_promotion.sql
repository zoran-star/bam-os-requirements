-- Client-portal agent training: per-user access grant + lesson global-promotion flow.
--
-- Feature: selected client-portal users can TRAIN their academy's booking agent
-- (local knowledge only). Lessons the AI judges to be GENERAL sales-craft are
-- flagged for BAM-admin approval before they can be promoted to the shared brain.

-- 1) Access grant -----------------------------------------------------------
-- Additive, opt-IN (default false). Unlike allowed_tabs (subtractive), training
-- is hidden for everyone until an admin explicitly turns it on for a person.
alter table public.client_users
  add column if not exists can_train_agent boolean not null default false;

comment on column public.client_users.can_train_agent is
  'When true, this client user sees the "Train Agent" surface in the client portal and can train their academy''s booking agent (local knowledge only). Granted by BAM staff. Default false.';

-- 2) Lesson promotion state -------------------------------------------------
-- agent_lessons already has `scope` ('academy' | 'general'). Client-trainer
-- lessons are always born scope='academy' (apply to their academy immediately).
-- The AI classifier may additionally mark a lesson as proposed-for-global; that
-- sets promotion_status='pending' for a BAM admin to approve/reject.
alter table public.agent_lessons
  add column if not exists promotion_status text not null default 'none'
    check (promotion_status in ('none','pending','approved','rejected'));

alter table public.agent_lessons
  add column if not exists promotion_reason text;

alter table public.agent_lessons
  add column if not exists submitted_by_client_user uuid references public.client_users(id) on delete set null;

alter table public.agent_lessons
  add column if not exists reviewed_by text;

alter table public.agent_lessons
  add column if not exists reviewed_at timestamptz;

comment on column public.agent_lessons.promotion_status is
  'Global-promotion review state. none = local academy lesson, no global ask. pending = AI judged this general sales-craft; awaiting BAM-admin approval to promote to shared brain. approved = admin promoted it (scope flipped to general). rejected = admin kept it academy-local.';
comment on column public.agent_lessons.promotion_reason is
  'AI classifier''s short reason for proposing (or not) global promotion.';
comment on column public.agent_lessons.submitted_by_client_user is
  'The client_users.id who created this lesson via the client portal. NULL = created by BAM staff.';

create index if not exists agent_lessons_promotion_pending_idx
  on public.agent_lessons (promotion_status) where promotion_status = 'pending';

-- 3) RLS for client-side reads ----------------------------------------------
-- Writes stay service-role only (the api/agent-train.js endpoint enforces the
-- can_train_agent grant + local-only scope/section constraints server-side).
-- Existing SELECT policies already allow members to read their academy's
-- agent_lessons / agent_prompt_sections, so no SELECT change is needed here.
