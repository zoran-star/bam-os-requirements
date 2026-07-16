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
