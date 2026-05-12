import { useState, useEffect } from "react";

const TYPE_META = {
  replace:           { icon: "🔄", label: "Replace creative" },
  add:               { icon: "➕", label: "Add new creative" },
  remove:            { icon: "🗑",  label: "Remove creative" },
  budget:            { icon: "💰", label: "Budget change" },
  "campaign-create": { icon: "🚀", label: "New campaign" },
};

const STATUS_META = {
  "in-progress": { label: "In Progress",  color: "gold" },
  "completed":   { label: "Completed",    color: "green" },
  "cancelled":   { label: "Cancelled",    color: "mute" },
};

// Ticket types that include uploaded files → need content review by Cam/Ximena
const CONTENT_TYPES = new Set(["replace", "add", "campaign-create"]);

function needsContentCheckByType(type) {
  return CONTENT_TYPES.has(type);
}

// 3-letter test-tracking code prefix derived from the ticket UUID
function ticketCode(id) {
  if (!id) return "???";
  const cleaned = String(id).replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return cleaned || "???";
}

// ─── Date formatters ───
function formatDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Map API ticket shape (Supabase columns) → flat shape this view renders
function normalizeTicket(apiTicket) {
  const fields = apiTicket.fields || {};
  const files = Array.isArray(apiTicket.files) ? apiTicket.files : [];
  return {
    id: apiTicket.id,
    academyName: apiTicket.client?.name || "—",
    campaignTitle: fields.campaign_title || "",
    type: apiTicket.type,
    creative: fields.creative_name,
    fileName: files[0]?.name,
    fileUrl: files[0]?.url,
    fileNames: files.map(f => f.name).filter(Boolean),
    files,
    note: fields.note || "",
    currentSpend: fields.current_spend,
    newSpend: fields.new_spend,
    offer: fields.offer,
    isNewOffer: fields.is_new_offer,
    newOfferDescription: fields.new_offer_description,
    budget: fields.monthly_spend,
    landingPage: fields.landing_page,
    status: apiTicket.status,
    contentCheckStatus: apiTicket.content_check_status,
    clientActionStatus: apiTicket.client_action_status,
    submittedDate: formatDateLong(apiTicket.submitted_at),
    updates: (apiTicket.messages || []).map(m => ({
      who: m.author_name || (m.author_type === "staff" ? "Staff" : "Client"),
      when: formatDateShort(m.created_at),
      message: m.body || "",
      isActionRequest: !!m.is_action_request,
    })),
    _raw: apiTicket,
  };
}

// Reference data only — replaced by live API fetch
const SAMPLE_TICKETS_UNUSED_ = [
  {
    id: "mt-001",
    academyName: "BAM GTA",
    campaignTitle: "Title of campaign 1",
    type: "replace",
    creative: "Creative 3",
    fileName: "summer-trial-v2.jpg",
    fileUrl: "https://picsum.photos/seed/upload1/120/120",
    note: "This one isn't getting many clicks. Trying a brighter version.",
    status: "in-progress",
    contentCheckStatus: "pending",
    clientActionStatus: "none",
    submittedDate: "May 8, 2026",
    updates: [],
  },
  {
    id: "mt-002",
    academyName: "BAM GTA",
    campaignTitle: "Title of campaign 2",
    type: "add",
    fileName: "gym-rental-promo.mp4",
    fileUrl: "https://picsum.photos/seed/upload2/120/120",
    note: "New 15-second promo for gym rental.",
    status: "in-progress",
    contentCheckStatus: "pending",
    clientActionStatus: "none",
    submittedDate: "May 6, 2026",
    updates: [],
  },
  {
    id: "mt-003",
    academyName: "BAM GTA",
    campaignTitle: "Title of campaign 1",
    type: "budget",
    currentSpend: "$465",
    newSpend: "$600",
    note: "Cost per result is solid, want to scale.",
    status: "in-progress",
    contentCheckStatus: "not-required",
    clientActionStatus: "requested",
    submittedDate: "May 4, 2026",
    updates: [{ who: "You", when: "May 5", message: "Can you confirm the $600 is the new daily or monthly target?", isActionRequest: true }],
  },
  {
    id: "mt-004",
    academyName: "BAM NY",
    campaignTitle: "Spring Tryouts",
    type: "remove",
    creative: "Creative 2",
    note: "",
    status: "in-progress",
    contentCheckStatus: "not-required",
    clientActionStatus: "none",
    submittedDate: "May 3, 2026",
    updates: [],
  },
  {
    id: "mt-005",
    academyName: "BAM Toronto Test",
    campaignTitle: "Summer Camp Drive",
    type: "budget",
    currentSpend: "$200",
    newSpend: "$350",
    note: "Camp registrations are coming in strong, let's push more spend.",
    status: "in-progress",
    contentCheckStatus: "not-required",
    clientActionStatus: "none",
    submittedDate: "May 2, 2026",
    updates: [],
  },
  {
    id: "mt-006",
    academyName: "BAM GTA",
    campaignTitle: "Title of campaign 1",
    type: "replace",
    creative: "Creative 5",
    fileName: "court-action-shot.jpg",
    fileUrl: "https://picsum.photos/seed/upload3/120/120",
    note: "",
    status: "completed",
    contentCheckStatus: "approved",
    clientActionStatus: "none",
    submittedDate: "Apr 22, 2026",
    updates: [{ who: "You", when: "Apr 23", message: "Swapped in. Performance is already up 8%." }],
  },
  {
    id: "mt-007",
    academyName: "BAM GTA",
    campaignTitle: "Title of campaign 2",
    type: "budget",
    currentSpend: "$150",
    newSpend: "$200",
    note: "",
    status: "completed",
    contentCheckStatus: "not-required",
    clientActionStatus: "none",
    submittedDate: "Apr 14, 2026",
    updates: [{ who: "You", when: "Apr 15", message: "Budget updated." }],
  },
];

