import { useState, useEffect, useCallback } from "react";

// Staff-side Ad Performance dashboard — the same KPI view clients see, scoped
// to one client via ?client_id=. Reuses /api/marketing?resource=meta-report
// (+ meta-insight for Claude coaching). Simple (default) / Advanced, with
// Last 7 days / This month / History windows. No emojis; constructive wording.

const DEFAULT_BM = { cpl: 25, ctr_min: 1.5, ctr_max: 2.5, freq_min: 2, freq_max: 4 };

const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");
function fmtMoney(n) {
  n = Number(n) || 0;
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
// Gold is the only accent (Full Control brand) — health reads from the wording,
// not red/amber/green traffic-light colours.

// Instant rule-based insight; Claude upgrades it when it returns.
function localInsight(period, goals, bm) {
  const target = (goals && goals.cpl_goal != null) ? goals.cpl_goal : bm.cpl;
  const t = period.totals || {};
  let verdict, verdict_label;
  if (t.cpl == null) { verdict = "attention"; verdict_label = "Worth revisiting"; }
  else if (t.cpl <= target) { verdict = "strong"; verdict_label = "Performing well"; }
  else if (t.cpl <= target * 1.5) { verdict = "steady"; verdict_label = "On track"; }
  else { verdict = "attention"; verdict_label = "Worth revisiting"; }
  const headline = t.cpl == null
    ? `Spent ${fmtMoney(t.spend)} so far — no leads recorded yet.`
    : `Spent ${fmtMoney(t.spend)} and brought in ${t.leads} lead${t.leads === 1 ? "" : "s"} at ${fmtMoney(t.cpl)} each.`;
  const list = period.campaigns || [];
  const withLeads = list.filter(c => c.cpl != null);
  const best = withLeads.slice().sort((a, b) => a.cpl - b.cpl)[0];
  const worst = list.slice().sort((a, b) => (b.cpl == null ? 1e9 : b.cpl) - (a.cpl == null ? 1e9 : a.cpl))[0];
  const win = best ? `${best.name} is your most efficient — ${fmtMoney(best.cpl)} per lead.` : `Leads are still coming in — give campaigns a few more days of data.`;
  let fix = `Everything's tracking near target — keep it running.`;
  if (worst) {
    if (worst.ctr != null && worst.ctr < bm.ctr_min) fix = `${worst.name}'s click rate is low — a fresh photo or opening line would help more people click.`;
    else if (worst.frequency != null && worst.frequency > bm.freq_max) fix = `${worst.name} is being shown to the same people too often — refresh the ad or widen the audience.`;
    else if (worst.cpl != null && worst.cpl > target) fix = `${worst.name}'s cost per lead is above target — tighten the audience or improve the page.`;
  }
  const campaigns = {};
  for (const c of list) {
    if (c.cpl == null) campaigns[c.id] = `Spent ${fmtMoney(c.spend)} with no leads yet.`;
    else if (c.ctr != null && c.ctr < bm.ctr_min) campaigns[c.id] = `${fmtMoney(c.cpl)} per lead. Not many people are clicking — a fresh hook would help.`;
    else if (c.frequency != null && c.frequency > bm.freq_max) campaigns[c.id] = `${fmtMoney(c.cpl)} per lead. People have seen this a lot — worth refreshing.`;
    else if (c.cpl > target) campaigns[c.id] = `${fmtMoney(c.cpl)} per lead, a little over your ${fmtMoney(target)} target.`;
    else campaigns[c.id] = `${fmtMoney(c.cpl)} per lead — at or under your ${fmtMoney(target)} target.`;
  }
  return { verdict, verdict_label, headline, win, fix, campaigns, source: "rule" };
}

const METRIC_INFO = {
  reach: { name: "People reached", term: "Reach", explain: (c) => `The number of different people who saw your ad at least once — ${fmtNum(c.reach)} this period. More reach means more of your area is seeing you.` },
  impressions: { name: "Times shown", term: "Impressions", explain: () => `How many times your ad appeared on a screen in total. The same person can be counted more than once, so this is normally higher than people reached.` },
  link_clicks: { name: "Clicks to your page", term: "Link clicks", explain: (c) => `How many times people tapped your ad to visit your page — ${fmtNum(c.link_clicks)} this period. These are your genuinely interested people.` },
  landing_page_views: { name: "Page views", term: "Landing page views", explain: () => `How many people actually loaded your page after clicking. If this is much lower than clicks, your page may be loading too slowly.` },
  ctr: { name: "Click rate", term: "CTR", explain: (c, bm) => `Out of everyone who saw the ad, the share who clicked${c.ctr != null ? ` — ${c.ctr}%` : ""}. A healthy range for academies is ${bm.ctr_min}–${bm.ctr_max}%. Lower means the ad isn't grabbing attention yet.` },
  frequency: { name: "Times each person saw it", term: "Frequency", explain: (c, bm) => `On average, how many times the same person saw your ad${c.frequency != null ? ` — ${c.frequency} times` : ""}. Above ${bm.freq_max} usually means people are starting to tune it out.` },
};

function Gauge({ value, target, t }) {
  const frac = (value == null || !target) ? 0 : Math.max(0, Math.min(value / (target * 2), 1));
  const R = 34, C = 2 * Math.PI * R, dash = C * frac;
  const col = t.accent;
  return (
    <div style={{ position: "relative", width: 84, height: 84 }}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={R} fill="none" stroke={t.surfaceEl} strokeWidth="8" />
        <circle cx="42" cy="42" r={R} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash.toFixed(1)} ${(C - dash).toFixed(1)}`} transform="rotate(-90 42 42)" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <b style={{ fontSize: 17, fontWeight: 600, color: t.text, lineHeight: 1 }}>{value == null ? "—" : fmtMoney(value)}</b>
        <span style={{ fontSize: 8, letterSpacing: "0.08em", color: t.textMute, marginTop: 3, textTransform: "uppercase" }}>per lead</span>
      </div>
    </div>
  );
}

function Funnel({ c, t }) {
  const imp = c.impressions || 0;
  const pct = (v) => imp > 0 ? Math.max((v / imp) * 100, 0.6) : 0;
  const stage = (label, val) => (
    <div key={label} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: t.textSub }}>{label}</div>
      <div style={{ height: 20, background: t.surfaceEl, borderRadius: 5, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct(val).toFixed(1)}%`, background: t.accent, borderRadius: 5, minWidth: 3 }} />
      </div>
      <div style={{ fontSize: 13, color: t.text, fontWeight: 600, minWidth: 60, textAlign: "right" }}>{fmtNum(val)}</div>
    </div>
  );
  const conv = (a, b, label) => !a ? null : (
    <div key={label + "c"} style={{ fontSize: 10, color: t.textMute, padding: "1px 0 5px 120px", letterSpacing: "0.04em" }}>↓ <b style={{ color: t.textSub }}>{Math.round((b / a) * 1000) / 10}%</b> {label}</div>
  );
  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
      {stage("Times shown", c.impressions)}
      {conv(c.impressions, c.link_clicks, "clicked")}
      {stage("Clicks", c.link_clicks)}
      {conv(c.link_clicks, c.landing_page_views, "loaded the page")}
      {stage("Page views", c.landing_page_views)}
      {conv(c.landing_page_views || c.link_clicks, c.leads, "became leads")}
      {stage("Leads", c.leads)}
    </div>
  );
}

