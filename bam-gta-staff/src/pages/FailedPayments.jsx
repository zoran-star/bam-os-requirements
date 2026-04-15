import { FAILED_PAYMENTS, MEMBERS } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #7: Failed Payments
// 2-week grace period, then credit refresh freezes
// One dunning SMS on Day 0, staff follows up manually
// Entire team notified, auto-resolve on Stripe success
// Dedicated Failed Payments view

export default function FailedPayments() {
  const allFailed = FAILED_PAYMENTS;
  const member = (id) => MEMBERS.find(m => m.id === id);

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Failed Payments</h1>
        <p className={s.pageDesc}>2-week grace period with full access, then credit refresh freezes</p>
      </div>

      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statValue} style={{ color: 'var(--red)' }}>{allFailed.length}</div>
          <div className={s.statLabel}>Active Failures</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>${allFailed.reduce((a, f) => a + f.amount, 0)}</div>
          <div className={s.statLabel}>Outstanding</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{allFailed.filter(f => f.smsSent).length}/{allFailed.length}</div>
          <div className={s.statLabel}>SMS Sent</div>
        </div>
      </div>

      {allFailed.length === 0 ? (
        <div className={s.card}>
          <div className={s.empty}>
            <div style={{ fontSize: 32, marginBottom: 'var(--sp-lg)', opacity: 0.3 }}>
              <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div className={s.emptyText}>No failed payments - all clear!</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
          {allFailed.map(fp => {
            const m = member(fp.memberId);
            const daysLeft = 14 - fp.daysSinceFailure;
            const urgent = daysLeft <= 3;
            return (
              <div key={fp.memberId} className={s.card} style={{ borderLeft: `3px solid ${urgent ? 'var(--red)' : 'var(--warn)'}` }}>
                <div className={s.flexBetween}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{fp.childName}</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                      Parent: {fp.parentName} | {fp.plan} - ${fp.amount}/mo
                    </div>
                  </div>
                  <span className={`${s.statusBadge} ${urgent ? s.statusFailed : s.statusPaused}`}>
                    {daysLeft > 0 ? `${daysLeft} days left in grace` : 'Credits frozen'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-md)', marginTop: 'var(--sp-lg)', fontSize: 'var(--fs-sm)' }}>
                  <div>
                    <div style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Failure Date</div>
                    <div style={{ fontWeight: 600 }}>{fp.failureDate}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Reason</div>
                    <div style={{ fontWeight: 600 }}>{fp.failureReason}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Grace Period Ends</div>
                    <div style={{ fontWeight: 600, color: urgent ? 'var(--red)' : 'inherit' }}>{fp.gracePeriodEnds}</div>
                  </div>
                </div>

                <div style={{ marginTop: 'var(--sp-lg)', padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
                  <strong>Auto SMS sent:</strong> "Hi {fp.parentName.split(' ')[0]} - your payment with BAM GTA has failed."
                  {fp.smsSent && <span style={{ color: 'var(--green)', marginLeft: 8, fontWeight: 700 }}>Delivered</span>}
                </div>

                <div style={{ marginTop: 'var(--sp-lg)' }} className={s.flexGap}>
                  <button className={`${s.btn} ${s.btnGold}`}>Manual Resolve</button>
                  <button className={s.btn}>Message Parent</button>
                  <button className={s.btn}>View in Stripe</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info card */}
      <div className={s.card} style={{ marginTop: 'var(--sp-xl)', background: 'var(--surf2)' }}>
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-sm)' }}>How Failed Payments Work</h3>
        <ul style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', paddingLeft: 'var(--sp-xl)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Stripe retries automatically using Smart Retry logic</li>
          <li>One dunning SMS sent to parent on Day 0</li>
          <li>2-week grace period: member keeps full access</li>
          <li>After 14 days: credit refresh freezes (no new credits, membership stays active)</li>
          <li>Auto-resolves when Stripe confirms payment + team notified</li>
          <li>Staff can manually resolve (e.g., cash payment) with required note</li>
          <li>SMS + in-app notification include deep link to Stripe payment update page</li>
        </ul>
      </div>
    </div>
  );
}
