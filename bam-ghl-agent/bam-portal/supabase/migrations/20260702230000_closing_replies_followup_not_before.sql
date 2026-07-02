-- The lead named a decision date ("we'll decide after the 15th") - the closing
-- follow-up loop honors it instead of the default next-day cadence. Stamped on
-- rows at draft time from the agent's followup_on extraction.
alter table public.agent_closing_replies
  add column if not exists followup_not_before timestamptz;
