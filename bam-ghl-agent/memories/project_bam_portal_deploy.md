---
name: bam-portal deploy (how to actually ship)
description: How to deploy the bam-portal Vercel project. Git auto-deploy on push to main WORKS as of 2026-06-11. `vercel redeploy` still does NOT pick up new code — if a manual deploy is ever needed, use a clean `vercel deploy --prod` from the repo root with the project env vars.
type: project
---

## TL;DR (re-verified 2026-06-11 — AUTO-DEPLOY NOW WORKS)

The `bam-portal` Vercel project (staff + client portal, custom domains
`portal.byanymeansbusiness.com` AND `staff.byanymeansbusiness.com` - both serve
the same app; Zoran calls the staff one by its staff subdomain (confirmed
2026-07-03) - alias `bam-portal-tawny.vercel.app`) **DOES
auto-deploy on push/merge to main** — verified 2026-06-11: PRs #197–#200 each
produced a production deployment carrying `meta.githubCommitSha`. Project is
linked to `zoran-star/bam-os-requirements`, production branch `main`, Root
Directory `bam-ghl-agent/bam-portal`, auto-deployments enabled.

So the normal ship path is just: **merge to main → Vercel deploys.** This also
means edits from Claude Code mobile / claude.ai/code go live on merge with no
laptop involved.

The manual-deploy instructions below are kept for when a deploy needs to be
forced (e.g. Vercel webhook hiccup). The earlier "no auto-deploy" finding
(2026-06-07) predated the git connection working; deployments back then had no
GitHub commit metadata.

**`vercel redeploy <url>` is a TRAP here:** it rebuilds the *original uploaded
source* of that deployment with current env vars — it does NOT pull the new merged
code. Using it after a merge silently keeps OLD frontend/api code live (env-var
changes DO apply, which is why redeploy "worked" for the GTA token but not for
code). Confirmed empirically: after merging the journey board, redeploy left the
old bundle live (grep of the deployed JS chunks had no new strings).

## The correct way to ship code changes

A clean deploy that uploads the actual current working tree. The project's
**Root Directory is `bam-ghl-agent/bam-portal`**, so running `vercel --prod` from
inside that dir DOUBLES the path (`.../bam-ghl-agent/bam-portal/bam-ghl-agent/bam-portal`
not found). Run from the **repo root** with the bam-portal project targeted via
env vars so rootDirectory resolves correctly:

```bash
cd /Users/zoransavic/bam-os-requirements
VERCEL_ORG_ID=team_6wlt8XJIU73wBv6T6SgOCr7J \
VERCEL_PROJECT_ID=prj_QZto4RmUsKKMHDEgS3EjauhIfpMQ \
vercel deploy --prod --yes
```

This uploads the real source, builds, and aliases to production
(`bam-portal-tawny.vercel.app` → `portal.byanymeansbusiness.com`).

## Verifying a deploy actually shipped (frontend is code-split)

`GhlKpiDiscovery` and other panels are in lazy chunks, so grepping the entry
bundle isn't enough. Crawl the chunks and grep for a string unique to the change:

```bash
B=https://bam-portal-tawny.vercel.app
curl -s "$B/" | grep -oE 'assets/[A-Za-z0-9_-]+\.js' | sort -u > /tmp/chunks.txt
for c in $(cat /tmp/chunks.txt); do curl -s "$B/$c" -o "/tmp/c_$(echo $c|tr / _)"; done
# one more pass to follow dynamic-import chunk refs, then:
grep -l "Journey board" /tmp/c_assets_* && echo LIVE || echo OLD
```

For API routes, an unauthenticated probe of a NEW `?resource=` returns 401
(`auth required`) when live vs 400 (`invalid resource`) on old code.

## Notes
- IDs: org `team_6wlt8XJIU73wBv6T6SgOCr7J`, project `prj_QZto4RmUsKKMHDEgS3EjauhIfpMQ`.
- Env-var-only changes (e.g. `GHL_LOCATIONS_JSON`) CAN go live via redeploy since
  env is applied fresh — but code changes cannot. When in doubt, do the clean deploy.
- Supabase project ref for this app: `jnojmfmpnsfmtqmwhopz`.
