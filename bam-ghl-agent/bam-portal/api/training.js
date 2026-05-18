// Merged training API — action-based routing to stay within Hobby plan's 12-function limit
// POST: { action: "evaluate" | "generate-queue" | "seed-scenarios", ...params }

export const config = { maxDuration: 10 };

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, ...params } = req.body || {};

  switch (action) {
    case "evaluate":
      return handleEvaluate(params, res);
    case "generate-queue":
      return handleGenerateQueue(params, res);
    case "seed-scenarios":
      return handleSeedScenarios(params, res);
    case "sync-notion":
      return handleSyncNotion(params, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}. Use evaluate, generate-queue, seed-scenarios, or sync-notion.` });
  }
}

// ─── EVALUATE ───────────────────────────────────────────

async function handleEvaluate({ scenarioId, responseText, conversationHistory }, res) {
  if (!scenarioId || !responseText) {
    return res.status(400).json({ error: "Missing scenarioId or responseText" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const { data: scenario, error: scenarioErr } = await supabase
      .from("sm_scenarios")
      .select("*, unit:sm_units(*)")
      .eq("id", scenarioId)
      .single();

    if (scenarioErr || !scenario) {
      return res.status(404).json({ error: "Scenario not found" });
    }

    // Check for Mike's calibration response for this scenario
    const { data: calibration } = await supabase
      .from("sm_calibrations")
      .select("response_text")
      .eq("scenario_id", scenarioId)
      .limit(1)
      .single();

    const systemPrompt = buildSystemPrompt(scenario, calibration?.response_text);

    let userMessage = `TRAINEE'S RESPONSE:\n${responseText}`;
    if (conversationHistory && conversationHistory.length > 0) {
      const convoText = conversationHistory
        .map((m) => `${m.role === "user" ? "SM" : "Character"}: ${m.content}`)
        .join("\n");
      userMessage = `CONVERSATION:\n${convoText}\n\n---\n\nPlease evaluate the SM's performance in this conversation.`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(502).json({ error: "AI evaluation failed" });
    }

    const result = await response.json();
    const rawText = result.content?.[0]?.text || "";

    let evaluation;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawText);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", rawText);
      evaluation = {
        score: 5,
        tldr: "Evaluation returned but couldn't be parsed",
        feedback: rawText,
        ideal_comparison: "",
        strengths: [],
        gaps: [],
        tags_demonstrated: [],
        tags_weak: [],
      };
    }

    return res.status(200).json(evaluation);
  } catch (err) {
    console.error("Evaluation error:", err?.message || "unknown");
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── GENERATE QUEUE ─────────────────────────────────────

async function handleGenerateQueue({ userId }, res) {
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    let { data: session } = await supabase
      .from("sm_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (!session) {
      const { data: newSession, error } = await supabase
        .from("sm_sessions")
        .insert({ user_id: userId, date: today })
        .select()
        .single();
      if (error) throw error;
      session = newSession;
    }

    const { data: existingQueue } = await supabase
      .from("sm_daily_queue")
      .select("id")
      .eq("session_id", session.id)
      .limit(1);

    if (existingQueue && existingQueue.length > 0) {
      return res.status(200).json({ message: "Queue already exists", sessionId: session.id });
    }

    const { data: progressData } = await supabase
      .from("sm_progress")
      .select("weak_tags, unit_id, status")
      .eq("user_id", userId);

    const weakTags = (progressData || [])
      .flatMap((p) => p.weak_tags || [])
      .filter(Boolean);

    const currentUnit = (progressData || []).find((p) => p.status === "in_progress");
    const completedUnits = (progressData || []).filter((p) => p.status === "completed" || p.status === "certified");

    const { data: allScenarios } = await supabase
      .from("sm_scenarios")
      .select("id, unit_id, type, tags, difficulty")
      .eq("is_active", true);

    if (!allScenarios || allScenarios.length === 0) {
      return res.status(200).json({ message: "No scenarios available", sessionId: session.id });
    }

    const quickFires = allScenarios.filter((s) => s.type === "quick_fire");
    const deepSits = allScenarios.filter((s) => s.type === "deep_situation");

    const qfQueue = buildQuickFireQueue(quickFires, weakTags, currentUnit?.unit_id, completedUnits.map((u) => u.unit_id));
    const dsQueue = buildDeepSitQueue(deepSits, weakTags, currentUnit?.unit_id, completedUnits.map((u) => u.unit_id));

    const fullQueue = [...qfQueue, ...dsQueue];

    const queueItems = fullQueue.map((scenarioId, idx) => ({
      user_id: userId,
      session_id: session.id,
      scenario_id: scenarioId,
      type: idx < qfQueue.length ? "quick_fire" : "deep_situation",
      queue_order: idx + 1,
    }));

    if (queueItems.length > 0) {
      const { error: insertError } = await supabase.from("sm_daily_queue").insert(queueItems);
      if (insertError) throw insertError;
    }

    return res.status(200).json({
      message: "Queue generated",
      sessionId: session.id,
      quickFireCount: qfQueue.length,
      deepSituationCount: dsQueue.length,
    });
  } catch (err) {
    console.error("Queue generation error:", err?.message || "unknown");
    return res.status(500).json({ error: "Failed to generate queue" });
  }
}

