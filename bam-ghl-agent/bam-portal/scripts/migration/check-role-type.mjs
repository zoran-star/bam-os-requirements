#!/usr/bin/env node
// Check the column type of `staff.role`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8")
    .split("\n").filter(l => l && !l.startsWith("#")).map(l => {
      const idx = l.indexOf("="); if (idx === -1) return ["", ""];
      let v = l.slice(idx + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "").replace(/\\r/g, "").trim();
      return [l.slice(0, idx), v];
    })
);

// Try to insert a row with a probe role value; rollback by deleting on error
// Easier: just check via OpenAPI introspection
const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/?apikey=${env.SUPABASE_SERVICE_KEY}`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Accept: "application/openapi+json" },
});
const spec = await res.json();
const staffSchema = spec?.definitions?.staff;
if (!staffSchema) {
  console.log("No staff schema found in OpenAPI spec");
  process.exit(1);
}
console.log("staff.role:", JSON.stringify(staffSchema.properties?.role, null, 2));
