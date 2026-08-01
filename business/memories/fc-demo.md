# fc-demo - the public investor demo (zero-backend)

Built 2026-08-01 (Cole's call after the "no risk" discussion). Lives at repo root
`fc-demo/`; full mechanics in [`fc-demo/README.md`](../../fc-demo/README.md).

- `build.mjs` GENERATES the demo from the canonical client-portal.html on every
  deploy (mock forced on, parked FCUI pilot forced off, network belt blocking
  real product hosts, noindex + welcome overlay + DEMO badge). Output is never
  committed and never hand-edited; the build THROWS if a patch anchor drifts.
- Safety model: the Vercel project is static-only - no API routes, no keys, no
  DB. Nothing on the server to leak. The client-side belt is redundancy.
- Verified 2026-08-01: mock boots rich (Northside Hoops), V2 command center (not
  the pilot), Hawkeye deck opens + approve works, ZERO requests to real product
  hosts, ZERO page errors (the long-standing mock _paintReport TypeError was
  fixed at the source - null-safe campaigns array - in the same change).
- ONE-TIME SETUP still needed: import the repo as a new Vercel project with
  Root Directory `fc-demo`, then add the `demo.fullcntrl.io` domain (steps in
  the README). Until then the demo has no public URL.
- Optional hardening if Zoran wants it gated: an access-code check is a one-line
  add in build.mjs (documented in the chat 2026-08-01, not built).
- The investor one-pager should get a "poke around the live demo" button once
  the domain is live.
