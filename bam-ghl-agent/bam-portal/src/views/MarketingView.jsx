import { useState, useEffect } from "react";
import { useUrlState } from "../hooks/useUrlState";
import MarketingOverview from "./MarketingOverview";
import RefreshCalendarSection from "./RefreshCalendarSection";
import MediaLightbox from "../components/MediaLightbox";
import { mlIsMedia, mlDownloadUrl } from "../lib/media";

const TYPE_META = {
  replace:           { icon: "🔄", label: "Replace creative" },
  add:               { icon: "➕", label: "Add new creative" },
  remove:            { icon: "🗑",  label: "Remove creative" },
  budget:            { icon: "💰", label: "Budget change" },
  "campaign-create": { icon: "🚀", label: "New campaign" },
  "budget-review":   { icon: "📋", label: "Budget confirmation" },
};

const STATUS_META = {
  "in-progress": { label: "In Progress",  color: "gold" },
  "completed":   { label: "Completed",    color: "green" },
  "cancelled":   { label: "Cancelled",    color: "mute" },
};

// ─── Priority + turnaround SLA ───
// Marketing turnaround: urgent (high) = 2 business days, standard (normal) = 4,
// from the marketing submit date. A 2/4 split deliberately sits inside the 3-day
// external promise so we stay conservative (Zoran/Cam call, 2026-06-27). These
// MUST match the digest cron's _mktDueDate in api/marketing.js, or the 9am Slack
// digest and the portal will disagree on which marketing tickets are overdue.
const PRIORITY_META = {
  high:   { label: "High",   sla: 2, color: "#ED7969" },
  normal: { label: "Normal", sla: 4, color: "#7E9CD9" },
};
function priorityOf(apiTicketFields) {
  return (apiTicketFields?.priority === "high") ? "high" : "normal";
}
// Add N business days (skip Sat/Sun) to a date.
function addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
// Whole business days from today until `due` (negative if past).
function bizDaysUntil(due) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(due);  d.setHours(0, 0, 0, 0);
  if (d.getTime() < now.getTime()) return -1;
  let count = 0;
  const cur = new Date(now);
  while (cur.getTime() < d.getTime()) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}
// { due, label, overdue } deadline info for a ticket, or null with no submit date.
function deadlineInfo(submittedIso, priority) {
  if (!submittedIso) return null;
  const sla = (PRIORITY_META[priority] || PRIORITY_META.normal).sla;
  const due = addBusinessDays(new Date(submittedIso), sla);
  const rem = bizDaysUntil(due);
  if (rem < 0) return { due, label: "Overdue", overdue: true };
  if (rem === 0) return { due, label: "Due today", overdue: false };
  return { due, label: `Due in ${rem} biz day${rem === 1 ? "" : "s"}`, overdue: false };
}

// Resolve the client's website from brand_data, wherever it was entered.
// Different input paths have used different keys (website_url from Brand Basics,
// domain from older imports), so check them all so Cam always sees a site if one
// exists. Returns a clickable absolute URL (prepends https:// for bare domains).
function clientWebsiteFrom(brand) {
  if (!brand || typeof brand !== "object") return "";
  const raw = [brand.website_url, brand.domain, brand.website, brand.url]
    .map(v => (typeof v === "string" ? v.trim() : ""))
    .find(Boolean);
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

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
function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min)       return "just now";
  if (diff < hr)        return Math.round(diff / min) + " min ago";
  if (diff < day)       return Math.round(diff / hr) + " hr ago";
  if (diff < 2 * day)   return "yesterday";
  if (diff < 7 * day)   return Math.round(diff / day) + " days ago";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function lastActivityIso(apiTicket) {
  const msgs = Array.isArray(apiTicket.messages) ? apiTicket.messages : [];
  const lastMsg = msgs.length ? msgs[msgs.length - 1]?.created_at : null;
  return lastMsg || apiTicket.updated_at || apiTicket.submitted_at || null;
}

