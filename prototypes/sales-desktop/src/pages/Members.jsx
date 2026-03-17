import { useState, useMemo } from 'react';
import PageBanner from '../components/PageBanner';
import useTypewriter from '../hooks/useTypewriter';
import s from '../styles/Members.module.css';
import sh from '../styles/shared.module.css';

/* ─── DATA ─── */
const SAGE_PROMPTS = [
  'Pause Ethan Nguyen for 2 weeks...',
  'Send a reminder to members who missed last week...',
  'Show me everyone with failed payments...',
  'Issue a make-up credit to Jaylen Brooks...',
  'Refund $50 to Marcus Davis...',
  'Create an announcement for Saturday clinic...',
];

const QUICK_ACTIONS = [
  { label: 'Send message', icon: '💬', action: 'compose' },
  { label: 'Create announcement', icon: '📢', action: 'announcement' },
  { label: 'Issue refund', icon: '💸', action: 'refund' },
  { label: 'Issue credit', icon: '🎟️', action: 'credit' },
  { label: 'Apply discount', icon: '🏷️', action: 'discount' },
  { label: 'Pause a member', icon: '⏸️', action: 'cmd' },
];

const MEMBERS = [
  { id: 1, name: 'Carlos Martinez', status: 'Active', plan: 'Elite', price: 175, lastSession: 'Mar 14', joined: 'Sep 2025', health: 'green', photo: 'CM', payStatus: 'Current', email: 'carlos.m@email.com', sessions: 38, streak: 4, revenue: 1050 },
  { id: 2, name: 'Mia Thompson', status: 'Active', plan: 'Intermediate', price: 125, lastSession: 'Mar 15', joined: 'Nov 2025', health: 'green', photo: 'MT', payStatus: 'Current', email: 'mia.t@email.com', sessions: 24, streak: 3, revenue: 625 },
  { id: 3, name: 'Jaylen Brooks', status: 'Active', plan: 'Elite', price: 175, lastSession: 'Mar 12', joined: 'Jun 2025', health: 'yellow', photo: 'JB', payStatus: 'Current', email: 'jaylen.b@email.com', sessions: 52, streak: 1, revenue: 1575 },
  { id: 4, name: 'Sofia Reyes', status: 'Trial', plan: 'Free Trial', price: 0, lastSession: 'Mar 16', joined: 'Mar 2026', health: 'green', photo: 'SR', payStatus: '—', email: 'sofia.r@email.com', sessions: 2, streak: 2, revenue: 0 },
  { id: 5, name: 'Ethan Nguyen', status: 'Paused', plan: 'Beginner', price: 95, lastSession: 'Feb 22', joined: 'Aug 2025', health: 'yellow', photo: 'EN', payStatus: 'Paused', email: 'ethan.n@email.com', sessions: 18, streak: 0, revenue: 665 },
  { id: 6, name: 'Ava Chen', status: 'Active', plan: 'Beginner', price: 95, lastSession: 'Mar 13', joined: 'Jan 2026', health: 'green', photo: 'AC', payStatus: 'Current', email: 'ava.c@email.com', sessions: 12, streak: 3, revenue: 285 },
  { id: 7, name: 'Marcus Davis', status: 'Active', plan: 'Intermediate', price: 125, lastSession: 'Mar 11', joined: 'Apr 2025', health: 'red', photo: 'MD', payStatus: 'Failed', email: 'marcus.d@email.com', sessions: 44, streak: 0, revenue: 1375 },
  { id: 8, name: 'Lily Park', status: 'Cancelled', plan: '—', price: 0, lastSession: 'Feb 10', joined: 'Oct 2025', health: 'red', photo: 'LP', payStatus: '—', email: 'lily.p@email.com', sessions: 16, streak: 0, revenue: 475 },
];

const PAUSES = [
  { name: 'Ethan Nguyen', player: 'Ethan Jr.', start: 'Feb 23', resume: 'Mar 23', reason: 'Family vacation', daysLeft: 7 },
  { name: 'Zara Okafor', player: 'Zara', start: 'Mar 1', resume: 'Apr 1', reason: 'Injury recovery', daysLeft: 16 },
];

const ACTIVITY = [
  { type: 'payment', icon: '💳', text: 'Payment received — Carlos Martinez ($175)', time: '2h ago', member: 'Carlos Martinez' },
  { type: 'signup', icon: '🎉', text: 'New trial booked — Sofia Reyes (Saturday 10am)', time: '4h ago', member: 'Sofia Reyes' },
  { type: 'alert', icon: '⚠️', text: 'Payment failed — Marcus Davis ($125)', time: '6h ago', member: 'Marcus Davis' },
  { type: 'pause', icon: '⏸️', text: 'Membership paused — Ethan Nguyen (vacation)', time: '1d ago', member: 'Ethan Nguyen' },
  { type: 'message', icon: '💬', text: 'New reply — Mia Thompson: "Sounds great, see you Saturday!"', time: '1d ago', member: 'Mia Thompson' },
  { type: 'cancel', icon: '🚪', text: 'Cancellation confirmed — Lily Park', time: '3d ago', member: 'Lily Park' },
  { type: 'refund', icon: '💸', text: 'Refund issued — Lily Park ($125, final month)', time: '3d ago', member: 'Lily Park' },
  { type: 'credit', icon: '🎟️', text: 'Make-up credit issued — Jaylen Brooks (Saturday makeup)', time: '4d ago', member: 'Jaylen Brooks' },
  { type: 'announcement', icon: '📢', text: 'Announcement published — "Spring Break Schedule Changes"', time: '5d ago', member: null },
];