export default function MarketingView({ tokens: tk, dark, me, session }) {
  const [tab, setTab] = useState("active"); // active | content-check | client-action | completed
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionMessage, setRevisionMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [banner, setBanner] = useState(null); // { type, text }

  // ─── Fetch tickets on mount ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError("");
      try {
        const token = session?.access_token;
        const res = await fetch("/api/marketing-tickets?scope=staff", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setTickets((json.tickets || []).map(normalizeTicket));
        }
      } catch (e) {
        if (!cancelled) setFetchError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const selected = selectedId ? tickets.find(t => t.id === selectedId) : null;

  const inProgress = tickets.filter(t => t.status === "in-progress");
  // "Awaiting revision" tickets (returned by marketing to content team) are also
  // hidden from Active since the ball is no longer in marketing's court.
  const awaitingRev = inProgress.filter(t => t._raw?.awaiting_revision);
  const clientDep   = inProgress.filter(t => t.clientActionStatus === "requested");
  // Active = in-progress, not awaiting client, not awaiting content revision
  const active      = inProgress.filter(t => t.clientActionStatus !== "requested" && !t._raw?.awaiting_revision);
  const completed   = tickets.filter(t => t.status === "completed" || t.status === "cancelled");

  const rows =
    tab === "active"         ? active
    : tab === "client-action" ? clientDep
                              : completed;

  const showBanner = (type, text) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 3500);
  };

  const _patchTicket = async (id, body) => {
    const token = session?.access_token;
    const res = await fetch(`/api/marketing-tickets?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return normalizeTicket({ ...json.ticket, client: selected._raw?.client || null });
  };

  const markCompleted = async () => {
    if (!selected || actionBusy) return;
    setActionBusy(true);
    try {
      const updated = await _patchTicket(selected.id, { action: "mark-completed" });
      setTickets(prev => prev.map(t => t.id === selected.id ? updated : t));
      setSelectedId(null);
      showBanner("success", `Ticket for ${selected.academyName} marked completed.`);
    } catch (e) {
      showBanner("error", "Mark completed failed: " + e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const submitRevisionRequest = async (msg) => {
    if (!selected || !msg || !msg.trim() || actionBusy) return;
    setActionBusy(true);
    try {
      const hasVideo = (selected.files || []).some(f => (f.mime || "").startsWith("video/"));
      await _patchTicket(selected.id, {
        action: "request-content-revision",
        message: msg.trim(),
        type: hasVideo ? "video" : "graphic",
      });
      // Pull fresh data so this ticket disappears from Active
      try {
        const token = session?.access_token;
        const res = await fetch("/api/marketing-tickets?scope=staff", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (res.ok) setTickets((json.tickets || []).map(normalizeTicket));
      } catch (_) { /* swallow */ }
      setSelectedId(null);
      setRevisionModalOpen(false);
      setRevisionMessage("");
      showBanner("success", `Revision request sent to content team for ${selected.academyName}.`);
    } catch (e) {
      showBanner("error", "Revision request failed: " + e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const submitActionRequest = async () => {
    if (!selected || !actionMessage.trim() || actionBusy) return;
    setActionBusy(true);
    try {
      const updated = await _patchTicket(selected.id, {
        action: "request-client-action",
        message: actionMessage.trim(),
      });
      setTickets(prev => prev.map(t => t.id === selected.id ? updated : t));
      setActionMessage("");
      setActionModalOpen(false);
      showBanner("success", `Action request sent to ${selected.academyName}.`);
    } catch (e) {
      showBanner("error", "Send failed: " + e.message);
    } finally {
      setActionBusy(false);
    }
  };

  // ─────────────────────── Detail view ───────────────────────
  if (selected) {
    const typeMeta = TYPE_META[selected.type] || { icon: "•", label: "Request" };

    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {banner && <Banner banner={banner} tk={tk} />}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 28 }}>
          <button
            onClick={() => setSelectedId(null)}
            style={{
              background: "transparent", border: `1px solid ${tk.border}`, color: tk.textMute,
              width: 38, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 18,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Back"
          >←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
              Marketing Ticket · {ticketCode(selected.id)} · {selected.id.slice(0, 8)}
            </div>
            <div style={{ fontSize: 26, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em", marginBottom: 4 }}>
              {typeMeta.icon}  {typeMeta.label}{selected.creative ? ` · ${selected.creative}` : ""}
            </div>
            <div style={{ fontSize: 13, color: tk.textSub }}>
              {selected.academyName}  ·  {selected.campaignTitle}  ·  Submitted {selected.submittedDate}
            </div>
          </div>
          <StatusPills t={selected} tk={tk} size="large" />
        </div>

        {/* What client submitted */}
        <SectionLabel tk={tk}>Client submitted</SectionLabel>
        <Card tk={tk} style={{ marginBottom: 24 }}>
          {renderSubmittedInfo(selected, tk)}
        </Card>

        {/* Updates */}
        <SectionLabel tk={tk}>Activity</SectionLabel>
        <Card tk={tk} style={{ marginBottom: 28 }}>
          {selected.updates && selected.updates.length ? selected.updates.map((u, i) => (
            <div key={i} style={{
              padding: "12px 0",
              borderBottom: i < selected.updates.length - 1 ? `1px solid ${tk.borderSoft || tk.border}` : "none",
            }}>
              <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
                {u.when} · {u.who}{u.isActionRequest ? "  ·  Action Requested" : ""}
              </div>
              <div style={{ fontSize: 14, color: tk.text, lineHeight: 1.5 }}>{u.message}</div>
            </div>
          )) : (
            <div style={{ padding: 12, textAlign: "center", color: tk.textSub, fontSize: 13, fontStyle: "italic" }}>
              No activity yet.
            </div>
          )}
        </Card>

        {/* Action buttons */}
        {selected.status === "in-progress" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {/* "Request Content Revision" only shows up when finals exist (i.e. ticket came from content team) */}
            {(selected.files && selected.files.length > 0) && (
              <button
                onClick={() => setRevisionModalOpen(true)}
                style={{
                  background: "transparent", border: `1px solid ${tk.amber || "#E8A547"}`, color: tk.amber || "#E8A547",
                  padding: "10px 20px", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                }}
              >↩  Request Content Revision</button>
            )}
            <button
              onClick={() => setActionModalOpen(true)}
              style={{
                background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
                padding: "10px 20px", borderRadius: 8, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              }}
            >Request Client Action</button>
            <button
              onClick={markCompleted}
              style={{
                background: tk.accent, color: "#0A0A0B", border: 0,
                padding: "10px 22px", borderRadius: 8, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 700,
              }}
            >✓  Mark Completed</button>
          </div>
        )}

        {actionModalOpen && (
          <ActionRequestModal
            tk={tk}
            value={actionMessage}
            onChange={setActionMessage}
            onCancel={() => { setActionModalOpen(false); setActionMessage(""); }}
            onSubmit={submitActionRequest}
            academyName={selected.academyName}
          />
        )}

        {revisionModalOpen && (
          <RevisionRequestModal
            tk={tk}
            value={revisionMessage}
            onChange={setRevisionMessage}
            onCancel={() => { setRevisionModalOpen(false); setRevisionMessage(""); }}
            onSubmit={() => submitRevisionRequest(revisionMessage)}
            busy={actionBusy}
          />
        )}
      </div>
    );
  }

  // ─────────────────────── List view ───────────────────────
  return (
    <div style={{ padding: "24px 28px", color: tk.text }}>
      {banner && <Banner banner={banner} tk={tk} />}

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
          § Marketing
        </div>
        <div style={{ fontSize: 28, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em" }}>
          Marketing Tickets
        </div>
        <div style={{ fontSize: 13, color: tk.textSub, marginTop: 6 }}>
          Requests from clients about their ad campaigns.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}`, marginBottom: 20, overflowX: "auto" }}>
        <Tab label={`Active (${active.length})`}                  active={tab === "active"}         onClick={() => setTab("active")}         tk={tk} />
        <Tab label={`Client Dependent (${clientDep.length})`}     active={tab === "client-action"} onClick={() => setTab("client-action")} tk={tk} red={clientDep.length > 0} />
        <Tab label={`Completed (${completed.length})`}            active={tab === "completed"}     onClick={() => setTab("completed")}     tk={tk} />
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 1.4fr 1.3fr 0.9fr 1.2fr",
        gap: 16,
        padding: "8px 16px",
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
      }}>
        <div>Academy</div>
        <div>Campaign</div>
        <div>Type</div>
        <div>Submitted</div>
        <div style={{ textAlign: "right" }}>Status</div>
      </div>

      {/* Rows */}
      <Card tk={tk} style={{ padding: "4px 0" }}>
        {loading ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.textSub, fontSize: 13 }}>
            Loading marketing tickets…
          </div>
        ) : fetchError ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.red || "#ED7969", fontSize: 13 }}>
            ⚠ {fetchError}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.textSub, fontSize: 13, fontStyle: "italic" }}>
            No tickets in this view.
          </div>
        ) : rows.map(t => {
          const typeMeta = TYPE_META[t.type] || { icon: "•", label: "Request" };
          return (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.4fr 1.3fr 0.9fr 1.2fr",
                gap: 16,
                padding: "14px 16px",
                borderBottom: `1px solid ${tk.borderSoft || tk.border}`,
                cursor: "pointer",
                alignItems: "center",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={e => e.currentTarget.style.background = tk.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontWeight: 500, color: tk.text, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 10, letterSpacing: "0.12em",
                  color: tk.textMute, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.04)", border: `1px solid ${tk.border}`,
                }}>{ticketCode(t.id)}</span>
                <span>{t.academyName}</span>
              </div>
              <div style={{ color: tk.textSub, fontSize: 13 }}>{t.campaignTitle}</div>
              <div style={{ color: tk.textSub, fontSize: 13 }}>
                <span style={{ marginRight: 6 }}>{typeMeta.icon}</span>{typeMeta.label}
                {t.creative ? <span style={{ color: tk.textMute, marginLeft: 6 }}>· {t.creative}</span> : ""}
              </div>
              <div style={{ color: tk.textMute, fontSize: 12, fontFamily: "monospace", letterSpacing: "0.05em" }}>
                {t.submittedDate}
              </div>
              <StatusPills t={t} tk={tk} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ── helpers ──────────────────────────────────────

function Tab({ label, active, onClick, tk, amber, red }) {
  // When inactive, the count-color hint draws attention to tabs with pending work
  const hintColor = red ? (tk.red || "#ED7969") : amber ? (tk.amber || "#E8A547") : null;
  const inactiveColor = hintColor || tk.textSub;
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 18px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? tk.accent : inactiveColor,
        borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s ease",
      }}
    >{label}</div>
  );
}

