# BUILD: apply-preset CLI does not stamp the offer (drifts from the API version)

You are picking up a small, well-scoped build in the **bam-os-requirements** repo, portal
app at `bam-ghl-agent/bam-portal/`. Supabase project: `jnojmfmpnsfmtqmwhopz` (Supabase MCP).
Surfaced during BAM San Jose's V2 onboarding.

## The problem (already traced - verify, don't re-derive)

There are two ways to apply a pipeline preset to an academy's offer, and they disagree.

| Path | Writes pipeline_stages + stage_transitions | Stamps the offer |
|---|---|---|
| `api/offers/apply-preset.js` (portal button) | yes | **yes** |
| `scripts/apply-preset.mjs` (staff CLI) | yes | **no** |

The API version stamps `offer.data.sales.{preset_key, preset_version, preset_applied_at}`
after applying (see ~line 112-132, the block commented "Stamp the offer so setup-status +
future re-stamps know which preset"). The CLI only calls `applyPreset()` and skips it.

**That stamp is load-bearing.** Readers:
- `api/offers/setup-status.js:196` - `preset: !!sales.preset_key` drives the owner's
  onboarding wizard checkmark
- `api/offers/setup-status.js:224` - reports key/version/applied_at
- `api/admin/activation-status.js:59` - staff-side activation status

So an academy set up via the CLI shows **"preset not applied"** in the owner's wizard and
in staff activation, even though its board is fully seeded. Silent and misleading.

Confirmed live: San Jose's preset was applied via the CLI, wrote 5 stages + 23 edges
correctly, and left `offer.data.sales.preset_key` NULL. It has since been hand-patched,
so San Jose itself is correct - **the code bug remains**.

## What to build

1. **Move the stamping into the shared `applyPreset()`** in `api/agent/presets.js` so the
   CLI and the API physically cannot drift. Then have both callers rely on it rather than
   each doing their own post-step.
   - Preserve the existing merge semantics: merge into `data.sales`, never clobber the rest
     of the offer blob (the owner's wizard answers live there).
   - Keep it non-fatal if the stamp write fails, matching today's API behavior.
2. **Backfill.** Find every offer that has `pipeline_stages` rows but a NULL
   `data.sales.preset_key` and stamp it with the preset its stages actually match.
3. **Fix `scripts/apply-preset.mjs --list`.** It currently crashes:
   ```
   TypeError: Cannot read properties of undefined (reading 'length')
       at scripts/apply-preset.mjs:28
   ```
   Line 28 does `p.transitions.length` - at least one preset in the `PRESETS` registry has
   no `transitions` array. Make `--list` resilient and/or normalize the registry shape.

## Acceptance criteria
- Applying a preset via the CLI and via the portal button produce byte-identical offer state.
- `setup-status` and `activation-status` report the preset correctly after a CLI apply.
- No existing offer has pipeline_stages rows with a NULL preset_key after the backfill.
- `node scripts/apply-preset.mjs --list` runs without throwing.

## Relevant files
- `api/agent/presets.js` - `PRESETS` registry + `applyPreset()` + `buildPresetRows()`
- `api/offers/apply-preset.js` - the API path that stamps today (~line 112-132)
- `scripts/apply-preset.mjs` - the CLI that does not (and whose `--list` crashes)
- `api/offers/setup-status.js` - lines 196 + 224 read the stamp
- `api/admin/activation-status.js` - line 59 reads the stamp
- Tables: `offers` (`data` jsonb, `status`), `pipeline_stages`, `stage_transitions`

## Ground rules
- Start by **verifying the diagnosis yourself** before writing anything.
- Work in a **git worktree** (`scripts/wt <name>`) - multiple sessions run on this repo.
- Follow the portal engineering + safe-build conventions (`/showtime` or `/build-portal`).
- **Never use an em dash** in any output, code comment, or UI copy. Hyphens only.
- The backfill touches production offer data - dry-run it and show the diff before writing.
- Commit and push with a descriptive message when done.

## First step
Verify the trace, then confirm the backfill scope (how many offers are affected) before
implementing.
