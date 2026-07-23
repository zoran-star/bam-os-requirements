# Pricing & GTM Strategy (repo mirror)

Source of truth: the Notion page [Pricing & GTM Strategy](https://app.notion.com/p/38f5aca8ac0f8118bf71dd7dcf0d69c7). This file mirrors additions made from the repo side; keep both in sync when editing either.

## Pricing revision + working projections (2026-07-23, Cole)

*Added by Cole (via Claude). Mirrored to the Notion page (callout under "The tier ladder"). Zoran to confirm before anything external goes out.*

**Price changes:**
- FC Core standard: **$499** (down from ~$699)
- Founding price: **$299-399, leaning $399** (down from $499)
- FC Growth ($899-999) and FC Scale ($1,499+) unchanged

**Mix assumption after founding:** ~75% Core / ~20% Growth / ~5% Scale = **blended ~$650 ARPU**

**OFFICIAL base model (locked 2026-07-23 by Cole): capacity ramp, not flat adds.**
3 dials only - adds/mo, churn, blended ARPU:
- Founding 25 @ $399 fill inside the 90-day window (months 1-3)
- Ramped adds from month 4: start **8/mo, +1 each month, capped at 25/mo** (cap = onboarding capacity)
- Blended ARPU **$600** (list mix is ~$650; $600 after discounts + annual deals)
- Churn 4%/mo on all cohorts

| Month | Accounts | MRR | ARR run rate | Marker |
|---|---|---|---|---|
| 3 | 25 | $10K | $115K | Founding window closes |
| 6 | 47 | $24K | $289K | |
| 9 | 76 | $42K | $505K | Seed-ready MRR band ($40-50K) |
| 12 | 111 | $63K | $759K | |
| 18 | 193 | $113K | $1.4M | Ramp at full capacity |
| 24 | 285 | $169K | $2.0M | |

Why ramp instead of flat 15/mo or %-MoM compounding: flat overstates the early months (nobody closes 15/mo on day one) and a raw % growth rate compounds into an indefensible hockey stick. The ramp ties growth to a real, defensible constraint (onboarding capacity) and gives a stronger exit velocity than flat ($169K vs $144K MRR at month 24).

Shareable outputs:
- One-pager: `business/fc-projections.html`, live at `/projections` (repo-root vercel.json rewrite)
- Barebones PDF: generated on request (tiers + assumptions + milestones), not stored in repo

Notes:
- A constant 25/mo cap plateaus at adds ÷ churn = ~625 accounts long-run; irrelevant inside the 24-month window.
- BAM Business growth-share revenue is NOT in these numbers (uncapped upside on top).

## Future pricing ideas (parking lot)

*Added 2026-07-05 by Cole (via Claude). Broad concepts worth considering later, not part of the current model.*

- **Pay-per-website-edit**: simple edits are free if we ship a simple self-serve website editor; bigger changes are billed per edit. Creates an upgrade path from DIY tweaks to paid build work.
- **Percent of revenue**: a 1-2% revenue share for certain things (instead of or on top of flat fees). Aligns our upside with academy growth; needs guardrails on what counts as attributable revenue.