function MetricCell({ mkey, value, c, bm, t }) {
  const [open, setOpen] = useState(false);
  const info = METRIC_INFO[mkey];
  let bench = null;
  if (mkey === "ctr" && c.ctr != null) {
    const ok = c.ctr >= bm.ctr_min;
    bench = <div style={{ fontSize: 11, marginTop: 4, color: t.textSub }}>{ok ? "in / above" : "below"} industry {bm.ctr_min}–{bm.ctr_max}%</div>;
  } else if (mkey === "frequency" && c.frequency != null) {
    const fatigue = c.frequency > bm.freq_max;
    bench = <div style={{ fontSize: 11, marginTop: 4, color: t.textSub }}>{fatigue ? "shown often" : "healthy"} · ind. {bm.freq_min}–{bm.freq_max}×</div>;
  }
  return (
    <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}>
      <div style={{ fontSize: 19, fontWeight: 600, color: t.text }}>{value}</div>
      <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMute, marginTop: 5 }}>
        {info.name} · {info.term}
        <span style={{ marginLeft: 6, fontSize: 8, border: `1px solid ${t.border}`, borderRadius: "50%", width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "middle" }}>?</span>
      </div>
      {bench}
      {open && <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px dashed ${t.border}`, fontSize: 11.5, lineHeight: 1.5, color: t.textSub }}>{info.explain(c, bm)}</div>}
    </div>
  );
}

function Delta({ cur, prev, suffix, t }) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "■";
  // Neutral — the arrow shows direction; no traffic-light colour.
  return <div style={{ fontSize: 11, marginTop: 5, color: t.textSub }}>{pct === 0 ? `no change ${suffix}` : `${arrow} ${Math.abs(pct)}% ${suffix}`}</div>;
}

function CampaignCard({ c, ctx, t }) {
  const { goals, bm, compare, deltaSuffix, mode, note } = ctx;
  const target = (goals && goals.cpl_goal != null) ? goals.cpl_goal : bm.cpl;
  const goalWord = (goals && goals.cpl_goal != null) ? "goal" : "target";
  const prev = compare.campaigns[c.id] || null;
  const budget = (goals && goals.monthly_budget != null) ? goals.monthly_budget : null;
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.surface, padding: 20, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 16 }}>{c.name}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px 32px", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 600, color: t.text, lineHeight: 1 }}>{fmtNum(c.leads)}</div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 7 }}>New leads · <span style={{ opacity: 0.7 }}>Leads</span></div>
          <Delta cur={c.leads} prev={prev?.leads} suffix={deltaSuffix} t={t} />
        </div>
        <div>
          <Gauge value={c.cpl} target={target} t={t} />
          <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 6 }}>Cost per lead · <span style={{ opacity: 0.7 }}>CPL</span></div>
          <div style={{ fontSize: 11, marginTop: 5, color: c.cpl == null ? t.textMute : t.textSub }}>
            {c.cpl == null ? "no leads yet" : `${c.cpl <= target ? "at / under" : "over"} ${fmtMoney(target)} ${goalWord}`}
          </div>
          <Delta cur={c.cpl} prev={prev?.cpl} suffix={deltaSuffix} t={t} />
        </div>
        <div>
          <div style={{ fontSize: 28, fontWeight: 600, color: t.text, lineHeight: 1 }}>{fmtMoney(c.spend)}</div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 7 }}>Amount spent · <span style={{ opacity: 0.7 }}>Ad spend</span></div>
          {budget != null && <div style={{ fontSize: 11, marginTop: 5, color: t.textSub }}>{Math.round((c.spend / budget) * 100)}% of {fmtMoney(budget)} budget</div>}
          <Delta cur={c.spend} prev={prev?.spend} suffix={deltaSuffix} t={t} />
        </div>
      </div>
      {note && <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${t.border}`, fontSize: 13, color: t.textSub, lineHeight: 1.55 }}>{note}</div>}
      {mode === "advanced" && <Funnel c={c} t={t} />}
      {mode === "advanced" && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${t.border}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "16px 20px" }}>
          <MetricCell mkey="reach" value={fmtNum(c.reach)} c={c} bm={bm} t={t} />
          <MetricCell mkey="impressions" value={fmtNum(c.impressions)} c={c} bm={bm} t={t} />
          <MetricCell mkey="link_clicks" value={fmtNum(c.link_clicks)} c={c} bm={bm} t={t} />
          <MetricCell mkey="landing_page_views" value={c.landing_page_views ? fmtNum(c.landing_page_views) : "—"} c={c} bm={bm} t={t} />
          <MetricCell mkey="ctr" value={c.ctr != null ? c.ctr + "%" : "—"} c={c} bm={bm} t={t} />
          <MetricCell mkey="frequency" value={c.frequency != null ? c.frequency + "×" : "—"} c={c} bm={bm} t={t} />
        </div>
      )}
    </div>
  );
}

