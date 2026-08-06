// THE CALL-SITE WAVE: every academy-scoped Stripe helper is a hollow shell over
// api/_stripe-transport.js, and the money gates are three-outcome.
//
//   node api/_stripe-callsite-wave.test.mjs
//
// WHAT THIS IS ABOUT. The direct-key transport gives platform-locked academies
// (CoachIQ-style, no Connect OAuth) their own Stripe key. For that to work,
// every academy-scoped call in the repo has to route through the ONE resolver -
// with ZERO call-site diffs. Each file's local stripeFetch/stripeGet/stripeReq
// keeps its exact name and signature and delegates; the resolver keys off the
// stripeAccount value the call sites already pass. Until a direct row exists in
// prod this whole wave is a pure no-op: Connect academies must behave
// byte-identically.
//
// WHAT IT PROVES
//   1. DELEGATION, in source bytes (the billing-cadence technique: read the
//      SHIPPED file, assert on it - a paraphrase can drift, bytes cannot).
//      The representative helpers delegate to transportStripeFetch and no
//      longer read a Stripe key from env themselves. A restored local env read
//      is the exact regression that would silently un-route direct academies
//      back onto the platform key (MUTATE=localenv).
//   2. PRECEDENCE, and it is now EXECUTED rather than spelled. onboarding/
//      checkout.js, website/checkout.js, camp-checkout and parent/_stripe.ts
//      honor ONBOARDING_STRIPE_SECRET_KEY FIRST - ahead of every envelope the
//      resolver could otherwise pick - and it travels as keyOverride, the
//      transport's own first-precedence door. These pins used to match the
//      literal `process.env.ONBOARDING_STRIPE_SECRET_KEY` at the keyOverride
//      site. That read moved behind api/_stripe-onboarding-key.js so the mode
//      decision and the credential come from ONE normalized value (a leading
//      space on an sk_test key used to give isTestMode()=false while the
//      transport authenticated with the test key - live branches, test money).
//      The SPELLING moved; the invariant did not, so the pins now assert the
//      invariant: the shipped helper is run against the REAL transport with an
//      active direct row waiting to be chosen, and the override has to win.
//   3. THE ERROR CONTRACTS SURVIVE. parent/_stripe.ts still throws its own
//      StripeFetchError (message / stripeStatus / responseBody) and its
//      intervalFor / piSecretFromSub are untouched. isTestMode is DELIBERATELY
//      no longer untouched - see section 3's comment for what replaced that pin
//      and why the replacement is a stronger guarantee than "unchanged".
//   4. MONEY GATES are three-outcome (house rule 10, option B - ruled by the
//      orchestrator 2026-07-31): ready = the stored-field check, unchanged;
//      not-ready = the row answered, existing 409/400 wording unchanged;
//      could-not-ask = the clients read THREW -> 503 "could not verify billing
//      setup, try again" - NEVER the 409. A gate that answers "not connected"
//      when the database was unreachable states an outage as a fact about an
//      academy (MUTATE=gate409).
//   5. PUBLISHABLE KEYS come from the resolver's publishableFor at every return
//      site that used to read process.env.STRIPE_PUBLISHABLE_KEY directly.
//   6. kpis-v15 payouts DEGRADE: when getCapabilities says a direct key lacks
//      the payouts permission, the revenue payload carries payouts: null - "we
//      cannot see them" - instead of $0.00-as-if-none-happened or a throw.
//   7. EXECUTABLE: the transport itself (imported for real, fetch stubbed)
//      passes pre-encoded STRING bodies through byte-for-byte (api/members.js
//      relies on that), drops null/undefined from object bodies, and throws the
//      superset error shape every hollowed caller reads.
//
// WHAT IT DOES NOT PROVE. That the resolver picks the right transport per
// account - that is api/_stripe-transport.test.mjs's job. Nothing here touches
// a database or the network.
//
// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS. Each breaks one thing IN MEMORY and requires this suite's
// own assertions to notice; a control run must PRINT the banner:
//
//   MUTATE=localenv node api/_stripe-callsite-wave.test.mjs
//     restores api/members.js's helper to reading its own env key - caught by
//     the delegation assertions (1).
//   MUTATE=gate409  node api/_stripe-callsite-wave.test.mjs
//     makes website/checkout.js's gate answer 409 "not connected" when the
//     clients read THREW - caught by the three-outcome assertions (4).
//   MUTATE=pubcatch node api/_stripe-callsite-wave.test.mjs
//     strips the Connect-fallback .catch off one publishableFor return site,
//     restoring the resolver as a hard-failure point AFTER the subscription
//     exists - caught by the publishable-key assertions (5).
//   MUTATE=overridedropped node api/_stripe-callsite-wave.test.mjs
//     the three checkout helpers stop passing the override at all, so the
//     resolver's own envelope wins and the test sandbox silently charges on the
//     live key - caught by the executed precedence assertions (2).
//   MUTATE=overrideindirect node api/_stripe-callsite-wave.test.mjs
//     the shared helper is repointed at a DIFFERENT env var, so every call site
//     still reads `onboardingKeyOverride()` and the override is dead. This is
//     the failure a source pin that stops at the indirection cannot see, which
//     is why section 2 executes and section 3 follows the helper's own source.
//   MUTATE=modesplit node api/_stripe-callsite-wave.test.mjs
//     isTestMode goes back to judging a RAW env read while the credential stays
//     normalized - defect B restored - caught by the derivation assertions (3).
//   MUTATE=credalias node api/_stripe-callsite-wave.test.mjs
//     parent/_stripe.ts's keyOverride goes back to a local typed alias carrying a
//     drift: a whitespace override becomes "no override", so the transport falls
//     through to the PLATFORM key - defect 4 recurring in the parent app.
//   MUTATE=modeguard node api/_stripe-callsite-wave.test.mjs
//     parent/_stripe.ts's isTestMode goes back from a RE-EXPORT to a wrapper
//     whose body is still exactly one return, with the drift hidden in a local
//     alias. The old body pin passed this; the re-export pin catches it.
//
// EXIT CODES read like the other control suites: a control run exits 0 when the
// mutation IS caught (the banner prints), 1 when it slipped through or the pin
// it mutates no longer matches. CI must look for the banner, not the exit code.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MUTATE = process.env.MUTATE || "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");

