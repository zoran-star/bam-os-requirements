// Pure read helpers for the marketing_ask intake blob. Every marketing_ask on
// the rail is one row (type marketing_ask); the SUB-KIND lives in intake.mode
// (or intake.kind for older shapes). The four handled kinds: post / budget /
// remove / campaign. Anything else falls back to a generic review body so no
// intake is ever silently dropped.

export const MODES = {
  post:     { label: "Post",         title: "Post the ad" },
  budget:   { label: "Budget",       title: "Budget change" },
  remove:   { label: "Remove",       title: "Remove creative" },
  campaign: { label: "New campaign", title: "New campaign" },
  generic:  { label: "Other",        title: "Marketing ask" },
};

// Resolve the sub-kind from the intake blob (explicit first, then inferred).
export function resolveMode(ticket) {
  const it = ticket?.intake || {};
  const raw = String(it.mode || it.kind || "").toLowerCase().trim();
  if (raw === "post") return "post";
  if (raw === "budget") return "budget";
  if (raw === "remove") return "remove";
  if (raw === "campaign" || raw === "new-campaign" || raw === "new_campaign") return "campaign";
  // Safety inference when mode is missing.
  if (Array.isArray(it.final_files) && it.final_files.length) return "post";
  if (it.new_spend != null || it.new_budget != null) return "budget";
  return "generic";
}

// Money-shaped values render as-is when already "$…", else prefix a hyphen-safe
// "$". Never emits an em dash or a currency placeholder.
export function money(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";
  if (s.startsWith("$")) return s;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s.replace(/[^0-9.]/g, "") !== "" ? `$${n}` : s;
}

// Campaign label for the queue sub-line + drawer.
export function campaignLabel(ticket) {
  const it = ticket?.intake || {};
  const ctx = ticket?.context || {};
  return (
    ctx.campaign ||
    it.campaign ||
    it.campaign_title ||
    it.campaign_name ||
    ""
  );
}

// final_files entry -> media kind. Falls back to the URL extension when mime
// is absent (spawned handoffs carry mime; older rows may not).
function extOf(f) {
  const u = String(f?.url || f?.name || "");
  const m = u.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}
export function isVideo(f) {
  const mime = String(f?.mime || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  return ["mp4", "mov", "webm", "m4v", "ogv"].includes(extOf(f));
}
export function isImage(f) {
  const mime = String(f?.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic"].includes(extOf(f));
}
export function isAudio(f) {
  const mime = String(f?.mime || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  return ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "weba", "opus", "amr"].includes(extOf(f));
}

// Short relative age for the queue row ("just now" -> "9h" -> "3d" -> "2w").
export function shortAge(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}

const OPEN_STATUSES = ["new", "in_progress", "waiting_client"];
export function isOpen(ticket) {
  return OPEN_STATUSES.includes(ticket?.status);
}

// Human-readable file size for the download row.
export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The staff roles that can own a marketing ticket (reassign target pool).
export const MARKETING_OWNER_ROLES = [
  "admin",
  "scaling_manager",
  "marketing_manager",
  "marketing_executor",
];
