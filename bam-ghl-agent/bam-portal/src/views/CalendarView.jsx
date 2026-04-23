import { useState, useMemo, useEffect, useRef } from "react";
import { fetchEvents } from "../services/calendarService";
import MeetingPrepModal from './MeetingPrepModal';
import { useIsMobile } from '../hooks/useMediaQuery';

const HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_HEIGHT = 60;
const PX_PER_MIN = HOUR_HEIGHT / 60;

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function fmtWeekLabel(monday) {
  const sun = new Date(monday);
  sun.setDate(monday.getDate() + 6);
  const opts = { month: "short", day: "numeric" };
  const year = monday.getFullYear();
  return `${monday.toLocaleDateString("en-US", opts)} - ${sun.toLocaleDateString("en-US", opts)}, ${year}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// Compute overlap layout for a list of events on a single day.
// Returns a Map from event id to { colIndex, totalCols }.
function computeOverlapLayout(dayEvents) {
  if (dayEvents.length === 0) return new Map();

  // Sort by start time, then by duration descending (longer events first)
  const sorted = [...dayEvents].sort((a, b) => {
    const diff = new Date(a.startTime) - new Date(b.startTime);
    if (diff !== 0) return diff;
    const durA = new Date(a.endTime) - new Date(a.startTime);
    const durB = new Date(b.endTime) - new Date(b.startTime);
    return durB - durA;
  });

  // Build overlap groups: groups of events that all overlap with each other transitively
  const groups = [];
  let currentGroup = [sorted[0]];
  let groupEnd = new Date(sorted[0].endTime).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const evStart = new Date(sorted[i].startTime).getTime();
    if (evStart < groupEnd) {
      // Overlaps with current group
      currentGroup.push(sorted[i]);
      groupEnd = Math.max(groupEnd, new Date(sorted[i].endTime).getTime());
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
      groupEnd = new Date(sorted[i].endTime).getTime();
    }
  }
  groups.push(currentGroup);

  // For each group, assign column indices
  const layoutMap = new Map();
  for (const group of groups) {
    const totalCols = group.length;
    group.forEach((ev, colIndex) => {
      layoutMap.set(ev.id, { colIndex, totalCols });
    });
  }
  return layoutMap;
}

function typeColor(type, tokens) {
  if (type === "call") return tokens.blue;
  if (type === "review") return tokens.accent;
  if (type === "deadline") return tokens.red;
  return tokens.textSub;
}

function typeBg(type, tokens) {
  if (type === "call") return `${tokens.blue}18`;
  if (type === "review") return tokens.accentGhost;
  if (type === "deadline") return tokens.redSoft;
  return `${tokens.textSub}12`;
}

const CLIENT_NAMES = [
  "ADAPT SF", "BAM GTA/Toronto", "BAM NY", "BAM San Jose", "BAM WV",
  "Basketball+", "BasketballPlus", "BTG", "D.A. Hoops Academy",
  "Danny Cooper Basketball", "DETAIL SD", "Elite Smart Athletes",
  "Johnson Bball", "Major Hoops", "Performance Space",
  "Prime By Design", "Pro Bound Training", "Straight Buckets",
  "Supreme Hoops Training", "The Basketball Lab",
];

function EventDetailModal({ event, tokens, onClose, onPrepCall, mappedClient, onMapClient, onRemoveMapping }) {
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  if (!event) return null;
  const effectiveClient = mappedClient || event.client || "";
  const start = new Date(event.startTime || event.start);
  const end = new Date(event.endTime || event.end);
  const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeStr = `${fmtTime(event.startTime || event.start)} – ${fmtTime(event.endTime || event.end)}`;
  const durationMin = Math.round((end - start) / 60000);
  const durationStr = durationMin >= 60 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60 ? (durationMin % 60) + "m" : ""}`.trim() : `${durationMin}m`;
  const color = typeColor(event.type, tokens);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1500,
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "cardIn 0.15s ease both",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: tokens.surface, borderRadius: 16, width: 480, maxWidth: "90vw",
        maxHeight: "80vh", overflowY: "auto",
        border: `1px solid ${tokens.border}`, boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
      }}>
        {/* Color header bar */}
        <div style={{ height: 4, borderRadius: "16px 16px 0 0", background: color }} />
        <div style={{ padding: "24px 28px" }}>
          {/* Close button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color, letterSpacing: "0.02em",
                  padding: "3px 9px", borderRadius: 6, background: typeBg(event.type, tokens),
                  textTransform: "capitalize",
                }}>{event.type || "event"}</span>
                {event.status && event.status !== "confirmed" && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 6,
                    background: `${tokens.amber}15`, color: tokens.amber,
                    textTransform: "capitalize",
                  }}>{event.status}</span>
                )}
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.3 }}>
                {event.title}
              </h2>
            </div>
            <div onClick={onClose} style={{
              width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: tokens.textMute, fontSize: 18, flexShrink: 0, marginLeft: 12,
              transition: "background 0.12s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >×</div>
          </div>

          {/* Date & Time */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{dateStr}</div>
                <div style={{ fontSize: 13, color: tokens.textSub, marginTop: 2 }}>{event.allDay ? "All day" : `${timeStr}  ·  ${durationStr}`}</div>
              </div>
            </div>

            {/* Client */}
            {event.client && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style={{ fontSize: 14, color: tokens.text }}>{event.client}</span>
              </div>
            )}

            {/* Organizer */}
            {event.organizer && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style={{ fontSize: 13, color: tokens.textSub }}>Organized by <span style={{ color: tokens.text, fontWeight: 500 }}>{event.organizer}</span></span>
              </div>
            )}

            {/* Location */}
            {event.location && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style={{ fontSize: 14, color: tokens.text }}>{event.location}</span>
              </div>
            )}

            {/* Meeting link */}
            {(event.hangoutLink || event.htmlLink) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6A5 5 0 0 1 6 7h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                <a href={event.hangoutLink || event.htmlLink} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 14, color: tokens.accent, textDecoration: "none", fontWeight: 500,
                }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                >
                  {event.hangoutLink ? "Join Google Meet" : "Open in Google Calendar"}
                </a>
              </div>
            )}
          </div>

          {/* Client matching */}
          <div style={{ marginBottom: effectiveClient ? 0 : 24 }}>
            {effectiveClient ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                padding: "8px 12px", borderRadius: 8, background: tokens.surfaceEl,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style={{ fontSize: 13, fontWeight: 500, color: tokens.text, flex: 1 }}>{effectiveClient}</span>
                {mappedClient && (
                  <span onClick={() => onRemoveMapping(event.title)} style={{
                    fontSize: 11, color: tokens.textMute, cursor: "pointer", padding: "2px 6px", borderRadius: 4,
                  }}
                    onMouseEnter={e => e.currentTarget.style.color = tokens.red}
                    onMouseLeave={e => e.currentTarget.style.color = tokens.textMute}
                  >unlink</span>
                )}
              </div>
            ) : (
              <div>
                {!showClientPicker ? (
                  <button onClick={() => setShowClientPicker(true)} style={{
                    width: "100%", background: tokens.surfaceEl, color: tokens.textSub,
                    borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 500,
                    border: `1px dashed ${tokens.border}`, cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "all 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textSub; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Link to Client for Prep
                  </button>
                ) : (
                  <div style={{
                    borderRadius: 10, border: `1px solid ${tokens.border}`, overflow: "hidden",
                    background: tokens.surfaceEl,
                  }}>
                    <input
                      autoFocus
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                      placeholder="Search clients..."
                      style={{
                        width: "100%", padding: "10px 14px", border: "none", outline: "none",
                        background: "transparent", color: tokens.text, fontSize: 13, fontFamily: "inherit",
                        borderBottom: `1px solid ${tokens.border}`, boxSizing: "border-box",
                      }}
                    />
                    <div style={{ maxHeight: 180, overflowY: "auto" }}>
                      {CLIENT_NAMES
                        .filter(c => !clientSearch || c.toLowerCase().includes(clientSearch.toLowerCase()))
                        .map(c => (
                          <div key={c} onClick={() => {
                            onMapClient(event.title, c);
                            setShowClientPicker(false);
                            setClientSearch("");
                          }} style={{
                            padding: "9px 14px", fontSize: 13, color: tokens.text, cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >{c}</div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Prep for Call button */}
          {effectiveClient && onPrepCall && (
            <button
              onClick={() => onPrepCall({ ...event, client: effectiveClient })}
              style={{
                width: "100%", background: tokens.accent, color: "#fff",
                borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 600,
                border: "none", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", gap: 8,
                marginBottom: 24, fontFamily: "inherit",
                transition: "filter 0.12s",
              }}
              onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.15)"}
              onMouseLeave={e => e.currentTarget.style.filter = "none"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
              Prep for Call
            </button>
          )}

          {/* Description */}
          {event.description && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>DESCRIPTION</div>
              <div style={{
                fontSize: 13, color: tokens.textSub, lineHeight: 1.6,
                padding: "12px 16px", background: tokens.surfaceEl, borderRadius: 10,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{event.description}</div>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 10 }}>
                ATTENDEES ({event.attendees.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {event.attendees.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px", borderRadius: 8, background: tokens.surfaceEl,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: tokens.accentGhost, color: tokens.accent,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700,
                      }}>{(a.name || a.email || "?")[0].toUpperCase()}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: tokens.text }}>{a.name || a.email}</div>
                        {a.name && a.email && <div style={{ fontSize: 11, color: tokens.textMute }}>{a.email}</div>}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                      textTransform: "capitalize",
                      background: a.status === "accepted" ? `${tokens.green}15` : a.status === "declined" ? `${tokens.red}15` : `${tokens.amber}15`,
                      color: a.status === "accepted" ? tokens.green : a.status === "declined" ? tokens.red : tokens.amber,
                    }}>{a.status || "pending"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Determine if an event is from "Bball" or "Business" calendar
function getEventSource(ev) {
  // Check calendarId or source field first
  if (ev.calendarId) {
    const cid = ev.calendarId.toLowerCase();
    if (cid.includes("bball") || cid.includes("basketball") || cid.includes("personal")) return "Bball";
    return "Business";
  }
  if (ev.source) {
    const src = ev.source.toLowerCase();
    if (src.includes("bball") || src.includes("basketball") || src.includes("personal")) return "Bball";
    return "Business";
  }
  // Heuristic: if title contains basketball/bball keywords and no client, it might be personal
  const t = (ev.title || "").toLowerCase();
  if (t.includes("bball") || t.includes("basketball") || t.includes("pickup") || t.includes("gym") || t.includes("workout")) return "Bball";
  return "Business";
}

function sourceColor(source, tokens) {
  return source === "Bball" ? tokens.blue : tokens.accent;
}

export default function CalendarView({ tokens, dark }) {
  const isMobile = useIsMobile();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getMonday(new Date()));
  const [viewMode, setViewMode] = useState("week");
  const [events, setEvents] = useState([]);
  const [isMock, setIsMock] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showPrep, setShowPrep] = useState(false);
  const [clientMappings, setClientMappings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("calendarClientMappings") || "{}"); } catch { return {}; }
  });
  const gridScrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const start = new Date(currentWeekStart);
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 7);
    fetchEvents(start.toISOString(), end.toISOString()).then(({ data }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        // Normalize service fields (start/end) to view fields (startTime/endTime)
        const normalized = data.map(ev => ({
          ...ev,
          startTime: ev.startTime || ev.start,
          endTime: ev.endTime || ev.end,
        }));
        setEvents(normalized);
        setIsMock(false);
      }
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentWeekStart]);

  const weekEvents = useMemo(() => {
    const start = new Date(currentWeekStart);
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 7);
    return events.filter(ev => {
      const d = new Date(ev.startTime);
      return d >= start && d < end;
    });
  }, [currentWeekStart, events]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return [...events]
      .filter(ev => new Date(ev.startTime) >= now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, 5);
  }, [events]);

  // Auto-scroll to 7am on load
  useEffect(() => {
    if (!isLoading && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, [isLoading]);

  // Save client mappings to localStorage
  const saveClientMapping = (eventTitle, clientName) => {
    const updated = { ...clientMappings, [eventTitle]: clientName };
    setClientMappings(updated);
    localStorage.setItem("calendarClientMappings", JSON.stringify(updated));
  };

  const removeClientMapping = (eventTitle) => {
    const updated = { ...clientMappings };
    delete updated[eventTitle];
    setClientMappings(updated);
    localStorage.setItem("calendarClientMappings", JSON.stringify(updated));
  };

  // Get client for an event — check mapping first, then event.client
  const getEventClient = (ev) => clientMappings[ev.title] || ev.client || "";

  const goToday = () => setCurrentWeekStart(getMonday(new Date()));
  const goPrev = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d);
  };
  const goNext = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d);
  };

  // Build day columns with dates
  const dayDates = DAYS.map((label, i) => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    return { label, date: d, dayNum: d.getDate() };
  });

  // Get events for a given day index (0=Mon)
  const eventsForDay = (dayIdx) => {
    const dayDate = dayDates[dayIdx].date;
    return weekEvents.filter(ev => {
      const d = new Date(ev.startTime);
      return d.getDate() === dayDate.getDate() && d.getMonth() === dayDate.getMonth();
    });
  };

  // Precompute overlap layouts for each day column
  const dayOverlapLayouts = useMemo(() => {
    return DAYS.map((_, di) => {
      const dayEvts = eventsForDay(di);
      return computeOverlapLayout(dayEvts);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekEvents, currentWeekStart]);

  const btnStyle = (active) => ({
    padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
    background: active ? tokens.accentGhost : "transparent",
    border: `1px solid ${active ? tokens.accentBorder : tokens.border}`,
    color: active ? tokens.accent : tokens.textSub,
    fontFamily: "inherit", fontWeight: active ? 600 : 400, transition: "all 0.12s",
  });

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      <style>{`
        @keyframes calPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      `}</style>

      {/* Sample data indicator */}
      {isMock && !isLoading && (
        <div style={{ marginBottom: 16 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
            background: `${tokens.amber}15`, color: tokens.amber,
            letterSpacing: "0.04em",
          }}>SAMPLE DATA</span>
        </div>
      )}

      {/* Calendar source legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.accent }} />
          <span style={{ fontSize: isMobile ? 12 : 11, color: tokens.textMute, fontWeight: 500 }}>Business</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.blue }} />
          <span style={{ fontSize: isMobile ? 12 : 11, color: tokens.textMute, fontWeight: 500 }}>Bball</span>
        </div>
      </div>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, marginBottom: isMobile ? 16 : 28, flexWrap: "wrap",
      }}>
        <button onClick={goPrev} style={btnStyle(false)}>{"\u2190"} Prev</button>
        <button onClick={goToday} style={btnStyle(false)}>Today</button>
        <button onClick={goNext} style={btnStyle(false)}>Next {"\u2192"}</button>
        <div style={{ width: 1, height: 24, background: tokens.border, margin: "0 8px" }} />
        <button onClick={() => setViewMode("week")} style={btnStyle(viewMode === "week")}>Week</button>
        <button onClick={() => setViewMode("day")} style={btnStyle(viewMode === "day")}>Day</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: tokens.text, letterSpacing: "-0.02em" }}>
          {fmtWeekLabel(currentWeekStart)}
        </span>
      </div>

      {isLoading ? (
        /* Loading skeleton mimicking the week view */
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 16 : 24 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              background: tokens.surfaceEl, borderRadius: 16,
              border: `1px solid ${tokens.border}`, overflow: "hidden",
            }}>
              {/* Day headers skeleton */}
              <div style={{ display: "flex", borderBottom: `1px solid ${tokens.border}` }}>
                <div style={{ width: 60, flexShrink: 0 }} />
                {DAYS.map((d, i) => (
                  <div key={i} style={{ flex: 1, padding: "14px 8px", textAlign: "center", borderLeft: `1px solid ${tokens.border}` }}>
                    <div style={{ width: 24, height: 12, borderRadius: 4, background: tokens.borderMed, margin: "0 auto", animation: "calPulse 1.5s ease-in-out infinite" }} />
                    <div style={{ width: 20, height: 20, borderRadius: 4, background: tokens.borderMed, margin: "8px auto 0", animation: "calPulse 1.5s ease-in-out infinite", animationDelay: "200ms" }} />
                  </div>
                ))}
              </div>
              {/* Hour rows skeleton with placeholder blocks */}
              <div style={{ position: "relative" }}>
                {HOURS.map((hour, hi) => (
                  <div key={hour} style={{ display: "flex", height: HOUR_HEIGHT, borderBottom: `1px solid ${tokens.border}` }}>
                    <div style={{ width: 60, flexShrink: 0, padding: "4px 8px 0 0", textAlign: "right" }}>
                      <div style={{ width: 30, height: 12, borderRadius: 4, background: tokens.borderMed, marginLeft: "auto", animation: "calPulse 1.5s ease-in-out infinite", animationDelay: `${hi * 50}ms` }} />
                    </div>
                    {DAYS.map((_, di) => (
                      <div key={di} style={{ flex: 1, borderLeft: `1px solid ${tokens.border}`, position: "relative" }}>
                        {/* Show random skeleton blocks in some cells */}
                        {((hi + di) % 3 === 0) && (
                          <div style={{
                            position: "absolute", top: 4, left: 2, right: 2, height: 36,
                            borderRadius: 6, background: tokens.borderMed,
                            animation: "calPulse 1.5s ease-in-out infinite",
                            animationDelay: `${(hi * 5 + di) * 80}ms`,
                          }} />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0 }}>
            <div style={{
              background: tokens.surfaceEl, borderRadius: 16,
              border: `1px solid ${tokens.border}`, padding: isMobile ? "16px 14px" : "22px 20px",
            }}>
              <div style={{ width: 80, height: 12, borderRadius: 4, background: tokens.borderMed, marginBottom: 18, animation: "calPulse 1.5s ease-in-out infinite" }} />
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ padding: "14px 0" }}>
                  <div style={{ width: 60, height: 10, borderRadius: 4, background: tokens.borderMed, marginBottom: 8, animation: "calPulse 1.5s ease-in-out infinite", animationDelay: `${i * 100}ms` }} />
                  <div style={{ width: "90%", height: 14, borderRadius: 4, background: tokens.borderMed, marginBottom: 4, animation: "calPulse 1.5s ease-in-out infinite", animationDelay: `${i * 100 + 50}ms` }} />
                  <div style={{ width: "50%", height: 10, borderRadius: 4, background: tokens.borderMed, animation: "calPulse 1.5s ease-in-out infinite", animationDelay: `${i * 100 + 100}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 16 : 24 }}>
        {/* Calendar grid */}
        <div style={{ flex: 1, minWidth: 0, overflowX: isMobile ? "auto" : "visible" }}>
          <div style={{
            background: tokens.surfaceEl, borderRadius: 16,
            border: `1px solid ${tokens.border}`, overflow: "hidden",
            minWidth: isMobile ? 580 : "auto",
          }}>
            {/* Day headers */}
            <div style={{ display: "flex", borderBottom: `1px solid ${tokens.border}` }}>
              <div style={{ width: isMobile ? 40 : 60, flexShrink: 0 }} />
              {dayDates.map((d, i) => {
                const isToday = new Date().toDateString() === d.date.toDateString();
                return (
                  <div key={i} style={{
                    flex: 1, padding: "14px 8px", textAlign: "center",
                    borderLeft: `1px solid ${tokens.border}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>{d.label}</div>
                    <div style={{
                      fontSize: 20, fontWeight: 700, marginTop: 4,
                      color: isToday ? tokens.accent : tokens.text,
                    }}>{d.dayNum}</div>
                  </div>
                );
              })}
            </div>

            {/* Hour rows — scrollable */}
            <div ref={gridScrollRef} style={{ position: "relative", maxHeight: 660, overflowY: "auto" }}>
              {HOURS.map((hour) => (
                <div key={hour} style={{ display: "flex", height: HOUR_HEIGHT, borderBottom: `1px solid ${tokens.border}` }}>
                  <div style={{
                    width: isMobile ? 40 : 60, flexShrink: 0, padding: "4px 8px 0 0", textAlign: "right",
                    fontSize: 12, color: tokens.textMute, fontWeight: 500,
                  }}>
                    {hour === 12 ? "12pm" : hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                  </div>
                  {dayDates.map((_, di) => (
                    <div key={di} style={{
                      flex: 1, borderLeft: `1px solid ${tokens.border}`, position: "relative",
                    }}>
                      {eventsForDay(di)
                        .filter(ev => {
                          const h = new Date(ev.startTime).getHours();
                          return h === hour;
                        })
                        .map(ev => {
                          const start = new Date(ev.startTime);
                          const end = new Date(ev.endTime);
                          const topMin = start.getMinutes();
                          const durationMin = Math.max((end - start) / 60000, 20);
                          const height = Math.max(durationMin * PX_PER_MIN, 28);
                          const color = typeColor(ev.type, tokens);
                          const bg = typeBg(ev.type, tokens);
                          const evSource = getEventSource(ev);
                          const srcColor = sourceColor(evSource, tokens);
                          // Overlap layout positioning
                          const layout = dayOverlapLayouts[di]?.get(ev.id) || { colIndex: 0, totalCols: 1 };
                          const widthPct = (1 / layout.totalCols) * 100;
                          const leftPct = (layout.colIndex / layout.totalCols) * 100;
                          return (
                            <div key={ev.id} onClick={() => setSelectedEvent(ev)} style={{
                              position: "absolute", top: topMin * PX_PER_MIN,
                              left: `calc(${leftPct}% + 1px)`,
                              width: `calc(${widthPct}% - 2px)`,
                              height,
                              background: bg, borderRadius: 6, padding: "4px 6px",
                              borderLeft: `3px solid ${color}`, overflow: "hidden",
                              cursor: "pointer", zIndex: 1,
                              transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                              boxSizing: "border-box",
                            }}
                              onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.transform = "scale(1.03) translateY(-1px)"; e.currentTarget.style.zIndex = "10"; e.currentTarget.style.boxShadow = `0 4px 16px ${color}30`; }}
                              onMouseLeave={e => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.zIndex = "1"; e.currentTarget.style.boxShadow = "none"; }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: srcColor, flexShrink: 0 }} />
                                <div style={{
                                  fontSize: isMobile ? 12 : 11, fontWeight: 600, color: color,
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>{ev.title.length > 20 ? ev.title.slice(0, 20) + "\u2026" : ev.title}</div>
                              </div>
                              {height > 36 && (
                                <div style={{ fontSize: isMobile ? 12 : 10, color: tokens.textMute, marginTop: 2, paddingLeft: 10 }}>
                                  {fmtTime(ev.startTime)}{ev.client ? ` \u00b7 ${ev.client.length > 14 ? ev.client.slice(0, 14) + "\u2026" : ev.client}` : ""}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0 }}>
          <div style={{
            background: tokens.surfaceEl, borderRadius: 16,
            border: `1px solid ${tokens.border}`, padding: isMobile ? "16px 14px" : "22px 20px",
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: tokens.textMute,
              letterSpacing: "0.04em", marginBottom: 18,
            }}>UPCOMING</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {upcomingEvents.map((ev, i) => {
                const color = typeColor(ev.type, tokens);
                const evSource = getEventSource(ev);
                const srcColor = sourceColor(evSource, tokens);
                return (
                  <div key={ev.id} onClick={() => setSelectedEvent(ev)} style={{
                    padding: "14px 16px", borderRadius: 10,
                    background: "transparent", transition: "background 0.12s",
                    animation: `cardIn 0.3s ease ${i * 60}ms both`,
                    cursor: "pointer",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: srcColor, flexShrink: 0 }} />
                      <span style={{
                        fontSize: isMobile ? 12 : 11, fontWeight: 600, color, letterSpacing: "0.02em",
                        padding: "2px 7px", borderRadius: 4,
                        background: typeBg(ev.type, tokens),
                        textTransform: "capitalize",
                      }}>{ev.type}</span>
                      <span style={{ fontSize: 12, color: tokens.textMute }}>{fmtTime(ev.startTime)}</span>
                    </div>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: tokens.text,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      letterSpacing: "-0.01em", marginBottom: 3,
                    }}>{ev.title}</div>
                    {ev.client && (
                      <div style={{ fontSize: 12, color: tokens.textSub }}>{ev.client}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}

      {selectedEvent && <EventDetailModal event={selectedEvent} tokens={tokens} onClose={() => setSelectedEvent(null)} onPrepCall={(ev) => { setSelectedEvent(null); setShowPrep(ev); }} mappedClient={clientMappings[selectedEvent.title]} onMapClient={saveClientMapping} onRemoveMapping={removeClientMapping} />}
      {showPrep && <MeetingPrepModal event={showPrep} tokens={tokens} dark={dark} onClose={() => setShowPrep(false)} />}
    </div>
  );
}
