-- V1 automations: the portal enrolls the GHL contact into an existing GHL
-- workflow when a lead arrives through an entry point. website-form rows
-- enroll on submission; calendar rows enroll on a successful booking.
alter table public.entry_points add column if not exists ghl_workflow_id text;
alter table public.entry_points add column if not exists ghl_workflow_name text;

update public.entry_points set ghl_workflow_id='b3feffee-69a8-4c99-be20-7652a3206de6', ghl_workflow_name='contact form filled in'
  where client_id='39875f07-0a4b-4429-a201-2249bc1f24df' and type='website-form' and key='contact';

update public.entry_points set ghl_workflow_id='b3f5337d-186a-487b-b1e2-86aa4c979908', ghl_workflow_name='trial form filled in'
  where client_id='39875f07-0a4b-4429-a201-2249bc1f24df' and type='website-form' and key='free-trial';

-- published 'free trial booked' (a draft duplicate also exists in GHL)
update public.entry_points set ghl_workflow_id='188cb898-0159-464d-8e3c-3df5024d4929', ghl_workflow_name='free trial booked'
  where client_id='39875f07-0a4b-4429-a201-2249bc1f24df' and type='calendar';;
