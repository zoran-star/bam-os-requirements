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

const fmtMoney = (n) => "$" + Math.round(n || 0).toLocaleString();
const fmtMoneyK = (n) => "$" + (Math.round((n || 0) / 100) / 10) + "K";

function StatusBar({ status, tk }) {
  const color = status === "good" ? tk.green : status === "warn" ? tk.amber : status === "bad" ? tk.red : tk.accent;
  return <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: color }} />;
}

function QuestionCard({ label, question, answer, detail, status, tk }) {
  const color = status === "good" ? tk.green : status === "warn" ? tk.amber : status === "bad" ? tk.red : tk.accent;
  return (
    <div style={{
      background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 4,
      padding: 20, position: "relative", overflow: "hidden",
    }}>
      <StatusBar status={status} tk={tk} />
      <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 16, minHeight: 36 }}>{question}</div>
      <div style={{
        fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 36, lineHeight: 1,
        letterSpacing: 1, marginBottom: 8, color,
      }}>{answer}</div>
      <div style={{ fontSize: 11, color: tk.textSub }}>{detail}</div>
    </div>
  );
}

function FunnelStep({ label, value, rate, rateNum, rateStatus, target, tk }) {
  const rc = rateStatus === "good" ? tk.green : rateStatus === "warn" ? tk.amber : rateStatus === "bad" ? tk.red : tk.textSub;
  return (
    <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, padding: 14, borderRadius: 4 }}>
      <div style={{ fontSize: 9, color: tk.textMute, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 28, lineHeight: 1, marginBottom: 4, color: tk.text }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: tk.textSub }}>
        {rate} <span style={{ color: rc, fontWeight: 700 }}>{rateNum}</span>
      </div>
      {target && <div style={{ fontSize: 9, color: tk.textMute, marginTop: 4 }}>{target}</div>}
    </div>
  );
}

