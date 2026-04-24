import { useState, useEffect } from "react";
import { T, calcProgress } from './tokens/tokens';
import { fetchActionItems } from './services/notionService';
import { fetchOnboardingClients } from './services/sheetsService';
import { fetchTasks, fetchAllTeamTasks, createTask, updateTask } from './services/asanaService';
import { fetchEvents } from './services/calendarService';
import { fetchAlerts } from './services/stripeService';
import Avatar from './components/primitives/Avatar';
import { getNextAction } from './views/OnboardingRow';
import ClientModal from './views/ClientModal';
import DashboardView from './views/DashboardView';
import CalendarView from './views/CalendarView';
import FinancialsView from './views/FinancialsView';
import ClientsView from './views/ClientsView';
import UnifiedTasksView from './views/UnifiedTasksView';
import KnowledgeBaseView from './views/KnowledgeBaseView';
import CommunicationView from './views/CommunicationView';
import SearchOverlay from './components/overlays/SearchOverlay';
import SettingsView from './views/SettingsView';
import AlertsPanel from './components/overlays/AlertsPanel';
import LoginView from './views/LoginView';
import { supabase } from './lib/supabase';
import { useIsMobile } from './hooks/useMediaQuery';
import { IconDashboard, IconClients, IconTasks, IconCalendar, IconKnowledge, IconFinancials, IconMessage, IconSettings, IconAlert, IconSearch, IconTraining } from './components/primitives/Icons';

