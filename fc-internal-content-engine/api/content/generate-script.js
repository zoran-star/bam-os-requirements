// Vercel Serverless Function — api/content/generate-script.js
// POST: { creative, feedback, version }
// Generates a video script using Anthropic Claude API
// Requires ANTHROPIC_API_KEY env var in Vercel

const VIDEO_STYLE_INSTRUCTIONS = {
  talking_head: "Format as a direct-to-camera talking head script. Cole or Zoran speaking directly. High trust, founder-led. Use natural pauses, emphasis markers, and conversational delivery cues.",
  ugc: "Format as a UGC (user-generated content) style script. Looks organic, not polished. Could be testimonial-style, 'discovered this app' format, or reaction video. Keep it raw and authentic.",
  screen_record: "Format as a screen recording script with voiceover. Include [SHOW: ...] markers for what's on screen alongside the narration. Show real FC features working.",
  quick_graphics: "Format as a quick graphics / motion design piece. Short punchy lines (5-10 seconds total). Include [GRAPHIC: ...] markers for animated stats, before/after graphics, quick-cut infographics.",
  funny_jarvis: "Format as a comedic 'Jarvis' concept script. Owner talking to FC like it's an AI assistant. Include dialogue between owner and FC. Humor + product demo combined.",
};

const PHASE_CONTEXT = {
  0: "This is PRE-LAUNCH content. The audience doesn't know about FullControl yet. Focus on pain points, curiosity, and building anticipation. Don't sell the product directly — sell the problem and hint at a solution.",
  1: "This is LAUNCH content. The audience is hearing about FullControl for the first time. Balance introducing the product with the pain points it solves. Create urgency. Include clear next steps.",
  2: "This is POST-LAUNCH content. The audience may already know about FullControl. Focus on social proof, deeper features, overcoming objections, and re-engaging people who haven't taken action yet.",
};

const PSYCH_LEVER_CONTEXT = {
  "FOMO": "Use fear of missing out. Create competitive anxiety — others are doing this, you're falling behind.",
  "Pain Point": "Lead with a specific, relatable pain. Name the exact frustration they feel daily.",
  "Solution": "Transition from problem to relief. Show how the pain dissolves with this tool.",
  "Urgency": "Create time pressure. The gap is widening NOW. Early movers win.",
  "Aspiration": "Paint the dream state. What does life look like when this is solved?",
  "Simplicity": "Emphasize how simple and easy everything becomes. One place, one click, done.",
  "Curiosity": "Tease without revealing. Ask questions that demand answers. Create an information gap.",
  "Value": "Reframe the economics. Compare the cost of NOT having this tool.",
  "Authority": "Position as the expert. Use credentials, data, and category-defining language.",
  "Objection Handler": "Address the skeptic head-on. Acknowledge the doubt, then dismantle it.",
  "Social Proof": "Show real results, real people, real adoption. 'Everyone else is doing this' energy.",
  "Humor": "Use comedy to disarm. Make the pain point funny, then pivot to the solution.",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { creative, feedback = [], version = 1 } = req.body || {};

  if (!creative || !creative.title) {
    return res.status(400).json({ error: "Missing creative data" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      script: `[API Key Not Configured]\n\nAdd ANTHROPIC_API_KEY to your Vercel environment variables to enable AI script generation.\n\nCreative: ${creative.title}\nHook: ${creative.hook || "\u2014"}\nCTA: ${creative.cta || "\u2014"}\nTone: ${creative.tone || "\u2014"}\nStyle: ${creative.video_style || "\u2014"}\nPsych Lever: ${creative.psych_lever || "\u2014"}\nPhase: ${creative.phase ?? 0}`,
    });
  }

  const styleInstruction = VIDEO_STYLE_INSTRUCTIONS[creative.video_style] || VIDEO_STYLE_INSTRUCTIONS.talking_head;
  const phaseContext = PHASE_CONTEXT[creative.phase] || PHASE_CONTEXT[0];
  const psychContext = creative.psych_lever ? (PSYCH_LEVER_CONTEXT[creative.psych_lever] || "") : "";

  let feedbackBlock = "";
  if (feedback.length > 0) {
    feedbackBlock = `\n\nPREVIOUS FEEDBACK TO INCORPORATE (this is version ${version}, improve based on this feedback):\n${feedback.map((f, i) => `${i + 1}. [${f.source}] ${f.body}`).join("\n")}`;
  }

  const systemPrompt = `You are a video script writer for FullControl — a SaaS platform for basketball training academies. You write scripts that will be spoken by the founders (Coleman and Zoran) directly to camera or used in video content.

Your scripts should be:
- Conversational and authentic, not corporate or salesy
- Written to be SPOKEN, not read — use short sentences, natural pauses
- Specific to basketball academy owners and private trainers
- Focused on real pain points: manual admin, scattered systems, no-shows, payment chasing, marketing struggles
- Confident but empathetic in tone

IMPORTANT FORMATTING:
- Start with [HOOK] section
- Then [BODY] section with the main content
- End with [CTA] section
- Use "..." for natural pauses
- Use *emphasis* for words to stress
- Include approximate timing in brackets like [~15 sec] for each section
- Total script should be 45-90 seconds unless it's a quick graphic

${styleInstruction}

${phaseContext}

${psychContext ? `PSYCHOLOGICAL ANGLE: ${psychContext}` : ""}

${creative.persona ? `TARGET PERSONA: ${creative.persona === "Young Hungry" ? "Young, hungry trainers who want fame, growth, and more clients." : "Established trainers who want family time back and less admin."}` : ""}

ANDROMEDA OPTIMIZATION NOTE: This script should have a distinctive hook that's different from other creatives in the library. Meta's Andromeda system rewards creative diversity — make the opening 3 seconds unique and scroll-stopping.`;

  const userPrompt = `Write a video script for this creative concept:

TITLE: ${creative.title}
HOOK: ${creative.hook || "(create a strong hook)"}
CTA: ${creative.cta || "(create a compelling call to action)"}
TONE: ${creative.tone || "Conversational"}
VIDEO STYLE: ${creative.video_style || "talking_head"}
PSYCH LEVER: ${creative.psych_lever || "General"}
MODE: ${creative.mode === "organic" ? "Organic content (no direct ads)" : "Paid ad content"}
${feedbackBlock}

Write the complete script now. Make it ready to read off a teleprompter.`;

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
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(500).json({ error: "Script generation failed" });
    }

    const data = await response.json();
    const script = data.content?.[0]?.text || "Script generation returned empty.";

    return res.status(200).json({ script });
  } catch (err) {
    console.error("Script generation error:", err);
    return res.status(500).json({ error: err.message });
  }
}
