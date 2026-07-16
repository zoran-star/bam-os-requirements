// Shared media detection - accepts files shaped { url, name, mime?, type? }.
// Extension fallback matters: link-sourced files often arrive without a mime.
export function mlIsVideo(f) {
  return ((f?.mime || f?.type || "")).startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(f?.url || f?.name || "");
}
export function mlIsImage(f) {
  return ((f?.mime || f?.type || "")).startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)(\?|#|$)/i.test(f?.url || f?.name || "");
}
export function mlIsMedia(f) {
  return mlIsVideo(f) || mlIsImage(f);
}

// Force-download URL: Supabase public-storage URLs accept ?download=<name>,
// flipping the response to Content-Disposition: attachment. Without it,
// images open inline in a tab instead of downloading. Non-storage URLs
// pass through unchanged.
export function mlDownloadUrl(f) {
  if (typeof f?.url === "string" && f.url.includes("/storage/v1/object/public/")) {
    const sep = f.url.includes("?") ? "&" : "?";
    return `${f.url}${sep}download=${encodeURIComponent(f.name || "file")}`;
  }
  return f?.url;
}
