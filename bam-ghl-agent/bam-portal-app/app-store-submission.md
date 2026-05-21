# BAM Portal — App Store Submission Guide

The complete walkthrough for getting the BAM client portal onto the **Apple
App Store** and **Google Play**. Work top to bottom. Steps marked
**[Zoran]** need you; everything else is prepared in this repo.

For native build mechanics (Xcode, Android Studio) see `README.md` in this
folder — this guide covers everything *around* the build: approval, testing,
store listings, and review.

---

## Part 0 — The plan at a glance

```
APPROVE          TEST              ASSETS            COMPILE           SUBMIT
review the   →   run the      →    listing copy  →   Xcode / Android → App Store
feature list     test checklist    + screenshots     Studio build      Connect +
& sign off       on a phone        + demo account    (needs a Mac)     Play Console
[Zoran]          [Zoran]           (mostly ready)    [Zoran]           [Zoran]
```

The app is a **thin Capacitor wrapper** — it loads the live portal in a
native WebView. So "what gets reviewed" = whatever the live portal does the
day Apple/Google look at it. That's why feature approval + testing come
*first*: lock the portal, then submit.

---

## Part 1 — Features in this release  *(approve before submitting)*

The app shows the live client portal. An academy owner / team member signs
in and sees these tabs:

| Tab | What it does | State |
|---|---|---|
| **Systems** | Home view — overview of the academy's services with BAM | Live |
| **Messages** | Support tickets + back-and-forth action threads with BAM | Live |
| **Marketing** | Ad performance (Meta) + marketing/content requests | Live |
| **Members** | Athlete roster — **hidden in the app for v1**, live on web | Web only |
| **Team** | Invite teammates into the portal, revoke access | Live |
| Push notifications | Native push prompt on login; tokens captured | Live (sending side is later) |
| First-login tour | 8-step guided tour for new users | Live |

**Decided (2026-05-20):**
- **Members is hidden in the app for v1.** The portal is one codebase for
  web + app, so `isNativeApp()` in `client-portal.html` hides the Members
  tab inside the native wrapper while it stays live on the web. Members
  keeps developing on the real web portal; when its billing actions
  (Phase 3) are ready, delete the `&& !isNativeApp()` check and resubmit.
- **The app's v1 = 4 tabs** — Systems, Messages, Marketing, Team — plus
  push notifications and the first-login tour.
- Push **capture** works; staff **sending** notifications is a later
  build. The app still ships — it just won't send anything yet.

---

## ⚠️ Maximizing approval odds — read before you submit

A Capacitor WebView wrapper has a few well-known rejection traps. Every
real risk, and what we've done about it:

### Apple App Store

| # | Rejection risk | Guideline | Exposure | Mitigation |
|---|---|---|---|---|
| 1 | "Just a repackaged website" | 4.2 | **Highest** — it's a WebView wrapper | Native **push notifications** (the single strongest defense) + native splash/icon/status-bar; review notes frame it as the mobile client of an existing B2B platform |
| 2 | Reviewer can't get past login | 2.1 | High if mishandled | Dedicated demo account, pre-seeded, credentials in the review notes |
| 3 | No in-app account deletion | 5.1.1(v) | Low — app is **login-only**, no in-app signup | Review notes state accounts are provisioned by By Any Means (B2B invite model); 5.1.1(v) targets apps that *create* accounts |
| 4 | Sign in with Apple missing | 4.8 | **None** — email/password only, no social login | n/a |
| 5 | Broken links / incomplete UI | 2.1 | Medium | Part 2 phone-testing checklist must fully pass first |
| 6 | iPad layout broken | 2.1 | Medium — universal app | Test on an iPad; portal renders its desktop layout on tablet — confirm it looks right |
| 7 | In-app purchase of digital goods | 3.1.1 | Low for v1 | Members/billing is hidden in the app; no billing UI ships in v1 |
| 8 | Privacy policy missing/weak | 5.1.1 | Low | Hosted `privacy.html` + the App Privacy declaration |

