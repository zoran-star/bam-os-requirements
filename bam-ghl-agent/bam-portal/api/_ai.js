// Shared Claude (Anthropic) helper for the portal's serverless functions.
//
// One job: call the Messages API and reliably get back a JSON ARRAY, even when
// the response gets truncated (the old code threw a blind "AI did not return a
// JSON array" the moment output was fenced, prose-led, or cut off at max_tokens).
//
// The trick: we PREFILL the assistant turn with "[" so the model is forced to
// emit a bare JSON array immediately — no fences, no preamble. We then reattach
// that "[", repair a truncated tail (keep every complete object that arrived),
// and parse. If it still can't, the error carries the real reason + a snippet
// so we can debug. extractJsonArray assumes the prefilled-"[" shape.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Extract a JSON array from a (prefilled / fenced / truncated) Claude response.
export function extractJsonArray(data) {
  let text = (data?.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  text = text.replace(/```(?:json)?/gi, "").trim();
  if (!text.startsWith("[")) text = "[" + text; // reattach the prefilled opening bracket
  let end = text.lastIndexOf("]");
  if (end === -1) {
    // Truncated mid-array (often stop_reason="max_tokens"): close after the last
    // COMPLETE object so we keep everything that did come through.
    const lastObj = text.lastIndexOf("}");
    if (lastObj === -1) {
      const why = data?.stop_reason ? ` (stop_reason=${data.stop_reason})` : "";
      throw new Error(`AI did not return a JSON array${why}: ${text.slice(0, 160)}`);
    }
    text = text.slice(0, lastObj + 1) + "]";
    end = text.length - 1;
  }
  const slice = text.slice(0, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(`AI returned malformed JSON (${e.message}): ${slice.slice(0, 160)}`);
  }
}

// Call Claude and return a parsed JSON array. Prefills "[" to force array output.
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
        { role: "assistant", content: "[" }, // prefill → forces a bare JSON array
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return extractJsonArray(await res.json());
}
