import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";

const STORAGE_BUCKET = "ticket-files";
const STORAGE_FOLDER = "guide-cards";

export default function ContentView({ tokens: tk, dark, me, session }) {
  const [mainTab, setMainTab]     = useState("tickets"); // tickets | guides
  const [guides, setGuides]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [banner, setBanner]       = useState(null);
  const [error, setError]         = useState("");

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

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>§ Content · Guides</div>
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

    // Concurrency-limited upload. Browser network gets messy if a user drops
    // 20+ files at once. Cap at 3 in flight; sequential batches.
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
        const results = await Promise.all(batch.map(uploadOne));
        uploads.push(...results);
      }
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
  const [subTab, setSubTab] = useState("active"); // active | client-dependent | completed
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [banner, setBanner] = useState(null);

  const showBanner = (text) => { setBanner(text); setTimeout(() => setBanner(null), 3500); };

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
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json.ticket;
  }

  // Filter rows by sub-tab; sort oldest first per spec
  const active     = tickets.filter(t => t.status === "active");
  const clientDep  = tickets.filter(t => t.status === "client-dependent");
  const completed  = tickets.filter(t => t.status === "completed" || t.status === "cancelled");
  const visible =
    subTab === "active"           ? active
    : subTab === "client-dependent" ? clientDep
                                    : completed;

  const selected = selectedId ? tickets.find(t => t.id === selectedId) : null;

  // ─────────────────── Detail view ───────────────────
  if (selected) {
    return (
      <ContentTicketDetail
        tk={tk}
        session={session}
        ticket={selected}
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

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>§ Content · Tickets</div>
        <div style={{ fontSize: 28, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em" }}>Tickets queue</div>
        <div style={{ fontSize: 13, color: tk.textSub, marginTop: 6 }}>
          Raw assets submitted by clients. Make the creative, upload it, then click "Send to Marketing".
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}`, marginBottom: 18, overflowX: "auto" }}>
        <SubTab label={`Active (${active.length})`}             active={subTab === "active"}            onClick={() => setSubTab("active")}            tk={tk} />
        <SubTab label={`Client Dependent (${clientDep.length})`} active={subTab === "client-dependent"} onClick={() => setSubTab("client-dependent")} tk={tk} red={clientDep.length > 0} />
        <SubTab label={`Completed (${completed.length})`}        active={subTab === "completed"}         onClick={() => setSubTab("completed")}         tk={tk} />
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 1.5fr 0.8fr 1fr",
        gap: 16,
        padding: "8px 16px",
        fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase",
      }}>
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
          const dateStr = t.submitted_at ? new Date(t.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
          return (
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.5fr 0.8fr 1fr",
                gap: 16,
                padding: "14px 16px",
                borderBottom: `1px solid ${tk.borderSoft || tk.border}`,
                cursor: "pointer",
                alignItems: "center",
                transition: "background 0.12s ease",
              }}
              onMouseEnter={e => e.currentTarget.style.background = tk.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontWeight: 500, color: tk.text, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontFamily: "monospace", fontSize: 10, letterSpacing: "0.12em",
                  color: tk.textMute, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.04)", border: `1px solid ${tk.border}`,
                }}>{ctkCode(t.id)}</span>
                <span>{academyName}</span>
              </div>
              <div style={{ color: tk.textSub, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewNotes}</div>
              <div style={{ color: tk.textSub, fontSize: 13 }}>
                <span style={{ marginRight: 6 }}>{meta.icon}</span>{meta.label}
              </div>
              <div style={{ color: tk.textMute, fontSize: 12, fontFamily: "monospace", letterSpacing: "0.05em", textAlign: "right" }}>{dateStr}</div>
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
function ContentTicketDetail({ tk, session, ticket, onBack, onRefetch, patchTicket, showBanner }) {
  const [finalsToUpload, setFinalsToUpload] = useState([]); // local File objects
  const [uploading, setUploading] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendNotes, setSendNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const meta = TYPE_META_CT[ticket.type] || { icon: "•", label: ticket.type };
  const academyName = ticket.client?.business_name || "—";

  const finalsExisting = Array.isArray(ticket.final_files) ? ticket.final_files : [];

  // ── Upload selected finals to Supabase Storage and persist on ticket ──
  async function commitFinals() {
    if (!finalsToUpload.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of finalsToUpload) {
        const uid = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${TICKET_STORAGE_FOLDER}/${ticket.id}/${uid}-${safe}`;
        const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
        });
        if (upErr) throw new Error(upErr.message);
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        uploaded.push({ name: file.name, url: urlData.publicUrl, size: file.size || 0, mime: file.type || "" });
      }
      await patchTicket(ticket.id, { action: "upload-final", final_files: uploaded });
      setFinalsToUpload([]);
      await onRefetch();
      showBanner(`Uploaded ${uploaded.length} final file${uploaded.length === 1 ? "" : "s"}.`);
    } catch (e) {
      alert("Upload failed: " + e.message);
    } finally {
      setUploading(false);
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
          <div style={{ fontSize: 24, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em" }}>
            {meta.icon}  {meta.label}{ticket.type === "mixed" ? " bundle" : ""}
          </div>
          <div style={{ fontSize: 13, color: tk.textSub, marginTop: 4 }}>
            {academyName} · Submitted {ticket.submitted_at ? new Date(ticket.submitted_at).toLocaleString() : "—"}
            {ctkLastActivityIso(ticket) ? ` · Last activity ${ctkFormatRelative(ctkLastActivityIso(ticket))}` : ""}
          </div>
        </div>
        <StatusBadge ticket={ticket} tk={tk} />
      </div>

      {/* Client inputs */}
      <SectionLabel tk={tk}>What the client submitted</SectionLabel>
      <Card tk={tk} style={{ marginBottom: 22 }}>
        <ClientInputs ticket={ticket} tk={tk} />
      </Card>

      {/* Finals (current + new upload) */}
      <SectionLabel tk={tk}>Finals</SectionLabel>
      <Card tk={tk} style={{ marginBottom: 22 }}>
        {finalsExisting.length === 0 ? (
          <div style={{ padding: 8, color: tk.textSub, fontSize: 13, fontStyle: "italic", marginBottom: 12 }}>
            No final creatives uploaded yet.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
            {finalsExisting.map((f, i) => <FilePreviewTile key={i} file={f} tk={tk} />)}
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

        <div style={{ display: "flex", gap: 10 }}>
          <label htmlFor="finals-input" style={{
            padding: "10px 18px", background: "transparent",
            border: `1.5px dashed ${tk.borderStr || tk.border}`, borderRadius: 8,
            color: tk.textMute, cursor: "pointer", fontSize: 13, fontWeight: 500,
          }}>+ Add final files</label>
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
          {finalsToUpload.length > 0 && (
            <button onClick={commitFinals} disabled={uploading} style={{
              padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
              border: 0, borderRadius: 8, fontWeight: 700, cursor: uploading ? "wait" : "pointer", fontSize: 13,
              opacity: uploading ? 0.6 : 1,
            }}>{uploading ? "Uploading…" : `Upload ${finalsToUpload.length} file${finalsToUpload.length === 1 ? "" : "s"}`}</button>
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
          <button onClick={() => setSendModalOpen(true)} disabled={busy || !finalsExisting.length} style={{
            background: tk.accent, color: "#0A0A0B", border: 0,
            padding: "10px 22px", borderRadius: 8,
            cursor: (busy || !finalsExisting.length) ? "not-allowed" : "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 700,
            opacity: (busy || !finalsExisting.length) ? 0.5 : 1,
          }}>📤  Send to Marketing</button>
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

function ClientInputs({ ticket, tk }) {
  const ctx = ticket.context || {};
  const raw = Array.isArray(ticket.raw_files) ? ticket.raw_files : [];
  const subCreatives = Array.isArray(ctx.creatives) ? ctx.creatives : null;

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
          {row("Source", <span><span style={{ color: tk.accent }}>📦 New campaign</span> · offer: <b>{ctx.offer || "—"}</b></span>)}
          {ctx.is_new_offer && row("New offer description", ctx.new_offer_description || "—")}
          {row("Monthly spend", <span style={{ color: tk.accent, fontWeight: 600 }}>{ctx.monthly_spend || "—"}</span>)}
          {row("Landing page", ctx.landing_page ? <a href={ctx.landing_page} target="_blank" rel="noreferrer" style={{ color: tk.accent, textDecoration: "none" }}>{ctx.landing_page} ↗</a> : <span style={{ color: tk.textMute }}>(default funnel)</span>)}
        </>
      )}
      {ctx.source === "add-creative" && row("Source", <span>Add-creative on <b>{ctx.campaign_title || "(unspecified)"}</b></span>)}
      {ctx.source === "marketing-revision" && row("Source", <span style={{ color: tk.red || "#ED7969" }}>↩ Revision requested by marketing</span>)}

      {subCreatives ? (
        <div style={{ padding: "10px 0" }}>
          <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>
            Creatives ({subCreatives.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {subCreatives.map((c, i) => (
              <div key={i} style={{
                padding: 14, background: "rgba(255,255,255,0.02)",
                border: `1px solid ${tk.borderSoft || tk.border}`, borderRadius: 8,
              }}>
                <div style={{ fontWeight: 600, color: tk.text, marginBottom: 8 }}>
                  Creative {i + 1} · {(TYPE_META_CT[c.type] || {}).label || c.type}
                </div>
                <div style={{ fontSize: 13, color: tk.text, marginBottom: 10, whiteSpace: "pre-wrap" }}>
                  {c.notes || <span style={{ color: tk.textMute, fontStyle: "italic" }}>(no notes)</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                  {(c.raw_files || []).map((f, fi) => <FilePreviewTile key={fi} file={f} tk={tk} compact />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {row("Notes", ticket.notes
            ? <span style={{ whiteSpace: "pre-wrap" }}>{ticket.notes}</span>
            : <span style={{ color: tk.textMute, fontStyle: "italic" }}>(no notes)</span>)}
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 10, color: tk.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>
              Raw files ({raw.length})
            </div>
            {raw.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {raw.map((f, i) => <FilePreviewTile key={i} file={f} tk={tk} />)}
              </div>
            ) : (
              <div style={{ color: tk.textMute, fontSize: 13, fontStyle: "italic" }}>None</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function FilePreviewTile({ file, tk, compact }) {
  const isImage = (file.mime || "").startsWith("image/");
  const isVideo = (file.mime || "").startsWith("video/");
  const icon = isImage ? "🖼" : isVideo ? "🎬" : "📄";
  return (
    <a href={file.url} target="_blank" rel="noreferrer" download={file.name} style={{
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
        <img src={file.url} alt={file.name} style={{
          width: "100%", aspectRatio: "1 / 1", objectFit: "cover",
          borderRadius: 4, background: tk.surfaceHov,
        }} />
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
      <div style={{ fontSize: 10, color: tk.accent, letterSpacing: "0.05em" }}>Download ↓</div>
    </a>
  );
}

function SectionLabel({ children, tk }) {
  return (
    <div style={{
      fontSize: 10, color: tk.textMute, letterSpacing: "0.22em",
      textTransform: "uppercase", marginBottom: 10,
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
