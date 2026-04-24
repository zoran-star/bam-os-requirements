import { useState } from "react";
import { statusColor } from '../tokens/tokens';
import RecurringDots from '../components/primitives/RecurringDots';

export default function ActiveCard({ client, tokens, index, onClick, dark }) {
  const [hov, setHov] = useState(false);
  const hasWins = client.wins.length > 0;
  const hasAlerts = client.alerts.length > 0;
  const recurringDone = client.recurring.filter(Boolean).length;

  const sc = statusColor(client.healthStatus, tokens);
  const glowColor = hasAlerts ? sc : hasWins ? tokens.green : tokens.accent;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => onClick(client)}
      style={{
        background: tokens.surfaceEl,
        border: `1px solid ${hov ? tokens.borderStr : tokens.border}`,
        borderRadius: 16, cursor: "pointer", overflow: "hidden",
        transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
        transform: hov ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hov
          ? `0 8px 30px ${glowColor}15, 0 24px 60px rgba(0,0,0,${dark ? 0.35 : 0.10})`
          : `0 1px 2px rgba(0,0,0,0.04)`,
        position: "relative",
        animation: `cardIn 0.35s ease ${index * 45}ms both`,
      }}
    >
      <div style={{ padding: "24px 24px 20px" }}>

        {/* Identity + Health ring */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 17, fontWeight: 600, color: tokens.text, letterSpacing: "-0.02em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              lineHeight: 1.3, marginBottom: 6,
            }}>{client.name}</div>
            <div style={{ fontSize: 13, color: tokens.textMute }}>
              {client.manager} · {client.revenue}
            </div>
          </div>
          {/* Health ring */}
          <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
            <svg width="52" height="52" viewBox="0 0 52 52" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="26" cy="26" r="22" fill="none" stroke={tokens.borderMed} strokeWidth="2.5" />
              <circle cx="26" cy="26" r="22" fill="none" stroke={sc} strokeWidth="2.5"
                strokeDasharray={`${(client.health / 100) * 138.2} 138.2`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }}
              />
            </svg>
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, fontWeight: 700, color: sc, letterSpacing: "-0.02em",
            }}>{client.health}</div>
          </div>
        </div>

        {/* KPIs — lead with revenue, then supporting */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 14 }}>
            {client.kpis.revenue}
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <span style={{ fontSize: 18, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em" }}>{client.kpis.leads}</span>
              <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: 6 }}>leads</span>
            </div>
            <div>
              <span style={{ fontSize: 18, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em" }}>{client.kpis.trials}</span>
              <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: 6 }}>trials</span>
            </div>
            <div>
              <span style={{ fontSize: 18, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em" }}>{client.kpis.conversion}</span>
              <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: 6 }}>conv</span>
            </div>
          </div>
        </div>

        {/* Tasks + activity */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: (hasWins || hasAlerts) ? 16 : 0 }}>
          <RecurringDots recurring={client.recurring} tokens={tokens} />
          <span style={{ fontSize: 12, color: tokens.textMute }}>{recurringDone}/{client.recurring.length}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: tokens.textMute }}>{client.lastActivity}</span>
        </div>

        {/* Signal — win or alert, no bordered box for wins */}
        {hasWins ? (
          <div style={{ paddingTop: 14, borderTop: `1px solid ${tokens.border}` }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: tokens.green }}>
              {client.wins[0]}
            </span>
            {client.wins.length > 1 && (
              <span style={{ fontSize: 13, color: tokens.green, opacity: 0.4, marginLeft: 8 }}>+{client.wins.length - 1}</span>
            )}
          </div>
        ) : hasAlerts ? (
          <div style={{ marginTop: 2, padding: "12px 16px", borderRadius: 10, background: tokens.redSoft }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: tokens.red }}>{client.alerts[0]}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
