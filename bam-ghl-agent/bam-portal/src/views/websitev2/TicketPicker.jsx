import { useEffect } from "react";
import StatusPill from "../../components/v2rail/StatusPill";
import { ageShort } from "../contentv2/utils";
import { pagePath, ticketAnnotations, dominantDevice, initials } from "./utils";

/* Ticket picker (locked frame 3c): the "N open" pill and the search results
   both render these rows. website_change rows load into the sandbox; every
   other systems-lane type (fix, billing_fix) shows with a chip and stays put
   (they are worked elsewhere, the sandbox only opens website changes). The chip
   is how a billing_fix mint ticket stays VISIBLE in the systems lane instead of
   landing where nobody looks. */
const CHIP_LABEL = { fix: "Fix", billing_fix: "Billing", data_fix: "Data", build_ask: "Build" };

function DeviceIcon({ device }) {
  return device === "mobile" ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="1.5" /><path d="M9 21h6M12 17v4" /></svg>
  );
}

// One picker row. Exported so the search-results dropdown reuses it.
export function PickerRow({ ticket, academy, active, onSelect }) {
  // Only website_change rows open in the sandbox; every other systems-lane type
  // is a read-only chip (worked elsewhere, but still rendered here).
  const isWebsite = ticket.type === "website_change";
  const chipLabel = CHIP_LABEL[ticket.type] || "Systems";
  const notes = ticketAnnotations(ticket);
  const path = pagePath(ticket.context?.page_url);
  const subParts = [];
  if (!isWebsite) subParts.push(ticket.title || `${chipLabel} request`);
  else {
    if (path) subParts.push(path);
    subParts.push(`${notes.length} change${notes.length === 1 ? "" : "s"}`);
  }
  return (
    <button
      type="button"
      className={`w2-prow${!isWebsite ? " is-fix" : ""}${active ? " is-active" : ""}`}
      onClick={isWebsite ? () => onSelect(ticket) : undefined}
      title={isWebsite ? undefined : `${chipLabel} tickets are worked on the Systems page`}
      tabIndex={isWebsite ? 0 : -1}
    >
      <span className="w2-prow-avatar">{initials(academy)}</span>
      <span className="w2-prow-main">
        <span className="w2-prow-academy">{academy}</span>
        <span className="w2-prow-sub">
          {isWebsite && path ? <span className="w2-prow-path">{path}</span> : null}
          {isWebsite && path ? " · " : null}
          {isWebsite ? `${notes.length} change${notes.length === 1 ? "" : "s"}` : subParts.join(" · ")}
        </span>
      </span>
      {isWebsite
        ? <span className="w2-prow-dev" title={dominantDevice(notes) === "mobile" ? "Noted on phone" : "Noted on computer"}><DeviceIcon device={dominantDevice(notes)} /></span>
        : <span className="w2-fixchip">{chipLabel}</span>}
      <StatusPill status={ticket.status} />
      <span className="w2-prow-age">{ageShort(ticket.updated_at || ticket.created_at)}</span>
    </button>
  );
}

export default function TicketPicker({ open, tickets, clientsMap, activeId, onSelect, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="w2-modal-overlay" onClick={onClose}>
      <div className="w2-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Pick a ticket">
        <div className="w2-modal-head">
          <div>
            <div className="w2-modal-title">Website tickets</div>
            <div className="w2-modal-sub">Pick a change request to open it in the sandbox.</div>
          </div>
          <button type="button" className="w2-modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="w2-modal-body">
          {tickets.length === 0 ? (
            <div className="w2-modal-empty">No website tickets right now.</div>
          ) : (
            tickets.map((t) => (
              <PickerRow
                key={t.id}
                ticket={t}
                academy={clientsMap[t.client_id] || "Academy"}
                active={t.id === activeId}
                onSelect={(picked) => { onSelect(picked); onClose?.(); }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