// Map API ticket shape (Supabase columns) → flat shape this view renders
function normalizeTicket(apiTicket) {
  const fields = apiTicket.fields || {};
  const files = Array.isArray(apiTicket.files) ? apiTicket.files : [];
  return {
    id: apiTicket.id,
    academyName: apiTicket.client?.business_name || "—",
    clientWebsite: clientWebsiteFrom(apiTicket.client?.brand_data),
    assignedSm: apiTicket.assigned_to_name || "",
    priority: priorityOf(fields),
    campaignTitle: fields.campaign_title || "",
    type: apiTicket.type,
    creative: fields.creative_name,
    fileName: files[0]?.name,
    fileUrl: files[0]?.url,
    fileNames: files.map(f => f.name).filter(Boolean),
    files,
    note: fields.note || "",
    clientNotes: fields.client_notes || "",
    currentSpend: fields.current_spend,
    newSpend: fields.new_spend,
    offer: fields.offer,
    isNewOffer: fields.is_new_offer,
    newOfferDescription: fields.new_offer_description,
    budget: fields.monthly_spend,
    confirmedBudgets: Array.isArray(fields.confirmed_budgets) ? fields.confirmed_budgets : null,
    changesCount: fields.changes_count,
    landingPage: fields.landing_page,
    status: apiTicket.status,
    contentCheckStatus: apiTicket.content_check_status,
    clientActionStatus: apiTicket.client_action_status,
    submittedDate: formatDateLong(apiTicket.submitted_at),
    lastActivityAt: lastActivityIso(apiTicket),
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
  const [section, setSection] = useUrlState("msec", "performance"); // performance | tickets | refresh
  const [tab, setTab] = useUrlState("mtab", "active"); // active | client-action | completed
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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | replace | add | remove | budget | campaign-create
  const [sortOrder, setSortOrder] = useState("due"); // due | priority | newest | oldest
  const [stateFilter, setStateFilter] = useState("all"); // all | overdue | awaiting-revision (cross-cuts tabs)

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

  // Deep-link: when the client-detail Marketing tab sends us here for a specific
  // ticket, it stashes the id. Once tickets load, jump to it and clear the stash.
  useEffect(() => {
    let focusId = null;
    try { focusId = sessionStorage.getItem("bam_marketing_focus_ticket"); } catch { focusId = null; }
    if (!focusId) return;
    const ft = tickets.find(t => t.id === focusId);
    if (!ft) return;
    setSection("tickets");
    if (ft.status === "completed" || ft.status === "cancelled") setTab("completed");
    else if (ft.clientActionStatus === "requested") setTab("client-action");
    else setTab("active");
    setSelectedId(focusId);
    try { sessionStorage.removeItem("bam_marketing_focus_ticket"); } catch { /* ignore */ }
  }, [tickets]);

  const selected = selectedId ? tickets.find(t => t.id === selectedId) : null;

  const inProgress = tickets.filter(t => t.status === "in-progress");
  const isOverdue   = t => !!deadlineInfo(t._raw?.submitted_at, t.priority)?.overdue;
  // "On hold" = staff-side pause (on_hold flag, invisible to the client). Held
  // tickets live in their OWN tab and leave Active / Client Dependent / Overdue -
  // a paused ticket shouldn't nag anyone until it's resumed.
  const onHold      = inProgress.filter(t => t._raw?.on_hold);
  const live        = inProgress.filter(t => !t._raw?.on_hold);
  // "Awaiting revision" = returned by marketing to the content team. It used to drop
  // the ticket out of every tab (invisible). Now it's a state we badge, not a place we
  // hide: the ticket stays in Active so overdue work can't fall through the cracks.
  const awaitingRev = live.filter(t => t._raw?.awaiting_revision);
  const clientDep   = live.filter(t => t.clientActionStatus === "requested");
  // Active = in-progress and not waiting on the client (awaiting-revision now lives here).
  const active      = live.filter(t => t.clientActionStatus !== "requested");
  const completed   = tickets.filter(t => t.status === "completed" || t.status === "cancelled");
  // Cross-cutting quick filters: every non-completed ticket that is overdue / in revision,
  // regardless of which tab it sits in — so "show me all overdue" is one click.
  const overdueAll  = live.filter(isOverdue);

  const tabRows =
    stateFilter === "overdue"            ? overdueAll
    : stateFilter === "awaiting-revision" ? awaitingRev
    : tab === "active"                    ? active
    : tab === "client-action"             ? clientDep
    : tab === "on-hold"                   ? onHold
                                          : completed;

  // Apply toolbar filters: free-text search across academy + campaign,
  // type filter, then sort by submitted date.
  const rows = (() => {
    let list = tabRows;
    if (typeFilter !== "all") list = list.filter(t => t.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        (t.academyName || "").toLowerCase().includes(q) ||
        (t.campaignTitle || "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const aDate = new Date(a._raw?.submitted_at || 0).getTime();
      const bDate = new Date(b._raw?.submitted_at || 0).getTime();
      if (sortOrder === "due") {
        // Soonest due first → overdue (earliest due date) floats to the very top.
        // Tickets with no submit date (no deadline) sink to the bottom.
        const aDue = a._raw?.submitted_at ? deadlineInfo(a._raw.submitted_at, a.priority).due.getTime() : Infinity;
        const bDue = b._raw?.submitted_at ? deadlineInfo(b._raw.submitted_at, b.priority).due.getTime() : Infinity;
        if (aDue !== bDue) return aDue - bDue;
        return aDate - bDate;
      }
      if (sortOrder === "priority") {
        // High priority first; within the same priority, newest first.
        const rank = p => (p === "high" ? 0 : 1);
        const diff = rank(a.priority) - rank(b.priority);
        if (diff !== 0) return diff;
        return bDate - aDate;
      }
      return sortOrder === "newest" ? bDate - aDate : aDate - bDate;
    });
    return list;
  })();

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

  // Staff-side pause. Toggles on_hold via the hold/resume actions - the ticket
  // stays open in the drawer so the new state is visible; the client sees nothing.
  const toggleHold = async () => {
    if (!selected || actionBusy) return;
    const holding = !selected._raw?.on_hold;
    setActionBusy(true);
    try {
      const updated = await _patchTicket(selected.id, { action: holding ? "hold" : "resume" });
      setTickets(prev => prev.map(t => t.id === selected.id ? updated : t));
      showBanner("success", `Ticket for ${selected.academyName} ${holding ? "put on hold" : "resumed"}.`);
    } catch (e) {
      showBanner("error", (holding ? "Hold" : "Resume") + " failed: " + e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const cancelTicket = async () => {
    if (!selected || actionBusy) return;
    if (!window.confirm(`Cancel this ticket for ${selected.academyName}? This cannot be undone.`)) return;
    setActionBusy(true);
    try {
      const updated = await _patchTicket(selected.id, { action: "cancel" });
      setTickets(prev => prev.map(t => t.id === selected.id ? updated : t));
      setSelectedId(null);
      showBanner("success", `Ticket for ${selected.academyName} cancelled.`);
    } catch (e) {
      showBanner("error", "Cancel failed: " + e.message);
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

  // Switcher between the cross-client Performance portal and the ticket queue.
  const sectionTabs = () => (
    <div style={{ display: "inline-flex", background: tk.surfaceEl, border: `1px solid ${tk.borderMed}`, borderRadius: 999, padding: 3, marginBottom: 20 }}>
      {[["performance", "Performance"], ["tickets", "Tickets"], ["refresh", "Creative Refresh"]].map(([id, label]) => (
        <button key={id} onClick={() => setSection(id)} style={{
          border: 0, background: section === id ? tk.accent : "transparent",
          color: section === id ? "#0A0A0B" : tk.textMute, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 16px", borderRadius: 999, cursor: "pointer",
        }}>{label}{id === "tickets" && clientDep.length > 0 ? ` (${clientDep.length})` : ""}</button>
      ))}
    </div>
  );

  // ─────────────────────── Performance portal (cross-client) ───────────────────────
  if (section === "performance") {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {banner && <Banner banner={banner} tk={tk} />}
        {sectionTabs()}
        <MarketingOverview tokens={tk} session={session} />
      </div>
    );
  }

  // ─────────────────────── Creative Refresh calendar ───────────────────────
  if (section === "refresh") {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {banner && <Banner banner={banner} tk={tk} />}
        {sectionTabs()}
        <RefreshCalendarSection tokens={tk} session={session} />
      </div>
    );
  }

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
              {selected.lastActivityAt ? `  ·  Last activity ${formatRelative(selected.lastActivityAt)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <PriorityChip priority={selected.priority} tk={tk} size="large" />
            <DeadlineLabel t={selected} tk={tk} />
            <StatusPills t={selected} tk={tk} size="large" />
          </div>
        </div>

        {/* Client — who this is for + where the offer lives (Cam's first stop) */}
        <SectionLabel tk={tk}>Client</SectionLabel>
        <Card tk={tk} style={{ marginBottom: 24 }}>
          {renderClientInfo(selected, tk, () => {
            const msg = `Hey — can you send the landing page link for ${selected.academyName}'s ${selected.offer || selected.campaignTitle || "campaign"}? Need it to build the ad.`;
            try {
              navigator.clipboard?.writeText(msg);
              showBanner("success", "Message copied — paste it to the SM in Slack.");
            } catch (_) {
              showBanner("error", "Couldn't copy — message: " + msg);
            }
          })}
        </Card>

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
              onClick={toggleHold}
              disabled={actionBusy}
              style={{
                background: "transparent", border: "1px solid #8FA8C8", color: "#8FA8C8",
                padding: "10px 20px", borderRadius: 8, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              }}
            >{selected._raw?.on_hold ? "▶  Resume" : "⏸  On Hold"}</button>
            <button
              onClick={cancelTicket}
              disabled={actionBusy}
              style={{
                background: "transparent", border: `1px solid ${tk.red || "#E55"}`, color: tk.red || "#E55",
                padding: "10px 20px", borderRadius: 8, cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 500,
              }}
            >✕  Cancel</button>
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
      {sectionTabs()}

      {/* Toolbar: search + type filter + sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by academy or campaign…"
          style={{
            flex: "1 1 280px", minWidth: 220,
            padding: "9px 14px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            outline: "none", fontFamily: "inherit",
          }}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: "9px 12px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <option value="all">All types</option>
          {Object.entries(TYPE_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          style={{
            padding: "9px 12px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <option value="due">Soonest due (overdue first)</option>
          <option value="priority">Priority (urgent first)</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}`, marginBottom: 20, overflowX: "auto" }}>
        <Tab label={`Active (${active.length})`}                  active={tab === "active"}         onClick={() => setTab("active")}         tk={tk} />
        <Tab label={`Client Dependent (${clientDep.length})`}     active={tab === "client-action"} onClick={() => setTab("client-action")} tk={tk} red={clientDep.length > 0} />
        <Tab label={`On Hold (${onHold.length})`}                 active={tab === "on-hold"}       onClick={() => setTab("on-hold")}       tk={tk} />
        <Tab label={`Completed (${completed.length})`}            active={tab === "completed"}     onClick={() => setTab("completed")}     tk={tk} />
      </div>

      {/* Quick filters — cut across tabs so nothing overdue can hide */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StateChip label="All"               active={stateFilter === "all"}               onClick={() => setStateFilter("all")} tk={tk} />
        <StateChip label={`⚠ Overdue (${overdueAll.length})`}            active={stateFilter === "overdue"}            onClick={() => setStateFilter("overdue")} tk={tk} tone={tk.red || "#ED7969"} count={overdueAll.length} />
        <StateChip label={`↩ Awaiting revision (${awaitingRev.length})`} active={stateFilter === "awaiting-revision"} onClick={() => setStateFilter("awaiting-revision")} tk={tk} tone={tk.amber || "#E8A547"} count={awaitingRev.length} />
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.1fr 1.3fr 1.1fr 1fr 0.8fr 1.1fr",
        gap: 16,
        padding: "8px 16px",
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
      }}>
        <div>Academy</div>
        <div>Campaign</div>
        <div>Type</div>
        <div>Priority</div>
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
          // Overdue (past the 3-day SLA) while still in progress → flag the whole
          // row red so it stands out at the top of the soonest-due sort. A held
          // ticket is paused on purpose, so it never screams overdue.
          const dl = (t.status === "in-progress" && !t._raw?.on_hold) ? deadlineInfo(t._raw?.submitted_at, t.priority) : null;
          const isOverdue = !!dl?.overdue;
          const redLine = tk.red || "#ED7969";
          const baseBg = isOverdue ? "rgba(237,121,105,0.08)" : "transparent";
          return (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "1.1fr 1.3fr 1.1fr 1fr 0.8fr 1.1fr",
                gap: 16,
                padding: "14px 16px",
                borderBottom: `1px solid ${tk.borderSoft || tk.border}`,
                borderLeft: isOverdue
                  ? `3px solid ${redLine}`
                  : (t.priority === "high" && t.status === "in-progress"
                      ? `3px solid ${PRIORITY_META.high.color}` : "3px solid transparent"),
                background: baseBg,
                cursor: "pointer",
                alignItems: "center",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={e => e.currentTarget.style.background = tk.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = baseBg}
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                <PriorityChip priority={t.priority} tk={tk} />
                <DeadlineLabel t={t} tk={tk} />
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

// Quick-filter chip — cross-cuts the tabs (e.g. "all overdue regardless of bucket").
// A zero-count state chip is dimmed but still clickable (shows the empty view).
function StateChip({ label, active, onClick, tk, tone, count }) {
  const accent = tone || tk.accent;
  const empty = typeof count === "number" && count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 13px", fontSize: 12.5, fontWeight: 600, borderRadius: 999,
        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        background: active ? `${accent}22` : "transparent",
        color: active ? accent : (empty ? tk.textMute : tk.textSub),
        border: `1px solid ${active ? accent : tk.border}`,
        transition: "all 0.12s ease",
      }}
    >{label}</button>
  );
}

