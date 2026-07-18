# Member Care agent (Hawkeye family) - proposal cards in member conversations

**Built 2026-07-18.** The 4th Hawkeye-family agent: watches each MEMBER's parent
conversation (V2 Members tab) and PROPOSES - never executes - three kinds of things
on one card, rendered INLINE in the member drawer conversation:

1. **Member action** - pause / unpause / cancel / change / payment-link /
   card-setup-link (exact `api/members.js` action strings). "Do action" fires the
   proven `_memberAction()` → `PATCH /api/members` path with the user's own bearer.
2. **Draft reply** to the parent (editable textarea) - "Send reply" fires
   `/api/ghl/send-message` (SMS default; Email only on GHL academies with parent_email).
3. **Staff to-dos** - "Add to to-dos" copies into `/api/action-items`.

Each part has its OWN status + approve button; dismiss has an optional teach-why
input that writes an `agent_lessons` row (`agent='member_care'` bucket, auto picked
up by `/consolidate-lessons`). Refunds/coupons are deliberately NOT proposable -
the prompt routes those to a to-do.

## Pieces

| Piece | Where |
|---|---|
| Table | `agent_member_cards` (migration `20260718100000`) - one card per member, unique partial index = one pending per member, part statuses action/reply/items |
| Draft core | `api/agent/member-care.js` - `draftMemberCareForMember()`, allowed-actions matrix by member status, server-side validation, dedup by `last_inbound_at` timestamp match |
| Endpoint | `api/agent-member-care.js` - cron `?action=detect` (CRON_SECRET), POST `list/counts/mark-action-done/mark-reply-sent/mark-items-added/dismiss/detect-now` |
| Cron | vercel.json `11,26,41,56 * * * *` (offset from the other 3 detectors) |
| Webhook fast path | both `api/ghl/inbound-webhook.js` + `api/twilio/inbound-webhook.js`: parent replies → cancel stale pending card + best-effort redraft (2 separate try/catch, delete the draft block if webhook latency bites) |
| Mode | `clients.ghl_kpi_config.member_care_agent_mode`, default OFF (opt-in). `memberCareAgentMode()` in `_mode.js`; `set-member-care-mode` in agent-config.js; toggle = staff portal AgentModePanel (4th row). Self-drive never offered - proposal-only by construction. |
| UI | client-portal.html `_memberCare*` functions next to the member inbox (~44850); cards render between thread and composer in `_renderMemberInbox`; gold dot on roster card via `counts` + `_MEMBER_CARE_PENDING` |
| Push | `member-care-ready` kind in `api/push/_send.js` |
| Registry | `AGENT_TEMPLATES.member_care` in `api/agent/presets.js` (declaration-only - NOT a pipeline-station agent, it iterates the members roster) |

## Gotchas
- Candidate discovery is contact-keyed: members without `ghl_contact_id` are invisible to this agent.
- Do NOT route its teach-why through `/api/agent-train` - `pickAgent` there falls back to `booking` and misfiles the lesson bucket. The endpoint's `dismiss` action inserts directly.
- Mock mode (`?mock=1`) has fixtures: cards `mcc-1`/`mcc-2` on members mb-3/mb-8, and the mock `/api/members?id=` single-member drawer shape was added for this (drawer previously blank in mock).
- Migration `20260718100000_agent_member_cards.sql` APPLIED to prod 2026-07-18 via Supabase MCP (DDL + history row inserted at the exact version, so `migration list --linked` stays in sync). The prod history row's statements column is a pointer note, not the full SQL - the repo file is canonical.
- Notion Member Management page: MEM- requirement for this agent still to be added (two-sources-of-truth rule).
