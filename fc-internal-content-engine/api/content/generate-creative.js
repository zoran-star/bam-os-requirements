// Vercel Serverless Function — api/content/generate-creative.js
// POST: { prompt, guardrails, themes }
// Generates a creative concept using Anthropic Claude API
// Requires ANTHROPIC_API_KEY env var in Vercel

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt = "", guardrails = {}, themes = [], suggestTheme = false } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      creative: {
        title: "[API Key Not Configured] Sample: Day-in-the-life walkthrough",
        hook: "Watch me run my entire academy from my phone",
        cta: "Try FullControl free for 14 days",
        tone: guardrails.tone || "Conversational",
        video_style: guardrails.video_style || "talking_head",
        psych_lever: guardrails.psych_lever || "Curiosity",
        persona: guardrails.persona || "",
        notes: "Add ANTHROPIC_API_KEY to Vercel env vars to enable real AI generation.",
        suggested_theme_id: themes[0]?.id || null,
        suggested_theme_title: themes[0]?.title || "No theme",
        also_fits: [],
      },
    });
  }

  const themeList = themes.map((t, i) => `${i + 1}. [ID: ${t.id}] "${t.title}" — ${t.description || "No description"}`).join("\n");

  const guardrailBlock = [
    guardrails.video_style ? `VIDEO STYLE: ${guardrails.video_style}` : null,
    guardrails.tone ? `TONE: ${guardrails.tone}` : null,
    guardrails.psych_lever ? `PSYCHOLOGICAL LEVER: ${guardrails.psych_lever}` : null,
    guardrails.persona ? `TARGET PERSONA: ${guardrails.persona}` : null,
    guardrails.phase !== undefined ? `PHASE: ${["Pre-Launch", "Launch", "Post-Launch"][guardrails.phase] || "Pre-Launch"}` : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are a creative director for FullControl — an AI-powered command center SaaS for basketball training academies, gym owners, and private sports trainers.

ABOUT FULLCONTROL:
- AI command center that runs an entire sports academy from one dashboard
- Features: AI-powered marketing (Meta ads management), sales pipeline, member management with churn prediction, content creation engine, scheduling, and an AI advisor called "Sage"
- Target audience: Basketball academy owners, private trainers, gym operators
- Founders: Coleman Ayers (CEO of BAM Basketball, 500K+ followers, gym owner since 2021) and Zoran
- Value prop: Replace 8+ jobs (marketer, accountant, scheduler, content creator, customer service, sales, strategist, coach admin) with one AI platform
- Key differentiators: AI that talks to leads and books them, auto follow-ups, churn prediction, content that writes itself in your voice, staff schedules that manage themselves
- Pain points we solve: Manual admin drowning, scattered systems, no-shows, payment chasing, marketing struggles, flying blind with no data
- The platform has a sleek dark/gold aesthetic and feels like a premium sports command center
- Member app lets clients book, check schedules, and interact — coaches control everything from the main dashboard

META ANDROMEDA OPTIMIZATION:
- Each creative must have a unique hook (first 3 seconds scored independently by Andromeda)
- Avoid similarity to existing creatives — aim for < 60% feature overlap
- Diversify across video styles, psychological levers, and personas
- Minimum 3 different format types across a campaign

Generate a creative AD CONCEPT (not a full script). This is a brief — the title, hook, CTA, and strategic notes for a video ad or content piece.

RESPOND IN STRICT JSON FORMAT:
{
  "title": "Short punchy creative title",
  "hook": "The opening line / first 3 seconds that stops the scroll",
  "cta": "The call to action",
  "tone": "One of: Educational, Motivational, Urgent, Conversational, Authoritative, Storytelling, Controversial",
  "video_style": "One of: talking_head, ugc, screen_record, quick_graphics, funny_jarvis",
  "psych_lever": "One of: FOMO, Pain Point, Solution, Urgency, Aspiration, Simplicity, Curiosity, Value, Authority, Objection Handler, Social Proof, Humor",
  "persona": "One of: Young Hungry, Established, or empty string",
  "notes": "2-3 sentences on the creative direction, what makes it unique, filming notes",
  "suggested_theme_id": "The ID of the best-fit theme from the list below",
  "suggested_theme_title": "The title of that theme (for display)",
  "also_fits": ["Array of 1-2 other theme IDs that could also work"]
${suggestTheme ? `,\n  "new_theme_suggestion": "If none of the existing themes fit well, suggest a new broad theme title here. Otherwise null"` : ""}
}`;

  const userPrompt = `Generate a creative concept for FullControl.

${prompt ? `USER DIRECTION: ${prompt}` : "Generate a fresh, unique creative concept. Be creative and unexpected."}

${guardrailBlock ? `GUARDRAILS (respect these if provided, otherwise choose the best option):\n${guardrailBlock}` : "Choose the best video style, tone, and psychological lever for maximum impact."}

EXISTING THEMES TO CATEGORIZE UNDER:
${themeList || "No themes available — suggest one."}

${suggestTheme ? "If no existing theme fits well, suggest a new broad theme in the new_theme_suggestion field." : "Pick the closest theme from the list above."}

Return ONLY valid JSON. No markdown, no explanation.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(500).json({ error: "Creative generation failed" });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse AI response" });
    }

    const creative = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ creative });
  } catch (err) {
    console.error("Creative generation error:", err);
    return res.status(500).json({ error: err.message });
  }
}
