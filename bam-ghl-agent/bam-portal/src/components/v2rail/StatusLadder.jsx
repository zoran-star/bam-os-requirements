import { Fragment } from "react";
import { V2_STATUSES } from "./StatusPill";

// The visible rungs of the ticket ladder: New > In progress > Needs client >
// Resolved. The current status gets the gold highlight, passed rungs read as
// done, upcoming rungs stay muted. `closed` renders every rung as done
// (pair it with a closed StatusPill in the detail view).
const RUNGS = ["new", "in_progress", "waiting_client", "resolved"];

export default function StatusLadder({ status = "new", dark = true }) {
  const idx = status === "closed" ? RUNGS.length : Math.max(0, RUNGS.indexOf(status));
  return (
    <div className="v2r-ladder">
      {RUNGS.map((key, i) => {
        const state = i < idx ? " is-done" : i === idx ? " is-current" : "";
        return (
          <Fragment key={key}>
            {i > 0 && (
              <span className="v2r-ladder-sep" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
              </span>
            )}
            <span className={`v2r-ladder-step${state}`}>{V2_STATUSES[key].label}</span>
          </Fragment>
        );
      })}
    </div>
  );
}