// Priority chip — High (urgent, client-flagged) vs Normal
function PriorityChip({ priority, tk, size = "small" }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.normal;
  const fontSize = size === "large" ? 11 : 10;
  const padding = size === "large" ? "5px 11px" : "3px 9px";
  return (
    <span style={{
      color: meta.color, fontSize, fontWeight: 700, letterSpacing: "0.14em",
      textTransform: "uppercase", padding, borderRadius: 999,
      border: `1px solid ${meta.color}`, background: `${meta.color}15`, whiteSpace: "nowrap",
    }}>{priority === "high" ? "⚡ " : ""}{meta.label}</span>
  );
}

// Turnaround deadline derived from priority SLA (only meaningful while in progress)
function DeadlineLabel({ t, tk }) {
  if (t.status !== "in-progress") return null;
  const info = deadlineInfo(t._raw?.submitted_at, t.priority);
  if (!info) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      color: info.overdue ? (tk.red || "#ED7969") : tk.textMute,
    }}>{info.overdue ? "⚠ " : ""}{info.label}</span>
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

  // Awaiting-revision signal — ticket was sent back to the content team. Shown as a
  // badge (not a hidden bucket) so the ticket stays visible in Active.
  if (t.status === "in-progress" && t._raw?.awaiting_revision) {
    pills.push({ label: "Awaiting revision", color: tk.amber || "#E8A547" });
  }

  // On-hold signal — staff-side pause (invisible to the client).
  if (t.status === "in-progress" && t._raw?.on_hold) {
    pills.push({ label: "⏸ On hold", color: "#8FA8C8" });
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

// Client header card: who the ticket is for + the links Cam needs to learn the
// offer (client site, landing page, offer name). When no landing page is attached,
// surface the V1 stopgap from the call — a one-tap "ask the SM for the link".
function renderClientInfo(t, tk, onAskSm) {
  const rows = [];
  rows.push(["Client", <span style={{ fontWeight: 600 }}>{t.academyName}</span>]);

  rows.push(["Assigned SM", t.assignedSm
    ? <span>{t.assignedSm}</span>
    : <span style={{ color: tk.textMute }}>Unassigned</span>]);

  rows.push(["Client site", t.clientWebsite
    ? <a href={t.clientWebsite} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{t.clientWebsite} ↗</a>
    : <span style={{ color: tk.textMute }}>No website on file</span>]);

  rows.push(["Landing page", t.landingPage
    ? <a href={t.landingPage} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{t.landingPage} ↗</a>
    : (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: tk.textMute }}>Not attached</span>
        <button onClick={onAskSm} style={{
          background: "transparent", border: `1px solid ${tk.accent}`, color: tk.accent,
          padding: "6px 14px", borderRadius: 6, cursor: "pointer",
          fontFamily: "inherit", fontSize: 12, fontWeight: 600,
        }}>🔗 Ask SM for landing page</button>
      </div>
    )]);

  if (t.offer) {
    rows.push(["Offer", <span>{t.offer}{t.isNewOffer ? <span style={{ marginLeft: 8, color: tk.accent, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>New offer</span> : null}</span>]);
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

// One attached-file tile in a submitted-info grid. Media tiles open the shared
// lightbox player (raw .MOV URLs download instead of playing when navigated to);
// the Download caption keeps the one-click download.
function SubmittedFileTile({ f, tk }) {
  const isImage = (f.mime || "").startsWith("image/");
  const isVideo = (f.mime || "").startsWith("video/");
  const isMedia = mlIsMedia(f);
  const [preview, setPreview] = useState(false);
  return (<>
    <a
      href={f.url} target="_blank" rel="noreferrer" download={f.name}
      onClick={isMedia ? (e) => { e.preventDefault(); setPreview(true); } : undefined}
      style={{
        display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
        padding: 8, borderRadius: 8,
        background: tk.surfaceHov || "rgba(255,255,255,0.04)",
        border: `1px solid ${tk.border}`,
        textDecoration: "none", color: tk.text, fontSize: 11, maxWidth: 120,
      }}>
      {isImage
        ? <img src={f.url} alt={f.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }} />
        : isVideo
        ? <div style={{ position: "relative", width: 56, height: 56 }}>
            <video src={`${f.url}#t=0.5`} muted playsInline preload="metadata" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4, background: tk.surface, display: "block" }} />
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, textShadow: "0 1px 3px rgba(0,0,0,0.7)", pointerEvents: "none" }}>▶</span>
          </div>
        : <div style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, background: tk.surface, fontSize: 22, color: tk.textMute }}>📄</div>
      }
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>{f.name}</span>
      <span
        onClick={isMedia ? (e) => {
          e.preventDefault(); e.stopPropagation();
          const a = document.createElement("a");
          a.href = mlDownloadUrl(f); a.download = f.name || "file";
          document.body.appendChild(a); a.click(); a.remove();
        } : undefined}
        style={{ color: tk.accent, fontSize: 10, letterSpacing: "0.05em" }}
      >Download ↓</span>
    </a>
    {preview && <MediaLightbox file={f} tk={tk} onClose={() => setPreview(false)} />}
  </>);
}

