export default function FeedbackCard({ evaluation, tk }) {
  if (!evaluation) return null;

  const { score, tldr, feedback, ideal_comparison, strengths = [], gaps = [] } = evaluation;

  const scoreColor = score >= 7 ? tk.green : score >= 4 ? tk.amber : tk.red;
  const scoreBg = score >= 7 ? tk.greenSoft : score >= 4 ? tk.amberSoft : tk.redSoft;

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Score badge + TLDR */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12,
          background: scoreBg, border: `1px solid ${scoreColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, fontWeight: 800, color: scoreColor,
        }}>
          {score}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: tk.text, fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tldr}</div>
          <div style={{ color: tk.textSub, fontSize: 12, marginTop: 2 }}>Score: {score}/10</div>
        </div>
      </div>

      {/* Strengths & Gaps pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {strengths.map((s, i) => (
          <span key={"s" + i} style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 12,
            background: tk.greenSoft, color: tk.green, border: `1px solid rgba(52,211,153,0.2)`,
          }}>
            {s}
          </span>
        ))}
        {gaps.map((g, i) => (
          <span key={"g" + i} style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 12,
            background: tk.redSoft, color: tk.red, border: `1px solid rgba(251,113,133,0.2)`,
          }}>
            {g}
          </span>
        ))}
      </div>

      {/* Detailed feedback */}
      {feedback && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Feedback</div>
          <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{feedback}</div>
        </div>
      )}

      {/* Ideal comparison */}
      {ideal_comparison && (
        <div style={{
          padding: 14, borderRadius: 8,
          background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
        }}>
          <div style={{ color: tk.accent, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>vs. Ideal Approach</div>
          <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.6 }}>{ideal_comparison}</div>
        </div>
      )}
    </div>
  );
}
