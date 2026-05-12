import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";

const STORAGE_BUCKET = "ticket-files";
const STORAGE_FOLDER = "guide-cards";

export default function ContentView({ tokens: tk, dark, me, session }) {
  const [guides, setGuides]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [banner, setBanner]       = useState(null);
  const [error, setError]         = useState("");

  const isEditing = editingId !== null || creating;
  const editing = editingId ? guides.find(g => g.id === editingId) : null;

  // ─────────────────── Fetch on mount ───────────────────
  useEffect(() => {
    fetchGuides();
  }, []);

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

  // ─────────────────── Edit view ───────────────────
  if (isEditing) {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
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
      {banner && <Banner banner={banner} tk={tk} />}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>§ Content</div>
          <div style={{ fontSize: 28, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em" }}>Guide Cards</div>
          <div style={{ fontSize: 13, color: tk.textSub, marginTop: 6 }}>
            {loading ? "Loading…" : `${guides.length} card${guides.length === 1 ? "" : "s"}. These guide cards appear in clients' "+ Add New Campaign" wizard.`}
          </div>
          {error && <div style={{ color: tk.red || "#ED7969", fontSize: 13, marginTop: 8 }}>⚠ {error}</div>}
        </div>
        <button
          onClick={() => { setCreating(true); setEditingId(null); }}
          style={{
            padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >+ New guide card</button>
      </div>

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
function GuideEditor({ tk, initial, isNew, onCancel, onSave, onDelete }) {
  const [title, setTitle]       = useState(initial.title || "");
  const [purpose, setPurpose]   = useState(initial.purpose || "");
  const [tips, setTips]         = useState(initial.filming_tips || "");
  const [script, setScript]     = useState(initial.example_script || "");
  const [assets, setAssets]     = useState(Array.isArray(initial.example_assets) ? initial.example_assets : []);
  const [links, setLinks]       = useState(Array.isArray(initial.example_links)  ? initial.example_links  : []);
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

  // ─ Upload to Supabase Storage ─
  const uploadFiles = async (filesList) => {
    const incoming = Array.from(filesList || []);
    if (!incoming.length) return;
    setUploading(true);
    setError("");
    try {
      const uploads = await Promise.all(incoming.map(async (file) => {
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
      }));
      setAssets(prev => [...prev, ...uploads]);
    } catch (e) {
      setError("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const removeAsset = (idx) => setAssets(prev => prev.filter((_, i) => i !== idx));
  const addLinkRow  = () => setLinks(prev => [...prev, { url: "", label: "" }]);
  const updateLink  = (idx, key, value) => setLinks(prev => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));
  const removeLink  = (idx) => setLinks(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    setError("");
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    // Filter out blank link rows
    const cleanLinks = links.filter(l => (l.url || "").trim());
    onSave({
      title: title.trim(),
      purpose: purpose.trim(),
      filming_tips: tips.trim(),
      example_script: script.trim(),
      example_assets: assets,
      example_links: cleanLinks,
    });
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

      <label style={labelStyle}>Purpose</label>
      <textarea style={textareaStyle} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Why does this offer exist? Who is the audience? What action do we want them to take?" />

      <label style={labelStyle}>Filming / creation tips</label>
      <textarea style={textareaStyle} value={tips} onChange={e => setTips(e.target.value)} placeholder="Camera angle, lighting, length, voiceover, hook in the first 3 seconds, etc." />

      <label style={labelStyle}>Example script</label>
      <textarea style={textareaStyle} value={script} onChange={e => setScript(e.target.value)} placeholder={"Hook line in the first 3 seconds.\nThen the offer pitch.\nThen the call to action."} />

      <label style={labelStyle}>Example assets {uploading && <span style={{ color: tk.accent, marginLeft: 8 }}>(uploading…)</span>}</label>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 8, marginBottom: 6,
      }}>
        {assets.map((a, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img src={a.url || a} alt={a.name || ""} style={{
              width: "100%", aspectRatio: "1 / 1", objectFit: "cover",
              borderRadius: 8, border: `1px solid ${tk.border}`, display: "block",
            }} />
            <button
              onClick={() => removeAsset(i)}
              style={{
                position: "absolute", top: 6, right: 6,
                width: 24, height: 24, borderRadius: "50%",
                background: "rgba(0,0,0,0.7)", color: "#fff",
                border: 0, cursor: "pointer", fontSize: 14, lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(4px)",
              }}
              aria-label="Remove"
            >×</button>
          </div>
        ))}
        <label
          htmlFor="guide-asset-input"
          style={{
            aspectRatio: "1 / 1",
            border: `1.5px dashed ${tk.borderStr || tk.border}`,
            borderRadius: 8,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            cursor: uploading ? "wait" : "pointer", color: tk.textMute,
            fontSize: 13, gap: 4,
            transition: "border-color 0.15s ease, color 0.15s ease",
            opacity: uploading ? 0.5 : 1,
          }}
          onMouseEnter={e => { if (!uploading) { e.currentTarget.style.borderColor = tk.accent; e.currentTarget.style.color = tk.accent; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = tk.borderStr || tk.border; e.currentTarget.style.color = tk.textMute; }}
        >
          <div style={{ fontSize: 22, lineHeight: 1 }}>+</div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Add</div>
        </label>
        <input
          id="guide-asset-input"
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          disabled={uploading}
          style={{ display: "none" }}
          onChange={e => { uploadFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ""; }}
        />
      </div>
      <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 22 }}>
        {assets.length} asset{assets.length === 1 ? "" : "s"} · Files persist in Supabase Storage.
      </div>

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
