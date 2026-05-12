import { useState, useRef } from "react";

const DEFAULT_OFFERS = [
  "Camps",
  "Internal tournament",
  "Internal league",
  "Gym rental",
  "Youth academy",
  "Training",
  "Tryouts",
  "General teams",
  "New hire",
  "Promo",
];

// Pre-seeded guide cards — one per offer, with placeholder copy Cam will overwrite.
const SAMPLE_GUIDES = DEFAULT_OFFERS.map((name, i) => ({
  id: `guide-${i + 1}`,
  title: name,
  purpose: "",
  filmingTips: "",
  exampleScript: "",
  exampleAssets: [
    `https://picsum.photos/seed/${name.replace(/\s/g, "")}-1/200/200`,
    `https://picsum.photos/seed/${name.replace(/\s/g, "")}-2/200/200`,
  ],
  updatedAt: null,
}));

export default function ContentView({ tokens: tk, dark, me }) {
  const [guides, setGuides]   = useState(SAMPLE_GUIDES);
  const [editingId, setEditingId] = useState(null); // null = list view
  const [creating, setCreating]   = useState(false);
  const [banner, setBanner]       = useState(null);

  const isEditing = editingId !== null || creating;
  const editing = editingId ? guides.find(g => g.id === editingId) : null;

  const showBanner = (text) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 3500);
  };

  const handleSave = (saved) => {
    if (creating) {
      const id = `guide-${Date.now()}`;
      setGuides(prev => [...prev, { ...saved, id, updatedAt: new Date().toISOString() }]);
      showBanner(`Created "${saved.title}".`);
    } else {
      setGuides(prev => prev.map(g => g.id === editingId ? { ...saved, id: editingId, updatedAt: new Date().toISOString() } : g));
      showBanner(`Saved "${saved.title}".`);
    }
    setEditingId(null);
    setCreating(false);
  };

  const handleDelete = () => {
    if (!editingId) return;
    const target = guides.find(g => g.id === editingId);
    if (!target) return;
    if (!confirm(`Delete the guide card for "${target.title}"? This can't be undone.`)) return;
    setGuides(prev => prev.filter(g => g.id !== editingId));
    setEditingId(null);
    showBanner(`Deleted "${target.title}".`);
  };

  // ─────────────────── Edit view ───────────────────
  if (isEditing) {
    return (
      <div style={{ padding: "24px 28px", color: tk.text }}>
        {banner && <Banner banner={banner} tk={tk} />}
        <GuideEditor
          tk={tk}
          initial={editing || { title: "", purpose: "", filmingTips: "", exampleScript: "", exampleAssets: [] }}
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
            {guides.length} card{guides.length === 1 ? "" : "s"}. These guide cards appear in clients' "+ Add New Campaign" wizard.
          </div>
        </div>
        <button
          onClick={() => { setCreating(true); setEditingId(null); }}
          style={{
            padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >+ New guide card</button>
      </div>

      {guides.length === 0 ? (
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
            const isComplete = g.purpose && g.filmingTips && g.exampleScript;
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

                {/* Asset thumbnails */}
                {g.exampleAssets && g.exampleAssets.length > 0 ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    {g.exampleAssets.slice(0, 4).map((url, i) => (
                      <img key={i} src={url} alt="" style={{
                        width: 42, height: 42, borderRadius: 6, objectFit: "cover",
                        border: `1px solid ${tk.border}`,
                      }} />
                    ))}
                    {g.exampleAssets.length > 4 && (
                      <div style={{
                        width: 42, height: 42, borderRadius: 6, border: `1px solid ${tk.border}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: tk.textMute, fontSize: 11, fontWeight: 600,
                      }}>+{g.exampleAssets.length - 4}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: tk.textMute, fontStyle: "italic" }}>No example assets</div>
                )}
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
  const [title, setTitle]     = useState(initial.title || "");
  const [purpose, setPurpose] = useState(initial.purpose || "");
  const [tips, setTips]       = useState(initial.filmingTips || "");
  const [script, setScript]   = useState(initial.exampleScript || "");
  const [assets, setAssets]   = useState(initial.exampleAssets || []);
  const [error, setError]     = useState("");
  const fileInputRef = useRef(null);

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tk.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = {
    width: "100%", padding: "10px 12px", marginBottom: 18,
    background: tk.bg, border: `1px solid ${tk.border}`, borderRadius: 8,
    color: tk.text, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
  };
  const textareaStyle = { ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.5 };

  const addFiles = (filesList) => {
    const incoming = Array.from(filesList || []);
    if (!incoming.length) return;
    const urls = incoming.map(f => URL.createObjectURL(f));
    setAssets(prev => [...prev, ...urls]);
  };

  const removeAsset = (idx) => {
    setAssets(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    setError("");
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    onSave({
      title: title.trim(),
      purpose: purpose.trim(),
      filmingTips: tips.trim(),
      exampleScript: script.trim(),
      exampleAssets: assets,
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

      <label style={labelStyle}>Example assets</label>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 8, marginBottom: 12,
      }}>
        {assets.map((url, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img src={url} alt="" style={{
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
            cursor: "pointer", color: tk.textMute,
            fontSize: 13, gap: 4,
            transition: "border-color 0.15s ease, color 0.15s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = tk.accent; e.currentTarget.style.color = tk.accent; }}
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
          style={{ display: "none" }}
          onChange={e => { addFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ""; }}
        />
      </div>
      <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 22 }}>
        {assets.length} asset{assets.length === 1 ? "" : "s"} · Clients see these as examples when picking this offer.
      </div>

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
          <button onClick={handleSave} style={{
            padding: "10px 22px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13,
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
