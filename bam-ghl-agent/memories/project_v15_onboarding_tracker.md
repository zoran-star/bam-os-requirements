# V1.5 Onboarding Tracker (training academies)

Living board for getting every **training** academy onto V1.5 — texting leads + using pipelines in the portal. Update the status as each academy advances. Started 2026-06-19.

## 🎯 Definition of "done" (recalibrated 2026-06-19)

```
CORE-LIVE  (text leads + use pipelines)  =  v1.5 ON  +  GHL connected  +  GHL built
                                            (pipeline + calendars exist in their GHL)
   → everything below is POLISH, not a blocker:

POLISH (KPIs / UX)  =  Stripe connected · trial-calendar pick · lead+member tags
                       · sign-up link · athlete-name field map
```
The inbox + pipelines run the moment **v1.5 is ON and GHL is connected**. Stripe powers KPIs/revenue; tags add the lead/member label; sign-up link powers the post-trial auto-text; athlete map fills athlete names. None gate the core flow.

## 🔌 Connection method — Path A (per-location), decided 2026-06-19

Connect each academy via the **existing published sub-account app's** OAuth (per-location), as we onboard each. We go academy-by-academy anyway (deep-dive pipelines first), so this fits.

**Path B (agency bulk via FC2 app) is parked:** a *draft* agency app can't be bulk-installed on sub-accounts — that needs FC2 published (GHL review). The agency token IS stored (`ghl_agency_tokens`, company `90gJh9fPWfmttsG6wH6Z`) — it's the future one-click-bulk + GHL-export lever once FC2 is published. See `[[project_v15_tier]]`.

## 📊 Status board (27 training academies)

`BAM GTA = V2, the fully-built reference/template — not a V1.5 target.`

```
LEGEND  v1.5 · GHL=connected · built=pipeline/cals exist in GHL · Strp=Stripe
        cals=trial calendars · tags=lead+member · sign=sign-up link · athl=athlete map

ACADEMY                    v1.5 GHL built Strp cals tags sign athl   STATUS
══════════════════════════════════════════════════════════════════════════════
CORE-LIVE ✅
 DETAIL Miami               ✅   ✅   ✅   ✅   ✅   ❌   ❌   ✅    LIVE (polish: tags,sign)
 D.A. Hoops Academy         ✅   ✅   ✅   ❌   ❌   ❌   ❌   ❌    core-live · KPI polish
──────────────────────────────────────────────────────────────────────────────
CONNECTED, GHL NOT BUILT 🔧 (systems must build pipeline+cals, then flip v1.5)
 GAME Winner Athletics      ❌   ✅   ❌   ❌   —    —    —    —     build GHL → flip
 Hoops Made Simple          ❌   ✅   ❌   ~    —    —    —    —     build GHL → flip
──────────────────────────────────────────────────────────────────────────────
FLAGGED v1.5, NOT CONNECTED ⚠️
 By Any Means Basketball    ✅   ❌   ?    ❌   —    —    —    —     connect GHL
──────────────────────────────────────────────────────────────────────────────
NOT STARTED — connect GHL (per-location) + flip v1.5 (+ build if empty) ⚪ (22)
 BAM NY · BAM San Jose · BAM WV · CH3 Training · Danny Cooper Basketball ·
 Elite Smart Athletes · Johnson Bball · Major Hoops · Performance Space Hoops ·
 Pro Bound Training · Sage Hoops · Straight Buckets Performance · Supreme Hoops Training ·
 The Basketball Lab · Total Hoops Training · X Basketball Academy · Elevate Hoops ·
 Basketball+ · DETAIL San Diego · ACTIV8 · Quicksand Mindset
   (all: v1.5 ❌ · GHL ❌ · built ❓ — can't inspect until connected)
══════════════════════════════════════════════════════════════════════════════
EXCLUDED (not training / internal / test):
 Fitz N Fit · Defy The Odds · Out Work · Prime By Design · Pro Precision ·
 BTG · Locked In Sports · (+ internal/test rows)
```

## 🔁 Per-academy process

```
1. Connect GHL (per-location, existing app)        → unlocks inbox + pipelines + contacts
2. Flip v1.5  (Staff → Clients → academy → Overview → Portal tier → V1.5)
   ── at this point: CORE-LIVE (text leads + use pipeline) ──
3. If GHL empty → systems builds TRAINING PIPELINE + trial calendars first
POLISH:
4. Connect Stripe          → KPIs / revenue / members
5. Set trial calendars     → KPIs + Home "trials today"  (Sales tab / clients.ghl_kpi_config.booking_calendar_ids)
6. Set lead + member tags  → inbox lead/member labels  (Blueprint → training offer)
7. Set sign-up link        → post-trial auto-text  (KPIs Setup → Offers, or comms-config)
8. Map athlete-name field  → athlete names  (Contacts → Setup)
9. Verify pipelines + KPIs populate; send PDF guide / onboarding visual flow
```

## DETAIL Miami — reference notes (first one done)
- Training offer = **"Training"** (8 other `training`-type offers are camps/rentals/ADAPT/archived tiers; all have empty data).
- Trial calendars set: `Free Trial- Elementary Academy`, `Free Trial - MS and HS Academy`.
- TRAINING PIPELINE: interested → responded → schedule trial → done trial.
- Open polish: pick lead tags (candidates: `detail training free trial (bam)`, `detail miami leads (bam)`, `free trial booked`) + member tag (`detail member (bam)` / `detail members` / `pt membership`) + sign-up link.
- Scope = **training only** (camps/clinics/tryouts left out).

🎯 **GOAL:** drive every training academy to CORE-LIVE (v1.5 + GHL connected + built) so their staff text leads and use pipelines in-portal — then layer the KPI/UX polish — tracking each one's row here until it's ✅, and sending a PDF guide + onboarding visual flow as each goes live.
