ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marketing_included boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clients.marketing_included IS 'Whether the BAM service for this client includes the Marketing module (Meta ads, campaigns, etc.). When false, staff portal Marketing tab shows only the toggle; client portal greys out the Marketing menu item; first-login tour skips the Marketing step.';;