export default function MarketingDashboard({ clientId, tokens, session, compact = false }) {
  const t = tokens;
  const [monthly, setMonthly] = useState(null);
  const [last7, setLast7] = useState(null);
  const [view, setView] = useState("this_month"); // last7 | this_month | history
  const [mode, setMode] = useState("simple");
  const [monthKey, setMonthKey] = useState(null);
  const [insights, setInsights] = useState({}); // cacheKey → insight
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const authGet = useCallback(async (qs) => {
    const res = await fetch(`/api/marketing?${qs}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }, [session]);

  // Parent passes key={clientId}, so this component remounts per client and
  // state starts fresh — no synchronous resets needed inside the effect.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { ok, status, json } = await authGet(`resource=meta-report&months=8&client_id=${clientId}`);
      if (!alive) return;
      if (!ok) { setErr(json.error || `HTTP ${status}`); setLoading(false); return; }
      if (json.reason || !(Array.isArray(json.periods) && json.periods.length)) {
        setMonthly({ empty: true, reason: json.reason, periods: [], goals: json.goals || {}, benchmarks: json.benchmarks || DEFAULT_BM });
      } else {
        setMonthly(json);
        setMonthKey(json.periods[0].key);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [clientId, authGet]);

  const data = view === "last7" ? last7 : monthly;
  const period = (() => {
    if (view === "last7") return last7 ? last7.periods[0] : null;
    if (!monthly || !monthly.periods.length) return null;
    if (view === "this_month") return monthly.periods[0];
    return monthly.periods.find(p => p.key === monthKey) || monthly.periods[0];
  })();

  // Lazy-load last 7 days.
  useEffect(() => {
    if (view !== "last7" || last7) return;
    let alive = true;
    (async () => {
      const { ok, json } = await authGet(`resource=meta-report&window=last7&client_id=${clientId}`);
      if (!alive) return;
      if (ok && !json.reason && Array.isArray(json.periods) && json.periods.length) setLast7(json);
      else setLast7({ empty: true, periods: [], goals: json.goals || {}, benchmarks: json.benchmarks || DEFAULT_BM });
    })();
    return () => { alive = false; };
  }, [view, last7, clientId, authGet]);

  // Fetch Claude insight for the current period (cached).
  useEffect(() => {
    if (!period || !data) return;
    const cacheKey = view + ":" + period.key;
    if (insights[cacheKey]) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/marketing?resource=meta-insight&client_id=${clientId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ label: period.label, totals: period.totals, campaigns: period.campaigns, goals: data.goals, benchmarks: data.benchmarks || DEFAULT_BM }),
        });
        if (!res.ok) return;
        const ai = await res.json();
        if (alive && ai && ai.headline) setInsights(prev => ({ ...prev, [cacheKey]: ai }));
      } catch { /* keep rule-based */ }
    })();
    return () => { alive = false; };
  }, [period, data, view, clientId, session, insights]);

  if (loading) return <div style={{ padding: 18, color: t.textSub }}>Loading performance…</div>;
  if (err) return <div style={{ padding: 18, color: t.red }}>Couldn't load report: {err}</div>;
  if (!data || !period) {
    return <div style={{ padding: 18, color: t.textSub }}>No performance data for this range yet{data?.reason === "no_ad_account" ? " — no ad account connected." : "."}</div>;
  }

  const bm = data.benchmarks || DEFAULT_BM;
  const goals = data.goals || {};
  const insight = insights[view + ":" + period.key] || localInsight(period, goals, bm);
  const compare = (() => {
    if (view === "last7") { const m = {}; (period.compareCampaigns || []).forEach(c => { m[c.id] = c; }); return { totals: period.compareTotals, campaigns: m }; }
    const idx = monthly.periods.findIndex(p => p.key === period.key);
    const prev = idx >= 0 ? monthly.periods[idx + 1] : null;
    const m = {}; if (prev) prev.campaigns.forEach(c => { m[c.id] = c; });
    return { totals: prev ? prev.totals : null, campaigns: m };
  })();
  const deltaSuffix = view === "last7" ? "vs prev 7d" : view === "this_month" ? "vs last month" : "vs prior month";

  const seg = (id, label) => (
    <button key={id} onClick={() => setView(id)} style={{ border: 0, background: view === id ? t.surfaceHov : "transparent", color: view === id ? t.text : t.textMute, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "7px 12px", borderRadius: 999, cursor: "pointer" }}>{label}</button>
  );
  const tog = (id, label) => (
    <button key={id} onClick={() => setMode(id)} style={{ border: 0, background: mode === id ? t.accent : "transparent", color: mode === id ? "#0A0A0B" : t.textMute, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "7px 14px", borderRadius: 999, cursor: "pointer" }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "inline-flex", background: t.surfaceEl, border: `1px solid ${t.borderMed}`, borderRadius: 999, padding: 3 }}>
          {seg("last7", "Last 7 days")}{seg("this_month", "This month")}{seg("history", "History")}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {view === "history" && (
            <select value={monthKey || ""} onChange={e => setMonthKey(e.target.value)} style={{ background: t.surfaceEl, color: t.text, border: `1px solid ${t.borderMed}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
              {monthly.periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
          <div style={{ display: "inline-flex", background: t.surfaceEl, border: `1px solid ${t.borderMed}`, borderRadius: 999, padding: 3 }}>
            {tog("simple", "Simple")}{tog("advanced", "Advanced")}
          </div>
        </div>
      </div>

      {data.empty ? (
        <div style={{ padding: 18, color: t.textSub }}>No campaign data yet{data.reason === "no_ad_account" ? " — connect this client's ad account in Setup." : "."}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", border: `1px solid ${t.border}`, background: t.surface, borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent, marginTop: 7, flex: "none", opacity: 0.8 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: t.textMute, marginBottom: 6 }}>{insight.verdict_label}</div>
              <div style={{ fontSize: 18, lineHeight: 1.45, color: t.text }}>{insight.headline}</div>
            </div>
            {insight.source === "ai" && <span style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: t.textMute, border: `1px solid ${t.border}`, borderRadius: 999, padding: "3px 8px", alignSelf: "center" }}>AI summary</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 24 }}>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: "15px 16px", background: t.surface }}>
              <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: t.accent, marginBottom: 7 }}>Biggest win</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: t.textSub }}>{insight.win}</div>
            </div>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: "15px 16px", background: t.surface }}>
              <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: t.textMute, marginBottom: 7 }}>What to look at</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: t.textSub }}>{insight.fix}</div>
            </div>
          </div>

          {period.campaigns.length
            ? period.campaigns.map(c => <CampaignCard key={c.id} c={c} ctx={{ goals, bm, compare, deltaSuffix, mode, note: (insight.campaigns || {})[c.id] }} t={t} />)
            : <div style={{ padding: 18, color: t.textSub }}>No campaigns ran in this period.</div>}
        </>
      )}
    </div>
  );
}

