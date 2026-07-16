import { useEffect } from "react";
import { mlIsVideo, mlDownloadUrl } from "../lib/media";

// Fullscreen preview overlay. Videos get a native player (navigating to a raw
// .MOV URL makes Chrome download it; the <video> element plays it fine).
// Render as a SIBLING of any <a> tile, never inside it, or modal clicks navigate.
export default function MediaLightbox({ file, tk, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!file) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: "min(920px, 94vw)", background: tk.surface,
        border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: tk.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <span style={{ flex: 1 }} />
          <a href={mlDownloadUrl(file)} download={file.name} rel="noreferrer" style={{ fontSize: 11, color: tk.accent, textDecoration: "none", whiteSpace: "nowrap" }}>Download ↓</a>
          <button onClick={onClose} aria-label="Close preview" style={{
            border: "none", background: "transparent", color: tk.textSub, fontSize: 16, cursor: "pointer", padding: "0 2px", lineHeight: 1,
          }}>✕</button>
        </div>
        {mlIsVideo(file) ? (
          <video src={file.url} controls autoPlay playsInline style={{ display: "block", width: "min(880px, 90vw)", maxHeight: "76vh", background: "#000" }} />
        ) : (
          <img src={file.url} alt={file.name} style={{ display: "block", maxWidth: "min(880px, 90vw)", maxHeight: "76vh", objectFit: "contain", background: "#000" }} />
        )}
      </div>
    </div>
  );
}
