import { useState, useEffect } from "react";
import { DEV_ROLE_PERSONAS } from "../hooks/useStaffMe";

export default function DevRoleSwitcher() {
  const [active, setActive] = useState(() => localStorage.getItem("dev_role") || "");
  const [open, setOpen] = useState(false);

  if (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return null;
  }

  const set = (key) => {
    if (key) localStorage.setItem("dev_role", key);
    else localStorage.removeItem("dev_role");
    setActive(key);
    window.dispatchEvent(new Event("dev-role-change"));
    setOpen(false);
  };

  const label = active ? DEV_ROLE_PERSONAS[active]?.name : "Real user";

  return (
    <div style={{
      position: "fixed", bottom: 16, left: 16, zIndex: 9999,
      fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12,
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        padding: "8px 14px", borderRadius: 10,
        background: active ? "#C8A84E" : "rgba(40,40,50,0.9)",
        color: active ? "#1A1A1A" : "#E8E8F0",
        border: `1px solid ${active ? "#C8A84E" : "rgba(255,255,255,0.1)"}`,
        cursor: "pointer", fontWeight: 600, letterSpacing: "0.02em",
        backdropFilter: "blur(10px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}>
        {active ? "🎭" : "👤"} {label}
      </button>
      {open && (
        <div style={{
          marginTop: 8,
          background: "rgba(20,20,28,0.96)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 6,
          minWidth: 220,
          backdropFilter: "blur(20px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <Row label="Real logged-in user" onClick={() => set("")} active={!active} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
          {Object.entries(DEV_ROLE_PERSONAS).map(([key, p]) => (
            <Row key={key} label={p.name} onClick={() => set(key)} active={active === key} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, onClick, active }) {
  return (
    <div onClick={onClick} style={{
      padding: "8px 12px", borderRadius: 8, cursor: "pointer",
      color: active ? "#C8A84E" : "#E8E8F0",
      background: active ? "rgba(200,168,78,0.08)" : "transparent",
      fontWeight: active ? 600 : 400,
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </div>
  );
}