**The big one is #1.** Native push is why this app clears 4.2 — do **not**
ship the iOS build without the Push Notifications capability enabled, and
make the review notes sell the "mobile client of a B2B platform" framing.

### Google Play

Play is more lenient with WebView apps. Watch:
- **Data safety form must exactly match reality** — use Part 5; don't
  over- or under-declare.
- **Account / data deletion** — Play wants a deletion path; the privacy +
  support pages cover "request deletion by email." Acceptable.
- **Target API level** — Capacitor 8 ships current; don't downgrade.

### Extra polish that lifts approval odds *(optional, worth it)*

- **Offline screen** — a wrapper loading a remote URL shows an ugly error
  page with no network. A simple native offline fallback in
  `bam-portal-app` reads as more "app-like" (helps risk #1).
- **TestFlight first** — surfaces crashes under a lighter review before
  the full App Store pass.
- **One store at a time** — get Apple's verdict (the harder review) first
  so any fix carries over to Play.

---

## Part 2 — Pre-submission testing checklist  *(do this on a real phone)*

Test the live portal as a client would. Easiest path: install the PWA
("Add to Home Screen" from `portal.byanymeansbusiness.com/client-portal.html`)
or use TestFlight once the first build is up. Run through every item:

**Auth**
- [ ] Sign in with email + password
- [ ] "Forgot password?" sends a reset email and the reset works
- [ ] Sign out returns to the login screen

**Each tab loads and renders**
- [ ] Systems
- [ ] Messages — open a ticket, read a thread
- [ ] Marketing — ad data / requests render
- [ ] Members — roster shows (test on the BAM GTA login)
- [ ] Team — member list shows

**Core actions**
- [ ] Submit a support ticket / reply on a thread
- [ ] Invite a teammate from the Team tab (use a throwaway email)
- [ ] Revoke that teammate

**Mobile layout**
- [ ] Bottom tab bar works; no hidden/cut-off content
- [ ] Modals open as bottom sheets, scroll, and close
- [ ] Inputs don't zoom weirdly; safe-area spacing looks right

**iPad** (universal app)
- [ ] Portal renders cleanly on an iPad (expect the desktop layout)

**Push**
- [ ] Notification permission prompt appears on login
- [ ] Permission grant is remembered

**[Zoran] Every box checked = the portal is ready to wrap and submit.**

---

## Part 3 — Assets status

| Asset | Status | Location |
|---|---|---|
| App icon 1024×1024 | Ready | `bam-portal-app/assets/icon.png` |
| Splash screen | Ready | `bam-portal-app/assets/splash.png` |
| Privacy policy (hosted) | Ready | `portal.byanymeansbusiness.com/privacy.html` |
| Support page (hosted) | Ready | `portal.byanymeansbusiness.com/support.html` |
| Listing copy | Ready | Part 4 below |
| App Privacy declaration | Ready | Part 5 below |
| Demo reviewer account | **[Zoran] to create** | Part 6 below |
| Screenshots | **[Zoran] to capture** | Part 7 below |
| Feature graphic (Play only) | **[Zoran] to create** | 1024×500, Part 7 |

Privacy + support pages go live automatically on the next push to `main`.

---

## Part 4 — Store listing copy

Paste these into App Store Connect and the Google Play Console.

- **App name:** `BAM Portal`
- **Subtitle (Apple, 30 char):** `Your academy, all in one place`
- **Short description (Play, 80 char):** `Run your sports academy — roster, billing, marketing, and support in one app.`
- **Promotional text (Apple, 170 char):**
  `Your roster, marketing, and support team in one place — and a direct line to By Any Means wherever you are.`
- **Keywords (Apple, 100 char):**
  `academy,sports,basketball,roster,members,billing,marketing,coaching,management,portal`
- **Primary category:** Business    **Secondary:** Sports
- **Support URL:** `https://portal.byanymeansbusiness.com/support.html`
- **Marketing URL:** *(optional — leave blank or your company site)*
- **Copyright:** `2026 By Any Means, LLC`

**Full description** (paste into both stores):

```
BAM Portal is the command center for sports academies that work with
By Any Means.

Sign in to run the parts of your academy that matter most — without
chasing emails or spreadsheets.

• ROSTER — See your athletes, their plans, and their status at a glance.
• MARKETING — Track ad performance and send requests to your marketing
  and content team.
• SUPPORT — Open requests and message the By Any Means team directly,
  with full back-and-forth threads.
• TEAM — Invite teammates into your portal so the whole staff stays in
  sync.
• NOTIFICATIONS — Get notified when something needs your attention.

BAM Portal is built for academy owners and their staff. Access requires
an account provided by By Any Means.

Questions? Email zoran@byanymeansbball.com
```

---

## Part 5 — App Privacy declaration

The portal collects only what it needs to run. **None of it is used for
tracking or advertising.** Declare exactly this:

### Apple — "App Privacy" (App Store Connect)

| Data type | Collected? | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Name | Yes | Yes | No | App Functionality |
| Email Address | Yes | Yes | No | App Functionality |
| Phone Number | Yes | Yes | No | App Functionality |
| User Content (messages, tickets, files) | Yes | Yes | No | App Functionality |
| Device ID (push token) | Yes | Yes | No | App Functionality |
| Usage Data | No | — | — | — |
| Crash / Diagnostics | No | — | — | — |
| Location | No | — | — | — |

"Used to Track You" = **No** for every item.

### Google Play — "Data safety"

- **Data collected:** Name, Email, Phone, Messages/User content, Device IDs.
- **Data shared with third parties:** No (vendors are processors, not
  third-party sharing for ads).
- **Encrypted in transit:** Yes.
- **Users can request deletion:** Yes — via `zoran@byanymeansbball.com`.
- **Committed to the Play Families policy:** Not a kids' app — it's a B2B
  business tool.

---

## Part 6 — Demo reviewer account  **[Zoran]**

Apple and Google **require working credentials** to review a login-gated
app — no login, instant rejection. Don't hand-write SQL for this: use the
staff portal's own **create-client + invite** flow, which fills every
table/column correctly (the schema has drifted from the repo's `.sql`
files, so raw inserts are fragile).

**Steps:**
1. **Staff portal → Clients → New client** — create **"Demo Academy"**.
2. **Send the invite** (Setup account) to **`zoran+appreview@byanymeansbball.com`**
   — a plus-alias that delivers to Zoran's real inbox (decided 2026-05-21;
   `appreview@byanymeansbusiness.com` was never created).
