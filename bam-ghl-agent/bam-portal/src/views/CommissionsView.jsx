import { useEffect, useMemo, useState } from "react";
import { SkelStats, SkelRows } from "../components/Skeleton.jsx";

// Commission & BAM Payment Calculator (Mike / BAM spec, 2026-07-25).
// Staff-only: admin sees every client; a scaling manager sees only their own
// assigned clients (enforced server-side in api/commissions.js). Admins set
// each client's payment terms here (the "client onboarding fields" from the
// spec), review monthly cycles, and can preview / manually run a cycle - the
// daily crons handle the automatic runs and the batched Anna+Cole reports.

import { showToast, uiConfirm } from "../components/dialogs.jsx";
const MODEL_LABEL = { flat_retainer: "Flat Retainer", growth_percentage: "Growth %" };

function money(n) {
  if (n == null || n === "") return "-";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CommissionsView({ tokens, session, me }) {
  const t = tokens;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);

  const tok = session?.access_token;
  async function api(method, qs, body) {
    const res = await fetch("/api/commissions" + (qs || ""), {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code, payload: j });
    return j;
  }

  async function load() {
    setErr(null);
    try { setData(await api("GET", "?action=overview")); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const isAdmin = !!data?.me?.is_admin;
  const smNames = useMemo(() => Object.fromEntries((data?.sms || []).map(s => [s.id, s.name])), [data]);
  const cyclesByClient = useMemo(() => {
    const m = {};
    (data?.cycles || []).forEach(c => { (m[c.client_id] = m[c.client_id] || []).push(c); });
    return m;
  }, [data]);

  if (err) return <div style={{ color: "#e08b7e", padding: 24 }}>{err}</div>;
  if (!data) return <div><SkelStats n={3} t={t} /><div style={{ borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}><SkelRows n={6} t={t} /></div></div>;

  const configured = (data.clients || []).filter(c => c.payment_model);
  const unconfigured = (data.clients || []).filter(c => !c.payment_model);
  const growthCount = configured.filter(c => c.payment_model === "growth_percentage").length;

  const card = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 18px" };
  const th = { textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: t.textMute, padding: "8px 10px" };
  const td = { fontSize: 13, color: t.text, padding: "9px 10px", borderTop: `1px solid ${t.border}` };

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={card}><div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{configured.length}</div><div style={{ fontSize: 12, color: t.textMute }}>clients on a payment model</div></div>
        <div style={card}><div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{growthCount}</div><div style={{ fontSize: 12, color: t.textMute }}>growth-percentage clients</div></div>
        <div style={card}><div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{(data.cycles || []).filter(c => !c.report_sent_at && c.payment_model === "growth_percentage").length}</div><div style={{ fontSize: 12, color: t.textMute }}>cycles awaiting the next report batch</div></div>
      </div>

      <div style={{ fontSize: 12, color: t.textMute, marginBottom: 16, lineHeight: 1.5 }}>
        Cycles close on each client's own renewal date and invoice via Stripe automatically.
        Reports (growth clients only) email to Anna + Cole 3 business days before the 1st and the 15th.
        SM payout is calculated here but paid manually.
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Client</th><th style={th}>Model</th><th style={th}>Terms</th>
            <th style={th}>Renewal</th><th style={th}>SM</th><th style={th}>Last cycle</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {[...configured, ...(isAdmin ? unconfigured : [])].map(c => {
              const latest = (cyclesByClient[c.id] || [])[0];
              const isOpen = openId === c.id;
              return (
                <ClientRows key={c.id} c={c} latest={latest} isOpen={isOpen} isAdmin={isAdmin}
                  cycles={cyclesByClient[c.id] || []} smName={smNames[c.scaling_manager_id]}
                  t={t} td={td} api={api} reload={load}
                  onToggle={() => setOpenId(isOpen ? null : c.id)} />
              );
            })}
            {!data.clients?.length && (
              <tr><td style={{ ...td, color: t.textMute, fontStyle: "italic" }} colSpan={7}>No clients visible to you.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientRows({ c, latest, isOpen, isAdmin, cycles, smName, t, td, api, reload, onToggle }) {
  const isGrowth = c.payment_model === "growth_percentage";
  const terms = !c.payment_model ? <span style={{ color: t.textMute }}>not configured</span>
    : isGrowth
      ? `${money(c.base_retainer)} base · ${c.growth_share_pct ?? "-"}% over ${money(c.baseline_revenue)}`
      : `${money(c.flat_amount)} / month`;
  const pill = c.payment_model && (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${isGrowth ? t.accent : t.blue || t.textMute}22`, color: isGrowth ? t.accent : t.textMute, whiteSpace: "nowrap" }}>
      {MODEL_LABEL[c.payment_model]}
    </span>
  );
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: isOpen ? `${t.accent}0d` : "transparent" }}>
        <td style={{ ...td, fontWeight: 600 }}>{c.business_name}</td>
        <td style={td}>{pill || <span style={{ color: t.textMute }}>-</span>}</td>
        <td style={td}>{terms}</td>
        <td style={td}>{c.subscription_renewal_date || "-"}</td>
        <td style={td}>{smName || "-"}</td>
        <td style={td}>{latest ? `${latest.cycle_date} · ${latest.revenue_pull_status === "failed" ? "pull failed" : money(latest.total_bam_payment)}` : "-"}</td>
        <td style={{ ...td, color: t.textMute }}>{isOpen ? "▴" : "▾"}</td>
      </tr>
      {isOpen && (
        <tr><td colSpan={7} style={{ ...td, background: t.surfaceEl }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "6px 0 10px" }}>
            {isAdmin && <SettingsForm c={c} t={t} api={api} reload={reload} />}
            <CycleHistory c={c} cycles={cycles} t={t} api={api} reload={reload} isAdmin={isAdmin} />
          </div>
        </td></tr>
      )}
    </>
  );
}

// Admin-only: the client-onboarding payment fields from the spec. Baseline is
// locked for 9 months once set - the API rejects an edit unless you confirm
// (agreement renewal), which re-locks it for another 9 months.
function SettingsForm({ c, t, api, reload }) {
  const [f, setF] = useState({
    payment_model: c.payment_model || "",
    flat_amount: c.flat_amount ?? "",
    base_retainer: c.base_retainer ?? 599,
    baseline_revenue: c.baseline_revenue ?? "",
    growth_share_pct: c.growth_share_pct ?? "",
    subscription_renewal_date: c.subscription_renewal_date || "",
    revenue_integration_connection: c.revenue_integration_connection || "",
  });
  const [busy, setBusy] = useState(false);
  const input = { width: "100%", padding: "8px 10px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13, fontFamily: "inherit" };
  const label = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: t.textMute, margin: "10px 0 4px" };
  const isGrowth = f.payment_model === "growth_percentage";

  async function save(confirmReset) {
    setBusy(true);
    try {
      await api("POST", "?action=save-settings", { client_id: c.id, ...f, ...(confirmReset ? { confirm_baseline_reset: true } : {}) });
      reload();
    } catch (e) {
      if (e.code === "baseline_locked") {
        if (await uiConfirm({ title: "Baseline is locked", body: e.message, confirmLabel: "Override and re-lock", danger: true })) return save(true);
      } else showToast(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ flex: "0 0 280px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 2 }}>Payment terms</div>
      <div style={label}>Payment model</div>
      <select value={f.payment_model} onChange={e => setF({ ...f, payment_model: e.target.value })} style={input}>
        <option value="">(not set)</option>
        <option value="flat_retainer">Flat Retainer</option>
        <option value="growth_percentage">Growth Percentage</option>
      </select>
      {f.payment_model === "flat_retainer" && (<>
        <div style={label}>Flat monthly amount ($)</div>
        <input type="number" value={f.flat_amount} onChange={e => setF({ ...f, flat_amount: e.target.value })} style={input} />
      </>)}
      {isGrowth && (<>
        <div style={label}>Base monthly retainer ($)</div>
        <input type="number" value={f.base_retainer} onChange={e => setF({ ...f, base_retainer: e.target.value })} style={input} />
        <div style={label}>Revenue baseline ($){c.baseline_locked_until ? ` · locked until ${c.baseline_locked_until}` : ""}</div>
        <input type="number" value={f.baseline_revenue} onChange={e => setF({ ...f, baseline_revenue: e.target.value })} style={input} />
        <div style={label}>Growth share (%)</div>
        <input type="number" value={f.growth_share_pct} onChange={e => setF({ ...f, growth_share_pct: e.target.value })} style={input} />
      </>)}
      {f.payment_model && (<>
        <div style={label}>Subscription renewal date</div>
        <input type="date" value={f.subscription_renewal_date} onChange={e => setF({ ...f, subscription_renewal_date: e.target.value })} style={input} />
        <div style={label}>Revenue data source</div>
        <select value={f.revenue_integration_connection} onChange={e => setF({ ...f, revenue_integration_connection: e.target.value })} style={input}>
          <option value="">(none)</option>
          <option value="stripe_connect">Client's connected Stripe account</option>
          <option value="ghl">GHL (not wired yet)</option>
        </select>
        <div style={{ fontSize: 11, color: t.textMute, marginTop: 8, lineHeight: 1.5 }}>
          Assigned SM comes from the client record's Scaling Manager. Invoices bill the client's Stripe customer on the platform account.
        </div>
      </>)}
      <button onClick={() => save(false)} disabled={busy}
        style={{ marginTop: 12, padding: "8px 16px", background: t.accent, color: "#0B0B0D", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        {busy ? "Saving…" : "Save terms"}
      </button>
    </div>
  );
}

function CycleHistory({ c, cycles, t, api, reload, isAdmin }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [grossOverride, setGrossOverride] = useState("");

  async function run(dryRun) {
    setBusy(true); setPreview(null);
    try {
      const j = await api("POST", "?action=run-cycle", {
        client_id: c.id, dry_run: dryRun, force: !dryRun,
        ...(grossOverride !== "" ? { gross_override: grossOverride } : {}),
      });
      if (dryRun) setPreview(j.preview);
      else { showToast("Cycle closed" + (j.row?.invoice_id ? ` - Stripe invoice ${j.row.invoice_id}` : "") + "."); reload(); }
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  }

  const cell = { fontSize: 12, color: t.text, padding: "5px 8px", borderTop: `1px solid ${t.border}` };
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 8 }}>Cycles</div>
      {!cycles.length && <div style={{ fontSize: 12, color: t.textMute, fontStyle: "italic" }}>No cycles yet - the daily cron closes the first one on the next renewal anniversary.</div>}
      {cycles.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["Cycle", "Gross", "Growth", "Fee", "Total BAM", "SM comm.", "Invoice", "Report"].map(h =>
              <th key={h} style={{ textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t.textMute, padding: "4px 8px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {cycles.map(cy => (
              <tr key={cy.id}>
                <td style={cell}>{cy.cycle_date}</td>
                <td style={cell}>{cy.revenue_pull_status === "failed" ? <span style={{ color: t.amber }} title={cy.revenue_pull_error || ""}>pull failed</span> : money(cy.gross_revenue)}</td>
                <td style={cell}>{money(cy.growth_amount)}</td>
                <td style={cell}>{money(cy.growth_share_fee)}</td>
                <td style={{ ...cell, fontWeight: 600 }}>{money(cy.total_bam_payment)}</td>
                <td style={cell}>{money(cy.sm_commission)}</td>
                <td style={cell}>{cy.invoice_id ? (cy.invoice_status || "created") : "-"}</td>
                <td style={cell}>{cy.report_sent_at ? "sent" : (cy.payout_batch || "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isAdmin && c.payment_model && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <input type="number" placeholder="Gross override ($)" value={grossOverride} onChange={e => setGrossOverride(e.target.value)}
            title="Use when the automatic revenue pull failed - enter gross revenue by hand"
            style={{ width: 150, padding: "7px 10px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 12 }} />
          <button onClick={() => run(true)} disabled={busy} style={{ padding: "7px 12px", background: "transparent", color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Preview today's cycle</button>
          <button onClick={async () => { if (await uiConfirm({ title: "Close this cycle now?", body: "This computes the cycle and generates the Stripe invoice.", confirmLabel: "Run cycle" })) run(false); }} disabled={busy}
            style={{ padding: "7px 12px", background: t.accent, color: "#0B0B0D", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Run cycle now</button>
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 10, fontSize: 12, color: t.text, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 12px", lineHeight: 1.7 }}>
          <b>Preview ({preview.cycle_start} to {preview.cycle_date}):</b>{" "}
          {preview.revenue_pull_status === "failed"
            ? <span style={{ color: t.amber }}>revenue pull failed - {preview.revenue_pull_error}</span>
            : preview.payment_model === "flat_retainer"
              ? <>flat {money(preview.total_bam_payment)}</>
              : <>gross {money(preview.gross_revenue)} · growth {money(preview.growth_amount)} · fee {money(preview.growth_share_fee)} · <b>total {money(preview.total_bam_payment)}</b> · SM commission {money(preview.sm_commission)}</>}
        </div>
      )}
    </div>
  );
}
