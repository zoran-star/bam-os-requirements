import { useState, useEffect } from "react";

// GHL KPI Discovery (beta) — read-only spike. Pulls an academy's GoHighLevel
// pipeline (stages + opportunity counts) and asks Claude to map it onto a
// canonical acquisition funnel + recommend which KPIs matter for THIS academy.
// Staff review the suggestion here; nothing is saved yet (next step = an editor
// that persists the mapping to clients.ghl_kpi_config + a learning loop).

export default function GhlKpiDiscovery({ client, tokens, session }) {
  const t = tokens;
  const [locations, setLocations] = useState([]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pipelines, setPipelines] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ghl?action=locations");
        const j = await res.json();
        if (!alive) return;
        const names = (j.data || []).map(l => l.name);
        setLocations(names);
        // Best-effort default: a location whose name matches the business.
        const guess = names.find(n => client?.business_name && n.toLowerCase().includes(client.business_name.toLowerCase().split(" ")[0]));
        setLocation(guess || names[0] || "");
      } catch { /* leave empty */ }
    })();
    return () => { alive = false; };
  }, [client]);

  async function analyze() {
    if (!location) { setErr("Pick a GHL location first."); return; }
    setBusy(true); setErr(""); setResult(null); setPipelines(null);
    try {
      const pRes = await fetch(`/api/ghl?action=pipelines&location=${encodeURIComponent(location)}`);
      const pData = await pRes.json();
      if (!pRes.ok) throw new Error(pData.error || `GHL pipelines HTTP ${pRes.status}`);
      const pls = pData.data?.pipelines || pData.pipelines || [];
      const opps = pData.data?.opportunities || pData.opportunities || [];
      const stageCounts = {};
      opps.forEach(o => { const s = o.stageName || "(unknown)"; stageCounts[s] = (stageCounts[s] || 0) + 1; });
      setPipelines({ pipelines: pls, stageCounts, oppCount: opps.length });

      const sRes = await fetch(`/api/marketing?resource=ghl-kpi-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ businessName: client?.business_name, pipelines: pls, stageCounts }),
      });
      const sData = await sRes.json();
      if (sData.error) throw new Error(sData.error);
      setResult(sData);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const card = { border: `1px solid ${t.border}`, borderRadius: 12, background: t.surface, padding: 18, marginBottom: 16 };
  const lbl = { fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginBottom: 8 };
  const conf = (c) => c === "high" ? t.text : c === "med" ? t.textSub : t.textMute;

  return (
    <div>
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div style={lbl}>GHL location</div>
          <select value={location} onChange={e => setLocation(e.target.value)} style={{ background: t.surfaceEl, color: t.text, border: `1px solid ${t.borderMed}`, borderRadius: 8, padding: "9px 11px", fontSize: 13, minWidth: 200 }}>
            {!locations.length && <option value="">No GHL locations configured</option>}
            {locations.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={analyze} disabled={busy || !location} style={{ padding: "10px 18px", background: t.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: (busy || !location) ? 0.6 : 1 }}>
          {busy ? "Analyzing…" : "Analyze funnel"}
        </button>
        <div style={{ flex: 1, minWidth: 180, fontSize: 12, color: t.textSub, lineHeight: 1.5 }}>
          Read-only. Pulls this academy's pipeline and proposes a funnel mapping + the KPIs that matter. Nothing is saved yet.
        </div>
      </div>

      {err && <div style={{ ...card, color: t.red }}>Couldn't analyze: {err}</div>}

      {result && (
        <>
          {result.summary && <div style={{ ...card, fontSize: 15, lineHeight: 1.5, color: t.text }}>{result.summary}</div>}

          <div style={card}>
            <div style={lbl}>Stage → funnel mapping {result.source === "ai" && <span style={{ color: t.accent }}>· AI proposed</span>}</div>
            {(result.mapping || []).map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
                <span style={{ flex: 1, fontSize: 13, color: t.text }}>{m.stage}{pipelines?.stageCounts?.[m.stage] != null && <span style={{ color: t.textMute }}> · {pipelines.stageCounts[m.stage]} open</span>}</span>
                <span style={{ color: t.textMute }}>→</span>
                <span style={{ minWidth: 90, textAlign: "right", fontSize: 13, fontWeight: 600, color: t.text }}>{m.canonical}</span>
                <span style={{ minWidth: 44, textAlign: "right", fontSize: 11, color: conf(m.confidence) }}>{m.confidence}</span>
              </div>
            ))}
            {Array.isArray(result.missing) && result.missing.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.border}`, fontSize: 12, color: t.textSub }}>
                <b style={{ color: t.textMute }}>Not in this funnel:</b> {result.missing.join(", ")}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={lbl}>Recommended KPIs</div>
            {(result.kpis || []).filter(k => k.recommended !== false).map((k, i) => (
              <div key={i} style={{ padding: "10px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{k.label}</span>
                  {k.formula && <span style={{ fontSize: 11, color: t.textMute, fontFamily: "monospace" }}>{k.formula}</span>}
                </div>
                {k.why && <div style={{ fontSize: 12, color: t.textSub, marginTop: 4, lineHeight: 1.5 }}>{k.why}</div>}
              </div>
            ))}
          </div>

          {Array.isArray(result.hidden_kpis) && result.hidden_kpis.length > 0 && (
            <div style={card}>
              <div style={lbl}>Skipped for this academy</div>
              {result.hidden_kpis.map((h, i) => (
                <div key={i} style={{ fontSize: 12, color: t.textSub, padding: "5px 0", lineHeight: 1.5 }}>
                  <b style={{ color: t.textMute }}>{h.label}</b> — {h.why}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: t.textMute, padding: "4px 2px" }}>
            Next step (not built yet): a Save/edit screen that persists this mapping per client and feeds your edits back so the next academy's guess is better.
          </div>
        </>
      )}
    </div>
  );
}
