# Questions for Mike — Clients consolidation (2026-05-17)

Context: we migrated client profile data from Notion → Supabase and made Supabase the source of truth for the portal. A handful of clients have missing or stale data, and a few roles/decisions need your sign-off. None of these block today's work — but the portal won't show full info for these clients until they're answered.

---

## 1. Supabase clients with no profile data

These clients exist in Supabase as active/onboarding accounts but have no `owner_name`, `email`, or `scaling_manager_id`. Fill in via Client Setup or tell me the values:

| Business | Status | Missing |
|---|---|---|
| **BAM GTA** | active | scaling_manager_id *(owner_name already set: Zoran)* |
| **BAM NY** | active | owner_name, email, scaling_manager_id, real notion link |
| **BAM San Jose** | active | owner_name, email, scaling_manager_id, real notion link |
| **BAM WV** | active | owner_name, email, scaling_manager_id, real notion link |
| **BTG** | active | owner_name, email, scaling_manager_id |
| **DETAIL Miami** | onboarding | scaling_manager_id *(others set)* |
| **Pro Bound Training** | active | owner_name, email, scaling_manager_id |

> BAM NY / SJ / WV: their stored `notion_page_id` points to pages no longer under Client Profiles. Either fix the link or leave it alone — the portal doesn't depend on it.

---

## 2. Real client or stale prospect?

| Client | What we did | Decision needed |
|---|---|---|
| **Alex Twin** | Created minimal Supabase row (status=onboarding), all fields blank | Is this a real client we're onboarding? If yes, fill in owner_name/email/manager. If no, delete the row. |

---

## 3. Roles & staff

| Item | Current state | Need |
|---|---|---|
| **Alex Silva** *(ACTIV8's scaling manager)* | Created as staff: name="Alex Silva", role="scaling_manager", email=null | Confirm full name. Provide her email when she needs portal access. |
| **"scaling_manager" role** | Created. Currently has same permissions as `admin` everywhere | Want to tighten scope later (e.g. no Financials access). Flag when ready to rework. |
| **Mike Eluki's role** | Still `admin` | OK to keep, or change to `scaling_manager` to match function? |
| **Duplicate Zoran rows in staff** | 2 rows: `zoran@byanymeansbball.com` + `zoransavic2000@gmail.com` | Confirm which is canonical; delete the other or keep both. |
| **"marketing test" staff row** | Likely junk | Delete? |

---

## 4. Data quality flags from Notion

| Client | Issue | What we did |
|---|---|---|
| **ACTIV8** | Notion email field had 2 addresses: `tj@activ8athlete.com / jana@activ8athlete.com` | Zoran picked Jana. Confirm. |
| **Supreme Hoops** | 2 owners in Notion: "Anthony Rizzo & Anthony Sciff" | Stored as single string in `owner_name`. Add second-owner field later if needed. |
| **Straight Buckets** | owner_name = "Joe Brooks (ops contact: Jade Sparks)" | Stored as-is. Clean up later if ops contact should be its own field. |

---

## 5. Data that didn't migrate (still lives in Notion only)

These were intentionally NOT migrated to Supabase (per the migration decisions). They stay in Notion as the human-notes layer. The portal won't show them — staff can keep using Notion for these:

- Instagram handle
- Program (Scaling System, BB Mentorship, SS Core, etc.)
- Recurring meeting day/time
- Start date / Renewal date
- Active client count (e.g. "~26 on Stripe")
- Location / Address
- Monthly investment / Ad spend defaults
- Call log entries
- Latest Update narrative
- Sales notes / Onboarding notes
- Action items table

If any of these become valuable in the portal later, we can promote them to Supabase columns case-by-case.

---

## What's safe to ignore

- **test business** Supabase row — kept intentionally as the dev test client.
- All the matched clients (Major Hoops, Basketball+, Prime, Johnson, DA Hoops, etc.) — all properly populated. No action needed.
