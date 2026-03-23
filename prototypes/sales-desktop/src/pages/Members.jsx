import { useState, useMemo, useRef } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useTypewriter from '../hooks/useTypewriter';
import { useLocation } from '../context/LocationContext';
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

const QA_ICONS = {
  compose: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  announcement: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  refund: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  credit: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  discount: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  cmd: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
};

const QUICK_ACTIONS = [
  { label: 'Send message', icon: 'compose', action: 'compose' },
  { label: 'Create announcement', icon: 'announcement', action: 'announcement' },
  { label: 'Issue refund', icon: 'refund', action: 'refund' },
  { label: 'Issue credit', icon: 'credit', action: 'credit' },
  { label: 'Extend member', icon: 'credit', action: 'extend' },
  { label: 'Apply discount', icon: 'discount', action: 'discount' },
  { label: 'Pause a member', icon: 'cmd', action: 'cmd' },
];

const MEMBERS = [
  { id: 1, name: 'Carlos Martinez', status: 'Active', plan: 'Elite', price: 175, lastSession: 'Mar 14', joined: 'Sep 2025', health: 'green', photo: 'CM', payStatus: 'Current', email: 'carlos.m@email.com', sessions: 38, streak: 4, revenue: 1050, location: 'Downtown' },
  { id: 2, name: 'Mia Thompson', status: 'Active', plan: 'Intermediate', price: 125, lastSession: 'Mar 15', joined: 'Nov 2025', health: 'green', photo: 'MT', payStatus: 'Current', email: 'mia.t@email.com', sessions: 24, streak: 3, revenue: 625, location: 'Downtown' },
  { id: 3, name: 'Jaylen Brooks', status: 'Active', plan: 'Elite', price: 175, lastSession: 'Mar 12', joined: 'Jun 2025', health: 'yellow', photo: 'JB', payStatus: 'Current', email: 'jaylen.b@email.com', sessions: 52, streak: 1, revenue: 1575, location: 'Downtown' },
  { id: 4, name: 'Sofia Reyes', status: 'Trial', plan: 'Free Trial', price: 0, lastSession: 'Mar 16', joined: 'Mar 2026', health: 'green', photo: 'SR', payStatus: '—', email: 'sofia.r@email.com', sessions: 2, streak: 2, revenue: 0, location: 'Downtown' },
  { id: 5, name: 'Ethan Nguyen', status: 'Paused', plan: 'Beginner', price: 95, lastSession: 'Feb 22', joined: 'Aug 2025', health: 'yellow', photo: 'EN', payStatus: 'Paused', email: 'ethan.n@email.com', sessions: 18, streak: 0, revenue: 665, location: 'Westside' },
  { id: 6, name: 'Ava Chen', status: 'Active', plan: 'Beginner', price: 95, lastSession: 'Mar 13', joined: 'Jan 2026', health: 'green', photo: 'AC', payStatus: 'Current', email: 'ava.c@email.com', sessions: 12, streak: 3, revenue: 285, location: 'Westside' },
  { id: 7, name: 'Marcus Davis', status: 'Active', plan: 'Intermediate', price: 125, lastSession: 'Mar 11', joined: 'Apr 2025', health: 'red', photo: 'MD', payStatus: 'Failed', email: 'marcus.d@email.com', sessions: 44, streak: 0, revenue: 1375, location: 'Westside' },
  { id: 8, name: 'Lily Park', status: 'Cancelled', plan: '—', price: 0, lastSession: 'Feb 10', joined: 'Oct 2025', health: 'red', photo: 'LP', payStatus: '—', email: 'lily.p@email.com', sessions: 16, streak: 0, revenue: 475, location: 'Westside' },
];

const PAUSES = [
  { name: 'Ethan Nguyen', player: 'Ethan Jr.', start: 'Feb 23', resume: 'Mar 23', reason: 'Family vacation', daysLeft: 7, location: 'Westside' },
  { name: 'Zara Okafor', player: 'Zara', start: 'Mar 1', resume: 'Apr 1', reason: 'Injury recovery', daysLeft: 16, location: 'Downtown' },
];

