import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";

// ─── Combined Clients page ──────────────────────────────────────────────────
// Replaces the old Clients tab + Client Setup tab. Two states:
//   1. List view — searchable/filterable/sortable table of all clients
//   2. Detail view — per-client page with tabs (Overview / Setup / Marketing / Activity / Notes)
//
// Permissions (per Zoran's approval):
//   adminLike = admin || scaling_manager       — full access incl. financial data
//   marketing = marketing_manager || marketing_executor
//   any staff can: view, edit slack_channel_id, edit ghl_location_id, add notes
//   admin+scaling can also: edit stripe/notion, send invites, archive/delete, see MRR
//   marketing can also: edit Meta connection + campaigns
// ────────────────────────────────────────────────────────────────────────────

// Auto-parse Slack channel link → extract channel ID (e.g. C0123ABCD)
function parseSlackChannel(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // Already a raw ID
  if (/^[CGD][A-Z0-9]{8,}$/.test(trimmed)) return trimmed;
  // URL forms: slack.com/.../C0123ABCD/...  or  ?channel=C0123ABCD
  const m = trimmed.match(/[CGD][A-Z0-9]{8,}/);
  return m ? m[0] : null;
}

const ROLES = {
  isAdminLike: (role) => role === "admin" || role === "scaling_manager",
  isMarketing: (role) => role === "marketing_manager" || role === "marketing_executor",
  // Any authenticated staff
  canViewFinancials: (role) => role === "admin" || role === "scaling_manager",
  canEditAuth:       (role) => role === "admin" || role === "scaling_manager",
  canEditBilling:    (role) => role === "admin" || role === "scaling_manager",
  canEditMeta:       (role) => role === "admin" || role === "scaling_manager" || role === "marketing_manager" || role === "marketing_executor",
  canEditBasics:     () => true, // any staff
  canArchive:        (role) => role === "admin" || role === "scaling_manager",
};

const STATUS_OPTIONS = ["onboarding", "active", "paused", "churned"];