// Stacked status pills: main status + content-check + client-action signals
function StatusPills({ t, tk, size = "small" }) {
  const fontSize = size === "large" ? 11 : 10;
  const padding = size === "large" ? "5px 11px" : "3px 9px";

  const pills = [];

  // Main status
  if (t.status === "in-progress") {
    pills.push({ label: "In Progress", color: tk.accent });
  } else if (t.status === "completed") {
    pills.push({ label: "Completed", color: tk.green || "#7ED996" });
  } else if (t.status === "cancelled") {
    pills.push({ label: "Cancelled", color: tk.textMute });
  }

  // Client action signal — only while active
  if (t.status === "in-progress" && t.clientActionStatus === "requested") {
    pills.push({ label: "Awaiting client", color: tk.red || "#ED7969" });
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4,
      alignItems: "flex-end",
    }}>
      {pills.map(p => (
        <span key={p.label} style={{
          color: p.color, fontSize, fontWeight: 600, letterSpacing: "0.15em",
          textTransform: "uppercase", padding, borderRadius: 999,
          border: `1px solid ${p.color}`, background: `${p.color}15`,
          whiteSpace: "nowrap",
        }}>{p.label}</span>
      ))}
    </div>
  );
}

function SectionLabel({ children, tk }) {
  return (
    <div style={{
      fontSize: 10, color: tk.textMute, letterSpacing: "0.22em",
      textTransform: "uppercase", marginBottom: 10,
    }}>{children}</div>
  );
}

