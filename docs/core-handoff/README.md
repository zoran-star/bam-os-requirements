# Prototype-to-Core Handoffs

Short developer handoffs for reviewing prototype architecture and tracking `fc-core-srvc` parity.

| Domain | Handoff | Review | Prototype | Core parity | Reviewed |
|---|---|---|---|---|---|
| Platform foundations | [`platform-foundations.md`](platform-foundations.md) | `ready-for-review` | `partial` | `partial` | 2026-06-04 |

Use one handoff per durable domain, not per ticket, screen, or table. Start from [`_template.md`](_template.md).

## Update Rules

Update the relevant handoff with every persistent-data or backend-architecture change:

- Record the prototype state and core commit reviewed.
- Separate the intended model, current prototype, and current core status.
- Keep parity gaps, shortcuts, and open decisions current.
- Link to code and migrations instead of copying schemas.
- Set changed docs to `ready-for-review`. Only developers can confirm `reviewed`.

Review states: `draft`, `ready-for-review`, `reviewed`, `superseded`.

## Developer Review Request

```text
Please review docs/core-handoff/<domain>.md against fc-core-srvc. Focus on the intended model, ownership, parity gaps, shortcuts, and open decisions. Reply with required changes or approval.
```
