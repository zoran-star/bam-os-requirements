import { useState } from 'react';
import { MEMBERS, PLANS, STAFF } from '../data/members';
import { SESSION_TEMPLATES } from '../data/sessions';
import s from '../styles/shared.module.css';

// PRD #10: Member Profiles & Tracker
// No trial or cancelled members here (trial = sales, cancelled = analysis)
// Order: child, parent, trainer connection, status, plan
// Left dot color matches status

const ACTIVE_MEMBERS = MEMBERS.filter(m => m.status !== 'trial' && m.status !== 'cancelled');

// Mock credit history per member
function getCreditHistory(member) {
  const history = [
    { date: '2026-04-13', description: 'Billing cycle refresh', amount: member.creditsTotal === 'unlimited' ? 0 : member.creditsTotal },
    { date: '2026-04-12', description: 'Booked: Saturday All Levels', amount: -1 },
    { date: '2026-04-10', description: 'Booked: Thursday Advanced', amount: -1 },
    { date: '2026-04-07', description: 'Booked: Monday Intermediate', amount: -1 },
    { date: '2026-03-16', description: 'Billing cycle refresh', amount: member.creditsTotal === 'unlimited' ? 0 : member.creditsTotal },
    { date: '2026-03-14', description: 'Manual adjustment', amount: 1 },
  ];
  if (member.creditsTotal === 'unlimited') return [{ date: '2026-04-13', description: 'Unlimited plan - no credit tracking', amount: 0 }];
  return history;
}

