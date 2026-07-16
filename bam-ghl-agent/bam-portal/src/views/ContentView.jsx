import { useState, useRef, useEffect } from "react";
import { useUrlState } from "../hooks/useUrlState";
import JSZip from "jszip";
import { supabase } from "../lib/supabase";
import MediaLightbox from "../components/MediaLightbox";
import { mlIsMedia, mlDownloadUrl } from "../lib/media";

const STORAGE_BUCKET = "ticket-files";
const STORAGE_FOLDER = "guide-cards";

// ─── Priority + turnaround SLA (mirrors MarketingView) ───
// Client-flagged urgent = High (3 business days); everything else = Normal (5).
// Content tickets carry priority on context.priority (the wizard "Mark as urgent"),
// whereas marketing tickets use fields.priority — same SLA math either way.
const CT_PRIORITY_META = {
  high:   { label: "High",   sla: 3, color: "#ED7969" },
  normal: { label: "Normal", sla: 5, color: "#7E9CD9" },
};
function ctkPriorityOf(ticket) {
  return (ticket?.context?.priority === "high") ? "high" : "normal";
}
function ctkAddBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
function ctkBizDaysUntil(due) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(due);  d.setHours(0, 0, 0, 0);
  if (d.getTime() < now.getTime()) return -1;
  let count = 0;
  const cur = new Date(now);
  while (cur.getTime() < d.getTime()) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}
// { due, label, overdue } from submit date + priority SLA, or null with no date.
function ctkDeadlineInfo(submittedIso, priority) {
  if (!submittedIso) return null;
  const sla = (CT_PRIORITY_META[priority] || CT_PRIORITY_META.normal).sla;
  const due = ctkAddBusinessDays(new Date(submittedIso), sla);
  const rem = ctkBizDaysUntil(due);
  if (rem < 0) return { due, label: "Overdue", overdue: true };
  if (rem === 0) return { due, label: "Due today", overdue: false };
  return { due, label: `Due in ${rem} biz day${rem === 1 ? "" : "s"}`, overdue: false };
}
// Quick-filter chip — cross-cuts the tabs (e.g. "all overdue regardless of bucket").
function CtkStateChip({ label, active, onClick, tk, tone, count }) {
  const accent = tone || tk.accent;
  const empty = typeof count === "number" && count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 13px", fontSize: 12.5, fontWeight: 600, borderRadius: 999,
        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        background: active ? `${accent}22` : "transparent",
        color: active ? accent : (empty ? tk.textMute : tk.textSub),
        border: `1px solid ${active ? accent : tk.border}`,
        transition: "all 0.12s ease",
      }}
    >{label}</button>
  );
}
function CtkPriorityChip({ priority, tk }) {
  const meta = CT_PRIORITY_META[priority] || CT_PRIORITY_META.normal;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
      color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}1A`,
    }}>{priority === "high" ? "⚡ " : ""}{meta.label}</span>
  );
}

// Which pipeline a content ticket belongs to: ads (digital marketing) vs organic.
const CT_CHANNEL_META = {
  organic: { label: "Organic", color: "#7BC47F" },
  ads:     { label: "Ads",     color: "#7E9CD9" },
  funnel:  { label: "Funnel",  color: "#D9A87E" },
};
function CtkChannelBadge({ channel }) {
  const meta = CT_CHANNEL_META[channel] || CT_CHANNEL_META.ads;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
      padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
      color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}1A`,
    }}>{meta.label}</span>
  );
}

