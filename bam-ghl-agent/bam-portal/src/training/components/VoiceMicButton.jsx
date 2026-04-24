import { useEffect, useState } from "react";

const pulseKeyframes = `
@keyframes micPulse {
  0% { box-shadow: 0 0 0 0 rgba(212,207,138,0.4); }
  70% { box-shadow: 0 0 0 18px rgba(212,207,138,0); }
  100% { box-shadow: 0 0 0 0 rgba(212,207,138,0); }
}
`;

export default function VoiceMicButton({ isListening, onToggle, tk, size = 56 }) {
  const [injected, setInjected] = useState(false);

  useEffect(() => {
    if (!injected) {
      const style = document.createElement("style");
      style.textContent = pulseKeyframes;
      document.head.appendChild(style);
      setInjected(true);
    }
  }, [injected]);

  return (
    <button
      onClick={onToggle}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${isListening ? tk.accent : tk.borderStr}`,
        background: isListening ? "rgba(212,207,138,0.12)" : tk.surface,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.2s ease",
        animation: isListening ? "micPulse 1.5s infinite" : "none",
        flexShrink: 0,
      }}
      title={isListening ? "Stop recording" : "Start voice input"}
    >
      <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke={isListening ? tk.accent : tk.textSub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}
