import { useState, useEffect } from "react";

export default function ProgressBar({ pct, tokens, animated = true, delay = 0, height = 4 }) {
  const [w, setW] = useState(animated ? 0 : pct);
  useEffect(() => {
    if (!animated) return;
    const t = setTimeout(() => setW(pct), delay);
    return () => clearTimeout(t);
  }, [pct, animated, delay]);
  const barColor = pct === 100 ? tokens.green : pct > 60 ? tokens.accent : pct > 30 ? tokens.amber : tokens.red;
  return (
    <div style={{ height, background: tokens.borderMed, borderRadius: height, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${w}%`, borderRadius: height,
        background: barColor, transition: "width 1.1s cubic-bezier(0.16,1,0.3,1)",
      }} />
    </div>
  );
}