3. Open the invite email → it lands on the **client portal** → **set a
   password**. Write it down — it goes in the review form.
4. Log in once as the demo account and **submit one sample support
   ticket**, so the Messages tab isn't empty for the reviewer.
5. Test the login end to end before submitting.

**Reviewer credentials** (for the App Store / Play review forms):
- Email: `zoran+appreview@byanymeansbball.com`
- Password: *(the one set in step 3)*

> Bonus: this doubles as a live re-test of the invite-redirect fix — the
> invite must land on the client portal, not the staff portal.

---

## Part 7 — Screenshots  **[Zoran]**

Capture the live portal. You can shoot real device screenshots once the
build is on TestFlight, or use a browser at the exact pixel sizes.

**Apple — required sizes** (3–10 each, portrait):
- **iPhone 6.9":** 1290 × 2796 px
- **iPad 13":** 2064 × 2752 px

**Google Play:**
- **Phone:** 2–8 shots, min 1080 px on the long side
- **Tablet:** 7" and 10" shots (since the app is universal)
- **Feature graphic:** 1024 × 500 px — required by Play

**Shoot these 5 screens** (signed in as the demo account):
1. **Systems** — the home overview · caption: "Your academy at a glance"
2. **Messages** — a ticket thread · caption: "A direct line to your team"
3. **Marketing** — ad performance · caption: "Track every campaign"
4. **Members** — the roster · caption: "Your whole roster, organized"
5. **Team** — the team list · caption: "Bring your whole staff in"

