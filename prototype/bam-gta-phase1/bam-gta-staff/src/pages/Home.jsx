import { LEADS } from '../data/leads';
import { SESSION_TEMPLATES, SESSION_INSTANCES } from '../data/sessions';
import { STAFF, FAILED_PAYMENTS } from '../data/members';
import s from '../styles/shared.module.css';

// Today is Sunday April 13
const TODAY_SESSIONS = SESSION_TEMPLATES.filter(t => t.day === 'Sunday');

export default function Home() {
  const todayTrials = LEADS.filter(l => l.stage === 'booked_trial' && l.trialDate === '2026-04-13');
  const staffName = (id) => STAFF.find(s => s.id === id)?.name || '';

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Home</h1>
        <p className={s.pageDesc}>Sunday, April 13, 2026</p>
      </div>

      {/* Mark Today's Attendance */}
      {TODAY_SESSIONS.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-xl)' }}>
          {TODAY_SESSIONS.map(session => {
            const instance = SESSION_INSTANCES.find(si => si.templateId === session.id);
            return (
              <a
                key={session.id}
                href="#/sessions"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--sp-lg) var(--sp-xl)',
                  background: 'linear-gradient(135deg, rgba(200,168,78,0.08), rgba(200,168,78,0.02))',
                  border: '2px solid rgba(200,168,78,0.2)',
                  borderRadius: 'var(--r-md)',
                  textDecoration: 'none',
                  color: 'var(--tp)',
                  cursor: 'pointer',
                  transition: 'all 140ms var(--es)',
                  marginBottom: 'var(--sp-sm)',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>{session.name}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginTop: 2 }}>
                    {session.startTime} - {session.endTime} | {instance ? `${instance.booked} booked` : '0 booked'}
                  </div>
                </div>
                <div style={{
                  padding: '10px 20px', background: 'var(--gold)', color: '#fff', borderRadius: 'var(--r-sm)',
                  fontWeight: 700, fontSize: 'var(--fs-md)', whiteSpace: 'nowrap',
                }}>
                  Mark Attendance
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* Today's Trials */}
      <div className={s.card}>
        <div className={s.flexBetween} style={{ marginBottom: 'var(--sp-lg)' }}>
          <h2 className={s.cardTitle} style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: todayTrials.length > 0 ? 'var(--green)' : 'var(--tm)' }} />
            Today's Trials
          </h2>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: todayTrials.length > 0 ? 'var(--gold)' : 'var(--tm)' }}>
            {todayTrials.length} {todayTrials.length === 1 ? 'trial' : 'trials'}
          </span>
        </div>

        {todayTrials.length === 0 ? (
          <div className={s.empty}><div className={s.emptyText}>No trials today</div></div>
        ) : (
          todayTrials.map(trial => (
            <div key={trial.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-md) 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{trial.childName}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                  Parent: {trial.parentName} | {trial.trialTime} - {trial.trialSession}
                </div>
                {trial.skillLevel && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 2 }}>
                    {trial.skillLevel} | {trial.daysAvailable} | Start: {trial.startTimeline}
                  </div>
                )}
              </div>
              <a href="#/pipeline" className={s.btn} style={{ fontSize: 'var(--fs-xs)', padding: '6px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Post-Trial Form
              </a>
            </div>
          ))
        )}
      </div>

      {/* Failed Payments */}
      {FAILED_PAYMENTS.length > 0 && (
        <div className={s.card} style={{ borderLeft: '3px solid var(--red)' }}>
          <div className={s.flexBetween} style={{ marginBottom: 'var(--sp-md)' }}>
            <h2 className={s.cardTitle} style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
              <svg width="16" height="16" fill="none" stroke="var(--red)" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Failed Payments
            </h2>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)', background: 'var(--redl)', padding: '3px 10px', borderRadius: 'var(--r-full)' }}>
              {FAILED_PAYMENTS.length}
            </span>
          </div>
          {FAILED_PAYMENTS.map(fp => (
            <div key={fp.memberId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-md) 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{fp.childName}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                  {fp.parentName} | {fp.failureReason} | {fp.daysSinceFailure} days ago
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: 'var(--red)' }}>${fp.amount}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{14 - fp.daysSinceFailure}d grace left</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
