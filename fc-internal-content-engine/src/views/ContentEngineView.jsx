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

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  fetchThemes, createTheme, updateTheme, deleteTheme,
  fetchCreatives, createCreative, updateCreative, deleteCreative,
  fetchScripts, createScript, updateScriptStatus,
  fetchFeedback, createFeedback,
  massImportThemes, massImportCreatives,
} from "../services/contentEngineService";

const PHASE_LABELS = { 0: "Pre-Launch", 1: "Launch", 2: "Post-Launch" };
const PHASE_COLORS = (tokens) => ({ 0: tokens.green, 1: tokens.amber, 2: tokens.blue });
const PHASE_BG = (tokens) => ({ 0: tokens.greenSoft, 1: tokens.amberSoft, 2: `${tokens.blue}15` });

const VIDEO_STYLES = [
  { value: "talking_head", label: "Talking Head — Founder Direct" },
  { value: "ugc", label: "UGC — User-Generated Style" },
  { value: "screen_record", label: "Screen Recording — Product Demo" },
  { value: "quick_graphics", label: "Quick Graphics — Motion Design" },
  { value: "funny_jarvis", label: "Funny Vibes — Jarvis Concept" },
];

const TONES = ["Educational", "Motivational", "Urgent", "Conversational", "Authoritative", "Storytelling", "Controversial"];

const PSYCH_LEVERS = ["FOMO", "Pain Point", "Solution", "Urgency", "Aspiration", "Simplicity", "Curiosity", "Value", "Authority", "Objection Handler", "Social Proof", "Humor"];

const PERSONAS = ["", "Young Hungry", "Established"];

const PSYCH_LEVER_COLORS = {
  "FOMO": "#e74c3c", "Pain Point": "#e67e22", "Solution": "#27ae60", "Urgency": "#c0392b",
  "Aspiration": "#8e44ad", "Simplicity": "#3498db", "Curiosity": "#f39c12", "Value": "#2ecc71",
  "Authority": "#2c3e50", "Objection Handler": "#d35400", "Social Proof": "#16a085", "Humor": "#e91e63",
};

const STATUS_FLOW = ["draft", "approved", "recorded", "published"];
const STATUS_COLORS = (tokens) => ({
  draft: tokens.textMute,
  approved: tokens.amber,
  recorded: tokens.blue,
  published: tokens.green,
});

const ANDROMEDA_RULES = {
  MIN_CREATIVES_PER_THEME: 8,
  MAX_CREATIVES_PER_THEME: 20,
  MIN_FORMATS: 3,
  MIN_PSYCH_LEVERS: 3,
  REFRESH_CADENCE_DAYS: 14,
  ORGANIC_BEFORE_PAID: 5,
};

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
          transform: value === opt.value ? "scale(1.05)" : "scale(1)",
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function EmptyState({ tokens, icon, title, subtitle }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", animation: "cardIn 0.4s ease both" }}>
      <div style={{
        fontSize: 48, marginBottom: 16, opacity: 0.25,
        filter: "grayscale(0.3)",
      }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tokens.text, marginBottom: 6, letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontSize: 14, color: tokens.textMute, maxWidth: 320, margin: "0 auto", lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  );
}

// ─── Diversity Score helper (kept for future use) ───

function getDiversityScore(creatives) {
  if (!creatives || creatives.length === 0) return 0;
  const uniqueLevers = new Set(creatives.map(c => c.psych_lever).filter(Boolean));
  const uniqueFormats = new Set(creatives.map(c => c.video_style).filter(Boolean));
  const count = creatives.length;
  const leverScore = (uniqueLevers.size / PSYCH_LEVERS.length) * 0.4;
  const formatScore = (uniqueFormats.size / VIDEO_STYLES.length) * 0.3;
  const countScore = (Math.min(count, 15) / 15) * 0.3;
  return leverScore + formatScore + countScore;
}

function getDiversityColor(score, tokens) {
  if (score > 0.6) return tokens.green;
  if (score >= 0.3) return tokens.amber;
  return tokens.red;
}

// DiversityDot kept for later use — removed from themes view
function DiversityDot({ score, tokens }) {
  const [hovered, setHovered] = useState(false);
  const color = getDiversityColor(score, tokens);
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: "50%", background: color,
        display: "inline-block", marginLeft: 6, flexShrink: 0,
      }} />
      {hovered && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)",
          fontSize: 11, fontWeight: 600, color: "#fff", background: "rgba(0,0,0,0.8)",
          padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none",
        }}>
          Diversity: {Math.round(score * 100)}%
        </span>
      )}
    </span>
  );
}

// ─── Andromeda Advisor (collapsible) ───