// Mock payment history per member (from Stripe - date, amount, product name, newest first)
function getPaymentHistory(member) {
  if (!member.plan) return [];
  const price = PLANS.find(p => p.id === member.plan)?.price || 0;
  const planName = PLANS.find(p => p.id === member.plan)?.name || '';
  const discountedPrice = member.siblingDiscount ? price * 0.5 : price;
  return [
    { date: '2026-04-13', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2026-03-16', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2026-02-16', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2026-01-19', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2025-12-22', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
  ];
}

// Mock attendance history per member
function getAttendanceHistory(member) {
  return [
    { date: 'Sat, Apr 12', session: 'Saturday All Levels', status: 'Present' },
    { date: 'Thu, Apr 10', session: 'Thursday Advanced', status: 'Present' },
    { date: 'Mon, Apr 7', session: 'Monday Intermediate', status: 'Present' },
    { date: 'Sat, Apr 5', session: 'Saturday All Levels', status: 'Present' },
    { date: 'Thu, Apr 3', session: 'Thursday Advanced', status: 'No-Show' },
    { date: 'Mon, Mar 31', session: 'Monday Intermediate', status: 'Present' },
  ].slice(0, Math.min(6, member.sessionsAttended));
}

const STATUS_COLOR = {
  active: 'var(--green)',
  paused: 'var(--warn)',
};

const HEALTH_COLOR = {
  'consistent': 'var(--green)',
  'at-risk': 'var(--red)',
};

// Sort: failed payments first, then active, then paused
function sortMembers(members) {
  return [...members].sort((a, b) => {
    if (a.paymentStatus === 'failed' && b.paymentStatus !== 'failed') return -1;
    if (b.paymentStatus === 'failed' && a.paymentStatus !== 'failed') return 1;
    return 0;
  });
}

export default function MemberProfiles() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMember, setSelectedMember] = useState(null);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);

  const staff = (id) => STAFF.find(s => s.id === id);
  const plan = (id) => PLANS.find(p => p.id === id);

  const filtered = ACTIVE_MEMBERS.filter(m => {
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (search && !m.childName.toLowerCase().includes(search.toLowerCase()) && !m.parentName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCounts = {
    all: ACTIVE_MEMBERS.length,
    active: ACTIVE_MEMBERS.filter(m => m.status === 'active').length,
    paused: ACTIVE_MEMBERS.filter(m => m.status === 'paused').length,
  };

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Member Profiles</h1>
        <p className={s.pageDesc}>Directory and action hub for all members</p>
      </div>

      {/* Stats */}
      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statValue}>{statusCounts.all}</div>
          <div className={s.statLabel}>Total Members</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{statusCounts.active}</div>
          <div className={s.statLabel}>Active</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{statusCounts.paused}</div>
          <div className={s.statLabel}>Paused</div>
        </div>
      </div>

      {/* Trainer Breakdown */}
      <div style={{ display: 'flex', gap: 'var(--sp-sm)', marginBottom: 'var(--sp-lg)', flexWrap: 'wrap' }}>
        {STAFF.map(st => {
          const count = ACTIVE_MEMBERS.filter(m => m.trainerConnection === st.id).length;
          return (
            <div key={st.id} style={{ padding: '6px 14px', borderRadius: 'var(--r-full)', background: 'var(--surf)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--ts)' }}>
              {st.name}: <strong style={{ color: 'var(--tp)' }}>{count}</strong>
            </div>
          );
        })}
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: 'var(--sp-md)', marginBottom: 'var(--sp-lg)' }}>
        <div className={s.searchWrap} style={{ flex: 1, marginBottom: 0 }}>
          <svg className={s.searchIcon} width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input className={s.searchInput} placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className={s.flexGap}>
          {['all', 'active', 'paused'].map(st => (
            <button key={st} className={`${s.btn} ${statusFilter === st ? s.btnGold : ''}`} onClick={() => setStatusFilter(st)}>
              {st.charAt(0).toUpperCase() + st.slice(1)} ({statusCounts[st]})
            </button>
          ))}
        </div>
      </div>

      {/* Member Table */}
      <div className={s.card}>
        <table className={s.table}>
          <thead>
            <tr>
              <th></th>
              <th>Child</th>
              <th>Parent</th>
              <th>Trainer</th>
              <th>Status</th>
              <th>Health</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {sortMembers(filtered).map(m => {
              const p = plan(m.plan);
              const t = staff(m.trainerConnection);
              const isFailed = m.paymentStatus === 'failed';
              const dotColor = isFailed ? 'var(--red)' : (STATUS_COLOR[m.status] || 'var(--tm)');
              return (
                <tr key={m.id} style={{ cursor: 'pointer', background: isFailed ? 'rgba(224,90,66,0.04)' : undefined }} onClick={() => setSelectedMember(m)}>
                  <td><span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, display: 'inline-block' }} /></td>
                  <td style={{ fontWeight: 600, color: isFailed ? 'var(--red)' : undefined }}>{m.childName}</td>
                  <td>{m.parentName}</td>
                  <td>{t?.name || '-'}</td>
                  <td>
                    {isFailed ? (
                      <span className={`${s.statusBadge} ${s.statusFailed}`}>payment failed</span>
                    ) : (
                      <span className={`${s.statusBadge} ${m.status === 'active' ? s.statusActive : s.statusPaused}`}>
                        {m.status}
                      </span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-xs)', color: HEALTH_COLOR[m.health] || 'var(--tm)' }}>
                      {m.health === 'at-risk' ? 'At Risk' : m.health === 'consistent' ? 'Consistent' : '-'}
                    </span>
                  </td>
                  <td>{p?.name || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Member Profile Drawer */}
      {selectedMember && (
        <div className={s.drawerOverlay} onClick={() => setSelectedMember(null)}>
          <div className={s.drawer} onClick={e => e.stopPropagation()}>
            <div className={s.drawerHeader}>
              <h2 className={s.drawerTitle}>{selectedMember.childName}</h2>
              <button className={s.drawerClose} onClick={() => setSelectedMember(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Editable Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-xl)' }}>
              <EditableField label="Parent" defaultValue={selectedMember.parentName} />
              <EditableField label="Phone" defaultValue={selectedMember.phone} />
              <EditableField label="Email" defaultValue={selectedMember.email} />
              <div>
                <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Status</span><br />
                <span className={`${s.statusBadge} ${selectedMember.status === 'active' ? s.statusActive : s.statusPaused}`} style={{ fontWeight: 700 }}>
                  {selectedMember.status}
                </span>
              </div>
              <DropdownField label="Health" defaultValue={selectedMember.health || 'consistent'} options={['consistent', 'at-risk']} colorMap={HEALTH_COLOR} />
              <div>
                <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Plan</span><br />
                <strong>{plan(selectedMember.plan)?.name || '-'} {plan(selectedMember.plan) ? `($${plan(selectedMember.plan).price}/mo)` : ''}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Credits</span><br />
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong>{selectedMember.creditsRemaining === 'unlimited' ? 'Unlimited' : `${selectedMember.creditsRemaining} / ${selectedMember.creditsTotal}`}</strong>
                  {selectedMember.creditsRemaining !== 'unlimited' && (
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button style={{ width: 24, height: 24, borderRadius: 'var(--r-full)', border: '1px solid var(--border)', background: 'var(--surf2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--red)', lineHeight: 1 }}>-</button>
                      <button style={{ width: 24, height: 24, borderRadius: 'var(--r-full)', border: '1px solid var(--border)', background: 'var(--surf2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--green)', lineHeight: 1 }}>+</button>
                    </span>
                  )}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Next Billing</span><br />
                <strong>{selectedMember.nextBilling || '-'}</strong>
              </div>
              <DropdownField label="Trainer" defaultValue={staff(selectedMember.trainerConnection)?.name || 'Unassigned'} options={STAFF.map(s => s.name)} />
              <DropdownField label="Group" defaultValue={selectedMember.group !== null ? `Group ${selectedMember.group}` : 'Unassigned'} options={['Group 0', 'Group 1', 'Group 2', 'Unassigned']} />
              {selectedMember.siblingDiscount && (
                <div style={{ gridColumn: '1 / -1', background: 'rgba(200,168,78,0.08)', padding: 'var(--sp-sm)', borderRadius: 'var(--r-sm)' }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Sibling discount: 50% off lifetime</span>
                </div>
              )}
            </div>

            {/* Failed Payment Alert */}
            {selectedMember.paymentStatus === 'failed' && (
              <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-xl)', fontSize: 'var(--fs-sm)' }}>
                <strong style={{ color: 'var(--red)' }}>Payment Failed</strong> - {selectedMember.failureReason} ({selectedMember.failureDate})
              </div>
            )}

            {/* Pause Info */}
            {selectedMember.status === 'paused' && (
              <div style={{ padding: 'var(--sp-md)', background: 'var(--warnl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-xl)', fontSize: 'var(--fs-sm)' }}>
                <strong>Paused:</strong> {selectedMember.pauseStart} - {selectedMember.pauseEnd} ({selectedMember.pauseReason})
              </div>
            )}

            {/* Actions */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-md)' }}>Actions</h3>
            <div style={{ display: 'flex', gap: 'var(--sp-sm)', flexWrap: 'wrap' }}>
              <button className={s.btn}>Message</button>
              <button className={s.btn}>Send Payment Update Link</button>
              {selectedMember.status === 'active' && (
                <>
                  <button className={s.btn} onClick={() => setShowPauseModal(true)}>Pause</button>
                  <button className={s.btn}>Upgrade</button>
                  <button className={s.btn}>Downgrade</button>
                  <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowCancelModal(true)}>Cancel</button>
                  <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowRefundModal(true)}>Refund</button>
                </>
              )}
              {selectedMember.status === 'paused' && <button className={`${s.btn} ${s.btnGold}`}>Resume</button>}
            </div>

            {/* Internal Notes */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Notes</h3>
            <textarea
              defaultValue={selectedMember.notes || ''}
              placeholder="Add internal notes about this member..."
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'rgba(224,157,36,0.04)', color: 'var(--tp)', fontFamily: 'var(--ff)', minHeight: 80, resize: 'vertical', borderColor: 'rgba(224,157,36,0.2)' }}
            />

            {/* Credit History */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Credit History</h3>
            <div style={{ fontSize: 'var(--fs-sm)' }}>
              {getCreditHistory(selectedMember).map((entry, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{entry.description}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{entry.date}</div>
                  </div>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--fm)', color: entry.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {entry.amount > 0 ? '+' : ''}{entry.amount}
                  </span>
                </div>
              ))}
            </div>

            {/* Attendance History */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Attendance History</h3>
            <div style={{ fontSize: 'var(--fs-sm)' }}>
              {getAttendanceHistory(selectedMember).map((entry, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{entry.session}{entry.walkin && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)', fontWeight: 600, background: 'rgba(224,157,36,0.08)', padding: '1px 6px', borderRadius: 'var(--r-full)', marginLeft: 6 }}>walk-in</span>}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{entry.date}</div>
                  </div>
                  <span className={`${s.statusBadge} ${entry.status === 'Present' ? s.statusActive : s.statusFailed}`}>
                    {entry.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Payment History */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Payment History</h3>
            <div style={{ fontSize: 'var(--fs-sm)' }}>
              {getPaymentHistory(selectedMember).map((entry, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{entry.product}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{entry.date}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>${entry.amount.toFixed(2)}</div>
                    {entry.status && (
                      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: entry.status === 'paid' ? 'var(--green)' : entry.status === 'refunded' ? 'var(--warn)' : 'var(--red)' }}>
                        {entry.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pause Modal */}
            {showPauseModal && (
              <PauseModal member={selectedMember} onClose={() => setShowPauseModal(false)} />
            )}

            {/* Cancel Modal */}
            {showCancelModal && (
              <CancelModal member={selectedMember} onClose={() => setShowCancelModal(false)} />
            )}

            {/* Refund Modal */}
            {showRefundModal && (
              <RefundModal member={selectedMember} onClose={() => setShowRefundModal(false)} />
            )}

          </div>
        </div>
      )}
    </div>
  );
}

function PauseModal({ member, onClose }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Calculate duration
  const duration = startDate && endDate ? Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) : 0;
  const validDuration = duration >= 14 && duration <= 56; // 2-8 weeks in days
  const tooShort = duration > 0 && duration < 14;
  const tooLong = duration > 56;

  // Calculate new billing date
  const newBillingDate = member.nextBilling && duration > 0
    ? new Date(new Date(member.nextBilling).getTime() + duration * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : null;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>Pause Membership</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>
          Pausing <strong>{member.childName}</strong>'s membership. Min 2 weeks, max 8 weeks.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)' }}>
            <div>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label>
              <input type="date" style={inputStyle} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</label>
              <input type="date" style={inputStyle} value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>

          {/* Duration feedback */}
          {duration > 0 && (
            <div style={{
              padding: 'var(--sp-md)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)',
              background: tooShort || tooLong ? 'var(--redl)' : 'var(--greenl)',
              color: tooShort || tooLong ? 'var(--red)' : 'var(--green)',
              fontWeight: 600,
            }}>
              {tooShort && `${duration} days - minimum is 2 weeks (14 days)`}
              {tooLong && `${duration} days - maximum is 8 weeks (56 days)`}
              {validDuration && `${duration} days (${Math.round(duration / 7)} weeks)`}
            </div>
          )}

          {/* Impact summary */}
          {validDuration && (
            <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>What happens when you pause:</div>
              <ul style={{ paddingLeft: 'var(--sp-lg)', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--ts)' }}>
                <li>Credit refresh stops during the pause period</li>
                <li>Existing bookings within {startDate} - {endDate} will be auto-cancelled and credits returned</li>
                <li>{member.childName} cannot book new sessions during the pause</li>
                <li>Billing date extends by {duration} days: <strong>{member.nextBilling}</strong> → <strong>{newBillingDate}</strong></li>
                <li>Membership auto-resumes on {endDate}</li>
                <li>Parent will be notified in-app</li>
              </ul>
            </div>
          )}

          <button
            onClick={validDuration ? onClose : undefined}
            style={{
              width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
              background: validDuration ? 'var(--gold)' : 'var(--surf3)',
              color: validDuration ? '#fff' : 'var(--tm)',
              fontWeight: 700, fontSize: 'var(--fs-md)', cursor: validDuration ? 'pointer' : 'default',
              fontFamily: 'var(--ff)',
            }}
          >
            Confirm Pause
          </button>
        </div>
      </div>
    </div>
  );
}

function CreditModal({ member, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const numAmount = parseInt(amount) || 0;
  const isUnlimited = member.creditsRemaining === 'unlimited';
  const newBalance = isUnlimited ? 'unlimited' : member.creditsRemaining + numAmount;
  const valid = numAmount !== 0 && (isUnlimited || newBalance >= 0);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>Adjust Credits</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>
          {member.childName}'s current balance: <strong>{isUnlimited ? 'Unlimited' : `${member.creditsRemaining} / ${member.creditsTotal}`}</strong>
        </div>

        {isUnlimited ? (
          <div style={{ padding: 'var(--sp-md)', background: 'var(--warnl)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-lg)' }}>
            This member has an unlimited plan - credit adjustments don't apply.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
            {/* Quick buttons */}
            <div>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 8 }}>Quick Adjust</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[-2, -1, 1, 2, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => setAmount(String(n))}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--fm)',
                      background: parseInt(amount) === n ? (n > 0 ? 'var(--green)' : 'var(--red)') : 'var(--surf)',
                      color: parseInt(amount) === n ? '#fff' : (n > 0 ? 'var(--green)' : 'var(--red)'),
                      borderColor: parseInt(amount) === n ? 'transparent' : 'var(--border)',
                    }}
                  >
                    {n > 0 ? `+${n}` : n}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Or enter custom amount</label>
              <input
                type="number"
                style={inputStyle}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="e.g. +3 or -1"
              />
            </div>

            {/* Note */}
            <div>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Note (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Reason for adjustment..."
              />
            </div>

            {/* Preview */}
            {numAmount !== 0 && (
              <div style={{
                padding: 'var(--sp-md)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', fontWeight: 600,
                background: newBalance < 0 ? 'var(--redl)' : 'var(--greenl)',
                color: newBalance < 0 ? 'var(--red)' : 'var(--green)',
              }}>
                {member.creditsRemaining} {numAmount > 0 ? '+' : ''}{numAmount} = <strong>{newBalance} credits</strong>
                {newBalance < 0 && ' (cannot go below 0)'}
              </div>
            )}

            <button
              onClick={valid ? onClose : undefined}
              style={{
                width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                background: valid ? 'var(--gold)' : 'var(--surf3)',
                color: valid ? '#fff' : 'var(--tm)',
                fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default',
                fontFamily: 'var(--ff)',
              }}
            >
              Confirm Adjustment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CancelModal({ member, onClose }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const valid = reason.trim().length > 0;
  const p = PLANS.find(pl => pl.id === member.plan);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (confirmed) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
        <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 32, marginBottom: 'var(--sp-md)' }}>
            <svg width="40" height="40" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginBottom: 'var(--sp-sm)' }}>Sent for Admin Approval</h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>
            Cancel request for {member.childName} has been submitted. An Admin needs to approve before it takes effect.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--red)' }}>Cancel Membership</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)' }}>
          <strong>This requires Admin approval.</strong> The cancellation will not take effect until approved.
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>
          Cancelling <strong>{member.childName}</strong>'s {p?.name || ''} membership.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          {/* Cancel Reason */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason for cancellation *</label>
            <select style={inputStyle} value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Select a reason...</option>
              <option value="Unknown">Unknown</option>
              <option value="Too expensive">Too expensive</option>
              <option value="Not enough time">Not enough time</option>
              <option value="Started other programs">Started other programs</option>
              <option value="Not locked in">Not locked in</option>
              <option value="other">Other</option>
            </select>
            {reason === 'other' && (
              <input
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="Enter reason..."
                onChange={e => setReason(e.target.value || 'other')}
              />
            )}
          </div>

          {/* Additional notes */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Additional notes</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} placeholder="Any additional context..." />
          </div>

          {/* What happens */}
          {valid && (
            <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>What happens on approval:</div>
              <ul style={{ paddingLeft: 'var(--sp-lg)', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--ts)' }}>
                <li>Status changes to "pending cancel" immediately</li>
                <li>{member.childName} keeps full access until end of billing period ({member.nextBilling})</li>
                <li>Stripe subscription cancels at period end</li>
                <li>Parent notified via in-app + SMS</li>
                <li>To rejoin, parent must go through full onboarding again</li>
              </ul>
            </div>
          )}

          <button
            onClick={valid ? () => setConfirmed(true) : undefined}
            style={{
              width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
              background: valid ? 'var(--red)' : 'var(--surf3)',
              color: valid ? '#fff' : 'var(--tm)',
              fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default',
              fontFamily: 'var(--ff)',
            }}
          >
            Submit for Admin Approval
          </button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({ member, onClose }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const p = PLANS.find(pl => pl.id === member.plan);
  const lastPayment = p ? (member.siblingDiscount ? p.price * 0.5 : p.price) : 0;
  const numAmount = parseFloat(amount) || 0;
  const valid = numAmount > 0 && reason.trim().length > 0;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (confirmed) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
        <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 32, marginBottom: 'var(--sp-md)' }}>
            <svg width="40" height="40" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginBottom: 'var(--sp-sm)' }}>Sent for Admin Approval</h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>
            Refund of <strong>${numAmount.toFixed(2)}</strong> for {member.childName} has been submitted. An Admin needs to approve before it processes.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--red)' }}>Issue Refund</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)' }}>
          <strong>This requires Admin approval.</strong> The refund will not process until approved.
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>
          Refund for <strong>{member.childName}</strong> | Last payment: <strong>${lastPayment.toFixed(2)}</strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          {/* Quick amount buttons */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 8 }}>Amount</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={() => setAmount(lastPayment.toFixed(2))} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ff)', background: parseFloat(amount) === lastPayment ? 'var(--gold)' : 'var(--surf)', color: parseFloat(amount) === lastPayment ? '#fff' : 'var(--ts)' }}>
                Full (${lastPayment.toFixed(2)})
              </button>
              <button onClick={() => setAmount('')} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ff)', background: 'var(--surf)', color: 'var(--ts)' }}>
                Custom
              </button>
            </div>
            <input type="number" style={inputStyle} value={amount} onChange={e => setAmount(e.target.value)} placeholder="$0.00" step="0.01" />
          </div>

          {/* Reason */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason *</label>
            <input style={inputStyle} value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter refund reason..." />
          </div>

          {/* Summary */}
          {valid && (
            <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>On approval:</div>
              <ul style={{ paddingLeft: 'var(--sp-lg)', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--ts)' }}>
                <li><strong>${numAmount.toFixed(2)}</strong> refunded via Stripe automatically</li>
                <li>Logged with reason, who requested, who approved</li>
              </ul>
            </div>
          )}

          <button
            onClick={valid ? () => setConfirmed(true) : undefined}
            style={{
              width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
              background: valid ? 'var(--red)' : 'var(--surf3)',
              color: valid ? '#fff' : 'var(--tm)',
              fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default',
              fontFamily: 'var(--ff)',
            }}
          >
            Submit for Admin Approval
          </button>
        </div>
      </div>
    </div>
  );
}

