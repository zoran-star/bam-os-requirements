# BAM GTA Summer Unlimited migration - session resume (2026-06-30 / 07-01)

Live-hands-on session moving BAM GTA members onto Summer Unlimited + fixing the
change/cancel flows. Scope: V2 / BAM GTA only. Supabase client_id
`39875f07-0a4b-4429-a201-2249bc1f24df`.

## Stripe access (IMPORTANT for next session)
- Stripe MCP is connected as **"By Any Means Toronto"** `acct_1P7kUCRxInSEtAh8` (the
  academy account directly - customers/subs live here, no Stripe-Account header needed).
  May need re-auth in a fresh session (`mcp__stripe__authenticate`).
- What the MCP CAN do: `stripe_api_read`, `stripe_api_write` for a LIMITED set -
  **update a subscription** (`PostSubscriptionsSubscriptionExposedId`), **create a
  payment link** (`PostPaymentLinks`), create refund. Plus `get_stripe_account_info`.
- What it CANNOT do: **create a subscription** (`PostSubscriptions` is blocked),
  Checkout sessions, billing-portal sessions. So no hosted "save card" link and no
  new-sub-on-existing-customer via MCP - those stay portal-only (Get card link,
  Set up billing).

## Price ids (BAM GTA)
- Summer Unlimited Monthly: `price_1Ti6PCRxInSEtAh89gUsOSFj`  $315.27 (4_weeks)
- Summer Unlimited 3mo:     `price_1Ti6PLRxInSEtAh8OprQcH9Q`  $850.89
- Steady monthly:           `plan_ToNwa96lQ5I1Bs`             $226
- Steady 6mo (keeper):      `price_1TgaMPRxInSEtAh8Hpa5wyTN`  $1130
- Old 2/wk "Accelerated":   `plan_ThYK86w2Zd8fp3`             $316.39 (the pre-migration price)

## Recipe: move a member to Summer Unlimited Monthly (same 4-week interval = swap in place)
1. Read their sub (`GetSubscriptionsSubscriptionExposedId`) - confirm status, trial_end, card.
2. `stripe_api_write PostSubscriptionsSubscriptionExposedId`:
   `items:[{id: <si_...>, price: price_1Ti6PCRxInSEtAh89gUsOSFj}]`,
   `proration_behavior: none`, `payment_settings.save_default_payment_method: on_subscription`,
   `metadata.origin: fullcontrol-portal`. **Do NOT pass trial_end** = keeps their start date
   ("start at the same time"). Only swap if intervals match (SU monthly is 4_weeks).
3. Sync DB: `update members set stripe_price_id='price_1Ti6PC...', plan='Summer Unlimited', updated_at=now() where id=...`

## The swap-bug (fixed) + drift sweep
The change-plan SWAP path used to persist only `plan`, not `stripe_price_id`, so DB rows
drifted (roster showed old price/Archived while Stripe was on the new one). Fixed in PR #946.
Members changed in the gap before deploy drifted; catch/repair with:
```sql
with last_change as (
  select distinct on (member_id) member_id, args->>'new_price_id' as changed_to, created_at
  from member_audit_log where action_type='change' and args->>'new_price_id' is not null
  order by member_id, created_at desc)
update members m set stripe_price_id=lc.changed_to, updated_at=now()
from last_change lc where m.id=lc.member_id
  and m.client_id='39875f07-0a4b-4429-a201-2249bc1f24df'
  and m.stripe_price_id is distinct from lc.changed_to;
```
Verified 0 drift at session end. (Only repoint to a price the sub is actually on - the
audit is written after the Stripe call succeeds, so `changed_to` = live price.)

## Other recipes learned
- **Alternate payment** (pays cash/e-transfer, no Stripe): `members.billing_mode='alternate'`
  (+ set plan label). Portal button = `_memberUpdateField(id,'billing_mode','alternate')`.
- **"needs card" status** = `members.status='payment_method_required'`.
- **Cancel a member whose Stripe sub is already canceled**: insert a `cancellations` row
  (type='cancel', cancel_date=today, reason, sub/customer ids) then `delete from members`.
  Code now swallows the "A canceled subscription can only update..." Stripe error (#953).
- **No-sub member (canceled sub, can't recreate via MCP)**: `PostPaymentLinks` with SU monthly,
  `subscription_data.trial_period_days=N` (relative), `restrictions.completed_sessions.limit=1`,
  metadata origin+member_id. Caveat: makes a NEW customer + trial is relative to signup day;
  repoint the DB after the parent pays.

## Members handled this session
Done/on Summer Unlimited: Geetika (Arnav), Carter Li (-> Steady live), Jaden, Charlie Harris,
Bradley Choi, Arthur, Archie Duan, Andriy, Andrew, John Fu, Leen, Ketan, Knowl Beharie, Malak,
Luke Newton, Sohail (Syed Faiz), Skylar Alexander, Stefan Djeric (alternate/no Stripe).
Samuel (Elaena Hooper): canceled + removed.
Also: pricing_catalog Steady-6mo dedup (derouted $1000 orphan `price_1SD3NCRxInSEtAh8z5eiQZhT`).

## OPEN LOOPS (do next)
- **Card links needed** (subs will fail at trial end without a card): **Luke Newton**
  (cus_ULLpLWXf8ld5hh, trial Jul 8), **Sohail/Syed Faiz** (cus_TtUsi0g7nyqGrv, ~Aug 1),
  **Skylar Alexander** (cus_UMq0iDX3XLlDYE). Use portal "Get card link" (MCP can't make one).
- **Krishay** (Vaisakh, vaxhere4u@gmail.com, cus_U40DJOEKMV1bBB): payment link sent
  `https://buy.stripe.com/28E8wR9hc7M3cLJ8lL5c40c` (SU monthly, 46-day trial, single use).
  Old sub already canceled. **After he pays -> repoint his members row** to the new sub/customer.
- **Tushar**: user canceled him in Stripe and wants him off the roster, but NO member matched
  "tush" in athlete_name/parent_name for this client. Need his athlete/parent name or email
  to complete the portal-side cancel (record cancellation + delete row).

## PRs shipped this session (all merged + live)
#937 change-plan flow memory note - #940 recent payments in change modal -
#944 Set-up-billing live-only prices + plan-label sync + grouped dropdown -
#945 change-plan spinner->check overlay - #946 payment history = real charges + swap persists
stripe_price_id - #947 roster price pill trusts canonical price (fixes "1/wk on Steady" -> Live) -
#953 cancel handles already-canceled subs - #956 sortable roster column headers -
#958 slide-away card animation on cancel.

See [[project_change_plan_flow]] for the change-plan flow details.