function Card({ children, tk, style }) {
  return (
    <div style={{
      background: tk.surface,
      border: `1px solid ${tk.border}`,
      borderRadius: 10,
      padding: 18,
      ...style,
    }}>{children}</div>
  );
}

function renderSubmittedInfo(t, tk) {
  const rows = [];
  rows.push(["Academy", t.academyName]);
  rows.push(["Campaign", t.campaignTitle]);

  // Helper to render a download grid for the attached final creatives
  const filesGrid = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {(t.files || []).map((f, i) => {
        const isImage = (f.mime || "").startsWith("image/");
        return (
          <a key={i} href={f.url} target="_blank" rel="noreferrer" download={f.name} style={{
            display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
            padding: 8, borderRadius: 8,
            background: tk.surfaceHov || "rgba(255,255,255,0.04)",
            border: `1px solid ${tk.border}`,
            textDecoration: "none", color: tk.text, fontSize: 11, maxWidth: 120,
          }}>
            {isImage
              ? <img src={f.url} alt={f.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }} />
              : <div style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, background: tk.surface, fontSize: 22, color: tk.textMute }}>{(f.mime || "").startsWith("video/") ? "🎬" : "📄"}</div>
            }
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{f.name}</span>
            <span style={{ color: tk.accent, fontSize: 10, letterSpacing: "0.05em" }}>Download ↓</span>
          </a>
        );
      })}
    </div>
  );

  if (t.type === "replace") {
    rows.push(["Replacing", t.creative || ""]);
    rows.push(["Final creatives", t.files && t.files.length ? filesGrid : <span style={{ color: tk.textMute }}>No files</span>]);
    rows.push(["Note", t.note ? t.note : <span style={{ color: tk.textMute }}>No note</span>]);
  } else if (t.type === "add") {
    rows.push(["Final creatives", t.files && t.files.length ? filesGrid : <span style={{ color: tk.textMute }}>No files</span>]);
    rows.push(["Note", t.note ? t.note : <span style={{ color: tk.textMute }}>No note</span>]);
  } else if (t.type === "remove") {
    rows.push(["Removing", t.creative || ""]);
  } else if (t.type === "budget") {
    rows.push(["Current spend", t.currentSpend || ""]);
    rows.push(["New spend", <span style={{ color: tk.accent, fontWeight: 600 }}>{t.newSpend || ""}</span>]);
    rows.push(["Reason", t.note ? t.note : <span style={{ color: tk.textMute }}>Not provided</span>]);
  } else if (t.type === "campaign-create") {
    rows.push(["Offer", <span>{t.offer || ""}{t.isNewOffer ? <span style={{ marginLeft: 8, color: tk.accent, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>New offer</span> : null}</span>]);
    if (t.isNewOffer && t.newOfferDescription) {
      rows.push(["Description", t.newOfferDescription]);
    }
    rows.push(["Monthly spend", <span style={{ color: tk.accent, fontWeight: 600 }}>{t.budget || ""}</span>]);
    rows.push(["Landing page", t.landingPage
      ? <a href={t.landingPage} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{t.landingPage} ↗</a>
      : <span style={{ color: tk.textMute }}>Using default funnel</span>]);
    rows.push(["Files", t.files && t.files.length
      ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {t.files.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ color: tk.text, fontSize: 12, padding: "4px 10px", borderRadius: 6, background: tk.surfaceHov || "rgba(255,255,255,0.04)", textDecoration: "none" }}>{f.name} ↗</a>
          ))}
        </div>
      )
      : <span style={{ color: tk.textMute }}>No files</span>]);
  }

  return rows.map(([label, value], i) => (
    <div key={label} style={{
      display: "flex", alignItems: "flex-start", gap: 16,
      padding: "10px 0",
      borderBottom: i < rows.length - 1 ? `1px solid ${tk.borderSoft || tk.border}` : "none",
    }}>
      <div style={{
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
        width: 140, flexShrink: 0, paddingTop: 4,
      }}>{label}</div>
      <div style={{ flex: 1, color: tk.text, fontSize: 14, lineHeight: 1.5 }}>{value}</div>
    </div>
  ));
}