const ACTIVITY_ICONS = {
  payment: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  signup: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  alert: <svg width="16" height="16" fill="none" stroke="var(--red)" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  pause: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  message: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  cancel: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  refund: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  credit: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  announcement: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
};

const ACTIVITY = [
  { type: 'payment', text: 'Payment received — Carlos Martinez ($175)', time: '2h ago', member: 'Carlos Martinez', location: 'Downtown' },
  { type: 'signup', text: 'New trial booked — Sofia Reyes (Saturday 10am)', time: '4h ago', member: 'Sofia Reyes', location: 'Downtown' },
  { type: 'alert', text: 'Payment failed — Marcus Davis ($125)', time: '6h ago', member: 'Marcus Davis', location: 'Westside' },
  { type: 'pause', text: 'Membership paused — Ethan Nguyen (vacation)', time: '1d ago', member: 'Ethan Nguyen', location: 'Westside' },
  { type: 'message', text: 'New reply — Mia Thompson: "Sounds great, see you Saturday!"', time: '1d ago', member: 'Mia Thompson', location: 'Downtown' },
  { type: 'cancel', text: 'Cancellation confirmed — Lily Park', time: '3d ago', member: 'Lily Park', location: 'Westside' },
  { type: 'refund', text: 'Refund issued — Lily Park ($125, final month)', time: '3d ago', member: 'Lily Park', location: 'Westside' },
  { type: 'credit', text: 'Make-up credit issued — Jaylen Brooks (Saturday makeup)', time: '4d ago', member: 'Jaylen Brooks', location: 'Downtown' },
  { type: 'announcement', text: 'Announcement published — "Spring Break Schedule Changes"', time: '5d ago', member: null, location: null },
];

const KPIS = [
  { label: 'Active Members', value: '42', trend: '+3', trendUp: true, ref: 'MEM-003a', explain: 'Members with an active, non-paused subscription right now. This is your core headcount.', pb: true },
  { label: 'New This Month', value: '6', trend: '+2 vs last', trendUp: true, ref: 'MEM-003b', explain: 'Members who started their first subscription this month. Shows how fast you\'re growing.', pb: false },
  { label: 'Churned (30d)', value: '1', trend: '-1 vs last', trendUp: true, ref: 'MEM-003c', explain: 'Members who cancelled in the last 30 days. This is not month to date — it is calculated over a rolling 30-day window.', pb: true },
  { label: 'Pause Rate (30d)', value: '4.8%', trend: 'Stable', trendUp: true, ref: 'MEM-003d', explain: 'Percentage of active members who paused in the last 30 days. This is not month to date — it is calculated over a rolling 30-day window.', pb: false },
  { label: 'Churn Rate (30d)', value: '2.4%', trend: 'Healthy', trendUp: true, ref: 'MEM-003g', explain: 'Percentage of members who cancelled in the last 30 days. This is not month to date — it is calculated over a rolling 30-day window. Under 5% is strong.', pb: true },
  { label: 'Avg Attendance', value: '8.2', trend: 'per class', trendUp: true, ref: 'MEM-003f', explain: 'Average number of athletes per session. Higher attendance means better class utilization and energy.', pb: false },
  { label: 'Avg Duration', value: '7.4mo', trend: '+0.6 vs last', trendUp: true, ref: 'MEM-003h', explain: 'How long members stay on average before cancelling. Longer duration = more lifetime revenue per member.', pb: true },
];

const ANNOUNCEMENTS = [
  { id: 1, title: 'Spring Break Schedule Changes', body: 'All Saturday sessions moved to 11am during March 22–29. Normal schedule resumes March 31.', date: 'Mar 12', status: 'Published', location: 'All Locations' },
  { id: 2, title: 'New Elite Program Starting April', body: 'We\'re launching advanced sessions for competitive players. Contact us for details.', date: 'Mar 8', status: 'Published', location: 'Downtown' },
  { id: 3, title: 'Summer Camp Registration Open', body: 'Early bird pricing available through April 15. Limited spots — register now!', date: 'Mar 5', status: 'Scheduled', location: 'All Locations' },
];

