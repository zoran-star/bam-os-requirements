import { useEffect, useState } from "react";

// Phone tab in the client detail view - the staff face of the phone pipeline.
// Three phases:
//   none    → two actions: start a GHL port migration, or buy a new number
//   pending → live pills for the port + A2P legs (the migration watcher
//             flips them; "Check now" pokes it for this client)
//   live    → the number, voice config, cutover date + this month's spend
export default function PhoneTab({ client, tokens: t, session }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const api = async (path, opts = {}) => {
    const r = await fetch(path, {
      ...opts,
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  const load = async () => {
    try { setErr(""); setData(await api(`/api/twilio/migration-status?client_id=${client.id}`)); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client.id]);

  const startPort = async () => {
    const number = window.prompt("The number being ported (E.164, e.g. +17862443336) - from the phone audit:");
    if (!number) return;
    const ring = window.prompt("Which cell should ring on inbound calls? (E.164, blank = decide later)") || "";
    const a2p = window.confirm("US client? (OK = yes, A2P texting registration required · Cancel = CA/AU, no A2P)");
    setBusy("Starting migration…");
    try {
      const j = await api("/api/twilio/start-migration", {
        method: "POST",
        body: JSON.stringify({ client_id: client.id, phone_number: number.trim(), ring_number: ring.trim() || undefined, a2p_required: a2p }),
      });
      window.alert(`Migration started.\n\nNEXT (5 min): submit the port in the Twilio console.\nTarget subaccount: ${j.port_submission_pack.target_subaccount_sid}\n\n${j.port_submission_pack.steps.join("\n")}`);
      await load();
    } catch (e) { window.alert("Couldn't start: " + e.message); }
    setBusy("");
  };

  const buyNumber = async () => {
    const area = window.prompt("Preferred area code (e.g. 416), blank = any:") || "";
    const ring = window.prompt("Which cell should ring on inbound calls? (E.164)") || "";
    const country = window.confirm("US number? (OK = US · Cancel = CA)") ? "US" : "CA";
    if (!window.confirm(`Buy a new ${country} number${area ? ` (${area})` : ""} for ${client.business_name}? (~$1.15/mo starts now)`)) return;
    setBusy("Provisioning…");
    try {
      const j = await api("/api/twilio/provision", {
        method: "POST",
        body: JSON.stringify({ client_id: client.id, country, area_code: area.trim() || undefined, ring_number: ring.trim() || undefined }),
      });
      window.alert(`Done: ${j.number}\nCalls + voicemail live now.\n${j.a2p === "n/a (CA)" ? "" : "US texting unlocks after A2P registration."}`);
      await load();
    } catch (e) { window.alert("Couldn't provision: " + e.message); }
    setBusy("");
  };

  const checkNow = async () => {
    setBusy("Checking…");
    try { await api(`/api/twilio/migration-watch?client_id=${client.id}`); await load(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  const S = {
    card: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 18, maxWidth: 640 },
    label: { fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: t.textMute },
    row: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${t.border}` },
    btn: (primary) => ({
      background: primary ? t.accent : "transparent", color: primary ? "#0B0B0D" : t.text,
      border: `1px solid ${primary ? t.accent : t.border}`, borderRadius: 6, padding: "9px 16px",
      fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    }),
  };
  const pill = (label, color) => (
    <span style={{ fontSize: 11, fontWeight: 800, color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 10px" }}>{label}</span>
  );

  if (err) return <div style={{ color: "#e0654f", fontSize: 13 }}>Couldn't load phone status - {err} <button style={S.btn(false)} onClick={load}>Retry</button></div>;
  if (!data) return <div style={{ color: t.textMute, fontSize: 13 }}>Loading phone status…</div>;

  const cfg = data.config || {};
  const spend = `$${(data.month_spend_usd || 0).toFixed(2)} this month`;

  if (data.phase === "live") {
    return (
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={S.label}>Phone system</div>
          {pill("LIVE ON BAM TWILIO", "#7BC47F")}
        </div>
        <div style={S.row}><span style={{ color: t.textMute }}>Number</span><b>{cfg.from_number}</b></div>
        <div style={S.row}><span style={{ color: t.textMute }}>Rings</span><span>{(cfg.voice_ring_numbers || []).join(", ") || "voicemail only"}</span></div>
        <div style={S.row}><span style={{ color: t.textMute }}>Voicemail / missed-call text</span><span>{cfg.voicemail_enabled ? "on" : "off"} / {cfg.missed_call_text_enabled ? "on" : "off"}</span></div>
        {cfg.cutover_at ? <div style={S.row}><span style={{ color: t.textMute }}>Cut over</span><span>{String(cfg.cutover_at).slice(0, 10)}</span></div> : null}
        <div style={{ ...S.row, borderBottom: "none" }}><span style={{ color: t.textMute }}>Twilio spend</span><b>{spend}</b></div>
      </div>
    );
  }

  if (data.phase === "pending") {
    const portLanded = cfg.port_status === "landed";
    const a2pState = !cfg.a2p_required ? ["A2P NOT NEEDED", "#7BC47F"]
      : cfg.a2p_status === "verified" ? ["A2P VERIFIED", "#7BC47F"]
      : cfg.a2p_status === "failed" ? ["A2P FAILED", "#e0654f"]
      : cfg.a2p_campaign_sid ? ["A2P VETTING", "#c79a4a"]
      : ["A2P AWAITING REGISTRATION", "#c79a4a"];
    return (
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={S.label}>Migration in progress</div>
          <button style={S.btn(false)} onClick={checkNow} disabled={!!busy}>{busy || "Check now"}</button>
        </div>
        <div style={S.row}><span style={{ color: t.textMute }}>Number</span><b>{cfg.from_number}</b></div>
        <div style={S.row}>
          <span style={{ color: t.textMute }}>Port</span>
          {portLanded ? pill("LANDED", "#7BC47F") : pill(cfg.port_status === "awaiting_submission" ? "AWAITING CONSOLE SUBMISSION" : "IN TRANSIT", "#c79a4a")}
        </div>
        <div style={S.row}><span style={{ color: t.textMute }}>Texting registration</span>{pill(a2pState[0], a2pState[1])}</div>
        <div style={{ ...S.row, borderBottom: "none" }}>
          <span style={{ color: t.textMute }}>Auto-cutover</span>
          <span>{cfg.auto_cutover ? "on - flips the moment both are green" : "OFF (white glove)"}</span>
        </div>
        <div style={{ fontSize: 12, color: t.textMute, marginTop: 10, lineHeight: 1.5 }}>
          Their texting keeps flowing via GHL until cutover. The watcher checks every 30 minutes.
        </div>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 10 }}>Phone system</div>
      <div style={{ fontSize: 13, color: t.textSub, marginBottom: 16, lineHeight: 1.5 }}>
        Not on the BAM phone spine yet. Two ways in:
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={S.btn(true)} onClick={startPort} disabled={!!busy}>{busy || "Port their GHL number"}</button>
        <button style={S.btn(false)} onClick={buyNumber} disabled={!!busy}>Get a new number</button>
      </div>
    </div>
  );
}
