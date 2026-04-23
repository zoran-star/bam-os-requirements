import { useState } from "react";
import { calcProgress, statusColor } from '../tokens/tokens';
const ONBOARDING_STAGES = [
  { group: "Sales Handover", tasks: ["Contract Signed", "Asana Created", "Software Setup"] },
  { group: "SM Intro",       tasks: ["SM Intro Call"] },
  { group: "Systems",        tasks: ["Systems Intro Call","Phone Number","Domain Added","Systems Initial Draft","Systems Final Draft","Additional Systems"] },
  { group: "Content",        tasks: ["Content Plan Reviewed"] },
  { group: "Paid Ads",       tasks: ["Ads Initial Draft","Ads Final Draft","Ads Running"] },
];
import ProgressBar from '../components/primitives/ProgressBar';

export function getClientCurrentPhase(checks) {
  let lastCompletedStage = null;
  let currentStage = null;
  for (let si = 0; si < ONBOARDING_STAGES.length; si++) {
    const offset = ONBOARDING_STAGES.slice(0, si).reduce((a, s) => a + s.tasks.length, 0);
    const stageChecks = checks.slice(offset, offset + ONBOARDING_STAGES[si].tasks.length);
    if (stageChecks.every(Boolean)) {
      lastCompletedStage = si;
    } else if (stageChecks.some(Boolean) || !currentStage) {
      currentStage = si;
      break;
    }
  }
  if (currentStage === null && lastCompletedStage !== null) {
    currentStage = Math.min(lastCompletedStage + 1, ONBOARDING_STAGES.length - 1);
  }
  return currentStage ?? 0;
}

export function getNextAction(client) {
  for (let si = 0; si < ONBOARDING_STAGES.length; si++) {
    const offset = ONBOARDING_STAGES.slice(0, si).reduce((a, s) => a + s.tasks.length, 0);
    for (let ti = 0; ti < ONBOARDING_STAGES[si].tasks.length; ti++) {
      if (!client.checks[offset + ti]) return ONBOARDING_STAGES[si].tasks[ti];
    }
  }
  return "All complete";
}

