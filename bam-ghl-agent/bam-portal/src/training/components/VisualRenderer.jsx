import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function VisualRenderer({ visualType, visualData, tk }) {
  if (!visualType || visualType === "none" || !visualData) return null;

  const renderers = {
    chart: () => <ChartVisual data={visualData} tk={tk} />,
    table: () => <TableVisual data={visualData} tk={tk} />,
    dashboard_mock: () => <DashboardMock data={visualData} tk={tk} />,
    email: () => <EmailMock data={visualData} tk={tk} />,
    text_thread: () => <TextThread data={visualData} tk={tk} />,
    pnl: () => <PnLVisual data={visualData} tk={tk} />,
  };

  const renderer = renderers[visualType];
  if (!renderer) return null;

  return (
    <div style={{ marginBottom: 20, borderRadius: 10, overflow: "hidden", border: `1px solid ${tk.border}` }}>
      {renderer()}
    </div>
  );
}

// ─── Chart ───
function ChartVisual({ data, tk }) {
  const { type = "bar", chartData = [], xKey = "name", yKey = "value", title } = data;
  const ChartComponent = type === "line" ? LineChart : BarChart;
  const DataComponent = type === "line" ? Line : Bar;

  return (
    <div style={{ background: tk.surface, padding: 16 }}>
      {title && <div style={{ color: tk.textSub, fontSize: 12, marginBottom: 12, fontFamily: "Inter, sans-serif" }}>{title}</div>}
      <ResponsiveContainer width="100%" height={200}>
        <ChartComponent data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={tk.border} />
          <XAxis dataKey={xKey} tick={{ fill: tk.textSub, fontSize: 11 }} stroke={tk.border} />
          <YAxis tick={{ fill: tk.textSub, fontSize: 11 }} stroke={tk.border} />
          <Tooltip
            contentStyle={{ background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 6, color: tk.text, fontSize: 12 }}
          />
          <DataComponent dataKey={yKey} fill={tk.accent} stroke={tk.accent} radius={type === "bar" ? [4, 4, 0, 0] : undefined} />
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Table ───
function TableVisual({ data, tk }) {
  const { title, headers = [], rows = [] } = data;

  return (
    <div style={{ background: tk.surface, padding: 16, overflowX: "auto" }}>
      {title && <div style={{ color: tk.textSub, fontSize: 12, marginBottom: 12, fontFamily: "Inter, sans-serif" }}>{title}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Inter, sans-serif", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${tk.borderMed}`, color: tk.textSub, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: "8px 12px", borderBottom: `1px solid ${tk.border}`, color: tk.text }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Dashboard Mock ───
function DashboardMock({ data, tk }) {
  const { title, kpis = [] } = data;

  return (
    <div style={{ background: tk.surface, padding: 16 }}>
      {title && <div style={{ color: tk.textSub, fontSize: 12, marginBottom: 12, fontFamily: "Inter, sans-serif" }}>{title}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`, gap: 12 }}>
        {kpis.map((kpi, i) => (
          <div key={i} style={{ background: tk.surfaceEl, borderRadius: 8, padding: 14, border: `1px solid ${tk.border}` }}>
            <div style={{ color: tk.textSub, fontSize: 11, fontFamily: "Inter, sans-serif", marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ color: tk.text, fontSize: 22, fontWeight: 700, fontFamily: "Inter, sans-serif" }}>{kpi.value}</div>
            {kpi.change && (
              <div style={{ color: kpi.change > 0 ? tk.green : tk.red, fontSize: 12, marginTop: 4, fontFamily: "Inter, sans-serif" }}>
                {kpi.change > 0 ? "+" : ""}{kpi.change}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Email Mock ───
function EmailMock({ data, tk }) {
  const { from, to, subject, body, date } = data;

  return (
    <div style={{ background: tk.surface, fontFamily: "Inter, sans-serif" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${tk.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ color: tk.textSub, fontSize: 12 }}>From: <span style={{ color: tk.text }}>{from}</span></span>
          <span style={{ color: tk.textMute, fontSize: 11 }}>{date}</span>
        </div>
        <div style={{ color: tk.textSub, fontSize: 12, marginBottom: 4 }}>To: <span style={{ color: tk.text }}>{to}</span></div>
        <div style={{ color: tk.text, fontSize: 14, fontWeight: 600 }}>{subject}</div>
      </div>
      <div style={{ padding: 16, color: tk.text, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{body}</div>
    </div>
  );
}

// ─── Text Thread ───
function TextThread({ data, tk }) {
  const { messages = [] } = data;

  return (
    <div style={{ background: tk.surface, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.from === "them" ? "flex-start" : "flex-end" }}>
            <div style={{
              maxWidth: "75%",
              padding: "8px 14px",
              borderRadius: 16,
              fontSize: 13,
              fontFamily: "Inter, sans-serif",
              lineHeight: 1.5,
              background: msg.from === "them" ? tk.surfaceEl : "rgba(212,207,138,0.15)",
              color: tk.text,
              border: msg.from === "them" ? `1px solid ${tk.border}` : `1px solid rgba(212,207,138,0.25)`,
            }}>
              {msg.name && <div style={{ fontSize: 11, color: tk.textSub, marginBottom: 2, fontWeight: 600 }}>{msg.name}</div>}
              {msg.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── P&L Statement ───
function PnLVisual({ data, tk }) {
  const { title = "Profit & Loss Statement", period, sections = [] } = data;

  return (
    <div style={{ background: tk.surface, padding: 16, fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ color: tk.text, fontSize: 14, fontWeight: 600 }}>{title}</div>
        {period && <div style={{ color: tk.textSub, fontSize: 12 }}>{period}</div>}
      </div>
      {sections.map((section, si) => (
        <div key={si} style={{ marginBottom: 12 }}>
          <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${tk.border}` }}>
            {section.label}
          </div>
          {section.items.map((item, ii) => (
            <div key={ii} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: item.isTotal ? tk.text : tk.textSub, fontWeight: item.isTotal ? 700 : 400 }}>{item.label}</span>
              <span style={{ color: item.value < 0 ? tk.red : tk.text, fontWeight: item.isTotal ? 700 : 400 }}>
                {typeof item.value === "number" ? (item.value < 0 ? "-" : "") + "$" + Math.abs(item.value).toLocaleString() : item.value}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
