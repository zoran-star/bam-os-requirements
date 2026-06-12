-- Drop the unique constraint on clients.auth_user_id so that one
-- Supabase auth user can be the Point of Contact for multiple clients.
-- Replace with a non-unique index for fast lookup.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_auth_user_id_key;
CREATE INDEX IF NOT EXISTS clients_auth_user_id_idx ON public.clients(auth_user_id);;
