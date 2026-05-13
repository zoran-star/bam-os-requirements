// ChannelView — basketball acquisition channel dashboard
// Answers 3 questions: (1) Is the channel working? (2) On track to kill basketball? (3) Where's the funnel breaking?
// Reads from bam_channel_snapshots + bam_channel_settings (RLS-gated to allowlist).
// Stripe auto-ingest via POST /api/stripe/overview?section=channel-ingest
// TODO: Slack alerts, week-over-week delta, per-client drill-down, email digests, Meta API ingest
import { useEffect, useMemo, useState } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Area, ComposedChart,
} from "recharts";
import {
  fetchChannelSettings,
  fetchLatestSnapshot,
  triggerStripeIngest,
  upsertSnapshotFields,
  computeDayCounter,
  ratioStatus,
  diagnoseFunnel,
  computeKillProgress,
  compositeKillProgress,
  projectTrajectory,
  estimateKillDate,
} from "../services/channelService";

const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";
const fmtMoney = (n) => "$" + Math.round(n || 0).toLocaleString();
const fmtMoneyK = (n) => "$" + (Math.round((n || 0) / 100) / 10) + "K";

// ─── Page header ─────────────────────────────────────────────────────
function PageHeader({ tk, day, settings, onSync, onEdit, ingesting }) {
  const endDate = new Date(new Date(settings.campaign_start_date).getTime() + settings.test_window_days * 86400000);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      marginBottom: 28, flexWrap: "wrap", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: tk.text, letterSpacing: "-0.03em", margin: 0 }}>
          Channel
        </h1>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: tk.textMute,
          padding: "4px 10px", borderRadius: 6,
          background: tk.surfaceAlt || tk.surfaceHov,
          border: `1px solid ${tk.border}`,
        }}>
          Day {day.dayN} of {day.total} · ends {endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSync} disabled={ingesting} style={btn(tk, "ghost")}>
          {ingesting ? "Syncing…" : "Sync Stripe"}
        </button>
        <button onClick={onEdit} style={btn(tk, "primary")}>Edit funnel</button>
      </div>
    </div>
  );
}

// ─── Decision banner ─────────────────────────────────────────────────
function DecisionBanner({ tk, day }) {
  return (
    <div style={{
      background: tk.surfaceEl, borderRadius: 14,
      border: `1px solid ${tk.accentBorder}`,
      padding: "18px 22px", marginBottom: 24,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      animation: `slideUp 0.4s ${SPRING} both`,
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: tk.accent, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
          Next strategic decision
        </div>
        <div style={{ fontSize: 13, color: tk.textSub, maxWidth: 640 }}>
          At Day {day.total}, channel decision is automatic per pre-committed rules. No strategy debate until then.
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: tk.accent, letterSpacing: "-0.03em", lineHeight: 1 }}>
          {day.daysRemaining}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginTop: 4 }}>
          DAYS REMAINING
        </div>
      </div>
    </div>
  );
}

// ─── Question card (top 3) ───────────────────────────────────────────
function QuestionCard({ tk, label, question, answer, detail, status, delay = 0 }) {
  const color = status === "good" ? tk.green : status === "warn" ? tk.amber : status === "bad" ? tk.red : tk.accent;
  return (
    <div
      style={{
        background: tk.surfaceEl, borderRadius: 14,
        border: `1px solid ${tk.border}`, padding: "22px 24px",
        animation: `slideUp 0.4s ${SPRING} ${delay}ms both`,
        transition: `all 0.3s ${SPRING}`,
        cursor: "default", position: "relative", overflow: "hidden",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = tk.borderStr; e.currentTarget.style.boxShadow = tk.cardHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tk.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: color }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 18, minHeight: 36 }}>{question}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 10 }}>
        {answer}
      </div>
      <div style={{ fontSize: 12, color: tk.textSub, lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────
function SectionHeader({ tk, title, source }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: tk.text, letterSpacing: "-0.02em", margin: 0 }}>
        {title}
      </h2>
      <div style={{ flex: 1, height: 1, background: tk.border }} />
      <span style={{
        fontSize: 10, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em",
        background: tk.surfaceAlt || tk.surfaceHov, padding: "3px 8px", borderRadius: 6,
        border: `1px solid ${tk.border}`, textTransform: "uppercase",
      }}>
        {source}
      </span>
    </div>
  );
}

