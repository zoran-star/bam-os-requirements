import { calcProgress } from '../tokens/tokens';
const ONBOARDING_STAGES = [
  { group: "Sales Handover", tasks: ["Contract Signed", "Asana Created", "Software Setup"] },
  { group: "SM Intro",       tasks: ["SM Intro Call"] },
  { group: "Systems",        tasks: ["Systems Intro Call","Phone Number","Domain Added","Systems Initial Draft","Systems Final Draft","Additional Systems"] },
  { group: "Content",        tasks: ["Content Plan Reviewed"] },
  { group: "Paid Ads",       tasks: ["Ads Initial Draft","Ads Final Draft","Ads Running"] },
];
import { getClientCurrentPhase } from './OnboardingRow';

export default function OnboardingSummary({ clients, tokens }) {
  const avgPct = Math.round(clients.reduce((a, c) => a + calcProgress(c.checks), 0) / clients.length);
  const blocked = clients.filter(c => c.alerts.length > 0).length;
  const critical = clients.filter(c => c.healthStatus === "critical").length;

  const stageCounts = ONBOARDING_STAGES.map((_, si) =>
    clients.filter(c => getClientCurrentPhase(c.checks) === si).length
  );

  return (
    <div style={{ marginBottom: 40 }}>
      {/* Hero stats — not a grid of boxes */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 36 }}>
        <div>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: avgPct >= 50 ? tokens.green : tokens.amber }}>{avgPct}%</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>avg. progress</div>
        </div>
        <div style={{ width: 1, height: 48, background: tokens.border }} />
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: blocked > 0 ? tokens.red : tokens.green }}>{blocked}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>blocked</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: critical > 0 ? tokens.red : tokens.green }}>{critical}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>critical</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: tokens.text }}>{clients.length}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>total</div>
        </div>
      </div>

      {/* Pipeline distribution — minimal */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {ONBOARDING_STAGES.map((_, si) => {
          const w = clients.length > 0 ? (stageCounts[si] / clients.length) * 100 : 0;
          return (
            <div key={si} style={{
              height: 6, borderRadius: 3,
              background: tokens.accent, opacity: w > 0 ? 0.7 : 0.1,
              flex: Math.max(w, 4), transition: "all 0.3s",
            }} />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {ONBOARDING_STAGES.map((stage, si) => (
          <div key={si} style={{ flex: Math.max((clients.length > 0 ? (stageCounts[si] / clients.length) * 100 : 0), 4), minWidth: 0 }}>
            <span style={{ fontSize: 12, color: stageCounts[si] > 0 ? tokens.textSub : tokens.textMute, fontWeight: 500 }}>
              {stage.group} <span style={{ fontWeight: 400, color: tokens.textMute }}>{stageCounts[si]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
