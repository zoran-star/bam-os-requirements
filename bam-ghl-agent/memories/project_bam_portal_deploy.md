---
name: bam-portal deploy (how to actually ship)
description: How to deploy the bam-portal Vercel project. It is NOT git-auto-deployed, and `vercel redeploy` does NOT pick up new code — use a clean `vercel deploy --prod` from the repo root with the project env vars.
type: project
---

## TL;DR (verified 2026-06-07)

The `bam-portal` Vercel project (staff + client portal, custom domain
`portal.byanymeansbusiness.com`, alias `bam-portal-tawny.vercel.app`) does **NOT
reliably auto-deploy on push to main** — its deployments carry no GitHub commit
metadata (`vercel inspect --json` → `meta.githubCommitSha` is absent). So a git
merge alone may not ship.

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
