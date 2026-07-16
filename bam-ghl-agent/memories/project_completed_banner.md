# "Completed while you were away" banner (client portal)

**Shipped 2026-07-06.** Mike's suggestion (client perspective): the portal should surface the latest completed ticket on login instead of making clients hunt for it. Cam chose the BANNER flavor over auto-opening the ticket (auto-open would fight the 4 existing landing controllers: first-login tour, content-only redirect, command center, default nav).

## How it works
- `#completed-banner` div at the top of `.main` in `client-portal.html`, styled like the persistent GHL banner (gold tint, above every view).
- `_checkCompletedBanner()` fires at boot (after the nav gates) + on client switch. Best-effort: any fetch failure = no banner, never blocks boot.
- **What counts as completed:**
  - systems `tickets` at status **`final_review`** (systems tickets never have a 'completed' status - final_review IS the work-delivered moment; ts = updated_at)
  - `content_tickets` status completed with resolved_at, **excluding channel='funnel'** (their visible finish is the systems Change ticket - would double-banner)
  - `marketing_tickets` status completed with resolved_at (label "Campaign request")
- **Baseline = localStorage** `bam_completed_seen_<CLIENT_ID>` (ISO of newest shown item, set on View/Dismiss). No schema. 14-day floor so first run never dredges ancient tickets. Multi-device = may see it once per device (fine).
- Single item: "**{label}** was completed while you were away." Multiple: "**N items** were finished...". View → systems: `switchView('systems')` + `openTicket(id)` if loaded; marketing kinds: `switchView('marketing')`.
- Fetch reuse: `_sb.from('tickets')` direct (RLS-scoped, same as loadTickets) + `_ctkFetchForClient()` + `_mreqFetchAll()` (existing authed API helpers).

## Known limits (v1)
- V2 command-center clients: banner lives in the classic `.main` flow - verify visibility in CC mode; may need a CC mount later.
- Marketing items deep-link to the marketing view, not the specific request detail.
- All tiers see it (deliberate - biggest value for V1 systems tickets); flagged on the PR per V1 rule.

## Sibling: "We need something from you" action banner (2026-07-16, Cam)
Same placement/pattern, sits ABOVE the completed banner. `_checkActionBanner()`
+ `_abOpen`/`_abSnooze` in client-portal.html. Shows while anything is waiting
on the client: systems `status=awaiting_client`, content/marketing
`client_action_status=requested` (cancelled excluded). Key difference from the
completed banner: snooze is **sessionStorage only** - it returns every login
until the client actually responds. Born from Pro Precision replying to a
b-roll request by creating a NEW $1 campaign ticket with 78 files instead of
using Respond on the ticket.
