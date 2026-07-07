import { useState, useEffect, useCallback } from "react";
import MarketingDashboard, { GoalEditor } from "../components/MarketingDashboard";

// Cross-client marketing overview — the "single marketing portal". One roster
// of every marketing client this month: verdict, spend, leads, CPL vs goal,
// trend, and budget pacing. Off-target clients float to the top. Drill into a
// client for the full dashboard + goal editor. CSV/print export + Slack digest.

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");
function fmtMoney(n) {
  n = Number(n) || 0;
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

function reasonFor(c, bm) {
  const target = c.goal_cpl != null ? c.goal_cpl : bm.cpl;
  if (!c.connected) return "ad account not connected";
  if (c.needs_campaigns) return "no campaigns selected — pick them in this client's Campaigns tab";
  if (c.cpl == null && c.spend > 5) return `spent ${fmtMoney(c.spend)} with no leads yet`;
  if (c.pacing && c.pacing.spent_pct != null && c.pacing.spent_pct > c.pacing.month_pct + 15) return `spending fast — ${c.pacing.spent_pct}% of budget, ${c.pacing.month_pct}% through the month`;
  if (c.cpl != null && c.cpl > target) return `cost per lead ${fmtMoney(c.cpl)} vs ${fmtMoney(target)} target`;
  return "worth a look";
}

export default function MarketingOverview({ tokens, session }) {
  const t = tokens;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("attention"); // attention | spend | cpl | leads | name
  const [open, setOpen] = useState(null); // selected client row
  const [slackMsg, setSlackMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/marketing?resource=meta-overview`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error || `HTTP ${res.status}`); }
      else setData(json);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, color: t.textSub }}>Loading marketing overview…</div>;
  if (err) return <div style={{ padding: 24, color: t.red }}>Couldn't load overview: {err}</div>;
  if (!data) return null;

  const bm = data.benchmarks || { cpl: 25 };
  const verdictColor = (v) => v === "strong" ? t.green : v === "attention" ? t.amber : v === "steady" ? t.accent : t.textMute;
  // Budget-confirmation status per client, from the "confirm your monthly
  // budgets" request:
  //   complete  = ticket done (green check "Confirmed")
  //   confirmed = client filled it out but ticket not actioned yet
  //               (red exclamation "Confirmed, needs action")
  //   requested = sent but not filled yet (orange dot "Sent, awaiting")
  //   none      = never sent (grey dot "Not sent")
  const budgetStatusCell = (s) => {
    if (s === "complete") return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ color: t.green, fontSize: 13, lineHeight: 1 }}>✓</span>
        <span style={{ fontSize: 12, color: t.textSub }}>Confirmed</span>
      </span>
    );
    if (s === "confirmed") return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ color: t.red, fontSize: 13, lineHeight: 1, fontWeight: 700 }}>!</span>
        <span style={{ fontSize: 12, color: t.red }}>Confirmed, needs action</span>
      </span>
    );
    const requested = s === "requested";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: requested ? t.amber : t.textMute }} />
        <span style={{ fontSize: 12, color: t.textSub }}>{requested ? "Sent, awaiting" : "Not sent"}</span>
      </span>
    );
  };
  const rows = [...data.clients];
  rows.sort((a, b) => {
    if (sort === "attention") {
      if (!!b.attention !== !!a.attention) return (b.attention ? 1 : 0) - (a.attention ? 1 : 0);
      return (b.spend || 0) - (a.spend || 0);
    }
    if (sort === "name") return (a.business_name || "").localeCompare(b.business_name || "");
    if (sort === "cpl") return (a.cpl == null ? 1e9 : a.cpl) - (b.cpl == null ? 1e9 : b.cpl);
    return (b[sort] || 0) - (a[sort] || 0);
  });
  const attention = rows.filter(r => r.attention).map(r => ({ name: r.business_name, reason: reasonFor(r, bm) }));

  function exportCSV() {
    const budgetStatusLabel = (s) => s === "complete" ? "Confirmed" : s === "confirmed" ? "Confirmed, needs action" : s === "requested" ? "Sent, awaiting" : "Not sent";
    const head = ["Client", "Verdict", "Spend", "Leads", "CPL", "Goal CPL", "Budget", "Leads vs last %", "CPL vs last %", "Spent % of budget", "Budget status"];
    const lines = rows.map(r => [
      r.business_name, r.needs_campaigns ? "Needs campaigns" : r.connected ? (r.verdict_label || "") : "Not connected",
      r.needs_campaigns ? "" : (r.spend ?? ""), r.needs_campaigns ? "" : (r.leads ?? ""), r.needs_campaigns ? "" : (r.cpl ?? ""), r.goal_cpl ?? "", r.monthly_budget ?? "",
      r.trend?.leads_pct ?? "", r.trend?.cpl_pct ?? "", r.pacing?.spent_pct ?? "", budgetStatusLabel(r.budget_status),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `marketing-overview-${data.month_label.replace(/\s/g, "-")}.csv`;
    a.click();
  }

  async function sendSlack() {
    setSlackMsg("sending");
    try {
      const res = await fetch(`/api/marketing?resource=meta-overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ month_label: data.month_label, items: attention }),
      });
      const j = await res.json().catch(() => ({}));
      setSlackMsg(j.sent ? `Sent ${j.count} to Slack` : (j.reason === "slack_not_configured" ? "Slack channel not configured" : `Not sent: ${j.reason || "error"}`));
    } catch (e) { setSlackMsg("Error: " + e.message); }
  }

  const stat = (label, value, sub) => (
    <div key={label} style={{ flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: t.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 7 }}>{label}</div>
      {sub}
    </div>
  );
  const pctSub = (pct, lowerBetter) => pct == null ? null : (
    <div style={{ fontSize: 11, marginTop: 4, color: pct === 0 ? t.textMute : ((lowerBetter ? pct < 0 : pct > 0) ? t.green : t.amber) }}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "■"} {Math.abs(pct)}% vs last month
    </div>
  );
  const btn = (active) => ({ padding: "7px 12px", background: active ? t.surfaceHov : "transparent", color: active ? t.text : t.textMute, border: `1px solid ${active ? t.borderMed : "transparent"}`, borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" });
  const th = { textAlign: "left", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMute, fontWeight: 600, padding: "0 12px 10px" };
  const td = { padding: "12px", borderTop: `1px solid ${t.border}`, fontSize: 13, color: t.text };

  return (
    <div style={{ padding: "8px 4px 40px" }}>
      {/* roll-up */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", border: `1px solid ${t.border}`, borderRadius: 14, padding: 22, background: t.surface, marginBottom: 18 }}>
        {stat("Ad spend", fmtMoney(data.rollup.spend), pctSub(data.rollup.spend_pct, false))}
        {stat("Leads", fmtNum(data.rollup.leads), pctSub(data.rollup.leads_pct, false))}
        {stat("Blended cost / lead", data.rollup.cpl != null ? fmtMoney(data.rollup.cpl) : "—")}
        {stat("Active clients", fmtNum(data.rollup.clients))}
        {stat("Need attention", fmtNum(data.rollup.attention), <div style={{ fontSize: 11, marginTop: 4, color: data.rollup.attention > 0 ? t.amber : t.green }}>{data.rollup.attention > 0 ? "review below" : "all on track"}</div>)}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: t.textSub }}>{data.month_label}</div>
          <div style={{ fontSize: 10, color: t.textMute, marginTop: 2 }}>{data.month_pct}% through the month</div>
        </div>
      </div>

      {/* controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMute, marginRight: 4 }}>Sort</span>
        {["attention", "spend", "leads", "cpl", "name"].map(s => (
          <button key={s} onClick={() => setSort(s)} style={btn(sort === s)}>{s === "attention" ? "Needs attention" : s === "cpl" ? "CPL" : s[0].toUpperCase() + s.slice(1)}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {slackMsg && <span style={{ fontSize: 11, color: t.textSub }}>{slackMsg === "sending" ? "Sending…" : slackMsg}</span>}
          <button onClick={sendSlack} style={btn(false)}>Send digest to Slack</button>
          <button onClick={exportCSV} style={btn(false)}>Export CSV</button>
          <button onClick={() => window.print()} style={btn(false)}>Print / PDF</button>
          <button onClick={load} style={btn(false)}>Refresh</button>
        </div>
      </div>

      {/* roster */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Client</th><th style={th}>Verdict</th><th style={{ ...th, textAlign: "right" }}>Spend</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th><th style={{ ...th, textAlign: "right" }}>CPL</th>
            <th style={th}>Trend</th><th style={{ ...th, textAlign: "right" }}>Budget</th><th style={th}>Pacing</th><th style={th}>Budget status</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const target = r.goal_cpl != null ? r.goal_cpl : bm.cpl;
              const showNums = r.connected && !r.needs_campaigns;
              return (
                <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: "pointer", background: r.attention ? t.amberSoft : "transparent" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.business_name}</td>
                  <td style={td}>
                    {r.needs_campaigns ? (
                      <span style={{ fontSize: 12, color: t.textMute }}>Pick campaigns</span>
                    ) : r.connected ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: verdictColor(r.verdict) }} />
                        <span style={{ fontSize: 12, color: t.textSub }}>{r.verdict_label}</span>
                      </span>
                    ) : <span style={{ fontSize: 12, color: t.textMute }}>Not connected</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{showNums ? fmtMoney(r.spend) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{showNums ? fmtNum(r.leads) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: r.cpl == null ? t.textMute : (r.cpl <= target ? t.green : t.amber) }}>{r.cpl != null ? fmtMoney(r.cpl) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.monthly_budget != null ? fmtMoney(r.monthly_budget) : <span style={{ color: t.textMute }}>—</span>}</td>
                  <td style={td}>{r.trend?.leads_pct == null ? <span style={{ color: t.textMute }}>—</span> : <span style={{ fontSize: 12, color: r.trend.leads_pct >= 0 ? t.green : t.amber }}>{r.trend.leads_pct > 0 ? "▲" : r.trend.leads_pct < 0 ? "▼" : "■"} {Math.abs(r.trend.leads_pct)}% leads</span>}</td>
                  <td style={td}>{r.pacing?.spent_pct == null ? <span style={{ color: t.textMute }}>—</span> : <span style={{ fontSize: 12, color: r.pacing.spent_pct > r.pacing.month_pct + 15 ? t.amber : t.textSub }}>{r.pacing.spent_pct}% of budget</span>}</td>
                  <td style={td}>{budgetStatusCell(r.budget_status)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td style={{ ...td, color: t.textSub }} colSpan={9}>No marketing clients yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* drill-in modal */}
      {open && (
        <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 860, background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 16, padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: t.text }}>{open.business_name}</div>
              <button onClick={() => setOpen(null)} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Close</button>
            </div>
            <GoalEditor client={{ id: open.id, meta_cpl_goal: open.goal_cpl, meta_monthly_budget: open.monthly_budget }} tokens={t} session={session} onSaved={() => { setOpen(null); load(); }} />
            <MarketingDashboard key={open.id} clientId={open.id} tokens={t} session={session} compact />
          </div>
        </div>
      )}
    </div>
  );
}
