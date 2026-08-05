// THE ONE SEAM between the portal and Stripe's API.
//
// ONE member-management system, TWO transports:
//
//   connect   the platform key + a Stripe-Account header, today's behavior for
//             every OAuth-connected academy.
//   direct    the academy's OWN restricted key (rk_live_..., staff-entered,
//             encrypted at rest in client_stripe_direct), for academies whose
//             Stripe is platform-locked (e.g. CoachIQ) and cannot do Connect
//             OAuth. Their key IS the account, so no Stripe-Account header.
//
// This module is the ONLY place that knows which transport an account uses.
// Callers keep passing `stripeAccount: "acct_..."` exactly as they always have;
// the resolver reverse-looks-up client_stripe_direct by account id and routes.
// NOTHING DOWNSTREAM MAY EVER ASK which transport it got. If a caller needs a
// per-transport fact (publishable key, capabilities), it asks THIS module.
//
// The decrypted key must never appear in any error property, any log line, or
// any response. api/_stripe-transport.test.mjs asserts that with a leak probe
// that covers BOTH kinds of error: the ones this module CONSTRUCTS and the ones
// the RUNTIME throws. That second half is not decoration - it is where the leak
// actually lived. An earlier version of this comment claimed the probe covered
// it while the probe only ever inspected constructed errors, and a key with an
// embedded line break went straight out to the browser underneath the claim.

import { decryptSecret } from "./_stripe-direct-crypto.js";
import { readStripeAccount, readStripeAccountViaKey } from "./stripe/_requirements.js";

const STRIPE_API = "https://api.stripe.com/v1";

// ── credentials are header values, and header values are printable ASCII ─────
//
// THE FAILURE THIS EXISTS FOR. A restricted key copied out of a wrapped email,
// a Slack code block or a PDF arrives with a line break IN THE MIDDLE of it.
// .trim() cannot see that - trim only touches the ends - so the key passes
// every rk_live_ shape check and reaches fetch, where undici refuses it with
//
//   TypeError: Headers.append: "Bearer rk_live_AAAA\nBBBB" is an invalid header value.
//
// That TypeError QUOTES THE WHOLE KEY and carries no .status, so any caller
// doing `res.status(e.status || 500).json({ error: e.message })` hands a LIVE
// credential back to the browser. The key is malformed but trivially repaired
// by deleting the break, and the operator's next move on a confusing error is
// to paste it into Slack or a ticket.
//
// The fix is refusal, not redaction. Scrubbing the message for rk_live_[A-Za-z0-9]*
// does NOT work: the break splits the key, the pattern stops at the break, and
// the tail stays on screen. So no key that cannot be a header value is ever
// handed to fetch, and the refusal carries no key material at all.
const HEADER_UNSAFE = /[^\x20-\x7E]/;

const NON_PRINTABLE_KEY_MESSAGE =
  "the API key contains a line break or non-printable character - re-copy it without the break";

// ── TRIM FIRST, THEN REFUSE ──────────────────────────────────────────────────
//
// The two cases look identical to a naive printable-ASCII test and are not the
// same thing at all:
//
//   TRAILING/LEADING whitespace is a PASTE ARTIFACT - how the value happened to
//   be stored or copied. `echo` instead of `printf` into a secret store leaves a
//   \n on the end; a copy out of a text field brings a space. The credential
//   itself is intact. Refusing it turns a cosmetic artifact into a hard failure
//   and refuses OUR OWN env config (production's SUPABASE_SERVICE_KEY carries
//   exactly this trailing newline today). It is trimmed away and USED.
//
//   An EMBEDDED break - a non-printable character still there AFTER the trim -
//   is a BROKEN KEY, and it is the leak vector this whole guard exists for: it
//   reaches fetch, undici refuses the header with a TypeError QUOTING THE WHOLE
//   KEY and no .status, and a route's `e.status || 500` hands a live credential
//   to the browser. That is still refused, and the refusal carries no key
//   material at all.
//
// .trim() already strips spaces, \t, \r and \n at BOTH ends - and only at the
// ends, which is precisely the line between the two cases.
function normalizeKey(v) {
  return String(v ?? "").trim();
}