// ─── SEED SCENARIOS ─────────────────────────────────────

async function handleSeedScenarios({ unitId, seedAll }, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    let units = [];

    if (seedAll) {
      const { data } = await supabase.from("sm_units").select("*").eq("is_active", true);
      units = data || [];
    } else if (unitId) {
      const { data } = await supabase.from("sm_units").select("*").eq("id", unitId).single();
      if (data) units = [data];
    } else {
      return res.status(400).json({ error: "Provide unitId or seedAll:true" });
    }

    if (units.length === 0) {
      return res.status(404).json({ error: "No units found. Seed units first." });
    }

    const results = [];

    for (const unit of units) {
      // Build sub-topics section if available
      const subTopicsText = (unit.sub_topics && unit.sub_topics.length > 0)
        ? `\nSUB-TOPICS TO COVER (distribute scenarios across these):\n${unit.sub_topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
        : "";

      const prompt = `Generate training scenarios for a basketball academy Scaling Manager (SM) training system.

IMPORTANT CONTEXT — WHO THE SM IS:
A Scaling Manager (SM) is a consultant/coach who gets on weekly calls with basketball academy OWNERS. The SM helps the owner grow their business — pricing, sales, retention, hiring, operations, etc. The SM is NOT the owner. The SM advises, guides, and holds the owner accountable.

EVERY scenario must be written FROM THE SM's PERSPECTIVE — they are on a coaching call with an academy owner (their client), and a situation comes up that they need to handle. The SM is the one giving advice, asking questions, and guiding the owner.

UNIT: ${unit.title}
DESCRIPTION: ${unit.description}
${subTopicsText}

Generate exactly:
- 10 quick-fire scenarios (short situational questions the SM must answer in 60-90 seconds)
- 5 deep-situation scenarios (multi-turn role-play conversations)

CRITICAL RULES:
- Every scenario must test CRITICAL THINKING, JUDGMENT, and DECISION-MAKING — not math or calculations.
- NEVER ask "calculate X", "what's the revenue impact", "how much would you charge", or any question where the answer is primarily a number.
- Instead, ask "what would you DO", "how would you handle this", "what's your approach", "what do you say".
- NEVER write scenarios from the perspective of someone MANAGING SMs. The trainee IS the SM.

MIX THREE SCENARIO TYPES (roughly equal distribution across the 15):
1. CLIENT COACHING (5-6 scenarios): You're on a call with an academy owner coaching them. Frame as: "You're on your weekly call with [owner name]. They tell you [situation]. How do you respond?" or "Mid-call, [owner] pushes back and says [objection]. What do you say?"
2. YOUR OWN ACADEMY (5-6 scenarios): This problem happens to YOU at your own academy. Most SMs also run their own academies. Frame as: "You notice [problem] happening at your academy. What do you do?" or "A parent at your academy [situation]. How do you handle it?" or "Your [staff/schedule/pricing] has [issue]. What's your move?"
3. GENERAL KNOWLEDGE (3-4 scenarios): Test understanding of BAM concepts and principles. Frame as: "What's the BAM approach to [concept]?" or "Explain why [principle] matters and how you'd implement it." or "What are the key things to consider when [situation]?"

Use real-world messiness: owners who won't raise prices, owners doing everything themselves, owners who ignore advice, owners with no SOPs, parents who push back, staff issues, etc.

For EACH scenario, provide:
- title: short descriptive title
- prompt: the scenario text (2-4 sentences for quick-fire, 3-6 sentences for deep situations). Frame as YOU (the SM) are on a call or preparing for one.
- context: any additional context (optional, null if not needed)
- difficulty: 1-5 (mix of difficulties)
- ideal_response: what a great SM would do/say (2-3 sentences focusing on the APPROACH, not a number)
- tags: array of 2-4 competency tags from: pricing_strategy, objection_handling, parent_communication, value_positioning, retention_strategy, churn_prevention, coach_management, scheduling, operations, client_success, sales_process, team_building, delegation, accountability, strategic_thinking, culture_building, onboarding, lead_qualification, referral_systems, hiring
- visual_type: one of "none", "email", "text_thread" (use "none" for most, but include 2-3 with email or text_thread visuals showing realistic owner messages the SM must respond to)
- visual_data: if visual_type is not "none", provide structured data. For email: { from, to, subject, body, date }. For text_thread: { messages: [{from: "them"|"me", name, text}] }.
- character_prompt: (deep situations only) role-play instructions for the AI character (the owner the SM is coaching)

Return a JSON object with:
{
  "quick_fire": [array of 10 scenarios],
  "deep_situation": [array of 5 scenarios]
}

IMPORTANT: Return ONLY the JSON object, no other text or markdown code blocks.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Seed failed for ${unit.title}:`, errText);
        results.push({ unit: unit.title, error: "AI generation failed" });
        continue;
      }

      const result = await response.json();
      const rawText = result.content?.[0]?.text || "";

      let scenarios;
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        scenarios = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawText);
      } catch (e) {
        console.error(`Parse failed for ${unit.title}:`, rawText.slice(0, 200));
        results.push({ unit: unit.title, error: "Failed to parse AI response" });
        continue;
      }

      let inserted = 0;
      for (const type of ["quick_fire", "deep_situation"]) {
        const items = scenarios[type] || [];
        for (const s of items) {
          const { error: insertErr } = await supabase.from("sm_scenarios").insert({
            unit_id: unit.id,
            type,
            difficulty: s.difficulty || 3,
            title: s.title,
            prompt: s.prompt,
            context: s.context || null,
            visual_type: s.visual_type || "none",
            visual_data: s.visual_data || null,
            ideal_response: s.ideal_response || null,
            scoring_rubric: null,
            follow_ups: null,
            character_prompt: s.character_prompt || null,
            tags: s.tags || [],
            is_active: true,
          });
          if (!insertErr) inserted++;
        }
      }

      results.push({ unit: unit.title, inserted });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("Seed error:", err?.message || "unknown");
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── SYNC TO NOTION ─────────────────────────────────────

const NOTION_DB_ID = "50cdf4e2-e31d-47e9-902f-79aca146ce9f";

const UNIT_SLUG_TO_NOTION = {
  "sm-identity": "SM Identity",
  "pricing-revenue": "Pricing & Revenue",
  "sales-conversion": "Sales & Conversion",
  "retention-churn": "Retention & Churn",
  "hiring-delegation": "Hiring & Delegation",
  "operations-systems": "Operations & Systems",
};

async function handleSyncNotion({ userId, scenarioId }, res) {
  const notionKey = process.env.NOTION_API_KEY;
  if (!notionKey) {
    return res.status(500).json({ error: "NOTION_API_KEY not configured. Add it to Vercel env vars." });
  }

  try {
    // Build query — sync all unsynced calibrations, or just one specific scenario
    let query = supabase
      .from("sm_calibrations")
      .select("*, scenario:sm_scenarios(*, unit:sm_units(title, slug, icon))")
      .eq("notion_synced", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (scenarioId) {
      query = supabase
        .from("sm_calibrations")
        .select("*, scenario:sm_scenarios(*, unit:sm_units(title, slug, icon))")
        .eq("scenario_id", scenarioId)
        .order("created_at", { ascending: false })
        .limit(1);
    }

    const { data: calibrations, error: calErr } = await query;
    if (calErr) throw calErr;

    if (!calibrations || calibrations.length === 0) {
      return res.status(200).json({ message: "Nothing to sync", synced: 0 });
    }

    // Get user display names
    const userIds = [...new Set(calibrations.map(c => c.user_id))];
    const { data: users } = await supabase
      .from("sm_user_roles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    const nameMap = {};
    for (const u of (users || [])) nameMap[u.user_id] = u.display_name || "Unknown";

    let synced = 0;
    for (const cal of calibrations) {
      const scenario = cal.scenario || {};
      const unit = scenario.unit || {};
      const unitLabel = UNIT_SLUG_TO_NOTION[unit.slug] || "SM Identity";
      const tags = (scenario.tags || []).filter(t => [
        "real_world", "lead_added", "pricing", "retention", "sales", "hiring", "operations", "mindset"
      ].includes(t));

      const notionBody = {
        parent: { database_id: NOTION_DB_ID },
        properties: {
          "Problem": { title: [{ text: { content: (scenario.prompt || "").slice(0, 2000) } }] },
          "Solution": { rich_text: [{ text: { content: (cal.response_text || "").slice(0, 2000) } }] },
          "Unit": { select: { name: unitLabel } },
          "Tags": { multi_select: tags.map(t => ({ name: t })) },
          "Difficulty": { select: { name: String(scenario.difficulty || 3) } },
          "Added By": { rich_text: [{ text: { content: nameMap[cal.user_id] || "Lead SM" } }] },
          "Source": { select: { name: scenario.tags?.includes("lead_added") ? "Real-Time Capture" : "Calibration" } },
        },
      };

      const notionRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${notionKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify(notionBody),
      });

      if (notionRes.ok) {
        // Mark as synced
        await supabase
          .from("sm_calibrations")
          .update({ notion_synced: true })
          .eq("id", cal.id);
        synced++;
      } else {
        const errText = await notionRes.text();
        console.error("Notion sync failed for cal:", cal.id, errText);
      }
    }

    return res.status(200).json({ message: `Synced ${synced} calibrations to Notion`, synced });
  } catch (err) {
    console.error("Notion sync error:", err?.message || "unknown");
    return res.status(500).json({ error: "Failed to sync to Notion" });
  }
}

// ─── HELPERS ────────────────────────────────────────────

function buildSystemPrompt(scenario, calibrationResponse = null) {
  const unit = scenario.unit || {};
  const rubric = scenario.scoring_rubric
    ? JSON.stringify(scenario.scoring_rubric, null, 2)
    : "Score holistically on: technical knowledge, communication quality, problem-solving approach, and alignment with BAM philosophy.";

  const unitPhilosophy = getUnitPhilosophy(unit.slug);

  return `You are a training evaluator for BAM Business, a basketball academy consulting organization. You are evaluating a Scaling Manager (SM) trainee's response to a business scenario.

CONTEXT: An SM is a consultant who coaches basketball academy OWNERS on weekly calls. The SM helps owners grow their business — pricing, sales, retention, hiring, operations. Most SMs also run their own academies. Scenarios come in three flavors: (1) coaching an academy owner on a call, (2) handling a problem at their own academy, or (3) general knowledge of BAM principles. Evaluate accordingly — the SM should show real-world judgment and BAM philosophy regardless of the scenario type.

BAM BUSINESS CORE PRINCIPLES:
- Speed to lead: respond to new leads immediately
- Let them sell themselves: question-based selling, never explain — guide
- Executing vs. Steering: most owners are busy but have no strategic direction
- Identify the core constraint: always find the single biggest bottleneck first
- Camps are paid lead magnets: you get paid to advertise yourself
- SOPs are everything: document processes, make yourself replaceable in the day-to-day
- 3 Content Buckets: Educational, Entertainment, Selling/Pain Points — most are weak on bucket 3
- Hiring = Client Acquisition: same 4 P's framework (Product, Price, Place, Promotion)

UNIT: ${unit.title || "General"}
UNIT CONTEXT: ${unit.description || ""}
${unitPhilosophy ? `\nBAM PHILOSOPHY FOR THIS UNIT:\n${unitPhilosophy}` : ""}

SCENARIO: ${scenario.title}
${scenario.prompt}

${scenario.context ? `ADDITIONAL CONTEXT: ${scenario.context}` : ""}

SCORING RUBRIC:
${rubric}

${scenario.ideal_response ? `IDEAL RESPONSE DIRECTION:\n${scenario.ideal_response}` : ""}
${calibrationResponse ? `\nGOLD-STANDARD RESPONSE (from Lead SM — this is what a 10/10 answer looks like):\n${calibrationResponse}\n\nUse this gold-standard response as the PRIMARY benchmark when scoring. The closer the trainee's response aligns with this approach, reasoning, and tone, the higher the score.` : ""}

Evaluate the trainee's response and return a JSON object:
{
  "score": <1-10>,
  "tldr": "<one sentence summary of their answer quality - this is what the Lead SM sees in their review feed, make it punchy and honest>",
  "feedback": "<2-3 paragraphs of detailed feedback. Start with what they got right. Then what they missed or could improve. End with the key principle they should internalize.>",
  "ideal_comparison": "<1 paragraph comparing their answer to the ideal approach>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "gaps": ["<gap 1>", "<gap 2>"],
  "tags_demonstrated": ["<tag1>", "<tag2>"],
  "tags_weak": ["<tag1>"]
}

Be direct and honest. Don't sugarcoat. These are future business operators — they need real feedback. But be constructive, not discouraging. Think of yourself as a tough but invested mentor.

IMPORTANT: Return ONLY the JSON object, no other text.`;
}

const UNIT_PHILOSOPHY = {
  "sm-identity": `You are a Business Doctor — diagnose the constraint, don't spray advice. Frame as "our experience" not personal opinion. Fractional COO mindset. Confidence on calls even without the answer — "let me look into that" is always valid. 24-hour response standard. Diagnosing before prescribing. 3-strike accountability framework. Executing vs. Steering — identify which mode the client is stuck in. Only the owner on calls.`,

  "pricing-revenue": `3x3 pricing matrix: 3 frequency tiers × 3 payment options. Price spacing makes the target tier feel like a steal (anchor principle). Commitment agreements are SEPARATE from pricing. Never fold when clients push back on terms — reframe. Legacy pricing needs a migration plan. Proactive discounting kills perceived value. Camps = paid lead magnets with wave pricing. Capacity = coaches × time slots × group size. When at capacity, raise prices or add sessions — never cram.`,

  "sales-conversion": `Speed to lead. ALWAYS sell on phone calls, never text. Discovery calls before trials took show rates from 30% to 80-100%. Question-based selling — let the parent arrive at the conclusion themselves. Never explain, never pitch — diagnose instead. Elongate the pain before offering the solution. Pre-handle the partner objection. Parents are the buyer, not the player. Close on the spot when energy is high, create deadlines when it's not.`,

  "retention-churn": `Retention starts at onboarding — the first 30 days make or break it. Seasonal churn is predictable — keep ads running through slow months (DA Hoops case study). Never turn off ads during churn — it creates a bigger hole. Check-in cadence: touch members before they go quiet. Cancellation saves happen on the phone — redirect, reframe, offer alternatives. Track churn religiously. Sometimes churn is actually a product problem.`,

  "hiring-delegation": `Solo operator ceiling at 35-45 members. Intern pipeline = first hire strategy. Hiring IS client acquisition — same 4 P's. Define the role and build the SOP BEFORE hiring. Look for coachability over experience. SOPs are everything — Loom over Canva. Delegation = tangible responsibilities with clear SOPs, not titles. Slow to hire, quick to fire. Staff accountability through documented standards, not micromanagement.`,

  "operations-systems": `BAM tech stack: FullControl (primary OS), GHL (CRM/automations), Stripe (payments). Pull meaningful data before every call — never go in blind. Pipeline hygiene: clean tags, accurate stages, proper flow. Common automation failures: misfires, double texts, wrong tags, 2 AM sends. Executing vs. Steering audit: map weekly tasks, categorize each. Block 1hr/week minimum for strategic thinking. Document everything that repeats.`,
};

function getUnitPhilosophy(slug) {
  return UNIT_PHILOSOPHY[slug] || null;
}

function buildQuickFireQueue(scenarios, weakTags, currentUnitId, completedUnitIds) {
  if (scenarios.length === 0) return [];
  const target = 10;
  const queue = [];

  if (weakTags.length > 0) {
    const weakScenarios = scenarios.filter((s) => s.tags && s.tags.some((t) => weakTags.includes(t)));
    queue.push(...pickRandom(weakScenarios, 6));
  }

  if (currentUnitId) {
    const unitScenarios = scenarios.filter((s) => s.unit_id === currentUnitId && !queue.includes(s.id));
    queue.push(...pickRandom(unitScenarios, 3));
  }

  if (completedUnitIds.length > 0) {
    const reviewScenarios = scenarios.filter((s) => completedUnitIds.includes(s.unit_id) && !queue.includes(s.id));
    queue.push(...pickRandom(reviewScenarios, 1));
  }

  if (queue.length < target) {
    const remaining = scenarios.filter((s) => !queue.includes(s.id));
    queue.push(...pickRandom(remaining, target - queue.length));
  }

  return shuffle(queue).slice(0, target);
}

function buildDeepSitQueue(scenarios, weakTags, currentUnitId, completedUnitIds) {
  if (scenarios.length === 0) return [];
  const target = 3;
  const queue = [];

  if (weakTags.length > 0) {
    const weakScenarios = scenarios.filter((s) => s.tags && s.tags.some((t) => weakTags.includes(t)));
    queue.push(...pickRandom(weakScenarios, 1));
  }

  if (currentUnitId) {
    const unitScenarios = scenarios.filter((s) => s.unit_id === currentUnitId && !queue.includes(s.id));
    queue.push(...pickRandom(unitScenarios, 1));
  }

  if (completedUnitIds.length > 0) {
    const reviewScenarios = scenarios.filter((s) => completedUnitIds.includes(s.unit_id) && !queue.includes(s.id));
    queue.push(...pickRandom(reviewScenarios, 1));
  }

  if (queue.length < target) {
    const remaining = scenarios.filter((s) => !queue.includes(s.id));
    queue.push(...pickRandom(remaining, target - queue.length));
  }

  return shuffle(queue).slice(0, target);
}

function pickRandom(scenarios, count) {
  const shuffled = [...scenarios].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((s) => s.id);
}

function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
