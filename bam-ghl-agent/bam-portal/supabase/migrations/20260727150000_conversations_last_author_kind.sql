-- Staff inbox: sender prefix on conversation previews ("You: ..." vs
-- "Mike: ..."). Stamps WHO sent the last message (staff vs client) next to
-- the existing preview, maintained by the same on-new-message trigger.
alter table public.conversations add column if not exists last_message_author_kind text;

create or replace function public.update_conversation_on_new_message()
returns trigger as $$
begin
  update public.conversations
  set
    last_message_at = new.created_at,
    last_message_preview = left(coalesce(new.body, ''), 140),
    last_message_author_kind = case when new.author_staff_id is not null then 'staff' else 'client' end,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;
