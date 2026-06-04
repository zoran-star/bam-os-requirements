# Zoran's Playground

Personal PWA Zoran builds on with Claude Code (incl. from his phone). Starts as a
synced TODO board; will grow into more pages over time.

## Stack
- **Vite 8 + React 19** (matches the rest of the repo)
- **PWA** via `vite-plugin-pwa` — installable to the iPhone home screen
- **Supabase** for data (synced across devices, live via realtime)
- **Passcode gate** (`src/Gate.jsx`) — client-side only, not real auth

## Navigation
**Whiteboard (home)** → tap a card → **zooms into** that widget full-screen → `‹` back.

## Files
| File | What it does |
|------|--------------|
| `src/App.jsx` | Gate → Whiteboard; tracks which widget is open full-screen |
| `src/Gate.jsx` | Passcode screen. Code = `VITE_PASSCODE` (default `0603`) |
| `src/Whiteboard.jsx` | Pan/zoom canvas; draggable cards; tap a card to open it |
| `src/TodoPreview.jsx` | Mini read-only TODO shown on the whiteboard card |
| `src/Todos.jsx` | Full TODO view — toggle/add/delete + **slide-to-nest** (depth) |
| `src/supabase.js` | Supabase client (URL + publishable key) |
| `src/styles.css` | All styling (dark theme) |
| `vite.config.js` | PWA manifest + service worker config |

## Data
Supabase project `jnojmfmpnsfmtqmwhopz`. Two tables (RLS open to publishable key, realtime on):

- `playground_widgets` — `id, type, title, x, y, w, h, color, …` — cards on the whiteboard.
- `playground_todos` — `id, section, section_position, label, position, done, depth, …`
  `depth` = nesting level (slide a row right to indent under the one above; left to outdent).

## Add a new widget type
1. Insert a row in `playground_widgets` with a new `type`.
2. Render its card preview in `Whiteboard.jsx` (the `w.type === 'todo' ? … : …` branch).
3. Render its full-screen view in `App.jsx` (next to the `Todos` case).

## Add a new page (the pattern)
1. New table in Supabase if it needs data (prefix `playground_`).
2. New component in `src/`, import `supabase` from `./supabase`.
3. Render it from `App.jsx` (add simple nav when there's more than one page).

## Deploy
Pushes to `main` auto-deploy via its own Vercel project (root dir = `playground/`).
Do NOT deploy via CLI — just push.
