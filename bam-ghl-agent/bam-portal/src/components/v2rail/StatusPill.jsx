// The locked 5-status ladder for V2 tickets (P3b spec,
// docs/zoran-icon-ticket-design.md): new -> in_progress -> waiting_client ->
// resolved -> closed. Staff labels below; waiting_client ("Needs client")
// carries the gold accent - it is the state staff act on.
//
// Colors come from the design-system tokens, which V2Page flips between dark
// and light via html[data-theme]; the `dark` prop is accepted for parity with
// the house component API.
export const V2_STATUSES = {
  new:            { label: "New" },
  in_progress:    { label: "In progress" },
  waiting_client: { label: "Needs client" },
  resolved:       { label: "Resolved" },
  closed:         { label: "Closed" },
};

export default function StatusPill({ status, dark = true }) {
  const key = V2_STATUSES[status] ? status : "new";
  return (
    <span className={`v2r-pill v2r-pill-${key}`}>
      <span className="v2r-pill-dot" />
      {V2_STATUSES[key].label}
    </span>
  );
}
