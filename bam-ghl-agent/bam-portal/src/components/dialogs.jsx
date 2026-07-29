import { useState, useEffect } from "react";

// ─── Toast + confirm: styled replacements for window.alert / window.confirm ─
// Module-level dispatchers so any nested tab/component in this view can call
// showToast()/uiConfirm() without prop-drilling; the hosts render at the view
// root. Falls back to the native dialogs if a host isn't mounted.
let _toastPush = null;
export function showToast(msg, kind = "error") {
  const text = typeof msg === "string" ? msg : (msg && msg.message) || String(msg);
  if (_toastPush) _toastPush({ text, kind });
  else window.alert(text);
}
export function ToastHost({ tokens: t }) {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastPush = ({ text, kind }) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(prev => [...prev.slice(-3), { id, text, kind }]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4500);
    };
    return () => { _toastPush = null; };
  }, []);
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
      {toasts.map(x => (
        <div key={x.id} onClick={() => setToasts(prev => prev.filter(y => y.id !== x.id))} style={{
          background: t.surfaceEl, color: t.text, border: `1px solid ${x.kind === "error" ? "#7a2f2f" : x.kind === "success" ? `${t.green}66` : t.border}`,
          borderLeft: `3px solid ${x.kind === "error" ? "#e08b7e" : x.kind === "success" ? t.green : t.accent}`,
          borderRadius: 12, padding: "11px 14px", fontSize: 13, lineHeight: 1.5,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)", cursor: "pointer", wordBreak: "break-word",
        }}>{x.text}</div>
      ))}
    </div>
  );
}
let _confirmOpen = null;
export function uiConfirm(opts) {
  const o = typeof opts === "string" ? { title: opts } : opts;
  return new Promise(resolve => {
    if (_confirmOpen) _confirmOpen(o, resolve);
    else resolve(window.confirm(o.body ? `${o.title}\n\n${o.body}` : o.title));
  });
}
export function ConfirmHost({ tokens: t }) {
  const [req, setReq] = useState(null); // { title, body, confirmLabel, danger, resolve }
  useEffect(() => {
    _confirmOpen = (o, resolve) => setReq({ ...o, resolve });
    return () => { _confirmOpen = null; };
  }, []);
  if (!req) return null;
  const done = (val) => { req.resolve(val); setReq(null); };
  return (
    <div onClick={() => done(false)} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 16, padding: "22px 24px", maxWidth: 440, width: "100%", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: t.text, lineHeight: 1.45 }}>{req.title}</div>
        {req.body && <div style={{ fontSize: 13, color: t.textSub, marginTop: 8, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{req.body}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={() => done(false)} style={{ padding: "8px 16px", background: "transparent", color: t.textMute, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => done(true)} autoFocus style={{ padding: "8px 16px", background: req.danger ? "#c0392b" : t.accent, color: req.danger ? "#fff" : "#0B0B0D", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {req.confirmLabel || (req.danger ? "Yes, do it" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