const MEMBERS = read("members.js");
const WEB = read("website/checkout.js");
const ONB = read("onboarding/checkout.js");
const CAMP = read("website/camp-checkout.js");
const PARENT = read("parent/_stripe.ts");
const KPIS = read("kpis-v15.js");
const ACTION = read("action-items.js");
const ONBKEY = read("_stripe-onboarding-key.js");

// Probe credentials, assembled from pieces: never a key-shaped literal in a
// committed file (push protection blocks those, and a suite that cannot be
// committed protects nothing).
const ONB_PROBE = "sk_" + "test_FIRST_PRECEDENCE_PROBE";
const PLATFORM_PROBE = "sk_" + "live_PLATFORM_PROBE";
const DIRECT_PROBE = "rk_" + "live_DIRECT_ROW_PROBE";
const SB_STUB = "https://wave.stub.invalid";

const TEMP_FILES = [];
process.on("exit", () => { for (const f of TEMP_FILES) { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } } });
// Leading dot on purpose: the one-doorway parity scan skips dotfiles, so a probe
// module that exists for milliseconds can never read as a new Stripe call site.
function writeTemp(name, source) {
  const p = path.join(HERE, name);
  fs.writeFileSync(p, source);
  TEMP_FILES.push(p);
  return p;
}
async function importTemp(name, source) {
  const p = writeTemp(name, source);
  try { return await import(pathToFileURL(p).href); }
  finally { try { fs.unlinkSync(p); } catch (_) { /* best effort */ } }
}

let pass = 0, fail = 0;
function report(results) {
  for (const r of results) {
    if (r.ok) { pass++; console.log(`  ✅ ${r.msg}`); }
    else { fail++; console.log(`  ❌ ${r.msg}`); }
  }
}

// Cut a top-level function's body out of a file by its declaration line. Loud on
// a moved pin: a cut that fails to apply must never look like a passing check.
function cut(src, decl, label) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`PIN MOVED: ${label} no longer contains the declaration line:\n  ${decl}`);
  const end = src.indexOf("\n}", i);
  if (end < 0) throw new Error(`PIN MOVED: could not find the closing brace of ${label}'s helper`);
  return src.slice(i, end + 2);
}

