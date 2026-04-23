import { useState, useEffect, useRef } from "react";
import { useMobile } from "../hooks/useMobile";
import {
  getOrCreateTodaySession,
  getDailyQueue,
  getUserProgress,
  getRecentResponses,
  getStreak,
  generateDailyQueue,
} from "../services/trainingService";

const homeKeyframes = `
@keyframes homeSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes homePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@keyframes homeGlow { 0%, 100% { box-shadow: 0 0 20px rgba(212,207,138,0.08); } 50% { box-shadow: 0 0 40px rgba(212,207,138,0.15); } }
@keyframes homeShine { 0% { left: -100%; } 100% { left: 200%; } }
`;

export default function TrainingHome({ tk, session, userRole, navigate }) {
  const [todaySession, setTodaySession] = useState(null);
  const [queue, setQueue] = useState([]);
  const [progress, setProgress] = useState([]);
  const [recentFeedback, setRecentFeedback] = useState([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const styleRef = useRef(false);

  const userId = session.user.id;
  const mob = useMobile();

  useEffect(() => {
    if (!styleRef.current) {
      const s = document.createElement("style");
      s.textContent = homeKeyframes;
      document.head.appendChild(s);
      styleRef.current = true;
    }
    loadData();
  }, []);

  async function loadData() {
    try {
      const [sess, prog, recent, streakCount] = await Promise.all([
        getOrCreateTodaySession(userId),
        getUserProgress(userId),
        getRecentResponses(userId, 3),
        getStreak(userId),
      ]);
      setTodaySession(sess);
      setProgress(prog);
      setRecentFeedback(recent);
      setStreak(streakCount);
      if (sess) {
        const q = await getDailyQueue(userId, sess.id);
        setQueue(q);
      }
    } catch (err) {
      console.error("Failed to load training data:", err);
    }
    setLoading(false);
  }

  async function handleGenerateQueue() {
    setGenerating(true);
    try {
      await generateDailyQueue(userId);
      const sess = await getOrCreateTodaySession(userId);
      const q = await getDailyQueue(userId, sess.id);
      setTodaySession(sess);
      setQueue(q);
    } catch (err) {
      console.error("Failed to generate queue:", err);
    }
    setGenerating(false);
  }

  function handleStartTraining() {
    navigate("/training/session/quick-fire");
  }

  const qfCompleted = todaySession?.quick_fire_completed || 0;
  const qfTarget = todaySession?.quick_fire_target || 10;
  const dsCompleted = todaySession?.deep_situation_completed || 0;
  const dsTarget = todaySession?.deep_situation_target || 3;
  const allDone = todaySession?.is_complete;
  const isAdmin = userRole.role === "admin" || userRole.role === "lead_sm";
  const firstName = userRole.display_name.split(" ")[0];

  if (loading) {
    return (
      <div style={{ background: tk.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: tk.textSub, fontSize: 14, fontFamily: "Inter, sans-serif", animation: "homePulse 1.5s infinite" }}>Loading training...</div>
      </div>
    );
  }

  return (
    <div style={{ background: tk.bg, minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      {/* Top bar */}
      <div style={{
        borderBottom: `1px solid ${tk.border}`,
        padding: mob ? "10px 14px" : "12px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        maxWidth: 1000, margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 12 }}>
          <div onClick={() => window.location.href = "/"}
            style={{ color: tk.textMute, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            {"\u2190"} {mob ? "" : "Portal"}
          </div>
          <div style={{ width: 1, height: 16, background: tk.border }} />
          <div style={{ color: tk.accent, fontSize: mob ? 11 : 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            SM Training
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: mob ? 6 : 10 }}>
          {streak > 0 && (
            <div style={{
              padding: "5px 12px", borderRadius: 20, background: tk.amberSoft,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ fontSize: 13 }}>{"\u{1F525}"}</span>
              <span style={{ color: tk.amber, fontSize: 12, fontWeight: 700 }}>{streak}</span>
            </div>
          )}
          {isAdmin && (
            <div onClick={() => navigate("/training/admin")}
              style={{
                padding: "5px 14px", borderRadius: 20, cursor: "pointer",
                background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
                color: tk.accent, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
              }}
            >
              {"\u2699\uFE0F"} Admin
            </div>
          )}
          <div style={{
            width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(135deg, ${tk.accent}30, ${tk.accent}10)`,
            color: tk.accent, fontSize: 13, fontWeight: 700,
          }}>
            {firstName[0]}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: mob ? "24px 14px 40px" : "40px 24px 60px" }}>
        {/* Hero greeting */}
        <div style={{ marginBottom: mob ? 24 : 36, animation: "homeSlideUp 0.4s ease" }}>
          <h1 style={{
            color: tk.text, fontSize: mob ? 24 : 32, fontWeight: 800, margin: "0 0 6px",
            letterSpacing: "-0.02em", lineHeight: 1.2,
          }}>
            {getGreeting()}, {firstName}
          </h1>
          <p style={{ color: tk.textSub, fontSize: 15, margin: 0, lineHeight: 1.5 }}>
            {allDone
              ? "You crushed today's training. Come back tomorrow."
              : queue.length > 0
                ? "Your scenarios are ready. Let's get sharper."
                : "Generate today's queue to start training."}
          </p>
        </div>

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: mob ? 8 : 12,
          marginBottom: mob ? 20 : 32, animation: "homeSlideUp 0.45s ease",
        }}>
          <StatCard label="Streak" value={streak || 0} suffix=" days" icon={"\u{1F525}"} color={tk.amber} tk={tk} mob={mob} />
          <StatCard label="Today" value={qfCompleted + dsCompleted} suffix={`/${qfTarget + dsTarget}`} icon={"\u26A1"} color={tk.accent} tk={tk} mob={mob} />
          <StatCard
            label="Avg Score"
            value={recentFeedback.length > 0 ? (recentFeedback.reduce((a, r) => a + (r.ai_score || 0), 0) / recentFeedback.length).toFixed(1) : "--"}
            suffix="/10"
            icon={"\u{1F3AF}"}
            color={tk.green}
            tk={tk}
            mob={mob}
          />
        </div>

        {/* Main mission card */}
        <div style={{ animation: "homeSlideUp 0.5s ease", marginBottom: mob ? 20 : 32 }}>
          {allDone ? (
            <CompletedCard tk={tk} qfCompleted={qfCompleted} dsCompleted={dsCompleted} mob={mob} />
          ) : (
            <div style={{
              background: tk.surface, borderRadius: 16, padding: mob ? "20px 16px 18px" : "28px 28px 24px",
              position: "relative", overflow: "hidden",
              boxShadow: `0 4px 24px rgba(0,0,0,0.2), 0 0 0 1px ${tk.borderMed}`,
              animation: "homeGlow 4s ease infinite",
            }}>
              {/* Top accent gradient */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg, ${tk.accent}, ${tk.accent}60, transparent 70%)`,
              }} />

              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24,
              }}>
                <div>
                  <div style={{ color: tk.accent, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                    Today's Mission
                  </div>
                  <div style={{ color: tk.text, fontSize: mob ? 17 : 20, fontWeight: 700 }}>
                    {queue.length > 0 ? `${qfTarget + dsTarget - qfCompleted - dsCompleted} scenarios remaining` : "Ready to begin"}
                  </div>
                </div>
                {queue.length > 0 && (
                  <CircularProgress completed={qfCompleted + dsCompleted} total={qfTarget + dsTarget} tk={tk} />
                )}
              </div>

              {/* Progress tracks */}
              <div style={{ display: "flex", gap: mob ? 10 : 16, marginBottom: mob ? 18 : 24 }}>
                <ProgressTrack label="Quick-Fire" icon={"\u26A1"} completed={qfCompleted} total={qfTarget} color={tk.accent} tk={tk} />
                <ProgressTrack label="Deep Sits" icon={"\u{1F3AD}"} completed={dsCompleted} total={dsTarget} color="#A78BFA" tk={tk} />
              </div>

              {/* CTA */}
              {queue.length === 0 ? (
                <button onClick={handleGenerateQueue} disabled={generating}
                  style={{
                    width: "100%", padding: "16px 0", borderRadius: 12,
                    background: generating ? tk.surfaceEl : `linear-gradient(135deg, ${tk.accent}, ${tk.accent}dd)`,
                    color: generating ? tk.textSub : tk.bg,
                    border: "none", cursor: generating ? "default" : "pointer",
                    fontSize: 15, fontWeight: 700, letterSpacing: "0.01em",
                    transition: "all 0.2s ease",
                    boxShadow: generating ? "none" : `0 4px 16px rgba(212,207,138,0.25)`,
                    position: "relative", overflow: "hidden",
                  }}
                >
                  {generating ? "Building your scenarios..." : "Start Training"}
                </button>
              ) : (
                <button onClick={handleStartTraining}
                  style={{
                    width: "100%", padding: "16px 0", borderRadius: 12,
                    background: `linear-gradient(135deg, ${tk.accent}, ${tk.accent}dd)`,
                    color: tk.bg, border: "none", cursor: "pointer",
                    fontSize: 15, fontWeight: 700, letterSpacing: "0.01em",
                    transition: "all 0.2s ease",
                    boxShadow: `0 4px 16px rgba(212,207,138,0.25)`,
                    position: "relative", overflow: "hidden",
                  }}
                >
                  {qfCompleted > 0 ? "Continue Training \u2192" : "Start Training \u2192"}
                  {/* Shine effect */}
                  <div style={{
                    position: "absolute", top: 0, left: "-100%", width: "50%", height: "100%",
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
                    animation: "homeShine 3s ease-in-out infinite",
                  }} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Unit Progress */}
        {progress.length > 0 && (
          <div style={{ marginBottom: mob ? 20 : 32, animation: "homeSlideUp 0.55s ease" }}>
            <SectionLabel tk={tk}>Unit Progress</SectionLabel>
            <div style={{
              display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(auto-fill, minmax(200px, 1fr))", gap: mob ? 8 : 10,
            }}>
              {progress.map((p) => (
                <UnitCard key={p.id} progress={p} tk={tk} />
              ))}
            </div>
          </div>
        )}

        {/* Recent Feedback */}
        {recentFeedback.length > 0 && (
          <div style={{ animation: "homeSlideUp 0.6s ease" }}>
            <SectionLabel tk={tk}>Recent Feedback</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentFeedback.map((r) => (
                <FeedbackCard key={r.id} response={r} tk={tk} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────

function StatCard({ label, value, suffix, icon, color, tk, mob }) {
  return (
    <div style={{
      background: tk.surface, borderRadius: mob ? 12 : 14, padding: mob ? "14px 12px" : "18px 16px",
      boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: mob ? 6 : 10 }}>
        <span style={{ fontSize: mob ? 15 : 18 }}>{icon}</span>
        <span style={{ color: tk.textMute, fontSize: mob ? 9 : 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span style={{ color, fontSize: mob ? 20 : 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{value}</span>
        {suffix && <span style={{ color: tk.textMute, fontSize: mob ? 10 : 12, fontWeight: 600 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function CircularProgress({ completed, total, tk }) {
  const pct = total > 0 ? Math.min(completed / total, 1) : 0;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div style={{ position: "relative", width: 68, height: 68 }}>
      <svg width="68" height="68" viewBox="0 0 68 68" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="34" cy="34" r={radius} fill="none" stroke={tk.surfaceEl} strokeWidth="5" />
        <circle cx="34" cy="34" r={radius} fill="none" stroke={tk.accent} strokeWidth="5"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        color: tk.text, fontSize: 15, fontWeight: 800,
      }}>
        {Math.round(pct * 100)}%
      </div>
    </div>
  );
}

function ProgressTrack({ label, icon, completed, total, color, tk }) {
  const pct = total > 0 ? Math.min((completed / total) * 100, 100) : 0;
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: tk.text, fontSize: 13, fontWeight: 600 }}>{icon} {label}</span>
        <span style={{ color: tk.textSub, fontSize: 12, fontWeight: 600 }}>{completed}/{total}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: tk.surfaceEl, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 3, width: `${pct}%`,
          background: pct >= 100 ? tk.green : `linear-gradient(90deg, ${color}, ${color}cc)`,
          transition: "width 0.5s ease",
          boxShadow: pct > 0 ? `0 0 8px ${color}40` : "none",
        }} />
      </div>
    </div>
  );
}

function UnitCard({ progress: p, tk }) {
  const unit = p.unit;
  if (!unit) return null;

  const statusConfig = {
    locked: { color: tk.textMute, label: "Locked", bg: "transparent" },
    in_progress: { color: tk.accent, label: "In Progress", bg: tk.accentGhost },
    completed: { color: tk.green, label: "Complete", bg: tk.greenSoft },
    certified: { color: tk.green, label: "Certified", bg: tk.greenSoft },
  };

  const s = statusConfig[p.status] || statusConfig.locked;
  const isLocked = p.status === "locked";

  return (
    <div style={{
      padding: "16px 18px", borderRadius: 14,
      background: isLocked ? tk.surfaceEl : tk.surface,
      boxShadow: isLocked ? "none" : `0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px ${tk.borderMed}`,
      opacity: isLocked ? 0.4 : 1,
      transition: "all 0.15s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>{unit.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: tk.text, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unit.title}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          padding: "3px 10px", borderRadius: 20, background: s.bg,
          color: s.color, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
        }}>{s.label}</span>
        {p.ai_competency_score > 0 && (
          <span style={{ color: tk.textSub, fontSize: 11, fontWeight: 600 }}>{Math.round(p.ai_competency_score)}%</span>
        )}
      </div>
    </div>
  );
}

function FeedbackCard({ response: r, tk }) {
  const [expanded, setExpanded] = useState(false);
  const scoreColor = r.ai_score >= 7 ? tk.green : r.ai_score >= 4 ? tk.amber : tk.red;
  const scoreEmoji = r.ai_score >= 8 ? "\u{1F525}" : r.ai_score >= 6 ? "\u{1F44D}" : r.ai_score >= 4 ? "\u{1F914}" : "\u26A0\uFE0F";

  return (
    <div onClick={() => setExpanded(!expanded)}
      style={{
        background: tk.surface, borderRadius: 14, padding: "14px 14px",
        boxShadow: `0 2px 8px rgba(0,0,0,0.1), 0 0 0 1px ${tk.borderMed}`,
        cursor: "pointer", transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: `linear-gradient(135deg, ${scoreColor}20, ${scoreColor}08)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 800, color: scoreColor, flexShrink: 0,
          border: `1px solid ${scoreColor}25`,
        }}>
          {r.ai_score}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: tk.text, fontSize: 13, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {scoreEmoji} {r.ai_tldr || r.scenario?.title || "Response"}
          </div>
          <div style={{ color: tk.textMute, fontSize: 11, marginTop: 2 }}>
            {r.scenario?.type === "quick_fire" ? "\u26A1 Quick-Fire" : "\u{1F3AD} Deep Sit"} {"\u00B7"} {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
        <span style={{
          color: tk.textMute, fontSize: 14, transition: "transform 0.2s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        }}>{"\u25BC"}</span>
      </div>
      {expanded && r.ai_feedback && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${tk.border}`,
          color: tk.textSub, fontSize: 13, lineHeight: 1.7,
        }}>
          {r.ai_feedback}
        </div>
      )}
    </div>
  );
}

function CompletedCard({ tk, qfCompleted, dsCompleted, mob }) {
  return (
    <div style={{
      background: tk.surface, borderRadius: 16, padding: mob ? "28px 16px" : "36px 28px", textAlign: "center",
      boxShadow: `0 4px 24px rgba(0,0,0,0.2), 0 0 0 1px ${tk.green}20`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${tk.green}, ${tk.green}60, transparent 70%)`,
      }} />
      <div style={{ fontSize: 52, marginBottom: 12 }}>{"\u{1F3C6}"}</div>
      <div style={{ color: tk.green, fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.01em" }}>
        Training Complete!
      </div>
      <div style={{ color: tk.textSub, fontSize: 14 }}>
        {qfCompleted} quick-fires + {dsCompleted} deep situations done today
      </div>
    </div>
  );
}

function SectionLabel({ tk, children }) {
  return (
    <div style={{
      color: tk.textSub, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.08em", marginBottom: 12,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {children}
      <div style={{ flex: 1, height: 1, background: tk.border }} />
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
