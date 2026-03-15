# BAM OS — UX & Interaction Design Prompt
## All Decisions to Date (Pre-Questions 29–38)

This document captures every confirmed UX, interaction, and design decision made in the BAM OS product design session. It is intended to be handed directly to a designer or developer as the source of truth for building the BAM OS interface. Nothing here is speculative — every item has been explicitly confirmed.

---

## 1. PRODUCT IDENTITY

**Product name:** BAM OS
**AI name:** Sage
**Sage voice:** Smooth, feminine, calming, professional female voice. Speaks responses out loud.
**Emotional target for every user on open:** Hype, confident, in control, ready to take action. Not anxious. Not overwhelmed. Like a coach walking into a game they've prepared for.

---

## 2. NAVIGATION ARCHITECTURE

### Top-level navigation (4 tabs — bottom nav bar or equivalent):
1. **Home** — primarily Sage. The intelligence hub.
2. **Marketing** — Meta ads performance, AI ad suggestions, content tools (CNT module).
3. **Sales** — Pipeline kanban, leads inbox, SAL KPIs, trial management.
4. **Management** — Three sub-navs within: Scheduling, Member Management, HR.

### Management sub-navigation:
- **Scheduling** — CLS module: class calendar, session creation, recurring series, session roster, attendance marking.
- **Member Management** — MEM module: member directory, 360° drawer, messaging, player reports, health scores, at-risk queue, cancellation, pause, billing, waivers.
- **HR** — STF module: coach profiles, invitations, schedule, staff roster, deactivation. (Extended scope TBD in questions 29–38.)

### Inbox split:
- **Leads inbox** lives in the Sales tab — GHL pipeline conversations, lead messages.
- **Member inbox** lives in Member Management — coach-to-member messaging (MEM-002).
- "See all messages" available from within each inbox as a unified view.

### No standalone Dashboard tab — KPI dashboard (STR module) lives within the relevant sections or is accessed from home via Sage.

---

## 3. HOME SCREEN

### Purpose:
The home screen is primarily a Sage interface. It is the command center, not a feature menu. Coaches open it to get oriented, talk to Sage, and get moving. It should feel like opening a conversation with the most knowledgeable person in the room — not opening a software product.

### Loading screen (shown every time the app opens):
- **Background:** Calming motion graphic — subtle, smooth, premium. Not a spinner. An intentional moment of visual calm before the dashboard appears.
- **Welcome message:** Dynamic, time-of-day aware, pulls live data for the second line.

**Time-of-day messages (confirmed):**

| Time | Message line 1 | Message line 2 (dynamic, live data) |
|---|---|---|
| 5–8am | "The work starts before anyone else wakes up. Let's build something." | Best metric from the last 24 hours |
| 8–11am | "Your academy is moving. Here's where things stand." | Current MRR or today's lead count |
| 11am–2pm | "Momentum is everything. Here's what's happening right now." | Best-performing metric right now |
| 2–5pm | "The day isn't done. Here's what still needs you." | Open action count or at-risk flag |
| 5–8pm | "Most people have stopped. You haven't. Here's the day." | Day's best outcome |
| 8pm+ | "The best operators review before they rest. Here's yours." | Day summary — top metric |

### Home screen elements (confirmed, in order from top to bottom):

**1. Best thing that happened — green highlight**
The single best metric or event since the coach last opened the app, displayed in green. Sage decides what this is dynamically — whichever metric is most objectively positive at this moment. Could be: new member signed up, MRR crossed a threshold, trial converted, attendance rate up, lead came in.

When nothing is objectively positive: Sage finds the least-bad thing and frames it constructively. Never leads with a red number. Example: "Attendance is down slightly this week — but you haven't lost a single member this month." The tone is always: honest, calm, coaching. Not falsely cheerful. Not alarming.

**2. Sage input bar — persistent, inviting**
Always visible. Small but prominent — not a buried footer element. Text placeholder rotates:
- "What's on your mind about the business?"
- "Ask Sage anything."
- "Pose a problem. Get a perspective."

Microphone icon on the right side of the bar. Equal visual weight to the text input — voice and text are first-class equals.