function AndromedaAdvisor({ tokens, creatives }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [collapsed, setCollapsed] = useState(true);

  const suggestions = useMemo(() => {
    const results = [];
    if (!creatives) return results;

    // 1. Creative volume
    if (creatives.length < ANDROMEDA_RULES.MIN_CREATIVES_PER_THEME) {
      results.push({
        id: "volume",
        type: "volume",
        severity: "critical",
        message: `This theme has ${creatives.length} creative${creatives.length !== 1 ? "s" : ""}. Andromeda needs 8-15 for optimal matching.`,
      });
    }

    // 2. Psych lever concentration
    const leverCounts = {};
    creatives.forEach(c => {
      if (c.psych_lever) leverCounts[c.psych_lever] = (leverCounts[c.psych_lever] || 0) + 1;
    });
    const usedLevers = Object.keys(leverCounts);
    const missingLevers = PSYCH_LEVERS.filter(l => !usedLevers.includes(l));
    Object.entries(leverCounts).forEach(([lever, count]) => {
      if (count >= 3) {
        const suggestMissing = missingLevers.slice(0, 3).join(", ") || "other angles";
        results.push({
          id: `lever-${lever}`,
          type: "lever_concentration",
          severity: "warning",
          message: `You have ${count} creatives using '${lever}' angles. Andromeda may cluster these. Diversify with ${suggestMissing}.`,
        });
      }
    });

    // 3. Format gap
    const uniqueFormats = new Set(creatives.map(c => c.video_style).filter(Boolean));
    if (uniqueFormats.size < ANDROMEDA_RULES.MIN_FORMATS) {
      const missingFormats = VIDEO_STYLES.filter(s => !uniqueFormats.has(s.value)).map(s => s.label).slice(0, 3).join(", ");
      results.push({
        id: "format-gap",
        type: "format_gap",
        severity: "warning",
        message: `Only ${uniqueFormats.size} format(s) used. Andromeda rewards format diversity — try ${missingFormats}.`,
      });
    }

    // 4. Stale creatives
    const now = Date.now();
    const staleThreshold = ANDROMEDA_RULES.REFRESH_CADENCE_DAYS * 24 * 60 * 60 * 1000;
    const staleCount = creatives.filter(c => c.created_at && (now - new Date(c.created_at).getTime()) > staleThreshold).length;
    if (staleCount > 0) {
      results.push({
        id: "stale",
        type: "stale",
        severity: "info",
        message: `${staleCount} creative${staleCount !== 1 ? "s are" : " is"} older than ${ANDROMEDA_RULES.REFRESH_CADENCE_DAYS} days. Consider refreshing hooks or thumbnails.`,
      });
    }

    // 5. Phase imbalance
    const phaseCounts = {};
    creatives.forEach(c => {
      const p = c.phase ?? 0;
      phaseCounts[p] = (phaseCounts[p] || 0) + 1;
    });
    const phaseValues = Object.values(phaseCounts);
    if (phaseValues.length > 1) {
      const maxPhase = Math.max(...phaseValues);
      const minPhase = Math.min(...phaseValues);
      if (maxPhase >= minPhase * 3) {
        const heavyPhase = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])[0];
        results.push({
          id: "phase-imbalance",
          type: "phase_imbalance",
          severity: "info",
          message: `Your creatives skew toward ${PHASE_LABELS[heavyPhase[0]] || "a phase"}. Consider balancing across phases.`,
        });
      }
    }

    // 6. Persona balance
    const personaCounts = {};
    creatives.forEach(c => {
      if (c.persona) personaCounts[c.persona] = (personaCounts[c.persona] || 0) + 1;
    });
    const personaKeys = Object.keys(personaCounts);
    if (personaKeys.length === 1) {
      results.push({
        id: "persona-balance",
        type: "persona_balance",
        severity: "info",
        message: `Library skews toward ${personaKeys[0]}. Create variations for the other persona.`,
      });
    } else if (personaKeys.length > 1) {
      const personaVals = Object.values(personaCounts);
      const maxP = Math.max(...personaVals);
      const minP = Math.min(...personaVals);
      if (maxP >= minP * 3) {
        const heavyPersona = Object.entries(personaCounts).sort((a, b) => b[1] - a[1])[0];
        results.push({
          id: "persona-balance",
          type: "persona_balance",
          severity: "info",
          message: `Library skews toward ${heavyPersona[0]}. Create variations for the other persona.`,
        });
      }
    }

    return results;
  }, [creatives]);

  const visibleSuggestions = suggestions.filter(s => !dismissed.has(s.id));

  if (visibleSuggestions.length === 0) return null;

  const severityColors = {
    info: { bg: `${tokens.green}12`, border: `${tokens.green}30`, text: tokens.green },
    warning: { bg: `${tokens.amber}12`, border: `${tokens.amber}30`, text: tokens.amber },
    critical: { bg: `${tokens.red}12`, border: `${tokens.red}30`, text: tokens.red },
  };

  return (
    <div style={{
      borderRadius: 14, marginBottom: 20,
      background: `${tokens.green}08`, border: `1px solid ${tokens.green}25`,
      animation: "cardIn 0.3s ease both",
      overflow: "hidden",
    }}>
      <div
        onClick={() => setCollapsed(prev => !prev)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: 16,
          fontSize: 14, fontWeight: 700, color: tokens.green,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{
          fontSize: 10, display: "inline-block",
          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: "transform 0.2s ease",
        }}>{"\u25BC"}</span>
        <span style={{ fontSize: 16 }}>{"\u26A1"}</span>
        Andromeda Advisor
        {collapsed && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 9999,
            background: `${tokens.green}20`, color: tokens.green, marginLeft: 8,
          }}>
            {visibleSuggestions.length} suggestion{visibleSuggestions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 16px" }}>
          {visibleSuggestions.map(s => {
            const colors = severityColors[s.severity] || severityColors.info;
            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
                borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`,
                fontSize: 13, color: tokens.text, lineHeight: 1.4,
              }}>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: colors.text, marginTop: 1 }}>
                  {s.severity === "critical" ? "\u2757" : s.severity === "warning" ? "\u26A0\uFE0F" : "\u2139\uFE0F"}
                </span>
                <span style={{ flex: 1 }}>{s.message}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set([...prev, s.id])); }}
                  style={{
                    flexShrink: 0, background: "none", border: "none", color: tokens.textMute,
                    cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.5,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "0.5"; }}
                >&times;</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Add Theme Form ───

function AddThemeForm({ tokens, mode, onSave, onCancel }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("AI Advantage");
  const [creator, setCreator] = useState("Coleman");
  const [phase, setPhase] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(""); }
  };
  const removeTag = (tag) => setTags(tags.filter(t => t !== tag));

  const save = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), category, mode, creator, phase, sort_order: 0, tags });
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
        onKeyDown={e => e.key === "Enter" && save()} style={{ ...inputStyle, marginBottom: 8 }} />
      {/* Tags */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: tags.length ? 6 : 0 }}>
          {tags.map(tag => (
            <span key={tag} onClick={() => removeTag(tag)} style={{
              fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
              background: tokens.accentGhost, color: tokens.accent, cursor: "pointer",
              border: `1px solid ${tokens.accentBorder}`, display: "flex", alignItems: "center", gap: 4,
            }}>{tag} <span style={{ fontSize: 13, lineHeight: 1 }}>&times;</span></span>
          ))}
        </div>
        <input placeholder="Add a tag (optional) — press Enter" value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } if (e.key === "," && tagInput.trim()) { e.preventDefault(); addTag(); } }}
          style={{ ...inputStyle, fontSize: 13 }} />
      </div>
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

// ─── Add Creative Form ───

function AddCreativeForm({ tokens, themeId, mode, onSave, onCancel }) {
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [cta, setCta] = useState("");
  const [tone, setTone] = useState("Educational");
  const [videoStyle, setVideoStyle] = useState("talking_head");
  const [phase, setPhase] = useState(0);
  const [creator, setCreator] = useState("Coleman");
  const [psychLever, setPsychLever] = useState("");
  const [persona, setPersona] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      theme_id: themeId, title: title.trim(), hook: hook.trim(), cta: cta.trim(),
      tone, video_style: videoStyle, phase, mode, creator, sort_order: 0,
      psych_lever: psychLever || null, persona: persona || null,
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
      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 12 }}>New Creative</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input ref={ref} placeholder="Creative title..." value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
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
      {/* Psych Lever pills */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 6, letterSpacing: "0.04em" }}>PSYCH LEVER</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {PSYCH_LEVERS.map(lever => (
            <button key={lever} onClick={() => setPsychLever(psychLever === lever ? "" : lever)} style={{
              fontSize: 11, fontWeight: psychLever === lever ? 600 : 400, padding: "4px 10px",
              borderRadius: 6, border: `1px solid ${psychLever === lever ? tokens.accentBorder : tokens.border}`,
              background: psychLever === lever ? tokens.accentGhost : "transparent",
              color: psychLever === lever ? tokens.accent : tokens.textSub,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
            }}>{lever}</button>
          ))}
        </div>
      </div>
      {/* Persona selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginBottom: 6, letterSpacing: "0.04em" }}>PERSONA</div>
        <div style={{ display: "flex", gap: 4 }}>
          {PERSONAS.filter(p => p !== "").map(p => (
            <button key={p} onClick={() => setPersona(persona === p ? "" : p)} style={{
              fontSize: 11, fontWeight: persona === p ? 600 : 400, padding: "4px 10px",
              borderRadius: 6, border: `1px solid ${persona === p ? tokens.accentBorder : tokens.border}`,
              background: persona === p ? tokens.accentGhost : "transparent",
              color: persona === p ? tokens.accent : tokens.textSub,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
            }}>{p}</button>
          ))}
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
          options={[{ value: "themes", label: "Themes" }, { value: "creatives", label: "Creatives" }]}
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

function ScriptPanel({ tokens, creative, onBack }) {
  const [scripts, setScripts] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [activeScript, setActiveScript] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    loadScripts();
  }, [creative.id]);

  const loadScripts = async () => {
    const { data } = await fetchScripts(creative.id);
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
        body: JSON.stringify({ message: creative, feedback: feedback.slice(0, 5), version: nextVersion }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");

      const { data } = await createScript({
        creative_id: creative.id, version: nextVersion,
        body: json.script, prompt_snapshot: { creative, feedback: feedback.slice(0, 5) },
        status: "draft",
      });
      if (data) {
        setScripts(prev => [data, ...prev]);
        setActiveScript(data);
        setFeedback([]);
      }
    } catch (err) {
      const placeholderBody = `[Script Generation]\n\nConnect your Anthropic API key to generate scripts automatically.\n\nIn the meantime, here's the framework:\n\nHOOK: ${creative.hook || "(no hook set)"}\n\nBODY:\nBased on the "${creative.title}" creative with a ${creative.tone || "conversational"} tone.\nVideo Style: ${VIDEO_STYLES.find(s => s.value === creative.video_style)?.label || creative.video_style}\nPhase: ${PHASE_LABELS[creative.phase] || "Pre-Launch"}\n\nCTA: ${creative.cta || "(no CTA set)"}\n\n---\nReplace this with your own script or connect the API for AI generation.`;

      const { data } = await createScript({
        creative_id: creative.id, version: nextVersion,
        body: placeholderBody, prompt_snapshot: { creative, error: err.message },
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

  const vsLabel = VIDEO_STYLES.find(s => s.value === creative.video_style)?.label || creative.video_style;

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      {/* Back + creative meta */}
      <div onClick={onBack} style={{
        fontSize: 13, fontWeight: 500, color: tokens.accent, cursor: "pointer",
        marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Creatives
      </div>

      {/* Creative attributes */}
      <div style={{
        padding: 20, borderRadius: 14, background: tokens.surfaceEl,
        border: `1px solid ${tokens.border}`, marginBottom: 20,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: tokens.text, marginBottom: 10, letterSpacing: "-0.02em" }}>
          {creative.title}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Pill label={vsLabel} color={tokens.accent} bg={tokens.accentGhost} />
          <Pill label={creative.tone || "\u2014"} color={tokens.textSub} bg={tokens.surfaceHov} />
          <Pill label={PHASE_LABELS[creative.phase] || "Pre-Launch"} color={PHASE_COLORS(tokens)[creative.phase]} bg={PHASE_BG(tokens)[creative.phase]} />
          <Pill label={creative.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
          {creative.psych_lever && (
            <Pill label={creative.psych_lever} color={tokens.blue} bg={`${tokens.blue}15`} />
          )}
          {creative.persona && (
            <Pill label={creative.persona} color={tokens.amber} bg={tokens.amberSoft} />
          )}
        </div>
        {creative.hook && (
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: tokens.textMute }}>Hook: </span>
            <span style={{ color: tokens.text }}>{creative.hook}</span>
          </div>
        )}
        {creative.cta && (
          <div style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: tokens.textMute }}>CTA: </span>
            <span style={{ color: tokens.text }}>{creative.cta}</span>
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
        <div style={{ position: "relative", marginBottom: 20 }}>
          <div style={{
            padding: 24, borderRadius: 14, background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            fontSize: 14, lineHeight: 1.8, color: tokens.text,
            whiteSpace: "pre-wrap", fontFamily: "inherit",
            minHeight: 200,
          }}>
            {activeScript.body}
          </div>
          <button onClick={() => { navigator.clipboard.writeText(activeScript.body); }}
            style={{
              position: "absolute", top: 10, right: 10, fontSize: 11, fontWeight: 500,
              padding: "4px 10px", borderRadius: 6, border: `1px solid ${tokens.border}`,
              background: tokens.surfaceEl, color: tokens.textMute, cursor: "pointer",
              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMute; }}
            onClickCapture={e => { const btn = e.currentTarget; const orig = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = orig; }, 1500); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
      ) : (
        <div style={{
          padding: 48, borderRadius: 14, border: `1px dashed ${tokens.border}`,
          textAlign: "center", color: tokens.textMute, fontSize: 14, marginBottom: 20,
          animation: "cardIn 0.3s ease both",
        }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>{"\uD83D\uDCDD"}</div>
          <div style={{ fontWeight: 600, color: tokens.text, marginBottom: 4 }}>No script yet</div>
          <div>Click "Generate Script" to create an AI-powered script for this creative.</div>
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

// ─── Theme Notes Panel (collapsible) ───

// ─── Generate Creative Modal ───
function GenerateCreativeModal({ tokens, themes, onSave, onClose, onCreateTheme }) {
  const [prompt, setPrompt] = useState("");
  const [videoStyle, setVideoStyle] = useState("");
  const [tone, setTone] = useState("");
  const [psychLever, setPsychLever] = useState("");
  const [persona, setPersona] = useState("");
  const [phase, setPhase] = useState(0);
  const [suggestTheme, setSuggestTheme] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [error, setError] = useState("");
  const [voiceRecording, setVoiceRecording] = useState(false);
  const voiceRecRef = useRef(null);

  const toggleVoiceDirection = () => {
    if (voiceRecording) { voiceRecRef.current?.stop(); setVoiceRecording(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported. Try Chrome."); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setPrompt(prev => prev ? prev + " " + t : t); };
    r.onerror = () => setVoiceRecording(false); r.onend = () => setVoiceRecording(false);
    voiceRecRef.current = r; r.start(); setVoiceRecording(true);
  };

  const generate = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const guardrails = {};
      if (videoStyle) guardrails.video_style = videoStyle;
      if (tone) guardrails.tone = tone;
      if (psychLever) guardrails.psych_lever = psychLever;
      if (persona) guardrails.persona = persona;
      guardrails.phase = phase;

      const res = await fetch("/api/content/generate-creative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, guardrails, themes, suggestTheme }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else {
        setResult(data.creative);
        setSelectedThemeId(data.creative.suggested_theme_id || "");
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const saveCreative = async () => {
    if (!result || !selectedThemeId) return;
    await onSave({
      theme_id: selectedThemeId,
      title: result.title,
      hook: result.hook || "",
      cta: result.cta || "",
      tone: result.tone || "Conversational",
      video_style: result.video_style || "talking_head",
      psych_lever: result.psych_lever || "",
      persona: result.persona || "",
      notes: result.notes || "",
      phase,
      mode: "paid",
      creator: "AI",
      sort_order: 0,
    });
    onClose();
  };

  const inputStyle = {
    width: "100%", fontSize: 14, padding: "10px 14px", borderRadius: 8,
    border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
    color: tokens.text, fontFamily: "inherit", outline: "none",
  };
  const chipStyle = (active) => ({
    fontSize: 12, fontWeight: active ? 600 : 400, padding: "5px 12px",
    borderRadius: 8, border: `1px solid ${active ? tokens.accentBorder : tokens.border}`,
    background: active ? tokens.accentGhost : "transparent",
    color: active ? tokens.accent : tokens.textSub,
    cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
  });

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      animation: "cardIn 0.2s ease both",
    }}>
      <div className="ce-generate-modal" onClick={e => e.stopPropagation()} style={{
        background: tokens.surface, borderRadius: 20, padding: 28,
        width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto",
        border: `1px solid ${tokens.border}`,
        boxShadow: `0 24px 48px rgba(0,0,0,0.2), 0 0 0 1px ${tokens.border}`,
        animation: "modalSlideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={tokens.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span style={{ fontSize: 18, fontWeight: 700, color: tokens.text }}>Generate Creative</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: tokens.textMute, cursor: "pointer", fontSize: 20 }}>&times;</button>
        </div>

        {!result ? (
          <>
            {/* Prompt */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 6, display: "block" }}>
                Direction <span style={{ fontWeight: 400, color: tokens.textMute }}>(optional — or let AI surprise you)</span>
              </label>
              <div style={{ position: "relative" }}>
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder="e.g., 'Something about how owners are drowning in admin' or 'A funny take on checking 6 different apps'..."
                  rows={3} style={{ ...inputStyle, resize: "vertical", paddingRight: 48 }} />
                <button onClick={toggleVoiceDirection} style={{
                  position: "absolute", right: 8, top: 8, width: 34, height: 34, borderRadius: 8,
                  border: `1px solid ${voiceRecording ? tokens.red : tokens.border}`,
                  background: voiceRecording ? tokens.redSoft : tokens.surfaceEl,
                  color: voiceRecording ? tokens.red : tokens.textMute,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s ease",
                  animation: voiceRecording ? "gentlePulse 1s ease-in-out infinite" : "none",
                }} title={voiceRecording ? "Stop recording" : "Speak your direction"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
                {voiceRecording && (
                  <span style={{
                    position: "absolute", right: 48, top: 14, fontSize: 11, fontWeight: 600,
                    color: tokens.red, animation: "gentlePulse 1s ease-in-out infinite",
                  }}>Listening...</span>
                )}
              </div>
            </div>

            {/* Guardrails */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 6, display: "block" }}>
                Video Style <span style={{ fontWeight: 400, color: tokens.textMute }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {VIDEO_STYLES.map(s => (
                  <button key={s.value} onClick={() => setVideoStyle(videoStyle === s.value ? "" : s.value)}
                    style={chipStyle(videoStyle === s.value)}>{s.label.split(" — ")[0]}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 6, display: "block" }}>
                Tone <span style={{ fontWeight: 400, color: tokens.textMute }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {TONES.map(t => (
                  <button key={t} onClick={() => setTone(tone === t ? "" : t)} style={chipStyle(tone === t)}>{t}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 6, display: "block" }}>
                Psych Lever <span style={{ fontWeight: 400, color: tokens.textMute }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PSYCH_LEVERS.map(p => (
                  <button key={p} onClick={() => setPsychLever(psychLever === p ? "" : p)} style={chipStyle(psychLever === p)}>{p}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 6, display: "block" }}>
                Persona <span style={{ fontWeight: 400, color: tokens.textMute }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                {["Young Hungry", "Established"].map(p => (
                  <button key={p} onClick={() => setPersona(persona === p ? "" : p)} style={chipStyle(persona === p)}>{p}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                onClick={() => setSuggestTheme(!suggestTheme)}>
                <div style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: `1.5px solid ${suggestTheme ? tokens.accent : tokens.border}`,
                  background: suggestTheme ? tokens.accentGhost : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
                }}>{suggestTheme && <span style={{ fontSize: 12, color: tokens.accent }}>&#10003;</span>}</div>
                Can suggest new themes if nothing fits
              </label>
            </div>

            {error && <div style={{ fontSize: 13, color: tokens.red, marginBottom: 12, padding: "8px 12px", background: tokens.redSoft, borderRadius: 8 }}>{error}</div>}

            <button onClick={generate} disabled={loading} style={{
              width: "100%", fontSize: 14, fontWeight: 600, padding: "12px 20px", borderRadius: 10,
              border: "none", background: loading ? tokens.surfaceHov : `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent}dd)`,
              color: loading ? tokens.textMute : "#0E0D0B", cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s",
            }}>
              {loading ? (
                <><span style={{ display: "inline-block", width: 14, height: 14, border: `2px solid ${tokens.textMute}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} /> Generating...</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Generate Creative</>
              )}
            </button>
          </>
        ) : (
          /* ─── Result view ─── */
          <>
            <div style={{ padding: 16, borderRadius: 12, background: tokens.surfaceEl, border: `1px solid ${tokens.border}`, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text, marginBottom: 8 }}>{result.title}</div>
              {result.hook && <div style={{ fontSize: 13, color: tokens.textSub, marginBottom: 6 }}><strong style={{ color: tokens.accent }}>Hook:</strong> {result.hook}</div>}
              {result.cta && <div style={{ fontSize: 13, color: tokens.textSub, marginBottom: 6 }}><strong style={{ color: tokens.accent }}>CTA:</strong> {result.cta}</div>}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                {result.tone && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: tokens.surfaceHov, color: tokens.textSub }}>{result.tone}</span>}
                {result.video_style && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: tokens.surfaceHov, color: tokens.textSub }}>{result.video_style}</span>}
                {result.psych_lever && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: tokens.surfaceHov, color: tokens.textSub }}>{result.psych_lever}</span>}
              </div>
              {result.notes && <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 10, lineHeight: 1.5, fontStyle: "italic" }}>{result.notes}</div>}
            </div>

            {/* Theme selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tokens.textSub, marginBottom: 8, display: "block" }}>
                Save under theme {result.suggested_theme_title && <span style={{ fontWeight: 400, color: tokens.textMute }}>— AI suggests: "{result.suggested_theme_title}"</span>}
              </label>
              <select value={selectedThemeId} onChange={e => setSelectedThemeId(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">Select a theme...</option>
                {themes.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.id === result.suggested_theme_id ? " ★" : ""}</option>
                ))}
              </select>
              {result.also_fits?.length > 0 && (
                <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 4 }}>
                  Also fits: {result.also_fits.map(id => themes.find(t => t.id === id)?.title).filter(Boolean).join(", ")}
                </div>
              )}
            </div>

            {result.new_theme_suggestion && (
              <div style={{
                padding: 12, borderRadius: 10, background: tokens.accentGhost,
                border: `1px solid ${tokens.accentBorder}`, marginBottom: 16,
                fontSize: 13, color: tokens.accent, display: "flex", alignItems: "center", gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                AI suggests a new theme: <strong>"{result.new_theme_suggestion}"</strong>
                <button onClick={async () => {
                  const { data } = await onCreateTheme({ title: result.new_theme_suggestion, description: "", mode: "paid", creator: "AI", phase: 0, sort_order: 0 });
                  if (data) setSelectedThemeId(data.id);
                }} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                  border: `1px solid ${tokens.accent}`, background: "transparent",
                  color: tokens.accent, cursor: "pointer", fontFamily: "inherit", marginLeft: "auto",
                }}>Create it</button>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setResult(null); setError(""); }} style={{
                flex: 1, fontSize: 13, fontWeight: 500, padding: "10px 16px", borderRadius: 8,
                border: `1px solid ${tokens.border}`, background: "transparent",
                color: tokens.textSub, cursor: "pointer", fontFamily: "inherit",
              }}>Regenerate</button>
              <button onClick={saveCreative} disabled={!selectedThemeId} style={{
                flex: 2, fontSize: 14, fontWeight: 600, padding: "10px 20px", borderRadius: 8,
                border: "none", background: selectedThemeId ? `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent}dd)` : tokens.surfaceHov,
                color: selectedThemeId ? "#0E0D0B" : tokens.textMute,
                cursor: selectedThemeId ? "pointer" : "not-allowed", fontFamily: "inherit",
              }}>Save Creative</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ThemeCard({ theme, index, tokens, onDrill, onDelete, onUpdate, onCopy, currentMode }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleVal, setTitleVal] = useState(theme.title);
  const [descVal, setDescVal] = useState(theme.description || "");
  const [hovered, setHovered] = useState(false);
  const titleRef = useRef(null);
  const descRef = useRef(null);
  const creativeCount = theme.content_creatives?.[0]?.count || 0;

  useEffect(() => { setTitleVal(theme.title); setDescVal(theme.description || ""); }, [theme.title, theme.description]);
  useEffect(() => { if (editingTitle) titleRef.current?.focus(); }, [editingTitle]);
  useEffect(() => { if (editingDesc) descRef.current?.focus(); }, [editingDesc]);

  const saveTitle = () => {
    setEditingTitle(false);
    if (titleVal.trim() && titleVal.trim() !== theme.title) onUpdate(theme.id, { title: titleVal.trim() });
    else setTitleVal(theme.title);
  };
  const saveDesc = () => {
    setEditingDesc(false);
    if (descVal.trim() !== (theme.description || "")) onUpdate(theme.id, { description: descVal.trim() });
    else setDescVal(theme.description || "");
  };

  return (
    <div style={{
      padding: 24, borderRadius: 16, background: tokens.surface,
      border: `1px solid ${hovered ? `${tokens.accent}40` : "transparent"}`,
      cursor: "pointer",
      transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
      animation: `cardIn 0.3s ease ${index * 40}ms both`,
      minHeight: 160, display: "flex", flexDirection: "column",
      transform: hovered ? "translateY(-4px)" : "translateY(0)",
      boxShadow: hovered ? "0 8px 28px rgba(200,168,78,0.10), 0 2px 8px rgba(0,0,0,0.06)" : "none",
    }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!editingTitle && !editingDesc) onDrill(theme); }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        {editingTitle ? (
          <input ref={titleRef} value={titleVal} onChange={e => setTitleVal(e.target.value)}
            onBlur={saveTitle} onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitleVal(theme.title); setEditingTitle(false); } }}
            onClick={e => e.stopPropagation()}
            style={{
              fontSize: 16, fontWeight: 700, color: tokens.text, flex: 1, lineHeight: 1.35,
              background: tokens.surfaceEl, border: `1px solid ${tokens.accent}`, borderRadius: 6,
              padding: "4px 8px", fontFamily: "inherit", outline: "none",
              boxShadow: `0 0 0 2px ${tokens.accentGhost}`,
            }}
          />
        ) : (
          <div style={{
            fontSize: 16, fontWeight: 700, color: tokens.text, flex: 1, lineHeight: 1.35,
            borderRadius: 6, padding: "4px 0", transition: "background 0.15s",
          }}
            onClick={e => { e.stopPropagation(); setEditingTitle(true); }}
            title="Click to edit title"
          >
            {theme.title}
            <span style={{ fontSize: 11, color: tokens.textMute, marginLeft: 6, opacity: hovered ? 0.6 : 0, transition: "opacity 0.2s ease" }}>✎</span>
          </div>
        )}
        <button onClick={(e) => { e.stopPropagation(); onDelete(theme.id); }} style={{
          background: "none", border: "none", color: tokens.textMute, cursor: "pointer",
          fontSize: 16, lineHeight: 1, padding: "0 4px", opacity: hovered ? 0.5 : 0,
          transition: "opacity 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = tokens.red; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = hovered ? "0.5" : "0"; e.currentTarget.style.color = tokens.textMute; }}
        >&times;</button>
      </div>

      {editingDesc ? (
        <textarea ref={descRef} value={descVal} onChange={e => setDescVal(e.target.value)}
          onBlur={saveDesc} onKeyDown={e => { if (e.key === "Escape") { setDescVal(theme.description || ""); setEditingDesc(false); } }}
          onClick={e => e.stopPropagation()}
          rows={3}
          style={{
            fontSize: 13, color: tokens.textSub, marginBottom: 12, lineHeight: 1.5,
            background: tokens.surfaceEl, border: `1px solid ${tokens.accent}`, borderRadius: 6,
            padding: "6px 8px", fontFamily: "inherit", outline: "none", resize: "vertical", width: "100%",
            boxShadow: `0 0 0 2px ${tokens.accentGhost}`,
          }}
        />
      ) : (
        <div style={{
          fontSize: 13, color: tokens.textSub, marginBottom: 12, lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", borderRadius: 6, padding: "2px 0", transition: "background 0.15s",
          minHeight: 20,
        }}
          onClick={e => { e.stopPropagation(); setEditingDesc(true); }}
          title="Click to edit description"
        >
          {theme.description || <span style={{ color: tokens.textMute, fontStyle: "italic" }}>Add a description...</span>}
          {hovered && !theme.description && null}
        </div>
      )}

      <div style={{ flex: 1 }} />
      {/* Tags */}
      {theme.tags && theme.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
          {theme.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
              background: tokens.accentGhost, color: tokens.accent,
              border: `1px solid ${tokens.accentBorder}`,
            }}>{tag}</span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 12, borderTop: `1px solid ${tokens.border}` }}>
        <Pill label={PHASE_LABELS[theme.phase] || "Pre-Launch"} color={PHASE_COLORS(tokens)[theme.phase]} bg={PHASE_BG(tokens)[theme.phase]} />
        <Pill label={theme.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
        <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: "auto", fontWeight: 600 }}>
          {creativeCount} creative{creativeCount !== 1 ? "s" : ""}
        </span>
        {hovered && onCopy && (
          <button onClick={e => { e.stopPropagation(); onCopy(theme); }}
            title={`Copy to ${currentMode === "paid" ? "Organic" : "Paid Ads"}`}
            style={{
              fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 6,
              border: `1px solid ${tokens.border}`, background: "transparent",
              color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 4,
              transition: "all 0.15s", marginLeft: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.color = tokens.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMute; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            → {currentMode === "paid" ? "Organic" : "Paid"}
          </button>
        )}
      </div>
    </div>
  );
}

function CreativeCard({ creative, index, tokens, onDrill, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [titleVal, setTitleVal] = useState(creative.title);
  const [hookVal, setHookVal] = useState(creative.hook || "");
  const [hovered, setHovered] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => { setTitleVal(creative.title); setHookVal(creative.hook || ""); }, [creative.title, creative.hook]);
  useEffect(() => { if (editing) titleRef.current?.focus(); }, [editing]);

  const vsLabel = VIDEO_STYLES.find(s => s.value === creative.video_style)?.label || creative.video_style || "\u2014";
  const isQueued = creative.is_active === false;

  const save = () => {
    setEditing(false);
    const updates = {};
    if (titleVal.trim() && titleVal.trim() !== creative.title) updates.title = titleVal.trim();
    if (hookVal.trim() !== (creative.hook || "")) updates.hook = hookVal.trim();
    if (Object.keys(updates).length > 0) onUpdate(creative.id, updates);
    else { setTitleVal(creative.title); setHookVal(creative.hook || ""); }
  };

  if (editing) {
    return (
      <div style={{
        padding: "14px 20px", borderRadius: 12, background: tokens.surfaceEl,
        border: `1px solid ${tokens.accent}`, animation: `cardIn 0.2s ease both`,
        borderLeft: `3px solid ${tokens.accent}`,
        boxShadow: `0 0 0 2px ${tokens.accentGhost}`,
      }} onClick={e => e.stopPropagation()}>
        <input ref={titleRef} value={titleVal} onChange={e => setTitleVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitleVal(creative.title); setHookVal(creative.hook || ""); setEditing(false); } }}
          placeholder="Creative title..."
          style={{
            width: "100%", fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 6,
            background: "transparent", border: "none", outline: "none", fontFamily: "inherit", padding: 0,
          }}
        />
        <input value={hookVal} onChange={e => setHookVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitleVal(creative.title); setHookVal(creative.hook || ""); setEditing(false); } }}
          placeholder="Hook / opening line..."
          style={{
            width: "100%", fontSize: 13, color: tokens.textSub, marginBottom: 8,
            background: "transparent", border: "none", outline: "none", fontFamily: "inherit", padding: 0,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => { setTitleVal(creative.title); setHookVal(creative.hook || ""); setEditing(false); }} style={{
            fontSize: 12, fontWeight: 500, padding: "4px 12px", borderRadius: 6,
            border: `1px solid ${tokens.border}`, background: "transparent",
            color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
          }}>Cancel</button>
          <button onClick={save} style={{
            fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6,
            border: "none", background: tokens.accent,
            color: "#0E0D0B", cursor: "pointer", fontFamily: "inherit",
          }}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ce-creative-row" style={{
      display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
      borderRadius: 12, background: tokens.surfaceEl,
      border: `1px solid ${hovered ? `${tokens.accent}30` : "transparent"}`, cursor: "pointer",
      borderLeft: `3px solid ${isQueued ? tokens.textMute : (creative.psych_lever && PSYCH_LEVER_COLORS[creative.psych_lever] ? PSYCH_LEVER_COLORS[creative.psych_lever] : (PHASE_COLORS(tokens)[creative.phase] || tokens.accent))}`,
      opacity: isQueued ? 0.5 : 1,
      transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
      animation: `cardIn 0.3s ease ${index * 30}ms both`,
      transform: hovered ? "translateY(-2px)" : "translateY(0)",
      boxShadow: hovered ? tokens.cardHover : "none",
    }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onDrill(creative)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          {creative.title}
          {creative.creator === "AI" && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
              background: `linear-gradient(135deg, ${tokens.accent}25, ${tokens.accent}15)`,
              color: tokens.accent, border: `1px solid ${tokens.accent}30`,
              letterSpacing: "0.04em", lineHeight: "16px", flexShrink: 0,
            }}>AI</span>
          )}
          <span onClick={e => { e.stopPropagation(); setEditing(true); }}
            style={{ fontSize: 12, color: tokens.textMute, opacity: hovered ? 0.6 : 0, cursor: "pointer", transition: "opacity 0.2s ease" }}
            title="Click to edit">✎</span>
        </div>
        {creative.hook && (
          <div style={{ fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {creative.hook}
          </div>
        )}
      </div>
      <div className="ce-creative-pills" style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {isQueued && <Pill label="Queued" color={tokens.textMute} bg={tokens.surfaceHov} />}
        <Pill label={vsLabel} color={tokens.accent} bg={tokens.accentGhost} />
        <Pill label={creative.tone || "\u2014"} color={tokens.textSub} bg={tokens.surfaceHov} />
        <Pill label={PHASE_LABELS[creative.phase] || "\u2014"} color={PHASE_COLORS(tokens)[creative.phase]} bg={PHASE_BG(tokens)[creative.phase]} />
        {creative.psych_lever && <Pill label={creative.psych_lever} color={tokens.blue} bg={`${tokens.blue}15`} />}
        {creative.persona && <Pill label={creative.persona} color={tokens.amber} bg={tokens.amberSoft} />}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDelete(creative.id); }} style={{
        background: "none", border: "none", color: tokens.textMute, cursor: "pointer",
        fontSize: 16, lineHeight: 1, padding: "0 4px", opacity: hovered ? 0.5 : 0,
        transition: "opacity 0.15s",
      }}
        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = tokens.red; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = hovered ? "0.5" : "0"; e.currentTarget.style.color = tokens.textMute; }}
      >&times;</button>
    </div>
  );
}

function ThemeNotes({ tokens, theme, onSave }) {
  const [notes, setNotes] = useState(theme.notes || "");
  const [saved, setSaved] = useState(true);
  const [expanded, setExpanded] = useState(false);
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
      <span
        onClick={() => setExpanded(prev => !prev)}
        style={{
          fontSize: 12, color: tokens.textMute, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
          userSelect: "none",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = tokens.text; }}
        onMouseLeave={e => { e.currentTarget.style.color = tokens.textMute; }}
      >
        {"\uD83D\uDCDD"} Notes
        {notes && !expanded && <span style={{ fontSize: 11, opacity: 0.6 }}> (has content)</span>}
      </span>
      {expanded && (
        <>
          <textarea value={notes} onChange={e => handleChange(e.target.value)} rows={3}
            placeholder="Theme notes..."
            style={{
              width: "100%", fontSize: 13, padding: "10px 14px", borderRadius: 8,
              border: `1px solid ${tokens.border}`, background: tokens.surface,
              color: tokens.text, fontFamily: "inherit", outline: "none", resize: "vertical",
              lineHeight: 1.5, marginTop: 8,
            }} />
          <div style={{ fontSize: 11, color: saved ? tokens.green : tokens.textMute, marginTop: 4 }}>
            {saved ? "Saved" : "Saving..."}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Pipeline (Kanban) View ───

function PipelineView({ creatives, tokens, onDrill, onDelete, onUpdate }) {
  const [dragId, setDragId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const columns = STATUS_FLOW.map(status => ({
    status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
    items: creatives.filter(c => (c.status || "draft") === status),
  }));

  const statusColors = STATUS_COLORS(tokens);

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    // Needed for Firefox
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== status) setDragOverCol(status);
  };

  const handleDragLeave = (e, status) => {
    // Only clear if actually leaving the column (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverCol === status) setDragOverCol(null);
    }
  };

  const handleDrop = (e, newStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    if (!dragId) return;
    const creative = creatives.find(c => c.id === dragId);
    if (!creative) return;
    const currentStatus = creative.status || "draft";
    if (currentStatus !== newStatus) {
      onUpdate(dragId, { status: newStatus });
    }
    setDragId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverCol(null);
  };

  return (
    <div className="ce-pipeline" style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 12,
      minHeight: 200,
      animation: "cardIn 0.3s ease both",
    }}>
      {columns.map(col => (
        <div
          key={col.status}
          onDragOver={(e) => handleDragOver(e, col.status)}
          onDragLeave={(e) => handleDragLeave(e, col.status)}
          onDrop={(e) => handleDrop(e, col.status)}
          style={{
            borderRadius: 12,
            background: dragOverCol === col.status
              ? `${statusColors[col.status]}12`
              : `${tokens.surfaceEl}80`,
            border: `1px solid ${dragOverCol === col.status ? statusColors[col.status] + "50" : tokens.border}`,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            transition: "all 0.2s ease",
            minHeight: 120,
          }}
        >
          {/* Column header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "4px 6px", marginBottom: 2,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: statusColors[col.status],
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 12, fontWeight: 700, color: tokens.text,
              letterSpacing: "0.03em", textTransform: "uppercase",
            }}>{col.label}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, color: tokens.textMute,
              marginLeft: "auto",
            }}>{col.items.length}</span>
          </div>

          {/* Cards */}
          {col.items.length === 0 && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: tokens.textMute, opacity: 0.5,
              border: `1px dashed ${tokens.border}`, borderRadius: 8, minHeight: 60,
            }}>
              Drop here
            </div>
          )}
          {col.items.map(creative => {
            const isDragging = dragId === creative.id;
            return (
              <div
                key={creative.id}
                draggable
                onDragStart={(e) => handleDragStart(e, creative.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onDrill(creative)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: tokens.surfaceEl,
                  border: `1px solid ${tokens.border}`,
                  borderLeft: `3px solid ${creative.psych_lever && PSYCH_LEVER_COLORS[creative.psych_lever] ? PSYCH_LEVER_COLORS[creative.psych_lever] : tokens.accent}`,
                  cursor: "grab",
                  opacity: isDragging ? 0.4 : 1,
                  transition: "all 0.15s ease",
                  userSelect: "none",
                }}
                onMouseEnter={e => {
                  if (!isDragging) {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = tokens.cardHover || `0 2px 8px ${tokens.accent}20`;
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{
                  fontSize: 13, fontWeight: 600, color: tokens.text,
                  marginBottom: 4, lineHeight: 1.3,
                  overflow: "hidden", textOverflow: "ellipsis",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>{creative.title}</div>
                {creative.hook && (
                  <div style={{
                    fontSize: 11, color: tokens.textSub, marginBottom: 6,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{creative.hook}</div>
                )}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {creative.psych_lever && (
                    <Pill label={creative.psych_lever} color={tokens.blue} bg={`${tokens.blue}15`}
                      style={{ fontSize: 10, padding: "1px 7px" }} />
                  )}
                  {creative.video_style && (
                    <Pill
                      label={VIDEO_STYLES.find(s => s.value === creative.video_style)?.label?.split(" — ")[0] || creative.video_style}
                      color={tokens.accent} bg={tokens.accentGhost}
                      style={{ fontSize: 10, padding: "1px 7px" }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════
// ─── Main Content Engine View ───
// ═══════════════════════════════════════════

export default function ContentEngineView({ tokens, dark }) {
  // Navigation state
  const [view, setView] = useState("themes"); // "themes" | "creatives" | "script"
  const [mode, setMode] = useState("paid"); // "paid" | "organic"
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Data state
  const [themes, setThemes] = useState([]);
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [creatives, setCreatives] = useState([]);
  const [selectedCreative, setSelectedCreative] = useState(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [showAddTheme, setShowAddTheme] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAddCreative, setShowAddCreative] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creativesViewMode, setCreativesViewMode] = useState("list"); // "list" | "pipeline"

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

  const loadCreatives = async (themeId) => {
    const { data } = await fetchCreatives(themeId);
    setCreatives(data);
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

  const handleCreateCreative = async (creative) => {
    const { data } = await createCreative(creative);
    if (data) { setCreatives(prev => [data, ...prev]); setShowAddCreative(false); }
  };

  const handleDeleteCreative = async (id) => {
    await deleteCreative(id);
    setCreatives(prev => prev.filter(m => m.id !== id));
  };

  const handleMassImport = async (rows, type) => {
    if (type === "themes") {
      const { data } = await massImportThemes(rows);
      if (data.length > 0) { loadThemes(); setShowImport(false); }
    } else {
      if (!selectedTheme) return;
      const withThemeId = rows.map(r => ({ ...r, theme_id: selectedTheme.id }));
      const { data } = await massImportCreatives(withThemeId);
      if (data.length > 0) { loadCreatives(selectedTheme.id); setShowImport(false); }
    }
  };

  const drillIntoTheme = (theme) => {
    setSelectedTheme(theme);
    setView("creatives");
    loadCreatives(theme.id);
  };

  const drillIntoCreative = (creative) => {
    setSelectedCreative(creative);
    setView("script");
  };

  const goBackToThemes = () => {
    setView("themes");
    setSelectedTheme(null);
    setCreatives([]);
  };

  const goBackToCreatives = () => {
    setView("creatives");
    setSelectedCreative(null);
  };

  // ─── Group themes by category ───

  const groupedThemes = useMemo(() => {
    const groups = {};
    themes.forEach(theme => {
      const cat = theme.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(theme);
    });
    return groups;
  }, [themes]);

  // ─── Breadcrumb ───

  const Breadcrumb = () => (
    <div className="ce-breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 13, animation: "cardIn 0.25s ease both" }}>
      <span onClick={goBackToThemes} style={{
        color: view === "themes" ? tokens.text : tokens.accent, fontWeight: view === "themes" ? 600 : 400,
        cursor: view === "themes" ? "default" : "pointer",
      }}>Themes</span>
      {selectedTheme && (
        <>
          <span style={{ color: tokens.textMute }}>/</span>
          <span onClick={view === "script" ? goBackToCreatives : undefined} style={{
            color: view === "creatives" ? tokens.text : tokens.accent,
            fontWeight: view === "creatives" ? 600 : 400,
            cursor: view === "script" ? "pointer" : "default",
          }}>{selectedTheme.title}</span>
        </>
      )}
      {selectedCreative && (
        <>
          <span style={{ color: tokens.textMute }}>/</span>
          <span style={{ color: tokens.text, fontWeight: 600 }}>{selectedCreative.title}</span>
        </>
      )}
    </div>
  );

  // ─── Active advanced filter count for badge ───
  const advancedFilterCount = (creatorFilter !== "all" ? 1 : 0) + (phaseFilter !== null ? 1 : 0);

  // ─── Render ───

  return (
    <div>
      {/* CSS keyframes */}
      <style>{`
        @keyframes cardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @media(max-width:768px){
          .ce-root{padding:16px 12px!important}
          .ce-header{flex-direction:column!important;gap:10px!important;align-items:stretch!important}
          .ce-header-title{font-size:20px!important}
          .ce-filters{flex-wrap:wrap!important;gap:6px!important}
          .ce-actions{flex-wrap:wrap!important;gap:6px!important;justify-content:stretch!important}
          .ce-actions button{flex:1!important;min-width:0!important;text-align:center!important;justify-content:center!important}
          .ce-theme-grid{grid-template-columns:1fr!important;gap:12px!important}
          .ce-creative-row{flex-direction:column!important;align-items:stretch!important;gap:10px!important}
          .ce-creative-pills{justify-content:flex-start!important;flex-wrap:wrap!important}
          .ce-pipeline{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
          .ce-breadcrumb{flex-wrap:wrap!important;font-size:12px!important}
          .ce-generate-modal{padding:20px!important;max-width:100%!important;margin:8px!important;max-height:92vh!important}
          .ce-andromeda{flex-direction:column!important}
        }
        @media(max-width:480px){
          .ce-root{padding:12px 8px!important}
          .ce-actions button{font-size:12px!important;padding:6px 10px!important}
          .ce-creative-row{padding:12px 14px!important}
          .ce-pipeline{grid-template-columns:1fr 1fr!important;gap:6px!important}
        }
        @keyframes dashPulse{0%,100%{opacity:0.4}50%{opacity:0.8}}
        @keyframes gentlePulse{0%,100%{opacity:1}50%{opacity:0.7}}
        @keyframes modalSlideUp{from{opacity:0;transform:translateY(24px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes skeletonPulse{0%{opacity:0.3}50%{opacity:0.6}100%{opacity:0.3}}
      `}</style>

      {/* Header controls — simplified to 1 row */}
      <div className="ce-header" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showAdvancedFilters ? 8 : 24, flexWrap: "wrap" }}>
        <SegmentToggle
          options={[{ value: "paid", label: "Paid Ads" }, { value: "organic", label: "Organic" }]}
          value={mode} onChange={(v) => { setMode(v); setView("themes"); setSelectedTheme(null); }}
          tokens={tokens}
        />
        <div style={{ width: 1, height: 24, background: tokens.border }} />
        {/* Collapsible advanced filters toggle */}
        <button
          onClick={() => setShowAdvancedFilters(prev => !prev)}
          style={{
            fontSize: 12, fontWeight: 500, padding: "4px 10px", borderRadius: 8,
            border: `1px solid ${showAdvancedFilters || advancedFilterCount > 0 ? tokens.accentBorder : tokens.border}`,
            background: showAdvancedFilters || advancedFilterCount > 0 ? tokens.accentGhost : "transparent",
            color: showAdvancedFilters || advancedFilterCount > 0 ? tokens.accent : tokens.textMute,
            cursor: "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 4,
            transition: "all 0.15s ease",
          }}
        >
          {"\u2699"} Filters
          {advancedFilterCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, width: 16, height: 16, borderRadius: "50%",
              background: tokens.accent, color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>{advancedFilterCount}</span>
          )}
        </button>
        <div style={{ flex: 1 }} />
        {view === "themes" && (
          <div className="ce-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setShowImport(p => !p)} style={{
              fontSize: 13, fontWeight: 400, padding: "6px 12px", borderRadius: 8,
              border: "none", background: "transparent",
              color: tokens.textMute, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
              onMouseEnter={e => { e.currentTarget.style.color = tokens.text; }}
              onMouseLeave={e => { e.currentTarget.style.color = tokens.textMute; }}
            >Import</button>
            <button onClick={() => setShowAddTheme(p => !p)} style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${tokens.accentBorder}`, background: "transparent",
              color: tokens.accent, cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 4,
              transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = tokens.accentGhost; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >+ Add Theme</button>
            <button onClick={() => setShowGenerate(true)} style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              border: "none", background: `linear-gradient(135deg, ${tokens.accent}, ${tokens.accent}dd)`,
              color: "#0E0D0B", cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 6,
              transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
              boxShadow: `0 2px 8px ${tokens.accent}30`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 4px 16px ${tokens.accent}40`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 2px 8px ${tokens.accent}30`; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              Generate
            </button>
          </div>
        )}
        {view === "creatives" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* List / Pipeline toggle */}
            <div style={{
              display: "inline-flex", borderRadius: 8, border: `1px solid ${tokens.border}`,
              background: tokens.surfaceEl, padding: 2, gap: 1,
            }}>
              <button onClick={() => setCreativesViewMode("list")} title="List view" style={{
                padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                background: creativesViewMode === "list" ? tokens.accent : "transparent",
                color: creativesViewMode === "list" ? "#0E0D0B" : tokens.textMute,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s ease",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
              <button onClick={() => setCreativesViewMode("pipeline")} title="Pipeline view" style={{
                padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                background: creativesViewMode === "pipeline" ? tokens.accent : "transparent",
                color: creativesViewMode === "pipeline" ? "#0E0D0B" : tokens.textMute,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s ease",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="3" width="6" height="12" rx="1"/><rect x="16" y="3" width="6" height="15" rx="1"/></svg>
              </button>
            </div>
            <button onClick={() => setShowAddCreative(p => !p)} style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${tokens.accentBorder}`, background: "transparent",
              color: tokens.accent, cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 4,
              transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = tokens.accentGhost; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >+ Add Creative</button>
          </div>
        )}
      </div>

      {/* Advanced filters row (Creator + Phase) — collapsed by default */}
      {showAdvancedFilters && (
        <div style={{
          display: "flex", gap: 12, alignItems: "center", marginBottom: 24, paddingLeft: 4,
          animation: "cardIn 0.2s ease both",
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>CREATOR</span>
          <FilterPills
            options={[{ value: "all", label: "All" }, { value: "Coleman", label: "Coleman" }, { value: "Zoran", label: "Zoran" }]}
            value={creatorFilter} onChange={setCreatorFilter} tokens={tokens}
          />
          <div style={{ width: 1, height: 20, background: tokens.border }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>PHASE</span>
          <FilterPills
            options={[
              { value: null, label: "All Phases" },
              { value: 0, label: "Pre-Launch" },
              { value: 1, label: "Launch" },
              { value: 2, label: "Post-Launch" },
            ]}
            value={phaseFilter} onChange={setPhaseFilter} tokens={tokens}
          />
        </div>
      )}

      <Breadcrumb />

      {/* Mass Import */}
      {showImport && (
        <MassImportPanel tokens={tokens} mode={mode} onImport={handleMassImport} onClose={() => setShowImport(false)} />
      )}

      {showGenerate && (
        <GenerateCreativeModal
          tokens={tokens}
          themes={themes}
          onClose={() => setShowGenerate(false)}
          onSave={async (creative) => {
            const { data } = await createCreative(creative);
            if (data) setThemes(prev => prev.map(t => t.id === creative.theme_id ? { ...t, content_creatives: [{ count: (t.content_creatives?.[0]?.count || 0) + 1 }] } : t));
          }}
          onCreateTheme={async (theme) => {
            const { data } = await createTheme(theme);
            if (data) setThemes(prev => [data, ...prev]);
            return { data };
          }}
        />
      )}

      {/* THEMES VIEW */}
      {view === "themes" && (
        <>
          {showAddTheme && (
            <AddThemeForm tokens={tokens} mode={mode} onSave={handleCreateTheme} onCancel={() => setShowAddTheme(false)} />
          )}

          {loading ? (
            <div className="ce-theme-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  height: 160, borderRadius: 16, background: `linear-gradient(135deg, ${tokens.surfaceEl}, ${tokens.surfaceHov || tokens.surfaceEl})`,
                  border: `1px solid ${tokens.border}`,
                  animation: "skeletonPulse 1.8s ease-in-out infinite",
                  animationDelay: `${i * 150}ms`,
                }} />
              ))}
            </div>
          ) : themes.length === 0 ? (
            <EmptyState tokens={tokens} icon={"\uD83C\uDFA8"} title="Your canvas is empty"
              subtitle={`Start building your ${mode === "paid" ? "paid ads" : "organic"} library. Add a theme or let AI generate one for you.`} />
          ) : (
            <div className="ce-theme-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {themes.map((theme, i) => (
                <ThemeCard key={theme.id} theme={theme} index={i} tokens={tokens}
                  onDrill={drillIntoTheme} onDelete={handleDeleteTheme}
                  currentMode={mode}
                  onCopy={async (theme) => {
                    const oppositeMode = mode === "paid" ? "organic" : "paid";
                    const { data } = await createTheme({
                      title: theme.title, description: theme.description || "",
                      category: theme.category || "Uncategorized", mode: oppositeMode,
                      creator: theme.creator, phase: theme.phase, sort_order: 0, tags: theme.tags || [],
                    });
                    if (data) setThemes(prev => [data, ...prev]);
                  }}
                  onUpdate={async (id, fields) => {
                    const { data } = await updateTheme(id, fields);
                    if (data) setThemes(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t));
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* CREATIVES VIEW */}
      {view === "creatives" && selectedTheme && (
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
              <Pill label={`${creatives.length} creatives`} color={tokens.textMute} bg={tokens.surfaceHov} />
            </div>
            <ThemeNotes tokens={tokens} theme={selectedTheme} onSave={updateTheme} />
          </div>

          {/* Andromeda Advisor */}
          <AndromedaAdvisor tokens={tokens} creatives={creatives} />

          {showAddCreative && (
            <AddCreativeForm tokens={tokens} themeId={selectedTheme.id} mode={mode}
              onSave={handleCreateCreative} onCancel={() => setShowAddCreative(false)} />
          )}

          {/* Simple creative count */}
          {creatives.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: tokens.textMute }}>
                {creatives.length} creative{creatives.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {creatives.length === 0 ? (
            <EmptyState tokens={tokens} icon={"\u2728"} title="Ready for creatives"
              subtitle="This theme is waiting for its first creative. Add one manually or use the Generate button." />
          ) : creativesViewMode === "pipeline" ? (
            <PipelineView
              creatives={creatives}
              tokens={tokens}
              onDrill={drillIntoCreative}
              onDelete={handleDeleteCreative}
              onUpdate={async (id, fields) => {
                const { data } = await updateCreative(id, fields);
                if (data) setCreatives(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c));
              }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {creatives.map((creative, i) => (
                <CreativeCard key={creative.id} creative={creative} index={i} tokens={tokens}
                  onDrill={drillIntoCreative} onDelete={handleDeleteCreative}
                  onUpdate={async (id, fields) => {
                    const { data } = await updateCreative(id, fields);
                    if (data) setCreatives(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c));
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* SCRIPT VIEW */}
      {view === "script" && selectedCreative && (
        <ScriptPanel tokens={tokens} creative={selectedCreative} onBack={goBackToCreatives} />
      )}
    </div>
  );
}