function ProgressRow({ label, actual, target, pct, detail, sustainDays, sustainTarget, unit, tk }) {
  const display = unit === "money"
    ? `${fmtMoneyK(actual)} / ${fmtMoneyK(target)}`
    : unit === "days"
      ? `${actual} / ${target}d`
      : `${actual} / ${target}`;
  const complete = pct >= 100;
  return (
    <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, padding: 16, borderRadius: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: tk.text, letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 18, color: tk.accent, letterSpacing: 1 }}>
          {display}
        </span>
      </div>
      <div style={{ height: 8, background: tk.surfaceEl, borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.min(100, pct)}%`,
          background: complete
            ? `linear-gradient(90deg, ${tk.green}, ${tk.green})`
            : `linear-gradient(90deg, ${tk.accentBorder}, ${tk.accent})`,
          borderRadius: 4, transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{ fontSize: 10, color: tk.textSub, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span>{detail || `${pct}% complete`}</span>
        <span style={{ color: sustainDays != null && sustainDays < sustainTarget ? tk.red : tk.textSub }}>
          {sustainDays != null ? `${sustainDays} / ${sustainTarget}d sustained` : (unit === "money" ? `+${fmtMoneyK(target - actual)} needed` : `+${Math.max(0, target - actual)} needed`)}
        </span>
      </div>
    </div>
  );
}

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
    const [s, snap] = await Promise.all([
      fetchChannelSettings(),
      fetchLatestSnapshot(),
    ]);
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
    ? (+snapshot?.new_closes_full_partner_60d || 0) / Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))
    : 0;

  async function handleIngest() {
    setIngesting(true);
    const { data, error } = await triggerStripeIngest(session);
    setIngesting(false);
    if (error) { setToast(`Ingest failed: ${error}`); setTimeout(() => setToast(null), 4000); return; }
    setToast(`Stripe sync complete · ${data?.stripe_pulled?.active_full_partner || 0} Full/Partner · ${data?.stripe_pulled?.active_core || 0} Core`);
    setTimeout(() => setToast(null), 4000);
    load();
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
    if (error) { setToast(`Save failed: ${error}`); setTimeout(() => setToast(null), 4000); return; }
    setEditMode(false);
    setToast("Saved");
    setTimeout(() => setToast(null), 2500);
    load();
  }

  if (loading) {
    return <div style={{ padding: 24, color: tk.textSub, fontFamily: "'DM Mono', monospace" }}>Loading channel data…</div>;
  }

  if (!settings) {
    return (
      <div style={{ padding: 24, color: tk.textSub, fontFamily: "'DM Mono', monospace" }}>
        <strong style={{ color: tk.amber }}>Channel not initialized.</strong> Run <code>bam_channel_schema.sql</code> in Supabase to create tables, then refresh.
      </div>
    );
  }

  const fontMono = "'DM Mono', 'SF Mono', Monaco, monospace";

  return (
    <div style={{ padding: 24, color: tk.text, fontFamily: fontMono, fontSize: 13, lineHeight: 1.5 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32, paddingBottom: 16, borderBottom: `1px solid ${tk.border}` }}>
        <div>
          <h1 style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 32, fontWeight: 400, letterSpacing: 2, color: tk.text, margin: 0 }}>
            BAM BUSINESS
          </h1>
          <div style={{ color: tk.accent, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 4 }}>
            Basketball Channel — Operating Dashboard
          </div>
        </div>
        <div style={{ textAlign: "right", color: tk.textSub, fontSize: 11 }}>
          <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 28, color: tk.accent, letterSpacing: 1 }}>
            DAY {day.dayN} / {day.total}
          </div>
          <div>{day.total}-day test window — ends {new Date(new Date(settings.campaign_start_date).getTime() + day.total * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={handleIngest} disabled={ingesting} style={btnStyle(tk, "ghost")}>
              {ingesting ? "Syncing…" : "Sync Stripe"}
            </button>
            <button onClick={openEdit} style={btnStyle(tk, "ghost")}>Edit funnel</button>
          </div>
        </div>
      </div>

      {/* Decision banner */}
      <div style={{
        background: tk.surface, border: `1px solid ${tk.accentBorder}`, borderRadius: 4,
        padding: "16px 20px", marginBottom: 24,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 10, color: tk.accent, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Next strategic decision
          </div>
          <div style={{ fontSize: 13, color: tk.text }}>
            At Day {day.total}, channel decision is automatic per pre-committed rules. No strategy debate until then.
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 32, color: tk.accent, letterSpacing: 1 }}>
            {day.daysRemaining}
          </div>
          <div style={{ fontSize: 10, color: tk.textSub }}>DAYS REMAINING</div>
        </div>
      </div>

      {/* Three top questions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 32 }}>
        <QuestionCard
          tk={tk}
          label="Question 1"
          question="Is the channel working?"
          answer={`$${ratio.toFixed(2)}`}
          status={rStatus}
          detail={<>MRR per $1 ad spend (60-day rolling)<br />
            {rStatus === "good" && <><span style={{ color: tk.green }}>▲</span> At or above $3:1 target</>}
            {rStatus === "warn" && <><span style={{ color: tk.amber }}>▲</span> Acceptable range — target $3.00+</>}
            {rStatus === "bad" && <><span style={{ color: tk.red }}>▼</span> Below $1.50:1 acceptable — failing</>}
          </>}
        />
        <QuestionCard
          tk={tk}
          label="Question 2"
          question="Are we on track to kill basketball?"
          answer={`${killComposite}%`}
          status="neutral"
          detail={<>Avg progress across {killRows.length} criteria<br />
            <span style={{ color: tk.accent }}>●</span> Est. completion: {killDate} at current pace
          </>}
        />
        <QuestionCard
          tk={tk}
          label="Question 3"
          question="Where's the funnel breaking?"
          answer={diagnosis ? diagnosis.stage : "ALL GOOD"}
          status={diagnosis ? "bad" : "good"}
          detail={diagnosis
            ? <>{diagnosis.actualPct} actual — target {diagnosis.targetPct}<br /><span style={{ color: tk.red }}>▼</span> Largest gap to benchmark</>
            : <>All stages at or above target<br /><span style={{ color: tk.green }}>▲</span> Funnel healthy</>}
        />
      </div>

      {/* Funnel section */}
      <SectionHeader title="FUNNEL" source="META + STRIPE + CRM • 60d" tk={tk} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        <FunnelStep tk={tk} label="Ad Spend" value={fmtMoney(ad)} rate="60d total" rateNum="" target="" />
        <FunnelStep tk={tk} label="Leads" value={leads.toLocaleString()} rate="CPL" rateNum={`$${cpl.toFixed(2)}`}
          rateStatus={cpl <= (settings.target_cpl || 15) ? "good" : cpl <= (settings.acceptable_cpl || 30) ? "warn" : "bad"}
          target={`target <$${settings.target_cpl}`} />
        <FunnelStep tk={tk} label="Booked Calls" value={booked.toLocaleString()} rate="L→B" rateNum={`${Math.round(leadToBook * 100)}%`}
          rateStatus={leadToBook >= (settings.target_lead_to_book || 0.4) ? "good" : leadToBook >= (settings.acceptable_lead_to_book || 0.25) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_lead_to_book || 0.4) * 100)}%`} />
        <FunnelStep tk={tk} label="Showed Up" value={showed.toLocaleString()} rate="Show" rateNum={`${Math.round(showRate * 100)}%`}
          rateStatus={showRate >= (settings.target_show_rate || 0.65) ? "good" : showRate >= (settings.acceptable_show_rate || 0.5) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_show_rate || 0.65) * 100)}%`} />
        <FunnelStep tk={tk} label="Closed" value={closed.toLocaleString()} rate="Close" rateNum={`${Math.round(closeRate * 100)}%`}
          rateStatus={closeRate >= (settings.target_close_rate || 0.6) ? "good" : closeRate >= (settings.acceptable_close_rate || 0.4) ? "warn" : "bad"}
          target={`target >${Math.round((settings.target_close_rate || 0.6) * 100)}%`} />
        <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, padding: 14, borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: tk.textMute, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>New MRR</div>
          <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 28, lineHeight: 1, marginBottom: 4, color: tk.accent }}>
            {fmtMoney(mrr60)}
          </div>
          <div style={{ fontSize: 10, color: tk.textSub }}>
            <span style={{ color: tk.accent, fontWeight: 700 }}>${ratio.toFixed(2)}</span> per $1 ad
          </div>
          <div style={{ fontSize: 9, color: tk.textMute, marginTop: 4 }}>target &gt;${settings.target_mrr_per_ad_dollar.toFixed(2)}</div>
        </div>
      </div>

      {/* Diagnosis callout */}
      {diagnosis && diagnosis.counterfactual && (
        <div style={{ marginTop: 12, padding: 12, background: tk.surfaceEl, borderRadius: 4, fontSize: 11, color: tk.textSub }}>
          <strong style={{ color: tk.amber }}>⚠ Diagnosis:</strong> Funnel collapsing at {diagnosis.stage.toLowerCase()} stage. {diagnosis.counterfactual}
        </div>
      )}

      {/* Closed mix */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader title="CLOSED MIX" source="STRIPE" tk={tk} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ProgressRow
            tk={tk}
            label="SS Full / Partner"
            actual={+snapshot?.new_closes_full_partner_60d || 0}
            target={Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))}
            pct={Math.round(fpMix * 100)}
            detail={`${Math.round(fpMix * 100)}% of new closes — target ${Math.round((settings.target_full_partner_mix || 0.6) * 100)}%`}
            unit="count"
          />
          <ProgressRow
            tk={tk}
            label="SS Core (downsell)"
            actual={+snapshot?.new_closes_core_60d || 0}
            target={Math.max(1, (+snapshot?.new_closes_full_partner_60d || 0) + (+snapshot?.new_closes_core_60d || 0))}
            pct={Math.round((1 - fpMix) * 100)}
            detail={`${Math.round((1 - fpMix) * 100)}% of new closes — target ${Math.round((1 - (settings.target_full_partner_mix || 0.6)) * 100)}%`}
            unit="count"
          />
        </div>
      </div>

      {/* Kill basketball progress */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader title="KILL BASKETBALL — PROGRESS" source="STRIPE + CRM • LIVE" tk={tk} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {killRows.map((r, i) => <ProgressRow key={i} tk={tk} {...r} />)}
        </div>
        <div style={{ marginTop: 16, padding: 12, background: tk.surfaceEl, borderRadius: 4, fontSize: 11, color: tk.textSub, display: "flex", justifyContent: "space-between" }}>
          <span><strong style={{ color: tk.accent }}>Composite progress:</strong> {killComposite}% — on pace for {killDate} completion if trajectory holds</span>
          <span><strong style={{ color: tk.accent }}>Rate-limiter:</strong> {killRows.reduce((min, r) => r.pct < min.pct ? r : min, { pct: 101, label: "—" }).label}</span>
        </div>
      </div>

      {/* Trajectory */}
      <div style={{ marginTop: 32 }}>
        <SectionHeader title="TRAJECTORY" source="PROJECTED • 12-MONTH MRR" tk={tk} />
        <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 4, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 12, color: tk.text, letterSpacing: 1, textTransform: "uppercase", margin: 0, fontWeight: 600 }}>
              Where we're heading — total BAM Business MRR
            </h3>
            <div style={{ display: "flex", gap: 4 }}>
              {["bear", "base", "bull"].map(k => (
                <button key={k} onClick={() => setScenarioKey(k)} style={{
                  background: scenarioKey === k ? tk.accent : tk.surfaceEl,
                  color: scenarioKey === k ? tk.bg : tk.textSub,
                  border: `1px solid ${scenarioKey === k ? tk.accent : tk.border}`,
                  padding: "4px 10px", fontSize: 10, fontFamily: "inherit", letterSpacing: 1,
                  cursor: "pointer", textTransform: "uppercase",
                }}>{k}</button>
              ))}
            </div>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trajectory.map((v, m) => ({
                month: `M${m}`,
                projected: v,
                threshold: settings.kill_total_mrr,
              }))} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tk.accent} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={tk.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" stroke={tk.border} />
                <XAxis dataKey="month" tick={{ fill: tk.textMute, fontSize: 10 }} stroke={tk.border} />
                <YAxis tick={{ fill: tk.textMute, fontSize: 10 }} stroke={tk.border}
                  tickFormatter={(v) => `$${Math.round(v / 1000)}K`} />
                <Tooltip
                  contentStyle={{ background: tk.surface, border: `1px solid ${tk.border}`, fontSize: 11 }}
                  formatter={(v) => fmtMoney(v)}
                />
                <ReferenceLine y={settings.kill_total_mrr} stroke={tk.textMute} strokeDasharray="4 4"
                  label={{ value: "Kill threshold", position: "insideTopLeft", fill: tk.textMute, fontSize: 10 }} />
                <Area type="monotone" dataKey="projected" stroke={tk.accent} fill="url(#gradGold)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: tk.textSub, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><strong style={{ color: tk.text }}>Month 12 MRR:</strong> {fmtMoneyK(trajectory[12])}</div>
            <div><strong style={{ color: tk.text }}>Month 12 ARR:</strong> {fmtMoneyK(trajectory[12] * 12)}</div>
            <div><strong style={{ color: tk.text }}>Kill date est:</strong> {killDate}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${tk.border}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: tk.textMute }}>
        <div>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: tk.green, marginRight: 6 }} />
          Last sync: {snapshot?.updated_at ? new Date(snapshot.updated_at).toLocaleString() : "never"} • Stripe • Meta Ads (manual) • CRM (manual)
        </div>
        <div>Pre-committed decision rules at Day {day.total} — no strategic debate until then</div>
      </div>

      {/* Edit modal */}
      {editMode && (
        <div onClick={() => setEditMode(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 6, padding: 24, minWidth: 420 }}>
            <h3 style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 22, letterSpacing: 1, color: tk.accent, margin: "0 0 16px" }}>EDIT FUNNEL (60d)</h3>
            {[
              ["Ad spend (60d)", "ad_spend_60d", "$"],
              ["Leads (60d)", "leads_60d", ""],
              ["Booked calls (60d)", "booked_calls_60d", ""],
              ["Showed up (60d)", "showed_up_60d", ""],
              ["Closed (60d)", "closed_60d", ""],
              ["New MRR (60d)", "new_mrr_60d", "$"],
            ].map(([label, key, prefix]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, color: tk.textSub, marginBottom: 4, letterSpacing: 0.5 }}>{label}</label>
                <div style={{ display: "flex", alignItems: "center", background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 4, padding: "8px 10px" }}>
                  {prefix && <span style={{ color: tk.textMute, marginRight: 6 }}>{prefix}</span>}
                  <input
                    type="number"
                    value={editForm[key] ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                    style={{ background: "transparent", border: "none", outline: "none", color: tk.text, fontFamily: fontMono, fontSize: 13, width: "100%" }}
                  />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setEditMode(false)} style={btnStyle(tk, "ghost")}>Cancel</button>
              <button onClick={saveEdit} style={btnStyle(tk, "primary")}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: tk.surface, border: `1px solid ${tk.accentBorder}`, color: tk.text, padding: "12px 18px", borderRadius: 4, fontSize: 12, zIndex: 200 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, source, tk }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 16, gap: 12 }}>
      <h2 style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 18, letterSpacing: 2, color: tk.accent, fontWeight: 400, margin: 0 }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: tk.border }} />
      <span style={{ fontSize: 10, color: tk.textMute, letterSpacing: 1, background: tk.surfaceEl, padding: "2px 6px", borderRadius: 2, textTransform: "uppercase" }}>
        {source}
      </span>
    </div>
  );
}

function btnStyle(tk, kind) {
  const base = {
    fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: 0.5,
    padding: "6px 12px", borderRadius: 4, cursor: "pointer", textTransform: "uppercase",
  };
  if (kind === "primary") {
    return { ...base, background: tk.accent, color: tk.bg, border: `1px solid ${tk.accent}` };
  }
  return { ...base, background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.border}` };
}