// ─── 1. delegation: api/members.js (the representative, string-body caller) ──
function checkMembersDelegation(src) {
  const out = [];
  const helper = cut(src, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', "members.js");
  out.push({ ok: /return transportStripeFetch\(path, \{ method, body, stripeAccount, idempotencyKey \}\);/.test(helper),
    msg: "members.js: stripeFetch is a hollow delegation to the transport, same name, same signature" });
  out.push({ ok: !/process\.env/.test(helper),
    msg: "members.js: the helper reads NO env key of its own - the resolver owns key selection" });
  out.push({ ok: !/api\.stripe\.com/.test(helper) && !/Authorization/.test(helper),
    msg: "members.js: the helper builds no Stripe request of its own (no URL, no auth header)" });
  out.push({ ok: src.includes('import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";'),
    msg: "members.js: imports the transport under an alias, keeping the local name free" });
  const calls = (src.match(/\bstripeFetch\(/g) || []).length - 1; // minus the declaration
  out.push({ ok: calls >= 30,
    msg: `members.js: the call sites are untouched (${calls} calls still go through the local name)` });
  out.push({ ok: src.includes("await stripeFetch(`/subscriptions/${member.stripe_subscription_id}`, {"),
    msg: "members.js: a known billing call site is byte-identical" });
  return out;
}

// ─── 4. the three-outcome money gate (generic over the six gate files) ───────
function checkGateThreeOutcome(src, label, notReadyLine) {
  const out = [];
  const catch503 = /\} catch \{\s*return res\.status\(503\)\.json\(\{ error: "could not verify billing setup, try again" \}\);\s*\}/;
  out.push({ ok: catch503.test(src),
    msg: `${label}: a clients read that THREW returns 503 could-not-ask, in a catch of its own` });
  out.push({ ok: !/catch \{\s*return res\.status\(409\)/.test(src) && !/catch \{\s*return res\.status\(400\)/.test(src),
    msg: `${label}: no catch turns a failed read into the not-connected answer (503, NEVER the 409)` });
  out.push({ ok: src.includes(notReadyLine),
    msg: `${label}: the not-ready wording for a row that ANSWERED is unchanged` });
  return out;
}

// ─── 2 + 5. precedence and publishable keys ─────────────────────────────────
// Every publishableFor site carries the SAME .catch fallback: these returns fire
// AFTER the subscription/PaymentIntent exists, and before this wave they could
// not fail. A resolver hiccup (the Supabase read behind publishableFor) must
// degrade to the Connect answer the site always returned - never 500 a
// checkout the parent already paid for (tester defect D1; MUTATE=pubcatch).
const pubCatch = (acct) => `publishableFor(${acct}).catch(() => ({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: ${acct} || null }))`;
const PUB_WITH_CATCH = pubCatch("stripeAccount"); // the exact string the pubcatch control strips
function checkOverridesAndPublishable(web = WEB, onb = ONB, camp = CAMP) {
  const out = [];
  // The parent-app sites ride the same rule: a direct academy's parents must
  // mount Stripe.js with the key that matches their client secret, so those
  // return sites ask the resolver too, with the same Connect fallback.
  const SITES = [
    ["website/checkout.js", web, 2, "stripeAccount"],
    ["onboarding/checkout.js", onb, 2, "stripeAccount"],
    ["website/camp-checkout.js", camp, 1, "stripeAccount"],
    ["parent/checkout.ts", read("parent/checkout.ts"), 2, "stripeAccount"],
    ["parent/billing.ts", read("parent/billing.ts"), 1, "academy.stripeAccount"],
  ];
  for (const [label, src, n, acct] of SITES) {
    const found = src.split(`publishableFor(${acct})`).length - 1;
    out.push({ ok: found === n,
      msg: `${label}: ${n} return site(s) ask the resolver's publishableFor (saw ${found})` });
    const guarded = src.split(pubCatch(acct)).length - 1;
    out.push({ ok: guarded === n,
      msg: `${label}: all ${n} publishableFor site(s) carry the Connect-fallback .catch - they cannot 500 after the money moved (saw ${guarded})` });
    const envReads = (src.match(/publishable_key: process\.env\.STRIPE_PUBLISHABLE_KEY/g) || []).length;
    out.push({ ok: envReads === n,
      msg: `${label}: the direct env read survives ONLY inside the ${n} catch fallback(s), nowhere else (saw ${envReads})` });
  }
  return out;
}

// ─── 2. ONBOARDING FIRST PRECEDENCE, EXECUTED ───────────────────────────────
//
// This was a source pin on the literal
//   keyOverride: process.env.ONBOARDING_STRIPE_SECRET_KEY || undefined,
// and that spelling is gone on purpose: the read moved behind
// api/_stripe-onboarding-key.js so the mode decision and the credential come
// from ONE normalized value. Relaxing the pin to match whatever the new code
// emits would have deleted the guarantee and kept the tick, so the pin was
// re-aimed at the INVARIANT instead, which never moved:
//
//   when ONBOARDING_STRIPE_SECRET_KEY is set, the credential that reaches
//   Stripe is THAT key, ahead of every other envelope, carried as keyOverride.
//
// Executed, not spelled. The SHIPPED helper is cut out of each file and run
// against the REAL transport with an ACTIVE DIRECT ROW waiting to be chosen -
// the strongest competing envelope there is, stronger than the platform key the
// old `||` chain competed with. LEG B is what makes leg A mean anything: with
// the env var unset the direct key must win, so leg A proves the override won
// rather than proving this file always sends the same string. A pin that can
// only pass is not a pin.
async function checkOnboardingPrecedence({ onbSpec = "./_stripe-onboarding-key.js", sources = {} } = {}) {
  const out = [];
  const saved = {
    onb: process.env.ONBOARDING_STRIPE_SECRET_KEY,
    enc: process.env.STRIPE_DIRECT_ENC_KEY,
    sbUrl: process.env.VITE_SUPABASE_URL, sbUrl2: process.env.SUPABASE_URL,
    svc: process.env.SUPABASE_SERVICE_ROLE_KEY,
    connect: process.env.STRIPE_CONNECT_SECRET_KEY, secret: process.env.STRIPE_SECRET_KEY,
  };
  process.env.STRIPE_DIRECT_ENC_KEY = "wave-suite-enc-key-not-a-real-one";
  process.env.VITE_SUPABASE_URL = SB_STUB;
  process.env.SUPABASE_URL = SB_STUB;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "wave-service-key";
  process.env.STRIPE_CONNECT_SECRET_KEY = PLATFORM_PROBE;
  delete process.env.STRIPE_SECRET_KEY;

  const { encryptSecret } = await import(pathToFileURL(path.join(HERE, "_stripe-direct-crypto.js")).href);
  const { bustTransportCache } = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);

  const realFetch = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(SB_STUB)) {
      const row = {
        client_id: "client-wave", status: "active", secret_key_enc: encryptSecret(DIRECT_PROBE),
        secret_key_last4: "robe", publishable_key: "pk_wave", stripe_account_id: "acct_wave",
        capabilities: null, key_last_verified_at: null,
      };
      const body = u.includes("client_stripe_direct") ? [row] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }
    return { ok: true, status: 200, text: async () => '{"id":"ok_stub"}' };
  };
  const bearerOf = () => {
    const s = calls.filter((c) => c.url.startsWith("https://api.stripe.com/"));
    return s.length ? String((s[s.length - 1].init.headers || {}).Authorization || "") : "(no Stripe call)";
  };

  try {
    for (const rel of ["website/checkout.js", "onboarding/checkout.js", "website/camp-checkout.js"]) {
      const src = sources[rel] || read(rel);
      const helper = cut(src, 'async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey } = {}) {', rel);
      // keyOverride is not decoration: it is the ONE argument that short-circuits
      // transport resolution. An override delivered any other way is not first.
      out.push({ ok: /keyOverride:/.test(helper),
        msg: `${rel}: the override still travels as keyOverride - the transport's own first-precedence door` });

      const M = await importTemp(`.wave-precedence-${rel.replace(/[/.]/g, "-")}.mjs`, [
        'import { stripeFetch as transportStripeFetch } from "./_stripe-transport.js";',
        `import { isOnboardingTestMode, onboardingKeyOverride } from "${onbSpec}";`,
        helper,
        "export { stripeFetch };",
      ].join("\n"));

      // LEG A: the override is set, and an active direct row exists for this
      // account. First precedence means the override still wins.
      process.env.ONBOARDING_STRIPE_SECRET_KEY = ONB_PROBE;
      bustTransportCache(); calls = [];
      let legAErr = null;
      try { await M.stripeFetch("/customers?limit=1", { stripeAccount: "acct_wave" }); } catch (e) { legAErr = e; }
      const a = bearerOf();
      out.push({ ok: !legAErr && a === `Bearer ${ONB_PROBE}`,
        msg: `${rel}: ONBOARDING_STRIPE_SECRET_KEY keeps FIRST precedence - it is the bearer even with an active direct row waiting (saw ${legAErr ? `threw ${legAErr.message}` : JSON.stringify(a)})` });

      // LEG B: unset it and the resolver's own envelope must take over. Without
      // this, leg A would also pass for a helper that hardcoded the probe key.
      delete process.env.ONBOARDING_STRIPE_SECRET_KEY;
      bustTransportCache(); calls = [];
      let legBErr = null;
      try { await M.stripeFetch("/customers?limit=1", { stripeAccount: "acct_wave" }); } catch (e) { legBErr = e; }
      const b = bearerOf();
      out.push({ ok: !legBErr && b === `Bearer ${DIRECT_PROBE}`,
        msg: `${rel}: with it UNSET the resolver's own envelope wins, so leg A proved the override and not a constant (saw ${legBErr ? `threw ${legBErr.message}` : JSON.stringify(b)})` });
    }

    // The shared derivation, run once: ONE normalized read answers both the mode
    // question and the credential, so they cannot disagree. LEADING whitespace
    // is the trigger - the raw read said "not test mode" while the transport
    // authenticated with the trimmed test key.
    const K = await import(pathToFileURL(path.resolve(HERE, onbSpec)).href);
    process.env.ONBOARDING_STRIPE_SECRET_KEY = ` ${ONB_PROBE}\n`;
    const mode = K.isOnboardingTestMode();
    const cred = K.onboardingKeyOverride();
    out.push({ ok: cred === ONB_PROBE,
      msg: `_stripe-onboarding-key.js: the credential is the normalized ONBOARDING_STRIPE_SECRET_KEY (saw ${JSON.stringify(cred)})` });
    out.push({ ok: mode === true && mode === String(cred || "").startsWith("sk_test"),
      msg: `_stripe-onboarding-key.js: the mode decision and the credential AGREE on a key with leading whitespace (mode ${mode}, credential ${JSON.stringify(cred)})` });
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [
      ["ONBOARDING_STRIPE_SECRET_KEY", saved.onb], ["STRIPE_DIRECT_ENC_KEY", saved.enc],
      ["VITE_SUPABASE_URL", saved.sbUrl], ["SUPABASE_URL", saved.sbUrl2],
      ["SUPABASE_SERVICE_ROLE_KEY", saved.svc],
      ["STRIPE_CONNECT_SECRET_KEY", saved.connect], ["STRIPE_SECRET_KEY", saved.secret],
    ]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    bustTransportCache();
  }
  return out;
}

