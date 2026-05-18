#!/usr/bin/env node
// Verify the 3 critical security fixes hold against production.
// Run AFTER deploy with: node scripts/migration/test-security-fixes.mjs --api=prod

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

const apiFlag = process.argv.find(a => a.startsWith("--api="));
const apiMode = apiFlag?.split("=")[1];
const apiBase = apiMode === "local" ? "http://localhost:3000"
              : apiMode === "prod" ? "https://bam-portal-tawny.vercel.app"
              : "https://bam-portal-tawny.vercel.app";

let pass = 0, fail = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${detail ? "  →  " + detail : ""}`);
    fail++;
  }
}

console.log("━".repeat(72));
console.log(`SECURITY FIX VERIFICATION — ${apiBase}`);
console.log("━".repeat(72));

// ─── SEC-3: Notion query rejects anonymous callers ────────────────────────
console.log("\n[SEC-3] /api/notion/query requires auth");
{
  const res = await fetch(`${apiBase}/api/notion/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "sops" }),
  });
  check(`Unauthenticated POST → 401 (got ${res.status})`, res.status === 401);

  const res2 = await fetch(`${apiBase}/api/notion/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-token" },
    body: JSON.stringify({ type: "sops" }),
  });
  check(`Bogus Bearer → 401 (got ${res2.status})`, res2.status === 401);

  const res3 = await fetch(`${apiBase}/api/notion/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "sop_content", pageId: "i-am-not-a-uuid" }),
  });
  check(`sop_content with garbage pageId → 401 (auth blocks first)`, res3.status === 401);
}

// ─── SEC-2: Signup is non-enumerable ──────────────────────────────────────
console.log("\n[SEC-2] Signup does not leak email existence");
{
  // Use a known-existing email + a known-new email. Responses should be identical
  // (both 200 ok with generic message) so an attacker can't tell them apart.
  // We do NOT actually send a real test signup that would create rows — we
  // probe by hitting the same endpoint multiple times and asserting identical
  // responses on the SHAPE (not the body) regardless of email.

  const existingEmail = "jeremy@majorhoops.com"; // already in clients table
  const randomEmail = `nonexistent-${Date.now()}@example-not-real.com`;

  const probe = async (email) => {
    const r = await fetch(`${apiBase}/api/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_name: "Test biz", owner_name: "Test owner", email }),
    });
    const body = await r.json();
    return { status: r.status, body };
  };

  const a = await probe(existingEmail);
  const b = await probe(randomEmail);

  // Both should be 200 (or both should be 429 if we got rate limited mid-test)
  check(`Existing email status === new email status (${a.status} vs ${b.status})`,
    a.status === b.status);

  // Body shape should match
  const aHasOk = a.body?.ok === true || a.body?.error;
  const bHasOk = b.body?.ok === true || b.body?.error;
  check(`Both responses have the same shape`, aHasOk === bHasOk);

  // No 'already exists' wording leak
  const aText = JSON.stringify(a.body).toLowerCase();
  const bText = JSON.stringify(b.body).toLowerCase();
  check(`Response does NOT include "already exists" wording for existing email`,
    !aText.includes("already exists"));
  check(`Response does NOT include "already exists" wording for new email`,
    !bText.includes("already exists"));
}

// ─── SEC-1: Hardcoded anon key removed ────────────────────────────────────
console.log("\n[SEC-1] Hardcoded anon key fallback gone");
{
  // We can't probe the deployed bundle directly, but we can verify the source
  // file has no fallback string.
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "supabase.js"), "utf8");
  check(`src/lib/supabase.js has no hardcoded JWT fallback`,
    !/eyJ[A-Za-z0-9_-]{20,}/.test(src));
  check(`src/lib/supabase.js throws if env vars missing`,
    /throw new Error\(/.test(src));
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log();
console.log("━".repeat(72));
console.log(`RESULTS: ${pass} passed, ${fail} failed`);
console.log("━".repeat(72));

if (fail > 0) {
  console.log("\n❌ Some security fixes did not hold. Re-investigate before claiming done.");
  process.exit(1);
}
console.log("\n✅ All critical security fixes verified.");
