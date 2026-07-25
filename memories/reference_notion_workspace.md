---
name: reference-notion-workspace
description: Notion business-requirements pages, domain/job-ID structure, table schemas, Open Loops, Working Memory
type: reference
---

Moved out of CLAUDE.md 2026-07-25 (context diet). Read this when the work touches
Notion requirements.

## Two sources of truth, kept in sync

1. **Prototype** (`prototype/src/`) - the living spec for UI, features, interactions.
   "What does the Sales page look like?" -> prototype. Deploys on push to `main`.
2. **Notion** - structured requirement tables under
   [Business Requirements](https://www.notion.so/31b5aca8ac0f81dca970c023294b24de).
   "What are the Sales requirements?" -> Notion.

**Never update one without checking the other.** Drift causes wasted work.

## Domain pages

| Domain | Prefix | North Star Metric | Page |
|---|---|---|---|
| Marketing | MKT- | Cost per qualified free trial | [link](https://www.notion.so/31b5aca8ac0f81d3bffdc79932d118c9) |
| Content | CNT- | Content output velocity | [link](https://www.notion.so/31f5aca8ac0f81229933dab1be576bf1) |
| Sales | SAL- | Qualified trial conversion rate | [link](https://www.notion.so/31b5aca8ac0f81638750d27bc0598d19) |
| Member Management | MEM- | Client retention rate | [link](https://www.notion.so/31b5aca8ac0f816c9b8ee4e4768270da) |
| Scheduling App | APP- | Client retention rate | [link](https://www.notion.so/31c5aca8ac0f81bebc61e9e76deb6a02) |
| Strategy | STR- | Business performance visibility | [link](https://www.notion.so/31c5aca8ac0f81da85dcc72bf057e3d6) |
| Profiles & Identity | PRF- | Account data integrity | [link](https://www.notion.so/3245aca8ac0f819e8166d52f994a5f7a) |
| AI Advisor | AI- | Time to confident action | [link](https://www.notion.so/3245aca8ac0f81978b4ef0972967611c) |
| Settings & Configuration | SET- | Onboarding completion rate | [link](https://www.notion.so/3315aca8ac0f81749b78f52144f369ba) |

## Schema differences per page

- **Marketing, Content, Strategy**: full schema with Parent ID column. Use Marketing as the template.
- **Sales**: full schema, no Parent ID; sub-job One-Liner may be blank.
- **Member Management**: full schema, no Parent ID.
- **Scheduling App**: different - has Category, omits Frequency / Data Inputs / Data Sources / One-Liner.
- **Settings & Configuration**: follow the Marketing schema.

## Conventions

- Job IDs: `{PREFIX}-{NUMBER}` for parents, `{PREFIX}-{NUMBER}{letter}` for sub-jobs.
- Release values: `MVP`, `V1`, `V2`, `V3`. Default status `Not Started`.
- Empty / not-applicable cell value: an em dash. (The only place an em dash is allowed.)
- When showing requirements in a table, always include the One-Liner column.
- Sub-jobs go in as separate rows.

## Working Memory

[Working Memory page](https://www.notion.so/31b5aca8ac0f81b59fd9e8b84aecffc9) holds the
CRLF and high-level state, plus a Detail Pages table linking every key Notion page.
**If a detail page is added, removed, or renamed, update that table immediately.**

## Open Loops

[Open Loops DB](https://www.notion.so/1eb460ed0646424d8ca7a4c33ceca9fc). Statuses:
CRLF (one critical blocker at a time), Open, Closed.

Proactively add a loop when you spot: an unresolved decision needing Zoran, a gap in
requirement coverage, a blocker that can't be resolved this session, prototype/Notion
drift, something Zoran says he'll do manually later, or known technical debt.

Set Status "Open" plus a Priority. **Only Zoran designates CRLF - never assign it.**

## Other Notion DBs

- Backlog: `39c1f40a005c4c9ba50b0c7fe47b45bd` (proposed, not yet built)
- Onboarding Data Points: `49be4ce65ada4d45b736070e11452edb` - see
  [[project-onboarding-datapoints]] and [[feedback-data-vs-features]]

## Gotcha

Large pages time out over Notion MCP. Fall back to the direct API via a Node script
(`@notionhq/client`, token in `whiteboard/.env.production`).

Related: [[feedback-data-vs-features]], [[project-prd-rework]]
