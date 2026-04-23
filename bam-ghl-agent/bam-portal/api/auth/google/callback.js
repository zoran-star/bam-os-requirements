// OAuth Step 2: Exchange code for tokens, store refresh token

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code parameter");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/auth/google/callback`;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      return res.status(400).json({ error: tokens.error, description: tokens.error_description });
    }

    // In production, store refresh_token in a database.
    // For now, show it so it can be added to env vars.
    const html = `
      <!DOCTYPE html>
      <html><body style="font-family:sans-serif;padding:40px;background:#1a1a2e;color:#fff">
        <h1>Google Calendar Connected!</h1>
        <p>Add this refresh token to your Vercel environment variables:</p>
        <p><strong>GOOGLE_REFRESH_TOKEN</strong></p>
        <pre style="background:#0d0d1a;padding:16px;border-radius:8px;word-break:break-all">${tokens.refresh_token || "No refresh token (re-auth with prompt=consent)"}</pre>
        <p>Then redeploy. You can close this tab.</p>
        <p style="color:#888;margin-top:24px">Access token (temporary): ${tokens.access_token?.slice(0, 20)}...</p>
      </body></html>
    `;
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
