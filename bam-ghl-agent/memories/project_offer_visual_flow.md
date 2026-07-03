# Offer visual flow + funnel analytics - the plan (Zoran, 2026-07-03)

**Vision:** an interactive "Offer Map" inside the Business Blueprint - the
FigJam board (`docs/offer-tie-in-map.html`) but live in the portal, per offer,
with real counts, where clicking a funnel node DISPLAYS the actual page.

## Attaching the funnel PAGE to the offer - 3 levels

1. **Attach the URL (build first, ~a day):** offer stores its funnel links
   (data.sales.signup_url exists; add trial_url). The Offer Map embeds the
   LIVE page in a preview panel on click. Feasible today: funnel pages are
   static Vercel pages with no frame-blocking headers.
2. **Attach the content (partly done):** page renders FROM offer data. Enroll
   = fully offer-driven (intake/prices/waiver). Trial = calendars offer-driven
   (2026-07-03); copy still website-owned (deliberate, brand voice).
3. **Attach the whole page (endgame):** portal-owned page templates, e.g.
   byanymeanstoronto.ca/trial/<offer> renders whatever the offer says.
   Creating the ADAPT offer auto-creates its funnel pages. Enroll proves the
   pattern; evolution not rebuild.

## Funnel analytics - STARTER SET BUILT (2026-07-03)

- `funnel_events` table (migration `20260703011305`): client_id, offer_id
  (auto-derived from the funnel's entry point), funnel, step, session_id, url,
  referrer, utm jsonb, meta. Staff-read RLS; writes via beacon endpoint only.
- `POST /api/website/funnel-event` (TS, CORS like other website endpoints,
  handles sendBeacon text/plain string bodies, always 200s - beacons never retry).
- bam-client-sites (PR #49): `bamFunnel()` in shared.jsx (session id + UTM/
  fbclid/referrer captured once per session; NOT bamTrack - that's the Meta
  pixel wrapper). submitLead auto-attaches UTMs to lead fields = ad->lead->
  member attribution. Steps: free-trial page_view/form_started/form_completed/
  calendar_viewed/slot_picked/confirmed; enroll page_view/plan_viewed/
  plan_picked/paid.
- KPI display: `GET /api/kpis-v15?action=funnel&days=30` aggregates steps,
  unique sessions, step-to-step %, calendar abandonment, top UTM sources;
  "Website funnel" section in the client-portal KPIs tab renders it.

## Future menu (not built - pick when needed)

- Per-field friction (which field kills them), device split, time-to-book,
  return visits, slot supply-vs-demand by day/time, A/B copy variants,
  Meta CAPI server events (trial booked / member converted back to ads),
  payment_started/failed on enroll (needs Stripe element event hooks).
