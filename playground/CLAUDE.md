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

## Slack Digest widget (`type: 'slack'`)
Tap the Slack card → pick a date/time → **Summarize**. Calls the `slack-digest`
edge function, which:
1. Reads Zoran's Slack user token from `user_slack_tokens` (slack_user_id `U09A66CU5N2`).
2. Lists every channel/DM he's in, pulls messages + thread replies since the chosen time.
3. Summarizes each conversation + an overview with Claude (`claude-haiku-4-5`).

- Edge function source: `supabase/functions/slack-digest/index.ts`.
- Secrets it reads (both in the `app_secrets` table, via service role):
  `user_slack_tokens.access_token` and `app_secrets.key = 'anthropic_api_key'`.
- Limitation: catches threads whose **parent** is in the window; replies to older
  threads aren't surfaced. Caps at 60 channels.

## Mind Map widget (`type: 'mindmap'`)
FigJam-style canvas. `src/MindMap.jsx` + `src/mm-geometry.js`.
- Tools (bottom pill): **Select**, **Box**, **Text**, **Arrow**.
- Boxes: drag to move, drag the blue corner to resize, double-tap to edit text.
- Text size + box color: contextual bar appears when a node is selected (A− / A+ / swatches).
- Arrows: pick the Arrow tool, drag from one box to another. Routed at right angles;
  select an arrow and drag its dot to bend the elbow.
- Stored as ONE JSON doc in `playground_scenes` (key `mindmap`), autosaved (500ms debounce).
  Doc shape: `{ nodes:[{id,type,x,y,w,h,text,fontSize,fill,color}], edges:[{id,from,to,axis,split}] }`
  where an edge endpoint is `{node:id}` or a free `{x,y}` point.

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