Tapping the bar OR the mic icon expands to full-screen Sage conversation mode.

**3. Get started task — Sage-picked, one at a time**
Sage surfaces exactly one task on the home screen. Not a list. One card. The task Sage calculates will build the most momentum right now given the current business state.

When the coach completes the task:
- A satisfying graphic moment plays (see Section 6 — Micro-interactions)
- The action counter increments
- Sage immediately surfaces the next task — no delay, no menu

The coach can always navigate away and do something else. The single task is an invitation, not a mandate.

**4. Action counter — appears after first action**
Tracks how many meaningful actions the coach has taken today. Appears only after the first action is completed — not present at zero. Resets at midnight.

Actions that count: sending a message, marking attendance, moving a pipeline lead, completing a Sage task, publishing a player report, issuing a refund, enrolling a member, creating a class, any deliberate coach-initiated action in the system.

Visual design: a number that grows. Not a progress bar toward a goal. Not a streak indicator. Just a clean, escalating count that says "you've done 7 things today." The emotional target is sleek psychological momentum — more like a pro athlete's stat line than a Duolingo streak.

Counter label and visual weight: subtle and growing. At 1–3: small, understated. At 4–7: slightly more prominent. At 8+: bold, confident. Not celebratory — earned. The counter does not do anything special at a threshold — it just gets more prominent as the number grows. The momentum speaks for itself.

---

## 4. SAGE — FULL SPECIFICATION

### Character and tone:
Sage is a mythical trusted advisor. A calm, knowledgeable guide who knows your business deeply and speaks to you like a friend who has seen everything. Not a chatbot. Not a search engine. Not an assistant. An advisor with a perspective and a point of view.

Sage's voice adapts to urgency — more direct when something needs immediate attention, more reflective when the coach is thinking strategically — but ALWAYS leans calm and confidence-inducing. Never alarms. Never overwhelms. The coach should feel steadier after talking to Sage than before.

Sage's spoken voice: smooth, feminine, calming, professional. Mid-paced. Never rushed. Clear enunciation. The voice of someone who has seen it all and knows what to do.

### Input methods (equal first-class):
- **Text:** tap the input bar, type freely
- **Voice:** tap the mic button, speak freely — no structured format, no prompts. Sage handles unstructured input.

Both inputs are captured, transcribed if voice, and sent to Sage with the current academy context snapshot (QST-002) automatically attached. The coach never has to explain their business context — Sage already knows it.

### Persistent memory:
Sage remembers everything across sessions. This is non-negotiable for the advisor relationship. If a coach tells Sage "I'm thinking about moving Marcus up to Elite next month," Sage will reference that the next time Marcus comes up. Sage's memory includes: all past conversations (QST-003), all academy context snapshots, all member events, all actions taken. Sage is a long-term relationship, not a stateless query tool.

### How Sage speaks back:
- Voice responses play automatically when the coach used voice to ask. When the coach typed, voice does not auto-play — a speaker icon is available to hear the response.
- Text response always displays regardless of input method.
- Response format: prose, not bullet points. 150–250 words for strategic responses. Shorter for simple factual queries ("You have 47 active members" — no prose needed).
- Structure of strategic responses: (1) Acknowledgment showing Sage understood. (2) Context from the academy's own data. (3) Pattern from the knowledge base with clear confidence framing. (4) Sage's perspective — a point of view, not a menu of options. (5) One recommended next step as a tappable action card.

### "How's my business doing?" — the daily pulse query:
When a coach asks this (voice or text), Sage responds with an urgency-aware visual snapshot of the KPIs most relevant to the current moment — not a static dashboard, but a Sage-curated read of right now. The response includes: a spoken summary (if voice was used), and a visual breakdown of the 3–5 metrics that matter most at this moment, each color-coded (green = good, yellow = watch, red = needs attention). Sage frames each metric with a one-line interpretation, not just the number.

### Sage proactive insight (weekly):
Every Monday morning, Sage generates one unprompted strategic observation based on 4 weeks of data patterns. Delivered as a card on the home screen with "Talk to Sage about this" CTA. The coach can dismiss it. The insight is always specific (naming a class, a metric, a member segment), pattern-based (not a one-week anomaly), and actionable. Generic observations are not surfaced.

