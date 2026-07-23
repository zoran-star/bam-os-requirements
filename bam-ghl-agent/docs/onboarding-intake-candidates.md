# Onboarding Intake Candidates (mined from agent lessons)

The `/consolidate-lessons` skill mines every academy-specific lesson for the
question: **"which client fact, collected at onboarding, would have made this
correction unnecessary?"** Each candidate lands here first. This ledger is the
dedupe + decision log; the Notion **Onboarding Data Points DB**
(`49be4ce65ada4d45b736070e11452edb`) stays the canonical intake list - accepted
candidates get a row there and a link back here.

Rules:

- IDs are `IC-001`, `IC-002`, ... never reused.
- **Rejected is final** - the skill must never re-propose a rejected candidate.
- Deferred = worth doing, not now. The skill skips it but may remind Zoran.
- **Accepted means BUILT**: a candidate is only marked `accepted` once the
  question actually exists in the V2 UI at the workshopped placement (BB card,
  offer setup, onboarding side page, Knowledge section, or Settings) with
  storage wired. Until then it stays `proposed`.
- Source quotes are the raw lesson text (they become the "BAM GTA Example" in
  Notion).

| ID | Candidate data point | Disposition | V2 UI placement | Source academy | Source lesson quote(s) | Status | Notion link | Decided |
|---|---|---|---|---|---|---|---|---|
| IC-001 | Areas served / catchment (how far athletes travel, which towns) | onboarding-question | BB card Locations (per-location "areas served" field); feeds selling_points/business_info render + website SEO | BAM GTA | "athletes travel from over 40 minutes... areas served should just be a question in the onboarding... good for SEO for the website and the agent" | accepted (data + renderer done via offer value; dedicated UI field pending) | - | 2026-07-23 |
| IC-002 | Sibling policy (can siblings join the same session? age exceptions?) | onboarding-question | Offer setup > policy block (`policy.sibling_policy`, text input); rendered by `renderPolicies` | BAM GTA | "don't worry about asking for the second athlete, they can just join (for bam gta only)"; "with siblings we would let a younger athlete in (only bam gta)" | accepted (renderer + GTA data done; wizard question pending) | - | 2026-07-23 |
<!-- /consolidate-lessons appends rows to the END of this table (delete the "_none yet_" placeholder row on the first real append). Keep rows sorted by ID. -->

Dispositions: `onboarding-question` · `brain-section-default` · `config-default` ·
`global-default` · `live-data`
