# /ghl-pipeline-import - bring an academy's GHL pipeline over to the portal

(aka the GHL migration skill - WS4 of the onboarding wizard spec. Runs as a
co-working session after the owner applies the Free Trial preset; the owner
sees it as the "Your leads" status. Import is NOT done when cards are placed:
it is done when every card is safe to launch on - see step 6.)

Staff-side, Claude-assisted runbook (accepted onboarding design 2026-07-14).
**We import their PEOPLE, not their pipeline shape**: every academy runs the same
Free Trial preset; you (Claude) read each of their open GHL cards and sort it
into the right preset stage. No stage-mapping engine, no custom presets.

Argument: the academy - a client_id, or a name to look up in `clients`.

## Before you start

- Work from `bam-ghl-agent/bam-portal/` (the scripts + env live there).
- Env needed: `VITE_SUPABASE_URL`/`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  (same as scripts/apply-preset.mjs). If missing, ask where the env file is.
- Confirm with the user WHICH academy before any write. Resolve the client_id
  and echo the business name back.
- The academy must already have: GHL connected (`clients.ghl_location_id`) and
  ideally the Free Trial preset applied to its training offer (check
  `offer.data.sales.preset_key` or `pipeline_stages` rows). If the preset is
  missing, apply it first: `node scripts/apply-preset.mjs --client <id> --offer <id> --preset free_trial`
  (or the owner clicks Apply preset in their onboarding flow).

## The runbook (walk it with the user, step by step)

### 1. Dump the board
```bash
node scripts/ghl-import.mjs dump --client <id> --out /tmp/board-<name>.json
```
Read the JSON. It has `pipelines` (with stage names) + `cards` (every open opp:
name, contact, stage_name, pipeline_name, last_stage_change_at).

### 2. Classify every card (you do this)
Sort each card into ONE of the preset roles:
`responded` (being worked / needs booking) · `interested` (went quiet / ghosted)
· `scheduled_trial` (booked, upcoming) · `done_trial` (attended, closing)
· `nurture` (long game / said not now) · `won` / `unqualified` (terminal - only
if their stage clearly says so).

Use the card's stage NAME first (e.g. their "Booked Trial" → scheduled_trial),
then recency (`last_stage_change_at`) for ambiguous ones. Present the user a
compact table: their stage name → your role, with card counts + the odd cases
called out individually. **Workshop it - the user confirms or corrects before
anything is written.**

### 3. Write the mapping + dry-run
Write the confirmed cards to `/tmp/cards-<name>.json` as
`[{ "id": "...", "role": "responded", "name": "...", "contact_id": "...", "phone": "...", "pipeline_id": "...", "last_stage_change_at": "..." }]`
(copy the extra fields straight from the dump - they enrich the store rows), then:
```bash
node scripts/ghl-import.mjs import --client <id> --map /tmp/cards-<name>.json --dry-run
```
Show the by_role counts. User confirms.

### 4. Import + shadow
```bash
node scripts/ghl-import.mjs import --client <id> --map /tmp/cards-<name>.json
node scripts/ghl-import.mjs shadow-on --client <id>
```
Shadow keeps the store synced with GHL moves until the flip.

### 5. Reconcile (the gate)
```bash
node scripts/ghl-import.mjs reconcile --client <id>
```
Show the drift report. `missing`/`mismatched` rows must be explained (usually:
cards the user chose to skip, or terminal stages). Re-import to fix, or accept.

### 6. Engine prep - make every card safe to launch on (the WS4 step)
Before the flip, walk the launch-safety list with the user:
- **Recency landed:** spot-check store rows carry `last_stage_change_at` from
  the dump - the agents' queue uses it so nobody who was texted yesterday gets
  texted again at go-live, and nobody waiting a week gets skipped.
- **Cadence position, not cadence restart:** imported `responded`/`interested`
  cards must read as MID-conversation to the follow-up engine (their recency
  stamp is the position). A card with no timestamp defaults to oldest - call
  those out and set a sensible date with the user.
- **Nothing texts yet:** confirm automations are still `approved:false` and
  Hawkeye is off - the flip moves the board, agent go-live is its own gate.
Fix anything off by re-importing that card with corrected fields.

### 7. Flip
Only after the user says go:
```bash
node scripts/ghl-import.mjs flip --client <id>
```
`pipeline_provider='portal'` - the board reads the store, agents work the
imported leads. Instant rollback if anything looks wrong:
```bash
node scripts/ghl-import.mjs rollback --client <id>
```

### 8. Verify + close out
- Staff portal → the academy → **Activation** tab: "Cards sorted into the
  pipeline" and "Flipped to the portal board" should both be green, with counts.
- The owner's onboarding flow: "Import your active leads" turns gold on its own
  (it reads `pipeline_provider === 'portal'`).
- Note anything odd in `bam-ghl-agent/memories/` if the academy needed special
  handling (new stage-name patterns are worth recording for the next import).

## Hard rules
- NEVER flip without a reconcile the user has seen.
- NEVER classify silently - the user confirms the table in step 2.
- Cards you and the user decide to skip: leave them OUT of the map file; note
  them in the final summary.
- This runbook only touches `opportunities` + provider flags. Contacts sync is
  automatic (cron); members/cancelled have their own owner-facing flows.
