#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=");
      if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/staff?select=*&order=name.asc`, {
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
});
const rows = await res.json();
console.log(JSON.stringify(rows, null, 2));