// ─── 3. parent/_stripe.ts error contract + untouched pair ──────────────────
// The onboarding-key module's SOURCE is read here too, and that is the point.
// parent/_stripe.ts is TypeScript and this suite is plain node with no build
// step, so it cannot be executed - which makes it exactly the place where a pin
// that stops at the indirection would rot. `keyOverride: onboardingKeyOverride()`
// proves a function is called, not which env var it reads: a helper quietly
// repointed at another variable keeps the tick while the test sandbox dies
// silently. So these pins follow the call into the helper and assert what it
// actually reads. (MUTATE=overrideindirect is that exact failure.)
//
// COMMENTS ARE NOT CODE, and this pin learned that the hard way: the first
// version of it tested the helper's raw text for ONBOARDING_STRIPE_SECRET_KEY,
// which the helper's own header comment quotes. Repointing the reader at a
// different variable left the comment behind and the pin stayed green. So the
// helper is stripped to code before it is judged.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
}
function checkParent(src, onbKey = ONBKEY) {
  const out = [];
  out.push({ ok: src.includes("export class StripeFetchError extends Error")
      && src.includes("readonly responseBody: unknown;")
      && src.includes("readonly stripeStatus: number | null;"),
    msg: "parent/_stripe.ts: StripeFetchError keeps its exported shape (message/stripeStatus/responseBody)" });
  out.push({ ok: src.includes('if (!key) throw new StripeFetchError("Stripe secret key not configured");'),
    msg: "parent/_stripe.ts: the no-key-configured guard still throws the same StripeFetchError first" });
  // The import block, non-greedy so it cannot swallow a neighbouring import.
  const imported = (onb) => {
    const m = onb.match(/import \{([^}]*)\} from "\.\.\/_stripe-onboarding-key\.js";/);
    return m ? m[1] : "";
  };
  const names = imported(src);
  const helperCode = stripComments(onbKey);
  // ONE env read in the whole helper, and it is ONBOARDING_STRIPE_SECRET_KEY.
  // The count is the load-bearing half: a second read is how the mode check and
  // the credential drift apart again (defect B), and it is invisible to any pin
  // that only asks "is the right variable mentioned somewhere".
  const envReads = helperCode.match(/process\.env\.[A-Z0-9_]+/g) || [];
  const singleOnboardingRead = envReads.length === 1 && envReads[0] === "process.env.ONBOARDING_STRIPE_SECRET_KEY";
  out.push({ ok: src.includes("transportStripeFetch(path, {")
      && src.includes("keyOverride: onboardingKeyOverride(),")
      && /\bonboardingKeyOverride\b/.test(names)
      && singleOnboardingRead,
    msg: `parent/_stripe.ts: stripeFetch delegates with a keyOverride that resolves from ONBOARDING_STRIPE_SECRET_KEY (followed through _stripe-onboarding-key.js, not stopped at the call - saw env reads ${JSON.stringify(envReads)})` });
  out.push({ ok: src.includes("throw new StripeFetchError(err.message"),
    msg: "parent/_stripe.ts: transport errors are rethrown AS StripeFetchError for the importers" });
  // WAS: "isTestMode is untouched". It IS touched, deliberately, so that pin was
  // stating something false rather than something outdated - and "unchanged" was
  // never the guarantee anyone wanted. The guarantee wanted is that the mode this
  // module reports and the credential it authenticates with come from the SAME
  // normalized read and therefore cannot disagree. That is strictly stronger:
  // "untouched" would have happily passed on the shipped defect, where a leading
  // space on an sk_test key gave isTestMode()=false while the transport sent
  // "Bearer sk_test_...". Both halves are asserted here, in the helper where the
  // single read lives, because that is what makes them one decision.
  // STRUCTURAL, NOT SUBSTRING - and this file is where that distinction bites.
  // parent/_stripe.ts is TypeScript and this suite is plain node with no build
  // step, so it CANNOT be executed here; a substring pin is all that is left,
  // and a substring pin cannot see control flow. Adding
  //   if ((stripeKey() || "") !== (stripeKey() || "").trim()) return false;
  // ABOVE `return isOnboardingTestMode();` restores the exact drift while every
  // `src.includes(...)` check stays green. So the pin reads the function BODY and
  // requires it to be that one return and nothing else: any added statement,
  // guard or early return fails it, whatever it says.
  const bodyOf = (text, decl) => {
    const at = text.indexOf(decl);
    if (at < 0) return null;
    let depth = 1, i = at + decl.length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    return text.slice(at + decl.length, i - 1);
  };
  const normBody = (b) => (b == null ? null : stripComments(b).replace(/\s+/g, " ").trim());
  // A RE-EXPORT, which is stronger than "the body is exactly one return". The
  // body pin was itself defeatable: leave `return isOnboardingTestMode();` alone
  // and put the drift in the LOCAL ALIAS this file used to declare -
  //   const isOnboardingTestMode = isOnboardingTestModeUntyped as () => boolean;
  // - and isTestMode() returns false for a leading-space sk_test key while every
  // pin stays green. A re-export has no body AND no alias, so a branch has
  // nowhere to live. Asserted three ways, because the point is the ABSENCE of a
  // place to hide: the re-export exists, no local isTestMode function is
  // declared, and no local binding of the helper name is declared either.
  const reExport = /export\s*\{[^}]*\bisOnboardingTestMode\s+as\s+isTestMode\b[^}]*\}\s*from\s*"\.\.\/_stripe-onboarding-key\.js";/.test(src);
  const declaresFn = /function\s+isTestMode\s*\(/.test(stripComments(src));
  const declaresAlias = /(?:const|let|var)\s+isOnboardingTestMode\b/.test(stripComments(src));
  out.push({ ok: reExport && !declaresFn && !declaresAlias,
    msg: `parent/_stripe.ts: isTestMode is a RE-EXPORT of the shared read - no body and no alias for a branch to hide in (re-export ${reExport}, local fn ${declaresFn}, local alias ${declaresAlias})` });
  // THE CREDENTIAL NEEDS THE SAME RULE, and it did not have it. The mode side was
  // closed with a re-export while the credential kept a local typed alias, and a
  // drifting alias there returns undefined for a whitespace override -> the
  // transport falls through to the PLATFORM key -> defect 4 recurring in the
  // parent app, with every suite green. It was defended by a comment claiming
  // this alias "IS executed" by the wave suite, which is false: nothing
  // transpiles this .ts. So: no local binding of the credential name either.
  const declaresCredAlias = /(?:const|let|var)\s+onboardingKeyOverride\b/.test(stripComments(src));
  const credFromImport = /import\s*\{[^}]*\bonboardingKeyOverride\b[^}]*\}\s*from\s*"\.\.\/_stripe-onboarding-key\.js";/.test(src);
  out.push({ ok: credFromImport && !declaresCredAlias,
    msg: `parent/_stripe.ts: the keyOverride is the IMPORTED helper called directly - no local alias to hide a fall-through in (imported ${credFromImport}, local alias ${declaresCredAlias})` });
  out.push({ ok: reExport && src.includes("keyOverride: onboardingKeyOverride(),")
      && credFromImport && !declaresCredAlias
      && singleOnboardingRead
      && /return onboardingStripeKey\(\) \|\| undefined;/.test(helperCode)
      && /return onboardingStripeKey\(\)\.startsWith\("sk_test"\);/.test(helperCode),
    msg: "parent/_stripe.ts: isTestMode and the credential BOTH derive from the single onboardingStripeKey() read, so they cannot disagree" });
  // RE-STATED (2026-08-06, adjustable prepay lengths). "intervalFor is
  // untouched" stopped being true when the term vocabulary opened. The invariant
  // is what it always protected: the interval derives from the TERM KEY alone -
  // the legacy 3/6 month branches are byte-identical to what live members bill
  // on, any other <n>_months is bounded calendar months that REFUSES loudly out
  // of range (never the week x4 default), and everything else stays week x4.
  out.push({ ok: src.includes('if (term === "3_months") return { interval: "month", interval_count: 3 };')
      && src.includes('if (term === "6_months") return { interval: "month", interval_count: 6 };')
      && src.includes('const m = /^(\\d+)_months$/.exec(String(term || ""));')
      && src.includes("if (n >= 1 && n <= 24) return { interval: \"month\", interval_count: n };")
      && /outside the 1-24 month range[\s\S]{0,120}?return \{ interval: "week", interval_count: 4 \};/.test(src),
    msg: "parent/_stripe.ts: intervalFor derives from the term key - legacy 3/6 byte-identical, <n>_months bounded 1-24 with a loud refusal, week x4 for everything else" });
  out.push({ ok: src.includes("const confirmationSecret = (latestInvoice as { confirmation_secret?: unknown }).confirmation_secret;"),
    msg: "parent/_stripe.ts: piSecretFromSub is untouched" });
  return out;
}