export default function ContentView({ tokens: tk, dark, me, session }) {
  const [mainTab, setMainTab]     = useUrlState("csec", "tickets"); // tickets | guides | routing
  const [guides, setGuides]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [banner, setBanner]       = useState(null);
  const [error, setError]         = useState("");

  // Managers/admin can manage the content routing roster (who owns each client's
  // organic vs ads content). Executors don't see this tab. Mirrors CONTENT_MANAGER_ROLES.
  const canManageRouting = ["admin", "scaling_manager", "marketing_manager"].includes(me?.role);

  // ─── fetchGuides must be defined BEFORE the useEffect that calls it
  //     (it's an arrow-function const, not a hoisted function declaration).
  //     And both must live ABOVE any conditional return so the hook order
  //     stays stable across re-renders. ───
  const fetchGuides = async () => {
    setLoading(true);
    setError("");
    try {
      const token = session?.access_token;
      const res = await fetch("/api/guide-cards", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGuides(json.cards || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const showBanner = (text) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 3500);
  };

  const handleSave = async (formData) => {
    const token = session?.access_token;
    try {
      if (creating) {
        const res = await fetch("/api/guide-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(formData),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setGuides(prev => [...prev, json.card]);
        showBanner(`Created "${json.card.title}".`);
      } else {
        const res = await fetch(`/api/guide-cards?id=${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(formData),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setGuides(prev => prev.map(g => g.id === editingId ? json.card : g));
        showBanner(`Saved "${json.card.title}".`);
      }
      setEditingId(null);
      setCreating(false);
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const target = guides.find(g => g.id === editingId);
    if (!target) return;
    if (!confirm(`Delete the guide card for "${target.title}"? This can't be undone.`)) return;
    const token = session?.access_token;
    try {
      const res = await fetch(`/api/guide-cards?id=${editingId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setGuides(prev => prev.filter(g => g.id !== editingId));
      setEditingId(null);
      showBanner(`Deleted "${target.title}".`);
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  };

  // ─── Fetch guides on mount — useEffect must come AFTER fetchGuides so
  //     the closure can see it, and BEFORE any conditional return so the
  //     hook order stays stable across re-renders. ───
  useEffect(() => {
    fetchGuides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Top-level tab bar (Guide cards | Tickets) ───
  const renderMainTabs = () => (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}`, marginBottom: 24 }}>
      <MainTab label="Tickets" active={mainTab === "tickets"} onClick={() => setMainTab("tickets")} tk={tk} />
      <MainTab label="Guide cards" active={mainTab === "guides"} onClick={() => setMainTab("guides")} tk={tk} />
      {canManageRouting && (
        <MainTab label="Routing" active={mainTab === "routing"} onClick={() => setMainTab("routing")} tk={tk} />
      )}
    </div>
  );

  // If the user is on the Tickets tab, hand off to the dedicated component
  if (mainTab === "tickets") {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {renderMainTabs()}
        <ContentTicketsTab tk={tk} session={session} me={me} />
      </div>
    );
  }

  // Routing roster — managers only (guarded by canManageRouting on the tab).
  if (mainTab === "routing" && canManageRouting) {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {renderMainTabs()}
        <ContentRoutingTab tk={tk} session={session} />
      </div>
    );
  }

  const isEditing = editingId !== null || creating;
  const editing = editingId ? guides.find(g => g.id === editingId) : null;

  // ─────────────────── Edit view ───────────────────
  if (isEditing) {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {renderMainTabs()}
        {banner && <Banner banner={banner} tk={tk} />}
        <GuideEditor
          tk={tk}
          initial={editing || { title: "", purpose: "", filming_tips: "", example_script: "", example_assets: [], example_links: [] }}
          isNew={creating}
          onCancel={() => { setEditingId(null); setCreating(false); }}
          onSave={handleSave}
          onDelete={creating ? null : handleDelete}
        />
      </div>
    );
  }

  // ─────────────────── List view ───────────────────
  return (
    <div style={{ padding: "24px 28px", color: tk.text }}>
      {renderMainTabs()}
      {banner && <Banner banner={banner} tk={tk} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: tk.textSub }}>
          {loading ? "Loading…" : `${guides.length} card${guides.length === 1 ? "" : "s"} · shown to clients in the "+ Add New Campaign" wizard`}
        </div>
        <button
          onClick={() => { setCreating(true); setEditingId(null); }}
          style={{
            padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >+ New guide card</button>
      </div>
      {error && <div style={{ color: tk.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: tk.textSub, fontSize: 14 }}>
          Loading guide cards…
        </div>
      ) : guides.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: tk.textSub, fontSize: 14 }}>
          No guide cards yet. Click "+ New guide card" to create one.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}>
          {guides.map(g => {
            const assets = Array.isArray(g.example_assets) ? g.example_assets : [];
            const links  = Array.isArray(g.example_links)  ? g.example_links  : [];
            const isComplete = g.purpose && g.filming_tips && g.example_script;
            return (
              <div
                key={g.id}
                onClick={() => { setEditingId(g.id); setCreating(false); }}
                style={{
                  background: tk.surface,
                  border: `1px solid ${tk.border}`,
                  borderRadius: 12,
                  padding: 16,
                  cursor: "pointer",
                  transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = tk.accent;
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.15)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = tk.border;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: tk.text }}>{g.title || "Untitled"}</div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase",
                    padding: "3px 8px", borderRadius: 999,
                    color: isComplete ? (tk.green || "#7ED996") : tk.textMute,
                    border: `1px solid ${isComplete ? (tk.green || "#7ED996") : tk.border}`,
                    background: isComplete ? "rgba(126,217,150,0.10)" : "transparent",
                    whiteSpace: "nowrap",
                  }}>{isComplete ? "Filled" : "Draft"}</span>
                </div>

                <div style={{ fontSize: 12, color: tk.textSub, marginBottom: 12, lineHeight: 1.5, minHeight: 32 }}>
                  {g.purpose ? truncate(g.purpose, 90) : <span style={{ color: tk.textMute, fontStyle: "italic" }}>No purpose set yet.</span>}
                </div>

                {/* Asset thumbnails + link count */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {assets.length > 0 ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      {assets.slice(0, 3).map((a, i) => (
                        <img key={i} src={a.url || a} alt="" style={{
                          width: 38, height: 38, borderRadius: 6, objectFit: "cover",
                          border: `1px solid ${tk.border}`,
                        }} />
                      ))}
                      {assets.length > 3 && (
                        <div style={{
                          width: 38, height: 38, borderRadius: 6, border: `1px solid ${tk.border}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: tk.textMute, fontSize: 11, fontWeight: 600,
                        }}>+{assets.length - 3}</div>
                      )}
                    </div>
                  ) : null}
                  {links.length > 0 && (
                    <div style={{
                      fontSize: 11, color: tk.textMute,
                      padding: "4px 10px", borderRadius: 999,
                      border: `1px solid ${tk.border}`,
                    }}>🔗 {links.length}</div>
                  )}
                  {assets.length === 0 && links.length === 0 && (
                    <div style={{ fontSize: 11, color: tk.textMute, fontStyle: "italic" }}>No example content yet</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Edit/create form
// ─────────────────────────────────────────────────────────
// ── Multi-format guide cards: an offer's guide is a set of ANGLES, each with a
// shared purpose + up to two executions (video / graphic). Each execution has
// labeled script beats, tips, and its own example assets. ────────────────────
const ANGLE_PRESETS = ["Free trial", "Transformation", "Testimonial", "Direct offer", "B-roll", "Reviews"];
const DEFAULT_BEATS = {
  video:   [{ label: "Hook", text: "" }, { label: "Value", text: "" }, { label: "CTA", text: "" }],
  graphic: [{ label: "Headline", text: "" }, { label: "Offer", text: "" }, { label: "CTA", text: "" }],
};
const newExecution = (medium) => ({ segments: DEFAULT_BEATS[medium].map(b => ({ ...b })), tips: "", example_assets: [] });
const newAngle = () => ({ name: "", purpose: "", video: newExecution("video"), graphic: null });
function _normExec(e, medium) {
  if (!e) return null;
  return {
    segments: Array.isArray(e.segments) && e.segments.length ? e.segments.map(s => ({ label: s.label || "", text: s.text || "" })) : DEFAULT_BEATS[medium].map(b => ({ ...b })),
    tips: e.tips || "",
    example_assets: Array.isArray(e.example_assets) ? e.example_assets : [],
  };
}
function normalizeAngles(initial) {
  if (Array.isArray(initial.angles) && initial.angles.length) {
    return initial.angles.map(a => ({ name: a.name || "", purpose: a.purpose || "", video: _normExec(a.video, "video"), graphic: _normExec(a.graphic, "graphic") }));
  }
  // Fallback: wrap legacy single guidance into one angle (for un-backfilled cards).
  const hasLegacy = initial.purpose || initial.example_script || initial.filming_tips || (Array.isArray(initial.example_assets) && initial.example_assets.length);
  if (hasLegacy) {
    return [{ name: "Recommended", purpose: initial.purpose || "", video: { segments: [{ label: "Script", text: initial.example_script || "" }], tips: initial.filming_tips || "", example_assets: Array.isArray(initial.example_assets) ? initial.example_assets : [] }, graphic: null }];
  }
  return [newAngle()];
}
// Flatten angles into the legacy columns so the current client wizard render
// (which still reads purpose/script/tips/assets) keeps working until Phase 2.
function flattenAnglesToLegacy(angles) {
  const purpose = angles.map(a => a.purpose).filter(Boolean).join("\n");
  const filming_tips = angles.flatMap(a => [a.video?.tips, a.graphic?.tips]).filter(Boolean).join("\n");
  const example_assets = angles.flatMap(a => [...(a.video?.example_assets || []), ...(a.graphic?.example_assets || [])]);
  const example_script = angles.map(a => {
    const execs = [["Video", a.video], ["Graphic", a.graphic]].filter(([, e]) => e);
    const body = execs.map(([m, e]) => `[${m}] ` + (e.segments || []).map(s => `${s.label}: ${s.text}`).join(" / ")).join("\n");
    return `${a.name || "Angle"}\n${body}`;
  }).join("\n\n");
  return { purpose, filming_tips, example_script, example_assets };
}

// Example-asset grid for one execution. Mirrors the original guide asset grid
// (1:1 thumbs + dashed add tile) and adds a video poster frame.
function ExecAssetGrid({ tk, assets, uploading, inputId, onAdd, onRemove }) {
  const ref = useRef(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginBottom: 4 }}>
      {assets.map((a, i) => {
        const url = a.url || a;
        const isVid = (a.type || "").startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url || "");
        const common = { width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, border: `1px solid ${tk.border}`, display: "block" };
        return (
          <div key={i} style={{ position: "relative" }}>
            {isVid
              ? <video src={`${url}#t=0.1`} preload="metadata" muted style={common} />
              : <img src={url} alt={a.name || ""} style={common} />}
            <button onClick={() => onRemove(i)} style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: 0, cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Remove">×</button>
          </div>
        );
      })}
      <label htmlFor={inputId} style={{ aspectRatio: "1 / 1", border: `1.5px dashed ${tk.borderStr || tk.border}`, borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: uploading ? "wait" : "pointer", color: tk.textMute, fontSize: 13, gap: 4, opacity: uploading ? 0.5 : 1 }}>
        <div style={{ fontSize: 20, lineHeight: 1 }}>+</div>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Add</div>
      </label>
      <input id={inputId} ref={ref} type="file" accept="image/*,video/*" multiple disabled={uploading} style={{ display: "none" }} onChange={e => { onAdd(e.target.files); if (ref.current) ref.current.value = ""; }} />
    </div>
  );
}

function GuideEditor({ tk, initial, isNew, onCancel, onSave, onDelete }) {
  const [title, setTitle]       = useState(initial.title || "");
  const [links, setLinks]       = useState(Array.isArray(initial.example_links)  ? initial.example_links  : []);
  const [isDefault, setIsDefault] = useState(initial.is_default === true);
  const [angles, setAngles]     = useState(() => normalizeAngles(initial));
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState("");
  const fileInputRef = useRef(null);

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tk.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = {
    width: "100%", padding: "10px 12px", marginBottom: 18,
    background: tk.bg, border: `1px solid ${tk.border}`, borderRadius: 8,
    color: tk.text, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
  };
  const textareaStyle = { ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.5 };

  // ─ Upload to Supabase Storage; returns the uploaded asset objects ─
  const uploadFiles = async (filesList) => {
    const incoming = Array.from(filesList || []);
    if (!incoming.length) return [];
    setUploading(true);
    setError("");
    const MAX_PARALLEL = 3;
    const uploadOne = async (file) => {
      const uid = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${STORAGE_FOLDER}/${uid}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return { name: file.name, url: urlData.publicUrl, type: file.type || "" };
    };
    try {
      const uploads = [];
      for (let i = 0; i < incoming.length; i += MAX_PARALLEL) {
        const batch = incoming.slice(i, i + MAX_PARALLEL);
        uploads.push(...await Promise.all(batch.map(uploadOne)));
      }
      return uploads;
    } catch (e) {
      setError("Upload failed: " + e.message);
      return [];
    } finally {
      setUploading(false);
    }
  };

  // ─ Angle / execution / beat / asset mutators (all functional updates) ─
  const addAngle    = () => setAngles(p => [...p, newAngle()]);
  const removeAngle = (i) => setAngles(p => p.filter((_, idx) => idx !== i));
  const patchAngle  = (i, patch) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const toggleExec  = (i, medium) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: a[medium] ? null : newExecution(medium) } : a));
  const patchExec   = (i, medium, patch) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], ...patch } } : a));
  const addBeat     = (i, medium) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], segments: [...a[medium].segments, { label: "", text: "" }] } } : a));
  const patchBeat   = (i, medium, j, patch) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], segments: a[medium].segments.map((s, sj) => sj === j ? { ...s, ...patch } : s) } } : a));
  const removeBeat  = (i, medium, j) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], segments: a[medium].segments.filter((_, sj) => sj !== j) } } : a));
  const addExecAssets = async (i, medium, files) => {
    const ups = await uploadFiles(files);
    if (ups.length) setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], example_assets: [...a[medium].example_assets, ...ups] } } : a));
  };
  const removeExecAsset = (i, medium, j) => setAngles(p => p.map((a, idx) => idx === i ? { ...a, [medium]: { ...a[medium], example_assets: a[medium].example_assets.filter((_, aj) => aj !== j) } } : a));

  const addLinkRow  = () => setLinks(prev => [...prev, { url: "", label: "" }]);
  const updateLink  = (idx, key, value) => setLinks(prev => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));
  const removeLink  = (idx) => setLinks(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    setError("");
    if (!title.trim()) { setError("Title is required."); return; }
    const cleanLinks = links.filter(l => (l.url || "").trim());
    const cleanAngles = angles.map(a => ({
      name: (a.name || "").trim(),
      purpose: (a.purpose || "").trim(),
      video:   a.video   ? { segments: a.video.segments.filter(s => (s.label || "").trim() || (s.text || "").trim()),   tips: (a.video.tips || "").trim(),   example_assets: a.video.example_assets }   : null,
      graphic: a.graphic ? { segments: a.graphic.segments.filter(s => (s.label || "").trim() || (s.text || "").trim()), tips: (a.graphic.tips || "").trim(), example_assets: a.graphic.example_assets } : null,
    })).filter(a => a.name || a.purpose || a.video || a.graphic);
    if (!cleanAngles.length) { setError("Add at least one angle."); return; }
    const legacy = flattenAnglesToLegacy(cleanAngles);
    onSave({ title: title.trim(), angles: cleanAngles, is_default: isDefault, example_links: cleanLinks, ...legacy });
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <button onClick={onCancel} style={{
        background: "transparent", border: 0, color: tk.textMute,
        fontSize: 13, cursor: "pointer", marginBottom: 18,
        padding: 0, fontFamily: "inherit",
      }}>← Back to guide cards</button>

      <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
        § Content · {isNew ? "New" : "Edit"}
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em", marginBottom: 28 }}>
        {isNew ? "Create a guide card" : "Edit guide card"}
      </div>

      <label style={labelStyle}>Offer title</label>
      <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Camps" />

      {/* Use this card as the generic "First Campaign" starter guide */}
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, cursor: "pointer", fontSize: 13, color: tk.text }}>
        <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ width: 16, height: 16, accentColor: tk.accent, cursor: "pointer", flexShrink: 0 }} />
        <span>Use as the <b>First Campaign</b> starter guide <span style={{ color: tk.textMute }}>· the generic example shown at the top of the Ads screen</span></span>
      </label>

      <label style={labelStyle}>Recommended creatives <span style={{ color: tk.textMute, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· one card per angle, each can be a video and/or a graphic</span></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
        {angles.map((a, i) => (
          <div key={i} style={{ border: `1px solid ${tk.border}`, borderRadius: 10, padding: 14, background: tk.surface }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: tk.textMute, minWidth: 16 }}>{i + 1}</span>
              <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={a.name} onChange={e => patchAngle(i, { name: e.target.value })} placeholder="Angle name (e.g. Testimonial)" />
              {angles.length > 1 && (
                <button onClick={() => removeAngle(i)} style={{ width: 32, height: 32, flexShrink: 0, background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 6, color: tk.textMute, cursor: "pointer", fontSize: 16 }} aria-label="Remove angle">×</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {ANGLE_PRESETS.map(p => (
                <button key={p} onClick={() => patchAngle(i, { name: p })} style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: a.name === p ? (tk.accentGhost || "transparent") : "transparent", border: `1px solid ${a.name === p ? tk.accent : tk.border}`, color: a.name === p ? tk.accent : tk.textMute }}>{p}</button>
              ))}
            </div>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Why this works <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· shared</span></label>
            <textarea style={{ ...textareaStyle, minHeight: 58, marginBottom: 14 }} value={a.purpose} onChange={e => patchAngle(i, { purpose: e.target.value })} placeholder="Who it targets, why it converts - applies to both the video and the graphic." />

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["video", "graphic"].map(m => (
                <button key={m} onClick={() => toggleExec(i, m)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize", background: a[m] ? tk.accent : "transparent", color: a[m] ? "#0A0A0B" : tk.textMute, border: `1px solid ${a[m] ? tk.accent : tk.border}` }}>{a[m] ? "✓ " : "+ "}{m}</button>
              ))}
            </div>

            {["video", "graphic"].map(m => a[m] && (
              <div key={m} style={{ borderLeft: `2px solid ${tk.accent}`, paddingLeft: 14, marginBottom: 12 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: tk.accent, marginBottom: 10 }}>{m} execution</div>
                <label style={{ ...labelStyle, marginBottom: 6 }}>Script beats</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {a[m].segments.map((s, j) => (
                    <div key={j} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <input style={{ ...inputStyle, marginBottom: 0, width: 108, flexShrink: 0, padding: "8px 10px" }} value={s.label} onChange={e => patchBeat(i, m, j, { label: e.target.value })} placeholder="Beat" />
                      <textarea style={{ ...inputStyle, marginBottom: 0, flex: 1, minHeight: 38, padding: "8px 10px", resize: "vertical", lineHeight: 1.4 }} value={s.text} onChange={e => patchBeat(i, m, j, { text: e.target.value })} placeholder="What to say / show" />
                      <button onClick={() => removeBeat(i, m, j)} style={{ width: 32, height: 32, flexShrink: 0, background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 6, color: tk.textMute, cursor: "pointer", fontSize: 15 }} aria-label="Remove beat">×</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addBeat(i, m)} style={{ padding: "5px 12px", marginBottom: 12, background: "transparent", color: tk.accent, border: `1px dashed ${tk.accent}`, borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Add beat</button>
                <label style={{ ...labelStyle, marginBottom: 6 }}>{m === "video" ? "Filming tips" : "Design tips"}</label>
                <textarea style={{ ...textareaStyle, minHeight: 52, marginBottom: 12 }} value={a[m].tips} onChange={e => patchExec(i, m, { tips: e.target.value })} placeholder={m === "video" ? "Camera, lighting, length, hook in 3s…" : "Layout, headline weight, logo placement…"} />
                <label style={{ ...labelStyle, marginBottom: 6 }}>Example {m}s {uploading && <span style={{ color: tk.accent, marginLeft: 6 }}>(uploading…)</span>}</label>
                <ExecAssetGrid tk={tk} assets={a[m].example_assets} uploading={uploading} inputId={`guide-asset-${i}-${m}`} onAdd={(files) => addExecAssets(i, m, files)} onRemove={(j) => removeExecAsset(i, m, j)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <button onClick={addAngle} style={{ padding: "9px 16px", marginBottom: 24, background: "transparent", color: tk.accent, border: `1px dashed ${tk.accent}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.03em" }}>+ Add angle</button>

      <label style={labelStyle}>Example links</label>
      <div style={{ marginBottom: 6, display: "flex", flexDirection: "column", gap: 8 }}>
        {links.length === 0 && (
          <div style={{ fontSize: 12, color: tk.textMute, fontStyle: "italic", padding: "6px 0" }}>No links yet. Add ones to inspiration, references, or example ads.</div>
        )}
        {links.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              style={{ ...inputStyle, marginBottom: 0, flex: 2, padding: "8px 10px" }}
              value={l.url || ""}
              onChange={e => updateLink(i, "url", e.target.value)}
              placeholder="https://example.com/inspiration"
            />
            <input
              style={{ ...inputStyle, marginBottom: 0, flex: 1, padding: "8px 10px" }}
              value={l.label || ""}
              onChange={e => updateLink(i, "label", e.target.value)}
              placeholder="Label (optional)"
            />
            <button
              onClick={() => removeLink(i)}
              style={{
                width: 32, height: 32, flexShrink: 0,
                background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 6,
                color: tk.textMute, cursor: "pointer", fontSize: 16,
              }}
              aria-label="Remove link"
            >×</button>
          </div>
        ))}
      </div>
      <button
        onClick={addLinkRow}
        style={{
          padding: "8px 14px", marginBottom: 22,
          background: "transparent", color: tk.accent,
          border: `1px dashed ${tk.accent}`, borderRadius: 8,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          letterSpacing: "0.05em",
        }}
      >+ Add link</button>

      {error && <div style={{ color: tk.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 8 }}>
        <div>
          {onDelete && (
            <button onClick={onDelete} style={{
              padding: "10px 16px", background: "transparent",
              border: `1px solid ${tk.red || "#C7253E"}`, borderRadius: 8,
              color: tk.red || "#C7253E", cursor: "pointer", fontSize: 13, fontWeight: 500,
            }}>Delete</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{
            padding: "10px 16px", background: "transparent",
            border: `1px solid ${tk.border}`, borderRadius: 8,
            color: tk.text, cursor: "pointer", fontSize: 13,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={uploading} style={{
            padding: "10px 22px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontWeight: 700,
            cursor: uploading ? "wait" : "pointer", fontSize: 13,
            opacity: uploading ? 0.5 : 1,
          }}>{isNew ? "Create guide card" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function Banner({ banner, tk }) {
  return (
    <div style={{
      position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
      background: tk.green, color: "#fff",
      padding: "12px 22px", borderRadius: 999, fontSize: 13, fontWeight: 600,
      zIndex: 9999, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    }}>{banner}</div>
  );
}

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ─────────────────────────────────────────────────────────
// MainTab — top-level tab pill used on Content page
// ─────────────────────────────────────────────────────────
function MainTab({ label, active, onClick, tk }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 18px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? tk.accent : tk.textSub,
        borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s ease",
      }}
    >{label}</div>
  );
}

// ─────────────────────────────────────────────────────────
// CONTENT TICKETS TAB
// ─────────────────────────────────────────────────────────
const TICKET_STORAGE_FOLDER = "content-tickets";

// 3-letter test-tracking code from ticket UUID
function ctkCode(id) {
  if (!id) return "???";
  const cleaned = String(id).replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return cleaned || "???";
}

function ctkLastActivityIso(ticket) {
  const msgs = Array.isArray(ticket.messages) ? ticket.messages : [];
  const lastMsg = msgs.length ? msgs[msgs.length - 1]?.created_at : null;
  return lastMsg || ticket.updated_at || ticket.submitted_at || null;
}
function ctkFormatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min)       return "just now";
  if (diff < hr)        return Math.round(diff / min) + " min ago";
  if (diff < day)       return Math.round(diff / hr) + " hr ago";
  if (diff < 2 * day)   return "yesterday";
  if (diff < 7 * day)   return Math.round(diff / day) + " days ago";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TYPE_META_CT = {
  graphic: { icon: "🖼", label: "Graphic" },
  video:   { icon: "🎬", label: "Video" },
  mixed:   { icon: "✦",  label: "Mixed" },
};

function ContentTicketsTab({ tk, session, me }) {
  const [subTab, setSubTab] = useUrlState("csub", "active"); // active | client-dependent | completed
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | graphic | video | mixed
  const [channelFilter, setChannelFilter] = useState("all"); // all | ads | organic
  const [sortOrder, setSortOrder] = useState("newest"); // newest | oldest
  const [stateFilter, setStateFilter] = useState("all"); // all | overdue (cross-cuts tabs)

  // Reassignment: managers/admin can re-route a creative to a different owner,
  // one at a time (detail) or in bulk (list multi-select) — e.g. covering for
  // someone on vacation without re-pointing the client's whole routing roster.
  const canReassign = ["admin", "scaling_manager", "marketing_manager"].includes(me?.role);
  const [owners, setOwners] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    if (!canReassign) return;
    let cancelled = false;
    supabase.from("staff").select("id,name,role").order("name").then(({ data }) => {
      if (!cancelled) setOwners((data || []).filter(s => ROUTING_OWNER_ROLES.includes(s.role)));
    });
    return () => { cancelled = true; };
  }, [canReassign]);
  const toggleSelect = (id) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const clearSelection = () => setSelectedIds(new Set());
  // Reset the selection when the visible slice changes, so we never bulk-act on
  // rows that scrolled out of the current tab/filter.
  useEffect(() => { setSelectedIds(new Set()); }, [subTab, stateFilter, channelFilter, typeFilter]);

  const showBanner = (text) => { setBanner(text); setTimeout(() => setBanner(null), 3500); };

  // Reassign every selected ticket to one owner (loops the per-ticket assign action).
  async function bulkReassign(staffId) {
    if (bulkBusy || selectedIds.size === 0) return;
    setBulkBusy(true);
    const ids = [...selectedIds];
    try {
      for (const id of ids) {
        await patchTicket(id, { action: "assign", assigned_to: staffId || null });
      }
      await refetch();
      const who = staffId === me?.id ? "you" : (owners.find(o => o.id === staffId)?.name || "Unassigned");
      showBanner(`${ids.length} ticket${ids.length === 1 ? "" : "s"} reassigned to ${who}.`);
      clearSelection();
    } catch (e) {
      showBanner("Bulk reassign failed: " + (e?.message || "error"));
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => { refetch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function refetch() {
    setLoading(true);
    setError("");
    try {
      const token = session?.access_token;
      const res = await fetch("/api/marketing?resource=content-tickets&scope=staff", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTickets(json.tickets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function patchTicket(id, body) {
    const token = session?.access_token;
    const res = await fetch(`/api/marketing?resource=content-tickets&id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    // Read as text first so a non-JSON error (gateway 500, timeout, 413) surfaces
    // its real message instead of a cryptic "Unexpected token" JSON parse error.
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
    if (!res.ok) throw new Error(json.error || (text ? text.slice(0, 160) : `HTTP ${res.status}`));
    return json.ticket;
  }

  // Queue scoping: content executors only work their own assigned creatives;
  // managers + marketing see the whole board. (Routing assigns organic→Eli,
  // ads→Cam, so Eli's queue is naturally his organic work.)
  const scoped = me?.role === "content_executor"
    ? tickets.filter(t => t.assigned_to === me.id)
    : tickets;

  // Channel filter (All / Ads / Organic) - applied before the sub-tab split so the
  // tab counts reflect it too.
  const channelScoped = channelFilter === "all"
    ? scoped
    : scoped.filter(t => (t.channel || "ads") === channelFilter);

  // Filter rows by sub-tab; sort oldest first per spec
  const active     = channelScoped.filter(t => t.status === "active");
  const clientDep  = channelScoped.filter(t => t.status === "client-dependent");
  const completed  = channelScoped.filter(t => t.status === "completed" || t.status === "cancelled");
  // Cross-cutting quick filter: every non-completed ticket that is overdue, regardless
  // of which tab it sits in — so "show me all overdue" is one click.
  const ctkIsOverdue = t =>
    t.status !== "completed" && t.status !== "cancelled" &&
    !!ctkDeadlineInfo(t.submitted_at, ctkPriorityOf(t))?.overdue;
  const overdueAll = channelScoped.filter(ctkIsOverdue);
  const tabRows =
    stateFilter === "overdue"       ? overdueAll
    : subTab === "active"           ? active
    : subTab === "client-dependent" ? clientDep
                                    : completed;

  // Apply toolbar filters: free-text search across academy + notes, type
  // filter, then sort by submitted_at.
  const visible = (() => {
    let list = tabRows;
    if (typeFilter !== "all") list = list.filter(t => t.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        (t.client?.business_name || "").toLowerCase().includes(q) ||
        (t.notes || "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const aDate = new Date(a.submitted_at || 0).getTime();
      const bDate = new Date(b.submitted_at || 0).getTime();
      if (sortOrder === "priority") {
        // Urgent first; within the same priority, oldest first (FIFO work order).
        const rank = p => (p === "high" ? 0 : 1);
        const diff = rank(ctkPriorityOf(a)) - rank(ctkPriorityOf(b));
        if (diff !== 0) return diff;
        return aDate - bDate;
      }
      return sortOrder === "newest" ? bDate - aDate : aDate - bDate;
    });
    return list;
  })();

  const selected = selectedId ? tickets.find(t => t.id === selectedId) : null;

  // ─────────────────── Detail view ───────────────────
  if (selected) {
    return (
      <ContentTicketDetail
        tk={tk}
        session={session}
        ticket={selected}
        me={me}
        owners={owners}
        canReassign={canReassign}
        onBack={() => setSelectedId(null)}
        onRefetch={refetch}
        patchTicket={patchTicket}
        showBanner={showBanner}
      />
    );
  }

  // ─────────────────── List view ───────────────────
  return (
    <div>
      {banner && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: tk.green, color: "#fff",
          padding: "12px 22px", borderRadius: 999, fontSize: 13, fontWeight: 600,
          zIndex: 9999, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>{banner}</div>
      )}

      {/* Toolbar: search + type filter + sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by academy or notes…"
          style={{
            flex: "1 1 280px", minWidth: 220,
            padding: "9px 14px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            outline: "none", fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 4, background: tk.surfaceEl, border: `1px solid ${tk.border}`, borderRadius: 8, padding: 3 }}>
          {[["all", "All"], ["ads", "Ads"], ["organic", "Organic"]].map(([k, label]) => {
            const on = channelFilter === k;
            const color = k === "organic" ? "#7BC47F" : k === "ads" ? "#7E9CD9" : tk.accent;
            return (
              <button key={k} type="button" onClick={() => setChannelFilter(k)} style={{
                padding: "6px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 6, border: "none",
                cursor: "pointer", fontFamily: "inherit",
                background: on ? `${color}22` : "transparent",
                color: on ? (k === "all" ? tk.text : color) : tk.textMute,
              }}>{label}</button>
            );
          })}
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: "9px 12px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <option value="all">All types</option>
          {Object.entries(TYPE_META_CT).map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          style={{
            padding: "9px 12px", fontSize: 13,
            background: tk.surfaceEl, color: tk.text,
            border: `1px solid ${tk.border}`, borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <option value="priority">Priority (urgent first)</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}`, marginBottom: 18, overflowX: "auto" }}>
        <SubTab label={`Active (${active.length})`}             active={subTab === "active"}            onClick={() => setSubTab("active")}            tk={tk} />
        <SubTab label={`Client Dependent (${clientDep.length})`} active={subTab === "client-dependent"} onClick={() => setSubTab("client-dependent")} tk={tk} red={clientDep.length > 0} />
        <SubTab label={`Completed (${completed.length})`}        active={subTab === "completed"}         onClick={() => setSubTab("completed")}         tk={tk} />
      </div>

      {/* Quick filters — cut across tabs so nothing overdue can hide */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <CtkStateChip label="All" active={stateFilter === "all"} onClick={() => setStateFilter("all")} tk={tk} />
        <CtkStateChip label={`⚠ Overdue (${overdueAll.length})`} active={stateFilter === "overdue"} onClick={() => setStateFilter("overdue")} tk={tk} tone={tk.red || "#ED7969"} count={overdueAll.length} />
      </div>

      {/* Bulk reassign bar — appears once rows are selected (managers/admin only).
          Route a batch of creatives to one owner in a single action. */}
      {canReassign && selectedIds.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "10px 14px", marginBottom: 12, borderRadius: 10,
          background: `${tk.accent}12`, border: `1px solid ${tk.accent}55`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: tk.accent }}>{selectedIds.size} selected</span>
          <span style={{ fontSize: 12, color: tk.textSub }}>Reassign to</span>
          <select
            value=""
            disabled={bulkBusy}
            onChange={e => { if (e.target.value) bulkReassign(e.target.value); }}
            style={{
              padding: "6px 10px", fontSize: 12.5, borderRadius: 8,
              background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.border}`,
              cursor: bulkBusy ? "default" : "pointer", fontFamily: "inherit",
            }}
          >
            <option value="">Choose owner…</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {me?.id && (
            <button onClick={() => bulkReassign(me.id)} disabled={bulkBusy} style={{
              padding: "6px 12px", fontSize: 12.5, fontWeight: 700, borderRadius: 8,
              background: tk.accent, color: "#0A0A0B", border: "none",
              cursor: bulkBusy ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}>{bulkBusy ? "Working…" : "→ Assign to me"}</button>
          )}
          <button onClick={clearSelection} disabled={bulkBusy} style={{
            padding: "6px 10px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
            background: "transparent", color: tk.textSub, border: `1px solid ${tk.border}`,
            cursor: "pointer", fontFamily: "inherit", marginLeft: "auto",
          }}>Clear</button>
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: canReassign ? "28px 1.2fr 1.5fr 0.8fr 1fr" : "1.2fr 1.5fr 0.8fr 1fr",
        gap: 16,
        padding: "8px 16px",
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
        alignItems: "center",
      }}>
        {canReassign && (
          <input
            type="checkbox"
            checked={visible.length > 0 && visible.every(t => selectedIds.has(t.id))}
            onChange={e => setSelectedIds(e.target.checked ? new Set(visible.map(t => t.id)) : new Set())}
            title="Select all in view"
            style={{ cursor: "pointer", accentColor: tk.accent }}
          />
        )}
        <div>Academy</div>
        <div>Notes / context</div>
        <div>Type</div>
        <div style={{ textAlign: "right" }}>Submitted</div>
      </div>

      <div style={{ background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "4px 0" }}>
        {loading ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.textSub, fontSize: 13 }}>Loading content tickets…</div>
        ) : error ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.red || "#ED7969", fontSize: 13 }}>⚠ {error}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: tk.textSub, fontSize: 13, fontStyle: "italic" }}>
            No tickets in this view.
          </div>
        ) : visible.map(t => {
          const meta = TYPE_META_CT[t.type] || { icon: "•", label: t.type };
          const academyName = t.client?.business_name || "—";
          const previewNotes = (t.notes || "").split("\n").filter(Boolean).slice(0, 1).join(" ").slice(0, 110) || "(no notes)";
          const titleLine = (t.title || "").trim();
          const dateStr = t.submitted_at ? new Date(t.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
          const pri = ctkPriorityOf(t);
          // Deadline is only meaningful while the ticket is still being worked.
          const inProgress = t.status === "active" || t.status === "client-dependent";
          const dl = inProgress ? ctkDeadlineInfo(t.submitted_at, pri) : null;
          return (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: canReassign ? "28px 1.2fr 1.5fr 0.8fr 1fr" : "1.2fr 1.5fr 0.8fr 1fr",
                gap: 16,
                padding: "14px 16px",
                borderBottom: `1px solid ${tk.borderSoft || tk.border}`,
                borderLeft: pri === "high" && inProgress
                  ? `3px solid ${CT_PRIORITY_META.high.color}` : "3px solid transparent",
                cursor: "pointer",
                alignItems: "center",
                background: selectedIds.has(t.id) ? `${tk.accent}0F` : "transparent",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={e => { if (!selectedIds.has(t.id)) e.currentTarget.style.background = tk.surfaceHov; }}
              onMouseLeave={e => { e.currentTarget.style.background = selectedIds.has(t.id) ? `${tk.accent}0F` : "transparent"; }}
            >
              {canReassign && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(t.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(t.id)}
                  title="Select"
                  style={{ cursor: "pointer", accentColor: tk.accent }}
                />
              )}
              <div style={{ fontWeight: 500, color: tk.text, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 10, letterSpacing: "0.12em",
                  color: tk.textMute, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.04)", border: `1px solid ${tk.border}`,
                }}>{ctkCode(t.id)}</span>
                <span>{academyName}</span>
                <CtkChannelBadge channel={t.channel} />
                <CtkPriorityChip priority={pri} tk={tk} />
                {t.context?.origin_systems_ticket_id && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                    padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
                    color: tk.textSub, border: `1px solid ${tk.borderMed}`,
                  }}>from Systems</span>
                )}
              </div>
              <div style={{ overflow: "hidden" }}>
                {titleLine ? (
                  <>
                    <div style={{ color: tk.text, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleLine}</div>
                    <div style={{ color: tk.textMute, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewNotes}</div>
                  </>
                ) : (
                  <div style={{ color: tk.textSub, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewNotes}</div>
                )}
              </div>
              <div style={{ color: tk.textSub, fontSize: 13 }}>
                <span style={{ marginRight: 6 }}>{meta.icon}</span>{meta.label}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: tk.textMute, fontSize: 12, fontFamily: "monospace", letterSpacing: "0.05em" }}>{dateStr}</div>
                {dl && (
                  <div style={{
                    fontSize: 11, fontWeight: 600, marginTop: 3,
                    color: dl.overdue ? CT_PRIORITY_META.high.color : tk.textSub,
                  }}>{dl.overdue ? "⚠ " : ""}{dl.label}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubTab({ label, active, onClick, tk, red }) {
  const inactiveColor = red ? (tk.red || "#ED7969") : tk.textSub;
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 18px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? tk.accent : inactiveColor,
        borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s ease",
      }}
    >{label}</div>
  );
}

// ─────────────────────────────────────────────────────────
// Detail view — review raw assets, upload finals, ship
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// Client media library - every raw file across all their tickets
// ─────────────────────────────────────────────────────────
// Collapsible; fetches once on first expand. Grouped by the folder names
// clients supply at upload, each file stamped with its origin ticket.
function _cmIsVideo(f) {
  return (f.type || "").startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(f.url || f.name || "");
}
function _cmIsImage(f) {
  return (f.type || "").startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)(\?|#|$)/i.test(f.url || f.name || "");
}
// Video poster frame, mounted only when scrolled near the viewport - <video> has no
// native lazy loading, and this grid can hold 100+ clips.
function CmVideoThumb({ url, tk }) {
  const ref = useRef(null);
  const [show, setShow] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setShow(true); obs.disconnect(); }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", height: 84, background: tk.surfaceHov }}>
      {show && (
        <video
          src={`${url}#t=0.5`}
          muted playsInline preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, paddingLeft: 2 }}>▶</span>
      </div>
    </div>
  );
}
function ClientMediaLibrary({ clientId, currentTicketId, tk, session }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(null);   // null = not fetched yet
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");  // all | video | image
  const [selected, setSelected] = useState(() => new Set());   // file urls
  const [zipping, setZipping] = useState(false);
  const [dlNote, setDlNote] = useState("");       // "Downloading 12/78…" progress
  const [preview, setPreview] = useState(null);   // file being viewed in the lightbox
  const _cmAnchorRef = useRef(null);              // shift-select range anchor (flat index)

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && files === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/marketing?resource=client-media&client_id=${encodeURIComponent(clientId)}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        const json = await res.json();
        setFiles(res.ok ? (json.files || []) : []);
      } catch {
        setFiles([]);
      } finally {
        setLoading(false);
      }
    }
  }

  const visible = (files || []).filter(f => {
    if (typeF === "video" && !_cmIsVideo(f)) return false;
    if (typeF === "image" && !_cmIsImage(f)) return false;
    if (q.trim()) {
      const hay = `${f.name} ${f.folder} ${f.ticket_title || ""} ${f.code}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  // Group by folder, folders ordered by their newest file.
  const groups = [];
  const byFolder = new Map();
  for (const f of visible) {
    const key = f.folder || "Ungrouped";
    if (!byFolder.has(key)) { byFolder.set(key, []); groups.push(key); }
    byFolder.get(key).push(f);
  }

  const dateStr = (iso) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  // ── Multi-select + zip download (same pattern as FilesByFolder) ──
  // Shift-click selects a range in rendered order, like Finder/Drive. The
  // anchor is the last tile whose checkbox was clicked; the range takes the
  // clicked tile's NEW state (shift-check selects the span, shift-uncheck
  // clears it).
  const flatOrder = groups.flatMap(g => byFolder.get(g));
  const idxOf = new Map(flatOrder.map((f, i) => [f, i]));
  const toggleSel = (f, shiftKey) => {
    const idx = idxOf.get(f);
    const anchor = _cmAnchorRef.current;
    setSelected(s => {
      const n = new Set(s);
      const willSelect = !n.has(f.url);
      if (shiftKey && anchor != null && idx != null) {
        const [a, b] = anchor < idx ? [anchor, idx] : [idx, anchor];
        for (let i = a; i <= b; i++) {
          if (willSelect) n.add(flatOrder[i].url); else n.delete(flatOrder[i].url);
        }
      } else if (willSelect) n.add(f.url); else n.delete(f.url);
      return n;
    });
    if (idx != null) _cmAnchorRef.current = idx;
  };
  const toggleGroup = (g) => {
    const gf = byFolder.get(g) || [];
    const allSel = gf.length > 0 && gf.every(f => selected.has(f.url));
    setSelected(s => {
      const n = new Set(s);
      gf.forEach(f => allSel ? n.delete(f.url) : n.add(f.url));
      return n;
    });
  };
  const selCount = visible.filter(f => selected.has(f.url)).length;
  const allVisibleSelected = visible.length > 0 && selCount === visible.length;
  const selectAllVisible = () => setSelected(s => {
    const n = new Set(s);
    visible.forEach(f => allVisibleSelected ? n.delete(f.url) : n.add(f.url));
    return n;
  });
  const downloadSelected = async () => {
    // Pull from the full file list so picks survive filter changes.
    const picked = (files || []).filter(f => selected.has(f.url));
    if (!picked.length || zipping) return;
    setZipping(true);
    try { await ctkDownloadPicked(picked, "client-media", setDlNote, clientId); }
    catch (e) { alert("Download failed: " + (e.message || e)); }
    finally { setZipping(false); setDlNote(""); }
  };
  const selBtn = (accent) => ({
    padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 999, fontFamily: "inherit",
    cursor: zipping ? "wait" : "pointer",
    border: `1px solid ${accent ? tk.accent : tk.border}`,
    background: accent ? tk.accent : "transparent",
    color: accent ? "#0A0A0B" : tk.textSub,
  });

  return (
    <Card tk={tk} style={{ marginBottom: 22, padding: 0 }}>
      <div onClick={toggle} role="button" aria-expanded={open} style={{
        display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", cursor: "pointer",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tk.text }}>Client media</span>
        <span style={{ fontSize: 12, color: tk.textMute }}>
          everything they&apos;ve sent, across all tickets{files ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: tk.textMute, fontSize: 13 }}>{open ? "˄" : "˅"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 18px 16px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {[["all", "All"], ["video", "Videos"], ["image", "Images"]].map(([id, label]) => (
              <button key={id} onClick={() => setTypeF(id)} style={{
                border: `1px solid ${typeF === id ? tk.accent : tk.border}`,
                background: typeF === id ? `${tk.accent}1A` : "transparent",
                color: typeF === id ? tk.accent : tk.textSub,
                fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 999, cursor: "pointer",
              }}>{label}</button>
            ))}
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, folder, ticket…"
              style={{
                flex: 1, minWidth: 160, background: tk.surfaceEl, border: `1px solid ${tk.borderMed}`,
                color: tk.text, fontSize: 12, padding: "6px 10px", borderRadius: 7, fontFamily: "inherit",
              }}
            />
          </div>
          {visible.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <button type="button" onClick={selectAllVisible} style={selBtn(false)}>
                {allVisibleSelected ? "Clear selection" : "Select all"}
              </button>
              {selected.size > 0 && (
                <>
                  <button type="button" onClick={downloadSelected} disabled={zipping} style={selBtn(true)}>
                    {zipping ? (dlNote || "Preparing…") : `↓ Download ${selected.size} selected`}
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} style={selBtn(false)}>Clear</button>
                </>
              )}
            </div>
          )}
          {loading && <div style={{ color: tk.textSub, fontSize: 13, padding: "8px 0" }}>Loading media…</div>}
          {files && !files.length && !loading && (
            <div style={{ color: tk.textSub, fontSize: 13, padding: "8px 0", fontStyle: "italic" }}>No media from this client yet.</div>
          )}
          {files && files.length > 0 && !visible.length && (
            <div style={{ color: tk.textSub, fontSize: 13, padding: "8px 0", fontStyle: "italic" }}>Nothing matches that filter.</div>
          )}
          {groups.map(g => (
            <div key={g} style={{ marginBottom: 14 }}>
              <label style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: tk.textMute, margin: "8px 0 8px",
              }}>
                <input
                  type="checkbox"
                  checked={byFolder.get(g).every(f => selected.has(f.url))}
                  ref={el => {
                    if (!el) return;
                    const gf = byFolder.get(g);
                    const some = gf.some(f => selected.has(f.url));
                    el.indeterminate = some && !gf.every(f => selected.has(f.url));
                  }}
                  onChange={() => toggleGroup(g)}
                  title={`Select all in ${g}`}
                  style={{ width: 14, height: 14, accentColor: tk.accent, cursor: "pointer", margin: 0 }}
                />
                {g} <span style={{ fontWeight: 500 }}>({byFolder.get(g).length})</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                {byFolder.get(g).map((f, i) => (
                  <div key={f.url + i} style={{ position: "relative" }}>
                    <label onClick={e => e.stopPropagation()} style={{
                      position: "absolute", top: 6, left: 6, zIndex: 3,
                      width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.55)", borderRadius: 5, cursor: "pointer",
                    }}>
                      <input type="checkbox" checked={selected.has(f.url)} onChange={() => {}}
                        onClick={(e) => { e.stopPropagation(); toggleSel(f, e.shiftKey); }}
                        style={{ width: 15, height: 15, accentColor: tk.accent, cursor: "pointer", margin: 0 }} />
                    </label>
                    <a
                      href={f.url} target="_blank" rel="noreferrer"
                      title={_cmIsImage(f) || _cmIsVideo(f) ? `${f.name} - click to preview` : `${f.name} - open in a new tab`}
                      onClick={_cmIsImage(f) || _cmIsVideo(f) ? (e) => { e.preventDefault(); setPreview(f); } : undefined}
                      style={{
                        display: "block", textDecoration: "none",
                        border: `1px solid ${selected.has(f.url) ? tk.accent : f.ticket_id === currentTicketId ? tk.accent : tk.border}`,
                        borderRadius: 8, overflow: "hidden", background: tk.surfaceEl,
                      }}>
                      {_cmIsImage(f) ? (
                        <img
                          src={ctkThumbUrl(f.url, 300)} alt={f.name} loading="lazy" decoding="async"
                          onError={e => {
                            const img = e.currentTarget;
                            if (!img.dataset.fellBack && f.url) { img.dataset.fellBack = "1"; img.src = f.url; }
                          }}
                          style={{ width: "100%", height: 84, objectFit: "cover", display: "block", background: tk.surfaceHov }}
                        />
                      ) : _cmIsVideo(f) ? (
                        <CmVideoThumb url={f.url} tk={tk} />
                      ) : (
                        <div style={{ height: 84, display: "flex", alignItems: "center", justifyContent: "center", color: tk.textSub, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
                          FILE
                        </div>
                      )}
                      <div style={{ padding: "6px 8px" }}>
                        <div style={{ fontSize: 11, color: tk.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: tk.textMute, marginTop: 2 }}>
                          {f.code}{f.ticket_id === currentTicketId ? " · this ticket" : ""} · {dateStr(f.sent_at)}{f.source === "response" ? " · from a response" : ""}
                        </div>
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && <MediaLightbox file={preview} tk={tk} onClose={() => setPreview(null)} />}
    </Card>
  );
}

function ContentTicketDetail({ tk, session, ticket, me, owners = [], canReassign = false, onBack, onRefetch, patchTicket, showBanner }) {
  const [assignBusy, setAssignBusy] = useState(false);
  // Re-route this single creative to a specific owner (or "me"). Manager/admin only;
  // the backend re-checks the role. Lets a manager cover an individual task without
  // re-pointing the client's whole routing roster.
  async function reassign(staffId) {
    if (assignBusy) return;
    setAssignBusy(true);
    try {
      await patchTicket(ticket.id, { action: "assign", assigned_to: staffId || null });
      await onRefetch();
      const name = staffId === me?.id ? "you" : (owners.find(o => o.id === staffId)?.name || "Unassigned");
      showBanner(`Owner set to ${name}.`);
    } catch (e) {
      showBanner("Reassign failed: " + (e?.message || "error"));
    } finally {
      setAssignBusy(false);
    }
  }
  // ── Edit the client's brief in place (staff correcting a typo / tightening notes) ──
  const [editingCtx, setEditingCtx] = useState(false);
  const [ctxDraft, setCtxDraft] = useState(null);   // working copy of ticket.context
  const [notesDraft, setNotesDraft] = useState(""); // working copy of ticket.notes
  const [titleDraft, setTitleDraft] = useState(""); // working copy of ticket.title
  const [savingCtx, setSavingCtx] = useState(false);
  function startEditCtx() {
    setCtxDraft(JSON.parse(JSON.stringify(ticket.context || {})));
    setNotesDraft(ticket.notes || "");
    setTitleDraft(ticket.title || "");
    setEditingCtx(true);
  }
  function cancelEditCtx() {
    setEditingCtx(false);
    setCtxDraft(null);
  }
  async function saveCtx() {
    if (savingCtx) return;
    setSavingCtx(true);
    try {
      await patchTicket(ticket.id, { action: "edit-context", context: ctxDraft || {}, notes: notesDraft, title: titleDraft });
      setEditingCtx(false);
      setCtxDraft(null);
      await onRefetch();
      showBanner("Brief updated.");
    } catch (e) {
      alert("Save failed: " + (e?.message || "error"));
    } finally {
      setSavingCtx(false);
    }
  }

  const [finalsToUpload, setFinalsToUpload] = useState([]); // local File objects
  const [finalsFolder, setFinalsFolder] = useState("");     // optional folder for the next upload batch
  const [finalsDragOver, setFinalsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(0);   // completed files this batch
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendNotes, setSendNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const meta = TYPE_META_CT[ticket.type] || { icon: "•", label: ticket.type };
  const academyName = ticket.client?.business_name || "—";

  const finalsExisting = Array.isArray(ticket.final_files) ? ticket.final_files : [];

  // Review mode = the finished creative goes to the client to approve before it
  // moves on. Always for organic; for ads only when the academy has the
  // "approve ads content before marketing" gate on. Otherwise ads send straight
  // to marketing.
  const adsApprovalGate = ticket.channel === "ads" && !!ticket.client?.ads_content_approval_required;
  const reviewMode = ticket.channel === "organic" || adsApprovalGate;
  // Funnel content ends with the SYSTEMS team (website placement) - not
  // marketing, not client review.
  const funnelMode = ticket.channel === "funnel";
  // Round-trip mode: this request ORIGINATED from a systems ticket, so the
  // finals return to that ticket instead of spawning a new one.
  const originSystemsId = ticket.context?.origin_systems_ticket_id || null;

  // ── Upload selected finals to Supabase Storage and persist on ticket ──
  // Files upload in PARALLEL (3 at a time - single connections rarely
  // saturate the pipe to storage, so this is a 2-3x win on video batches)
  // with a done-count on the button so big uploads never look hung.
  async function commitFinals() {
    if (!finalsToUpload.length) return;
    setUploading(true);
    setUploadDone(0);
    try {
      const files = finalsToUpload;
      const results = new Array(files.length);
      let nextIdx = 0;
      async function worker() {
        for (;;) {
          const i = nextIdx++;
          if (i >= files.length) return;
          const file = files[i];
          const uid = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${TICKET_STORAGE_FOLDER}/${ticket.id}/${uid}-${safe}`;
          const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
            contentType: file.type || "application/octet-stream",
            cacheControl: "3600",
          });
          if (upErr) throw new Error(`Storage upload failed (${file.name}): ${upErr.message}`);
          const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
          const entry = { name: file.name, url: urlData.publicUrl, size: file.size || 0, mime: file.type || "" };
          const folder = finalsFolder.trim();
          if (folder) entry.folder = folder;
          results[i] = entry;
          setUploadDone(d => d + 1);
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
      const uploaded = results.filter(Boolean);
      await patchTicket(ticket.id, { action: "upload-final", final_files: uploaded });
      setFinalsToUpload([]);
      setFinalsFolder("");
      await onRefetch();
      showBanner(`Uploaded ${uploaded.length} final file${uploaded.length === 1 ? "" : "s"}.`);
    } catch (e) {
      // The storage upload + DB write may have already succeeded even if the
      // response errored, so refetch so any saved finals still show up.
      try { await onRefetch(); } catch { /* ignore */ }
      alert("Upload failed: " + e.message + "\n\nIf your files don't appear, refresh - they may have saved.");
    } finally {
      setUploading(false);
    }
  }

  // ── Remove finals uploaded by mistake (multi-select from FilesByFolder) ──
  async function removeFinals(toRemove) {
    if (!toRemove?.length) return;
    if (!window.confirm(`Remove ${toRemove.length} file${toRemove.length === 1 ? "" : "s"} from finals? This can't be undone.`)) return;
    const removeKeys = new Set(toRemove.map(f => f.url || f.name));
    const kept = finalsExisting.filter(f => !removeKeys.has(f.url || f.name));
    // Best-effort: also delete the objects from storage (DB removal is what matters).
    try {
      const marker = `/${STORAGE_BUCKET}/`;
      const paths = toRemove
        .map(f => (f.url || "").split(marker)[1])
        .filter(Boolean)
        .map(p => decodeURIComponent(p.split("?")[0]));
      if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    } catch { /* ignore storage errors */ }
    await patchTicket(ticket.id, { action: "set-final", final_files: kept });
    await onRefetch();
    showBanner(`Removed ${toRemove.length} file${toRemove.length === 1 ? "" : "s"} from finals.`);
  }

  // Organic tickets go back to the CLIENT for review (not to marketing/Meta).
  async function sendForReview() {
    if (busy) return;
    if (!finalsExisting.length) {
      alert("Upload at least one final creative before sending for review.");
      return;
    }
    setBusy(true);
    try {
      await patchTicket(ticket.id, { action: "send-for-review" });
      showBanner(`Sent ${academyName}'s creative for client review.`);
      onBack();
      await onRefetch();
    } catch (e) {
      alert("Send for review failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  // Funnel tickets hand off to the systems team as a Change ticket (website
  // work). Origin-linked tickets RETURN finals to the requesting systems
  // ticket instead - no duplicate ticket.
  async function sendToSystems() {
    if (busy) return;
    if (!finalsExisting.length) {
      alert("Upload at least one final file before sending to systems.");
      return;
    }
    setBusy(true);
    try {
      await patchTicket(ticket.id, { action: originSystemsId ? "return-to-systems" : "send-to-systems" });
      showBanner(originSystemsId
        ? `Finals returned to the systems ticket for ${academyName}.`
        : `Sent ${academyName}'s funnel content to the systems team.`);
      onBack();
      await onRefetch();
    } catch (e) {
      alert("Send to systems failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendToMarketing(marketingNotes) {
    if (busy) return;
    if (!finalsExisting.length) {
      alert("Upload at least one final creative before sending to marketing.");
      return;
    }
    setBusy(true);
    try {
      await patchTicket(ticket.id, { action: "send-to-marketing", marketing_notes: marketingNotes || "" });
      showBanner(`Sent ${academyName} content to marketing.`);
      setSendModalOpen(false);
      setSendNotes("");
      onBack();
      await onRefetch();
    } catch (e) {
      alert("Send to marketing failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitActionRequest() {
    if (!actionMsg.trim() || busy) return;
    setBusy(true);
    try {
      await patchTicket(ticket.id, { action: "request-client-action", message: actionMsg.trim() });
      setActionMsg("");
      setActionModalOpen(false);
      showBanner(`Action request sent to ${academyName}.`);
      await onRefetch();
      onBack();
    } catch (e) {
      alert("Send failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTicket() {
    if (busy) return;
    if (!window.confirm(`Cancel this content ticket for ${academyName}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await patchTicket(ticket.id, { action: "cancel" });
      showBanner(`Content ticket for ${academyName} cancelled.`);
      await onRefetch();
      onBack();
    } catch (e) {
      alert("Cancel failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: "transparent", border: `1px solid ${tk.border}`, color: tk.textMute,
          width: 38, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 18,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
            § Content · Ticket · {ctkCode(ticket.id)}
          </div>
          {/* Title where the type used to be; when titled, the type demotes to a
              divided suffix (Cam's spec: "Title | Graphic"). Untitled = old look. */}
          <div style={{ fontSize: 24, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {editingCtx ? (
              <input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                maxLength={120}
                placeholder="Creative name"
                style={{
                  background: tk.surfaceEl, border: `1px solid ${tk.borderMed}`, color: tk.text,
                  fontSize: 18, fontWeight: 500, fontFamily: "inherit", borderRadius: 8,
                  padding: "6px 12px", minWidth: 260,
                }}
              />
            ) : (
              <span>{meta.icon}  {(ticket.title || "").trim() || `${meta.label}${ticket.type === "mixed" ? " bundle" : ""}`}</span>
            )}
            {(ticket.title || "").trim() || editingCtx ? (
              <>
                <span style={{ width: 1, height: 22, background: tk.borderStr || tk.border, flex: "none" }} />
                <span style={{ color: tk.textSub, fontSize: 16, fontWeight: 500 }}>{meta.label}{ticket.type === "mixed" ? " bundle" : ""}</span>
              </>
            ) : null}
          </div>
          <div style={{ fontSize: 13, color: tk.textSub, marginTop: 4 }}>
            {academyName} · Submitted {ticket.submitted_at ? new Date(ticket.submitted_at).toLocaleString() : "—"}
            {ctkLastActivityIso(ticket) ? ` · Last activity ${ctkFormatRelative(ctkLastActivityIso(ticket))}` : ""}
          </div>
          {/* Priority + SLA deadline, content owner (channel-routed), and SM contact */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
            <CtkChannelBadge channel={ticket.channel} />
            <CtkPriorityChip priority={ctkPriorityOf(ticket)} tk={tk} />
            {originSystemsId && (
              <span
                title={`Requested by ${ticket.context?.requested_by_name || "systems"} - finals return to systems ticket ${String(originSystemsId).slice(0, 3).toUpperCase()}`}
                style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                  padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
                  color: tk.textSub, border: `1px solid ${tk.borderMed}`,
                }}>from Systems · {String(originSystemsId).slice(0, 3).toUpperCase()}</span>
            )}
            {(() => {
              const inProg = ticket.status === "active" || ticket.status === "client-dependent";
              const dl = inProg ? ctkDeadlineInfo(ticket.submitted_at, ctkPriorityOf(ticket)) : null;
              return dl ? (
                <span style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                  padding: "3px 10px", borderRadius: 999,
                  color: dl.overdue ? CT_PRIORITY_META.high.color : tk.textSub,
                  border: `1px solid ${dl.overdue ? CT_PRIORITY_META.high.color + "66" : tk.border}`,
                }}>{dl.overdue ? "⚠ " : "⏱ "}{dl.label}</span>
              ) : null;
            })()}
            {canReassign ? (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 11, fontWeight: 600, color: tk.accent, letterSpacing: "0.04em",
                padding: "2px 6px 2px 10px", borderRadius: 999,
                border: `1px solid ${tk.accent}`, background: `${tk.accent}14`,
                opacity: assignBusy ? 0.6 : 1,
              }}>
                👤 Owner ·
                <select
                  value={ticket.assigned_to || ""}
                  disabled={assignBusy}
                  onChange={e => reassign(e.target.value || null)}
                  title="Reassign this creative"
                  style={{
                    background: "transparent", color: tk.accent, border: "none",
                    fontFamily: "inherit", fontSize: 11, fontWeight: 600, cursor: "pointer", outline: "none",
                  }}
                >
                  <option value="" style={{ color: "#000" }}>Unassigned</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id} style={{ color: "#000" }}>{o.name}</option>
                  ))}
                </select>
                {me?.id && ticket.assigned_to !== me.id && (
                  <button
                    onClick={() => reassign(me.id)}
                    disabled={assignBusy}
                    style={{
                      background: tk.accent, color: "#0A0A0B", border: "none",
                      borderRadius: 999, padding: "2px 9px", fontSize: 10, fontWeight: 700,
                      cursor: assignBusy ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}
                  >Assign to me</button>
                )}
              </span>
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 600, color: tk.accent, letterSpacing: "0.04em",
                padding: "3px 10px", borderRadius: 999,
                border: `1px solid ${tk.accent}`, background: `${tk.accent}14`,
              }}>👤 Owner · {ticket.assigned_to_name || "Unassigned"}</span>
            )}
            <span style={{
              fontSize: 11, fontWeight: 500, color: tk.textSub, letterSpacing: "0.04em",
              padding: "3px 10px", borderRadius: 999,
              border: `1px solid ${tk.border}`,
            }}>SM contact · {ticket.sm_name || "Unassigned"}</span>
          </div>
        </div>
        <StatusBadge ticket={ticket} tk={tk} />
      </div>

      {/* Brand reference (collapsible) — colors/fonts/logos so the team builds on-brand */}
      <details style={{ marginBottom: 22, background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "12px 16px" }}>
        <summary style={{
          cursor: "pointer", userSelect: "none",
          fontFamily: "monospace", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: tk.textMute,
        }}>🎨 Brand</summary>
        <div style={{ marginTop: 12 }}>
          <BrandCard brand={ticket.client?.brand_data} tk={tk} />
        </div>
      </details>

      {/* Client inputs */}
      {(() => {
        const canEditCtx = ticket.status === "active" || ticket.status === "client-dependent";
        return (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <SectionLabel tk={tk} style={{ marginBottom: 0 }}>What the client submitted</SectionLabel>
            {canEditCtx && (
              editingCtx ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={cancelEditCtx} disabled={savingCtx} style={{
                    background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
                    padding: "5px 14px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500,
                  }}>Cancel</button>
                  <button onClick={saveCtx} disabled={savingCtx} style={{
                    background: tk.accent, color: "#0A0A0B", border: 0,
                    padding: "5px 16px", borderRadius: 7, cursor: savingCtx ? "wait" : "pointer",
                    fontFamily: "inherit", fontSize: 12, fontWeight: 700, opacity: savingCtx ? 0.6 : 1,
                  }}>{savingCtx ? "Saving…" : "Save"}</button>
                </div>
              ) : (
                <button onClick={startEditCtx} style={{
                  background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
                  padding: "5px 14px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500,
                }}>✎ Edit</button>
              )
            )}
          </div>
        );
      })()}
      <Card tk={tk} style={{ marginBottom: 22 }}>
        <ClientInputs
          ticket={ticket}
          tk={tk}
          edit={editingCtx ? { draft: ctxDraft, setDraft: setCtxDraft, notesDraft, setNotesDraft } : null}
        />
      </Card>

      {/* Everything this client has EVER sent, across all tickets - for the
          "use the b-roll I previously sent" requests. Lazy-loads on expand. */}
      <ClientMediaLibrary clientId={ticket.client_id} currentTicketId={ticket.id} tk={tk} session={session} />

      {/* Finals (current + new upload) */}
      <SectionLabel tk={tk}>Finals</SectionLabel>
      <Card tk={tk} style={{ marginBottom: 22 }}>
        {finalsExisting.length === 0 ? (
          <div style={{ padding: 8, color: tk.textSub, fontSize: 13, fontStyle: "italic", marginBottom: 12 }}>
            No final creatives uploaded yet.
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <FilesByFolder files={finalsExisting} tk={tk} zipName="finals" onRemove={removeFinals} />
          </div>
        )}

        {/* Stage new finals */}
        {finalsToUpload.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {finalsToUpload.map((f, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", borderRadius: 6,
                background: "rgba(232,197,71,0.08)", border: `1px solid ${tk.accentBorder || tk.accent}`,
              }}>
                <div style={{ fontSize: 18 }}>{(f.type || "").startsWith("image/") ? "🖼" : (f.type || "").startsWith("video/") ? "🎬" : "📄"}</div>
                <div style={{ flex: 1, fontSize: 13, color: tk.text }}>{f.name}</div>
                <button onClick={() => setFinalsToUpload(prev => prev.filter((_, j) => j !== i))} style={{
                  background: "transparent", border: 0, color: tk.textMute, cursor: "pointer", fontSize: 16,
                }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Drop zone - drag final creatives here, or click to browse */}
        <label
          htmlFor="finals-input"
          onDragOver={e => { e.preventDefault(); if (!finalsDragOver) setFinalsDragOver(true); }}
          onDragEnter={e => { e.preventDefault(); setFinalsDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setFinalsDragOver(false); }}
          onDrop={e => {
            e.preventDefault();
            setFinalsDragOver(false);
            const arr = Array.from(e.dataTransfer?.files || []);
            if (arr.length) setFinalsToUpload(prev => [...prev, ...arr]);
          }}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5,
            padding: "24px 16px", marginBottom: 10,
            border: `1.5px dashed ${finalsDragOver ? tk.accent : (tk.borderStr || tk.border)}`,
            background: finalsDragOver ? (tk.accentGhost || "transparent") : "transparent",
            borderRadius: 10, cursor: uploading ? "wait" : "pointer",
            color: finalsDragOver ? tk.accent : tk.textMute,
            transition: "border-color 0.15s ease, background 0.15s ease, color 0.15s ease",
          }}
        >
          <div style={{ fontSize: 22, lineHeight: 1, pointerEvents: "none" }}>↑</div>
          <div style={{ fontSize: 13, fontWeight: 500, pointerEvents: "none" }}>Drag final creatives here, or <span style={{ color: tk.accent }}>browse</span></div>
          <div style={{ fontSize: 11, color: tk.textMute, pointerEvents: "none" }}>Images &amp; videos · multiple at once</div>
        </label>
        <input
          id="finals-input"
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: "none" }}
          onChange={e => {
            const arr = Array.from(e.target.files || []);
            if (arr.length) setFinalsToUpload(prev => [...prev, ...arr]);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={finalsFolder}
            onChange={e => setFinalsFolder(e.target.value)}
            placeholder="Folder (optional)"
            title="Group this upload batch under a folder name"
            style={{
              padding: "10px 12px", background: tk.surface, border: `1px solid ${tk.border}`,
              borderRadius: 8, color: tk.text, fontSize: 13, fontFamily: "inherit", width: 170, outline: "none",
            }}
          />
          {finalsToUpload.length > 0 && (
            <button onClick={commitFinals} disabled={uploading} style={{
              padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
              border: 0, borderRadius: 8, fontWeight: 700, cursor: uploading ? "wait" : "pointer", fontSize: 13,
              opacity: uploading ? 0.6 : 1,
            }}>{uploading ? `Uploading… ${uploadDone}/${finalsToUpload.length}` : `Upload ${finalsToUpload.length} file${finalsToUpload.length === 1 ? "" : "s"}`}</button>
          )}
        </div>
      </Card>

      {/* Activity */}
      <SectionLabel tk={tk}>Activity</SectionLabel>
      <Card tk={tk} style={{ marginBottom: 24 }}>
        {ticket.messages && ticket.messages.length ? ticket.messages.map((u, i) => (
          <div key={i} style={{
            padding: "10px 0",
            borderBottom: i < ticket.messages.length - 1 ? `1px solid ${tk.borderSoft || tk.border}` : "none",
          }}>
            <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
              {u.created_at ? new Date(u.created_at).toLocaleString() : ""} · {u.author_name || u.author_type}
              {u.is_action_request ? "  ·  Action Requested" : ""}
            </div>
            <div style={{ fontSize: 14, color: tk.text, lineHeight: 1.5 }}>{u.body}</div>
          </div>
        )) : (
          <div style={{ padding: 12, textAlign: "center", color: tk.textSub, fontSize: 13, fontStyle: "italic" }}>No activity yet.</div>
        )}
      </Card>

      {/* Actions */}
      {ticket.status !== "completed" && ticket.status !== "cancelled" && (
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={cancelTicket} disabled={busy} style={{
            background: "transparent", border: `1px solid ${tk.red || "#E55"}`, color: tk.red || "#E55",
            padding: "10px 20px", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500,
          }}>✕  Cancel</button>
          <button onClick={() => setActionModalOpen(true)} style={{
            background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
            padding: "10px 20px", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500,
          }}>Request Client Action</button>
          <button
            onClick={() => (funnelMode || originSystemsId) ? sendToSystems() : reviewMode ? sendForReview() : setSendModalOpen(true)}
            disabled={busy || !finalsExisting.length}
            title={funnelMode ? "Creates a Change ticket for the systems team with the final files attached." : adsApprovalGate ? "This academy reviews ads content before it goes to marketing. On approval it auto-sends." : ""}
            style={{
              background: tk.accent, color: "#0A0A0B", border: 0,
              padding: "10px 22px", borderRadius: 8,
              cursor: (busy || !finalsExisting.length) ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 700,
              opacity: (busy || !finalsExisting.length) ? 0.5 : 1,
            }}>{originSystemsId ? "📤  Return to Systems" : funnelMode ? "📤  Send to Systems" : reviewMode ? "📤  Send for client review" : "📤  Send to Marketing"}</button>
        </div>
      )}

      {sendModalOpen && (
        <div onClick={() => !busy && setSendModalOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(10,10,11,0.78)",
          backdropFilter: "blur(8px)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 480,
            background: tk.bg, border: `1px solid ${tk.borderStrong || tk.border}`,
            borderRadius: 12, padding: 28,
          }}>
            <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>§ Confirm</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: tk.text, marginBottom: 6 }}>
              Send to marketing?
            </div>
            <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 18, lineHeight: 1.5 }}>
              {finalsExisting.length} final file{finalsExisting.length === 1 ? "" : "s"} will be handed off to the marketing team. Optionally leave them a note.
            </div>

            <label style={{ fontSize: 11, fontWeight: 700, color: tk.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" }}>
              Notes for marketing (optional)
            </label>
            <textarea
              value={sendNotes}
              onChange={e => setSendNotes(e.target.value)}
              placeholder="e.g. The 16:9 version is the hero. Variants are sized for IG story and feed."
              style={{
                width: "100%", minHeight: 100,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${tk.border}`, borderRadius: 6,
                color: tk.text, fontFamily: "inherit", fontSize: 14,
                padding: "10px 12px", resize: "vertical",
              }}
            />

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setSendModalOpen(false)} disabled={busy} style={{
                background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
                padding: "10px 18px", borderRadius: 6, cursor: busy ? "wait" : "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: 500, opacity: busy ? 0.6 : 1,
              }}>Cancel</button>
              <button onClick={() => sendToMarketing(sendNotes)} disabled={busy} style={{
                background: tk.accent, color: "#0A0A0B", border: 0,
                padding: "10px 20px", borderRadius: 6,
                cursor: busy ? "wait" : "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                opacity: busy ? 0.6 : 1,
              }}>{busy ? "Sending…" : "Send to Marketing"}</button>
            </div>
          </div>
        </div>
      )}

      {actionModalOpen && (
        <div onClick={() => setActionModalOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(10,10,11,0.78)",
          backdropFilter: "blur(8px)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 460,
            background: tk.bg, border: `1px solid ${tk.borderStrong || tk.border}`,
            borderRadius: 12, padding: 28,
          }}>
            <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>§ Action Request</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: tk.text, marginBottom: 6 }}>What do you need from the client?</div>
            <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 18, lineHeight: 1.5 }}>
              {academyName} will see this on their portal and be prompted to respond.
            </div>
            <textarea autoFocus value={actionMsg} onChange={e => setActionMsg(e.target.value)}
              placeholder="e.g. Could you send a higher-res version of the logo? The current one is pixelating."
              style={{
                width: "100%", minHeight: 110,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${tk.border}`, borderRadius: 6,
                color: tk.text, fontFamily: "inherit", fontSize: 14,
                padding: "10px 12px", resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => { setActionModalOpen(false); setActionMsg(""); }} style={{
                background: "transparent", border: `1px solid ${tk.border}`, color: tk.textSub,
                padding: "10px 18px", borderRadius: 6, cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: 500,
              }}>Cancel</button>
              <button onClick={submitActionRequest} disabled={!actionMsg.trim() || busy} style={{
                background: actionMsg.trim() ? tk.accent : tk.border, color: "#0A0A0B", border: 0,
                padding: "10px 20px", borderRadius: 6,
                cursor: actionMsg.trim() && !busy ? "pointer" : "not-allowed",
                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                opacity: actionMsg.trim() && !busy ? 1 : 0.6,
              }}>Send Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ ticket, tk }) {
  let label, color;
  if (ticket.status === "completed") { label = "Completed"; color = tk.green || "#7ED996"; }
  else if (ticket.status === "cancelled") { label = "Cancelled"; color = tk.textMute; }
  else if (ticket.status === "client-dependent") { label = "Awaiting client"; color = tk.red || "#ED7969"; }
  else { label = "Active"; color = tk.accent; }
  return (
    <span style={{
      color, fontSize: 11, fontWeight: 600, letterSpacing: "0.15em",
      textTransform: "uppercase", padding: "5px 11px", borderRadius: 999,
      border: `1px solid ${color}`, background: `${color}15`, whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function ClientInputs({ ticket, tk, edit = null }) {
  const ctx = ticket.context || {};
  const raw = Array.isArray(ticket.raw_files) ? ticket.raw_files : [];
  const subCreatives = Array.isArray(ctx.creatives) ? ctx.creatives : null;

  // In edit mode we read/write the draft copy the parent owns; the branch
  // structure (which fields show) stays keyed off the original ctx so the shape
  // can't shift mid-edit.
  const editing = !!edit;
  const d = editing ? (edit.draft || {}) : ctx;
  const setField = (key, value) => edit.setDraft(prev => ({ ...(prev || {}), [key]: value }));
  const setCreative = (i, key, value) => edit.setDraft(prev => ({
    ...(prev || {}),
    creatives: (prev.creatives || []).map((c, j) => (j === i ? { ...c, [key]: value } : c)),
  }));

  const inputStyle = {
    width: "100%", padding: "8px 10px", background: tk.surface,
    border: `1px solid ${tk.border}`, borderRadius: 7, color: tk.text,
    fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const textInput = (key, { placeholder } = {}) => (
    <input type="text" value={d[key] || ""} placeholder={placeholder || ""}
      onChange={e => setField(key, e.target.value)} style={inputStyle} />
  );
  const textArea = (key, { placeholder, minRows = 3 } = {}) => (
    <textarea value={d[key] || ""} placeholder={placeholder || ""} rows={minRows}
      onChange={e => setField(key, e.target.value)} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
  );
  const toggle = (key) => (
    <button type="button" onClick={() => setField(key, !d[key])} style={{
      display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
      background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 999,
      padding: "5px 12px", color: d[key] ? (tk.green || "#7BC47F") : tk.textMute,
      fontFamily: "inherit", fontSize: 13, fontWeight: 600,
    }}>{d[key] ? "✓ Yes" : "✕ No"}</button>
  );

  const row = (label, value) => (
    <div key={label} style={{
      display: "flex", alignItems: "flex-start", gap: 16,
      padding: "10px 0",
      borderBottom: `1px solid ${tk.borderSoft || tk.border}`,
    }}>
      <div style={{
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
        width: 150, flexShrink: 0, paddingTop: 4,
      }}>{label}</div>
      <div style={{ flex: 1, color: tk.text, fontSize: 14, lineHeight: 1.5 }}>{value}</div>
    </div>
  );

  return (
    <>
      {ctx.source === "new-campaign" && (
        <>
          {row("Offer", editing
            ? textInput("offer", { placeholder: "Offer name" })
            : <span><span style={{ color: tk.accent }}>📦 New campaign</span> · offer: <b>{ctx.offer || "—"}</b></span>)}
          {ctx.is_new_offer && row("New offer description", editing
            ? textArea("new_offer_description", { placeholder: "Describe the new offer", minRows: 2 })
            : (ctx.new_offer_description || "—"))}
          {row("Monthly spend", editing
            ? textInput("monthly_spend", { placeholder: "e.g. $1,500/mo" })
            : <span style={{ color: tk.accent, fontWeight: 600 }}>{ctx.monthly_spend || "—"}</span>)}
          {row("Landing page", editing
            ? textInput("landing_page", { placeholder: "https://… (blank = default funnel)" })
            : (ctx.landing_page ? <a href={ctx.landing_page} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{ctx.landing_page} ↗</a> : <span style={{ color: tk.textMute }}>(default funnel)</span>))}
        </>
      )}
      {ctx.source === "add-creative" && row("Source", <span>Add-creative on <b>{ctx.campaign_title || "(unspecified)"}</b></span>)}
      {ctx.source === "marketing-revision" && row("Source", <span style={{ color: tk.red || "#ED7969" }}>↩ Revision requested by marketing</span>)}

      {(ctx.format !== undefined || editing) && row("Format", editing
        ? textInput("format", { placeholder: "e.g. Reel, Static, Carousel" })
        : (ctx.format ? <b style={{ color: tk.accent }}>{ctx.format}</b> : <span style={{ color: tk.textMute }}>—</span>))}
      {ctx.captions !== undefined && row("On-screen captions", editing
        ? toggle("captions")
        : (ctx.captions
          ? <span style={{ color: tk.green || "#7BC47F", fontWeight: 600 }}>Yes</span>
          : <span style={{ color: tk.textMute }}>No</span>))}

      {subCreatives ? (
        <div style={{ padding: "10px 0" }}>
          <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>
            Creatives ({subCreatives.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {subCreatives.map((c, i) => {
              const cd = editing ? ((d.creatives || [])[i] || c) : c;
              return (
              <div key={i} style={{
                padding: 14, background: "rgba(255,255,255,0.02)",
                border: `1px solid ${tk.borderSoft || tk.border}`, borderRadius: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: tk.text }}>
                    Creative {i + 1} · {(TYPE_META_CT[cd.type] || {}).label || cd.type}
                  </span>
                  {editing ? (
                    <input type="text" value={cd.angle || ""} placeholder="Angle (optional)"
                      onChange={e => setCreative(i, "angle", e.target.value)}
                      style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160, padding: "4px 8px", fontSize: 12 }} />
                  ) : (cd.angle && (
                    <span style={{
                      fontSize: 10, color: tk.accent, letterSpacing: "0.08em", textTransform: "uppercase",
                      padding: "2px 8px", borderRadius: 4,
                      border: `1px solid ${tk.accent}`, background: "rgba(232,197,71,0.08)",
                    }} title="Recommended angle from the offer's guide card">
                      {cd.angle}{cd.type ? ` · ${cd.type}` : ""}
                    </span>
                  ))}
                </div>
                {editing ? (
                  <textarea value={cd.notes || ""} placeholder="Notes for this creative" rows={3}
                    onChange={e => setCreative(i, "notes", e.target.value)}
                    style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, marginBottom: 10 }} />
                ) : (
                  <div style={{ fontSize: 13, color: tk.text, marginBottom: 10, whiteSpace: "pre-wrap" }}>
                    {cd.notes || <span style={{ color: tk.textMute, fontStyle: "italic" }}>(no notes)</span>}
                  </div>
                )}
                <FilesByFolder files={c.raw_files} tk={tk} compact minmax={160} />
              </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {row("Notes", editing
            ? <textarea value={edit.notesDraft} placeholder="Brief / notes" rows={4}
                onChange={e => edit.setNotesDraft(e.target.value)}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
            : (ticket.notes
              ? <span style={{ whiteSpace: "pre-wrap" }}>{ticket.notes}</span>
              : <span style={{ color: tk.textMute, fontStyle: "italic" }}>(no notes)</span>))}
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>
              Raw files ({raw.length})
            </div>
            {raw.length ? (
              <FilesByFolder files={raw} tk={tk} />
            ) : (
              <div style={{ color: tk.textMute, fontSize: 13, fontStyle: "italic" }}>None</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// Client brand reference — colors, fonts, logos — so the content team builds
// on-brand without leaving the ticket. Reads clients.brand_data.
function BrandCard({ brand, tk }) {
  const b = brand || {};
  const colors = [["Primary", b.color_primary], ["Secondary", b.color_secondary], ["Accent", b.color_accent]].filter(c => c[1]);
  const logos = [["Dark bg", b.logo_dark_url], ["Light bg", b.logo_light_url], ["Icon", b.icon_url]].filter(l => l[1]);
  const hasAny = colors.length || logos.length || b.font_display || b.font_body || b.notes || b.stats;
  if (!hasAny) {
    return <div style={{ color: tk.textMute, fontSize: 13, fontStyle: "italic" }}>No brand info on file yet.</div>;
  }
  const row = (label, value) => value ? (
    <div style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: `1px solid ${tk.borderSoft || tk.border}` }}>
      <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: tk.textMute, width: 90, flexShrink: 0, paddingTop: 3 }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: tk.text }}>{value}</div>
    </div>
  ) : null;
  return (
    <div>
      {colors.length > 0 && row("Colors", (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {colors.map(([name, hex]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 22, borderRadius: 5, background: hex, border: `1px solid ${tk.border}`, display: "inline-block" }} />
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{hex}</span>
              <span style={{ fontSize: 11, color: tk.textMute }}>{name}</span>
            </div>
          ))}
        </div>
      ))}
      {(b.font_display || b.font_body) && row("Fonts", (
        <span>{[b.font_display && `Display: ${b.font_display}`, b.font_body && `Body: ${b.font_body}`].filter(Boolean).join("  ·  ")}</span>
      ))}
      {logos.length > 0 && row("Logos", (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {logos.map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noreferrer" title={name} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: 6, borderRadius: 6, border: `1px solid ${tk.border}`, background: name === "Light bg" ? "#fff" : tk.surfaceHov,
              textDecoration: "none",
            }}>
              <img src={url} alt={name} style={{ width: 48, height: 36, objectFit: "contain" }} />
              <span style={{ fontSize: 9, color: tk.textMute }}>{name}</span>
            </a>
          ))}
        </div>
      ))}
      {row("Website", b.website_url || b.domain ? <a href={(b.website_url || b.domain).startsWith("http") ? (b.website_url || b.domain) : `https://${b.website_url || b.domain}`} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{b.website_url || b.domain} ↗</a> : null)}
      {row("Brand notes", b.notes ? <span style={{ whiteSpace: "pre-wrap" }}>{b.notes}</span> : null)}
      {row("Stats", b.stats || null)}
    </div>
  );
}

// Render a set of files grouped by their `folder` (the client's categories).
// Falls back to a flat grid when nothing is foldered.
// Fetch the given files and download them as a single .zip (one click instead of
// N). Files that fail to fetch are skipped. Names are de-duped inside the zip.
async function ctkDownloadZip(files, baseName) {
  const zip = new JSZip();
  const used = new Set();
  await Promise.all(files.map(async (f) => {
    try {
      const res = await fetch(f.url);
      if (!res.ok) return;
      const blob = await res.blob();
      const safe = (f.name || "file").replace(/[\\/]/g, "_");
      let name = safe, n = 1;
      while (used.has(name)) {
        const dot = safe.lastIndexOf(".");
        name = dot > 0 ? `${safe.slice(0, dot)}-${n}${safe.slice(dot)}` : `${safe}-${n}`;
        n++;
      }
      used.add(name);
      zip.file(name, blob);
    } catch (_) { /* skip files that can't be fetched */ }
  }));
  const out = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(out);
  const a = document.createElement("a");
  a.href = url; a.download = `${baseName || "files"}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Supabase public-storage URLs accept ?download=<name>, which flips the
// response to Content-Disposition: attachment - the browser streams straight
// to disk. Non-storage URLs pass through unchanged.
function ctkDirectUrl(f) {
  return mlDownloadUrl(f);
}
// Download files individually, streamed to the Downloads folder. Staggered so
// Chrome registers them as one multi-download burst (single permission prompt).
async function ctkDownloadDirect(files, onProgress) {
  for (let i = 0; i < files.length; i++) {
    const a = document.createElement("a");
    a.href = ctkDirectUrl(files[i]);
    a.download = files[i].name || "file";
    document.body.appendChild(a); a.click(); a.remove();
    if (onProgress) onProgress(i + 1, files.length);
    await new Promise(r => setTimeout(r, 350));
  }
}
// Pick a destination folder ONCE, then stream every file into it (File System
// Access API, Chrome/Edge). No per-file Save As dialogs even when Chrome's
// "ask where to save each file" setting is on. Returns false if the user
// cancelled the picker (caller falls back or aborts), true when done.
async function ctkDownloadToFolder(files, onProgress, pickerId) {
  let dir;
  try {
    // `id` makes Chrome remember the last-used folder PER id - keyed by client
    // so Pro Precision downloads reopen in Pro Precision's folder, not the
    // last client you happened to touch. Must be <= 32 chars, [a-zA-Z0-9_-].
    const opts = { mode: "readwrite" };
    const cleanId = typeof pickerId === "string" ? pickerId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) : "";
    if (cleanId) opts.id = cleanId;
    dir = await window.showDirectoryPicker(opts);
  } catch {
    return false;   // user cancelled the folder picker
  }
  const used = new Set();
  for (let i = 0; i < files.length; i++) {
    try {
      const f = files[i];
      const res = await fetch(f.url);
      if (!res.ok) continue;
      const safe = (f.name || "file").replace(/[\\/:*?"<>|]/g, "_");
      let name = safe, n = 1;
      while (used.has(name)) {
        const dot = safe.lastIndexOf(".");
        name = dot > 0 ? `${safe.slice(0, dot)}-${n}${safe.slice(dot)}` : `${safe}-${n}`;
        n++;
      }
      used.add(name);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await res.body.pipeTo(writable);   // streams network -> disk, no RAM buildup
    } catch { /* skip files that fail; keep going */ }
    if (onProgress) onProgress(i + 1, files.length);
  }
  return true;
}
// Zip only small non-video batches. In-browser zipping buffers every file in
// RAM before packaging (Google Drive zips server-side; we can't), so video
// batches took minutes and could die at Chrome's ~2GB blob ceiling.
function ctkShouldZip(files) {
  return files.length <= 12 && !files.some(f => _cmIsVideo(f));
}
// Shared "download picked files the right way" wrapper for the grids below.
// Big batches: folder streaming where supported (one picker, zero dialogs),
// else per-file direct downloads.
async function ctkDownloadPicked(picked, zipName, setNote, pickerId) {
  if (ctkShouldZip(picked)) {
    setNote("Zipping…");
    await ctkDownloadZip(picked, zipName);
    return;
  }
  const note = (i, n) => setNote(`Downloading ${i}/${n}…`);
  if (typeof window.showDirectoryPicker === "function") {
    setNote("Pick a folder…");
    await ctkDownloadToFolder(picked, note, pickerId);   // false = user cancelled; that's a deliberate abort
    return;
  }
  await ctkDownloadDirect(picked, note);
}

function FilesByFolder({ files, tk, compact, minmax = 180, zipName = "creatives", onRemove }) {
  const list = Array.isArray(files) ? files : [];
  const keyOf = (f) => f.url || f.name || "";
  const isDl = (f) => !!f.url && (f.mime || "") !== "text/uri-list";   // skip drive-link entries
  const dlList = list.filter(isDl);
  const [selected, setSelected] = useState(() => new Set());
  const [zipping, setZipping] = useState(false);
  const [dlNote, setDlNote] = useState("");
  const [removing, setRemoving] = useState(false);
  if (!list.length) return null;

  const toggle = (f) => setSelected(s => {
    const n = new Set(s); const k = keyOf(f); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const selCount = dlList.filter(f => selected.has(keyOf(f))).length;
  const allSelected = dlList.length > 0 && selCount === dlList.length;
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(dlList.map(keyOf)));
  const download = async (which) => {
    const picked = which === "all" ? dlList : dlList.filter(f => selected.has(keyOf(f)));
    if (!picked.length) return;
    setZipping(true);
    try { await ctkDownloadPicked(picked, zipName, setDlNote); }
    catch (e) { alert("Download failed: " + (e.message || e)); }
    finally { setZipping(false); setDlNote(""); }
  };
  const removeSelected = async () => {
    const picked = list.filter(f => selected.has(keyOf(f)));
    if (!picked.length || !onRemove) return;
    setRemoving(true);
    try { await onRemove(picked); setSelected(new Set()); }
    catch (e) { alert("Remove failed: " + (e.message || e)); }
    finally { setRemoving(false); }
  };

  const btn = (accent) => ({
    padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, fontFamily: "inherit",
    cursor: zipping ? "wait" : "pointer",
    border: `1px solid ${accent ? tk.accent : tk.border}`,
    background: accent ? tk.accent : "transparent",
    color: accent ? "#0A0A0B" : tk.textSub,
  });

  const groups = {};
  list.forEach(f => { const k = (f.folder || "").trim(); (groups[k] = groups[k] || []).push(f); });
  const names = Object.keys(groups).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  const tile = (f, i) => (
    <div key={i} style={{ position: "relative" }}>
      {isDl(f) && (
        <label onClick={e => e.stopPropagation()} style={{
          position: "absolute", top: 7, left: 7, zIndex: 3,
          width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.55)", borderRadius: 5, cursor: "pointer",
        }}>
          <input type="checkbox" checked={selected.has(keyOf(f))} onChange={() => toggle(f)}
            style={{ width: 15, height: 15, accentColor: tk.accent, cursor: "pointer", margin: 0 }} />
        </label>
      )}
      <FilePreviewTile file={f} tk={tk} compact={compact} />
    </div>
  );
  const grid = (items) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minmax}px, 1fr))`, gap: 10 }}>
      {items.map(tile)}
    </div>
  );

  const removeBtn = {
    padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, fontFamily: "inherit",
    cursor: removing ? "wait" : "pointer",
    border: `1px solid ${tk.danger || "#E0524A"}`, background: "transparent", color: tk.danger || "#E0524A",
  };
  const showToolbar = dlList.length > 1 || (onRemove && dlList.length >= 1);
  const toolbar = showToolbar ? (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <button type="button" onClick={selectAll} style={btn(false)}>{allSelected ? "Clear" : "Select all"}</button>
      {selCount > 0 && (
        <button type="button" onClick={() => download("selected")} disabled={zipping} style={btn(true)}>
          {zipping ? (dlNote || "Preparing…") : `↓ Download ${selCount} selected`}
        </button>
      )}
      {dlList.length > 1 && (
        <button type="button" onClick={() => download("all")} disabled={zipping} style={btn(false)}>
          {zipping ? (dlNote || "Preparing…") : `↓ Download all (${dlList.length})`}
        </button>
      )}
      {onRemove && selCount > 0 && (
        <button type="button" onClick={removeSelected} disabled={removing} style={removeBtn}>
          {removing ? "Removing…" : `✕ Remove ${selCount} selected`}
        </button>
      )}
    </div>
  ) : null;

  const body = (names.length === 1 && names[0] === "")
    ? grid(groups[""])
    : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {names.map(name => (
          <details key={name || "_uncat"} style={{
            border: `1px solid ${tk.borderSoft || tk.border}`, borderRadius: 8, padding: "8px 10px",
          }}>
            <summary style={{
              cursor: "pointer", userSelect: "none",
              fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
              color: name ? tk.accent : tk.textMute,
            }}>
              {name ? `📁 ${name}` : "Uncategorized"} <span style={{ color: tk.textMute }}>({groups[name].length})</span>
            </summary>
            <div style={{ marginTop: 10 }}>{grid(groups[name])}</div>
          </details>
        ))}
      </div>
    );

  return <div>{toolbar}{body}</div>;
}

// Resize a Supabase public-storage image to a small thumbnail on the fly (Supabase
// image transforms). Camera-original JPEGs are multi-MB each; the grid only needs
// ~400px. Non-Supabase URLs (e.g. Google Drive links) pass through untouched, and
// the <img> onError falls back to the full file if transforms aren't available.
function ctkThumbUrl(url, width = 400) {
  if (typeof url !== "string" || !url.includes("/storage/v1/object/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=${width}&quality=70&resize=contain`;
}

function FilePreviewTile({ file, tk, compact }) {
  const isImage = (file.mime || "").startsWith("image/");
  const isVideo = (file.mime || "").startsWith("video/");
  const icon = isImage ? "🖼" : isVideo ? "🎬" : "📄";
  // Media tiles preview in the lightbox; the Download caption below keeps the
  // one-click download. The lightbox renders as a sibling of the <a>, never
  // inside it, so modal clicks don't navigate.
  const [preview, setPreview] = useState(false);
  const isMedia = mlIsMedia(file);
  return (<>
    <a
      href={file.url} target="_blank" rel="noreferrer" download={file.name}
      onClick={isMedia ? (e) => { e.preventDefault(); setPreview(true); } : undefined}
      style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: 10, borderRadius: 8,
      background: tk.surface, border: `1px solid ${tk.border}`,
      textDecoration: "none", color: tk.text,
      transition: "border-color 0.15s ease",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = tk.accent}
      onMouseLeave={e => e.currentTarget.style.borderColor = tk.border}
    >
      {isImage ? (
        <img
          src={ctkThumbUrl(file.url)}
          alt={file.name}
          loading="lazy"
          decoding="async"
          onError={e => {
            // Transform endpoint unavailable (or errored) → fall back to the original once.
            const img = e.currentTarget;
            if (!img.dataset.fellBack && file.url) { img.dataset.fellBack = "1"; img.src = file.url; }
          }}
          style={{
            width: "100%", aspectRatio: "1 / 1", objectFit: "cover",
            borderRadius: 4, background: tk.surfaceHov,
          }}
        />
      ) : isVideo ? (
        <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1" }}>
          {/* Poster frame: seek a fraction in so browsers paint a real frame, not black */}
          <video
            src={`${file.url}#t=0.5`}
            muted playsInline preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4, background: tk.surfaceHov, display: "block" }}
          />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, paddingLeft: 2 }}>▶</span>
          </div>
        </div>
      ) : (
        <div style={{
          width: "100%", aspectRatio: "1 / 1",
          background: tk.surfaceHov, borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: compact ? 28 : 36, color: tk.textMute,
        }}>{icon}</div>
      )}
      <div style={{ fontSize: compact ? 11 : 12, color: tk.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </div>
      <div
        onClick={isMedia ? (e) => {
          // Real download, not the preview intercept and not inline navigation
          // (images render in a tab without ?download).
          e.preventDefault(); e.stopPropagation();
          const a = document.createElement("a");
          a.href = mlDownloadUrl(file); a.download = file.name || "file";
          document.body.appendChild(a); a.click(); a.remove();
        } : undefined}
        style={{ fontSize: 10, color: tk.accent, letterSpacing: "0.05em" }}
      >Download ↓</div>
    </a>
    {preview && <MediaLightbox file={file} tk={tk} onClose={() => setPreview(false)} />}
  </>);
}

function SectionLabel({ children, tk, style }) {
  return (
    <div style={{
      fontSize: 10, color: tk.textMute, letterSpacing: "0.22em",
      textTransform: "uppercase", marginBottom: 10, ...style,
    }}>{children}</div>
  );
}

function Card({ children, tk, style }) {
  return (
    <div style={{
      background: tk.surface,
      border: `1px solid ${tk.border}`,
      borderRadius: 10,
      padding: 18,
      ...style,
    }}>{children}</div>
  );
}

// ─── Content Routing roster (managers/admin) ────────────────────────────────
// One screen: who owns each client's organic vs ads content. Blank = the global
// channel default (organic → Eli, ads → Cam). Writes clients.content_assignee_*.
// Internal only — clients never see these assignments.
const ROUTING_OWNER_ROLES = ["admin", "scaling_manager", "marketing_manager", "marketing_executor", "content_executor"];

function ContentRoutingTab({ tk, session }) {
  const [clients, setClients] = useState([]);
  const [staff, setStaff]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [savingKey, setSavingKey] = useState(null);
  const [q, setQ]             = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr("");
      try {
        const [cRes, sRes] = await Promise.all([
          supabase.from("clients")
            .select("id,business_name,status,organic_content,content_assignee_organic_id,content_assignee_ads_id")
            .order("business_name"),
          supabase.from("staff").select("id,name,role").order("name"),
        ]);
        if (cRes.error) throw cRes.error;
        if (sRes.error) throw sRes.error;
        if (cancelled) return;
        setClients((cRes.data || []).filter(c => c.status !== "archived"));
        setStaff(sRes.data || []);
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const owners = staff.filter(s => ROUTING_OWNER_ROLES.includes(s.role));

  async function setAssignee(client, channel, staffId) {
    const field = channel === "organic" ? "content_assignee_organic_id" : "content_assignee_ads_id";
    const key = `${client.id}:${channel}`;
    const prevVal = client[field] || null;
    setSavingKey(key);
    setClients(prev => prev.map(c => c.id === client.id ? { ...c, [field]: staffId || null } : c));
    try {
      const tok = session?.access_token;
      const res = await fetch(`/api/clients?action=update-fields&id=${client.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ client_id: client.id, [field]: staffId || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    } catch (e) {
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, [field]: prevVal } : c));
      alert("Save failed: " + (e.message || e));
    } finally {
      setSavingKey(null);
    }
  }

  const selStyle = {
    width: "100%", padding: "7px 9px", fontSize: 13, borderRadius: 6,
    background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.border}`, cursor: "pointer",
  };

  const renderSelect = (client, channel) => {
    const field = channel === "organic" ? "content_assignee_organic_id" : "content_assignee_ads_id";
    const disabled = channel === "organic" && !client.organic_content;
    const key = `${client.id}:${channel}`;
    if (disabled) {
      return <span style={{ fontSize: 12, color: tk.textMute, fontStyle: "italic" }}>organic off</span>;
    }
    return (
      <select
        value={client[field] || ""}
        disabled={savingKey === key}
        onChange={e => setAssignee(client, channel, e.target.value || null)}
        style={{ ...selStyle, opacity: savingKey === key ? 0.6 : 1 }}
      >
        <option value="">{channel === "organic" ? "Default → Eli" : "Default → Cam"}</option>
        {owners.map(o => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
      </select>
    );
  };

  const filtered = clients.filter(c =>
    !q.trim() || (c.business_name || "").toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: tk.textSub, marginBottom: 16, lineHeight: 1.5 }}>
        Who produces each client's creatives, per channel. <b style={{ color: tk.text }}>Blank = the channel default</b> —
        organic routes to the content team (Eli), ads routes to marketing (Cam). New creatives auto-assign by this table; the owner can still be overridden per creative. <b style={{ color: tk.text }}>Clients never see this.</b>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search clients…"
        style={{
          width: 260, maxWidth: "100%", padding: "8px 11px", fontSize: 13, marginBottom: 14,
          background: tk.surfaceEl, color: tk.text, border: `1px solid ${tk.border}`, borderRadius: 6,
        }}
      />

      {loading && <div style={{ color: tk.textMute, fontSize: 13 }}>Loading roster…</div>}
      {err && <div style={{ color: tk.red || "#e5484d", fontSize: 13 }}>Failed to load: {err}</div>}

      {!loading && !err && (
        <div style={{ border: `1px solid ${tk.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 220px 220px", gap: 0,
            padding: "10px 14px", background: tk.surfaceEl || tk.surface,
            fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: tk.textMute, fontWeight: 700,
          }}>
            <span>Client</span><span>🌱 Organic owner</span><span>📣 Ads owner</span>
          </div>
          {filtered.map((c, i) => (
            <div key={c.id} style={{
              display: "grid", gridTemplateColumns: "1fr 220px 220px", gap: 12,
              alignItems: "center", padding: "10px 14px",
              borderTop: `1px solid ${tk.border}`,
              background: i % 2 ? "transparent" : (tk.surfaceHov ? `${tk.surfaceHov}55` : "transparent"),
            }}>
              <span style={{ fontSize: 13, color: tk.text, fontWeight: 600 }}>{c.business_name || "—"}</span>
              <div>{renderSelect(c, "organic")}</div>
              <div>{renderSelect(c, "ads")}</div>
            </div>
          ))}
          {!filtered.length && (
            <div style={{ padding: "14px", color: tk.textMute, fontSize: 13, borderTop: `1px solid ${tk.border}` }}>
              No clients match “{q}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
