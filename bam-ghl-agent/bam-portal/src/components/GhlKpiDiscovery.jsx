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

  // Lead-forms picker state
  const cfg = client?.ghl_kpi_config || {};
  const [forms, setForms] = useState(null);
  const [formsErr, setFormsErr] = useState("");
  const [picked, setPicked] = useState(() => new Set(cfg.lead_form_ids || []));
  const [savingForms, setSavingForms] = useState(false);
  const [formsMsg, setFormsMsg] = useState(cfg.lead_form_ids?.length ? `${cfg.lead_form_ids.length} form(s) saved` : null);
  const [kpis, setKpis] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Live funnel KPIs — stale-while-revalidate: show what's stored instantly, then
  // (if it's stale) pull fresh GHL data in the background and re-read.
  useEffect(() => {
    if (!client?.id) return;
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/marketing?resource=ghl-kpis&client_id=${client.id}&days=30`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return res.ok ? res.json() : null;
    };
    (async () => {
      let data = null;
      try { data = await load(); } catch { /* ignore */ }
      if (!alive) return;
      if (data) setKpis(data);
      const stale = !data?.synced_at || (Date.now() - new Date(data.synced_at).getTime() > 10 * 60 * 1000);
      if (stale) {
        setRefreshing(true);
        try {
          await fetch(`/api/ghl?action=refresh-funnel&client_id=${client.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
          const updated = await load();
          if (alive && updated) setKpis(updated);
        } catch { /* keep stored */ }
        if (alive) setRefreshing(false);
      }
    })();
    return () => { alive = false; };
  }, [client, session]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ghl?action=locations");
        const j = await res.json();
        if (!alive) return;
        const names = (j.data || []).map(l => l.name);
        setLocations(names);
        // Best-effort default: saved config, else a name matching the business.
        const guess = names.find(n => client?.business_name && n.toLowerCase().includes(client.business_name.toLowerCase().split(" ")[0]));
        setLocation(cfg.ghl_location || guess || names[0] || "");
      } catch { /* leave empty */ }
    })();
    return () => { alive = false; };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load this location's forms whenever the selected location changes.
  useEffect(() => {
    if (!location) { setForms(null); return; }
    let alive = true;
    setForms(null); setFormsErr("");
    (async () => {
      try {
        const res = await fetch(`/api/ghl?action=forms&location=${encodeURIComponent(location)}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) { setFormsErr(j.error || `HTTP ${res.status}`); return; }
        setForms(j.data || []);
      } catch (e) { if (alive) setFormsErr(e.message); }
    })();
    return () => { alive = false; };
  }, [location]);

  function toggleForm(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveForms() {
    setSavingForms(true); setFormsMsg(null);
    try {
      const ids = [...picked];
      const names = (forms || []).filter(f => picked.has(f.id)).map(f => f.name);
      const next = { ...(client?.ghl_kpi_config || {}), ghl_location: location, lead_form_ids: ids, lead_form_names: names };
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ghl_kpi_config: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setFormsMsg(`Saved ${ids.length} form(s) as "leads in"`);
    } catch (e) { setFormsMsg("Couldn't save: " + e.message); }
    finally { setSavingForms(false); }
  }

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

  const money = (n) => n == null ? "—" : "$" + Number(n).toLocaleString();
  const kpiStat = (label, val, rate) => (
    <div key={label}>
      <div style={{ fontSize: 24, fontWeight: 600, color: t.text, lineHeight: 1 }}>{val ?? 0}</div>
      <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 6 }}>{label}</div>
      {rate != null && <div style={{ fontSize: 11, color: t.textSub, marginTop: 3 }}>{rate}% of leads</div>}
    </div>
  );

  return (
    <div>
      {kpis && (
        <div style={card}>
          <div style={lbl}>Live funnel — last 30 days{refreshing ? " · refreshing…" : ""}</div>
          {!kpis.ready ? (
            <div style={{ fontSize: 12, color: t.textSub, lineHeight: 1.5 }}>
              No funnel data yet. Run the SQL (/apply-sql) and connect the GHL + Stripe webhooks — numbers fill in as events arrive.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 30px" }}>
                {kpiStat("Leads in", kpis.leads)}
                {kpiStat("Responded", kpis.responded, kpis.rates?.response_rate)}
                {kpiStat("Booked", kpis.booked, kpis.rates?.booking_rate)}
                {kpiStat("Members", kpis.converted, kpis.rates?.conversion_rate)}
              </div>
              {kpis.cac && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${t.border}`, fontSize: 12, color: t.textSub }}>
                  Spend {money(kpis.spend)} · {kpis.cac.per_lead != null ? `${money(kpis.cac.per_lead)}/lead` : "—/lead"} · {kpis.cac.per_member != null ? `${money(kpis.cac.per_member)}/member (CAC)` : "—/member"}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Lead-forms picker — defines "leads in" */}
      <div style={card}>
        <div style={lbl}>Leads in — which forms count?</div>
        <div style={{ fontSize: 12, color: t.textSub, lineHeight: 1.5, marginBottom: 12 }}>
          Tick the forms whose submissions count as a new lead (e.g. free-trial booking form + contact form). This becomes the config the KPIs read.
        </div>
        {formsErr && <div style={{ fontSize: 12, color: t.red, marginBottom: 8 }}>Couldn't load forms: {formsErr}</div>}
        {!forms && !formsErr && <div style={{ fontSize: 12, color: t.textMute }}>Loading forms…</div>}
        {forms && forms.length === 0 && <div style={{ fontSize: 12, color: t.textMute }}>No forms found for this location.</div>}
        {forms && forms.map(f => (
          <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", cursor: "pointer", fontSize: 13, color: t.text }}>
            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggleForm(f.id)} style={{ width: 16, height: 16, accentColor: t.accent, cursor: "pointer" }} />
            {f.name}
          </label>
        ))}
        {forms && forms.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <button onClick={saveForms} disabled={savingForms} style={{ padding: "9px 16px", background: t.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: savingForms ? "wait" : "pointer" }}>
              {savingForms ? "Saving…" : "Save lead forms"}
            </button>
            {formsMsg && <span style={{ fontSize: 12, color: t.textSub }}>{formsMsg}</span>}
          </div>
        )}
      </div>

      {err && <div style={{ ...card, color: t.red }}>Couldn't analyze: {err}</div>}

      {result && (
        <>
          {result.summary && <div style={{ ...card, fontSize: 15, lineHeight: 1.5, color: t.text }}>{result.summary}</div>}

          {Array.isArray(result.unmapped) && result.unmapped.length > 0 && (
            <div style={{ ...card, borderColor: t.accentBorder }}>
              <div style={lbl}>Needs your call</div>
              <div style={{ fontSize: 13, color: t.textSub, lineHeight: 1.5 }}>
                Couldn't confidently place: <b style={{ color: t.text }}>{result.unmapped.join(", ")}</b>. Tell me which funnel step each is and I'll teach the matcher.
              </div>
            </div>
          )}

          {Array.isArray(result.canonical) && (
            <div style={card}>
              <div style={lbl}>Funnel steps (what each means)</div>
              {result.canonical.map((c, i) => (
                <div key={c.step} style={{ display: "flex", gap: 10, padding: "5px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
                  <span style={{ minWidth: 78, fontSize: 12, fontWeight: 600, color: t.text }}>{c.step}</span>
                  <span style={{ flex: 1, fontSize: 12, color: t.textSub, lineHeight: 1.5 }}>{c.desc}</span>
                </div>
              ))}
            </div>
          )}

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