// ─── 6. kpis-v15 payouts degrade to null when the key cannot see them ────────
function checkKpisPayouts(src) {
  const out = [];
  out.push({ ok: src.includes('import { stripeFetch as transportStripeFetch, getCapabilities } from "./_stripe-transport.js";'),
    msg: "kpis-v15.js: asks the resolver (getCapabilities) for the per-transport payouts fact" });
  out.push({ ok: src.includes("const caps = await getCapabilities(acct).catch(() => null);")
      && src.includes("caps.payouts !== false"),
    msg: "kpis-v15.js: a capability row saying payouts:false switches the payouts read off" });
  out.push({ ok: src.includes("payouts: payoutsArr ? money(payouts) : null,")
      && src.includes("payouts_count: payoutsArr ? payoutsArr.length : null,"),
    msg: "kpis-v15.js: an unreadable payouts feed reports null, never $0.00-as-a-fact" });
  out.push({ ok: src.includes("? await stripeGetAll(`/payouts?created[gte]=${start}&created[lt]=${end}`, acct).catch(() => [])"),
    msg: "kpis-v15.js: a permitted-but-failed payouts read still degrades to [] as before" });
  return out;
}

// ─── the sweep: every hollowed file routes through the transport ─────────────
const SWEEP = [
  "members.js", "members/enroll.js", "members/import-cancelled.js", "members-agent.js",
  "offers/create-price.js", "offers/create-discount.js", "offers/kpi-setup.js", "offers/match-prices.js",
  "sorter/cleanup.js", "sorter/fix-payment.js", "sorter/setup-monthly.js", "sorter/take-over.js", "sorter/take-over-ai.js",
  "ghl.js", "marketing.js", "kpis-v15.js", "contacts/stripe-link.js", "stripe/contact.js",
  "admin/backfill-stripe-joined-at.js", "commissions.js",
  "website/checkout.js", "website/camp-checkout.js", "website/validate-coupon.js",
];
// The stripe-bearer constructions the old helpers used. commissions.js's
// platform-invoicing stripeForm keeps `Bearer ${key}` ON PURPOSE (BAM's own
// account, not academy-scoped) and is not in this list.
const OLD_BEARERS = ["Bearer ${stripeKey()}", "Bearer ${STRIPE_KEY}", "Bearer ${stripeSecret}", "Bearer ${stripeKey}"];
function checkSweep() {
  const out = [];
  for (const rel of SWEEP) {
    const src = read(rel);
    const leftovers = OLD_BEARERS.filter((b) => src.includes(b));
    out.push({ ok: src.includes("transportStripeFetch(") && leftovers.length === 0,
      msg: `${rel}: routes through the transport${leftovers.length ? ` - STILL BUILDS ITS OWN BEARER: ${leftovers.join(", ")}` : ""}` });
  }
  out.push({ ok: ACTION.includes('import { readAccountHealth } from "./_stripe-transport.js";')
      && ACTION.includes("readAccountHealth({ id: clientId, stripe_connect_account_id: acct })")
      && !/readStripeAccount\(/.test(ACTION),
    msg: "action-items.js: backfillStripeWhenChargeable reads health through the resolver, same outcome gating" });
  out.push({ ok: ACTION.includes('if (status.outcome !== "ready") return signals;'),
    msg: "action-items.js: only outcome 'ready' can tick the onboarding step, exactly as before" });
  return out;
}

// ─── 7. executable: the transport seam the hollow helpers now stand on ───────
async function checkTransportExecutable() {
  const out = [];
  const { stripeFetch } = await import(pathToFileURL(path.join(HERE, "_stripe-transport.js")).href);
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"id":"sub_1"}' };
    };
    // (a) a pre-encoded STRING body passes through byte-for-byte (members.js's contract)
    const raw = "items[0][price]=price_1&metadata[athlete_name]=A%20B";
    await stripeFetch("/subscriptions", { method: "POST", body: raw, stripeAccount: "acct_1", keyOverride: "rk_live_ctrl" });
    const a = calls[0];
    out.push({ ok: a.url === "https://api.stripe.com/v1/subscriptions" && a.init.body === raw,
      msg: "transport: a pre-encoded string body reaches Stripe byte-for-byte" });
    out.push({ ok: a.init.headers.Authorization === "Bearer rk_live_ctrl" && a.init.headers["Stripe-Account"] === "acct_1"
        && a.init.headers["Content-Type"] === "application/x-www-form-urlencoded",
      msg: "transport: keyOverride is the bearer and the caller's Stripe-Account header survives" });
    // (b) object bodies drop null/undefined - the shape every old helper encoded
    await stripeFetch("/prices", { method: "POST", body: { currency: "cad", unit_amount: 7500, nope: null, gone: undefined }, keyOverride: "rk_live_ctrl" });
    out.push({ ok: calls[1].init.body === "currency=cad&unit_amount=7500",
      msg: "transport: object bodies drop null/undefined keys exactly like the old helpers" });
    // (c) the error superset every hollowed caller reads
    globalThis.fetch = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: { message: "Your card was declined." } }) });
    let err = null;
    try { await stripeFetch("/charges", { method: "POST", body: { amount: 1 }, keyOverride: "rk_live_ctrl" }); } catch (e) { err = e; }
    out.push({ ok: !!err && err.message === "Your card was declined." && err.stripeStatus === 402
        && !!err.stripeResponse && err.responseBody === err.stripeResponse,
      msg: "transport: errors carry message + stripeStatus + stripeResponse + responseBody (both legacy shapes)" });
  } finally {
    globalThis.fetch = realFetch;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
if (MUTATE === "localenv") {
  // Restore the helper's own env-key read - the regression that would silently
  // put a direct academy's traffic back on the platform key.
  const pin = "return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey });";
  if (!MEMBERS.includes(pin)) { console.error("PIN MOVED: members.js delegation line not found; the control cannot run."); process.exit(1); }
  const mutated = MEMBERS.replace(pin,
    'const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;\n  return transportStripeFetch(path, { method, body, stripeAccount, idempotencyKey, keyOverride: stripeSecret });');
  const results = checkMembersDelegation(mutated);
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (localenv) - a restored local env-key read was flagged by the delegation assertions."
    : "❌ NEGATIVE CONTROL FAILED (localenv) - the helper went back to choosing its own key and every assertion still passed.");
  process.exit(caught ? 0 : 1);
}

