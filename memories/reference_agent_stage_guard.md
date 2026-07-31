# "Is this lead still in that stage?" is a three-outcome question

**Files:** `bam-ghl-agent/bam-portal/api/agent/_stage.js` (`contactStageState`) and `api/agent/_store.js` (`contactRoleState`, `pipelineFlagsState`).
**Shipped:** 2026-07-31. **Test:** `api/_stage-guard-unknown.test.mjs` (plain node, 8 negative controls, runs in Portal CI).

## The rule

Nothing asks "is this contact's open opportunity in this stage?" with a boolean. Both functions return:

```js
{ inStage: true | false | null, trusted: boolean, reason: string }
```

`inStage` is **null** whenever `trusted` is false, deliberately, so a caller that reads only the answer cannot turn an outage back into "this lead moved on". Callers branch on `trusted` FIRST. Same shape as `computeQueue`'s `idsTrusted`, which is the older instance of the idea in the same file.

The old names were `contactInRespondedStage` and `contactInRole`. They returned a bare boolean whose catch was `return false`, and the send path rendered that to staff as a 409 reading "This lead is no longer in the Responded stage". A GHL blip became a stated fact about a real parent. House rule 10, and the last two HARMFUL entries in `scripts/network-boolean-inventory.txt`.

## What staff see

| situation | status | wording |
|---|---|---|
| the lead really moved on | 409 | "This lead is no longer in the ... stage - not sending." |
| we could not check | 503 | "We couldn't check whether this lead is still in the ... stage, so nothing was sent. Try again in a moment." plus `unchecked: true` and a `detail` |

The deck renders the server's `error` string in a red toast, so that sentence IS the product surface. Do not merge the two.

## Gotchas

- **Three hops can fail, not one.** The GHL opportunity search, the portal `opportunities` read, AND the `pipeline_flags` read that decides which of those two to ask. Guessing "ghl" on a `provider='portal'` academy asks the wrong system and reports its stale answer as this one's, which is the same false claim by another route. `pipelineFlagsState` exists for that hop.
- **A 200 is not automatically an answer.** An empty body, a PostgREST error object, or a GHL payload carrying neither `opportunities` nor `data` is unknown, not zero.
- **`pipelineFlags` keeps its old dormant-on-error contract** for its nine other callers. `pipelineFlagsState` is the same read with `trusted` exposed. A FAILED flag read is no longer cached: the old code pinned an academy to the dormant default for the full 30s TTL, which made "try again in a moment" untrue.
- **Non-HTTP callers distinguish too.** `_rebook.js` returns `reason: "stage-unknown"` versus `"not-in-scheduled-trial"`. The two inbound webhooks notify only on `inStage === true` and log the unknown.
- **Not changed:** `portalStageContactIds` in `_stage.js` still falls through to GHL on a flag blip. That is the queue read, not a claim about one lead, and it is covered downstream by `idsTrusted`.
