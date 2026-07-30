# Reading a connected Stripe account: one place, three outcomes

**File:** `bam-ghl-agent/bam-portal/api/stripe/_requirements.js`
**Shipped:** PR #1670, 2026-07-30. **Test:** `api/_stripe-connect-requirements.test.mjs` (plain node, 7 negative controls, runs in Portal CI).

## The rule

`readStripeAccount(acctId, platformKey)` is the ONLY place anything in the portal asks Stripe about a connected account. Do not add a second `fetch` to `/v1/accounts/...` anywhere. Callers today: `api/stripe/connect.js` (the OAuth callback), `api/action-items.js` (`backfillStripeWhenChargeable`, the self-heal), `api/members.js` (the Stripe card on the Members tab).

It returns **three** outcomes, never a boolean:

| outcome | means | may tick the onboarding step? |
|---|---|---|
| `ready` | `charges_enabled === true` | yes, and only this one |
| `not_ready` | Stripe answered no, plus `needs` / `reviewing` / `disabled_reason` | no |
| `unreachable` | we did not get an answer at all | no, and never tell an owner their account is incomplete |

`unreachable` covers a network failure, a non-2xx from Stripe and a missing platform key. It is a fact about OUR call, not about their account. The old `canCharge()` collapsed all of that into `false`, which is how a Stripe outage, an expired platform key and a genuinely unfinished account produced identical wording. House rule 10.

## Gotchas

- **Requirement codes are shown, never dropped.** `describeRequirement()` maps known Stripe codes to plain English. An unmapped code renders verbatim (`Stripe asks for: <code>`), and mapped items carry their raw codes in the list item's `title` attribute. Stripe adds codes whenever it likes, and a silently missing requirement is what made "finish the remaining steps" a dead end for Elijah (San Jose, 2026-07-30).
- **Never say "reconnect".** `backfillStripeWhenChargeable` re-checks Stripe and flips the status itself. Sending an owner back through OAuth when the blocker is inside Stripe just loops them. Every message and card says so explicitly.
- **The OAuth callback has three return flags**, not two: `connected`, `pending`, `error`. `pending` is "connected, payments not switched on yet" (or "we could not check"). `_stripeConnectReturnCheck` in `public/client-portal.html` reads them; anything unrecognised still falls through to the failure wording, so the flag cannot fail open.
- **`stripe_connect_status` values are unchanged**: `not_connected`, `onboarding`, `connected`, `disabled`. Nothing writes `disabled`, so it is dead UI (see the build-queue item on `account.application.deauthorized`).
- The Members-tab Stripe call is narrow on purpose: only when an account is stored AND the status is not `connected`. Do not widen it, or every members fetch for every academy waits on Stripe.
