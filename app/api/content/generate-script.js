// Vercel Serverless Function — place at api/content/generate-script.js
// POST: { message, feedback, version }
// Generates a video script using Anthropic Claude API
// Requires ANTHROPIC_API_KEY env var in Vercel

const VIDEO_STYLE_INSTRUCTIONS = {
  talking_head: "Format as a direct-to-camera talking head script. Use natural pauses, emphasis markers, and conversational delivery cues.",
  selfie: "Format as a casual selfie/iPhone-style script. Keep it raw, authentic, and like you're talking to a friend. Short punchy lines.",
  pro_camera: "Format as a professional camera script. Include shot notes, pacing markers, and polished delivery. Studio quality.",
  carousel: "Format as carousel slides. Number each slide (1-8). Each slide: headline (max 8 words) + supporting copy (1-2 lines). First slide = hook, last slide = CTA.",
  screen_record: "Format as a screen recording script with voiceover. Include [SHOW: ...] markers for what's on screen alongside the narration.",
  broll_voiceover: "Format as a B-roll + voiceover script. Include [B-ROLL: ...] markers describing visual footage alongside the voiceover narration.",
  testimonial: "Format as a testimonial-style script. Start with the pain point, show the transformation, and end with the recommendation. Keep it story-driven.",
  other: "Format as a general video script with clear sections for hook, body, and CTA.",
};

const PHASE_CONTEXT = {
  0: "This is PRE-LAUNCH content. The audience doesn't know about FullControl yet. Focus on pain points, curiosity, and building anticipation. Don't sell the product directly — sell the problem and hint at a solution.",
  1: "This is LAUNCH content. The audience is hearing about FullControl for the first time. Balance introducing the product with the pain points it solves. Create urgency. Include clear next steps.",
  2: "This is POST-LAUNCH content. The audience may already know about FullControl. Focus on social proof, deeper features, overcoming objections, and re-engaging people who haven't taken action yet.",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, feedback = [], version = 1 } = req.body || {};

  if (!message || !message.title) {
    return res.status(400).json({ error: "Missing message data" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      script: `[API Key Not Configured]\n\nAdd ANTHROPIC_API_KEY to your Vercel environment variables to enable AI script generation.\n\nMessage: ${message.title}\nHook: ${message.hook || "\u2014"}\nCTA: ${message.cta || "\u2014"}\nTone: ${message.tone || "\u2014"}\nStyle: ${message.video_style || "\u2014"}\nPhase: ${message.phase ?? 0}`,
    });
  }

  const styleInstruction = VIDEO_STYLE_INSTRUCTIONS[message.video_style] || VIDEO_STYLE_INSTRUCTIONS.other;
  const phaseContext = PHASE_CONTEXT[message.phase] || PHASE_CONTEXT[0];

  let feedbackBlock = "";
  if (feedback.length > 0) {
    feedbackBlock = `\n\nPREVIOUS FEEDBACK TO INCORPORATE (this is version ${version}, improve based on this feedback):\n${feedback.map((f, i) => `${i + 1}. [${f.source}] ${f.body}`).join("\n")}`;
  }

  const systemPrompt = `You are a video script writer for FullControl \u2014 a SaaS platform for basketball training academies. You write scripts that will be spoken by the founders (Coleman and Zoran) directly to camera or used in video content.

Your scripts should be:
- Conversational and authentic, not corporate or salesy
- Written to be SPOKEN, not read \u2014 use short sentences, natural pauses
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
- Total script should be 45-90 seconds unless it's a carousel

${styleInstruction}

${phaseContext}`;

  const userPrompt = `Write a video script for this message:

TITLE: ${message.title}
HOOK: ${message.hook || "(create a strong hook)"}
CTA: ${message.cta || "(create a compelling call to action)"}
TONE: ${message.tone || "Conversational"}
VIDEO STYLE: ${message.video_style || "talking_head"}
MODE: ${message.mode === "organic" ? "Organic content (no direct ads)" : "Paid ad content"}
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
