import s from '../styles/shared.module.css';

// Admin approvals page
// Cancels and refunds require Admin approval
// Pause requests come here too for visibility

const PENDING_APPROVALS = [
  { id: 'pa1', type: 'Cancel', member: 'Lily Park', parent: 'James Park', requestedBy: 'Adrian', date: '2026-04-12', reason: 'Moving away', details: 'Parent requested cancel. Access until end of billing period (2026-04-28).' },
  { id: 'pa2', type: 'Refund', member: 'Jaylen Brooks', parent: 'Tom Brooks', requestedBy: 'Filip', date: '2026-04-11', reason: 'Session cancelled by staff', details: '$49.75 partial refund for cancelled Saturday session.' },
];

const RECENT_DECISIONS = [
  { id: 'rd1', type: 'Cancel', member: 'Lily Park', decision: 'Approved', decidedBy: 'Zoran', date: '2026-02-10' },
  { id: 'rd2', type: 'Refund', member: 'Mia Thompson', decision: 'Approved', decidedBy: 'Zoran', date: '2026-03-20', amount: '$25.00' },
  { id: 'rd3', type: 'Refund', member: 'Carlos Jr.', decision: 'Denied', decidedBy: 'Zoran', date: '2026-03-05', amount: '$199.00' },
];

export default function Admin() {
  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Admin Approvals</h1>
        <p className={s.pageDesc}>Cancellations and refunds that need your approval</p>
      </div>

      {/* Pending */}
      <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
        <h2 className={s.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Pending Approvals
          {PENDING_APPROVALS.length > 0 && (
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)', background: 'var(--redl)', padding: '2px 8px', borderRadius: 'var(--r-full)' }}>
              {PENDING_APPROVALS.length}
            </span>
          )}
        </h2>

        {PENDING_APPROVALS.length === 0 ? (
          <div className={s.empty}><div className={s.emptyText}>No pending approvals</div></div>
        ) : (
          PENDING_APPROVALS.map(item => (
            <div key={item.id} style={{ padding: 'var(--sp-lg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-md)', borderLeft: `3px solid ${item.type === 'Cancel' ? 'var(--red)' : 'var(--warn)'}` }}>
              <div className={s.flexBetween}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`${s.statusBadge} ${item.type === 'Cancel' ? s.statusFailed : s.statusPaused}`}>{item.type}</span>
                    <span style={{ fontWeight: 700 }}>{item.member}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginTop: 4 }}>
                    Parent: {item.parent} | Requested by {item.requestedBy} on {item.date}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginTop: 8 }}>
                <strong>Reason:</strong> {item.reason}
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginTop: 4 }}>{item.details}</div>
              <div style={{ display: 'flex', gap: 'var(--sp-sm)', marginTop: 'var(--sp-md)' }}>
                <button className={`${s.btn} ${s.btnGold}`}>Approve</button>
                <button className={`${s.btn} ${s.btnDanger}`}>Deny</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Decisions */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Recent Decisions</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Member</th>
              <th>Decision</th>
              <th>By</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_DECISIONS.map(d => (
              <tr key={d.id}>
                <td><span className={`${s.statusBadge} ${d.type === 'Cancel' ? s.statusFailed : s.statusPaused}`}>{d.type}</span></td>
                <td style={{ fontWeight: 600 }}>{d.member}</td>
                <td>
                  <span style={{ fontWeight: 600, color: d.decision === 'Approved' ? 'var(--green)' : 'var(--red)' }}>
                    {d.decision}
                  </span>
                </td>
                <td>{d.decidedBy}</td>
                <td>{d.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
