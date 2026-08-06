import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Local-only config for the clickable Backlog mockup (mock/index.html).
// The alias swaps src/lib/supabase for a fake one, which lets the mockup mount
// the REAL BacklogV2View instead of a hand-copied lookalike that would drift.
// Not part of any build or deploy: `npm run build` still uses vite.config.js.
export default defineConfig({
  root: path.resolve(here, "mock"),
  plugins: [react()],
  resolve: {
    alias: [
      // Matches "../lib/supabase" and "../../lib/supabase" alike.
      { find: /^.*\/lib\/supabase$/, replacement: path.resolve(here, "mock/fake-supabase.js") },
    ],
  },
  server: { port: 5180, strictPort: true },
});
