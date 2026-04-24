// Unified Slack API — channels, messages, DMs, OAuth, status, disconnect
// Routes via ?action= query param for OAuth flows, otherwise standard channel ops
import { createClient } from "@supabase/supabase-js";

const SLACK_API = "https://slack.com/api";
const SCOPES = "channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read,chat:write";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://jnojmfmpnsfmtqmwhopz.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

// Create an authenticated client for write ops when no service key
function getWriteClient(jwt) {
  if (SERVICE_KEY) return supabase;
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// ─── Helpers ───

async function resolveSlackToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const jwt = authHeader.replace("Bearer ", "");
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr) console.warn("Slack token resolve: auth error:", authErr.message);
      if (user) {
        const readClient = getWriteClient(jwt);
        const { data, error: dbErr } = await readClient
          .from("user_slack_tokens")
          .select("access_token")
          .eq("user_id", user.id)
          .single();
        if (dbErr) console.warn("Slack token resolve: db error:", dbErr.message, dbErr.code);
        if (data?.access_token) {
          console.log("Slack: using per-user token for", user.id);
          return { token: data.access_token, isUserToken: true };
        }
        console.log("Slack: no per-user token found for", user.id, "— falling back to shared");
      }
    } catch (e) {
      console.warn("Slack token resolve exception:", e.message);
    }
  }
  const shared = process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN;
  return { token: shared, isUserToken: !!process.env.SLACK_USER_TOKEN };
}

