// POST: { query: string, context: string }
// Uses Anthropic Claude API to answer questions based on SOP content
// Requires ANTHROPIC_API_KEY env var

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.query.action;
  if (action === "summarize-call") {
    return handleSummarizeCall(req, res);
  }

  const { query, context } = req.body || {};

  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  // If no context provided, use fallback immediately
  if (!context || context.trim().length === 0) {
    return res.status(200).json({
      answer: "I don't have any SOP content loaded yet. Try browsing some SOPs first, or click \"Browse SOPs\" to load the documentation — then ask me again!",
      sources: [],
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Fallback: text-based search if no API key
  if (!apiKey) {
    return res.status(200).json(fallbackSearch(query, context));
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "You are a BAM Business assistant. Answer the user's question based ONLY on the provided SOP documentation. Be concise and specific. If the answer isn't in the SOPs, say so. Quote relevant sections when possible. At the end of your answer, on a new line, write SOURCES: followed by a comma-separated list of the SOP document titles you referenced (exactly as they appear in the headers). If no specific SOPs were referenced, write SOURCES: none.",
        messages: [
          {
            role: "user",
            content: `Here is the SOP documentation:\n\n${context}\n\n---\n\nQuestion: ${query}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      // Fall back to text search on API error
      return res.status(200).json(fallbackSearch(query, context));
    }

    const data = await response.json();
    const rawAnswer = data.content?.[0]?.text || "No answer generated.";

    // Parse sources from the answer
    const { answer, sources } = parseSources(rawAnswer);

    return res.status(200).json({ answer, sources });
  } catch (err) {
    console.error("AI search error:", err);
    return res.status(200).json(fallbackSearch(query, context));
  }
}

function parseSources(text) {
  const sourceLine = text.match(/SOURCES:\s*(.+)$/im);
  let sources = [];
  let answer = text;

  if (sourceLine) {
    answer = text.slice(0, sourceLine.index).trim();
    const raw = sourceLine[1].trim();
    if (raw.toLowerCase() !== "none") {
      sources = raw.split(",").map(s => s.trim()).filter(Boolean);
    }
  }

  return { answer, sources };
}

async function handleSummarizeCall(req, res) {
  const { notes, title = "" } = req.body || {};
  if (!notes || notes.trim().length < 40) {
    return res.status(200).json({ summary: "", bullets: [], actionItems: [], thingsToKnow: [], skipped: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ summary: notes.slice(0, 200), bullets: [], actionItems: [], thingsToKnow: [], skipped: true });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: `You analyze client call notes and produce concise meeting-prep briefs for a Scaling Manager about to get on their next call. Output STRICT JSON with this shape:
{
  "summary": "1-2 sentence TL;DR of the call",
  "bullets": ["key discussion point 1", "key discussion point 2", ...],
  "actionItems": ["action with owner if mentioned", ...],
  "thingsToKnow": ["context/concern/opportunity to remember", ...]
}
Rules:
- 3-6 bullets max per array
- Be specific (names, numbers, dates)
- actionItems are concrete next steps/follow-ups
- thingsToKnow captures mood, blockers, opportunities, or anything surprising
- If a section has nothing real, return an empty array
- Return ONLY JSON, no markdown fences, no commentary`,
        messages: [
          { role: "user", content: `Call: ${title}\n\nNotes:\n${notes.slice(0, 6000)}` },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(200).json({ summary: "", bullets: [], actionItems: [], thingsToKnow: [], error: "ai_error" });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return res.status(200).json({
      summary: parsed.summary || "",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      thingsToKnow: Array.isArray(parsed.thingsToKnow) ? parsed.thingsToKnow : [],
    });
  } catch (err) {
    console.error("summarize-call error:", err);
    return res.status(200).json({ summary: "", bullets: [], actionItems: [], thingsToKnow: [], error: err.message });
  }
}

function fallbackSearch(query, context) {
  const qLower = query.toLowerCase();
  const sections = context.split(/(?=^## )/m);
  const matches = [];

  for (const section of sections) {
    if (section.toLowerCase().includes(qLower)) {
      const titleMatch = section.match(/^## (.+)/);
      const title = titleMatch ? titleMatch[1].trim() : "Untitled";
      const lines = section.split("\n").filter(l => l.toLowerCase().includes(qLower));
      const snippet = lines.slice(0, 3).join(" ").slice(0, 300);
      matches.push({ title, snippet });
    }
  }

  if (matches.length === 0) {
    return {
      answer: `No results found for "${query}" in the SOPs. Try rephrasing your question or using different keywords.`,
      sources: [],
    };
  }

  const answer = matches
    .map(m => `**${m.title}:** ${m.snippet}`)
    .join("\n\n");

  return {
    answer: `Text search results for "${query}":\n\n${answer}`,
    sources: matches.map(m => m.title),
  };
}
