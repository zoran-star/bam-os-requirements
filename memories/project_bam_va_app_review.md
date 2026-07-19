# BAM VA (By Any Means Virtual Academy) - App Store review: expired-subscription demo account

**Status: OPEN blocker (2026-07-19).** Apple rejected the BAM VA app under **Guideline 2.1 - Information Needed**.

## What Apple said

> We need access to a demo account with an **expired subscription** to review the **entire purchase flow** (no get access purchase button).
> Provide a user name and password for a demo account with expired subscriptions in the **App Review Information** section of App Store Connect.

Their screenshot (Programs tab): every program shows **ENROLLED**, the All Access banner shows $39.99/mo, and there is **no purchase button anywhere**. The reviewer cannot exercise the purchase/subscribe flow because the demo account is fully enrolled.

## Where the app lives

- Code: **`coleman-ayers/bam-va`** (Coleman's repo - NOT in this monorepo)
- This session (bam-os-requirements) could not open it: cross-owner `add_repo` is blocked in Claude Code Remote v1. Fix must be made in a session started FROM `bam-va`.

## Fix checklist (do in bam-va, then App Store Connect)

| # | Step | Where |
|---|---|---|
| 1 | Create a second demo login whose subscription is **expired/lapsed**, e.g. `appreview-expired@byanymeansbball.com` | bam-va backend / seed data |
| 2 | Make the expired state actually render the **locked/paywall UI**: programs show a **Get Access** (subscribe) button instead of ENROLLED, All Access banner tappable to the purchase sheet | bam-va app code |
| 3 | Verify the purchase button triggers the **StoreKit / IAP** flow end to end in sandbox (reviewer will complete a sandbox purchase) | bam-va app code |
| 4 | If any code changed: bump build, archive, upload a new build | Xcode |
| 5 | App Store Connect > App > App Review Information: add the **expired-account username + password** (keep the existing enrolled account too, label both) | App Store Connect |
| 6 | Review notes: 1 line each - "Account A = active sub (full content). Account B = expired sub - open any program to see the Get Access purchase button; purchase runs via IAP sandbox." | App Store Connect |
| 7 | Reply in **Resolution Center** + resubmit | App Store Connect |

## ⚠️ Risk to check before resubmitting (3.1.1)

Apple's aside "(no get access purchase button)" can also mean the app has **no in-app purchase path at all** when unsubscribed. If BAM VA sells the $39.99/mo All Access **only on the web** (Stripe checkout) and the app just gates content, Apple will follow this 2.1 with a **3.1.1 rejection** (digital content must be purchasable via IAP). Confirm the app actually implements IAP subscriptions before resubmitting; if not, that is the real work item.

## Log

- 2026-07-19: rejection received (screenshot `Screenshot-0719-145308.png`). Plan written from `bam-os-requirements` session (branch `claude/app-review-demo-account-dy9z5o`); app repo unreachable from here.
