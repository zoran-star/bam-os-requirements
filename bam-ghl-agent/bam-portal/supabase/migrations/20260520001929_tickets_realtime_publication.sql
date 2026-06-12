-- Add the ticket-shaped tables to the Supabase Realtime publication
-- so frontend subscriptions actually receive row-level events.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketing_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.content_tickets;;