export default function ClientsCombinedView({ tokens, dark, me, session, initialClientId, onInitialClientHandled }) {
  const t = tokens;
  const role = me?.role || "";

  const [clients, setClients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  // If parent passed an initialClientId (e.g. Dashboard click), open that client.
  // One-shot: parent clears it via onInitialClientHandled so reopening the
  // Clients tab fresh doesn't keep re-jumping into the same client.
  useEffect(() => {
    if (initialClientId && initialClientId !== selectedId) {
      setSelectedId(initialClientId);
      onInitialClientHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all|active|onboarding|paused|churned
  const [sortKey, setSortKey] = useState("alpha"); // alpha|recent|mrr
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Load clients + staff.
  // Hard cap at 500 to prevent runaway memory if the table ever grows huge.
  // Past 500 clients we'll need server-side search/pagination; for now this
  // is a defensive safety net.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from("clients").select("*").order("business_name").limit(500).then(r => r.data || []),
        supabase.from("staff").select("id,name,role,email").order("name").then(r => r.data || []),
      ]);
      if (cancelled) return;
      setClients(c);
      setStaff(s);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshCounter]);

  const staffMap = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff]);
  const refresh = () => setRefreshCounter(x => x + 1);

  const filtered = useMemo(() => {
    let list = clients.filter(c => !c.archived_at); // Hide archived
    if (statusFilter !== "all") list = list.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => {
        const biz = (c.business_name || "").toLowerCase();
        const own = (c.owner_name || "").toLowerCase();
        return biz.includes(q) || own.includes(q);
      });
    }
    if (sortKey === "alpha") {
      list = [...list].sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""));
    } else if (sortKey === "recent") {
      list = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return list;
  }, [clients, statusFilter, search, sortKey]);

  const selectedClient = selectedId ? clients.find(c => c.id === selectedId) : null;

  // ─── DETAIL VIEW ─────────────────────────────────────────────────────────
  if (selectedClient) {
    return (
      <ClientDetail
        client={selectedClient}
        staff={staff}
        staffMap={staffMap}
        tokens={t}
        dark={dark}
        me={me}
        session={session}
        onBack={() => setSelectedId(null)}
        onChanged={refresh}
      />
    );
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────────────
  const counts = {
    all: clients.filter(c => !c.archived_at).length,
    active: clients.filter(c => c.status === "active" && !c.archived_at).length,
    onboarding: clients.filter(c => c.status === "onboarding" && !c.archived_at).length,
    paused: clients.filter(c => c.status === "paused" && !c.archived_at).length,
    churned: clients.filter(c => c.status === "churned" && !c.archived_at).length,
  };

  return (
    <div>
      {/* Header counts */}
      <div style={{ display: "flex", gap: 36, marginBottom: 28, alignItems: "baseline", flexWrap: "wrap" }}>
        <Stat label="Total" value={counts.all} tokens={t} />
        <Stat label="Active" value={counts.active} tokens={t} accent={t.green} />
        <Stat label="Onboarding" value={counts.onboarding} tokens={t} accent={t.amber} />
        {ROLES.canViewFinancials(role) && <Stat label="Paused" value={counts.paused} tokens={t} />}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by business or owner..."
          style={{
            flex: 1, minWidth: 240, padding: "10px 14px", background: t.surface,
            border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, fontSize: 13,
          }}
        />
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "active", label: `Active ${counts.active}` },
            { value: "onboarding", label: `Onboarding ${counts.onboarding}` },
            { value: "paused", label: `Paused ${counts.paused}` },
            { value: "churned", label: `Churned ${counts.churned}` },
          ]}
          tokens={t}
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          style={{
            padding: "10px 14px", background: t.surface, border: `1px solid ${t.border}`,
            borderRadius: 6, color: t.text, fontSize: 13, cursor: "pointer",
          }}
        >
          <option value="alpha">Sort: A → Z</option>
          <option value="recent">Sort: Recently added</option>
        </select>
        {ROLES.canArchive(role) && (
          <button
            onClick={() => setSelectedId("__new__")}
            style={{
              padding: "10px 16px", background: t.gold, color: "#0B0B0D",
              border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            + New client
          </button>
        )}
      </div>

      {loading && <div style={{ color: t.textMute, padding: 24 }}>Loading clients…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ color: t.textMute, padding: 36, textAlign: "center" }}>
          No clients match your filters.
        </div>
      )}

      {/* Table-style list */}
      {!loading && filtered.length > 0 && (
        <div style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 0.7fr",
            padding: "12px 18px",
            background: t.surface,
            borderBottom: `1px solid ${t.border}`,
            fontSize: 11, fontWeight: 600, color: t.textMute, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            <div>Business</div>
            <div>Owner</div>
            <div>Scaling Manager</div>
            <div>Status</div>
            <div>Auth</div>
          </div>
          {filtered.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              staff={staffMap[c.scaling_manager_id]}
              tokens={t}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
        </div>
      )}

      {selectedId === "__new__" && (
        <NewClientModal
          tokens={t}
          session={session}
          onClose={() => setSelectedId(null)}
          onCreated={(id) => { refresh(); setSelectedId(id); }}
        />
      )}
    </div>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────
function Stat({ label, value, tokens, accent }) {
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: accent || tokens.text }}>{value}</div>
      <div style={{ fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Segmented control ──────────────────────────────────────────────────────
function SegmentedControl({ value, onChange, options, tokens }) {
  return (
    <div style={{ display: "flex", background: tokens.surfaceEl, border: `1px solid ${tokens.border}`, borderRadius: 6, padding: 2 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "6px 12px", background: value === o.value ? tokens.surface : "transparent",
            color: value === o.value ? tokens.text : tokens.textMute,
            border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Single row in the list ─────────────────────────────────────────────────
function ClientRow({ client, staff, tokens, onClick }) {
  const [hov, setHov] = useState(false);
  const t = tokens;
  const authStatus = client.auth_user_id ? { label: "Active", color: t.green }
    : client.email ? { label: "Ready", color: t.amber }
    : { label: "No email", color: t.textMute };
  const statusColor = client.status === "active" ? t.green
    : client.status === "onboarding" ? t.amber
    : client.status === "paused" ? t.textMute
    : t.red;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 0.7fr",
        padding: "14px 18px",
        borderBottom: `1px solid ${t.border}`,
        cursor: "pointer",
        background: hov ? t.surfaceElHover || "rgba(255,255,255,0.03)" : "transparent",
        transition: "background 0.12s",
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 600, color: t.text, fontSize: 14 }}>{client.business_name || "(unnamed)"}</div>
      <div style={{ fontSize: 13, color: t.textSub }}>{client.owner_name || <span style={{ color: t.textMute, fontStyle: "italic" }}>none</span>}</div>
      <div style={{ fontSize: 13, color: t.textSub }}>{staff?.name || <span style={{ color: t.textMute, fontStyle: "italic" }}>unassigned</span>}</div>
      <div>
        <span style={{
          fontSize: 11, padding: "3px 9px", borderRadius: 999,
          background: `${statusColor}22`, color: statusColor, fontWeight: 600,
          textTransform: "capitalize",
        }}>{client.status}</span>
      </div>
      <div>
        <span style={{ fontSize: 11, color: authStatus.color, fontWeight: 600 }}>{authStatus.label}</span>
      </div>
    </div>
  );
}

// ─── Detail view with tabs ──────────────────────────────────────────────────
function ClientDetail({ client, staff, staffMap, tokens, dark, me, session, onBack, onChanged }) {
  const t = tokens;
  const role = me?.role || "";
  const [tab, setTab] = useState("overview");

  const tabs = [
    { id: "overview",     label: "Overview" },
    { id: "setup",        label: "Setup" },
    { id: "marketing",    label: "Marketing" },
    { id: "activity",     label: "Activity", hide: !ROLES.canViewFinancials(role) },
    { id: "notes",        label: "Notes" },
  ].filter(t => !t.hide);

  return (
    <div>
      {/* Breadcrumb + header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: t.textMute, marginBottom: 10, cursor: "pointer" }} onClick={onBack}>
        <span>← Clients</span><span>/</span><span style={{ color: t.text }}>{client.business_name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${t.border}` }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>{client.business_name}</h1>
          <div style={{ fontSize: 13, color: t.textSub, marginTop: 6 }}>
            {client.owner_name || "(no owner set)"}
            {client.email ? <> · {client.email}</> : null}
            {staffMap[client.scaling_manager_id] && <> · Manager: <b style={{ color: t.text }}>{staffMap[client.scaling_manager_id].name}</b></>}
          </div>
        </div>
        <StatusPill status={client.status} tokens={t} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${t.border}`, marginBottom: 22 }}>
        {tabs.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            style={{
              padding: "10px 18px",
              background: "transparent",
              color: tab === tb.id ? t.gold : t.textMute,
              borderBottom: `2px solid ${tab === tb.id ? t.gold : "transparent"}`,
              borderTop: "none", borderLeft: "none", borderRight: "none",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >{tb.label}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab client={client} staffMap={staffMap} tokens={t} role={role} session={session} onChanged={onChanged} />}
      {tab === "setup" && <SetupTab client={client} staff={staff} tokens={t} role={role} session={session} onChanged={onChanged} onBack={onBack} />}
      {tab === "marketing" && <MarketingTab client={client} tokens={t} role={role} session={session} />}
      {tab === "activity" && ROLES.canViewFinancials(role) && <ActivityTab client={client} tokens={t} session={session} />}
      {tab === "notes" && <NotesTab client={client} tokens={t} me={me} session={session} staffMap={staffMap} />}
    </div>
  );
}

function StatusPill({ status, tokens }) {
  const t = tokens;
  const color = status === "active" ? t.green
    : status === "onboarding" ? t.amber
    : status === "paused" ? t.textMute
    : t.red;
  return (
    <span style={{
      fontSize: 12, padding: "5px 12px", borderRadius: 999,
      background: `${color}22`, color, fontWeight: 600, textTransform: "capitalize",
    }}>{status}</span>
  );
}

// ─── OVERVIEW tab ───────────────────────────────────────────────────────────
function OverviewTab({ client, staffMap, tokens, role, session, onChanged }) {
  const t = tokens;
  const [revenue, setRevenue] = useState(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const canViewFinancials = ROLES.canViewFinancials(role);

  useEffect(() => {
    if (!canViewFinancials || !client.stripe_customer_id) return;
    let cancelled = false;
    setRevenueLoading(true);
    fetch(`/api/clients?id=${client.id}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const shaped = Array.isArray(data?.data) ? data.data[0] : data?.data;
        if (shaped) {
          setRevenue({
            label: shaped.revenue,
            mrr: shaped.mrr,
            status: shaped.billing_status,
            subs: shaped.active_subs,
          });
        }
        setRevenueLoading(false);
      })
      .catch(() => setRevenueLoading(false));
    return () => { cancelled = true; };
  }, [client.id, session, canViewFinancials, client.stripe_customer_id]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
      <div>
        <SectionTitle>Profile</SectionTitle>
        <Field k="Business Name" v={client.business_name} tokens={t} />
        <Field k="Owner" v={client.owner_name} tokens={t} />
        <Field k="Email" v={client.email} tokens={t} />
        <Field k="Scaling Manager" v={staffMap[client.scaling_manager_id]?.name} tokens={t} />
        <Field k="Status" v={client.status} tokens={t} cap />
        <Field k="Created" v={client.created_at ? new Date(client.created_at).toLocaleDateString() : null} tokens={t} />

        {canViewFinancials && (
          <>
            <SectionTitle style={{ marginTop: 28 }}>Billing (live from Stripe)</SectionTitle>
            {!client.stripe_customer_id && (
              <div style={{ color: t.textMute, fontSize: 13, padding: 12, fontStyle: "italic" }}>No Stripe customer linked.</div>
            )}
            {client.stripe_customer_id && revenueLoading && <div style={{ color: t.textMute, fontSize: 13 }}>Loading…</div>}
            {client.stripe_customer_id && revenue && (
              <>
                <Field k="MRR" v={revenue.label} tokens={t} />
                <Field k="Billing status" v={revenue.status} tokens={t} cap />
                <Field k="Active subscriptions" v={revenue.subs} tokens={t} />
              </>
            )}
          </>
        )}
      </div>

      <div>
        <SectionTitle>Quick links</SectionTitle>
        <QuickLink label="Slack channel" value={client.slack_channel_id} url={client.slack_channel_id ? `https://slack.com/app_redirect?channel=${client.slack_channel_id}` : null} tokens={t} />
        <QuickLink label="GHL sub-account" value={client.ghl_location_id} url={client.ghl_location_id ? `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}` : null} tokens={t} />
        <QuickLink label="Stripe customer" value={canViewFinancials ? client.stripe_customer_id : null} url={canViewFinancials && client.stripe_customer_id ? `https://dashboard.stripe.com/customers/${client.stripe_customer_id}` : null} tokens={t} hidden={!canViewFinancials} />
        <QuickLink label="Notion profile" value={client.notion_page_id} url={client.notion_page_id ? `https://www.notion.so/${String(client.notion_page_id).replace(/-/g, "")}` : null} tokens={t} />

        <SectionTitle style={{ marginTop: 28 }}>Auth</SectionTitle>
        <Field k="Auth status" v={client.auth_user_id ? "Active" : client.email ? "Ready to invite" : "No email"} tokens={t} />
        <Field k="auth_user_id" v={client.auth_user_id ? client.auth_user_id.slice(0, 8) + "…" : null} tokens={t} mono />
      </div>
    </div>
  );
}

// ─── SETUP tab ──────────────────────────────────────────────────────────────
function SetupTab({ client, staff, tokens, role, session, onChanged, onBack }) {
  const t = tokens;
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showArchive, setShowArchive] = useState(false);

  const canEditBilling = ROLES.canEditBilling(role);
  const canEditAuth = ROLES.canEditAuth(role);
  const canArchive = ROLES.canArchive(role);

  const set = (field, value) => setEdits(e => ({ ...e, [field]: value }));

  const currentValue = (field) => edits[field] !== undefined ? edits[field] : client[field];

  async function save() {
    setSaving(true); setMsg(null);
    const patch = { ...edits };

    // Auto-parse Slack link if user pasted a URL
    if (patch.slack_channel_id !== undefined) {
      const parsed = parseSlackChannel(patch.slack_channel_id);
      patch.slack_channel_id = parsed || (patch.slack_channel_id?.trim() ? patch.slack_channel_id.trim() : null);
    }

    // Normalize empty strings to null
    for (const k of Object.keys(patch)) {
      if (patch[k] === "" || patch[k] === undefined) patch[k] = null;
    }

    try {
      const tok = session?.access_token;
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ client_id: client.id, ...patch }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: "Saved ✓" });
      setEdits({});
      onChanged();
    } catch (err) {
      setMsg({ kind: "err", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive ${client.business_name}? They won't appear in the active list.`)) return;
    const tok = session?.access_token;
    const res = await fetch(`/api/clients?action=archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ client_id: client.id }),
    });
    if (res.ok) { onChanged(); onBack(); }
    else { const j = await res.json(); setMsg({ kind: "err", text: j.error || "archive failed" }); }
  }

  const hasChanges = Object.keys(edits).length > 0;

  return (
    <div style={{ maxWidth: 720 }}>
      <SectionTitle>Basics</SectionTitle>
      <EditField label="Business name" value={currentValue("business_name") || ""} onChange={v => set("business_name", v)} tokens={t} />
      <EditField label="Owner name" value={currentValue("owner_name") || ""} onChange={v => set("owner_name", v)} tokens={t} />
      <EditField label="Email" value={currentValue("email") || ""} onChange={v => set("email", v)} tokens={t} type="email" />
      <EditSelect label="Status" value={currentValue("status")} onChange={v => set("status", v)} options={STATUS_OPTIONS} tokens={t} />
      <EditSelect
        label="Scaling Manager"
        value={currentValue("scaling_manager_id") || ""}
        onChange={v => set("scaling_manager_id", v || null)}
        options={[{ value: "", label: "(unassigned)" }, ...staff.map(s => ({ value: s.id, label: `${s.name} · ${s.role}` }))]}
        tokens={t}
      />

      <SectionTitle style={{ marginTop: 28 }}>Integrations</SectionTitle>
      <EditField
        label="Slack channel"
        value={currentValue("slack_channel_id") || ""}
        onChange={v => set("slack_channel_id", v)}
        tokens={t}
        hint="Paste a Slack channel URL or just the channel ID (C0123ABCD). We'll auto-parse."
      />
      <EditField
        label="GHL location ID"
        value={currentValue("ghl_location_id") || ""}
        onChange={v => set("ghl_location_id", v)}
        tokens={t}
      />
      {canEditBilling && (
        <EditField
          label="Stripe customer ID"
          value={currentValue("stripe_customer_id") || ""}
          onChange={v => set("stripe_customer_id", v)}
          tokens={t}
          hint="cus_XXXXXXXX"
        />
      )}
      {canEditBilling && (
        <EditField
          label="Notion page ID"
          value={currentValue("notion_page_id") || ""}
          onChange={v => set("notion_page_id", v)}
          tokens={t}
        />
      )}

      {/* Save bar */}
      <div style={{ display: "flex", gap: 12, marginTop: 24, alignItems: "center" }}>
        <button
          onClick={save}
          disabled={!hasChanges || saving}
          style={{
            padding: "10px 22px", background: hasChanges ? t.gold : t.surfaceEl,
            color: hasChanges ? "#0B0B0D" : t.textMute, border: "none", borderRadius: 6,
            fontSize: 13, fontWeight: 600, cursor: hasChanges ? "pointer" : "not-allowed",
          }}
        >{saving ? "Saving…" : "Save changes"}</button>
        {hasChanges && !saving && (
          <button
            onClick={() => { setEdits({}); setMsg(null); }}
            style={{
              padding: "10px 16px", background: "transparent", color: t.textSub,
              border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 13, cursor: "pointer",
            }}
          >Discard</button>
        )}
        {msg && (
          <span style={{ fontSize: 13, color: msg.kind === "ok" ? t.green : t.red, fontWeight: 600 }}>
            {msg.text}
          </span>
        )}
      </div>

      {/* Account management */}
      {canEditAuth && (
        <>
          <SectionTitle style={{ marginTop: 36 }}>Account management</SectionTitle>
          <AuthActions client={client} tokens={t} session={session} onChanged={onChanged} />
        </>
      )}

      {/* Archive zone */}
      {canArchive && (
        <>
          <SectionTitle style={{ marginTop: 36, color: t.red }}>Danger zone</SectionTitle>
          <div style={{ padding: "14px 16px", border: `1px solid ${t.red}33`, borderRadius: 6, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 13, color: t.textSub, flex: 1 }}>
              Archive this client (hides them from the active list, keeps history).
            </div>
            <button
              onClick={archive}
              style={{
                padding: "8px 18px", background: "transparent", color: t.red,
                border: `1px solid ${t.red}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >Archive</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── MARKETING tab (Meta) ───────────────────────────────────────────────────
function fuzzyScore(a, b) {
  if (!a || !b) return 0;
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (x === y) return 100;
  if (y.includes(x) || x.includes(y)) return 60;
  const xw = x.split(/[\s\-_/.,&]+/).filter(w => w.length > 2);
  const yw = y.split(/[\s\-_/.,&]+/).filter(w => w.length > 2);
  let common = 0;
  for (const w of xw) if (yw.includes(w)) common++;
  return common * 15;
}
function suggestAdAccount(clientName, adAccounts) {
  let best = null, bestScore = 0;
  for (const a of adAccounts) {
    const s = fuzzyScore(clientName, a.name || "");
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return bestScore >= 15 ? best : null;
}

function MarketingTab({ client, tokens, role, session }) {
  const t = tokens;
  const canEdit = ROLES.canEditMeta(role);

  // Setup state
  const [adAccounts, setAdAccounts] = useState([]);
  const [metaConnected, setMetaConnected] = useState(null); // null=loading
  const [pickedAdAccount, setPickedAdAccount] = useState(client.meta_ad_account_id || "");
  const [pickedCampaigns, setPickedCampaigns] = useState(Array.isArray(client.meta_campaign_ids) ? client.meta_campaign_ids : []);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupMsg, setSetupMsg] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Campaign picker modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCampaigns, setPickerCampaigns] = useState([]);
  const [pickerSelected, setPickerSelected] = useState(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");

  // Display state — active campaigns shown below
  const [campaigns, setCampaigns] = useState(null);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsErr, setCampaignsErr] = useState(null);

  // Load ad accounts on mount (requires Meta connected staff-side)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = session?.access_token;
        const res = await fetch("/api/meta/adaccounts", { headers: { Authorization: `Bearer ${tok}` } });
        if (cancelled) return;
        if (res.ok) {
          const j = await res.json();
          setAdAccounts(j.ad_accounts || []);
          setMetaConnected(true);
        } else {
          setMetaConnected(false);
        }
      } catch {
        if (!cancelled) setMetaConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Load currently-active campaigns for display
  useEffect(() => {
    if (!client.meta_ad_account_id) { setCampaigns(null); setCampaignsLoading(false); return; }
    let cancelled = false;
    setCampaignsLoading(true);
    fetch(`/api/meta/campaigns?client_id=${client.id}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setCampaigns(data?.campaigns || []);
        setCampaignsLoading(false);
      })
      .catch(e => { if (!cancelled) { setCampaignsErr(e.message); setCampaignsLoading(false); } });
    return () => { cancelled = true; };
  }, [client.id, client.meta_ad_account_id, session, refreshKey]);

  // Auto-suggest an ad account if none picked yet and we have ad accounts
  const suggested = useMemo(() => {
    if (pickedAdAccount || !adAccounts.length) return null;
    return suggestAdAccount(client.business_name, adAccounts);
  }, [client.business_name, adAccounts, pickedAdAccount]);

  async function openPicker() {
    if (!pickedAdAccount) {
      setSetupMsg({ kind: "err", text: "Save an ad account first, then pick campaigns." });
      return;
    }
    if (pickedAdAccount !== (client.meta_ad_account_id || "")) {
      setSetupMsg({ kind: "err", text: "Save the ad account change first, then pick campaigns." });
      return;
    }
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerError("");
    setPickerSelected(new Set(pickedCampaigns));
    try {
      const tok = session?.access_token;
      const r = await fetch(`/api/meta/campaigns?staff_picker=1&client_id=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.reason === "no_ad_account") {
        setPickerError("Save the ad account first, then re-open this picker.");
      } else if (j.reason === "no_staff_token") {
        setPickerError("Meta not connected. Go to Settings → Connect Meta.");
      } else {
        setPickerCampaigns(j.campaigns || []);
        if (Array.isArray(j.meta_campaign_ids)) setPickerSelected(new Set(j.meta_campaign_ids));
      }
    } catch (e) {
      setPickerError(e.message || "Failed to load campaigns");
    }
    setPickerLoading(false);
  }

  function togglePickerCampaign(id) {
    setPickerSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function applyPicker() {
    setPickedCampaigns(Array.from(pickerSelected));
    setPickerOpen(false);
  }

  async function saveSetup() {
    setSetupSaving(true); setSetupMsg(null);
    try {
      const tok = session?.access_token;
      const adChanged = (pickedAdAccount || "") !== (client.meta_ad_account_id || "");
      const oldCamp = Array.isArray(client.meta_campaign_ids) ? client.meta_campaign_ids : [];
      const campsChanged = oldCamp.length !== pickedCampaigns.length || oldCamp.some(id => !pickedCampaigns.includes(id));
      if (!adChanged && !campsChanged) {
        setSetupMsg({ kind: "info", text: "No changes to save." });
        setSetupSaving(false); return;
      }
      if (pickedAdAccount) {
        const r = await fetch("/api/meta/adaccounts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ client_id: client.id, ad_account_id: pickedAdAccount, campaign_ids: pickedCampaigns }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      } else if (adChanged) {
        // Clearing ad account
        const r = await fetch(`/api/meta/adaccounts?client_id=${encodeURIComponent(client.id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
      }
      setSetupMsg({ kind: "ok", text: "Saved ✓" });
      setRefreshKey(x => x + 1);
    } catch (err) {
      setSetupMsg({ kind: "err", text: err.message });
    } finally {
      setSetupSaving(false);
    }
  }

  const hasUnsaved = (pickedAdAccount || "") !== (client.meta_ad_account_id || "") ||
    (function () {
      const oldCamp = Array.isArray(client.meta_campaign_ids) ? client.meta_campaign_ids : [];
      return oldCamp.length !== pickedCampaigns.length || oldCamp.some(id => !pickedCampaigns.includes(id));
    })();

  return (
    <div style={{ maxWidth: 880 }}>
      {/* Meta connection status */}
      <div style={{
        padding: "12px 16px", marginBottom: 22, borderRadius: 6,
        background: t.surfaceEl, border: `1px solid ${t.border}`,
        display: "flex", alignItems: "center", gap: 12, fontSize: 13,
      }}>
        {metaConnected === null && <span style={{ color: t.textMute }}>Checking Meta connection…</span>}
        {metaConnected === true && (
          <>
            <span style={{ color: t.green, fontWeight: 600 }}>● Meta connected</span>
            <span style={{ color: t.textSub }}>{adAccounts.length} ad accounts available on your staff token</span>
          </>
        )}
        {metaConnected === false && (
          <>
            <span style={{ color: t.red, fontWeight: 600 }}>● Meta not connected</span>
            <span style={{ color: t.textSub }}>Go to <b style={{ color: t.text }}>Settings → Connect Meta</b> to load ad accounts.</span>
          </>
        )}
      </div>

      {/* Setup: ad account + campaign picker */}
      {canEdit && (
        <>
          <SectionTitle>Meta setup</SectionTitle>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, color: t.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
              Ad account
            </label>
            <select
              value={pickedAdAccount}
              onChange={e => setPickedAdAccount(e.target.value)}
              disabled={!metaConnected}
              style={{
                width: "100%", padding: "9px 12px", background: t.surface,
                border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, fontSize: 13,
              }}
            >
              <option value="">{metaConnected ? "(none — pick one)" : "Meta not connected"}</option>
              {adAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name || "(unnamed)"} · {a.id}
                </option>
              ))}
            </select>
            {suggested && (
              <div style={{ fontSize: 11, color: t.textMute, marginTop: 6 }}>
                Suggested: <button
                  onClick={() => setPickedAdAccount(suggested.id)}
                  style={{ background: "transparent", color: t.gold, border: "none", padding: 0, fontWeight: 600, cursor: "pointer", fontSize: 11 }}
                >{suggested.name} · {suggested.id}</button>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, color: t.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
              Campaigns to surface ({pickedCampaigns.length} selected)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={openPicker} style={btnStyle(t, "secondary")}>
                {pickedCampaigns.length ? `Edit selection (${pickedCampaigns.length})` : "Pick campaigns"}
              </button>
              <span style={{ fontSize: 11, color: t.textMute }}>
                {pickedCampaigns.length === 0 ? "Empty = show all active campaigns" : `${pickedCampaigns.length} campaign(s) will be shown to this client`}
              </span>
            </div>
          </div>

          {/* Save bar */}
          <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
            <button
              onClick={saveSetup}
              disabled={!hasUnsaved || setupSaving}
              style={{
                padding: "9px 18px", background: hasUnsaved ? t.gold : t.surfaceEl,
                color: hasUnsaved ? "#0B0B0D" : t.textMute, border: "none", borderRadius: 6,
                fontSize: 13, fontWeight: 600, cursor: hasUnsaved ? "pointer" : "not-allowed",
              }}
            >{setupSaving ? "Saving…" : "Save Meta setup"}</button>
            {hasUnsaved && !setupSaving && (
              <button
                onClick={() => {
                  setPickedAdAccount(client.meta_ad_account_id || "");
                  setPickedCampaigns(Array.isArray(client.meta_campaign_ids) ? client.meta_campaign_ids : []);
                  setSetupMsg(null);
                }}
                style={btnStyle(t, "secondary")}
              >Discard</button>
            )}
            {setupMsg && (
              <span style={{ fontSize: 13, color: setupMsg.kind === "ok" ? t.green : setupMsg.kind === "err" ? t.red : t.textSub, fontWeight: 600 }}>
                {setupMsg.text}
              </span>
            )}
          </div>
        </>
      )}

      {/* Active campaigns display */}
      <SectionTitle style={{ marginTop: 32 }}>Active campaigns</SectionTitle>
      {!client.meta_ad_account_id && (
        <div style={{ color: t.textMute, padding: 12, fontSize: 13, fontStyle: "italic" }}>
          No ad account linked yet. {canEdit ? "Pick one above and save to see campaigns." : "Ask an admin or scaling manager to wire one up."}
        </div>
      )}
      {client.meta_ad_account_id && campaignsLoading && <div style={{ color: t.textMute, padding: 12 }}>Loading campaigns…</div>}
      {client.meta_ad_account_id && campaignsErr && <div style={{ color: t.red, padding: 12 }}>Error: {campaignsErr}</div>}
      {client.meta_ad_account_id && !campaignsLoading && !campaignsErr && campaigns?.length === 0 && (
        <div style={{ color: t.textMute, padding: 12, fontStyle: "italic" }}>No active campaigns.</div>
      )}
      {client.meta_ad_account_id && !campaignsLoading && campaigns?.length > 0 && (
        <div style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
          {campaigns.map(c => (
            <a
              key={c.id}
              href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${(client.meta_ad_account_id || "").replace(/^act_/, "")}&selected_campaign_ids=${c.id}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                padding: "14px 18px", borderBottom: `1px solid ${t.border}`,
                textDecoration: "none", color: t.text, alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
              <div style={{ fontSize: 13, color: t.textSub }}>{c.spend ? `$${c.spend}` : "—"}</div>
              <div style={{ fontSize: 13, color: t.textSub }}>{c.leads || 0} leads</div>
              <div style={{ fontSize: 12, color: t.textMute, textAlign: "right" }}>↗ Open in Meta</div>
            </a>
          ))}
        </div>
      )}

      {/* Campaign picker modal */}
      {pickerOpen && (
        <CampaignPickerModal
          campaigns={pickerCampaigns}
          selected={pickerSelected}
          loading={pickerLoading}
          error={pickerError}
          onToggle={togglePickerCampaign}
          onSelectAll={() => setPickerSelected(new Set(pickerCampaigns.map(c => c.id)))}
          onClear={() => setPickerSelected(new Set())}
          onApply={applyPicker}
          onClose={() => setPickerOpen(false)}
          tokens={t}
        />
      )}
    </div>
  );
}

function CampaignPickerModal({ campaigns, selected, loading, error, onToggle, onSelectAll, onClear, onApply, onClose, tokens }) {
  const t = tokens;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, padding: 0, maxWidth: 720, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.text }}>Pick campaigns to surface</div>
            <div style={{ fontSize: 12, color: t.textMute, marginTop: 2 }}>Only the selected campaigns will appear on this client's portal.</div>
          </div>
          <button onClick={onClose} style={btnStyle(t, "secondary")}>✕ Close</button>
        </div>
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${t.border}`, display: "flex", gap: 8 }}>
          <button onClick={onSelectAll} style={btnStyle(t, "secondary")}>Select all</button>
          <button onClick={onClear} style={btnStyle(t, "secondary")}>Clear</button>
          <div style={{ marginLeft: "auto", fontSize: 12, color: t.textMute, alignSelf: "center" }}>
            {selected.size} of {campaigns.length} selected
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading && <div style={{ padding: 24, color: t.textMute, textAlign: "center" }}>Loading…</div>}
          {error && <div style={{ padding: 24, color: t.red }}>{error}</div>}
          {!loading && !error && campaigns.length === 0 && (
            <div style={{ padding: 24, color: t.textMute, textAlign: "center", fontStyle: "italic" }}>No campaigns in this ad account.</div>
          )}
          {campaigns.map(c => {
            const checked = selected.has(c.id);
            return (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 22px", cursor: "pointer", borderBottom: `1px solid ${t.border}` }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(c.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: t.textMute, fontFamily: "JetBrains Mono, monospace" }}>{c.id} · {c.status || "active"}</div>
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={btnStyle(t, "secondary")}>Cancel</button>
          <button onClick={onApply} style={btnStyle(t, "primary")}>Apply selection</button>
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVITY tab (tickets + Stripe failed payments) ─────────────────────────
function ActivityTab({ client, tokens, session }) {
  const t = tokens;
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("tickets").select("id,type,menu_item,status,submitted_at").eq("client_id", client.id).order("submitted_at", { ascending: false }).limit(10),
    ]).then(([tk]) => {
      if (cancelled) return;
      setTickets(tk.data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client.id]);

  return (
    <div>
      <SectionTitle>Recent tickets</SectionTitle>
      {loading && <div style={{ color: t.textMute }}>Loading…</div>}
      {!loading && tickets.length === 0 && <div style={{ color: t.textMute, fontStyle: "italic", padding: 12 }}>No tickets yet.</div>}
      {!loading && tickets.length > 0 && (
        <div style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
          {tickets.map(tk => (
            <div key={tk.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", padding: "12px 18px", borderBottom: `1px solid ${t.border}`, fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{tk.menu_item || tk.type}</div>
              <div style={{ color: t.textSub, textTransform: "capitalize" }}>{tk.type}</div>
              <div style={{ color: t.textSub, textTransform: "capitalize" }}>{tk.status}</div>
              <div style={{ color: t.textMute }}>{tk.submitted_at ? new Date(tk.submitted_at).toLocaleDateString() : "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NOTES tab ──────────────────────────────────────────────────────────────
function NotesTab({ client, tokens, me, session, staffMap }) {
  const t = tokens;
  const [notes, setNotes] = useState([]);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("client_notes")
      .select("id,body,created_at,staff_id")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setNotes(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [client.id, refresh]);

  async function addNote() {
    if (!body.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("client_notes")
      .insert({ client_id: client.id, staff_id: me?.id || null, body: body.trim() });
    setSaving(false);
    if (!error) {
      setBody("");
      setRefresh(x => x + 1);
    } else {
      alert(`Error: ${error.message}`);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <SectionTitle>Internal notes</SectionTitle>
      <div style={{ marginBottom: 18 }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note about this client (visible to all staff)..."
          rows={3}
          style={{
            width: "100%", padding: 12, background: t.surface,
            border: `1px solid ${t.border}`, borderRadius: 6, color: t.text,
            fontSize: 13, fontFamily: "inherit", resize: "vertical",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            onClick={addNote}
            disabled={saving || !body.trim()}
            style={{
              padding: "8px 18px", background: body.trim() ? t.gold : t.surfaceEl,
              color: body.trim() ? "#0B0B0D" : t.textMute, border: "none", borderRadius: 6,
              fontSize: 13, fontWeight: 600, cursor: body.trim() ? "pointer" : "not-allowed",
            }}
          >{saving ? "Saving…" : "Add note"}</button>
        </div>
      </div>

      {loading && <div style={{ color: t.textMute }}>Loading…</div>}
      {!loading && notes.length === 0 && (
        <div style={{ color: t.textMute, padding: 24, fontStyle: "italic", textAlign: "center" }}>
          No notes yet. Be the first to add one.
        </div>
      )}
      {notes.map(n => (
        <div key={n.id} style={{ padding: "12px 16px", background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: t.textMute }}>
            <span><b style={{ color: t.text }}>{staffMap[n.staff_id]?.name || "Unknown"}</b></span>
            <span>{new Date(n.created_at).toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 14, color: t.text, whiteSpace: "pre-wrap" }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Auth actions ───────────────────────────────────────────────────────────
function AuthActions({ client, tokens, session, onChanged }) {
  const t = tokens;
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send(action, body) {
    setBusy(true); setMsg(null);
    try {
      const tok = session?.access_token;
      const res = await fetch(`/api/clients?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: action === "reset-password" ? "Reset email sent ✓" : "Invite sent ✓" });
      onChanged();
    } catch (err) {
      setMsg({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      {!client.auth_user_id && client.email && client.owner_name && (
        <button
          onClick={() => send("setup-account", { client_id: client.id, email: client.email, owner_name: client.owner_name })}
          disabled={busy}
          style={btnStyle(t, "primary")}
        >Send portal invite</button>
      )}
      {client.auth_user_id && client.email && (
        <button
          onClick={() => send("reset-password", { email: client.email })}
          disabled={busy}
          style={btnStyle(t, "secondary")}
        >Send password reset</button>
      )}
      {!client.email && (
        <div style={{ fontSize: 13, color: t.textMute, fontStyle: "italic" }}>
          Add an email above first, then save — then you can send invites.
        </div>
      )}
      {msg && (
        <span style={{ fontSize: 13, color: msg.kind === "ok" ? t.green : t.red, fontWeight: 600 }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

// ─── New client modal ───────────────────────────────────────────────────────
function NewClientModal({ tokens, session, onClose, onCreated }) {
  const t = tokens;
  const [biz, setBiz] = useState("");
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function create() {
    setErr(null);
    if (!biz.trim()) { setErr("Business name required"); return; }
    if (sendInvite && (!email.trim() || !owner.trim())) {
      setErr("Email + owner required to send invite");
      return;
    }
    setBusy(true);
    try {
      const tok = session?.access_token;
      const action = sendInvite ? "" : "create-client";
      const url = action ? `/api/clients?action=${action}` : "/api/clients";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          business_name: biz.trim(),
          owner_name: owner.trim() || undefined,
          email: email.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onCreated(j.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 6, padding: 28, maxWidth: 460, width: "100%" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 18px", color: t.text }}>New client</h2>
        <EditField label="Business name" value={biz} onChange={setBiz} tokens={t} />
        <EditField label="Owner name" value={owner} onChange={setOwner} tokens={t} />
        <EditField label="Email" value={email} onChange={setEmail} tokens={t} type="email" />
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, cursor: "pointer", fontSize: 13, color: t.textSub }}>
          <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} />
          Send portal invite immediately *(requires email + owner)*
        </label>
        {err && <div style={{ color: t.red, fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={btnStyle(t, "secondary")}>Cancel</button>
          <button onClick={create} disabled={busy} style={btnStyle(t, "primary")}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tiny components ────────────────────────────────────────────────────────
function SectionTitle({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "#6E6E78", marginBottom: 12, ...style,
    }}>{children}</div>
  );
}

function Field({ k, v, tokens, mono, cap }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${tokens.border}`, fontSize: 13 }}>
      <span style={{ color: tokens.textMute }}>{k}</span>
      <span style={{
        color: v ? tokens.text : tokens.textMute,
        fontWeight: v ? 500 : 400,
        fontFamily: mono ? "JetBrains Mono, monospace" : "inherit",
        textTransform: cap ? "capitalize" : "none",
        fontStyle: v ? "normal" : "italic",
      }}>{v || "—"}</span>
    </div>
  );
}

function QuickLink({ label, value, url, tokens, hidden }) {
  if (hidden) return null;
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${tokens.border}` }}>
      <div style={{ fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {value && url ? (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: tokens.gold, fontSize: 13, textDecoration: "none", fontFamily: "JetBrains Mono, monospace" }}>
          {value} ↗
        </a>
      ) : (
        <span style={{ color: tokens.textMute, fontSize: 13, fontStyle: "italic" }}>Not linked</span>
      )}
    </div>
  );
}

function EditField({ label, value, onChange, tokens, type = "text", hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "9px 12px", background: tokens.surface,
          border: `1px solid ${tokens.border}`, borderRadius: 6, color: tokens.text, fontSize: 13,
        }}
      />
      {hint && <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function EditSelect({ label, value, onChange, options, tokens }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "9px 12px", background: tokens.surface,
          border: `1px solid ${tokens.border}`, borderRadius: 6, color: tokens.text, fontSize: 13,
        }}
      >
        {options.map(o => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </div>
  );
}

function btnStyle(t, kind) {
  if (kind === "primary") return {
    padding: "9px 18px", background: t.gold, color: "#0B0B0D",
    border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
  };
  return {
    padding: "9px 16px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
  };
}
