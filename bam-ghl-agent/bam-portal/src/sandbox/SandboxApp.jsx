import { useState, useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { authFetch } from "../lib/authFetch";
import { T } from "../tokens/tokens";

// 🎮 Agent Sandbox — a private chat to TRAIN the BAM GTA sales agent.
// You play the parent/lead; the agent proposes replies (never sent anywhere).
// 📝 corrections become "lessons" injected into the brain on the next message.
const tk = T.dark;
const F = "Inter, sans-serif";

async function api(action, payload = {}) {
  const res = await authFetch("/api/agent-sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${action} failed`);
  return data;
}

export default function SandboxApp() {
  const [session, setSession] = useState(undefined);
  const [messages, setMessages] = useState([]);     // {role:'parent'|'agent', text, meta?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lessons, setLessons] = useState([]);
  const [teachFor, setTeachFor] = useState(null);    // index of agent msg being corrected
  const [teachText, setTeachText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadLessons(); }, [session]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, busy]);

  async function loadLessons() {
    try { const d = await api("lessons"); setLessons(d.lessons || []); } catch (_) {}
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError("");
    const next = [...messages, { role: "parent", text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const d = await api("chat", { messages: next.map(m => ({ role: m.role, text: m.text })) });
      setMessages(m => [...m, {
        role: "agent",
        text: d.reply,
        meta: { reasoning: d.reasoning, confidence: d.confidence, escalate: d.escalate, escalate_reason: d.escalate_reason },
      }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLesson(idx) {
    const lesson = teachText.trim();
    if (!lesson) return;
    const ctx = { conversation: messages.slice(0, idx + 1), corrected_reply: messages[idx]?.text || "" };
    try {
      await api("teach", { lesson, kind: "fix", context: ctx });
      setTeachFor(null); setTeachText("");
      await loadLessons();
    } catch (e) { setError(e.message); }
  }

  async function forget(id) {
    try { await api("forget", { id }); await loadLessons(); } catch (e) { setError(e.message); }
  }

  if (session === undefined) {
    return <Center>Loading…</Center>;
  }
  if (!session) return <Navigate to="/" replace />;

  return (
    <>
      <style>{`html,body{margin:0;padding:0;background:${tk.bg};} *{box-sizing:border-box;}`}</style>
      <div style={{ background: tk.bg, minHeight: "100vh", color: tk.text, fontFamily: F, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${tk.border}`, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>🎮 Agent Sandbox</div>
          <div style={{ fontSize: 12, color: tk.textSub }}>BAM GTA brain</div>
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: tk.amberSoft, color: tk.amber, border: `1px solid ${tk.amber}33`, fontWeight: 600 }}>
            ⚠ TRAINING ONLY — nothing is sent
          </span>
          <div style={{ flex: 1 }} />
          <BtnGhost onClick={() => setMessages([])}>↺ Reset chat</BtnGhost>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Chat */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {messages.length === 0 && (
                <div style={{ margin: "auto", textAlign: "center", color: tk.textMute, maxWidth: 420 }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>🏀</div>
                  <div style={{ fontSize: 15, color: tk.textSub, lineHeight: 1.6 }}>
                    Text the agent like you're a parent asking about training.<br />Watch how it replies — then 👍 or 📝 teach it.
                  </div>
                </div>
              )}
              {messages.map((m, i) => m.role === "parent"
                ? <ParentBubble key={i} text={m.text} />
                : <AgentBubble key={i} m={m} onTeach={() => { setTeachFor(i); setTeachText(""); }}
                    teaching={teachFor === i} teachText={teachText} setTeachText={setTeachText}
                    onSave={() => saveLesson(i)} onCancel={() => setTeachFor(null)} />
              )}
              {busy && <div style={{ color: tk.textMute, fontSize: 13, fontStyle: "italic" }}>agent is thinking…</div>}
              {error && <div style={{ color: tk.red, fontSize: 13, background: tk.redSoft, padding: "8px 12px", borderRadius: 8 }}>⚠ {error}</div>}
            </div>

            {/* Composer */}
            <div style={{ padding: 16, borderTop: `1px solid ${tk.border}`, display: "flex", gap: 10 }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="type as the parent…  (Enter to send)"
                rows={1}
                style={{ flex: 1, resize: "none", background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.borderMed}`,
                  borderRadius: 10, padding: "12px 14px", fontFamily: F, fontSize: 14, outline: "none", lineHeight: 1.4 }}
              />
              <button onClick={send} disabled={busy || !input.trim()}
                style={{ background: input.trim() ? tk.accent : tk.surfaceHov, color: input.trim() ? "#000" : tk.textMute,
                  border: "none", borderRadius: 10, padding: "0 22px", fontWeight: 700, fontSize: 14, cursor: input.trim() ? "pointer" : "default", fontFamily: F }}>
                Send
              </button>
            </div>
          </div>

          {/* Lessons panel */}
          <div style={{ width: 300, borderLeft: `1px solid ${tk.border}`, padding: 18, overflowY: "auto", background: tk.surface }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🧠 What it's learned</div>
            <div style={{ fontSize: 11, color: tk.textMute, marginBottom: 14 }}>Applied to every new reply.</div>
            {lessons.length === 0 && <div style={{ fontSize: 12, color: tk.textMute, lineHeight: 1.6 }}>No lessons yet. Hit 📝 on a reply to teach it something.</div>}
            {lessons.map(l => (
              <div key={l.id} style={{ background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, fontSize: 12.5, lineHeight: 1.5, position: "relative" }}>
                <div style={{ color: tk.text, paddingRight: 16 }}>{l.lesson}</div>
                <div title="forget this" onClick={() => forget(l.id)}
                  style={{ position: "absolute", top: 8, right: 10, color: tk.textMute, cursor: "pointer", fontSize: 13 }}>✕</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ParentBubble({ text }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "72%" }}>
      <div style={{ fontSize: 10, color: tk.textMute, textAlign: "right", marginBottom: 4 }}>👤 parent</div>
      <div style={{ background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`, color: tk.text, padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{text}</div>
    </div>
  );
}

function AgentBubble({ m, onTeach, teaching, teachText, setTeachText, onSave, onCancel }) {
  const { reasoning, confidence, escalate, escalate_reason } = m.meta || {};
  const conf = typeof confidence === "number" ? Math.round(confidence * 100) : null;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "78%" }}>
      <div style={{ fontSize: 10, color: tk.textMute, marginBottom: 4 }}>🤖 agent</div>
      {escalate ? (
        <div style={{ background: tk.amberSoft, border: `1px solid ${tk.amber}44`, color: tk.amber, padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 13.5, lineHeight: 1.5 }}>
          🙋 <b>Would escalate to you</b>{escalate_reason ? ` — ${escalate_reason}` : ""}<br />
          <span style={{ color: tk.textSub, fontSize: 12 }}>(in real life it stops + flags a human here)</span>
        </div>
      ) : (
        <div style={{ background: tk.surfaceEl, border: `1px solid ${tk.border}`, color: tk.text, padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text || "(no reply)"}</div>
      )}

      {reasoning && (
        <div style={{ marginTop: 6, background: tk.surface, border: `1px dashed ${tk.borderMed}`, borderRadius: 8, padding: "7px 11px", fontSize: 12, color: tk.textSub, lineHeight: 1.5 }}>
          🧠 {reasoning}{conf != null && <span style={{ color: tk.textMute }}>  ·  {conf}% sure</span>}
        </div>
      )}

      {!teaching ? (
        <div style={{ marginTop: 6, display: "flex", gap: 14 }}>
          <Mini onClick={onTeach}>📝 teach</Mini>
        </div>
      ) : (
        <div style={{ marginTop: 8, background: tk.surface, border: `1px solid ${tk.borderMed}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: tk.textSub, marginBottom: 6 }}>What should it have done instead?</div>
          <textarea value={teachText} onChange={e => setTeachText(e.target.value)} autoFocus rows={2}
            placeholder="e.g. Don't share pricing unless they ask first."
            style={{ width: "100%", resize: "vertical", background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.borderMed}`, borderRadius: 8, padding: "8px 10px", fontFamily: F, fontSize: 13, outline: "none" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={onSave} disabled={!teachText.trim()} style={{ background: tk.accent, color: "#000", border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: F }}>Save lesson</button>
            <button onClick={onCancel} style={{ background: "transparent", color: tk.textSub, border: `1px solid ${tk.borderMed}`, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: F }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const Center = ({ children }) => (
  <div style={{ background: tk.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: tk.textSub, fontFamily: F, fontSize: 14 }}>{children}</div>
);
const Mini = ({ onClick, children }) => (
  <span onClick={onClick} style={{ fontSize: 12, color: tk.textSub, cursor: "pointer", userSelect: "none" }}>{children}</span>
);
const BtnGhost = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: "transparent", color: tk.textSub, border: `1px solid ${tk.borderMed}`, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: F }}>{children}</button>
);
