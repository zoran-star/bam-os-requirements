import { useState } from 'react';
import s from '../../styles/member-app/MemberApp.module.css';

/* ═══════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════ */

const ANNOUNCEMENTS = [
  { id: 1, title: 'Spring Break Schedule Changes', body: 'All Saturday sessions moved to 11am during March 22–29. Normal schedule resumes March 31.', full: 'All Saturday sessions have been moved to 11:00 AM during the week of March 22–29 to accommodate spring break scheduling. This affects Elite Skills Training, Youth Development, and Open Gym sessions. Normal schedule resumes on Monday, March 31. Please update your bookings accordingly. Contact the front desk if you have questions.' },
  { id: 2, title: 'Summer Camp Registration Open', body: 'Early bird pricing through April 15. Limited spots — register now!', full: 'Summer Camp 2026 registration is now open! We\'re offering three age-group camps this year: Mini Ballers (6–8), Rising Stars (9–12), and Elite Prep (13–16). Each camp runs Monday–Friday, 9 AM – 3 PM. Early bird pricing is available through April 15: $299/week (regular $375). Space is limited to 20 campers per group. Register through the app or contact Coach Zoran.' },
];

const ICON = {
  calendar: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  schedule: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  ticket: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M2 9a3 3 0 0 1 0 6v5h20v-5a3 3 0 0 1 0-6V4H2z"/><line x1="13" y1="4" x2="13" y2="20" strokeDasharray="2 2"/></svg>,
  chat: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  user: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  settings: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  card: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  bell: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  lock: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  phone: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  ban: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  trash: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  flame: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 22c-4.97 0-9-2.69-9-6 0-4 5-11 9-14 4 3 9 10 9 14 0 3.31-4.03 6-9 6z"/></svg>,
};

const SHORTCUTS = [
  { icon: ICON.calendar, label: 'Book a Class' },
  { icon: ICON.schedule, label: 'My Schedule' },
  { icon: ICON.ticket, label: 'My Credits' },
  { icon: ICON.chat, label: 'Messages' },
  { icon: ICON.user, label: 'Profile' },
  { icon: ICON.settings, label: 'Settings' },
];

