# Agreement engine - one terms doc per academy (2026-07-25)

## The bug it fixed

The words a parent read and the words we filed were **two different documents**.

- Enroll page showed: an inline `EN_CLAUSES` array (GTA, Miami) or `agreement.html` (San Jose).
- The filed PDF rendered: `sampleClauses()` in `api/_lib/agreement-pdf.js` - **BAM GTA's waiver, for every academy**.

So a San Jose parent read 16 California-specific sections, signed, and we filed
a contract with different terms. Also: no record of which version was signed, and
the photo/video opt-in was displayed but never captured.

## How it works now

```
bam-client-sites/clients/<slug>/agreement.terms.json    <- THE source. Edit this.
        |
        +-- system/agreement/render.js      -> agreement.html (what the parent reads)
        +-- api/_lib/agreement-pdf.js       -> the PDF we file
        +-- sha256 over the doc             -> version_id (the "wax seal")
```

The screen and the PDF cannot drift because there is only one document.

**Block types**: `p`, `list`, `fields`, `consent`, `ack`, `note`, `signature`.
Format + field keys: `bam-client-sites/system/agreement/README.md`.

## Editing an academy's agreement

1. Edit `clients/<slug>/agreement.terms.json`, bump `revision`.
2. `node bam-portal/scripts/publish-agreement.mjs <path-to-terms.json>`
3. Deploy the site.

Step 2 stamps the `version_id` into the file AND inserts it into
`agreement_documents`. **Until you publish, checkout REFUSES the signature**
(409 `agreement_version_not_published`) rather than filing terms it cannot
identify. A forgotten publish fails loudly; it never silently records the wrong
contract. New academy = copy a terms file + an `agreement.html` shell, publish.

## Schema (migration `20260725140000_signed_agreements.sql`)

| Table | What |
|---|---|
| `agreement_documents` | published, version-stamped terms. Immutable (a trigger blocks edits to `terms`/`version_id`); republish = new row. One `is_current` per (client, doc). |
| `member_agreements` | what one parent signed: `version_id`, `signed_at`, `signature_path`, `pdf_path`, `consents` jsonb, `filled` jsonb, `client_version_id`, `version_matched`. |
| `member_consents` (view) | latest consent position per member. `media_allowed` is false ONLY on an explicit "deny", so no recorded choice never reads as opted out. |

`members.agreement_pdf_path` still exists as the denormalized "has signed" flag.

**Applied to the live project 2026-07-26** as migrations `20260726022703_signed_agreements`
+ `20260726022844_signed_agreements_harden`. The harden one matters: a Postgres view
defaults to SECURITY DEFINER, so `member_consents` initially bypassed RLS on
`member_agreements` and any authenticated user could read every academy's consent
data. It now has `security_invoker = on`. **Any new view over an RLS table in this
project needs that option** - `get_advisors('security')` catches it as
`security_definer_view`.

## Consent, and where it is honored

`api/members.js` attaches `m.consents` to every roster row
(`{ all, media_release, media_allowed, signed_at, agreement_version_id }`), and
the member drawer's Documents section shows a loud "Photo / video: NOT allowed"
pill plus the version and signed date.

**Gap, not yet closed**: nothing links a marketing/content asset to a member, so
"do not use this family's images" cannot be enforced mechanically - it is stored,
queryable and visible, but a human still has to honor it. Closing it needs
athlete tagging on assets. See [[project_marketing_content_flow]].

## Backwards compatibility

A funnel that does not send `agreement.version_id` (a site that has not
redeployed) still works: `maybeAttachAgreement` falls back to the legacy
`buildClauses()`/`sampleClauses()` path and stores `version_id =
'legacy-unversioned'`. Those two functions exist ONLY for that and for
re-rendering old agreements. Nothing new should call them.

## Watch out

- GTA and Miami keep their **mandatory** media-release grant (clause 5), not an
  opt-in. Only San Jose has a real `consent` block. Changing GTA/Miami wording is
  a business decision, not a code one.
- San Jose's terms still carry a **draft / not-for-signature** notice, and it
  renders into the PDF. Remove it in the terms file once counsel signs off.
- The San Jose document asks for DOB / grade / school; the enroll funnel does not
  collect them, so they print as blank lines. Fix by adding them to the intake,
  not by deleting them from the agreement.

Related: [[project_website_enrollment_funnel]], [[project_member_documents]].
