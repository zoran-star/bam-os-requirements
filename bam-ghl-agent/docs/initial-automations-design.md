# Initial Automations per Entry Point — design draft

**Status:** draft (2026-07-06) · **Owner:** Zoran · **Context:** Sales-Crew flow / router work (PR #1189)

> **The idea (Zoran):** every stage whose engine is an **agent** should fire an
> **initial automation for each entry point** into it - an on-entry scripted
> sequence that runs until the lead replies, at which point the AI agent takes over.

---

## 1. What we already have (copy this pattern)

Two of the three agent stages already have exactly this - a scripted, editable,
approval-gated, mode-gated on-entry sequence. **The pattern is proven; we copy it.**

| Agent stage | Engine | Initial automation file | Steps (shipped GTA copy) | Config store |
|---|---|---|---|---|
| **Scheduled Trial** | Confirm | `api/agent/confirm-automations.js` | `confirm` (immediate) · `same_day` (morning_of) | `clients.ghl_kpi_config.confirm_initial_automations` |
| **Done Trial** | Closing | `api/agent/closing-automations.js` | `post_trial` (immediate) · `nudge` (+2d) · `closeout` (+4d) | `clients.ghl_kpi_config.closing_initial_automations` |

**Shape of each (the template to copy):**

```js
export const DEFAULT_CONFIRM_AUTOMATIONS = {
  enabled: true,
  approved: false,                 // must be approved once per academy before it sends
  steps: [
    { key: "confirm", label: "Booking confirmation", when: "immediate",
      channel: "sms", email: true, email_subject: "...", enabled: true,
      template: "Your free trial is booked! ..." },
    { key: "same_day", label: "Same-day check-in", when: "morning_of", ... },
  ],
};
getConfirmAutomations(client)   // merges ghl_kpi_config override (enabled + per-step copy)
automationsLive(autos)          // enabled && approved && some step enabled
nextDueStep(autos, {nowMs, trialMs, sentKeys})   // the next unsent due step
```

**How it fires:** the agent's detector cron (`agent-confirm.js` / `agent-closing.js`)
scans the stage queue. For a lead with no agent message yet, if `automationsLive`,
it sends `nextDueStep` via the send engine - **mode-gated** (`hawkeye` queues a
one-tap approval, `self_drive` auto-sends) and **approval-gated** (until approved,
it falls back to the old AI opener). The moment the lead replies, the AI agent takes over.

---

## 2. What we DON'T have (the gap)

### Gap A - Responded (Booking) has no scripted initial automation
The Booking agent's "initial automation" today is an **AI-drafted cold opener**
seeded by an `agent_contact_notes` "Entry:" row (`api/agent-approvals.js`
`draftOpener`, reads `note ilike 'Entry:%'`). It's context-aware but it is **not**
a scripted, editable, per-step sequence like confirm/closing. No `booking-automations.js`, no
`ghl_kpi_config.booking_initial_automations`.

### Gap B - no per-ENTRY-POINT model
Confirm & Closing sequences are **stage-level** - one automation, fires on any
entry. That's fine for them because each has exactly **one** entry point:

```
Scheduled Trial  ← booked (from Responded)                    ... 1 entry
Done Trial       ← post_trial_good_fit (from Scheduled Trial) ... 1 entry
```

**Responded is the hub with FIVE entry points**, and each wants a different opener:

```
Responded (Booking)  ← new_lead        (form / ad)        → "new lead" first outreach
                     ← no_show         (from Sched, rebook)→ "sorry we missed you, rebook?"
                     ← cant_make_it     (from Sched, rebook)→ "no problem, new time?"
                     ← replied         (from Nurture)      → "great to hear back" re-engage
                     ← replied         (from Ghosted)      → re-engage
```

So the per-entry need is **specifically a Responded problem**. Confirm/Done are
already 1-entry = already per-entry.

---

## 3. Proposed model

**Principle:** an initial automation is attached to an **entry point** = the
`(destination stage_role, entry trigger)` pair. The `stage_transitions` edge says
the entry EXISTS; the automation config says what FIRES on it.

### 3a. Build `booking-automations.js` (copy `confirm-automations.js`)
Keyed by entry point, because Responded has many:

```js
export const DEFAULT_BOOKING_AUTOMATIONS = {
  enabled: true, approved: false,
  entries: {
    new_lead:  { steps: [ { key: "opener", when: "immediate", channel: "sms",
                            template: "Hey {{contact.first_name}}! Saw you were interested in ..." } ] },
    rebook:    { steps: [ { key: "opener", when: "immediate", channel: "sms",
                            template: "Hey {{contact.first_name}}, sorry we missed you at the trial! Want to grab a new time?" } ] },
    reengaged: { steps: [ { key: "opener", when: "immediate", channel: "sms",
                            template: "Great to hear back {{contact.first_name}}! ..." } ] },
  },
};
```

Entry-point grouping (which triggers map to which opener):
- `new_lead` → **new_lead**
- `no_show`, `cant_make_it` → **rebook**
- `replied` (from nurture or ghosted) → **reengaged**

### 3b. Router stamps the entry point on move-in
When `routeTransition` (or the post-trial form) moves a lead INTO an agent stage,
it records the **entry trigger** so the detector knows which opener to fire.
Reuse the existing mechanism: write a structured `agent_contact_notes` "Entry:"
row carrying the trigger (this already happens for rebook in `confirm-handoff`).
Generalize it to every move into an agent stage.

### 3c. Booking detector fires the matching entry's automation
`agent-approvals.js` opener pass: instead of only AI-drafting from the Entry note,
first check `automationsLive(getBookingAutomations(client))` for that entry point
and fire its `nextDueStep` (scripted, mode+approval gated). Fall back to the AI
opener when the automation is off/unapproved - **backward-compatible**, same as
confirm/closing did.

### 3d. Storage + UI
- Config in `clients.ghl_kpi_config.booking_initial_automations` (mirror confirm/closing).
- Focus mode: the **Engine** section of an agent stage already embeds the Train
  Agent renderers; add the initial-automations editor there, shown **per entry
  point** (each entry chip in the Entry section links to its opener). This is the
  UI payoff of the focus-mode Entry list we already built.

---

## 4. How this resolves `no_show`

Zoran's call: `no_show` → **Responded** (not the current code's Interested),
**with an initial automation**. Under this model:

