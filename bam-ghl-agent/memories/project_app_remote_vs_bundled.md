# Decision: remote-URL wrapper vs bundled app (+ Capgo)

_2026-06-29 — DECISION: stay remote-URL for now. Re-evaluate on the triggers below._

## What the app is today

`bam-portal-app/` is a **thin Capacitor wrapper**. `capacitor.config.json` sets
`server.url = https://portal.byanymeansbusiness.com/client-portal.html`, so the
native app just loads the **live web portal** in a WebView. It does NOT bundle web
assets locally (only `offline.html` fallback lives in `www/`).

**Consequence:** every web change (UI, pages, flows, logic, bug fixes) is **live in the
app instantly on next launch — zero App Store review.** Native-only changes (icon, splash,
push entitlements, new native plugins, Capacitor/OS bumps, `server.url` itself) still need a
resubmit. No tool changes that — Apple reviews native binaries, period.

## Why we are NOT installing Capgo

Capgo = OTA live-updates for **bundled** Capacitor apps ("push web changes without review").
Our app already gets that for free because it loads a remote URL. **Capgo's value = $0 for us
while we stay remote-URL.** It only earns its keep if we switch to bundling.

## Why we are NOT bundling yet

We are in a **heavy-iteration phase**. Bundling — even with Capgo — adds a build + OTA-publish +
propagation step to every change vs. remote-URL's instant deploy. Iteration speed is the thing
we are optimizing, so remote-URL wins today.

## Switch to bundled + Capgo when ANY trigger fires

| Trigger | Type |
|---|---|
| 🍎 Apple rejects the build under Guideline 4.2 ("just a website") | Forced — do it immediately |
| 📴 A core use case needs offline (courtside / dead-zone gyms) | User-driven |
| ⚡ Real complaints about slow cold start or white-screens | Quality-driven |
| 🧊 Iteration slows below ~one web change/week (product stabilized) | Cost of bundling stops hurting |

**Cleanest single threshold:** still shipping web changes more than ~weekly? → stay remote-URL.
Stabilized? → bundle + Capgo (our other Capacitor app already runs Capgo = the template).

## Cheap prep to do NOW (makes the future switch a ~1-day job, not a migration)

- [ ] Build the web portal with **relative paths** (no hard-coded absolute origin)
- [ ] Add a **service worker / offline-ready caching** layer
- [ ] Avoid **hard server-coupling** in the front-end (no assumptions that the origin == the API host)

Do the prep now; keep shipping remote-URL at full speed. When a trigger fires, flip in a day.

## Native defense already in place
Push notifications + haptics + badge + splash plugins are shipped, which is the main hedge
against a 4.2 thin-wrapper rejection. See README "Push notifications".
