---
name: Session pickup — KPI dashboard + Sales tab (2026-06-10)
description: Where the GHL KPI / Sales / Clients work stands as of 2026-06-10, what's live, and the open follow-ups — read first when resuming this thread in a new chat.
type: project
---

## What got built this session (all LIVE on portal.byanymeansbusiness.com)

Most detail lives in [[project_ad_performance_dashboard]]; this is the index + open items.

- **GHL KPI dashboard** (per academy): monthly view ("this month so far" + month-by-month),
  All purchases vs New clients, CAC. In the academy profile.
- **Journey board** (▦) per month: Board + Timeline toggle. People as cards, click → Stripe
  history, ✕ → **soft-delete** (excluded flag, survives re-pull + refresh), bottom-right
  **trash bin + undo** (persistent), no-scroll-jump on delete.
- **Per-month forms/calendars** = exact-month override (`ghl_kpi_config.effective_configs`).
- **"When were forms/calendars used?"** = `?action=form-activity` / `calendar-activity` (first→last
  + total per form/calendar; calendar window 12mo + retry-on-429). ⚠️ GHL forms/submissions needs
  explicit `startAt`/`endAt` or it only returns recent — now passed everywhere.
- **Sales tab** (new top-level tab in each academy, beside Marketing) = `<GhlKpiDiscovery salesMode/>`
  wizard: New/Old toggle (New=blank) → Old: 1) forms 2) calendars 3) monthly KPIs (All purchases,
  one **Adjust** button per month → journey board). See [[project_ad_performance_dashboard]] "Sales tab".
- **Member documents**: per-member private waiver/media/medical storage. See [[project_member_documents]].
- **Clients roster**: STATUS column is now a **progress bar** (onboarding clients fill to their
  8-step onboarding completion; active/live = full green bar; paused/churned = pill). Dropped the
  duplicate top "Clients · N total" topbar header on the clients page.
- **Tickets**: a free reply vs "Request client action" now labelled distinctly (STAFF REPLIED vs
  STAFF ASKED · awaiting reply) + a hint on the reply box.

## Open follow-ups / next steps

- **GTA leads pre-May** = likely NOT captured in a GHL form (forms only have May+ submissions even
  with the date-range fix). Confirm in Sales→Forms; if so, those months legitimately have no leads.
- **Sales "New client" tab** = blank placeholder — design what goes there.
- **Vercel intake form → auto-drop signed waiver** into member-files (member docs step 5).
- **Stripe sales** intentionally kept as-is (new subs + one-time charges, renewals excluded). Zoran
  declined tightening out incomplete/failed subscription signups (`status=all`).
- KPIs still **untested beyond GTA** — calendars/Stripe pulls are best-effort per academy.

## Deploy reminder
bam-portal does NOT auto-deploy reliably + `vercel redeploy` ships OLD code. Always:
`cd repo root && VERCEL_ORG_ID=team_6wlt8XJIU73wBv6T6SgOCr7J VERCEL_PROJECT_ID=prj_QZto4RmUsKKMHDEgS3EjauhIfpMQ vercel deploy --prod --yes`. See [[project_bam_portal_deploy]].
