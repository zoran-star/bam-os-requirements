import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase";

const STORAGE_BUCKET = "resources";              // private - gated file attachments
const BLOCK_IMAGE_BUCKET = "resource-block-images"; // public - decorative inline images
// Login-gated client portal base for shareable resource deep links.
const CLIENT_PORTAL_BASE = "https://portal.byanymeansbusiness.com/client-portal.html";

function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return Math.round(diff / min) + " min ago";
  if (diff < day) return Math.round(diff / hr) + " hr ago";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return Math.round(diff / day) + " days ago";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function ResourcesView({ tokens, dark, me }) {
  const tk = tokens;
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [editing, setEditing] = useState(null);       // resource being edited (or {} for new)
  const [showCats, setShowCats] = useState(false);
  const [converting, setConverting] = useState(null); // resource id being converted, or 'all'
  const [copiedId, setCopiedId] = useState(null);     // resource id whose link was just copied

  // Admins + the content/marketing team manage the library. Writes are enforced
  // server-side by RLS is_resource_editor(); this is just the UI gate.
  const isEditor = me && (me.role === "admin" || me.role === "marketing_manager" || me.role === "marketing_executor");

  // ─── Load resources + categories ───
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [resRes, catRes] = await Promise.all([
        supabase.from("resources").select("*, resource_files(*)").order("created_at", { ascending: false }),
        supabase.from("resource_categories").select("*").order("sort_order"),
      ]);
      if (resRes.error) throw resRes.error;
      if (catRes.error) throw catRes.error;
      setResources(resRes.data || []);
      setCategories(catRes.data || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const catById = useMemo(() => {
    const m = {};
    categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter(r => {
      if (filterCat !== "all" && r.category_id !== filterCat) return false;
      if (!q) return true;
      return (r.title || "").toLowerCase().includes(q)
          || (r.description || "").toLowerCase().includes(q);
    });
  }, [resources, search, filterCat]);

  // ─── Delete ───
  const handleDelete = async (resource) => {
    if (!window.confirm(`Delete "${resource.title}"? This removes all files. Cannot be undone.`)) return;
    try {
      // Best-effort storage cleanup first (RLS allows admin)
      const paths = (resource.resource_files || []).map(f => f.storage_path).filter(Boolean);
      if (paths.length) {
        await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      }
      const { error } = await supabase.from("resources").delete().eq("id", resource.id);
      if (error) throw error;
      await load();
    } catch (e) {
      alert("Delete failed: " + (e.message || String(e)));
    }
  };

  // ─── Share a login-gated link ───
  // The resources bucket is PRIVATE, so we never share a raw file URL. Instead
  // we share a deep link into the client portal; opening it requires the client
  // to be logged in (random public can't view). Works for every resource.
  const shareUrlFor = useCallback((r) => `${CLIENT_PORTAL_BASE}#resource=${r.id}`, []);

  const handleCopyLink = useCallback(async (r) => {
    const url = shareUrlFor(r);
    if (!url) { alert("Could not build a link for this resource."); return; }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(c => (c === r.id ? null : c)), 1600);
  }, [shareUrlFor]);

  // ─── Convert legacy PDF(s) → content blocks (AI) ───
  const isLegacyPdf = (r) =>
    (!Array.isArray(r.content_blocks) || r.content_blocks.length === 0) &&
    (r.resource_files || []).some((f) => (f.mime_type || "").includes("pdf"));

  const convertCall = async (action, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/resources/convert?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body || {}),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `${action} failed`);
    return j;
  };

  const handleConvert = async (r) => {
    setConverting(r.id); setError(null);
    try { await convertCall("convert", { resourceId: r.id }); await load(); }
    catch (e) { setError(`Convert failed: ${e.message}`); }
    finally { setConverting(null); }
  };

  const handleConvertAll = async () => {
    if (!window.confirm("Convert all legacy PDF resources into interactive pages? This uses AI and may take a minute.")) return;
    setConverting("all"); setError(null);
    let total = 0;
    try {
      let remaining = Infinity;
      while (remaining > 0) {
        const j = await convertCall("convert-all");
        total += j.converted || 0;
        remaining = j.remaining || 0;
        if ((j.converted || 0) === 0 && remaining > 0) {           // a batch all-failed → stop
          const f = (j.failed || [])[0];
          throw new Error(f ? `${f.title}: ${f.error}` : "some resources could not be converted");
        }
      }
      await load();
      if (total) setError(null);
    } catch (e) {
      setError(`Converted ${total}. Stopped: ${e.message}`);
      await load();
    } finally { setConverting(null); }
  };

  if (!isEditor) {
    return (
      <div style={{ padding: 40, color: tk.textSub }}>
        Resources is for admins and the content team. Your role: <strong>{me?.role || "unknown"}</strong>.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12, marginBottom: 20,
      }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 280 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources…"
            style={{
              flex: 1, padding: "10px 14px",
              background: tk.surface, border: `1px solid ${tk.borderMed}`,
              borderRadius: 8, color: tk.text, fontSize: 14, fontFamily: "inherit",
              outline: "none",
            }}
          />
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            style={{
              padding: "10px 14px", background: tk.surface, border: `1px solid ${tk.borderMed}`,
              borderRadius: 8, color: tk.text, fontSize: 14, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            <option value="all">All categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {resources.filter(isLegacyPdf).length > 0 && (
            <button onClick={handleConvertAll} disabled={!!converting} style={btnSecondary(tk)}
              title="Use AI to turn legacy PDF resources into interactive pages">
              {converting === "all"
                ? "Converting…"
                : `Convert ${resources.filter(isLegacyPdf).length} PDF${resources.filter(isLegacyPdf).length > 1 ? "s" : ""}`}
            </button>
          )}
          <button
            onClick={() => setShowCats(true)}
            style={btnSecondary(tk)}
          >Manage categories</button>
          <button
            onClick={() => setEditing({})}
            style={btnPrimary(tk)}
          >+ Add resource</button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12, marginBottom: 16, borderRadius: 8,
          background: tk.redSoft, color: tk.red, fontSize: 13,
          border: `1px solid ${tk.red}`,
        }}>{error}</div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: tk.textSub }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: 60, textAlign: "center", color: tk.textSub,
          background: tk.surface, border: `1px dashed ${tk.borderMed}`, borderRadius: 12,
        }}>
          {resources.length === 0
            ? "No resources yet. Click “+ Add resource” to publish one."
            : "No resources match your filters."}
        </div>
      ) : (
        <div style={{
          background: tk.surface, border: `1px solid ${tk.borderMed}`, borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 70px 110px 280px",
            gap: 0, padding: "12px 16px",
            borderBottom: `1px solid ${tk.borderMed}`,
            fontSize: 11, fontWeight: 600, color: tk.textMute, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <div>Title</div>
            <div>Category</div>
            <div>Files</div>
            <div>Added</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>

          {filtered.map(r => {
            const c = catById[r.category_id];
            const fileCount = (r.resource_files || []).length;
            return (
              <div key={r.id} style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 70px 110px 280px",
                gap: 0, padding: "14px 16px",
                borderBottom: `1px solid ${tk.border}`,
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tk.text, marginBottom: 2 }}>{r.title}</div>
                  {r.description && (
                    <div style={{
                      fontSize: 12, color: tk.textSub,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      maxWidth: 460,
                    }}>{r.description}</div>
                  )}
                </div>
                <div>
                  {c ? (
                    <span style={{
                      display: "inline-block", padding: "3px 9px", borderRadius: 999,
                      fontSize: 11, fontWeight: 600,
                      background: c.color + "22", color: c.color,
                      border: `1px solid ${c.color}55`,
                    }}>{c.name}</span>
                  ) : <span style={{ color: tk.textMute, fontSize: 12 }}>—</span>}
                </div>
                <div style={{ fontSize: 13, color: tk.textSub }}>{fileCount}</div>
                <div style={{ fontSize: 12, color: tk.textSub }}>{formatRelative(r.created_at)}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {shareUrlFor(r) && (
                    <button onClick={() => handleCopyLink(r)}
                      style={copiedId === r.id ? btnIconCopied(tk) : btnIcon(tk)}
                      title="Copy a link to send to clients (opens in their portal, login required)">
                      {copiedId === r.id ? "Copied!" : "Copy link"}
                    </button>
                  )}
                  {isLegacyPdf(r) && (
                    <button onClick={() => handleConvert(r)} disabled={!!converting} style={btnIcon(tk)}
                      title="Convert this PDF into an interactive page with AI">
                      {converting === r.id ? "…" : "Convert"}
                    </button>
                  )}
                  <button onClick={() => setEditing(r)} style={btnIcon(tk)} title="Edit">Edit</button>
                  <button onClick={() => handleDelete(r)} style={btnIconDanger(tk)} title="Delete">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {editing && (
        <ResourceFormModal
          tokens={tk}
          resource={editing.id ? editing : null}
          categories={categories}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {showCats && (
        <CategoryManagerModal
          tokens={tk}
          categories={categories}
          onClose={() => setShowCats(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Resource form modal — create or edit
// ─────────────────────────────────────────────────────────────────────
function ResourceFormModal({ tokens: tk, resource, categories, me, onClose, onSaved }) {
  const isEdit = !!resource;
  const [title, setTitle]             = useState(resource?.title || "");
  const [description, setDescription] = useState(resource?.description || "");
  const [categoryId, setCategoryId]   = useState(resource?.category_id || categories[0]?.id || "");
  const [existingFiles, setExistingFiles] = useState(resource?.resource_files || []);
  const [newFiles, setNewFiles]       = useState([]);   // File[] from input
  const [removeFileIds, setRemoveFileIds] = useState([]);
  const [contentBlocks, setContentBlocks] = useState(
    Array.isArray(resource?.content_blocks) ? resource.content_blocks : []
  );
  const [saving, setSaving]           = useState(false);
  const [progress, setProgress]       = useState("");
  const [err, setErr]                 = useState(null);

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    const maxBytes = 524_288_000; // 500 MB
    const tooBig = files.find(f => f.size > maxBytes);
    if (tooBig) {
      setErr(`"${tooBig.name}" is over 500 MB.`);
      return;
    }
    setErr(null);
    setNewFiles(prev => [...prev, ...files]);
    e.target.value = "";
  };

  const removeExisting = (fileId) => {
    setRemoveFileIds(prev => prev.includes(fileId) ? prev : [...prev, fileId]);
    setExistingFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const removeNew = (idx) => {
    setNewFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setErr(null);

    if (!title.trim()) return setErr("Title is required.");
    if (!categoryId)   return setErr("Pick a category.");
    if (!isEdit && newFiles.length === 0 && contentBlocks.length === 0) {
      return setErr("Add some content blocks or a file.");
    }

    setSaving(true);
    try {
      // 1. Insert/update the resource row
      let resourceId = resource?.id;
      if (isEdit) {
        const { error } = await supabase.from("resources").update({
          title: title.trim(),
          description: description.trim() || null,
          category_id: categoryId,
          content_blocks: contentBlocks,
        }).eq("id", resourceId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("resources").insert({
          title: title.trim(),
          description: description.trim() || null,
          category_id: categoryId,
          content_blocks: contentBlocks,
          created_by: me?.id || null,
        }).select().single();
        if (error) throw error;
        resourceId = data.id;
      }

      // 2. Remove flagged files (storage + DB)
      if (removeFileIds.length) {
        setProgress("Removing files…");
        const paths = (resource?.resource_files || [])
          .filter(f => removeFileIds.includes(f.id))
          .map(f => f.storage_path);
        if (paths.length) {
          await supabase.storage.from(STORAGE_BUCKET).remove(paths);
        }
        await supabase.from("resource_files").delete().in("id", removeFileIds);
      }

      // 3. Upload new files
      const startingSort = existingFiles.length;
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        setProgress(`Uploading ${i + 1}/${newFiles.length}: ${file.name}`);
        const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
        const path = `${resourceId}/${Date.now()}-${slugify(file.name.replace(ext, ""))}${ext}`;
        const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET)
          .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("resource_files").insert({
          resource_id: resourceId,
          filename: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          sort_order: startingSort + i,
        });
        if (insErr) throw insErr;
      }

      setProgress("");
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell tokens={tk} onClose={onClose} title={isEdit ? "Edit resource" : "Add resource"}>
      {err && (
        <div style={{
          padding: 12, marginBottom: 14, borderRadius: 8,
          background: tk.redSoft, color: tk.red, fontSize: 13,
          border: `1px solid ${tk.red}`,
        }}>{err}</div>
      )}

      <Field label="Title">
        <input
          type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Sales Playbook v3"
          style={inputStyle(tk)}
          disabled={saving}
        />
      </Field>

      <Field label="Category">
        <select
          value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
          style={inputStyle(tk)}
          disabled={saving}
        >
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label="Description">
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description shown on the tile and on the detail page."
          rows={4}
          style={{ ...inputStyle(tk), resize: "vertical", fontFamily: "inherit" }}
          disabled={saving}
        />
      </Field>

      <Field label="Content">
        <BlockEditor tk={tk} blocks={contentBlocks} setBlocks={setContentBlocks} disabled={saving} />
      </Field>

      <Field label={`Attachments (${existingFiles.length + newFiles.length})`}>
        <div style={{
          border: `1px dashed ${tk.borderStr}`, borderRadius: 8, padding: 14,
          background: tk.surfaceAlt,
        }}>
          {existingFiles.map(f => (
            <FileRow key={f.id} tk={tk}
              name={f.filename} sub={formatBytes(f.size_bytes)}
              onRemove={() => removeExisting(f.id)}
              disabled={saving}
            />
          ))}
          {newFiles.map((f, i) => (
            <FileRow key={i} tk={tk}
              name={f.name} sub={`${formatBytes(f.size)} · new`}
              onRemove={() => removeNew(i)}
              disabled={saving}
            />
          ))}
          {existingFiles.length + newFiles.length === 0 && (
            <div style={{ color: tk.textMute, fontSize: 13, marginBottom: 12 }}>No files yet.</div>
          )}
          <label style={{
            display: "inline-block", padding: "8px 14px",
            background: tk.surface, border: `1px solid ${tk.borderMed}`, borderRadius: 6,
            cursor: saving ? "not-allowed" : "pointer", fontSize: 13, color: tk.text, fontWeight: 500,
          }}>
            + Add file(s)
            <input type="file" multiple onChange={onPickFiles} style={{ display: "none" }} disabled={saving} />
          </label>
          <div style={{ marginTop: 8, fontSize: 11, color: tk.textMute }}>Max 500 MB per file.</div>
        </div>
      </Field>

      {progress && (
        <div style={{ color: tk.textSub, fontSize: 13, marginBottom: 10 }}>{progress}</div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={btnSecondary(tk)} disabled={saving}>Cancel</button>
        <button onClick={save} style={btnPrimary(tk)} disabled={saving}>
          {saving ? "Saving…" : (isEdit ? "Save changes" : "Publish")}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Category manager modal
// ─────────────────────────────────────────────────────────────────────
function CategoryManagerModal({ tokens: tk, categories, onClose, onChanged }) {
  const [items, setItems] = useState(categories);
  const [newName, setNewName]   = useState("");
  const [newColor, setNewColor] = useState("#E8C547");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  useEffect(() => { setItems(categories); }, [categories]);

  const addCategory = async () => {
    if (!newName.trim()) return;
    setBusy(true); setErr(null);
    try {
      const slug = slugify(newName);
      const sort = (items[items.length - 1]?.sort_order || 0) + 1;
      const { error } = await supabase.from("resource_categories").insert({
        name: newName.trim(), slug, color: newColor, sort_order: sort,
      });
      if (error) throw error;
      setNewName(""); setNewColor("#E8C547");
      onChanged();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateColor = async (id, color) => {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("resource_categories").update({ color }).eq("id", id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // audience: 'all' = full/scaling clients only; 'content' = content-only
  // clients see it too (RLS enforces this server-side).
  const toggleAudience = async (cat) => {
    setBusy(true); setErr(null);
    try {
      const next = cat.audience === "content" ? "all" : "content";
      const { error } = await supabase.from("resource_categories").update({ audience: next }).eq("id", cat.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"? Only works if no resources use it.`)) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("resource_categories").delete().eq("id", cat.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr("Couldn't delete — likely still in use by a resource. (" + (e.message || e) + ")");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell tokens={tk} onClose={onClose} title="Manage categories">
      {err && (
        <div style={{
          padding: 12, marginBottom: 14, borderRadius: 8,
          background: tk.redSoft, color: tk.red, fontSize: 13,
          border: `1px solid ${tk.red}`,
        }}>{err}</div>
      )}

      <div style={{ marginBottom: 18 }}>
        {items.map(c => (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderBottom: `1px solid ${tk.border}`,
          }}>
            <input
              type="color" value={c.color}
              onChange={(e) => updateColor(c.id, e.target.value)}
              style={{ width: 30, height: 28, border: "none", background: "transparent", cursor: "pointer" }}
              disabled={busy}
            />
            <div style={{ flex: 1, color: tk.text, fontSize: 14 }}>{c.name}</div>
            <button
              onClick={() => toggleAudience(c)}
              disabled={busy}
              title={c.audience === "content"
                ? "Content-only clients CAN see this category. Click to restrict to full clients."
                : "Hidden from content-only clients. Click to make it visible to them too."}
              style={{
                background: c.audience === "content" ? `${tk.green}1A` : "transparent",
                border: `1px solid ${c.audience === "content" ? tk.green : tk.border}`,
                color: c.audience === "content" ? tk.green : tk.textMute,
                fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
              }}>
              {c.audience === "content" ? "Content clients: visible" : "Content clients: hidden"}
            </button>
            <button onClick={() => deleteCategory(c)} style={btnIconDanger(tk)} disabled={busy}>Delete</button>
          </div>
        ))}
      </div>

      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        padding: 12, background: tk.surfaceAlt, borderRadius: 8,
      }}>
        <input
          type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}
          style={{ width: 30, height: 28, border: "none", background: "transparent", cursor: "pointer" }}
          disabled={busy}
        />
        <input
          type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          style={{ ...inputStyle(tk), flex: 1 }}
          disabled={busy}
        />
        <button onClick={addCategory} style={btnPrimary(tk)} disabled={busy || !newName.trim()}>Add</button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={btnSecondary(tk)}>Done</button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small primitives
// ─────────────────────────────────────────────────────────────────────
function ModalShell({ tokens: tk, onClose, title, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "60px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 600,
          background: tk.surface, border: `1px solid ${tk.borderMed}`, borderRadius: 14,
          padding: 24,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: tk.text }}>{title}</div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: tk.textSub,
            cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: "#8E8E93", marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  );
}

function FileRow({ tk, name, sub, onRemove, disabled }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 0", borderBottom: `1px solid ${tk.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: tk.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ color: tk.textMute, fontSize: 11 }}>{sub}</div>
      </div>
      <button onClick={onRemove} style={btnIconDanger(tk)} disabled={disabled}>Remove</button>
    </div>
  );
}

function inputStyle(tk) {
  return {
    width: "100%", padding: "10px 12px",
    background: tk.surfaceAlt, border: `1px solid ${tk.borderMed}`,
    borderRadius: 8, color: tk.text, fontSize: 14, fontFamily: "inherit",
    outline: "none",
  };
}

function btnPrimary(tk) {
  return {
    padding: "9px 16px", border: 0, borderRadius: 8,
    background: tk.accent, color: "#0A0A0B",
    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
}

function btnSecondary(tk) {
  return {
    padding: "9px 16px", borderRadius: 8,
    background: tk.surface, border: `1px solid ${tk.borderMed}`,
    color: tk.text, fontSize: 13, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
  };
}

function btnIcon(tk) {
  return {
    padding: "6px 10px", borderRadius: 6,
    background: "transparent", border: `1px solid ${tk.border}`,
    color: tk.textSub, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  };
}

function btnIconCopied(tk) {
  return {
    ...btnIcon(tk),
    background: (tk.accent || "#D4B65C") + "22",
    border: `1px solid ${tk.accent || "#D4B65C"}`,
    color: tk.accent || "#D4B65C",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Content block editor — authors the interactive resource page.
// Block shapes match the client renderer in client-portal.html
// (_renderResourceBlock). Stored on resources.content_blocks (jsonb).
// ─────────────────────────────────────────────────────────────────────
const BLOCK_TYPES = [
  { type: "heading",   label: "Heading" },
  { type: "text",      label: "Text" },
  { type: "callout",   label: "Callout" },
  { type: "checklist", label: "Checklist" },
  { type: "accordion", label: "Accordion" },
  { type: "image",     label: "Image" },
  { type: "video",     label: "Video" },
  { type: "divider",   label: "Divider" },
];

function blockDefault(type) {
  switch (type) {
    case "callout":   return { type, variant: "tip", text: "" };
    case "checklist": return { type, title: "", items: [] };
    case "accordion": return { type, title: "", text: "" };
    case "image":     return { type, url: "", caption: "" };
    case "video":     return { type, url: "", caption: "" };
    case "divider":   return { type };
    default:          return { type, text: "" }; // heading, text
  }
}

function BlockEditor({ tk, blocks, setBlocks, disabled }) {
  const add    = (type) => setBlocks([...blocks, blockDefault(type)]);
  const update = (i, patch) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i) => setBlocks(blocks.filter((_, j) => j !== i));
  const move   = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const copy = blocks.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setBlocks(copy);
  };
  return (
    <div style={{ border: `1px dashed ${tk.borderStr}`, borderRadius: 8, padding: 12, background: tk.surfaceAlt }}>
      {blocks.length === 0 && (
        <div style={{ color: tk.textMute, fontSize: 13, marginBottom: 10 }}>
          No content yet — add blocks to build a branded, interactive page.
        </div>
      )}
      {blocks.map((b, i) => (
        <BlockCard key={i} tk={tk} block={b} idx={i} total={blocks.length} disabled={disabled}
          onUpdate={(patch) => update(i, patch)} onRemove={() => remove(i)} onMove={(d) => move(i, d)} />
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: blocks.length ? 12 : 0 }}>
        {BLOCK_TYPES.map((t) => (
          <button key={t.type} type="button" onClick={() => add(t.type)} disabled={disabled} style={btnIcon(tk)}>
            + {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BlockCard({ tk, block: b, idx, total, disabled, onUpdate, onRemove, onMove }) {
  const ti = inputStyle(tk);
  const ta = { ...inputStyle(tk), resize: "vertical", fontFamily: "inherit", minHeight: 64 };
  return (
    <div style={{ border: `1px solid ${tk.borderMed}`, borderRadius: 8, padding: 12, marginBottom: 8, background: tk.surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: tk.textMute, flex: 1 }}>{b.type}</span>
        <button type="button" onClick={() => onMove(-1)} disabled={disabled || idx === 0} style={btnIcon(tk)}>↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={disabled || idx === total - 1} style={btnIcon(tk)}>↓</button>
        <button type="button" onClick={onRemove} disabled={disabled} style={btnIconDanger(tk)}>Remove</button>
      </div>
      {b.type === "heading" && (
        <input style={ti} placeholder="Heading text" value={b.text || ""} onChange={(e) => onUpdate({ text: e.target.value })} disabled={disabled} />
      )}
      {b.type === "text" && (
        <textarea style={ta} placeholder="Text — **bold**, *italic*, [link](url), and lines starting with '- ' become bullets." value={b.text || ""} onChange={(e) => onUpdate({ text: e.target.value })} disabled={disabled} />
      )}
      {b.type === "callout" && (
        <>
          <select style={{ ...ti, marginBottom: 8 }} value={b.variant || "tip"} onChange={(e) => onUpdate({ variant: e.target.value })} disabled={disabled}>
            <option value="tip">Tip 💡</option>
            <option value="warn">Warning ⚠️</option>
            <option value="info">Info ℹ️</option>
          </select>
          <textarea style={ta} placeholder="Callout text" value={b.text || ""} onChange={(e) => onUpdate({ text: e.target.value })} disabled={disabled} />
        </>
      )}
      {b.type === "checklist" && (
        <>
          <input style={{ ...ti, marginBottom: 8 }} placeholder="Checklist title (optional)" value={b.title || ""} onChange={(e) => onUpdate({ title: e.target.value })} disabled={disabled} />
          <textarea style={ta} placeholder="One item per line" value={(b.items || []).join("\n")} onChange={(e) => onUpdate({ items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} disabled={disabled} />
        </>
      )}
      {b.type === "accordion" && (
        <>
          <input style={{ ...ti, marginBottom: 8 }} placeholder="Section title (the part you tap)" value={b.title || ""} onChange={(e) => onUpdate({ title: e.target.value })} disabled={disabled} />
          <textarea style={ta} placeholder="Hidden content — **bold**, *italic*, - bullets" value={b.text || ""} onChange={(e) => onUpdate({ text: e.target.value })} disabled={disabled} />
        </>
      )}
      {b.type === "image" && (
        <>
          <input style={{ ...ti, marginBottom: 8 }} placeholder="Image URL" value={b.url || ""} onChange={(e) => onUpdate({ url: e.target.value })} disabled={disabled} />
          <BlockImageUpload tk={tk} disabled={disabled} onUploaded={(url) => onUpdate({ url })} />
          <input style={{ ...ti, marginTop: 8 }} placeholder="Caption (optional)" value={b.caption || ""} onChange={(e) => onUpdate({ caption: e.target.value })} disabled={disabled} />
        </>
      )}
      {b.type === "video" && (
        <>
          <input style={{ ...ti, marginBottom: 8 }} placeholder="Video URL (mp4, YouTube, or Vimeo)" value={b.url || ""} onChange={(e) => onUpdate({ url: e.target.value })} disabled={disabled} />
          <input style={ti} placeholder="Caption (optional)" value={b.caption || ""} onChange={(e) => onUpdate({ caption: e.target.value })} disabled={disabled} />
        </>
      )}
      {b.type === "divider" && (
        <div style={{ color: tk.textMute, fontSize: 12 }}>A horizontal divider line.</div>
      )}
    </div>
  );
}

function BlockImageUpload({ tk, disabled, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    setBusy(true);
    try {
      const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      const path = `${Date.now()}-${slugify(file.name.replace(ext, ""))}${ext}`;
      // Decorative inline images live in a PUBLIC bucket (not the gated
      // `resources` bucket) so they render via a stable URL for everyone.
      const { error } = await supabase.storage.from(BLOCK_IMAGE_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (error) throw error;
      const { data } = supabase.storage.from(BLOCK_IMAGE_BUCKET).getPublicUrl(path);
      onUploaded(data.publicUrl);
    } catch (err) {
      alert("Image upload failed: " + (err.message || err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <label style={{ display: "inline-block", padding: "7px 12px", background: tk.surface, border: `1px solid ${tk.borderMed}`, borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, color: tk.text }}>
      {busy ? "Uploading…" : "Or upload an image"}
      <input type="file" accept="image/*" onChange={pick} style={{ display: "none" }} disabled={disabled || busy} />
    </label>
  );
}

function btnIconDanger(tk) {
  return {
    padding: "6px 10px", borderRadius: 6,
    background: "transparent", border: `1px solid ${tk.border}`,
    color: tk.red, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
