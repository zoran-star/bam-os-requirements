// OAuth Step 1: Redirect user to Google consent screen

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured" });

  const redirectUri = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/auth/google/callback`;
  const scopes = "https://www.googleapis.com/auth/calendar.readonly";

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(302, authUrl);
}
