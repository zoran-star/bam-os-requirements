# Memories — bam-ghl-agent

Project notes for the BAM GHL Agent / portal work. Read the relevant file when its topic comes up.

- [BAM GHL North Star](project_bam_ghl_north_star.md) — dual client+staff portal (chat, ad spend, tickets), not just an autonomous agent
- [BAM GHL Agent Files](project_bam_ghl_agent_files.md) — local + git + Vercel file locations and workflow
- [Client Portal Flow](project_client_portal_flow.md) — onboarding.html → client row, client-portal.html shows tickets, live on Vercel
- [Support Ticket System](project_support_ticket_system.md) — full ticket pipeline + Systems portal status
- [BAM Onboarding Checkpoints](project_bam_onboarding_checkpoints.md) — current 14-step sheet checklist, baseline for Supabase redesign
- [Slack Onboarding Automation](project_slack_onboarding_automation.md) — auto-create Slack channels for new clients
- [iOS Push via PWA](project_ios_push_pwa.md) — deferred PWA + Web Push plan for iPhone client notifications
- [Player Intake Setup](project_player_intake_setup.md) — Phase 3 complete, SQL plan ready for Phase 4
- [Training Onboarding Flow](project_training_onboarding.md) — 3-step standalone flow, all DB questions inserted
- [Tasks System Pending Mike](project_tasks_pending_mike.md) — task unification on hold until Mike gives preferences
- [Questions Database Schema](supabase_questions_db.md) — full schema, enums, valid Places Asked, insert rules, **UUID→Question lookup pattern** for ticket field labels
- [Local Dev Workflow](project_local_dev_workflow.md) — `npm run dev` hits prod Supabase; use test_business client (71d01c0f-...) for safe testing + cleanup query
- [Client Action Thread](project_client_action_thread.md) — multi-round chat between staff & client on a ticket: `tickets.messages` jsonb, state machine, API actions, UI mapping
- [Client Action Notifications (TODO)](project_client_action_notifications_todo.md) — deferred: Slack/email/SMS notifications when staff requests action or client responds
- [Client Portal Auth](project_client_auth.md) — email + password login, 1 user per client via `clients.auth_user_id`, manual provisioning, RLS-scoped queries; URL `?client_id=` flow removed
- [Pre-Launch Checklist](project_pre_launch_checklist.md) — everything intentionally deferred during dev: SMTP for prod email, branded templates, signed URLs, notifications, audit trail, etc. Walk through 🔴 items before first real client.
