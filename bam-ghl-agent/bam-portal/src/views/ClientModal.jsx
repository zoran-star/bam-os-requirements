import { useState, useEffect } from "react";
import { calcProgress, statusColor } from '../tokens/tokens';
const ONBOARDING_STAGES = [
  { group: "Sales Handover", tasks: ["Contract Signed", "Asana Created", "Software Setup"] },
  { group: "SM Intro",       tasks: ["SM Intro Call"] },
  { group: "Systems",        tasks: ["Systems Intro Call","Phone Number","Domain Added","Systems Initial Draft","Systems Final Draft","Additional Systems"] },
  { group: "Content",        tasks: ["Content Plan Reviewed"] },
  { group: "Paid Ads",       tasks: ["Ads Initial Draft","Ads Final Draft","Ads Running"] },
];

const RECURRING_TASKS = [
  "Weekly Check-in Call",
  "Monthly KPI Review",
  "Ad Performance Report",
  "Content Calendar Approval",
  "Systems Audit",
  "Renewal Check (60 days out)",
];
import { fetchClientProfile } from '../services/notionService';
import { fetchContacts, fetchPipelines, fetchConversations } from '../services/ghlService';
import Avatar from '../components/primitives/Avatar';
import ProgressBar from '../components/primitives/ProgressBar';

// Map portal client names → GHL location names
const CLIENT_GHL_MAP = {
  "BAM San Jose": "BAM San Jose",
  "BAM WV": "BAM Mountain State",
  "BAM NY": "BAM NY",
  "BTG": "BTG Basketball",
  "Prime By Design": "Prime By Design",
  "Pro Bound Training": "ProBound",
  "Danny Cooper Basketball": "Danny Cooper Basketball",
  "Johnson Bball": "Johnson Basketball Training",
  "D.A. Hoops Academy": "DA Hoops",
  "Performance Space": "Performance Space",
  "BAM GTA/Toronto": "BAM GTA",
  "Elite-Smart Athletes": "Elite-Smart Athletes",
  "Basketball+": "Basketball+",
  "ADAPT SF": "ADAPT SF",
  "Straight Buckets": "Straight Buckets",
  "The Basketball Lab": "The Basketball Lab",
  "DETAIL SD": "DETAIL SD",
};

