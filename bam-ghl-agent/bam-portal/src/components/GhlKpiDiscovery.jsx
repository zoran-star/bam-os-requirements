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
  const [monthly, setMonthly] = useState(null);   // { ready, synced_at, months:[...] }
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState(null);
  const [clientFilter, setClientFilter] = useState("new"); // 'new' | 'all'
  const [rangeKey, setRangeKey] = useState("30");          // '7' | '30' | '90' | 'month'
  const [detail, setDetail] = useState(null);              // drill-down modal
  const [cfgEdit, setCfgEdit] = useState(null);            // per-month forms/calendars editor
  const [board, setBoard] = useState(null);                // per-month journey board
  const [boardHi, setBoardHi] = useState(null);            // highlighted person (key) across columns
  const rangeDays = rangeKey === "month" ? new Date().getDate() : parseInt(rangeKey, 10);

  // Live funnel KPIs — stale-while-revalidate: show what's stored instantly, then
  // (if it's stale) pull fresh GHL data in the background and re-read.
  useEffect(() => {
    if (!client?.id) return;
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return res.ok ? res.json() : null;
    };
    (async () => {
      let data = null;
      try { data = await load(); } catch { /* ignore */ }
      if (!alive) return;
      if (data) setMonthly(data);
      const stale = !data?.synced_at || (Date.now() - new Date(data.synced_at).getTime() > 10 * 60 * 1000);
      if (stale) {
        setRefreshing(true);
        try {
          const rr = await fetch(`/api/ghl?action=refresh-funnel&client_id=${client.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
          const info = await rr.json().catch(() => ({}));
          if (alive) setRefreshInfo(info);
          const updated = await load();
          if (alive && updated) setMonthly(updated);
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

  // Drill-down: the records behind a KPI number (to verify by name). `month`
  // (YYYY-MM) scopes to a calendar month; without it, falls back to rangeDays.
  async function openDetail(type, title, month) {
    setDetail({ type, title, month, loading: true, items: [] });
    try {
      const win = month ? `month=${month}` : `days=${rangeDays}`;
      const res = await fetch(`/api/marketing?resource=ghl-kpi-detail&client_id=${client.id}&${win}&type=${type}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const j = await res.json();
      setDetail({ type, title, month, loading: false, items: j.items || [], count: j.count });
    } catch (e) { setDetail({ type, title, month, loading: false, items: [], error: e.message }); }
  }
  function exportDetailCsv() {
    if (!detail?.items?.length) return;
    const head = ["Name", "Email", "Date", "Amount", "Status"];
    const lines = detail.items.map(i => [i.name, i.email || "", String(i.date || "").slice(0, 10), i.amount != null ? i.amount : "", i.is_new ? "new" : (detail.type === "clients_all" ? "existing" : "")]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${detail.title.replace(/\s+/g, "-").toLowerCase()}-${rangeDays}d.csv`; a.click();
  }

  // Pretty date for the drill-down, e.g. "Tuesday, May 2nd".
  function niceDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const day = d.getDate();
    const ord = (day % 10 === 1 && day !== 11) ? "st"
      : (day % 10 === 2 && day !== 12) ? "nd"
      : (day % 10 === 3 && day !== 13) ? "rd" : "th";
    const wd = d.toLocaleDateString("en-US", { weekday: "long" });
    const mo = d.toLocaleDateString("en-US", { month: "long" });
    return `${wd}, ${mo} ${day}${ord}`;
  }

  // Delete a drill-down record (data cleaning). Removes ALL underlying event
  // rows for that person+type, then re-reads the KPI tallies so the headline
  // number drops too. (A later "Refresh now" re-adds anything still live at the
  // source — this is for junk/test/stale rows.)
  async function deleteDetailRow(it) {
    if (!it?.ids?.length) return;
    if (!window.confirm(`Remove "${it.name}" from ${detail.title}?\n\nThis deletes the record from your KPI data.`)) return;
    try {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ids: it.ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert("Delete failed: " + (j.error || res.status)); return; }
      setDetail(d => ({ ...d, items: d.items.filter(x => x !== it), count: Math.max(0, (d.count ?? d.items.length) - 1) }));
      const kr = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (kr.ok) setMonthly(await kr.json());
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  // Per-month forms/calendars (effective-dated). Opening prefills with the
  // month's currently-effective selection; saving writes an effective_configs
  // entry { from: <monthKey> } that applies from that month onward.
  function openCfgEdit(month) {
    setCfgEdit({
      monthKey: month.key, monthLabel: month.label,
      formIds: new Set(month.forms?.ids || []),
      calIds: new Set(month.calendars?.ids || []),
      saving: false, msg: null,
    });
  }
  async function saveCfgEdit() {
    if (!cfgEdit) return;
    setCfgEdit(e => ({ ...e, saving: true, msg: null }));
    try {
      const fIds = [...cfgEdit.formIds], cIds = [...cfgEdit.calIds];
      const fNames = (forms || []).filter(f => cfgEdit.formIds.has(f.id)).map(f => f.name);
      const cNames = (cals || []).filter(c => cfgEdit.calIds.has(c.id)).map(c => c.name);
      const existing = Array.isArray(monthly?.config?.effective_configs) ? monthly.config.effective_configs : [];
      const others = existing.filter(o => o.from !== cfgEdit.monthKey);
      // Clearing everything removes the override → this month reverts to the
      // inherited default. Otherwise add/replace the entry for this month.
      const effective_configs = (fIds.length === 0 && cIds.length === 0)
        ? others
        : [...others, { from: cfgEdit.monthKey, lead_form_ids: fIds, lead_form_names: fNames, booking_calendar_ids: cIds, booking_calendar_names: cNames }]
            .sort((a, b) => String(a.from).localeCompare(String(b.from)));
      const next = { ...(client?.ghl_kpi_config || {}), effective_configs };
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ghl_kpi_config: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (client) client.ghl_kpi_config = next;   // keep prefill base fresh for re-opens
      setCfgEdit(null);
      const kr = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (kr.ok) setMonthly(await kr.json());
    } catch (e) { setCfgEdit(ed => ({ ...ed, saving: false, msg: "Couldn't save: " + e.message })); }
  }
  function clearCfgOverride() {
    if (!cfgEdit) return;
    setCfgEdit(e => ({ ...e, formIds: new Set(), calIds: new Set() }));
  }

  // Journey board — Leads → Trials → Sales for one month, each person a card.
  async function openBoard(month) {
    setBoard({ key: month.key, label: month.label, loading: true, leads: [], trials: [], sales: [] });
    const fetchType = async (type) => {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-detail&client_id=${client.id}&month=${month.key}&type=${type}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return (await res.json().catch(() => ({}))).items || [];
    };
    try {
      const [leads, trials, sales] = await Promise.all([fetchType("lead"), fetchType("trial"), fetchType("clients_all")]);
      setBoard({ key: month.key, label: month.label, loading: false, leads, trials, sales });
    } catch (e) { setBoard({ key: month.key, label: month.label, loading: false, leads: [], trials: [], sales: [], error: e.message }); }
  }
  async function deleteBoardCard(stage, person) {
    if (!person?.ids?.length) return;
    try {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-delete`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ids: person.ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert("Delete failed: " + (j.error || res.status)); return; }
      setBoard(b => ({ ...b, [stage]: b[stage].filter(p => p !== person) }));
      const kr = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (kr.ok) setMonthly(await kr.json());
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  // Manual refresh — always pulls (ignores the stale gate) and surfaces the
  // pull result (per-source counts + errors) so we can diagnose empties.
  async function doRefresh() {
    if (!client?.id) return;
    setRefreshing(true); setRefreshInfo(null);
    try {
      const rr = await fetch(`/api/ghl?action=refresh-funnel&client_id=${client.id}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
      setRefreshInfo(await rr.json().catch(() => ({ error: `HTTP ${rr.status}` })));
      const kr = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (kr.ok) setMonthly(await kr.json());
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
  // Big stat for the "this month so far" hero card.
  const heroStat = (label, val, onClick) => (
    <div key={label} onClick={onClick} title={onClick ? "Click to see the list" : undefined} style={{ cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: t.text, lineHeight: 1, textDecoration: onClick ? "underline dotted" : "none", textUnderlineOffset: 4 }}>{val ?? 0}</div>
      <div style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginTop: 7 }}>{label}</div>
    </div>
  );
  // Compact metric for a month-by-month row.
  const monthMetric = (label, val, onClick) => (
    <div key={label} onClick={onClick} title={onClick ? "Click to see the list" : undefined} style={{ minWidth: 56, textAlign: "right", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: t.text, textDecoration: onClick ? "underline dotted" : "none", textUnderlineOffset: 3 }}>{val ?? 0}</div>
      <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: t.textMute, marginTop: 3 }}>{label}</div>
    </div>
  );
  // Forms/calendars gear — opens the per-month editor. Accent when a custom
  // override is in effect for this month; muted when using the default.
  const gearBtn = (month) => (
    <button onClick={() => openCfgEdit(month)} title="Forms & calendars from this month onward"
      style={{ flexShrink: 0, height: 26, padding: "0 9px", borderRadius: 8, border: `1px solid ${month.override_from ? t.accent : t.border}`, background: "transparent", color: month.override_from ? t.accent : t.textMute, cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
      ⚙ <span style={{ fontSize: 10 }}>{(month.forms?.ids?.length || 0)}f·{(month.calendars?.ids?.length || 0)}c</span>
    </button>
  );
  // Opens the journey board for a month.
  const boardBtn = (month) => (
    <button onClick={() => openBoard(month)} title="Journey board — map each person Leads → Trials → Sales"
      style={{ flexShrink: 0, height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMute, cursor: "pointer", fontSize: 13, fontWeight: 600, lineHeight: 1 }}>▦</button>
  );
  // One person card in the journey board. filled = continued from the prior stage.
  const boardCard = (person, stage, filled) => {
    const hi = boardHi && person.key === boardHi;
    return (
      <div key={stage + ":" + (person.key || person.ids?.[0])}
        onMouseEnter={() => setBoardHi(person.key)} onMouseLeave={() => setBoardHi(null)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, marginBottom: 8,
          border: `1.5px solid ${filled ? t.accent : t.borderMed}`, background: filled ? `${t.accent}22` : "transparent",
          boxShadow: hi ? `0 0 0 2px ${t.accent}` : "none", transition: "box-shadow .12s ease" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.name}</div>
          <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 2 }}>{niceDate(person.date)}{person.amount != null ? ` · $${person.amount.toLocaleString()}` : ""}</div>
        </div>
        <button onClick={() => deleteBoardCard(stage, person)} title="Delete this record"
          style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: `1px solid ${t.border}`, background: "transparent", color: t.textMute, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
      </div>
    );
  };
  const boardColumn = (title, list, stage, filledFn) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: t.text, textAlign: "center", paddingBottom: 8, borderBottom: `2px solid ${t.text}`, marginBottom: 12 }}>{title} <span style={{ color: t.textMute, fontWeight: 600 }}>{list.length}</span></div>
      {list.length === 0 ? <div style={{ fontSize: 11, color: t.textMute, textAlign: "center" }}>—</div> : list.map(p => boardCard(p, stage, filledFn(p)))}
    </div>
  );

  return (
    <div>
      {monthly && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={lbl}>Monthly KPIs{refreshing ? " · refreshing…" : ""}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["new", "all"].map(f => (
                <button key={f} onClick={() => setClientFilter(f)} style={{
                  border: `1px solid ${clientFilter === f ? t.accent : t.borderMed}`,
                  background: clientFilter === f ? t.accent : "transparent",
                  color: clientFilter === f ? "#0A0A0B" : t.textMute,
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                  padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                }}>{f === "new" ? "New clients" : "All purchases"}</button>
              ))}
            </div>
          </div>
          {!monthly.ready ? (
            <div style={{ fontSize: 12, color: t.textSub, lineHeight: 1.5 }}>
              No funnel data yet. Run <b>/apply-sql</b>, then pick the lead forms + trial calendars below — numbers fill in on the next refresh.
            </div>
          ) : (() => {
            const cur = monthly.months.find(m => m.is_current) || monthly.months[0];
            const past = monthly.months.filter(m => m !== cur);
            const cVal = (m) => clientFilter === "new" ? m.clients_new : m.clients_all;
            const cType = clientFilter === "new" ? "client_new" : "clients_all";
            const cLabel = clientFilter === "new" ? "New clients" : "All purchases";
            return (
              <>
                {cur && (
                  <div style={{ border: `1px solid ${t.borderMed}`, borderRadius: 12, background: t.surfaceEl, padding: 16, marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: t.accent }}>{cur.label} · so far</div>
                      <div style={{ display: "flex", gap: 6 }}>{boardBtn(cur)}{gearBtn(cur)}</div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 34px", alignItems: "flex-start" }}>
                      {heroStat("Leads in", cur.leads, () => openDetail("lead", `Leads in · ${cur.label}`, cur.key))}
                      {heroStat("Trials booked", cur.trials, () => openDetail("trial", `Trials booked · ${cur.label}`, cur.key))}
                      {heroStat(cLabel, cVal(cur), () => openDetail(cType, `${cLabel} · ${cur.label}`, cur.key))}
                      {heroStat("CAC", cur.cac?.per_new_client != null ? money(cur.cac.per_new_client) : "—", null)}
                    </div>
                    <div style={{ fontSize: 11, color: t.textMute, marginTop: 10 }}>
                      {clientFilter === "all" ? `${cur.clients_new} new · ${cur.clients_existing} existing · ` : ""}spend {money(cur.spend)}
                    </div>
                  </div>
                )}
                {past.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ ...lbl, marginBottom: 6 }}>Month by month</div>
                    {past.map((m, i) => (
                      <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
                        <div style={{ flex: 1, minWidth: 90, fontSize: 13, fontWeight: 600, color: t.text }}>{m.label}</div>
                        {monthMetric("Leads", m.leads, () => openDetail("lead", `Leads in · ${m.label}`, m.key))}
                        {monthMetric("Trials", m.trials, () => openDetail("trial", `Trials booked · ${m.label}`, m.key))}
                        {monthMetric(clientFilter === "new" ? "New" : "All", cVal(m), () => openDetail(cType, `${cLabel} · ${m.label}`, m.key))}
                        <div style={{ minWidth: 64, textAlign: "right" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: t.textSub }}>{m.cac?.per_new_client != null ? money(m.cac.per_new_client) : "—"}</div>
                          <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: t.textMute, marginTop: 3 }}>CAC</div>
                        </div>
                        {boardBtn(m)}
                        {gearBtn(m)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
          {refreshInfo && (refreshInfo.stored_total != null) && (
            <div style={{ marginTop: 6, fontSize: 11, color: t.textMute, fontFamily: "monospace" }}>
              stored for this client: {refreshInfo.stored_total} total · {refreshInfo.stored_30d} in last 30d{refreshInfo.sample_occurred_at ? ` · sample date ${String(refreshInfo.sample_occurred_at).slice(0, 10)}` : ""}
            </div>
          )}
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

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>{detail.title}{detail.items ? ` · ${detail.count ?? detail.items.length}` : ""} <span style={{ fontSize: 12, color: t.textMute }}>(last {rangeDays}d)</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                {detail.items?.length > 0 && <button onClick={exportDetailCsv} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>CSV</button>}
                <button onClick={() => setDetail(null)} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Close</button>
              </div>
            </div>
            {detail.loading ? <div style={{ color: t.textSub, fontSize: 13 }}>Loading…</div>
              : detail.error ? <div style={{ color: t.red, fontSize: 13 }}>{detail.error}</div>
              : detail.items.length === 0 ? <div style={{ color: t.textSub, fontSize: 13 }}>No records in this window.</div>
              : (
                <div>
                  {detail.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{it.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: t.textSub, marginTop: 2 }}>{niceDate(it.date)}</div>
                        {it.email && it.email !== it.name && <div style={{ fontSize: 11, color: t.textMute, marginTop: 1 }}>{it.email}</div>}
                      </div>
                      {detail.type === "clients_all" && <span style={{ fontSize: 10, color: it.is_new ? t.accent : t.textMute, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{it.is_new ? "new" : "existing"}</span>}
                      {it.amount != null && <span style={{ fontSize: 13, fontWeight: 600, color: t.textSub, minWidth: 60, textAlign: "right" }}>${it.amount.toLocaleString()}</span>}
                      <button
                        onClick={() => deleteDetailRow(it)}
                        title="Remove this record from your KPI data"
                        style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMute, cursor: "pointer", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${t.red}1a`; e.currentTarget.style.color = t.red; e.currentTarget.style.borderColor = t.red; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.textMute; e.currentTarget.style.borderColor = t.border; }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {cfgEdit && (
        <div onClick={() => setCfgEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>Forms &amp; calendars</div>
            <div style={{ fontSize: 12.5, color: t.textSub, marginTop: 4, lineHeight: 1.5 }}>
              Applies to <b style={{ color: t.text }}>{cfgEdit.monthLabel}</b> and every month after — until you set a different mapping on a later month. Leave everything unchecked to fall back to the default selection.
            </div>

            <div style={{ marginTop: 16, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginBottom: 8 }}>Lead forms → Leads</div>
            {!forms ? <div style={{ fontSize: 12, color: t.textMute }}>Loading forms… (open the setup section below once if this stays empty)</div>
              : forms.length === 0 ? <div style={{ fontSize: 12, color: t.textMute }}>No forms found for this location.</div>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 180, overflowY: "auto" }}>
                  {forms.map(f => (
                    <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: t.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={cfgEdit.formIds.has(f.id)} onChange={() => setCfgEdit(e => { const n = new Set(e.formIds); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return { ...e, formIds: n }; })} style={{ width: 16, height: 16, accentColor: t.accent, cursor: "pointer" }} />
                      {f.name}
                    </label>
                  ))}
                </div>
              )}

            <div style={{ marginTop: 16, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: t.textMute, marginBottom: 8 }}>Trial calendars → Trials</div>
            {!cals ? <div style={{ fontSize: 12, color: t.textMute }}>Loading calendars…</div>
              : cals.length === 0 ? <div style={{ fontSize: 12, color: t.textMute }}>No calendars found for this location.</div>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 160, overflowY: "auto" }}>
                  {cals.map(c => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: t.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={cfgEdit.calIds.has(c.id)} onChange={() => setCfgEdit(e => { const n = new Set(e.calIds); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return { ...e, calIds: n }; })} style={{ width: 16, height: 16, accentColor: t.accent, cursor: "pointer" }} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}

            {cfgEdit.msg && <div style={{ marginTop: 12, fontSize: 12, color: t.red }}>{cfgEdit.msg}</div>}
            <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
              <button onClick={clearCfgOverride} style={{ marginRight: "auto", background: "transparent", border: `1px solid ${t.border}`, color: t.textMute, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 12 }}>Use default</button>
              <button onClick={() => setCfgEdit(null)} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
              <button onClick={saveCfgEdit} disabled={cfgEdit.saving} style={{ background: t.accent, color: "#0A0A0B", border: 0, borderRadius: 8, padding: "8px 16px", cursor: cfgEdit.saving ? "wait" : "pointer", fontSize: 12, fontWeight: 700 }}>{cfgEdit.saving ? "Saving…" : `Apply from ${cfgEdit.monthLabel}`}</button>
            </div>
          </div>
        </div>
      )}

      {board && (
        <div onClick={() => { setBoard(null); setBoardHi(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "32px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1000, background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>Journey board · {board.label}</div>
              <button onClick={() => { setBoard(null); setBoardHi(null); }} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Close</button>
            </div>
            <div style={{ fontSize: 12, color: t.textSub, marginBottom: 16, lineHeight: 1.5 }}>
              Hover a person to trace them across stages. <span style={{ color: t.accent }}>■</span> filled = came from the previous stage · ▢ outline = joined here. ✕ deletes the record.
            </div>
            {board.loading ? <div style={{ color: t.textSub, fontSize: 13 }}>Loading…</div>
              : board.error ? <div style={{ color: t.red, fontSize: 13 }}>{board.error}</div>
              : (() => {
                  const leadKeys = new Set(board.leads.map(p => p.key));
                  const trialKeys = new Set(board.trials.map(p => p.key));
                  return (
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                      {boardColumn("LEADS", board.leads, "leads", () => true)}
                      {boardColumn("TRIALS", board.trials, "trials", p => leadKeys.has(p.key))}
                      {boardColumn("SALES", board.sales, "sales", p => trialKeys.has(p.key))}
                    </div>
                  );
                })()}
          </div>
        </div>
      )}
    </div>
  );
}
