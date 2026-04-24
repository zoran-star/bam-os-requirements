import { statusColor } from '../../tokens/tokens';

export default function AlertsPanel({ tokens, dark, onClose, allClients }) {
  const all = allClients
    .flatMap(cl => cl.alerts.map(a => ({ client: cl.name, msg: a, status: cl.healthStatus })))
    .slice(0, 9);

  return (
    <div style={{
      position: "absolute", top: 50, right: 0, width: 380,
      background: tokens.surface, border: `1px solid ${tokens.borderMed}`,
      borderRadius: 16, boxShadow: `0 24px 64px rgba(0,0,0,${dark ? 0.45 : 0.15})`,
      zIndex: 200, overflow: "hidden",
    }}>
      <div style={{ padding: "16px 22px", borderBottom: `1px solid ${tokens.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>Alerts</span>
        <span style={{ fontSize: 12, color: tokens.textMute, fontWeight: 500 }}>{all.length} active</span>
      </div>
      {all.length === 0 && (
        <div style={{ padding: "32px 22px", textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No active alerts.</div>
      )}
      {all.map((a, i) => (
        <div key={i} style={{
          padding: "14px 22px", borderBottom: `1px solid ${tokens.border}`,
          transition: "background 0.1s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(a.status, tokens), flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{a.client}</span>
          </div>
          <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: "20px", paddingLeft: 14 }}>{a.msg}</div>
        </div>
      ))}
    </div>
  );
}