// ─── Funnel step card ────────────────────────────────────────────────
function FunnelStep({ tk, label, value, rate, rateNum, rateStatus, target, accent }) {
  const rc = rateStatus === "good" ? tk.green : rateStatus === "warn" ? tk.amber : rateStatus === "bad" ? tk.red : tk.textSub;
  return (
    <div style={{
      background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
      padding: "16px 18px", transition: `all 0.3s ${SPRING}`,
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = tk.borderStr; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = tk.border; }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? tk.accent : tk.text, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: tk.textSub, display: "flex", alignItems: "center", gap: 6 }}>
        {rate && <span>{rate}</span>}
        {rateNum && <span style={{ color: rc, fontWeight: 700 }}>{rateNum}</span>}
      </div>
      {target && <div style={{ fontSize: 10, color: tk.textMute, marginTop: 4 }}>{target}</div>}
    </div>
  );
}

// ─── Progress row (kill basketball + closed mix) ─────────────────────
function ProgressRow({ tk, label, actual, target, pct, detail, sustainDays, sustainTarget, unit, delay = 0 }) {
  const display = unit === "money"
    ? `${fmtMoneyK(actual)} / ${fmtMoneyK(target)}`
    : unit === "days"
      ? `${actual} / ${target}d`
      : `${actual} / ${target}`;
  const complete = pct >= 100;
  const barColor = complete ? tk.green : tk.accent;
  return (
    <div style={{
      background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
      padding: "18px 20px", animation: `slideUp 0.4s ${SPRING} ${delay}ms both`,
      transition: `all 0.3s ${SPRING}`,
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = tk.borderStr; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = tk.border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tk.text }}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: tk.accent, letterSpacing: "-0.02em" }}>{display}</span>
      </div>
      <div style={{ height: 6, background: tk.surfaceHov, borderRadius: 999, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.min(100, pct)}%`,
          background: barColor, borderRadius: 999,
          transition: "width 0.6s ease",
        }} />
      </div>
      <div style={{ fontSize: 11, color: tk.textSub, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
        <span>{detail || `${pct}% complete`}</span>
        <span style={{ color: sustainDays != null && sustainDays < sustainTarget ? tk.red : tk.textMute }}>
          {sustainDays != null
            ? `${sustainDays} / ${sustainTarget}d sustained`
            : (unit === "money"
              ? `+${fmtMoneyK(Math.max(0, target - actual))} needed`
              : `+${Math.max(0, target - actual)} needed`)}
        </span>
      </div>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────
export default function ChannelView({ tokens: tk, session }) {
  const [settings, setSettings] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [scenarioKey, setScenarioKey] = useState("base");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [toast, setToast] = useState(null);

  async function load() {
    setLoading(true);
    const [s, snap] = await Promise.all([fetchChannelSettings(), fetchLatestSnapshot()]);
    setSettings(s.data);
    setSnapshot(snap.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const day = useMemo(() => computeDayCounter(settings?.campaign_start_date, settings?.test_window_days), [settings]);
  const ratio = +snapshot?.daily_ratio || 0;
  const rStatus = useMemo(() => ratioStatus(ratio, settings), [ratio, settings]);
  const diagnosis = useMemo(() => diagnoseFunnel(snapshot, settings), [snapshot, settings]);
  const killRows = useMemo(() => computeKillProgress(snapshot, settings), [snapshot, settings]);
  const killComposite = useMemo(() => compositeKillProgress(killRows), [killRows]);
  const trajectory = useMemo(() => projectTrajectory(scenarioKey, settings, snapshot), [scenarioKey, settings, snapshot]);
  const killDate = useMemo(() => estimateKillDate(scenarioKey, settings, snapshot), [scenarioKey, settings, snapshot]);

  const ad = +snapshot?.ad_spend_60d || 0;
  const leads = +snapshot?.leads_60d || 0;
  const booked = +snapshot?.booked_calls_60d || 0;
  const showed = +snapshot?.showed_up_60d || 0;
  const closed = +snapshot?.closed_60d || 0;
  const mrr60 = +snapshot?.new_mrr_60d || 0;

  const cpl = leads > 0 ? ad / leads : 0;
  const leadToBook = leads > 0 ? booked / leads : 0;
  const showRate = booked > 0 ? showed / booked : 0;
  const closeRate = showed > 0 ? closed / showed : 0;

  const fpMix = (closed > 0)
    ? (+snapshot?.new_closes_full_partner_60d || 0)
      / Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))
    : 0;

  async function handleIngest() {
    setIngesting(true);
    const { data, error } = await triggerStripeIngest(session);
    setIngesting(false);
    if (error) { showToast(`Ingest failed: ${error}`); return; }
    showToast(`Stripe sync complete · ${data?.stripe_pulled?.active_full_partner || 0} Full/Partner · ${data?.stripe_pulled?.active_core || 0} Core`);
    load();
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function openEdit() {
    setEditForm({
      ad_spend_60d: snapshot?.ad_spend_60d || 0,
      leads_60d: snapshot?.leads_60d || 0,
      booked_calls_60d: snapshot?.booked_calls_60d || 0,
      showed_up_60d: snapshot?.showed_up_60d || 0,
      closed_60d: snapshot?.closed_60d || 0,
      new_mrr_60d: snapshot?.new_mrr_60d || 0,
    });
    setEditMode(true);
  }

  async function saveEdit() {
    const today = new Date().toISOString().slice(0, 10);
    const fields = Object.fromEntries(Object.entries(editForm).map(([k, v]) => [k, Number(v) || 0]));
    const { error } = await upsertSnapshotFields(today, fields);
    if (error) { showToast(`Save failed: ${error}`); return; }
    setEditMode(false);
    showToast("Saved");
    load();
  }

  if (loading) {
    return (
      <div style={{ padding: 28 }}>
        <div style={{ color: tk.textSub, fontSize: 13 }}>Loading channel data…</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ padding: 28 }}>
        <div style={{
          background: tk.surfaceEl, border: `1px solid ${tk.amber}40`, borderRadius: 14,
          padding: "22px 24px", color: tk.text,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: tk.amber, marginBottom: 6 }}>Channel not initialized</div>
          <div style={{ fontSize: 13, color: tk.textSub }}>
            Run <code style={{ background: tk.surfaceHov, padding: "2px 6px", borderRadius: 4 }}>bam_channel_schema.sql</code> in Supabase, then refresh.
          </div>
        </div>
      </div>
    );
  }

  // Diagnosis status drives the third question card
  const q3status = diagnosis ? "bad" : "good";
  const lastSyncStr = snapshot?.updated_at
    ? new Date(snapshot.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <div style={{ padding: 28 }}>
      <PageHeader tk={tk} day={day} settings={settings} onSync={handleIngest} onEdit={openEdit} ingesting={ingesting} />

      <DecisionBanner tk={tk} day={day} />

      {/* Three top questions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
        <QuestionCard
          tk={tk} delay={0}
          label="Question 1"
          question="Is the channel working?"
          answer={`$${ratio.toFixed(2)}`}
          status={rStatus}
          detail={<>MRR per $1 ad spend (60-day rolling)<br />
            {rStatus === "good" && "At or above $3:1 target"}
            {rStatus === "warn" && "Acceptable range — target $3.00+"}
            {rStatus === "bad" && "Below $1.50:1 acceptable — failing"}
          </>}
        />
        <QuestionCard
          tk={tk} delay={60}
          label="Question 2"
          question="Are we on track to kill basketball?"
          answer={`${killComposite}%`}
          status="neutral"
          detail={<>Average across {killRows.length} criteria<br />
            Est. completion: {killDate} at current pace
          </>}
        />
        <QuestionCard
          tk={tk} delay={120}
          label="Question 3"
          question="Where's the funnel breaking?"
          answer={diagnosis ? diagnosis.stage : "ALL GOOD"}
          status={q3status}
          detail={diagnosis
            ? <>{diagnosis.actualPct} actual — target {diagnosis.targetPct}<br />Largest gap to benchmark</>
            : <>All stages at or above target<br />Funnel healthy</>}
        />
      </div>

      {/* Funnel */}
      <SectionHeader tk={tk} title="Funnel" source="Meta + Stripe + CRM · 60d" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <FunnelStep tk={tk} label="Ad Spend" value={fmtMoney(ad)} rate="60d total" />
        <FunnelStep tk={tk} label="Leads" value={leads.toLocaleString()} rate="CPL" rateNum={`$${cpl.toFixed(2)}`}
          rateStatus={cpl <= (settings.target_cpl || 15) ? "good" : cpl <= (settings.acceptable_cpl || 30) ? "warn" : "bad"}
          target={`target <$${settings.target_cpl}`} />
        <FunnelStep tk={tk} label="Booked" value={booked.toLocaleString()} rate="L→B" rateNum={`${Math.round(leadToBook * 100)}%`}
          rateStatus={leadToBook >= (settings.target_lead_to_book || 0.4) ? "good" : leadToBook >= (settings.acceptable_lead_to_book || 0.25) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_lead_to_book || 0.4) * 100)}%`} />
        <FunnelStep tk={tk} label="Showed" value={showed.toLocaleString()} rate="Show" rateNum={`${Math.round(showRate * 100)}%`}
          rateStatus={showRate >= (settings.target_show_rate || 0.65) ? "good" : showRate >= (settings.acceptable_show_rate || 0.5) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_show_rate || 0.65) * 100)}%`} />
        <FunnelStep tk={tk} label="Closed" value={closed.toLocaleString()} rate="Close" rateNum={`${Math.round(closeRate * 100)}%`}
          rateStatus={closeRate >= (settings.target_close_rate || 0.6) ? "good" : closeRate >= (settings.acceptable_close_rate || 0.4) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_close_rate || 0.6) * 100)}%`} />
        <FunnelStep tk={tk} label="New MRR" value={fmtMoney(mrr60)} rate="per $1 ad" rateNum={`$${ratio.toFixed(2)}`}
          rateStatus={rStatus} target={`target >$${settings.target_mrr_per_ad_dollar.toFixed(2)}`} accent />
      </div>

      {/* Diagnosis callout */}
      {diagnosis && diagnosis.counterfactual && (
        <div style={{
          marginTop: 14, padding: "14px 18px", borderRadius: 14,
          background: `${tk.amber}10`, border: `1px solid ${tk.amber}30`,
          fontSize: 12, color: tk.textSub, lineHeight: 1.5,
        }}>
          <strong style={{ color: tk.amber }}>Diagnosis · </strong>
          Funnel collapsing at {diagnosis.stage.toLowerCase()} stage. {diagnosis.counterfactual}
        </div>
      )}

      {/* Closed mix */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader tk={tk} title="Closed mix (60d)" source="Stripe" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <ProgressRow
            tk={tk}
            label="SS Full / Partner"
            actual={+snapshot?.new_closes_full_partner_60d || 0}
            target={Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))}
            pct={Math.round(fpMix * 100)}
            detail={`${Math.round(fpMix * 100)}% of new closes · target ${Math.round((settings.target_full_partner_mix || 0.6) * 100)}%`}
            unit="count"
          />
          <ProgressRow
            tk={tk}
            label="SS Core (downsell)"
            actual={+snapshot?.new_closes_core_60d || 0}
            target={Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))}
            pct={Math.round((1 - fpMix) * 100)}
            detail={`${Math.round((1 - fpMix) * 100)}% of new closes · target ${Math.round((1 - (settings.target_full_partner_mix || 0.6)) * 100)}%`}
            unit="count"
          />
        </div>
      </div>

      {/* Kill basketball progress */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader tk={tk} title="Kill basketball · progress" source="Stripe + CRM · live" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {killRows.map((r, i) => <ProgressRow key={i} tk={tk} {...r} delay={i * 40} />)}
        </div>
        <div style={{
          marginTop: 16, padding: "14px 18px", borderRadius: 14,
          background: tk.surfaceEl, border: `1px solid ${tk.border}`,
          fontSize: 12, color: tk.textSub,
          display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
        }}>
          <span><strong style={{ color: tk.text }}>Composite progress · </strong>
            {killComposite}% — on pace for {killDate} completion if trajectory holds</span>
          <span><strong style={{ color: tk.text }}>Rate-limiter · </strong>
            {killRows.reduce((min, r) => r.pct < min.pct ? r : min, { pct: 101, label: "—" }).label}</span>
        </div>
      </div>

      {/* Trajectory */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader tk={tk} title="Trajectory · 12-month MRR projection" source="Projected" />
        <div style={{
          background: tk.surfaceEl, borderRadius: 16, border: `1px solid ${tk.border}`,
          padding: "22px 24px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: tk.text, margin: 0 }}>
              Where we're heading — total BAM Business MRR
            </h3>
            <div style={{ display: "flex", gap: 4, background: tk.surfaceHov, padding: 3, borderRadius: 8 }}>
              {["bear", "base", "bull"].map((k) => (
                <button key={k} onClick={() => setScenarioKey(k)} style={{
                  background: scenarioKey === k ? tk.accent : "transparent",
                  color: scenarioKey === k ? tk.bg : tk.textSub,
                  border: 0, padding: "5px 14px", fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.04em", cursor: "pointer", textTransform: "uppercase",
                  borderRadius: 6, transition: `all 0.2s ${SPRING}`,
                  fontFamily: "inherit",
                }}>{k}</button>
              ))}
            </div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trajectory.map((v, m) => ({ month: `M${m}`, projected: v }))}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tk.accent} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={tk.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke={tk.border} />
                <XAxis dataKey="month" tick={{ fill: tk.textMute, fontSize: 11 }} stroke={tk.border} />
                <YAxis tick={{ fill: tk.textMute, fontSize: 11 }} stroke={tk.border}
                  tickFormatter={(v) => `$${Math.round(v / 1000)}K`} />
                <Tooltip
                  contentStyle={{ background: tk.surface, border: `1px solid ${tk.border}`, fontSize: 12, borderRadius: 8 }}
                  formatter={(v) => fmtMoney(v)}
                />
                <ReferenceLine y={settings.kill_total_mrr} stroke={tk.textMute} strokeDasharray="4 4"
                  label={{ value: `Kill ${fmtMoneyK(settings.kill_total_mrr)}`, position: "insideTopLeft", fill: tk.textMute, fontSize: 11 }} />
                <Area type="monotone" dataKey="projected" stroke={tk.accent} fill="url(#gradGold)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{
            marginTop: 14, display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14,
          }}>
            <Stat tk={tk} label="Month 12 MRR" value={fmtMoneyK(trajectory[12])} />
            <Stat tk={tk} label="Month 12 ARR" value={fmtMoneyK(trajectory[12] * 12)} />
            <Stat tk={tk} label="Kill date est." value={killDate} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 32, paddingTop: 18, borderTop: `1px solid ${tk.border}`,
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        fontSize: 11, color: tk.textMute,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: tk.green, boxShadow: tk.greenGlow,
          }} />
          Last sync · {lastSyncStr} · Stripe live · Meta + CRM manual
        </div>
        <div>Pre-committed decision rules at Day {day.total}</div>
      </div>

      {/* Edit modal */}
      {editMode && (
        <div onClick={() => setEditMode(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
          animation: `fadeIn 0.2s ${SPRING}`,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: tk.surface, border: `1px solid ${tk.borderMed}`,
            borderRadius: 16, padding: 28, minWidth: 440, maxWidth: 520,
            boxShadow: tk.cardHover,
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: tk.text, letterSpacing: "-0.02em", margin: "0 0 6px" }}>
              Edit funnel (60d)
            </h3>
            <p style={{ fontSize: 12, color: tk.textSub, margin: "0 0 20px" }}>
              These numbers come from Meta + CRM (hand-entered until ingestion lands).
            </p>
            {[
              ["Ad spend", "ad_spend_60d", "$"],
              ["Leads", "leads_60d", ""],
              ["Booked calls", "booked_calls_60d", ""],
              ["Showed up", "showed_up_60d", ""],
              ["Closed", "closed_60d", ""],
              ["New MRR", "new_mrr_60d", "$"],
            ].map(([label, key, prefix]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginBottom: 6, textTransform: "uppercase" }}>
                  {label}
                </label>
                <div style={{
                  display: "flex", alignItems: "center",
                  background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 10,
                  padding: "10px 12px",
                }}>
                  {prefix && <span style={{ color: tk.textMute, marginRight: 8, fontSize: 13 }}>{prefix}</span>}
                  <input
                    type="number"
                    value={editForm[key] ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                    style={{
                      background: "transparent", border: "none", outline: "none",
                      color: tk.text, fontFamily: "inherit", fontSize: 14, fontWeight: 600, width: "100%",
                    }}
                  />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setEditMode(false)} style={btn(tk, "ghost")}>Cancel</button>
              <button onClick={saveEdit} style={btn(tk, "primary")}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: tk.surfaceEl, border: `1px solid ${tk.accentBorder}`,
          color: tk.text, padding: "12px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 500, zIndex: 200,
          boxShadow: tk.cardHover,
          animation: `slideUp 0.3s ${SPRING}`,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────
function Stat({ tk, label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tk.text, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

function btn(tk, kind) {
  const base = {
    fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
    padding: "8px 14px", borderRadius: 10, cursor: "pointer",
    fontFamily: "inherit", transition: `all 0.2s ${SPRING}`,
  };
  if (kind === "primary") {
    return { ...base, background: tk.accent, color: tk.bg, border: `1px solid ${tk.accent}` };
  }
  return { ...base, background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.border}` };
}