const REFUND_REASONS = ['Billing error', 'Service not delivered', 'Cancellation refund', 'Duplicate charge', 'Customer request', 'Other'];

const MORE_TOOLS = [
  { name: 'Waivers & Documents', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>, enabled: false, ref: 'MEM-008' },
];

/* ─── NOTIFICATIONS (MEM-007) ─── */
const NOTIFICATIONS = [
  { id: 'n1', domain: 'Members', title: 'Payment failed — Marcus Davis', preview: '$125 charge declined. Retry or contact member.', time: '6h ago', unread: true, action: 'Retry payment' },
  { id: 'n2', domain: 'Members', title: 'Pause ending soon — Ethan Nguyen', preview: 'Membership resumes in 7 days. Send a welcome-back message?', time: '1d ago', unread: true, action: 'Send message' },
  { id: 'n3', domain: 'Members', title: 'New trial completed — Sofia Reyes', preview: 'Trial session finished. Follow up to convert.', time: '4h ago', unread: true, action: 'Follow up' },
  { id: 'n4', domain: 'System', title: 'Monthly report ready', preview: 'March member metrics are available for review.', time: '1d ago', unread: false, action: 'View report' },
  { id: 'n5', domain: 'Members', title: 'Attendance streak — Mia Thompson', preview: '3-week streak! Consider sending encouragement.', time: '2d ago', unread: false, action: 'Send kudos' },
];

/* ─── ATTENDANCE CHECK-IN (MEM-036) ─── */
const TODAYS_SESSIONS = [
  { id: 'sess1', time: '10:00 AM', name: 'Saturday Elite', coach: 'Coach Rivera', location: 'Downtown', roster: [
    { id: 1, name: 'Carlos Martinez', initials: 'CM', checked: false },
    { id: 2, name: 'Mia Thompson', initials: 'MT', checked: false },
    { id: 3, name: 'Jaylen Brooks', initials: 'JB', checked: false },
    { id: 6, name: 'Ava Chen', initials: 'AC', checked: false },
  ]},
  { id: 'sess2', time: '2:00 PM', name: 'Saturday Intermediate', coach: 'Coach Z', location: 'Westside', roster: [
    { id: 7, name: 'Marcus Davis', initials: 'MD', checked: false },
    { id: 4, name: 'Sofia Reyes', initials: 'SR', checked: false },
  ]},
];

