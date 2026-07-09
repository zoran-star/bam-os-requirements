# Stripe-Contact Link Cleanup - Design Scope (DECISIONS LOCKED 2026-07-08)

**Status:** C1-C4 answered by Zoran 2026-07-08. Not built.
**Where it lives:** STAFF portal, attached to the GHL contact import (Zoran's C1 call - see Decisions)
**One-liner:** Link every Stripe customer in the academy's account to their contact record from the GoHighLevel contact import, and keep those links clean going forward.

---

## 1. The non-technical part

### The problem

The academy has **two lists of people that don't know about each other**:

```
STRIPE                          CONTACTS (imported from GHL)
"Jim Newton"                    "Newton, Jim" + kid: Luke
jimmnewton@gmail.com            jimmnewton@gmail.com · (416) 555-...
card 3983 · paid $854 Apr 16    tags, trial history, custom fields
        │                                   │
        └──────── no link ──────────────────┘
```

Stripe knows the **money**. Contacts know the **person** (athlete name, phone, history, answers they gave on forms). Because nothing ties them together, the Returning Client Enroll search can only show the money side, and staff end up re-typing info the academy already collected.

### What this build does

A one-time cleanup + an always-on tie:

1. **The sweep:** portal reads every Stripe customer and every imported contact, and matches them up (email first, then phone).
2. **Sure matches link silently.** Same email on both sides = linked, no clicking.
3. **Unsure ones go to a short review list.** Side-by-side cards: *"Stripe: Jim Newton, card 3983"* vs *"Contact: Jim Newton, Luke's dad"*. Owner taps **Link** or **Skip**. Same UX feel as the existing Stripe Matcher steps.
4. **Stripe customers with no contact at all** get a contact record created from their Stripe info, so nobody is invisible.
5. **From then on it stays clean by itself:** new Stripe customers auto-link on creation, and the regular GHL contact import keeps enriching the linked records.

### What the owner gets out of it

- Returning Client Enroll shows the **full picture per result**: past member badge, athlete name, what they already told you.
- One person = one record. No more "which Jim is this?"
- The same links power receipts, the member drawer, and the agent later.

### Decisions (LOCKED 2026-07-08, Zoran)

| # | Question | Decision |
|---|---|---|
| C1 | **Where it lives** | **Split by import type.** The **member import** (Stripe Matcher / sorter) keeps matching *members* only - unchanged. The **GHL contact import** (staff side) owns the whole Stripe-to-contacts cleaning: sweep + review + keep-clean all live on the **staff portal**, attached to the contact import. Where the member import surfaces in V2 gets spec'd LATER - after the Returning Client Enroll build ships and is run for real for the client **Houssein**. |
| C2 | **Auto-link threshold** | **Exact-email matches link silently.** Everything else reviewed. |
| C3 | **Orphan Stripe customers** | **Yes** - auto-create contact rows (`source='stripe-import'`). |
| C4 | **Duplicate contacts** | **Build the merge tool** - duplicates sharing an email get merged, not just best-row linked. |

### Sequencing (from C1)

```
1. Returning Client Enroll ships  ->  2. Run it live for Houssein
->  3. Spec where the member import lives in V2
->  4. This cleanup build (staff-side, GHL contact import)
```

---

## 2. Technical design

### What already exists (a lot)

| Piece | Where |
|---|---|
| `contacts` store, synced from GHL every 10 min | `contacts` table + `api/ghl/cron-sync-contacts.js` (`bulkUpsertPortalContacts`); GTA ~1,725 rows |
| **`contacts.stripe_customer_id` column** (mostly empty - this build fills it) | contacts schema, indexed |
| Charge-email matching precedent | `api/sorter/cleanup.js` (~line 1285: billing_details/receipt_email/customer email) |
| `members.contact_id` FK + cancellations history | migrations `20260630211000`, member-management schema |
| Review-first match UX pattern | Stripe Matcher wizard (`project_pricing_sorter_wizard.md`), `api/offers/match-prices.js` |
| Stripe webhook per connected account | `api/stripe/webhook.js` (add `customer.created`/`customer.updated`) |

### Net-new

**A. Sweep + match endpoint** (`api/contacts/stripe-link.js` or a sorter action)

```
1. page GET /v1/customers on the connected account (Stripe-Account header)
2. for each: match contacts by lower(email) -> exact = AUTO-LINK
             else by normalized phone     -> exact = AUTO-LINK
             else name similarity          -> REVIEW queue
             else                           -> ORPHAN (create contact, source='stripe-import')
3. write contacts.stripe_customer_id; conflicts (2+ contacts same email)
   -> REVIEW with all candidates
4. stamp past-member badge data: cancellations + members lookup per customer
5. audit rows per link (who/how: auto-email | auto-phone | manual)
```

**B. Review UI** - side-by-side match cards on the **staff portal**, inside/next to the GHL contact import surface (per C1), Link / Skip per row, progress counter. Reuses the Matcher's visual language.

**C. Keep-clean hooks**
- `api/stripe/webhook.js`: `customer.created` -> try auto-link, else create contact
- enroll + checkout paths already know the customer id -> stamp the link at create (website/checkout.js, parent/checkout.ts, sorter/setup-monthly.js, future enroll action)
- GHL contact import cron unchanged (it enriches the same rows)

### Guards

- V2-gated; per-academy; read-only against GHL.
- Never overwrite an existing manual link automatically.
- Phone normalization must match the existing inbox/members matching helpers.
- Respect `contact_provider` seam: writes go to `contacts` only (never GHL).

### Build phases (post-approval)

| Phase | What | Size |
|---|---|---|
| 1 | Sweep + auto-link + orphan creation + audit (staff-side) | ~half session |
| 2 | Review UI for ambiguous matches (staff-side, at the GHL contact import) | ~half session |
| 3 | Webhook + write-path stamps (keep-clean) | small |
| 4 | Duplicate-contact merge tool (C4 = yes) | ~half session |

Merge tool sketch (Phase 4): pick surviving row, repoint `members.contact_id` /
`website_leads.contact_id` / `opportunities.contact_id` + `contact_field_values`,
union tags, keep non-empty fields, archive the loser (never hard-delete), audit row.

---

*Decisions locked 2026-07-08. Build waits behind the enroll pilot (Houssein) per the sequencing above.*
