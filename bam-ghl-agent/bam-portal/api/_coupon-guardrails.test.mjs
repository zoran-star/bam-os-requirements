// THE COUPON GUARDRAILS GATE: api/_coupon-guardrails.js, imported directly.
//
//   node api/_coupon-guardrails.test.mjs
//
// WHY THIS FILE EXISTS (2026-08-06, whitespace-applies_to remediation). The
// module is the single shared brain for coupon scope and coupon math, imported
// by create-discount, members, checkout, validate-coupon, match-prices and
// workbook - and until this pass NOTHING pinned its own behaviour directly:
// every consumer's suite stubbed it or walked around it. The adversarial
// finding this closes: `applies_to: [" "]` read as "restricted" to raw
// length checks while couponAppliesToKeys trimmed it to null = EVERYTHING,
// so the guards and the Stripe coupon builder disagreed about the same code.
// cleanAppliesTo is now the ONE definition of applies-to emptiness and this
// file is where that definition is pinned.
//
// WHAT THIS PROVES
//   1. A whitespace-only applies_to list IS empty: couponAppliesToKeys answers
//      null (= everything), which is exactly why the apply-side fee withhold
//      (unrestrictedCodes in api/offers/match-prices.js, pinned in
//      api/_workbook-apply.test.mjs) must fire on the same list - the pairing
//      is the claim, and it is asserted in one sentence below.
//   2. Trim never over-refuses: a padded REAL key survives, and a mixed list
//      keeps its real keys only.
//   3. couponCoversKey is unchanged for real keys.
//   4. A code NAMED by whitespace only ("   ") mints NOTHING on the coupon-mint
//      path: normCode trims it to "", validateCouponDef refuses it, and the
//      mint loop in api/offers/create-discount.js skips it (`if (!code)
//      ... continue`) BEFORE any stripeCouponBody call - verified against the
//      source, so the guard cannot silently move below the body builder.
//
// NEGATIVE CONTROL. Prints "NEGATIVE CONTROL PASSED" and exits 0 when caught.
//
//   MUTATE=blankkeysrestrict   node api/_coupon-guardrails.test.mjs
//       cleanAppliesTo stops trimming - raw `.filter(Boolean)` - so `[" "]`
//       reads as a restriction again. The one-line hole exactly as it shipped.
//
// MEASURED CATCH COUNTS (2026-08-06, measured on that date):
//   blankkeysrestrict -> 4 failures here (the null/everything pairing,
//                        couponCoversKey on the whitespace list, the mixed
//                        list, and the padded-key trim). The SAME one-line pin is carried by
//                        api/_workbook.test.mjs (confirm battery),
//                        api/_workbook-apply.test.mjs (fee withhold) and
//                        scripts/verify-workbook-contract.mjs (direct-POST
//                        confirm) - counts recorded in each file's header.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; failures.push(label); console.log("  ❌ " + label); }
};

// ── importing the module (real file, or a pinned mutant copy) ────────────────
const BLANKKEYSRESTRICT = [[
  `const cleanAppliesTo = (v) =>
  (Array.isArray(v) ? v.map((k) => String(k == null ? "" : k).trim()).filter(Boolean) : []);`,
  `const cleanAppliesTo = (v) =>
  (Array.isArray(v) ? v.filter(Boolean) : []);   // (control blankkeysrestrict) raw values, no trim`]];

let modulePath = path.join(HERE, "_coupon-guardrails.js");
const tmpFiles = [];
process.on("exit", () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } });
if (MUTATE) {
  if (MUTATE !== "blankkeysrestrict") {
    console.log(`❌ NEGATIVE CONTROL FAILED: unknown control MUTATE=${MUTATE}. Known controls: blankkeysrestrict`);
    process.exit(1);
  }
  let src = fs.readFileSync(modulePath, "utf8");
  for (const [find, repl] of BLANKKEYSRESTRICT) {
    if (!src.includes(find)) {
      console.log(`❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} is pinned to text that is no longer in api/_coupon-guardrails.js:\n\n${find}\n\nRe-point it or delete it - a pin that fails to apply looks exactly like a check that passed.`);
      process.exit(1);
    }
    src = src.split(find).join(repl);
  }
  modulePath = path.join(HERE, ".mutant-coupon-guardrails-gate.js");
  fs.writeFileSync(modulePath, src);
  tmpFiles.push(modulePath);
}
const G = await import(pathToFileURL(modulePath).href);

