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
  const [view, setView] = useState("chat");          // 'chat' | 'brain'
  const [messages, setMessages] = useState([]);     // {role:'parent'|'agent', text, meta?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lessons, setLessons] = useState([]);
  const [examples, setExamples] = useState([]);
  const [teachFor, setTeachFor] = useState(null);    // index of agent msg being corrected
  const [teachText, setTeachText] = useState("");
  const [lead, setLead] = useState({ form: "", age: "", location: "", notes: "" });
  const [leadOpen, setLeadOpen] = useState(false);
  const scrollRef = useRef(null);

  // Stats for the tracker bar.
  const agentMsgs = messages.filter(m => m.role === "agent");
  const bookAsks = agentMsgs.filter(m => m.meta?.asked_to_book).length;
  const lastConf = agentMsgs.length ? agentMsgs[agentMsgs.length - 1].meta?.confidence : null;

  function leadContext() {
    const parts = [];
    if (lead.form) parts.push(`Form submitted: ${lead.form}`);
    if (lead.age) parts.push(`Athlete age: ${lead.age}`);
    if (lead.location) parts.push(`Location: ${lead.location}`);
    if (lead.notes) parts.push(`Notes: ${lead.notes}`);
    return parts.join("\n");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) { loadLessons(); loadExamples(); } }, [session]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, busy]);

  async function loadLessons() {
    try { const d = await api("lessons"); setLessons(d.lessons || []); } catch (_) {}
  }
  async function loadExamples() {
    try { const d = await api("examples"); setExamples(d.examples || []); } catch (_) {}
  }
  async function saveExample(parent_text, agent_text) {
    try { await api("save-example", { parent_text, agent_text }); await loadExamples(); } catch (e) { setError(e.message); }
  }
  async function forgetExample(id) {
    try { await api("forget-example", { id }); await loadExamples(); } catch (e) { setError(e.message); }
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
      const d = await api("chat", { messages: next.map(m => ({ role: m.role, text: m.text })), lead_context: leadContext() });
      setMessages(m => [...m, {
        role: "agent",
        text: d.reply,
        meta: { reasoning: d.reasoning, confidence: d.confidence, escalate: d.escalate, escalate_reason: d.escalate_reason,
                followup: d.followup, followup_when: d.followup_when, followup_message: d.followup_message,
                asked_to_book: d.asked_to_book, sources: d.sources || [] },
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
          <div style={{ display: "flex", gap: 4, marginLeft: 8, background: tk.surfaceEl, borderRadius: 9, padding: 3, border: `1px solid ${tk.border}` }}>
            <Tab on={view === "chat"} onClick={() => setView("chat")}>💬 Chat</Tab>
            <Tab on={view === "brain"} onClick={() => setView("brain")}>📝 Brain</Tab>
          </div>
          <div style={{ flex: 1 }} />
          {view === "chat" && <BtnGhost onClick={() => setMessages([])}>↺ Reset chat</BtnGhost>}
        </div>

        {view === "brain" ? <BrainEditor /> :
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Chat */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Trackers + lead info */}
            <div style={{ borderBottom: `1px solid ${tk.border}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 12, color: tk.textSub }}>
              <span>💬 <b style={{ color: tk.text }}>{agentMsgs.length}</b> replies</span>
              <span>🎯 <b style={{ color: tk.text }}>{bookAsks}</b> book-asks</span>
              <span>✅ last confidence: <b style={{ color: lastConf == null ? tk.textMute : (lastConf >= 0.7 ? tk.green : lastConf >= 0.4 ? tk.amber : tk.red) }}>{lastConf == null ? "—" : Math.round(lastConf * 100) + "%"}</b></span>
              <div style={{ flex: 1 }} />
              <span onClick={() => setLeadOpen(o => !o)} style={{ cursor: "pointer", color: tk.accent }}>
                📋 Lead info {leadContext() ? "✓" : ""} {leadOpen ? "▲" : "▼"}
              </span>
            </div>
            {leadOpen && (
              <div style={{ borderBottom: `1px solid ${tk.border}`, padding: "12px 16px", background: tk.surface, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: tk.textMute, width: "100%" }}>Pre-filled form data (used to qualify, like a real lead who submitted a form):</span>
                <select value={lead.form} onChange={e => setLead({ ...lead, form: e.target.value })} style={inp(140)}>
                  <option value="">no form</option>
                  <option value="Contact form">Contact form</option>
                  <option value="Free trial form">Free trial form</option>
                </select>
                <input value={lead.age} onChange={e => setLead({ ...lead, age: e.target.value })} placeholder="athlete age" style={inp(110)} />
                <input value={lead.location} onChange={e => setLead({ ...lead, location: e.target.value })} placeholder="location" style={inp(140)} />
                <input value={lead.notes} onChange={e => setLead({ ...lead, notes: e.target.value })} placeholder="notes (e.g. plays rep)" style={inp(220)} />
              </div>
            )}
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
                : <AgentBubble key={i} m={m} parentText={messages[i - 1]?.role === "parent" ? messages[i - 1].text : ""}
                    onTeach={() => { setTeachFor(i); setTeachText(""); }}
                    teaching={teachFor === i} teachText={teachText} setTeachText={setTeachText}
                    onSave={() => saveLesson(i)} onCancel={() => setTeachFor(null)}
                    onSaveExample={saveExample} />
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

            {/* Saved examples */}
            <div style={{ fontSize: 13, fontWeight: 700, margin: "20px 0 4px" }}>⭐ Example replies</div>
            <div style={{ fontSize: 11, color: tk.textMute, marginBottom: 10 }}>Saved good answers — these set the tone and replace the default examples.</div>
            {examples.length === 0 && <div style={{ fontSize: 12, color: tk.textMute, lineHeight: 1.6 }}>None yet. Hit ⭐ on a great reply to save it.</div>}
            {examples.map(ex => (
              <div key={ex.id} style={{ background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 8, padding: "9px 11px", marginBottom: 8, fontSize: 12, lineHeight: 1.5, position: "relative" }}>
                <div style={{ color: tk.textMute, paddingRight: 16 }}>👤 {ex.parent_text}</div>
                <div style={{ color: tk.text, marginTop: 3 }}>🤖 {ex.agent_text}</div>
                <div title="remove" onClick={() => forgetExample(ex.id)} style={{ position: "absolute", top: 8, right: 10, color: tk.textMute, cursor: "pointer", fontSize: 13 }}>✕</div>
              </div>
            ))}
          </div>
        </div>}
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

function AgentBubble({ m, parentText, onSaveExample, onTeach, teaching, teachText, setTeachText, onSave, onCancel }) {
  const { reasoning, confidence, escalate, escalate_reason, followup, followup_when, followup_message, sources } = m.meta || {};
  const conf = typeof confidence === "number" ? Math.round(confidence * 100) : null;
  const confColor = conf == null ? tk.textMute : (conf >= 70 ? tk.green : conf >= 40 ? tk.amber : tk.red);
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "78%" }}>
      <div style={{ fontSize: 10, color: tk.textMute, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
        🤖 agent
        {conf != null && <span style={{ fontSize: 10, fontWeight: 700, color: confColor, background: `${confColor}1a`, border: `1px solid ${confColor}44`, borderRadius: 99, padding: "1px 7px" }}>{conf}% sure</span>}
      </div>
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
          {Array.isArray(sources) && sources.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
              <span style={{ fontSize: 10.5, color: tk.textMute }}>📍 from:</span>
              {sources.map((s, i) => (
                <span key={i} style={{ fontSize: 10.5, color: tk.blue, background: "rgba(96,165,250,0.10)", border: `1px solid ${tk.blue}33`, borderRadius: 99, padding: "1px 8px" }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {followup && (
        <div style={{ marginTop: 6, background: tk.blueGlow ? "rgba(96,165,250,0.08)" : tk.surface, border: `1px solid ${tk.blue}44`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: tk.text, lineHeight: 1.5 }}>
          🕒 <b style={{ color: tk.blue }}>Would follow up</b>{followup_when ? ` — ${followup_when}` : ""}
          {followup_message && <div style={{ marginTop: 4, color: tk.textSub, fontStyle: "italic" }}>"{followup_message}"</div>}
          <div style={{ marginTop: 3, fontSize: 10.5, color: tk.textMute }}>(sandbox — not actually scheduled yet)</div>
        </div>
      )}

      {!teaching ? (
        <div style={{ marginTop: 6, display: "flex", gap: 14 }}>
          <Mini onClick={onTeach}>📝 teach</Mini>
          {!escalate && m.text && parentText && <Mini onClick={() => onSaveExample(parentText, m.text)}>⭐ save as example</Mini>}
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

// ── Brain editor (categorized prompt sections) ──────────────────────
const GROUPS = [
  { key: "identity",   label: "🪪 Identity",            hint: "Who the agent is" },
  { key: "academy",    label: "🏠 Academy facts",       hint: "Schedule, pricing, program — the truth it speaks from" },
  { key: "behavior",   label: "🧠 Behavior",            hint: "How it talks, qualifies, handles objections" },
  { key: "guardrails", label: "🛡️ Guardrails & examples", hint: "Hard rules + sample conversations" },
];

function BrainEditor() {
  const [sections, setSections] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { load(); }, []);
  async function load() { try { const d = await api("sections"); setSections(d.sections || []); } catch (e) { setErr(e.message); } }
  if (err) return <div style={{ flex: 1, padding: 24, color: tk.red }}>⚠ {err}</div>;
  if (!sections) return <div style={{ flex: 1, padding: 24, color: tk.textSub, fontSize: 14 }}>Loading the brain…</div>;
  const editedCount = sections.filter(s => !s.is_default).length;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 20, lineHeight: 1.6 }}>
          Edit any section — saved changes hit the very next sandbox message. <span style={{ color: tk.accent }}>✏️ edited</span> marks sections you've customized{editedCount ? ` (${editedCount} so far)` : ""}.
        </div>
        {GROUPS.map(g => (
          <div key={g.key} style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{g.label}</div>
            <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 12 }}>{g.hint}</div>
            {sections.filter(s => s.group === g.key).map(s => <SectionCard key={s.key} s={s} reload={load} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionCard({ s, reload }) {
  const [body, setBody] = useState(s.body);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = body !== s.body;
  async function save() { setSaving(true); try { await api("update-section", { key: s.key, body }); await reload(); } finally { setSaving(false); } }
  async function reset() { setSaving(true); try { await api("reset-section", { key: s.key }); setBody(s.default_body); await reload(); } finally { setSaving(false); } }
  return (
    <div style={{ background: tk.surface, border: `1px solid ${dirty ? tk.accentBorder : tk.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", color: tk.textMute, fontSize: 11 }}>▶</span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</span>
        {!s.is_default && <span style={{ fontSize: 10, color: tk.accent, background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`, borderRadius: 99, padding: "1px 8px" }}>✏️ edited</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: tk.textMute }}>{open ? "hide" : "edit"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={Math.min(20, Math.max(4, body.split("\n").length + 1))}
            style={{ width: "100%", resize: "vertical", background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.borderMed}`, borderRadius: 8, padding: "10px 12px", fontFamily: F, fontSize: 13, lineHeight: 1.55, outline: "none" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button onClick={save} disabled={!dirty || saving} style={{ background: dirty ? tk.accent : tk.surfaceHov, color: dirty ? "#000" : tk.textMute, border: "none", borderRadius: 7, padding: "6px 16px", fontSize: 12.5, fontWeight: 700, cursor: dirty ? "pointer" : "default", fontFamily: F }}>{saving ? "saving…" : "Save"}</button>
            {!s.is_default && <button onClick={reset} disabled={saving} style={{ background: "transparent", color: tk.textSub, border: `1px solid ${tk.borderMed}`, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: F }}>Reset to default</button>}
            {dirty && <span style={{ fontSize: 11, color: tk.amber }}>unsaved</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const inp = (w) => ({ width: w, background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.borderMed}`, borderRadius: 7, padding: "6px 9px", fontFamily: F, fontSize: 12.5, outline: "none" });

const Tab = ({ on, onClick, children }) => (
  <button onClick={onClick} style={{ background: on ? tk.accent : "transparent", color: on ? "#000" : tk.textSub, border: "none", borderRadius: 7, padding: "5px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: F }}>{children}</button>
);

const Center = ({ children }) => (
  <div style={{ background: tk.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: tk.textSub, fontFamily: F, fontSize: 14 }}>{children}</div>
);
const Mini = ({ onClick, children }) => (
  <span onClick={onClick} style={{ fontSize: 12, color: tk.textSub, cursor: "pointer", userSelect: "none" }}>{children}</span>
);
const BtnGhost = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: "transparent", color: tk.textSub, border: `1px solid ${tk.borderMed}`, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: F }}>{children}</button>
);
