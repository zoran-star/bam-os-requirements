---
name: Public onboarding URL (self-serve signup for testers + new clients)
description: The shareable signup link for new clients/prospects/testers. Lands them in the client portal with sample marketing data + optional Meta connect.
type: project
---

## The links

| Purpose | URL |
|---|---|
| **Public onboarding** (share with new clients/testers) | `https://bam-portal-tawny.vercel.app/onboarding.html` |
| Client portal sign-in | `https://bam-portal-tawny.vercel.app/client-portal.html` |
| Staff portal | `https://bam-portal-tawny.vercel.app/` |

## What the onboarding flow does

1. User fills form: Academy name, Owner name, Email
2. `POST /api/clients` (no auth) creates the `clients` row (status=onboarding) + sends Supabase invite email via Resend SMTP (custom SMTP wired 2026-05-15 — `byanymeansbball.com` verified in Resend, sender `portal@byanymeansbball.com`)
3. User clicks email link → Supabase verifies → redirects to `/client-portal.html?type=invite#access_token=...`
4. Client portal `boot()` detects either the URL flag OR `user_metadata.needs_password=true` and shows the "Welcome — choose your password" form
5. User sets password (`updateUser({ password, data: { needs_password: false } })`) → reloads as logged-in client
6. Lands on Marketing tab with **4 sample campaign cards** + "Connect Meta" CTA

## Connect Meta flow (optional, post-onboarding)

- Client clicks "Connect Meta" on the Marketing tab → `POST /api/auth/meta/start` → Facebook OAuth → callback writes to `client_meta_tokens` → redirects back with `?meta=connected`
- `boot()` shows "Meta connected ✅" toast, auto-opens ad-account picker (native `prompt()` — minimum viable)
- Client picks an ad account → `POST /api/meta/adaccounts` saves `clients.meta_ad_account_id` → Marketing tab refreshes with real campaigns

If client skips Meta connect, the Marketing tab stays on sample data permanently — they can connect later via the same CTA.

## What the demo data looks like

`_DEMO_CAMPAIGNS` in `public/client-portal.html`:
- Spring Free Trial — Lead Gen: $1,247.36 / 84 / $14.85 CPL
- Summer Camp Awareness: $892.10 / 53 / $16.83 CPL
- Player Intake — Q1 Retarget: $2,104.00 / 117 / $17.98 CPL
- Coach Showcase Reel Boost: $456.20 / 19 / $24.01 CPL

Cards are slightly faded (opacity 0.85) with a `SAMPLE` pill on the title. Banner above says "Sample data shown below — Connect your Meta to see real campaigns."

## Caveats for testers

- **Meta is in Development mode** — only BAM Meta app developers/testers can complete the client-side OAuth. To open to anyone, BAM needs to submit for Meta App Review.
- **Resend rate limits**: 100/day on free tier. Plenty for invites but watch if running large test waves.
- **Email confirmation**: Supabase Site URL is `/client-portal.html`. Auth Allowed Redirect URLs include `https://bam-portal-tawny.vercel.app/client-portal.html?type=invite`.

## Related notes

- [[project_client_auth]] — full auth schema + flow
- [[project_meta_api_integration]] — hybrid client/staff Meta architecture
- [[project_marketing_content_flow]] — what's in the Marketing tab once Meta is real
