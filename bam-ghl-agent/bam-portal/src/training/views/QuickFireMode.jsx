import { useState, useEffect, useRef } from "react";
import { useMobile } from "../hooks/useMobile";
import {
  getOrCreateTodaySession,
  getDailyQueue,
  getAllActiveScenarios,
  markQueueItemComplete,
  updateSession,
  evaluateResponse,
  saveResponse,
  getRecentResponses,
} from "../services/trainingService";
import VisualRenderer from "../components/VisualRenderer";
import FeedbackCard from "../components/FeedbackCard";
import ScenarioFeedback from "../components/ScenarioFeedback";
import VoiceMicButton from "../components/VoiceMicButton";
import { useVoiceInput } from "../hooks/useVoiceInput";

const animKeyframes = `
@keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes fadeInUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes scoreReveal { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`;

export default function QuickFireMode({ tk, session, userRole, navigate }) {
  const [scenarios, setScenarios] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [todaySession, setTodaySession] = useState(null);
  const [inputText, setInputText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [startTime, setStartTime] = useState(null);
  const [sessionScores, setSessionScores] = useState([]);
  const inputRef = useRef(null);
  const styleRef = useRef(false);

  const userId = session.user.id;
  const mob = useMobile();

  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement("style");
      style.textContent = animKeyframes;
      document.head.appendChild(style);
      styleRef.current = true;
    }
  }, []);

  const { isListening, transcript, startListening, stopListening, resetTranscript, supported: voiceSupported } = useVoiceInput({
    onResult: (text) => setInputText((prev) => (prev ? prev + " " + text : text).trim()),
    onInterim: (text) => setInterimText(text),
    autoSubmitDelay: 2500,
  });

  useEffect(() => { loadQueue() }, []);

  async function loadQueue() {
    try {
      const sess = await getOrCreateTodaySession(userId);
      setTodaySession(sess);

      let q = await getDailyQueue(userId, sess.id);
      let scenarioList = [];

      if (q.length > 0) {
        const qfItems = q.filter((item) => item.type === "quick_fire" && !item.is_completed);
        scenarioList = qfItems.map((item) => ({ ...item.scenario, queueItemId: item.id }));
      } else {
        const all = await getAllActiveScenarios("quick_fire");
        scenarioList = all;
      }

      if (scenarioList.length === 0) {
        setPhase("done");
      } else {
        setScenarios(scenarioList);
        setPhase("scenario");
        setStartTime(Date.now());
      }
    } catch (err) {
      console.error("Failed to load queue:", err);
      setPhase("done");
    }
  }

  const current = scenarios[currentIndex];
  const total = scenarios.length;

  async function handleSubmit() {
    const text = inputText.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    setInterimText("");

    const durationSeconds = startTime ? Math.round((Date.now() - startTime) / 1000) : null;

    try {
      const eval_ = await evaluateResponse(current.id, text);

      await saveResponse({
        session_id: todaySession.id,
        scenario_id: current.id,
        user_id: userId,
        response_text: text,
        response_duration_seconds: durationSeconds,
        ai_score: eval_.score,
        ai_feedback: eval_.feedback,
        ai_tldr: eval_.tldr,
        ai_ideal_comparison: eval_.ideal_comparison,
        ai_strengths: eval_.strengths || [],
        ai_gaps: eval_.gaps || [],
        type: "quick_fire",
      });

      if (current.queueItemId) {
        await markQueueItemComplete(current.queueItemId);
      }

      const newCount = (todaySession.quick_fire_completed || 0) + 1;
      const updates = { quick_fire_completed: newCount };
      if (newCount >= todaySession.quick_fire_target && todaySession.deep_situation_completed >= todaySession.deep_situation_target) {
        updates.is_complete = true;
      }
      const updatedSession = await updateSession(todaySession.id, updates);
      setTodaySession(updatedSession);

      setSessionScores(prev => [...prev, eval_.score]);
      setEvaluation(eval_);
      setPhase("feedback");
    } catch (err) {
      console.error("Evaluation failed:", err);
      setEvaluation({ score: 0, tldr: "Evaluation failed. Try again.", feedback: err.message, strengths: [], gaps: [] });
      setPhase("feedback");
    }

    setSubmitting(false);
  }

  function handleNext() {
    if (currentIndex + 1 >= total) {
      setPhase("done");
    } else {
      setCurrentIndex((prev) => prev + 1);
      setInputText("");
      setEvaluation(null);
      setInterimText("");
      resetTranscript();
      setPhase("scenario");
      setStartTime(Date.now());
    }
  }

  const avgScore = sessionScores.length > 0
    ? (sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length).toFixed(1)
    : null;

  const scoreColor = (s) => s >= 7 ? tk.green : s >= 4 ? tk.amber : tk.red;

  return (
    <div style={{ background: tk.bg, minHeight: "100vh", fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Top bar */}
      <div style={{
        padding: mob ? "10px 12px" : "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${tk.border}`, background: tk.surface,
      }}>
        <div
          onClick={() => navigate("/training")}
          style={{ color: tk.textMute, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          {"\u2190"} Exit
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: tk.accent, fontSize: 13, fontWeight: 700 }}>{"\u26A1"} Quick-Fire</span>
          {phase !== "done" && (
            <span style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600,
              background: tk.accentGhost, color: tk.accent, border: `1px solid ${tk.accentBorder}`,
            }}>
              {currentIndex + 1} / {total}
            </span>
          )}
          {avgScore && (
            <span style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700,
              background: scoreColor(parseFloat(avgScore)) + '20',
              color: scoreColor(parseFloat(avgScore)),
            }}>
              Avg: {avgScore}
            </span>
          )}
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Progress bar */}
      {phase !== "done" && (
        <div style={{ height: 3, background: tk.surfaceEl }}>
          <div style={{
            height: "100%", background: `linear-gradient(90deg, ${tk.accent}, ${tk.green})`,
            width: `${((currentIndex + (phase === "feedback" ? 1 : 0)) / total) * 100}%`,
            transition: "width 0.4s ease",
          }} />
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: mob ? "16px 12px" : "24px 20px" }}>

        {phase === "loading" && (
          <div style={{ color: tk.textSub, fontSize: 14, animation: "pulse 1.5s infinite" }}>Loading scenarios...</div>
        )}

        {phase === "scenario" && current && (
          <div style={{ width: "100%", maxWidth: 640, animation: "slideInRight 0.3s ease" }}>
            <VisualRenderer visualType={current.visual_type} visualData={current.visual_data} tk={tk} />

            {/* Scenario card */}
            <div style={{
              background: tk.surface, borderRadius: 14, padding: 24,
              border: `1px solid ${tk.borderMed}`, marginBottom: 20,
              boxShadow: tk.cardShadow,
            }}>
              {current.tags && current.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  {current.tags.slice(0, 3).map((tag) => (
                    <span key={tag} style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10,
                      color: tk.textMute, border: `1px solid ${tk.border}`,
                      textTransform: "uppercase", letterSpacing: "0.04em",
                    }}>
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                  {current.unit && (
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10,
                      color: tk.accent, background: tk.accentGhost,
                      fontWeight: 600, textTransform: "uppercase",
                    }}>
                      {current.unit?.title || ""}
                    </span>
                  )}
                </div>
              )}
              <div style={{ color: tk.text, fontSize: 16, lineHeight: 1.65, fontWeight: 500 }}>
                {current.prompt}
              </div>
              {current.context && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 8, background: tk.surfaceAlt,
                  color: tk.textSub, fontSize: 13, lineHeight: 1.5,
                  borderLeft: `3px solid ${tk.accent}`,
                }}>
                  {current.context}
                </div>
              )}
            </div>

            {/* Input area */}
            <div style={{
              background: tk.surface, borderRadius: 14, padding: mob ? 14 : 18,
              border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
            }}>
              {interimText && (
                <div style={{ color: tk.accent, fontSize: 13, marginBottom: 8, fontStyle: "italic", opacity: 0.7 }}>
                  {interimText}...
                </div>
              )}

              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your response, or use the mic..."
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                style={{
                  width: "100%", minHeight: 100, padding: 14, borderRadius: 10,
                  background: tk.bg, border: `1px solid ${tk.border}`,
                  color: tk.text, fontSize: 14, fontFamily: "Inter, sans-serif",
                  resize: "vertical", outline: "none", lineHeight: 1.5,
                  transition: "border-color 0.15s, box-shadow 0.15s",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => { e.target.style.borderColor = tk.accent; e.target.style.boxShadow = tk.inputGlow }}
                onBlur={(e) => { e.target.style.borderColor = tk.border; e.target.style.boxShadow = "none" }}
              />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {voiceSupported && (
                    <VoiceMicButton isListening={isListening} onToggle={isListening ? stopListening : startListening} tk={tk} size={44} />
                  )}
                  {isListening && (
                    <span style={{ color: tk.red, fontSize: 12, fontWeight: 600, animation: "pulse 1s infinite" }}>
                      Listening...
                    </span>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!inputText.trim() || submitting}
                  style={{
                    padding: "12px 32px", borderRadius: 10,
                    background: inputText.trim() && !submitting
                      ? `linear-gradient(135deg, ${tk.accent}, ${tk.accentBorder})`
                      : tk.surfaceEl,
                    color: inputText.trim() && !submitting ? "#0A0A0C" : tk.textMute,
                    border: "none", cursor: inputText.trim() && !submitting ? "pointer" : "default",
                    fontSize: 14, fontWeight: 700, transition: "all 0.2s ease",
                    boxShadow: inputText.trim() && !submitting ? tk.accentGlow : "none",
                  }}
                >
                  {submitting ? "Evaluating..." : "Submit"}
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "feedback" && evaluation && (
          <div style={{ width: "100%", maxWidth: 640, animation: "fadeInUp 0.3s ease" }}>
            <div style={{
              background: tk.surface, borderRadius: 14, padding: 24,
              border: `1px solid ${tk.borderMed}`, marginBottom: 16,
              boxShadow: tk.cardShadow,
            }}>
              <FeedbackCard evaluation={evaluation} tk={tk} />
            </div>

            {/* Question quality feedback for admins/lead SMs */}
            {(userRole?.role === 'lead_sm' || userRole?.role === 'admin') && current && (
              <div style={{ marginBottom: 12 }}>
                <ScenarioFeedback scenarioId={current.id} userId={userId} tk={tk} />
              </div>
            )}

            <button
              onClick={handleNext}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 10,
                background: `linear-gradient(135deg, ${tk.accent}, ${tk.accentBorder})`,
                color: "#0A0A0C",
                border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 700, transition: "all 0.15s ease",
                boxShadow: tk.accentGlow,
              }}
            >
              {currentIndex + 1 >= total ? "Finish Session" : "Next Scenario \u2192"}
            </button>
          </div>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", animation: "fadeInUp 0.4s ease", maxWidth: 420 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{"\u{1F3C6}"}</div>
            <div style={{ color: tk.text, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Session Complete!</div>

            {/* Session stats */}
            {sessionScores.length > 0 && (
              <div style={{
                display: "flex", justifyContent: "center", gap: mob ? 14 : 24, margin: "20px 0",
                padding: mob ? "14px 12px" : "16px 24px", borderRadius: 12, background: tk.surface,
                border: `1px solid ${tk.borderMed}`,
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: tk.accent, fontSize: mob ? 24 : 32, fontWeight: 800 }}>{sessionScores.length}</div>
                  <div style={{ color: tk.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Scenarios</div>
                </div>
                <div style={{ width: 1, background: tk.border }} />
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: scoreColor(parseFloat(avgScore)), fontSize: mob ? 24 : 32, fontWeight: 800 }}>{avgScore}</div>
                  <div style={{ color: tk.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Avg Score</div>
                </div>
                <div style={{ width: 1, background: tk.border }} />
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: tk.green, fontSize: mob ? 24 : 32, fontWeight: 800 }}>
                    {sessionScores.filter(s => s >= 7).length}
                  </div>
                  <div style={{ color: tk.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>Nailed It</div>
                </div>
              </div>
            )}

            {/* Score distribution dots */}
            {sessionScores.length > 0 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
                {sessionScores.map((s, i) => (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: scoreColor(s),
                    animation: `scoreReveal 0.3s ease ${i * 0.1}s both`,
                  }} title={`Scenario ${i + 1}: ${s}/10`} />
                ))}
              </div>
            )}

            <div style={{ color: tk.textSub, fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              {parseFloat(avgScore) >= 7
                ? "Strong performance. Keep it up."
                : parseFloat(avgScore) >= 4
                ? "Solid work. Review your feedback to sharpen the weak spots."
                : "Tough session. Go back through the feedback — that's where the growth is."}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => navigate("/training")}
                style={{
                  padding: "12px 28px", borderRadius: 10,
                  background: tk.accent, color: "#0A0A0C",
                  border: "none", cursor: "pointer",
                  fontSize: 14, fontWeight: 700,
                  boxShadow: tk.accentGlow,
                }}
              >
                Back to Training
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
