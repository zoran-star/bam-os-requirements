import StatusPill from "./StatusPill";

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

// One ticket in a lane queue: neutral academy-initials avatar (house v1.6
// avatar chip) + title/sub + status pill + owner chip + age. Clickable when
// onClick is passed (C2/C3 open the TicketDrawer from here).
export default function QueueRow({ academy, title, sub, status, owner, age, onClick, dark = true }) {
  const interactive = typeof onClick === "function";
  return (
    <div
      className={`v2r-row${interactive ? " v2r-row-click" : ""}`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
    >
      <div className="v2r-avatar" title={academy}>{initials(academy)}</div>
      <div className="v2r-row-main">
        <div className="v2r-row-title">{title}</div>
        {sub && <div className="v2r-row-sub">{sub}</div>}
      </div>
      <StatusPill status={status} dark={dark} />
      <span className={`v2r-owner${owner ? "" : " v2r-owner-none"}`}>{owner || "Unassigned"}</span>
      {age != null && <span className="v2r-row-age">{age}</span>}
    </div>
  );
}
