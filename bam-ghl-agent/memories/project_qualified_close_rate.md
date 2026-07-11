# Qualified trial close rate (definition + popup)

**2026-07-10 (PR #1357, shipped to live client portal).** The Sales command-center
"Qualified trial close rate" now matches Zoran's exact definition.

**Definition:** population = post-trial cards marked **showed up + good fit**
(`post_trial_reviews.showed_up=true AND good_fit=true`). Of those:
- **won** = the lead became a paying member (ground truth) OR an opportunity/outcome marks it won
- **lost** = the lead's opportunity/outcome is marked lost (`pipeline_outcomes.status='lost'`)
- **pending** = neither yet (EXCLUDED from the rate)
- **rate = won / (won + lost)**, null if 0.

**Why it was wrong before:** old calc was `new members in 45d / (new members + not-a-fit reviews)`
- mixed opposite populations (counted NOT-a-fit as the loss), ignored `showed_up`, counted every
new member as a win. It even said so in its own header note.

**Data-model gotchas (the hard part):**
- `post_trial_reviews.opportunity_id` is a **MIX** of portal UUIDs and GHL ids; `members` /
  `pipeline_outcomes` key on **GHL ids only**. Bridge through the `opportunities` table
  (`o.id::text = opp_id OR o.ghl_opportunity_id = opp_id`) to get the canonical id.
- **"won" reads from the `members` table first** because `opportunities.status` LAGS the real sale
  (found a live win where the opp still said "open"). `opportunities.status` never holds 'lost' at
  all - lost lives only in `pipeline_outcomes`.
- A good-fit lead only gets a "lost" marker via the pipeline **Mark Lost** AFTER the good-fit form
  (the form itself writes no outcome for good_fit=true). So early on the denominator's lost half is
  near-empty and the rate reads ~100% / "-" until trials resolve. That's correct, not a bug.

**Code:**
- SQL functions (live in prod): `cc_qualified_close_rate(client_id, since)` (counts) and
  `cc_qualified_trials(client_id, from, to)` (per-trial rows: name, contact id, trainer, trial date,
  outcome, plan).
- Endpoint `api/ghl/cc-sales-kpis.js` takes optional `from`/`to` (default 45d), returns
  `won`/`lost`/`pending` arrays + counts + `closing_rate` + `prev_closing_rate` (preceding
  equal-length window, for the trend). Still returns `sales_7d`/`sales`.
- Client portal (`client-portal.html`): close rate is its own tappable box (`#cc-sal-close-box`) →
  `_ccOpenCloseRate()` popup (prefix `cccr-`): number box + trend, from/to date picker, Closed |
  Lost columns (plan pill on Closed), full-width Pending chips. Every name → `_hk2OpenContact`.

V2-only surface. Related: [[project_command_center]], [[project_kpis_offghl]].
