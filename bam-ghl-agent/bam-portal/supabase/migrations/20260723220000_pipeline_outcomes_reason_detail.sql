-- Structured lost reasons (Zoran, from the Hawkeye teach-why pile): keep the
-- taxonomy in `reason`, and store the lead's OWN words / staff detail here.
alter table pipeline_outcomes add column if not exists reason_detail text;