/* ─── FAILED PAYMENTS (MEM-015a) ─── */
const FAILED_PAYMENTS = [
  { id: 'fp1', name: 'Marcus Davis', initials: 'MD', plan: 'Intermediate', amount: 125, failedDate: 'Mar 14', retryDate: 'Mar 17', attempts: 2, lastFour: '4242', reason: 'Insufficient funds' },
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


/* Extension Modal — Issue Credit */
function ExtendModal({ onClose }) {
  const [extType, setExtType] = useState('date');
  const [member, setMember] = useState('');
  const [days, setDays] = useState('7');
  const [credits, setCredits] = useState('1');
  const [saved, setSaved] = useState(false);

  const handleIssue = () => { setSaved(true); setTimeout(onClose, 1500); };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Issue Credit / Extension</h3>
          <span className={s.modalRef}>P1</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Member</label>
          <select className={s.formSelect} value={member} onChange={e => setMember(e.target.value)}>
            <option value="">Select a member...</option>
            {MEMBERS.filter(m => m.status !== 'Cancelled').map(m => (
              <option key={m.id} value={m.name}>{m.name} — {m.plan}</option>
            ))}
          </select>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Extension type</label>
          <div className={s.radioGroup}>
            <label className={`${s.radioOption} ${extType === 'date' ? s.radioActive : ''}`}>
              <input type="radio" name="extType" value="date" checked={extType === 'date'} onChange={() => setExtType('date')} />
              <span>Extend next payment date</span>
            </label>
            <label className={`${s.radioOption} ${extType === 'credits' ? s.radioActive : ''}`}>
              <input type="radio" name="extType" value="credits" checked={extType === 'credits'} onChange={() => setExtType('credits')} />
              <span>Add session credits</span>
            </label>
          </div>
        </div>

        {extType === 'date' ? (
          <div className={s.formGroup}>
            <label className={s.formLabel}>Extend by (days)</label>
            <input className={s.formInput} type="number" value={days} onChange={e => setDays(e.target.value)} />
            <div className={s.creditInfo}>
              <div className={s.creditInfoRow}><span>Effect</span><span>Next payment pushed back {days} days</span></div>
              <div className={s.creditInfoRow}><span>Billing adjustment</span><span>Automatic via Stripe</span></div>
            </div>
          </div>
        ) : (
          <div className={s.formGroup}>
            <label className={s.formLabel}>Number of credits</label>
            <input className={s.formInput} type="number" value={credits} onChange={e => setCredits(e.target.value)} />
            <div className={s.creditInfo}>
              <div className={s.creditInfoRow}><span>Credit value</span><span>{credits} session(s)</span></div>
              <div className={s.creditInfoRow}><span>Expires</span><span>30 days from issue</span></div>
            </div>
          </div>
        )}

        {saved ? (
          <div className={s.sentConfirm}>{extType === 'date' ? `Payment date extended by ${days} days` : `${credits} credit(s) issued`}</div>
        ) : (
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={s.btnPrimary} onClick={handleIssue} disabled={!member}>Issue {extType === 'date' ? 'extension' : 'credits'}</button>
          </div>
        )}
      </div>
    </div>
  );
}


