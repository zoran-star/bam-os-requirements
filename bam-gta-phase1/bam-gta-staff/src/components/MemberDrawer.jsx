import { useState } from 'react';
import { MEMBERS, PLANS, STAFF } from '../data/members';
import { SESSION_TEMPLATES } from '../data/sessions';
import s from '../styles/shared.module.css';

const STATUS_COLOR = {
  active: 'var(--green)',
  paused: 'var(--warn)',
};

const HEALTH_COLOR = {
  'consistent': 'var(--green)',
  'at-risk': 'var(--red)',
};

function getMessageHistory(member) {
  return [
    { from: 'parent', text: 'Hey, will there be a session this Saturday?', time: '2h ago', channel: 'SMS' },
    { from: 'staff', text: 'Yes! Saturday Younger at 11:30am and Older at 12:30pm.', time: '1h ago', channel: 'SMS' },
    { from: 'parent', text: 'Thanks for the update!', time: '10m ago', channel: 'SMS' },
  ];
}

function getPaymentHistory(member) {
  if (!member.plan) return [];
  const price = PLANS.find(p => p.id === member.plan)?.price || 0;
  const planName = PLANS.find(p => p.id === member.plan)?.name || '';
  const discountedPrice = member.siblingDiscount ? price * 0.5 : price;
  return [
    { date: '2026-04-13', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2026-03-16', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
    { date: '2026-02-16', product: `${planName}${member.siblingDiscount ? ' (50% sibling discount)' : ''}`, amount: discountedPrice, status: 'paid' },
  ];
}

function getCreditHistory(member) {
  if (member.creditsTotal === 'unlimited') return [{ date: '2026-04-13', description: 'Unlimited plan - no credit tracking', amount: 0 }];
  return [
    { date: '2026-04-13', description: 'Billing cycle refresh', amount: member.creditsTotal },
    { date: '2026-04-12', description: 'Booked: Saturday Younger', amount: -1 },
    { date: '2026-04-10', description: 'Booked: Thursday Older', amount: -1 },
    { date: '2026-04-07', description: 'Booked: Monday Older', amount: -1 },
    { date: '2026-03-16', description: 'Billing cycle refresh', amount: member.creditsTotal },
  ];
}

function getAttendanceHistory(member) {
  return [
    { date: 'Sat, Apr 12', session: 'Saturday Younger', status: 'Present' },
    { date: 'Thu, Apr 10', session: 'Thursday Older', status: 'Present' },
    { date: 'Mon, Apr 7', session: 'Monday Older', status: 'Present' },
    { date: 'Sat, Apr 5', session: 'Saturday Younger', status: 'Present' },
    { date: 'Thu, Apr 3', session: 'Thursday Older', status: 'No-Show' },
  ].slice(0, Math.min(5, member.sessionsAttended));
}

export default function MemberDrawer({ member, onClose }) {
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);

  const staff = (id) => STAFF.find(st => st.id === id);
  const plan = (id) => PLANS.find(p => p.id === id);

  return (
    <div className={s.drawerOverlay} onClick={onClose}>
      <div className={s.drawer} onClick={e => e.stopPropagation()}>
        <div className={s.drawerHeader}>
          <h2 className={s.drawerTitle}>{member.childName}</h2>
          <button className={s.drawerClose} onClick={onClose}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Info Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-xl)' }}>
          <EditableField label="Parent" defaultValue={member.parentName} />
          <EditableField label="Phone" defaultValue={member.phone} />
          <EditableField label="Email" defaultValue={member.email} />
          <div>
            <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Status</span><br />
            <span style={{ fontWeight: 700, color: STATUS_COLOR[member.status] || 'var(--tp)', textTransform: 'capitalize' }}>
              {member.status}
            </span>
          </div>
          <DropdownField label="Health" defaultValue={member.health || 'consistent'} options={['consistent', 'at-risk']} colorMap={HEALTH_COLOR} />
          <div>
            <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Plan</span><br />
            <strong>{plan(member.plan)?.name || '-'} {plan(member.plan) ? `($${plan(member.plan).price}/mo)` : ''}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Credits</span><br />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{member.creditsRemaining === 'unlimited' ? 'Unlimited' : `${member.creditsRemaining} / ${member.creditsTotal}`}</strong>
              {member.creditsRemaining !== 'unlimited' && (
                <span style={{ display: 'flex', gap: 4 }}>
                  <button style={{ width: 24, height: 24, borderRadius: 'var(--r-full)', border: '1px solid var(--border)', background: 'var(--surf2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--red)', lineHeight: 1 }}>-</button>
                  <button style={{ width: 24, height: 24, borderRadius: 'var(--r-full)', border: '1px solid var(--border)', background: 'var(--surf2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--green)', lineHeight: 1 }}>+</button>
                </span>
              )}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Next Billing</span><br />
            <strong>{member.nextBilling || '-'}</strong>
          </div>
          <DropdownField label="Trainer" defaultValue={staff(member.trainerConnection)?.name || 'Unassigned'} options={STAFF.map(st => st.name)} />
          <DropdownField label="Group" defaultValue={member.group !== null ? `Group ${member.group}` : 'Unassigned'} options={['Group 0', 'Group 1', 'Group 2', 'Unassigned']} />
          {member.siblingDiscount && (
            <div style={{ gridColumn: '1 / -1', background: 'rgba(200,168,78,0.08)', padding: 'var(--sp-sm)', borderRadius: 'var(--r-sm)' }}>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Sibling discount: 50% off lifetime</span>
            </div>
          )}
        </div>

        {/* Failed Payment Alert */}
        {member.paymentStatus === 'failed' && (
          <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-xl)', fontSize: 'var(--fs-sm)' }}>
            <strong style={{ color: 'var(--red)' }}>Payment Failed</strong> - {member.failureReason} ({member.failureDate})
          </div>
        )}

        {/* Pause Info */}
        {member.status === 'paused' && (
          <div style={{ padding: 'var(--sp-md)', background: 'var(--warnl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-xl)', fontSize: 'var(--fs-sm)' }}>
            <strong>Paused:</strong> {member.pauseStart} - {member.pauseEnd} ({member.pauseReason})
          </div>
        )}

        {/* Actions */}
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-md)' }}>Actions</h3>
        <div style={{ display: 'flex', gap: 'var(--sp-sm)', flexWrap: 'wrap' }}>
          <button className={s.btn}>Message</button>
          <button className={s.btn}>Send Payment Update Link</button>
          {member.status === 'active' && (
            <>
              <button className={s.btn} onClick={() => setShowPauseModal(true)}>Pause</button>
              <button className={s.btn}>Upgrade</button>
              <button className={s.btn}>Downgrade</button>
              <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowCancelModal(true)}>Cancel</button>
              <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setShowRefundModal(true)}>Refund</button>
            </>
          )}
          {member.status === 'paused' && <button className={`${s.btn} ${s.btnGold}`}>Resume</button>}
        </div>

        {/* Notes */}
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Notes</h3>
        <textarea
          defaultValue={member.notes || ''}
          placeholder="Add internal notes about this member..."
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'rgba(224,157,36,0.04)', color: 'var(--tp)', fontFamily: 'var(--ff)', minHeight: 80, resize: 'vertical', borderColor: 'rgba(224,157,36,0.2)' }}
        />

        {/* Message History */}
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Messages</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-sm)', marginBottom: 'var(--sp-sm)' }}>
          {getMessageHistory(member).map((msg, i) => (
            <div key={i} style={{
              alignSelf: msg.from === 'parent' ? 'flex-start' : 'flex-end',
              maxWidth: '80%', padding: 'var(--sp-sm) var(--sp-md)',
              borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)',
              background: msg.from === 'parent' ? 'var(--surf2)' : 'rgba(200,168,78,0.08)',
              border: msg.from === 'parent' ? '1px solid var(--border)' : '1px solid rgba(200,168,78,0.15)',
            }}>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: msg.from === 'parent' ? 'var(--ts)' : 'var(--gold)', marginBottom: 2 }}>
                {msg.from === 'parent' ? member.parentName : 'BAM GTA'}
              </div>
              <div>{msg.text}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 2 }}>{msg.time} - {msg.channel}</div>
            </div>
          ))}
        </div>

        {/* Credit History */}
        <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginTop: 'var(--sp-xl)', marginBottom: 'var(--sp-md)' }}>Credit History</h3>
        <div style={{ fontSize: 'var(--fs-sm)' }}>
          {getCreditHistory(member).map((entry, i) => (
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
          {getAttendanceHistory(member).map((entry, i) => (
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
          {getPaymentHistory(member).map((entry, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{entry.product}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{entry.date}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>${entry.amount.toFixed(2)}</div>
                <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: entry.status === 'paid' ? 'var(--green)' : entry.status === 'refunded' ? 'var(--warn)' : 'var(--red)' }}>
                  {entry.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Modals */}
        {showPauseModal && <PauseModal member={member} onClose={() => setShowPauseModal(false)} />}
        {showCancelModal && <CancelModal member={member} onClose={() => setShowCancelModal(false)} />}
        {showRefundModal && <RefundModal member={member} onClose={() => setShowRefundModal(false)} />}
      </div>
    </div>
  );
}

// Add unbooked attendance entry
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

// Reusable sub-components

function EditableField({ label, defaultValue }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(defaultValue);
  if (editing) {
    return (
      <div>
        <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
        <input autoFocus style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--gold)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 600 }} value={value} onChange={e => setValue(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }} />
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

function DropdownField({ label, defaultValue, options, colorMap }) {
  const [value, setValue] = useState(defaultValue);
  const color = colorMap?.[value];
  return (
    <div>
      <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
      <select value={value} onChange={e => setValue(e.target.value)} style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: color || 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 700, cursor: 'pointer' }}>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function PauseModal({ member, onClose }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const duration = startDate && endDate ? Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) : 0;
  const validDuration = duration >= 14 && duration <= 56;
  const tooShort = duration > 0 && duration < 14;
  const tooLong = duration > 56;
  const newBillingDate = member.nextBilling && duration > 0 ? new Date(new Date(member.nextBilling).getTime() + duration * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>Pause Membership</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-lg)' }}>Pausing <strong>{member.childName}</strong>'s membership. Min 2 weeks, max 8 weeks.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)', marginBottom: 'var(--sp-lg)' }}>
          <div><label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</label><input type="date" style={inputStyle} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
          <div><label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</label><input type="date" style={inputStyle} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
        </div>
        {duration > 0 && <div style={{ padding: 'var(--sp-md)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: tooShort || tooLong ? 'var(--redl)' : 'var(--greenl)', color: tooShort || tooLong ? 'var(--red)' : 'var(--green)', fontWeight: 600, marginBottom: 'var(--sp-lg)' }}>{tooShort ? `${duration} days - minimum is 2 weeks (14 days)` : tooLong ? `${duration} days - maximum is 8 weeks (56 days)` : `${duration} days (${Math.round(duration / 7)} weeks)`}</div>}
        {validDuration && <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-lg)' }}><div style={{ fontWeight: 700, marginBottom: 8 }}>What happens:</div><ul style={{ paddingLeft: 'var(--sp-lg)', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--ts)' }}><li>Credit refresh stops</li><li>Bookings within pause auto-cancelled, credits returned</li><li>Cannot book during pause</li><li>Billing extends by {duration} days: {member.nextBilling} → {newBillingDate}</li><li>Auto-resumes on {endDate}</li></ul></div>}
        <button onClick={validDuration ? onClose : undefined} style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none', background: validDuration ? 'var(--gold)' : 'var(--surf3)', color: validDuration ? '#fff' : 'var(--tm)', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: validDuration ? 'pointer' : 'default', fontFamily: 'var(--ff)' }}>Confirm Pause</button>
      </div>
    </div>
  );
}

function CancelModal({ member, onClose }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const valid = reason.trim().length > 0 && reason !== 'other';
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (confirmed) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <svg width="40" height="40" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '12px 0 8px' }}>Sent for Admin Approval</h2>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>Cancel request for {member.childName} submitted.</div>
        <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)' }}>Done</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--red)', marginBottom: 'var(--sp-lg)' }}>Cancel Membership</h2>
        <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)' }}><strong>Requires Admin approval.</strong></div>
        <div style={{ marginBottom: 'var(--sp-lg)' }}>
          <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason *</label>
          <select style={inputStyle} value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select a reason...</option>
            <option value="Unknown">Unknown</option>
            <option value="Too expensive">Too expensive</option>
            <option value="Not enough time">Not enough time</option>
            <option value="Started other programs">Started other programs</option>
            <option value="Not locked in">Not locked in</option>
            <option value="other">Other</option>
          </select>
          {reason === 'other' && <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Enter reason..." onChange={e => setReason(e.target.value || 'other')} />}
        </div>
        <button onClick={valid ? () => setConfirmed(true) : undefined} style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none', background: valid ? 'var(--red)' : 'var(--surf3)', color: valid ? '#fff' : 'var(--tm)', fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--ff)' }}>Submit for Admin Approval</button>
      </div>
    </div>
  );
}

