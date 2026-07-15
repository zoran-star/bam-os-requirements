# /onboarding-continue - resume the Onboarding Flow project

THE tie-everything project: one resumable flow that takes any academy to BAM
GTA's V2 state (off GHL, text/call flip last). Owner flow + sales preset +
GHL migration + site-build machine + readiness gate - all one system.

## On invoke
1. Read `bam-ghl-agent/docs/onboarding-flow-handoff.md` (the resume point)
   and `bam-ghl-agent/memories/project_v2_onboarding_model.md` (the canonical
   model). Skim `bam-ghl-agent/docs/v2-onboarding-spec.md` if deeper context
   is needed.
2. Give Zoran a SHORT visual catch-up: what's live, where DETAIL (the running
   test client) stands, and the next-session list from the handoff.
3. Confirm which item to start on (default: the three sign-off redesigns, in
   the handoff's order), then work.

## Ground rules for this project
- Work in git worktrees; PR + squash-merge; commit memory-note updates in the
  same PRs (project_v2_onboarding_model.md is a MANDATORY-update note).
- Two repos: bam-os-requirements (portal) + bam-client-sites (sites). The
  bam-portal .env.local SUPABASE_SERVICE_KEY is stale - use the Supabase MCP
  or scripts' --data offline modes.
- DETAIL Miami is mid-gate (staging_ready) - don't break its state while
  changing the gate; re-verify after.
- Run the tour verifier after any client-portal.html edit. No em dashes in
  person-facing output. No emojis in product UI.
