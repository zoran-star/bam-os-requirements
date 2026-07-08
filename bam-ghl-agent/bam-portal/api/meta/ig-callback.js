import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 30;

// Facebook OAuth callback for the client Instagram connect wizard
// (/api/meta/ig-connect action=start builds the dialog URL that lands here).
// Exchanges the code for a long-lived user token, then:
//   exactly 1 page  -> wires it immediately        -> ?ig=connected
//   several pages   -> stores token + page list    -> ?ig=pick   (wizard shows picker)
//   no pages/error  ->                             -> ?ig=error&msg=...
// Register `<portal origin>/api/meta/ig-callback` as a Valid OAuth Redirect
// URI on the Meta app or Facebook rejects with "URL Blocked".
import {
  verifyState, igRedirectUri, portalOrigin, encryptSecret,
  listPagesForToken, readClient, saveSetup, wirePage,
} from "./_igshared.js";

const META_GRAPH = "https://graph.facebook.com/v22.0";

function back(req, res, status, msg) {
  const params = new URLSearchParams({ ig: status });
  if (msg) params.set("msg", String(msg).slice(0, 200));
  res.setHeader("Location", `${portalOrigin(req)}/client-portal.html?${params.toString()}`);
  return res.status(302).end();
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const { code, state, error: fbError, error_description } = req.query;
  if (fbError) return back(req, res, "error", error_description || String(fbError));
  if (!code || !state) return back(req, res, "error", "missing code or state");

  let payload;
  try { payload = verifyState(state); }
  catch (e) { return back(req, res, "error", `state: ${e.message}`); }
  const clientId = payload.client_id;
  if (!clientId) return back(req, res, "error", "state missing client_id");

  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return back(req, res, "error", "Meta app not configured");

    // Code -> short-lived token
    const shortRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret, redirect_uri: igRedirectUri(req), code,
    }));
    const shortJson = await shortRes.json();
    if (!shortRes.ok || !shortJson.access_token) {
      return back(req, res, "error", shortJson?.error?.message || "token exchange failed");
    }

    // Short -> long-lived (60 days; Page tokens derived from it don't expire)
    const longRes = await fetch(`${META_GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret,
      fb_exchange_token: shortJson.access_token,
    }));
    const longJson = await longRes.json();
    const userToken = longJson.access_token || shortJson.access_token;

    const pages = await listPagesForToken(userToken);
    if (!pages.length) {
      return back(req, res, "error", "No Facebook Pages on that account - the Instagram must be a professional account linked to a Facebook Page you manage.");
    }

    const client = await readClient(clientId);
    const setup = (client && client.ig_setup) || {};

    if (pages.length === 1) {
      await wirePage({ clientId, userToken, pageId: pages[0].page_id, by: payload.by, existingSetup: { ...setup, connected_at: new Date().toISOString() } });
      return back(req, res, "connected");
    }

    // Several pages: park the token + list, the wizard shows the picker.
    await saveSetup(clientId, {
      ...setup,
      user_token_enc: encryptSecret(userToken),
      pages: pages.map(({ _page_token, ...p }) => p),
      connected_at: new Date().toISOString(),
    });
    return back(req, res, "pick");
  } catch (e) {
    return back(req, res, "error", e.message || "internal error");
  }
}

export default withSentryApiRoute(handler);
