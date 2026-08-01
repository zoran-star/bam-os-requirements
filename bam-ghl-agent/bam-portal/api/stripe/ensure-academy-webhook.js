import { withSentryApiRoute } from "../_sentry.js";
import crypto from "node:crypto";
import { stripeFetch } from "../_stripe-transport.js";
import { encryptSecret } from "../_stripe-direct-crypto.js";
import { REQUIRED_EVENTS } from "./ensure-webhook-events.js";

// Vercel Serverless Function - register/repair a DIRECT-KEY academy's Stripe
// webhook endpoint (STAFF ONLY handler; ensureAcademyWebhook() is also called
// from api/stripe/direct-key.js right after a key save).
//
// WHY PER-ACADEMY ENDPOINTS EXIST AT ALL. Connect academies need none: Stripe
// delivers their events to the single platform endpoint. A direct-key academy's
// account has no Connect link to us, so its events can only arrive at an
// endpoint created ON ITS OWN ACCOUNT, signed with ITS OWN whsec_ secret. The
// endpoint URL carries an opaque routing token (?t=<token>) that is how
// api/stripe/webhook.js knows which academy - and which signing secret - an
// incoming event belongs to.
//
// IDEMPOTENT AND CRASH-SAFE, in this order, because the endpoint's signing
// secret is returned by Stripe EXACTLY ONCE at creation:
//   1. the row (with a fresh token) is written BEFORE the endpoint is created,
//   2. the secret is encrypted the moment it arrives,
//   3. a row holding a token but no endpoint_id is a crashed step 2: the orphan
//      endpoints carrying our token are DELETED (their secret is unrecoverable)
//      and a fresh one is created.

// The sole definition. Connect-plumbing events make no sense on an account that
// has no Connect application to deauthorize, and subscribing an academy key's
// endpoint to them would fail or sit dead forever.
export const CONNECT_ONLY_EVENTS = ["account.application.deauthorized"];

// What a direct academy's endpoint listens to: everything the portal handles,
// minus the Connect-only plumbing. Derived, never hand-listed, so a new handler
// added to REQUIRED_EVENTS reaches direct academies on the next ensure run.
export const ACADEMY_EVENTS = REQUIRED_EVENTS.filter((ev) => !CONNECT_ONLY_EVENTS.includes(ev));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name&limit=1`);
  }
  if (!Array.isArray(staff) || !staff[0]) throw Object.assign(new Error("BAM staff only"), { status: 403 });
  return { user, staff: staff[0] };
}

const nowIso = () => new Date().toISOString();
const newToken = () => crypto.randomBytes(16).toString("hex");

function endpointUrl(token) {
  return `${process.env.PORTAL_BASE_URL}/api/stripe/webhook?t=${token}`;
}

function isResourceMissing(e) {
  return !!e && (
    e.stripeStatus === 404 ||
    (e.stripeResponse && e.stripeResponse.error && e.stripeResponse.error.code === "resource_missing")
  );
}

// Create the endpoint on the ACADEMY account. Every Stripe call in this file
// goes through api/_stripe-transport.js with the academy's stripeAccount - the
// resolver routes to their key, and this file never sees it.
async function createEndpoint(stripeAccount, token) {
  const body = { url: endpointUrl(token) };
  ACADEMY_EVENTS.forEach((ev, i) => { body[`enabled_events[${i}]`] = ev; });
  return stripeFetch("/webhook_endpoints", { method: "POST", body, stripeAccount });
}

// Stamp endpoint_id + the once-only signing secret onto the row. The secret is
// encrypted IMMEDIATELY - it exists in plaintext only inside this call frame.
async function stampEndpoint(clientId, endpoint) {
  await sb(`stripe_academy_webhooks?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      endpoint_id: endpoint.id,
      secret_enc: encryptSecret(endpoint.secret),
      enabled_events: ACADEMY_EVENTS,
      registered_at: nowIso(),
      last_verified_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
}

