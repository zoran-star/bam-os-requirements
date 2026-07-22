# Opt-out → mark-unqualified flow (2026-07-22)

When a lead opts out ("stop texting me", "leave me alone", "remove my number", "unsubscribe"...), agents now suggest MARK UNQUALIFIED in Hawkeye - never Lost. Before this, opt-outs mapped to Lost, and approving a Lost card with nurture live RE-ENROLLED the opted-out lead in nurture texting (compliance bug, found during the Jul 21 Sembly-note check).

## How it works
- All 3 agents (booking/confirm/closing) have `recommend_unqualified` in their draft schema; detector queues card kinds `mark_unqualified` / `confirm_unqualified` / `closing_unqualified` with NO sendable message.
- Approving = the existing confirm-abandoned path: abandoned + unqualified tag, no nurture, no message, queues swept.
- Prompt rules: opt-out is never Lost, never a complaint escalation; "Opted out" removed from the Lost taxonomy.
- Both inbound webhooks (Twilio + GHL) run a soft opt-out regex and write a persistent agent_contact_notes flag ("suggest mark unqualified, do not keep messaging") without blocking the reply flow. Literal STOP still handled by the exact-match early-return.
- Migration `20260722120000_unqualified_card_kinds.sql` widens confirm/closing kind CHECKs - booking cards work without it, confirm/closing insert fails soft until applied.

## Known leak paths (accepted for now)
1. Human override: approving a plain Lost card / Nurture move on an opted-out lead still nurtures (human-confirmed).
2. Booking detector's 24h+ quiet skip could send a stale unprocessed opt-out to the Ghosted automation (automations don't read contact notes).