const KPIS = [
  { label: 'Active Members', value: '42', trend: '+3', trendUp: true, ref: 'MEM-003a' },
  { label: 'New This Month', value: '6', trend: '+2 vs last', trendUp: true, ref: 'MEM-003b' },
  { label: 'Churned', value: '1', trend: '-1 vs last', trendUp: true, ref: 'MEM-003c' },
  { label: 'Pause Rate', value: '4.8%', trend: 'Stable', trendUp: true, ref: 'MEM-003d' },
  { label: 'Churn Rate', value: '2.4%', trend: 'Healthy', trendUp: true, ref: 'MEM-003g' },
  { label: 'Avg Attendance', value: '8.2', trend: 'per class', trendUp: true, ref: 'MEM-003f' },
  { label: 'Avg Duration', value: '7.4mo', trend: '+0.6 vs last', trendUp: true, ref: 'MEM-003h' },
];

const ANNOUNCEMENTS = [
  { id: 1, title: 'Spring Break Schedule Changes', body: 'All Saturday sessions moved to 11am during March 22–29. Normal schedule resumes March 31.', date: 'Mar 12', status: 'Published', location: 'All Locations' },
  { id: 2, title: 'New Elite Program Starting April', body: 'We\'re launching advanced sessions for competitive players. Contact us for details.', date: 'Mar 8', status: 'Published', location: 'Downtown' },
  { id: 3, title: 'Summer Camp Registration Open', body: 'Early bird pricing available through April 15. Limited spots — register now!', date: 'Mar 5', status: 'Scheduled', location: 'All Locations' },
];

const REFUND_REASONS = ['Billing error', 'Service not delivered', 'Cancellation refund', 'Duplicate charge', 'Customer request', 'Other'];

const MORE_TOOLS = [
  { name: 'Attendance Tracking', icon: '📋', enabled: false, ref: 'MEM-001' },
  { name: 'Waivers & Documents', icon: '📄', enabled: false, ref: 'MEM-008' },
];

/* ─── SUB-COMPONENTS ─── */