```
no_show → Responded, entry point = "rebook"
        → fires the BOOKING "rebook" initial automation (the opener above)
        → replaces the standalone missed_trial automation for this path
```

This removes the double-touch risk: today `no_show` fires `missed_trial` (which
lives in Interested → Ghosted → Nurture). Under the model, the rebook opener owns
the outreach and the booking agent works the reply. **Decision needed:** retire
`missed_trial` entirely, or keep it only for academies that prefer the
nurture-path no-show handling.

---

## 5. Build phases

| Phase | What | Risk |
|---|---|---|
| A | `booking-automations.js` (copy confirm) + `getBookingAutomations` + defaults | none (dormant) |
| B | Router stamps entry trigger on every move into an agent stage | low |
| C | Booking detector fires the entry's initial automation (fallback to AI opener) | med (touches live opener) |
| D | Switch `no_show` → Responded + rebook opener; reconcile `missed_trial` | med (behavior change) |
| E | Focus-mode per-entry initial-automations editor | UI only |

---

## Open questions
- **`missed_trial`**: retire, or keep as an academy option for no-show handling?
- **Multi-step openers?** Confirm/Closing are multi-step; Booking openers may only
  need 1 step (the agent takes over on reply). Start with 1, allow more.
- **`replied` bounce**: is the ghosted/nurture → Responded reply bounce portal code
  or a GHL workflow? If GHL, its entry-point automation can't fire until it's rebuilt
  portal-side (tracked separately).
