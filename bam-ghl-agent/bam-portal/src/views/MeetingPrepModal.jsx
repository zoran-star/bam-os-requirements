import { useState, useEffect, useCallback } from "react";
import { fetchActionItems, fetchClientProfile } from "../services/notionService";
import { fetchAlerts } from "../services/stripeService";
import { fetchTasks } from "../services/asanaService";
import { fetchContacts, fetchPipelines, fetchConversations } from "../services/ghlService";

// Map portal client names → GHL location names (shared with ClientModal)
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

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function SkeletonLine({ tokens, width = "100%", height = 10 }) {
  return (
    <div style={{
      width, height, borderRadius: 4,
      background: `linear-gradient(90deg, ${tokens.surfaceEl} 0%, ${tokens.border} 50%, ${tokens.surfaceEl} 100%)`,
      backgroundSize: "200% 100%",
      animation: "prep-shimmer 1.4s ease-in-out infinite",
    }} />
  );
}

function CallSummarySkeleton({ tokens }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SkeletonLine tokens={tokens} width="90%" height={11} />
        <SkeletonLine tokens={tokens} width="65%" height={11} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SkeletonLine tokens={tokens} width="30%" height={8} />
        <SkeletonLine tokens={tokens} width="85%" height={9} />
        <SkeletonLine tokens={tokens} width="75%" height={9} />
        <SkeletonLine tokens={tokens} width="80%" height={9} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          border: `1.5px solid ${tokens.accent}`, borderTopColor: "transparent",
          animation: "prep-spin 0.8s linear infinite",
        }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>
          AI SUMMARIZING{"\u2026"}
        </span>
      </div>
    </div>
  );
}

function SectionLabel({ tokens, children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: tokens.textMute,
      letterSpacing: "0.04em", marginBottom: 12,
    }}>{children}</div>
  );
}

