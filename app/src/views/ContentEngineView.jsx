// ═══════════════════════════════════════════════════════════════
// CONTENT ENGINE — FullControl
// ═══════════════════════════════════════════════════════════════
//
// DROP-IN GUIDE:
// 1. Place this file in your views/ or pages/ directory
// 2. Place contentEngineService.js in your services/ directory
// 3. Run the SQL from content_engine_schema.sql in your Supabase SQL Editor
// 4. Place generate-script.js in your api/content/ directory (Vercel serverless)
// 5. Make sure ANTHROPIC_API_KEY is set in your Vercel env vars
// 6. Import and render: <ContentEngineView tokens={tk} dark={dark} />
//
// PROPS:
//   tokens — your design token object (needs: bg, surface, surfaceEl, surfaceHov,
//            surfaceAlt, border, borderMed, borderStr, text, textSub, textMute,
//            accent, accentGhost, accentBorder, green, greenSoft, amber, amberSoft,
//            blue, red, redSoft, cardHover, inputGlow)
//   dark   — boolean, dark mode flag
//
// SUPABASE:
//   Expects a supabase client exported from "../lib/supabase" (or change the
//   import path in contentEngineService.js to match your project)
//
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchThemes, createTheme, updateTheme, deleteTheme,
  fetchMessages, createMessage, updateMessage, deleteMessage,
  fetchScripts, createScript, updateScriptStatus,
  fetchFeedback, createFeedback,
  massImportThemes, massImportMessages,
} from "../services/contentEngineService";

const PHASE_LABELS = { 0: "Pre-Launch", 1: "Launch", 2: "Post-Launch" };
const PHASE_COLORS = (tokens) => ({ 0: tokens.green, 1: tokens.amber, 2: tokens.blue });
const PHASE_BG = (tokens) => ({ 0: tokens.greenSoft, 1: tokens.amberSoft, 2: `${tokens.blue}15` });

const VIDEO_STYLES = [
  { value: "talking_head", label: "Talking Head" },
  { value: "selfie", label: "Selfie / iPhone" },
  { value: "pro_camera", label: "Pro Camera" },
  { value: "carousel", label: "Carousel" },
  { value: "screen_record", label: "Screen Record" },
  { value: "broll_voiceover", label: "B-Roll + Voiceover" },
  { value: "testimonial", label: "Testimonial" },
  { value: "other", label: "Other" },
];

const TONES = ["Educational", "Motivational", "Urgent", "Conversational", "Authoritative", "Storytelling", "Controversial"];

const STATUS_FLOW = ["draft", "approved", "recorded", "published"];
const STATUS_COLORS = (tokens) => ({
  draft: tokens.textMute,
  approved: tokens.amber,
  recorded: tokens.blue,
  published: tokens.green,
});

// ─── Small UI helpers ───

function Pill({ label, color, bg, style, onClick }) {
  return (
    <span onClick={onClick} style={{
      fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 9999,
      color, background: bg, whiteSpace: "nowrap", cursor: onClick ? "pointer" : "default",
      transition: "all 0.15s ease", ...style,
    }}>{label}</span>
  );
}