async function slackFetch(token, method, params = {}) {
  const url = new URL(`${SLACK_API}/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

async function slackPost(token, method, body = {}) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

const userCache = {};
async function fetchUserName(token, uid) {
  if (!uid) return "Unknown";
  if (userCache[uid]) return userCache[uid];
  try {
    const data = await slackFetch(token, "users.info", { user: uid });
    const name = data.user?.real_name || data.user?.profile?.display_name || data.user?.name || uid;
    userCache[uid] = name;
    return name;
  } catch { userCache[uid] = uid; return uid; }
}

async function fetchUserNames(token, userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const names = {};
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    await Promise.all(batch.map(async (uid) => { names[uid] = await fetchUserName(token, uid); }));
  }
  return names;
}

async function getUserFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(jwt);
  return user || null;
}

// ─── OAuth: Start ───
async function handleOAuthStart(req, res) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "SLACK_CLIENT_ID not configured" });
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Missing auth token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid auth token" });
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/slack/channels?action=oauth-callback`;
  const slackUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackUrl.searchParams.set("client_id", clientId);
  slackUrl.searchParams.set("user_scope", SCOPES);
  slackUrl.searchParams.set("redirect_uri", redirectUri);
  slackUrl.searchParams.set("state", token);
  return res.redirect(302, slackUrl.toString());
}

// ─── OAuth: Callback ───
async function handleOAuthCallback(req, res) {
  const { code, state, error: slackError } = req.query;
  if (slackError) return res.redirect(302, "/?nav=settings&slack=denied");
  if (!code || !state) return res.redirect(302, "/?nav=settings&slack=error");
  const { data: { user }, error: authError } = await supabase.auth.getUser(state);
  if (authError || !user) return res.redirect(302, "/?nav=settings&slack=error");
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.redirect(302, "/?nav=settings&slack=error");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/slack/channels?action=oauth-callback`;
  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.ok) return res.redirect(302, "/?nav=settings&slack=error");
    const accessToken = tokenJson.authed_user?.access_token;
    if (!accessToken) return res.redirect(302, "/?nav=settings&slack=error");
    const writeClient = getWriteClient(state);
    const { error: dbError } = await writeClient.from("user_slack_tokens").upsert({
      user_id: user.id,
      access_token: accessToken,
      slack_user_id: tokenJson.authed_user?.id,
      slack_team_id: tokenJson.team?.id,
      slack_team_name: tokenJson.team?.name || "",
      scopes: tokenJson.authed_user?.scope || "",
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (dbError) { console.error("Supabase upsert error:", dbError); return res.redirect(302, "/?nav=settings&slack=error"); }
    return res.redirect(302, "/?nav=settings&slack=connected");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return res.redirect(302, "/?nav=settings&slack=error");
  }
}

// ─── Status ───
async function handleStatus(req, res) {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(200).json({ connected: false });
  const { data } = await supabase.from("user_slack_tokens")
    .select("slack_team_name, slack_user_id, connected_at")
    .eq("user_id", user.id).single();
  if (data) return res.status(200).json({ connected: true, slackTeamName: data.slack_team_name || "", slackUserId: data.slack_user_id || "", connectedAt: data.connected_at });
  return res.status(200).json({ connected: false });
}

// ─── Disconnect ───
async function handleDisconnect(req, res) {
  const user = await getUserFromAuth(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { data: tokenRow } = await supabase.from("user_slack_tokens").select("access_token").eq("user_id", user.id).single();
  if (tokenRow?.access_token) {
    try { await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { "Authorization": `Bearer ${tokenRow.access_token}`, "Content-Type": "application/x-www-form-urlencoded" } }); } catch (e) { /* ok */ }
  }
  await supabase.from("user_slack_tokens").delete().eq("user_id", user.id);
  return res.status(200).json({ ok: true });
}

// ─── Feedback: submit to Slack (folded in from /api/feedback) ───
async function handleFeedbackSubmit(req, res) {
  const { id, body, source, page, author } = req.body || {};
  if (!body) return res.status(400).json({ error: "Missing feedback body" });
  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
  const channel = process.env.FEEDBACK_SLACK_CHANNEL;
  if (!token || !channel) return res.status(200).json({ ok: true, slack: false });
  const sourceEmoji = source === "voice" ? ":studio_microphone:" : ":pencil:";
  const pageLabel = page ? ` _(from ${page} page)_` : "";
  const slackBody = {
    channel,
    text: `${sourceEmoji} *Portal Feedback* from *${author || "Mike"}*${pageLabel}\n\n>${body.split("\n").join("\n>")}\n\n_React with :white_check_mark: to approve for build_`,
    unfurl_links: false,
  };
  try {
    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(slackBody),
    });
    const slackJson = await slackRes.json();
    if (slackJson.ok && id) {
      await supabase.from("portal_feedback").update({ slack_ts: slackJson.ts, slack_channel: slackJson.channel }).eq("id", id);
    }
    return res.status(200).json({ ok: true, slack: slackJson.ok });
  } catch (err) {
    return res.status(200).json({ ok: true, slack: false, error: err.message });
  }
}

// ─── Feedback: Slack reaction webhook (folded in from /api/feedback) ───
async function handleFeedbackWebhook(req, res) {
  const body = req.body;
  if (body.type === "url_verification") return res.status(200).json({ challenge: body.challenge });
  if (body.type !== "event_callback") return res.status(200).json({ ok: true });
  const event = body.event;
  if (event.type !== "reaction_added") return res.status(200).json({ ok: true });
  const approvers = (process.env.FEEDBACK_APPROVER_SLACK_IDS || "").split(",").filter(Boolean);
  const reaction = event.reaction;
  const userId = event.user;
  const messageTs = event.item?.ts;
  const channel = event.item?.channel;
  if (!["white_check_mark", "heavy_check_mark", "+1"].includes(reaction)) return res.status(200).json({ ok: true });
  if (approvers.length > 0 && !approvers.includes(userId)) return res.status(200).json({ ok: true, skipped: "not an approver" });
  if (!messageTs) return res.status(200).json({ ok: true });
  try {
    const { data: rows } = await supabase.from("portal_feedback")
      .select("id, status").eq("slack_ts", messageTs).eq("slack_channel", channel).limit(1);
    if (rows && rows.length > 0 && rows[0].status === "pending") {
      await supabase.from("portal_feedback").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", rows[0].id);
      const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
      if (token) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel, thread_ts: messageTs, text: ":white_check_mark: *Approved* — queued for next Claude Code session." }),
        });
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: err.message });
  }
}

// ─── Main Handler ───
export default async function handler(req, res) {
  // Prevent browser from caching API responses
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  const action = req.query.action;

  // Route OAuth & management actions
  if (action === "oauth-start") return handleOAuthStart(req, res);
  if (action === "oauth-callback") return handleOAuthCallback(req, res);
  if (action === "status") return handleStatus(req, res);
  if (action === "disconnect") return handleDisconnect(req, res);
  if (action === "feedback-submit") return handleFeedbackSubmit(req, res);
  if (action === "feedback-webhook") return handleFeedbackWebhook(req, res);

  // ── Standard Slack operations ──
  const { token, isUserToken } = await resolveSlackToken(req);
  if (!token) return res.status(500).json({ error: "No Slack token configured. Connect Slack in Settings or set SLACK_USER_TOKEN." });

  try {
    // POST: Send a message
    if (req.method === "POST") {
      const { channel, text } = req.body || {};
      if (!channel || !text) return res.status(400).json({ error: "channel and text are required" });
      const result = await slackPost(token, "chat.postMessage", { channel, text });
      return res.status(200).json({ data: { id: result.ts, channel: result.channel, text: result.message?.text || text, timestamp: result.ts } });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const { channel, mode } = req.query;

    // GET channel + members
    if (channel && mode === "members") {
      const data = await slackFetch(token, "conversations.members", { channel, limit: "200" });
      const names = await fetchUserNames(token, data.members || []);
      return res.status(200).json({ data: (data.members || []).map(uid => ({ id: uid, name: names[uid] || uid })) });
    }

    // GET channel messages
    if (channel) {
      console.log("Slack: fetching history for channel:", channel);
      const data = await slackFetch(token, "conversations.history", { channel, limit: "40" });
      const messages = data.messages || [];
      if (messages.length > 0) {
        const newest = new Date(parseFloat(messages[0].ts) * 1000).toISOString();
        const oldest = new Date(parseFloat(messages[messages.length - 1].ts) * 1000).toISOString();
        console.log(`Slack: got ${messages.length} messages, newest=${newest}, oldest=${oldest}`);
      }
      const names = await fetchUserNames(token, messages.map(m => m.user));
      const mapped = messages.map(m => ({
        id: m.ts, text: m.text || "", user: m.user || null,
        userName: names[m.user] || m.user || "Unknown", timestamp: m.ts,
        threadTs: m.thread_ts || null, replyCount: m.reply_count || 0,
        isBot: !!m.bot_id, attachments: (m.attachments || []).length,
        files: (m.files || []).map(f => ({ name: f.name, url: f.url_private })),
      }));
      return res.status(200).json({ data: mapped });
    }

    // GET all conversations
    const allConversations = [];
    const channelData = await slackFetch(token, "conversations.list", { types: "public_channel,private_channel", exclude_archived: "true", limit: "200" });
    for (const ch of (channelData.channels || [])) {
      allConversations.push({ id: ch.id, name: ch.name, type: ch.is_private ? "private_channel" : "public_channel", topic: ch.topic?.value || "", purpose: ch.purpose?.value || "", numMembers: ch.num_members || 0, isPrivate: ch.is_private || false, isDM: false, isGroupDM: false, updated: ch.updated || 0 });
    }
    if (isUserToken) {
      try {
        const imData = await slackFetch(token, "conversations.list", { types: "im", limit: "100" });
        const dmNames = await fetchUserNames(token, (imData.channels || []).map(dm => dm.user).filter(Boolean));
        for (const dm of (imData.channels || [])) {
          if (!dm.user) continue;
          allConversations.push({ id: dm.id, name: dmNames[dm.user] || dm.user, type: "dm", topic: "", purpose: "", numMembers: 2, isPrivate: true, isDM: true, isGroupDM: false, userId: dm.user, updated: dm.updated || 0 });
        }
      } catch (e) { console.warn("Could not fetch DMs:", e.message); }
      try {
        const mpimData = await slackFetch(token, "conversations.list", { types: "mpim", limit: "50" });
        for (const gm of (mpimData.channels || [])) {
          let groupName = gm.name || "Group DM";
          if (gm.purpose?.value) groupName = gm.purpose.value;
          else if (groupName.startsWith("mpdm-")) groupName = groupName.replace("mpdm-", "").replace(/--/g, ", ").replace(/-\d+$/, "");
          allConversations.push({ id: gm.id, name: groupName, type: "group_dm", topic: gm.topic?.value || "", purpose: gm.purpose?.value || "", numMembers: gm.num_members || 0, isPrivate: true, isDM: false, isGroupDM: true, updated: gm.updated || 0 });
        }
      } catch (e) { console.warn("Could not fetch group DMs:", e.message); }
    }
    // Sort all by most recently active
    allConversations.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return res.status(200).json({ data: allConversations });
  } catch (err) {
    console.error("Slack error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
