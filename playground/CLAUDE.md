# Zoran's Playground

Personal PWA Zoran builds on with Claude Code (incl. from his phone). Starts as a
synced TODO board; will grow into more pages over time.

## Stack
- **Vite 8 + React 19** (matches the rest of the repo)
- **PWA** via `vite-plugin-pwa` — installable to the iPhone home screen
- **Supabase** for data (synced across devices, live via realtime)
- **Passcode gate** (`src/Gate.jsx`) — client-side only, not real auth

## Files
| File | What it does |
|------|--------------|
| `src/App.jsx` | Passcode gate → renders the board |
| `src/Gate.jsx` | Passcode screen. Code = `VITE_PASSCODE` (default `0603`) |
| `src/Todos.jsx` | The TODO board — load, toggle, add, delete, live sync |
| `src/supabase.js` | Supabase client (URL + publishable key) |
| `src/styles.css` | All styling (dark theme) |
| `vite.config.js` | PWA manifest + service worker config |

## Data
Supabase project `jnojmfmpnsfmtqmwhopz`. One table:

`playground_todos` — `id, section, section_position, label, position, done, created_at, updated_at`

RLS is open to the publishable key (personal app, gated by passcode). Realtime is on,
so edits on one device push to others.

## Add a new page (the pattern)
1. New table in Supabase if it needs data (prefix `playground_`).
2. New component in `src/`, import `supabase` from `./supabase`.
3. Render it from `App.jsx` (add simple nav when there's more than one page).

## Deploy
Pushes to `main` auto-deploy via its own Vercel project (root dir = `playground/`).
Do NOT deploy via CLI — just push.
