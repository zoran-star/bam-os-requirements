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
| _none yet_ | | | | | | | | |
<!-- /consolidate-lessons appends rows to the END of this table (delete the "_none yet_" placeholder row on the first real append). Keep rows sorted by ID. -->

Dispositions: `onboarding-question` · `brain-section-default` · `config-default` ·
`global-default` · `live-data`
