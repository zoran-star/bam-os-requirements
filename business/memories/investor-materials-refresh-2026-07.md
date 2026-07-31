# Investor materials refresh - 2026-07-31 (Cole, via Claude)

The one-pager (`business/business/summary.html`, live at `/summary`) and the main deck
(`business/business/fullcontrol-investor-playbook.html`, live at `/playbook`) were rewritten
from "here's the plan" to "the product is real". Zoran to confirm before anything goes external.

Framing decisions from Cole (2026-07-31), keep them in any future edit:
- **"Beta testing", not "live/production"** - the product claims say beta with real operators.
- **Not raising now.** These docs put FullControl on investors' radar for when the round opens,
  which happens on the strength of real MRR ("the round opens on the back of that curve").
  Investment section is future-tense; CTA invites following the build, not booking a pitch.
- **Hawkeye is the investor-facing agent name**, framed as one of a family of per-area agents
  (marketing, member management next). "Sage" is retired from the playbook.
- **Pricing v2 + re-curved model** (see `../pricing-gtm-strategy.md` top block): Core $429,
  Founding $399, Growth $799, Scale $1,499+, ~$500 blended; $31K MRR @ m9 -> $168K/$2.0M @ m24.

## The narrative shift

Old arc: operators drowning -> we lived it -> we'll build it -> the plan.
New arc: operators drowning -> we lived it -> **it already runs our own academies in
production** (Hawkeye sales agents, owner approval deck, teach loop) -> money scales
onboarding capacity, not product risk.

## What changed in both docs

| Was | Now |
|---|---|
| Pricing $199 lite / $400 full / $300 blended | Founding $399, Core $499, Growth $899+, Scale $1,499+, ~$600 blended (locked 2026-07-23, see `pricing-gtm-strategy.md`) |
| Year 1.5: $75K MRR, 250 programs, $900K ARR | Official ramp model: $42K MRR @ m9 (seed-ready), $113K MRR / $1.4M ARR @ m18; one-pager links to `/projections` |
| LTV/CAC 18x, payback 1.3 months | CAC $293 vs $600 ARPU = payback inside the first month (LTV/CAC multiple dropped: the 50x+ the new model implies invites scrutiny) |
| Phase 1 "Month 4-6, first cohort coming" | "Live now": own academy fully on FullControl, first BAM Business cohort migrating |
| "See it in motion" = prototype only | Prototype = the destination; live product in production, demo on request |
| "Mobile prototype on the way" | Mobile app headed to App Store + Google Play |
| Playbook traction "Prototype live. LOIs in hand." | "Product live in production. Operators on it." |
| Playbook demo step "Show Sage greeting you" | Live production demo, lead with the Hawkeye deck |
| Claims 2 + 3 aspirational | Both carry "live today" proof lines (Hawkeye agents; teach-why loop = proprietary per-academy training data) |

Also: full em-dash sweep of both docs (repo hard rule), and fixed the `/playbook`
Vercel rewrite which pointed at a nonexistent root file (404'd).

## Still stale / needs a human

- `/investor` rewrite points at `/prototypes/fc-company/index.html` which does not exist in
  the repo - either restore the file or retarget/remove the rewrite.
- Numbers kept but NOT verified this pass: $20K+ BAM Business MRR, 82% avg client growth,
  1M+ / 19K+ / 30+ network stats, CAC $293, 73% / $4.2B playbook stats.
- Sage vs Hawkeye naming: playbook still says Sage for the AI layer; Hawkeye is what
  shipped. Zoran to pick the investor-facing name.
- `business/business/index.html` (company overview) + `fc-landing/` still carry the
  "being built" framing and prototype URL - not touched this pass.
- `plan.html` (full business plan) not touched this pass.
