// Unified Feedback API — submit feedback + Slack webhook for reaction approvals
// POST with action=submit: submit feedback to Slack
// POST with Slack event body: handle reaction_added webhook
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://jnojmfmpnsfmtqmwhopz.supabase.co",
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
);

const APPROVER_SLACK_IDS = (process.env.FEEDBACK_APPROVER_SLACK_IDS || "").split(",").filter(Boolean);

// ─── Submit feedback to Slack ───
async function handleSubmit(req, res) {
  const { id, body, source, page, author } = req.body || {};
  if (!body) return res.status(400).json({ error: "Missing feedback body" });

  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
  const channel = process.env.FEEDBACK_SLACK_CHANNEL;

  if (!token || !channel) {
    console.warn("Slack not configured for feedback");
    return res.status(200).json({ ok: true, slack: false });
  }

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
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(slackBody),
    });
    const slackJson = await slackRes.json();
    if (slackJson.ok && id) {
      await supabase.from("portal_feedback").update({ slack_ts: slackJson.ts, slack_channel: slackJson.channel }).eq("id", id);
    }
    return res.status(200).json({ ok: true, slack: slackJson.ok });
  } catch (err) {
    console.error("Slack feedback error:", err);
    return res.status(200).json({ ok: true, slack: false, error: err.message });
  }
}

// ─── Slack webhook for reaction approvals ───
async function handleWebhook(req, res) {
  const body = req.body;

  // Slack URL verification challenge
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  if (body.type === "event_callback") {
    const event = body.event;
    if (event.type !== "reaction_added") return res.status(200).json({ ok: true });

    const reaction = event.reaction;
    const userId = event.user;
    const messageTs = event.item?.ts;
    const channel = event.item?.channel;

    if (reaction !== "white_check_mark" && reaction !== "heavy_check_mark" && reaction !== "+1") {
      return res.status(200).json({ ok: true });
    }
    if (APPROVER_SLACK_IDS.length > 0 && !APPROVER_SLACK_IDS.includes(userId)) {
      return res.status(200).json({ ok: true, skipped: "not an approver" });
    }
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
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel, thread_ts: messageTs, text: ":white_check_mark: *Approved* — queued for next Claude Code session." }),
          });
        }
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(200).json({ ok: true, error: err.message });
    }
  }

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const action = req.query.action;
  if (action === "submit") return handleSubmit(req, res);

  // Default: treat as Slack webhook (has body.type)
  return handleWebhook(req, res);
}
