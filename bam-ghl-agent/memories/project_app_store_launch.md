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
- **`server.url` verified** — 2026-05-20: curled both candidate URLs;
  `portal.byanymeansbusiness.com/client-portal.html` and the raw
  `bam-portal-tawny.vercel.app` serve byte-identical content. Config keeps
  the custom domain (branded + stable). No change needed.
- **Push notifications (wrapper-complete)** — 2026-05-20: `@capacitor/push-notifications`
  installed; `capacitor.config.json` configured; `client-portal.html`
  registers on login, captures the device token, and upserts it to a new
  Supabase `device_tokens` table (RLS-scoped per user). No-op outside the
  native app. Staff send-side is the follow-up below.
- **`device_tokens` migration applied** — 2026-05-20: ran
  `bam-portal/scripts/migration/device-tokens.sql` against live Supabase
  (`jnojmfmpnsfmtqmwhopz`) via the Supabase MCP `apply_migration`. Verified
  7 columns, 4 owner-scoped RLS policies (select/insert/update/delete),
  2 indexes. The push registration code now has a table to write to.

### ⏳ Next steps (in order)
1. **Compile on a Mac** (Zoran's task) — needs Mac + Xcode + CocoaPods.
   `npm install` → `npx cap sync ios` → `npx cap open ios` → set signing
   Team → add the **Push Notifications** capability → Archive → upload to
   App Store Connect. Full steps in `bam-portal-app/README.md`.
2. **APNs Auth Key** — in the Apple Developer portal create a `.p8` APNs
   key; save the key file + Key ID + Team ID (the staff send-backend needs
   them later).
3. **Phase 3 — App Store Connect**: screenshots, 1024 icon, description,
   a hosted **privacy policy URL**, App Privacy data declaration, and a
   **demo login account** for the reviewer (portal is behind a login —
   mandatory or instant rejection).
4. **Submit for review** → expect a possible 4.2 rejection round → then
   request Unlisted distribution → release.

### 🔜 Follow-up (after approval)
- Staff-side "send a notification" UI in `bam-portal/` + an APNs send
  backend (service-role API route reading `device_tokens`). The app
  collects tokens now; sending is a separate build.

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

## App Store submission prep (2026-05-20)

Submission groundwork done — full end-to-end guide lives at
`bam-portal-app/app-store-submission.md` (feature approval, phone testing
checklist, store listing copy, App Privacy / Data safety declaration, demo
reviewer account spec, screenshots spec, iOS + Android submit steps,
review notes, final checklist).

- **Hosted pages shipped** — `bam-portal/public/privacy.html` +
  `support.html` deploy to `portal.byanymeansbusiness.com/privacy.html`
  and `/support.html`. The stores require hosted privacy + support URLs.
- **Decisions:** business/legal name = "By Any Means, LLC"; contact email
  = zoran@byanymeansbball.com; app is universal (iPhone + iPad); a
  dedicated demo reviewer account will be created (spec in the guide).
  Demo reviewer login email = `zoran+appreview@byanymeansbball.com` — a
  plus-alias to Zoran's inbox (decided 2026-05-21; the originally-spec'd
  `appreview@byanymeansbusiness.com` mailbox never existed).
- **Members hidden in the app** — Zoran chose to ship the app WITHOUT the
  Members tab. `isNativeApp()` in `client-portal.html` (wraps
  `Capacitor.isNativePlatform()`) makes `applyMemberMgmtNavState()` hide
  the `[data-feature="members"]` nav inside the native wrapper only —
  Members stays live on the web so it keeps being built + can onboard
  real clients. App v1 = 4 tabs (Systems, Messages, Marketing, Team) +
  push + tour. To bring Members into the app later: delete
  `&& !isNativeApp()` in `applyMemberMgmtNavState()` and resubmit.
- **Approval-risk section** added to the guide — the WebView-wrapper
  rejection traps (Apple 4.2 "just a website", 2.1 demo login, 5.1.1(v)
  account deletion, 4.8 Sign in with Apple) each mapped to a mitigation.
  Login is email/password only (no Sign in with Apple needed) and the app
  is login-only (no in-app signup → no account-deletion flow required);
  native push is the key 4.2 defense.
- **Still on Zoran:** phone testing (Part 2 checklist), create + seed the
  demo account, screenshots + Play feature graphic, the Mac compile, and
  the two store submissions.
- **Resume command:** `/app-submission` (repo-root `.claude/commands/`)
  reloads this work, prints a 9-step status board, and continues the
  walkthrough.

## Step 4 — Demo account (in progress, 2026-05-21)

Demo reviewer account `zoran+appreview@byanymeansbball.com` / "Demo
Academy" client created in the staff portal — auth user + clients row
exist and are linked. Blocker hit: clicking the invite email landed on
the **staff** portal HQ login, not the client portal.

Root cause = the Supabase redirect_to → Site URL fallback bug; fixed in
commit `d35d124` (see [[Client Portal Auth]] gotcha). Once that deploy
lands, re-send the invite/reset for Demo Academy → it lands on the
client portal → set the password → submit one sample ticket → Step 4
done. The stale `CLIENT_PORTAL_URL` env var can be deleted from Vercel.

## Related notes
- [[project_client_portal_mobile]] — the mobile/phone layout pass that made
  the portal phone-ready (prerequisite for the app)
- [[project_member_management_portal]] — the Members feature, now hidden in
  the native app (still live on web)
