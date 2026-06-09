// Shared Claude (Anthropic) helper for the portal's serverless functions.
//
// One job: call the Messages API and reliably get back a JSON ARRAY, even when
// the response is fenced, prose-led, or cut off at max_tokens (the old code threw
// a blind "AI did not return a JSON array" in all three cases).
//
// NOTE: we do NOT prefill the assistant turn with "[" — claude-sonnet-4-6 (the
// model these endpoints use) rejects assistant-message prefill with a 400 ("This
// model does not support assistant message prefill"). Instead we instruct the
// model (in each caller's system prompt) to return only a JSON array, then parse
// robustly: locate the array, repair a truncated tail (keep every complete object
// that arrived), and surface the real reason + a snippet if it still can't parse.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Extract a JSON array from a (possibly fenced / prose-led / truncated) response.
export function extractJsonArray(data) {
  let text = (data?.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  text = text.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("[");
  if (start === -1) {
    const why = data?.stop_reason ? ` (stop_reason=${data.stop_reason})` : "";
    throw new Error(`AI did not return a JSON array${why}: ${text.slice(0, 160)}`);
  }
  let end = text.lastIndexOf("]");
  if (end < start) {
    // Truncated mid-array (often stop_reason="max_tokens"): close after the last
    // COMPLETE object so we keep everything that did come through.
    const lastObj = text.lastIndexOf("}");
    if (lastObj < start) {
      const why = data?.stop_reason ? ` (stop_reason=${data.stop_reason})` : "";
      throw new Error(`AI returned a truncated/empty array${why}: ${text.slice(start, start + 160)}`);
    }
    text = text.slice(0, lastObj + 1) + "]";
    end = text.length - 1;
  }
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(`AI returned malformed JSON (${e.message}): ${slice.slice(0, 160)}`);
  }
}

// Call Claude and return a parsed JSON array.
export async function claudeJsonArray({ apiKey, model, system, payload, maxTokens = 8192 }) {
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [
        { role: "user", content: typeof payload === "string" ? payload : JSON.stringify(payload) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return extractJsonArray(await res.json());
}
