
CREATE TABLE public.website_leads (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       uuid        REFERENCES public.clients(id),
  form_type       text        NOT NULL DEFAULT 'contact',
  name            text,
  email           text,
  phone           text,
  fields          jsonb       NOT NULL DEFAULT '{}',
  source_url      text,
  ghl_contact_id  text,
  ghl_synced_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.website_leads ENABLE ROW LEVEL SECURITY;

-- Service role (portal API) has full access; bypasses RLS automatically.
-- Staff portal reads via authenticated staff users.
CREATE POLICY "staff_read" ON public.website_leads
  FOR SELECT
  USING (auth.role() = 'authenticated');
;
