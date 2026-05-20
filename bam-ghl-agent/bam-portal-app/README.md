# BAM Portal — native app (Capacitor wrapper)

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

## Regenerating icons / splash

Source art is in `assets/` (`icon.png` 1024×1024, `splash.png` 2732×2732).
After editing, run:
```bash
npm run assets
```

---

## Next step — push notifications

Apple may reject a pure WebView wrapper (Guideline 4.2, "minimum
functionality"). The fix is real native functionality — **push
notifications** via `@capacitor/push-notifications`. That is the planned
follow-up build before submitting for review.
