# Marketing overview — Budget Status column

Added 2026-07-01 (PRs #971, #972, #974). A **Budget status** column on the
cross-client staff Marketing performance roster (`MarketingOverview.jsx`), so
the marketing team (Ximena) can see at a glance who has confirmed their monthly
ad budgets.

## Where
- **UI:** `bam-portal/src/views/MarketingOverview.jsx` — last column in the
  PERFORMANCE spend table. Helper `budgetStatusCell(s)` renders the indicator;
  also added to the CSV export (`budgetStatusLabel`).
- **API:** `bam-portal/api/marketing.js` → `handleMetaOverview`. Builds
  `budgetStatusById` from the newest `budget-review` ticket per client and
  returns `budget_status` on each client row.

## State logic (source = the `budget-review` marketing ticket Ximena sends)
Newest ticket per client wins:

| `budget_status` | Trigger | Indicator |
|---|---|---|
| `complete`  | ticket `status = "completed"` | green check "Confirmed" |
| `confirmed` | client `client_action_status = "responded"` but ticket not completed | red "!" "Confirmed, needs action" |
| `requested` | `client_action_status = "requested"` (sent, not filled) | orange dot "Sent, awaiting" |
| `none`      | no budget-review ticket for that client | grey dot "Not sent" |

The `budget-review` ticket lifecycle already existed: staff POST
`type=budget-review` creates it (`client_action_status = requested`); the client
portal turns it into a "confirm your monthly budgets" popup; on client respond it
flips to `responded` and folds `fields.confirmed_budgets` in. Green only once a
human marks the ticket completed. See [[project_marketing_content_flow]].

## ⚠️ Schema gotcha — `marketing_tickets` has NO `created_at`
The timestamp column is **`submitted_at`** (plus `updated_at`, `resolved_at`).
The first cut ordered/selected by `created_at`, the query threw, the `try/catch`
swallowed it, and every client silently fell back to grey "Not sent" (fixed in
#972). Always use `submitted_at` for recency on `marketing_tickets`.

## Budget-review lifecycle rework (2026-07-14, Cam + Ximena)
Client still decides; the aftermath changed:
- **No changes -> AUTO-COMPLETES on the spot** (respond handler sets status completed + resolved_at). The old "always leave a ticket to verify" rule buried the Slack digest in zombie tasks - most overdue Marketing lines were zero-change confirms. Two existing zero-change tickets retro-completed same day (D.A. Hoops, Major Hoops).
- **Changes -> ticket stays in-progress** for marketing to apply + the client's assigned SM gets a Slack DM with the itemized changes ("Apply in Meta, then mark the ticket completed").
- Budget-status column semantics unaffected: auto-completed no-change reviews read green (correct - budgets ARE confirmed).

## Auto-apply budget changes via Meta API (APPROVED, not yet built)
**Zoran approved on a call 2026-07-14** (Cam relayed). Would be the portal's FIRST
Meta WRITE (everything today is read-only - see [[project_meta_api_integration]]).
Agreed guardrail design (research-backed, July 2026 Meta rules):
- **20% delta tier**: delta <= 20% of current budget auto-applies instantly (safe,
  no learning-phase reset). Larger increases go to a staged cron ladder (<= 20%
  steps every ~3 days) with a 24h SM hold window before step 1. Decreases > 20%
  apply in full immediately (never overspend client money to protect the algo).
- **Fat-finger net**: client-side re-type confirmation when input deviates > 50%
  from current; server ceiling ~3x highest-ever monthly spend routes to SM, no
  automation. The 20% tier itself means a 10x typo can never auto-apply.
- **Accuracy**: read-after-write verify (GET campaign back, compare), before/after
  audit trail on the ticket, idempotency key per change, feature-flag kill switch.
- **Rollout**: Cam chose IMMEDIATE live rollout (no shadow mode, 2026-07-14).
  Read-after-write verify + per-change SM DM stand in as the safety net.
- Still needed from Ximena: monthly -> daily conversion rule + per-client CPA
  floor (daily budget < target CPA x 7 can't exit learning - flag, don't apply).

