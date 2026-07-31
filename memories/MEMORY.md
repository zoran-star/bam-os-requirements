# Memories — bam-os-requirements

Team-shared project notes. Read the relevant file when its topic comes up.

- [Notion Workspace](reference_notion_workspace.md) - domain pages + job-ID prefixes, per-page table schemas, conventions, Working Memory, Open Loops rules
- [Deployments](reference_deployments.md) - Vercel auto-deploy on push to main, never deploy by CLI, ignoreCommand build-speed setup
- [Data vs Features](feedback_data_vs_features.md) — separate data points to collect from features to build
- [Onboarding Data Points backfill](project_onboarding_datapoints_backfill.md) — PARKED 2026-07-08 (Zoran's call): 5 integration-row backfills drafted + approved but not written to Notion; exact values + page ids inside if ever revived. Instagram DM Connection row WAS added.
- [Style Guide Source of Truth](feedback_style_guide.md) — prototype/docs/style-guide.md is canonical; Section 10 = Questions DB Input Guide
- [PRD Rework](project_prd_rework.md) — replacing job-ID reqs with categorized granular PRDs for BAM GTA MVP
- [Onboarding Data Points](project_onboarding_datapoints.md) — open items to detail for academy owner onboarding
- [LLM Chat Collection](project_llm_chat_collection.md) — strategy data collected via guided LLM chat, not forms
- [FullControl Brand Assets](project_fullcontrol_brand_assets.md) — logo system + 4 size-tiered variants, SVG extraction
- [No Em Dashes](feedback_no_em_dashes.md) — Never use em dashes anywhere, in any copy or output
- [Main Branch Protection](project_git_main_protection.md) - main is locked (PR required + local pre-commit hook); run `sh .githooks/install.sh` once per machine
- [Design Systems Map](project_design_systems_map.md) - exactly 2 canonical design systems: V2 live product (`bam-portal/design-system/tokens.css`, #D4B65C) + prototype reference (`prototype/src/styles/theme.css`, #C8A84E). Everything else is a copy. No DS for V1/V1.5.
- [Academy Facts + Testimonials](project_academy_facts_testimonials.md) - `public_name` (parent-facing name) vs internal `business_name`, community group link + platform, Google review link, and the `testimonials` table. Migration written NOT applied. Rule: no fact, no output. Testimonials seeded for NOBODY, ever.
- [No hour12, use hourCycle](reference_no_hour12.md) - `hour12` is a HINT the engine resolves (Node 20 -> h24, midnight renders "24"); banned in portal source, CI gate `scripts/check-no-hour12.mjs`. Never coexists with `hourCycle`.
- [Stripe Account Reads](reference_stripe_account_reads.md) - `api/stripe/_requirements.js` is the ONLY place anything asks Stripe about a connected account; three outcomes (ready / not_ready / unreachable), never a boolean. Requirement codes are always shown, never dropped. Never tell an owner to reconnect: the self-heal ticks it.
- [Agent Stage Guard](reference_agent_stage_guard.md) - "is this lead still in that stage?" returns `{ inStage, trusted, reason }`, never a boolean; `inStage` is null when untrusted. The 409 "no longer in the ... stage" is only ever sent on a real answer; a failed check is a 503 that says so. Three hops can fail, including the pipeline-provider flag read.
