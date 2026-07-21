import { useEffect } from "react";

// House detail idiom: the right-side drawer (client-portal #cal-drawer
// pattern). Fixed overlay with blur, panel 460px max, full-width on mobile.
// Slots: `title` (or a custom `header` node), `children` = body, optional
// `footer` (pinned action row). Escape and overlay click both close.
export default function TicketDrawer({ open, onClose, title, header, footer, children, dark = true }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="v2r-drawer-overlay" onClick={onClose}>
      <aside className="v2r-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="v2r-drawer-head">
          <div className="v2r-drawer-head-slot">
            {header || (title ? <div className="v2r-drawer-title">{title}</div> : null)}
          </div>
          <button type="button" className="v2r-drawer-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="v2r-drawer-body">{children}</div>
        {footer && <div className="v2r-drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}