### When to be proactive vs. reactive:
Sage surfaces items on the home screen as feed cards — but they are framed as a dashboard of momentum opportunities, not alerts. The tone is: "here's what could move today" not "here are your problems." Each card has a positive action framing. At-risk members are not "3 members about to churn" — they are "3 members who need a personal touch."

---

## 5. SALES TAB

### What lives here:
- **Pipeline kanban** — the primary view when landing on Sales
- **Leads inbox** — GHL-connected, all lead conversations
- **SAL KPIs** — new leads today, best-performing SAL metric (dynamic, Sage-picked), trial conversion rate, pipeline velocity
- **Trial management** — trial check-ins, no-show recovery, post-trial follow-up status

### Pipeline kanban specifics:
- Drag-and-drop between stages
- Stages: New Lead → Contacted → Trial Booked → Trial Done → Member (fixed for beta, customizable later)
- On card move: satisfying snap animation, subtle sound plays, column count flashes/updates
- The drag-and-drop IS the 10-second dopamine hit — visually moving a lead to "Member" is the most satisfying moment in the product
- Card content: lead name, source, days in stage, last contact date, assigned coach
- Column headers show live count — flashes briefly when count changes

### 10-second dopamine experience on Sales tab:
Coach opens Sales, sees: new leads that came in (highlighted at top of New Lead column), the best-performing KPI shown prominently (whichever SAL metric is trending most positively right now — dynamic, Sage decides), and one clear thing to do (move a lead, send a follow-up, confirm a trial). They do it in 10 seconds and feel the pipeline moving.

---

## 6. MICRO-INTERACTIONS AND FEEL

### Task completion graphic (between Sage tasks):
**Feeling target:** Sleek psychological momentum. Smooth and premium, not explosive or Duolingo-like. The moment should feel earned and satisfying — like a heavyweight door closing perfectly. Not a confetti burst. More like: a card elegantly resolves, a number increments with weight, a brief pulse of color, and then it's done. The breath between tasks is the point — one moment of visual satisfaction, then the next thing arrives.

### Pipeline card move:
- Snap: card settles into new column position with a precise, physical feel
- Sound: subtle — a soft, low-frequency click or whoosh. Premium, not arcade-y
- Column count: briefly flashes (scale up, scale back) as the number updates

### Action counter increment:
- Number transitions smoothly (not a hard jump)
- Brief weight to the transition — not instant
- The counter feels like it's counting something real, not ticking artificially

### Loading screen motion graphic:
- Calming, smooth, slow-moving background
- Could be: gentle particle movement, slow gradient shift, abstract fluid motion
- Not a logo animation — the motion IS the screen, the logo lives on top of it
- Duration: 1.5–2.5 seconds. Long enough to feel intentional, short enough not to feel like loading

