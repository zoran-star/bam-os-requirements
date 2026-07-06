# FullControl — native app (Capacitor wrapper)

This is the **native iOS / Android wrapper** for the BAM Business client
portal. It is a thin Capacitor shell: the app loads the live portal
(`server.url` in `capacitor.config.json`) inside a native WebView.

**Why a thin wrapper:** any change you deploy to the portal shows up in
the app instantly — no App Store resubmission for content or UI changes.
You only resubmit the native build for native changes (app icon, push
notifications, plugins, OS version bumps).

---

## ⚠️ Confirm these two values before the first build

Both live in `capacitor.config.json` and are **permanent once the app is
published** — get them right first:

| Value | Current | Check |
|---|---|---|
| `server.url` | `https://portal.byanymeansbusiness.com/client-portal.html` | Must be the **exact URL clients use** to reach the portal |
| `appId` | `com.byanymeansbusiness.portal` | The iOS/Android bundle ID — **cannot change after publishing** |

---

## Build the iOS app (requires a Mac)

**Prerequisites**
- macOS with **Xcode** (free, Mac App Store)
- **Node.js 20+** — https://nodejs.org
- **CocoaPods** — `sudo gem install cocoapods` (or `brew install cocoapods`)
- An **Apple Developer Program** account (Phase 1 — already done)

**Steps**
```bash
cd bam-ghl-agent/bam-portal-app
npm install
npx cap sync ios
npx cap open ios            # opens the project in Xcode
```
Then in Xcode:
1. Select the **App** target → **Signing & Capabilities**
2. Set **Team** to the By Any Means Apple Developer account
3. Confirm **Bundle Identifier** = `com.byanymeansbusiness.portal`
4. Choose **Any iOS Device** as the destination
5. **Product → Archive**
6. In the Organizer window → **Distribute App → App Store Connect → Upload**

The build now appears in App Store Connect, ready to attach to a version
and submit for review (Phase 3).

## Build the Android app

```bash
npx cap open android        # opens Android Studio
```
Then: **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**,
and upload the `.aab` to the Google Play Console.

---

## Updating

- **Portal content/UI change** → just deploy the portal as usual. The app
  picks it up automatically. No rebuild.
- **App icon / splash change** → edit `assets/icon.png` or
  `assets/splash.png`, run `npm run assets`, then rebuild.
- **Native change (push notifications, plugins)** → rebuild and resubmit.

## ⚠️ Release checklist (every store resubmission)

Run these on the Mac before archiving - skipping either has bitten us:

1. **`npm install && npx cap sync`** - the committed `ios/App/CapApp-SPM/Package.swift`
   and `android/capacitor.settings.gradle` are GENERATED and go stale when
   `package.json` plugins change. Without a sync, push notifications, keyboard,
   haptics, badge, and the in-app browser are silently MISSING from the build.
2. **Bump the build numbers** - App Store Connect and Play both reject a
   re-upload with the same number. iOS: `CURRENT_PROJECT_VERSION` (and
   `MARKETING_VERSION` for a user-visible version) in Xcode. Android:
   `versionCode` / `versionName` in `android/app/build.gradle`.
3. **Check the APNs entitlement** - `ios/App/App/App.entitlements` must say
   `production` for TestFlight/App Store builds (dev tokens get no pushes).
   Currently set to production; Xcode can flip it back when toggling
   capabilities, so verify before archive.

## Regenerating icons / splash

Source art is in `assets/` (`icon.png` 1024×1024, `splash.png` 2732×2732).
After editing, run:
```bash
npm run assets
```

---

## Push notifications

Push notifications are wired in — this is the native functionality that
defends against Apple's Guideline 4.2 ("just a website") rejection.

**What's built:**
- `@capacitor/push-notifications` plugin added to `package.json`.
- `capacitor.config.json` declares `PushNotifications.presentationOptions`.
- The live portal (`bam-portal/public/client-portal.html`) registers the
  device on login, captures the APNs/FCM token, and saves it to the
  Supabase `device_tokens` table tied to the logged-in client. The block
  is a no-op in a normal browser / PWA — it only runs inside this wrapper.

**Required before push works on a device** (do during the iOS build):
1. Run the DB migration once: `bam-portal/scripts/migration/device-tokens.sql`
   in the Supabase SQL editor (creates the `device_tokens` table + RLS).
2. In Xcode → **App** target → **Signing & Capabilities** → **+ Capability**
   → add **Push Notifications**.
3. In the Apple Developer portal → **Certificates, IDs & Profiles → Keys**
   → create an **APNs Auth Key** (`.p8`). Save the key file, Key ID, and
   Team ID — the staff "send" backend will need them later.
4. `npx cap sync ios` copies the plugin into the native project.

**Not built yet (follow-up):** the staff-side "send a notification" UI and
the APNs send backend. The app *collects* device tokens now; *sending* is
a separate build after the app is approved.