console.log("\n── 1. whitespace-only applies_to is EMPTY, and empty means everything ──");
{
  const keys = G.couponAppliesToKeys({ applies_to: [" ", "\t"] });
  const cleaned = G.cleanAppliesTo([" ", "\t"]);
  ok(keys === null && Array.isArray(cleaned) && cleaned.length === 0,
    `couponAppliesToKeys({applies_to:[" ","\\t"]}) answers null - the coupon applies to EVERYTHING, the joining fee included, which is exactly why the apply-side withhold (unrestrictedCodes) must fire on the same list: the null here and the withhold there are one claim (saw ${JSON.stringify(keys)}, cleaned ${JSON.stringify(cleaned)})`);
  ok(G.couponCoversKey({ applies_to: [" ", "\t"] }, "Academy 2x/week|signup_fee") === true,
    "and couponCoversKey reads that same list as covering the fee key - unrestricted, not narrowed");
}

console.log("\n── 2. trim never over-refuses a real key ──");
{
  const mixed = G.couponAppliesToKeys({ applies_to: ["a", " "] });
  ok(JSON.stringify(mixed) === JSON.stringify(["a"]),
    `a mixed list keeps its real keys only: ["a", " "] -> ${JSON.stringify(mixed)}`);
  const padded = G.couponAppliesToKeys({ applies_to: ["  Academy 2x/week|monthly  "] });
  ok(JSON.stringify(padded) === JSON.stringify(["Academy 2x/week|monthly"]),
    `a padded real key survives, trimmed: ${JSON.stringify(padded)}`);
}

console.log("\n── 3. couponCoversKey unchanged for real keys ──");
{
  ok(G.couponCoversKey({ applies_to: ["a", "b"] }, "a") === true, 'a restricted code covers a listed key ("a")');
  ok(G.couponCoversKey({ applies_to: ["a", "b"] }, "c") === false, 'and does not cover an unlisted one ("c")');
  ok(G.couponCoversKey({}, "anything") === true, "a code with no list at all covers everything, as it always did");
}

console.log("\n── 4. a whitespace-only code NAME mints no coupon ──");
{
  // The mint path's own guard order, replicated value-for-value: normCode
  // trims the name to nothing, so the `if (!code) ... continue` in
  // api/offers/create-discount.js skips the row before any Stripe body is
  // built - and validateCouponDef refuses it independently.
  const skippedName = G.normCode("   ");
  const def = G.validateCouponDef({ code: "   ", kind: "Dollar off", value: 100 });
  ok(skippedName === "" && def.ok === false,
    `a code named "   " with value 100 produces NO coupon body: normCode skips it as ${JSON.stringify(skippedName)} ("empty code") and validateCouponDef refuses ("${def.error}")`);
  // And the source-order pin: the skip sits ABOVE both stripeCouponBody call
  // sites in the mint loop, so the guard cannot drift below the body builder.
  const cd = fs.readFileSync(path.join(HERE, "offers", "create-discount.js"), "utf8");
  const guardAt = cd.indexOf('if (!code) { results.push({ code: c.code, error: "empty code" }); continue; }');
  const bodyAt = cd.indexOf("stripeCouponBody(");
  ok(guardAt >= 0 && bodyAt >= 0 && guardAt < bodyAt,
    `api/offers/create-discount.js still skips the empty-after-trim name BEFORE its first stripeCouponBody call (guard at ${guardAt}, first body build at ${bodyAt})`);
}

// ─── report ──────────────────────────────────────────────────────────────────
console.log("");
if (MUTATE) {
  const caught = fail > 0;
  console.log(caught
    ? `✅ NEGATIVE CONTROL PASSED: MUTATE=${MUTATE} was caught by ${fail} assertion(s):\n   - ${failures.slice(0, 4).join("\n   - ")}`
    : `❌ NEGATIVE CONTROL FAILED: MUTATE=${MUTATE} broke a real guarantee and every assertion still passed. That check is decorative.`);
  process.exit(caught ? 0 : 1);
}
console.log(fail ? `❌ ${pass} passed, ${fail} failed.` : `✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
