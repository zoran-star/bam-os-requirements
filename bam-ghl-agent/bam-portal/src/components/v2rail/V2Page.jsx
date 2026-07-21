import { useEffect } from "react";
import "./v2rail.css";

// Shared root for the staff V2 ticket pages (Content V2 / Marketing V2).
// Owns the design-system wiring so the token import stays scoped to the
// V2 chunks: v2rail.css pulls in design-system/tokens.css (pure custom
// properties, no element rules - legacy views keep their inline JS tokens).

// Same font set + URL as bam-portal/public/client-portal.html.
const V2_FONTS_ID = "v2rail-fonts";
const V2_FONTS_HREF = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&family=Nunito:wght@700;800;900&display=swap";

export default function V2Page({ dark = true, title, sub, children }) {
  // tokens.css defaults to dark and flips light via html[data-theme="light"].
  // Nothing legacy reads this attribute (checked 2026-07-20), so syncing it
  // here only re-themes token-driven (V2) surfaces.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", dark ? "dark" : "light");
    return () => el.removeAttribute("data-theme");
  }, [dark]);

  // Load the V2 fonts once, on first V2 page mount.
  useEffect(() => {
    if (document.getElementById(V2_FONTS_ID)) return;
    const link = document.createElement("link");
    link.id = V2_FONTS_ID;
    link.rel = "stylesheet";
    link.href = V2_FONTS_HREF;
    document.head.appendChild(link);
  }, []);

  return (
    <div className="v2rail">
      <header className="v2r-page-head">
        <h1 className="v2r-page-title">{title}</h1>
        {sub && <p className="v2r-page-sub">{sub}</p>}
      </header>
      {children}
    </div>
  );
}

// House empty-state recipe: dashed box + icon at .3 opacity + 1-line muted
// message (+ optional CTA node).
export function V2EmptyState({ message, action = null }) {
  return (
    <div className="v2r-empty">
      <svg className="v2r-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      <div className="v2r-empty-msg">{message}</div>
      {action}
    </div>
  );
}