### General UI feel:
- Dark backgrounds (per BAM design system: #080808–#1c1c1c)
- Gold accents (#C9B97A / #E2DD9F)
- Bebas Neue for headers and numbers
- DM Mono for data, codes, counters
- DM Sans for body and labels
- Animations: CSS transitions, purposeful, never decorative
- Sound: optional but on by default, mutable in settings. Always subtle — the product should work perfectly with sound off

---

## 7. NOTIFICATIONS

### Model:
Push notifications for time-sensitive events, toggleable to mute per notification type (per APP-023b in the spec).

### Notification types and urgency:
- New lead came in — medium urgency
- Trial booked — medium urgency
- Payment failed — high urgency (but Sage frames it calmly)
- Member cancelled — medium urgency
- New message from member — medium urgency
- At-risk member flag — low urgency (daily digest, not per-event)
- Sage proactive insight — low urgency (Monday only)

### What happens when a push notification is tapped:
Deep-link to the specific screen related to the notification. A "new lead" notification opens that lead in the Sales pipeline. A "payment failed" notification opens that member's billing screen. The home screen is NOT the default landing — notifications are routing shortcuts, not home-screen triggers.

---

## 8. MULTI-LOCATION

Owner can toggle between locations easily — a location selector accessible from the top of any screen. Also includes a combined "All Locations" view that aggregates data across all locations. The Sage context snapshot (QST-002) is location-aware — when viewing a specific location, Sage knows which location is active. When in combined view, Sage speaks about the business as a whole. Specific multi-location data model and permissions as per the spec (SET-002, MEM-034, PRF-004b).

---

## 9. ROLE-BASED HOME SCREEN

The home screen is role-aware based on the permissions model in the spec (MEM-014b). An owner sees: business health, financial pulse, pipeline, Sage strategic counsel. A junior coach sees: today's sessions, their assigned members, messages. Same emotional target for both — hype, confident, ready to act — but the specific content Sage surfaces is scoped to their role and permissions. A junior coach opening BAM OS before a session should feel like they know exactly who they have and what they need to do.

---

## 10. DECISIONS — QUESTIONS 29–38

### 29. Home screen — minimal
Home screen is deliberately minimal. Elements confirmed:
- Green highlight (best metric/event)
- Sage input bar (persistent, inviting)
- One Sage-picked get-started task card
- Action counter (appears after first action)
- **Action counter has a benchmark: shows average actions taken on previous days so the coach has something to beat.** Format: "7 actions today · avg 5" — the comparison creates natural competition with yourself without being gamified.
- Nothing else permanently anchored on home. Everything else is in the tabs. Home is Sage + momentum, not a widget farm.

### 30. Sage voice — ChatGPT model
Sage's voice works exactly like ChatGPT voice mode:
- A speaker/audio icon is always present alongside Sage responses
- Tapping it plays the response in Sage's voice
- A persistent toggle to turn voice fully on or off (so voice plays automatically on all responses when on)
- When voice mode is ON: Sage speaks every response automatically. When OFF: text only, speaker icon still available per-response
- Setting persists across sessions

### 31. Sales tab — confirmed layout (top to bottom)
1. **MTD stats strip** — 3 numbers shown prominently:
   - Trials MTD
   - Sales closed MTD
   - Close rate % MTD
2. **Sage quick tip** — one sentence directly below the stats, informed by current sales KPIs. Sage-authored, updates when data changes. Calm, actionable tone. Example: "Your close rate is 8 points above last month — your trial experience is working. Keep the personal follow-up tight."
3. **"See full dashboard" link** — tapping opens deeper SAL KPI view with all metrics
4. **Pipeline kanban** — drag-and-drop, full width, scrollable horizontally if needed
5. **Persistent inbox bubble** — anchored at bottom of Sales tab. Shows unread lead message count. Tapping opens leads inbox. Always visible regardless of scroll position.

### 32. Management sub-navs — 3 big blocks
When the coach taps Management, they see **3 large, visually prominent blocks** — not a tab bar, not a sidebar. Three full-width (or large card) blocks:
- **MEMBERS** — routes to Member Management (MEM module)
- **STAFF** — routes to HR / coach management (STF module)  
- **FACILITY** — routes to Scheduling (CLS module: calendar, classes, sessions)

Visual design: big, bold, cool-looking. Each block has an icon, the label in Bebas Neue, and a one-line status hint (e.g., "47 active · 3 at risk" under MEMBERS, "4 coaches · 2 sessions today" under STAFF, "3 classes today · 82% fill" under FACILITY). Tapping a block navigates into that section. Back navigation returns to the 3-block Management landing.

### 33. Sage identity — known from onboarding, no avatar
- Sage is introduced by name during onboarding — not announced on every open
- No dedicated avatar or character image — Sage is voice + text, the identity is the voice and the name
- Small "Sage" label appears near the input bar and on responses as attribution
- Animated waveform plays when Sage is speaking (audio visualization only — not a face or character)
- The name surfaces naturally in copy throughout: "Ask Sage," "Sage suggests," "Sage noticed something"

### 34. Marketing tab — confirmed layout (top to bottom)
1. **MTD KPI strip** — 3 chosen marketing KPIs shown prominently (specific KPIs TBD when rules are defined, but format matches Sales tab: 3 numbers, clean, scannable)
2. **Sage actionable quote** — one sentence below the KPI strip, same format as Sales tab. Informed by current marketing performance. Example: "Your Saturday ad is outperforming everything else by 3x — worth putting more budget there this week."
3. **"See full dashboard" link** — deeper MKT KPI view
4. **Ads that need refreshing** — cards for ads that Sage has flagged as stale or underperforming, with one-tap refresh suggestion action
5. **Best-performing ads** — current top performers shown as cards with key metrics inline
- More marketing features to be added later. KPI selection rules deferred.

### 35. Sage framing bad news — mental reframe
When the data is bad, Sage's approach:
- **Mentally reframes the problem** into its simplest, most actionable form
- **Understanding tone** — acknowledges the difficulty without dwelling on it
- **One clear thing to focus on** — reduces overwhelm by isolating the lever that matters most
- Never ignores the problem, never sugarcoats it, never spirals into it
- Example: instead of "Your churn rate is at 12% which is significantly above the healthy threshold of 5% and you've lost 6 members this month" → Sage says "You've lost 6 members this month — that's worth taking seriously. The pattern I'm seeing is that they're all leaving in months 2–3. That's not a product problem, it's an activation problem. One thing: make sure every new member attends a class in their first week."
- The reframe is always: name the real problem simply → give it a cause → one move

### 36. Push notifications — home screen with card + deep link
When a push notification is tapped:
- Opens to the **home screen** (not directly to the feature)
- A **contextual card appears** on the home screen with the important information from the notification (e.g., "Marcus just cancelled his membership — reason: not enough time")
- The card has a **deep-link CTA** — tapping it routes to the specific screen (Marcus's member profile, the failed payment, the new lead, etc.)
- This keeps Sage as the central layer — the coach can ask Sage about it right there before taking action, or tap the card to go directly
- The home screen card dismisses after the coach taps the deep-link or manually dismisses it

### 37. Action counter — "Actions today" vs. yesterday
- Label: **"Actions today"** — clear, no ambiguity
- Comparison shown: **vs. yesterday's count**. Format: "7 actions today · 5 yesterday"
- Visual escalation: subtle at low counts, grows more prominent as count increases
- **Special moment at 10+ actions AND above yesterday AND above personal average:** a full-screen (or prominent on-screen) graphic plays. Sleek, satisfying, premium — not confetti. More like a brief visual acknowledgment that something real was accomplished. Then it's gone. One moment, not a loop.

**Sage daily action digest (new — confirmed):**
At the end of each day (or when the coach opens the app the next morning), a notification summarizes **everything Sage did that day autonomously** — AI responses sent, sequences triggered, lead nurtures fired, dunning steps executed, health scores recalculated, insights generated. This is distinct from the coach's action counter. It shows the coach how much is happening behind the scenes without them. Format: "While you were focused on coaching, Sage handled 34 things today." With a tappable list of what those things were. Purpose: builds trust in the system and demonstrates ROI of BAM OS.

### 38. HR sub-nav (Management → Staff) — coach profiles, simple
For beta: **coach profiles only**, simple interface.
- Landing view: all coaches shown as cards — photo, name, role, location(s), one status line ("4 sessions this week · last active 2h ago")
- Tapping a coach card opens their full profile: all STF-002 fields (name, photo, bio, specialties, experience, certifications, contact), their assigned schedule (STF-004), their session history, and their performance stats from MEM-029 (members on roster, retention rate, report count)
- Actions available from coach profile: send message, edit profile, view schedule
- No BAM Coaches certification integration yet — that's a future vertical connection
- The interface is clean and simple — not a full HR platform, just the information a head coach or owner needs about their staff at a glance

---

## 14. DECISIONS — QUESTIONS 39–48

### 39. Sage input — persistent floating button on all tabs
A persistent floating mic/text button lives on every screen in BAM OS. Tapping it from any tab opens the full-screen Sage conversation view regardless of where the coach is. Sage always has access to the current screen context — if the coach is on the Sales tab and taps the floating button, Sage knows they're looking at sales data and uses that as context. The floating button is small but unmissable — a mic icon with a subtle gold ring or glow. It does not interfere with the tab content.

### 40. Facility sub-nav — class calendar and session management only (beta)
For beta: Facility = CLS module only. Class calendar (CLS-006), session creation (CLS-002), recurring series (CLS-003), session roster and attendance (CLS-005). No physical facility management (room assignments, equipment) in beta. That scope can expand later.

### 41. Sage quick tip — session-generated (refreshes on tab open)
The Sage quick tip on Sales and Marketing tabs is generated when the coach opens the tab, not updated in real time. If data changes while they're on the tab, the tip stays static until they navigate away and return. This keeps API cost predictable and the tip feels considered rather than flickering.

### 42. Facility status hint on Management landing block
"X sessions this week" — total session count for the current week. Simple, operational, answers the most common question at a glance. Could also include today's count if different: "3 today · 12 this week."

### 43. Home screen notification card — Sage speaks proactively
When a push notification is tapped and routes to the home screen with a contextual card, Sage proactively surfaces a response about the event. The coach does not have to ask — Sage already has a take. Example: "Marcus just cancelled. He was one of your most consistent members until about 3 weeks ago when his attendance dropped off. This looks like a life circumstance change, not dissatisfaction. A personal message (not a template) in the next 24 hours is your best move." The card has the deep-link CTA below Sage's response. Coach can engage with Sage further or tap the card to go take action.

### 44. Sage speaking indicator — small persistent element
When Sage is speaking out loud, a small animated waveform indicator appears near the floating mic button (or in the nav bar area) — visible from any screen. It shows Sage is currently talking even if the coach navigated away or locked their screen. Tapping the indicator brings the coach back to the full-screen Sage conversation view where they can see the text and stop playback.

### 45. Member Management default view — activity feed
When a coach taps the Members block and enters Member Management, they land on the activity feed (MEM-013) — the real-time chronological log of member events. This is the right default because it answers "what just happened with my members?" immediately. From the activity feed, all other Member Management sections are accessible via a sub-navigation (search/filter bar at top, section shortcuts below the feed header).

### 46. Action counter — home only, brief pop-up on other tabs
The action counter lives on the home screen. On other tabs, when an action is completed, the counter briefly pops up (a small toast or floating badge — 1.5–2 seconds) showing the updated count, then disappears. The coach gets the feedback that their action was counted without the counter permanently cluttering other tabs. When they return to Home, the full counter is there.

### 47. Sage daily digest — user-chosen send time set at onboarding
During onboarding, the coach sets their preferred end-of-day notification time. Sage sends the daily action digest at that time — one notification, one summary of everything Sage handled that day. The time is editable in settings after onboarding. Default suggested time during onboarding: 8:00 PM. The digest is a single notification (not a series) with a tappable log inside BAM OS showing the full list.

### 48. Mobile-first, desktop adaptive
BAM OS is designed mobile-first. The primary experience is a coach on their phone. Desktop gets the same content with an adapted layout: bottom nav becomes a left sidebar (same 4 destinations: Home, Marketing, Sales, Management) or a top nav bar — decision TBD based on what feels most natural at design time. The sidebar/top nav has the same options, same hierarchy. No desktop-exclusive features — just more screen real estate used for information density (e.g., the Sales tab might show the pipeline kanban and the MTD stats side by side on desktop vs. stacked on mobile).

## 15. DECISIONS — QUESTIONS 49–54

### 49. Floating Sage button — bottom right, dual trigger
The floating Sage entry point lives in the **bottom right corner**, above the nav bar. It has two parts:
- A **microphone/compass icon** (described as a microscope icon — a symbol of examination and insight, reinforcing the Sage-as-advisor character). Tapping the icon opens full-screen Sage conversation.
- A **small live text bar** next to or below the icon — an inviting, animated prompt that subtly cycles or pulses to draw the coach in. Example rotating prompts: "What's on your mind?", "Ask Sage anything.", "Something to discuss?" The text bar is tappable and opens Sage in text-input mode directly.

Both the icon and the text bar are persistent on every screen. The text bar keeps the entry point feeling warm and conversational rather than mechanical. It should feel like someone is already there, waiting.

### 50. Full-screen Sage — chat interface, dual voice mode
Full-screen Sage is a **standard chat interface**: conversation history scrolling upward, input bar at the bottom. Clean, familiar, no friction.

**Voice interaction — two modes from the same mic button:**
- **Tap mic button:** sends a voice note (records, sends, Sage responds to the audio). Quick, hands-free, one message.
- **Hold mic button:** enters continuous voice mode — like a phone call with Sage. Ongoing back-and-forth without releasing the button between messages. The most immersive Sage experience.

**Exiting Sage:**
- Tap the **BAM OS logo** to return to wherever they came from (back to the tab they were on)
- Swipe down also dismisses
- No dedicated X/close button — the logo IS the exit, reinforcing brand presence at the most intimate moment in the product

**Visual during voice:**
- Animated waveform displays when Sage is speaking
- Mic button pulses when recording
- Transcript of both sides shown in the chat history so the coach can scroll back and read what was said

### 51. Member Management internal navigation — hamburger menu
Within Member Management (after landing on the activity feed), a **hamburger menu** in the top corner reveals all sections:
- Activity Feed (default — current)
- Member Directory
- Messaging
- At-Risk Queue
- Player Reports
- Pause Management
- Billing & Payments
- Health Scores

The hamburger keeps the activity feed view clean and uncluttered. The coach who needs to navigate deeper taps it intentionally. The sections that Sage most commonly routes to (at-risk queue, a specific member's profile) are reachable via the deep-link from Sage's recommended action card — so the hamburger is mostly for intentional direct navigation, not the primary access path.

### 52. Light mode default, dark mode available
**Light mode is the default.** BAM OS ships with a light theme as the primary experience — better for outdoor readability on mobile (coaches on the gym floor, outdoors at camps). Dark mode is available as a toggle in settings and may become the preference for coaches who use BAM OS primarily at night or on desktop.

**Design system implication:** the color palette needs both themes. The gold accents (#C9B97A), zone colors (green/yellow/red), and typography all carry across both. The dark theme uses the existing dark palette (#080808 backgrounds). The light theme inverts: light backgrounds (#F8F7F4 or similar warm off-white, not pure white), dark text, same gold accents. The premium feel must hold in both modes.

### 53. Pipeline kanban mobile — 1.5 columns visible, dopamine scroll
On mobile, the pipeline kanban shows **1.5 columns** at a time — the current column fully visible, the next column peeking at ~50% to signal that there's more to scroll across. This creates the horizontal scroll affordance without hiding the board entirely.

**Drag-and-drop mechanics on mobile:**
- Long-press a card to lift it (slight scale-up + shadow = card is "held")
- Drag horizontally to the target column — columns highlight as the card passes over them
- Drop: satisfying snap into position, column count flashes, subtle sound plays
- The 1.5-column view means dragging from column 1 to column 2 is a short, satisfying motion — not a frustrating scroll-while-dragging experience
- For moves that skip columns (e.g., New Lead → Member): the board auto-scrolls as the coach drags toward the right edge

**The dopamine is preserved.** The physical feel of dragging a lead to "Member" and hearing the snap is the primary reward mechanism on the Sales tab.

### 54. Home notification card — stays until manually dismissed, Sage consolidates multiples
The home screen notification card (triggered by push notification tap) stays until the coach manually dismisses it — swipe away or tap an X on the card.

**Multiple notifications stacking:**
If multiple notifications come in while the coach was away, Sage **consolidates** them into a single card rather than stacking. Example: "3 things happened while you were away — a new lead came in, Marcus cancelled, and a payment failed. Here's what needs you first." Below the Sage summary: individual action cards for each item, prioritized by urgency. The coach works through them one at a time or dismisses all.

This consolidation is important: a coach opening the app to find 4 stacked cards feels like they're behind. One Sage-curated card that says "3 things, here's the priority" feels like they're in control.

---

## 16. LIGHT MODE DESIGN TOKENS (additions to Section 12)

```
Light mode (default):
  Background primary:    #F8F7F4  (warm off-white — not pure white)
  Background secondary:  #F0EEE9
  Card background:       #FFFFFF
  Card hover:            #F5F3EF
  Border:                #E5E2DC
  Border accent:         #D4D0C8
  Text primary:          #1A1A1A
  Text secondary:        #666666
  Text dim:              #999999
  Gold (primary accent): #C9B97A  (same across both modes)
  Gold (dark variant):   #A8965A  (for light mode where gold needs more contrast)
  Green:                 #2E7D32  (deeper in light mode for readability)
  Red:                   #C62828
  Yellow:                #F57F17
  Blue:                  #1565C0

Dark mode (toggle):
  (existing palette from Section 12 — unchanged)
```

---

## 11. THINGS EXPLICITLY NOT DECIDED YET

- Whether desktop uses left sidebar or top nav (decided at design time)
- Specific 3 KPIs shown in Marketing and Sales tab strips (rules deferred)
- Full hamburger menu section order within Member Management (priority TBD)
- BAM Coaches certification integration into HR (future vertical)
- Onboarding UX flow in detail (deferred — includes daily digest time-picker, Sage intro, theme default selection)
- Whether a 5th nav tab is needed beyond Home / Marketing / Sales / Management
- Light mode background exact value (#F8F7F4 suggested — confirm with designer)
- Final icon for floating Sage button (microscope/compass direction — TBD with designer)

---

## 12. DESIGN SYSTEM (confirmed, matches all BAM projects)

```
Fonts:
  Headers / KPI values / counters: Bebas Neue
  Numbers / codes / tags: DM Mono or DM Mono 500
  Body / labels / descriptions: DM Sans 300–600

Colors:
  Background primary:    #080808
  Background secondary:  #111111
  Card background:       #1a1a1a
  Card hover:            #222222
  Border:                #2a2a2a
  Border accent:         #333333
  Gold (primary accent): #C9B97A
  Gold (light):          #E2DD9F
  Gold (dim/fill):       rgba(201, 185, 122, 0.15)
  Text primary:          #f0f0f0
  Text secondary:        #888888
  Text dim:              #555555
  Green (positive):      #4caf50
  Red (attention):       #f44336
  Yellow (watch):        #f5c842
  Blue (info):           #45b7d1
  Purple (profiles):     #b388ff

Zone colors (health score, fill rate, risk):
  Green zone:  #4caf50  (healthy / good)
  Yellow zone: #f5c842  (watch / moderate)
  Red zone:    #f44336  (critical / needs action)

Motion:
  All animations: CSS transitions, purposeful only
  No decorative animation
  Loading screen: calming background motion, 1.5–2.5s
  Task completion: smooth, weighted, premium
  Pipeline card: physical snap + sound + column flash
  Sound: optional, on by default, always subtle
```

---

## 13. TECHNICAL ARCHITECTURE DECISIONS AFFECTING UX

- **Platform:** PWA (Progressive Web App). Not native iOS/Android. Same codebase for desktop and mobile. Works on coach's phone at gym.
- **Scheduling app:** External (Mindbody or similar). BAM OS is the dashboard + backend. Member-facing scheduling UI is the scheduling vendor's product.
- **Sage backend:** Anthropic API (Claude). Context snapshot attached to every query. Response time target: under 2 seconds for factual queries, under 4 seconds for strategic responses.
- **Sage voice:** ElevenLabs recommended for the specific feminine voice character. Web Speech Synthesis as fallback. Voice toggle works like ChatGPT — on/off persists across sessions, per-response speaker icon always available.
- **Real-time data:** Supabase real-time subscriptions for activity feed, pipeline counts, action counter, notification badges.
- **Deep linking:** All push notifications route to home screen first (with contextual card), then offer deep-link CTA to the specific feature screen.
- **Sage daily action digest:** End-of-day notification (or next-morning open) summarizing all autonomous Sage actions taken that day. Stored in Database as a daily digest record. Displayed as a notification + tappable log. Separate from the coach's own action counter.
- **Action counter special graphic:** Triggered when: actions today ≥ 10 AND actions today > yesterday's count AND actions today > rolling average. One-time trigger per day. Logged to prevent repeat triggering in the same session.
