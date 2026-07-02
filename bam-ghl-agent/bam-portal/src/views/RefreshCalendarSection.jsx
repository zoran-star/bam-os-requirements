import { useState, useEffect, useCallback } from "react";

// Creative Refresh Calendar (phase 1) - the "Creative refresh" section inside the
// Marketing tab. Week-lane view of every enrolled client's monthly creative-update
// window: 4 Monday-anchored lanes, one chip per client, statuses derived server-side.
// View is open to all marketing + content roles; the action buttons (nudge / move /
// mark received / skip / enroll) only render when the API says canEdit (managers).
// See memories/project_creative_refresh_calendar.md for the full scope.

const STATUS_META = {
  upcoming:  { label: "Upcoming" },
  open:      { label: "Window open" },
  submitted: { label: "Submitted" },
  overdue:   { label: "Overdue" },
  skipped:   { label: "Skipped" },
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

function shortDate(iso) {
  if (!iso) return "-";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

export default function RefreshCalendarSection({ tokens: tk, session }) {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [attnOnly, setAttnOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type: "success"|"error", text }

  const statusColors = {
    upcoming:  { fg: tk.textSub,  bg: tk.surfaceAlt, bd: tk.borderMed, dot: tk.textMute },
    open:      { fg: tk.amber,    bg: tk.amberSoft,  bd: tk.amber,     dot: tk.amber },
    submitted: { fg: tk.green,    bg: tk.greenSoft,  bd: tk.green,     dot: tk.green },
    overdue:   { fg: tk.red,      bg: tk.redSoft,    bd: tk.red,       dot: tk.red },
    skipped:   { fg: tk.textMute, bg: "transparent", bd: tk.border,    dot: tk.textMute },
  };

  const showNotice = (type, text) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = session?.access_token;
      const res = await fetch(`/api/marketing?resource=refresh-windows&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session, month]);

  useEffect(() => { load(); }, [load]);

  const patch = async (body) => {
    if (busy) return null;
    setBusy(true);
    try {
      const token = session?.access_token;
      const res = await fetch("/api/marketing?resource=refresh-windows", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (e) {
      showNotice("error", e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const act = async (body, successText) => {
    const out = await patch(body);
    if (out) {
      if (successText) showNotice("success", successText);
      await load();
    }
  };

  if (loading && !data) {
    return <div style={{ color: tk.textSub, fontSize: 13, padding: "24px 0" }}>Loading refresh calendar…</div>;
  }
  if (error && !data) {
    return <div style={{ color: tk.red, fontSize: 13, padding: "24px 0" }}>Could not load the refresh calendar: {error}</div>;
  }

  const windows = data?.windows || [];
  const weeks = data?.weeks || {};
  const unassigned = data?.unassigned || [];
  const canEdit = !!data?.canEdit;
  const todayIso = new Date().toISOString().slice(0, 10);
  const selected = selectedId ? windows.find(w => w.id === selectedId) : null;
  const visible = attnOnly ? windows.filter(w => w.status === "overdue" || w.status === "open") : windows;
  const attnCount = windows.filter(w => w.status === "overdue" || w.status === "open").length;

  const chip = (w) => {
    const c = statusColors[w.status] || statusColors.upcoming;
    const isSel = w.id === selectedId;
    return (
      <button
        key={w.id}
        onClick={() => setSelectedId(isSel ? null : w.id)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          fontSize: 12, borderRadius: 6, cursor: "pointer",
          background: c.bg, color: c.fg,
          border: `1px solid ${isSel ? tk.accent : c.bd}`,
          boxShadow: isSel ? `0 0 0 1px ${tk.accent}` : "none",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot }} />
        {w.business_name}
      </button>
    );
  };

  return (
    <div>
      {notice && (
        <div style={{
          marginBottom: 14, padding: "8px 14px", borderRadius: 6, fontSize: 12,
          background: notice.type === "success" ? tk.greenSoft : tk.redSoft,
          color: notice.type === "success" ? tk.green : tk.red,
          border: `1px solid ${notice.type === "success" ? tk.green : tk.red}`,
        }}>{notice.text}</div>
      )}

      {/* Header: month nav + needs-attention filter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setMonth(shiftMonth(month, -1))} style={{
            background: "transparent", border: `1px solid ${tk.borderMed}`, color: tk.textSub,
            width: 30, height: 30, borderRadius: 6, cursor: "pointer",
          }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: tk.text, minWidth: 130, textAlign: "center" }}>
            {monthLabel(month)}
          </span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} style={{
            background: "transparent", border: `1px solid ${tk.borderMed}`, color: tk.textSub,
            width: 30, height: 30, borderRadius: 6, cursor: "pointer",
          }}>›</button>
          {month !== currentMonth() && (
            <button onClick={() => setMonth(currentMonth())} style={{
              background: "transparent", border: 0, color: tk.accent, fontSize: 11, cursor: "pointer",
            }}>Today</button>
          )}
        </div>
        <button onClick={() => setAttnOnly(!attnOnly)} style={{
          padding: "6px 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", borderRadius: 6, cursor: "pointer",
          background: attnOnly ? tk.redSoft : "transparent",
          color: attnOnly ? tk.red : tk.textMute,
          border: `1px solid ${attnOnly ? tk.red : tk.borderMed}`,
        }}>⚠ Needs attention{attnCount ? ` (${attnCount})` : ""}</button>
      </div>

      {/* Week lanes */}
      <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "4px 16px", marginBottom: 14 }}>
        {[1, 2, 3, 4].map(w => {
          const laneAll = windows.filter(x => x.week === w);
          const lane = visible.filter(x => x.week === w);
          const wk = weeks[w] || {};
          const isNow = wk.start && wk.end && todayIso >= wk.start && todayIso <= wk.end;
          return (
            <div key={w} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 8px",
              margin: "0 -8px",
              borderTop: w === 1 ? 0 : `1px solid ${tk.border}`,
              background: isNow ? tk.surfaceEl : "transparent",
              borderRadius: isNow ? 6 : 0,
            }}>
              <div style={{ minWidth: 108 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: tk.text }}>
                  Week {w}
                  {isNow && (
                    <span style={{
                      fontSize: 10, color: tk.accent, background: tk.accentGhost,
                      border: `1px solid ${tk.accentBorder}`, padding: "1px 7px",
                      borderRadius: 6, marginLeft: 6,
                    }}>now</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: tk.textMute }}>
                  {wk.start ? `${shortDate(wk.start)} - ${shortDate(wk.end)}` : ""}
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {lane.length
                  ? lane.map(chip)
                  : <span style={{ fontSize: 12, color: tk.textMute }}>
                      {attnOnly && laneAll.length ? "Nothing needs attention" : "No clients this week"}
                    </span>}
              </div>
              <div style={{ fontSize: 11, color: tk.textMute, minWidth: 54, textAlign: "right" }}>
                {laneAll.length} client{laneAll.length === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 18, fontSize: 11, color: tk.textSub, flexWrap: "wrap" }}>
        {["upcoming", "open", "submitted", "overdue"].map(s => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColors[s].dot }} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>

      {/* Detail panel for the selected chip */}
      {selected && (
        <div style={{ background: tk.surfaceEl, border: `1px solid ${tk.borderMed}`, borderRadius: 10, padding: "16px 18px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: tk.text }}>{selected.business_name}</div>
              <div style={{ fontSize: 11, color: statusColors[selected.status]?.fg || tk.textSub }}>
                {STATUS_META[selected.status]?.label || selected.status}
                {" · "}Week {selected.week} · {shortDate(selected.window_start)} - {shortDate(selected.window_end)}
              </div>
            </div>
            <button onClick={() => setSelectedId(null)} style={{
              background: "transparent", border: `1px solid ${tk.border}`, color: tk.textMute,
              width: 28, height: 28, borderRadius: 6, cursor: "pointer",
            }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: tk.textSub, borderTop: `1px solid ${tk.border}`, paddingTop: 10, display: "grid", gap: 5 }}>
            <div>Last submission: <span style={{ color: tk.text }}>{selected.last_submission ? shortDate(selected.last_submission) : "None in the last 4 months"}</span></div>
            <div>Linked ticket: <span style={{ color: selected.submitted_ticket_id ? tk.accent : tk.textMute }}>
              {selected.submitted_ticket_id
                ? `${selected.submitted_ticket_type === "content" ? "Content" : selected.submitted_ticket_type === "marketing" ? "Marketing" : "Manual"} · ${String(selected.submitted_ticket_id).slice(0, 8)}`
                : "None yet"}
            </span></div>
            <div>Nudged: <span style={{ color: tk.text }}>
              {selected.nudges.length
                ? selected.nudges.map(n => `${shortDate(n.at)}${n.kind === "auto" ? " (auto)" : ""}`).join(", ")
                : "Not yet"}
            </span></div>
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              <button disabled={busy} onClick={() => act({ action: "nudge", id: selected.id }, `Nudge sent to ${selected.business_name}'s Slack channel.`)} style={{
                background: tk.accent, color: "#0A0A0B", border: 0, fontSize: 12, fontWeight: 700,
                padding: "7px 14px", borderRadius: 6, cursor: "pointer", opacity: busy ? 0.6 : 1,
              }}>Nudge now</button>
              {selected.status !== "submitted" && selected.status !== "skipped" && (
                <>
                  <button disabled={busy} onClick={() => act({ action: "mark-received", id: selected.id }, "Marked received.")} style={{
                    background: "transparent", border: `1px solid ${tk.green}`, color: tk.green,
                    fontSize: 12, padding: "7px 14px", borderRadius: 6, cursor: "pointer", opacity: busy ? 0.6 : 1,
                  }}>Mark received</button>
                  <select disabled={busy} value="" onChange={e => e.target.value && act({ action: "move-week", id: selected.id, week: Number(e.target.value) }, "Window moved.")} style={{
                    background: "transparent", border: `1px solid ${tk.borderMed}`, color: tk.textSub,
                    fontSize: 12, padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                  }}>
                    <option value="">Move to week…</option>
                    {[1, 2, 3, 4].filter(w => w !== selected.week).map(w => (
                      <option key={w} value={w}>Week {w} ({shortDate(weeks[w]?.start)} - {shortDate(weeks[w]?.end)})</option>
                    ))}
                  </select>
                  <button disabled={busy} onClick={() => act({ action: "skip", id: selected.id }, "Skipped this month.")} style={{
                    background: "transparent", border: `1px solid ${tk.borderMed}`, color: tk.textMute,
                    fontSize: 12, padding: "7px 14px", borderRadius: 6, cursor: "pointer", opacity: busy ? 0.6 : 1,
                  }}>Skip this month</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Eligible clients not on the calendar yet */}
      {unassigned.length > 0 && (
        <div style={{ background: tk.surface, border: `1px dashed ${tk.borderMed}`, borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: tk.textMute, marginBottom: 8 }}>
            Not on the calendar yet
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {unassigned.map(c => (
              <span key={c.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                color: tk.textSub, background: tk.surfaceAlt, border: `1px solid ${tk.border}`,
                padding: "4px 6px 4px 10px", borderRadius: 6,
              }}>
                {c.business_name}
                {canEdit ? (
                  <select disabled={busy} value="" onChange={e => e.target.value && act({ action: "set-week", client_id: c.id, week: Number(e.target.value), month }, `${c.business_name} added to week ${e.target.value}.`)} style={{
                    background: "transparent", border: 0, color: tk.accent, fontSize: 11, cursor: "pointer",
                  }}>
                    <option value="">+ Add</option>
                    {[1, 2, 3, 4].map(w => <option key={w} value={w}>Week {w}</option>)}
                  </select>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
