# Returning Client Enroll - Design Scope (DRAFT, for workshop)

**Status:** PROPOSED - not built. Workshop + approve before any code.
**Where it lives:** V2 client portal, Members tab (`public/client-portal.html`)
**One-liner:** Take someone who has already paid this academy in Stripe before (an old client) and put them straight onto a live offer, without sending them through the public checkout page.

---

## 1. The non-technical part (read this first)

### The problem today

An old client says "we want back in." Right now the owner's options are all clunky:

- Send them the public enroll page: they re-type all their info and re-enter a card **we already have on file**. Feels cold for someone who paid you for a year.
- Do it by hand in Stripe: error-prone, and hand-made subs are ones the portal **can't manage later** (no pause/cancel/change buttons work on them).
- Ask BAM staff to do it in the database: not a real option at scale.

### What this feature does (plain english)

A **"Sign up returning client"** button in the Members tab. The owner:

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌─────────────┐
│ 1. FIND     │ →  │ 2. PICK      │ →  │ 3. REVIEW    │ →  │ 4. DONE     │
│ the parent  │    │ a live offer │    │ + confirm    │    │ member is   │
│ (name/email │    │ + plan/price │    │ what will be │    │ on the      │
│ /phone)     │    │ + start date │    │ charged when │    │ roster      │
└─────────────┘    └──────────────┘    └──────────────┘    └─────────────┘
```

- The portal searches the academy's own Stripe account and shows the match: **"Jim Newton - paid $854 in April - card on file ending 3983"**.
- The owner picks the offer and plan from the academy's **live prices only** (the same ones the website sells).
- The portal shows a plain preview: *"$316.39 every 4 weeks starting Aug 1, charged to Mastercard 3983."*
- One confirm click. New member appears on the roster, billing runs itself from then on.

### The two doors (this is the important safety bit)

Whether the client has a **usable saved card** decides what happens:

| Client's Stripe state | What the portal does |
|---|---|
| **Card on file** | Creates the subscription on that card. Nothing for the parent to do (optional: send them a heads-up text). |
| **No usable card** (one-time payers, detached cards - this is real, we found 4 of these in GTA) | Creates the member as *pending* + texts the parent a **secure card link**. Sub starts the moment they add the card. No card typed = no charge, ever. |

This mirrors the lesson from the GTA billing cleanup: dead sub means start fresh, live-but-no-card means collect a card first, and **never** send a checkout link to someone who'd end up with two subscriptions.

### What the owner never has to worry about

- **Double members:** if that parent/athlete already has a live roster row, the portal says so and offers "change their plan" instead.
- **Wrong price:** only live, confirmed prices are offered. No typing amounts.
- **Un-manageable subs:** everything created here is portal-owned, so pause/cancel/change/refund all work later.

### Questions to workshop (need Zoran's call)

| # | Question | Options |
|---|---|---|
| Q1 | **Charge timing** | Charge saved card immediately vs anchor to a chosen start date (trial_end until then) vs always ask |
| Q2 | **Consent** | OK to charge a saved card with zero parent interaction? Or always send a "reply YES / tap to confirm" text first? (Recommend: owner chooses per enroll, default = notify + charge) |
| Q3 | **Search scope** | Stripe customers only, or also past-member history (cancellations) + GHL contacts so you can find them by athlete name? |
| Q4 | **Who can use it** | Owner only, or any staff with Members access? |
| Q5 | **Athlete name** | Stripe knows the parent, not the kid. Owner types the athlete name during enroll - fine? |
| Q6 | **Notify** | Auto-send confirmation SMS/email after enroll? Copy? |

---

## 2. Technical design

### Why this is ~90% assembled already

Every primitive exists; nothing wires them together for a brand-new roster entry:

| Primitive | Where it already lives |
|---|---|
| Find existing Stripe customer by email on the connected account | `api/website/checkout.js` (~line 324), `api/parent/checkout.ts` (~line 151) |
| Reuse a customer's saved card + create a portal-owned sub with `trial_end` anchor | `api/sorter/setup-monthly.js` (**the template**: `invoice_settings.default_payment_method` else `/payment_methods?customer=`, `metadata[origin]='fullcontrol-portal'`) |
| List an academy's LIVE offer prices (canonical + is_routable + confirmed + non-archived offer) | `buildTargets()` in `api/sorter/fix-payment.js` (~line 102) |
| No-card fallback: `mode:'setup'` Checkout link | `actionCardSetupLink` in `api/members.js`, `fix-payment.js` card_link |
| Flip member live on payment + access sync | `api/stripe/webhook.js` (existing events) |
| Send the link/notification by SMS/email | `api/ghl/send-message.js` + payment-link modal pattern |
| Idempotent member creation on (athlete_name, parent_email) | `api/members/intake.js` |

### Net-new pieces

**A. Backend: `enroll` action** (new PATCH/POST in `api/members.js`, or `api/members/enroll.js`)

```
INPUT  { client_id, customer_query | stripe_customer_id,
         athlete_name, parent fields, offer_id + offer_price_key
         (resolved to pricing_catalog / typed offer_prices row),
         start_date, charge_mode, notify: bool }

