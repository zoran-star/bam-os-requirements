# `hour12` is banned in the portal. Use `hourCycle`.

**The rule:** `hourCycle: "h23"` for 24-hour, `hourCycle: "h12"` for 12-hour display.
**Never** `hour12`, either value. CI fails the PR if one appears.

## Why

`hour12` is not a cycle you choose, it is a **hint the engine resolves**, and the same ICU resolves it differently on different V8 versions:

| runtime | `hour12: false` resolves to | local midnight renders |
|---|---|---|
| Node 20 (what CI runs) | `h24` | `24` |
| Node 24 | `h23` | `00` |

Any code doing arithmetic on that hour is **exactly one day out at local midnight**, in every zone at UTC+0 or ahead.

`hour12: true` has the same problem at **noon**: `h11` is a legal resolution and renders 12pm as `0:00 PM`.

## It bit three times in one day (2026-07-30)

1. Turned Portal CI red.
2. Put Europe/London (Elite Smart Athletes) a day behind on the Home dashboard for the ~5 months a year London is UTC+0.
3. Would have silently stopped the trial-summary cron for any academy setting `send_hour = 0`.

Each was fixed as an instance while the pattern stayed in the tree, which is why it kept coming back.

## They cannot coexist

Per ECMA-402, `hour12` **overrides** `hourCycle`. Adding `hourCycle` next to `hour12` fixes nothing. The hint must be **removed**.

## Where it is enforced

| thing | path |
|---|---|
| CI gate | `bam-ghl-agent/bam-portal/scripts/check-no-hour12.mjs` (`npm run lint:no-hour12`) |
| CI step | `.github/workflows/portal-ci.yml`, step "No hour12 in portal source" |
| Test suite | `bam-ghl-agent/bam-portal/api/_local-day.test.mjs` (case 4 text pins, case 10 belt-and-braces, case 11 sweep) |
| Shared local-ISO builder | `bam-ghl-agent/bam-portal/api/_local-iso.js` (used by `agent/booking.js` AND `website/availability.js`) |

**No allowlist, no display carve-out** - Zoran's explicit call, so a user can never be shown "24:00" either. The gate skips test files only because `_local-day.test.mjs` exists to pin the string's absence and has to be able to name it.

## Gotchas for the next person

- Put "why hourCycle" comments **above the function signature**, not inside the body. Case 4 pins that function bodies contain no `hour12` at all, comments included.
- Don't write `MUTATE=<name>` in prose for a **retired** control. CI discovers controls by grepping that prefix and will resurrect it and fail.
- The surviving `% 24` / `=== "24" ? "00"` repairs are **defensive, not load-bearing**. Under h23 they are the identity. Do not write a comment saying otherwise.

Shipped in PR #1655.