if (MUTATE === "gate409") {
  // Make the gate state "not connected" when the clients read THREW - the exact
  // collapse house rule 10 exists to stop.
  const pin = 'return res.status(503).json({ error: "could not verify billing setup, try again" });';
  if (!WEB.includes(pin)) { console.error("PIN MOVED: website/checkout.js 503 gate line not found; the control cannot run."); process.exit(1); }
  const mutated = WEB.replace(pin, 'return res.status(409).json({ error: "academy is not connected to Stripe" });');
  const results = checkGateThreeOutcome(mutated, "website/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });');
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (gate409) - a gate answering 409 not-connected on a THROWN read was flagged by the three-outcome assertions."
    : "❌ NEGATIVE CONTROL FAILED (gate409) - an outage now reads as 'not connected' and nothing here noticed.");
  process.exit(caught ? 0 : 1);
}

if (MUTATE === "pubcatch") {
  // Strip the fallback off ONE return site - publishableFor becomes a hard
  // failure point again, on a response that fires after the sub was created.
  if (!WEB.includes(PUB_WITH_CATCH)) { console.error("PIN MOVED: website/checkout.js publishableFor+catch not found; the control cannot run."); process.exit(1); }
  const mutated = WEB.replace(PUB_WITH_CATCH, "publishableFor(stripeAccount)");
  const results = checkOverridesAndPublishable(mutated, ONB, CAMP);
  const caught = results.some((r) => !r.ok);
  console.log(caught
    ? "NEGATIVE CONTROL PASSED (pubcatch) - an unguarded publishableFor return site was flagged by the fallback assertions."
    : "❌ NEGATIVE CONTROL FAILED (pubcatch) - a post-payment return site can 500 on a resolver hiccup and nothing here noticed.");
  process.exit(caught ? 0 : 1);
}

