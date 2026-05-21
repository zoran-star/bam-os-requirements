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
| **Members** | Athlete roster — view athletes, plans, status | Live, **read-only**, BAM GTA only |
| **Team** | Invite teammates into the portal, revoke access | Live |
| Push notifications | Native push prompt on login; tokens captured | Live (sending side is later) |
| First-login tour | 8-step guided tour for new users | Live |

**Notes for the approval decision:**
- **Members** is read-only until Phase 3 (billing actions). It only shows
  for BAM GTA today. Decide: ship it visible, or hide it for v1.
- Push **capture** works; staff **sending** notifications is a later build.
  The app can still ship — it just won't send anything yet.

**[Zoran] Sign off on the feature list above before moving on.**

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

The portal is behind a login, so Apple and Google **require working
credentials** or they reject the app instantly. Create a dedicated account
(not a real academy's) and seed it so reviewers see a populated portal.

**Account to create:**
- Email: `appreview@byanymeansbusiness.com`  *(or any inbox you control)*
- Password: a fixed strong password — you'll paste it into the review form

**Steps (Supabase project `jnojmfmpnsfmtqmwhopz`):**
1. **Auth → Users → Add user** — create the email + password above;
   mark the email confirmed.
2. **SQL Editor** — insert a demo `clients` row (e.g. business_name
   `Demo Academy`, status `active`).
3. Insert a `client_users` row linking that auth user to the demo client
   with `role = 'owner'`, `status = 'active'`.
4. Seed a little sample data so tabs aren't empty: ~3 `members` rows, one
   `tickets` row with a short message thread.

> Want this exact? Say the word and I'll generate the precise SQL from the
> current schema — I just need to confirm the demo client's name.

Test the login yourself before submitting.

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

```
BAM Portal is a business tool for sports academy owners and staff who
work with By Any Means. Access requires an account we provide.

Demo account for review:
  Email:    appreview@byanymeansbusiness.com
  Password: [paste the password you set]

After signing in, the reviewer can browse all tabs: Systems, Messages,
Marketing, Members, and Team. The app is a secure client portal — it does
not contain user-generated public content, ads, or tracking.

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