/* ─── MAIN COMPONENT ─── */
export default function Members() {
  const { location: activeLocation, setLocation: setActiveLocation } = useLocation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawerMember, setDrawerMember] = useState(null);
  const [tab, setTab] = useState('directory');
  const [cmdInput, setCmdInput] = useState('');
  const [cmdResponse, setCmdResponse] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const typewriterText = useTypewriter(SAGE_PROMPTS);

  const filteredMembers = activeLocation === 'all' ? MEMBERS : MEMBERS.filter(m => m.location.toLowerCase() === activeLocation);
  const filteredPauses = activeLocation === 'all' ? PAUSES : PAUSES.filter(p => p.location.toLowerCase() === activeLocation);
  const filteredActivityByLocation = activeLocation === 'all' ? ACTIVITY : ACTIVITY.filter(a => !a.location || a.location.toLowerCase() === activeLocation);

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
  const [extendOpen, setExtendOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState('all');
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
  const [bellFilter, setBellFilter] = useState('All');
  const [sessions, setSessions] = useState(TODAYS_SESSIONS);
  const filteredSessionsData = activeLocation === 'all' ? sessions : sessions.filter(sess => sess.location.toLowerCase() === activeLocation);

  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);

  const activeCount = filteredMembers.filter(m => m.status === 'Active').length;
  const pausedCount = filteredMembers.filter(m => m.status === 'Paused').length;
  const unreadNotifs = notifications.filter(n => n.unread).length;

  /* Quick action handler */
  const handleQuickAction = (action, text) => {
    if (action === 'compose') return setComposeOpen(true);
    if (action === 'announcement') return setAnnouncementOpen(true);
    if (action === 'refund') { setRefundMember(null); return setRefundOpen(true); }
    if (action === 'credit') { setCreditMember(null); return setCreditOpen(true); }
    if (action === 'extend') return setExtendOpen(true);
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
    let list = filteredMembers.filter(m => {
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
  }, [search, statusFilter, sortCol, sortDir, filteredMembers]);

  const filteredActivity = activityFilter === 'all' ? filteredActivityByLocation : filteredActivityByLocation.filter(a => a.type === activityFilter);

  const healthColor = h => h === 'green' ? s.healthGreen : h === 'yellow' ? s.healthYellow : s.healthRed;
  const statusClass = st =>
    st === 'Active' ? s.statusActive :
    st === 'Paused' ? s.statusPaused :
    st === 'Trial' ? s.statusTrial : s.statusCancelled;

  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const openMemberInDrawer = (memberName) => {
    const m = filteredMembers.find(mb => mb.name === memberName);
    if (m) setDrawerMember(m);
  };

  const toggleAttendance = (sessionId, memberId) => {
    setSessions(prev => prev.map(sess =>
      sess.id === sessionId
        ? { ...sess, roster: sess.roster.map(r => r.id === memberId ? { ...r, checked: !r.checked } : r) }
        : sess
    ));
  };

  if (dashOpen) return <FullDashboard onClose={() => setDashOpen(false)} />;

  return (
    <main className={sh.main}>
      {/* ═══ COMMAND BAR HEADER ═══ */}
      <div className={s.cmdBarHeader}>
        <canvas ref={canvasRef} className={s.cmdBarCanvas} />
        <div className={s.cmdBarInner}>
          <div className={s.cmdLeft}>
            <h1 className={s.cmdGreeting}>Members</h1>
            <span className={s.cmdSubGreeting}>{activeCount} active &middot; {pausedCount} paused</span>
          </div>
          <div className={s.cmdCenter}>
            <div className={s.cmdSageOrb}>S</div>
            <input
              className={s.cmdSageInput}
              value={cmdInput}
              onChange={e => setCmdInput(e.target.value)}
              placeholder={typewriterText}
              onKeyDown={e => e.key === 'Enter' && handleCommand()}
            />
            {isListening && <span className={s.cmdListenBadge}>Listening...</span>}
            <button className={`${s.cmdMicBtn} ${isListening ? s.cmdMicBtnActive : ''}`} onClick={toggleListening}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button className={s.cmdSendBtn} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div className={s.cmdRight}>
            <div className={sh.locationFilter}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <select className={sh.locationSelect} value={activeLocation} onChange={e => setActiveLocation(e.target.value)}>
                <option value="all">All Locations</option>
                <option value="downtown">Downtown</option>
                <option value="westside">Westside</option>
              </select>
            </div>
            <button className={s.cmdChipH} onClick={() => setDashOpen(true)}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Dashboard
            </button>
            <button className={s.cmdBell} onClick={() => setBellOpen(true)}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {unreadNotifs > 0 && <span className={s.cmdBellBadge}>{unreadNotifs}</span>}
            </button>
          </div>
        </div>
      </div>

      <div className={sh.scroll}>
        {/* Sage response */}
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

        {/* Quick action chips */}
        <div className={s.cmdChips}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} className={s.cmdChip} onClick={() => handleQuickAction(a.action, a.label)}>
              <span className={s.cmdChipIcon}>{QA_ICONS[a.icon]}</span> {a.label}
            </button>
          ))}
          <div className={s.moreToolsWrap}>
            <button className={s.cmdChipMore} onClick={() => setMoreToolsOpen(!moreToolsOpen)}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              More tools
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

        {/* Tab nav */}
        <div className={s.tabBar}>
          {['directory', 'metrics', 'attendance', 'pauses', 'failedPayments', 'activity', 'announcements'].map(t => (
            <button
              key={t}
              className={`${s.tabBtn} ${tab === t ? s.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'directory' ? 'Directory' : t === 'metrics' ? 'Stats' : t === 'attendance' ? 'Check-In' : t === 'pauses' ? 'Pauses' : t === 'failedPayments' ? 'Failed Payments' : t === 'activity' ? 'Activity Feed' : 'Announcements'}
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
              <button className={s.btnAction} onClick={() => setComposeOpen(true)}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Send message
              </button>
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
              <h3 className={s.sectionTitle}>Stats</h3>
              <span className={s.sectionRef}>MEM-003</span>
            </div>
            <div className={s.kpiGrid}>
              {KPIS.map(k => (
                <div key={k.label} className={`${s.kpiCard} ${k.pb ? s.kpiCardPb : ''}`}>
                  {k.pb && <div className={s.kpiPbBadge}>Best month</div>}
                  <div className={s.kpiFront}>
                    <div className={s.kpiLabel}>{k.label}</div>
                    <div className={s.kpiValue}>{k.value}</div>
                    <div className={s.kpiTrend}>
                      <span className={k.trendUp ? s.trendUp : s.trendDown}>{k.trend}</span>
                      <span className={s.kpiRef}>{k.ref}</span>
                    </div>
                  </div>
                  <div className={s.kpiBack}>
                    <div className={s.kpiBackLabel}>{k.label}</div>
                    <div className={s.kpiExplain}>{k.explain}</div>
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

        {/* ═══ ATTENDANCE CHECK-IN TAB ═══ */}
        {tab === 'attendance' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Attendance Check-In</h3>
              <span className={s.sectionRef}>MEM-036</span>
            </div>
            {filteredSessionsData.map(sess => {
              const checkedCount = sess.roster.filter(r => r.checked).length;
              return (
                <div key={sess.id} className={s.attendSession}>
                  <div className={s.attendSessionHead}>
                    <div className={s.attendSessionInfo}>
                      <span className={s.attendSessionTime}>{sess.time}</span>
                      <span className={s.attendSessionName}>{sess.name}</span>
                      <span className={s.attendSessionCoach}>{sess.coach}</span>
                    </div>
                    <span className={s.attendSessionCount}>{checkedCount}/{sess.roster.length} checked in</span>
                  </div>
                  <div className={s.attendGrid}>
                    {sess.roster.map(r => (
                      <button
                        key={r.id}
                        className={`${s.attendCard} ${r.checked ? s.attendCardChecked : ''}`}
                        onClick={() => toggleAttendance(sess.id, r.id)}
                      >
                        <div className={`${s.attendAvatar} ${r.checked ? s.attendAvatarChecked : ''}`}>
                          {r.checked ? (
                            <svg width="16" height="16" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : r.initials}
                        </div>
                        <span className={s.attendName}>{r.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Tap a member to mark them present. Attendance data feeds into streak tracking and the member health score.</span>
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
            {filteredPauses.map(p => (
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

            <div className={s.sectionHead} style={{ marginTop: 24 }}>
              <h3 className={s.sectionTitle}>Failed Payments & Dunning</h3>
              <span className={s.sectionRef}>MEM-015a</span>
            </div>
            {FAILED_PAYMENTS.map(fp => (
              <div key={fp.id} className={s.fpCard}>
                <div className={s.fpLeft}>
                  <div className={s.fpAvatar}>{fp.initials}</div>
                  <div className={s.fpInfo}>
                    <div className={s.fpName}>{fp.name}</div>
                    <div className={s.fpMeta}>{fp.plan} · ${fp.amount}/mo · {fp.reason}</div>
                  </div>
                </div>
                <div className={s.fpRight}>
                  <div className={s.fpDetail}><span className={s.fpDetailLabel}>Attempts</span><span className={s.fpDetailValue}>{fp.attempts}/3</span></div>
                  <div className={s.fpActions}>
                    <button className={s.pauseAction}>Retry now</button>
                    <button className={s.pauseAction}>Send dunning message</button>
                    <button className={s.pauseAction}>Contact</button>
                  </div>
                </div>
              </div>
            ))}
            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Failed payments trigger automatic dunning sequences. If all retries fail, the member is flagged here for manual follow-up.</span>
            </div>
          </>
        )}

        {/* ═══ FAILED PAYMENTS TAB ═══ */}
        {tab === 'failedPayments' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Failed Payments</h3>
              <span className={s.sectionRef}>MEM-015a</span>
            </div>
            {FAILED_PAYMENTS.length > 0 ? (
              <div className={s.fpList}>
                {FAILED_PAYMENTS.map(fp => (
                  <div key={fp.id} className={s.fpCard}>
                    <div className={s.fpLeft}>
                      <div className={s.fpAvatar}>{fp.initials}</div>
                      <div className={s.fpInfo}>
                        <div className={s.fpName}>{fp.name}</div>
                        <div className={s.fpMeta}>{fp.plan} &middot; ${fp.amount}/mo &middot; Card ending {fp.lastFour}</div>
                      </div>
                    </div>
                    <div className={s.fpRight}>
                      <div className={s.fpDetail}>
                        <span className={s.fpDetailLabel}>Failed</span>
                        <span className={s.fpDetailValue}>{fp.failedDate}</span>
                      </div>
                      <div className={s.fpDetail}>
                        <span className={s.fpDetailLabel}>Retry</span>
                        <span className={s.fpDetailValue}>{fp.retryDate}</span>
                      </div>
                      <div className={s.fpDetail}>
                        <span className={s.fpDetailLabel}>Attempts</span>
                        <span className={s.fpDetailValue}>{fp.attempts}</span>
                      </div>
                      <span className={s.fpReason}>{fp.reason}</span>
                      <div className={s.fpActions}>
                        <button className={s.pauseAction}>Retry now</button>
                        <button className={s.pauseAction}>Contact</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.emptyState}>No failed payments right now.</div>
            )}
            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Stripe automatically retries failed payments. You can also retry manually or reach out to the member to update their card.</span>
            </div>
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
                  <div className={s.feedIcon}>{ACTIVITY_ICONS[a.type]}</div>
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
              <button className={s.drawerActionBtn} onClick={() => setComposeOpen(true)}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Message
              </button>
              <button className={s.drawerActionBtn} onClick={() => { setRefundMember(drawerMember); setRefundOpen(true); }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Refund
              </button>
              <button className={s.drawerActionBtn} onClick={() => { setCreditMember(drawerMember); setCreditOpen(true); }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Credit
              </button>
              <button className={s.drawerActionBtn} onClick={() => setDiscountOpen(true)}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Discount
              </button>
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

      {/* ═══ BELL NOTIFICATION PANEL (MEM-007) ═══ */}
      {bellOpen && <div className={s.bellOverlay} onClick={() => setBellOpen(false)} />}
      <div className={`${s.bellPanel} ${bellOpen ? s.bellPanelOpen : ''}`}>
        <div className={s.bellPanelHead}>
          <span className={s.bellPanelTitle}>Notifications</span>
          <button className={s.bellCloseBtn} onClick={() => setBellOpen(false)}>&times;</button>
        </div>
        <div className={s.bellFilters}>
          {['All', 'Members', 'System'].map(f => (
            <button key={f} className={`${s.bellFilterBtn} ${bellFilter === f ? s.bellFilterActive : ''}`} onClick={() => setBellFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className={s.bellList}>
          {notifications
            .filter(n => bellFilter === 'All' || n.domain === bellFilter)
            .map(n => (
              <div key={n.id} className={`${s.bellItem} ${n.unread ? s.bellItemUnread : ''}`}>
                <div className={s.bellItemTop}>
                  <span className={s.bellItemTitle}>{n.title}</span>
                  <span className={s.bellItemTime}>{n.time}</span>
                </div>
                <div className={s.bellItemPreview}>{n.preview}</div>
                <div className={s.bellItemBottom}>
                  <span className={s.bellItemDomain}>{n.domain}</span>
                  <button
                    className={s.bellItemAction}
                    onClick={() => setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, unread: false } : x))}
                  >
                    {n.action}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* ═══ MODALS ═══ */}
      {composeOpen && <ComposeMessage onClose={() => setComposeOpen(false)} />}
      {announcementOpen && <AnnouncementEditor onClose={() => { setAnnouncementOpen(false); setEditAnnouncement(null); }} existing={editAnnouncement} />}
      {refundOpen && <RefundModal onClose={() => { setRefundOpen(false); setRefundMember(null); }} member={refundMember} />}
      {discountOpen && <DiscountModal onClose={() => setDiscountOpen(false)} />}
      {creditOpen && <CreditModal onClose={() => { setCreditOpen(false); setCreditMember(null); }} member={creditMember} />}
      {extendOpen && <ExtendModal onClose={() => setExtendOpen(false)} />}
    </main>
  );
}
