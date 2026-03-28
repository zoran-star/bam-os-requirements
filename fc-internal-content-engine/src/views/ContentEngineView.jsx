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
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), category, mode, creator, phase, sort_order: 0 });
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
          {["AI Advantage", "Command Center", "Strategic Intel"].map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} style={{
              fontSize: 12, fontWeight: category === cat ? 600 : 400, padding: "4px 12px",
              borderRadius: 8, border: `1px solid ${category === cat ? tokens.accentBorder : tokens.border}`,
              background: category === cat ? tokens.accentGhost : "transparent",
              color: category === cat ? tokens.accent : tokens.textSub,
              cursor: "pointer", fontFamily: "inherit",
            }}>{cat}</button>
          ))}
        </div>
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

// ─── Theme Notes Panel (collapsible) ───

function ThemeCard({ theme, index, tokens, onDrill, onDelete, onUpdate }) {
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
      border: `1.5px solid ${hovered ? `${tokens.accent}50` : tokens.border}`,
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
            {hovered && <span style={{ fontSize: 11, color: tokens.textMute, marginLeft: 6, opacity: 0.6 }}>✎</span>}
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
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 12, borderTop: `1px solid ${tokens.border}` }}>
        <Pill label={PHASE_LABELS[theme.phase] || "Pre-Launch"} color={PHASE_COLORS(tokens)[theme.phase]} bg={PHASE_BG(tokens)[theme.phase]} />
        <Pill label={theme.creator} color={tokens.textSub} bg={tokens.surfaceHov} />
        <span style={{ fontSize: 12, color: tokens.textMute, marginLeft: "auto", fontWeight: 600 }}>
          {creativeCount} creative{creativeCount !== 1 ? "s" : ""}
        </span>
      </div>
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
  const [showAddCreative, setShowAddCreative] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // ─── Data loading ───

  const loadThemes = useCallback(async () => {
    setLoading(true);
    const filters = { mode };
    if (categoryFilter !== "all") filters.category = categoryFilter;
    if (creatorFilter !== "all") filters.creator = creatorFilter;
    if (phaseFilter !== null) filters.phase = phaseFilter;
    const { data } = await fetchThemes(filters);
    setThemes(data);
    setLoading(false);
  }, [mode, categoryFilter, creatorFilter, phaseFilter]);

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
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 13 }}>
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
        @keyframes dashPulse{0%,100%{opacity:0.4}50%{opacity:0.8}}
        @keyframes gentlePulse{0%,100%{opacity:1}50%{opacity:0.7}}
      `}</style>

      {/* Header controls — simplified to 1 row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showAdvancedFilters ? 8 : 24, flexWrap: "wrap" }}>
        <SegmentToggle
          options={[{ value: "paid", label: "Paid Ads" }, { value: "organic", label: "Organic" }]}
          value={mode} onChange={(v) => { setMode(v); setView("themes"); setSelectedTheme(null); }}
          tokens={tokens}
        />
        <div style={{ width: 1, height: 24, background: tokens.border }} />
        <FilterPills
          options={[{ value: "all", label: "All Categories" }, { value: "AI Advantage", label: "AI Advantage" }, { value: "Command Center", label: "Command Center" }, { value: "Strategic Intel", label: "Strategic Intel" }]}
          value={categoryFilter} onChange={setCategoryFilter} tokens={tokens}
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          </div>
        )}
        {view === "creatives" && (
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
            <div>
              {Object.entries(groupedThemes).map(([category, categoryThemes]) => (
                <div key={category} style={{ marginBottom: 32 }}>
                  {/* Category section header */}
                  <div style={{
                    fontSize: 11, fontWeight: 800, color: tokens.accent,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    marginBottom: 14, paddingLeft: 4,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <div style={{ width: 3, height: 14, borderRadius: 2, background: tokens.accent }} />
                    {category}
                    <span style={{ fontSize: 10, fontWeight: 500, color: tokens.textMute, letterSpacing: "0.02em", textTransform: "none" }}>
                      {categoryThemes.length} theme{categoryThemes.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    {categoryThemes.map((theme, i) => (
                      <ThemeCard key={theme.id} theme={theme} index={i} tokens={tokens}
                        onDrill={drillIntoTheme} onDelete={handleDeleteTheme}
                        onUpdate={async (id, fields) => {
                          const { data } = await updateTheme(id, fields);
                          if (data) setThemes(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t));
                        }}
                      />
                    ))}
                  </div>
                </div>
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
            <EmptyState tokens={tokens} icon={"\uD83D\uDCAC"} title="No creatives yet"
              subtitle="Add your first creative to this theme." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {creatives.map((creative, i) => {
                const vsLabel = VIDEO_STYLES.find(s => s.value === creative.video_style)?.label || creative.video_style || "\u2014";
                const isQueued = creative.is_active === false;
                return (
                  <div key={creative.id} onClick={() => drillIntoCreative(creative)} style={{
                    display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
                    borderRadius: 12, background: tokens.surfaceEl,
                    border: `1px solid ${tokens.border}`, cursor: "pointer",
                    borderLeft: `3px solid ${isQueued ? tokens.textMute : (PHASE_COLORS(tokens)[creative.phase] || tokens.accent)}`,
                    opacity: isQueued ? 0.5 : 1,
                    transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
                    animation: `cardIn 0.3s ease ${i * 30}ms both`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = tokens.cardHover; e.currentTarget.style.borderColor = tokens.borderStr; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = tokens.border; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>{creative.title}</div>
                      {creative.hook && (
                        <div style={{ fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {creative.hook}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {isQueued && <Pill label="Queued" color={tokens.textMute} bg={tokens.surfaceHov} />}
                      <Pill label={vsLabel} color={tokens.accent} bg={tokens.accentGhost} />
                      <Pill label={creative.tone || "\u2014"} color={tokens.textSub} bg={tokens.surfaceHov} />
                      <Pill label={PHASE_LABELS[creative.phase] || "\u2014"} color={PHASE_COLORS(tokens)[creative.phase]} bg={PHASE_BG(tokens)[creative.phase]} />
                      {creative.psych_lever && (
                        <Pill label={creative.psych_lever} color={tokens.blue} bg={`${tokens.blue}15`} />
                      )}
                      {creative.persona && (
                        <Pill label={creative.persona} color={tokens.amber} bg={tokens.amberSoft} />
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteCreative(creative.id); }} style={{
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
      {view === "script" && selectedCreative && (
        <ScriptPanel tokens={tokens} creative={selectedCreative} onBack={goBackToCreatives} />
      )}
    </div>
  );
}
