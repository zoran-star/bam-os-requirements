-- V1.5 portal tier: no GoHighLevel, lighter than V2. Mutually exclusive with
-- v2_access in the staff "Portal tier" selector (V1 = both false).
alter table public.clients add column if not exists v15_access boolean not null default false;
comment on column public.clients.v15_access is 'V1.5 portal tier (no GoHighLevel, lighter than V2). Set by the staff Portal tier selector; mutually exclusive with v2_access.';;
