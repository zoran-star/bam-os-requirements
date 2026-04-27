import { useState, useEffect } from "react";
import { fetchAllClients } from "../services/notionService";
// Mock data imports removed — always use live API
import { fetchPipelines, fetchConversations, fetchContact, fetchConversationMessages } from "../services/ghlService";
import { fetchChannels, fetchMessages } from "../services/slackService";
import { useIsMobile } from '../hooks/useMediaQuery';
import { supabase } from '../lib/supabase';

export default function ClientsView({ tokens, dark, onboardingClients, activeClients, onSelectClient }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("active");
  const [setupTarget, setSetupTarget] = useState(null);
  const [setupRefreshKey, setSetupRefreshKey] = useState(0);
  const [notionClients, setNotionClients] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Leads state
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsSearchQuery, setLeadsSearchQuery] = useState("");
  const [leadsRetryCount, setLeadsRetryCount] = useState(0);
  const [leadsEmpty, setLeadsEmpty] = useState(false);

  // Lead detail modal
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadContact, setLeadContact] = useState(null);
  const [leadConversations, setLeadConversations] = useState([]);
  const [leadMessages, setLeadMessages] = useState([]);
  const [leadLoading, setLeadLoading] = useState(false);

  // Messages state — unified GHL conversations + Slack
  const [ghlMessages, setGhlMessages] = useState([]);
  const [slackMessages, setSlackMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesSearchQuery, setMessagesSearchQuery] = useState("");
  const [expandedConvo, setExpandedConvo] = useState(null);
  const [msgSource, setMsgSource] = useState("all"); // "all" | "ghl" | "slack"

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchAllClients().then(({ data }) => {
      if (!cancelled) {
        setNotionClients(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Attempt to fetch live GHL pipeline data for leads tab
  useEffect(() => {
    if (tab !== "leads") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeadsLoading(true);
    setLeadsEmpty(false);

    const mapOpportunities = (opportunities, stageMap, pipelineName) =>
      opportunities.map(o => ({
        id: o.id,
        name: o.name || o.contactName || "Unknown",
        phone: o.contactEmail || "",
        email: o.contactEmail || "",
        source: o.source || "Direct",
        stage: stageMap[o.stageId] || o.status || "New",
        assignedSM: o.assignedTo || "",
        client: pipelineName || "",
        lastActivity: o.lastActivity || "",
        createdAt: o.createdAt || "",
        notes: "",
        monetaryValue: o.monetaryValue || 0,
      }));

    const finishEmpty = () => {
      if (cancelled) return;
      setLeadsLoading(false);
      setLeadsEmpty(true);
    };

    const finishWithData = (data) => {
      if (cancelled) return;
      setLeads(data);
      setLeadsLoading(false);
      setLeadsEmpty(false);
      setLeadsRetryCount(0);
    };

    // Fetch pipelines from GHL BAM Business sub-account
    fetchPipelines("BAM Business").then(({ data }) => {
      if (cancelled) return;
      if (data && data.pipelines && data.pipelines.length > 0) {
        const pipeline = data.pipelines[0];
        const stageMap = {};
        (pipeline.stages || []).forEach(s => { stageMap[s.id] = s.name; });
        // If we have a pipeline but no opportunities yet, fetch them
        if (data.opportunities && data.opportunities.length > 0) {
          finishWithData(mapOpportunities(data.opportunities, stageMap, pipeline.name));
        }
        // If no pipeline ID was sent, re-fetch with the first pipeline's ID
        else if (pipeline.id) {
          fetchPipelines("BAM Business", pipeline.id).then(({ data: d2 }) => {
            if (cancelled) return;
            if (d2 && d2.opportunities && d2.opportunities.length > 0) {
              finishWithData(mapOpportunities(d2.opportunities, stageMap, pipeline.name));
            } else {
              finishEmpty();
            }
          });
          return;
        } else {
          finishEmpty();
        }
      } else {
        finishEmpty();
      }
    }).catch(() => {
      finishEmpty();
    });
    return () => { cancelled = true; };
  }, [tab, leadsRetryCount]);

  // Auto-retry fetching leads if result was empty (max 3 retries, 5s apart)
  useEffect(() => {
    if (!leadsEmpty || leadsRetryCount >= 3 || tab !== "leads") return;
    const timer = setTimeout(() => {
      setLeadsRetryCount(c => c + 1);
    }, 5000);
    return () => clearTimeout(timer);
  }, [leadsEmpty, leadsRetryCount, tab]);

  // Fetch full lead details when a lead is selected
  useEffect(() => {
    if (!selectedLead) {
      setLeadContact(null);
      setLeadConversations([]);
      setLeadMessages([]);
      return;
    }
    let cancelled = false;
    setLeadLoading(true);

    // Fetch full contact record
    const contactPromise = fetchContact("BAM Business", selectedLead.id).then(({ data }) => {
      if (!cancelled && data) setLeadContact(data);
    });

    // Fetch conversations for this contact
    const convoPromise = fetchConversations("BAM Business", selectedLead.id).then(async ({ data }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        setLeadConversations(data);
        // Fetch messages from the most recent conversation
        const latest = data[0];
        if (latest?.id) {
          const { data: msgs } = await fetchConversationMessages("BAM Business", latest.id);
          if (!cancelled && msgs) setLeadMessages(msgs);
        }
      }
    });

    Promise.all([contactPromise, convoPromise]).then(() => {
      if (!cancelled) setLeadLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedLead]);

  // Fetch BAM Business conversations + Slack messages for Messages tab
  useEffect(() => {
    if (tab !== "messages") return;
    let cancelled = false;
    setMessagesLoading(true);

    // Fetch GHL conversations from BAM Business sub-account
    const ghlPromise = fetchConversations("BAM Business").then(({ data }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) =>
          new Date(b.lastMessageDate) - new Date(a.lastMessageDate)
        );
        setGhlMessages(sorted);
      }
    });

    // Fetch Slack DMs + recent channel messages
    const slackPromise = fetchChannels().then(async ({ data: channels }) => {
      if (cancelled || !channels) return;
      // Get DMs and recent channel activity
      const dms = channels.filter(c => c.isDM || c.isGroupDM);
      const slackItems = [];
      // Fetch latest message from each DM
      for (const dm of dms.slice(0, 10)) {
        try {
          const { data: msgs } = await fetchMessages(dm.id);
          if (cancelled) return;
          if (msgs && msgs.length > 0) {
            const latest = msgs[0];
            slackItems.push({
              id: `slack-${dm.id}`,
              contactName: dm.name || "Slack DM",
              lastMessageBody: latest.text || "",
              lastMessageDate: latest.timestamp ? new Date(parseFloat(latest.timestamp) * 1000).toISOString() : new Date().toISOString(),
              lastMessageDirection: latest.userName === "Coleman" ? "outbound" : "inbound",
              lastMessageType: "slack",
              unreadCount: 0,
              source: "slack",
              channelId: dm.id,
            });
          }
        } catch { /* skip */ }
      }
      if (!cancelled) setSlackMessages(slackItems);
    });

    Promise.all([ghlPromise, slackPromise]).then(() => {
      if (!cancelled) setMessagesLoading(false);
    });
    return () => { cancelled = true; };
  }, [tab]);

  // Preload GHL messages count on mount for the tab badge
  useEffect(() => {
    let cancelled = false;
    fetchConversations("BAM Business").then(({ data }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) =>
          new Date(b.lastMessageDate) - new Date(a.lastMessageDate)
        );
        setGhlMessages(sorted);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Build unified client list — merge Notion data with prop data when available
  const buildClients = () => {
    if (notionClients && notionClients.length > 0) {
      const filtered = notionClients.filter(c => c.profileStatus === tab);
      // Overlay with prop data where names match
      const propMap = {};
      [...onboardingClients, ...activeClients].forEach(c => {
        const key = (c.businessName || c.name || "").toLowerCase();
        if (key) propMap[key] = c;
      });
      return filtered.map(nc => {
        const key = (nc.businessName || nc.title || "").toLowerCase();
        const propMatch = propMap[key];
        return { ...nc, _propData: propMatch || null };
      });
    }
    // Fallback: use prop data
    if (tab === "onboarding") {
      return onboardingClients.map(c => ({ ...c, _source: "props", profileStatus: "onboarding" }));
    }
    return activeClients.map(c => ({ ...c, _source: "props", profileStatus: "active" }));
  };

  const clientsUnfiltered = (tab !== "leads" && tab !== "messages") ? buildClients() : [];
  const isNotionMode = notionClients && notionClients.length > 0;

  // Apply search filter for clients
  const clients = searchQuery
    ? clientsUnfiltered.filter(c => {
        const q = searchQuery.toLowerCase();
        const name = (c.businessName || c.title || c.name || "").toLowerCase();
        const clientName = (c.clientName || c.owner || "").toLowerCase();
        return name.includes(q) || clientName.includes(q);
      })
    : clientsUnfiltered;

  // Filtered leads
  const filteredLeads = leadsSearchQuery
    ? leads.filter(l => {
        const q = leadsSearchQuery.toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          (l.source || "").toLowerCase().includes(q) ||
          (l.stage || "").toLowerCase().includes(q) ||
          (l.client || "").toLowerCase().includes(q) ||
          (l.assignedSM || "").toLowerCase().includes(q)
        );
      })
    : leads;

  // Summary stats
  const totalClients = (onboardingClients?.length || 0) + (activeClients?.length || 0);
  const leadsCount = leads.length;
  const avgHealth = (() => {
    const all = [...(onboardingClients || []), ...(activeClients || [])];
    if (all.length === 0) return 0;
    const sum = all.reduce((a, c) => a + (c.health || 0), 0);
    return Math.round(sum / all.length);
  })();
  const activeCount = activeClients?.length || 0;
  const onboardingCount = onboardingClients?.length || 0;

  // Leads stats
  const unreadMessages = 0; // TODO: pull from live GHL conversations
  const wonLeads = leads.filter(l => l.stage === "Won").length;
  const pipelineConversion = leads.length > 0 ? Math.round((wonLeads / leads.length) * 100) : 0;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = leads.filter(l => {
    if (!l.createdAt) return false;
    return new Date(l.createdAt) >= oneWeekAgo;
  }).length;

  const handleCardClick = (client) => {
    const isOnboarding = client.profileStatus === "onboarding" || client._source === "props" && tab === "onboarding";
    // If we have prop data overlay, pass that for modal compatibility
    const modalClient = client._propData || client;
    onSelectClient(modalClient, isOnboarding);
  };

  // SM avatar colors
  const smColors = { Mike: "#4F8CFF", Zoran: "#8B5CF6", Silva: "#F59E0B", Graham: "#10B981" };

  // Stage colors
  const stageColorMap = {
    "New": tokens.blue || "#3B82F6",
    "Contacted": tokens.amber || "#F59E0B",
    "Qualified": tokens.purple || "#8B5CF6",
    "Trial Booked": tokens.cyan || "#06B6D4",
    "Trial Complete": tokens.green || "#22C55E",
    "Won": tokens.green || "#22C55E",
    "Lost": tokens.red || "#EF4444",
  };

  // Source badge colors
  const sourceColorMap = {
    "Facebook Ad": "#1877F2",
    "Instagram Ad": "#E1306C",
    "Google Search": "#34A853",
    "Referral": tokens.purple || "#8B5CF6",
  };

  // Unified messages: merge GHL + Slack, sorted by date
  const allMessages = (() => {
    const ghl = ghlMessages.map(m => ({ ...m, source: "ghl" }));
    const slack = slackMessages.map(m => ({ ...m, source: "slack" }));
    const merged = [...ghl, ...slack].sort((a, b) =>
      new Date(b.lastMessageDate) - new Date(a.lastMessageDate)
    );
    return merged;
  })();

  // Filter by source tab
  const sourceFilteredMessages = msgSource === "all" ? allMessages
    : msgSource === "ghl" ? allMessages.filter(m => m.source === "ghl")
    : allMessages.filter(m => m.source === "slack");

  // Messages unread count
  const messagesUnreadCount = allMessages.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  // Filtered messages (search)
  const filteredMessages = messagesSearchQuery
    ? sourceFilteredMessages.filter(m => {
        const q = messagesSearchQuery.toLowerCase();
        return (
          (m.contactName || "").toLowerCase().includes(q) ||
          (m.lastMessageBody || "").toLowerCase().includes(q)
        );
      })
    : sourceFilteredMessages;

  // Tab counts for the toggle
  const getTabCount = (t) => {
    if (t === "active") return isNotionMode ? notionClients.filter(c => c.profileStatus === "active").length : activeClients.length;
    if (t === "onboarding") return isNotionMode ? notionClients.filter(c => c.profileStatus === "onboarding").length : onboardingClients.length;
    if (t === "leads") return leadsCount;
    if (t === "messages") return allMessages.length;
    return 0;
  };

  return (
    <div>
      {/* Toggle + Search row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 4, background: tokens.surfaceAlt, borderRadius: 10, padding: 3 }}>
          {["active", "onboarding", "leads", "messages"].map(t => {
            const isActive = tab === t;
            const count = getTabCount(t);
            const tabLabel = t === "active" ? "Active" : t === "onboarding" ? "Onboarding" : t === "leads" ? "Leads" : "Messages";
            return (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "10px 24px", borderRadius: 8, fontSize: 14, cursor: "pointer",
                background: isActive ? tokens.surfaceEl : "transparent",
                border: "none", color: isActive ? tokens.text : tokens.textMute,
                fontFamily: "inherit", fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s", textTransform: "capitalize",
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                position: "relative",
              }}>
                {tabLabel}
                {t === "messages" && messagesUnreadCount > 0 ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: tokens.red, color: "#fff",
                    transition: "all 0.15s",
                    minWidth: 20, textAlign: "center",
                  }}>{messagesUnreadCount}</span>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: isActive ? tokens.accentGhost : `${tokens.textMute}18`,
                    color: isActive ? tokens.accent : tokens.textMute,
                    transition: "all 0.15s",
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 10,
          background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
          transition: "border-color 0.15s",
        }}>
          <span style={{ fontSize: 14, color: tokens.textMute, flexShrink: 0 }}>{"\u2315"}</span>
          <input
            value={tab === "messages" ? messagesSearchQuery : tab === "leads" ? leadsSearchQuery : searchQuery}
            onChange={e => tab === "messages" ? setMessagesSearchQuery(e.target.value) : tab === "leads" ? setLeadsSearchQuery(e.target.value) : setSearchQuery(e.target.value)}
            placeholder={tab === "messages" ? "Search conversations..." : tab === "leads" ? "Search leads..." : "Search clients..."}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 14, color: tokens.text, fontFamily: "inherit",
            }}
          />
          {(tab === "messages" ? messagesSearchQuery : tab === "leads" ? leadsSearchQuery : searchQuery) && (
            <button onClick={() => tab === "messages" ? setMessagesSearchQuery("") : tab === "leads" ? setLeadsSearchQuery("") : setSearchQuery("")} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: tokens.textMute, padding: 0, fontFamily: "inherit",
            }}>{"\u2715"}</button>
          )}
        </div>

      </div>

      {/* Summary bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 40, padding: "18px 28px",
        background: tokens.surfaceEl, borderRadius: 14, marginBottom: 32,
        border: `1px solid ${tokens.border}`,
        ...((!isNotionMode && !loading && tab !== "leads" && tab !== "messages") ? { opacity: 0.6 } : {}),
      }}>
        {tab === "messages" ? (
          <>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{allMessages.length}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Conversations</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: messagesUnreadCount > 0 ? tokens.red : tokens.green, letterSpacing: "-0.03em", lineHeight: 1 }}>{messagesUnreadCount}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Unread</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#4F8CFF", letterSpacing: "-0.03em", lineHeight: 1 }}>{ghlMessages.length}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>GHL</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#E01E5A", letterSpacing: "-0.03em", lineHeight: 1 }}>{slackMessages.length}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Slack</div>
            </div>
          </>
        ) : tab !== "leads" ? (
          <>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{totalClients}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Total Clients</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: avgHealth >= 70 ? tokens.green : avgHealth >= 40 ? tokens.amber : tokens.red, letterSpacing: "-0.03em", lineHeight: 1 }}>{avgHealth}%</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Avg Health</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.green, letterSpacing: "-0.03em", lineHeight: 1 }}>{activeCount}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Active</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.amber, letterSpacing: "-0.03em", lineHeight: 1 }}>{onboardingCount}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Onboarding</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.accent || tokens.blue || "#4F8CFF", letterSpacing: "-0.03em", lineHeight: 1 }}>{leadsCount}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Leads</div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{leadsCount}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Total Leads</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: unreadMessages > 0 ? tokens.red : tokens.green, letterSpacing: "-0.03em", lineHeight: 1 }}>{unreadMessages}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Unread Messages</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.green, letterSpacing: "-0.03em", lineHeight: 1 }}>{pipelineConversion}%</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>Pipeline Conversion</div>
            </div>
            <div style={{ width: 1, height: 40, background: tokens.border }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: tokens.accent || tokens.blue || "#4F8CFF", letterSpacing: "-0.03em", lineHeight: 1 }}>{newThisWeek}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 6 }}>New This Week</div>
            </div>
          </>
        )}
      </div>

      {/* Loading skeleton — shimmer cards */}
      {(tab === "messages" ? messagesLoading : tab === "leads" ? leadsLoading : loading) && (
        <>
          <style>{`
            @keyframes shimmer {
              0% { background-position: -400px 0; }
              100% { background-position: 400px 0; }
            }
            @keyframes skeletonFadeIn {
              from { opacity: 0; transform: translateY(12px) scale(0.97); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
              const shimmerBg = `linear-gradient(90deg, ${tokens.surfaceEl} 0%, ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"} 40%, ${tokens.surfaceEl} 80%)`;
              const bar = (w, h, mb = 0, delay = 0) => (
                <div style={{
                  height: h, width: w, borderRadius: h > 12 ? 8 : 4, marginBottom: mb,
                  background: shimmerBg,
                  backgroundSize: "800px 100%",
                  animation: `shimmer 1.6s ease-in-out infinite`,
                  animationDelay: `${delay}ms`,
                }} />
              );
              return (
                <div key={i} style={{
                  background: tokens.surfaceEl, borderRadius: 18, padding: "24px 26px",
                  border: `1px solid ${tokens.border}`,
                  animation: `skeletonFadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both`,
                }}>
                  {/* Header row — avatar + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: shimmerBg, backgroundSize: "800px 100%",
                      animation: `shimmer 1.6s ease-in-out infinite`,
                      animationDelay: `${i * 80}ms`, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      {bar("65%", 16, 6, i * 80)}
                      {bar("40%", 11, 0, i * 80 + 100)}
                    </div>
                    {/* Status badge */}
                    {bar(60, 22, 0, i * 80 + 50)}
                  </div>
                  {/* KPI row */}
                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    {[0, 1, 2].map(j => (
                      <div key={j} style={{
                        flex: 1, height: 56, borderRadius: 10,
                        background: shimmerBg, backgroundSize: "800px 100%",
                        animation: `shimmer 1.6s ease-in-out infinite`,
                        animationDelay: `${i * 80 + j * 120}ms`,
                      }} />
                    ))}
                  </div>
                  {/* Meta row */}
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    {bar(70, 11, 0, i * 80 + 200)}
                    {bar(80, 11, 0, i * 80 + 250)}
                    <div style={{ flex: 1 }} />
                    {bar(50, 11, 0, i * 80 + 300)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Client cards grid — Active / Onboarding tabs */}
      {!loading && tab !== "leads" && tab !== "messages" && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {clients.map((client, i) => (
            <ClientCard
              key={client.id || client.pageId || i}
              client={client}
              tokens={tokens}
              dark={dark}
              index={i}
              isNotionMode={isNotionMode}
              onClick={() => handleCardClick(client)}
              onResetPassword={async () => {
                if (!client.email) return alert("No email on file for this client.");
                if (!confirm(`Send a password reset link to ${client.email}?`)) return;
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch("/api/clients?action=reset-password", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
                    body: JSON.stringify({ email: client.email }),
                  });
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) alert("Failed: " + (json.error || res.status));
                  else alert(`Reset link sent to ${client.email}`);
                } catch (e) { alert("Failed: " + e.message); }
              }}
              onSetupAccount={() => setSetupTarget(client)}
            />
          ))}
          {clients.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "60px 0", color: tokens.textMute, fontSize: 14 }}>
              No {tab} clients found.
            </div>
          )}
        </div>
      )}

      {setupTarget && (
        <SetupAccountModal
          tokens={tokens}
          client={setupTarget}
          onClose={() => setSetupTarget(null)}
          onSuccess={() => { setSetupTarget(null); setSetupRefreshKey(k => k + 1); window.location.reload(); }}
        />
      )}

      {/* Lead cards grid — Leads tab */}
      {!leadsLoading && tab === "leads" && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {filteredLeads.map((lead, i) => (
            <LeadCard
              key={lead.id || i}
              lead={lead}
              tokens={tokens}
              dark={dark}
              index={i}
              smColors={smColors}
              stageColorMap={stageColorMap}
              sourceColorMap={sourceColorMap}
              onClick={() => setSelectedLead(lead)}
            />
          ))}
          {filteredLeads.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "60px 0", color: tokens.textMute, fontSize: 14 }}>
              {leadsEmpty && leadsRetryCount < 3 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                  <style>{`
                    @keyframes leadsSpinPulse {
                      0% { transform: rotate(0deg); opacity: 0.7; }
                      50% { opacity: 1; }
                      100% { transform: rotate(360deg); opacity: 0.7; }
                    }
                  `}</style>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    border: `3px solid ${tokens.border}`,
                    borderTopColor: tokens.accent || tokens.blue || "#4F8CFF",
                    animation: "leadsSpinPulse 1.2s linear infinite",
                  }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>
                    Loading leads from GoHighLevel...
                  </div>
                  <div style={{ fontSize: 13, color: tokens.textMute, opacity: 0.8 }}>
                    This may take a moment if the API is busy
                  </div>
                </div>
              ) : (
                "No leads found."
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages inbox — Messages tab */}
      {!messagesLoading && tab === "messages" && (
        <div style={{
          background: tokens.surfaceEl, borderRadius: 16,
          border: `1px solid ${tokens.border}`, overflow: "hidden",
        }}>
          {/* Source filter pills */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "12px 20px",
            borderBottom: `1px solid ${tokens.border}`,
          }}>
            {[
              { key: "all", label: "All", count: allMessages.length },
              { key: "ghl", label: "GHL", count: ghlMessages.length, color: "#4F8CFF" },
              { key: "slack", label: "Slack", count: slackMessages.length, color: "#E01E5A" },
            ].map(s => (
              <button key={s.key} onClick={() => setMsgSource(s.key)} style={{
                padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: "pointer", border: "none", fontFamily: "inherit",
                background: msgSource === s.key ? (s.color ? `${s.color}20` : tokens.accentGhost) : "transparent",
                color: msgSource === s.key ? (s.color || tokens.accent) : tokens.textMute,
                transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
              }}>
                {s.label}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6,
                  background: msgSource === s.key ? `${s.color || tokens.accent}15` : `${tokens.textMute}15`,
                  color: msgSource === s.key ? (s.color || tokens.accent) : tokens.textMute,
                }}>{s.count}</span>
              </button>
            ))}
          </div>
          {filteredMessages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMute, fontSize: 14 }}>
              No conversations found.
            </div>
          ) : (
            filteredMessages.map((convo, i) => {
              const isUnread = convo.unreadCount > 0;
              const isExpanded = expandedConvo === convo.id;
              const timeAgo = (() => {
                const now = new Date();
                const msgDate = new Date(convo.lastMessageDate);
                const diffMs = now - msgDate;
                const diffMin = Math.floor(diffMs / 60000);
                if (diffMin < 1) return "now";
                if (diffMin < 60) return `${diffMin}m ago`;
                const diffHr = Math.floor(diffMin / 60);
                if (diffHr < 24) return `${diffHr}h ago`;
                const diffDay = Math.floor(diffHr / 24);
                if (diffDay === 1) return "yesterday";
                return `${diffDay}d ago`;
              })();
              const initials = (convo.contactName || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

              return (
                <div key={convo.id} style={{ animation: `cardIn 0.3s ease ${i * 40}ms both` }}>
                  <div
                    onClick={() => setExpandedConvo(isExpanded ? null : convo.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "16px 20px",
                      background: isUnread ? `${tokens.accent}08` : "transparent",
                      borderBottom: `1px solid ${tokens.border}`,
                      cursor: "pointer",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                    onMouseLeave={e => e.currentTarget.style.background = isUnread ? `${tokens.accent}08` : "transparent"}
                  >
                    {/* Avatar with source indicator */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: convo.source === "slack" ? "#4A154B" : isUnread ? tokens.accent : tokens.accentGhost,
                        color: convo.source === "slack" ? "#fff" : isUnread ? "#fff" : tokens.accent,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700,
                      }}>
                        {convo.source === "slack" ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
                        ) : initials}
                      </div>
                      {/* Tiny source dot */}
                      <div style={{
                        position: "absolute", bottom: -1, right: -1,
                        width: 14, height: 14, borderRadius: "50%",
                        background: convo.source === "slack" ? "#E01E5A" : "#4F8CFF",
                        border: `2px solid ${tokens.surfaceEl}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 7, fontWeight: 800, color: "#fff",
                      }}>
                        {convo.source === "slack" ? "S" : "G"}
                      </div>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{
                          fontSize: 14, fontWeight: isUnread ? 700 : 500,
                          color: tokens.text, letterSpacing: "-0.01em",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {convo.contactName}
                        </span>
                        {convo.lastMessageDirection === "inbound" && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <polyline points="19 12 12 19 5 12"/><line x1="12" y1="19" x2="12" y2="5"/>
                          </svg>
                        )}
                        {convo.lastMessageDirection === "outbound" && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <polyline points="5 12 12 5 19 12"/><line x1="12" y1="5" x2="12" y2="19"/>
                          </svg>
                        )}
                      </div>
                      <div style={{
                        fontSize: 13, color: isUnread ? tokens.textSub : tokens.textMute,
                        fontWeight: isUnread ? 500 : 400,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        lineHeight: "18px",
                      }}>
                        {convo.lastMessageBody}
                      </div>
                    </div>

                    {/* Right side: timestamp + unread badge */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: tokens.textMute, whiteSpace: "nowrap" }}>
                        {timeAgo}
                      </span>
                      {isUnread && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                          background: tokens.red, color: "#fff", minWidth: 18, textAlign: "center",
                        }}>
                          {convo.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Expand chevron */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{
                      flexShrink: 0, transition: "transform 0.15s",
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{
                      padding: "16px 20px 20px 74px",
                      borderBottom: `1px solid ${tokens.border}`,
                      background: tokens.surface,
                      animation: "cardIn 0.2s ease both",
                    }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: tokens.textMute }}>
                          <span style={{ fontWeight: 600, color: tokens.textSub }}>Contact:</span> {convo.contactName}
                        </div>
                        <div style={{ fontSize: 12, color: tokens.textMute }}>
                          <span style={{ fontWeight: 600, color: tokens.textSub }}>Direction:</span> {convo.lastMessageDirection}
                        </div>
                        {convo.lastMessageType && (
                          <div style={{ fontSize: 12, color: tokens.textMute }}>
                            <span style={{ fontWeight: 600, color: tokens.textSub }}>Type:</span> {convo.lastMessageType}
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: tokens.textMute }}>
                          <span style={{ fontWeight: 600, color: tokens.textSub }}>Date:</span> {new Date(convo.lastMessageDate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 13, color: tokens.textSub, lineHeight: "20px",
                        padding: "12px 16px", background: tokens.surfaceEl, borderRadius: 10,
                        border: `1px solid ${tokens.border}`,
                      }}>
                        {convo.lastMessageBody}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Lead Detail Modal ── */}
      {selectedLead && (
        <div
          onClick={() => setSelectedLead(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(900px, 92vw)", maxHeight: "88vh", overflow: "auto",
              background: tokens.surfaceEl, borderRadius: 20,
              border: `1px solid ${tokens.border}`,
              boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
              animation: "cardIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {/* Modal header */}
            <div style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              padding: "24px 28px 20px", borderBottom: `1px solid ${tokens.border}`,
              position: "sticky", top: 0, background: tokens.surfaceEl, zIndex: 1,
              borderRadius: "20px 20px 0 0",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%",
                    background: tokens.accent, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 700,
                  }}>
                    {(selectedLead.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em" }}>
                      {selectedLead.name}
                    </div>
                    <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 2 }}>
                      {selectedLead.stage && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 6,
                          background: `${stageColorMap[selectedLead.stage] || tokens.accent}18`,
                          color: stageColorMap[selectedLead.stage] || tokens.accent,
                          marginRight: 8,
                        }}>{selectedLead.stage}</span>
                      )}
                      Added {selectedLead.createdAt ? new Date(selectedLead.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedLead(null)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: tokens.textMute, padding: "4px 8px", borderRadius: 8,
                fontFamily: "inherit", lineHeight: 1,
              }}>{"\u2715"}</button>
            </div>

            {leadLoading ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{
                  width: 28, height: 28, border: `3px solid ${tokens.border}`,
                  borderTopColor: tokens.accent, borderRadius: "50%",
                  animation: "spin 0.6s linear infinite", margin: "0 auto 12px",
                }} />
                <div style={{ fontSize: 13, color: tokens.textMute }}>Loading details...</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <div style={{ padding: "0 28px 28px" }}>
                {/* Contact info grid */}
                <div style={{
                  display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))", gap: 12,
                  padding: "20px 0 16px",
                }}>
                  {/* Phone */}
                  <InfoTile icon="phone" label="Phone" value={leadContact?.phone || selectedLead.phone || "—"} tokens={tokens} />
                  {/* Email */}
                  <InfoTile icon="email" label="Email" value={leadContact?.email || selectedLead.email || "—"} tokens={tokens} />
                  {/* Source */}
                  <InfoTile icon="source" label="Source" value={leadContact?.source || selectedLead.source || "—"} tokens={tokens} />
                  {/* Monetary Value */}
                  <InfoTile icon="money" label="Value" value={selectedLead.monetaryValue ? `$${selectedLead.monetaryValue.toLocaleString()}` : "—"} tokens={tokens} />
                  {/* Company */}
                  {leadContact?.companyName && (
                    <InfoTile icon="company" label="Company" value={leadContact.companyName} tokens={tokens} />
                  )}
                  {/* Location */}
                  {(leadContact?.city || leadContact?.state) && (
                    <InfoTile icon="location" label="Location" value={[leadContact.city, leadContact.state].filter(Boolean).join(", ")} tokens={tokens} />
                  )}
                  {/* Website */}
                  {leadContact?.website && (
                    <InfoTile icon="web" label="Website" value={leadContact.website} tokens={tokens} />
                  )}
                  {/* Timezone */}
                  {leadContact?.timezone && (
                    <InfoTile icon="clock" label="Timezone" value={leadContact.timezone} tokens={tokens} />
                  )}
                </div>

                {/* Tags */}
                {leadContact?.tags && leadContact.tags.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Tags</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {leadContact.tags.map((tag, i) => (
                        <span key={i} style={{
                          fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                          background: `${tokens.accent}12`, color: tokens.accent,
                        }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom Fields */}
                {leadContact?.customFields && leadContact.customFields.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Custom Fields</div>
                    <div style={{
                      display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(200px, 1fr))", gap: 8,
                    }}>
                      {leadContact.customFields.filter(f => f.value).map((f, i) => (
                        <div key={i} style={{
                          padding: "8px 12px", borderRadius: 8,
                          background: `${tokens.textMute}08`, border: `1px solid ${tokens.border}`,
                        }}>
                          <div style={{ fontSize: 10, color: tokens.textMute, fontWeight: 600, marginBottom: 2 }}>{f.name || f.key || `Field ${i + 1}`}</div>
                          <div style={{ fontSize: 13, color: tokens.text, fontWeight: 500 }}>{String(f.value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* DND Status */}
                {leadContact?.dnd && (
                  <div style={{
                    padding: "10px 14px", borderRadius: 10, marginBottom: 16,
                    background: `${tokens.red}10`, border: `1px solid ${tokens.red}25`,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ fontSize: 16 }}>{"\u26D4"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: tokens.red }}>Do Not Disturb is enabled</span>
                  </div>
                )}

                {/* Conversation History */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Conversation History {leadConversations.length > 0 && `(${leadConversations.length})`}
                  </div>

                  {leadMessages.length > 0 ? (
                    <div style={{
                      background: tokens.surface, borderRadius: 14,
                      border: `1px solid ${tokens.border}`, overflow: "hidden",
                      maxHeight: 400, overflowY: "auto",
                    }}>
                      {leadMessages.map((msg, i) => {
                        const isInbound = msg.direction === "inbound";
                        const msgDate = msg.dateAdded ? new Date(msg.dateAdded) : null;
                        return (
                          <div key={msg.id || i} style={{
                            display: "flex", gap: 12, padding: "14px 18px",
                            borderBottom: i < leadMessages.length - 1 ? `1px solid ${tokens.border}` : "none",
                            background: isInbound ? `${tokens.accent}04` : "transparent",
                          }}>
                            {/* Direction indicator */}
                            <div style={{
                              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                              background: isInbound ? `${tokens.accent}15` : `${tokens.green}15`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              marginTop: 2,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isInbound ? tokens.accent : tokens.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                {isInbound ? (
                                  <><polyline points="19 12 12 19 5 12"/><line x1="12" y1="19" x2="12" y2="5"/></>
                                ) : (
                                  <><polyline points="5 12 12 5 19 12"/><line x1="12" y1="5" x2="12" y2="19"/></>
                                )}
                              </svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: isInbound ? tokens.accent : tokens.green }}>
                                  {isInbound ? "Received" : "Sent"}
                                </span>
                                {msg.type && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                                    background: `${tokens.textMute}12`, color: tokens.textMute,
                                  }}>
                                    {msg.type === "TYPE_SMS" ? "SMS" : msg.type === "TYPE_EMAIL" ? "Email" : msg.type === "TYPE_CALL" ? "Call" : msg.type.replace("TYPE_", "")}
                                  </span>
                                )}
                                {msgDate && (
                                  <span style={{ fontSize: 11, color: tokens.textMute, marginLeft: "auto" }}>
                                    {msgDate.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                  </span>
                                )}
                              </div>
                              <div style={{
                                fontSize: 13, color: tokens.textSub, lineHeight: "20px",
                                wordBreak: "break-word",
                              }}>
                                {msg.body || <span style={{ fontStyle: "italic", color: tokens.textMute }}>No content</span>}
                              </div>
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                  {msg.attachments.map((a, ai) => (
                                    <span key={ai} style={{
                                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                                      background: `${tokens.accent}12`, color: tokens.accent,
                                    }}>{"\uD83D\uDCCE"} Attachment</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : leadConversations.length > 0 ? (
                    <div style={{ padding: "30px 0", textAlign: "center", color: tokens.textMute, fontSize: 13 }}>
                      {leadConversations.length} conversation{leadConversations.length > 1 ? "s" : ""} found — no messages loaded yet.
                    </div>
                  ) : (
                    <div style={{
                      padding: "30px 0", textAlign: "center", color: tokens.textMute, fontSize: 13,
                      background: tokens.surface, borderRadius: 12, border: `1px solid ${tokens.border}`,
                    }}>
                      No conversations yet with this lead.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

/* ── Info Tile (for Lead Modal) ──────────────────────────────── */
function InfoTile({ icon, label, value, tokens }) {
  const iconMap = {
    phone: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
    email: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    source: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    money: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    company: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/></svg>,
    location: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    web: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", borderRadius: 10,
      background: `${tokens.textMute}06`, border: `1px solid ${tokens.border}`,
    }}>
      <div style={{ flexShrink: 0, opacity: 0.7 }}>{iconMap[icon]}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: tokens.textMute, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{
          fontSize: 13, color: tokens.text, fontWeight: 500, marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{value}</div>
      </div>
    </div>
  );
}

/* ── Lead Card ────────────────────────────────────────────────── */
function LeadCard({ lead, tokens, dark, index, smColors, stageColorMap, sourceColorMap, onClick }) {
  const [hov, setHov] = useState(false);

  const stageColor = stageColorMap[lead.stage] || tokens.textMute;
  const sourceColor = sourceColorMap[lead.source] || tokens.textMute;
  const smColor = smColors[lead.assignedSM] || tokens.textMute;

  // Check if this lead has unread conversations
  const hasUnread = false;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        position: "relative",
        background: tokens.surfaceEl,
        border: `1px solid ${hov ? tokens.borderStr : tokens.border}`,
        borderRadius: 16,
        cursor: "pointer",
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        transform: hov ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hov
          ? tokens.cardHover
          : tokens.cardShadow,
        padding: "22px 24px",
        animation: `cardIn 0.3s ease ${index * 40}ms both`,
      }}
    >
      {/* Unread indicator */}
      {hasUnread && (
        <div style={{
          position: "absolute", top: 12, right: 12,
          width: 8, height: 8, borderRadius: "50%",
          background: tokens.red,
          animation: "gentlePulse 2s ease-in-out infinite",
        }}>
          <div style={{ position: "absolute", inset: -3, borderRadius: "50%", background: tokens.red, animation: "dotPing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite", opacity: 0.4 }} />
        </div>
      )}

      {/* Header: name + stage badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: tokens.text,
            letterSpacing: "-0.02em", lineHeight: "22px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {lead.name}
          </div>
          {lead.phone && (
            <div style={{ fontSize: 13, color: tokens.textSub, marginTop: 3 }}>{lead.phone}</div>
          )}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
          background: `${stageColor}18`, color: stageColor, flexShrink: 0, marginLeft: 10,
        }}>
          {lead.stage}
        </span>
      </div>

      {/* Source badge + client */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 14 }}>
        {lead.source && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background: `${sourceColor}15`, color: sourceColor,
          }}>
            {lead.source}
          </span>
        )}
        {lead.client && (
          <div style={{ fontSize: 12, color: tokens.textMute }}>
            <span style={{ fontWeight: 600, color: tokens.textSub }}>{lead.client}</span>
          </div>
        )}
      </div>

      {/* Notes snippet */}
      {lead.notes && (
        <div style={{
          fontSize: 13, color: tokens.textSub, lineHeight: "19px",
          marginBottom: 14, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {lead.notes.length > 120 ? lead.notes.slice(0, 120) + "..." : lead.notes}
        </div>
      )}

      {/* Bottom row: SM avatar + last activity */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        borderTop: `1px solid ${tokens.border}`, paddingTop: 12,
      }}>
        {lead.assignedSM && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: smColor, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 11, fontWeight: 700,
              color: "#fff", flexShrink: 0,
            }}>
              {lead.assignedSM.charAt(0)}
            </div>
            <span style={{ fontSize: 12, color: tokens.textSub, fontWeight: 500 }}>{lead.assignedSM}</span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {lead.lastActivity && (
          <span style={{ fontSize: 12, color: tokens.textMute }}>{lead.lastActivity}</span>
        )}
      </div>
    </div>
  );
}

/* ── Client Card — KPI-forward ────────────────────────────────── */
function ClientCard({ client, tokens, dark, index, isNotionMode, onClick, onResetPassword, onSetupAccount }) {
  const [hov, setHov] = useState(false);

  const isOnboarding = client.profileStatus === "onboarding";
  const statusColor = isOnboarding ? tokens.amber : tokens.green;
  const statusLabel = isOnboarding ? "Onboarding" : "Active";

  // Resolve display fields
  const businessName = client.businessName || client.title || client.name || "Unnamed";
  const clientName = client.clientName || client.owner || client.owner_name || "";
  const manager = client.manager || "";
  // Tier hidden along with health — both were the uniform "Foundations"/"95%"
  // placeholder. Restore by removing this override once a real tier exists.
  const program = "";
  const latestUpdate = client.latestUpdate || "";
  const activeClientsCount = client.activeClients;
  const monthlyRevenue = client.monthlyRevenue;
  // Health + tier intentionally hidden until real values exist (placeholder
  // mock was uniformly 95% / "Foundations"). Re-enable by removing these
  // overrides once Supabase has real columns + real data.
  const health = null;
  const healthStatus = null;
  const lastInteraction = client.lastCallDate
    || (client.callLog && client.callLog.length > 0 ? client.callLog[client.callLog.length - 1].date : null)
    || client._propData?.lastCallDate
    || null;
  const alertCount = client._propData?.alerts?.length || client.alerts?.length || 0;

  const healthColor = healthStatus === "healthy" ? tokens.green : healthStatus === "at-risk" ? tokens.amber : healthStatus === "critical" ? tokens.red : tokens.textMute;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        position: "relative",
        background: tokens.surfaceEl,
        border: `1px solid ${hov ? tokens.borderStr : tokens.border}`,
        borderRadius: 16,
        cursor: "pointer",
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        transform: hov ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hov ? tokens.cardHover : tokens.cardShadow,
        padding: 0,
        animation: `cardIn 0.3s ease ${index * 40}ms both`,
      }}
    >
      {/* Health bar accent at top */}
      {health != null && (
        <div style={{
          height: 3, borderRadius: "16px 16px 0 0",
          background: `linear-gradient(90deg, ${healthColor} ${health}%, ${tokens.border} ${health}%)`,
        }} />
      )}

      <div style={{ padding: "20px 22px 18px" }}>
        {/* Header: name + status badge */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {health != null && (
                <div style={{
                  width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                  background: healthColor,
                  boxShadow: `0 0 6px ${healthColor}60`,
                }} />
              )}
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em", lineHeight: "22px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {businessName}
              </div>
            </div>
            {clientName && (
              <div style={{ fontSize: 13, color: tokens.textSub, marginTop: 3, paddingLeft: health != null ? 17 : 0 }}>{clientName}</div>
            )}
            {client.email && (
              <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 2, paddingLeft: health != null ? 17 : 0, fontFamily: "monospace" }}>{client.email}</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0, marginLeft: 10 }}>
            {(onResetPassword || onSetupAccount) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (client.auth_user_id) onResetPassword?.();
                  else onSetupAccount?.();
                }}
                title={client.auth_user_id
                  ? `Send password reset link to ${client.email}`
                  : `Set up a portal login for ${client.name}`}
                style={{
                  fontSize: 10, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
                  background: client.auth_user_id ? `${tokens.accent}1A` : `${tokens.green}1A`,
                  color: client.auth_user_id ? tokens.accent : tokens.green,
                  border: `1px solid ${client.auth_user_id ? tokens.accent : tokens.green}33`,
                  cursor: "pointer",
                  letterSpacing: 0.4, textTransform: "uppercase",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >{client.auth_user_id ? "🔑 Reset password" : "✉ Set up account"}</button>
            )}
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
              background: `${statusColor}18`, color: statusColor,
            }}>
              {statusLabel}
            </span>
            {alertCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${tokens.red}15`, color: tokens.red }}>
                {alertCount} alert{alertCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* KPI grid — the main visual */}
        {(() => {
          // Format revenue: only show clean value if numeric or parseable
          const fmtRevenue = (() => {
            if (monthlyRevenue == null) return null;
            if (typeof monthlyRevenue === "number") return `$${monthlyRevenue >= 1000 ? (monthlyRevenue / 1000).toFixed(1) + "k" : monthlyRevenue}`;
            const match = String(monthlyRevenue).match(/[\d,]+\.?\d*/);
            const num = match ? parseFloat(match[0].replace(/,/g, "")) : NaN;
            if (!isNaN(num) && num > 0) return `$${num >= 1000 ? (num / 1000).toFixed(1) + "k" : num}`;
            return null; // Non-numeric string — skip the big tile
          })();
          // Format clients: only show if numeric
          const fmtClients = (() => {
            if (activeClientsCount == null) return null;
            if (typeof activeClientsCount === "number") return String(activeClientsCount);
            const match = String(activeClientsCount).match(/\d+/);
            const num = match ? parseInt(match[0]) : NaN;
            if (!isNaN(num) && num > 0) return String(num);
            return null;
          })();
          const hasKpis = health != null || fmtRevenue || fmtClients;
          const kpiCount = [health != null, !!fmtRevenue, !!fmtClients].filter(Boolean).length;

          return hasKpis ? (
            <div style={{
              display: "grid", gridTemplateColumns: kpiCount === 1 ? "1fr" : kpiCount === 2 ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 10,
              marginBottom: 14,
            }}>
              {health != null && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: `${healthColor}0C`, border: `1px solid ${healthColor}20`,
                  textAlign: "center", overflow: "hidden",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: healthColor, letterSpacing: "-0.03em", lineHeight: 1 }}>{health}%</div>
                  <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 4, fontWeight: 500 }}>Health</div>
                </div>
              )}
              {fmtRevenue && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: `${tokens.green}0C`, border: `1px solid ${tokens.green}20`,
                  textAlign: "center", overflow: "hidden",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: tokens.green, letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtRevenue}</div>
                  <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 4, fontWeight: 500 }}>Revenue/mo</div>
                </div>
              )}
              {fmtClients && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: `${tokens.accent || "#4F8CFF"}0C`, border: `1px solid ${tokens.accent || "#4F8CFF"}20`,
                  textAlign: "center", overflow: "hidden",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: tokens.accent || "#4F8CFF", letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtClients}</div>
                  <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 4, fontWeight: 500 }}>Clients</div>
                </div>
              )}
            </div>
          ) : manager ? (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14,
            }}>
              <div style={{
                padding: "10px 12px", borderRadius: 10,
                background: `${tokens.textMute}08`, textAlign: "center",
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: tokens.textSub }}>{manager}</div>
                <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 2 }}>Manager</div>
              </div>
              {program && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: `${tokens.textMute}08`, textAlign: "center",
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tokens.textSub }}>{program}</div>
                  <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 2 }}>Tier</div>
                </div>
              )}
            </div>
          ) : null;
        })()}

        {/* Meta row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: latestUpdate ? 10 : 0 }}>
          {manager && health != null && (
            <div style={{ fontSize: 12, color: tokens.textMute }}>
              <span style={{ fontWeight: 600, color: tokens.textSub }}>SM:</span> {manager}
            </div>
          )}
          {program && (
            <div style={{ fontSize: 12, color: tokens.textMute }}>
              <span style={{ fontWeight: 600, color: tokens.textSub }}>Tier:</span> {program}
            </div>
          )}
          {lastInteraction && (
            <div style={{ fontSize: 12, color: tokens.textMute }}>
              <span style={{ fontWeight: 600, color: tokens.textSub }}>Last Call:</span> {lastInteraction}
            </div>
          )}
        </div>

        {/* Latest update snippet */}
        {latestUpdate && (
          <div style={{
            fontSize: 12, color: tokens.textMute, lineHeight: "18px",
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            padding: "8px 10px", borderRadius: 8, background: `${tokens.textMute}08`,
          }}>
            {latestUpdate.length > 120 ? latestUpdate.slice(0, 120) + "..." : latestUpdate}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Setup-account modal (sends an invite email to a client) ───
function SetupAccountModal({ tokens, client, onClose, onSuccess }) {
  const [ownerName, setOwnerName] = useState(client.owner_name || "");
  const [email, setEmail] = useState(client.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/clients?action=setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id, owner_name: ownerName, email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || `HTTP ${res.status}`); setBusy(false); return; }
      setSent({ name: client.name, email });
      setBusy(false);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tokens.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = { width: "100%", padding: "10px 12px", marginBottom: 14, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, fontSize: 14, fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 28 }}>
        {!sent ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>Send invite — {client.name}</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>The client gets an email with a link. They'll choose their own password and log in. We never see it.</div>

            <label style={labelStyle}>Owner name</label>
            <input style={inputStyle} value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Jordan Cole" />

            <label style={labelStyle}>Owner email</label>
            <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@academy.com" type="email" />

            {error && <div style={{ color: tokens.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "10px 16px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={submit} disabled={busy} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>✓ Invite sent</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>
              {sent.name} will receive an email at <b style={{ color: tokens.text }}>{sent.email}</b> with a link to set their password and log in. The link expires in 24 hours; if they miss it, use <b style={{ color: tokens.text }}>Reset password</b> on the card to send a fresh one.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onSuccess} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
