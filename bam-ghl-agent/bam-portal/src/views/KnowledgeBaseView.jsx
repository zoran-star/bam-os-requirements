import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchSOPTree, fetchSOPContent, fetchSolutionWarehouses } from "../services/notionService";
import { useIsMobile } from '../hooks/useMediaQuery';

/* ─── SOP parsing/rendering helpers ─── */

function parseContent(content, tokens) {
  const lines = content.split("\n");
  const elements = [];
  let listItems = [];
  let listType = null; // "ul" or "ol"
  let olCounter = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <div key={`list-${elements.length}`} style={{ marginBottom: 16, paddingLeft: 8 }}>
        {listItems.map((item, i) => (
          <div key={i} style={{
            display: "flex", gap: 10, fontSize: 14, color: tokens.text,
            lineHeight: 1.7, marginBottom: 4,
          }}>
            <span style={{ color: tokens.textMute, flexShrink: 0, width: 20, textAlign: "right" }}>
              {item.type === "ol" ? `${item.num}.` : "\u2022"}
            </span>
            <span>{renderInline(item.text, tokens)}</span>
          </div>
        ))}
      </div>
    );
    listItems = [];
    listType = null;
    olCounter = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip top-level ## title (already shown in breadcrumb)
    if (i === 0 && line.startsWith("## ")) continue;

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} style={{
          fontSize: 16, fontWeight: 600, color: tokens.text,
          margin: "24px 0 12px", letterSpacing: "-0.01em",
        }}>{line.slice(4)}</h3>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} style={{
          fontSize: 20, fontWeight: 700, color: tokens.text,
          margin: "28px 0 14px", letterSpacing: "-0.02em",
        }}>{line.slice(3)}</h2>
      );
    } else if (/^- /.test(line)) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push({ type: "ul", text: line.slice(2) });
    } else if (/^\d+\.\s/.test(line)) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        olCounter = 0;
      }
      olCounter++;
      listItems.push({ type: "ol", num: olCounter, text: line.replace(/^\d+\.\s/, "") });
    } else if (line.trim() === "") {
      flushList();
    } else if (line.trim()) {
      flushList();
      elements.push(
        <p key={`p-${i}`} style={{
          fontSize: 14, color: tokens.textSub, lineHeight: 1.7, margin: "8px 0",
        }}>{renderInline(line, tokens)}</p>
      );
    }
  }
  flushList();
  return elements;
}

function renderInline(text, tokens) {
  // Handle **bold** and `code`
  const parts = [];
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[1]) {
      parts.push(
        <strong key={match.index} style={{ fontWeight: 600, color: tokens.text }}>{match[2]}</strong>
      );
    } else if (match[3]) {
      parts.push(
        <code key={match.index} style={{
          fontFamily: "monospace", fontSize: 13,
          background: tokens.surfaceAlt, padding: "2px 6px", borderRadius: 4,
          color: tokens.accent,
        }}>{match[4]}</code>
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length > 0 ? parts : text;
}

function highlightSnippet(text, query, tokens, maxLen = 120) {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return null;

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + (maxLen - 40));
  const snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");

  // Split snippet around the match to highlight it
  const snippetLower = snippet.toLowerCase();
  const matchIdx = snippetLower.indexOf(qLower);
  if (matchIdx === -1) return <span>{snippet}</span>;

  return (
    <span>
      {snippet.slice(0, matchIdx)}
      <span style={{ background: tokens.accentGhost, color: tokens.accent, fontWeight: 600, padding: "1px 2px", borderRadius: 3 }}>
        {snippet.slice(matchIdx, matchIdx + query.length)}
      </span>
      {snippet.slice(matchIdx + query.length)}
    </span>
  );
}

/* ─── Problem Warehouse color helpers ─── */

const CATEGORIES = ["Content", "Internal", "Academy Strategy", "Digital Marketing", "Systems", "Legal", "Team"];
const SEVERITIES = ["Low", "Medium", "High"];

const WAREHOUSE_CATEGORY_MAP = {
  "Content": "content",
  "Internal": "internal",
  "Academy Strategy": "academy_strategy",
  "Digital Marketing": "digital_marketing",
  "Systems": "systems",
  "Legal": "legal",
  "Team": "team",
};

function severityColor(sev, tokens) {
  return sev === "High" ? tokens.red : sev === "Medium" ? tokens.amber : tokens.green;
}

function severityBg(sev, tokens) {
  return sev === "High" ? tokens.redSoft : sev === "Medium" ? tokens.amberSoft : tokens.greenSoft;
}

function catColor(cat, tokens) {
  return cat === "Systems" ? tokens.blue
    : cat === "Digital Marketing" ? tokens.accent
    : cat === "Academy Strategy" ? tokens.amber
    : cat === "Legal" ? tokens.red
    : cat === "Team" ? tokens.green
    : cat === "Content" ? tokens.accent
    : tokens.textSub;
}

function catBg(cat, tokens) {
  return cat === "Systems" ? `${tokens.blue}15`
    : cat === "Digital Marketing" ? tokens.accentGhost
    : cat === "Academy Strategy" ? tokens.amberSoft
    : cat === "Legal" ? tokens.redSoft
    : cat === "Team" ? tokens.greenSoft
    : cat === "Content" ? tokens.accentGhost
    : tokens.surfaceAlt;
}

/* ─── Suggested quick questions ─── */

