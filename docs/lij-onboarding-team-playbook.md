# San Jose (Lij) onboarding: team playbook

The operating manual for the agent team running San Jose onboarding. The orchestrator (the main chat session) reads this before spawning anyone.

Companion files: [build queue](lij-onboarding-build-queue.md) (what to work on) and [agent-team-rules.md](agent-team-rules.md) (the general rules this team obeys).

---

## THE OPERATING MODEL (Zoran, 2026-07-27). This supersedes the roster below.

**Every chat owns its own full loop.** A chat plans, spawns its OWN builder subagents, spawns its OWN tester subagents, tests with Zoran, and then relays only what matters upward. The orchestrator stops dispatching builders.

| | Owns |
|---|---|
| **A chat** | Its plan · its builders · its testers · testing with Zoran · relaying up |
| **MISTER_ORCHESTRATOR** | The two higher-level goals (get San Jose live, and build the template so the next academies onboard easily) · the queue as shared memory · routing between chats · catching collisions before they cost a build · protecting Zoran's attention |

**What a chat relays up, and nothing more:** decisions Zoran made, anything that changes another chat's work, anything that changes the shared queue, blockers needing a human, and finished work. **Not** progress narration, not internal build detail, not things only that chat needs to know.

**Rules that travel WITH the loop, non-negotiable, because they were each learned the expensive way:**
1. **The tester never built the thing.** A builder verifying itself rubber-stamps itself. Spawn a separate agent.
2. **Never send an undeployed build to Zoran for testing.** Commit, push, open the PR, confirm a preview exists first. Testing uncommitted worktree edits means prod is still running the old code, so every step either passes for the wrong reason or actively causes the bug the build exists to prevent. This cost two rooms a wasted session.
3. **Verify a claim before acting on it**, especially a scary one. One audit produced four false blockers in a day. Rendered or executed output beats static analysis every time.
4. **Trace overrides, do not grep literals.** A literal in a source file is not evidence it reaches output. Ask: does anything override this on the path to output, and does that override fail OPEN or CLOSED?
5. **Say what you did not verify.** A short accurate report beats a long confident one.
6. **If the proof is not in the repo, the fix is not finished.** Two harnesses built on 2026-07-27 proved real data-loss bugs and were both left in a scratchpad, so the fix shipped and the evidence evaporated. A committed test must run on plain `node` with no new dependencies, no network and no database. **Include a negative control** (an env flag that reverts one fix and shows the suite catching it), because a suite that only ever passes tells you nothing about whether it would notice a regression. Same failure shape as rule 2: the work is real, the durability is not.
7. **A test fixture that drifts from production passes for the wrong reason.** Distinct from rule 2: everything is deployed and green, but the test measures a world that no longer exists. Proven 2026-07-27 - a golden-snapshot lock guarding "GTA never changes" used a hardcoded client fixture with no `public_name`, so when that column landed in production the lock rendered the pre-change reality, compared it to goldens of that same dead reality, and reported green. **Worse than no test, because it was trusted and quoted as evidence.** Fix shape: the fixture reads the SAME shared snapshot production reads, plus an assertion that fails loudly if the fixture loses a field production has.

8. **A yes/no answer that crossed a network boundary must have THREE outcomes, not two: yes · no, and here is why · we could not ask.** Never let "no" and "could not ask" collapse into the same value. **This rule already existed and was scoped to one build**, as the testimonials resolver contract ("can a caller tell *this academy has no testimonials* apart from *the resolver could not answer*"), where collapsing them turns a product decision into an outage that presents as a feature. **Nothing carried it to the next place the shape appeared**, so `canCharge()` returns bare `false` for a network blip, an expired key and a genuinely unfinished Stripe account alike, and an owner is told to "finish the remaining steps" by a function that threw away which steps. **A rule written as one build's contract does not travel. Write it here.**

**Why this shape:** it keeps deep context where the work is, and keeps Zoran's attention on one track at a time rather than on N chats each reporting mechanics at him.

## Roster

| Agent | Model | Territory | Spawns when |
|---|---|---|---|
| **Orchestrator** | whatever the chat is on | Talks to Zoran, holds the onboarding thread, triages | always on, never spawned |
| **Scout** | Fable | Read-only. Owns no files | on demand, to sweep before Zoran trips on something |
| **Planner** | Fable | Writes only to `docs/plans/` | a BLOCKER clears triage |
| **Builder** | Opus | Owns the code for one build, in its own worktree | Zoran approves the mockup at gate 1 |
| **Tester** | Opus | Read-only on the build. Writes only the test script | Builder reports done |

Only one build is in flight at a time. Scout may run in parallel with any of it.

Permissions are already pre-approved globally (`defaultMode: bypassPermissions` in `~/.claude/settings.json`), so agents will not stall asking. Do not re-add an allowlist.

---

## Gate 0: the triage gate

Nothing gets planned, built, or even discussed as work until it has a severity. The orchestrator says the severity out loud, in the chat, before proposing anything.

