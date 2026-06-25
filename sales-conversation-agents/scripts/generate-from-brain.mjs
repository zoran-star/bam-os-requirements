// Generate the .txt prompt files FROM the live brain so they can never drift.
//
//   node scripts/generate-from-brain.mjs
//
// The brain (bam-portal/api/agent/prompt-structure.js) is the single source of
// truth for what actually runs. This emits two human-readable .txt files:
//   • conversation-ai-booking-agent.txt          — master template (FACT sections
//                                                   use {{PLACEHOLDER}}s)
//   • conversation-ai-booking-agent-bam-gta.txt  — BAM GTA instance (FACT sections
//                                                   filled with GTA values)
// BEHAVIOR sections are identical in both (academy-agnostic, fact-free).
//
// Edit the brain, then re-run this. Do NOT hand-edit the generated .txt files.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assemblePrompt } from "../../bam-ghl-agent/bam-portal/api/agent/prompt-structure.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..");

// Placeholder bodies for the master template's FACT sections. Behavior sections
// are NOT overridden here — they come straight from the brain (fact-free), so
// the master and the instance share the exact same behavior.
const MASTER_FACTS = {
  business_info: "Name: {{BUSINESS_NAME}}\nLocation: {{LOCATION_ADDRESS}}\nDirections: {{LOCATION_DIRECTIONS}}\nYears running: {{YEARS_RUNNING}}\nTrial booking link: {{TRIAL_BOOKING_LINK}}",
  schedule: "{{SCHEDULE}}\n\nHoliday schedule: {{HOLIDAY_SCHEDULE}}",
  coaches: "{{COACH_CREDENTIALS}}",
  social_proof: "{{REVIEW_PLATFORMS}}",
  selling_points: "These are the key differentiators for this academy. Weave them into responses when there is a natural opening. Only highlight one per message. Forcing multiple selling points into a single reply feels like a sales pitch.\n\n{{SELLING_POINTS}}",
  program: "Ages: {{AGE_RANGE}}\nSkill levels: {{SKILL_LEVELS}}\nGroup sizes: {{GROUP_SIZES}}\nCoach ratio: {{COACH_RATIO}}\nCo-ed or gendered: {{CO_ED_OR_GENDERED}}\nPrivate training: {{PRIVATE_TRAINING}}\nCamps/clinics: {{CAMPS_CLINICS}}\nAdult classes: {{ADULT_CLASSES}}",
  pricing: "Transparency mode: {{PRICING_TRANSPARENCY_MODE}}\n\nWhen the lead asks about pricing, follow the transparency mode strictly:\n- RANGE: Share the range ({{PRICING_RANGE}}) and say full details are covered at the trial.\n- EXACT: Share the full pricing details: {{PRICING_DETAILS}}\n- HIDDEN: Acknowledge the question warmly, then redirect to the trial.\n\nAdditional pricing info (mention only when relevant or asked):\n- Prepayment options: {{PREPAYMENT_OPTIONS}}\n- Sibling discount: {{SIBLING_DISCOUNT}}\n- Referral discount: {{REFERRAL_DISCOUNT}}\n- Payment methods: {{PAYMENT_METHODS}}",
  policies: "Cancel/pause: {{CANCEL_PAUSE_POLICY}}\nMakeup/reschedule: {{MAKEUP_RESCHEDULE_POLICY}}\nParent watching: {{PARENT_WATCHING_POLICY}}\nUnder-18 policy: {{UNDER_18_POLICY}}\nFlexibility: {{POLICY_FLEXIBILITY}}",
  qualification_config: "{{QUALIFICATION_DIMENSIONS}}",
};

const header = (title) =>
  `# ${title}\n` +
  `# GENERATED FROM bam-portal/api/agent/prompt-structure.js (the live brain).\n` +
  `# Do NOT hand-edit — change the brain, then run: node scripts/generate-from-brain.mjs\n` +
  `# BEHAVIOR sections are academy-agnostic + fact-free; FACT sections hold every value once.\n\n`;

writeFileSync(
  join(outDir, "conversation-ai-booking-agent.txt"),
  header("Booking agent — MASTER TEMPLATE ({{PLACEHOLDER}} facts)") + assemblePrompt(MASTER_FACTS) + "\n"
);
writeFileSync(
  join(outDir, "conversation-ai-booking-agent-bam-gta.txt"),
  header("Booking agent — BAM GTA INSTANCE (facts filled)") + assemblePrompt() + "\n"
);

// The CONFIRM agent (Scheduled-Trial stage). Shares the exact same FACT sections —
// only its BEHAVIOR differs — so the same MASTER_FACTS placeholders apply.
writeFileSync(
  join(outDir, "conversation-ai-confirm-agent.txt"),
  header("Confirm agent — MASTER TEMPLATE ({{PLACEHOLDER}} facts)") + assemblePrompt(MASTER_FACTS, "confirm") + "\n"
);
writeFileSync(
  join(outDir, "conversation-ai-confirm-agent-bam-gta.txt"),
  header("Confirm agent — BAM GTA INSTANCE (facts filled)") + assemblePrompt({}, "confirm") + "\n"
);

console.log("✓ Regenerated all 4 .txt prompt files (booking + confirm) from the brain.");
