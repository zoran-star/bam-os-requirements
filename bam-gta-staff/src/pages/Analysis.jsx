import { LOST_TRIALS } from '../data/leads';
import { MEMBERS } from '../data/members';
import s from '../styles/shared.module.css';

const CANCELLED = MEMBERS.filter(m => m.status === 'cancelled');

export default function Analysis() {
  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Analysis</h1>
        <p className={s.pageDesc}>Lost trials, cancelled members, and insights</p>
      </div>

      {/* Cancelled Members */}
      <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
        <h2 className={s.cardTitle}>Cancelled Members ({CANCELLED.length})</h2>
        {CANCELLED.length === 0 ? (
          <div className={s.empty}><div className={s.emptyText}>No cancelled members</div></div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Parent</th>
                <th>Cancel Date</th>
                <th>Reason</th>
                <th>Sessions Attended</th>
              </tr>
            </thead>
            <tbody>
              {CANCELLED.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.childName}</td>
                  <td>{m.parentName}</td>
                  <td>{m.cancelDate || '-'}</td>
                  <td><span className={`${s.statusBadge} ${s.statusCancelled}`}>{m.cancelReason || '-'}</span></td>
                  <td>{m.sessionsAttended}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Lost Trials */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Lost Trials ({LOST_TRIALS.length})</h2>
        {LOST_TRIALS.length === 0 ? (
          <div className={s.empty}><div className={s.emptyText}>No lost trials</div></div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Parent</th>
                <th>Trial Date</th>
                <th>Reason</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {LOST_TRIALS.map(lt => (
                <tr key={lt.id}>
                  <td style={{ fontWeight: 600 }}>{lt.childName}</td>
                  <td>{lt.parentName}</td>
                  <td>{lt.trialDate}</td>
                  <td><span className={`${s.statusBadge} ${s.statusCancelled}`}>{lt.reason}</span></td>
                  <td style={{ color: 'var(--ts)', fontSize: 'var(--fs-sm)' }}>{lt.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
