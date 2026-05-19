---
name: Client onboarding method + derived status pill
description: 2026-05-19 — added clients.onboarding_method ('call' | 'send_link') + clients.call_completed_at. Status pill on Clients list/detail now derives from method + completion fields, not the raw status column.
metadata:
  type: project
---

## What this is

Per-client onboarding can happen two ways: a live walkthrough call (Zoom/phone) or a self-serve email invite link. The Setup tab now lets staff pick which one, and the Clients list shows a status pill that reflects where that client actually is in the funnel — not just the raw `status` column.

## DB additions (2026-05-19 migration)

```sql
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS onboarding_method text
    CHECK (onboarding_method IN ('call', 'send_link')),
  ADD COLUMN IF NOT EXISTS call_completed_at timestamptz;
```

- `onboarding_method` — nullable; null means "no method picked yet" (legacy clients + brand-new rows).
- `call_completed_at` — nullable timestamptz. Set when staff checks "Call done?" in the Setup tab.

## Status pill logic (frontend)

Single helper `deriveClientStatus(client, t)` in `ClientsCombinedView.jsx` — used by both `ClientRow` (list) and `StatusPill` (detail header):

| Condition | Label | Color |
|---|---|---|
| `status === "paused"` | Paused | mute |
| `status === "churned"` | Churned | red |
| `status === "active"` | **Live** | green |
| `status === "onboarding"` + `method=call` + `call_completed_at` set | Live | green |
| `status === "onboarding"` + `method=call` + no completion | Call pending | amber |
| `status === "onboarding"` + `method=send_link` + `auth_user_id` set | Live | green |
| `status === "onboarding"` + `method=send_link` + no auth user | Pending link accept | amber |
| `status === "onboarding"` + no method picked | Onboarding | amber |

Two "Live" paths exist:
1. **Call done** — backend auto-flips `status` to `"active"` when the checkbox lands true, so this case usually surfaces as `status === "active"`.
2. **Link accepted** — backend does NOT currently flip status when `auth_user_id` gets attached. That's why the derive function checks `auth_user_id` directly for send_link clients. See "Known gap" below.

## Backend behavior — `update-fields` action

Two new fields accepted by `POST /api/clients?action=update-fields`:

- `onboarding_method` — validated against `['call', 'send_link']`, also accepts `null` to clear.
- `call_completed_at` — accepts boolean (`true` → ISO `now()`, `false`/`null` → `null`), or pass-through ISO string for backfill. **Side effect:** when boolean is set, the same patch also writes `status` (`active` on true, `onboarding` on false) UNLESS the patch also includes an explicit `status` field — caller-set status wins.

That side effect is what keeps the top-of-page counters (Total / Active / Onboarding / Paused) honest: a client showing "Live" pill is always counted as Active.

## Known gap — send_link "Live" status mismatch

For send_link onboarding, the "Live" pill triggers off `auth_user_id` presence, but we never flip `status` from `"onboarding"` → `"active"` when the client first logs in. So a send_link client who has accepted the invite shows:
- Status pill: **Live** ✓
- Onboarding counter: still includes them (since `status === "onboarding"` in DB)
- Active counter: does NOT include them

To fix properly: wherever `auth_user_id` gets attached to a client row (on first portal login / setup-account completion / wherever), also patch `status = 'active'` if it was `'onboarding'`. Left for a follow-up.

## Files touched

- `bam-ghl-agent/bam-portal/api/clients.js` — added the two fields to `update-fields` with auto-promote-status side effect
- `bam-ghl-agent/bam-portal/src/views/ClientsCombinedView.jsx`:
  - Added `deriveClientStatus()` helper
  - Added `OnboardingMethodPicker` component (two pills + conditional "Call done?" checkbox)
  - Refactored `StatusPill` to take `client` prop instead of `status` string
  - `ClientRow` uses the derived label instead of raw `status`
  - SetupTab renders a new "Onboarding" section between Basics and Integrations

## Related notes

- [[project_clients_supabase_consolidation]] — the earlier `clients` table cleanup that added `scaling_manager_id`
- [[project_client_portal_tour]] — the first-login tour that runs when a send_link client lands on the client portal (this is where we should also flip status to active to close the known gap)
