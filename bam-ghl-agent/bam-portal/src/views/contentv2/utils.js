import { supabase } from "../../lib/supabase";

// Shared helpers for the staff Content V2 page (queue + drawer). Kept tiny and
// pure so the view and the drawer can both lean on them.

// Compact "time since" for queue rows: now / 5m / 3h / 2d / 4w / 3mo.
export function ageShort(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h";
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + "d";
  const wks = Math.floor(days / 7);
  if (wks < 5) return wks + "w";
  const mos = Math.floor(days / 30);
  return mos + "mo";
}

// Human file size for the finals + attachment lists.
export function fmtBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = num;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x < 10 && i > 0 ? x.toFixed(1) : Math.round(x)} ${units[i]}`;
}

// "Jul 20, 3:14 PM" style timestamp for thread rows.
export function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Resolve a client_assets row to a viewable URL: external link wins, else the
// public URL of the stored object in the client-assets bucket.
export function assetPublicUrl(a) {
  if (!a) return null;
  if (a.link_url) return a.link_url;
  if (a.storage_path) {
    try {
      const { data } = supabase.storage.from("client-assets").getPublicUrl(a.storage_path);
      return data?.publicUrl || null;
    } catch (_) { return null; }
  }
  return null;
}

export function isVideo(mime, name) {
  if ((mime || "").toLowerCase().startsWith("video/")) return true;
  return /\.(mp4|mov|webm|m4v|avi)$/i.test(name || "");
}

export function isImage(mime, name) {
  if ((mime || "").toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name || "");
}

export function isAudio(mime, name) {
  if ((mime || "").toLowerCase().startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|ogg|oga|flac|weba|3gp|amr|opus)$/i.test(name || "");
}

// intake.mode -> short human label ("New ad" / "Edit" / "Replace").
export function modeLabel(mode) {
  if (mode === "edit") return "Edit";
  if (mode === "replace") return "Replace";
  if (mode === "new") return "New ad";
  return "";
}

// The three request-from-client kinds, in display order.
export const REQUEST_KINDS = [
  { id: "reply", label: "Reply" },
  { id: "upload", label: "Upload" },
  { id: "approval", label: "Approval" },
];
