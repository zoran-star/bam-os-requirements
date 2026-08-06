import { useState, useEffect, useCallback } from "react";
import MarketingDashboard, { GoalEditor } from "../components/MarketingDashboard";
import { SkelStats, SkelCards } from "../components/Skeleton.jsx";
import MetaError from "../components/MetaError.jsx";
import { LOAD_FAILED } from "../lib/metaError.js";

// Cross-client marketing overview, the "single marketing portal". One roster
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
  // Ad account is wired, the team's Meta connection is the thing missing. Not
  // this client's fault and not this client's fix.
  if (c.no_staff_token) return "Meta isn't connected for the team, so this client's numbers are missing";
  if (!c.connected) return "ad account not connected";
  if (c.needs_campaigns) return "no campaigns selected, pick them in this client's Campaigns tab";
  if (c.error) return "we couldn't read this client's Meta data, so this month's numbers are missing";
  if (c.cpl == null && c.spend > 5) return `spent ${fmtMoney(c.spend)} with no leads yet`;
  if (c.pacing && c.pacing.spent_pct != null && c.pacing.spent_pct > c.pacing.month_pct + 15) return `spending fast at ${c.pacing.spent_pct}% of budget, ${c.pacing.month_pct}% through the month`;
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

  if (loading) return <div style={{ padding: 24 }}><SkelStats n={4} t={t} /><SkelCards n={6} h={120} t={t} /></div>;
  // `err` here is ANY non-ok response: our own 500, an expired login, a dropped
  // connection. Only the ones carrying a recognisable Meta signature get to
  // name Meta; the rest say the page didn't load and blame nobody.
  if (err) return <MetaError tokens={t} raw={err} unknownText={LOAD_FAILED} style={{ padding: 24 }} />;
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
      // Unreadable rows outrank off-target rows: a row we can't read is a
      // problem with us, not with the client's ads.
      const rank = (x) => x.error ? 2 : x.attention ? 1 : 0;
      if (rank(a) !== rank(b)) return rank(b) - rank(a);
      return (b.spend || 0) - (a.spend || 0);
    }
    if (sort === "name") return (a.business_name || "").localeCompare(b.business_name || "");
    if (sort === "cpl") return (a.cpl == null ? 1e9 : a.cpl) - (b.cpl == null ? 1e9 : b.cpl);
    return (b[sort] || 0) - (a[sort] || 0);
  });
  // Rows Meta wouldn't answer for. Their spend/leads are unknown, not zero.
  const errorRows = rows.filter(r => r.error);
  const errorCount = errorRows.length;
  // No Meta connection at all. Nothing failed, because nothing was ever asked:
  // not one number on this page came from Meta. To a person that is the same
  // event as a dead connection and it gets the same honesty, but the fix is
  // different, so the banner below says "connect" rather than "reconnect".
  const metaMissing = data.meta_connected === false;
  const noTokenCount = metaMissing ? rows.filter(r => r.no_staff_token).length : 0;
  // Every guard below counts THIS, not errorCount, so a connection we never had
  // can't walk past checks that were only ever written for one that broke.
  const unreadableCount = errorCount + noTokenCount;
  const metaDown = errorCount > 0 || metaMissing;
  // Every roll-up total below is summed from readable clients only, so during
  // an outage it covers fewer clients than the roster shows.
  const noneReadable = metaDown && data.rollup.clients === 0;
  // One dead team token makes every client an error row. Collapse them into a
  // single digest line so a genuinely off-target client can't be buried under
  // repeats of the same sentence. A lone failure still gets named, which is
  // more useful than a count of one.
  const errorDigest = metaMissing
    ? [{ name: "Meta connection", reason: "Meta isn't connected, so no client's numbers could be read for this digest" }]
    : errorCount === 0 ? []
      : errorCount === 1 ? [{ name: errorRows[0].business_name, reason: reasonFor(errorRows[0], bm) }]
        : [{ name: "Meta connection", reason: `can't reach Meta for ${errorCount} clients, so they are missing from this digest` }];
  const attention = [
    ...errorDigest,
    ...rows.filter(r => r.attention && !r.error).map(r => ({ name: r.business_name, reason: reasonFor(r, bm) })),
  ];

  function exportCSV() {
    const budgetStatusLabel = (s) => s === "complete" ? "Confirmed" : s === "confirmed" ? "Confirmed, needs action" : s === "requested" ? "Sent, awaiting" : "Not sent";
    const head = ["Client", "Verdict", "Spend", "Leads", "CPL", "Goal CPL", "Budget", "Client-confirmed budget", "Leads vs last %", "CPL vs last %", "Spent % of budget", "Budget status", "Budget request sent"];
    const lines = rows.map(r => [
      r.business_name, r.needs_campaigns ? "Needs campaigns" : r.no_staff_token ? "Meta not connected" : r.error ? "Can't reach Meta" : r.connected ? (r.verdict_label || "") : "Not connected",
      r.needs_campaigns ? "" : (r.spend ?? ""), r.needs_campaigns ? "" : (r.leads ?? ""), r.needs_campaigns ? "" : (r.cpl ?? ""), r.goal_cpl ?? "", r.monthly_budget ?? "", r.confirmed_budget ?? "",
      r.trend?.leads_pct ?? "", r.trend?.cpl_pct ?? "", r.pacing?.spent_pct ?? "", budgetStatusLabel(r.budget_status),
      r.budget_request_sent_at ? String(r.budget_request_sent_at).slice(0, 10) : "",
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
  // Outage caveat for the roll-up tiles. The totals are summed from readable
  // clients only, so during an outage they are a slice of the month, not the
  // month. Every Meta-derived tile carries the same sentence.
  const missSub = (text) => <div style={{ fontSize: 11, marginTop: 4, color: t.red }}>{text}</div>;
  // Denominator = the roster right below, so a person can count it. It used to
  // be readable + unreadable, which silently dropped not-connected and
  // needs-campaigns rows and produced "across 6 of 8" under a list of 10.
  const coverSub = !metaDown ? null
    : missSub(noneReadable ? "no clients could be read" : `across ${fmtNum(data.rollup.clients)} of ${fmtNum(rows.length)} clients`);
  const withCover = (sub) => coverSub ? <>{sub}{coverSub}</> : sub;
  // Budget cell. The amount shown is the last figure the CLIENT agreed to, so
  // a staff edit to the target can look like it did nothing, and a request
  // already out for reply explains why. A coordinator hit "Save goals" twice
  // and then asked to type the number in by hand, because nothing on screen
  // said "you already asked them, they haven't answered". Now it does.
  //
  // Deliberately NOT an override field: the label under the amount says
  // "client confirmed", and a number staff typed themselves would make that a
  // lie. The whole point of the confirmation flow is that the figure carries
  // the client's agreement.
  const budgetAmount = (r) => r.confirmed_budget != null ? fmtMoney(r.confirmed_budget)
    : r.monthly_budget != null ? fmtMoney(r.monthly_budget)
    : <span style={{ color: t.textMute }}>-</span>;
  const budgetCell = (r) => {
    const confirmedTag = r.confirmed_budget != null
      ? <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: t.green }}>client confirmed</span>
      : null;
    let pending = null;
    // The FACT that a request is outstanding is budget_status "requested",
    // which the roster has always had. The date is the new bit, and it is only
    // ever decoration: no date still beats no warning.
    if (r.budget_status === "requested") {
      const d = r.budget_request_sent_at ? new Date(r.budget_request_sent_at) : null;
      const day = !d || isNaN(d.getTime()) ? "" : ` ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      pending = (
        <span style={{ fontSize: 10, fontWeight: 600, color: t.amber, whiteSpace: "nowrap" }}>
          {r.confirmed_budget != null ? "new request" : "request"} sent{day}, awaiting reply
        </span>
      );
    }
    // Nothing extra to say: render exactly what this cell always rendered.
    if (!confirmedTag && !pending) return budgetAmount(r);
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span>{budgetAmount(r)}</span>
        {confirmedTag}
        {pending}
      </span>
    );
  };
  const btn = (active) => ({ padding: "7px 12px", background: active ? t.surfaceHov : "transparent", color: active ? t.text : t.textMute, border: `1px solid ${active ? t.borderMed : "transparent"}`, borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" });
  const th = { textAlign: "left", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMute, fontWeight: 600, padding: "0 12px 10px" };
  const td = { padding: "12px", borderTop: `1px solid ${t.border}`, fontSize: 13, color: t.text };

  return (
    <div style={{ padding: "8px 4px 40px" }}>
      {/* Meta is down for at least one client. One dead team token takes every
          client out at once, so say it here instead of leaving the roster to
          read like a room full of clients who spent nothing. */}
      {metaDown && (
        <div style={{
          padding: "12px 16px", marginBottom: 18, borderRadius: 8,
          background: t.redSoft, border: `1px solid ${t.red}44`,
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.red, marginTop: 5, flexShrink: 0 }} />
          {metaMissing ? (
            // Never say "reconnect" to someone who has nothing to reconnect.
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.red }}>
                Meta isn't connected, so no ad numbers could be read.
              </div>
              <div style={{ fontSize: 12, color: t.textSub, marginTop: 3, lineHeight: 1.5 }}>
                Nothing on this page came from Meta{noTokenCount > 0 ? `, including ${noTokenCount} ${noTokenCount === 1 ? "client" : "clients"} with an ad account ready to read` : ""}.
                Empty is not the same as zero. Connect Meta in <b style={{ color: t.text }}>Settings → Connect Meta</b>, then hit Refresh.
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.red }}>
                Can't reach Meta for {errorCount} {errorCount === 1 ? "client" : "clients"}.
              </div>
              <div style={{ fontSize: 12, color: t.textSub, marginTop: 3, lineHeight: 1.5 }}>
                Their numbers can't be read right now, which is not the same as zero. The totals and rows below leave them out.
                Reconnect Meta in <b style={{ color: t.text }}>Settings → Connect Meta</b>, then hit Refresh.
              </div>
            </div>
          )}
        </div>
      )}

      {/* roll-up */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", border: `1px solid ${t.border}`, borderRadius: 14, padding: 22, background: t.surface, marginBottom: 18 }}>
        {stat("Ad spend", noneReadable ? "-" : fmtMoney(data.rollup.spend), withCover(pctSub(data.rollup.spend_pct, false)))}
        {stat("Leads", noneReadable ? "-" : fmtNum(data.rollup.leads), withCover(pctSub(data.rollup.leads_pct, false)))}
        {stat("Blended cost / lead", data.rollup.cpl != null ? fmtMoney(data.rollup.cpl) : "-", withCover(null))}
        {stat("Active clients", fmtNum(data.rollup.clients), unreadableCount > 0 ? missSub(`${unreadableCount} not counted`) : null)}
        {/* Never "all on track" while a client is unreadable. We don't know that. */}
        {stat("Need attention", fmtNum(data.rollup.attention), metaDown
          ? missSub(unreadableCount > 0 ? `${unreadableCount} not counted, could be more` : "we can't read Meta, so this could be more")
          : <div style={{ fontSize: 11, marginTop: 4, color: data.rollup.attention > 0 ? t.amber : t.green }}>{data.rollup.attention > 0 ? "review below" : "all on track"}</div>)}
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
              // An unreadable row shows no money. Blank beats a wrong zero.
              const showNums = r.connected && !r.needs_campaigns && !r.error;
              return (
                <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: "pointer", background: (r.error || r.no_staff_token) ? t.redSoft : r.attention ? t.amberSoft : "transparent" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.business_name}</td>
                  <td style={td}>
                    {r.needs_campaigns ? (
                      <span style={{ fontSize: 12, color: t.textMute }}>Pick campaigns</span>
                    ) : r.no_staff_token ? (
                      // This client's ad account is wired. Ours isn't. Saying
                      // plain "Not connected" here sends staff into the wrong
                      // client's setup screen looking for a problem that is
                      // ours.
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.red }} />
                        <span style={{ fontSize: 12, color: t.red }}>Meta not connected</span>
                      </span>
                    ) : r.error ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.red }} />
                        <span style={{ fontSize: 12, color: t.red }}>Can't reach Meta</span>
                      </span>
                    ) : r.connected ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: verdictColor(r.verdict) }} />
                        <span style={{ fontSize: 12, color: t.textSub }}>{r.verdict_label}</span>
                      </span>
                    ) : <span style={{ fontSize: 12, color: t.textMute }}>Not connected</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{showNums ? fmtMoney(r.spend) : "-"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{showNums ? fmtNum(r.leads) : "-"}</td>
                  <td style={{ ...td, textAlign: "right", color: r.cpl == null ? t.textMute : (r.cpl <= target ? t.green : t.amber) }}>{r.cpl != null ? fmtMoney(r.cpl) : "-"}</td>
                  <td style={td}>{r.trend?.leads_pct == null ? <span style={{ color: t.textMute }}>-</span> : <span style={{ fontSize: 12, color: r.trend.leads_pct >= 0 ? t.green : t.amber }}>{r.trend.leads_pct > 0 ? "▲" : r.trend.leads_pct < 0 ? "▼" : "■"} {Math.abs(r.trend.leads_pct)}% leads</span>}</td>
                  <td style={{ ...td, textAlign: "right" }}>{budgetCell(r)}</td>
                  <td style={td}>{r.pacing?.spent_pct == null ? <span style={{ color: t.textMute }}>-</span> : <span style={{ fontSize: 12, color: r.pacing.spent_pct > r.pacing.month_pct + 15 ? t.amber : t.textSub }}>{r.pacing.spent_pct}% of budget</span>}</td>
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
