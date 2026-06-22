// Shared: the agent autonomy mode for an academy. ONE switch (set by BAM staff)
// governs BOTH the Responded-stage reply bot AND the follow-up nudge engine.
//
//   off         → agent is silent; nothing drafts or sends.
//   hawkeye     → agent drafts every message; a human approves before it sends.
//   self_drive  → agent sends high-confidence messages itself; anything it's
//                 unsure about (low confidence or guardrail escalate) still
//                 lands in the approval inbox.
//
// Stored at clients.ghl_kpi_config.agent_mode. Legacy academies (set before this
// switch existed) fall back to the old per-engine booleans.

export const AGENT_MODES = ["off", "hawkeye", "self_drive"];

// Self-drive only sends on its own when the brain is at least this confident
// (0..1) AND not escalating. Everything else drops to the inbox for a human.
export const SELF_DRIVE_MIN_CONFIDENCE = 0.8;

export function agentMode(client) {
  const cfg = (client && client.ghl_kpi_config) || {};
  const m = cfg.agent_mode;
  if (AGENT_MODES.includes(m)) return m;
  // Legacy fallback: either engine flag on = treat as hawkeye (approve-each).
  return (cfg.agent_approvals_enabled || cfg.followup_engine_enabled) ? "hawkeye" : "off";
}

export const modeIsOn      = (mode) => mode === "hawkeye" || mode === "self_drive";
export const modeSelfDrives = (mode) => mode === "self_drive";

// Should this draft be auto-sent (self-drive) rather than queued for approval?
export function shouldAutoSend(mode, { confidence, escalate } = {}) {
  if (!modeSelfDrives(mode)) return false;
  if (escalate) return false;
  return typeof confidence === "number" && confidence >= SELF_DRIVE_MIN_CONFIDENCE;
}