function RefundModal({ member, onClose }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const lastPayment = PLANS.find(p => p.id === member.plan)?.price || 0;
  const realPayment = member.siblingDiscount ? lastPayment * 0.5 : lastPayment;
  const numAmount = parseFloat(amount) || 0;
  const valid = numAmount > 0 && reason.trim().length > 0;
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (confirmed) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <svg width="40" height="40" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '12px 0 8px' }}>Sent for Admin Approval</h2>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>Refund of ${numAmount.toFixed(2)} submitted.</div>
        <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)' }}>Done</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 440, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--red)', marginBottom: 'var(--sp-lg)' }}>Issue Refund</h2>
        <div style={{ padding: 'var(--sp-md)', background: 'var(--redl)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)' }}><strong>Requires Admin approval.</strong> Last payment: ${realPayment.toFixed(2)}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--sp-md)' }}>
          <button onClick={() => setAmount(realPayment.toFixed(2))} style={{ flex: 1, padding: '8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ff)', background: parseFloat(amount) === realPayment ? 'var(--gold)' : 'var(--surf)', color: parseFloat(amount) === realPayment ? '#fff' : 'var(--ts)' }}>Full (${realPayment.toFixed(2)})</button>
          <button onClick={() => setAmount('')} style={{ flex: 1, padding: '8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--ff)', background: 'var(--surf)', color: 'var(--ts)' }}>Custom</button>
        </div>
        <input type="number" style={{ ...inputStyle, marginBottom: 'var(--sp-md)' }} value={amount} onChange={e => setAmount(e.target.value)} placeholder="$0.00" />
        <div style={{ marginBottom: 'var(--sp-lg)' }}>
          <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason *</label>
          <input style={inputStyle} value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter refund reason..." />
        </div>
        <button onClick={valid ? () => setConfirmed(true) : undefined} style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none', background: valid ? 'var(--red)' : 'var(--surf3)', color: valid ? '#fff' : 'var(--tm)', fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--ff)' }}>Submit for Admin Approval</button>
      </div>
    </div>
  );
}