Keep the demo account's data clean — no real client names in any shot.

---

## Part 8 — iOS: build, upload, submit  **[Zoran]**

Build mechanics are in `README.md`. After the build is uploaded:

1. **App Store Connect → My Apps → +** — create the app. Bundle ID
   `com.byanymeansbusiness.portal`, name `BAM Portal`.
2. Fill the version: description, keywords, subtitle, promo text, support
   URL (all from Part 4), screenshots (Part 7), 1024 icon.
3. **App Privacy** — enter the declaration from Part 5.
4. **App Review Information** — paste the demo credentials (Part 6) and the
   review notes (Part 10).
5. **Age rating** — answer the questionnaire (it's a business tool — no
   objectionable content; expect 4+).
6. Attach the uploaded build → **Submit for Review**.
7. After approval: request **Unlisted** distribution (Apple grants it
   separately — the app stays off public search, reachable by direct link).

**Fast path:** push the build to **TestFlight** first — lighter review,
~1 day — to get it on real client phones while full review runs.

---

## Part 9 — Android: build, upload, submit  **[Zoran]**

Build mechanics (`.aab`) are in `README.md`. In the Google Play Console:

1. **Create app** — name `BAM Portal`, app (not game), free.
2. **Store listing** — short + full description, screenshots, feature
   graphic, app icon (Part 4 + Part 7).
3. **Data safety** — enter the declaration from Part 5.
4. **App content** — privacy policy URL, ads (none), content rating
   questionnaire, target audience (adults), news app (no).
5. Upload the `.aab` to a release track (Internal testing first, then
   Production).
6. Add the **demo account** credentials under app access (mark that the
   app needs a login).
7. **Send for review.**

---

## Part 10 — Review notes (paste into both review forms)

Written to clear the most likely rejections — keep it strong. Set the
password line before pasting.

```
BAM Portal is the mobile client for By Any Means — an established B2B
service that manages marketing, CRM, and operations for sports
academies. This is not a website: it is the companion app our existing
business clients use to run their account day to day. It includes native
push notifications so academy owners are alerted when a support request
needs their attention.

Access requires an account that By Any Means provisions for each client
(a B2B invite model). The app is login-only — users cannot create
accounts in the app, so there is no in-app account-deletion flow; account
lifecycle is handled by By Any Means. Login is email + password; there is
no third-party or social login.

Demo account for review:
  Email:    zoran+appreview@byanymeansbball.com
  Password: [paste the password you set]

After signing in, the reviewer can browse every tab — Systems, Messages,
Marketing, and Team — and receive push notifications. The app contains no
public user-generated content, no ads, and no tracking.

Contact: zoran@byanymeansbball.com
```

---

## Part 11 — Final pre-submit checklist

- [ ] Part 1 feature list approved
- [ ] Part 2 testing checklist fully passed on a phone
- [ ] `privacy.html` + `support.html` live (pushed to `main`, deployed)
- [ ] Demo reviewer account created, seeded, and login tested
- [ ] Screenshots captured at the required sizes
- [ ] Feature graphic made (Play)
- [ ] `appId` / `server.url` confirmed in `capacitor.config.json`
- [ ] APNs `.p8` key created (needed before push *sending* — not blocking
      this submission)
- [ ] iOS build archived + uploaded
- [ ] Android `.aab` built + uploaded
- [ ] Listing copy + App Privacy + review notes entered in both consoles
- [ ] Submitted to App Store Connect
- [ ] Submitted to Google Play Console

---

*Prepared 2026-05-20. Pairs with `project_app_store_launch` in
`bam-ghl-agent/memories/`.*
