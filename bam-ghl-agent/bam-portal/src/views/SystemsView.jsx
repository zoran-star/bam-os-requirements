import { useState, useEffect, useCallback } from "react";
import {
  fetchTickets,
  fetchTicket,
  fetchDelegationPool,
  delegateTicket,
  startTicket,
  saveTicketNotes,
  requestClientAction,
  cancelClientRequest,
  submitForReview,
  saveUserGuide,
  approveTicket,
  denyTicket,
  cancelTicket,
  saveTicketFields,
  setTicketDueDate,
  sendForFinalReview,
} from "../services/ticketsService";
import { supabase } from "../lib/supabase";

const STATUS_LABEL = {
  open:             "New",
  delegated:        "Delegated",
  in_progress:      "In progress",
  awaiting_client:  "Awaiting client",
  in_review:        "In review",
  final_review:     "Final review",
  needs_rework:     "Needs rework",
  approved:         "Approved",
  done:             "Done",
  cancelled:        "Cancelled",
};

function statusColor(status, t) {
  switch (status) {
    case "open":             return t.amber;
    case "delegated":        return t.blue;
    case "in_progress":      return t.accent;
    case "awaiting_client":  return t.amber;
    case "in_review":        return t.blue;
    case "final_review":     return t.amber;
    case "needs_rework":     return t.red;
    case "approved":
    case "done":             return t.green;
    case "cancelled":        return t.textMute;
    default:                 return t.textMute;
  }
}

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Relative day count for completed tickets: "Today", "Yesterday",
// "N days ago". Compares calendar days, not 24h windows, so a ticket
// finished late last night reads "Yesterday" not "Today".
function relativeDays(s) {
  if (!s) return "";
  const then = new Date(s); then.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((now.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// Number of business days from a date (Mon=1..Fri=5 — skips Sat/Sun).
function addBusinessDays(start, n) {
  const d = new Date(start);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}
function biz(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysBetween(a, b) {
  return Math.round((biz(b).getTime() - biz(a).getTime()) / 86400000);
}

export default function SystemsView({ tokens: t, dark, me, session }) {
  const isManager = me?.role === "admin" || me?.role === "systems_manager";
  const defaultTab = isManager ? "overview" : "ongoing";

  const [tab, setTab] = useState(defaultTab);
  const [tickets, setTickets] = useState([]);
  const [pool, setPool] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [ticketsRes, poolRes] = await Promise.all([
      fetchTickets(),
      fetchDelegationPool(),
    ]);
    if (ticketsRes.data) setTickets(ticketsRes.data);
    if (poolRes.data) setPool(poolRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime: auto-refresh the ticket list whenever any tickets row
  // changes (new ticket, status flip, delegation, client reply). No
  // more manual refresh needed.
  useEffect(() => {
    const channel = supabase
      .channel("systems:tickets")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // One scoping rule for everyone: managers see all tickets in a tab,
  // executors only see tickets assigned to them.
  const inScope = (x) => isManager || x.assigned_to === me?.id;
  // Managers also see open (un-delegated) tickets in Lobby so they can
  // delegate from the row's modal; executors only see their own delegated
  // tickets waiting to start.
  const lobbyStatuses = isManager ? ["open","delegated"] : ["delegated"];
  const visibleTickets = tickets.filter(x => {
    if (tab === "lobby")     return lobbyStatuses.includes(x.status) && inScope(x);
    if (tab === "ongoing")   return ["in_progress","needs_rework"].includes(x.status) && inScope(x);
    if (tab === "awaiting")  return ["awaiting_client","final_review"].includes(x.status) && inScope(x);
    if (tab === "review")    return x.status === "in_review" && inScope(x);
    if (tab === "completed") return ["done","approved","cancelled"].includes(x.status) && inScope(x);
    return false;
  });

  // Shared tab structure. Managers additionally get an Overview tab at
  // the front. Counts reuse the same scope as visibleTickets above
  // (managers see all, executors only their own).
  const tabs = [
    ...(isManager ? [{ key: "overview", label: "Overview" }] : []),
    { key: "lobby",     label: "Lobby",           count: tickets.filter(x => lobbyStatuses.includes(x.status) && inScope(x)).length },
    { key: "ongoing",   label: "Ongoing",         count: tickets.filter(x => ["in_progress","needs_rework"].includes(x.status) && inScope(x)).length },
    { key: "awaiting",  label: "Awaiting client", count: tickets.filter(x => ["awaiting_client","final_review"].includes(x.status) && inScope(x)).length },
    { key: "review",    label: "In review",       count: tickets.filter(x => x.status === "in_review" && inScope(x)).length },
    { key: "completed", label: "Completed",       count: tickets.filter(x => ["done","approved","cancelled"].includes(x.status) && inScope(x)).length },
  ];

  return (
    <div style={{ padding: "28px 32px" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: `1px solid ${t.border}` }}>
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            padding: "12px 20px", border: "none", background: "transparent",
            color: tab === tb.key ? t.text : t.textMute,
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            borderBottom: `2px solid ${tab === tb.key ? t.accent : "transparent"}`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {tb.label}
            {tb.count > 0 && (
              <span style={{
                background: tab === tb.key ? t.accent : t.borderMed,
                color: tab === tb.key ? "#000" : t.textMute,
                borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 700,
              }}>{tb.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          tickets={tickets}
          loading={loading}
          tokens={t}
          dark={dark}
          onOpenTicket={(x) => setSelected(x)}
          onJumpToTab={(k) => setTab(k)}
        />
      ) : (
        <>
          {loading && <div style={{ color: t.textMute, fontSize: 14 }}>Loading tickets…</div>}

          {!loading && visibleTickets.length === 0 && (
            <div style={{ color: t.textMute, fontSize: 14, padding: "40px 0", textAlign: "center" }}>
              No tickets in this tab.
            </div>
          )}

          {/* Managers get an assignee-grouped view on any multi-person tab.
              Executors only see their own tickets, so grouping is redundant. */}
          {isManager && ["lobby","ongoing","awaiting","review"].includes(tab) && visibleTickets.length > 0 ? (
            (() => {
              const groups = {};
              visibleTickets.forEach(x => {
                const name = x.assignee?.name || "Unassigned";
                (groups[name] = groups[name] || []).push(x);
              });
              const names = Object.keys(groups).sort((a, b) => {
                if (a === "Unassigned") return 1;
                if (b === "Unassigned") return -1;
                return a.localeCompare(b);
              });
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {names.map(name => (
                    <div key={name}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5 }}>{name}</span>
                        <span style={{ fontSize: 11, color: t.textMute, background: t.surface, padding: "2px 8px", borderRadius: 10 }}>{groups[name].length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {groups[name].map(x => (
                          <TicketCard key={x.id} ticket={x} tokens={t} onOpen={() => setSelected(x)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleTickets.map(x => (
                <TicketCard key={x.id} ticket={x} tokens={t} onOpen={() => setSelected(x)} completed={tab === "completed"} />
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <TicketModal
          ticket={selected}
          me={me}
          isManager={isManager}
          pool={pool}
          tokens={t}
          dark={dark}
          onClose={() => setSelected(null)}
          // Don't auto-close on action. The modal updates in-place
          // (status pill, action bar swap) so the user can see their
          // click took effect. They close manually with the Close
          // button when they're done.
          onAction={async () => { await load(); }}
        />
      )}
    </div>
  );
}

// Overview tab — managers/admins only. Three stat tiles at top, then
// CLIENT ACTIONS (awaiting_client status, grouped by client, newest at
// top), then TIMELINE SENSITIVE (urgent OR overdue OR due within 2
// business days, sorted most overdue → nearest due).
function OverviewTab({ tickets, loading, tokens: t, dark, onOpenTicket, onJumpToTab }) {
  // "Completed in the last 5 days" — done/approved/cancelled tickets whose
  // resolved_at lands within the trailing 5-day window. Clicking jumps to
  // the Completed tab (which shows the full archive).
  const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const completedLast5 = tickets.filter(x =>
    ["done","approved","cancelled"].includes(x.status) &&
    x.resolved_at && new Date(x.resolved_at).getTime() >= fiveDaysAgo.getTime()
  ).length;

  const tileData = [
    { key: "lobby",    label: "tickets in lobby",   count: tickets.filter(x => ["open","delegated"].includes(x.status)).length },
    { key: "ongoing",  label: "tickets ongoing",    count: tickets.filter(x => ["in_progress","needs_rework"].includes(x.status)).length },
    { key: "review",   label: "tickets in review",  count: tickets.filter(x => x.status === "in_review").length },
    { key: "completed", label: "completed last 5 days", count: completedLast5 },
  ];

  // Timeline-sensitive predicate — used both to filter the Timeline
  // section AND to flag client-action rows that also qualify, so we can
  // surface a "TIMELINE SENSITIVE" pill on them instead of duplicating.
  const today = new Date(); today.setHours(0,0,0,0);
  const twoBizDaysOut = addBusinessDays(today, 2);
  const isTimelineSensitive = (x) => {
    if (["done","approved","cancelled"].includes(x.status)) return false;
    if (x.priority === "urgent") return true;
    if (!x.due_date) return false;
    const due = new Date(x.due_date + "T00:00:00");
    return due.getTime() <= twoBizDaysOut.getTime();
  };

  const clientActionTickets = tickets
    .filter(x => x.status === "awaiting_client")
    .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

  // Group client actions by client business_name
  const clientGroups = {};
  clientActionTickets.forEach(x => {
    const name = x.client?.business_name || "Unknown client";
    (clientGroups[name] = clientGroups[name] || []).push(x);
  });
  const clientNames = Object.keys(clientGroups).sort();

  // Tickets already shown under Client Actions are excluded here — we
  // surface their urgency via a "TIMELINE SENSITIVE" pill on the client
  // action row instead.
  const clientActionIds = new Set(clientActionTickets.map(x => x.id));
  const timelineTickets = tickets
    .filter(x => isTimelineSensitive(x) && !clientActionIds.has(x.id))
    .sort((a, b) => {
      // Most overdue first, then nearest due, urgent-no-date last.
      const ad = a.due_date ? new Date(a.due_date + "T00:00:00").getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date + "T00:00:00").getTime() : Infinity;
      return ad - bd;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {tileData.map(tile => (
          <button
            key={tile.key}
            onClick={() => onJumpToTab(tile.key)}
            style={{
              padding: "28px 20px",
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "center",
              transition: "border-color 140ms, background 140ms",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; }}
          >
            <div style={{ fontSize: 38, fontWeight: 700, color: t.text, letterSpacing: "-0.02em" }}>
              {tile.count}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>
              {tile.label}
            </div>
          </button>
        ))}
      </div>

      {/* CLIENT ACTIONS */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: t.text, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>
            {clientActionTickets.length} Client Action{clientActionTickets.length === 1 ? "" : "s"}
          </h2>
          <span style={{ fontSize: 12, color: t.textMute }}>grouped by client · newest at top</span>
        </div>
        {loading && <div style={{ color: t.textMute, fontSize: 14 }}>Loading…</div>}
        {!loading && clientActionTickets.length === 0 && (
          <div style={{ color: t.textMute, fontSize: 13, padding: "20px 0", fontStyle: "italic" }}>
            No tickets awaiting client action.
          </div>
        )}
        {clientNames.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {clientNames.map(name => (
              <div key={name}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  {name}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {clientGroups[name].map(x => (
                    <OverviewRow
                      key={x.id} ticket={x} tokens={t} dark={dark} variant="action"
                      onClick={() => onOpenTicket(x)}
                      timelineSensitive={isTimelineSensitive(x)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TIMELINE SENSITIVE */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: t.text, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>
            Timeline Sensitive
          </h2>
          <span style={{ fontSize: 12, color: t.textMute }}>urgent · overdue · due within 2 business days</span>
        </div>
        {!loading && timelineTickets.length === 0 && (
          <div style={{ color: t.textMute, fontSize: 13, padding: "20px 0", fontStyle: "italic" }}>
            Nothing urgent or due soon.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {timelineTickets.map(x => (
            <OverviewRow
              key={x.id} ticket={x} tokens={t} dark={dark} variant="urgent"
              onClick={() => onOpenTicket(x)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// One row in the Overview lists. Variant 'action' is plain; 'urgent' is
// red-tinted with a due-date column instead of submission date.
// timelineSensitive (only set on 'action' variant) renders a small red
// "Timeline sensitive" pill next to the title so we can dedup the row
// from the Timeline Sensitive section while keeping the urgency visible.
function OverviewRow({ ticket, tokens: t, dark, onClick, variant, timelineSensitive }) {
  const title = ticket.menu_item
    || (ticket.type === "error" ? "Error report" : ticket.type === "change" ? "Change request" : "Build request");
  const clientName = ticket.client?.business_name || "Unknown";
  const isUrgent = variant === "urgent";
  const redBg = dark ? "rgba(232,117,96,0.08)" : "rgba(232,117,96,0.10)";
  const redBorder = `${t.red || "#ED7969"}55`;

  // Date column: submission date for 'action', due_date label for 'urgent'.
  let dateLabel = "";
  let dateColor = t.textMute;
  if (isUrgent) {
    if (ticket.priority === "urgent" && !ticket.due_date) {
      dateLabel = "🔴 Urgent";
      dateColor = t.red || "#ED7969";
    } else if (ticket.due_date) {
      const today = new Date(); today.setHours(0,0,0,0);
      const due = new Date(ticket.due_date + "T00:00:00");
      const diff = daysBetween(today, due);
      const datePart = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      if (diff < 0)       dateLabel = `${datePart} · ${Math.abs(diff)}d overdue`;
      else if (diff === 0) dateLabel = `${datePart} · today`;
      else if (diff === 1) dateLabel = `${datePart} · tomorrow`;
      else                 dateLabel = `${datePart} · in ${diff}d`;
      dateColor = diff < 0 ? (t.red || "#ED7969") : t.text;
    }
  } else {
    const d = ticket.submitted_at ? new Date(ticket.submitted_at) : null;
    dateLabel = d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "";
  }

  return (
    <button
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr 160px",
        gap: 16,
        alignItems: "center",
        padding: "14px 16px",
        background: isUrgent ? redBg : t.surface,
        border: `1px solid ${isUrgent ? redBorder : t.border}`,
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "background 140ms",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = isUrgent ? (dark ? "rgba(232,117,96,0.13)" : "rgba(232,117,96,0.16)") : t.bg; }}
      onMouseLeave={e => { e.currentTarget.style.background = isUrgent ? redBg : t.surface; }}
    >
      <div style={{ fontSize: 13, color: t.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientName}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {timelineSensitive && (
          <span style={{
            flexShrink: 0,
            fontSize: 10, fontWeight: 700,
            color: t.red || "#ED7969",
            textTransform: "uppercase", letterSpacing: 0.5,
            padding: "2px 8px", borderRadius: 999,
            background: `${t.red || "#ED7969"}15`,
            border: `1px solid ${t.red || "#ED7969"}40`,
            whiteSpace: "nowrap",
          }}>Timeline sensitive</span>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: dateColor, textAlign: "right" }}>{dateLabel}</div>
    </button>
  );
}

function TicketCard({ ticket, tokens: t, onOpen, completed }) {
  const title = ticket.menu_item
    || (ticket.type === "error" ? "Error report" : ticket.type === "change" ? "Change request" : "Build request");
  const preview = Object.values(ticket.fields || {}).filter(Boolean).join(" · ").slice(0, 120);
  // On the Completed tab, surface the completion date (resolved_at) large
  // on the right so staff can scan "what got finished and when" at a glance.
  const showCompletedDate = completed && ticket.resolved_at;
  return (
    <div onClick={onOpen} style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: "16px 20px", cursor: "pointer", transition: "border-color 0.2s",
      display: "flex", alignItems: "center", gap: 20,
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = t.borderMed}
      onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          {ticket.priority === "urgent" && <span style={{ fontSize: 11, fontWeight: 700, color: t.red }}>🔴 URGENT</span>}
          {!showCompletedDate && <span style={{ fontSize: 12, color: t.textMute, marginLeft: "auto" }}>{formatDate(ticket.submitted_at)}</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: t.textMute, marginBottom: 8 }}>
          {ticket.client?.business_name || "Unknown client"}
          {ticket.assignee && <> · assigned to <b style={{ color: t.textSub }}>{ticket.assignee.name}</b></>}
        </div>
        {preview && <div style={{ fontSize: 13, color: t.textSub, lineHeight: 1.4 }}>{preview}</div>}
      </div>
      {showCompletedDate && (
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            Completed
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>
            {relativeDays(ticket.resolved_at)}
          </div>
        </div>
      )}
    </div>
  );
}

export function TicketModal({ ticket: initial, me, isManager, pool, tokens: t, dark, onClose, onAction }) {
  const [ticket, setTicket] = useState(initial);
  const [notes, setNotes] = useState(initial.staff_notes || "");
  const [userGuide, setUserGuide] = useState(initial.user_guide || "");
  const [clientRequest, setClientRequest] = useState("");
  const [denyNotes, setDenyNotes] = useState("");
  const [assignee, setAssignee] = useState(initial.assigned_to || "");
  const [showDeny, setShowDeny] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [fieldEdits, setFieldEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [questionMap, setQuestionMap] = useState({});

  // Auto-refresh the ticket from the server when the modal opens, so we
  // pick up any client responses that landed after the list was loaded.
  // Without this, staff sees a stale snapshot and misses new messages.
  useEffect(() => {
    let cancelled = false;
    fetchTicket(initial.id).then(res => {
      if (cancelled) return;
      if (res?.data) {
        setTicket(res.data);
        setNotes(res.data.staff_notes || "");
        setUserGuide(res.data.user_guide || "");
        setAssignee(res.data.assigned_to || "");
      }
    });
    return () => { cancelled = true; };
  }, [initial.id]);

  // Resolve field UUIDs → question text from Questions Database.
  // Some keys are non-UUIDs (e.g. "<uuid>_custom" for free-text "other"
  // answers). Including those in `.in("id", …)` would fail the whole
  // query (Postgres can't cast _custom to uuid). Filter to canonical
  // UUIDs first; non-UUID keys still render with a friendly fallback.
  useEffect(() => {
    const allKeys = Object.keys(ticket.fields || {});
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = allKeys.filter(k => UUID_RE.test(k));
    if (!ids.length) { setQuestionMap({}); return; }
    let cancelled = false;
    supabase
      .from("Questions Database")
      .select('id, "Question"')
      .in("id", ids.map(s => s.toLowerCase()))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("Questions DB lookup failed:", error.message); return; }
        const map = {};
        (data || []).forEach(r => { map[r.id] = r.Question; });
        // Also key by the original (possibly mixed-case) form so render lookup hits
        const byOriginal = {};
        ids.forEach(orig => { byOriginal[orig] = map[orig.toLowerCase()]; });
        setQuestionMap(byOriginal);
      });
    return () => { cancelled = true; };
  }, [ticket.id]);

  const canExec = isManager || ticket.assigned_to === me?.id;
  // Any systems team member (manager or executor) can interact with clients
  // — request action, cancel a request — regardless of who the ticket is
  // assigned to. Other actions (start, submit, approve, deny) stay
  // assignee/manager gated.
  const canClientComm = !!me;

  const wrap = async (fn) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res?.data) {
      setTicket(res.data);
      await onAction();
    } else if (res?.error) {
      alert(res.error);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: dark ? "rgba(0,0,0,0.80)" : "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, backdropFilter: "blur(12px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 820, maxHeight: "88vh",
        background: t.surface, borderRadius: 20,
        border: `1px solid ${t.borderMed}`,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            {(() => {
              const sc = statusColor(ticket.status, t);
              return (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: sc,
                  textTransform: "uppercase", letterSpacing: 0.7,
                  padding: "4px 10px", borderRadius: 999,
                  border: `1px solid ${sc}55`,
                  background: `${sc}15`,
                }}>
                  {STATUS_LABEL[ticket.status] || ticket.status}
                </span>
              );
            })()}
            {ticket.priority === "urgent" && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: t.red,
                textTransform: "uppercase", letterSpacing: 0.7,
                padding: "4px 10px", borderRadius: 999,
                border: `1px solid ${t.red}55`,
                background: `${t.red}15`,
              }}>🔴 URGENT</span>
            )}
            <span style={{ fontSize: 11, color: t.textMute, fontFamily: "monospace", marginLeft: "auto" }}>{ticket.id.slice(0, 8)}</span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: t.text, margin: 0 }}>
            {ticket.menu_item || (ticket.type === "error" ? "Error report" : ticket.type === "change" ? "Change request" : "Build request")}
          </h2>
          <div style={{ display: "flex", gap: 14, fontSize: 13, color: t.textMute, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span>{ticket.client?.business_name || "Unknown client"}</span>
            <span>Submitted {formatDate(ticket.submitted_at)}</span>
            {ticket.assignee && <span>Assigned to {ticket.assignee.name}</span>}
            {/* Due date — admin can edit, everyone else sees the value. */}
            {me?.role === "admin" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>Due</span>
                <input
                  type="date"
                  value={ticket.due_date || ""}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => wrap(() => setTicketDueDate(ticket.id, e.target.value))}
                  disabled={busy}
                  style={{
                    background: t.surface, border: `1px solid ${t.border}`, borderRadius: 6,
                    padding: "3px 6px", fontSize: 12, color: t.text, fontFamily: "inherit",
                    colorScheme: dark ? "dark" : "light",
                  }}
                />
              </label>
            ) : ticket.due_date && (
              <span>Due {new Date(ticket.due_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Submission fields — editable, gated to non-terminal statuses */}
          {(() => {
            const fieldsLocked = ["done", "approved", "cancelled"].includes(ticket.status);
            const hasFieldEdits = Object.keys(fieldEdits).length > 0;
            const currentFieldValue = (k) =>
              Object.prototype.hasOwnProperty.call(fieldEdits, k) ? fieldEdits[k] : (ticket.fields || {})[k];
            return (
              <Section title="Submission" tokens={t}>
                {Object.entries(ticket.fields || {}).map(([k, v]) => {
                  // Resolve label: real question text > custom-answer hint > raw key
                  let label = questionMap[k];
                  if (!label && k.endsWith("_custom")) {
                    const baseId = k.slice(0, -"_custom".length);
                    const base = questionMap[baseId];
                    label = base ? `${base} (other)` : "Other (custom answer)";
                  }
                  if (!label) label = k;
                  return (
                    <EditableRow
                      key={k}
                      label={label}
                      value={currentFieldValue(k)}
                      originalValue={v}
                      onChange={(nv) => setFieldEdits(prev => ({ ...prev, [k]: nv }))}
                      disabled={fieldsLocked}
                      tokens={t}
                    />
                  );
                })}
                {(ticket.files || []).length > 0 && (
                  <Row label="Files" tokens={t} value={
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {ticket.files.map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ color: t.accent, fontSize: 13, textDecoration: "none" }}>
                          📎 {f.name}
                        </a>
                      ))}
                    </div>
                  } />
                )}
                {/* Save bar: only shows when there are edits */}
                {hasFieldEdits && !fieldsLocked && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={async () => {
                        await wrap(() => saveTicketFields(ticket.id, fieldEdits));
                        setFieldEdits({});
                      }}
                      disabled={busy}
                      style={btn(t, "primary")}
                    >{busy ? "Saving…" : "Save changes"}</button>
                    <button
                      onClick={() => setFieldEdits({})}
                      disabled={busy}
                      style={btn(t, "ghost")}
                    >Discard</button>
                    <span style={{ fontSize: 12, color: t.textMute }}>
                      {Object.keys(fieldEdits).length} field{Object.keys(fieldEdits).length === 1 ? "" : "s"} edited
                    </span>
                  </div>
                )}
              </Section>
            );
          })()}

          {/* Denial notes (visible when rework) */}
          {ticket.denial_notes && ticket.status === "needs_rework" && (
            <Section title="⚠️ Denial feedback" tokens={t}>
              <div style={{ background: dark ? "rgba(232,117,96,0.08)" : "rgba(232,117,96,0.1)", border: `1px solid ${t.red}33`, borderRadius: 8, padding: 12, fontSize: 13, color: t.text, whiteSpace: "pre-wrap" }}>
                {ticket.denial_notes}
              </div>
            </Section>
          )}

          {/* Client action thread (multi-round) */}
          {((ticket.messages || []).length > 0 || ticket.client_action_request || ticket.client_action_response) && (
            <Section title="Client conversation" tokens={t}>
              {ticket.status === "awaiting_client" && canClientComm && (
                <div style={{ marginBottom: 12, padding: 10, background: dark ? "rgba(232,191,96,0.08)" : "rgba(232,191,96,0.12)", border: `1px solid ${t.accent}33`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>⏳ Awaiting client response</div>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => cancelClientRequest(ticket.id))} disabled={busy} style={btn(t, "ghost")}>Cancel request</button>
                </div>
              )}
              {(ticket.messages && ticket.messages.length > 0)
                ? ticket.messages.map((m, i) => (
                    <div key={i} style={{
                      marginBottom: 10, padding: 10, borderRadius: 8,
                      background: m.direction === "client_to_staff"
                        ? (dark ? "rgba(120,200,140,0.08)" : "rgba(120,200,140,0.12)")
                        : (dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"),
                      border: `1px solid ${m.direction === "client_to_staff" ? "rgba(120,200,140,0.25)" : t.border}`,
                    }}>
                      <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, marginBottom: 4 }}>
                        {m.direction === "client_to_staff" ? "CLIENT REPLIED" : "STAFF ASKED"}
                        {m.system && " · system"}
                        {" · "}{new Date(m.created_at).toLocaleString()}
                      </div>
                      {m.body && <div style={{ fontSize: 13, color: t.text, whiteSpace: "pre-wrap" }}>{m.body}</div>}
                      {(m.files || []).map((f, j) => (
                        <a key={j} href={f.url} target="_blank" rel="noreferrer" style={{ color: t.accent, fontSize: 13, display: "block", marginTop: 4 }}>📎 {f.name}</a>
                      ))}
                    </div>
                  ))
                : (
                    <>
                      {ticket.client_action_request && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, marginBottom: 4 }}>STAFF ASKED</div>
                          <div style={{ fontSize: 13, color: t.text, whiteSpace: "pre-wrap" }}>{ticket.client_action_request}</div>
                        </div>
                      )}
                      {ticket.client_action_response && (
                        <div>
                          <div style={{ fontSize: 11, color: t.textMute, fontWeight: 600, marginBottom: 4 }}>CLIENT REPLIED</div>
                          <div style={{ fontSize: 13, color: t.text, whiteSpace: "pre-wrap" }}>{ticket.client_action_response}</div>
                          {(ticket.client_action_files || []).map((f, i) => (
                            <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ color: t.accent, fontSize: 13, display: "block", marginTop: 4 }}>📎 {f.name}</a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
            </Section>
          )}

          {/* Notes */}
          <Section title="Notes" tokens={t}>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => notes !== ticket.staff_notes && wrap(() => saveTicketNotes(ticket.id, notes))}
              placeholder="Scratchpad for the systems team…"
              style={{
                width: "100%", minHeight: 90, padding: 12,
                background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
              }}
            />
          </Section>

          {/* User guide — managers and assigned executors can edit until the ticket is done */}
          {(isManager || ticket.status === "in_progress" || ticket.status === "needs_rework" || ticket.status === "in_review" || ticket.status === "done") && (
            <Section title="User guide (shown to client on completion)" tokens={t}>
              <textarea
                value={userGuide}
                onChange={e => setUserGuide(e.target.value)}
                onBlur={() => userGuide !== (ticket.user_guide || "") && wrap(() => saveUserGuide(ticket.id, userGuide))}
                disabled={!isManager && (ticket.status === "done" || !canExec)}
                placeholder="Explain to the client what happens in their GHL…"
                style={{
                  width: "100%", minHeight: 80, padding: 12,
                  background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                  color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
                  opacity: ticket.status === "done" ? 0.7 : 1,
                }}
              />
            </Section>
          )}

          {/* Request client action form */}
          {showRequest && (
            <Section title="Ask client something" tokens={t}>
              <textarea
                value={clientRequest}
                onChange={e => setClientRequest(e.target.value)}
                placeholder="What do you need from the client?"
                style={{
                  width: "100%", minHeight: 80, padding: 12,
                  background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                  color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowRequest(false)} style={btn(t, "ghost")}>Cancel</button>
                <button disabled={!clientRequest.trim() || busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => requestClientAction(ticket.id, clientRequest))} style={btn(t, "primary")}>Send to client</button>
              </div>
            </Section>
          )}

          {/* Deny form */}
          {showDeny && (
            <Section title="Denial feedback" tokens={t}>
              <textarea
                value={denyNotes}
                onChange={e => setDenyNotes(e.target.value)}
                placeholder="What needs to change before approval?"
                style={{
                  width: "100%", minHeight: 80, padding: 12,
                  background: t.bg, border: `1px solid ${t.red}55`, borderRadius: 8,
                  color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowDeny(false)} style={btn(t, "ghost")}>Cancel</button>
                <button disabled={!denyNotes.trim() || busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => denyTicket(ticket.id, denyNotes))} style={btn(t, "danger")}>Deny & send back</button>
              </div>
            </Section>
          )}
        </div>

        {/* Action bar */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 8, flexWrap: "wrap", background: t.bg }}>
          {/* Manager: delegate / reassign — available on any non-final status */}
          {isManager && !["done","approved"].includes(ticket.status) && (
            <>
              <select
                value={assignee}
                onChange={e => setAssignee(e.target.value)}
                style={{ padding: "8px 12px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13 }}
              >
                <option value="">Choose executor…</option>
                {(pool || []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.role === "systems_manager" ? "Mgr" : "Exec"})</option>)}
              </select>
              <button disabled={!assignee || busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => delegateTicket(ticket.id, assignee))} style={btn(t, "primary")}>
                {ticket.status === "open" ? "Delegate" : "Reassign"}
              </button>
              {ticket.status === "open" && (
                <button disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => delegateTicket(ticket.id, me.id))} style={btn(t, "ghost")}>Self-assign</button>
              )}
            </>
          )}

          {/* Executor: start */}
          {ticket.status === "delegated" && canExec && (
            <button disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => startTicket(ticket.id))} style={btn(t, "primary")}>Start work</button>
          )}

          {/* Anyone on systems team: request client action (works on any
              non-final status, including while already awaiting_client —
              supports multiple pending requests) */}
          {canClientComm && !["done","approved","in_review"].includes(ticket.status) && !showRequest && (
            <button disabled={busy} onClick={() => setShowRequest(true)} style={btn(t, "ghost")}>
              {ticket.status === "awaiting_client" ? "Add another request" : "Request client action"}
            </button>
          )}

          {/* Executor: submit for review (assignee/manager only).
              onMouseDown preventDefault keeps the user guide textarea from
              blurring → avoids a race where the blur autosave disables this
              button before the click registers. submitForReview already
              includes user_guide in its payload. */}
          {canExec && (ticket.status === "in_progress" || ticket.status === "needs_rework") && (
            <button
              disabled={busy}
              onMouseDown={e => e.preventDefault()}
              onClick={() => wrap(() => submitForReview(ticket.id, userGuide))}
              style={btn(t, "primary")}
            >Submit for review</button>
          )}

          {/* Manager: approve / deny / send-for-final-review on in_review */}
          {isManager && ticket.status === "in_review" && (
            <>
              <button disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => approveTicket(ticket.id))} style={btn(t, "primary")}>Approve</button>
              <button disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => wrap(() => sendForFinalReview(ticket.id))} style={btn(t, "primary")} title="Send to client for final sign-off">Mark complete for review</button>
              {!showDeny && <button disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => setShowDeny(true)} style={btn(t, "danger-ghost")}>Deny</button>}
            </>
          )}

          {/* Manager: mark complete on any non-terminal, non-in_review
              status. Same underlying action as Approve, different label
              since there's nothing to approve here. */}
          {isManager && !["done","approved","cancelled","in_review"].includes(ticket.status) && (
            <button
              disabled={busy}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { if (confirm("Mark this ticket complete?")) wrap(() => approveTicket(ticket.id)); }}
              style={btn(t, "primary")}
            >✓ Mark complete</button>
          )}

          {/* Cancel ticket — any systems staff can cancel at any non-final
              status (i.e. not done/approved/cancelled). Pushed to the right
              edge next to Close so it's discoverable but not the primary
              action. */}
          {!["done", "approved", "cancelled"].includes(ticket.status) && (
            <button
              onClick={() => { setCancelReason(""); setShowCancel(true); }}
              disabled={busy}
              style={{ ...btn(t, "danger-ghost"), marginLeft: "auto" }}
            >Cancel ticket</button>
          )}
          <button
            onClick={onClose}
            style={{
              ...btn(t, "ghost"),
              ...(["done", "approved", "cancelled"].includes(ticket.status) ? { marginLeft: "auto" } : {}),
            }}
          >Close</button>
        </div>

        {/* Cancel-ticket confirmation modal */}
        {showCancel && (
          <div
            onClick={() => !busy && setShowCancel(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 1100,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: 460,
                background: t.surface, border: `1px solid ${t.borderMed || t.border}`,
                borderRadius: 16, padding: 28,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: t.text, marginBottom: 6 }}>Cancel this ticket?</div>
              <div style={{ fontSize: 13, color: t.textSub, marginBottom: 18 }}>
                This marks the ticket as cancelled and removes it from your active queue. It can't be reopened.
              </div>

              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                Reason (optional)
              </label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Why is this being cancelled? Appears in the audit log."
                style={{
                  width: "100%", minHeight: 80, padding: 12,
                  background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                  color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
                  marginBottom: 18,
                }}
              />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => setShowCancel(false)} disabled={busy} style={btn(t, "ghost")}>Keep ticket</button>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={async () => {
                    await wrap(() => cancelTicket(ticket.id, cancelReason));
                    setShowCancel(false);
                  }}
                  disabled={busy}
                  style={btn(t, "danger")}
                >{busy ? "Cancelling…" : "Cancel ticket"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, tokens: t }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, tokens: t }) {
  // Coerce to a renderable form: strings/numbers pass through, React
  // elements pass through, arrays/objects get readable serialization,
  // null/undefined render as em-dash.
  let rendered;
  if (value == null || value === "") {
    rendered = <span style={{ color: t.textMute }}>—</span>;
  } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    rendered = String(value);
  } else if (typeof value === "object" && !Array.isArray(value) && value.$$typeof) {
    // React element (has $$typeof) — render as-is
    rendered = value;
  } else if (Array.isArray(value)) {
    rendered = value.filter(v => v != null && v !== "").map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(", ");
  } else {
    // Plain object — render as comma-separated key/value or JSON
    const truthy = Object.entries(value).filter(([, v]) => v && v !== false).map(([k]) => k);
    rendered = truthy.length ? truthy.join(", ") : JSON.stringify(value);
  }
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ minWidth: 220, fontSize: 13, fontWeight: 500, color: t.textSub }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: t.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {rendered}
      </div>
    </div>
  );
}

// Submission row that lets staff edit the value. Decides between a
// single-line input vs a multi-line textarea based on the current
// content (any newline or > 60 chars → textarea). Complex values
// (objects/arrays that aren't simple lists) fall back to read-only —
// editing those structurally would need a richer UI.
function EditableRow({ label, value, originalValue, onChange, disabled, tokens: t }) {
  const isEdited = value !== originalValue;
  const isPlainString = value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  const isStringArray = Array.isArray(value) && value.every(v => v == null || typeof v === "string" || typeof v === "number");

  // Coerce to a string for the input
  const stringValue = value == null
    ? ""
    : isStringArray ? value.filter(v => v != null && v !== "").join(", ")
    : typeof value === "object" ? JSON.stringify(value, null, 2)
    : String(value);

  const isComplex = !isPlainString && !isStringArray;
  const useTextarea = stringValue.includes("\n") || stringValue.length > 60;

  const emit = (raw) => {
    // Empty string → null (matches the rest of the codebase's normalization)
    if (raw === "") return onChange(null);
    // String array → split back to array
    if (isStringArray) return onChange(raw.split(",").map(s => s.trim()).filter(Boolean));
    onChange(raw);
  };

  const baseInputStyle = {
    width: "100%", padding: "8px 10px",
    background: t.bg, border: `1px solid ${isEdited ? t.accent : t.border}`,
    borderRadius: 6, color: t.text, fontSize: 13,
    fontFamily: "inherit", outline: "none",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ minWidth: 220, fontSize: 13, fontWeight: 500, color: t.textSub, paddingTop: 8 }}>{label}</div>
      <div style={{ flex: 1 }}>
        {isComplex ? (
          <div style={{ fontSize: 13, color: t.text, fontStyle: "italic", paddingTop: 8 }}>
            (complex value — edit via direct DB)
          </div>
        ) : useTextarea ? (
          <textarea
            value={stringValue}
            onChange={e => emit(e.target.value)}
            disabled={disabled}
            style={{ ...baseInputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.45 }}
          />
        ) : (
          <input
            type="text"
            value={stringValue}
            onChange={e => emit(e.target.value)}
            disabled={disabled}
            style={baseInputStyle}
          />
        )}
      </div>
    </div>
  );
}

function btn(t, variant) {
  // Note: disabled buttons get the proper visual cue via :disabled CSS
  // pseudo-class on the inline-styled element. Browsers honor opacity +
  // cursor on disabled. We force these via 'aria-disabled' style trick:
  // styles include disabled-aware overrides applied at usage when needed.
  const base = {
    padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: "pointer", border: "none",
    // The browser doesn't auto-apply opacity/cursor for disabled inline
    // styles, so we add them via a CSS class that we'll inject globally.
  };
  if (variant === "primary")     return { ...base, background: t.accent, color: "#000" };
  if (variant === "danger")      return { ...base, background: t.red, color: "#fff" };
  if (variant === "danger-ghost")return { ...base, background: "transparent", color: t.red, border: `1px solid ${t.red}55` };
  return { ...base, background: "transparent", color: t.text, border: `1px solid ${t.border}` };
}

// Inject a one-time global rule so any disabled <button> looks disabled.
// React doesn't add a class for :disabled when only inline style is used.
if (typeof document !== "undefined" && !document.getElementById("__systems_disabled_btn_css__")) {
  const s = document.createElement("style");
  s.id = "__systems_disabled_btn_css__";
  s.textContent = `button:disabled { opacity: 0.4 !important; cursor: not-allowed !important; }`;
  document.head.appendChild(s);
}
