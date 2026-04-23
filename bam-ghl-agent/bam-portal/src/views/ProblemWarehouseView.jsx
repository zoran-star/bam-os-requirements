import { useState, useEffect } from "react";
import { fetchSolutionWarehouses } from '../services/notionService';

const CATEGORIES = ["Content", "Internal", "Academy Strategy", "Digital Marketing", "Systems", "Legal", "Team"];
const SEVERITIES = ["Low", "Medium", "High"];

export default function ProblemWarehouseView({ tokens, dark }) {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSolutionWarehouses().then(({ data, error }) => {
      if (cancelled) return;
      if (data && data.length > 0) {
        setProblems(data);
        setIsMock(false);
      } else {
        setProblems([]);
        setIsMock(false);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setProblems([]);
        setIsMock(false);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

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

  const severityColor = (sev) =>
    sev === "High" ? tokens.red : sev === "Medium" ? tokens.amber : tokens.green;

  const severityBg = (sev) =>
    sev === "High" ? tokens.redSoft : sev === "Medium" ? tokens.amberSoft : tokens.greenSoft;

  const catColor = (cat) =>
    cat === "Systems" ? tokens.blue
    : cat === "Digital Marketing" ? tokens.accent
    : cat === "Academy Strategy" ? tokens.amber
    : cat === "Legal" ? tokens.red
    : cat === "Team" ? tokens.green
    : cat === "Content" ? tokens.accent
    : tokens.textSub;

  const catBg = (cat) =>
    cat === "Systems" ? `${tokens.blue}15`
    : cat === "Digital Marketing" ? tokens.accentGhost
    : cat === "Academy Strategy" ? tokens.amberSoft
    : cat === "Legal" ? tokens.redSoft
    : cat === "Team" ? tokens.greenSoft
    : cat === "Content" ? tokens.accentGhost
    : tokens.surfaceAlt;

  // Loading skeleton
  if (loading) {
    return (
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
        <style>{`@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.7; } }`}</style>
      </div>
    );
  }

  return (
    <div>
      {/* Hero stats */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 36, flexWrap: "wrap", ...(problems.length === 0 ? { opacity: 0.4 } : {}) }}>
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
          const cc = catColor(p.category);
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
                      background: catBg(p.category),
                    }}>{p.category}</span>
                    {p.severity && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: severityColor(p.severity), padding: "2px 8px", borderRadius: 4,
                        background: severityBg(p.severity),
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
  );
}