FLOW   1. resolve live price        (reuse buildTargets logic)
       2. resolve Stripe customer   (stored id -> /customers?email= -> ?phone=)
       3. duplicate guard           (live members row w/ same parent_email+athlete)
       4. card check                (default PM, else attached card PMs)
       5a. card:    POST /v1/subscriptions  default_payment_method,
                    trial_end = start_date (if future),
                    metadata origin=fullcontrol-portal + enroll_source=returning_client
       5b. no card: insert member status='payment_method_required'
                    + setup Checkout link -> SMS/email; sub created after
                    card saved (webhook or existing setup-monthly path)
       6. upsert members row (client_id, stripe_customer_id, sub id, price id, plan)
       7. member_audit_log row ('enroll-returning')
       8. optional GHL notify
```

Search endpoint (step 1 of the UI): `GET /api/members?action=find-customer&q=` - proxies `GET /customers/search` on the connected account (query by email/name/phone), merges hits from `cancellations` + `members_staging` for "past member" badges (Q3).

**B. UI: 3-step right-drawer wizard** in the Members tab (design system: DESIGN.md tokens, one gold, right-drawer-only, no emojis)

```
[Members toolbar]  ... [ + Returning client ]
        │
        ▼  drawer
┌────────────────────────────────────────────┐
│ STEP 1  Find client                        │
│  [search: name / email / phone      🔍]    │
│  ┌ Jim Newton · jimmnewton@ · card 3983 ┐  │
│  │ last paid $854.28 · Apr 16 · PAST    │  │
│  └──────────────────────────────────────┘  │
│ STEP 2  Offer + plan                       │
│  offer select -> live prices as cards      │
│  athlete name [________]  start [date]     │
│ STEP 3  Review                             │
│  "$316.39 / 4 wks from Aug 1 on MC 3983"   │
│  [ Confirm enroll ]   [ Send card link ]   │
└────────────────────────────────────────────┘
```

**C. Member agent tool** - `enroll_returning_client` write tool in `api/members-agent.js` (proposal-only like the other 13): *"sign Jim Newton back up for Accelerated 2x/week"* -> proposal card -> Confirm fires the same enroll action.

### Guards + gotchas baked into the design

- **V2-gated** like the rest of Members (`data-feature="members"`); V1/V1.5 untouched.
- Subs created here are **app-created** -> all 6 existing PATCH actions work on them later (avoids the Standard-Connect foreign-sub trap entirely).
- **Canceled subs can't be revived** - we never try; always a fresh sub.
- One-time payers often have **no saved card** (setup_future_usage was never set) -> door 2, never assume.
- Card link = `mode:'setup'` Checkout, **never** a subscription checkout for someone getting a sub created (no double-sub risk).
- `members_staging` / intake idempotency pattern reused for the duplicate guard.
- Native app firewall: Members tab already hidden in Capacitor - no change.

### Build phases (post-approval)

| Phase | What | Size |
|---|---|---|
| 1 | `find-customer` search + `enroll` action + drawer wizard (both doors) | ~1 session |
| 2 | Agent tool + notify SMS copy + audit polish | small |
| 3 | "Win-back" candidates surface (auto-list past members from cancellations) | later, optional |

### Onboarding data check

Only if Q2/Q6 land on "configurable": a per-academy default for **enroll notification channel + copy** (Onboarding Data Points DB, Category: Member Management, Phase: Settings). Otherwise nothing to add.

---

*Draft 2026-07-08. Workshop with Zoran, then update this doc with decisions before building.*
