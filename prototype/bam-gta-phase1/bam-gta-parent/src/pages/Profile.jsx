import { useState } from 'react';
import { PARENT, CHILDREN, PAYMENT_METHOD, BILLING_HISTORY, PLANS } from '../data/parent';
import s from '../styles/app.module.css';

// PRD #17: View Profile (read-only P0)
// PRD #16: Payment Methods (Stripe-hosted update)
// PRD #18: Edit Membership (request pause, cancel, upgrade, downgrade)
// PRD #19: Sibling Management (tab switcher)
// PRD #20: Billing History (per-child)

export default function Profile() {
  const [activeChild, setActiveChild] = useState(CHILDREN[0].id);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const child = CHILDREN.find(c => c.id === activeChild);
  const currentPlan = PLANS.find(p => p.id === child?.plan);

  return (
    <div>
      <div className={s.header}>
        <div className={s.headerTitle}>Profile</div>
        <div className={s.headerSub}>{PARENT.name}</div>
      </div>

      {/* Parent Info */}
      <div className={s.card}>
        <div className={s.cardTitle}>Parent Info</div>
        <div className={s.infoRow}><span className={s.infoLabel}>Name</span><span className={s.infoValue}>{PARENT.name}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Phone</span><span className={s.infoValue}>{PARENT.phone}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Email</span><span className={s.infoValue}>{PARENT.email}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Emergency</span><span className={s.infoValue}>{PARENT.emergencyContactName}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Emergency #</span><span className={s.infoValue}>{PARENT.emergencyContactNumber}</span></div>
      </div>

      {/* Payment Method (PRD #16) */}
      <div className={s.card}>
        <div className={s.cardTitle}>Payment Method</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{PAYMENT_METHOD.brand} ending in {PAYMENT_METHOD.last4}</div>
            <div style={{ fontSize: 12, color: 'var(--ts)' }}>Expires {PAYMENT_METHOD.expiry}</div>
          </div>
          <button className={`${s.btn} ${s.btnSmall}`}>Update</button>
        </div>
      </div>

      {/* Billing History (PRD #20) */}
      <div className={s.card}>
        <div className={s.cardTitle}>Billing History</div>
        {BILLING_HISTORY.slice(0, 3).map(bill => (
          <div key={bill.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{bill.description}</div>
              <div style={{ fontSize: 12, color: 'var(--ts)' }}>{bill.date}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>${bill.amount.toFixed(2)}</div>
              <span className={`${s.badge} ${s.badgeGreen}`}>{bill.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Child Switcher (PRD #19) */}
      <div className={s.sectionTitle}>Children</div>
      <div className={s.childSwitcher}>
        {CHILDREN.map(c => (
          <button
            key={c.id}
            className={`${s.childTab} ${activeChild === c.id ? s.childTabActive : ''}`}
            onClick={() => setActiveChild(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Credit Balance (PRD #17) */}
      <div className={`${s.card} ${s.cardGold}`}>
        <div className={s.cardTitle}>Credits - {child?.name}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--gold)' }}>
            {child?.creditsRemaining === 'unlimited' ? 'Unlimited' : child?.creditsRemaining}
          </div>
          {child?.creditsRemaining !== 'unlimited' && (
            <div style={{ fontSize: 13, color: 'var(--ts)' }}>of {child?.creditsTotal} this cycle</div>
          )}
        </div>
        {child?.creditsRemaining !== 'unlimited' && (
          <div className={s.creditBar}>
            <div className={s.creditFill} style={{ width: `${(child?.creditsRemaining / child?.creditsTotal) * 100}%` }} />
          </div>
        )}
      </div>

      {/* Child Info */}
      <div className={s.card}>
        <div className={s.cardTitle}>{child?.name}</div>
        <div className={s.infoRow}><span className={s.infoLabel}>Plan</span><span className={s.infoValue}>{child?.plan}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Next Billing</span><span className={s.infoValue}>{child?.nextBilling}</span></div>
        <div className={s.infoRow}><span className={s.infoLabel}>Next Amount</span><span className={s.infoValue}>${child?.siblingDiscount ? (child.planPrice * 0.5).toFixed(2) : child?.planPrice?.toFixed(2)}</span></div>
        {child?.siblingDiscount && (
          <div style={{ marginTop: 8, padding: 8, background: 'rgba(200,168,78,0.08)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--gold)', fontWeight: 600 }}>
            50% sibling discount applied
          </div>
        )}
      </div>

      {/* Upcoming Bookings */}
      {child?.upcomingBookings?.length > 0 && (
        <div className={s.card}>
          <div className={s.cardTitle}>Upcoming - {child.name}</div>
          {child.upcomingBookings.map(booking => (
            <div key={booking.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{booking.sessionName}</div>
                <div style={{ fontSize: 12, color: 'var(--ts)' }}>{booking.date} | {booking.time}</div>
              </div>
              <button className={`${s.btnSmall} ${s.btn}`} style={{ color: 'var(--red)', borderColor: 'rgba(224,90,66,0.3)' }}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Past Sessions */}
      {child?.pastSessions?.length > 0 && (
        <div className={s.card}>
          <div className={s.cardTitle}>Past Sessions - {child.name}</div>
          {child.pastSessions.map((session, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{session.sessionName}</div>
                <div style={{ fontSize: 12, color: 'var(--ts)' }}>{session.date}</div>
              </div>
              <span className={`${s.badge} ${session.status === 'attended' ? s.badgeGreen : s.badgeRed}`}>
                {session.status === 'attended' ? 'Attended' : 'No-Show'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Membership Actions (PRD #18) - per child */}
      <div className={s.section}>
        <div className={s.sectionTitle} style={{ padding: '8px 0 4px' }}>Actions for {child?.name}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          <button className={`${s.btn} ${s.btnGold}`} onClick={() => setShowUpgradeModal(true)}>
            Change {child?.name}'s Plan
          </button>
          <button className={s.btn} onClick={() => setShowPauseModal(true)}>
            Pause {child?.name}'s Membership
          </button>
          <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowCancelModal(true)}>
            Cancel {child?.name}'s Membership
          </button>
        </div>
      </div>

      {/* Pause Modal */}
      {showPauseModal && (
        <div className={s.modal} onClick={() => setShowPauseModal(false)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHandle} />
            <div className={s.modalTitle}>Request Pause</div>
            <div style={{ fontSize: 14, color: 'var(--ts)', marginBottom: 16 }}>
              Pause {child?.name}'s membership for 2-8 weeks. Your billing date will be extended. No credits during the pause.
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label>
              <input type="date" style={{ width: '100%', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 14, background: 'var(--surf)' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</label>
              <input type="date" style={{ width: '100%', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 14, background: 'var(--surf)' }} />
            </div>
            <button className={`${s.btn} ${s.btnGold}`} onClick={() => setShowPauseModal(false)}>Submit Pause Request</button>
            <button className={s.btn} style={{ marginTop: 8 }} onClick={() => setShowPauseModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className={s.modal} onClick={() => setShowCancelModal(false)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHandle} />
            <div className={s.modalTitle}>Request Cancellation</div>
            <div style={{ fontSize: 14, color: 'var(--ts)', marginBottom: 16 }}>
              Cancel {child?.name}'s membership. Takes effect at end of billing period. {child?.name} keeps access until {child?.nextBilling}. Requires admin approval.
            </div>
            <div style={{ padding: 12, background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 16, fontSize: 13 }}>
              <strong>Note:</strong> To rejoin later, you'll need to go through the full signup process again.
            </div>
            <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowCancelModal(false)}>Submit Cancel Request</button>
            <button className={s.btn} style={{ marginTop: 8 }} onClick={() => setShowCancelModal(false)}>Keep Membership</button>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className={s.modal} onClick={() => setShowUpgradeModal(false)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHandle} />
            <div className={s.modalTitle}>Change Plan</div>
            <div style={{ fontSize: 14, color: 'var(--ts)', marginBottom: 16 }}>
              Current: <strong>{currentPlan?.name} (${child?.planPrice}/mo)</strong>
            </div>
            {PLANS.filter(p => p.price > (child?.planPrice || 0)).map(plan => (
              <div key={plan.id} style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{plan.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--ts)' }}>
                      {plan.sessionsPerWeek === 'unlimited' ? 'Unlimited' : plan.sessionsPerWeek + 'x/week'} | {plan.credits === 'unlimited' ? 'Unlimited' : plan.credits} credits/cycle
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>${plan.price}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ts)' }}>/mo</span></div>
                </div>
                <button className={`${s.btn} ${s.btnGold}`} style={{ marginTop: 12 }} onClick={() => setShowUpgradeModal(false)}>
                  Upgrade to {plan.name}
                </button>
              </div>
            ))}
            <button className={s.btn} style={{ marginTop: 8 }} onClick={() => setShowUpgradeModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
