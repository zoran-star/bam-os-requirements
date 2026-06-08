import { useState, useEffect, useRef, Fragment } from "react";

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
  const boardBodyRef = useRef(null);                        // columns container (for arrow geometry)
  const cardRefs = useRef({});                              // `${stage}:${rowIndex}` -> card DOM node
  const boardRowsRef = useRef([]);                          // rows from the last board render
  const [arrows, setArrows] = useState([]);                // measured connector lines
  const [boardView, setBoardView] = useState("board");     // 'board' | 'timeline'
  const [trash, setTrash] = useState([]);                  // recently deleted (for undo)
  const trashSeq = useRef(0);
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

  // Measure the journey-board cards and compute connector lines between the same
  // person across stages. Columns are top-packed independently, so connections
  // are diagonal — recomputed after render and on resize.
  useEffect(() => {
    if (!board || board.loading) { setArrows([]); return; }
    const compute = () => {
      const cont = boardBodyRef.current;
      if (!cont) return;
      const base = cont.getBoundingClientRect();
      const rect = (k) => {
        const el = cardRefs.current[k];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left - base.left, right: r.right - base.left, midY: r.top - base.top + r.height / 2 };
      };
      const out = [];
      boardRowsRef.current.forEach((row, i) => {
        const link = (a, b, kind) => {
          const ra = rect(`${a}:${i}`), rb = rect(`${b}:${i}`);
          if (ra && rb) out.push({ x1: ra.right, y1: ra.midY, x2: rb.left, y2: rb.midY, kind });
        };
        if (row.lead && row.trial) link("lead", "trial", "solid");
        if (row.trial && row.sale) link("trial", "sale", "solid");
        if (row.lead && row.sale && !row.trial) link("lead", "sale", "skip");
      });
      setArrows(out);
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (boardBodyRef.current) ro.observe(boardBodyRef.current);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [board, boardView]);

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
    setTrash([]);
    const fetchType = async (type) => {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-detail&client_id=${client.id}&month=${month.key}&type=${type}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return (await res.json().catch(() => ({}))).items || [];
    };
    try {
      const [leads, trials, sales] = await Promise.all([fetchType("lead"), fetchType("trial"), fetchType("clients_all")]);
      setBoard({ key: month.key, label: month.label, loading: false, leads, trials, sales });
    } catch (e) { setBoard({ key: month.key, label: month.label, loading: false, leads: [], trials: [], sales: [], error: e.message }); }
  }
  // Silent re-fetch of the open board (no loading flash) — keeps scroll position.
  async function refetchBoardSilent() {
    if (!board) return;
    const fetchType = async (type) => {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-detail&client_id=${client.id}&month=${board.key}&type=${type}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return (await res.json().catch(() => ({}))).items || [];
    };
    const [leads, trials, sales] = await Promise.all([fetchType("lead"), fetchType("trial"), fetchType("clients_all")]);
    setBoard(b => b ? ({ ...b, leads, trials, sales }) : b);
  }
  async function refreshMonthlyCounts() {
    const kr = await fetch(`/api/marketing?resource=ghl-kpis-monthly&client_id=${client.id}&months=6`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
    if (kr.ok) setMonthly(await kr.json());
  }
  // Smooth delete: remove the card from view instantly (no reload), then delete in
  // the background and stash the removed rows in the trash for Undo.
  async function deleteBoardCard(cell) {
    if (!cell?.ids?.length || !board) return;
    const idset = new Set(cell.ids);
    const drop = (arr) => (arr || []).filter(it => !it.ids.some(id => idset.has(id)));
    setBoard(b => b ? ({ ...b, leads: drop(b.leads), trials: drop(b.trials), sales: drop(b.sales) }) : b);
    try {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-delete`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, ids: cell.ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert("Delete failed: " + (j.error || res.status)); refetchBoardSilent(); return; }
      setTrash(tr => [{ key: ++trashSeq.current, name: cell.name || "record", rows: j.rows || [] }, ...tr].slice(0, 50));
      refreshMonthlyCounts();
    } catch (e) { alert("Delete failed: " + e.message); refetchBoardSilent(); }
  }
  // Undo a delete — re-insert the stashed rows, then silently re-sync.
  async function undoDelete(entry) {
    if (!entry) return;
    if (!entry.rows?.length) { setTrash(tr => tr.filter(x => x !== entry)); return; }
    try {
      const res = await fetch(`/api/marketing?resource=ghl-kpi-restore`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, rows: entry.rows }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert("Undo failed: " + (j.error || res.status)); return; }
      setTrash(tr => tr.filter(x => x !== entry));
      await refetchBoardSilent();
      refreshMonthlyCounts();
    } catch (e) { alert("Undo failed: " + e.message); }
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
  // Align the same person into one ROW across Leads/Trials/Sales. Match by ANY
  // shared identifier (email / phone / contact_id) via union-find, so a person
  // tracked differently per stage still lines up. Same-stage duplicates merge
  // (ids combined, ×N badge). Returns rows ordered most-complete-journey first.
  const buildBoardRows = (b) => {
    const all = [];
    for (const c of b.leads) all.push({ ...c, _stage: "lead" });
    for (const c of b.trials) all.push({ ...c, _stage: "trial" });
    for (const c of b.sales) all.push({ ...c, _stage: "sale" });
    const parent = all.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, c) => { parent[find(a)] = find(c); };
    const norm = (s) => (s ? String(s).toLowerCase().trim() : "");
    const seen = new Map();
    all.forEach((c, i) => {
      [c.email && "e:" + norm(c.email), c.phone && "p:" + norm(c.phone), c.contact_id && "c:" + c.contact_id]
        .filter(Boolean).forEach(id => { if (seen.has(id)) union(i, seen.get(id)); else seen.set(id, i); });
    });
    const groups = new Map();
    all.forEach((c, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(c); });
    const rows = [];
    for (const cards of groups.values()) {
      const row = { lead: null, trial: null, sale: null };
      for (const stage of ["lead", "trial", "sale"]) {
        const sc = cards.filter(c => c._stage === stage);
        if (sc.length) row[stage] = { ...sc[0], ids: sc.flatMap(c => c.ids), dupCount: sc.length };
      }
      rows.push(row);
    }
    // Drop-off staircase: sort by furthest stage reached (Sales > Trials > Leads),
    // then by completeness, so full journeys sit on top and the right edge steps
    // down — a clean diagonal of where each person dropped off.
    const furthest = (r) => r.sale ? 3 : r.trial ? 2 : r.lead ? 1 : 0;
    const filledCount = (r) => (r.lead ? 1 : 0) + (r.trial ? 1 : 0) + (r.sale ? 1 : 0);
    const firstDate = (r) => [r.lead, r.trial, r.sale].filter(Boolean).map(c => c.date).sort()[0] || "";
    rows.sort((a, c) => furthest(c) - furthest(a) || filledCount(c) - filledCount(a) || firstDate(a).localeCompare(firstDate(c)));
    return rows;
  };
  // One person's cell within a row. filled = they came from the prior stage.
  const boardCell = (cell, filled) => {
    if (!cell) return <div style={{ minHeight: 50 }} />;   // empty slot keeps rows aligned
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 10, minHeight: 50,
        border: `1.5px solid ${filled ? t.accent : t.borderMed}`, background: filled ? `${t.accent}22` : "transparent" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cell.name}{cell.dupCount > 1 ? <span style={{ color: t.amber, fontWeight: 700 }}> ×{cell.dupCount}</span> : ""}
          </div>
          <div style={{ fontSize: 10.5, color: t.textMute, marginTop: 2 }}>{niceDate(cell.date)}{cell.amount != null ? ` · $${cell.amount.toLocaleString()}` : ""}</div>
        </div>
        <button onClick={() => deleteBoardCard(cell)} title="Delete this record"
          style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: `1px solid ${t.border}`, background: "transparent", color: t.textMute, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
      </div>
    );
  };

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
        <div onClick={() => setBoard(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "32px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: boardView === "timeline" ? 1240 : 1000, background: t.bg, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>{boardView === "timeline" ? "Journey timeline" : "Journey board"} · {board.label}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ display: "flex", border: `1px solid ${t.borderMed}`, borderRadius: 8, overflow: "hidden" }}>
                  {["board", "timeline"].map(v => (
                    <button key={v} onClick={() => setBoardView(v)} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: 0, cursor: "pointer", background: boardView === v ? t.accent : "transparent", color: boardView === v ? "#0A0A0B" : t.textMute }}>{v}</button>
                  ))}
                </div>
                <button onClick={() => setBoard(null)} style={{ background: "transparent", border: `1px solid ${t.borderMed}`, color: t.text, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Close</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: t.textSub, marginBottom: 16, lineHeight: 1.5 }}>
              {boardView === "timeline"
                ? <>One row per person, time runs left → right. The line is their journey — <span style={{ color: t.accent, fontWeight: 700 }}>━</span> continued · <span style={{ color: t.textMute }}>┄</span> skipped a stage. Most-complete journeys on top, so lines never cross. ✕ deletes the record.</>
                : <>Arrows connect the same person across stages. <span style={{ color: t.accent, fontWeight: 700 }}>→</span> continued · <span style={{ color: t.textMute }}>⇢</span> skipped a stage. Each column is sorted with the furthest-along on top, so the gaps fall to the bottom. <span style={{ color: t.amber, fontWeight: 700 }}>×N</span> = merged duplicates. ✕ deletes the record.</>}
            </div>
            {board.loading ? <div style={{ color: t.textSub, fontSize: 13 }}>Loading…</div>
              : board.error ? <div style={{ color: t.red, fontSize: 13 }}>{board.error}</div>
              : (() => {
                  const rows = buildBoardRows(board);
                  boardRowsRef.current = rows;
                  if (!rows.length) return <div style={{ fontSize: 13, color: t.textSub }}>No records this month.</div>;
                  const colHead = { fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: t.text, textAlign: "center", paddingBottom: 8, borderBottom: `2px solid ${t.text}` };
                  const filledFor = (stage, r) => stage === "lead" ? true : stage === "trial" ? !!r.lead : !!r.trial;
                  // Shared SVG connector overlay (measured in the arrows effect).
                  const svgOverlay = (
                    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                      <defs>
                        <marker id="jb-ah" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={t.accent} /></marker>
                        <marker id="jb-ahs" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={t.textMute} /></marker>
                      </defs>
                      {arrows.map((a, idx) => (
                        <line key={idx} x1={a.x1} y1={a.y1} x2={a.x2 - 3} y2={a.y2}
                          stroke={a.kind === "solid" ? t.accent : t.textMute} strokeWidth={a.kind === "solid" ? 2 : 1.5}
                          strokeDasharray={a.kind === "skip" ? "4 3" : "none"} opacity={a.kind === "skip" ? 0.6 : 1}
                          markerEnd={a.kind === "solid" ? "url(#jb-ah)" : "url(#jb-ahs)"} />
                      ))}
                    </svg>
                  );

                  if (boardView === "timeline") {
                    // One ROW per person, time left→right. A person's journey is a short
                    // horizontal line in their own row, so lines never cross. Most-complete
                    // journeys on top. Only date columns that actually have events are shown.
                    const dayOf = (c) => (c && c.date || "").slice(0, 10);
                    const dateSet = new Set();
                    rows.forEach(r => ["lead", "trial", "sale"].forEach(s => { const d = dayOf(r[s]); if (d) dateSet.add(d); }));
                    const days = [...dateSet].sort();
                    const shortDate = (d) => { const dt = new Date(d + "T00:00:00Z"); return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
                    const filledN = (r) => (r.lead ? 1 : 0) + (r.trial ? 1 : 0) + (r.sale ? 1 : 0);
                    const furth = (r) => r.sale ? 3 : r.trial ? 2 : r.lead ? 1 : 0;
                    const firstD = (r) => ["lead", "trial", "sale"].map(s => dayOf(r[s])).filter(Boolean).sort()[0] || "";
                    const tlRows = rows.map((r, i) => ({ r, i }))
                      .filter(({ r }) => ["lead", "trial", "sale"].some(s => dayOf(r[s])))
                      .sort((a, b) => filledN(b.r) - filledN(a.r) || furth(b.r) - furth(a.r) || firstD(a.r).localeCompare(firstD(b.r)));
                    const cols = `190px repeat(${days.length}, 80px)`;
                    const pillStyle = (stage) => stage === "sale"
                      ? { border: `1.5px solid ${t.accent}`, background: t.accent, color: "#0A0A0B" }
                      : stage === "trial"
                        ? { border: `1.5px solid ${t.accent}`, background: "transparent", color: t.accent }
                        : { border: `1.5px solid ${t.borderMed}`, background: "transparent", color: t.textSub };
                    const cell = { borderTop: `1px solid ${t.border}`, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center" };
                    if (!days.length) return <div style={{ fontSize: 13, color: t.textSub }}>No dated records this month.</div>;
                    return (
                      <div style={{ overflowX: "auto" }}>
                        <div ref={boardBodyRef} style={{ position: "relative", width: "max-content", minWidth: "100%" }}>
                          <div style={{ display: "grid", gridTemplateColumns: cols }}>
                            <div style={{ ...colHead, textAlign: "left", paddingLeft: 2 }}>PERSON</div>
                            {days.map(d => <div key={"h" + d} style={{ fontSize: 10, fontWeight: 700, color: t.textMute, textAlign: "center", paddingBottom: 8, borderBottom: `2px solid ${t.text}` }}>{shortDate(d)}</div>)}
                            {tlRows.map(({ r, i }) => {
                              const nm = r.lead?.name || r.trial?.name || r.sale?.name;
                              return (
                                <Fragment key={i}>
                                  <div style={{ ...cell, justifyContent: "flex-start", gap: 6, paddingRight: 10, fontSize: 12.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{nm}</span>
                                    {r.sale?.amount != null && <span style={{ fontSize: 11, color: t.textSub, fontWeight: 500 }}>${r.sale.amount.toLocaleString()}</span>}
                                  </div>
                                  {days.map(d => {
                                    const stage = ["lead", "trial", "sale"].find(s => dayOf(r[s]) === d);
                                    const ev = stage ? r[stage] : null;
                                    return (
                                      <div key={i + "-" + d} style={cell}>
                                        {ev && (
                                          <div ref={el => { cardRefs.current[`${stage}:${i}`] = el; }}
                                            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 8, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", ...pillStyle(stage) }}>
                                            {stage === "lead" ? "Lead" : stage === "trial" ? "Trial" : "Sale"}{ev.dupCount > 1 ? `×${ev.dupCount}` : ""}
                                            <button onClick={() => deleteBoardCard(ev)} title="Delete this record" style={{ width: 15, height: 15, borderRadius: 4, border: "none", background: "transparent", color: stage === "sale" ? "#0A0A0B" : t.textMute, cursor: "pointer", fontSize: 10, lineHeight: 1, opacity: 0.8 }}>✕</button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </div>
                          {svgOverlay}
                        </div>
                      </div>
                    );
                  }

                  // Each column top-packs its own cards (whitespace falls to the bottom).
                  const renderCol = (title, stage, count) => (
                    <div style={{ minWidth: 0 }}>
                      <div style={colHead}>{title} <span style={{ color: t.textMute, fontWeight: 600 }}>{count}</span></div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                        {rows.map((r, i) => r[stage]
                          ? <div key={i} ref={el => { cardRefs.current[`${stage}:${i}`] = el; }}>{boardCell(r[stage], filledFor(stage, r))}</div>
                          : null)}
                      </div>
                    </div>
                  );
                  return (
                    <div ref={boardBodyRef} style={{ position: "relative" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", columnGap: 64, alignItems: "start" }}>
                        {renderCol("LEADS", "lead", board.leads.length)}
                        {renderCol("TRIALS", "trial", board.trials.length)}
                        {renderCol("SALES", "sale", board.sales.length)}
                      </div>
                      {svgOverlay}
                    </div>
                  );
                })()}
          </div>

          {trash.length > 0 && (
            <div onClick={e => e.stopPropagation()} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1200, width: 268, background: t.surface, border: `1px solid ${t.borderMed}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "11px 12px", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>🗑 Recently deleted <span style={{ color: t.textMute }}>({trash.length})</span></div>
                <button onClick={() => undoDelete(trash[0])} style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 7, border: "none", background: t.accent, color: "#0A0A0B", cursor: "pointer" }}>↩ Undo</button>
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {trash.map(entry => (
                  <div key={entry.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${t.border}` }}>
                    <span style={{ fontSize: 12, color: t.textSub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</span>
                    <button onClick={() => undoDelete(entry)} title="Restore this record" style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, border: `1px solid ${t.borderMed}`, background: "transparent", color: t.text, cursor: "pointer" }}>↩</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
