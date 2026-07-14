-- Form builder (Gap #5, phase 5A-1): per-field help text / instruction.
-- Shown under the question in the offer wizard's form builder and (later) on the
-- live free-trial / onboarding form. Nullable and additive; existing fields and
-- forms are unaffected.
alter table public.custom_field_defs
  add column if not exists help_text text;
