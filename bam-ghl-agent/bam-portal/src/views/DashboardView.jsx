import { useState, useEffect } from "react";
import { useIsMobile } from '../hooks/useMediaQuery';
import { statusColor } from '../tokens/tokens';
import Avatar from '../components/primitives/Avatar';
import { fetchConversations } from '../services/ghlService';
import { fetchChannels, fetchMessages } from '../services/slackService';

// Skeleton placeholder with pulse animation
function SkeletonBlock({ width, height, tokens, style }) {
  return (
    <div style={{
      width: width || "100%", height: height || 20, borderRadius: 8,
      background: tokens.borderMed,
      animation: "dashPulse 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

function SkeletonStatCard({ tokens, delay = 0 }) {
  return (
    <div style={{
      padding: "20px 24px", borderRadius: 14,
      background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
    }}>
      <SkeletonBlock width={60} height={36} tokens={tokens} style={{ marginBottom: 8, animationDelay: `${delay}ms` }} />
      <SkeletonBlock width={90} height={13} tokens={tokens} style={{ animationDelay: `${delay + 100}ms` }} />
    </div>
  );
}

export default function DashboardView({ tokens, dark, onboardingClients, activeClients, allReminders, tasks, calendarEvents, financialAlerts, onNavigate, loading, onUpdateTask, onSelectClient, userName }) {
  const isMobile = useIsMobile();
  const allClients = [...onboardingClients, ...activeClients];
  const today = new Date().toISOString().split("T")[0];

  // Track completing tasks for animation
  const [completingTasks, setCompletingTasks] = useState(new Set());

  // Live recent messages from GHL + Slack
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveMessagesLoaded, setLiveMessagesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentMessages() {
      const combined = [];

      // Fetch GHL conversations from BAM Business sub-account
      try {
        const ghlRes = await fetchConversations("BAM Business");
        if (!cancelled && ghlRes.data) {
          ghlRes.data.forEach(c => {
            combined.push({
              id: `ghl-${c.id}`,
              contactName: c.contactName || "Unknown",
              lastMessage: c.lastMessageBody || "",
              lastTimestamp: c.lastMessageDate || "",
              unreadCount: c.unreadCount || 0,
              source: "ghl",
            });
          });
        }
      } catch {}

      // Fetch latest Slack DMs
      try {
        const slackRes = await fetchChannels();
        if (!cancelled && slackRes.data) {
          const dms = slackRes.data.filter(ch => ch.isDM || ch.isGroupDM);
          const msgPromises = dms.slice(0, 5).map(async ch => {
            const msgRes = await fetchMessages(ch.id);
            const msgs = msgRes.data || [];
            const latest = msgs[0];
            if (latest) {
              return {
                id: `slack-${ch.id}`,
                contactName: ch.name || "Unknown",
                lastMessage: latest.text || "",
                lastTimestamp: latest.timestamp ? new Date(parseFloat(latest.timestamp) * 1000).toISOString() : "",
                unreadCount: 0,
                source: "slack",
              };
            }
            return null;
          });
          const slackMsgs = (await Promise.all(msgPromises)).filter(Boolean);
          combined.push(...slackMsgs);
        }
      } catch {}

      // Sort by most recent
      combined.sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));

      if (!cancelled) {
        setLiveMessages(combined);
        setLiveMessagesLoaded(true);
      }
    }

    loadRecentMessages();
    return () => { cancelled = true; };
  }, []);

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Use userName prop or fall back
  const displayName = userName || "Mike";
  const firstName = displayName.split(" ")[0];

  // Task window: past 7 days through next 3 days
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const threeDaysOut = new Date(); threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
  const threeDaysOutStr = threeDaysOut.toISOString().split("T")[0];

  // Only show tasks within the window
  const dueTodayTasks = (tasks || []).filter(t => !t.completed && t.dueDate && t.dueDate >= sevenDaysAgoStr && t.dueDate <= threeDaysOutStr);
  const overdueTasks = dueTodayTasks.filter(t => t.dueDate < today);
  const dueExactlyToday = dueTodayTasks.filter(t => t.dueDate === today);
  const upcomingTasks = dueTodayTasks.filter(t => t.dueDate > today);

  // All incomplete tasks for "In Progress" count
  const inProgressTasks = (tasks || []).filter(t => !t.completed && t.status === "in_progress");

  // Today's calendar events
  const eventsSource = calendarEvents && calendarEvents.length > 0 ? calendarEvents : [];
  const hasLiveCalendar = calendarEvents && calendarEvents.length > 0;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const todayEvents = eventsSource
    .filter(e => {
      const st = new Date(e.startTime || e.start);
      return st >= todayStart && st <= todayEnd;
    })
    .sort((a, b) => new Date(a.startTime || a.start) - new Date(b.startTime || b.start))
    .slice(0, 5);

  // Next upcoming event (from now)
  const now = new Date();
  const upcomingEvents = eventsSource
    .filter(e => new Date(e.startTime || e.start) > now)
    .sort((a, b) => new Date(a.startTime || a.start) - new Date(b.startTime || b.start));
  const nextEvent = upcomingEvents[0] || null;
  const isNextClientCall = nextEvent && nextEvent.client && (nextEvent.type === "call" || !nextEvent.type);

  // Top Asana tasks (incomplete, sorted by due date)
  const topTasks = (tasks || [])
    .filter(t => !t.completed)
    .sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    })
    .slice(0, 5);

  // At-risk clients
  const atRisk = allClients.filter(c => c.health < 50).sort((a, b) => a.health - b.health).slice(0, 5);

  // Unread messages
  const unreadSource = liveMessagesLoaded && liveMessages.length > 0 ? liveMessages : [];
  const totalUnread = unreadSource.reduce((a, c) => a + (c.unreadCount || 0), 0);

  // Urgent reminders
  const urgentReminders = allReminders.filter(r => r.urgent).slice(0, 5);

  // Financial alerts
  const failedPaymentCount = financialAlerts?.failedPayments?.length || 0;
  const pastDueCount = financialAlerts?.pastDueInvoices?.length || 0;
  const totalPaymentAlerts = failedPaymentCount + pastDueCount;

  const typeColor = (type) => type === "call" ? tokens.blue : type === "deadline" ? tokens.red : type === "review" ? tokens.accent : tokens.textMute;

  // Handle task completion from dashboard
  const handleCompleteTask = async (task) => {
    if (completingTasks.has(task.id)) return;
    setCompletingTasks(prev => new Set(prev).add(task.id));
    if (onUpdateTask) {
      await onUpdateTask(task.id, { completed: true });
    }
    // Keep the animation for a moment, then let it disappear on next render
    setTimeout(() => {
      setCompletingTasks(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }, 600);
  };

  // Find which list a client belongs to (for onSelectClient)
  const handleClientClick = (client) => {
    if (!onSelectClient) return;
    const isOnboarding = onboardingClients.some(c => c.id === client.id);
    onSelectClient(client, isOnboarding);
  };

  // Days overdue helper
  const daysOverdue = (dateStr) => {
    const due = new Date(dateStr);
    const diff = Math.floor((new Date(today) - due) / (1000 * 60 * 60 * 24));
    return diff === 1 ? "1 day overdue" : `${diff} days overdue`;
  };

  const sampleBadge = null;

  return (
    <div>
      <style>{`
        @keyframes dashPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        @keyframes taskComplete { 0% { opacity: 1; transform: scaleX(1); } 100% { opacity: 0; transform: scaleX(0.95); height: 0; padding: 0; margin: 0; overflow: hidden; } }
        @keyframes checkPop { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
      `}</style>

      {/* Greeting */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
          {greeting}, {firstName}
        </div>
        <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 6 }}>{dateStr}</div>
      </div>

      {/* Quick Action Buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 28 }}>
        {[
          { label: "Add Task", icon: "+", key: "tasks" },
          { label: "View Calendar", icon: "\u{1F4C5}", key: "calendar" },
          { label: "Knowledge Base", icon: "\u{1F4DA}", key: "knowledge" },
        ].map((action) => (
          <button key={action.label} onClick={() => onNavigate && onNavigate(action.key)} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`,
            color: tokens.accent, cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = tokens.accentGlow; }}
            onMouseLeave={e => { e.currentTarget.style.background = tokens.accentGhost; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      {/* Hero stats — clickable */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 12 : 16, marginBottom: 40 }}>
          {[0, 1, 2, 3].map(i => <SkeletonStatCard key={i} tokens={tokens} delay={i * 80} />)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 12 : 16, marginBottom: 40 }}>
          {[
            { value: allClients.length, label: "total clients", color: tokens.text, nav: "clients" },
            { value: overdueTasks.length, label: "overdue", color: overdueTasks.length > 0 ? tokens.red : tokens.green, nav: "tasks" },
            { value: dueExactlyToday.length, label: "due today", color: dueExactlyToday.length > 0 ? tokens.amber : tokens.green, nav: "tasks" },
            { value: upcomingTasks.length, label: "next 3 days", color: upcomingTasks.length > 0 ? tokens.blue : tokens.textMute, nav: "tasks" },
          ].map((s, i) => (
            <div key={i} onClick={() => onNavigate && onNavigate(s.nav)} style={{
              padding: "20px 24px", borderRadius: 14,
              background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
              transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
              animation: `slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both`,
              cursor: "pointer",
            }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = tokens.cardHover;
                e.currentTarget.style.borderColor = tokens.borderStr;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.borderColor = tokens.border;
              }}
            >
              <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: s.color, transition: "transform 0.2s" }}>{s.value}</div>
              <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 8 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 24 }}>
        {/* Left column */}
        <div style={{ flex: 3, minWidth: 0 }}>

          {/* Next Upcoming Event — clickable */}
          {nextEvent && (
            <div onClick={() => onNavigate && onNavigate("calendar")} style={{
              marginBottom: 28, padding: "18px 22px", borderRadius: 14,
              background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
              display: "flex", alignItems: "center", gap: 16,
              transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
              animation: "slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both",
              cursor: "pointer",
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = tokens.cardHover; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${typeColor(nextEvent.type)}18`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={typeColor(nextEvent.type)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 4 }}>NEXT UP</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>{nextEvent.title}</div>
                <div style={{ fontSize: 12, color: tokens.textSub, marginTop: 2 }}>
                  {new Date(nextEvent.startTime || nextEvent.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  {nextEvent.client && ` \u00b7 ${nextEvent.client}`}
                </div>
              </div>
              {isNextClientCall && (
                <button onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate("calendar"); }} style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: tokens.accent, color: "#fff", border: "none",
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = tokens.accentGlow; e.currentTarget.style.filter = "brightness(1.15)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.filter = "none"; }}
                >
                  Prep for Call
                </button>
              )}
            </div>
          )}

          {/* Today's Schedule — clickable events */}
          {loading ? (
            <div style={{ marginBottom: 36 }}>
              <SkeletonBlock width={160} height={18} tokens={tokens} style={{ marginBottom: 16 }} />
              <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
              {[0, 1, 2].map(i => (
                <SkeletonBlock key={i} height={48} tokens={tokens} style={{ marginBottom: 4, borderRadius: 10, animationDelay: `${i * 100}ms` }} />
              ))}
            </div>
          ) : (
            <div style={{ marginBottom: 36, ...(!hasLiveCalendar ? { opacity: 0.4 } : {}) }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em", display: "flex", alignItems: "center" }}>
                  Today's Schedule
                  <span style={{ fontSize: 14, fontWeight: 400, color: tokens.textMute, marginLeft: 10 }}>{todayEvents.length}</span>
                  {!hasLiveCalendar && sampleBadge}
                </div>
                <span onClick={() => onNavigate && onNavigate("calendar")} style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                >View all &rarr;</span>
              </div>
              <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
              {todayEvents.length === 0 ? (
                <div style={{ padding: "24px 0", fontSize: 14, color: tokens.textMute }}>No events scheduled today.</div>
              ) : (
                todayEvents.map((ev, i) => {
                  const time = new Date(ev.startTime || ev.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={ev.id} onClick={() => onNavigate && onNavigate("calendar")} style={{
                      display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", marginBottom: 4,
                      borderRadius: 10, borderLeft: `3px solid ${typeColor(ev.type)}`,
                      background: tokens.surfaceEl, animation: `cardIn 0.3s ease ${i * 40}ms both`,
                      transition: "all 0.15s ease", cursor: "pointer",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = tokens.borderStr; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = ""; }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: typeColor(ev.type), width: 70, flexShrink: 0 }}>{time}</span>
                      <span style={{ fontSize: 14, fontWeight: 500, color: tokens.text, flex: 1 }}>{ev.title}</span>
                      {ev.client && <span style={{ fontSize: 12, color: tokens.textMute }}>{ev.client}</span>}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tasks Due — interactive with assignee, completion, project, days overdue */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em", display: "flex", alignItems: "center" }}>
                Tasks Due
                <span style={{ fontSize: 14, fontWeight: 400, color: tokens.red, marginLeft: 10 }}>{dueTodayTasks.length}</span>
                {inProgressTasks.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: tokens.blue, marginLeft: 10, padding: "2px 8px", borderRadius: 6, background: `${tokens.blue}15` }}>
                    {inProgressTasks.length} in progress
                  </span>
                )}
              </div>
              <span onClick={() => onNavigate && onNavigate("tasks")} style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
              >View all &rarr;</span>
            </div>
            <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
            {dueTodayTasks.length === 0 ? (
              <div style={{ padding: "24px 0", fontSize: 14, color: tokens.textMute }}>No tasks due today — you're all caught up!</div>
            ) : (
              dueTodayTasks.slice(0, 10).map((task, i) => {
                const isOverdue = task.dueDate < today;
                const isCompleting = completingTasks.has(task.id);
                return (
                  <div key={task.id || i} style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", marginBottom: 4,
                    borderRadius: 10, borderLeft: `3px solid ${isOverdue ? tokens.red : tokens.amber}`,
                    background: tokens.surfaceEl, animation: isCompleting ? "taskComplete 0.5s ease forwards" : `cardIn 0.3s ease ${i * 30}ms both`,
                    transition: "all 0.15s ease", cursor: "pointer",
                    opacity: isCompleting ? 0.5 : 1,
                  }}
                    onClick={() => onNavigate && onNavigate("tasks")}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = tokens.borderStr; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = ""; }}
                  >
                    {/* Clickable checkbox to complete */}
                    <div onClick={(e) => { e.stopPropagation(); handleCompleteTask(task); }} style={{
                      width: 20, height: 20, borderRadius: 5,
                      border: `2px solid ${isCompleting ? tokens.green : isOverdue ? tokens.red : tokens.accent}`,
                      background: isCompleting ? tokens.greenSoft : "transparent",
                      flexShrink: 0, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s ease",
                    }}
                      onMouseEnter={e => { if (!isCompleting) { e.currentTarget.style.background = tokens.accentGhost; e.currentTarget.style.borderColor = tokens.accent; }}}
                      onMouseLeave={e => { if (!isCompleting) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = isOverdue ? tokens.red : tokens.accent; }}}
                    >
                      {isCompleting && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ animation: "checkPop 0.3s ease" }}>
                          <path d="M2.5 6.5L5 9L9.5 3.5" stroke={tokens.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    {/* Assignee avatar */}
                    {task.assignee && <Avatar name={task.assignee} size={24} dark={dark} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.name || task.title}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                        {task.assignee && <span style={{ fontSize: 11, color: tokens.textMute }}>{task.assignee}</span>}
                        {task.assignee && task.project && <span style={{ fontSize: 11, color: tokens.textMute }}>·</span>}
                        {task.project && (
                          <span style={{ fontSize: 11, color: tokens.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.project}</span>
                        )}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                      color: isOverdue ? tokens.red : tokens.amber,
                      background: isOverdue ? tokens.redSoft : tokens.amberSoft,
                      whiteSpace: "nowrap",
                    }}>{isOverdue ? daysOverdue(task.dueDate) : "Due Today"}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* At-Risk Clients — clickable to open client modal */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em" }}>
                At-Risk Clients
                <span style={{ fontSize: 14, fontWeight: 400, color: tokens.amber, marginLeft: 10 }}>{atRisk.length}</span>
              </div>
              <span onClick={() => onNavigate && onNavigate("clients")} style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
              >View all &rarr;</span>
            </div>
            <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
            {atRisk.length === 0 ? (
              <div style={{ padding: "24px 0", fontSize: 14, color: tokens.green }}>All clients are healthy!</div>
            ) : (
              atRisk.map((client, i) => (
                <div key={client.id} onClick={() => handleClientClick(client)} style={{
                  display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", marginBottom: 4,
                  borderRadius: 10, background: tokens.surfaceEl,
                  borderLeft: `3px solid ${statusColor(client.healthStatus, tokens)}`,
                  animation: `cardIn 0.3s ease ${i * 30}ms both`,
                  transition: "all 0.15s ease", cursor: "pointer",
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = tokens.borderStr; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = ""; }}
                >
                  <Avatar name={client.manager} size={28} dark={dark} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>{client.name}</div>
                    <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 2 }}>{client.manager}</div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: statusColor(client.healthStatus, tokens) }}>{client.health}</span>
                  {client.alerts.length > 0 && (
                    <span style={{ fontSize: 12, color: tokens.red, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.alerts[0]}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={{ width: isMobile ? "100%" : 320, flexShrink: 0 }}>

          {/* Payment Alerts Mini-Section — clickable */}
          <div onClick={totalPaymentAlerts > 0 ? () => onNavigate && onNavigate("financials") : undefined} style={{
            marginBottom: 36, padding: "16px 18px", borderRadius: 14,
            background: totalPaymentAlerts > 0 ? tokens.redSoft : tokens.surfaceEl,
            border: `1px solid ${totalPaymentAlerts > 0 ? tokens.red + "30" : tokens.border}`,
            cursor: totalPaymentAlerts > 0 ? "pointer" : "default",
            transition: "all 0.2s ease",
          }}
            onMouseEnter={e => { if (totalPaymentAlerts > 0) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = tokens.redGlow; }}}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: totalPaymentAlerts > 0 ? 10 : 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={totalPaymentAlerts > 0 ? tokens.red : tokens.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1v4M12 19v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M1 12h4M19 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>Payment Alerts</span>
              {totalPaymentAlerts > 0 ? (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#fff", background: tokens.red,
                  padding: "1px 7px", borderRadius: 10, minWidth: 18, textAlign: "center", marginLeft: "auto",
                }}>{totalPaymentAlerts}</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 600, color: tokens.green, marginLeft: "auto" }}>All clear</span>
              )}
            </div>
            {failedPaymentCount > 0 && (
              <div style={{ fontSize: 12, color: tokens.red, fontWeight: 500, marginBottom: 4 }}>
                {failedPaymentCount} failed payment{failedPaymentCount !== 1 ? "s" : ""}
              </div>
            )}
            {pastDueCount > 0 && (
              <div style={{ fontSize: 12, color: tokens.amber, fontWeight: 500 }}>
                {pastDueCount} past due invoice{pastDueCount !== 1 ? "s" : ""}
              </div>
            )}
            {totalPaymentAlerts > 0 && (
              <div style={{
                fontSize: 11, fontWeight: 600, color: tokens.accent, marginTop: 8,
              }}>
                View details &rarr;
              </div>
            )}
          </div>

          {/* Recent Messages — clickable to communication */}
          {(() => {
            const displayMessages = liveMessagesLoaded && liveMessages.length > 0 ? liveMessages : [];
            const isLive = liveMessagesLoaded && liveMessages.length > 0;
            return (
              <div style={{ marginBottom: 36, ...(isLive ? {} : { opacity: 0.4 }) }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em", display: "flex", alignItems: "center" }}>
                    Recent Messages
                    {!isLive && sampleBadge}
                  </div>
                  <span onClick={() => onNavigate && onNavigate("communication")} style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                    onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                  >View all &rarr;</span>
                </div>
                {displayMessages.length === 0 ? (
                  <div style={{ padding: "24px 0", fontSize: 14, color: tokens.textMute }}>No data available</div>
                ) : displayMessages.slice(0, 6).map((conv, i) => (
                  <div key={conv.id} onClick={() => onNavigate && onNavigate("communication")} style={{
                    padding: "14px 16px", marginBottom: 6, borderRadius: 10,
                    background: conv.unreadCount > 0 ? tokens.surfaceEl : "transparent",
                    border: conv.unreadCount > 0 ? `1px solid ${tokens.borderMed}` : `1px solid transparent`,
                    animation: `cardIn 0.3s ease ${i * 40}ms both`,
                    transition: "all 0.15s ease", cursor: "pointer",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = conv.unreadCount > 0 ? tokens.surfaceEl : "transparent"; e.currentTarget.style.transform = "translateY(0)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {conv.source === "ghl" && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: `${tokens.green}20`, color: tokens.green, letterSpacing: "0.03em" }}>GHL</span>
                      )}
                      {conv.source === "slack" && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: `${tokens.accent}20`, color: tokens.accent, letterSpacing: "0.03em" }}>SLACK</span>
                      )}
                      <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, flex: 1 }}>{conv.contactName}</span>
                      {conv.unreadCount > 0 && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: "#fff", background: tokens.blue,
                          padding: "1px 7px", borderRadius: 10, minWidth: 18, textAlign: "center",
                        }}>{conv.unreadCount}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: tokens.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.lastMessage}</div>
                  </div>
                ))}
              </div>
            );
          })()}


          {/* Urgent Reminders — clickable to clients */}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, marginBottom: 12, letterSpacing: "-0.01em" }}>Urgent Reminders</div>
            {urgentReminders.length === 0 ? (
              <div style={{ fontSize: 13, color: tokens.textMute }}>No urgent reminders.</div>
            ) : (
              urgentReminders.map((r, i) => (
                <div key={i} onClick={() => onNavigate && onNavigate("clients")} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: `1px solid ${tokens.border}`,
                  animation: `cardIn 0.3s ease ${i * 30}ms both`,
                  cursor: "pointer", transition: "opacity 0.15s",
                }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                >
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: tokens.red, flexShrink: 0, marginTop: 6 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{r.client}</div>
                    <div style={{ fontSize: 12, color: tokens.textSub, marginTop: 2 }}>{r.msg}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