// A shape refusal is a DELIBERATE refusal, so it carries .status - and it fires
// before fetch is called, therefore before anything is written. That ordering is
// load-bearing: .status is this codebase's signal to a caller (the CLI included)
// that a save was refused and NOTHING happened.
//
// RETURNS THE NORMALIZED KEY, and every call site must use what it returns -
// otherwise the trimmed value is checked and the untrimmed one is sent, which is
// the same bug in a nicer costume.
function assertHeaderSafeKey(key) {
  // A MISSING key is not this check's business. An unconfigured env var must
  // keep today's behavior (Stripe answers 401), or an empty STRIPE_SECRET_KEY
  // would start telling people to re-copy a line break. Handed back untouched so
  // an absent key stays absent rather than becoming "".
  if (key == null || key === "") return key;
  const normalized = normalizeKey(key);
  if (HEADER_UNSAFE.test(normalized)) {
    throw Object.assign(new Error(NON_PRINTABLE_KEY_MESSAGE), { status: 400 });
  }
  return normalized;
}

// ── belt as well as braces: nothing the runtime wrote is ever passed on ──────
//
// The shape check above closes the leak we found. This closes the shape of leak
// we have not found yet. Node's fetch errors are REQUEST MATERIAL: the invalid
// header TypeError quotes the Authorization header verbatim, a DNS failure
// names the host, and a future undici version can put anything it likes in
// there. So the message handed onward is always one we wrote. What survives is
// the error's NAME and, when it is a plain symbolic constant, its cause code -
// enough to tell a timeout from a DNS failure, carrying nothing anyone typed.
const SAFE_CAUSE_CODE = /^[A-Z][A-Z0-9_]*$/;

// NO .status ON PURPOSE, and this is not an oversight to be tidied up later.
// A fetch can throw AFTER a write has already landed. Stamping a status here
// would tell saveDirectKey's callers "refused, nothing happened" at the exact
// moment a live credential had just been stored. An unmapped 500 is the honest
// answer; a reassuring 4xx is the dangerous one.
function sanitizeFetchError(e, what) {
  const name = e && e.name ? String(e.name) : "Error";
  const rawCode = String((e && e.cause && e.cause.code) || (e && e.code) || "");
  const code = SAFE_CAUSE_CODE.test(rawCode) ? rawCode : "";
  const err = new Error(`${what} request failed (${name}${code ? `: ${code}` : ""})`);
  err.transportFailure = true;
  err.causeName = name;
  if (code) err.causeCode = code;
  return err;
}

async function safeFetch(url, init, what) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw sanitizeFetchError(e, what);
  }
}

// The three-outcome shape from api/stripe/_requirements.js, built here for the
// cases that never get to ASK Stripe (a credential we refuse to put in a
// header). Mirrored rather than imported because _requirements.js keeps it
// private - api/_stripe-transport.test.mjs pins this object's key set against a
// real readStripeAccountViaKey() result so the two cannot drift apart quietly.
function unreachableStatus(error, extra = {}) {
  return {
    outcome: "unreachable",
    ready: false,
    reachable: false,
    error,
    charges_enabled: null,
    details_submitted: null,
    disabled_reason: null,
    needs: [],
    reviewing: [],
    problems: [],
    ...extra,
  };
}

// Env is read lazily (per call, not at import) so the module is import-clean:
// plain `node` can import it with env stubs set before OR after the import.
function platformKey() {
  return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
}
function supabaseUrl() {
  return process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
}
function supabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}

async function sb(path, init = {}) {
  // Same treatment as the Stripe bearer, trim first and all: this secret comes
  // from env rather than from a paste, and env is exactly where the trailing
  // newline lives (`echo` instead of `printf` into a secret store). That
  // newline is an artifact of how the value was stored, not a broken key, so it
  // is trimmed off and the key is used. A break still inside it after the trim
  // would be quoted by the runtime's invalid-header TypeError just as happily
  // as a Stripe key, so that is still refused.
  //
  // STATUSLESS on purpose, unlike the Stripe key refusal: sb() is called both
  // before and after writes, so a .status here could one day tell a caller
  // "nothing happened" after a write landed. A broken service key is a server
  // misconfiguration, and 500 is the truthful answer.
  const rawServiceKey = supabaseServiceKey();
  const serviceKey = rawServiceKey ? normalizeKey(rawServiceKey) : rawServiceKey;
  if (serviceKey && HEADER_UNSAFE.test(serviceKey)) {
    throw new Error("the Supabase service key contains a line break or non-printable character - re-set it without the break");
  }
  const res = await safeFetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  }, "Supabase");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ── the direct-row cache ─────────────────────────────────────────────────────
