import { useState, useEffect, useCallback } from "react";
import {
  fetchTickets,
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
} from "../services/ticketsService";
import AsanaImportView from "./AsanaImportView";
import { supabase } from "../lib/supabase";

const STATUS_LABEL = {
  open:             "New",
  delegated:        "Delegated",
  in_progress:      "In progress",
  awaiting_client:  "Awaiting client",
  in_review:        "In review",
  needs_rework:     "Needs rework",
  approved:         "Approved",
  done:             "Done",
};

function statusColor(status, t) {
  switch (status) {
    case "open":             return t.amber;
    case "delegated":        return t.blue;
    case "in_progress":      return t.accent;
    case "awaiting_client":  return t.amber;
    case "in_review":        return t.blue;
    case "needs_rework":     return t.red;
    case "approved":
    case "done":             return t.green;
    default:                 return t.textMute;
  }
}

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SystemsView({ tokens: t, dark, me, session }) {
  const isManager = me?.role === "admin" || me?.role === "systems_manager";
  const defaultTab = isManager ? "delegation" : "execution";

  const [tab, setTab] = useState(defaultTab);
  const [tickets, setTickets] = useState([]);
  const [pool, setPool] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overviewClient, setOverviewClient] = useState("all");

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

  const visibleTickets = tickets.filter(x => {
    if (tab === "delegation") return x.status === "open";
    if (tab === "review") return x.status === "in_review";
    if (tab === "completed") return x.status === "done" || x.status === "approved";
    if (tab === "execution") {
      if (!["delegated","in_progress","awaiting_client","needs_rework"].includes(x.status)) return false;
      if (isManager) return true;
      return x.assigned_to === me?.id;
    }
    return false;
  });

  const overviewTickets = tickets
    .filter(x => x.status !== "done" && x.status !== "approved")
    .filter(x => overviewClient === "all" || x.client?.id === overviewClient)
    .sort((a, b) => {
      // Awaiting_client pinned to top
      const aAwaiting = a.status === "awaiting_client" ? 0 : 1;
      const bAwaiting = b.status === "awaiting_client" ? 0 : 1;
      if (aAwaiting !== bAwaiting) return aAwaiting - bAwaiting;
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return ad - bd;
    });

  const academyOptions = Array.from(
    new Map(tickets.filter(x => x.client?.id).map(x => [x.client.id, x.client.name])).entries()
  ).sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));

  const completedCount = tickets.filter(x => x.status === "done" || x.status === "approved").length;
  const tabs = isManager
    ? [
        { key: "overview",   label: "Overview",   count: tickets.filter(x => x.status !== "done" && x.status !== "approved").length },
        { key: "delegation", label: "Delegation", count: tickets.filter(x => x.status === "open").length },
        { key: "execution",  label: "Execution",  count: tickets.filter(x => ["delegated","in_progress","awaiting_client","needs_rework"].includes(x.status)).length },
        { key: "review",     label: "Review",     count: tickets.filter(x => x.status === "in_review").length },
        { key: "completed",  label: "Completed",  count: completedCount },
        { key: "import",     label: "Asana Import" },
      ]
    : [
        { key: "execution", label: "My Tickets", count: tickets.filter(x => x.assigned_to === me?.id && ["delegated","in_progress","awaiting_client","needs_rework"].includes(x.status)).length },
        { key: "completed", label: "Completed", count: completedCount },
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

      {tab === "import" ? (
        <AsanaImportView tokens={t} dark={dark} />
      ) : tab === "overview" ? (
        <OverviewTab
          tickets={overviewTickets}
          loading={loading}
          academyOptions={academyOptions}
          overviewClient={overviewClient}
          setOverviewClient={setOverviewClient}
          onOpen={(x) => setSelected(x)}
          onCancelClient={async (id) => { await cancelClientRequest(id); await load(); }}
          tokens={t}
        />
      ) : (
        <>
          {loading && <div style={{ color: t.textMute, fontSize: 14 }}>Loading tickets…</div>}

          {!loading && visibleTickets.length === 0 && (
            <div style={{ color: t.textMute, fontSize: 14, padding: "40px 0", textAlign: "center" }}>
              No tickets in this tab.
            </div>
          )}

          {tab === "execution" && visibleTickets.length > 0 ? (
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
                <TicketCard key={x.id} ticket={x} tokens={t} onOpen={() => setSelected(x)} />
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
          onAction={async () => { await load(); setSelected(null); }}
        />
      )}
    </div>
  );
}

function formatDueDate(s, t) {
  if (!s) return { text: "No due date", color: t.textMute };
  const d = new Date(s);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((due - today) / 86400000);
  const text = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: due.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  let label = text;
  if (diff < 0) label = `${text} · ${Math.abs(diff)}d overdue`;
  else if (diff === 0) label = `${text} · today`;
  else if (diff === 1) label = `${text} · tomorrow`;
  else if (diff <= 7) label = `${text} · in ${diff}d`;
  const color = diff < 0 ? t.red : diff <= 2 ? t.amber : t.text;
  return { text: label, color };
}

const TYPE_LABEL = { error: "Error", change: "Change", build: "Build" };

function OverviewTab({ tickets, loading, academyOptions, overviewClient, setOverviewClient, onOpen, onCancelClient, tokens: t }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5 }}>Academy</span>
        <select
          value={overviewClient}
          onChange={e => setOverviewClient(e.target.value)}
          style={{ padding: "8px 12px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 13, minWidth: 200 }}
        >
          <option value="all">All academies ({academyOptions.length})</option>
          {academyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: t.textMute, marginLeft: "auto" }}>{tickets.length} open · sorted by due date</span>
      </div>

      {loading && <div style={{ color: t.textMute, fontSize: 14 }}>Loading tickets…</div>}

      {!loading && tickets.length === 0 && (
        <div style={{ color: t.textMute, fontSize: 14, padding: "40px 0", textAlign: "center" }}>No open tickets.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 1, background: t.border, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
        {tickets.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 180px 200px", gap: 12, padding: "10px 16px", background: t.bg, fontSize: 11, fontWeight: 700, color: t.textMute, textTransform: "uppercase", letterSpacing: 0.5 }}>
            <div>Title</div><div>Type</div><div>Due</div><div>Academy</div>
          </div>
        )}
        {tickets.map(x => {
          const title = x.menu_item || (x.type === "error" ? "Error report" : x.type === "change" ? "Change request" : "Build request");
          const due = formatDueDate(x.due_date, t);
          const awaiting = x.status === "awaiting_client";
          return (
            <div key={x.id} onClick={() => onOpen(x)} style={{
              display: "grid", gridTemplateColumns: "1fr 110px 180px 200px", gap: 12,
              padding: "14px 16px",
              background: awaiting ? (t.bg === "#0E0E12" ? "rgba(232,191,96,0.06)" : "rgba(232,191,96,0.10)") : t.surface,
              borderLeft: awaiting ? `3px solid ${t.accent}` : "3px solid transparent",
              cursor: "pointer", alignItems: "center",
            }}
              onMouseEnter={e => e.currentTarget.style.background = t.bg}
              onMouseLeave={e => e.currentTarget.style.background = awaiting ? (t.bg === "#0E0E12" ? "rgba(232,191,96,0.06)" : "rgba(232,191,96,0.10)") : t.surface}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                {awaiting && (
                  <>
                    <span style={{ fontSize: 10, fontWeight: 700, color: t.accent, background: t.bg === "#0E0E12" ? "rgba(232,191,96,0.15)" : "rgba(232,191,96,0.20)", padding: "3px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>⏳ Action Needed</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm("Cancel the request to the client?")) onCancelClient?.(x.id); }}
                      style={{ fontSize: 11, padding: "3px 8px", background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.textSub, cursor: "pointer", whiteSpace: "nowrap" }}
                    >Cancel request</button>
                  </>
                )}
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textSub }}>{TYPE_LABEL[x.type] || x.type}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: due.color }}>{due.text}</div>
              <div style={{ fontSize: 13, color: t.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.client?.name || "—"}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TicketCard({ ticket, tokens: t, onOpen }) {
  const title = ticket.menu_item
    || (ticket.type === "error" ? "Error report" : ticket.type === "change" ? "Change request" : "Build request");
  const preview = Object.values(ticket.fields || {}).filter(Boolean).join(" · ").slice(0, 120);
  return (
    <div onClick={onOpen} style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: "16px 20px", cursor: "pointer", transition: "border-color 0.2s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = t.borderMed}
      onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(ticket.status, t), textTransform: "uppercase", letterSpacing: 0.5 }}>
          {STATUS_LABEL[ticket.status] || ticket.status}
        </span>
        {ticket.priority === "urgent" && <span style={{ fontSize: 11, fontWeight: 700, color: t.red }}>🔴 URGENT</span>}
        <span style={{ fontSize: 12, color: t.textMute, marginLeft: "auto" }}>{formatDate(ticket.submitted_at)}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: t.textMute, marginBottom: 8 }}>
        {ticket.client?.name || "Unknown client"}
        {ticket.assignee && <> · assigned to <b style={{ color: t.textSub }}>{ticket.assignee.name}</b></>}
      </div>
      {preview && <div style={{ fontSize: 13, color: t.textSub, lineHeight: 1.4 }}>{preview}</div>}
    </div>
  );
}

function TicketModal({ ticket: initial, me, isManager, pool, tokens: t, dark, onClose, onAction }) {
  const [ticket, setTicket] = useState(initial);
  const [notes, setNotes] = useState(initial.staff_notes || "");
  const [userGuide, setUserGuide] = useState(initial.user_guide || "");
  const [clientRequest, setClientRequest] = useState("");
  const [denyNotes, setDenyNotes] = useState("");
  const [assignee, setAssignee] = useState(initial.assigned_to || "");
  const [showDeny, setShowDeny] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [questionMap, setQuestionMap] = useState({});

  // Resolve field UUIDs → question text from Questions Database
  useEffect(() => {
    const ids = Object.keys(ticket.fields || {});
    if (!ids.length) { setQuestionMap({}); return; }
    let cancelled = false;
    supabase
      .from("Questions Database")
      .select('id, "Question"')
      .in("id", ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map = {};
        data.forEach(r => { map[r.id] = r.Question; });
        setQuestionMap(map);
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(ticket.status, t), textTransform: "uppercase", letterSpacing: 0.5 }}>
              {STATUS_LABEL[ticket.status] || ticket.status}
            </span>
            {ticket.priority === "urgent" && <span style={{ fontSize: 11, fontWeight: 700, color: t.red }}>🔴 URGENT</span>}
            <span style={{ fontSize: 11, color: t.textMute, fontFamily: "monospace", marginLeft: "auto" }}>{ticket.id.slice(0, 8)}</span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: t.text, margin: 0 }}>
            {ticket.menu_item || (ticket.type === "error" ? "Error report" : ticket.type === "change" ? "Change request" : "Build request")}
          </h2>
          <div style={{ display: "flex", gap: 14, fontSize: 13, color: t.textMute, marginTop: 6 }}>
            <span>{ticket.client?.name || "Unknown client"}</span>
            <span>Submitted {formatDate(ticket.submitted_at)}</span>
            {ticket.assignee && <span>Assigned to {ticket.assignee.name}</span>}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Submission fields */}
          <Section title="Submission" tokens={t}>
            {Object.entries(ticket.fields || {}).map(([k, v]) => (
              <Row key={k} label={questionMap[k] || k} value={v} tokens={t} />
            ))}
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
          </Section>

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
                  <button onClick={() => wrap(() => cancelClientRequest(ticket.id))} disabled={busy} style={btn(t, "ghost")}>Cancel request</button>
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

          {/* User guide — managers can always edit; executors edit while
              the ticket is theirs and not yet in_review/done */}
          {(isManager || ticket.status === "in_progress" || ticket.status === "needs_rework" || ticket.status === "in_review" || ticket.status === "done") && (
            <Section title="User guide (shown to client on completion)" tokens={t}>
              <textarea
                value={userGuide}
                onChange={e => setUserGuide(e.target.value)}
                onBlur={() => userGuide !== (ticket.user_guide || "") && wrap(() => saveUserGuide(ticket.id, userGuide))}
                disabled={!isManager && (ticket.status === "in_review" || ticket.status === "done" || !canExec)}
                placeholder="Explain to the client what happens in their GHL…"
                style={{
                  width: "100%", minHeight: 80, padding: 12,
                  background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                  color: t.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
                  opacity: (ticket.status === "in_review" || ticket.status === "done") ? 0.7 : 1,
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
                <button disabled={!clientRequest.trim() || busy} onClick={() => wrap(() => requestClientAction(ticket.id, clientRequest))} style={btn(t, "primary")}>Send to client</button>
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
                <button disabled={!denyNotes.trim() || busy} onClick={() => wrap(() => denyTicket(ticket.id, denyNotes))} style={btn(t, "danger")}>Deny & send back</button>
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
              <button disabled={!assignee || busy} onClick={() => wrap(() => delegateTicket(ticket.id, assignee))} style={btn(t, "primary")}>
                {ticket.status === "open" ? "Delegate" : "Reassign"}
              </button>
              {ticket.status === "open" && (
                <button disabled={busy} onClick={() => wrap(() => delegateTicket(ticket.id, me.id))} style={btn(t, "ghost")}>Self-assign</button>
              )}
            </>
          )}

          {/* Executor: start */}
          {ticket.status === "delegated" && canExec && (
            <button disabled={busy} onClick={() => wrap(() => startTicket(ticket.id))} style={btn(t, "primary")}>Start work</button>
          )}

          {/* Anyone on systems team: request client action (works on any
              non-final status, including while already awaiting_client —
              supports multiple pending requests) */}
          {canClientComm && !["done","approved","in_review"].includes(ticket.status) && !showRequest && (
            <button disabled={busy} onClick={() => setShowRequest(true)} style={btn(t, "ghost")}>
              {ticket.status === "awaiting_client" ? "Add another request" : "Request client action"}
            </button>
          )}

          {/* Executor: submit for review (assignee/manager only) */}
          {canExec && (ticket.status === "in_progress" || ticket.status === "needs_rework") && (
            <button
              disabled={busy}
              onClick={() => wrap(() => submitForReview(ticket.id, userGuide))}
              style={btn(t, "primary")}
            >Submit for review</button>
          )}

          {/* Manager: approve / deny on in_review */}
          {isManager && ticket.status === "in_review" && (
            <>
              <button disabled={busy} onClick={() => wrap(() => approveTicket(ticket.id))} style={btn(t, "primary")}>Approve</button>
              {!showDeny && <button disabled={busy} onClick={() => setShowDeny(true)} style={btn(t, "danger-ghost")}>Deny</button>}
            </>
          )}

          <button onClick={onClose} style={{ ...btn(t, "ghost"), marginLeft: "auto" }}>Close</button>
        </div>
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
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ minWidth: 140, fontSize: 12, fontWeight: 600, color: t.textMute, textTransform: "capitalize" }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: t.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {typeof value === "string" ? value : value}
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