const QUICK_QUESTIONS = [
  "How do I run a sales call?",
  "What's the onboarding process?",
  "How to handle objections?",
  "What are our cultural standards?",
  "How do I use CoachIQ?",
  "What's the decision-making framework?",
];

/* ─── CSS keyframes for animated gradient border ─── */

const gradientKeyframes = `
@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes pulseGlow {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
@keyframes pulseRed {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.6; }
}
@keyframes chatIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.7; } }
@keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

/* ─── Main component ─── */

export default function KnowledgeBaseView({ tokens }) {
  const isMobile = useIsMobile();
  const [subTab, setSubTab] = useState("sops");

  /* ── SOP state ── */
  const [tree, setTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [selectedContent, setSelectedContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [sopIsMock, setSopIsMock] = useState(false);

  // AI-first search state
  const [aiQuery, setAiQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [contentCache, setContentCache] = useState({});
  const searchInputRef = useRef(null);

  // AI Q&A state
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiSources, setAiSources] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);

  // Voice transcription state
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  // SOP sidebar toggle (hidden by default for AI-first)
  const [showSidebar, setShowSidebar] = useState(false);
  // Track if user has browsed into an SOP
  const [browsingSOPs, setBrowsingSOPs] = useState(false);

  /* ── Solutions state ── */
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [problems, setProblems] = useState([]);
  const [solLoading, setSolLoading] = useState(true);
  const [solIsMock, setSolIsMock] = useState(false);

  // New Solution form state
  const [showNewSolution, setShowNewSolution] = useState(false);
  const [newSolProblem, setNewSolProblem] = useState("");
  const [newSolSolution, setNewSolSolution] = useState("");
  const [newSolCategory, setNewSolCategory] = useState("");
  const [newSolAutoDetect, setNewSolAutoDetect] = useState(false);
  const [newSolSubmitting, setNewSolSubmitting] = useState(false);
  const [newSolError, setNewSolError] = useState(null);
  const [newSolSuccess, setNewSolSuccess] = useState(false);

  /* ── SOP effects ── */

  // Load SOP tree on mount
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    fetchSOPTree().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setSopIsMock(true);
      if (data) {
        setTree(data);
        // All categories collapsed by default
        const exp = {};
        data.forEach(cat => { exp[cat.id] = false; });
        setExpandedCategories(exp);
        // Do NOT auto-select any SOP — AI-first landing
        // Preload all SOP content in background so AI has context
        const allPages = data.flatMap(cat => (cat.children || []).map(c => c.pageId)).filter(Boolean);
        allPages.forEach(pageId => {
          fetchSOPContent(pageId).then(({ data: pageData }) => {
            if (pageData && !cancelled) {
              setContentCache(prev => ({ ...prev, [pageId]: pageData }));
            }
          });
        });
      }
      setTreeLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch content when a page is selected
  useEffect(() => {
    if (!selectedPageId) return;

    // Check cache first
    if (contentCache[selectedPageId]) {
      setSelectedContent(contentCache[selectedPageId]);
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    fetchSOPContent(selectedPageId).then(({ data }) => {
      if (cancelled) return;
      if (data) {
        setSelectedContent(data);
        setContentCache(prev => ({ ...prev, [selectedPageId]: data }));
      }
      setContentLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPageId]);

  /* ── Solutions effect ── */

  useEffect(() => {
    let cancelled = false;
    setSolLoading(true);
    fetchSolutionWarehouses().then(({ data }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        setProblems(data);
        setSolIsMock(false);
      } else {
        setProblems([]);
        setSolIsMock(false);
      }
      setSolLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setProblems([]);
        setSolIsMock(false);
        setSolLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /* ── Voice transcription ── */

  const startRecording = useCallback(() => {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Speech recognition is not supported in this browser.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
        setAiQuery(transcript);
      };
      recognition.onerror = () => {
        setIsRecording(false);
      };
      recognition.onend = () => {
        setIsRecording(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  /* ── SOP derived / callbacks ── */

  // Find category label for breadcrumb
  const selectedCategoryLabel = useMemo(() => {
    for (const cat of tree) {
      if (cat.children && cat.children.some(c => c.pageId === selectedPageId)) {
        return cat.label;
      }
    }
    return null;
  }, [tree, selectedPageId]);

  // Toggle category expansion
  const toggleCategory = useCallback((catId) => {
    setExpandedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
  }, []);

  // AI Search: send to /api/ai/search and show chat-style response
  const handleAiAsk = useCallback(async (e) => {
    if (e) e.preventDefault();
    const q = aiQuery.trim();
    if (!q || aiLoading) return;

    // Add user message to chat history
    setChatHistory(prev => [...prev, { role: "user", text: q }]);
    setAiQuery("");
    setAiLoading(true);

    // Build context from all cached SOP content
    const contextParts = [];
    for (const [, content] of Object.entries(contentCache)) {
      if (content.title && content.content) {
        contextParts.push(`## ${content.title}\n${content.content}`);
      }
    }

    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, context: contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : "" }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setChatHistory(prev => [...prev, {
        role: "ai",
        text: data.answer || "No answer returned.",
        sources: data.sources || [],
      }]);
      setAiSources(data.sources || []);
    } catch (err) {
      console.error("AI search failed:", err);
      setChatHistory(prev => [...prev, {
        role: "ai",
        text: "Failed to get AI response. Please try again.",
        sources: [],
      }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, contentCache, aiLoading]);

  // Handle quick question click
  const handleQuickQuestion = useCallback((question) => {
    setAiQuery(question);
    // Submit after setting query
    setTimeout(() => {
      setChatHistory(prev => [...prev, { role: "user", text: question }]);
      setAiLoading(true);

      const contextParts = [];
      for (const [, content] of Object.entries(contentCache)) {
        if (content.title && content.content) {
          contextParts.push(`## ${content.title}\n${content.content}`);
        }
      }

      fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, context: contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : undefined }),
      })
        .then(res => {
          if (!res.ok) throw new Error("API error");
          return res.json();
        })
        .then(data => {
          setChatHistory(prev => [...prev, {
            role: "ai",
            text: data.answer || "No answer returned.",
            sources: data.sources || [],
          }]);
          setAiSources(data.sources || []);
        })
        .catch(() => {
          setChatHistory(prev => [...prev, {
            role: "ai",
            text: "Failed to get AI response. Please try again.",
            sources: [],
          }]);
        })
        .finally(() => {
          setAiLoading(false);
          setAiQuery("");
        });
    }, 0);
  }, [contentCache]);

  // Navigate to a source SOP by title
  const handleSourceClick = useCallback((sourceTitle) => {
    for (const [pageId, content] of Object.entries(contentCache)) {
      if (content.title === sourceTitle) {
        setSelectedPageId(pageId);
        setBrowsingSOPs(true);
        setShowSidebar(true);
        return;
      }
    }
    // Try matching in tree if not cached
    for (const cat of tree) {
      if (!cat.children) continue;
      for (const child of cat.children) {
        if (child.title === sourceTitle) {
          setSelectedPageId(child.pageId);
          setBrowsingSOPs(true);
          setShowSidebar(true);
          return;
        }
      }
    }
  }, [contentCache, tree]);

  const handleSearchResultClick = useCallback((pageId) => {
    setSelectedPageId(pageId);
    setSearchResults(null);
    setAiQuery("");
    setBrowsingSOPs(true);
    setShowSidebar(true);
  }, []);

  // Back to AI search from SOP browsing
  const handleBackToSearch = useCallback(() => {
    setBrowsingSOPs(false);
    setSelectedPageId(null);
    setSelectedContent(null);
    setShowSidebar(false);
  }, []);

  /* ── New Solution handlers ── */

  const handleAutoDetectCategory = useCallback(async () => {
    if (!newSolProblem.trim()) return;
    setNewSolAutoDetect(true);
    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `Categorize this problem into exactly one of these categories: ${CATEGORIES.join(", ")}. Problem: "${newSolProblem}". Reply with only the category name.`,
        }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const answer = (data.answer || "").trim();
      // Match against known categories
      const match = CATEGORIES.find(c => answer.toLowerCase().includes(c.toLowerCase()));
      if (match) setNewSolCategory(match);
    } catch {
      // silent fail
    } finally {
      setNewSolAutoDetect(false);
    }
  }, [newSolProblem]);

  const handleSubmitNewSolution = useCallback(async (e) => {
    e.preventDefault();
    if (!newSolProblem.trim() || !newSolSolution.trim() || !newSolCategory) {
      setNewSolError("All fields are required.");
      return;
    }
    setNewSolSubmitting(true);
    setNewSolError(null);
    setNewSolSuccess(false);
    try {
      const res = await fetch("/api/notion/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "create_solution",
          problem: newSolProblem.trim(),
          solution: newSolSolution.trim(),
          category: WAREHOUSE_CATEGORY_MAP[newSolCategory] || newSolCategory.toLowerCase().replace(/\s+/g, "_"),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create solution");
      }
      setNewSolSuccess(true);
      setNewSolProblem("");
      setNewSolSolution("");
      setNewSolCategory("");
      // Refresh solutions list
      fetchSolutionWarehouses().then(({ data }) => {
        if (data && data.length > 0) {
          setProblems(data);
          setSolIsMock(false);
        }
      });
    } catch (err) {
      setNewSolError(err.message);
    } finally {
      setNewSolSubmitting(false);
    }
  }, [newSolProblem, newSolSolution, newSolCategory]);

  /* ── Solutions derived ── */

  const filtered = problems.filter(p => {
    if (search && !p.problem.toLowerCase().includes(search.toLowerCase()) && !p.solution.toLowerCase().includes(search.toLowerCase())) return false;
    if (severityFilter !== "all" && p.severity !== severityFilter) return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    return true;
  });

  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = problems.filter(p => p.category === cat).length;
    return acc;
  }, {});

  /* ─────────── RENDER ─────────── */

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      <style>{gradientKeyframes}</style>

      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 4, background: tokens.surfaceAlt, borderRadius: 10, padding: 3, marginBottom: 24 }}>
        {["sops", "solutions"].map(t => (
          <button key={t} onClick={() => setSubTab(t)} style={{
            padding: "10px 24px", borderRadius: 8, fontSize: 14, cursor: "pointer",
            background: subTab === t ? tokens.surfaceEl : "transparent",
            border: "none", color: subTab === t ? tokens.text : tokens.textMute,
            fontFamily: "inherit", fontWeight: subTab === t ? 600 : 400,
            transition: "all 0.15s", boxShadow: subTab === t ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
          }}>{t === "sops" ? "SOPs" : "Solutions"}</button>
        ))}
      </div>

      {/* ══════════ SOPs sub-tab ══════════ */}
      {subTab === "sops" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: 600 }}>
          {/* Sample data indicator */}
          {sopIsMock && !treeLoading && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 6,
                background: `${tokens.amber}15`,
                border: `1px solid ${tokens.amber}30`,
                fontSize: 11, fontWeight: 600, color: tokens.amber,
                letterSpacing: "0.04em",
              }}>SAMPLE DATA</div>
            </div>
          )}

          {/* ── AI-First Search Landing ── */}
          {!browsingSOPs && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: chatHistory.length > 0 ? "flex-start" : "center",
              minHeight: chatHistory.length > 0 ? "auto" : 480,
              paddingTop: chatHistory.length > 0 ? 0 : 60,
            }}>
              {/* Title - only show when no chat history */}
              {chatHistory.length === 0 && (
                <div style={{
                  fontSize: 28, fontWeight: 700, color: tokens.text,
                  letterSpacing: "-0.03em", marginBottom: 8, textAlign: "center",
                }}>
                  Knowledge Base
                </div>
              )}
              {chatHistory.length === 0 && (
                <div style={{
                  fontSize: 15, color: tokens.textMute, marginBottom: 32, textAlign: "center",
                }}>
                  Your AI-powered guide to every SOP and solution
                </div>
              )}

              {/* Chat history */}
              {chatHistory.length > 0 && (
                <div style={{
                  width: "100%", maxWidth: 680, marginBottom: 24,
                  display: "flex", flexDirection: "column", gap: 16,
                }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} style={{
                      display: "flex",
                      justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                      animation: "chatIn 0.3s ease both",
                    }}>
                      <div style={{
                        maxWidth: "85%",
                        padding: msg.role === "user" ? "12px 18px" : "16px 20px",
                        borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        background: msg.role === "user"
                          ? tokens.accent
                          : tokens.surfaceEl,
                        color: msg.role === "user" ? "#fff" : tokens.text,
                        fontSize: 14, lineHeight: 1.7,
                        border: msg.role === "ai" ? `1px solid ${tokens.border}` : "none",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}>
                        {msg.role === "ai" ? (
                          <div>
                            <div style={{ whiteSpace: "pre-wrap" }}>
                              {parseContent(msg.text, tokens)}
                            </div>
                            {msg.sources && msg.sources.length > 0 && (
                              <div style={{
                                marginTop: 12, paddingTop: 10,
                                borderTop: `1px solid ${tokens.border}`,
                              }}>
                                <div style={{
                                  fontSize: 10, fontWeight: 700, color: tokens.textMute,
                                  textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6,
                                }}>Sources</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {msg.sources.map((src, si) => (
                                    <span
                                      key={si}
                                      onClick={() => handleSourceClick(src)}
                                      style={{
                                        fontSize: 11, color: tokens.accent, cursor: "pointer",
                                        padding: "3px 8px", borderRadius: 6,
                                        background: tokens.accentGhost,
                                        transition: "opacity 0.12s",
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.opacity = "0.7"; }}
                                      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                                    >{src}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : msg.text}
                      </div>
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {aiLoading && (
                    <div style={{
                      display: "flex", justifyContent: "flex-start",
                      animation: "chatIn 0.3s ease both",
                    }}>
                      <div style={{
                        padding: "16px 20px", borderRadius: "18px 18px 18px 4px",
                        background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}>
                        <div style={{
                          display: "flex", gap: 6, alignItems: "center",
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%", background: tokens.accent,
                            animation: "pulseGlow 1s ease infinite",
                          }} />
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%", background: tokens.accent,
                            animation: "pulseGlow 1s ease 0.2s infinite",
                          }} />
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%", background: tokens.accent,
                            animation: "pulseGlow 1s ease 0.4s infinite",
                          }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Animated gradient search input */}
              <div style={{
                position: "relative", width: "100%", maxWidth: 560,
                borderRadius: 16, padding: 2,
                background: "linear-gradient(135deg, " + tokens.accent + ", #a855f7, #ec4899, " + tokens.accent + ")",
                backgroundSize: "300% 300%",
                animation: "gradientShift 6s ease infinite",
                boxShadow: `0 0 30px ${tokens.accent}22, 0 0 60px ${tokens.accent}11`,
              }}>
                <form onSubmit={handleAiAsk} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 20px",
                  background: tokens.surfaceEl,
                  borderRadius: 14,
                  backdropFilter: "blur(20px)",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0, opacity: 0.7 }}>{"\u2728"}</span>
                  <input
                    ref={searchInputRef}
                    value={aiQuery}
                    onChange={e => setAiQuery(e.target.value)}
                    placeholder="Ask me how to do anything"
                    style={{
                      flex: 1, background: "none", border: "none", outline: "none",
                      fontSize: 16, color: tokens.text, fontFamily: "inherit",
                      minHeight: 28,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !aiQuery.trim()}
                    style={{
                      background: tokens.accent, color: "#fff", border: "none",
                      borderRadius: 10, padding: "8px 20px", fontSize: 14, fontWeight: 600,
                      cursor: aiLoading ? "wait" : "pointer", fontFamily: "inherit",
                      opacity: aiLoading || !aiQuery.trim() ? 0.5 : 1,
                      transition: "opacity 0.15s",
                    }}
                  >{aiLoading ? "..." : "Ask"}</button>
                </form>
              </div>

              {/* Microphone button */}
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  style={{
                    width: 44, height: 44, borderRadius: "50%",
                    border: isRecording ? `2px solid ${tokens.red}` : `1px solid ${tokens.border}`,
                    background: isRecording ? `${tokens.red}15` : tokens.surfaceEl,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s",
                    boxShadow: isRecording ? `0 0 16px ${tokens.red}33` : "none",
                  }}
                  title={isRecording ? "Stop recording" : "Voice input"}
                >
                  {isRecording ? (
                    <span style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: tokens.red,
                      animation: "pulseRed 1s ease infinite",
                    }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
                {isRecording && (
                  <span style={{ fontSize: 13, color: tokens.red, fontWeight: 500 }}>
                    Listening...
                  </span>
                )}
              </div>

              {/* Quick questions — only show when no chat history */}
              {chatHistory.length === 0 && (
                <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 600 }}>
                  {QUICK_QUESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuickQuestion(q)}
                      style={{
                        padding: "8px 16px", borderRadius: 20, fontSize: 13,
                        background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                        color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
                        transition: "all 0.15s", fontWeight: 400,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = tokens.accent;
                        e.currentTarget.style.color = tokens.accent;
                        e.currentTarget.style.background = tokens.accentGhost;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = tokens.border;
                        e.currentTarget.style.color = tokens.textSub;
                        e.currentTarget.style.background = tokens.surfaceEl;
                      }}
                    >{q}</button>
                  ))}
                </div>
              )}

              {/* Browse SOPs button */}
              <button
                onClick={() => { setShowSidebar(true); setBrowsingSOPs(true); }}
                style={{
                  marginTop: chatHistory.length === 0 ? 40 : 20,
                  padding: "10px 24px", borderRadius: 10, fontSize: 13,
                  background: "transparent", border: `1px solid ${tokens.border}`,
                  color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: 500, transition: "all 0.15s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = tokens.textSub;
                  e.currentTarget.style.color = tokens.textSub;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = tokens.border;
                  e.currentTarget.style.color = tokens.textMute;
                }}
              >Browse SOPs</button>
            </div>
          )}

          {/* ── SOP Browser Mode (sidebar + content) ── */}
          {browsingSOPs && (
            <div>
              {/* Back to search bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <button
                  onClick={handleBackToSearch}
                  style={{
                    padding: "8px 16px", borderRadius: 8, fontSize: 13,
                    background: "transparent", border: `1px solid ${tokens.border}`,
                    color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
                    fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceEl; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  {"\u2190"} Back to AI Search
                </button>

                {/* Inline search when browsing */}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const q = aiQuery.trim();
                  if (!q) { setSearchResults(null); return; }
                  const results = [];
                  const qLower = q.toLowerCase();
                  for (const [pageId, content] of Object.entries(contentCache)) {
                    const titleMatch = content.title && content.title.toLowerCase().includes(qLower);
                    const contentMatch = content.content && content.content.toLowerCase().includes(qLower);
                    if (titleMatch || contentMatch) {
                      results.push({ pageId, title: content.title, snippet: contentMatch ? content.content : content.title, matchInTitle: titleMatch, matchInContent: contentMatch });
                    }
                  }
                  for (const cat of tree) {
                    if (!cat.children) continue;
                    for (const child of cat.children) {
                      if (child.title && child.title.toLowerCase().includes(qLower) && !contentCache[child.pageId]) {
                        results.push({ pageId: child.pageId, title: child.title, snippet: child.title, matchInTitle: true, matchInContent: false });
                      }
                    }
                  }
                  setSearchResults(results);
                }} style={{
                  flex: 1, display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 14px", background: tokens.surfaceEl, borderRadius: 10,
                  border: `1px solid ${tokens.border}`,
                }}>
                  <span style={{ fontSize: 14, color: tokens.textMute }}>{"\uD83D\uDD0D"}</span>
                  <input
                    value={aiQuery}
                    onChange={e => setAiQuery(e.target.value)}
                    placeholder="Search SOPs..."
                    style={{
                      flex: 1, background: "none", border: "none", outline: "none",
                      fontSize: 13, color: tokens.text, fontFamily: "inherit",
                    }}
                  />
                  {aiQuery && (
                    <button type="button" onClick={() => { setAiQuery(""); setSearchResults(null); }}
                      style={{ background: "none", border: "none", color: tokens.textMute, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}
                    >{"\u2715"}</button>
                  )}
                </form>
              </div>

              {/* Search results dropdown */}
              {searchResults !== null && (
                <div style={{
                  marginBottom: 16, background: tokens.surfaceEl, borderRadius: 12,
                  border: `1px solid ${tokens.border}`, overflow: "hidden",
                }}>
                  {searchResults.length === 0 ? (
                    <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 13, color: tokens.textMute }}>
                      No results found. Try loading more SOPs first by clicking them in the sidebar.
                    </div>
                  ) : (
                    <div>
                      <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 600, color: tokens.textMute, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${tokens.border}` }}>
                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
                      </div>
                      {searchResults.map((r, i) => (
                        <div
                          key={r.pageId + "-" + i}
                          onClick={() => handleSearchResultClick(r.pageId)}
                          style={{
                            padding: "12px 16px", cursor: "pointer",
                            borderBottom: i < searchResults.length - 1 ? `1px solid ${tokens.border}` : "none",
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
                            {r.title}
                          </div>
                          {r.matchInContent && (
                            <div style={{ fontSize: 12, color: tokens.textMute, lineHeight: 1.5 }}>
                              {highlightSnippet(r.snippet, aiQuery, tokens)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Main layout: sidebar + content */}
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 0, flex: 1 }}>
                {/* Left tree nav */}
                {showSidebar && !(isMobile && selectedPageId) && (
                  <div style={{
                    width: isMobile ? "100%" : 240, flexShrink: 0, borderRight: isMobile ? "none" : `1px solid ${tokens.border}`,
                    borderBottom: isMobile ? `1px solid ${tokens.border}` : "none",
                    paddingRight: 0, overflowY: "auto",
                    animation: "cardIn 0.2s ease both",
                  }}>
                    {treeLoading ? (
                      <div style={{ padding: "20px 16px", fontSize: 13, color: tokens.textMute }}>
                        Loading SOPs...
                      </div>
                    ) : tree.length === 0 ? (
                      <div style={{ padding: "20px 16px", fontSize: 13, color: tokens.textMute }}>
                        No SOPs found.
                      </div>
                    ) : (
                      tree.map(cat => {
                        const isExpanded = expandedCategories[cat.id];
                        const childCount = cat.children ? cat.children.length : 0;
                        return (
                          <div key={cat.id} style={{ marginBottom: 8 }}>
                            {/* Category header (collapsible) */}
                            <div
                              onClick={() => toggleCategory(cat.id)}
                              style={{
                                fontSize: 11, fontWeight: 600, color: tokens.textMute,
                                letterSpacing: "0.04em", padding: "8px 4px",
                                textTransform: "uppercase", cursor: "pointer",
                                display: "flex", alignItems: "center", gap: 6,
                                userSelect: "none", borderRadius: 6,
                                transition: "background 0.12s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <span style={{
                                display: "inline-block", fontSize: 10, transition: "transform 0.15s",
                                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                              }}>{"\u25B6"}</span>
                              <span style={{ flex: 1 }}>{cat.label}</span>
                              <span style={{
                                fontSize: 10, color: tokens.textMute, background: tokens.surfaceAlt,
                                borderRadius: 10, padding: "2px 7px", fontWeight: 500,
                              }}>{childCount}</span>
                            </div>

                            {/* Child SOP pages */}
                            {isExpanded && cat.children && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                                {cat.children.map(sop => {
                                  const active = sop.pageId === selectedPageId;
                                  return (
                                    <div
                                      key={sop.pageId}
                                      onClick={() => setSelectedPageId(sop.pageId)}
                                      style={{
                                        padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                                        background: active ? tokens.accentGhost : "transparent",
                                        color: active ? tokens.accent : tokens.textSub,
                                        fontSize: 13, fontWeight: active ? 600 : 400,
                                        transition: "all 0.12s", marginRight: 16,
                                        lineHeight: 1.4, paddingLeft: 20,
                                      }}
                                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = tokens.surfaceHov; }}
                                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                                    >
                                      {sop.title}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Main content */}
                <div style={{ flex: 1, paddingLeft: showSidebar && !isMobile ? 36 : 0, minWidth: 0, display: isMobile && showSidebar && !selectedPageId ? "none" : "block" }}>
                  {isMobile && selectedPageId && (
                    <button
                      onClick={() => setSelectedPageId(null)}
                      style={{
                        padding: "8px 14px", borderRadius: 8, fontSize: 13,
                        background: "transparent", border: `1px solid ${tokens.border}`,
                        color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
                        fontWeight: 500, display: "flex", alignItems: "center", gap: 6,
                        marginBottom: 16, transition: "all 0.15s",
                      }}
                    >{"\u2190"} Back to list</button>
                  )}
                  {contentLoading ? (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", height: 400, gap: 8,
                    }}>
                      <div style={{ fontSize: 14, color: tokens.textMute }}>Loading content...</div>
                    </div>
                  ) : selectedContent ? (
                    <div style={{ animation: "cardIn 0.25s ease both" }}>
                      {/* Breadcrumb */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        {selectedCategoryLabel && (
                          <>
                            <span style={{ fontSize: 13, color: tokens.textMute }}>{selectedCategoryLabel}</span>
                            <span style={{ fontSize: 13, color: tokens.textMute }}>{"\u203A"}</span>
                          </>
                        )}
                        <span style={{ fontSize: 13, color: tokens.accent, fontWeight: 600 }}>{selectedContent.title}</span>
                      </div>

                      {/* Last updated */}
                      <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 28 }}>
                        Last updated: {selectedContent.lastUpdated || selectedContent.lastEdited || "Unknown"}
                      </div>

                      {/* Rendered content */}
                      <div style={{
                        background: tokens.surfaceEl, borderRadius: 16,
                        border: `1px solid ${tokens.border}`, padding: isMobile ? "16px 14px" : "32px 36px",
                      }}>
                        {parseContent(selectedContent.content || "", tokens)}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", height: 400, gap: 8,
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text }}>Select an SOP</div>
                      <div style={{ fontSize: 14, color: tokens.textMute }}>Choose from the sidebar to view documentation.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════ Solutions sub-tab ══════════ */}
      {subTab === "solutions" && (
        <div>
          {/* Loading skeleton */}
          {solLoading ? (
            <div>
              {/* Hero skeleton */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 36 }}>
                <div>
                  <div style={{ width: 60, height: 48, borderRadius: 8, background: tokens.surfaceEl, animation: "pulse 1.2s ease infinite" }} />
                  <div style={{ width: 100, height: 14, borderRadius: 4, background: tokens.surfaceEl, marginTop: 8 }} />
                </div>
                <div style={{ width: 1, height: 48, background: tokens.border }} />
                {[1, 2, 3, 4].map(i => (
                  <div key={i}>
                    <div style={{ width: 36, height: 32, borderRadius: 6, background: tokens.surfaceEl, animation: `pulse 1.2s ease ${i * 100}ms infinite` }} />
                    <div style={{ width: 70, height: 14, borderRadius: 4, background: tokens.surfaceEl, marginTop: 8 }} />
                  </div>
                ))}
              </div>
              {/* Filter skeleton */}
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, height: 42, borderRadius: 10, background: tokens.surfaceEl }} />
                <div style={{ width: 260, height: 42, borderRadius: 10, background: tokens.surfaceEl }} />
              </div>
              {/* Card skeletons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} style={{
                    height: 72, borderRadius: 14, background: tokens.surfaceEl,
                    animation: `pulse 1.2s ease ${i * 80}ms infinite`,
                  }} />
                ))}
              </div>
            </div>
          ) : (
            <div>
              {/* Hero stats + New Solution button */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 36, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 48, flex: 1, flexWrap: "wrap", ...(problems.length === 0 ? { opacity: 0.4 } : {}) }}>
                  <div>
                    <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: tokens.accent }}>{problems.length}</div>
                    <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>solutions stored</div>
                  </div>
                  <div style={{ width: 1, height: 48, background: tokens.border }} />
                  {CATEGORIES.filter(cat => categoryCounts[cat] > 0).map(cat => (
                    <div key={cat}>
                      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: tokens.text }}>{categoryCounts[cat]}</div>
                      <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>{cat.toLowerCase()}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setShowNewSolution(!showNewSolution); setNewSolError(null); setNewSolSuccess(false); }}
                  style={{
                    padding: "10px 20px", borderRadius: 10, fontSize: 14,
                    background: tokens.accent, border: "none",
                    color: "#fff", cursor: "pointer", fontFamily: "inherit",
                    fontWeight: 600, transition: "all 0.15s",
                    display: "flex", alignItems: "center", gap: 8,
                    boxShadow: `0 2px 8px ${tokens.accent}33`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                >
                  + New Solution
                </button>
              </div>

              {/* New Solution Form */}
              {showNewSolution && (
                <div style={{
                  marginBottom: 24, background: tokens.surfaceEl, borderRadius: 16,
                  border: `1px solid ${tokens.border}`, padding: "24px 28px",
                  animation: "cardIn 0.25s ease both",
                }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, marginBottom: 20 }}>New Solution</div>

                  {newSolSuccess && (
                    <div style={{
                      padding: "10px 16px", borderRadius: 8, marginBottom: 16,
                      background: tokens.greenSoft, border: `1px solid ${tokens.green}33`,
                      fontSize: 13, color: tokens.green, fontWeight: 500,
                    }}>Solution created successfully.</div>
                  )}

                  {newSolError && (
                    <div style={{
                      padding: "10px 16px", borderRadius: 8, marginBottom: 16,
                      background: tokens.redSoft, border: `1px solid ${tokens.red}33`,
                      fontSize: 13, color: tokens.red, fontWeight: 500,
                    }}>{newSolError}</div>
                  )}

                  <form onSubmit={handleSubmitNewSolution}>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Problem Description
                      </label>
                      <textarea
                        value={newSolProblem}
                        onChange={e => setNewSolProblem(e.target.value)}
                        placeholder="Describe the problem..."
                        rows={3}
                        style={{
                          width: "100%", padding: "10px 14px", borderRadius: 10,
                          background: tokens.surface, border: `1px solid ${tokens.border}`,
                          color: tokens.text, fontSize: 14, fontFamily: "inherit",
                          resize: "vertical", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Solution
                      </label>
                      <textarea
                        value={newSolSolution}
                        onChange={e => setNewSolSolution(e.target.value)}
                        placeholder="Describe the solution..."
                        rows={3}
                        style={{
                          width: "100%", padding: "10px 14px", borderRadius: 10,
                          background: tokens.surface, border: `1px solid ${tokens.border}`,
                          color: tokens.text, fontSize: 14, fontFamily: "inherit",
                          resize: "vertical", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Category
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select
                          value={newSolCategory}
                          onChange={e => setNewSolCategory(e.target.value)}
                          style={{
                            flex: 1, padding: "10px 14px", borderRadius: 10,
                            background: tokens.surface, border: `1px solid ${tokens.border}`,
                            color: tokens.text, fontSize: 14, fontFamily: "inherit",
                            outline: "none", cursor: "pointer",
                          }}
                        >
                          <option value="">Select category...</option>
                          {CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleAutoDetectCategory}
                          disabled={newSolAutoDetect || !newSolProblem.trim()}
                          style={{
                            padding: "10px 16px", borderRadius: 10, fontSize: 13,
                            background: tokens.accentGhost, border: `1px solid ${tokens.accent}33`,
                            color: tokens.accent, cursor: newSolAutoDetect ? "wait" : "pointer",
                            fontFamily: "inherit", fontWeight: 500,
                            opacity: newSolAutoDetect || !newSolProblem.trim() ? 0.5 : 1,
                            whiteSpace: "nowrap",
                          }}
                        >{newSolAutoDetect ? "Detecting..." : "Auto-detect"}</button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        type="submit"
                        disabled={newSolSubmitting}
                        style={{
                          padding: "10px 24px", borderRadius: 10, fontSize: 14,
                          background: tokens.accent, border: "none",
                          color: "#fff", cursor: newSolSubmitting ? "wait" : "pointer",
                          fontFamily: "inherit", fontWeight: 600,
                          opacity: newSolSubmitting ? 0.6 : 1,
                        }}
                      >{newSolSubmitting ? "Creating..." : "Create Solution"}</button>
                      <button
                        type="button"
                        onClick={() => { setShowNewSolution(false); setNewSolError(null); setNewSolSuccess(false); }}
                        style={{
                          padding: "10px 20px", borderRadius: 10, fontSize: 14,
                          background: "transparent", border: `1px solid ${tokens.border}`,
                          color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              {/* Search + Filters */}
              <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{
                  flex: 1, minWidth: 200, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                  background: tokens.surfaceEl, borderRadius: 10, border: `1px solid ${tokens.border}`,
                }}>
                  <span style={{ fontSize: 14, color: tokens.textMute }}>&#8981;</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search problems & solutions\u2026"
                    style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 14, color: tokens.text, fontFamily: "inherit" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["all", ...SEVERITIES].map(s => (
                    <button key={s} onClick={() => setSeverityFilter(s)} style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: severityFilter === s ? tokens.accentGhost : "transparent",
                      border: "none", color: severityFilter === s ? tokens.accent : tokens.textMute,
                      fontFamily: "inherit", fontWeight: severityFilter === s ? 600 : 400,
                    }}>{s === "all" ? "All Severity" : s}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["all", ...CATEGORIES].map(c => (
                    <button key={c} onClick={() => setCategoryFilter(c)} style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: categoryFilter === c ? tokens.accentGhost : "transparent",
                      border: "none", color: categoryFilter === c ? tokens.accent : tokens.textMute,
                      fontFamily: "inherit", fontWeight: categoryFilter === c ? 600 : 400,
                    }}>{c === "all" ? "All" : c}</button>
                  ))}
                </div>
              </div>

              {/* Problem list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {filtered.map((p, i) => {
                  const isExpanded = expanded === p.id;
                  const cc = catColor(p.category, tokens);
                  return (
                    <div key={p.id} style={{ animation: `cardIn 0.3s ease ${i * 30}ms both` }}>
                      <div
                        onClick={() => setExpanded(isExpanded ? null : p.id)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 16, padding: "18px 24px",
                          cursor: "pointer", borderRadius: isExpanded ? "14px 14px 0 0" : 14,
                          background: isExpanded ? tokens.surfaceAlt : "transparent",
                          borderLeft: `3px solid ${cc}`,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = tokens.surfaceEl; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, lineHeight: 1.4, marginBottom: 6 }}>{p.problem}</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, color: cc, padding: "2px 8px", borderRadius: 4,
                              background: catBg(p.category, tokens),
                            }}>{p.category}</span>
                            {p.severity && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, color: severityColor(p.severity, tokens), padding: "2px 8px", borderRadius: 4,
                                background: severityBg(p.severity, tokens),
                              }}>{p.severity}</span>
                            )}
                            {p.frequency && p.frequency.length > 0 && p.frequency.map((f, fi) => (
                              <span key={fi} style={{
                                fontSize: 11, fontWeight: 500, color: tokens.textMute, padding: "2px 8px", borderRadius: 4,
                                background: tokens.surfaceAlt,
                              }}>{f}</span>
                            ))}
                            {p.client && <span style={{ fontSize: 12, color: tokens.textMute }}>{p.client}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: tokens.textMute, flexShrink: 0 }}>{p.createdAt || p.meetingDate}</span>
                      </div>

                      {isExpanded && (
                        <div style={{
                          background: tokens.surfaceEl, borderRadius: "0 0 14px 14px",
                          padding: "20px 24px 24px 27px", borderLeft: `3px solid ${cc}`,
                          animation: "cardIn 0.2s ease both",
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.green, letterSpacing: "0.04em", marginBottom: 10 }}>SOLUTION</div>
                          <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7, marginBottom: 20 }}>{p.solution}</div>
                          <div style={{ display: "flex", gap: 24, fontSize: 13, color: tokens.textMute, flexWrap: "wrap" }}>
                            {p.resolvedBy && (
                              <span>Resolved by <span style={{ color: tokens.textSub, fontWeight: 500 }}>{p.resolvedBy}</span></span>
                            )}
                            <span>{p.createdAt || p.meetingDate}</span>
                            {p.problemType && p.problemType.length > 0 && (
                              <span>{p.problemType.join(", ")}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {problems.length === 0 && (
                <div style={{ padding: "60px 0", textAlign: "center", color: tokens.textMute, fontSize: 14, opacity: 0.4 }}>No data available</div>
              )}
              {problems.length > 0 && filtered.length === 0 && (
                <div style={{ padding: "60px 0", textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No problems match your filters.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
