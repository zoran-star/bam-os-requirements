// Shared GHL agency-token plumbing: load/refresh the agency (Company) token and
// mint per-sub-account Location tokens from it.
//
// BAM is the agency. It authorizes ONCE at company level; every academy's
// location token is minted from that agency token via /oauth/locationToken.
// Academies never do their own OAuth, so keeping the agency token healthy is
// what keeps all 30+ sub-accounts syncing.
//
// This lives here (not in agency-connect.js) so the hot path in _core.js can
// re-mint a token on demand without importing an HTTP handler. Nothing in this
// file may import _core.js - that would be a cycle.
//
// Why minting beats the refresh_token grant:
//   A location token's refresh_token is bound to the OAuth app that issued it.
//   If the agency app changes, or a single refresh attempt is lost, that
//   refresh_token is dead forever and the academy silently stops syncing.
//   Minting from the agency token always works and is not order-dependent.

const GHL_TOKEN_URL     = "https://services.leadconnectorhq.com/oauth/token";
const GHL_LOC_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/locationToken";
const V2_VERSION        = "2021-07-28";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Re-mint / refresh once a token is inside this window of expiring. Generous on
// purpose: the old 60s window gave exactly ONE chance per 24h cycle, so a single
// transient failure bricked the academy until a human intervened.
export const RENEW_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ── Alerting ──────────────────────────────────────────────────────────────
export async function slackAlert(text) {
  try {
    const token = process.env.SLACK_BOT_TOKEN, channel = process.env.FEEDBACK_SLACK_CHANNEL;
    if (!token || !channel) return;
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
  } catch (_) { /* best-effort */ }
}

// Flag an academy as needing a GHL reconnect. Deliberately a separate column
// rather than flipping ghl_connect_status, so existing "connected" UI logic and
// the status CHECK constraint stay untouched.
export async function markTokenTrouble(clientId, message) {
  try {
    await sb(`clients?id=eq.${clientId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ghl_token_error: String(message || "unknown").slice(0, 300),
        ghl_token_error_at: new Date().toISOString(),
      }),
    });
  } catch (_) { /* best-effort */ }
}

export async function clearTokenTrouble(clientId) {
  try {
    await sb(`clients?id=eq.${clientId}&ghl_token_error=not.is.null`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ghl_token_error: null, ghl_token_error_at: null }),
    });
  } catch (_) { /* best-effort */ }
}

// ── Agency credentials ────────────────────────────────────────────────────
// The agency flow needs an OAuth app whose Distribution is Agency. The
// sub-account app cannot mint location tokens: GHL answers
// "This token's user type is not yet supported!". Prefer the dedicated agency
// app when configured, and fall back to the shared app otherwise.
export function agencyCreds() {
  const id  = (process.env.GHL_AGENCY_OAUTH_CLIENT_ID || process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const sec = (process.env.GHL_AGENCY_OAUTH_CLIENT_SECRET || process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  const dedicated = !!(process.env.GHL_AGENCY_OAUTH_CLIENT_ID || "").trim();
  return { clientId: id, clientSecret: sec, dedicated };
}

// GHL access tokens are JWTs. The claims tell us what the token actually IS,
// which is the only reliable way to catch an install that landed on a single
// location instead of the agency.
export function tokenClaims(accessToken) {
  try {
    const part = String(accessToken || "").split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (_) { return null; }
}

// Throws unless this is a real Company (agency) token. A location token here is
// the exact failure that silently stopped every academy from re-minting.
export function assertCompanyToken(accessToken) {
  const claims = tokenClaims(accessToken);
  const authClass = claims?.authClass || "unknown";
  if (authClass !== "Company") {
    throw new Error(
      `This is a ${authClass} token, not an agency token. Re-run the connect and choose the ` +
      `AGENCY (company) level, not a single sub-account. The marketplace app must have ` +
      `Distribution = Agency.`,
    );
  }
  return claims;
}

// ── Agency token load + refresh ───────────────────────────────────────────
export async function getAgencyToken({ verify = true } = {}) {
  const rows = await sb(`ghl_agency_tokens?select=*&order=updated_at.desc&limit=1`);
  let t = rows && rows[0];
  if (!t) return null;

  const exp = t.expires_at ? new Date(t.expires_at).getTime() : 0;
  if (exp && exp - Date.now() <= RENEW_WINDOW_MS && t.refresh_token) {
    const { clientId, clientSecret } = agencyCreds();
    try {
      const r = await fetch(GHL_TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret,
          grant_type: "refresh_token", refresh_token: t.refresh_token, user_type: "Company",
        }),
      });
      const j = await r.json();
      if (r.ok && j.access_token) {
        const expiresAt = j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null;
        await sb(`ghl_agency_tokens?company_id=eq.${encodeURIComponent(t.company_id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            access_token: j.access_token,
            refresh_token: j.refresh_token || t.refresh_token,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }),
        });
        t = { ...t, access_token: j.access_token, expires_at: expiresAt };
      } else {
        await slackAlert(
          `:rotating_light: GHL agency token refresh FAILED (${j?.error_description || j?.error || r.status}). ` +
          `Every academy stops syncing within 24h. Reconnect: ${portalUrl()}/api/agency-connect?action=start`,
        );
      }
    } catch (_) { /* keep the existing token and let the caller try */ }
  }

  // A Location token stored here mints nothing. Surface it loudly instead of
  // failing 30+ times in a row with a 200 OK, which is how this went unnoticed.
  if (verify) {
    const claims = tokenClaims(t.access_token);
    if (claims && claims.authClass !== "Company") {
      t.badAuthClass = claims.authClass || "unknown";
    }
  }
  return t;
}