function ActionItemRow({ item, tokens }) {
  const isOpen = item.status !== "Done";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 12px", borderRadius: 8,
      background: isOpen ? "transparent" : tokens.surfaceEl,
      opacity: isOpen ? 1 : 0.55,
      marginBottom: 4,
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
        background: isOpen ? "transparent" : tokens.green,
        border: `1.5px solid ${isOpen ? tokens.borderStr : tokens.green}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {!isOpen && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700 }}>{"\u2713"}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: isOpen ? 500 : 400, color: isOpen ? tokens.text : tokens.textMute,
          textDecoration: isOpen ? "none" : "line-through",
          lineHeight: 1.4,
        }}>{item.action}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          {item.urgency === "Urgent" && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
              background: tokens.redSoft, color: tokens.red,
            }}>Urgent</span>
          )}
          {item.reminderDate && (
            <span style={{ fontSize: 11, color: tokens.textMute }}>Due {item.reminderDate}</span>
          )}
          {item.sourceCall && (
            <span style={{ fontSize: 11, color: tokens.textMute }}>{"\u00b7"} {item.sourceCall}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MeetingPrepModal({ event, tokens, dark, onClose, onOpenClient }) {
  const [ready, setReady] = useState(false);
  const [actionItems, setActionItems] = useState([]);
  const [clientProfile, setClientProfile] = useState(null);
  const [prepNotes, setPrepNotes] = useState("");
  const [copied, setCopied] = useState(false);
  const [missedPayments, setMissedPayments] = useState([]);
  const [asanaTasks, setAsanaTasks] = useState([]);
  const [ghlKpis, setGhlKpis] = useState(null);
  const [callSummaries, setCallSummaries] = useState({}); // pageId → { summary, bullets, actionItems, thingsToKnow, loading }
  const [expandedCalls, setExpandedCalls] = useState({}); // pageId → bool

  const clientName = event?.client || "";
  const storageKey = event?.id ? `meetingPrep-${event.id}` : null;

  // Animate in
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Load prep notes from localStorage
  useEffect(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) setPrepNotes(saved);
    }
  }, [storageKey]);

  // Save prep notes to localStorage on change
  useEffect(() => {
    if (storageKey && prepNotes) {
      localStorage.setItem(storageKey, prepNotes);
    }
  }, [storageKey, prepNotes]);

  // Fetch action items, client profile, Stripe alerts, Asana tasks, GHL KPIs
  useEffect(() => {
    let cancelled = false;

    // Action items from Notion
    fetchActionItems().then(({ data }) => {
      if (!cancelled && data) {
        const filtered = data.filter(
          (i) => i.client && clientName && i.client.toLowerCase() === clientName.toLowerCase()
        );
        setActionItems(filtered);
      }
    });

    // Client profile from Notion
    if (clientName) {
      fetchClientProfile(clientName).then(({ data }) => {
        if (!cancelled && data) setClientProfile(data);
      });
    }

    // Stripe alerts — filter for this client's missed payments
    fetchAlerts().then(({ data }) => {
      if (!cancelled && data) {
        const clientLower = clientName.toLowerCase();
        const failed = (data.failedPayments || []).filter(
          p => p.customerName && p.customerName.toLowerCase().includes(clientLower)
        );
        const pastDue = (data.pastDueInvoices || []).filter(
          p => p.customerName && p.customerName.toLowerCase().includes(clientLower)
        );
        setMissedPayments([...failed.map(p => ({ ...p, type: "failed" })), ...pastDue.map(p => ({ ...p, type: "past_due" }))]);
      }
    });

    // Asana tasks — outstanding tasks mentioning this client
    fetchTasks({ mode: "user" }).then(({ data }) => {
      if (!cancelled && data) {
        const clientLower = clientName.toLowerCase();
        const relevant = data.filter(t =>
          !t.completed && (
            (t.title && t.title.toLowerCase().includes(clientLower)) ||
            (t.project && t.project.toLowerCase().includes(clientLower)) ||
            (t.notes && t.notes.toLowerCase().includes(clientLower))
          )
        );
        setAsanaTasks(relevant);
      }
    });

    // GHL KPIs for this client
    const ghlLocation = CLIENT_GHL_MAP[clientName];
    if (ghlLocation) {
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
        const convos = convosRes.data || [];

        const wonCount = opps.filter(o => (o.status || "").toLowerCase() === "won" || (o.stageName || "").toLowerCase().includes("won")).length;
        const conversionRate = opps.length > 0 ? Math.round((wonCount / opps.length) * 100) : 0;

        setGhlKpis({
          totalContacts,
          pipelineLeads: opps.length,
          wonCount,
          conversionRate,
          conversations: convos.length,
        });
      }).catch(() => {});
    }

    return () => { cancelled = true; };
  }, [clientName]);

  const theirItems = actionItems.filter((i) => i.owner === "Client");
  const ourItems = actionItems.filter((i) => i.owner !== "Client");

  // Extract last 3 calls from call log
  const callLog = clientProfile?.callLog;
  const recentCalls = Array.isArray(callLog) ? callLog.slice(0, 3) : (callLog ? [callLog] : []);

  // Fetch AI summaries for each call that has fullNotes
  useEffect(() => {
    let cancelled = false;
    const callsToSummarize = recentCalls.filter(c =>
      c && typeof c === "object" && c.pageId && c.fullNotes && c.fullNotes.length > 40 && !callSummaries[c.pageId]
    );
    if (callsToSummarize.length === 0) return;

    // Mark as loading
    setCallSummaries(prev => {
      const next = { ...prev };
      callsToSummarize.forEach(c => { next[c.pageId] = { loading: true }; });
      return next;
    });

    callsToSummarize.forEach(async (call) => {
      try {
        const res = await fetch("/api/ai/search?action=summarize-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: call.fullNotes, title: call.title || "" }),
        });
        const data = await res.json();
        if (cancelled) return;
        setCallSummaries(prev => ({
          ...prev,
          [call.pageId]: { ...data, loading: false },
        }));
      } catch {
        if (cancelled) return;
        setCallSummaries(prev => ({
          ...prev,
          [call.pageId]: { loading: false, summary: "", bullets: [], actionItems: [], thingsToKnow: [] },
        }));
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientProfile]);

  const latestUpdate = clientProfile?.latestUpdate;
  const info = clientProfile?.info;

  // Find next-steps-like text in a call entry
  const extractNextSteps = (text) => {
    if (!text) return null;
    const patterns = [/plan for next call[:\s]*([\s\S]*?)(?:\n\n|$)/i, /next steps[:\s]*([\s\S]*?)(?:\n\n|$)/i];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1].trim();
    }
    return null;
  };

  const getCallText = (call) => typeof call === "string" ? call : call?.notes || call?.summary || "";
  const latestCallText = recentCalls.length > 0 ? getCallText(recentCalls[0]) : "";
  const nextSteps = extractNextSteps(latestCallText);

  // Backwards compat aliases
  const callText = latestCallText;

  // KPI-like fields from info
  const kpiFields = info
    ? Object.entries(info).filter(([k]) =>
        /kpi|metric|revenue|leads|conversion|retention|growth|roas|cpl|spend/i.test(k)
      )
    : [];

  // Build text summary for clipboard
  const buildPrepBrief = useCallback(() => {
    const lines = [];
    lines.push(`Meeting Prep: ${clientName}`);
    lines.push(`${fmtDate(event.startTime)} ${fmtTime(event.startTime)} - ${fmtTime(event.endTime)}`);
    lines.push("");

    if (ourItems.length > 0 || theirItems.length > 0) {
      lines.push("--- ACTION ITEMS ---");
      if (theirItems.length > 0) {
        lines.push("Their Items:");
        theirItems.forEach((i) => lines.push(`  [${i.status}] ${i.action}`));
      }
      if (ourItems.length > 0) {
        lines.push("Our Items:");
        ourItems.forEach((i) => lines.push(`  [${i.status}] ${i.action}`));
      }
      lines.push("");
    }

    if (recentCalls.length > 0) {
      lines.push(`--- CALL NOTES (Last ${recentCalls.length}) ---`);
      recentCalls.forEach((call, idx) => {
        const text = getCallText(call);
        const isObj = typeof call === "object";
        const pageId = isObj ? call.pageId : null;
        const date = isObj ? call.date : null;
        const title = isObj ? call.title : null;
        const s = pageId ? callSummaries[pageId] : null;
        lines.push(date ? `[${date}${title ? ` — ${title}` : ""}]` : `[Call ${idx + 1}]`);
        if (s && !s.loading && (s.summary || s.bullets?.length)) {
          if (s.summary) lines.push(s.summary);
          if (s.bullets?.length) { lines.push("Key points:"); s.bullets.forEach(b => lines.push(`  • ${b}`)); }
          if (s.actionItems?.length) { lines.push("Action items:"); s.actionItems.forEach(a => lines.push(`  • ${a}`)); }
          if (s.thingsToKnow?.length) { lines.push("Things to know:"); s.thingsToKnow.forEach(t => lines.push(`  • ${t}`)); }
        } else if (text) {
          lines.push(text.slice(0, 400));
        }
        lines.push("");
      });
    }
    if (nextSteps) {
      lines.push("--- NEXT STEPS FROM LAST CALL ---");
      lines.push(nextSteps);
      lines.push("");
    }
    if (ghlKpis) {
      lines.push("--- KPI SNAPSHOT (GHL) ---");
      lines.push(`Contacts: ${ghlKpis.totalContacts} | Pipeline: ${ghlKpis.pipelineLeads} | Won: ${ghlKpis.wonCount} | Conv: ${ghlKpis.conversionRate}%`);
      lines.push("");
    }
    if (missedPayments.length > 0) {
      lines.push("--- PAYMENT ALERTS ---");
      missedPayments.forEach(p => {
        lines.push(`  [${p.type === "failed" ? "FAILED" : "PAST DUE"}] $${(p.amount / 100).toLocaleString()} — ${p.failureMessage || p.dueDate || ""}`);
      });
      lines.push("");
    }
    if (asanaTasks.length > 0) {
      lines.push(`--- OUTSTANDING TASKS (${asanaTasks.length}) ---`);
      asanaTasks.forEach(t => lines.push(`  [ ] ${t.title || t.name}${t.dueDate ? ` (due ${t.dueDate})` : ""}`));
      lines.push("");
    }
    if (latestUpdate) {
      lines.push("--- LATEST UPDATE ---");
      lines.push(typeof latestUpdate === "string" ? latestUpdate : JSON.stringify(latestUpdate));
      lines.push("");
    }
    if (prepNotes.trim()) {
      lines.push("--- PREP NOTES ---");
      lines.push(prepNotes.trim());
    }
    return lines.join("\n");
  }, [clientName, event, ourItems, theirItems, recentCalls, nextSteps, latestUpdate, prepNotes, ghlKpis, missedPayments, asanaTasks, callSummaries]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPrepBrief());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = buildPrepBrief();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!event) return null;

  const start = new Date(event.startTime);
  const timeStr = `${fmtDate(event.startTime)} ${fmtTime(event.startTime)} \u2013 ${fmtTime(event.endTime)}`;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1500,
      background: dark ? "rgba(0,0,0,0.80)" : "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "32px 24px 24px", backdropFilter: "blur(12px)",
      opacity: ready ? 1 : 0, transition: "opacity 0.2s",
      overflowY: "auto",
    }}>
      <style>{`
        @keyframes prep-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes prep-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 640, maxWidth: "94vw", maxHeight: "calc(100vh - 56px)",
        background: tokens.surface, borderRadius: 20,
        border: `1px solid ${tokens.border}`,
        boxShadow: `0 40px 100px rgba(0,0,0,${dark ? 0.7 : 0.25})`,
        display: "flex", flexDirection: "column", overflow: "hidden",
        transform: ready ? "translateY(0) scale(1)" : "translateY(16px) scale(0.975)",
        transition: "transform 0.22s cubic-bezier(0.34,1.3,0.64,1)",
      }}>
        {/* Header */}
        <div style={{
          padding: "24px 28px 20px",
          borderBottom: `1px solid ${tokens.border}`,
          display: "flex", alignItems: "flex-start", gap: 14,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                padding: "3px 9px", borderRadius: 6,
                background: tokens.accentGhost, color: tokens.accent,
              }}>MEETING PREP</span>
            </div>
            <h2 style={{
              fontSize: 20, fontWeight: 700, color: tokens.text,
              letterSpacing: "-0.02em", margin: 0, lineHeight: 1.3,
            }}>{clientName || event.title}</h2>
            <div style={{
              fontSize: 13, color: tokens.textSub, marginTop: 6,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {timeStr}
            </div>
            {event.hangoutLink && (
              <a href={event.hangoutLink} target="_blank" rel="noopener noreferrer" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                marginTop: 12, padding: "8px 16px", borderRadius: 8,
                background: tokens.accent, color: "#08080A",
                fontSize: 13, fontWeight: 600, textDecoration: "none",
                transition: "opacity 0.12s",
              }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14"/><rect x="1" y="6" width="14" height="12" rx="2" ry="2"/></svg>
                Join Meeting
              </a>
            )}
          </div>
          <div onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: tokens.textSub, fontSize: 20, fontWeight: 500,
            transition: "all 0.15s",
            background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
            border: `1px solid ${tokens.border}`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = tokens.text; e.currentTarget.style.background = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = tokens.textSub; e.currentTarget.style.background = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; }}
          >{"\u00d7"}</div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

          {/* Section 1 - Action Items */}
          <div style={{ marginBottom: 28 }}>
            <SectionLabel tokens={tokens}>ACTION ITEMS</SectionLabel>
            {actionItems.length === 0 ? (
              <div style={{
                padding: "20px 16px", borderRadius: 10,
                background: tokens.surfaceEl, textAlign: "center",
                fontSize: 13, color: tokens.textMute,
              }}>No action items found for {clientName || "this client"}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Their items */}
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: tokens.textSub,
                    marginBottom: 8, paddingLeft: 4,
                  }}>Their Action Items ({theirItems.length})</div>
                  <div style={{
                    background: tokens.surfaceEl, borderRadius: 10,
                    padding: theirItems.length > 0 ? "8px 4px" : "16px",
                    minHeight: 60,
                    border: `1px solid ${tokens.border}`,
                  }}>
                    {theirItems.length === 0 ? (
                      <div style={{ fontSize: 12, color: tokens.textMute, textAlign: "center" }}>None</div>
                    ) : (
                      theirItems.map((item) => <ActionItemRow key={item.id} item={item} tokens={tokens} />)
                    )}
                  </div>
                </div>
                {/* Our items */}
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: tokens.textSub,
                    marginBottom: 8, paddingLeft: 4,
                  }}>Our Action Items ({ourItems.length})</div>
                  <div style={{
                    background: tokens.surfaceEl, borderRadius: 10,
                    padding: ourItems.length > 0 ? "8px 4px" : "16px",
                    minHeight: 60,
                    border: `1px solid ${tokens.border}`,
                  }}>
                    {ourItems.length === 0 ? (
                      <div style={{ fontSize: 12, color: tokens.textMute, textAlign: "center" }}>None</div>
                    ) : (
                      ourItems.map((item) => <ActionItemRow key={item.id} item={item} tokens={tokens} />)
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2 - Last 3 Call Notes */}
          <div style={{ marginBottom: 28 }}>
            <SectionLabel tokens={tokens}>CALL NOTES {recentCalls.length > 0 ? `(Last ${recentCalls.length})` : ""}</SectionLabel>
            {recentCalls.length === 0 && !latestUpdate ? (
              <div style={{
                padding: "20px 16px", borderRadius: 10,
                background: tokens.surfaceEl, textAlign: "center",
                fontSize: 13, color: tokens.textMute,
              }}>No call notes yet for this client.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {recentCalls.map((call, idx) => {
                  const text = getCallText(call);
                  const isObj = typeof call === "object";
                  const callDate = isObj ? call.date : null;
                  const callTitle = isObj ? call.title : null;
                  const pageId = isObj ? call.pageId : null;
                  const fullNotes = isObj ? call.fullNotes : "";
                  const summary = pageId ? callSummaries[pageId] : null;
                  const isExpanded = pageId ? !!expandedCalls[pageId] : false;
                  const hasStructured = summary && !summary.loading && (
                    summary.summary || (summary.bullets?.length || 0) > 0 ||
                    (summary.actionItems?.length || 0) > 0 || (summary.thingsToKnow?.length || 0) > 0
                  );
                  if (!text && !fullNotes) return null;
                  return (
                    <div key={idx} style={{
                      padding: "14px 18px", borderRadius: 10,
                      background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                      borderLeft: idx === 0 ? `3px solid ${tokens.accent}` : undefined,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        {idx === 0 && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                            background: tokens.accentGhost, color: tokens.accent, letterSpacing: "0.03em",
                          }}>LATEST</span>
                        )}
                        {callDate && (
                          <span style={{ fontSize: 11, color: tokens.textMute }}>
                            {callDate}{callTitle ? ` \u2014 ${callTitle}` : ""}
                          </span>
                        )}
                      </div>

                      {/* AI Summary block */}
                      {summary?.loading && <CallSummarySkeleton tokens={tokens} />}
                      {hasStructured && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {summary.summary && (
                            <div style={{ fontSize: 13, color: tokens.text, lineHeight: 1.55, fontWeight: 500 }}>
                              {summary.summary}
                            </div>
                          )}
                          {summary.bullets?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 4 }}>KEY POINTS</div>
                              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                                {summary.bullets.map((b, i) => (
                                  <li key={i} style={{ fontSize: 12.5, color: tokens.textSub, lineHeight: 1.5 }}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {summary.actionItems?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: tokens.accent, letterSpacing: "0.04em", marginBottom: 4 }}>ACTION ITEMS</div>
                              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                                {summary.actionItems.map((a, i) => (
                                  <li key={i} style={{ fontSize: 12.5, color: tokens.text, lineHeight: 1.5 }}>{a}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {summary.thingsToKnow?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: tokens.amber, letterSpacing: "0.04em", marginBottom: 4 }}>THINGS TO KNOW</div>
                              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                                {summary.thingsToKnow.map((t, i) => (
                                  <li key={i} style={{ fontSize: 12.5, color: tokens.textSub, lineHeight: 1.5 }}>{t}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* No AI content — fallback to raw text */}
                      {!summary?.loading && !hasStructured && text && (
                        <div style={{
                          fontSize: 13, color: tokens.textSub, lineHeight: 1.6,
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>{text}</div>
                      )}

                      {/* Expand / collapse full notes */}
                      {fullNotes && (
                        <>
                          <button
                            onClick={() => setExpandedCalls(p => ({ ...p, [pageId]: !p[pageId] }))}
                            style={{
                              marginTop: 10, padding: "4px 8px", borderRadius: 6,
                              background: "transparent", border: `1px solid ${tokens.border}`,
                              color: tokens.textSub, fontSize: 11, fontWeight: 600,
                              cursor: "pointer", fontFamily: "inherit",
                            }}
                          >
                            {isExpanded ? "Hide full notes" : "Show full notes"}
                          </button>
                          {isExpanded && (
                            <div style={{
                              marginTop: 10, padding: "12px 14px", borderRadius: 8,
                              background: tokens.surfaceAlt || tokens.surfaceEl,
                              border: `1px dashed ${tokens.border}`,
                              fontSize: 12.5, color: tokens.textSub, lineHeight: 1.6,
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                              maxHeight: 400, overflowY: "auto",
                            }}>{fullNotes}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {nextSteps && (
                  <div style={{
                    padding: "14px 18px", borderRadius: 10,
                    background: tokens.accentGhost,
                    borderLeft: `3px solid ${tokens.accent}`,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: tokens.accent,
                      letterSpacing: "0.03em", marginBottom: 6,
                    }}>PLAN FOR NEXT CALL</div>
                    <div style={{
                      fontSize: 13, color: tokens.text, lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}>{nextSteps}</div>
                  </div>
                )}

                {latestUpdate && (
                  <div style={{
                    padding: "14px 18px", borderRadius: 10,
                    background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: tokens.textMute,
                      letterSpacing: "0.03em", marginBottom: 6,
                    }}>LATEST UPDATE</div>
                    <div style={{
                      fontSize: 13, color: tokens.textSub, lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}>{typeof latestUpdate === "string" ? latestUpdate : JSON.stringify(latestUpdate, null, 2)}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 3 - KPI Snapshot (live from GHL or Notion) */}
          <div style={{ marginBottom: 28 }}>
            <SectionLabel tokens={tokens}>KPI SNAPSHOT</SectionLabel>
            {ghlKpis ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {[
                  { label: "Total Contacts", value: ghlKpis.totalContacts, color: tokens.accent || "#4F8CFF" },
                  { label: "Pipeline Leads", value: ghlKpis.pipelineLeads, color: tokens.amber },
                  { label: "Won / Converted", value: ghlKpis.wonCount, color: tokens.green },
                  { label: "Conversion Rate", value: `${ghlKpis.conversionRate}%`, color: ghlKpis.conversionRate >= 20 ? tokens.green : tokens.amber },
                  { label: "Conversations", value: ghlKpis.conversations, color: tokens.accent || "#4F8CFF" },
                ].map((kpi, i) => (
                  <div key={i} style={{
                    padding: "14px 16px", borderRadius: 10,
                    background: tokens.surfaceAlt,
                  }}>
                    <div style={{ fontSize: 11, color: tokens.textMute, marginBottom: 4 }}>{kpi.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color, letterSpacing: "-0.02em" }}>{kpi.value}</div>
                  </div>
                ))}
              </div>
            ) : kpiFields.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {kpiFields.map(([key, val]) => (
                  <div key={key} style={{
                    padding: "14px 16px", borderRadius: 10,
                    background: tokens.surfaceAlt,
                  }}>
                    <div style={{ fontSize: 11, color: tokens.textMute, marginBottom: 4, textTransform: "capitalize" }}>{key.replace(/[_-]/g, " ")}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: tokens.text, letterSpacing: "-0.02em" }}>{val}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: "24px 20px", borderRadius: 12, textAlign: "center",
                border: `2px dashed ${tokens.border}`,
                color: tokens.textMute, fontSize: 13,
              }}>
                KPIs available when GHL connected
              </div>
            )}
          </div>

          {/* Section 4 - Missed Payments */}
          {missedPayments.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <SectionLabel tokens={tokens}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tokens.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  PAYMENT ALERTS
                </span>
              </SectionLabel>
              <div style={{
                padding: "14px 18px", borderRadius: 10,
                background: tokens.redSoft || `${tokens.red}10`,
                border: `1px solid ${tokens.red}30`,
              }}>
                {missedPayments.map((p, i) => (
                  <div key={p.id || i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 0",
                    borderBottom: i < missedPayments.length - 1 ? `1px solid ${tokens.red}15` : "none",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: tokens.red, color: "#fff",
                    }}>{p.type === "failed" ? "FAILED" : "PAST DUE"}</span>
                    <span style={{ fontSize: 13, color: tokens.text, flex: 1 }}>
                      ${(p.amount / 100).toLocaleString()} {p.type === "failed" ? `\u2014 ${p.failureMessage || "Card declined"}` : `\u2014 Due ${p.dueDate || ""}`}
                    </span>
                    <span style={{ fontSize: 11, color: tokens.textMute }}>{p.created}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 5 - Outstanding Asana Tasks */}
          {asanaTasks.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <SectionLabel tokens={tokens}>OUTSTANDING TASKS ({asanaTasks.length})</SectionLabel>
              <div style={{
                background: tokens.surfaceEl, borderRadius: 10,
                border: `1px solid ${tokens.border}`, padding: "8px 4px",
              }}>
                {asanaTasks.map((task, i) => (
                  <div key={task.id || i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${tokens.borderStr || tokens.border}`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.title || task.name}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                        {task.assignee && <span style={{ fontSize: 11, color: tokens.textMute }}>{task.assignee}</span>}
                        {task.dueDate && (
                          <span style={{ fontSize: 11, color: task.dueDate < new Date().toISOString().split("T")[0] ? tokens.red : tokens.textMute }}>
                            Due {task.dueDate}
                          </span>
                        )}
                        {task.section && <span style={{ fontSize: 11, color: tokens.textMute }}>{"\u00b7"} {task.section}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 6 - Prep Notes */}
          <div style={{ marginBottom: 8 }}>
            <SectionLabel tokens={tokens}>PREP NOTES</SectionLabel>
            <textarea
              value={prepNotes}
              onChange={(e) => setPrepNotes(e.target.value)}
              placeholder="Paste any Slack questions or notes to prep for this call..."
              rows={4}
              style={{
                width: "100%", padding: "14px 18px", borderRadius: 10, resize: "vertical",
                background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                color: tokens.text, fontSize: 14, fontFamily: "inherit", lineHeight: 1.6,
                outline: "none", boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = tokens.accent}
              onBlur={(e) => e.currentTarget.style.borderColor = tokens.border}
            />
            {storageKey && prepNotes && (
              <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 4, textAlign: "right" }}>
                Auto-saved locally
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 28px",
          borderTop: `1px solid ${tokens.border}`,
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          {onOpenClient && (
            <button onClick={() => onOpenClient(clientName)} style={{
              padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "transparent", border: `1px solid ${tokens.border}`,
              color: tokens.text, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.12s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.borderColor = tokens.borderStr || tokens.border; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = tokens.border; }}
            >Open Client Profile</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={handleCopy} style={{
            padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: copied ? tokens.green : tokens.accent,
            color: "#08080A", border: "none", cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.15s", minWidth: 140,
          }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
          >{copied ? "Copied!" : "Copy Prep Brief"}</button>
        </div>
      </div>
    </div>
  );
}
