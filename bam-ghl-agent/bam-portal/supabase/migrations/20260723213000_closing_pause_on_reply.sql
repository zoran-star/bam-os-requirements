-- "Send nothing" + pause-don't-kill (Zoran 2026-07-23)
--
-- The problem this fixes: a lead who replies "Thank you" to our post-trial info
-- had their ENTIRE scheduled follow-up plan hard CANCELED by the inbound sweep,
-- before a human ever saw the card. A courtesy reply is not a conversation -
-- killing a cadence over it silently drops the lead.
--
-- (Sibling fix, PR #1575: a parked reignition now survives a reply outright, so
-- parks need no pause/resume - only the follow-up PLAN does.)
--
-- New model, CLOSING AGENT ONLY (booking/confirm keep the old hard cancel):
--   inbound reply  -> the closing follow-up plan goes to 'paused'
--                     (nothing can auto-fire while a human is deciding)
--   staff sends a real reply  -> paused rows finalize to 'canceled' (agent re-plans)
--   staff sends NOTHING (empty message box = "send nothing")
--                     -> paused rows RESUME on their original dates
--
-- paused_from remembers which status a row came from so a resume restores
-- 'approved' (already human-approved, sends on schedule) vs 'pending' (still
-- needs approval) exactly as it was.
--
-- Paused rows sit OUTSIDE every existing filter: the deck reads
-- status in (pending,approved), the flush reads status=approved, and both
-- one-active-per-contact unique indexes are partial on those statuses - so a
-- fresh reply card can be drafted for the lead while their plan waits.

alter table public.agent_closing_replies
  drop constraint if exists agent_closing_replies_status_check;
alter table public.agent_closing_replies
  add constraint agent_closing_replies_status_check
  check (status in ('pending','approved','sent','skipped','canceled','failed','paused'));

alter table public.agent_closing_replies
  add column if not exists paused_from text;

comment on column public.agent_closing_replies.paused_from is
  'When status=paused: the status this row was in before a lead reply paused it (pending|approved). A resume ("send nothing" in Hawkeye) puts it back exactly there.';
