# Client portal error copy — always use _friendlyErr()

**2026-07-06 (PR #1192, follow-up to #1191).** Raw exception/provider text (Meta `(#200)` strings, `HTTP 502`, JSON blobs, `Failed to fetch`) must never render in the client portal UI.

## The rule
In `bam-portal/public/client-portal.html`, every client-facing error render goes through `_friendlyErr(e, fallback)` (defined next to `escapeHTML`, ~line 41194):

```js
host.innerHTML = `Couldn't load contacts - ${escapeHTML(_friendlyErr(e, 'please try again in a minute'))}`;
```

- Short, plain, human-readable messages pass through as-is.
- Anything technical-shaped (`{`, `<`, `(#`, HTTP/status codes, fetch noise, empty, >80 chars) is swallowed: raw error goes to `console.error`, client sees calm generic copy.
- With a `Couldn't load X - ` / `: ` prefix, pass the lowercase tail `'please try again in a minute'`; standalone surfaces omit the fallback and get "Something went wrong on our end - please try again in a minute."
- Keep `escapeHTML(...)` wrapped around the call - pass-through messages still need escaping.

## Why
Provider errors are for staff, not clients (a Meta permission string reads like the client's ads are broken when they aren't). Applies to ALL tiers including V1 - error-state copy is a bug-fix carve-out.

**Never** write a new `escapeHTML(e.message)` / `escapeHTML(json.error ...)` render site - grep for those patterns if auditing.
