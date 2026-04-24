// SM Training Units Configuration — BAM SM Curriculum
// 6 Units · 99 Sub-Topics · Scenario-Based Training
// Source: Mike's BAM_SM_Curriculum.docx

export const UNITS = [
  {
    title: "Who You Need to BE as an SM",
    slug: "sm-identity",
    order: 1,
    icon: "🩺",
    description: "The Business Doctor identity, SM mindset, accountability, and call presence.",
    unlockAfter: null,
    subTopics: [
      "The Business Doctor identity — your job is to find the constraint, not give advice",
      "The fractional COO mindset — you're not a coach, you're an operator",
      "\"Our experience\" framing vs. speaking from personal opinion",
      "Confidence on calls even when you don't have the answer",
      "24-hour response standard and what it signals to clients",
      "Diagnosing before prescribing — never jump to solutions",
      "Holding clients accountable without apologizing for it",
      "The 3-strike accountability framework",
      "Speed to lead as a general urgency mindset",
      "Staying composed when a client is frustrated or resistant",
      "Executing vs. Steering — identifying which mode a client is stuck in",
      "Only the owner on calls — why staff presence changes the dynamic and when exceptions apply",
      "KPI definitions and benchmarks — what every key metric means and what good looks like",
    ],
    bamPhilosophy: `
You are a Business Doctor. Your job is to diagnose the constraint — the ONE thing holding this client back — not spray advice. Never prescribe before you diagnose. Ask questions, listen for the real problem underneath the stated problem, then direct.

Frame everything as "our experience" or "what we've seen work" — never personal opinion. You are a fractional COO operating from a position of authority backed by data across 100+ academies.

Confidence on calls is non-negotiable. If you don't know the answer, say "let me look into that and get back to you within 24 hours" — never guess, never hedge, never fill silence with fluff. The 24-hour response standard signals professionalism and urgency.

Accountability is the job. Use the 3-strike framework: Strike 1 = direct conversation ("this was due, it's not done, what happened?"). Strike 2 = escalation ("this is a pattern, here's what needs to change by [date]"). Strike 3 = hard conversation about fit. Never apologize for holding someone to the standard they agreed to.

Executing vs. Steering: most clients are drowning in tasks (executing) but have zero strategic direction (steering). Your job is to identify which mode they're stuck in and pull them toward balance. ProBound had 40 executing tasks and 3 steering tasks — busy every day, going nowhere.

Only the owner should be on BAM calls. Staff presence changes the dynamic — the owner holds back, filters, performs. Exceptions exist but they're rare and intentional.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.15,
      communication: 0.35,
      problem_solving: 0.25,
      bam_alignment: 0.25,
    },
  },
  {
    title: "Pricing & Revenue Structure",
    slug: "pricing-revenue",
    order: 2,
    icon: "💰",
    description: "Pricing architecture, tier strategy, commitment agreements, capacity, and revenue diagnosis.",
    unlockAfter: "sm-identity",
    subTopics: [
      "Identifying when a client is underpriced relative to their value",
      "How to have the pricing conversation without the client getting defensive",
      "Building the 3-tier frequency structure (1x/week, 2x/week, unlimited)",
      "Building the 3-payment option structure (monthly, 3-month upfront, 6-month upfront)",
      "How the 3x3 pricing matrix works together as a system",
      "How your prices dictate where members land — intentional price architecture",
      "Using price spacing to make your target tier look like a steal (the anchor principle)",
      "Knowing when a client needs to change their price points",
      "What a strong SPP looks like and how to evaluate it",
      "Commitment agreements — why they matter and how to sell the client on implementing them",
      "Handling conflict when a client pushes back on commitment terms — why you don't fold and how to reframe",
      "Handling client resistance to raising prices (\"my parents will leave\")",
      "The clinic-to-academy pricing anchor problem",
      "Legacy pricing — clients with old members on outdated rates",
      "When and how to grandfather vs. migrate existing members to new pricing",
      "Proactive discounting — why offering discounts before they're needed kills perceived value",
      "Camp and event wave pricing — how to structure early bird vs. standard vs. late pricing",
      "How to define and calculate true capacity (coaches x time slots x group size)",
      "What to do when approaching or at capacity — the right levers vs. the wrong ones",
      "Reading a client's current revenue structure and diagnosing the gap",
    ],
    bamPhilosophy: `
Pricing reflects value delivered, not market average. An academy that competes on price dies on price.

The 3x3 pricing matrix: 3 frequency tiers (1x/week, 2x/week, unlimited) × 3 payment options (monthly, 3-month, 6-month). This creates a system where your prices dictate where members land. Space them so the target tier feels like the obvious choice — anchor high with expensive options so the standard feels like a steal.

Commitment agreements are SEPARATE from pricing tiers — even monthly payers need a minimum commitment period. When clients push back ("my parents will leave"), don't fold. Reframe: "The parents who leave over a 3-month commitment were never going to stay anyway."

Legacy pricing is a trap. Clients with old members on outdated rates need a migration plan — either grandfather with a sunset date or migrate in waves. Never let legacy rates drag down the business forever.

Proactive discounting kills perceived value. Never offer a discount before it's asked for. D Coop ran clinics at $275/8 sessions, then couldn't convert parents to academy at $225/4 because the promo anchor was too low.

Camps are paid lead magnets — you get paid to advertise yourself. Use wave pricing: early bird, standard, late. 50% current members, 25% outsiders, 25% referrals.

Capacity = coaches × time slots × group size. When approaching capacity, the right lever is raising prices or adding sessions, NOT cramming more bodies into existing groups.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.3,
      communication: 0.25,
      problem_solving: 0.25,
      bam_alignment: 0.2,
    },
  },
  {
    title: "Sales & Conversion",
    slug: "sales-conversion",
    order: 3,
    icon: "🎯",
    description: "Lead handling, discovery calls, objection handling, trial conversion, and closing.",
    unlockAfter: "pricing-revenue",
    subTopics: [
      "The free trial as a sales tool — how most clients are doing it wrong",
      "Why discovery calls before trials dramatically improve show rates",
      "How to structure a discovery call (what to ask, what to listen for)",
      "Question-based selling — letting the parent arrive at the conclusion themselves",
      "Never explain, never pitch — how to diagnose instead of sell",
      "Why text-based selling doesn't work and how to move leads to the phone",
      "Handling leads that go cold over text",
      "Speed to lead in the sales context — what happens when you wait",
      "Two levers to increase show rate — increasing friction for higher quality leads vs. more aggressive pre-call follow up",
      "Handling price objections (that are actually money objections in disguise)",
      "Handling feature objections (\"do you have X?\" — actually a money objection)",
      "Handling the partner objection (\"I need to talk to my husband/wife\")",
      "Pre-handling the partner objection during the discovery call — asking upfront if all decision makers will be present",
      "Handling prospect resistance to commitment before trial — how to hold the term without killing the close",
      "Parents as the actual buyer — how to sell to the parent not the player",
      "Getting the trial to show up — confirmation sequences and pre-trial communication",
      "Trial-to-member conversion conversation — what to say and when",
      "Knowing what good conversion rates look like based on lead source (warm vs. cold)",
      "The VSL — when to use it and what it should cover before a trial",
      "Closing on the spot vs. giving time — how to read the room and when to push vs. pull back",
    ],
    bamPhilosophy: `
Speed to lead. Call new leads immediately — every minute you wait, conversion drops. ALWAYS sell on phone calls, never text. Text is for logistics; phone is for closing.

Discovery calls before trials took show rates from 30% to 80-100% at Prime By Design. The discovery call structure: qualify the lead, identify their pain, elongate it, then offer the trial as the next step — not the solution.

Question-based selling: let the parent arrive at the conclusion themselves. Never explain, never pitch. Ask questions that guide them down your line. Only make statements when they go off-track. Pattern interrupt when confused: "Can I help you with something?" Then reframe from expert position.

Pain, pain, pain. Elongate the pain before offering the solution. "We'll wait till after spring break" or "let me think about it" = money objection in disguise. Pre-sign with deposit, create urgency around capacity.

The partner objection: pre-handle it on the discovery call. "Will all the decision-makers be at the trial?" If not, reschedule. Don't waste a trial on someone who can't say yes.

Parents are the buyer. Sell to the parent, not the player. The parent cares about development, accountability, and structure — not how cool the drills look.

Closing on the spot vs. giving time: read the room. If the energy is high and the parent is nodding, close NOW. If they're hesitant, create a deadline ("we have 2 spots left this month") and follow up within 24 hours.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.2,
      communication: 0.3,
      problem_solving: 0.25,
      bam_alignment: 0.25,
    },
  },
  {
    title: "Retention & Churn",
    slug: "retention-churn",
    order: 4,
    icon: "🤝",
    description: "Churn patterns, onboarding, cancellation saves, reactivation, and referral programs.",
    unlockAfter: "sales-conversion",
    subTopics: [
      "The difference between churn and seasonal pause — how to read which one you're dealing with",
      "Seasonal churn patterns (high school season, holidays, summer travel) — how to anticipate and prepare",
      "Why running ads through slow months is the single best churn defense — DA Hoops as the case study",
      "When churn rises and ads are the main acquisition channel — why you don't panic and never turn them off",
      "The \"turning off ads during churn\" trap — how it creates a bigger hole than the churn itself",
      "Building a structured member onboarding experience — what the first 30 days should look like",
      "Check-in cadence — how and when to proactively touch members before they go quiet",
      "Identifying churn risk early — the signals that someone is about to leave",
      "Redirecting a cancellation to a pause — how to get on the phone and save the membership",
      "How to have the live cancellation conversation — reframing, creative solutions, what to say",
      "Pause mechanics — how to handle mid-cycle pauses, billing alignment, and return dates",
      "Reactivation campaigns — how to systematically bring back inactive and lapsed members",
      "Cleaning and tagging the contact list — why accurate active/inactive data is the foundation of reactivation",
      "Referral programs — why every client has one informally and nobody promotes it",
      "How to build and activate a referral program that actually runs",
      "Commitment agreements as a retention tool — not just a pricing play",
      "When a client's churn problem is actually a product problem",
    ],
    bamPhilosophy: `
Retention starts at onboarding. If a client's first 30 days are confusing, unstructured, or impersonal — they're already halfway out the door. Build a standardized onboarding flow that makes every new member feel like they belong from day one.

Seasonal churn is predictable — high school season, holidays, summer travel. The academies that lose the least are the ones who plan for it. DA Hoops had their BEST revenue months during the traditionally slowest period because they kept ads running. The "turning off ads during churn" trap: you save $500/month on ads but lose $3,000 in new members who would have replaced the churn.

Never panic when churn rises. If ads are your main acquisition channel, turning them off during a churn spike creates a BIGGER hole — you lose the churned members AND the new ones who would have replaced them.

Check-in cadence: proactively touch members before they go quiet. The signals someone is about to leave: missed sessions, reduced frequency, stopped responding to texts, parent disengagement.

Cancellation saves happen on the phone, not over text. Redirect every cancellation request to a live conversation. Reframe: "Before we cancel, can I understand what's going on?" Offer a pause, offer a schedule change, offer a tier adjustment. Creative solutions save memberships.

Track churn religiously. ProBound had 30% churn in October and didn't even know it. Clean your contact list — accurate active/inactive tags are the foundation of any reactivation campaign.

Sometimes a churn problem is actually a product problem. If members are leaving because sessions are inconsistent, coaching is poor, or the experience doesn't match the price — no retention tactic fixes that.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.2,
      communication: 0.3,
      problem_solving: 0.25,
      bam_alignment: 0.25,
    },
  },
  {
    title: "Hiring & Delegation",
    slug: "hiring-delegation",
    order: 5,
    icon: "📋",
    description: "The solo operator ceiling, intern pipeline, SOPs, staff progression, and delegation.",
    unlockAfter: "retention-churn",
    subTopics: [
      "The solo operator ceiling — why every client hits a wall around 35-45 members and what it actually means",
      "Recognizing when a client is at the ceiling vs. just having a bad month",
      "The intern pipeline as the first hire strategy — why it works and how to build it",
      "How to recruit interns — posting, targeting local colleges, using ads for intern acquisition",
      "The full staff journey mirrors the full client journey — how marketing, sales, and client management map directly to announcing the job offer, interviewing, and training up staff",
      "Onboarding an intern — how to build them up one task at a time without overwhelming them",
      "Defining roles clearly before hiring — why most clients hire before they know what they need",
      "The difference between a task-taker and an A-player — what to look for and how to identify it",
      "Building SOPs so delegation is actually possible — Loom over Canva",
      "How to delegate without losing quality control",
      "When a client is the bottleneck — how to identify it and how to coach them out of it",
      "W2 vs. 1099 — what the difference is, when each makes sense, and how to guide a client on which to use",
      "Staff compensation structures — percentage vs. fixed, recurring vs. first month only",
      "When to go from intern to part-time to full-time — the progression and what triggers each stage",
      "Slow to hire, quick to fire — what this means in practice and how to coach clients on it",
      "Staff accountability — how to hold trainers to standards without the owner becoming a micromanager",
    ],
    bamPhilosophy: `
Every academy owner hits a solo operator ceiling around 35-45 members. They physically can't coach more sessions, answer more leads, AND run the business. If you haven't started the hiring pipeline by then, you're already behind.

The intern pipeline is the first hire strategy. Target local colleges within 30-minute radius. The full staff journey mirrors the client journey: announcing the role = marketing, interviewing = sales, training up = client management. Treat it with the same process and urgency.

Hiring IS client acquisition — same 4 P's framework. Product (the role), Price (compensation), Place (where to find candidates), Promotion (your vision that attracts talent).

Defining roles before hiring is critical. Most clients hire before they know what they need — they get a warm body and then figure out what to do with them. Write the job description FIRST, build the SOP FIRST, then hire someone to follow it.

SOPs are everything. Loom recordings over Canva presentations. The goal is to make the owner replaceable in the day-to-day. D Coop promoted Jake from intern to key operator — but it only worked because they documented processes Jake could follow independently.

Delegation isn't giving someone a title — it's giving them tangible responsibilities with clear SOPs. Danny promoted Jake but didn't give him actual new tasks for weeks. Vision without action items is meaningless.

Slow to hire, quick to fire — but start the pipeline NOW. Look for coachability over experience. Overqualified candidates who already have their own methods are harder to mold than raw talent you can develop.

Staff accountability: clear expectations, regular check-ins, documented standards. Hold trainers to the standard without micromanaging — SOPs are the guardrails that make this possible.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.2,
      communication: 0.3,
      problem_solving: 0.3,
      bam_alignment: 0.2,
    },
  },
  {
    title: "Operations & Systems",
    slug: "operations-systems",
    order: 6,
    icon: "⚙️",
    description: "Tech stack, dashboards, pipeline hygiene, automations, and strategic thinking time.",
    unlockAfter: "hiring-delegation",
    subTopics: [
      "Understanding the BAM tech stack — FullControl as the primary OS, GHL underneath, Stripe for payments",
      "FullControl fundamentals — how clients use it, how SMs use it, what lives where",
      "How to audit a client's operational setup — what healthy looks like vs. what broken looks like",
      "Reading dashboards and pulling meaningful data — what to look at before every call",
      "Member count accuracy — why the number is often wrong and how to reconcile across platforms",
      "Pipeline hygiene — keeping contacts, tags, and stages clean and accurate",
      "The free trial pipeline — how it should flow and what happens at each stage",
      "Common automation failures — misfires, double texts, wrong tags — and how to diagnose them",
      "Meta ad account setup — connecting Facebook/Instagram, common blocks and suspensions",
      "Stripe setup — separate accounts for separate revenue streams, how to guide a client through it",
      "The executing vs. steering audit — how to map a client's weekly tasks and identify wasted time",
      "Strategic thinking time — how to protect it and why most operators have none",
      "Building and maintaining SOPs — what needs to be documented and how to keep it current",
    ],
    bamPhilosophy: `
The BAM tech stack: FullControl is the primary OS that clients and SMs interact with. GHL (GoHighLevel) runs underneath for CRM, automations, and pipeline management. Stripe handles payments. The SM needs to understand all three layers.

Before every call, pull meaningful data from the dashboard. Know the member count (and verify it — the number is often wrong across platforms), pipeline status, churn trends, and revenue trajectory. Never go into a call blind.

Pipeline hygiene is foundational. Contacts, tags, and stages must be clean and accurate. If your CRM is a mess of outdated labels and wrong tags, every automation built on top of it will misfire. The free trial pipeline should flow clearly: lead → qualified → discovery call → trial booked → trial completed → converted or lost.

Common automation failures: misfires sending the wrong message at the wrong time, double texts from overlapping workflows, wrong tags triggering wrong sequences, automations firing at 2 AM. Set business hours (9am-9pm). Walk through every automation with the client — don't assume they understand it.

Executing vs. Steering is the #1 operational failure. Most owners spend ALL their time executing (filling the gas tank) but zero time steering (deciding where to drive). The audit: map a client's weekly tasks, categorize each as executing or steering. ProBound had 40 executing tasks and 3 steering tasks.

Block 1 hour per week minimum for CEO/strategic thinking time. Sundays. Look at numbers, identify the single biggest constraint, plan next moves. This is non-negotiable.

Build SOPs for everything that repeats. Document it, record it, make it followable by someone who isn't you. If it's not documented, it doesn't scale.
    `.trim(),
    scoringWeights: {
      technical_knowledge: 0.35,
      communication: 0.15,
      problem_solving: 0.3,
      bam_alignment: 0.2,
    },
  },
];

// Seed units into Supabase sm_units table
export async function seedUnits(supabase) {
  const results = [];
  for (const unit of UNITS) {
    // Resolve unlock_after slug to UUID
    let unlockAfterId = null;
    if (unit.unlockAfter) {
      const { data: prereq } = await supabase
        .from("sm_units")
        .select("id")
        .eq("slug", unit.unlockAfter)
        .single();
      if (prereq) unlockAfterId = prereq.id;
    }

    const { data, error } = await supabase
      .from("sm_units")
      .upsert(
        {
          title: unit.title,
          slug: unit.slug,
          order_index: unit.order,
          icon: unit.icon,
          description: unit.description,
          sub_topics: unit.subTopics,
          is_active: true,
          unlock_after: unlockAfterId,
        },
        { onConflict: "slug" }
      )
      .select()
      .single();

    results.push({ unit: unit.slug, data, error });
  }
  return results;
}

// Get unit config by slug (for AI prompt building)
export function getUnitConfig(slug) {
  return UNITS.find((u) => u.slug === slug) || null;
}
