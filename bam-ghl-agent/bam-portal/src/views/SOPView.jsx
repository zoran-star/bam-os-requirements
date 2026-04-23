import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchSOPTree, fetchSOPContent } from "../services/notionService";

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

export default function SOPView({ tokens, dark }) {
  const [tree, setTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [selectedContent, setSelectedContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);

  // Search state
  const [aiQuery, setAiQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [contentCache, setContentCache] = useState({});
  const searchInputRef = useRef(null);

  // AI Q&A state
  const [searchMode, setSearchMode] = useState("search"); // "search" or "ai"
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiSources, setAiSources] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  // Load SOP tree on mount
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    fetchSOPTree().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setIsMock(true);
      if (data) {
        setTree(data);
        // Expand all categories by default
        const expanded = {};
        data.forEach(cat => { expanded[cat.id] = true; });
        setExpandedCategories(expanded);
        // Select first child of first category if available
        if (data.length > 0 && data[0].children && data[0].children.length > 0) {
          setSelectedPageId(data[0].children[0].pageId);
        }
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
    fetchSOPContent(selectedPageId).then(({ data, error }) => {
      if (cancelled) return;
      if (data) {
        setSelectedContent(data);
        setContentCache(prev => ({ ...prev, [selectedPageId]: data }));
      }
      setContentLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedPageId]);

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

  // AI Search: search across all cached content
  const handleAiSearch = useCallback((e) => {
    e.preventDefault();
    const q = aiQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }

    const results = [];
    const qLower = q.toLowerCase();

    // Search through all cached content
    for (const [pageId, content] of Object.entries(contentCache)) {
      const titleMatch = content.title && content.title.toLowerCase().includes(qLower);
      const contentMatch = content.content && content.content.toLowerCase().includes(qLower);
      if (titleMatch || contentMatch) {
        results.push({
          pageId,
          title: content.title,
          snippet: contentMatch ? content.content : content.title,
          matchInTitle: titleMatch,
          matchInContent: contentMatch,
        });
      }
    }

    // Also search through tree items that might not be cached yet (title-only search)
    for (const cat of tree) {
      if (!cat.children) continue;
      for (const child of cat.children) {
        if (child.title && child.title.toLowerCase().includes(qLower) && !contentCache[child.pageId]) {
          results.push({
            pageId: child.pageId,
            title: child.title,
            snippet: child.title,
            matchInTitle: true,
            matchInContent: false,
          });
        }
      }
    }

    setSearchResults(results);
  }, [aiQuery, contentCache, tree]);

  // AI Q&A: ask AI about SOP content
  const handleAiAsk = useCallback(async (e) => {
    e.preventDefault();
    const q = aiQuery.trim();
    if (!q) return;

    // Build context from all cached SOP content
    const contextParts = [];
    for (const [pageId, content] of Object.entries(contentCache)) {
      if (content.title && content.content) {
        contextParts.push(`## ${content.title}\n${content.content}`);
      }
    }

    if (contextParts.length === 0) {
      setAiAnswer("No SOP content loaded yet. Browse some SOPs in the sidebar first so their content can be searched.");
      setAiSources([]);
      return;
    }

    setAiLoading(true);
    setAiAnswer(null);
    setAiSources([]);

    try {
      const res = await fetch("/api/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, context: contextParts.join("\n\n---\n\n") }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setAiAnswer(data.answer || "No answer returned.");
      setAiSources(data.sources || []);
    } catch (err) {
      console.error("AI search failed:", err);
      setAiAnswer("Failed to get AI response. Please try again.");
      setAiSources([]);
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, contentCache]);

  // Navigate to a source SOP by title
  const handleSourceClick = useCallback((sourceTitle) => {
    for (const [pageId, content] of Object.entries(contentCache)) {
      if (content.title === sourceTitle) {
        setSelectedPageId(pageId);
        return;
      }
    }
    // Try matching in tree if not cached
    for (const cat of tree) {
      if (!cat.children) continue;
      for (const child of cat.children) {
        if (child.title === sourceTitle) {
          setSelectedPageId(child.pageId);
          return;
        }
      }
    }
  }, [contentCache, tree]);

  const handleSearchResultClick = useCallback((pageId) => {
    setSelectedPageId(pageId);
    setSearchResults(null);
    setAiQuery("");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, animation: "cardIn 0.3s ease both", minHeight: 600 }}>
      {/* Sample data indicator */}
      {isMock && !treeLoading && (
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

      {/* Search bar with mode toggle */}
      <div style={{ marginBottom: 20, position: "relative" }}>
        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 8 }}>
          {[
            { key: "search", label: "Search" },
            { key: "ai", label: "Ask AI" },
          ].map(mode => (
            <button
              key={mode.key}
              onClick={() => {
                setSearchMode(mode.key);
                setSearchResults(null);
                setAiAnswer(null);
                setAiSources([]);
              }}
              style={{
                padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", border: `1px solid ${tokens.border}`,
                background: searchMode === mode.key ? tokens.accent : "transparent",
                color: searchMode === mode.key ? "#fff" : tokens.textMute,
                borderRadius: mode.key === "search" ? "8px 0 0 8px" : "0 8px 8px 0",
                borderLeft: mode.key === "ai" ? "none" : undefined,
                transition: "all 0.15s",
              }}
            >{mode.label}</button>
          ))}
          {searchMode === "ai" && (
            <span style={{
              fontSize: 11, color: tokens.textMute, marginLeft: 12,
              display: "flex", alignItems: "center",
            }}>
              {Object.keys(contentCache).length} SOP{Object.keys(contentCache).length !== 1 ? "s" : ""} loaded
            </span>
          )}
        </div>

        <form onSubmit={searchMode === "ai" ? handleAiAsk : handleAiSearch} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          background: tokens.surfaceEl, borderRadius: 12,
          border: `1px solid ${searchMode === "ai" ? tokens.accent + "44" : tokens.border}`,
        }}>
          <span style={{ fontSize: 16, color: searchMode === "ai" ? tokens.accent : tokens.textMute, flexShrink: 0 }}>
            {searchMode === "ai" ? "\u2728" : "\uD83D\uDD0D"}
          </span>
          <input
            ref={searchInputRef}
            value={aiQuery}
            onChange={e => setAiQuery(e.target.value)}
            placeholder={searchMode === "ai" ? "Ask a question about SOPs..." : "Search SOPs by keyword..."}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 14, color: tokens.text, fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            disabled={aiLoading}
            style={{
              background: tokens.accent, color: "#fff", border: "none",
              borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600,
              cursor: aiLoading ? "wait" : "pointer", fontFamily: "inherit",
              opacity: aiLoading ? 0.6 : 1,
            }}
          >{aiLoading ? "Thinking..." : searchMode === "ai" ? "Ask" : "Search"}</button>
          {(searchResults !== null || aiAnswer !== null) && (
            <button
              type="button"
              onClick={() => { setSearchResults(null); setAiAnswer(null); setAiSources([]); setAiQuery(""); }}
              style={{
                background: "none", color: tokens.textMute, border: `1px solid ${tokens.border}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >Clear</button>
          )}
        </form>

        {/* AI Answer area */}
        {searchMode === "ai" && (aiLoading || aiAnswer !== null) && (
          <div style={{
            marginTop: 10, background: tokens.surfaceEl, borderRadius: 12,
            border: `1px solid ${tokens.accent}22`, overflow: "hidden",
          }}>
            {/* Header label */}
            <div style={{
              padding: "8px 16px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: tokens.accent,
              borderBottom: `1px solid ${tokens.border}`,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ fontSize: 12 }}>{"\u2728"}</span>
              AI-generated answer
            </div>

            {aiLoading ? (
              <div style={{ padding: "24px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: tokens.textMute, animation: "pulse 1.5s ease-in-out infinite" }}>
                  Analyzing SOPs...
                </div>
              </div>
            ) : (
              <div style={{ padding: "16px 20px" }}>
                {/* Answer text */}
                <div style={{
                  fontSize: 14, color: tokens.text, lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                }}>
                  {parseContent(aiAnswer || "", tokens)}
                </div>

                {/* Source links */}
                {aiSources.length > 0 && (
                  <div style={{
                    marginTop: 16, paddingTop: 12,
                    borderTop: `1px solid ${tokens.border}`,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: tokens.textMute,
                      textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8,
                    }}>
                      Sources
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {aiSources.map((src, i) => (
                        <span
                          key={i}
                          onClick={() => handleSourceClick(src)}
                          style={{
                            fontSize: 12, color: tokens.accent, cursor: "pointer",
                            padding: "4px 10px", borderRadius: 6,
                            background: tokens.accentGhost,
                            transition: "opacity 0.12s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                        >
                          {src}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Text search results dropdown */}
        {searchMode === "search" && searchResults !== null && (
          <div style={{
            marginTop: 8, background: tokens.surfaceEl, borderRadius: 12,
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
      </div>

      {/* Main layout: sidebar + content */}
      <div style={{ display: "flex", gap: 0, flex: 1 }}>
        {/* Left tree nav */}
        <div style={{
          width: 240, flexShrink: 0, borderRight: `1px solid ${tokens.border}`,
          paddingRight: 0, overflowY: "auto",
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

        {/* Main content */}
        <div style={{ flex: 1, paddingLeft: 36, minWidth: 0 }}>
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
                border: `1px solid ${tokens.border}`, padding: "32px 36px",
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
  );
}