// ── Goal editor — sets clients.meta_cpl_goal + meta_monthly_budget ──
export function GoalEditor({ client, tokens, session, onSaved }) {
  const t = tokens;
  const [cpl, setCpl] = useState(client.meta_cpl_goal != null ? String(client.meta_cpl_goal) : "");
  const [budget, setBudget] = useState(client.meta_monthly_budget != null ? String(client.meta_monthly_budget) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, meta_cpl_goal: cpl === "" ? null : cpl, meta_monthly_budget: budget === "" ? null : budget }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Saved" });
      onSaved?.();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const inp = { width: 110, padding: "9px 11px", background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 8, color: t.text, fontSize: 14, fontFamily: "inherit" };
  const lbl = { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMute, marginBottom: 6 };
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: 18, background: t.surface, marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 4 }}>Performance goals</div>
      <div style={{ fontSize: 12, color: t.textSub, marginBottom: 14, lineHeight: 1.5 }}>Set this client's targets. Leave blank to use the industry default (~$25 CPL). Goals color every dashboard — yours and theirs.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" }}>
        <div><div style={lbl}>Target cost / lead ($)</div><input type="number" min="0" step="0.01" value={cpl} onChange={e => setCpl(e.target.value)} placeholder="25" style={inp} /></div>
        <div><div style={lbl}>Monthly budget ($)</div><input type="number" min="0" step="1" value={budget} onChange={e => setBudget(e.target.value)} placeholder="—" style={inp} /></div>
        <button onClick={save} disabled={busy} style={{ padding: "10px 18px", background: t.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Save goals"}</button>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? t.green : t.red }}>{msg.text}</span>}
      </div>
    </div>
  );
}