function renderSubmittedInfo(t, tk) {
  const rows = [];
  rows.push(["Academy", t.academyName]);
  rows.push(["Campaign", t.campaignTitle]);

  // Helper to render a download grid for the attached final creatives
  const filesGrid = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {(t.files || []).map((f, i) => <SubmittedFileTile key={i} f={f} tk={tk} />)}
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
    // Finals from the content team land in `files` via send-to-marketing -
    // without this row campaign-create tickets HID their attached creatives
    // (replace/add always showed them; this branch never did).
    rows.push(["Final creatives", t.files && t.files.length ? filesGrid : <span style={{ color: tk.textMute }}>None attached yet - content team hasn't sent finals</span>]);
  } else if (t.type === "budget-review") {
    const cb = Array.isArray(t.confirmedBudgets) ? t.confirmedBudgets : [];
    if (cb.length) {
      const total = cb.reduce((s, b) => s + (Number(b.confirmed) || 0), 0);
      rows.push(["Client confirmed", (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {cb.map((b, i) => {
            const cur = b.current == null || b.current === "" ? null : Number(b.current);
            const conf = b.confirmed == null || b.confirmed === "" ? null : Number(b.confirmed);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                <span style={{ color: tk.text, fontWeight: 600, minWidth: 150 }}>{b.name || "Campaign"}</span>
                <span style={{ color: tk.textMute }}>{cur != null ? `$${cur}/mo` : "-"}</span>
                <span style={{ color: tk.textMute }}>→</span>
                <span style={{ color: b.changed ? tk.accent : tk.text, fontWeight: 600 }}>{conf != null ? `$${conf}/mo` : "-"}</span>
                {b.changed ? <span style={{ fontSize: 10, color: tk.accent, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>changed</span> : null}
              </div>
            );
          })}
        </div>
      )]);
      rows.push(["Total confirmed", <span style={{ color: tk.accent, fontWeight: 600 }}>{`$${total}/mo`}</span>]);
    } else {
      rows.push(["Client confirmed", <span style={{ color: tk.textMute }}>Not confirmed yet</span>]);
    }
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

  // Client's original notes (passed through from the content ticket when content
  // team hit "Send to Marketing"). Surfaces what the academy actually said.
  if (t.clientNotes) {
    rows.push(["Client said", (
      <div style={{
        background: "rgba(232,197,71,0.06)",
        borderLeft: `3px solid ${tk.accent}`,
        padding: "10px 12px",
        borderRadius: 6,
        fontStyle: "italic",
        whiteSpace: "pre-wrap",
      }}>{t.clientNotes}</div>
    )]);
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
