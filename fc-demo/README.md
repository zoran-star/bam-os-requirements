# fc-demo - the public investor demo of FullControl

A **zero-backend** deployment of the real client portal locked to the fictional
Northside Hoops Academy. Generated from the canonical portal file on every
deploy, so it can never drift from the product (see the stale-copy incident,
`business/memories/investor-materials-refresh-2026-07.md`).

## How it works

`build.mjs` reads `../bam-ghl-agent/bam-portal/public/client-portal.html` and
applies four patches: mock mode forced on, the parked FCUI pilot forced off, a
client-side block on all real product hosts, and demo dressing (noindex, title,
welcome overlay, persistent DEMO badge). Output: `public/index.html`. Nothing in
`public/` is committed - it is a build artifact.

Safety model: this project has **no API routes, no database, no keys**. There is
nothing on the server to leak. The network belt is redundancy, not the defense.

## One-time Vercel setup (Cole or Zoran)

1. Vercel -> Add New Project -> import `zoran-star/bam-os-requirements`
2. **Root Directory: `fc-demo`** (build command + output dir come from vercel.json)
3. Deploy, then Settings -> Domains -> add `demo.fullcntrl.io`
4. Done. Every push to main rebuilds the demo from the canonical portal.

## Local preview

```bash
node build.mjs && python3 -m http.server 5180 -d public
# open http://localhost:5180
```

## Rules

- NEVER edit `public/index.html` - it is generated. Edit the canonical portal.
- The fixture data must stay 100% fictional - it is public.
- If a patch anchor breaks (the build THROWS on drift, by design), fix the
  anchor in `build.mjs` to match the current canonical file.
