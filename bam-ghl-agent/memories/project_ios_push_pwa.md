---
name: iOS Push via PWA (deferred)
description: Plan to deliver iPhone push notifications to BAM clients via PWA + web push, no native iOS app needed
type: project
originSessionId: d0f2fb2d-df8b-4076-bc7e-c1bf8254e638
---
Decision: deliver iPhone push notifications to BAM clients via Progressive Web App + Web Push, NOT a native iOS app.

**Why:** avoid App Store review, Swift, and dual-codebase. The portal is already a web app — installable PWA + web push gets us native-feeling pushes for free on iOS 16.4+.

**How it works:**
- Client opens client-portal.html on iPhone → taps Share → Add to Home Screen (installs PWA)
- First open from home-screen icon → prompt "Allow notifications?" → Apple issues a push subscription / device token
- Server stores the token (Supabase)
- On ticket update / chat reply, server hits APNs (Apple Push Notification service) with the token → banner + badge appears

**What needs building when we're ready:**
1. Service worker file (background script that listens for pushes)
2. "Allow notifications" prompt in the portal
3. Supabase table to store device tokens per client
4. API endpoint /api/push/subscribe + /api/push/send
5. APNs key from Apple Developer account ($99/yr) — or use `web-push` npm lib via VAPID keys (no Apple Developer account needed for web push specifically)
6. Manifest.json + HTTPS (already have via Vercel)

**Constraints:**
- iOS user MUST tap "Add to Home Screen" first — no install, no push, ever (Apple's rule)
- Only iOS 16.4+ (March 2023+, near-universal coverage)
- Android works the same way + also supports push without install

**How to apply:** Don't build this yet. When client comms become a priority and SMS/email aren't enough, revisit. Until then, ticket notifications go via Slack (staff) and email (clients).