// ── the three controls that keep the RE-STATED precedence pins honest ────────
// Each breaks the INVARIANT (not the spelling) and the re-aimed assertions must
// fail and PRINT. A re-stated pin that cannot catch the thing it names is worse
// than the pin it replaced.
const OVERRIDE_PIN = "keyOverride: onboardingKeyOverride(),";

if (MUTATE === "overridedropped") {
  // The override stops being passed at all: the resolver's own envelope wins and
  // the test sandbox quietly bills on the live/direct key.
  const sources = {};
  for (const rel of ["website/checkout.js", "onboarding/checkout.js", "website/camp-checkout.js"]) {
    const src = read(rel);
    if (!src.includes(OVERRIDE_PIN)) { console.error(`PIN MOVED: ${rel} no longer contains "${OVERRIDE_PIN}"; the control cannot run.`); process.exit(1); }
    sources[rel] = src.replace(OVERRIDE_PIN, "keyOverride: undefined, // (control overridedropped) the override is gone");
  }
  const results = await checkOnboardingPrecedence({ sources });
  const caught = results.filter((r) => !r.ok);
  console.log(caught.length
    ? `NEGATIVE CONTROL PASSED (overridedropped) - the onboarding key losing first precedence was caught by ${caught.length} executed assertion(s):\n   - ${caught.slice(0, 6).map((r) => r.msg).join("\n   - ")}`
    : "❌ NEGATIVE CONTROL FAILED (overridedropped) - the test-sandbox override is dead and every assertion still passed. Those pins are decorative.");
  process.exit(caught.length ? 0 : 1);
}

if (MUTATE === "overrideindirect") {
  // THE FAILURE A SOURCE PIN CANNOT SEE. Every call site still reads
  // `onboardingKeyOverride()`; the helper behind it is repointed at a different
  // env var. The old spelling-pin style would have been green here.
  const pin = "const raw = process.env.ONBOARDING_STRIPE_SECRET_KEY;";
  if (!ONBKEY.includes(pin)) { console.error(`PIN MOVED: _stripe-onboarding-key.js no longer contains "${pin}"; the control cannot run.`); process.exit(1); }
  const mutated = ONBKEY.replace(pin, "const raw = process.env.SOME_OTHER_STRIPE_KEY; // (control overrideindirect) repointed");
  const spec = writeTemp(".wave-onbkey-indirect.mjs", mutated);
  const results = [
    ...(await checkOnboardingPrecedence({ onbSpec: "./" + path.basename(spec), sources: {} })),
    ...checkParent(PARENT, mutated),
  ];
  const caught = results.filter((r) => !r.ok);
  console.log(caught.length
    ? `NEGATIVE CONTROL PASSED (overrideindirect) - a helper repointed at another env var was caught by ${caught.length} assertion(s), so the pins follow the indirection instead of stopping at it:\n   - ${caught.slice(0, 6).map((r) => r.msg).join("\n   - ")}`
    : "❌ NEGATIVE CONTROL FAILED (overrideindirect) - the override reads a different variable now and every assertion still passed. The pins stop at the call.");
  process.exit(caught.length ? 0 : 1);
}

if (MUTATE === "modesplit") {
  // Defect B restored: the mode judged from a RAW read, the credential from the
  // normalized one. This is what "isTestMode is untouched" would have allowed.
  const pin = 'return onboardingStripeKey().startsWith("sk_test");';
  if (!ONBKEY.includes(pin)) { console.error(`PIN MOVED: _stripe-onboarding-key.js no longer contains "${pin}"; the control cannot run.`); process.exit(1); }
  const mutated = ONBKEY.replace(pin, 'return String(process.env.ONBOARDING_STRIPE_SECRET_KEY || "").startsWith("sk_test"); // (control modesplit) raw again');
  const spec = writeTemp(".wave-onbkey-modesplit.mjs", mutated);
  const results = [
    ...(await checkOnboardingPrecedence({ onbSpec: "./" + path.basename(spec), sources: {} })),
    ...checkParent(PARENT, mutated),
  ];
  const caught = results.filter((r) => !r.ok);
  console.log(caught.length
    ? `NEGATIVE CONTROL PASSED (modesplit) - a mode check reading a different value than the credential was caught by ${caught.length} assertion(s):\n   - ${caught.slice(0, 6).map((r) => r.msg).join("\n   - ")}`
    : "❌ NEGATIVE CONTROL FAILED (modesplit) - the mode and the credential can disagree again and every assertion still passed.");
  process.exit(caught.length ? 0 : 1);
}

