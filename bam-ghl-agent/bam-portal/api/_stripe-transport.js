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
// any response. api/_stripe-transport.test.mjs asserts that with a leak probe.

import { decryptSecret } from "./_stripe-direct-crypto.js";
import { readStripeAccount, readStripeAccountViaKey } from "./stripe/_requirements.js";

const STRIPE_API = "https://api.stripe.com/v1";

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
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseServiceKey(),
      Authorization: `Bearer ${supabaseServiceKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
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
// path for every existing academy. api/stripe/direct-key.js busts this the
// moment a key is saved or disabled so routing flips without waiting a minute.
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

  const headers = { Authorization: `Bearer ${t.bearer}` };
  const encoded = encodeBody(body);
  if (encoded != null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (t.accountHeader) headers["Stripe-Account"] = t.accountHeader;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body: encoded });
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
    // Same shape readStripeAccount() returns for a missing account id.
    return readStripeAccount(null, platformKey());
  }

  // active OR invalid: an invalid row must still be probed, or it could never
  // self-heal. 'disabled' means staff turned the key off - that academy is a
  // Connect academy again until further notice.
  const rows = await sb(
    `client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}` +
    `&status=in.(active,invalid)&select=${DIRECT_SELECT}&limit=1`
  );
  const direct = Array.isArray(rows) && rows[0] ? rows[0] : null;

  if (!direct) {
    return readStripeAccount(client.stripe_connect_account_id, platformKey());
  }

  const status = await readStripeAccountViaKey(decryptSecret(direct.secret_key_enc));
  const nowIso = new Date().toISOString();
  if (status.outcome === "unreachable" && status.credential_problem) {
    await sb(`client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "invalid", updated_at: nowIso }),
    });
    bustTransportCache();
  } else if (status.outcome === "ready" || status.outcome === "not_ready") {
    const patch = { key_last_verified_at: nowIso, updated_at: nowIso };
    if (direct.status === "invalid") patch.status = "active"; // self-heal: the key answered
    await sb(`client_stripe_direct?client_id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
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