/* Compose Message Modal — MEM-002a / MEM-002b */
function ComposeMessage({ onClose }) {
  const [mode, setMode] = useState('direct');
  const [recipient, setRecipient] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const handleSend = () => { setSent(true); setTimeout(onClose, 1800); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Send Message</h3>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={s.modeToggle}>
          <button className={`${s.modeBtn} ${mode === 'direct' ? s.modeBtnActive : ''}`} onClick={() => setMode('direct')}>
            1:1 Message <span className={s.modeRef}>MEM-002a</span>
          </button>
          <button className={`${s.modeBtn} ${mode === 'broadcast' ? s.modeBtnActive : ''}`} onClick={() => setMode('broadcast')}>
            Broadcast <span className={s.modeRef}>MEM-002b</span>
          </button>
        </div>

        {mode === 'direct' ? (
          <div className={s.formGroup}>
            <label className={s.formLabel}>Recipient</label>
            <select className={s.formSelect} value={recipient} onChange={e => setRecipient(e.target.value)}>
              <option value="">Select a member...</option>
              {MEMBERS.filter(m => m.status !== 'Cancelled').map(m => (
                <option key={m.id} value={m.name}>{m.name} — {m.plan}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className={s.formGroup}>
            <label className={s.formLabel}>Audience filter</label>
            <div className={s.filterChips}>
              {['All Active', 'Trial', 'Paused', 'Failed Payment', 'Elite', 'Intermediate', 'Beginner'].map(f => (
                <button
                  key={f}
                  className={`${s.filterChip} ${filterStatus === f ? s.filterChipActive : ''}`}
                  onClick={() => setFilterStatus(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className={s.recipientPreview}>
              {filterStatus === 'All Active' ? '5 members' : filterStatus === 'Elite' ? '2 members' : filterStatus === 'Trial' ? '1 member' : filterStatus === 'Failed Payment' ? '1 member' : '3 members'} will receive this message individually
            </div>
          </div>
        )}

        <div className={s.formGroup}>
          <label className={s.formLabel}>Message</label>
          <textarea
            className={s.formTextarea}
            rows={4}
            placeholder={mode === 'direct' ? 'Type your message...' : 'This message will be sent individually to each recipient...'}
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
        </div>

        <div className={s.sageTipModal}>
          <span className={s.sageTipLabel}>Sage</span>
          <span>{mode === 'direct' ? 'Members receive messages in the BAM app. Replies show up in your inbox.' : 'Each member gets their own copy — they won\'t see other recipients.'}</span>
        </div>

        {sent ? (
          <div className={s.sentConfirm}>Message sent successfully</div>
        ) : (
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={s.btnPrimary} onClick={handleSend} disabled={!message.trim() || (mode === 'direct' && !recipient)}>
              Send {mode === 'broadcast' ? 'to all' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Announcement Editor Modal — MEM-016 */
function AnnouncementEditor({ onClose, existing }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [body, setBody] = useState(existing?.body || '');
  const [location, setLocation] = useState(existing?.location || 'All Locations');
  const [scheduleDate, setScheduleDate] = useState('');
  const [saved, setSaved] = useState(false);

  const handlePublish = () => { setSaved(true); setTimeout(onClose, 1500); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>{existing ? 'Edit Announcement' : 'New Announcement'}</h3>
          <span className={s.modalRef}>MEM-016</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Title</label>
          <input className={s.formInput} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Spring Break Schedule Changes" />
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Body</label>
          <textarea className={s.formTextarea} rows={4} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your announcement..." />
        </div>

        <div className={s.formRow}>
          <div className={s.formGroup} style={{ flex: 1 }}>
            <label className={s.formLabel}>Location</label>
            <select className={s.formSelect} value={location} onChange={e => setLocation(e.target.value)}>
              <option>All Locations</option>
              <option>Downtown</option>
              <option>Westside</option>
            </select>
          </div>
          <div className={s.formGroup} style={{ flex: 1 }}>
            <label className={s.formLabel}>Schedule (optional)</label>
            <input className={s.formInput} type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
          </div>
        </div>

        <div className={s.sageTipModal}>
          <span className={s.sageTipLabel}>Sage</span>
          <span>Announcements appear on the member home page carousel. Members at the selected location will see it on their next login.</span>
        </div>

        {saved ? (
          <div className={s.sentConfirm}>Announcement {scheduleDate ? 'scheduled' : 'published'} successfully</div>
        ) : (
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={s.btnPrimary} onClick={handlePublish} disabled={!title.trim() || !body.trim()}>
              {scheduleDate ? 'Schedule' : 'Publish now'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Refund Modal — MEM-047 / MEM-047a */
function RefundModal({ onClose, member }) {
  const [step, setStep] = useState('form');
  const [refundType, setRefundType] = useState('full');
  const [amount, setAmount] = useState(member ? String(member.price) : '');
  const [reason, setReason] = useState('');

  const handleConfirm = () => { setStep('done'); setTimeout(onClose, 1800); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Issue Refund</h3>
          <span className={s.modalRef}>MEM-047</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        {step === 'form' && (
          <>
            {member && (
              <div className={s.refundMemberCard}>
                <div className={s.refundAvatar}>{member.photo}</div>
                <div>
                  <div className={s.refundMemberName}>{member.name}</div>
                  <div className={s.refundMemberPlan}>{member.plan} — ${member.price}/mo</div>
                </div>
              </div>
            )}

            {!member && (
              <div className={s.formGroup}>
                <label className={s.formLabel}>Member</label>
                <select className={s.formSelect}>
                  <option value="">Select a member...</option>
                  {MEMBERS.filter(m => m.status !== 'Cancelled').map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={s.formGroup}>
              <label className={s.formLabel}>Refund type</label>
              <div className={s.radioGroup}>
                <label className={`${s.radioOption} ${refundType === 'full' ? s.radioActive : ''}`}>
                  <input type="radio" name="refundType" value="full" checked={refundType === 'full'} onChange={() => { setRefundType('full'); if (member) setAmount(String(member.price)); }} />
                  <span>Full refund</span>
                </label>
                <label className={`${s.radioOption} ${refundType === 'partial' ? s.radioActive : ''}`}>
                  <input type="radio" name="refundType" value="partial" checked={refundType === 'partial'} onChange={() => setRefundType('partial')} />
                  <span>Partial refund</span>
                </label>
              </div>
            </div>

            <div className={s.formGroup}>
              <label className={s.formLabel}>Amount</label>
              <div className={s.inputWithPrefix}>
                <span className={s.inputPrefix}>$</span>
                <input className={s.formInput} type="number" value={amount} onChange={e => setAmount(e.target.value)} disabled={refundType === 'full'} />
              </div>
            </div>

            <div className={s.formGroup}>
              <label className={s.formLabel}>Reason (required)</label>
              <select className={s.formSelect} value={reason} onChange={e => setReason(e.target.value)}>
                <option value="">Select a reason...</option>
                {REFUND_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className={s.modalFooter}>
              <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
              <button className={s.btnPrimary} onClick={() => setStep('confirm')} disabled={!reason || !amount}>
                Review refund
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className={s.confirmCard}>
              <div className={s.confirmRow}><span>Member</span><span>{member?.name || 'Selected member'}</span></div>
              <div className={s.confirmRow}><span>Amount</span><span className={s.confirmAmount}>${amount}</span></div>
              <div className={s.confirmRow}><span>Type</span><span>{refundType === 'full' ? 'Full refund' : 'Partial refund'}</span></div>
              <div className={s.confirmRow}><span>Reason</span><span>{reason}</span></div>
            </div>
            <div className={s.confirmWarning}>
              This action cannot be undone. The refund will be processed to the original payment method via Stripe.
            </div>
            <div className={s.modalFooter}>
              <button className={s.btnSecondary} onClick={() => setStep('form')}>Back</button>
              <button className={s.btnDanger} onClick={handleConfirm}>Confirm refund — ${amount}</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className={s.sentConfirm}>Refund of ${amount} processed successfully</div>
        )}
      </div>
    </div>
  );
}

/* Discount Modal — MEM-023 */
function DiscountModal({ onClose }) {
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('percentage');
  const [value, setValue] = useState('');
  const [duration, setDuration] = useState('once');
  const [saved, setSaved] = useState(false);

  const handleCreate = () => { setSaved(true); setTimeout(onClose, 1500); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Create Discount Code</h3>
          <span className={s.modalRef}>MEM-023</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Promo code</label>
          <input className={s.formInput} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. SPRING25" />
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Discount type</label>
          <div className={s.radioGroup}>
            {[['percentage', '% Off'], ['fixed', '$ Off'], ['free', 'Free Months']].map(([val, label]) => (
              <label key={val} className={`${s.radioOption} ${discountType === val ? s.radioActive : ''}`}>
                <input type="radio" name="discType" value={val} checked={discountType === val} onChange={() => setDiscountType(val)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>{discountType === 'percentage' ? 'Percentage' : discountType === 'fixed' ? 'Amount' : 'Number of months'}</label>
          <div className={s.inputWithPrefix}>
            <span className={s.inputPrefix}>{discountType === 'percentage' ? '%' : discountType === 'fixed' ? '$' : '#'}</span>
            <input className={s.formInput} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder={discountType === 'percentage' ? '25' : discountType === 'fixed' ? '50' : '1'} />
          </div>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Duration</label>
          <div className={s.radioGroup}>
            {[['once', 'One-time'], ['recurring', 'Recurring']].map(([val, label]) => (
              <label key={val} className={`${s.radioOption} ${duration === val ? s.radioActive : ''}`}>
                <input type="radio" name="dur" value={val} checked={duration === val} onChange={() => setDuration(val)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={s.sageTipModal}>
          <span className={s.sageTipLabel}>Sage</span>
          <span>Codes are created as Stripe coupons. You can track redemptions and revoke anytime from the member's profile.</span>
        </div>

        {saved ? (
          <div className={s.sentConfirm}>Discount code {code} created</div>
        ) : (
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={s.btnPrimary} onClick={handleCreate} disabled={!code.trim() || !value}>Create code</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Make-up Credit Modal — MEM-026 */
function CreditModal({ onClose, member }) {
  const [creditType, setCreditType] = useState('class_cancel');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  const handleIssue = () => { setSaved(true); setTimeout(onClose, 1500); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Issue Make-up Credit</h3>
          <span className={s.modalRef}>MEM-026</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        {member && (
          <div className={s.refundMemberCard}>
            <div className={s.refundAvatar}>{member.photo}</div>
            <div>
              <div className={s.refundMemberName}>{member.name}</div>
              <div className={s.refundMemberPlan}>{member.plan} — ${member.price}/mo</div>
            </div>
          </div>
        )}

        {!member && (
          <div className={s.formGroup}>
            <label className={s.formLabel}>Member</label>
            <select className={s.formSelect}>
              <option value="">Select a member...</option>
              {MEMBERS.filter(m => m.status !== 'Cancelled').map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className={s.formGroup}>
          <label className={s.formLabel}>Reason</label>
          <div className={s.radioGroup}>
            {[['class_cancel', 'Class cancelled'], ['weather', 'Weather closure'], ['coach', 'Coach request'], ['other', 'Other']].map(([val, label]) => (
              <label key={val} className={`${s.radioOption} ${creditType === val ? s.radioActive : ''}`}>
                <input type="radio" name="creditType" value={val} checked={creditType === val} onChange={() => setCreditType(val)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Note (optional)</label>
          <input className={s.formInput} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Saturday session cancelled due to facility maintenance" />
        </div>

        <div className={s.creditInfo}>
          <div className={s.creditInfoRow}><span>Credit value</span><span>1 make-up session</span></div>
          <div className={s.creditInfoRow}><span>Expires</span><span>30 days from issue</span></div>
          <div className={s.creditInfoRow}><span>Redeemable on</span><span>Any equivalent class</span></div>
        </div>

        {saved ? (
          <div className={s.sentConfirm}>Make-up credit issued</div>
        ) : (
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={s.btnPrimary} onClick={handleIssue}>Issue credit</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Full Dashboard Overlay — MEM-003 deep view */
function FullDashboard({ onClose }) {
  const [period, setPeriod] = useState('This Month');
  return (
    <div className={s.dashFull}>
      <div className={s.dashHead}>
        <button className={s.dashBack} onClick={onClose}>← Back</button>
        <h2 className={s.dashTitle}>Member Metrics Dashboard</h2>
        <div className={s.dashPeriod}>
          {['This Week', 'This Month', 'This Quarter', 'All Time'].map(p => (
            <button key={p} className={`${s.dashPeriodBtn} ${period === p ? s.dashPeriodActive : ''}`} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className={s.dashBody}>
        <div className={s.dashGrid}>
          {KPIS.map(k => (
            <div key={k.label} className={s.dashMetric}>
              <div className={s.dashMetricLabel}>{k.label}</div>
              <div className={s.dashMetricValue}>{k.value}</div>
              <div className={s.dashMetricTrend}>{k.trend}</div>
              <div className={s.dashMetricRef}>{k.ref}</div>
            </div>
          ))}
        </div>

        <div className={s.dashSection}>
          <h3 className={s.dashSectionTitle}>Revenue Overview <span className={s.dashSectionRef}>MEM-024</span></h3>
          <div className={s.dashRevenueGrid}>
            <div className={s.dashRevenueCard}>
              <div className={s.dashRevLabel}>MRR</div>
              <div className={s.dashRevValue}>$5,295</div>
              <div className={s.dashRevTrend}>+$370 vs last month</div>
            </div>
            <div className={s.dashRevenueCard}>
              <div className={s.dashRevLabel}>Avg Revenue / Member</div>
              <div className={s.dashRevValue}>$126</div>
              <div className={s.dashRevTrend}>+$4 vs last month</div>
            </div>
            <div className={s.dashRevenueCard}>
              <div className={s.dashRevLabel}>Projected LTV</div>
              <div className={s.dashRevValue}>$932</div>
              <div className={s.dashRevTrend}>Based on 7.4mo avg duration</div>
            </div>
            <div className={s.dashRevenueCard}>
              <div className={s.dashRevLabel}>Total Lifetime Revenue</div>
              <div className={s.dashRevValue}>$6,050</div>
              <div className={s.dashRevTrend}>All members, all time</div>
            </div>
          </div>
        </div>

        <div className={s.dashSection}>
          <h3 className={s.dashSectionTitle}>Membership Breakdown</h3>
          <div className={s.dashBreakdownGrid}>
            {[
              { plan: 'Elite ($175)', count: 2, pct: '33%', revenue: '$350/mo' },
              { plan: 'Intermediate ($125)', count: 2, pct: '33%', revenue: '$250/mo' },
              { plan: 'Beginner ($95)', count: 2, pct: '33%', revenue: '$190/mo' },
              { plan: 'Trial (Free)', count: 1, pct: '—', revenue: '$0' },
            ].map(p => (
              <div key={p.plan} className={s.dashBreakdownRow}>
                <span className={s.dashBreakdownPlan}>{p.plan}</span>
                <span className={s.dashBreakdownCount}>{p.count} members ({p.pct})</span>
                <span className={s.dashBreakdownRev}>{p.revenue}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={s.dashSection}>
          <h3 className={s.dashSectionTitle}>Payment Status</h3>
          <div className={s.dashPayGrid}>
            <div className={s.dashPayCard}><span className={s.dashPayLabel}>Current</span><span className={s.dashPayValue}>5</span></div>
            <div className={s.dashPayCard}><span className={s.dashPayLabel}>Paused</span><span className={`${s.dashPayValue} ${s.dashPayWarn}`}>1</span></div>
            <div className={s.dashPayCard}><span className={s.dashPayLabel}>Failed</span><span className={`${s.dashPayValue} ${s.dashPayDanger}`}>1</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ─── MAIN COMPONENT ─── */
export default function Members() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawerMember, setDrawerMember] = useState(null);
  const [tab, setTab] = useState('directory');
  const [cmdInput, setCmdInput] = useState('');
  const [cmdResponse, setCmdResponse] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const typewriterText = useTypewriter(SAGE_PROMPTS);

  /* View & sort state for directory */
  const [viewMode, setViewMode] = useState('table');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  /* Modal state */
  const [composeOpen, setComposeOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [editAnnouncement, setEditAnnouncement] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMember, setRefundMember] = useState(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditMember, setCreditMember] = useState(null);
  const [dashOpen, setDashOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState('all');

  const activeCount = MEMBERS.filter(m => m.status === 'Active').length;
  const pausedCount = MEMBERS.filter(m => m.status === 'Paused').length;

  /* Quick action handler */
  const handleQuickAction = (action, text) => {
    if (action === 'compose') return setComposeOpen(true);
    if (action === 'announcement') return setAnnouncementOpen(true);
    if (action === 'refund') { setRefundMember(null); return setRefundOpen(true); }
    if (action === 'credit') { setCreditMember(null); return setCreditOpen(true); }
    if (action === 'discount') return setDiscountOpen(true);
    handleCommand(text);
  };

  const handleCommand = (text) => {
    const cmd = text || cmdInput;
    if (!cmd.trim()) return;
    setCmdResponse({
      input: cmd,
      reply: `Got it — I'll ${cmd.toLowerCase().startsWith('show') || cmd.toLowerCase().startsWith('find') ? 'pull that up' : 'take care of that'} for you. Processing "${cmd}"...`,
      actions: cmd.toLowerCase().includes('pause') ? ['Confirm pause', 'Edit dates', 'Cancel']
        : cmd.toLowerCase().includes('cancel') ? ['Confirm cancellation', 'Process final invoice', 'Cancel']
        : cmd.toLowerCase().includes('refund') ? ['Issue full refund', 'Partial refund', 'Cancel']
        : ['Confirm', 'Edit', 'Cancel'],
    });
    setCmdInput('');
  };

  const toggleListening = () => {
    setIsListening(!isListening);
    if (!isListening) {
      setTimeout(() => {
        setIsListening(false);
        setCmdInput('Pause Ethan Nguyen for 2 weeks — family vacation');
      }, 2500);
    }
  };

  /* Sorting */
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    let list = MEMBERS.filter(m => {
      const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'All' || m.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    list.sort((a, b) => {
      let av, bv;
      if (sortCol === 'name') { av = a.name; bv = b.name; }
      else if (sortCol === 'status') { av = a.status; bv = b.status; }
      else if (sortCol === 'plan') { av = a.plan; bv = b.plan; }
      else if (sortCol === 'session') { av = a.lastSession; bv = b.lastSession; }
      else if (sortCol === 'payment') { av = a.payStatus; bv = b.payStatus; }
      else { av = a.name; bv = b.name; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [search, statusFilter, sortCol, sortDir]);

  const filteredActivity = activityFilter === 'all' ? ACTIVITY : ACTIVITY.filter(a => a.type === activityFilter);

  const healthColor = h => h === 'green' ? s.healthGreen : h === 'yellow' ? s.healthYellow : s.healthRed;
  const statusClass = st =>
    st === 'Active' ? s.statusActive :
    st === 'Paused' ? s.statusPaused :
    st === 'Trial' ? s.statusTrial : s.statusCancelled;

  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const openMemberInDrawer = (memberName) => {
    const m = MEMBERS.find(mb => mb.name === memberName);
    if (m) setDrawerMember(m);
  };

  if (dashOpen) return <FullDashboard onClose={() => setDashOpen(false)} />;

  return (
    <main className={sh.main}>
      <PageBanner
        title="Members"
        stats={[
          { value: `${activeCount} Active`, explanation: 'Active members' },
          { value: `${pausedCount} Paused`, explanation: 'Paused members' },
          { value: '2.4% Churn', explanation: 'Monthly churn rate' },
        ]}
        onDashboardClick={() => setDashOpen(true)}
      />

      <div className={sh.scroll}>
        {/* Sage Command Bar */}
        <div className={s.cmdBar}>
          <div className={s.cmdHeader}>
            <div className={s.cmdSageIcon}>S</div>
            <div className={s.cmdHeaderText}>
              <div className={s.cmdTitle}>Manage your members</div>
              <div className={s.cmdSubtitle}>Tell Sage what you need — type or use your voice</div>
            </div>
          </div>

          <div className={s.cmdInputWrap}>
            <div className={`${s.cmdMic} ${isListening ? s.cmdMicActive : ''}`} onClick={toggleListening}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              {isListening && <div className={s.cmdMicPulse} />}
            </div>
            <div className={s.cmdInputInner}>
              <input
                className={s.cmdInput}
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                placeholder={typewriterText}
                onKeyDown={e => e.key === 'Enter' && handleCommand()}
              />
              {isListening && <span className={s.cmdListeningBadge}>Listening...</span>}
            </div>
            <button className={s.cmdSend} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>

          <div className={s.cmdChips}>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} className={s.cmdChip} onClick={() => handleQuickAction(a.action, a.label)}>
                <span>{a.icon}</span> {a.label}
              </button>
            ))}

            {/* More tools dropdown */}
            <div className={s.moreToolsWrap}>
              <button className={s.cmdChipMore} onClick={() => setMoreToolsOpen(!moreToolsOpen)}>
                ⚙️ More tools <span className={s.moreChevron}>{moreToolsOpen ? '▲' : '▼'}</span>
              </button>
              {moreToolsOpen && (
                <div className={s.moreToolsDrop}>
                  {MORE_TOOLS.map(t => (
                    <div key={t.name} className={`${s.moreToolItem} ${!t.enabled ? s.moreToolDisabled : ''}`}>
                      <span className={s.moreToolIcon}>{t.icon}</span>
                      <span className={s.moreToolName}>{t.name}</span>
                      <span className={s.moreToolRef}>{t.ref}</span>
                      {!t.enabled && <span className={s.moreToolBadge}>Coming soon</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {cmdResponse && (
            <div className={s.cmdResponse}>
              <div className={s.cmdResponseQ}>You said: &ldquo;{cmdResponse.input}&rdquo;</div>
              <div className={s.cmdResponseA}>{cmdResponse.reply}</div>
              <div className={s.cmdResponseActions}>
                {cmdResponse.actions.map(a => (
                  <button
                    key={a}
                    className={a === 'Cancel' ? s.cmdActionCancel : s.cmdActionConfirm}
                    onClick={() => setCmdResponse(null)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tab nav */}
        <div className={s.tabBar}>
          {['directory', 'metrics', 'pauses', 'activity', 'announcements'].map(t => (
            <button
              key={t}
              className={`${s.tabBtn} ${tab === t ? s.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'directory' ? 'Directory' : t === 'metrics' ? 'Business Metrics' : t === 'pauses' ? 'Pauses' : t === 'activity' ? 'Activity Feed' : 'Announcements'}
            </button>
          ))}
        </div>

        {/* ═══ DIRECTORY TAB ═══ */}
        {tab === 'directory' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Member Directory</h3>
              <div className={s.sectionActions}>
                <div className={s.viewToggle}>
                  <button className={`${s.viewBtn} ${viewMode === 'table' ? s.viewBtnActive : ''}`} onClick={() => setViewMode('table')} title="Table view">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
                  </button>
                  <button className={`${s.viewBtn} ${viewMode === 'card' ? s.viewBtnActive : ''}`} onClick={() => setViewMode('card')} title="Card view">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  </button>
                </div>
                <span className={s.sectionRef}>MEM-011</span>
              </div>
            </div>

            <div className={s.filterRow}>
              <input
                className={s.searchInput}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name..."
              />
              <select
                className={s.filterSelect}
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option>All</option>
                <option>Active</option>
                <option>Paused</option>
                <option>Trial</option>
                <option>Cancelled</option>
              </select>
              <button className={s.btnAction} onClick={() => setComposeOpen(true)}>💬 Send message</button>
            </div>

            {viewMode === 'table' ? (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.sortable} onClick={() => handleSort('name')}>Member{sortIcon('name')}</th>
                      <th className={s.sortable} onClick={() => handleSort('status')}>Status{sortIcon('status')}</th>
                      <th className={s.sortable} onClick={() => handleSort('plan')}>Plan{sortIcon('plan')}</th>
                      <th className={s.sortable} onClick={() => handleSort('session')}>Last Session{sortIcon('session')}</th>
                      <th className={s.sortable} onClick={() => handleSort('payment')}>Payment{sortIcon('payment')}</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(m => (
                      <tr key={m.id} className={s.tableRow} onClick={() => setDrawerMember(m)}>
                        <td>
                          <div className={s.memberCell}>
                            <div className={s.avatar}>{m.photo}</div>
                            <div>
                              <div className={s.memberName}>{m.name}</div>
                              <div className={s.memberJoined}>Joined {m.joined}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className={statusClass(m.status)}>{m.status}</span></td>
                        <td className={s.planCell}>{m.plan} {m.price ? `($${m.price}/mo)` : ''}</td>
                        <td className={s.sessionCell}>{m.lastSession}</td>
                        <td><span className={m.payStatus === 'Failed' ? s.payFailed : s.payNormal}>{m.payStatus}</span></td>
                        <td><span className={`${s.healthDot} ${healthColor(m.health)}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && <div className={s.emptyState}>No members match your search.</div>}
              </div>
            ) : (
              /* Card view — MEM-011a */
              <div className={s.cardGrid}>
                {filtered.map(m => (
                  <div key={m.id} className={s.memberCard} onClick={() => setDrawerMember(m)}>
                    <div className={s.memberCardTop}>
                      <div className={s.cardAvatar}>{m.photo}</div>
                      <span className={`${s.healthDot} ${healthColor(m.health)}`} />
                    </div>
                    <div className={s.cardName}>{m.name}</div>
                    <span className={statusClass(m.status)}>{m.status}</span>
                    <div className={s.cardMeta}>
                      <span>{m.plan} {m.price ? `$${m.price}` : ''}</span>
                      <span>Last: {m.lastSession}</span>
                    </div>
                    {m.payStatus === 'Failed' && <span className={s.payFailed}>Payment Failed</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ METRICS TAB ═══ */}
        {tab === 'metrics' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Business Metrics</h3>
              <span className={s.sectionRef}>MEM-003</span>
            </div>
            <div className={s.kpiGrid}>
              {KPIS.map(k => (
                <div key={k.label} className={s.kpiCard}>
                  <div className={s.kpiLabel}>{k.label}</div>
                  <div className={s.kpiValue}>{k.value}</div>
                  <div className={s.kpiTrend}>
                    <span className={k.trendUp ? s.trendUp : s.trendDown}>{k.trend}</span>
                    <span className={s.kpiRef}>{k.ref}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Your churn rate dropped below 3% this month — the Saturday trial pipeline is converting into long-term members. Keep the Saturday energy going.</span>
            </div>
          </>
        )}

        {/* ═══ PAUSES TAB ═══ */}
        {tab === 'pauses' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Active Pauses</h3>
              <span className={s.sectionRef}>MEM-012</span>
            </div>
            {PAUSES.map(p => (
              <div key={p.name} className={s.pauseCard}>
                <div className={s.pauseLeft}>
                  <div className={s.pauseName}>{p.name}</div>
                  <div className={s.pauseMeta}>
                    <span>{p.start} → {p.resume}</span>
                    <span>•</span>
                    <span>{p.reason}</span>
                  </div>
                </div>
                <div className={s.pauseRight}>
                  <span className={s.pauseDays}>{p.daysLeft}d left</span>
                  <button className={s.pauseAction}>Resume early</button>
                  <button className={s.pauseAction}>Extend</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ═══ ACTIVITY TAB ═══ */}
        {tab === 'activity' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Activity Feed</h3>
              <span className={s.sectionRef}>MEM-013</span>
            </div>
            <div className={s.feedFilterRow}>
              {['all', 'payment', 'signup', 'alert', 'pause', 'message', 'cancel', 'refund', 'credit', 'announcement'].map(f => (
                <button
                  key={f}
                  className={`${s.feedFilterBtn} ${activityFilter === f ? s.feedFilterActive : ''}`}
                  onClick={() => setActivityFilter(f)}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className={s.feedList}>
              {filteredActivity.map((a, i) => (
                <div key={i} className={s.feedCard}>
                  <div className={s.feedIcon}>{a.icon}</div>
                  <div className={s.feedBody}>
                    <div className={s.feedText}>
                      {a.member ? (
                        <>
                          {a.text.split(a.member)[0]}
                          <span className={s.feedMemberLink} onClick={() => openMemberInDrawer(a.member)}>{a.member}</span>
                          {a.text.split(a.member).slice(1).join(a.member)}
                        </>
                      ) : a.text}
                    </div>
                    <div className={s.feedTime}>{a.time}</div>
                  </div>
                </div>
              ))}
              {filteredActivity.length === 0 && <div className={s.emptyState}>No activity matching this filter.</div>}
            </div>
          </>
        )}

        {/* ═══ ANNOUNCEMENTS TAB ═══ */}
        {tab === 'announcements' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Announcements</h3>
              <div className={s.sectionActions}>
                <button className={s.btnPrimary} onClick={() => { setEditAnnouncement(null); setAnnouncementOpen(true); }}>+ New announcement</button>
                <span className={s.sectionRef}>MEM-016</span>
              </div>
            </div>

            <div className={s.announceList}>
              {ANNOUNCEMENTS.map(a => (
                <div key={a.id} className={s.announceCard}>
                  <div className={s.announceTop}>
                    <div className={s.announceTitle}>{a.title}</div>
                    <span className={a.status === 'Published' ? s.announcePublished : s.announceScheduled}>{a.status}</span>
                  </div>
                  <div className={s.announceBody}>{a.body}</div>
                  <div className={s.announceMeta}>
                    <span>{a.date}</span>
                    <span>•</span>
                    <span>{a.location}</span>
                    <button className={s.announceEdit} onClick={() => { setEditAnnouncement(a); setAnnouncementOpen(true); }}>Edit</button>
                  </div>
                </div>
              ))}
            </div>

            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Announcements appear in the member app home page carousel. Schedule them ahead of time so members see updates on login.</span>
            </div>
          </>
        )}
      </div>

      {/* ═══ 360° DRAWER ═══ */}
      {drawerMember && (
        <div className={s.drawerOverlay} onClick={() => setDrawerMember(null)}>
          <div className={s.drawer} onClick={e => e.stopPropagation()}>
            <button className={s.drawerClose} onClick={() => setDrawerMember(null)}>✕</button>
            <div className={s.drawerHeader}>
              <div className={s.drawerAvatar}>{drawerMember.photo}</div>
              <div>
                <div className={s.drawerName}>{drawerMember.name}</div>
                <span className={statusClass(drawerMember.status)}>{drawerMember.status}</span>
              </div>
            </div>

            {/* Drawer quick actions */}
            <div className={s.drawerActions}>
              <button className={s.drawerActionBtn} onClick={() => setComposeOpen(true)}>💬 Message</button>
              <button className={s.drawerActionBtn} onClick={() => { setRefundMember(drawerMember); setRefundOpen(true); }}>💸 Refund</button>
              <button className={s.drawerActionBtn} onClick={() => { setCreditMember(drawerMember); setCreditOpen(true); }}>🎟️ Credit</button>
              <button className={s.drawerActionBtn} onClick={() => setDiscountOpen(true)}>🏷️ Discount</button>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Membership</div>
              <div className={s.drawerRow}><span>Plan</span><span>{drawerMember.plan} {drawerMember.price ? `($${drawerMember.price}/mo)` : ''}</span></div>
              <div className={s.drawerRow}><span>Joined</span><span>{drawerMember.joined}</span></div>
              <div className={s.drawerRow}><span>Payment</span><span>{drawerMember.payStatus}</span></div>
              <div className={s.drawerRow}><span>Lifetime revenue</span><span>${drawerMember.revenue}</span></div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Attendance</div>
              <div className={s.drawerRow}><span>Last session</span><span>{drawerMember.lastSession}</span></div>
              <div className={s.drawerRow}><span>Total sessions</span><span>{drawerMember.sessions}</span></div>
              <div className={s.drawerRow}><span>Current streak</span><span>{drawerMember.streak} weeks</span></div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Credits & Discounts</div>
              <div className={s.drawerRow}><span>Make-up credits</span><span>1 available</span></div>
              <div className={s.drawerRow}><span>Active discounts</span><span>—</span></div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Internal Notes</div>
              <div className={s.drawerNote}>Interested in upgrading to Elite next month. Dad asked about sibling discount. — Coach Z, Mar 10</div>
              <input className={s.drawerNoteInput} placeholder="Add a note..." />
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══ */}
      {composeOpen && <ComposeMessage onClose={() => setComposeOpen(false)} />}
      {announcementOpen && <AnnouncementEditor onClose={() => { setAnnouncementOpen(false); setEditAnnouncement(null); }} existing={editAnnouncement} />}
      {refundOpen && <RefundModal onClose={() => { setRefundOpen(false); setRefundMember(null); }} member={refundMember} />}
      {discountOpen && <DiscountModal onClose={() => setDiscountOpen(false)} />}
      {creditOpen && <CreditModal onClose={() => { setCreditOpen(false); setCreditMember(null); }} member={creditMember} />}
    </main>
  );
}