// One reverse lookup per account id per minute, not per Stripe call. Negative
// results (no direct row = Connect academy) are cached too - that is the hot
// path for every existing academy. api/stripe/direct-key.js busts this on key
// save/disable, but the bust only reaches THIS lambda instance - other warm
// instances keep their entry until the TTL runs out, so a routing flip is
// guaranteed everywhere only after 60s. Anything needing a faster, global flip
// must not rely on bustTransportCache().
const CACHE_TTL_MS = 60_000;
const directRowCache = new Map(); // stripe_account_id -> { row: object|null, at: ms }

export function bustTransportCache() {
  directRowCache.clear();
}

const DIRECT_SELECT = "client_id,status,secret_key_enc,secret_key_last4,publishable_key,stripe_account_id,capabilities,key_last_verified_at";

async function directRowByAccount(stripeAccount) {
  const hit = directRowCache.get(stripeAccount);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const rows = await sb(
    `client_stripe_direct?stripe_account_id=eq.${encodeURIComponent(stripeAccount)}` +
    `&status=eq.active&select=${DIRECT_SELECT}&limit=1`
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  directRowCache.set(stripeAccount, { row, at: Date.now() });
  return row;
}

// ── transport resolution ─────────────────────────────────────────────────────
// Exactly one of three envelopes, decided here and nowhere else:
//   keyOverride           the caller brought its own key (the onboarding/checkout
//                         ONBOARDING_STRIPE_SECRET_KEY path, and direct-key.js's
//                         probe of a not-yet-saved key). Stripe-Account header
//                         behavior stays exactly as the caller intended.
//   stripeAccount null    PLATFORM. No header. Byte-identical to today - this is
//                         the test-mode path and must never route to an academy key.
//   stripeAccount acct_   direct row -> the academy's decrypted key, NO header;
//                         no row -> platform key + Stripe-Account header (today's
//                         Connect behavior).
async function resolveTransport(stripeAccount, keyOverride) {
  if (keyOverride) {
    return {
      bearer: keyOverride,
      accountHeader: stripeAccount || null,
      label: stripeAccount ? `connect:${stripeAccount}` : "platform",
    };
  }
  if (!stripeAccount) return { bearer: platformKey(), accountHeader: null, label: "platform" };
  const row = await directRowByAccount(stripeAccount);
  if (row) {
    return { bearer: decryptSecret(row.secret_key_enc), accountHeader: null, label: `direct:${stripeAccount}` };
  }
  return { bearer: platformKey(), accountHeader: stripeAccount, label: `connect:${stripeAccount}` };
}

// Body encoding, matching the existing helpers byte for byte:
//   object  -> URLSearchParams over flat string keys ("items[0][price]" style),
//              null/undefined values dropped, everything else String()ed
//   string  -> passed through AS-IS (api/members.js pre-encodes some bodies)
//   null    -> no body at all
function encodeBody(body) {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return new URLSearchParams(
    Object.entries(body).reduce((acc, [k, v]) => {
      if (v !== undefined && v !== null) acc[k] = String(v);
      return acc;
    }, {})
  ).toString();
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export async function stripeFetch(path, { method = "GET", body, stripeAccount, idempotencyKey, keyOverride } = {}) {
  const t = await resolveTransport(stripeAccount, keyOverride);

  // BEFORE the header is built, and therefore before the runtime ever sees the
  // key. Whichever envelope the resolver picked - a pasted keyOverride, a
  // decrypted academy key, the platform key out of env - it is about to become
  // an Authorization header, so it must be able to be one.
  // USE what it returns: the trimmed key is the one that becomes the header.
  const bearer = assertHeaderSafeKey(t.bearer);

  const headers = { Authorization: `Bearer ${bearer}` };
  const encoded = encodeBody(body);
  if (encoded != null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (t.accountHeader) headers["Stripe-Account"] = t.accountHeader;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await safeFetch(`${STRIPE_API}${path}`, { method, headers, body: encoded }, "Stripe");
  const text = await res.text();
  const json = text ? safeJsonParse(text) : {};
  if (!res.ok) {
    // The SUPERSET of both existing error shapes, so every current consumer can
    // read what it already reads:
    //   message / stripeStatus / stripeResponse   (api/members.js shape)
    //   message / stripeStatus / responseBody     (api/parent/_stripe.ts shape)
    // plus transportLabel for diagnostics. The bearer key appears in NONE of it.
    const err = new Error((json && json.error && json.error.message) || `Stripe ${res.status}`);
    err.stripeStatus = res.status;
    err.stripeResponse = json;
    err.responseBody = json;
    err.transportLabel = t.label;
    throw err;
  }
  return json;
}

// ── account health, transport-aware ──────────────────────────────────────────
// The three-outcome contract from api/stripe/_requirements.js (ready / not_ready
// / unreachable), answered over whichever transport the academy actually uses.
// Side effects, direct rows only:
//   unreachable + credential_problem  -> status='invalid' (the key is dead, not
//                                        the network; routing falls back to
//                                        Connect until staff re-enters a key)
//   ready / not_ready                 -> key_last_verified_at stamped, and an
//                                        'invalid' row self-heals to 'active'
//                                        (the key answered, so it works again).
export async function readAccountHealth(clientRowOrId) {
  let client = clientRowOrId;
  if (typeof clientRowOrId === "string") {
    const rows = await sb(
      `clients?id=eq.${encodeURIComponent(clientRowOrId)}` +
      `&select=id,stripe_connect_account_id,stripe_connect_status&limit=1`
    );
    client = Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  if (!client || !client.id) {
    // Same shape readStripeAccount() returns for a missing account id - but the
    // key is normalized and REFUSED HERE, by this branch, like the one below.
    //
    // NOT BECAUSE THIS PATH LEAKS TODAY. It does not: readStripeAccount checks
    // `if (!acctId)` before it ever touches the secret, and the acctId here is
    // the literal null. That is the whole reason it is safe - a guarantee that
    // lives in another file, in the order of two statements, for a caller that
    // cannot see it. Swap those two lines over there and this hands an unusable
    // key to fetch, whose TypeError quotes the header verbatim into
    // `could not reach Stripe: ${e.message}` - a RETURNED string, which
    // api/stripe/direct-key.js's status action serializes into the response
    // body without ever touching a catch block.
    //
    // SAY ONLY WHAT IS ENFORCED, because a claim wider than its test is the
    // exact shape that let the original leak read as safe. What is enforced and
    // asserted here is the REFUSAL: an embedded break in the platform key stops
    // at this branch with a message carrying no key material, and a paste
    // artifact is trimmed and still answers "no connected account id" rather
    // than a refusal. What is NOT enforceable here is the hand-over half: with
    // acctId hardcoded null, readStripeAccount returns before it reads the
    // secret, so passing `pk` or `rawPk` is behaviourally identical and NO test
    // can tell them apart. Nothing on this branch proves the normalized value is
    // the one that travels, because on this branch nothing travels. If this
    // return ever gains a real account id, that half needs an assertion of its
    // own before it can be trusted - see the Connect branch below, where the
    // key does travel and the outgoing header is pinned exactly.
    const rawPk = platformKey();
    const pk = rawPk ? normalizeKey(rawPk) : rawPk;
    if (pk && HEADER_UNSAFE.test(pk)) {
      // OUR configuration, not an academy's credential - so no
      // credential_problem, same as the Connect branch below.
      return unreachableStatus("the configured Stripe platform key contains a line break or non-printable character - re-set it without the break");
    }
    return readStripeAccount(null, pk);
  }

  // active OR invalid: an invalid row must still be probed, or it could never
  // self-heal. 'disabled' means staff turned the key off - that academy is a
  // Connect academy again until further notice.
  const rows = await sb(
    `client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}` +
    `&status=in.(active,invalid)&select=${DIRECT_SELECT}&limit=1`
  );
  const direct = Array.isArray(rows) && rows[0] ? rows[0] : null;

  // THE OTHER MOUTH OF THE SAME LEAK. readStripeAccount / readStripeAccountViaKey
  // catch a fetch failure into `could not reach Stripe: ${e.message}` and RETURN
  // it - and api/stripe/direct-key.js's status action puts that string straight
  // into the JSON it sends the browser. So a key that cannot be a header value
  // would arrive in a response body by the return path rather than the throw
  // path, and no amount of care in a catch block upstream would stop it. Neither
  // key is handed over until it can be a header.
  if (!direct) {
    // Trim first here too: readStripeAccount builds its OWN Authorization
    // header out of what we hand it, so the normalized key has to be the one
    // that travels. A trailing newline on STRIPE_CONNECT_SECRET_KEY is our
    // storage artifact, not a broken platform key.
    const rawPk = platformKey();
    const pk = rawPk ? normalizeKey(rawPk) : rawPk;
    if (pk && HEADER_UNSAFE.test(pk)) {
      // OUR configuration is broken, not this academy's credential, so no
      // credential_problem - that flag is what flips a direct row to 'invalid'.
      return unreachableStatus("the configured Stripe platform key contains a line break or non-printable character - re-set it without the break");
    }
    return readStripeAccount(client.stripe_connect_account_id, pk);
  }

  // Trim first, then judge. A row stored with a trailing newline (written before
  // the save path trimmed, or pasted with one) holds a PERFECTLY GOOD key, so it
  // must read as whatever Stripe says it is - not as credential_problem, which
  // would flip a working academy's row to 'invalid' over a stray byte.
  const storedKey = normalizeKey(decryptSecret(direct.secret_key_enc));
  // A stored key with an EMBEDDED break can never answer for its account, which
  // is precisely what credential_problem means - so this takes the existing
  // 'invalid' side effect below and routing falls back to Connect until staff
  // re-enter it. In practice the save path can no longer store such a key
  // (stripeFetch refuses it during the probe); this is the belt for a row
  // written before that guard existed.
  const status = HEADER_UNSAFE.test(storedKey)
    ? unreachableStatus(
        "the stored key contains a line break or non-printable character and cannot be sent to Stripe - re-enter it without the break",
        { credential_problem: true }
      )
    : await readStripeAccountViaKey(storedKey);
  const nowIso = new Date().toISOString();
  // BOTH patches re-filter on status=in.(active,invalid). Without that, a health
  // read racing a staff disable would match on client_id alone and flip the row
  // back - silently re-arming a key staff just turned off. With the filter, a
  // row that became 'disabled' between our SELECT and this PATCH matches nothing.
  if (status.outcome === "unreachable" && status.credential_problem) {
    await sb(
      `client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}&status=in.(active,invalid)`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "invalid", updated_at: nowIso }),
      }
    );
    bustTransportCache();
  } else if (status.outcome === "ready" || status.outcome === "not_ready") {
    const patch = { key_last_verified_at: nowIso, updated_at: nowIso };
    if (direct.status === "invalid") patch.status = "active"; // self-heal: the key answered
    await sb(
      `client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}&status=in.(active,invalid)`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      }
    );
    if (patch.status) bustTransportCache();
  }
  return status;
}

// ── per-transport facts callers are allowed to ask THIS module for ───────────

// What the browser needs to mount Stripe.js/Elements. A direct academy's
// publishable key pairs with ITS account, so stripe_account is null (Stripe.js
// must NOT be told to act on behalf of an account it is already on). A Connect
// academy keeps the platform publishable key + the connected account id.
export async function publishableFor(stripeAccount) {
  if (stripeAccount) {
    const row = await directRowByAccount(stripeAccount);
    if (row) return { publishable_key: row.publishable_key || null, stripe_account: null };
  }
  return { publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, stripe_account: stripeAccount || null };
}

// The entry-time capability probe results for a direct account ({customers:
// true, payouts: false, ...}), null for Connect accounts (a Connect academy's
// platform key can do everything Connect allows, so there is nothing to store).
export async function getCapabilities(stripeAccount) {
  if (!stripeAccount) return null;
  const row = await directRowByAccount(stripeAccount);
  return row ? (row.capabilities || null) : null;
}
