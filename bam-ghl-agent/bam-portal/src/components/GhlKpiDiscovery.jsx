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
  const [formsInfo, setFormsInfo] = useState(null);
  const [picked, setPicked] = useState(() => new Set(cfg.lead_form_ids || []));
  const [savingForms, setSavingForms] = useState(false);
  const [formsMsg, setFormsMsg] = useState(cfg.lead_form_ids?.length ? `${cfg.lead_form_ids.length} form(s) saved` : null);
  // Trial-calendar picker state
  const [cals, setCals] = useState(null);
  const [calsInfo, setCalsInfo] = useState(null);
  const [pickedCals, setPickedCals] = useState(() => new Set(cfg.booking_calendar_ids || []));
  const [kpis, setKpis] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState(null);
  const [clientFilter, setClientFilter] = useState("new"); // 'new' | 'all'
  const [rangeKey, setRangeKey] = useState("30");          // '7' | '30' | '90' | 'month'
  const rangeDays = rangeKey === "month" ? new Date().getDate() : parseInt(rangeKey, 10);

  // Live funnel KPIs — stale-while-revalidate: show what's stored instantly, then
  // (if it's stale) pull fresh GHL data in the background and re-read.
  useEffect(() => {
    if (!client?.id) return;
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/marketing?resource=ghl-kpis&client_id=${client.id}&days=${rangeDays}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
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
          const rr = await fetch(`/api/ghl?action=refresh-funnel&client_id=${client.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
          const info = await rr.json().catch(() => ({}));
          if (alive) setRefreshInfo(info);
          const updated = await load();
          if (alive && updated) setKpis(updated);
        } catch { /* keep stored */ }
        if (alive) setRefreshing(false);
      }
    })();
    return () => { alive = false; };
  }, [client, session, rangeDays]);

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
    setForms(null); setFormsErr(""); setFormsInfo(null);
    (async () => {
      try {
        const res = await fetch(`/api/ghl?action=forms&location=${encodeURIComponent(location)}`);
        const j = await res.json();
        if (!alive) return;
        setFormsInfo(j);
        if (!res.ok) { setFormsErr(j.error || `HTTP ${res.status}`); return; }
        setForms(j.data || []);
      } catch (e) { if (alive) setFormsErr(e.message); }
    })();
    return () => { alive = false; };
  }, [location]);

  // Load this location's calendars (for the trial-calendar picker).
  useEffect(() => {
    if (!location) { setCals(null); return; }
    let alive = true;
    setCals(null); setCalsInfo(null);
    (async () => {
      try {
        const res = await fetch(`/api/ghl?action=calendars&location=${encodeURIComponent(location)}`);
        const j = await res.json();
        if (!alive) return;
        setCalsInfo(j);
        if (res.ok) setCals(j.data || []);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [location]);

  // Manual refresh — always pulls (ignores the stale gate) and surfaces the
  // pull result (per-source counts + errors) so we can diagnose empties.
  async function doRefresh() {
    if (!client?.id) return;
    setRefreshing(true); setRefreshInfo(null);
    try {
      const rr = await fetch(`/api/ghl?action=refresh-funnel&client_id=${client.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
      setRefreshInfo(await rr.json().catch(() => ({ error: `HTTP ${rr.status}` })));
      const kr = await fetch(`/api/marketing?resource=ghl-kpis&client_id=${client.id}&days=${rangeDays}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (kr.ok) setKpis(await kr.json());
    } catch (e) { setRefreshInfo({ error: e.message }); }
    finally { setRefreshing(false); }
  }

  function toggleForm(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleCal(id) {
    setPickedCals(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Saves the whole funnel config: lead forms + trial calendars.
  async function saveForms() {
    setSavingForms(true); setFormsMsg(null);
    try {
      const ids = [...picked];
      const names = (forms || []).filter(f => picked.has(f.id)).map(f => f.name);
      const calIds = [...pickedCals];
      const calNames = (cals || []).filter(c => pickedCals.has(c.id)).map(c => c.name);
      const next = {
        ...(client?.ghl_kpi_config || {}),
        ghl_location: location,
        lead_form_ids: ids, lead_form_names: names,
        booking_calendar_ids: calIds, booking_calendar_names: calNames,
      };
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ghl_kpi_config: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setFormsMsg(`Saved ${ids.length} form(s) + ${calIds.length} calendar(s)`);
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={lbl}>Live funnel{refreshing ? " · refreshing…" : ""}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["7", "7d"], ["30", "30d"], ["90", "90d"], ["month", "This month"]].map(([k, label]) => (
                <button key={k} onClick={() => setRangeKey(k)} style={{
                  border: `1px solid ${rangeKey === k ? t.accent : t.borderMed}`,
                  background: rangeKey === k ? t.accent : "transparent",
                  color: rangeKey === k ? "#0A0A0B" : t.textMute,
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>
          </div>
          {!kpis.ready ? (
            <div style={{ fontSize: 12, color: t.textSub, lineHeight: 1.5 }}>
              No funnel data yet. Run <b>/apply-sql</b>, then pick the lead forms + trial calendars below — numbers fill in on the next refresh.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 30px", alignItems: "flex-start" }}>
                {kpiStat("Leads in", kpis.leads)}
                {kpiStat("Trials booked", kpis.trials, kpis.rates?.trial_rate)}
                {kpiStat(clientFilter === "new" ? "New clients" : "All clients",
                  clientFilter === "new" ? kpis.clients_new : kpis.clients_all,
                  clientFilter === "new" ? kpis.rates?.new_client_rate : null)}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                {["new", "all"].map(f => (
                  <button key={f} onClick={() => setClientFilter(f)} style={{
                    border: `1px solid ${clientFilter === f ? t.accent : t.borderMed}`,
                    background: clientFilter === f ? t.accent : "transparent",
                    color: clientFilter === f ? "#0A0A0B" : t.textMute,
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                    padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                  }}>{f === "new" ? "New clients" : "All purchases"}</button>
                ))}
                {clientFilter === "all" && kpis.clients_existing != null && (
                  <span style={{ fontSize: 11, color: t.textMute, alignSelf: "center" }}>({kpis.clients_new} new · {kpis.clients_existing} existing)</span>
                )}
              </div>
              {kpis.cac && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${t.border}`, fontSize: 12, color: t.textSub }}>
                  Spend {money(kpis.spend)} · {kpis.cac.per_lead != null ? `${money(kpis.cac.per_lead)}/lead` : "—/lead"} · {kpis.cac.per_new_client != null ? `${money(kpis.cac.per_new_client)}/new client (CAC)` : "—/new client"}
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={doRefresh} disabled={refreshing} style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: refreshing ? "wait" : "pointer" }}>
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
            {refreshInfo && (
              <span style={{ fontSize: 11, color: t.textMute, fontFamily: "monospace" }}>
                {refreshInfo.skipped ? `skipped: ${refreshInfo.skipped}`
                  : refreshInfo.error ? `error: ${refreshInfo.error}`
                  : `pulled — leads ${refreshInfo.leads ?? 0} · trials ${refreshInfo.trials ?? 0} · new ${refreshInfo.clients_new ?? 0} · existing ${refreshInfo.clients_existing ?? 0}`}
              </span>
            )}
          </div>
          {refreshInfo && Array.isArray(refreshInfo.errors) && refreshInfo.errors.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: t.amber, fontFamily: "monospace" }}>issues: {refreshInfo.errors.join(" · ")}</div>
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
        {forms && forms.length === 0 && (
          <div style={{ fontSize: 12, color: t.textMute, lineHeight: 1.5 }}>
            No forms returned for this location.
            {formsInfo && <span> <span style={{ color: t.textSub }}>(GHL v{formsInfo.version} · location "{formsInfo.location}"{formsInfo.reason ? ` · ${formsInfo.reason}` : ""}{formsInfo.status ? ` · HTTP ${formsInfo.status}` : ""})</span></span>}
            <div style={{ marginTop: 6 }}>If this location has forms in GHL, the diagnostic above tells us why they're not coming through — send it to Cole.</div>
          </div>
        )}
        {forms && forms.map(f => (
          <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", cursor: "pointer", fontSize: 13, color: t.text }}>
            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggleForm(f.id)} style={{ width: 16, height: 16, accentColor: t.accent, cursor: "pointer" }} />
            {f.name}
          </label>
        ))}

        {/* Trial calendars */}
        <div style={{ ...lbl, marginTop: 20 }}>Trials booked — which calendar(s)?</div>
        <div style={{ fontSize: 12, color: t.textSub, lineHeight: 1.5, marginBottom: 10 }}>
          Tick the calendar(s) where trials get booked. A booked appointment there = a trial (deduped to one per person).
        </div>
        {!cals && <div style={{ fontSize: 12, color: t.textMute }}>Loading calendars…</div>}
        {cals && cals.length === 0 && (
          <div style={{ fontSize: 12, color: t.textMute }}>
            No calendars returned.{calsInfo && <span style={{ color: t.textSub }}> (GHL v{calsInfo.version}{calsInfo.status ? ` · HTTP ${calsInfo.status}` : ""}{calsInfo.reason ? ` · ${calsInfo.reason}` : ""})</span>}
          </div>
        )}
        {cals && cals.map(c => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", cursor: "pointer", fontSize: 13, color: t.text }}>
            <input type="checkbox" checked={pickedCals.has(c.id)} onChange={() => toggleCal(c.id)} style={{ width: 16, height: 16, accentColor: t.accent, cursor: "pointer" }} />
            {c.name}
          </label>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button onClick={saveForms} disabled={savingForms} style={{ padding: "9px 16px", background: t.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: savingForms ? "wait" : "pointer" }}>
            {savingForms ? "Saving…" : "Save funnel config"}
          </button>
          {formsMsg && <span style={{ fontSize: 12, color: t.textSub }}>{formsMsg}</span>}
        </div>
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
