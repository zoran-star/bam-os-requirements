// Vercel Serverless Function — Agent Sessions
//
// Captures Claude Code session transcripts via /showtime → /byebye skills,
// generates dual summaries (technical + visual ADHD-friendly), exposes them
// on Zoran's review page.
//
// Endpoints:
//   POST /api/agent-sessions?action=start    (bearer: AGENT_SESSION_INGEST_SECRET)
//   POST /api/agent-sessions?action=finish   (bearer: AGENT_SESSION_INGEST_SECRET)
//   GET  /api/agent-sessions                 (zoran-only)
//   GET  /api/agent-sessions?id=<uuid>       (zoran-only)
//   GET  /api/agent-sessions?users=true      (zoran-only, returns list of distinct user_email + display)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const INGEST_SECRET = process.env.AGENT_SESSION_INGEST_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

const SB = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sbSelect(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB });
  if (!r.ok) throw new Error(`supabase select ${r.status}: ${await r.text()}`);
  return r.json();
}
async function sbInsert(table, row, returning = "representation") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...SB, Prefer: `return=${returning}` },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`supabase insert ${r.status}: ${await r.text()}`);
  return r.json();
}
async function sbPatch(table, filter, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...SB, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`supabase patch ${r.status}: ${await r.text()}`);
  return r.json();
}

// Resolve the staff user from a Supabase auth bearer token.
async function getStaffFromBearer(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` },
  });
  if (!r.ok) return null;
  const user = await r.json();
  return user?.email ? user : null;
}

function checkIngestSecret(req) {
  // Vercel CLI can store env values with a trailing literal \n when piped
  // in via `cat | vercel env add` — strip whitespace on both sides before
  // comparing so the secret matches whether or not it has a stray newline.
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const stored = (INGEST_SECRET || "").trim();
  return stored && bearer === stored;
}

// ── AI summaries ────────────────────────────────────────────────────
async function generateSummaries(transcript, userDisplayName, projectPath) {
  if (!ANTHROPIC_KEY) {
    return {
      technical_summary: "(no ANTHROPIC_API_KEY set on server — summary skipped)",
      visual_summary: "(no key)",
    };
  }

  // Compact the transcript to text (drop large tool blobs to fit context).
  const text = compactTranscript(transcript);

  const systemPrompt = `You are reviewing a Claude Code session transcript for Zoran (founder of BAM).
Zoran has ADHD and is a visual learner — heavy structure, short text, ASCII boxes, tables.

Produce TWO summaries of what happened in this session:

1. TECHNICAL — a developer-level recap of:
   - What the user was trying to do
   - What files were edited (with paths)
   - What decisions were made
   - What's working, what's broken, what's blocked
   - Any database / API / infra changes
   - Anything risky or worth Zoran's attention

2. VISUAL — extremely short and visual, ADHD-friendly:
   - Top: a one-line "tl;dr" with an emoji status indicator
   - A small ASCII flow/diagram if the work has stages
   - 3-5 bullets max with the actual outcomes
   - A single "⚠ Watch out for" line if there's a real risk
   - Plain English — no jargon. Tech terms in [brackets].

The user (${userDisplayName || "unknown"}) was working in: ${projectPath || "unknown"}

Call the submit_summaries tool with both summaries.`;

  // Use a forced tool call to guarantee structured JSON. (Assistant-prefill
  // is NOT supported by this model — it 400s with "conversation must end with
  // a user message" — and free-text "return ONLY JSON" prompting was
  // unreliable: the model sometimes led with prose and broke JSON.parse.)
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        name: "submit_summaries",
        description: "Record the technical and visual summaries of the session.",
        input_schema: {
          type: "object",
          properties: {
            technical_summary: { type: "string", description: "Developer-level recap (files, decisions, what's broken/blocked, infra changes, risks)." },
            visual_summary: { type: "string", description: "Extremely short, visual, ADHD-friendly: tl;dr line with emoji, optional ASCII diagram, 3-5 bullets, one ⚠ line if risky." },
          },
          required: ["technical_summary", "visual_summary"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_summaries" },
    messages: [{ role: "user", content: `Transcript:\n\n${text}` }],
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    return {
      technical_summary: `(Claude API error ${r.status}: ${await r.text()})`,
      visual_summary: "⚠ summary failed",
    };
  }
  const data = await r.json();
  // Primary path: read the forced tool_use block's structured input.
  const toolBlock = (data.content || []).find(
    (b) => b.type === "tool_use" && b.name === "submit_summaries"
  );
  if (toolBlock?.input) {
    return {
      technical_summary: toolBlock.input.technical_summary || "(no technical_summary in response)",
      visual_summary: toolBlock.input.visual_summary || "(no visual_summary in response)",
    };
  }
  // Defensive fallback: if a future model returns text instead, parse it.
  const out = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJsonLoose(out);
  if (parsed) {
    return {
      technical_summary: parsed.technical_summary || "(no technical_summary in response)",
      visual_summary: parsed.visual_summary || "(no visual_summary in response)",
    };
  }
  return {
    technical_summary: `(failed to parse Claude response)\n\nraw:\n${out.slice(0, 4000)}`,
    visual_summary: "⚠ summary parse failed",
  };
}

// Best-effort JSON parse: strips ``` fences, tries a direct parse, then falls
// back to the widest {...} slice. Returns null if nothing parses.
function parseJsonLoose(s) {
  if (!s) return null;
  const cleaned = s.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Flatten the JSONL transcript array into readable text. Drops large tool
// outputs to stay under context. Keeps user/assistant text + tool call names.
const MAX_CHARS = 80_000;
function compactTranscript(transcript) {
  if (!Array.isArray(transcript)) return String(transcript).slice(0, MAX_CHARS);
  const parts = [];
  for (const entry of transcript) {
    // jsonl entries vary: {type:'user',message:{content:...}}, {type:'assistant',...}, etc.
    const role = entry?.type || entry?.role || "?";
    let content = entry?.message?.content ?? entry?.content;
    if (typeof content === "string") {
      parts.push(`[${role}] ${content}`);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "text") parts.push(`[${role}] ${block.text}`);
        else if (block?.type === "tool_use") parts.push(`[${role} tool_use] ${block.name}(${JSON.stringify(block.input || {}).slice(0, 400)})`);
        else if (block?.type === "tool_result") {
          const tr = typeof block.content === "string" ? block.content : JSON.stringify(block.content || "");
          parts.push(`[tool_result] ${tr.slice(0, 600)}`);
        }
      }
    }
    if (parts.join("\n").length > MAX_CHARS) break;
  }
  return parts.join("\n").slice(0, MAX_CHARS);
}

// ── handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const action = req.query.action;

    // ── POST start / finish (ingest) — bearer = INGEST_SECRET ──
    if (req.method === "POST") {
      if (!checkIngestSecret(req)) {
        return res.status(401).json({ error: "invalid ingest secret" });
      }
      const body = req.body || {};

      if (action === "start") {
        const { user_email, user_display_name, project_path, session_id } = body;
        if (!user_email) return res.status(400).json({ error: "user_email required" });
        const [row] = await sbInsert("agent_sessions", {
          user_email: String(user_email).toLowerCase(),
          user_display_name: user_display_name || null,
          project_path: project_path || null,
          session_id: session_id || null,
          status: "in_progress",
        });
        return res.status(200).json({ id: row.id });
      }

      if (action === "finish") {
        const { id, transcript, message_count } = body;
        if (!id) return res.status(400).json({ error: "id required" });
        if (!Array.isArray(transcript)) return res.status(400).json({ error: "transcript must be an array" });

        // Pull session for context
        const existing = await sbSelect(`agent_sessions?id=eq.${id}&select=*`);
        if (!existing?.[0]) return res.status(404).json({ error: "session not found" });
        const session = existing[0];

        // Generate summaries (don't block on failure — we still want the transcript saved)
        let summaries = { technical_summary: null, visual_summary: null };
        try {
          summaries = await generateSummaries(
            transcript,
            session.user_display_name || session.user_email,
            session.project_path
          );
        } catch (e) {
          summaries = {
            technical_summary: `(summary generation crashed: ${e.message})`,
            visual_summary: "⚠ summary crashed",
          };
        }

        const [updated] = await sbPatch(
          "agent_sessions",
          `id=eq.${id}`,
          {
            transcript,
            message_count: typeof message_count === "number" ? message_count : transcript.length,
            ended_at: new Date().toISOString(),
            status: "completed",
            updated_at: new Date().toISOString(),
            ...summaries,
          }
        );
        return res.status(200).json({ ok: true, id: updated.id });
      }

      return res.status(400).json({ error: "unknown action" });
    }

    // ── GET (admin-only) ──
    if (req.method === "GET") {
      const user = await getStaffFromBearer(req);
      if (!user) return res.status(401).json({ error: "unauthorized" });
      const staffRows = await sbSelect(
        `staff?email=eq.${encodeURIComponent(user.email)}&select=role`
      );
      if (staffRows?.[0]?.role !== "admin") {
        return res.status(403).json({ error: "admin only" });
      }

      // Distinct users (for the tabs)
      if (req.query.users === "true") {
        const rows = await sbSelect(
          `agent_sessions?select=user_email,user_display_name&order=user_email.asc`
        );
        const map = new Map();
        for (const r of rows) {
          if (!map.has(r.user_email)) {
            map.set(r.user_email, r.user_display_name || r.user_email.split("@")[0]);
          }
        }
        return res.status(200).json(
          Array.from(map.entries()).map(([email, display]) => ({ email, display }))
        );
      }

      // Single session
      if (req.query.id) {
        const rows = await sbSelect(`agent_sessions?id=eq.${req.query.id}&select=*`);
        if (!rows?.[0]) return res.status(404).json({ error: "not found" });
        return res.status(200).json(rows[0]);
      }

      // List — optional ?user_email= filter, default 50 newest
      const filter = req.query.user_email
        ? `&user_email=eq.${encodeURIComponent(String(req.query.user_email).toLowerCase())}`
        : "";
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const rows = await sbSelect(
        // Omit `transcript` from list view to keep payload small
        `agent_sessions?select=id,user_email,user_display_name,project_path,session_id,started_at,ended_at,message_count,technical_summary,visual_summary,status${filter}&order=started_at.desc&limit=${limit}`
      );
      return res.status(200).json(rows);
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error("[agent-sessions]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}