function RevisionRequestModal({ tk, value, onChange, onCancel, onSubmit, busy }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,11,0.78)",
        backdropFilter: "blur(8px)", zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: tk.bg, border: `1px solid ${tk.borderStrong || tk.border}`,
          borderRadius: 12, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>
          § Revision Request
        </div>
        <div style={{ fontSize: 20, fontWeight: 500, color: tk.text, marginBottom: 6 }}>
          What needs to be revised?
        </div>
        <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 18, lineHeight: 1.5 }}>
          This spawns a new content ticket with these notes. The ticket leaves the Active tab until content sends the revision back.
        </div>

        <textarea
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. The hook is too slow. Cut the first 2 seconds and add a stronger opener."
          style={{
            width: "100%", minHeight: 120,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${tk.border}`, borderRadius: 6,
            color: tk.text, fontFamily: "inherit", fontSize: 14,
            padding: "10px 12px", resize: "vertical",
          }}
        />

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button onClick={onCancel} disabled={busy} style={{
            background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
            padding: "10px 18px", borderRadius: 6,
            cursor: busy ? "wait" : "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 500,
            opacity: busy ? 0.6 : 1,
          }}>Cancel</button>
          <button onClick={onSubmit} disabled={!value.trim() || busy} style={{
            background: value.trim() && !busy ? (tk.amber || "#E8A547") : tk.border,
            color: "#0A0A0B", border: 0,
            padding: "10px 20px", borderRadius: 6,
            cursor: value.trim() && !busy ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontSize: 12, fontWeight: 700,
            opacity: value.trim() && !busy ? 1 : 0.6,
          }}>{busy ? "Sending…" : "Send Revision Request"}</button>
        </div>
      </div>
    </div>
  );
}

function ActionRequestModal({ tk, value, onChange, onCancel, onSubmit, academyName }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,10,11,0.78)",
        backdropFilter: "blur(8px)", zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460,
          background: tk.bg, border: `1px solid ${tk.borderStrong || tk.border}`,
          borderRadius: 12, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>
          § Action Request
        </div>
        <div style={{ fontSize: 20, fontWeight: 500, color: tk.text, marginBottom: 6 }}>
          What do you need from the client?
        </div>
        <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 18, lineHeight: 1.5 }}>
          {academyName} will see this on their ticket and be prompted to respond before you can complete it.
        </div>

        <textarea
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. Can you confirm the $600 is the new daily target, not monthly?"
          style={{
            width: "100%", minHeight: 110,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${tk.border}`, borderRadius: 6,
            color: tk.text, fontFamily: "inherit", fontSize: 14,
            padding: "10px 12px", resize: "vertical",
          }}
        />

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button onClick={onCancel} style={{
            background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
            padding: "10px 18px", borderRadius: 6, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 500,
          }}>Cancel</button>
          <button onClick={onSubmit} disabled={!value.trim()} style={{
            background: value.trim() ? tk.accent : tk.border, color: "#0A0A0B", border: 0,
            padding: "10px 20px", borderRadius: 6,
            cursor: value.trim() ? "pointer" : "not-allowed",
            fontFamily: "inherit", fontSize: 12, fontWeight: 700,
            opacity: value.trim() ? 1 : 0.6,
          }}>Send Request</button>
        </div>
      </div>
    </div>
  );
}

function Banner({ banner, tk }) {
  const bg = banner.type === "success" ? tk.green : tk.red;
  return (
    <div style={{
      position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
      background: bg, color: "#fff",
      padding: "12px 22px", borderRadius: 999, fontSize: 13, fontWeight: 600,
      zIndex: 9999, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      animation: "toastIn 0.25s ease",
    }}>{banner.text}</div>
  );
}