if (MUTATE === "credalias") {
  // THE ATTACKER'S DRIFTING CREDENTIAL ALIAS, verbatim in shape: a whitespace
  // override silently becomes "no override", the transport falls through to the
  // platform key, and an intended test sandbox charges live money. Both suites
  // were green against this before the credential got the same no-alias rule as
  // the mode check.
  const pin = 'import { onboardingKeyOverride } from "../_stripe-onboarding-key.js";';
  if (!PARENT.includes(pin)) { console.error("PIN MOVED: parent/_stripe.ts onboardingKeyOverride import not found; the control cannot run."); process.exit(1); }
  const mutated = PARENT.replace(pin, [
    'import { onboardingKeyOverride as onboardingKeyOverrideUntyped } from "../_stripe-onboarding-key.js";',
    "const onboardingKeyOverride = ((): string | undefined => {",
    "  const v = (onboardingKeyOverrideUntyped as () => string | undefined)();",
    "  return v && v.trim() === v ? v : undefined;   // MUTATED: whitespace -> platform key",
    "}) as () => string | undefined;",
  ].join("\n"));
  const results = checkParent(mutated, ONBKEY);
  const caught = results.filter((r) => !r.ok);
  console.log(caught.length
    ? `NEGATIVE CONTROL PASSED (credalias) - a drifting credential alias that falls through to the platform key was caught by ${caught.length} assertion(s):\n   - ${caught.slice(0, 6).map((r) => r.msg).join("\n   - ")}`
    : "\u274c NEGATIVE CONTROL FAILED (credalias) - the parent app can fall through to the platform key on a whitespace override and every pin still passed.");
  process.exit(caught.length ? 0 : 1);
}

if (MUTATE === "modeguard") {
  // THE ATTACKER'S DEFEAT, verbatim: an added early return restores the drift
  // while leaving every substring pin green. Only the structural body pin sees it.
  // THE ALIAS DEFEAT: put isTestMode back as a wrapper whose body is still
  // EXACTLY one return, and hide the drift in a local alias. The old body pin
  // passed this; only the re-export pin sees it.
  const pin = 'export { isOnboardingTestMode as isTestMode } from "../_stripe-onboarding-key.js";';
  if (!PARENT.includes(pin)) { console.error("PIN MOVED: parent/_stripe.ts isTestMode re-export not found; the control cannot run."); process.exit(1); }
  const mutated = PARENT.replace(pin, [
    'import { isOnboardingTestMode as rawMode } from "../_stripe-onboarding-key.js";',
    'const isOnboardingTestMode = () => rawMode() && stripeKey() === (stripeKey() || "").trim();',
    "export function isTestMode(): boolean {",
    "  return isOnboardingTestMode();",
    "}",
  ].join("\n"));
  const results = checkParent(mutated, ONBKEY);
  const caught = results.filter((r) => !r.ok);
  console.log(caught.length
    ? `NEGATIVE CONTROL PASSED (modeguard) - the drift hidden in a LOCAL ALIAS under an untouched one-line body was caught by ${caught.length} assertion(s), which a substring pin could not have seen:\n   - ${caught.slice(0, 6).map((r) => r.msg).join("\n   - ")}`
    : "\u274c NEGATIVE CONTROL FAILED (modeguard) - the drift moved into the alias and every pin still passed. A body pin is not structure enough.");
  process.exit(caught.length ? 0 : 1);
}

if (MUTATE) {
  console.error(`Unknown MUTATE="${MUTATE}". Known controls: localenv, gate409, pubcatch, overridedropped, overrideindirect, modesplit, modeguard, credalias`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// The real run
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. delegation (members.js, the string-body representative) ──");
report(checkMembersDelegation(MEMBERS));

console.log("\n── 2. ONBOARDING first precedence, EXECUTED against the real transport ──");
report(await checkOnboardingPrecedence());

console.log("\n── 5. publishableFor at the return sites ──");
report(checkOverridesAndPublishable());

console.log("\n── 3. parent/_stripe.ts error contract + untouched trio ──");
report(checkParent(PARENT));

console.log("\n── 4. money gates: three outcomes, could-not-ask is 503 ──");
report(checkGateThreeOutcome(WEB, "website/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });'));
report(checkGateThreeOutcome(ONB, "onboarding/checkout.js", 'return res.status(409).json({ error: "academy is not connected to Stripe" });'));
report(checkGateThreeOutcome(MEMBERS, "members.js", "Stripe not connected for this academy. Click 'Connect Stripe' on the Members tab first."));
report(checkGateThreeOutcome(read("members/enroll.js"), "members/enroll.js", `return res.status(409).json({ error: "Stripe isn't connected for this academy - connect it on the Members tab first" });`));
report(checkGateThreeOutcome(read("offers/create-price.js"), "offers/create-price.js", 'return res.status(409).json({ error: "academy not connected to Stripe" });'));
report(checkGateThreeOutcome(read("offers/match-prices.js"), "offers/match-prices.js", 'return res.status(409).json({ error: "academy not connected to Stripe" });'));

console.log("\n── 6. kpis-v15 payouts degrade when the key cannot see them ──");
report(checkKpisPayouts(KPIS));

console.log("\n── sweep: every hollowed file routes through the transport ──");
report(checkSweep());

console.log("\n── 7. executable: the transport seam itself (fetch stubbed) ──");
report(await checkTransportExecutable());

console.log(fail ? `\n❌ ${pass} passed, ${fail} failed.` : `\n✅ ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
