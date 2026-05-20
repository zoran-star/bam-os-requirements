---
name: App Store / Native App Launch
description: 2026-05-20 — getting the client portal onto the iOS App Store + Google Play as a native app. PWA shipped; Capacitor wrapper built. Next steps documented below.
type: project
---

## Goal

Get the BAM client portal (`bam-portal/public/client-portal.html`) onto the
**iOS App Store** and **Google Play** so academy clients can download it as
a real app.

## Approach — Capacitor "thin wrapper"

The portal stays a normal web app. A **Capacitor** native shell wraps it;
the app loads the LIVE portal via `server.url` inside a native WebView.

- **Portal updates** (features, fixes, copy, UI) → deploy as usual → they
  appear in the app instantly, no App Store resubmission.
- **Native shell changes** (app icon, splash, app name, the URL it points
  to, push notifications, OS/tooling bumps) → rebuild on a Mac + resubmit.

## Distribution model — Unlisted

Decided: **Unlisted** App Store distribution — on the store but only
reachable via a direct link you send academies (B2B-friendly). Not public
search; not Custom Apps / Apple Business Manager (too heavy — each client
org would need ABM).

## Status

### ✅ Done
- **PWA** — `client-portal.html` is an installable PWA. Files in
  `bam-portal/public/`: `manifest.webmanifest`, `sw.js` (network-only,
  zero caching), `icon-192/512/180.png`, plus Apple home-screen meta tags
  in the `<head>`. Clients can "Add to Home Screen" today. **Live on main.**
- **Capacitor wrapper** — `bam-ghl-agent/bam-portal-app/` — Capacitor 8
  project. iOS + Android native projects generated, app icon + splash
  generated from the BAM compass mark. `appId` = `com.byanymeansbusiness.portal`,
  `appName` = "BAM Portal". See `bam-portal-app/README.md` for build steps.
- **Phase 1** — Apple Developer Program enrollment + D-U-N-S number —
  Zoran confirmed done.

### ⏳ Next steps (in order)
1. **CONFIRM `server.url`** in `bam-portal-app/capacitor.config.json` —
   currently `https://portal.byanymeansbusiness.com/client-portal.html`.
   This is a best guess, **NOT verified**. It must be the exact URL clients
   use. (The env network allowlist now permits `*.byanymeansbusiness.com`,
   so a session can `curl` it to confirm.)
2. **Build push notifications** into the wrapper (`@capacitor/push-notifications`).
   This is the mitigation for Apple Guideline 4.2 ("just a wrapped website"
   rejection) — do it BEFORE submitting. ~1–2 days.
3. **Compile on a Mac** (Zoran's task) — needs Mac + Xcode + CocoaPods.
   `npx cap open ios` → set signing Team → Archive → upload to App Store
   Connect. Full steps in `bam-portal-app/README.md`.
4. **Phase 3 — App Store Connect**: screenshots, 1024 icon, description,
   a hosted **privacy policy URL**, App Privacy data declaration, and a
   **demo login account** for the reviewer (portal is behind a login —
   mandatory or instant rejection).
5. **Submit for review** → expect a possible 4.2 rejection round → then
   request Unlisted distribution → release.

## Key facts
- Capacitor project lives at `bam-ghl-agent/bam-portal-app/`.
- Bundle ID `com.byanymeansbusiness.portal` — **permanent once published**;
  confirm before the first archive.
- Native compile REQUIRES a Mac + Xcode (or a cloud builder: Codemagic / EAS).
- **TestFlight** is the fast-track to get the app on client phones (~1 day,
  lighter review) before full App Store approval.
- Realistic timeline: ~3–4 weeks, mostly waiting on enrollment + review.

## Environment note
The Claude Code cloud environment's network allowlist was updated to permit
`*.supabase.co`, `cdn.jsdelivr.net`, and `*.byanymeansbusiness.com` — so a
session can now query the live Supabase DB and reach the live portal
directly (e.g. to confirm the `server.url`).

## Related notes
- [[project_client_portal_mobile]] — the mobile/phone layout pass that made
  the portal phone-ready (prerequisite for the app)