export default function ClientModal({ client, tokens, dark, onClose, isOnboarding, onToggleCheck, onAddTask, onToggleCustomTask, onUpdateNotes, onMoveToActive }) {
  const [tab, setTab] = useState("overview");
  const [ready, setReady] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(client.notes || "");
  const [notionProfile, setNotionProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // GHL-linked KPI data
  const [ghlKpis, setGhlKpis] = useState(null);
  const [ghlKpisLoading, setGhlKpisLoading] = useState(false);

  useEffect(() => { const t = setTimeout(() => setReady(true), 10); return () => clearTimeout(t); }, []);
  useEffect(() => { setNotesVal(client.notes || ""); }, [client.notes]);

  // Fetch enriched profile from Notion on mount (use pageId if available, else name)
  useEffect(() => {
    let cancelled = false;
    setProfileLoading(true);
    const identifier = client.pageId || client.name;
    fetchClientProfile(identifier).then(({ data }) => {
      if (!cancelled) {
        if (data) setNotionProfile(data);
        setProfileLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [client.name, client.pageId]);

  // Fetch real KPIs from GHL when KPIs tab is selected
  useEffect(() => {
    if (tab !== "kpis" || isOnboarding) return;
    const ghlLocation = CLIENT_GHL_MAP[client.name];
    if (!ghlLocation || ghlKpis) return; // Already fetched or no mapping
    let cancelled = false;
    setGhlKpisLoading(true);

    Promise.all([
      fetchContacts(ghlLocation),
      fetchPipelines(ghlLocation),
      fetchConversations(ghlLocation),
    ]).then(([contactsRes, pipelinesRes, convosRes]) => {
      if (cancelled) return;
      const contacts = contactsRes.data || [];
      const totalContacts = contactsRes.total || contacts.length;
      const pipeData = pipelinesRes.data || { pipelines: [], opportunities: [] };
      const opps = pipeData.opportunities || [];
      const pipelines = pipeData.pipelines || [];
      const convos = convosRes.data || [];

      // Compute KPIs from real data
      const stages = pipelines[0]?.stages || [];
      const stageMap = {};
      stages.forEach(s => { stageMap[s.id] = s.name; });

      // Count opportunities by stage
      const stageCounts = {};
      opps.forEach(o => {
        const name = o.stageName || stageMap[o.stageId] || "Unknown";
        stageCounts[name] = (stageCounts[name] || 0) + 1;
      });

      // Try to identify "won" / "$$$" / "closed" stages
      const wonStages = Object.keys(stageCounts).filter(s =>
        /won|closed|\$\$\$|paid|converted/i.test(s)
      );
      const wonCount = wonStages.reduce((sum, s) => sum + (stageCounts[s] || 0), 0);
      const conversionRate = opps.length > 0 ? Math.round((wonCount / opps.length) * 100) : 0;

      // Revenue from monetary values
      const totalRevenue = opps.reduce((sum, o) => sum + (o.monetaryValue || 0), 0);

      // Unread conversations
      const unreadCount = convos.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

      // Recent leads (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentOpps = opps.filter(o => o.createdAt && new Date(o.createdAt) >= thirtyDaysAgo);

      setGhlKpis({
        totalContacts,
        totalOpportunities: opps.length,
        stageCounts,
        wonCount,
        conversionRate,
        totalRevenue,
        conversations: convos.length,
        unreadCount,
        recentLeads: recentOpps.length,
        pipelineName: pipelines[0]?.name || "Pipeline",
        stages: stages.map(s => ({ name: s.name, count: stageCounts[s.name] || 0 })),
      });
      setGhlKpisLoading(false);
    });

    return () => { cancelled = true; };
  }, [tab, client.name, isOnboarding]);

  // Shorthand for Notion profile data
  const np = notionProfile;

  const pct = isOnboarding ? calcProgress(client.checks) : 100;
  const ai = client.aiSentiment;
  const tabs = isOnboarding
    ? ["overview", "checklist", "marketing", "tasks", "messages"]
    : ["overview", "kpis", "marketing", "recurring", "messages"];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: dark ? "rgba(0,0,0,0.80)" : "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, backdropFilter: "blur(12px)",
      opacity: ready ? 1 : 0, transition: "opacity 0.2s",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 960, maxHeight: "88vh",
        background: tokens.surface, borderRadius: 20,
        border: `1px solid ${tokens.borderMed}`,
        boxShadow: `0 40px 100px rgba(0,0,0,${dark ? 0.7 : 0.2})`,
        display: "flex", flexDirection: "column", overflow: "hidden",
        transform: ready ? "translateY(0) scale(1)" : "translateY(16px) scale(0.975)",
        transition: "transform 0.22s cubic-bezier(0.34,1.3,0.64,1)",
      }}>
        {/* Header */}
        <div style={{ padding: "28px 32px 24px", borderBottom: `1px solid ${tokens.border}`, display: "flex", alignItems: "flex-start", gap: 18, flexShrink: 0 }}>
          <Avatar name={np?.manager || client.manager} size={44} dark={dark} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: tokens.text, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2 }}>{np?.businessName || client.name}</h2>
            <div style={{ display: "flex", gap: 16, fontSize: 14, color: tokens.textMute, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(np?.clientName || client.owner) && <span style={{ fontWeight: 500, color: tokens.textSub }}>{np?.clientName || client.owner}</span>}
              <span style={{ fontWeight: 500, color: tokens.textSub }}>{np?.manager || client.manager}</span>
              <span>{np?.program || client.tier}</span>
              {(np?.monthlyRevenue || client.revenue) && (
                <span style={{ fontWeight: 600, color: tokens.text }}>
                  {np?.monthlyRevenue != null ? (typeof np.monthlyRevenue === "number" ? `$${np.monthlyRevenue.toLocaleString()}/mo` : np.monthlyRevenue) : client.revenue}
                </span>
              )}
              {np?.recurringMeeting && <span>Meeting: {np.recurringMeeting}</span>}
              {client.startDate && <span>Started {client.startDate}</span>}
              {client.renewal && <span>Renews {client.renewal}</span>}
            </div>
          </div>
          {/* Health */}
          <div style={{
            fontSize: 18, fontWeight: 700, color: statusColor(client.healthStatus, tokens),
            display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(client.healthStatus, tokens) }} />
            {client.health}
          </div>
          <div onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: tokens.textSub, fontSize: 20, fontWeight: 500,
            transition: "all 0.15s",
            background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
            border: `1px solid ${tokens.border}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.color = tokens.text; e.currentTarget.style.background = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = tokens.textSub; e.currentTarget.style.background = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; }}
          >{"\u00d7"}</div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", paddingLeft: 32, flexShrink: 0, borderBottom: `1px solid ${tokens.border}`, gap: 8 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "14px 20px", fontSize: 14, fontWeight: tab === t ? 600 : 400,
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
              color: tab === t ? tokens.text : tokens.textMute,
              borderBottom: `2px solid ${tab === t ? tokens.accent : "transparent"}`,
              marginBottom: -1, transition: "all 0.12s", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {tab === "overview" && (
            <div>
              {/* Profile loading skeleton */}
              {profileLoading && (
                <div style={{ marginBottom: 28 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                      <div style={{ height: 14, width: "25%", background: tokens.borderMed, borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
                      <div style={{ height: 14, width: "35%", background: tokens.borderMed, borderRadius: 6, animation: `pulse 1.5s ease-in-out ${i * 0.15}s infinite` }} />
                    </div>
                  ))}
                  <div style={{ height: 60, background: tokens.borderMed, borderRadius: 10, animation: "pulse 1.5s ease-in-out 0.3s infinite", marginBottom: 16 }} />
                  <div style={{ height: 40, background: tokens.borderMed, borderRadius: 10, animation: "pulse 1.5s ease-in-out 0.45s infinite" }} />
                  <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }`}</style>
                </div>
              )}

              {client.alerts?.length > 0 && (
                <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 20, background: tokens.redSoft }}>
                  {client.alerts.map((a, i) => <div key={i} style={{ fontSize: 14, color: tokens.red, fontWeight: 500, lineHeight: "24px" }}>{a}</div>)}
                </div>
              )}
              {client.wins?.length > 0 && (
                <div style={{ padding: "16px 20px", borderRadius: 12, marginBottom: 20, background: tokens.greenSoft }}>
                  {client.wins.map((w, i) => <div key={i} style={{ fontSize: 14, color: tokens.green, fontWeight: 500, lineHeight: "24px" }}>{w}</div>)}
                </div>
              )}

              {isOnboarding && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: 36, fontWeight: 700, color: tokens.accent, letterSpacing: "-0.03em" }}>{pct}%</span>
                    <span style={{ fontSize: 14, color: tokens.textMute }}>onboarding progress</span>
                  </div>
                  <ProgressBar pct={pct} tokens={tokens} delay={80} height={5} />
                </div>
              )}

              {/* ── Section: Overview ── */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>OVERVIEW</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Business Name", value: np?.businessName || client.name },
                    { label: "Client Name", value: np?.clientName || client.owner || "\u2014" },
                    { label: "Manager", value: np?.manager || client.manager || "\u2014" },
                    { label: "Program", value: np?.program || client.tier || "\u2014" },
                    { label: "Recurring Meeting", value: np?.recurringMeeting || "\u2014" },
                    { label: "Active Clients", value: np?.activeClients != null ? np.activeClients : (client.activeClients != null ? client.activeClients : "\u2014") },
                    { label: "Monthly Revenue", value: np?.monthlyRevenue != null ? (typeof np.monthlyRevenue === "number" ? `$${np.monthlyRevenue.toLocaleString()}` : np.monthlyRevenue) : (client.revenue || "\u2014") },
                    { label: "Profile Status", value: np?.profileStatus || (isOnboarding ? "Onboarding" : "Active") },
                  ].map((field, i) => (
                    <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: tokens.surfaceAlt }}>
                      <div style={{ fontSize: 11, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.03em", fontWeight: 500 }}>{field.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{field.value}</div>
                    </div>
                  ))}
                </div>
                {/* Show any additional Notion profile fields not already covered */}
                {np && (() => {
                  const knownKeys = new Set(["businessName", "clientName", "manager", "program", "recurringMeeting", "activeClients", "monthlyRevenue", "profileStatus", "title", "pageId", "callLog", "latestUpdate", "actionItems", "id", "content"]);
                  const extra = Object.entries(np).filter(([k]) => !knownKeys.has(k) && np[k] != null && np[k] !== "");
                  if (extra.length === 0) return null;
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      {extra.map(([k, v], i) => (
                        <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: tokens.surfaceAlt }}>
                          <div style={{ fontSize: 11, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.03em", fontWeight: 500 }}>
                            {k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ── Section: Notion Content (parsed from markdown) ── */}
              {np?.content && (() => {
                // Parse raw markdown content into structured sections
                const raw = np.content;
                const sections = [];
                // Split by ## headers
                const parts = raw.split(/---/).filter(Boolean);
                parts.forEach(part => {
                  const lines = part.trim().split("\n").filter(l => l.trim());
                  lines.forEach(line => {
                    const h2 = line.match(/^##\s+(.+)/);
                    const h3 = line.match(/^###\s+(.+)/);
                    if (h2) {
                      sections.push({ type: "heading", text: h2[1].replace(/\*\*/g, "").trim() });
                    } else if (h3) {
                      sections.push({ type: "subheading", text: h3[1].replace(/\*\*/g, "").trim() });
                    } else {
                      const clean = line.replace(/\*\*([^*]+)\*\*/g, "$1").trim();
                      if (clean && clean !== "N/A") {
                        // Check if it's a date entry (like "March 26, 2026 —")
                        const dateMatch = clean.match(/^((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})\s*[—–-]\s*(.*)/i);
                        if (dateMatch) {
                          sections.push({ type: "entry", date: dateMatch[1], text: dateMatch[2] });
                        } else {
                          sections.push({ type: "text", text: clean });
                        }
                      }
                    }
                  });
                });

                if (sections.length === 0) return null;

                // Group entries under their headings
                const grouped = [];
                let currentGroup = null;
                sections.forEach(s => {
                  if (s.type === "heading") {
                    if (currentGroup) grouped.push(currentGroup);
                    currentGroup = { title: s.text, items: [] };
                  } else if (currentGroup) {
                    currentGroup.items.push(s);
                  } else {
                    // Orphan items go under a default group
                    if (!currentGroup) currentGroup = { title: "Notes", items: [] };
                    currentGroup.items.push(s);
                  }
                });
                if (currentGroup && currentGroup.items.length > 0) grouped.push(currentGroup);

                // Filter out empty groups and skip "Call Log", "Client Info", "Sales Notes" headers with no real content
                const meaningful = grouped.filter(g => g.items.some(item => item.type === "entry" || (item.type === "text" && item.text.length > 5)));

                if (meaningful.length === 0) return null;

                return meaningful.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>
                      {group.title.toUpperCase()}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {group.items.map((item, ii) => {
                        if (item.type === "subheading") {
                          return (
                            <div key={ii} style={{ fontSize: 13, fontWeight: 700, color: tokens.text, marginTop: ii > 0 ? 8 : 0 }}>
                              {item.text}
                            </div>
                          );
                        }
                        if (item.type === "entry") {
                          return (
                            <div key={ii} style={{
                              padding: "14px 18px", borderRadius: 10,
                              background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                            }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, marginBottom: 6 }}>{item.date}</div>
                              <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.65 }}>{item.text}</div>
                            </div>
                          );
                        }
                        return (
                          <div key={ii} style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.65, paddingLeft: 2 }}>
                            {item.text}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}

              {/* ── Section: Latest Update ── */}
              {!np?.content && (np?.latestUpdate || client.latestUpdate) && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>LATEST UPDATE</div>
                  <div style={{ padding: "16px 20px", borderRadius: 12, background: tokens.surfaceEl, border: `1px solid ${tokens.border}` }}>
                    <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{np?.latestUpdate || client.latestUpdate}</div>
                  </div>
                </div>
              )}

              {/* ── Section: Call Log ── */}
              {(np?.callLog && np.callLog.length > 0) && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>CALL LOG</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {np.callLog.map((entry, i) => (
                      <div key={i} style={{ padding: "14px 18px", borderRadius: 10, background: tokens.surfaceEl, border: `1px solid ${tokens.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: entry.notes ? 8 : 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{entry.date || "\u2014"}</span>
                          {entry.type && <span style={{ fontSize: 11, fontWeight: 500, color: tokens.textMute, padding: "1px 6px", borderRadius: 4, background: tokens.surfaceAlt }}>{entry.type}</span>}
                        </div>
                        {entry.notes && <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.6 }}>{entry.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Section: Action Items (from Notion profile) ── */}
              {(np?.actionItems && np.actionItems.length > 0) && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>ACTION ITEMS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {np.actionItems.map((item, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderRadius: 8, background: tokens.surfaceAlt }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                          background: item.status === "done" || item.status === "complete" ? tokens.green : item.urgency === "high" ? tokens.red : tokens.amber,
                        }} />
                        <span style={{ fontSize: 13, color: tokens.text, flex: 1 }}>{item.title || item.name || item}</span>
                        {item.status && <span style={{ fontSize: 11, color: tokens.textMute, fontWeight: 500 }}>{item.status}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>TIMELINE</div>
                {[
                  { label: "Contract Signed", date: client.startDate || "\u2014", done: true },
                  { label: "Onboarding Started", date: client.startDate || "\u2014", done: isOnboarding ? pct > 5 : true },
                  { label: "Systems Launched", date: isOnboarding ? "Pending" : "Completed", done: isOnboarding ? pct > 50 : true },
                  { label: "Ads Running", date: isOnboarding ? "Pending" : "Live", done: isOnboarding ? pct === 100 : true },
                  { label: "Renewal", date: client.renewal || "\u2014", done: false },
                ].map((ev, ei) => (
                  <div key={ei} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, opacity: ev.done ? 1 : 0.3 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: ev.done ? tokens.green : tokens.textMute }} />
                    <span style={{ fontSize: 14, color: tokens.text, flex: 1 }}>{ev.label}</span>
                    <span style={{ fontSize: 13, color: tokens.textMute }}>{ev.date}</span>
                  </div>
                ))}
              </div>

              {/* AI Sentiment */}
              {ai && (
                <div style={{ marginBottom: 20, padding: "16px 20px", borderRadius: 12, background: tokens.surfaceEl, border: `1px solid ${tokens.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>AI SENTIMENT</span>
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                      color: ai.score >= 5 ? tokens.green : ai.score <= -5 ? tokens.red : tokens.amber,
                      background: ai.score >= 5 ? tokens.greenSoft : ai.score <= -5 ? tokens.redSoft : tokens.amberSoft,
                    }}>{ai.label} ({ai.score > 0 ? "+" : ""}{ai.score})</span>
                    <span style={{ fontSize: 11, color: ai.trend === "up" ? tokens.green : ai.trend === "down" ? tokens.red : tokens.textMute }}>
                      {ai.trend === "up" ? "\u2191 Improving" : ai.trend === "down" ? "\u2193 Declining" : "\u2192 Steady"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.5, fontStyle: "italic" }}>"{ai.lastMsg}"</div>
                </div>
              )}

              {/* Sales Handover Notes */}
              {isOnboarding && client.salesNotes && (
                <div style={{ marginBottom: 20, padding: "16px 20px", borderRadius: 12, background: tokens.accentGhost, borderLeft: `3px solid ${tokens.accent}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tokens.accent, letterSpacing: "0.04em", marginBottom: 8 }}>SALES HANDOVER NOTES</div>
                  <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{client.salesNotes}</div>
                </div>
              )}

              {/* Editable Notes */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>NOTES</span>
                  {isOnboarding && (
                    <span onClick={() => {
                      if (editingNotes) { onUpdateNotes?.(client.id, notesVal); setEditingNotes(false); }
                      else setEditingNotes(true);
                    }} style={{ fontSize: 12, color: tokens.accent, cursor: "pointer", fontWeight: 500 }}>
                      {editingNotes ? "Save" : "Edit"}
                    </span>
                  )}
                </div>
                {editingNotes ? (
                  <textarea value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={3} style={{
                    width: "100%", padding: "14px 18px", borderRadius: 10, resize: "vertical",
                    background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                    color: tokens.text, fontSize: 14, fontFamily: "inherit", lineHeight: 1.6, outline: "none",
                  }} />
                ) : (
                  <div style={{ padding: "16px 20px", borderRadius: 12, background: tokens.surfaceAlt }}>
                    <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{client.notes || "No notes yet."}</div>
                  </div>
                )}
              </div>

              {/* Move to Active */}
              {isOnboarding && pct >= 80 && (
                <button onClick={() => onMoveToActive?.(client.id)} style={{
                  padding: "12px 28px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                  background: tokens.green, color: "#08080A", border: "none", cursor: "pointer",
                  fontFamily: "inherit", transition: "opacity 0.12s",
                }}>Move to Active</button>
              )}
            </div>
          )}

          {tab === "checklist" && isOnboarding && (
            <div>
              {ONBOARDING_STAGES.map((stage, si) => {
                const offset = ONBOARDING_STAGES.slice(0, si).reduce((a, s) => a + s.tasks.length, 0);
                const stagePct = Math.round(stage.tasks.filter((_, ti) => client.checks[offset + ti]).length / stage.tasks.length * 100);
                return (
                  <div key={si} style={{ marginBottom: 28 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                      <span style={{ fontSize: 15, color: tokens.accent, fontWeight: 600 }}>{stage.group}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: stagePct === 100 ? tokens.green : tokens.textMute }}>{stagePct}%</span>
                    </div>
                    {stage.tasks.map((task, ti) => {
                      const done = client.checks[offset + ti];
                      return (
                        <div key={ti}
                          onClick={() => onToggleCheck?.(client.id, offset + ti)}
                          style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.1s" }}
                          onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                            background: done ? tokens.green : "transparent",
                            border: `1.5px solid ${done ? tokens.green : tokens.borderStr}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                          }}>
                            {done && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{"\u2713"}</span>}
                          </div>
                          <span style={{ fontSize: 14, color: done ? tokens.textMute : tokens.text, textDecoration: done ? "line-through" : "none", flex: 1 }}>{task}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Custom tasks */}
              {(client.customTasks || []).length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 15, color: tokens.accent, fontWeight: 600, marginBottom: 12 }}>Custom Tasks</div>
                  {client.customTasks.map((task, ti) => (
                    <div key={ti}
                      onClick={() => onToggleCustomTask?.(client.id, ti)}
                      style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        background: task.done ? tokens.green : "transparent",
                        border: `1.5px solid ${task.done ? tokens.green : tokens.borderStr}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                        {task.done && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{"\u2713"}</span>}
                      </div>
                      <span style={{ fontSize: 14, color: task.done ? tokens.textMute : tokens.text, textDecoration: task.done ? "line-through" : "none", flex: 1 }}>{task.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new task */}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <input value={newTask} onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newTask.trim()) { onAddTask?.(client.id, newTask); setNewTask(""); } }}
                  placeholder="Add a custom task\u2026"
                  style={{
                    flex: 1, padding: "12px 16px", borderRadius: 8,
                    background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                    color: tokens.text, fontSize: 14, fontFamily: "inherit", outline: "none",
                  }}
                />
                <button onClick={() => { if (newTask.trim()) { onAddTask?.(client.id, newTask); setNewTask(""); } }} style={{
                  padding: "12px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: newTask.trim() ? tokens.accent : tokens.textMute,
                  color: "#08080A", border: "none", cursor: newTask.trim() ? "pointer" : "default",
                  fontFamily: "inherit", opacity: newTask.trim() ? 1 : 0.3,
                }}>Add</button>
              </div>
            </div>
          )}

          {tab === "kpis" && !isOnboarding && (
            <div>
              {ghlKpisLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{ background: tokens.surfaceAlt, borderRadius: 14, padding: "24px 24px" }}>
                      <div style={{ height: 14, width: "40%", background: tokens.borderMed, borderRadius: 6, marginBottom: 14, animation: "pulse 1.5s ease-in-out infinite" }} />
                      <div style={{ height: 36, width: "60%", background: tokens.borderMed, borderRadius: 8, animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite` }} />
                    </div>
                  ))}
                  <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }`}</style>
                </div>
              ) : ghlKpis ? (
                <>
                  {/* GHL location badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.green }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: tokens.green }}>Live from GHL</span>
                    <span style={{ fontSize: 12, color: tokens.textMute }}>{CLIENT_GHL_MAP[client.name]}</span>
                  </div>

                  {/* Primary KPIs */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
                    {[
                      { label: "Total Contacts", value: ghlKpis.totalContacts, color: tokens.accent || "#4F8CFF" },
                      { label: "Pipeline Leads", value: ghlKpis.totalOpportunities, color: tokens.amber },
                      { label: "Won / Converted", value: ghlKpis.wonCount, color: tokens.green },
                      { label: "Conversion Rate", value: `${ghlKpis.conversionRate}%`, color: ghlKpis.conversionRate >= 20 ? tokens.green : tokens.amber },
                      { label: "Conversations", value: ghlKpis.conversations, color: tokens.accent || "#4F8CFF" },
                      { label: "New (30 days)", value: ghlKpis.recentLeads, color: tokens.cyan || "#06B6D4" },
                    ].map((kpi, i) => (
                      <div key={i} style={{
                        background: tokens.surfaceAlt, borderRadius: 14, padding: "20px 22px",
                        border: `1px solid ${tokens.border}`, position: "relative", overflow: "hidden",
                      }}>
                        <div style={{ fontSize: 12, color: tokens.textMute, fontWeight: 500, marginBottom: 10 }}>{kpi.label}</div>
                        <div style={{ fontSize: 32, fontWeight: 700, color: kpi.color, letterSpacing: "-0.03em" }}>{kpi.value}</div>
                        {/* Subtle accent line */}
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: `${kpi.color}30` }} />
                      </div>
                    ))}
                  </div>

                  {/* Pipeline stages breakdown */}
                  {ghlKpis.stages && ghlKpis.stages.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 14 }}>
                        {ghlKpis.pipelineName.toUpperCase()} STAGES
                      </div>
                      <div style={{
                        background: tokens.surfaceAlt, borderRadius: 14, padding: "18px 22px",
                        border: `1px solid ${tokens.border}`,
                      }}>
                        {/* Funnel bar chart */}
                        {ghlKpis.stages.map((stage, i) => {
                          const max = Math.max(...ghlKpis.stages.map(s => s.count), 1);
                          const pct = Math.round((stage.count / max) * 100);
                          const stageColors = [tokens.accent || "#4F8CFF", tokens.amber, tokens.purple || "#8B5CF6", tokens.cyan || "#06B6D4", tokens.green];
                          const color = stageColors[i % stageColors.length];
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: i < ghlKpis.stages.length - 1 ? 10 : 0 }}>
                              <span style={{ fontSize: 13, color: tokens.textSub, fontWeight: 500, width: 140, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {stage.name}
                              </span>
                              <div style={{ flex: 1, height: 24, background: `${tokens.textMute}10`, borderRadius: 6, overflow: "hidden" }}>
                                <div style={{
                                  height: "100%", borderRadius: 6,
                                  background: `${color}40`,
                                  width: `${Math.max(pct, 4)}%`,
                                  transition: "width 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
                                  display: "flex", alignItems: "center", paddingLeft: 8,
                                }}>
                                  {pct > 15 && <span style={{ fontSize: 11, fontWeight: 700, color }}>{stage.count}</span>}
                                </div>
                              </div>
                              {pct <= 15 && <span style={{ fontSize: 13, fontWeight: 700, color: tokens.text, width: 30, textAlign: "right" }}>{stage.count}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Unread alert */}
                  {ghlKpis.unreadCount > 0 && (
                    <div style={{
                      padding: "12px 18px", borderRadius: 10,
                      background: `${tokens.red}10`, border: `1px solid ${tokens.red}25`,
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: tokens.red, animation: "gentlePulse 2s ease-in-out infinite" }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: tokens.red }}>{ghlKpis.unreadCount} unread message{ghlKpis.unreadCount > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </>
              ) : (
                /* Fallback to static KPIs if no GHL connection */
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                  {Object.entries(client.kpis || {}).map(([k, v]) => (
                    <div key={k} style={{ background: tokens.surfaceAlt, borderRadius: 14, padding: "24px 24px" }}>
                      <div style={{ fontSize: 14, color: tokens.textMute, fontWeight: 500, marginBottom: 10, textTransform: "capitalize" }}>{k}</div>
                      <div style={{ fontSize: 36, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em" }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "recurring" && !isOnboarding && (
            <div>
              {RECURRING_TASKS.map((task, ti) => {
                const done = client.recurring[ti];
                return (
                  <div key={ti} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: `1px solid ${tokens.border}` }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: done ? tokens.green : "transparent",
                      border: `1.5px solid ${done ? tokens.green : tokens.borderStr}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {done && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{"\u2713"}</span>}
                    </div>
                    <span style={{ fontSize: 14, color: done ? tokens.textMute : tokens.text, flex: 1, textDecoration: done ? "line-through" : "none" }}>{task}</span>
                    {!done && <span style={{ fontSize: 12, color: tokens.red, fontWeight: 600 }}>Due</span>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "marketing" && (() => {
            const mkt = null; // Marketing data loaded from live services
            if (!mkt) return <div style={{ padding: "60px 0", textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No marketing data available.</div>;
            const budgetPct = mkt.monthlyBudget > 0 ? Math.round((mkt.totalSpend / mkt.monthlyBudget) * 100) : 0;
            const trendIcon = mkt.trend === "up" ? "\u2191" : mkt.trend === "down" ? "\u2193" : "\u2192";
            const trendColor = mkt.trend === "up" ? tokens.green : mkt.trend === "down" ? tokens.red : tokens.textMute;
            return (
              <div>
                {/* Budget + KPIs */}
                <div style={{ display: "flex", gap: 20, marginBottom: 28 }}>
                  <div style={{ flex: 1, padding: "20px 22px", borderRadius: 12, background: tokens.surfaceAlt }}>
                    <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 6 }}>Monthly Budget</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em" }}>${mkt.monthlyBudget.toLocaleString()}</div>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: tokens.textMute, marginBottom: 4 }}>
                        <span>${mkt.totalSpend.toLocaleString()} spent</span>
                        <span>{budgetPct}%</span>
                      </div>
                      <ProgressBar pct={budgetPct} tokens={tokens} animated={false} height={4} />
                    </div>
                  </div>
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      { label: "ROAS", val: mkt.roas > 0 ? `${mkt.roas}x` : "\u2014", color: mkt.roas >= 5 ? tokens.green : mkt.roas >= 3 ? tokens.amber : tokens.textMute },
                      { label: "Avg CPL", val: mkt.cpl > 0 ? `$${mkt.cpl.toFixed(2)}` : "\u2014", color: mkt.cpl <= 20 ? tokens.green : mkt.cpl <= 30 ? tokens.amber : tokens.red },
                      { label: "Total Leads", val: mkt.totalLeads, color: tokens.text },
                      { label: "Trend", val: `${trendIcon} ${mkt.trend}`, color: trendColor },
                    ].map((kpi, i) => (
                      <div key={i} style={{ padding: "14px 16px", borderRadius: 10, background: tokens.surfaceAlt }}>
                        <div style={{ fontSize: 11, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.03em" }}>{kpi.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color, letterSpacing: "-0.02em" }}>{kpi.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Platforms */}
                <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
                  {mkt.platforms.map(p => (
                    <span key={p} style={{ fontSize: 12, fontWeight: 500, color: tokens.textSub, padding: "4px 10px", borderRadius: 6, background: tokens.surfaceAlt }}>{p}</span>
                  ))}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: tokens.textMute }}>Last updated: {mkt.lastCampaignUpdate}</span>
                </div>

                {/* Campaigns */}
                {mkt.campaigns.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 12 }}>CAMPAIGNS</div>
                    {mkt.campaigns.map((c, ci) => {
                      const isStale = c.lastUpdated.includes("d ago") && parseInt(c.lastUpdated) >= 4;
                      return (
                        <div key={ci} style={{
                          padding: "18px 20px", borderRadius: 12, marginBottom: 8,
                          background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, flex: 1 }}>{c.name}</span>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 5,
                              color: c.status === "Active" ? tokens.green : tokens.amber,
                              background: c.status === "Active" ? tokens.greenSoft : tokens.amberSoft,
                            }}>{c.status}</span>
                            {isStale && <span style={{ fontSize: 11, fontWeight: 600, color: tokens.red }}>Stale</span>}
                          </div>
                          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                            {[
                              { label: "Spend", val: `$${c.spend.toLocaleString()}` },
                              { label: "Impressions", val: c.impressions.toLocaleString() },
                              { label: "Clicks", val: c.clicks.toLocaleString() },
                              { label: "Leads", val: c.leads },
                              { label: "CPL", val: `$${c.cpl.toFixed(2)}` },
                              { label: "CTR", val: c.ctr },
                              { label: "Conv", val: c.conv },
                            ].map((m, mi) => (
                              <div key={mi}>
                                <div style={{ fontSize: 11, color: tokens.textMute }}>{m.label}</div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginTop: 2 }}>{m.val}</div>
                              </div>
                            ))}
                            <div style={{ flex: 1 }} />
                            <div style={{ alignSelf: "flex-end" }}>
                              <span style={{ fontSize: 11, color: isStale ? tokens.red : tokens.textMute }}>{c.lastUpdated}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "40px 0", textAlign: "center" }}>
                    <div style={{ fontSize: 15, color: tokens.textMute }}>No campaigns running yet</div>
                    <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 4 }}>{mkt.notes}</div>
                  </div>
                )}

                {/* Notes */}
                {mkt.notes && mkt.campaigns.length > 0 && (
                  <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 10, background: tokens.surfaceAlt }}>
                    <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.6 }}>{mkt.notes}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {(tab === "messages" || tab === "tasks") && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text }}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</div>
              <div style={{ fontSize: 14, color: tokens.textMute }}>Connect Supabase to populate this panel.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
