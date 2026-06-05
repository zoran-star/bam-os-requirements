// Slack Digest — pulls Zoran's Slack messages since a given time and summarizes
// each channel/DM (incl. threads) with Claude. Runs server-side so the Slack
// token + Anthropic key never touch the browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SLACK_USER_ID = "U09A66CU5N2"; // Zoran (zoran@byanymeansbball.com)
const MAX_CHANNELS = 200; // safety cap (covers most workspaces fully)
const PER_CHANNEL_CHARS = 4000; // truncate transcript fed to Claude
const MODEL = "claude-haiku-4-5-20251001";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { since } = await req.json(); // unix seconds
    if (!since) return json({ error: "missing 'since' (unix seconds)" }, 400);
    const oldest = String(since);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tok } = await admin
      .from("user_slack_tokens").select("access_token").eq("slack_user_id", SLACK_USER_ID).single();
    if (!tok?.access_token) return json({ error: "no Slack token for Zoran" }, 500);
    const slackToken = tok.access_token;

    const { data: sec } = await admin
      .from("app_secrets").select("value").eq("key", "anthropic_api_key").single();
    if (!sec?.value) return json({ error: "anthropic_api_key not set in app_secrets" }, 500);
    const anthropicKey = sec.value;

    // ---- Slack helpers ----
    async function slack(method: string, params: Record<string, string>): Promise<any> {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`https://slack.com/api/${method}?` + new URLSearchParams(params), {
          headers: { Authorization: `Bearer ${slackToken}` },
        });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2) * 1000));
          continue;
        }
        const j = await res.json();
        if (!j.ok) throw new Error(`${method}: ${j.error}`);
        return j;
      }
      throw new Error(`${method}: rate limited`);
    }

    const nameCache = new Map<string, string>();
    async function userName(uid?: string): Promise<string> {
      if (!uid) return "someone";
      if (nameCache.has(uid)) return nameCache.get(uid)!;
      try {
        const r = await slack("users.info", { user: uid });
        const n = r.user?.profile?.display_name || r.user?.real_name || uid;
        nameCache.set(uid, n);
        return n;
      } catch {
        nameCache.set(uid, uid);
        return uid;
      }
    }
    async function clean(text = ""): Promise<string> {
      let t = text;
      for (const m of [...text.matchAll(/<@([A-Z0-9]+)>/g)]) t = t.replaceAll(m[0], "@" + (await userName(m[1])));
      t = t.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1");
      t = t.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2");
      t = t.replace(/<(https?:[^>]+)>/g, "$1");
      return t.trim();
    }

    // ---- list conversations the user is in ----
    let channels: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await slack("users.conversations", {
        types: "public_channel,private_channel,mpim,im",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      });
      channels.push(...(r.channels || []));
      cursor = r.response_metadata?.next_cursor || "";
    } while (cursor);

    const capped = channels.length > MAX_CHANNELS;
    channels = channels.slice(0, MAX_CHANNELS);

    // ---- gather per-channel transcripts since `oldest` ----
    const convos = await mapLimit(channels, 6, async (ch) => {
      let history: any[] = [];
      try {
        const r = await slack("conversations.history", { channel: ch.id, oldest, limit: "200" });
        history = r.messages || [];
      } catch {
        return null;
      }
      if (history.length === 0) return null;

      // pull replies for any in-window thread parents
      const all = [...history];
      for (const m of history) {
        if ((m.reply_count || 0) > 0 && m.thread_ts) {
          try {
            const rr = await slack("conversations.replies", { channel: ch.id, ts: m.thread_ts, oldest, limit: "200" });
            for (const reply of rr.messages || []) if (reply.ts !== m.ts) all.push(reply);
          } catch { /* ignore */ }
        }
      }
      all.sort((a, b) => Number(a.ts) - Number(b.ts));

      let label: string;
      if (ch.is_im) label = "DM with " + (await userName(ch.user));
      else if (ch.is_mpim) label = "Group DM";
      else label = "#" + (ch.name || ch.id);

      const lines: string[] = [];
      for (const m of all) {
        if (!m.text && !m.user) continue;
        const who = await userName(m.user);
        const txt = await clean(m.text);
        if (txt) lines.push(`${who}: ${txt}`);
      }
      if (lines.length === 0) return null;
      let transcript = lines.join("\n");
      if (transcript.length > PER_CHANNEL_CHARS) transcript = transcript.slice(-PER_CHANNEL_CHARS);
      return { label, msgCount: lines.length, transcript };
    });

    const active = convos.filter(Boolean) as { label: string; msgCount: number; transcript: string }[];
    if (active.length === 0) {
      return json({ since: oldest, overview: "No Slack activity in that window.", channels: [], capped });
    }

    // ---- summarize with Claude ----
    const blocks = active
      .map((c, i) => `### CONVERSATION ${i} — ${c.label} (${c.msgCount} msgs)\n${c.transcript}`)
      .join("\n\n");
    const prompt =
      `You summarize Slack activity for a busy founder. Below are ${active.length} Slack conversations ` +
      `(channels/DMs) with messages since a chosen time.\n\n` +
      `Return ONLY valid JSON (no markdown fences) shaped exactly like:\n` +
      `{"overview":"2-3 sentence high-level summary of everything that matters","channels":[` +
      `{"i":0,"label":"#channel","summary":"1-3 tight sentences on what happened","action":"any action needed for the founder, or empty string"}]}\n\n` +
      `Be concise and concrete. Name people. Surface decisions, blockers, and anything needing his reply. ` +
      `Skip pure noise.\n\n${blocks}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
    });
    const ai = await aiRes.json();
    if (!aiRes.ok) return json({ error: "anthropic: " + (ai?.error?.message || aiRes.status) }, 500);

    let parsed: any = { overview: "", channels: [] };
    try {
      const raw = (ai.content?.[0]?.text || "").replace(/^```json\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(raw);
    } catch {
      parsed = { overview: ai.content?.[0]?.text || "Could not parse summary.", channels: [] };
    }

    // stitch labels/counts back in
    const out = (parsed.channels || []).map((c: any) => ({
      label: active[c.i]?.label || c.label || "",
      msgCount: active[c.i]?.msgCount || 0,
      summary: c.summary || "",
      action: c.action || "",
    }));

    return json({ since: oldest, overview: parsed.overview || "", channels: out, capped, scanned: active.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