function portalUrl() {
  return (process.env.PORTAL_URL || "https://portal.byanymeansbusiness.com").replace(/\/+$/, "");
}

export function reconnectHint() {
  return `${portalUrl()}/api/agency-connect?action=start`;
}

// ── Minting ───────────────────────────────────────────────────────────────
export async function mintLocationToken(agencyToken, companyId, locationId) {
  const r = await fetch(GHL_LOC_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agencyToken}`, Version: V2_VERSION,
      Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ companyId, locationId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error((j && (j.message || j.error)) || `locationToken ${r.status}`);
  return j; // access_token, refresh_token, expires_in
}

async function persistLocationToken(clientId, tok) {
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
  await sb(`clients?id=eq.${clientId}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ghl_access_token: tok.access_token,
      ghl_refresh_token: tok.refresh_token || null,
      ghl_token_expires_at: expiresAt,
      ghl_connect_status: "connected",
      ghl_connected_at: new Date().toISOString(),
      ghl_token_error: null,
      ghl_token_error_at: null,
    }),
  });
  return expiresAt;
}

// Mint + persist a fresh location token for ONE academy, straight from the live
// agency token. This is the on-demand heal used by pickGhlToken and the path
// that removes the "a human opens the Inbox to fix it" step.
// Returns { token, locationId } or null when it cannot be done.
export async function mintForClient(client) {
  if (!client?.ghl_location_id) return null;
  const agency = await getAgencyToken().catch(() => null);
  if (!agency || !agency.access_token || agency.badAuthClass) return null;
  const companyId = client.ghl_company_id || agency.company_id;
  if (!companyId) return null;

  const tok = await mintLocationToken(agency.access_token, companyId, client.ghl_location_id);
  await persistLocationToken(client.id, tok);
  return { token: tok.access_token, locationId: client.ghl_location_id };
}

// Mint for every sub-account, or only the ones close to expiry.
//   scope: "all"   - every academy with a GHL location (post-connect, daily sweep)
//          "stale" - only tokens missing or expiring within RENEW_WINDOW_MS
export async function mintAll(companyId, agencyToken, { scope = "all" } = {}) {
  const cutoff = new Date(Date.now() + RENEW_WINDOW_MS).toISOString();
  // Only academies that were actually connected. An academy that never finished
  // its GHL connect has a location id but nothing to mint from, and re-trying it
  // hourly would just be recurring Slack noise. The daily full sweep still covers it.
  const staleFilter =
    `&or=(ghl_token_expires_at.is.null,ghl_token_expires_at.lt.${encodeURIComponent(cutoff)})` +
    `&ghl_connect_status=eq.connected`;

  const clients = await sb(
    `clients?ghl_location_id=not.is.null` +
    (scope === "stale" ? staleFilter : "") +
    `&select=id,business_name,ghl_location_id,ghl_company_id,ghl_token_expires_at&order=business_name.asc`,
  );

  const queue = [...(clients || [])];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      // Was this academy already broken before we started? Used to decide
      // whether a failure is a NEW outage worth paging about.
      const wasExpired = !c.ghl_token_expires_at || new Date(c.ghl_token_expires_at).getTime() <= Date.now();
      try {
        const tok = await mintLocationToken(agencyToken, c.ghl_company_id || companyId, c.ghl_location_id);
        await persistLocationToken(c.id, tok);
        results.push({ id: c.id, name: c.business_name, ok: true });
      } catch (e) {
        const err = String(e.message || e).slice(0, 140);
        results.push({ id: c.id, name: c.business_name, ok: false, err, wasExpired });
        await markTokenTrouble(c.id, err);
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  results.sort((a, b) => (a.ok === b.ok ? String(a.name).localeCompare(String(b.name)) : a.ok ? 1 : -1));
  return results;
}

// One place that decides whether a mint run deserves a Slack ping, so both the
// cron and the manual re-mint behave the same.
export async function alertOnMintResults(results, { scope = "all" } = {}) {
  const failed = results.filter(r => !r.ok);
  const total = results.length;
  if (!total || !failed.length) return;

  // Every single one failed - that is the agency token itself, not the academies.
  if (failed.length === total) {
    await slackAlert(
      `:rotating_light: GHL re-mint failed for ALL ${total} academies: "${failed[0].err}". ` +
      `The agency token cannot mint sub-account tokens, so every academy will stop syncing ` +
      `within 24h. Reconnect at the AGENCY level: ${reconnectHint()}`,
    );
    return;
  }

  await slackAlert(
    `:warning: GHL re-mint (${scope}) failed for ${failed.length}/${total} academies - these stop ` +
    `syncing contacts and pipeline until fixed:\n` +
    failed.map(f => `- ${f.name}: ${f.err}`).join("\n") +
    `\nReconnect: ${reconnectHint()}`,
  );
}
