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
  `portal.byanymeansbusiness.com` serve byte-identical content. Config keeps
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
- **Members + Team + Business Blueprint hidden in the app** — Zoran chose
  to ship the app WITHOUT those three tabs (Team confirmed web-only
  2026-05-22; Business Blueprint added 2026-05-27 mid-submission when
  Zoran spotted it in the screenshot prep — it's an owner-side desktop
  setup surface, not a phone-flow). `isNativeApp()` in `client-portal.html`
  (wraps `Capacitor.isNativePlatform()`) makes `applyMemberMgmtNavState()`
  hide the `[data-feature="members"]`, `[data-feature="team"]`, and
  `[data-feature="blueprint"]` nav inside the native wrapper only — all
  stay live on the web. App v1 = 3 tabs (Systems, Messages, Marketing) +
  push + tour. To bring any of them into the app later: remove the
  `!isNativeApp()` check in `applyMemberMgmtNavState()` and resubmit.
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

## Step 4 — Demo account ✅ DONE (2026-06-01)

Demo reviewer account `zoran+appreview@byanymeansbball.com` / "Demo
Academy" — fully set up and verified:
- auth user + clients row + `client_users` owner row all linked
- password set; `email_confirmed_at` 2026-05-21, `last_sign_in_at`
  2026-05-22, `onboarding_completed_at` 2026-05-22 (tour done)
- **1 sample Change ticket seeded** (id
  `03acda4e-ed3b-4f37-812d-32f07b1815ce`) with a 2-message client↔staff
  thread, so the reviewer doesn't see an empty Messages tab.

The earlier blocker (invite email landed on the **staff** HQ login) was
the Supabase redirect_to → Site URL fallback bug, fixed in `d35d124`
(see [[Client Portal Auth]] gotcha) and since deployed. **Action left for
Zoran:** put the password he set into the App Store / Play review forms.
The stale `CLIENT_PORTAL_URL` env var can still be deleted from Vercel.

**Remaining [Zoran] gates before submit:** Part 1 feature approval, Part 2
phone testing, screenshots + Play feature graphic, the Mac/Xcode compile
(iOS archive) + Android `.aab`, then the two store submissions.

## Native v1 polish pass (2026-06-05, branch `feat/app-v1-native-polish`)

Coleman's pre-submit phone test surfaced a **status-bar collision** (sticky
`.topbar` tucked under the Dynamic Island) — root cause = `contentInset:
"never"` in `capacitor.config.json` with **no `safe-area-inset-top`** anywhere
in `client-portal.html`. Fixed + a batch of native-feel polish.

**TRACK 1 — portal only (deploy, NO resubmit). DONE on the branch:**
- **#1 safe-area top** — `.topbar` padding now `calc(28px + env(safe-area-inset-top))`
  (0 on web/desktop, only the notch pays). Kills the cut-off title.
- **#2 status bar** — verified already correct (`style: DARK` on `#16140F` = light icons).
- **#5 launch flash** — verified none: `--ink` = `#16140F` = Capacitor splash/bg color.
- **#3/#7 feedback widget** — smaller (44px) + calmer opacity in-app (kept, not hidden).
- **#4 overscroll** — `overscroll-behavior-y: contain` on `.main` (the scroller).
- **#6 + #10 native tells** — tap-highlight/long-press-callout/stray selection killed,
  scoped to `body.native-app` (set via `isNativeApp()`); selection re-enabled on
  inputs + chat. Web/PWA untouched.
- **#17 pull-to-refresh** — JS PTR on `.main`, native-only, skips the chat view.
- All gated by a new `body.native-app` class (works in `?native=1` preview too).
- Tour verifier passes.

**TRACK 2 — native rebuild + resubmit. CODE DONE on branch `feat/app-v1-native-track2`
(Coleman chose all 7 push events):**
- **#14 push sending** — `api/push/_send.js` = dependency-free APNs sender
  (Node `http2` + `crypto` ES256 JWT, sandbox/prod host auto-fallback, prunes
  dead tokens, 7-event catalog). `api/push/send.js` = admin-gated manual/test
  send + `?action=status`. Triggers wired beside existing Slack notifies (never
  throw, no-op until APNS_* env set):
  - #1 ticket-action-needed → tickets.js request_client + send_for_final_review;
    marketing.js + content request-client-action
  - #2 ticket-complete → tickets.js approve; marketing.js + content mark-completed
  - #3 action-item-assigned → action-items.js create + reassign
  - #4 action-item-due-soon → action-items.js cron-due-soon
  - #5 new-message → messages.js send (only when STAFF sends)
  - #7 weekly-digest → `api/push/cron-weekly.js` + vercel.json cron (Mon 14:00 UTC)
  - #6 campaign-milestone → admin manual send only; auto-detect needs a Meta
    status poller (campaigns live in Meta, not the portal) — documented follow-up
- **#15 deep-link** — `pushNotificationActionPerformed` → `switchView(data.view)`
  (+ best-effort openConversation). All pushes carry type + ids + view.
- **#12 haptics** — `hapticTap()` on tab switch (`@capacitor/haptics` ^8.0.2 added).
- **#13 badge** — `setAppIconBadge()` mirrors unread (`@capawesome/capacitor-badge` ^8.0.2 added).
- **#11 Face ID** — `initBiometricLock()` FAIL-OPEN gate on boot/resume. Biometric
  plugin NOT in package.json (Cap-8 compat unverified) — install on Mac; JS
  feature-detects, so inert until then.
- **#16 offline screen** — `bam-portal-app/www/offline.html` (self-contained) +
  `server.errorPath`.

**Manual steps left to ACTIVATE Track 2 (Coleman/Zoran):**
1. **APNs `.p8` key** — Apple Developer → Keys → create APNs key. Save .p8 + Key ID + Team ID.
2. **Vercel env** — `APNS_KEY_P8` (or `_BASE64`), `APNS_KEY_ID`, `APNS_TEAM_ID`,
   `APNS_TOPIC=com.byanymeansbusiness.portal`. Until set, every push is a silent no-op.
3. **On the Mac:** `cd bam-portal-app && npm install` (gets haptics+badge), optional
   `npm install @aparajita/capacitor-biometric-auth` for Face ID, then `npx cap sync ios`.
4. **Xcode:** confirm Push Notifications capability (already added), Archive, upload, resubmit.
All Track 2 client JS is feature-detected/fail-safe → safe to deploy to web/current app NOW.

**Out of scope (Coleman's call 2026-06-05):** hiding the feedback widget (#7 —
improve instead), tab audit (#8), connect-copy reword (#9).

## Related notes
- [[project_client_portal_mobile]] — the mobile/phone layout pass that made
  the portal phone-ready (prerequisite for the app)
- [[project_member_management_portal]] — the Members feature, now hidden in
  the native app (still live on web)
- [[project_member_management_portal]] — the Members feature, now hidden in
  the native app (still live on web)