function SegmentToggle({ options, value, onChange, tokens }) {
  return (
    <div style={{
      display: "inline-flex", borderRadius: 10, border: `1px solid ${tokens.border}`,
      background: tokens.surfaceEl, padding: 2, gap: 2,
    }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          fontSize: 13, fontWeight: value === opt.value ? 600 : 400, padding: "6px 16px",
          borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
          background: value === opt.value ? tokens.accent : "transparent",
          color: value === opt.value ? "#fff" : tokens.textSub,
          transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function FilterPills({ options, value, onChange, tokens }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map(opt => (
        <button key={opt.value ?? "all"} onClick={() => onChange(opt.value)} style={{
          fontSize: 12, fontWeight: value === opt.value ? 600 : 400, padding: "4px 12px",
          borderRadius: 8, border: `1px solid ${value === opt.value ? tokens.accentBorder : tokens.border}`,
          cursor: "pointer", fontFamily: "inherit",
          background: value === opt.value ? tokens.accentGhost : "transparent",
          color: value === opt.value ? tokens.accent : tokens.textSub,
          transition: "all 0.15s ease",
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function EmptyState({ tokens, icon, title, subtitle }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 14, color: tokens.textMute }}>{subtitle}</div>
    </div>
  );
}

// ─── Add Theme Form ───

function AddThemeForm({ tokens, mode, onSave, onCancel }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creator, setCreator] = useState("Coleman");
  const [phase, setPhase] = useState(0);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), mode, creator, phase, sort_order: 0 });
  };

  const inputStyle = {
    width: "100%", fontSize: 14, padding: "10px 14px", borderRadius: 8,
    border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
    color: tokens.text, fontFamily: "inherit", outline: "none",
    transition: "border-color 0.15s ease",
  };

  return (
    <div style={{
      padding: 20, borderRadius: 14, border: `1px solid ${tokens.accentBorder}`,
      background: tokens.surfaceEl, marginBottom: 16,
      animation: "cardIn 0.25s ease both",
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 12 }}>New Theme</div>
      <input ref={ref} placeholder="Theme title..." value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => e.key === "Enter" && save()} style={{ ...inputStyle, marginBottom: 8 }} />
      <input placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)}
        onKeyDown={e => e.key === "Enter" && save()} style={{ ...inputStyle, marginBottom: 12 }} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["Coleman", "Zoran"].map(c => (
            <button key={c} onClick={() => setCreator(c)} style={{
              fontSize: 12, fontWeight: creator === c ? 600 : 400, padding: "4px 12px",
              borderRadius: 8, border: `1px solid ${creator === c ? tokens.accentBorder : tokens.border}`,
              background: creator === c ? tokens.accentGhost : "transparent",
              color: creator === c ? tokens.accent : tokens.textSub,
              cursor: "pointer", fontFamily: "inherit",
            }}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map(p => (
            <button key={p} onClick={() => setPhase(p)} style={{
              fontSize: 12, fontWeight: phase === p ? 600 : 400, padding: "4px 12px",
              borderRadius: 8, border: `1px solid ${phase === p ? PHASE_COLORS(tokens)[p] + "40" : tokens.border}`,
              background: phase === p ? PHASE_BG(tokens)[p] : "transparent",
              color: phase === p ? PHASE_COLORS(tokens)[p] : tokens.textSub,
              cursor: "pointer", fontFamily: "inherit",
            }}>{PHASE_LABELS[p]}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={{
          fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: 8,
          border: `1px solid ${tokens.border}`, background: "transparent",
          color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        <button onClick={save} style={{
          fontSize: 13, fontWeight: 600, padding: "6px 18px", borderRadius: 8,
          border: "none", background: tokens.accent, color: "#fff",
          cursor: "pointer", fontFamily: "inherit", opacity: title.trim() ? 1 : 0.4,
        }}>Create</button>
      </div>
    </div>
  );
}

// ─── Add Message Form ───

function AddMessageForm({ tokens, themeId, mode, onSave, onCancel }) {
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [cta, setCta] = useState("");
  const [tone, setTone] = useState("Educational");
  const [videoStyle, setVideoStyle] = useState("talking_head");
  const [phase, setPhase] = useState(0);
  const [creator, setCreator] = useState("Coleman");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      theme_id: themeId, title: title.trim(), hook: hook.trim(), cta: cta.trim(),
      tone, video_style: videoStyle, phase, mode, creator, sort_order: 0,
    });
  };

  const inputStyle = {
    width: "100%", fontSize: 14, padding: "10px 14px", borderRadius: 8,
    border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
    color: tokens.text, fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{
      padding: 20, borderRadius: 14, border: `1px solid ${tokens.accentBorder}`,
      background: tokens.surfaceEl, marginBottom: 16,
      animation: "cardIn 0.25s ease both",
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 12 }}>New Message</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input ref={ref} placeholder="Message title..." value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        <input placeholder="Hook line..." value={hook} onChange={e => setHook(e.target.value)} style={inputStyle} />
      </div>
      <input placeholder="Call to action..." value={cta} onChange={e => setCta(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.04em" }}>STYLE</div>
          <select value={videoStyle} onChange={e => setVideoStyle(e.target.value)} style={{
            ...inputStyle, width: "auto", padding: "6px 12px", fontSize: 13, cursor: "pointer",
          }}>
            {VIDEO_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.04em" }}>TONE</div>
          <select value={tone} onChange={e => setTone(e.target.value)} style={{
            ...inputStyle, width: "auto", padding: "6px 12px", fontSize: 13, cursor: "pointer",
          }}>
            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.04em" }}>PHASE</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map(p => (
              <button key={p} onClick={() => setPhase(p)} style={{
                fontSize: 11, fontWeight: phase === p ? 600 : 400, padding: "4px 10px",
                borderRadius: 6, border: `1px solid ${phase === p ? PHASE_COLORS(tokens)[p] + "40" : tokens.border}`,
                background: phase === p ? PHASE_BG(tokens)[p] : "transparent",
                color: phase === p ? PHASE_COLORS(tokens)[p] : tokens.textSub,
                cursor: "pointer", fontFamily: "inherit",
              }}>{PHASE_LABELS[p]}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 4, letterSpacing: "0.04em" }}>CREATOR</div>
          <div style={{ display: "flex", gap: 4 }}>
            {["Coleman", "Zoran"].map(c => (
              <button key={c} onClick={() => setCreator(c)} style={{
                fontSize: 11, fontWeight: creator === c ? 600 : 400, padding: "4px 10px",
                borderRadius: 6, border: `1px solid ${creator === c ? tokens.accentBorder : tokens.border}`,
                background: creator === c ? tokens.accentGhost : "transparent",
                color: creator === c ? tokens.accent : tokens.textSub,
                cursor: "pointer", fontFamily: "inherit",
              }}>{c}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: 8,
          border: `1px solid ${tokens.border}`, background: "transparent",
          color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
        }}>Cancel</button>
        <button onClick={save} style={{
          fontSize: 13, fontWeight: 600, padding: "6px 18px", borderRadius: 8,
          border: "none", background: tokens.accent, color: "#fff",
          cursor: "pointer", fontFamily: "inherit", opacity: title.trim() ? 1 : 0.4,
        }}>Create</button>
      </div>
    </div>
  );
}

// ─── Mass Import Modal ───

function MassImportPanel({ tokens, mode, onImport, onClose }) {
  const [text, setText] = useState("");
  const [importType, setImportType] = useState("themes");
  const [preview, setPreview] = useState([]);

  const parse = (raw) => {
    const lines = raw.split("\n").filter(l => l.trim());
    return lines.map(l => {
      const parts = l.split("\t").length > 1 ? l.split("\t") : l.split(",");
      return { title: (parts[0] || "").trim(), description: (parts[1] || "").trim() };
    }).filter(p => p.title);
  };

  useEffect(() => { setPreview(parse(text)); }, [text]);

  const doImport = () => {
    if (preview.length === 0) return;
    const rows = preview.map(p => ({
      title: p.title, description: p.description, mode, creator: "Coleman", phase: 0, sort_order: 0,
    }));
    onImport(rows, importType);
  };

  return (
    <div style={{
      padding: 24, borderRadius: 14, border: `1px solid ${tokens.accentBorder}`,
      background: tokens.surfaceEl, marginBottom: 16,
      animation: "cardIn 0.25s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>Mass Import</div>
        <SegmentToggle
          options={[{ value: "themes", label: "Themes" }, { value: "messages", label: "Messages" }]}
          value={importType} onChange={setImportType} tokens={tokens}
        />
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          fontSize: 13, padding: "4px 12px", borderRadius: 6,
          border: `1px solid ${tokens.border}`, background: "transparent",
          color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
        }}>&times;</button>
      </div>
      <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 8 }}>
        Paste one per line. Use tabs or commas to separate title and description.
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder={`Theme Title, Description\nAnother Theme, Its description`}
        style={{
          width: "100%", fontSize: 13, padding: "10px 14px", borderRadius: 8,
          border: `1px solid ${tokens.border}`, background: tokens.surface,
          color: tokens.text, fontFamily: "inherit", outline: "none", resize: "vertical",
          lineHeight: 1.5,
        }} />
      {preview.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 6 }}>
            Preview: {preview.length} item{preview.length !== 1 ? "s" : ""}
          </div>
          <div style={{ maxHeight: 120, overflowY: "auto", borderRadius: 8, border: `1px solid ${tokens.border}` }}>
            {preview.slice(0, 10).map((p, i) => (
              <div key={i} style={{ fontSize: 13, padding: "6px 12px", borderBottom: `1px solid ${tokens.border}`, color: tokens.text }}>
                <span style={{ fontWeight: 600 }}>{p.title}</span>
                {p.description && <span style={{ color: tokens.textMute }}> — {p.description}</span>}
              </div>
            ))}
            {preview.length > 10 && (
              <div style={{ fontSize: 12, padding: "6px 12px", color: tokens.textMute }}>+ {preview.length - 10} more...</div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={doImport} style={{
          fontSize: 13, fontWeight: 600, padding: "8px 20px", borderRadius: 8,
          border: "none", background: tokens.accent, color: "#fff",
          cursor: "pointer", fontFamily: "inherit", opacity: preview.length > 0 ? 1 : 0.4,
        }}>Import {preview.length} {importType}</button>
      </div>
    </div>
  );
}

// ─── Script Panel ───

function ScriptPanel({ tokens, message, onBack }) {
  const [scripts, setScripts] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [activeScript, setActiveScript] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    loadScripts();
  }, [message.id]);

  const loadScripts = async () => {
    const { data } = await fetchScripts(message.id);
    setScripts(data);
    if (data.length > 0) {
      setActiveScript(data[0]);
      loadFeedback(data[0].id);
    }
  };

  const loadFeedback = async (scriptId) => {
    const { data } = await fetchFeedback(scriptId);
    setFeedback(data);
  };

  const generateScript = async () => {
    setGenerating(true);
    const nextVersion = scripts.length + 1;

    try {
      const res = await fetch("/api/content/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, feedback: feedback.slice(0, 5), version: nextVersion }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      const { data } = await createScript({
        message_id: message.id, version: nextVersion,
        body: json.script, prompt_snapshot: { message, feedback: feedback.slice(0, 5) },
        status: "draft",
      });
      if (data) {
        setScripts(prev => [data, ...prev]);
        setActiveScript(data);
        setFeedback([]);
      }
    } catch (err) {
      const placeholderBody = `[Script Generation]\n\nConnect your Anthropic API key to generate scripts automatically.\n\nIn the meantime, here's the framework:\n\nHOOK: ${message.hook || "(no hook set)"}\n\nBODY:\nBased on the "${message.title}" message with a ${message.tone || "conversational"} tone.\nVideo Style: ${VIDEO_STYLES.find(s => s.value === message.video_style)?.label || message.video_style}\nPhase: ${PHASE_LABELS[message.phase] || "Pre-Launch"}\n\nCTA: ${message.cta || "(no CTA set)"}\n\n---\nReplace this with your own script or connect the API for AI generation.`;

      const { data } = await createScript({
        message_id: message.id, version: nextVersion,
        body: placeholderBody, prompt_snapshot: { message, error: err.message },
        status: "draft",
      });
      if (data) {
        setScripts(prev => [data, ...prev]);
        setActiveScript(data);
        setFeedback([]);
      }
    }
    setGenerating(false);
  };

  const advanceStatus = async () => {
    if (!activeScript) return;
    const currentIdx = STATUS_FLOW.indexOf(activeScript.status);
    if (currentIdx >= STATUS_FLOW.length - 1) return;
    const nextStatus = STATUS_FLOW[currentIdx + 1];
    const { data } = await updateScriptStatus(activeScript.id, nextStatus);
    if (data) {
      setActiveScript(data);
      setScripts(prev => prev.map(s => s.id === data.id ? data : s));
    }
  };

  const submitFeedback = async (source = "text", body = "") => {
    const text = body || feedbackText.trim();
    if (!text || !activeScript) return;
    const { data } = await createFeedback({ script_id: activeScript.id, source, body: text });
    if (data) {
      setFeedback(prev => [data, ...prev]);
      setFeedbackText("");
    }
  };

  // Voice transcription
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Speech recognition not supported in this browser."); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join(" ");
      submitFeedback("voice", transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const vsLabel = VIDEO_STYLES.find(s => s.value === message.video_style)?.label || message.video_style;

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      {/* Back + message meta */}
      <div onClick={onBack} style={{
        fontSize: 13, fontWeight: 500, color: tokens.accent, cursor: "pointer",
        marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Messages
      </div>

      {/* Message attributes */}
      <div style={{
        padding: 20, borderRadius: 14, background: tokens.surfaceEl,
        border: `1px solid ${tokens.border}`, marginBottom: 20,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: tokens.text, marginBottom: 10, letterSpacing: "-0.02em" }}>
          {message.title}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Pill label={vsLabel} color={tokens.accent} bg={tokens.accentGhost} />
          <Pill label={message.tone || "—"} color={tokens.textSub} bg={tokens.surfaceHov} />
          <Pill label={PHASE_LABELS[message.phase] || "Pre-Launch"} color={PHASE_COLORS(tokens)[message.phase]} bg={PHASE_BG(tokens)[message.phase]} />
          <Pill label={message.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
        </div>
        {message.hook && (
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: tokens.textMute }}>Hook: </span>
            <span style={{ color: tokens.text }}>{message.hook}</span>
          </div>
        )}
        {message.cta && (
          <div style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: tokens.textMute }}>CTA: </span>
            <span style={{ color: tokens.text }}>{message.cta}</span>
          </div>
        )}
      </div>

      {/* Generate / Version selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={generateScript} disabled={generating} style={{
          fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 10,
          border: "none", background: tokens.accent, color: "#fff",
          cursor: generating ? "wait" : "pointer", fontFamily: "inherit",
          opacity: generating ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8,
          transition: "all 0.2s ease",
        }}>
          {generating ? (
            <>
              <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
              Generating...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              {scripts.length === 0 ? "Generate Script" : "Regenerate"}
            </>
          )}
        </button>
        {scripts.length > 1 && (
          <div style={{ display: "flex", gap: 4 }}>
            {scripts.map(s => (
              <button key={s.id} onClick={() => { setActiveScript(s); loadFeedback(s.id); }} style={{
                fontSize: 12, fontWeight: activeScript?.id === s.id ? 600 : 400, padding: "4px 10px",
                borderRadius: 6, border: `1px solid ${activeScript?.id === s.id ? tokens.accentBorder : tokens.border}`,
                background: activeScript?.id === s.id ? tokens.accentGhost : "transparent",
                color: activeScript?.id === s.id ? tokens.accent : tokens.textSub,
                cursor: "pointer", fontFamily: "inherit",
              }}>v{s.version}</button>
            ))}
          </div>
        )}
        {activeScript && (
          <div onClick={advanceStatus} style={{
            marginLeft: "auto", fontSize: 12, fontWeight: 600, padding: "4px 14px",
            borderRadius: 8, cursor: "pointer",
            color: STATUS_COLORS(tokens)[activeScript.status],
            border: `1px solid ${STATUS_COLORS(tokens)[activeScript.status]}40`,
            background: `${STATUS_COLORS(tokens)[activeScript.status]}10`,
            transition: "all 0.15s ease",
          }}
            title="Click to advance status"
          >
            {activeScript.status.charAt(0).toUpperCase() + activeScript.status.slice(1)}
            {STATUS_FLOW.indexOf(activeScript.status) < STATUS_FLOW.length - 1 && " \u2192"}
          </div>
        )}
      </div>

      {/* Script body */}
      {activeScript ? (
        <div style={{
          padding: 24, borderRadius: 14, background: tokens.surface,
          border: `1px solid ${tokens.border}`, marginBottom: 20,
          fontSize: 14, lineHeight: 1.8, color: tokens.text,
          whiteSpace: "pre-wrap", fontFamily: "inherit",
          minHeight: 200,
        }}>
          {activeScript.body}
        </div>
      ) : (
        <div style={{
          padding: 40, borderRadius: 14, border: `1px dashed ${tokens.border}`,
          textAlign: "center", color: tokens.textMute, fontSize: 14, marginBottom: 20,
        }}>
          No script yet. Click "Generate Script" to create one.
        </div>
      )}

      {/* Feedback section */}
      {activeScript && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 10 }}>Feedback</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitFeedback()}
              placeholder="Type feedback or use voice..."
              style={{
                flex: 1, fontSize: 14, padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
                color: tokens.text, fontFamily: "inherit", outline: "none",
              }} />
            <button onClick={() => submitFeedback()} style={{
              fontSize: 13, fontWeight: 600, padding: "10px 16px", borderRadius: 8,
              border: "none", background: tokens.accent, color: "#fff",
              cursor: "pointer", fontFamily: "inherit", opacity: feedbackText.trim() ? 1 : 0.4,
            }}>Send</button>
            <button onClick={toggleVoice} style={{
              width: 40, height: 40, borderRadius: 8, border: `1px solid ${listening ? tokens.red : tokens.border}`,
              background: listening ? tokens.redSoft : tokens.surfaceEl,
              color: listening ? tokens.red : tokens.textMute,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s ease",
              animation: listening ? "gentlePulse 1s ease-in-out infinite" : "none",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          </div>
          {feedback.length > 0 && (
            <div style={{ borderRadius: 10, border: `1px solid ${tokens.border}`, overflow: "hidden" }}>
              {feedback.map((fb, i) => (
                <div key={fb.id || i} style={{
                  padding: "10px 14px", borderBottom: i < feedback.length - 1 ? `1px solid ${tokens.border}` : "none",
                  fontSize: 13, color: tokens.text,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Pill label={fb.source === "voice" ? "Voice" : "Text"} color={fb.source === "voice" ? tokens.blue : tokens.textMute}
                      bg={fb.source === "voice" ? `${tokens.blue}15` : tokens.surfaceHov}
                      style={{ fontSize: 10, padding: "1px 6px" }} />
                    <span style={{ fontSize: 11, color: tokens.textMute }}>
                      {new Date(fb.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  {fb.body}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Theme Notes Panel ───

function ThemeNotes({ tokens, theme, onSave }) {
  const [notes, setNotes] = useState(theme.notes || "");
  const [saved, setSaved] = useState(true);
  const timer = useRef(null);

  const handleChange = (val) => {
    setNotes(val);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave(theme.id, { notes: val });
      setSaved(true);
    }, 800);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <textarea value={notes} onChange={e => handleChange(e.target.value)} rows={3}
        placeholder="Theme notes..."
        style={{
          width: "100%", fontSize: 13, padding: "10px 14px", borderRadius: 8,
          border: `1px solid ${tokens.border}`, background: tokens.surface,
          color: tokens.text, fontFamily: "inherit", outline: "none", resize: "vertical",
          lineHeight: 1.5,
        }} />
      <div style={{ fontSize: 11, color: saved ? tokens.green : tokens.textMute, marginTop: 4 }}>
        {saved ? "Saved" : "Saving..."}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// ─── Main Content Engine View ───
// ═══════════════════════════════════════════

export default function ContentEngineView({ tokens, dark }) {
  // Navigation state
  const [view, setView] = useState("themes"); // "themes" | "messages" | "script"
  const [mode, setMode] = useState("paid"); // "paid" | "organic"
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState(null);

  // Data state
  const [themes, setThemes] = useState([]);
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [showAddTheme, setShowAddTheme] = useState(false);
  const [showAddMsg, setShowAddMsg] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // ─── Data loading ───

  const loadThemes = useCallback(async () => {
    setLoading(true);
    const filters = { mode };
    if (creatorFilter !== "all") filters.creator = creatorFilter;
    if (phaseFilter !== null) filters.phase = phaseFilter;
    const { data } = await fetchThemes(filters);
    setThemes(data);
    setLoading(false);
  }, [mode, creatorFilter, phaseFilter]);

  useEffect(() => { loadThemes(); }, [loadThemes]);

  const loadMessages = async (themeId) => {
    const { data } = await fetchMessages(themeId);
    setMessages(data);
  };

  // ─── Handlers ───

  const handleCreateTheme = async (theme) => {
    const { data } = await createTheme(theme);
    if (data) { setThemes(prev => [data, ...prev]); setShowAddTheme(false); }
  };

  const handleDeleteTheme = async (id) => {
    await deleteTheme(id);
    setThemes(prev => prev.filter(t => t.id !== id));
  };

  const handleCreateMessage = async (msg) => {
    const { data } = await createMessage(msg);
    if (data) { setMessages(prev => [data, ...prev]); setShowAddMsg(false); }
  };

  const handleDeleteMessage = async (id) => {
    await deleteMessage(id);
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleMassImport = async (rows, type) => {
    if (type === "themes") {
      const { data } = await massImportThemes(rows);
      if (data.length > 0) { loadThemes(); setShowImport(false); }
    } else {
      if (!selectedTheme) return;
      const withThemeId = rows.map(r => ({ ...r, theme_id: selectedTheme.id }));
      const { data } = await massImportMessages(withThemeId);
      if (data.length > 0) { loadMessages(selectedTheme.id); setShowImport(false); }
    }
  };

  const drillIntoTheme = (theme) => {
    setSelectedTheme(theme);
    setView("messages");
    loadMessages(theme.id);
  };

  const drillIntoMessage = (msg) => {
    setSelectedMsg(msg);
    setView("script");
  };

  const goBackToThemes = () => {
    setView("themes");
    setSelectedTheme(null);
    setMessages([]);
  };

  const goBackToMessages = () => {
    setView("messages");
    setSelectedMsg(null);
  };

  // ─── Breadcrumb ───

  const Breadcrumb = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 13 }}>
      <span onClick={goBackToThemes} style={{
        color: view === "themes" ? tokens.text : tokens.accent, fontWeight: view === "themes" ? 600 : 400,
        cursor: view === "themes" ? "default" : "pointer",
      }}>Themes</span>
      {selectedTheme && (
        <>
          <span style={{ color: tokens.textMute }}>/</span>
          <span onClick={view === "script" ? goBackToMessages : undefined} style={{
            color: view === "messages" ? tokens.text : tokens.accent,
            fontWeight: view === "messages" ? 600 : 400,
            cursor: view === "script" ? "pointer" : "default",
          }}>{selectedTheme.title}</span>
        </>
      )}
      {selectedMsg && (
        <>
          <span style={{ color: tokens.textMute }}>/</span>
          <span style={{ color: tokens.text, fontWeight: 600 }}>{selectedMsg.title}</span>
        </>
      )}
    </div>
  );

  // ─── Render ───

  return (
    <div>
      {/* These CSS keyframes are required — add to your global styles or keep here */}
      <style>{`
        @keyframes cardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes dashPulse{0%,100%{opacity:0.4}50%{opacity:0.8}}
        @keyframes gentlePulse{0%,100%{opacity:1}50%{opacity:0.7}}
      `}</style>

      {/* Header controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <SegmentToggle
          options={[{ value: "paid", label: "Paid Ads" }, { value: "organic", label: "Organic" }]}
          value={mode} onChange={(v) => { setMode(v); setView("themes"); setSelectedTheme(null); }}
          tokens={tokens}
        />
        <div style={{ width: 1, height: 24, background: tokens.border }} />
        <FilterPills
          options={[{ value: "all", label: "All" }, { value: "Coleman", label: "Coleman" }, { value: "Zoran", label: "Zoran" }]}
          value={creatorFilter} onChange={setCreatorFilter} tokens={tokens}
        />
        <div style={{ width: 1, height: 24, background: tokens.border }} />
        <FilterPills
          options={[
            { value: null, label: "All Phases" },
            { value: 0, label: "Pre-Launch" },
            { value: 1, label: "Launch" },
            { value: 2, label: "Post-Launch" },
          ]}
          value={phaseFilter} onChange={setPhaseFilter} tokens={tokens}
        />
        <div style={{ flex: 1 }} />
        {view === "themes" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowImport(p => !p)} style={{
              fontSize: 13, fontWeight: 500, padding: "8px 14px", borderRadius: 8,
              border: `1px solid ${tokens.border}`, background: "transparent",
              color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}>Import</button>
            <button onClick={() => setShowAddTheme(p => !p)} style={{
              fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 8,
              border: "none", background: tokens.accent, color: "#fff",
              cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}>+ Add Theme</button>
          </div>
        )}
        {view === "messages" && (
          <button onClick={() => setShowAddMsg(p => !p)} style={{
            fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 8,
            border: "none", background: tokens.accent, color: "#fff",
            cursor: "pointer", fontFamily: "inherit",
          }}>+ Add Message</button>
        )}
      </div>

      <Breadcrumb />

      {/* Mass Import */}
      {showImport && (
        <MassImportPanel tokens={tokens} mode={mode} onImport={handleMassImport} onClose={() => setShowImport(false)} />
      )}

      {/* THEMES VIEW */}
      {view === "themes" && (
        <>
          {showAddTheme && (
            <AddThemeForm tokens={tokens} mode={mode} onSave={handleCreateTheme} onCancel={() => setShowAddTheme(false)} />
          )}

          {loading ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  height: 120, borderRadius: 14, background: tokens.surfaceEl,
                  border: `1px solid ${tokens.border}`,
                  animation: "dashPulse 1.5s ease-in-out infinite",
                  animationDelay: `${i * 100}ms`,
                }} />
              ))}
            </div>
          ) : themes.length === 0 ? (
            <EmptyState tokens={tokens} icon={"\uD83C\uDFAC"} title="No themes yet"
              subtitle={`Create your first ${mode === "paid" ? "paid ads" : "organic"} theme to get started.`} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {themes.map((theme, i) => {
                const msgCount = theme.content_messages?.[0]?.count || 0;
                return (
                  <div key={theme.id} onClick={() => drillIntoTheme(theme)} style={{
                    padding: 20, borderRadius: 14, background: tokens.surfaceEl,
                    border: `1px solid ${tokens.border}`, cursor: "pointer",
                    transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                    animation: `cardIn 0.3s ease ${i * 40}ms both`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = tokens.cardHover; e.currentTarget.style.borderColor = tokens.borderStr; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = tokens.border; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, flex: 1, lineHeight: 1.3 }}>{theme.title}</div>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteTheme(theme.id); }} style={{
                        background: "none", border: "none", color: tokens.textMute, cursor: "pointer",
                        fontSize: 16, lineHeight: 1, padding: "0 4px", opacity: 0.4,
                        transition: "opacity 0.15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = tokens.red; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.color = tokens.textMute; }}
                      >&times;</button>
                    </div>
                    {theme.description && (
                      <div style={{ fontSize: 13, color: tokens.textSub, marginBottom: 10, lineHeight: 1.4 }}>{theme.description}</div>
                    )}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill label={PHASE_LABELS[theme.phase] || "Pre-Launch"} color={PHASE_COLORS(tokens)[theme.phase]} bg={PHASE_BG(tokens)[theme.phase]} />
                      <Pill label={theme.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
                      <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: "auto" }}>
                        {msgCount} message{msgCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {theme.notes && (
                      <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        Has notes
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* MESSAGES VIEW */}
      {view === "messages" && selectedTheme && (
        <>
          <div onClick={goBackToThemes} style={{
            fontSize: 13, fontWeight: 500, color: tokens.accent, cursor: "pointer",
            marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Themes
          </div>

          {/* Theme header */}
          <div style={{
            padding: 20, borderRadius: 14, background: tokens.surfaceEl,
            border: `1px solid ${tokens.border}`, marginBottom: 20,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em" }}>
              {selectedTheme.title}
            </div>
            {selectedTheme.description && (
              <div style={{ fontSize: 14, color: tokens.textSub, marginBottom: 10 }}>{selectedTheme.description}</div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <Pill label={PHASE_LABELS[selectedTheme.phase]} color={PHASE_COLORS(tokens)[selectedTheme.phase]} bg={PHASE_BG(tokens)[selectedTheme.phase]} />
              <Pill label={selectedTheme.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
              <Pill label={`${messages.length} messages`} color={tokens.textMute} bg={tokens.surfaceHov} />
            </div>
            <ThemeNotes tokens={tokens} theme={selectedTheme} onSave={updateTheme} />
          </div>

          {showAddMsg && (
            <AddMessageForm tokens={tokens} themeId={selectedTheme.id} mode={mode}
              onSave={handleCreateMessage} onCancel={() => setShowAddMsg(false)} />
          )}

          {/* Active cap indicator */}
          {messages.length > 0 && (() => {
            const activeCount = messages.filter(m => m.is_active !== false).length;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: activeCount > 20 ? tokens.red : tokens.green }}>
                  {activeCount}/20 active
                </span>
                <span style={{ color: tokens.textMute }}>
                  {messages.length - activeCount > 0 ? `\u00b7 ${messages.length - activeCount} queued` : ""}
                </span>
              </div>
            );
          })()}

          {messages.length === 0 ? (
            <EmptyState tokens={tokens} icon={"\uD83D\uDCAC"} title="No messages yet"
              subtitle="Add your first message to this theme." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {messages.map((msg, i) => {
                const vsLabel = VIDEO_STYLES.find(s => s.value === msg.video_style)?.label || msg.video_style || "\u2014";
                const isQueued = msg.is_active === false;
                return (
                  <div key={msg.id} onClick={() => drillIntoMessage(msg)} style={{
                    display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
                    borderRadius: 12, background: tokens.surfaceEl,
                    border: `1px solid ${tokens.border}`, cursor: "pointer",
                    borderLeft: `3px solid ${isQueued ? tokens.textMute : (PHASE_COLORS(tokens)[msg.phase] || tokens.accent)}`,
                    opacity: isQueued ? 0.5 : 1,
                    transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
                    animation: `cardIn 0.3s ease ${i * 30}ms both`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = tokens.cardHover; e.currentTarget.style.borderColor = tokens.borderStr; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = tokens.border; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>{msg.title}</div>
                      {msg.hook && (
                        <div style={{ fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msg.hook}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {isQueued && <Pill label="Queued" color={tokens.textMute} bg={tokens.surfaceHov} />}
                      <Pill label={vsLabel} color={tokens.accent} bg={tokens.accentGhost} />
                      <Pill label={msg.tone || "\u2014"} color={tokens.textSub} bg={tokens.surfaceHov} />
                      <Pill label={PHASE_LABELS[msg.phase] || "\u2014"} color={PHASE_COLORS(tokens)[msg.phase]} bg={PHASE_BG(tokens)[msg.phase]} />
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }} style={{
                      background: "none", border: "none", color: tokens.textMute, cursor: "pointer",
                      fontSize: 16, lineHeight: 1, padding: "0 4px", opacity: 0.3,
                    }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = tokens.red; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = "0.3"; e.currentTarget.style.color = tokens.textMute; }}
                    >&times;</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* SCRIPT VIEW */}
      {view === "script" && selectedMsg && (
        <ScriptPanel tokens={tokens} message={selectedMsg} onBack={goBackToMessages} />
      )}
    </div>
  );
}
