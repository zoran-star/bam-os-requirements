# Command Center — desktop concept ("The Descent")

Experimental home dashboard concept. **No side nav.** A sticky command deck (core vitals) up top, then you *descend* through full-screen "scenes" of the business, with a live scroll-spy rail on the right that doubles as status + jump-to nav. Built to be **modular** so scenes (including Zoran's marketing sections later) can be composed into one command center.

## Spin it up locally

It's a single self-contained HTML file - two easy ways:

**Option A — just open it**
```
open concepts/command-center/index.html          # macOS
```

**Option B — serve it (better for scroll/observer behavior)**
```
cd concepts/command-center
python3 -m http.server 8080
# then open http://localhost:8080
```

## What's in v1
- **Sticky command deck** - core vitals always visible, condenses as you scroll
- **Right rail** - live "bubbles" = scroll-spy + status (Members bubble shows an alert ring) + click to jump
- **6 scenes** - Overview · Pulse (the calm-but-alive heartbeat, incl. low-activity "on course" state) · Sales · Members · Marketing · Offers
- **Motion** - scenes reveal + numbers count up on scroll; scenes fill the viewport (one focus at a time = not overwhelming)
- **Offers scene** - the payoff; each offer is a living card meant to "zoom" into its own detailed dashboard

## Architecture (why it's built this way)
Each `<section class="scene" data-rail="N">` is a **self-contained block**. The shell (deck + rail + scroll container) is generic. To merge marketing later: add more `.scene` blocks + rail items. That's the "combine into one command center" infrastructure.

## Knobs to experiment with
- Scene count / order / labels (edit the `.scene` blocks + `.rail-item`s)
- Turn on **scroll-snap** for a more "cinematic scenes" feel: add `scroll-snap-type:y mandatory` to `html` and `scroll-snap-align:start` to `.scene`
- Motion intensity (the `.scene` transition, the count-up duration, the 7s "alive" flash interval)
- Rail position (right vs left), bubble style, alert behavior

## Not yet (future)
- Real click-to-zoom into an offer's detailed dashboard
- ⌘K command bar (currently a static chip)
- Wiring to live data (this is static demo data)
- Port to React components in the real app once the direction is locked