export async function ensureAcademyWebhook({ clientId }) {
  if (!clientId) throw Object.assign(new Error("clientId required"), { status: 400 });

  const directRows = await sb(
    `client_stripe_direct?client_id=eq.${encodeURIComponent(clientId)}` +
    `&select=client_id,status,stripe_account_id&limit=1`
  );
  const direct = Array.isArray(directRows) && directRows[0] ? directRows[0] : null;
  if (!direct || direct.status !== "active") {
    return { ok: true, skipped: "not a direct-key academy" };
  }

  // Preview-deploy guard: an endpoint registered against a preview URL would
  // silently swallow a LIVE academy's events. Refuse loudly instead of guessing.
  if (!process.env.PORTAL_BASE_URL) {
    throw Object.assign(
      new Error("PORTAL_BASE_URL is not set - refusing to register a webhook endpoint against an unknown base URL"),
      { status: 500 }
    );
  }

  const stripeAccount = direct.stripe_account_id;
  const rows = await sb(
    `stripe_academy_webhooks?client_id=eq.${encodeURIComponent(clientId)}` +
    `&select=id,client_id,token,endpoint_id,secret_enc,enabled_events,registered_at,last_verified_at&limit=1`
  );
  let row = Array.isArray(rows) && rows[0] ? rows[0] : null;

  // ── no row: row first (crash-safe), then endpoint, then secret ─────────────
  if (!row) {
    const token = newToken();
    await sb(`stripe_academy_webhooks`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ client_id: clientId, token }]),
    });
    const endpoint = await createEndpoint(stripeAccount, token);
    await stampEndpoint(clientId, endpoint);
    return { ok: true, action: "created", endpoint_id: endpoint.id, enabled_events: ACADEMY_EVENTS };
  }

  // ── row with an endpoint: verify it still exists, still ours, still full ──
  if (row.endpoint_id) {
    let endpoint = null;
    try {
      endpoint = await stripeFetch(`/webhook_endpoints/${encodeURIComponent(row.endpoint_id)}`, { stripeAccount });
    } catch (e) {
      if (!isResourceMissing(e)) throw e;
    }

    if (!endpoint) {
      // Deleted on Stripe's side. The old secret and token are dead, which is
      // correct: mint a NEW token so nothing signed for the old endpoint can
      // ever route again, and create fresh.
      const token = newToken();
      await sb(`stripe_academy_webhooks?client_id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ token, endpoint_id: null, secret_enc: null, updated_at: nowIso() }),
      });
      const created = await createEndpoint(stripeAccount, token);
      await stampEndpoint(clientId, created);
      return { ok: true, action: "recreated", endpoint_id: created.id, enabled_events: ACADEMY_EVENTS };
    }

    // Present but pointing somewhere that is not our token (edited by hand, or
    // a stale registration): its secret pairs with a URL we do not trust, so
    // recreate under a fresh token and delete the stray.
    if (!String(endpoint.url || "").includes(row.token)) {
      try {
        await stripeFetch(`/webhook_endpoints/${encodeURIComponent(row.endpoint_id)}`, { method: "DELETE", stripeAccount });
      } catch (_) { /* best effort - it may already be gone */ }
      const token = newToken();
      await sb(`stripe_academy_webhooks?client_id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ token, endpoint_id: null, secret_enc: null, updated_at: nowIso() }),
      });
      const created = await createEndpoint(stripeAccount, token);
      await stampEndpoint(clientId, created);
      return { ok: true, action: "recreated", endpoint_id: created.id, enabled_events: ACADEMY_EVENTS };
    }

    // Ours. Union in any events added to the portal since registration.
    const current = Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events : [];
    const missing = current.includes("*") ? [] : ACADEMY_EVENTS.filter((ev) => !current.includes(ev));
    if (missing.length) {
      const union = [...current, ...missing];
      const body = {};
      union.forEach((ev, i) => { body[`enabled_events[${i}]`] = ev; });
      await stripeFetch(`/webhook_endpoints/${encodeURIComponent(row.endpoint_id)}`, { method: "POST", body, stripeAccount });
    }
    await sb(`stripe_academy_webhooks?client_id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ...(missing.length ? { enabled_events: current.includes("*") ? ["*"] : [...current, ...missing] } : {}),
        last_verified_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    return { ok: true, action: "verified", endpoint_id: row.endpoint_id, added: missing };
  }

  // ── row with a token but no endpoint_id: a crash between INSERT and create ─
  // An endpoint may exist on the academy account whose secret we never stored
  // and can never recover. Find anything carrying our token, delete it, create
  // fresh under the same (already persisted, still unique) token.
  const list = await stripeFetch(`/webhook_endpoints?limit=100`, { stripeAccount });
  const orphans = (Array.isArray(list.data) ? list.data : []).filter((e) => String(e.url || "").includes(row.token));
  for (const orphan of orphans) {
    await stripeFetch(`/webhook_endpoints/${encodeURIComponent(orphan.id)}`, { method: "DELETE", stripeAccount });
  }
  const endpoint = await createEndpoint(stripeAccount, row.token);
  await stampEndpoint(clientId, endpoint);
  return { ok: true, action: "recovered", endpoint_id: endpoint.id, deleted_orphans: orphans.length, enabled_events: ACADEMY_EVENTS };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    await resolveStaff(req);
    const { client_id } = req.body || {};
    const result = await ensureAcademyWebhook({ clientId: client_id });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