**The three questions, in order. First yes wins.**

1. Would San Jose onboard *incorrectly* without this, or would GTA content leak to SJ leads?
   → **BLOCKER.** Build now.
2. Can SJ onboard, but a human has to do something manual, ugly, or repeated?
   → **FRICTION.** Add to queue. Batch later.
3. Does this only bite at academy #3 or later?
   → **SCALE.** One line in the backlog. Walk away.

**The guardrail applied at the same moment:** sales systems are shared. If the fix reads "San Jose needs X," the answer is never a per-academy branch. Either every academy gets X, or X becomes a runtime fact (domain, owner, program names, prices, age ranges, location). An `if academy == gta` is always the wrong fix.

**If the orchestrator cannot name the severity, it asks Zoran.** It does not guess and it does not skip to building.

---

## Shared context block

Every spawn prompt opens with this. Teammates get ZERO conversation history.

> You are on a small agent team onboarding a new basketball academy, San Jose (owner: "Lij"), onto FullControl / the BAM portal. The repo is bam-os-requirements. The recurring problem: the free-trial sales system preset is full of values hardcoded to the existing BAM GTA academy, so each new academy needs code changes instead of just data.
>
> Hard guardrail: sales systems are SHARED across academies. Never fork one academy's structure. If one client needs X, either every academy gets X or X is a runtime fact stored per academy. A per-academy code branch is always wrong.
>
> Before any preset-shaped work, read `bam-ghl-agent/docs/sales-preset-entity-handoff.md` and `bam-ghl-agent/memories/project_preset_sweep_2026_07_21.md`. There is an existing plan to make presets ONE shared entity. Do not rebuild what it already scopes, and do not build preset-shaped work in a way that contradicts it.
>
> Zoran approves work by looking at diagrams, mockups and plain non-technical writing. He does not read specs. Never use an em dash in anything person-facing.

---

## Planner (Fable)

Append to the shared context block:

> Your job is to produce something Zoran can APPROVE OR REJECT IN UNDER TWO MINUTES, by looking at it. Not a spec document.
>
> The task: [ORCHESTRATOR FILLS IN: the one BLOCKER, with the file:line evidence from Scout]
>
> Deliver exactly three things:
> 1. A one-paragraph plain-English statement of what changes for a person using the product. No file names, no function names.
> 2. A visual: a before/after mockup if it is UI, a flow diagram if it is logic. Self-contained HTML, no external assets.
> 3. The build spec underneath: exact files to touch, exact behaviour, what must NOT change, and how a tester would prove it works.
>
> Write the visual to `docs/plans/`. Say plainly what you are unsure about rather than inventing detail. If the task turns out to be bigger than one build, say so and propose the split instead of planning all of it.

## Builder (Opus, `isolation: worktree`)

Append to the shared context block:

> Build exactly the approved spec below. It has already been approved by Zoran, so do not redesign it. If you believe the spec is wrong, stop and report back rather than improvising.
>
> The approved spec: [ORCHESTRATOR FILLS IN]
>
> Rules: touch only the files the spec names. Do not commit or push. Do not apply Supabase migrations. If your change needs a migration, write it and say so, but leave applying it to a human. When done, report what you changed, what you deliberately did not change, and anything you noticed that belongs in the build queue as a separate item.

## Tester (Opus)

Append to the shared context block:

> You did not build this and you must not fix it. You verify, then you either bounce it back or you hand Zoran a test script.
>
> What was built: [ORCHESTRATOR FILLS IN]
>
> Do two passes:
> 1. **Technical.** Does it work, did it break anything nearby, does it honour the no-forking guardrail, does it handle an academy whose domain and owner are unwired (the known GTA-leak case)? Report failures as specific fixes for the builder, with file:line. Be adversarial. Try to make it fail.
> 2. **Human.** If and only if pass 1 is clean, write Zoran a test script: numbered steps, plain English, click by click, each step saying what he should SEE. No jargon. Five to ten steps. It must cover the case that would embarrass us if it broke.
>
> You cannot judge whether this is right for the business. That is Zoran's call at gate 2. Do not say "approved," say "technically clean, over to you."

---

## ⛔ BUGS BECOME SUBAGENTS, NEVER CHIPS (Zoran, 2026-07-31)

His words: *"instead of doing suggested tasks to open new chats for bugs, can you make it just a subagent that does it automatically - one thing is make sure its being done in this chat and no other sub chats."*

**When a bug or small fix is found in passing, spawn it as a background subagent from the chat that found it. Do not raise a suggested-task chip.**

**Why, and it is not only preference: a chip is a loaded instruction waiting for a human who will not have the context.** Clicking it opens a whole new chat that must be re-briefed from nothing, and an unclicked chip looks passive while being anything but. **This bit on 2026-07-30**, when an agent had to withdraw its own chip after being stood down, because one click would have started exactly the uncoordinated edit a collision check had just prevented.

