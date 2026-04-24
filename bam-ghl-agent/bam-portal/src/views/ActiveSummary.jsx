export default function ActiveSummary({ clients, tokens }) {
  const totalRev = clients.reduce((a, c) => {
    const n = parseInt(c.kpis.revenue.replace(/[$,]/g, ""));
    return a + (isNaN(n) ? 0 : n);
  }, 0);
  const totalLeads = clients.reduce((a, c) => a + c.kpis.leads, 0);
  const avgConv = clients.length > 0
    ? Math.round(clients.reduce((a, c) => a + parseInt(c.kpis.conversion), 0) / clients.length)
    : 0;
  const avgHealth = clients.length > 0
    ? Math.round(clients.reduce((a, c) => a + c.health, 0) / clients.length)
    : 0;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 44 }}>
      <div>
        <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: tokens.green }}>${totalRev.toLocaleString()}</div>
        <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>portfolio revenue</div>
      </div>
      <div style={{ width: 1, height: 48, background: tokens.border }} />
      <div>
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: tokens.text }}>{totalLeads.toLocaleString()}</div>
        <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>total leads</div>
      </div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: avgConv >= 23 ? tokens.green : tokens.amber }}>{avgConv}%</div>
        <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>avg conversion</div>
      </div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: avgHealth >= 70 ? tokens.green : tokens.amber }}>{avgHealth}</div>
        <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>avg health</div>
      </div>
    </div>
  );
}
