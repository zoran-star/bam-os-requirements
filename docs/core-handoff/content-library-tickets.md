---
domain: content-library-tickets
review_state: ready-for-review
prototype_status: in-progress
core_parity: not-reviewed
last_reviewed: "2026-07-20"
prototype_commit: working-tree
core_commit_reviewed: unavailable (fc-core-srvc not reachable from this machine 2026-07-20 - repo Full-Control/fc-core-srvc not found for the zoran-star GitHub account; re-run align-core-data-model when access lands)
---

# Content Library + V2 Ticket Rail: Prototype-to-Core Handoff

## Summary

- What the prototype implements: (P1) a structured content taxonomy on the
  live `client_assets` library - typed content (action/coaching/culture/
  testimonial) with person links (athletes -> `contacts`, staff ->
  `client_users`) and per-academy skill presets; (P3, upcoming) a greenfield
  V2 ticket rail (`v2_tickets` + `v2_ticket_messages`) replacing client-facing
  Slack. V1/V1.5 legacy `tickets`/`marketing_tickets`/`content_tickets` stay
  untouched (tier split, no migration).
- Intended production direction: core owns a ContentAsset aggregate (asset +
  typed taxonomy + person/skill links) and a Ticket aggregate (ticket + thread
  messages + status transitions) per tenant.
- Suggested core owner: media/content module (library), support module (rail).

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/migrations/` (P1 taxonomy
  migration), `client_assets` (20260616000707 + successors),
  `bam-ghl-agent/docs/zoran-icon-ticket-design.md` (T-SCOPE OUTCOME - full
  approved architecture)
- **Core reviewed:** none - checkout unavailable (see frontmatter)

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| client_assets.content_type + highlight | Typed content classification (action/coaching/culture/testimonial; highlight bool only for action) | client_id tenant scope (existing) |
| client_asset_people | Person tags on an asset | asset_id -> client_assets; role=athlete -> contacts.id; role=staff -> client_users.id; display_name is a render/search SNAPSHOT next to the FK, never the identifier; client_id scope |
| client_content_skills | Per-academy skill preset vocabulary (6 seeded defaults + client custom) | client_id scope; slug unique per client; is_default rows undeletable by clients |
| client_asset_skills | Asset<->skill join | (asset_id, skill_slug) PK; composite FK (client_id, skill_slug) -> client_content_skills |
| v2_tickets (P3) | Greenfield V2 ticket | client_id scope; type (10 values in 4 families); status 5-state ladder; assignee_role; created_by -> client_users / created_by_staff -> staff; intake+context jsonb |
| v2_ticket_messages (P3) | Real conversation thread | ticket_id + denormalized client_id for RLS; author_kind client/staff/agent/system; system rows are the append-only status log |

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| Athlete identity via contacts.id | Core person/contact model | `decision-needed` | Review once fc-core-srvc reachable |
| Staff identity via client_users.id (nullable user_id, name-only rows) | Core staff/membership model | `decision-needed` | Same |
| Skill presets as per-tenant rows (not global enum) | Core vocabulary/enum strategy | `decision-needed` | Same |
| Ticket status transitions as system thread messages | Core audit/event pattern | `decision-needed` | Same |
| Conditional taxonomy rules in UI/API not DB constraints | Core validation layer | `partial` | Document in core module contract |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| Additive-only schema (2 nullable cols + new tables; nothing renamed/dropped) | Production data safety | Clean normalization path |
| display_name snapshots on person links | Contact merges / staff removal must not blank historical tags | Core keeps FK + snapshot pattern or re-resolves at read |
| Tier split instead of migrating marketing_tickets/content_tickets | V1 hard rule; working staff queues | Core only ever ingests the V2 rail; legacy tables retire with V1 |
| Slack channel NOT stored on ticket rows (f(type,source) in notify module) | Channel set is deployment config, not data | Core notification config, not schema |
| core checkout unavailable at design time | Repo not found for this account | Re-run align-core-data-model before P3 ships |
