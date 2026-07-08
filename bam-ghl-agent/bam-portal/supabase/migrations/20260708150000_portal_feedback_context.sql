-- Auto-captured context snapshot from the client-portal feedback widget
-- (the "lil Zoran" icon). Lets the widget become description-only for
-- users: the page, active view, click path, view history, recent JS
-- errors, tier (v1/v1.5/v2) and device ride along automatically.
-- Read by the /v2-tickets triage skill and the staff Feedback tab.
alter table public.portal_feedback
  add column if not exists context jsonb;

comment on column public.portal_feedback.context is
  'Auto-captured widget snapshot: {v, tier, academy, view, view_trail[], clicks[], errors[], url, viewport, ua, native_app, online, seconds_on_page, submitted_at}';