const CLASSES = [
  { id: 1, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', duration: '90 min', location: 'Main Court', color: '#C8A84E', capacity: '8/12', day: 'Today', booked: false, desc: 'Advanced ball-handling, finishing, and decision-making for competitive players.', credits: 2 },
  { id: 2, name: 'Youth Development', coach: 'Coach Marcus', time: '10:30 AM', duration: '60 min', location: 'Court B', color: '#3EAF5C', capacity: '10/15', day: 'Today', booked: true, desc: 'Fundamentals and game concepts for developing players ages 8–12.', credits: 1 },
  { id: 3, name: 'Shooting Lab', coach: 'Coach Zoran', time: '4:00 PM', duration: '60 min', location: 'Main Court', color: '#6366f1', capacity: '6/10', day: 'Today', booked: false, desc: 'Form shooting, catch-and-shoot, off-screen work. All levels.', credits: 1 },
  { id: 4, name: 'Open Gym', coach: 'Coach Marcus', time: '6:00 PM', duration: '120 min', location: 'Main Court', color: '#E09D24', capacity: '15/20', day: 'Today', booked: false, desc: 'Unstructured play and pickup games. All members welcome.', credits: 1 },
  { id: 5, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', duration: '90 min', location: 'Main Court', color: '#C8A84E', capacity: '4/12', day: 'Tomorrow', booked: false, desc: 'Advanced ball-handling, finishing, and decision-making for competitive players.', credits: 2 },
  { id: 6, name: 'Beginner Fundamentals', coach: 'Coach Ava', time: '11:00 AM', duration: '60 min', location: 'Court B', color: '#E05A42', capacity: '12/12', day: 'Tomorrow', booked: false, desc: 'First steps on the court. Dribbling, passing, and basic shooting.', credits: 1, full: true },
  { id: 7, name: 'Team Tactics', coach: 'Coach Zoran', time: '2:00 PM', duration: '75 min', location: 'Main Court', color: '#3EAF5C', capacity: '7/10', day: 'Wed, Mar 18', booked: false, desc: 'Pick-and-roll, off-ball movement, defensive rotations.', credits: 1 },
  { id: 8, name: 'Shooting Lab', coach: 'Coach Zoran', time: '4:00 PM', duration: '60 min', location: 'Main Court', color: '#6366f1', capacity: '5/10', day: 'Wed, Mar 18', booked: false, desc: 'Form shooting, catch-and-shoot, off-screen work. All levels.', credits: 1 },
];

const MY_UPCOMING = [
  { id: 2, name: 'Youth Development', coach: 'Coach Marcus', time: '10:30 AM', day: 'Today', color: '#3EAF5C' },
  { id: 5, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', day: 'Tomorrow', color: '#C8A84E' },
];

const MY_PAST = [
  { name: 'Elite Skills Training', time: '9:00 AM', day: 'Mar 14', attended: true },
  { name: 'Shooting Lab', time: '4:00 PM', day: 'Mar 13', attended: true },
  { name: 'Open Gym', time: '6:00 PM', day: 'Mar 11', attended: false },
];

const NOTIF_TYPES = [
  { label: 'Session reminders', key: 'session', locked: false },
  { label: 'Payment reminders', key: 'payment', locked: true },
  { label: 'Coach messages', key: 'messages', locked: false },
  { label: 'Report published', key: 'reports', locked: false },
  { label: 'Announcements', key: 'announce', locked: false },
  { label: 'Milestones & achievements', key: 'gamification', locked: false },
];

const CAL_DAYS_WITH_CLASSES = [16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31];

/* ─── P0: Inbox messages — APP-026, APP-031 ─── */
const INBOX_MESSAGES = [
  { id: 1, from: 'Coach Zoran', avatar: 'CZ', time: '2h ago', preview: 'Great work on the pull-up jumper today. Let\'s add some off-screen reps next session.', unread: true, messages: [
    { sender: 'Coach Zoran', text: 'Great work on the pull-up jumper today. Let\'s add some off-screen reps next session.', time: '2:15 PM' },
    { sender: 'You', text: 'Thanks coach! I felt way more comfortable shooting off movement today.', time: '2:20 PM' },
    { sender: 'Coach Zoran', text: 'That\'s the goal. Keep putting in the work', time: '2:22 PM' },
  ]},
  { id: 2, from: 'BAM Academy', avatar: 'BA', time: '1d ago', preview: 'Your March progress report is ready. Tap to view.', unread: true, messages: [
    { sender: 'BAM Academy', text: 'Your March progress report is ready. Tap to view your shooting splits, attendance, and coach notes.', time: 'Yesterday' },
  ]},
  { id: 3, from: 'Coach Marcus', avatar: 'CM', time: '3d ago', preview: 'Hey Carlos, just a reminder to ice that ankle after practice.', unread: false, messages: [
    { sender: 'Coach Marcus', text: 'Hey Carlos, just a reminder to ice that ankle after practice. Don\'t push it if it still feels sore tomorrow.', time: 'Mar 14' },
    { sender: 'You', text: 'Will do, thanks for checking in!', time: 'Mar 14' },
  ]},
];

/* ─── P0: Notification center — APP-031 ─── */
const NOTIF_CENTER = [
  { id: 1, type: 'reminder', title: 'Youth Development starts in 1 hour', sub: 'Today at 10:30 AM · Court B', time: '30m ago', unread: true },
  { id: 2, type: 'message', title: 'New message from Coach Zoran', sub: 'Great work on the pull-up jumper…', time: '2h ago', unread: true },
  { id: 3, type: 'billing', title: 'Payment processed — $175.00', sub: 'Elite Plan · Mar 15, 2026', time: '2d ago', unread: false },
  { id: 4, type: 'announcement', title: 'Spring Break Schedule Changes', sub: 'Saturday sessions moved to 11am', time: '3d ago', unread: false },
  { id: 5, type: 'report', title: 'Progress report available', sub: 'March 2026 performance summary', time: '4d ago', unread: false },
  { id: 6, type: 'waitlist', title: 'Spot opened! Beginner Fundamentals', sub: 'Tomorrow at 11:00 AM — book now', time: '5d ago', unread: false },
];

/* ─── P0: Billing data — APP-001, APP-002, APP-033 ─── */
const BILLING_INFO = {
  plan: 'Elite Plan',
  price: '$175/mo',
  nextBilling: 'Apr 15, 2026',
  cardLast4: '4242',
  cardBrand: 'Visa',
  cardExp: '08/27',
};

const PAYMENT_HISTORY = [
  { date: 'Mar 15, 2026', amount: '$175.00', desc: 'Elite Plan — Monthly', status: 'Paid' },
  { date: 'Feb 15, 2026', amount: '$175.00', desc: 'Elite Plan — Monthly', status: 'Paid' },
  { date: 'Jan 15, 2026', amount: '$175.00', desc: 'Elite Plan — Monthly', status: 'Paid' },
  { date: 'Dec 15, 2025', amount: '$50.00', desc: 'Credit Pack — 5 sessions', status: 'Paid' },
  { date: 'Dec 15, 2025', amount: '$175.00', desc: 'Elite Plan — Monthly', status: 'Paid' },
];

const PLANS = [
  { id: 'starter', name: 'Starter', price: '$99/mo', credits: '4 sessions', current: false },
  { id: 'growth', name: 'Growth', price: '$139/mo', credits: '8 sessions', current: false },
  { id: 'elite', name: 'Elite', price: '$175/mo', credits: '12 sessions', current: true },
  { id: 'unlimited', name: 'Unlimited', price: '$249/mo', credits: 'Unlimited', current: false },
];

/* ─── P1: Credit history — APP-021 ─── */
const CREDIT_HISTORY = [
  { date: 'Mar 16', action: 'Used', amount: -2, desc: 'Elite Skills Training', balance: 6 },
  { date: 'Mar 14', action: 'Used', amount: -1, desc: 'Shooting Lab', balance: 8 },
  { date: 'Mar 11', action: 'No-show', amount: -1, desc: 'Open Gym', balance: 9 },
  { date: 'Mar 1', action: 'Renewed', amount: 12, desc: 'Monthly reset — Elite Plan', balance: 10 },
  { date: 'Feb 28', action: 'Used', amount: -2, desc: 'Elite Skills Training', balance: -2 },
];

/* ═══════════════════════════════════════════
   MEMBER APP (all screens in one component)
   ═══════════════════════════════════════════ */

export default function MemberApp({ onClose }) {
  const [tab, setTab] = useState('home');
  const [announceIdx, setAnnounceIdx] = useState(0);
  const [browseView, setBrowseView] = useState('list');
  const [selectedClass, setSelectedClass] = useState(null);
  const [bookingConfirm, setBookingConfirm] = useState(null);
  const [accountView, setAccountView] = useState('main');
  const [pauseDuration, setPauseDuration] = useState('2');
  const [calSelected, setCalSelected] = useState(16);
  const [notifs, setNotifs] = useState({ session: true, payment: true, messages: true, reports: true, announce: false, gamification: true });

  /* GAM-002: Milestone celebration modal */
  const [milestoneModal, setMilestoneModal] = useState(false);

  /* P0: Inbox + Notification center */
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxThread, setInboxThread] = useState(null);
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);

  /* P0: Cancel class confirmation */
  const [cancelConfirm, setCancelConfirm] = useState(null);

  /* P0: Announcement detail */
  const [announceDetail, setAnnounceDetail] = useState(null);

  /* P0: Billing */
  const [billingTab, setBillingTab] = useState('history');

  /* P0: Delete account / Cancel membership */
  const [deleteStep, setDeleteStep] = useState(0);
  const [cancelMemberStep, setCancelMemberStep] = useState(0);
  const [cancelReason, setCancelReason] = useState('');

  /* P1: QR check-in */
  const [qrOpen, setQrOpen] = useState(false);

  /* P1: Trial banner dismissed */
  const [trialDismissed, setTrialDismissed] = useState(false);
  const IS_TRIAL = false; // toggle to true to preview trial experience

  const toggleNotif = (key, locked) => {
    if (locked) return;
    setNotifs(n => ({ ...n, [key]: !n[key] }));
  };

  const handleBook = (cls) => {
    setBookingConfirm(cls);
    setSelectedClass(null);
  };

  const navTo = (t) => {
    setTab(t);
    setSelectedClass(null);
    setBookingConfirm(null);
    setAccountView('main');
    setInboxOpen(false);
    setNotifCenterOpen(false);
    setAnnounceDetail(null);
    setCancelConfirm(null);
    setQrOpen(false);
  };

  /* ─── ICONS (shared) ─── */
  const BellIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
  const ChevronRight = () => <span className={s.accountRowChevron}>›</span>;

  /* ─── Bottom Nav ─── */
  const BottomNav = () => (
    <nav className={s.bottomNav}>
      {[
        { id: 'home', label: 'Home', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
        { id: 'browse', label: 'Classes', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
        { id: 'schedule', label: 'Schedule', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> },
        { id: 'account', label: 'Account', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
      ].map(n => (
        <div key={n.id} className={`${s.navItem} ${tab === n.id ? s.navActive : ''}`} onClick={() => navTo(n.id)}>
          <div className={s.navIcon}>{n.icon}</div>
          <span className={s.navLabel}>{n.label}</span>
        </div>
      ))}
    </nav>
  );

  /* ─── HOME ─── */
  const HomePage = () => (
    <div className={s.pageScroll}>
      <div className={s.homeGreeting}>
        <div className={s.greetingText}>Good morning</div>
        <div className={s.greetingName}>Carlos</div>
      </div>

      {/* P1: Trial banner — APP-034a/b */}
      {IS_TRIAL && !trialDismissed && (
        <div className={s.trialBanner}>
          <div className={s.trialBannerLeft}>
            <div className={s.trialBannerTitle}>Free Trial — 3 days left</div>
            <div className={s.trialBannerSub}>You have 2 trial sessions remaining. Book now!</div>
          </div>
          <button className={s.trialBannerBtn} onClick={() => { setTab('account'); setAccountView('billing'); }}>Upgrade</button>
          <button className={s.trialDismiss} onClick={() => setTrialDismissed(true)}>✕</button>
        </div>
      )}

      {/* Announcement Carousel — APP-006 / MEM-016 / APP-029 (tap for detail) */}
      <div className={s.announceCarousel}>
        <div className={s.announceSlide} onClick={() => setAnnounceDetail(ANNOUNCEMENTS[announceIdx])}>
          <div className={s.announceSlideTitle}>{ANNOUNCEMENTS[announceIdx].title}</div>
          <div className={s.announceSlideBody}>{ANNOUNCEMENTS[announceIdx].body}</div>
          <div className={s.announceTapHint}>Tap to read more</div>
        </div>
        <div className={s.announceDots}>
          {ANNOUNCEMENTS.map((_, i) => (
            <div key={i} className={`${s.announceDot} ${i === announceIdx ? s.announceDotActive : ''}`} onClick={() => setAnnounceIdx(i)} />
          ))}
        </div>
      </div>

      {/* Quick Actions — APP-006 */}
      <div className={s.shortcuts}>
        {SHORTCUTS.map(sc => (
          <div key={sc.label} className={s.shortcutBtn} onClick={() => {
            if (sc.label === 'Book a Class') navTo('browse');
            else if (sc.label === 'My Schedule') navTo('schedule');
            else if (sc.label === 'My Credits') { setTab('account'); setAccountView('credits'); }
            else if (sc.label === 'Messages') setInboxOpen(true);
            else if (sc.label === 'Profile') { setTab('account'); setAccountView('profile'); }
            else if (sc.label === 'Settings') navTo('account');
          }}>
            <div className={s.shortcutIcon}>{sc.icon}</div>
            <div className={s.shortcutLabel}>{sc.label}</div>
          </div>
        ))}
      </div>

      {/* Upcoming Sessions — APP-006 */}
      <div className={s.sectionHead}>
        <div className={s.sectionTitle}>Up Next</div>
        <div className={s.sectionLink} onClick={() => navTo('schedule')}>See all</div>
      </div>
      {MY_UPCOMING.slice(0, 2).map(u => (
        <div key={u.id} className={s.upcomingCard}>
          <div className={s.upcomingColor} style={{ background: u.color }} />
          <div className={s.upcomingInfo}>
            <div className={s.upcomingClass}>{u.name}</div>
            <div className={s.upcomingMeta}>{u.coach} · {u.day}</div>
          </div>
          <div className={s.upcomingTime}>{u.time}</div>
        </div>
      ))}

      {/* Streak Widget — GAM-001 / GAM-003: Progress ring + milestone tracker */}
      <div className={s.streakWidget} onClick={() => setMilestoneModal(true)} style={{ cursor: 'pointer' }}>
        <div className={s.progressRingWrap}>
          <svg className={s.progressRingSvg} viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e2dc" strokeWidth="8" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="#C8A84E" strokeWidth="8" strokeLinecap="round" strokeDasharray="263.89" strokeDashoffset={263.89 * (1 - 0.76)} className={s.progressRingCircle} />
          </svg>
          <div className={s.progressRingInner}>
            <div className={s.progressRingCount}>38</div>
          </div>
        </div>
        <div className={s.streakInfo}>
          <div className={s.streakCount}>{ICON.flame} Session Streak</div>
          <div className={s.streakSub}>12 sessions to next milestone (50)</div>
        </div>
      </div>

      {/* Credit Balance — APP-021 */}
      <div className={s.creditWidget} onClick={() => { setTab('account'); setAccountView('credits'); }} style={{ cursor: 'pointer' }}>
        <div className={s.creditLeft}>
          <div className={s.creditLabel}>Session Credits</div>
          <div className={s.creditValue}>6</div>
        </div>
        <div className={s.creditReset}>Resets Apr 1 · 1 make-up</div>
      </div>
    </div>
  );

  /* ─── BROWSE CLASSES ─── */
  const BrowsePage = () => {
    const days = [...new Set(CLASSES.map(c => c.day))];

    return (
      <div className={s.pageScroll}>
        <div className={s.browseToggle}>
          <button className={`${s.browseToggleBtn} ${browseView === 'list' ? s.browseToggleActive : ''}`} onClick={() => setBrowseView('list')}>List</button>
          <button className={`${s.browseToggleBtn} ${browseView === 'calendar' ? s.browseToggleActive : ''}`} onClick={() => setBrowseView('calendar')}>Calendar</button>
        </div>

        {browseView === 'list' ? (
          days.map(day => (
            <div key={day} className={s.dayGroup}>
              <div className={s.dayLabel}>{day}</div>
              {CLASSES.filter(c => c.day === day).map(cls => (
                <div key={cls.id} className={s.classCard} onClick={() => setSelectedClass(cls)}>
                  <div className={s.classColor} style={{ background: cls.color }} />
                  <div className={s.classInfo}>
                    <div className={s.className}>{cls.name}</div>
                    <div className={s.classMeta}>{cls.coach} · {cls.location}</div>
                  </div>
                  <div className={s.classRight}>
                    <div className={s.classTime}>{cls.time}</div>
                    <div className={s.classCapacity}>{cls.capacity}</div>
                    {cls.booked ? (
                      <span className={s.classBookedBtn}>Booked ✓</span>
                    ) : cls.full ? (
                      <button className={s.classWaitlistBtn} onClick={e => e.stopPropagation()}>Waitlist</button>
                    ) : (
                      <button className={s.classBookBtn} onClick={e => { e.stopPropagation(); handleBook(cls); }}>Book</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          /* Calendar View — APP-015b */
          <div className={s.calGrid}>
            <div className={s.calHeader}>
              <div className={s.calMonth}>March 2026</div>
              <div className={s.calNav}>
                <button className={s.calNavBtn}>‹</button>
                <button className={s.calNavBtn}>›</button>
              </div>
            </div>
            <div className={s.calDayNames}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className={s.calDayName}>{d}</div>
              ))}
            </div>
            <div className={s.calDays}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                const hasClasses = CAL_DAYS_WITH_CLASSES.includes(day);
                return (
                  <div
                    key={day}
                    className={`${s.calDay} ${day === 16 ? s.calDayToday : ''} ${day === calSelected ? s.calDaySelected : ''}`}
                    onClick={() => setCalSelected(day)}
                  >
                    <span className={s.calDayNum}>{day}</span>
                    {hasClasses && (
                      <div className={s.calDots}>
                        <div className={s.calDotColor} style={{ background: '#C8A84E' }} />
                        <div className={s.calDotColor} style={{ background: '#3EAF5C' }} />
                        {day % 3 === 0 && <div className={s.calDotColor} style={{ background: '#6366f1' }} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={s.dayGroup}>
              <div className={s.dayLabel}>{calSelected === 16 ? 'Today' : `Mar ${calSelected}`}</div>
              {CLASSES.filter(c => c.day === 'Today').slice(0, 3).map(cls => (
                <div key={cls.id} className={s.classCard} onClick={() => setSelectedClass(cls)}>
                  <div className={s.classColor} style={{ background: cls.color }} />
                  <div className={s.classInfo}>
                    <div className={s.className}>{cls.name}</div>
                    <div className={s.classMeta}>{cls.coach} · {cls.time}</div>
                  </div>
                  <div className={s.classRight}>
                    {cls.booked ? (
                      <span className={s.classBookedBtn}>Booked ✓</span>
                    ) : (
                      <button className={s.classBookBtn} onClick={e => { e.stopPropagation(); handleBook(cls); }}>Book</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ─── MY SCHEDULE ─── */
  const SchedulePage = () => (
    <div className={s.pageScroll}>
      {/* P1: QR Check-In button — APP-030a */}
      <div style={{ padding: '0 20px' }}>
        <button className={s.qrCheckinBtn} onClick={() => setQrOpen(true)}>
          <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/></svg>
          Check In with QR Code
          <span style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, marginLeft: 8 }}>P2</span>
        </button>
      </div>

      {/* Credit balance widget — APP-021 */}
      <div className={s.creditWidget} onClick={() => { setTab('account'); setAccountView('credits'); }} style={{ cursor: 'pointer' }}>
        <div className={s.creditLeft}>
          <div className={s.creditLabel}>Session Credits</div>
          <div className={s.creditValue}>6</div>
        </div>
        <div className={s.creditReset}>Resets Apr 1 · 1 make-up credit</div>
      </div>

      {/* Upcoming — APP-018 */}
      <div className={s.scheduleSection}>
        <div className={s.scheduleLabel}>Upcoming</div>
        {MY_UPCOMING.map(u => (
          <div key={u.id} className={s.scheduleCard}>
            <div className={s.classColor} style={{ background: u.color }} />
            <div className={s.classInfo}>
              <div className={s.className}>{u.name}</div>
              <div className={s.classMeta}>{u.day} · {u.time} · {u.coach}</div>
            </div>
            <button className={s.scheduleCancelBtn} onClick={() => setCancelConfirm(u)}>Cancel</button>
          </div>
        ))}
      </div>

      {/* Past 30 days — APP-018 */}
      <div className={s.scheduleSection}>
        <div className={s.scheduleLabel}>Past 30 Days</div>
        {MY_PAST.map((p, i) => (
          <div key={i} className={s.scheduleCard}>
            <div className={s.classColor} style={{ background: '#A5A19A' }} />
            <div className={s.classInfo}>
              <div className={s.className}>{p.name}</div>
              <div className={s.classMeta}>{p.day} · {p.time}</div>
            </div>
            {p.attended ? (
              <span className={s.attendedBadge}>Attended</span>
            ) : (
              <span className={s.missedBadge}>Missed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── ACCOUNT ─── */
  const AccountPage = () => {
    if (accountView === 'pause') return <PauseFlow />;
    if (accountView === 'notifications') return <NotificationsView />;
    if (accountView === 'password') return <PasswordChange />;
    if (accountView === 'billing') return <BillingView />;
    if (accountView === 'deleteAccount') return <DeleteAccountFlow />;
    if (accountView === 'cancelMembership') return <CancelMembershipFlow />;
    if (accountView === 'profile') return <ProfileEdit />;
    if (accountView === 'credits') return <CreditDetailView />;
    if (accountView === 'changePlan') return <ChangePlanView />;

    return (
      <div className={s.pageScroll}>
        <div className={s.accountHeader}>
          <div className={s.accountAvatar}>CM</div>
          <div className={s.accountName}>Carlos Martinez</div>
          <div className={s.accountEmail}>carlos.m@email.com</div>
          <div className={s.accountPlan}>Elite Plan — $175/mo</div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Membership</div>
          <div className={s.accountRow} onClick={() => setAccountView('billing')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.card}</span><span className={s.accountRowLabel}>Billing & Payments</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('changePlan')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg></span><span className={s.accountRowLabel}>Change Plan</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('pause')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></span><span className={s.accountRowLabel}>Pause Membership</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('credits')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.ticket}</span><span className={s.accountRowLabel}>Session Credits</span></div>
            <ChevronRight />
          </div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Settings</div>
          <div className={s.accountRow} onClick={() => setAccountView('profile')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.user}</span><span className={s.accountRowLabel}>Edit Profile</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('notifications')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.bell}</span><span className={s.accountRowLabel}>Notifications</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('password')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.lock}</span><span className={s.accountRowLabel}>Change Password</span></div>
            <ChevronRight />
          </div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Support</div>
          <div className={s.accountRow}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.chat}</span><span className={s.accountRowLabel}>Contact Academy</span></div>
            <ChevronRight />
          </div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Danger Zone</div>
          <div className={s.accountRow} onClick={() => { setCancelMemberStep(0); setAccountView('cancelMembership'); }}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.ban}</span><span className={s.accountRowLabel} style={{ color: 'var(--warn)' }}>Cancel Membership</span></div>
            <ChevronRight />
          </div>
          <div className={s.accountRow} onClick={() => { setDeleteStep(0); setAccountView('deleteAccount'); }}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>{ICON.trash}</span><span className={s.accountRowLabel} style={{ color: 'var(--red)' }}>Delete Account</span></div>
            <ChevronRight />
          </div>
        </div>
      </div>
    );
  };

  /* ─── PAUSE FLOW — APP-009 / APP-009a / APP-009b ─── */
  const PauseFlow = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Pause Membership</div>
        <div className={s.pauseFlowSub}>
          Your billing will be suspended during the pause. You won't be able to book sessions until you resume. You can end the pause early at any time.
        </div>

        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Duration (weeks)</div>
          <select className={s.pauseFormInput} value={pauseDuration} onChange={e => setPauseDuration(e.target.value)}>
            <option value="1">1 week</option>
            <option value="2">2 weeks</option>
            <option value="3">3 weeks</option>
            <option value="4">4 weeks</option>
          </select>
        </div>

        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Start date</div>
          <input className={s.pauseFormInput} type="date" defaultValue="2026-03-17" />
        </div>

        <div className={s.pausePreview}>
          <div className={s.pausePreviewRow}><span>Pause starts</span><span>Mar 17, 2026</span></div>
          <div className={s.pausePreviewRow}><span>Auto-resume</span><span>{pauseDuration === '1' ? 'Mar 24' : pauseDuration === '2' ? 'Mar 31' : pauseDuration === '3' ? 'Apr 7' : 'Apr 14'}, 2026</span></div>
          <div className={s.pausePreviewRow}><span>Billing impact</span><span>No charge during pause</span></div>
          <div className={s.pausePreviewRow}><span>Remaining pauses</span><span>1 of 2 this year</span></div>
        </div>

        <button className={s.pauseSubmitBtn}>Confirm Pause</button>
      </div>
    </div>
  );

  /* ─── NOTIFICATIONS — APP-010 / APP-022a ─── */
  const NotificationsView = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.sectionHead}>
        <div className={s.sectionTitle}>Notification Preferences</div>
      </div>
      <div className={s.notifList}>
        {NOTIF_TYPES.map(n => (
          <div key={n.key} className={s.notifRow}>
            <div className={s.notifLabel}>
              {n.label}
              {n.locked && <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 6 }}>(required)</span>}
            </div>
            <button
              className={`${s.notifToggle} ${notifs[n.key] ? s.notifToggleOn : ''}`}
              onClick={() => toggleNotif(n.key, n.locked)}
              style={n.locked ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <div className={s.notifToggleDot} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── PASSWORD CHANGE — APP-023a ─── */
  const PasswordChange = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Change Password</div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Current password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Enter current password" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>New password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Enter new password" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Confirm new password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Confirm new password" />
        </div>
        <button className={s.pauseSubmitBtn}>Update Password</button>
      </div>
    </div>
  );

  /* ─── P0: BILLING — APP-001, APP-002, APP-033, APP-012a/b ─── */
  const BillingView = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Billing & Payments</div>

        {/* Current plan summary */}
        <div className={s.billingSummary}>
          <div className={s.billingPlanRow}>
            <div>
              <div className={s.billingPlanName}>{BILLING_INFO.plan}</div>
              <div className={s.billingPlanPrice}>{BILLING_INFO.price}</div>
            </div>
            <button className={s.billingChangeBtn} onClick={() => setAccountView('changePlan')}>Change</button>
          </div>
          <div className={s.billingNext}>Next billing: {BILLING_INFO.nextBilling}</div>
        </div>

        {/* Payment method — APP-033 */}
        <div className={s.billingMethodCard}>
          <div className={s.billingMethodLeft}>
            <div className={s.billingMethodIcon}>
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            </div>
            <div>
              <div className={s.billingMethodBrand}>{BILLING_INFO.cardBrand} •••• {BILLING_INFO.cardLast4}</div>
              <div className={s.billingMethodExp}>Expires {BILLING_INFO.cardExp}</div>
            </div>
          </div>
          <button className={s.billingMethodBtn}>Update</button>
        </div>

        {/* Tabs: History / Upcoming */}
        <div className={s.browseToggle}>
          <button className={`${s.browseToggleBtn} ${billingTab === 'history' ? s.browseToggleActive : ''}`} onClick={() => setBillingTab('history')}>History</button>
          <button className={`${s.browseToggleBtn} ${billingTab === 'upcoming' ? s.browseToggleActive : ''}`} onClick={() => setBillingTab('upcoming')}>Upcoming</button>
        </div>

        {billingTab === 'history' ? (
          <div className={s.paymentList}>
            {PAYMENT_HISTORY.map((p, i) => (
              <div key={i} className={s.paymentRow}>
                <div className={s.paymentRowLeft}>
                  <div className={s.paymentDesc}>{p.desc}</div>
                  <div className={s.paymentDate}>{p.date}</div>
                </div>
                <div className={s.paymentRowRight}>
                  <div className={s.paymentAmount}>{p.amount}</div>
                  <span className={s.paymentBadge}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.paymentList}>
            <div className={s.paymentRow}>
              <div className={s.paymentRowLeft}>
                <div className={s.paymentDesc}>{BILLING_INFO.plan} — Monthly</div>
                <div className={s.paymentDate}>{BILLING_INFO.nextBilling}</div>
              </div>
              <div className={s.paymentRowRight}>
                <div className={s.paymentAmount}>$175.00</div>
                <span className={s.paymentBadgePending}>Scheduled</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* ─── P0: CHANGE PLAN — APP-012a/b ─── */
  const ChangePlanView = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('billing')}>← Back to Billing</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Change Plan</div>
        <div className={s.pauseFlowSub}>Select a plan. Changes take effect at your next billing cycle.</div>
        <div className={s.planGrid}>
          {PLANS.map(p => (
            <div key={p.id} className={`${s.planCard} ${p.current ? s.planCardCurrent : ''}`}>
              <div className={s.planCardName}>{p.name}</div>
              <div className={s.planCardPrice}>{p.price}</div>
              <div className={s.planCardCredits}>{p.credits}</div>
              {p.current ? (
                <span className={s.planCardBadge}>Current</span>
              ) : (
                <button className={s.planCardBtn}>Select</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ─── P0: CANCEL CLASS CONFIRMATION — APP-019a/b ─── */
  const CancelClassDialog = () => (
    <div className={s.dialogOverlay} onClick={() => setCancelConfirm(null)}>
      <div className={s.dialogBox} onClick={e => e.stopPropagation()}>
        <div className={s.dialogIcon}>
          <svg width="28" height="28" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        </div>
        <div className={s.dialogTitle}>Cancel this class?</div>
        <div className={s.dialogSub}>
          <strong>{cancelConfirm.name}</strong><br />
          {cancelConfirm.day} at {cancelConfirm.time}
        </div>
        <div className={s.dialogPolicy}>
          Cancellations within 2 hours of start time will not receive a credit refund. This session is more than 2 hours away — your credit will be returned.
        </div>
        <div className={s.dialogActions}>
          <button className={s.dialogDanger} onClick={() => setCancelConfirm(null)}>Yes, Cancel Class</button>
          <button className={s.dialogCancel} onClick={() => setCancelConfirm(null)}>Keep Booking</button>
        </div>
      </div>
    </div>
  );

  /* ─── P0: ANNOUNCEMENT DETAIL — APP-029 ─── */
  const AnnouncementDetail = () => (
    <div className={s.detailOverlay}>
      <button className={s.detailBack} onClick={() => setAnnounceDetail(null)}>← Back</button>
      <div className={s.detailContent}>
        <div className={s.detailHero} style={{ borderLeft: '4px solid var(--gold)' }}>
          <div className={s.detailClassName}>{announceDetail.title}</div>
          <div className={s.detailMeta}>BAM Academy · Announcement</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ts)', lineHeight: 1.65, padding: '0 4px' }}>
          {announceDetail.full || announceDetail.body}
        </div>
      </div>
    </div>
  );

  /* ─── P0: DELETE ACCOUNT — APP-023c ─── */
  const DeleteAccountFlow = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        {deleteStep === 0 ? (
          <>
            <div className={s.pauseFlowTitle} style={{ color: 'var(--red)' }}>Delete Account</div>
            <div className={s.pauseFlowSub}>
              This will permanently delete your account and all associated data. This action cannot be undone.
            </div>
            <div className={s.dangerList}>
              <div className={s.dangerItem}>Your membership will be cancelled immediately</div>
              <div className={s.dangerItem}>All session history and credits will be lost</div>
              <div className={s.dangerItem}>Your profile and progress data will be erased</div>
              <div className={s.dangerItem}>Any remaining billing cycle will not be refunded</div>
            </div>
            <button className={s.dangerBtn} onClick={() => setDeleteStep(1)}>I Understand, Continue</button>
            <button className={s.confirmSecondary} onClick={() => setAccountView('main')}>Cancel</button>
          </>
        ) : (
          <>
            <div className={s.pauseFlowTitle} style={{ color: 'var(--red)' }}>Confirm Deletion</div>
            <div className={s.pauseFlowSub}>Type <strong>DELETE</strong> to confirm account deletion.</div>
            <div className={s.pauseFormGroup}>
              <div className={s.pauseFormLabel}>Confirmation</div>
              <input className={s.pauseFormInput} type="text" placeholder='Type "DELETE"' />
            </div>
            <button className={s.dangerBtn}>Permanently Delete Account</button>
            <button className={s.confirmSecondary} onClick={() => setDeleteStep(0)}>Go Back</button>
          </>
        )}
      </div>
    </div>
  );

  /* ─── P0: CANCEL MEMBERSHIP — MEM-006a ─── */
  const CancelMembershipFlow = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        {cancelMemberStep === 0 ? (
          <>
            <div className={s.pauseFlowTitle} style={{ color: 'var(--warn)' }}>Cancel Membership</div>
            <div className={s.pauseFlowSub}>
              We're sorry to see you go. Your membership will remain active until the end of your current billing period (Apr 15, 2026).
            </div>
            <div className={s.pauseFormGroup}>
              <div className={s.pauseFormLabel}>Why are you leaving?</div>
              <select className={s.pauseFormInput} value={cancelReason} onChange={e => setCancelReason(e.target.value)}>
                <option value="">Select a reason...</option>
                <option value="cost">Too expensive</option>
                <option value="time">Not enough time</option>
                <option value="moving">Moving away</option>
                <option value="injury">Injury or health</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className={s.pausePreview}>
              <div className={s.pausePreviewRow}><span>Access until</span><span>Apr 15, 2026</span></div>
              <div className={s.pausePreviewRow}><span>Remaining credits</span><span>6 (use them!)</span></div>
              <div className={s.pausePreviewRow}><span>Rejoin anytime</span><span>Yes</span></div>
            </div>
            <div className={s.altSuggestion}>
              <div className={s.altSuggestionTitle}>Consider pausing instead?</div>
              <div className={s.altSuggestionSub}>Pause for up to 4 weeks and keep your spot.</div>
              <button className={s.altSuggestionBtn} onClick={() => setAccountView('pause')}>Pause Membership</button>
            </div>
            <button className={s.dangerBtnWarn} onClick={() => setCancelMemberStep(1)}>Continue with Cancellation</button>
          </>
        ) : (
          <>
            <div className={s.pauseFlowTitle} style={{ color: 'var(--warn)' }}>Confirm Cancellation</div>
            <div className={s.pauseFlowSub}>
              Your Elite Plan will end on April 15, 2026. You can still use your remaining 6 credits until then.
            </div>
            <button className={s.dangerBtnWarn}>Confirm Cancellation</button>
            <button className={s.confirmSecondary} onClick={() => setCancelMemberStep(0)}>Go Back</button>
          </>
        )}
      </div>
    </div>
  );

  /* ─── P1: PROFILE EDIT — PRF-002b, PRF-003b ─── */
  const ProfileEdit = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Edit Profile</div>
        <div className={s.profileAvatarEdit}>
          <div className={s.accountAvatar} style={{ width: 80, height: 80, fontSize: 28 }}>CM</div>
          <button className={s.profileAvatarBtn}>Change Photo</button>
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>First name</div>
          <input className={s.pauseFormInput} type="text" defaultValue="Carlos" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Last name</div>
          <input className={s.pauseFormInput} type="text" defaultValue="Martinez" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Email</div>
          <input className={s.pauseFormInput} type="email" defaultValue="carlos.m@email.com" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Phone</div>
          <input className={s.pauseFormInput} type="tel" defaultValue="(555) 123-4567" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Date of birth</div>
          <input className={s.pauseFormInput} type="date" defaultValue="2008-06-15" />
        </div>
        <button className={s.pauseSubmitBtn}>Save Changes</button>
      </div>
    </div>
  );

  /* ─── P1: CREDIT DETAIL / HISTORY — APP-021 ─── */
  const CreditDetailView = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Session Credits</div>

        <div className={s.creditSummaryCard}>
          <div className={s.creditSummaryMain}>
            <div className={s.creditSummaryNum}>6</div>
            <div className={s.creditSummaryLabel}>credits remaining</div>
          </div>
          <div className={s.creditSummaryMeta}>
            <div className={s.pausePreviewRow}><span>Plan allowance</span><span>12/month</span></div>
            <div className={s.pausePreviewRow}><span>Used this cycle</span><span>4</span></div>
            <div className={s.pausePreviewRow}><span>Make-up credits</span><span>1</span></div>
            <div className={s.pausePreviewRow}><span>No-show deductions</span><span>1</span></div>
            <div className={s.pausePreviewRow}><span>Resets</span><span>Apr 1, 2026</span></div>
          </div>
        </div>

        <div className={s.creditHistoryLabel}>Activity Log</div>
        <div className={s.paymentList}>
          {CREDIT_HISTORY.map((c, i) => (
            <div key={i} className={s.paymentRow}>
              <div className={s.paymentRowLeft}>
                <div className={s.paymentDesc}>{c.desc}</div>
                <div className={s.paymentDate}>{c.date} · {c.action}</div>
              </div>
              <div className={s.paymentRowRight}>
                <div className={s.paymentAmount} style={{ color: c.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {c.amount > 0 ? '+' : ''}{c.amount}
                </div>
                <span className={s.creditBalBadge}>Bal: {c.balance}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ─── P0: INBOX — APP-026 ─── */
  const InboxOverlay = () => (
    <div className={s.detailOverlay}>
      {inboxThread ? (
        <>
          <button className={s.detailBack} onClick={() => setInboxThread(null)}>← Back to Messages</button>
          <div className={s.inboxThreadHead}>
            <div className={s.inboxAvatar}>{inboxThread.avatar}</div>
            <div className={s.inboxThreadName}>{inboxThread.from}</div>
          </div>
          <div className={s.inboxMessages}>
            {inboxThread.messages.map((m, i) => (
              <div key={i} className={`${s.inboxBubble} ${m.sender === 'You' ? s.inboxBubbleMine : ''}`}>
                <div className={s.inboxBubbleText}>{m.text}</div>
                <div className={s.inboxBubbleTime}>{m.time}</div>
              </div>
            ))}
          </div>
          <div className={s.inboxCompose}>
            <input className={s.inboxInput} placeholder="Type a message…" />
            <button className={s.inboxSendBtn}>
              <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
        </>
      ) : (
        <>
          <button className={s.detailBack} onClick={() => setInboxOpen(false)}>← Back</button>
          <div style={{ padding: '0 20px 12px' }}>
            <div className={s.pauseFlowTitle}>Messages</div>
          </div>
          <div className={s.inboxList}>
            {INBOX_MESSAGES.map(msg => (
              <div key={msg.id} className={`${s.inboxRow} ${msg.unread ? s.inboxRowUnread : ''}`} onClick={() => setInboxThread(msg)}>
                <div className={s.inboxAvatar}>{msg.avatar}</div>
                <div className={s.inboxRowContent}>
                  <div className={s.inboxRowTop}>
                    <div className={s.inboxRowName}>{msg.from}</div>
                    <div className={s.inboxRowTime}>{msg.time}</div>
                  </div>
                  <div className={s.inboxRowPreview}>{msg.preview}</div>
                </div>
                {msg.unread && <div className={s.inboxUnreadDot} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  /* ─── P0: NOTIFICATION CENTER — APP-031 ─── */
  const NotifCenterOverlay = () => (
    <div className={s.detailOverlay}>
      <button className={s.detailBack} onClick={() => setNotifCenterOpen(false)}>← Back</button>
      <div style={{ padding: '0 20px 12px' }}>
        <div className={s.pauseFlowTitle}>Notifications</div>
      </div>
      <div className={s.notifCenterList}>
        {NOTIF_CENTER.map(n => (
          <div key={n.id} className={`${s.notifCenterRow} ${n.unread ? s.notifCenterUnread : ''}`}>
            <div className={s.notifCenterIcon}>
              {n.type === 'reminder' && <svg width="18" height="18" fill="none" stroke="var(--gold)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
              {n.type === 'message' && <svg width="18" height="18" fill="none" stroke="var(--blue)" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
              {n.type === 'billing' && <svg width="18" height="18" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>}
              {n.type === 'announcement' && <svg width="18" height="18" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><path d="M19.4 14.9A9 9 0 0 0 22 9c0-5-4.5-7-10-7S2 4 2 9c0 3.5 1.5 6.5 5 8v5l4.5-3.5"/></svg>}
              {n.type === 'report' && <svg width="18" height="18" fill="none" stroke="var(--purple)" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
              {n.type === 'waitlist' && <svg width="18" height="18" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            </div>
            <div className={s.notifCenterContent}>
              <div className={s.notifCenterTitle}>{n.title}</div>
              <div className={s.notifCenterSub}>{n.sub}</div>
            </div>
            <div className={s.notifCenterTime}>{n.time}</div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── P1: QR CHECK-IN — APP-030a ─── */
  const QrCheckinOverlay = () => (
    <div className={s.detailOverlay}>
      <button className={s.detailBack} onClick={() => setQrOpen(false)}>← Back</button>
      <div className={s.qrScreen}>
        <div className={s.qrTitle}>Self Check-In</div>
        <div className={s.qrSub}>Show this QR code at the front desk or scan the court QR.</div>
        <div className={s.qrCodeBox}>
          {/* Fake QR pattern */}
          <svg width="160" height="160" viewBox="0 0 160 160">
            <rect width="160" height="160" rx="12" fill="var(--surf)"/>
            <rect x="20" y="20" width="36" height="36" rx="4" fill="var(--tp)"/>
            <rect x="24" y="24" width="28" height="28" rx="2" fill="var(--surf)"/>
            <rect x="30" y="30" width="16" height="16" rx="1" fill="var(--tp)"/>
            <rect x="104" y="20" width="36" height="36" rx="4" fill="var(--tp)"/>
            <rect x="108" y="24" width="28" height="28" rx="2" fill="var(--surf)"/>
            <rect x="114" y="30" width="16" height="16" rx="1" fill="var(--tp)"/>
            <rect x="20" y="104" width="36" height="36" rx="4" fill="var(--tp)"/>
            <rect x="24" y="108" width="28" height="28" rx="2" fill="var(--surf)"/>
            <rect x="30" y="114" width="16" height="16" rx="1" fill="var(--tp)"/>
            {/* Center dots pattern */}
            {[64,72,80,88,96].map(x => [64,72,80,88,96].map(y => (
              <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill={(x+y) % 16 === 0 ? 'var(--tp)' : 'var(--borderm)'} />
            )))}
            {/* Random fill dots */}
            {[20,28,36,44,52].map(x => [64,72,80,88,96].map(y => (
              <rect key={`l${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill={(x*y) % 5 < 3 ? 'var(--tp)' : 'transparent'} />
            )))}
            {[64,72,80,88,96].map(x => [20,28,36,44,52].map(y => (
              <rect key={`t${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill={(x+y*2) % 7 < 4 ? 'var(--tp)' : 'transparent'} />
            )))}
            {[104,112,120,128,136].map(x => [64,72,80,88,96].map(y => (
              <rect key={`r${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill={(x*y) % 4 < 2 ? 'var(--tp)' : 'transparent'} />
            )))}
            {[64,72,80,88,96].map(x => [104,112,120,128,136].map(y => (
              <rect key={`b${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" fill={(x+y) % 3 === 0 ? 'var(--tp)' : 'transparent'} />
            )))}
          </svg>
        </div>
        <div className={s.qrMemberId}>Member ID: BAM-2026-CM0417</div>
        <div className={s.qrSessionInfo}>
          <div className={s.qrSessionLabel}>Next session</div>
          <div className={s.qrSessionName}>Youth Development</div>
          <div className={s.qrSessionMeta}>Today · 10:30 AM · Court B</div>
        </div>
      </div>
    </div>
  );

  /* ─── CLASS DETAIL — APP-017 ─── */
  const ClassDetail = () => (
    <div className={s.detailOverlay}>
      <button className={s.detailBack} onClick={() => setSelectedClass(null)}>← Back</button>
      <div className={s.detailContent}>
        <div className={s.detailHero} style={{ borderLeft: `4px solid ${selectedClass.color}` }}>
          <div className={s.detailClassName}>{selectedClass.name}</div>
          <div className={s.detailMeta}>{selectedClass.day} · {selectedClass.time} · {selectedClass.duration}</div>
        </div>

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Details</div>
          <div className={s.detailRow}><span>Location</span><span>{selectedClass.location}</span></div>
          <div className={s.detailRow}><span>Capacity</span><span>{selectedClass.capacity}</span></div>
          <div className={s.detailRow}><span>Credits</span><span>{selectedClass.credits} credit{selectedClass.credits > 1 ? 's' : ''}</span></div>
        </div>

        {/* P1: Waitlist position — APP-027 */}
        {selectedClass.full && (
          <div className={s.waitlistInfo}>
            <div className={s.waitlistIcon}>
              <svg width="16" height="16" fill="none" stroke="var(--warn)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <div>
              <div className={s.waitlistLabel}>Waitlist Position: #3</div>
              <div className={s.waitlistSub}>You'll be notified if a spot opens up</div>
            </div>
          </div>
        )}

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Coach</div>
          <div className={s.detailCoach}>
            <div className={s.detailCoachAvatar}>{selectedClass.coach.split(' ')[1]?.[0] || 'C'}</div>
            <div>
              <div className={s.detailCoachName}>{selectedClass.coach}</div>
              <div className={s.detailCoachRole}>Head Trainer</div>
            </div>
          </div>
        </div>

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Description</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ts)', lineHeight: 1.55 }}>{selectedClass.desc}</div>
        </div>

        {selectedClass.booked ? (
          <>
            <button className={s.detailBookBtn} style={{ background: 'var(--green)' }}>Booked ✓</button>
            <button className={s.detailCancelBookingBtn} onClick={() => { setCancelConfirm(selectedClass); setSelectedClass(null); }}>Cancel Booking</button>
          </>
        ) : selectedClass.full ? (
          <button className={s.detailBookBtn} style={{ background: 'var(--warn)' }}>Join Waitlist</button>
        ) : (
          <button className={s.detailBookBtn} onClick={() => handleBook(selectedClass)}>
            Book — {selectedClass.credits} credit{selectedClass.credits > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );

  /* ─── BOOKING CONFIRMATION — APP-016a ─── */
  const BookingConfirm = () => (
    <div className={s.confirmOverlay}>
      <div className={s.confirmCheck}>✓</div>
      <div className={s.confirmTitle}>You're booked!</div>
      <div className={s.confirmSub}>
        {bookingConfirm.name}<br />
        {bookingConfirm.day} at {bookingConfirm.time}
      </div>
      <div className={s.confirmActions}>
        <button className={s.confirmPrimary} onClick={() => { setBookingConfirm(null); navTo('schedule'); }}>View My Schedule</button>
        <button className={s.confirmSecondary} onClick={() => setBookingConfirm(null)}>Back to Classes</button>
      </div>
    </div>
  );

  /* ─── RENDER ─── */
  const content = (
    <div className={s.appShell}>
      {/* Top bar */}
      <div className={s.topBar}>
        <div className={s.topBarTitle}>
          {tab === 'home' ? 'BAM' : tab === 'browse' ? 'Classes' : tab === 'schedule' ? 'My Schedule' : 'Account'}
        </div>
        <div className={s.topBarRight}>
          <button className={s.topBarBtn} style={{ position: 'relative' }} onClick={() => setNotifCenterOpen(true)}>
            <BellIcon />
            <div className={s.topBarBellDot} />
          </button>
          <div className={s.topBarAvatar} onClick={() => navTo('account')}>CM</div>
        </div>
      </div>

      {/* Page body */}
      <div className={s.appBody} style={{ position: 'relative' }}>
        {tab === 'home' && <HomePage />}
        {tab === 'browse' && <BrowsePage />}
        {tab === 'schedule' && <SchedulePage />}
        {tab === 'account' && <AccountPage />}

        {/* Overlays */}
        {selectedClass && <ClassDetail />}
        {bookingConfirm && <BookingConfirm />}
        {inboxOpen && <InboxOverlay />}
        {notifCenterOpen && <NotifCenterOverlay />}
        {announceDetail && <AnnouncementDetail />}
        {qrOpen && <QrCheckinOverlay />}
      </div>

      {/* P0: Cancel class dialog — APP-019a/b */}
      {cancelConfirm && <CancelClassDialog />}

      {/* GAM-002 / GAM-002a: Milestone celebration modal */}
      {milestoneModal && (
        <div className={s.milestoneOverlay} onClick={() => setMilestoneModal(false)}>
          <div className={s.milestoneCard} onClick={e => e.stopPropagation()}>
            <div className={s.milestoneIcon}>&#127942;</div>
            <div className={s.milestoneTitle}>Milestone Reached!</div>
            <div className={s.milestoneSub}>Carlos completed 25 sessions!</div>
            <div className={s.milestoneEncourage}>Keep pushing toward 50!</div>
            <button className={s.milestoneBtn} onClick={() => setMilestoneModal(false)}>Awesome!</button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );

  /* If onClose is provided, render inside phone frame */
  if (onClose) {
    return (
      <div className={s.phoneFrame} onClick={onClose}>
        <div className={s.phoneBezel} onClick={e => e.stopPropagation()}>
          <div className={s.phoneNotch}><div className={s.phoneNotchInner} /></div>
          <button className={s.phoneCloseBtn} onClick={onClose}>✕ Close preview</button>
          {content}
        </div>
      </div>
    );
  }

  return content;
}