**What moves with the rule:**
- **The collision check moves EARLIER, to the moment of spawning.** The thing that made chips feel safe was that they deferred the collision question to a human. A subagent does not defer it, so it must be answered first. **Run it by content, never by title.**
- **Spawned agents must not raise chips either**, and their spawn prompts should say so. Several came from agents rather than from a room. **A finding comes back up as a report; whoever holds the thread decides whether it becomes a subagent.**

**Chips remain correct for a genuinely separate WORKSTREAM a human must choose to begin** - a new design track, a new academy, a new phase. **The rule is about bugs and small fixes.**

## Rooms: where Zoran's interactive loops live (decided 2026-07-26)

The orchestrator chat never hosts a long back-and-forth loop. When a build needs Zoran's workshop (gate 1) or his hands-on test (gate 2), the orchestrator spawns a DISPOSABLE ROOM: a pre-briefed chat chip (via spawn_task) named "Design: <build>" or "Test: <build>". Zoran clicks it, works the loop there, the room reports its outcome back to the orchestrator session, and Zoran archives it. Rooms carry full context in their spawn prompt (plan file path, queue item, decisions already locked); the queue file stays the single memory. One build in flight = 1-2 rooms open, ever. Background agents (scout, builder, tester) stay invisible inside the orchestrator session.

## Mission board

Zoran's visual tracker lives at `board/index.html`, fed entirely by `board/data.json`.

**Start it with `scripts/mission-board.sh`, NOT preview_start.** The preview-managed server dies whenever the tooling or session restarts, which stranded Zoran twice. The script runs a detached `nohup` server that survives restarts, and is idempotent (safe to run any time). `scripts/mission-board.sh status` checks it, `stop` kills it. **Orchestrator duty: every time the queue, pipeline stage, agents, or Zoran's to-dos change, update `board/data.json` in the same breath as the queue file.** The board auto-refreshes every 5s.

## Rooms report live to the board

Every spawned room MUST keep its own status file so Zoran sees progress WHILE he is talking to it, instead of waiting for the room to finish. Add this block to every room spawn prompt:

> **Keep the mission board live.** You own one file: `board/rooms/<slug>.json` in the orchestrator worktree (`/Users/zoransavic/bam-os-requirements/.claude/worktrees/agent-teams-access-6ba23e`). Write it when you start, whenever you start waiting on Zoran, whenever you get blocked, and when you finish. Shape: `{"slug":"<slug>","chat":"<exact sidebar chat name>","state":"red|white|blue|orange|done","one":"<one plain line, no em dashes>","blockedBy":"<only when orange>","at":"<ISO UTC>"}`. States: `red` = Zoran must do something on his computer, `white` = you are actively working, `blue` = you need his input in the chat, `orange` = blocked (say by what), `done` = finished. Also add your slug to `board/rooms/index.json` if it is not already there. Do NOT touch `board/data.json`; that belongs to the orchestrator.

The board polls `rooms/index.json` every 5s, overlays each room's state/one-liner onto its chat card, and shows a green `● live · Nm ago` marker so Zoran can tell a self-reported status from an orchestrator-written one. One file per room means two rooms can never clobber each other. The orchestrator prunes stale files when a room is archived.

## HARD RULE: hand DNS and secret values as plain code blocks, never in a table

Cost an hour on 2026-07-26. A DNS value copied out of a markdown TABLE carried an invisible leading tab, which made an SPF record invalid, which failed an Amazon SES check, which dropped the domain into a backoff retry queue. Nothing was ever actually wrong with the setup.

- Give any value a human will copy (DNS records, tokens, ids) as a plain single-line code block. Never inside a table cell, never with surrounding formatting.
- `dig` and confirm propagation BEFORE triggering any verification API. One failed trigger costs the provider's backoff penalty, which is far longer than the check itself.
- Do domain setup during onboarding, about a week before launch, so provider latency never sits on the critical path. A clean first-try domain verifies in 5 to 15 minutes.

## HARD RULE: never send a build to gate 2 undeployed

Learned twice, the expensive way (tz build, then from-address). A test room CANNOT run Zoran's hands-on script against uncommitted worktree edits: production is still running the old code, so every step either passes for the wrong reason or actively causes the bug the build exists to prevent.

**Before spawning a gate-2 test room, the orchestrator MUST:** commit the builder's work, push the branch, open the PR, and confirm a Vercel preview URL exists. Commit the test script too, or it dies with the worktree. Give the room the preview URL. If a preview genuinely cannot exist, say so in the spawn prompt and instruct a paper test explicitly, rather than letting the room discover the problem.

## Gate 2 outcomes

Zoran runs the script and says one of:
- **ship it** → orchestrator commits, pushes, moves the queue row to Done
- **change X** → back to Builder with X as a fresh spec, Tester runs again
- **wrong idea** → back to Planner, and the orchestrator logs why in the queue row so it is not re-proposed
