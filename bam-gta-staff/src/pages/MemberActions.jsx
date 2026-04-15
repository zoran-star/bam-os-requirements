import { useState } from 'react';
import { MEMBERS, PLANS, STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #8: Membership Actions & Credits
// Pause, Cancel, Upgrade, Downgrade, Refund, Manual credit adjustments
// Approval rules: refunds + cancels = Admin only, pause/upgrade/downgrade = any staff
// Credit lifecycle: per billing cycle, no rollover

export default function MemberActions() {
  const [tab, setTab] = useState('overview');
  const [actionModal, setActionModal] = useState(null);

  const activeMembers = MEMBERS.filter(m => m.status === 'active');
  const pausedMembers = MEMBERS.filter(m => m.status === 'paused');

  const staff = (id) => STAFF.find(s => s.id === id);
  const plan = (id) => PLANS.find(p => p.id === id);

  const ACTIONS = [
    { id: 'pause', label: 'Pause', icon: '||', desc: 'Min 2 weeks, max 8 weeks. Extends billing date.', approval: 'Any staff', color: 'var(--warn)' },
    { id: 'cancel', label: 'Cancel', icon: 'x', desc: 'Takes effect end of billing period. Admin approval required.', approval: 'Admin only', color: 'var(--red)' },
    { id: 'upgrade', label: 'Upgrade', icon: '+', desc: 'Stripe charges prorated difference. Credits added immediately.', approval: 'Any staff', color: 'var(--green)' },
    { id: 'downgrade', label: 'Downgrade', icon: '-', desc: 'Takes effect next billing cycle. No credit clawback.', approval: 'Any staff', color: 'var(--blue)' },
    { id: 'refund', label: 'Refund', icon: '$', desc: 'Admin approves amount. Stripe processes automatically.', approval: 'Admin only', color: 'var(--red)' },
    { id: 'credit', label: 'Adjust Credits', icon: '#', desc: 'Add or remove credits manually. No reason required.', approval: 'Any staff', color: 'var(--gold)' },
  ];

  const RECENT_ACTIONS = [
    { id: 'ra1', action: 'Pause', member: 'Ethan Nguyen', by: 's2', date: '2026-03-23', details: 'Family vacation, 4 weeks', status: 'active' },
    { id: 'ra2', action: 'Cancel', member: 'Lily Park', by: 's1', date: '2026-02-10', details: 'Moving away', status: 'completed' },
    { id: 'ra3', action: 'Credit +2', member: 'Jaylen Brooks', by: 's3', date: '2026-04-08', details: 'Make-up for cancelled session', status: 'completed' },
    { id: 'ra4', action: 'Upgrade', member: 'Sarah Mitchell', by: 's1', date: '2026-03-15', details: 'Elevate -> Dominate', status: 'completed' },
  ];

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Membership Actions & Credits</h1>
        <p className={s.pageDesc}>Manage pauses, cancellations, upgrades, refunds, and credit adjustments</p>
      </div>

      <div className={s.tabs}>
        <button className={`${s.tab} ${tab === 'overview' ? s.tabActive : ''}`} onClick={() => setTab('overview')}>Actions</button>
        <button className={`${s.tab} ${tab === 'credits' ? s.tabActive : ''}`} onClick={() => setTab('credits')}>Credit Overview</button>
        <button className={`${s.tab} ${tab === 'history' ? s.tabActive : ''}`} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'overview' && (
        <>
          {/* Quick Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-md)', marginBottom: 'var(--sp-xl)' }}>
            {ACTIONS.map(action => (
              <div key={action.id} className={s.card} style={{ cursor: 'pointer', borderTop: `3px solid ${action.color}` }} onClick={() => setActionModal(action)}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{action.label}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 8 }}>{action.desc}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Approval: {action.approval}</div>
              </div>
            ))}
          </div>

          {/* Active Pauses */}
          {pausedMembers.length > 0 && (
            <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
              <h2 className={s.cardTitle}>Active Pauses</h2>
              {pausedMembers.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-md) 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.childName}</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                      {m.pauseStart} - {m.pauseEnd} | {m.pauseReason}
                    </div>
                  </div>
                  <button className={s.btn}>Resume Early</button>
                </div>
              ))}
            </div>
          )}

          {/* Pending Approvals */}
          <div className={s.card}>
            <h2 className={s.cardTitle}>Pending Approvals</h2>
            <div className={s.empty}><div className={s.emptyText}>No pending approvals</div></div>
          </div>
        </>
      )}

      {tab === 'credits' && (
        <div className={s.card}>
          <h2 className={s.cardTitle}>Member Credits</h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>
            Credits refresh per billing cycle. No rollover - unused credits expire at cycle reset.
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Plan</th>
                <th>Credits</th>
                <th>Next Refresh</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MEMBERS.filter(m => m.status === 'active' || m.status === 'paused').map(m => {
                const p = plan(m.plan);
                return (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600 }}>{m.childName}</td>
                    <td>{p?.name || '-'}</td>
                    <td>
                      {m.creditsRemaining === 'unlimited' ? (
                        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>Unlimited</span>
                      ) : (
                        <span>
                          <strong>{m.creditsRemaining}</strong>
                          <span style={{ color: 'var(--tm)' }}> / {m.creditsTotal}</span>
                        </span>
                      )}
                    </td>
                    <td>{m.nextBilling || '-'}</td>
                    <td>
                      <span className={`${s.statusBadge} ${m.status === 'paused' ? s.statusPaused : m.creditsRemaining === 0 ? s.statusFailed : s.statusActive}`}>
                        {m.status === 'paused' ? 'Paused' : m.creditsRemaining === 0 ? 'No credits' : 'Active'}
                      </span>
                    </td>
                    <td><button className={s.btn} style={{ fontSize: 'var(--fs-xs)' }}>Adjust</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'history' && (
        <div className={s.card}>
          <h2 className={s.cardTitle}>Recent Actions</h2>
          <table className={s.table}>
            <thead>
              <tr><th>Action</th><th>Member</th><th>By</th><th>Date</th><th>Details</th><th>Status</th></tr>
            </thead>
            <tbody>
              {RECENT_ACTIONS.map(ra => (
                <tr key={ra.id}>
                  <td style={{ fontWeight: 600 }}>{ra.action}</td>
                  <td>{ra.member}</td>
                  <td>{staff(ra.by)?.name}</td>
                  <td>{ra.date}</td>
                  <td style={{ color: 'var(--ts)', fontSize: 'var(--fs-sm)' }}>{ra.details}</td>
                  <td><span className={`${s.statusBadge} ${ra.status === 'active' ? s.statusPaused : s.statusActive}`}>{ra.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Modal */}
      {actionModal && (
        <div className={s.drawerOverlay} onClick={() => setActionModal(null)}>
          <div className={s.drawer} style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className={s.drawerHeader}>
              <h2 className={s.drawerTitle}>{actionModal.label}</h2>
              <button className={s.drawerClose} onClick={() => setActionModal(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className={s.flexCol} style={{ gap: 'var(--sp-lg)' }}>
              <div>
                <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Select Member</label>
                <select style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }}>
                  <option value="">Choose a member...</option>
                  {activeMembers.map(m => <option key={m.id} value={m.id}>{m.childName} ({m.parentName})</option>)}
                </select>
              </div>
              <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
                {actionModal.desc}
                <div style={{ marginTop: 4, color: 'var(--tm)' }}>Requires: {actionModal.approval}</div>
              </div>
              {actionModal.id === 'pause' && (
                <>
                  <div>
                    <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label>
                    <input type="date" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date (min 2 weeks, max 8 weeks)</label>
                    <input type="date" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }} />
                  </div>
                </>
              )}
              {(actionModal.id === 'refund') && (
                <div>
                  <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount ($)</label>
                  <input type="number" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }} placeholder="0.00" />
                </div>
              )}
              {actionModal.id === 'credit' && (
                <div>
                  <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Credit Adjustment</label>
                  <input type="number" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }} placeholder="+2 or -1" />
                </div>
              )}
              <div>
                <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Note (optional)</label>
                <textarea style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)', minHeight: 80, resize: 'vertical' }} placeholder="Add a note..." />
              </div>
              <button className={`${s.btn} ${s.btnGold}`} style={{ width: '100%', justifyContent: 'center' }} onClick={() => setActionModal(null)}>
                Submit {actionModal.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