export default function OnboardingRow({ client, tokens, index, onClick, expanded, onToggle, onToggleCheck, onMoveToActive }) {
  const [hov, setHov] = useState(false);
  const pct = calcProgress(client.checks);
  const phaseIndex = getClientCurrentPhase(client.checks);
  const phaseName = ONBOARDING_STAGES[phaseIndex]?.group || "—";
  const nextAction = getNextAction(client);
  const sc = statusColor(client.healthStatus, tokens);
  const isBlocked = client.alerts.length > 0;

  const stageData = ONBOARDING_STAGES.map((stage, si) => {
    const offset = ONBOARDING_STAGES.slice(0, si).reduce((a, s) => a + s.tasks.length, 0);
    const stageChecks = client.checks.slice(offset, offset + stage.tasks.length);
    return {
      name: stage.group, done: stageChecks.every(Boolean),
      partial: !stageChecks.every(Boolean) && stageChecks.some(Boolean),
      completedCount: stageChecks.filter(Boolean).length, total: stage.tasks.length,
      tasks: stage.tasks, offset,
    };
  });

  return (
    <div style={{ animation: `cardIn 0.3s ease ${index * 40}ms both` }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onClick={() => onToggle(client.id)}
        style={{
          display: "flex", alignItems: "center",
          background: expanded ? tokens.surfaceAlt : hov ? tokens.surfaceEl : "transparent",
          borderRadius: expanded ? "14px 14px 0 0" : 14,
          cursor: "pointer", transition: "all 0.15s",
          padding: "18px 24px", gap: 20,
          borderLeft: `3px solid ${sc}`,
        }}
      >
        {/* Client */}
        <div style={{ width: 210, minWidth: 210, flexShrink: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 600, color: tokens.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            lineHeight: 1.3, letterSpacing: "-0.01em",
          }}>{client.name}</div>
          <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 4 }}>
            {client.manager}
          </div>
        </div>

        {/* Progress */}
        <div style={{ width: 130, minWidth: 130, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
            <span style={{
              fontSize: 26, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1,
              color: pct >= 70 ? tokens.green : pct >= 40 ? tokens.accent : tokens.red,
            }}>{pct}</span>
            <span style={{ fontSize: 13, color: tokens.textMute, fontWeight: 400 }}>%</span>
          </div>
          <ProgressBar pct={pct} tokens={tokens} delay={index * 80 + 100} height={4} />
        </div>

        {/* Phase */}
        <div style={{ width: 120, minWidth: 120, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{phaseName}</div>
          <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 3 }}>
            {phaseIndex + 1} of {ONBOARDING_STAGES.length}
          </div>
        </div>

        {/* Blocker / next action */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isBlocked ? (
            <span style={{ fontSize: 14, fontWeight: 500, color: sc }}>
              {client.alerts[0]}
              {client.alerts.length > 1 && (
                <span style={{ opacity: 0.5, fontWeight: 400 }}>{" "}+{client.alerts.length - 1}</span>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 14, color: tokens.textSub }}>
              {nextAction}
            </span>
          )}
        </div>

        {/* Activity */}
        <div style={{ width: 70, textAlign: "right", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: tokens.textMute }}>{client.lastActivity}</span>
        </div>

        {/* Open modal */}
        <div
          onClick={e => { e.stopPropagation(); onClick(client); }}
          style={{
            width: 28, height: 28, borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: hov ? tokens.accent : tokens.textMute,
            cursor: "pointer", transition: "color 0.12s", flexShrink: 0,
            fontSize: 14,
          }}
        >{"\u2192"}</div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div style={{
          background: tokens.surfaceEl, borderRadius: "0 0 14px 14px",
          padding: "4px 24px 24px 27px", borderLeft: `3px solid ${sc}`,
          animation: "cardIn 0.2s ease both",
        }}>
          {/* Stage pipeline */}
          <div style={{ display: "flex", gap: 3, marginBottom: 24, paddingTop: 8 }}>
            {stageData.map((stage, si) => (
              <div key={si} style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  height: 5, borderRadius: 3, marginBottom: 10,
                  background: stage.done ? tokens.green : stage.partial ? tokens.accent : tokens.borderMed,
                }} />
                <div style={{
                  fontSize: 12, fontWeight: 600, marginBottom: 2,
                  color: stage.done ? tokens.green : si === phaseIndex ? tokens.text : tokens.textMute,
                }}>{stage.name}</div>
                <div style={{ fontSize: 12, color: tokens.textMute }}>{stage.completedCount}/{stage.total}</div>
              </div>
            ))}
          </div>

          {/* Remaining tasks — clickable */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px", marginBottom: 20 }}>
            {stageData.flatMap((stage) =>
              stage.tasks.map((task, ti) => {
                const done = client.checks[stage.offset + ti];
                return (
                  <div key={`${stage.name}-${ti}`}
                    onClick={e => { e.stopPropagation(); onToggleCheck?.(client.id, stage.offset + ti); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "7px 4px",
                      cursor: "pointer", borderRadius: 6, transition: "background 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${done ? tokens.green : tokens.borderStr}`,
                      background: done ? tokens.green : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                    }}>
                      {done && <span style={{ color: "#fff", fontSize: 8, fontWeight: 700 }}>{"\u2713"}</span>}
                    </div>
                    <span style={{ fontSize: 13, color: done ? tokens.textMute : tokens.textSub, flex: 1, textDecoration: done ? "line-through" : "none" }}>{task}</span>
                    <span style={{ fontSize: 11, color: tokens.textMute, flexShrink: 0 }}>{stage.name}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Sales notes */}
          {client.salesNotes && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: tokens.accentGhost, borderLeft: `3px solid ${tokens.accent}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.accent, letterSpacing: "0.04em", marginBottom: 4 }}>SALES NOTES</div>
              <div style={{ fontSize: 12, color: tokens.textSub, lineHeight: 1.5 }}>{client.salesNotes}</div>
            </div>
          )}

          {/* AI Sentiment inline */}
          {client.aiSentiment && (
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute }}>AI:</span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                color: client.aiSentiment.score >= 5 ? tokens.green : client.aiSentiment.score <= -5 ? tokens.red : tokens.amber,
                background: client.aiSentiment.score >= 5 ? tokens.greenSoft : client.aiSentiment.score <= -5 ? tokens.redSoft : tokens.amberSoft,
              }}>{client.aiSentiment.label}</span>
              <span style={{ fontSize: 11, color: tokens.textMute, fontStyle: "italic", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{client.aiSentiment.lastMsg}"</span>
            </div>
          )}

          {/* Meta + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 24, paddingTop: 16, borderTop: `1px solid ${tokens.border}` }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>{client.revenue}</span>
            <span style={{ fontSize: 13, color: tokens.textMute }}>Started {client.startDate}</span>
            <span style={{ fontSize: 13, color: tokens.textMute }}>Renews {client.renewal}</span>
            {client.tasksDue > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: tokens.red }}>{client.tasksDue} tasks due</span>}
            <div style={{ flex: 1 }} />
            {pct >= 80 && (
              <span onClick={e => { e.stopPropagation(); onMoveToActive?.(client.id); }} style={{
                fontSize: 13, fontWeight: 600, color: tokens.green, cursor: "pointer", transition: "opacity 0.12s",
              }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >Move to Active</span>
            )}
            {["Message", "Ticket"].map((act, ai) => (
              <span key={ai} onClick={e => e.stopPropagation()} style={{
                fontSize: 13, color: tokens.textMute, cursor: "pointer", transition: "color 0.12s",
              }}
                onMouseEnter={e => e.currentTarget.style.color = tokens.accent}
                onMouseLeave={e => e.currentTarget.style.color = tokens.textMute}
              >{act}</span>
            ))}
          </div>

          {/* All alerts */}
          {client.alerts.length > 0 && (
            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 10, background: tokens.redSoft }}>
              {client.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: tokens.red, fontWeight: 500, lineHeight: "22px" }}>{a}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