export default function BAMPortal() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = not authed
  const [authLoading, setAuthLoading] = useState(true);
  const [dark, setDark] = useState(true);
  const [nav, setNav] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [isOnboardingModal, setIsOnboardingModal] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [onboardingClients, setOnboardingClients] = useState([]);
  const [activeClients, setActiveClients] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [toast, setToast] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [financialAlerts, setFinancialAlerts] = useState({ failedPayments: [], pastDueInvoices: [], upcomingRenewals: [], expiringCards: [] });
  const [notifDismissed, setNotifDismissed] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ─ Auth ─
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const tk = dark ? T.dark : T.light;

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // Load onboarding data from Google Sheets (falls back to mock)
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchOnboardingClients().then(({ data }) => {
      if (!cancelled && data) setOnboardingClients(data);
    });
    return () => { cancelled = true; };
  }, [session]);

  // Load action items from Notion service
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchActionItems().then(({ data }) => {
      if (!cancelled && data) setActionItems(data);
    });
    return () => { cancelled = true; };
  }, [session]);

  // Load tasks from Asana (falls back to mock)
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchAllTeamTasks().then(({ data, error }) => {
      if (!cancelled) {
        if (data && data.length > 0) setTasks(data);
        else if (error) console.warn("Asana fetch failed:", error);
      }
    });
    return () => { cancelled = true; };
  }, [session]);

  // Load calendar events for dashboard
  // Load calendar events for dashboard
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    fetchEvents(now.toISOString(), weekEnd.toISOString()).then(({ data }) => {
      if (!cancelled && data) {
        const normalized = data.map(ev => ({
          ...ev,
          startTime: ev.startTime || ev.start,
          endTime: ev.endTime || ev.end,
        }));
        setCalendarEvents(normalized);
      }
    });
    return () => { cancelled = true; };
  }, [session]);

  // Load financial alerts from Stripe
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchAlerts().then(({ data }) => {
      if (!cancelled && data) setFinancialAlerts(data);
    });
    return () => { cancelled = true; };
  }, [session]);

  // Mark dashboard loading complete once initial data loads
  useEffect(() => {
    const timer = setTimeout(() => setDashboardLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  const handleCreateTask = async ({ title, assignee, dueDate, notes, project }) => {
    const { data, error } = await createTask({ title, assignee, dueDate, notes, project });
    if (error) { showToast(`Task error: ${error}`); return; }
    if (data) { setTasks(prev => [...prev, data]); showToast(`Task created: ${title}`); }
  };

  const handleUpdateTask = async (id, fields) => {
    const { data, error } = await updateTask(id, fields);
    if (error) { showToast(`Update error: ${error}`); return; }
    if (data) {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
      showToast("Task updated");
    }
  };

  // ─ Client mutations ─
  const updateOnboardingClient = (id, updater) => {
    setOnboardingClients(prev => prev.map(c => c.id === id ? (typeof updater === "function" ? updater(c) : { ...c, ...updater }) : c));
    setSelected(prev => prev && prev.id === id ? (typeof updater === "function" ? updater(prev) : { ...prev, ...updater }) : prev);
  };

  const toggleCheck = (clientId, checkIndex) => {
    updateOnboardingClient(clientId, c => {
      const newChecks = [...c.checks];
      newChecks[checkIndex] = !newChecks[checkIndex];
      const pct = Math.round(newChecks.filter(Boolean).length / newChecks.length * 100);
      const newHealth = Math.max(15, Math.min(100, Math.round(pct * 0.9 + (c.aiSentiment?.score || 0))));
      return { ...c, checks: newChecks, health: newHealth, healthStatus: newHealth >= 70 ? "healthy" : newHealth >= 40 ? "at-risk" : "critical" };
    });
  };

  const addCustomTask = (clientId, taskName) => {
    if (!taskName.trim()) return;
    updateOnboardingClient(clientId, c => ({
      ...c,
      customTasks: [...(c.customTasks || []), { name: taskName.trim(), done: false }],
    }));
  };

  const toggleCustomTask = (clientId, taskIndex) => {
    updateOnboardingClient(clientId, c => {
      const newTasks = [...(c.customTasks || [])];
      newTasks[taskIndex] = { ...newTasks[taskIndex], done: !newTasks[taskIndex].done };
      return { ...c, customTasks: newTasks };
    });
  };

  const updateClientNotes = (clientId, notes) => {
    updateOnboardingClient(clientId, { notes });
  };

  const moveToActive = (clientId) => {
    const client = onboardingClients.find(c => c.id === clientId);
    if (!client) return;
    const newActive = {
      ...client,
      id: 200 + client.id,
      kpis: { leads: 0, trials: 0, conversion: "0%", revenue: "$0" },
      recurring: [false, false, false, false, false, false],
      healthStatus: "healthy",
      health: 70,
      alerts: [],
    };
    setActiveClients(prev => [...prev, newActive]);
    setOnboardingClients(prev => prev.filter(c => c.id !== clientId));
    setSelected(null);
    showToast(`${client.name} moved to Active Clients`);
  };

  const totalAlerts = [...onboardingClients, ...activeClients].reduce((a, c) => a + c.alerts.length, 0);
  const critCount = [...onboardingClients, ...activeClients].filter(c => c.healthStatus === "critical").length;

  // Reminders
  const onboardingReminders = onboardingClients.flatMap(c => {
    const reminders = [];
    const pct = calcProgress(c.checks);
    if (pct < 100) {
      const nextTask = getNextAction(c);
      if (nextTask !== "All complete") reminders.push({ client: c.name, msg: nextTask, type: "task", urgent: c.healthStatus === "critical" });
    }
    (c.customTasks || []).filter(t => !t.done).forEach(t => {
      reminders.push({ client: c.name, msg: t.name, type: "custom", urgent: false });
    });
    return reminders;
  });
  const activeReminders = activeClients.flatMap(c => {
    const reminders = [];
    c.recurring.forEach((done, i) => {
      if (!done) reminders.push({ client: c.name, msg: (c.recurringTaskNames || [])[i] || `Recurring task ${i + 1}`, type: "recurring", urgent: c.healthStatus !== "healthy" });
    });
    return reminders;
  });
  const allReminders = [...onboardingReminders, ...activeReminders].sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));


  useEffect(() => {
    let ctrlDown = 0;
    let ctrlUsedCombo = false;
    const onDown = e => {
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setShowCmd(p => !p); }
      if (e.key === "Escape") { setShowCmd(false); setShowAlerts(false); }
      if (e.key === "Control") { ctrlDown = Date.now(); ctrlUsedCombo = false; }
      if (e.ctrlKey && e.key !== "Control") { ctrlUsedCombo = true; }
    };
    const onUp = e => {
      if (e.key === "Control" && !ctrlUsedCombo && Date.now() - ctrlDown < 400) {
        setShowCmd(p => !p);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  // ─ Auth gate (after all hooks) ─
  if (authLoading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#000000",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32,
      }}>
        <img src="/bam-logo.png" alt="BAM" style={{ width: 80, height: "auto", opacity: 0.8 }} />
        <div style={{
          width: 32, height: 32, border: "3px solid #1A1A2E",
          borderTopColor: "#D4CF8A", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          boxShadow: "0 0 20px rgba(212,207,138,0.2), 0 0 40px rgba(212,207,138,0.05)",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!session) {
    return <LoginView onLogin={(s) => setSession(s)} supabase={supabase} />;
  }

  const userName = session.user?.user_metadata?.full_name || session.user?.email?.split("@")[0] || "Mike";

  const today = new Date().toISOString().split("T")[0];
  const urgentActionItems = actionItems.filter(a => a.status === "Open" && a.urgency === "Urgent").length;
  // Task window: past 7 days through next 3 days
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const threeDaysOut = new Date(); threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
  const threeDaysOutStr = threeDaysOut.toISOString().split("T")[0];
  const windowTasks = tasks.filter(t => !t.completed && t.dueDate && t.dueDate >= sevenDaysAgoStr && t.dueDate <= threeDaysOutStr);
  const taskCount = windowTasks.length;
  const taskAlert = urgentActionItems > 0 || windowTasks.some(t => t.dueDate <= today);

  const titles = {
    dashboard: ["Dashboard", "Your daily cockpit"],
    clients: ["Clients", `${onboardingClients.length + activeClients.length} total`],
    tasks: ["Tasks", `${taskCount} due \u00b7 ${urgentActionItems} urgent`],
    calendar: ["Calendar", "Your schedule"],
    knowledge: ["Knowledge Base", "SOPs & Solutions"],
    financials: ["Financials", "BAM internal finances"],
    communication: ["Communication", "Slack channels & messages"],
    settings: ["Settings", "Preferences & integrations"],
  };
  const [pageTitle, pageDesc] = titles[nav] || ["Portal", ""];

  const NAV_ICONS = {
    dashboard: IconDashboard,
    clients: IconClients,
    tasks: IconTasks,
    calendar: IconCalendar,
    knowledge: IconKnowledge,
    financials: IconFinancials,
    communication: IconMessage,
    training: IconTraining,
    settings: IconSettings,
  };

  const navItems = [
    { label: "Dashboard", key: "dashboard" },
    { label: "Clients", key: "clients", count: onboardingClients.length + activeClients.length },
    { label: "Tasks", key: "tasks", count: taskCount, alert: taskAlert },
    { label: "Calendar", key: "calendar" },
    { label: "Knowledge Base", key: "knowledge" },
    { label: "Financials", key: "financials" },
    { label: "Communication", key: "communication" },
    { label: "SM Training", key: "training", href: "/training" },
  ];

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif", background: tk.bg, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${dark ? "#222" : "#CCC"};border-radius:2px}
        @keyframes cardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
        @keyframes gentlePulse{0%,100%{opacity:1}50%{opacity:0.7}}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 8px rgba(212,207,138,0.15)}50%{box-shadow:0 0 20px rgba(212,207,138,0.3)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes pressDown{0%{transform:scale(1)}50%{transform:scale(0.97)}100%{transform:scale(1)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(16px) scale(0.95)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
        @keyframes dotPing{0%{transform:scale(1);opacity:1}75%,100%{transform:scale(2);opacity:0}}
        button,select{transition:all 0.2s cubic-bezier(0.22, 1, 0.36, 1)}
        button:active{transform:scale(0.97)!important}
        input:focus,textarea:focus,select:focus{outline:none;border-color:${tk.accentBorder}!important;box-shadow:${tk.inputGlow}!important;transition:all 0.2s cubic-bezier(0.22, 1, 0.36, 1)!important}
      `}</style>

      <div style={{ display: "flex", height: "100vh" }}>

        {/* SIDEBAR */}
        <div style={{
          width: isMobile ? "80vw" : 240,
          minWidth: isMobile ? 0 : 240,
          maxWidth: isMobile ? 300 : 240,
          background: tk.surface,
          borderRight: `1px solid ${tk.border}`,
          display: "flex", flexDirection: "column", flexShrink: 0,
          position: isMobile ? "fixed" : "relative",
          top: 0, left: 0, bottom: 0,
          zIndex: isMobile ? 2000 : 1,
          transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "translateX(0)",
          transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          boxShadow: isMobile && sidebarOpen ? "4px 0 24px rgba(0,0,0,0.3)" : "none",
        }}>
          <div style={{ padding: "20px 24px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/bam-logo.png" alt="BAM" style={{ width: 40, height: "auto", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tk.accent, lineHeight: 1.2 }}>By Any Means</div>
              <div style={{ fontSize: 11, color: tk.textMute, marginTop: 2, letterSpacing: "0.02em" }}>Business HQ</div>
            </div>
          </div>

          <div style={{ flex: 1, padding: "0 10px", display: "flex", flexDirection: "column", gap: 2 }}>
            {navItems.map(item => {
              const active = nav === item.key;
              const Icon = NAV_ICONS[item.key];
              return (
                <div key={item.key} onClick={() => { if (item.href) { window.location.href = item.href; return; } setNav(item.key); if (isMobile) setSidebarOpen(false); }} title={item.label} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "11px 14px", borderRadius: 10, cursor: "pointer",
                  background: active ? tk.accentGhost : "transparent",
                  borderLeft: active ? `3px solid ${tk.accent}` : "3px solid transparent",
                  transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                  boxShadow: active ? tk.accentGlow : "none",
                  position: "relative",
                  overflow: "hidden",
                }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.background = tk.surfaceHov;
                      e.currentTarget.style.transform = "translateX(3px)";
                      e.currentTarget.style.borderLeftColor = tk.textMute;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.transform = "translateX(0)";
                      e.currentTarget.style.borderLeftColor = "transparent";
                    }
                  }}
                >
                  <span style={{ flexShrink: 0, width: 20, display: "flex", alignItems: "center", justifyContent: "center", color: active ? tk.accent : tk.textMute, transition: "color 0.2s, transform 0.2s" }}>
                    {Icon && <Icon />}
                  </span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 600 : 400, color: active ? tk.accent : tk.textSub, lineHeight: "20px", transition: "color 0.2s" }}>{item.label}</span>
                  {item.alert && <div style={{ width: 5, height: 5, borderRadius: "50%", background: tk.red, flexShrink: 0, animation: "gentlePulse 2s ease-in-out infinite", position: "relative" }}>
                    <div style={{ position: "absolute", inset: -2, borderRadius: "50%", background: tk.red, animation: "dotPing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite", opacity: 0.4 }} />
                  </div>}
                  {item.count != null && <span style={{ fontSize: 12, fontWeight: 600, color: active ? tk.accent : tk.textMute, transition: "color 0.2s" }}>{item.count}</span>}
                </div>
              );
            })}
            {/* Settings at bottom */}
            <div style={{ marginTop: "auto", padding: "8px 0 0" }}>
              {(() => {
                const active = nav === "settings";
                return (
                  <div onClick={() => { setNav("settings"); if (isMobile) setSidebarOpen(false); }} title="Settings" style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "11px 14px", borderRadius: 10, cursor: "pointer",
                    background: active ? tk.accentGhost : "transparent",
                    borderLeft: active ? `3px solid ${tk.accent}` : "3px solid transparent",
                    transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                    boxShadow: active ? tk.accentGlow : "none",
                  }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.background = tk.surfaceHov; e.currentTarget.style.transform = "translateX(3px)"; e.currentTarget.style.borderLeftColor = tk.textMute; } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; e.currentTarget.style.borderLeftColor = "transparent"; } }}
                  >
                    <span style={{ flexShrink: 0, width: 20, display: "flex", alignItems: "center", justifyContent: "center", color: active ? tk.accent : tk.textMute }}><IconSettings /></span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 600 : 400, color: active ? tk.accent : tk.textSub }}>Settings</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ padding: "0 24px 20px", borderTop: `1px solid ${tk.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: tk.textMute, marginBottom: 14, letterSpacing: "0.04em" }}>Portfolio</div>
            {[
              { label: "Healthy", count: activeClients.filter(c => c.healthStatus === "healthy" && c.alerts.length === 0).length, color: tk.green },
              { label: "At Risk", count: [...onboardingClients, ...activeClients].filter(c => c.healthStatus === "at-risk").length, color: tk.amber },
              { label: "Critical", count: critCount, color: tk.red },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: tk.textSub }}>{s.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: s.color, letterSpacing: "-0.02em" }}>{s.count}</span>
              </div>
            ))}
          </div>

          <div style={{ padding: "16px 24px 24px", borderTop: `1px solid ${tk.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex" }}>
                {["Coleman","Silva","Mike","Zoran","Graham"].map((name, i) => (
                  <div key={i} style={{ marginLeft: i === 0 ? 0 : -6 }} title={name}>
                    <Avatar name={name} size={28} />
                  </div>
                ))}
              </div>
              <button onClick={handleLogout} title="Sign out" style={{
                background: "none", border: `1px solid ${tk.border}`, borderRadius: 8,
                padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600,
                color: tk.textMute, fontFamily: "inherit", transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tk.red; e.currentTarget.style.color = tk.red; e.currentTarget.style.background = tk.redSoft; e.currentTarget.style.boxShadow = tk.redGlow; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tk.border; e.currentTarget.style.color = tk.textMute; e.currentTarget.style.background = "none"; e.currentTarget.style.boxShadow = "none"; }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 1999, transition: "opacity 0.3s",
          }} />
        )}

        {/* MAIN */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Global Notification Bar */}
          {(() => {
            const failedCount = financialAlerts.failedPayments?.length || 0;
            const overdueTasks = actionItems.filter(a => a.status === "Open" && a.urgency === "Urgent").length;
            const criticalClients = [...onboardingClients, ...activeClients].filter(c => c.healthStatus === "critical").length;
            const hasAlerts = (failedCount > 0 || overdueTasks > 0 || criticalClients > 0) && !notifDismissed;
            if (!hasAlerts) return null;
            const parts = [];
            if (failedCount > 0) parts.push(`${failedCount} failed payment${failedCount !== 1 ? "s" : ""}`);
            if (overdueTasks > 0) parts.push(`${overdueTasks} overdue task${overdueTasks !== 1 ? "s" : ""}`);
            if (criticalClients > 0) parts.push(`${criticalClients} critical client${criticalClients !== 1 ? "s" : ""}`);
            const isRed = failedCount > 0 || criticalClients > 0;
            return (
              <div style={{
                height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                gap: 10, fontSize: 12, fontWeight: 600, flexShrink: 0,
                background: isRed ? tk.redSoft : tk.amberSoft,
                color: isRed ? tk.red : tk.amber,
                borderBottom: `1px solid ${isRed ? tk.red + "30" : tk.amber + "30"}`,
                position: "relative",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  {failedCount > 0 && (
                    <span onClick={() => { setNav("financials"); setNotifDismissed(true); }} style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                    >{failedCount} failed payment{failedCount !== 1 ? "s" : ""}</span>
                  )}
                  {failedCount > 0 && overdueTasks > 0 && <span style={{ margin: "0 6px", opacity: 0.5 }}>&middot;</span>}
                  {overdueTasks > 0 && (
                    <span onClick={() => { setNav("tasks"); setNotifDismissed(true); }} style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                    >{overdueTasks} overdue task{overdueTasks !== 1 ? "s" : ""}</span>
                  )}
                  {(failedCount > 0 || overdueTasks > 0) && criticalClients > 0 && <span style={{ margin: "0 6px", opacity: 0.5 }}>&middot;</span>}
                  {criticalClients > 0 && (
                    <span onClick={() => { setNav("clients"); setNotifDismissed(true); }} style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                    >{criticalClients} critical client{criticalClients !== 1 ? "s" : ""}</span>
                  )}
                </span>
                <div onClick={() => setNotifDismissed(true)} style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  cursor: "pointer", fontSize: 16, lineHeight: 1, opacity: 0.7,
                  transition: "opacity 0.12s",
                }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}
                >&times;</div>
              </div>
            );
          })()}

          {/* Topbar */}
          <div style={{
            height: 60, background: tk.surface, borderBottom: `1px solid ${tk.border}`,
            display: "flex", alignItems: "center", padding: isMobile ? "0 16px" : "0 32px", gap: 12, flexShrink: 0,
          }}>
            {isMobile && (
              <div onClick={() => setSidebarOpen(s => !s)} style={{
                width: 36, height: 36, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center", cursor: "pointer",
                color: tk.textMute, flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: tk.text, letterSpacing: "-0.02em" }}>{pageTitle}</span>
              {!isMobile && <span style={{ fontSize: 13, color: tk.textMute }}>{pageDesc}</span>}
            </div>
            {!isMobile && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 24px" }}>
              <div onClick={() => setShowCmd(true)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 20px",
                background: tk.surfaceEl, borderRadius: 12, width: "100%", maxWidth: 520,
                color: tk.textMute, fontSize: 15, cursor: "pointer",
                transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                border: `1px solid ${tk.borderMed}`,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = tk.surfaceHov; e.currentTarget.style.borderColor = tk.borderStr; e.currentTarget.style.boxShadow = tk.inputGlow; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = tk.surfaceEl; e.currentTarget.style.borderColor = tk.borderMed; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tk.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span style={{ flex: 1 }}>Search clients, tasks, SOPs, or ask AI...</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, border: `1px solid ${tk.border}`, letterSpacing: "0.02em", color: tk.textMute }}>Ctrl</span>
              </div>
            </div>
            )}

            <div style={{ position: "relative" }}>
              <div onClick={() => setShowAlerts(p => !p)} style={{
                width: 34, height: 34, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: totalAlerts > 0 ? tk.red : tk.textMute,
                fontSize: 13, position: "relative", transition: "color 0.12s",
              }}>
                <IconAlert />
                {totalAlerts > 0 && (
                  <span style={{
                    position: "absolute", top: 2, right: 2, width: 6, height: 6,
                    borderRadius: "50%", background: tk.red,
                  }} />
                )}
              </div>
              {showAlerts && <AlertsPanel tokens={tk} dark={dark} onClose={() => setShowAlerts(false)} allClients={[...onboardingClients, ...activeClients]} />}
            </div>

            {!isMobile && (
            <div onClick={() => setDark(d => !d)} style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tk.textMute} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              <div style={{
                width: 36, height: 20, borderRadius: 10, position: "relative",
                background: dark ? tk.accent : tk.borderStr,
                transition: "background 0.2s ease",
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: dark ? tk.surface : "#fff",
                  position: "absolute", top: 2,
                  left: dark ? 18 : 2,
                  transition: "left 0.2s ease",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tk.textMute} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </div>
            )}
          </div>

          {/* Page content */}
          <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "24px 16px 40px" : "40px 44px 64px" }}>

            <div key={nav} style={{ marginBottom: 40, animation: "slideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
              <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, color: tk.text, letterSpacing: "-0.03em", lineHeight: 1.1, margin: 0 }}>{pageTitle}</h1>
              <p style={{ fontSize: 15, color: tk.textMute, marginTop: 8 }}>{pageDesc}</p>
            </div>

            {/* DASHBOARD */}
            {nav === "dashboard" && <DashboardView tokens={tk} dark={dark} onboardingClients={onboardingClients} activeClients={activeClients} allReminders={allReminders} tasks={tasks} calendarEvents={calendarEvents} financialAlerts={financialAlerts} onNavigate={setNav} loading={dashboardLoading} onUpdateTask={handleUpdateTask} onSelectClient={(client, isOnboarding) => { setSelected(client); setIsOnboardingModal(isOnboarding); }} userName={userName} />}

            {/* CLIENTS */}
            {nav === "clients" && (
              <ClientsView
                tokens={tk}
                dark={dark}
                onboardingClients={onboardingClients}
                activeClients={activeClients}
                onSelectClient={(client, isOnboarding) => {
                  setSelected(client);
                  setIsOnboardingModal(isOnboarding);
                }}
              />
            )}

            {/* TASKS (Action Items + Asana Tasks + Reminders) */}
            {nav === "tasks" && (
              <UnifiedTasksView
                tokens={tk}
                dark={dark}
                tasks={tasks}
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                allReminders={allReminders}
                onboardingClients={onboardingClients}
                activeClients={activeClients}
                currentUser={userName}
              />
            )}

            {/* CALENDAR */}
            {nav === "calendar" && <CalendarView tokens={tk} dark={dark} />}

            {/* KNOWLEDGE BASE (SOPs + Solutions) */}
            {nav === "knowledge" && <KnowledgeBaseView tokens={tk} dark={dark} />}

            {/* FINANCIALS */}
            {nav === "financials" && <FinancialsView tokens={tk} dark={dark} />}

            {/* COMMUNICATION */}
            {nav === "communication" && <CommunicationView tokens={tk} dark={dark} />}

            {/* SETTINGS */}
            {nav === "settings" && <SettingsView tokens={tk} dark={dark} setDark={setDark} userName={userName} session={session} />}
          </div>
        </div>
      </div>

      {selected && <ClientModal client={selected} tokens={tk} dark={dark} isOnboarding={isOnboardingModal} onClose={() => setSelected(null)} onToggleCheck={toggleCheck} onAddTask={addCustomTask} onToggleCustomTask={toggleCustomTask} onUpdateNotes={updateClientNotes} onMoveToActive={moveToActive} />}
      {showCmd && <SearchOverlay tokens={tk} dark={dark} onClose={() => setShowCmd(false)} allClients={[...onboardingClients, ...activeClients]} onNavigate={(key) => { setNav(key); setShowCmd(false); }} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: tk.green, color: "#fff", padding: "14px 28px",
          borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 2000,
          boxShadow: `0 8px 32px rgba(0,0,0,0.3), ${tk.greenGlow}`,
          animation: "toastIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
          backdropFilter: "blur(8px)",
        }}>{toast}</div>
      )}
    </div>
  );
}