function DropdownField({ label, defaultValue, options, colorMap }) {
  const [value, setValue] = useState(defaultValue);
  const color = colorMap?.[value];
  return (
    <div>
      <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
      <select
        value={value}
        onChange={e => setValue(e.target.value)}
        style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: color || 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 700, cursor: 'pointer', appearance: 'auto' }}
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function AddUnbookedAttendance() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState('');
  const [date, setDate] = useState('');
  const [added, setAdded] = useState([]);

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (!open) {
    return (
      <div style={{ marginTop: 'var(--sp-sm)' }}>
        {added.map((entry, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-sm)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{entry.session}<span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)', fontWeight: 600, background: 'rgba(224,157,36,0.08)', padding: '1px 6px', borderRadius: 'var(--r-full)', marginLeft: 6 }}>walk-in</span></div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{entry.date}</div>
            </div>
            <span className={`${s.statusBadge} ${s.statusActive}`}>Present</span>
          </div>
        ))}
        <button
          className={s.btn}
          style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed', marginTop: 'var(--sp-sm)', fontSize: 'var(--fs-xs)' }}
          onClick={() => setOpen(true)}
        >
          + Add Attendance (didn't book)
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-sm)', padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-sm)' }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Add Unbooked Session</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>Cancel</button>
      </div>
      <div style={{ marginBottom: 'var(--sp-sm)' }}>
        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, display: 'block', marginBottom: 2 }}>Session</label>
        <select style={inputStyle} value={session} onChange={e => setSession(e.target.value)}>
          <option value="">Select session...</option>
          {SESSION_TEMPLATES.map(t => (
            <option key={t.id} value={t.name}>{t.name} ({t.startTime})</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 'var(--sp-md)' }}>
        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, display: 'block', marginBottom: 2 }}>Date</label>
        <input type="date" style={inputStyle} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <button
        className={`${s.btn} ${s.btnGold}`}
        style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--fs-sm)' }}
        onClick={() => {
          if (session && date) {
            const formatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            setAdded(prev => [{ session, date: formatted }, ...prev]);
            setSession('');
            setDate('');
            setOpen(false);
          }
        }}
      >
        Add Attendance
      </button>
    </div>
  );
}

function EditableField({ label, defaultValue }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(defaultValue);

  if (editing) {
    return (
      <div>
        <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
        <input
          autoFocus
          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--gold)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 600 }}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }}
        />
      </div>
    );
  }

  return (
    <div style={{ cursor: 'pointer' }} onClick={() => setEditing(true)}>
      <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ borderBottom: '1px dashed var(--border)' }}>{value}</strong>
        <svg width="12" height="12" fill="none" stroke="var(--tm)" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      </span>
    </div>
  );
}
