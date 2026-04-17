import { useState, useRef, useEffect } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import s from '../styles/Settings.module.css';
import sh from '../styles/shared.module.css';

/* ─── DATA ─── */
const DEFAULT_FAQS = [
  { q: 'What ages do you train?', a: 'We train athletes ages 6-18, grouped by age and skill level.' },
  { q: 'How much does it cost?', a: 'Plans start at $95/mo for Beginner, $125/mo for Intermediate, and $175/mo for Elite.' },
  { q: 'Do you offer free trials?', a: 'Yes! Every new athlete gets a free trial session. Book at our website or reply here to schedule.' },
];

const DEFAULT_OFFERS = [
  { id: 'o1', name: 'Elite Training', athletes: 'Ages 13-18, competitive', sessions: '3x/week, 90min', price: '$175/mo', status: 'Active' },
  { id: 'o2', name: 'Intermediate Development', athletes: 'Ages 10-14, rec+travel', sessions: '2x/week, 60min', price: '$125/mo', status: 'Active' },
  { id: 'o3', name: 'Beginner Fundamentals', athletes: 'Ages 6-10, all levels', sessions: '1x/week, 45min', price: '$95/mo', status: 'Active' },
];

const DEFAULT_PLANS = [
  { id: 'p1', name: 'Elite', price: 175, interval: 'month', sessions: '3x/week', stripeId: 'price_elite_175', active: true },
  { id: 'p2', name: 'Intermediate', price: 125, interval: 'month', sessions: '2x/week', stripeId: 'price_inter_125', active: true },
  { id: 'p3', name: 'Beginner', price: 95, interval: 'month', sessions: '1x/week', stripeId: 'price_begin_95', active: true },
  { id: 'p4', name: 'Free Trial', price: 0, interval: '—', sessions: '1 session', stripeId: '—', active: true },
];

const DEFAULT_LOCATIONS = [
  { id: 'loc1', name: 'Downtown', address: '1250 Court Ave, Austin, TX 78701', timezone: 'America/Chicago', coaches: 3, members: 28, active: true },
  { id: 'loc2', name: 'Westside', address: '4810 W 35th St, Austin, TX 78731', timezone: 'America/Chicago', coaches: 2, members: 14, active: true },
];

const DEFAULT_LINKS = [
  { id: 'lk1', plan: 'Free Trial', location: 'Downtown', url: 'bamacademy.bamos.app/join/dt-trial', visits: 142, completions: 38, created: 'Jan 15', expires: '—' },
  { id: 'lk2', plan: 'Free Trial', location: 'Westside', url: 'bamacademy.bamos.app/join/ws-trial', visits: 67, completions: 12, created: 'Feb 1', expires: '—' },
  { id: 'lk3', plan: 'Elite', location: 'Downtown', url: 'bamacademy.bamos.app/join/elite-dt', visits: 23, completions: 5, created: 'Mar 1', expires: 'Apr 1' },
];

const CHECKLIST_ITEMS = [
  { id: 'ck1', label: 'Connect Stripe account', ref: 'SET-006', done: true },
  { id: 'ck2', label: 'Set up academy profile', ref: 'SET-001', done: true },
  { id: 'ck3', label: 'Add at least one location', ref: 'SET-002', done: true },
  { id: 'ck4', label: 'Create membership plans', ref: 'SET-003', done: true },
  { id: 'ck5', label: 'Configure membership policies', ref: 'SET-004', done: true },
  { id: 'ck6', label: 'Set up AI brand voice', ref: 'SAL-004c', done: true },
  { id: 'ck7', label: 'Create training offers', ref: 'SAL-014', done: true },
  { id: 'ck8', label: 'Generate an onboarding link', ref: 'SET-005', done: true },
  { id: 'ck10', label: 'Connect Meta Conversions API', ref: 'SET-010', done: false },
];

const ICON = {
  home: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  strategy: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>,
  pin: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  users: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  dollar: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  shield: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  bot: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>,
  link: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  code: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  card: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  sun: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  check: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
};

const NAV_SECTIONS = [
  { group: 'Identity', items: [
    { id: 'academy', label: 'Academy Profile', icon: ICON.home },
    { id: 'locations', label: 'Locations', icon: ICON.pin },
  ]},
  { group: 'Strategy', items: [
    { id: 'strategy', label: 'Strategy Chat', icon: ICON.strategy },
  ]},
  { group: 'Staff', items: [
    { id: 'staff', label: 'Staff & Coaches', icon: ICON.users },
  ]},
  { group: 'Product', items: [
    { id: 'plans', label: 'Plans & Pricing', icon: ICON.dollar },
  ]},
  { group: 'Policy', items: [
    { id: 'policies', label: 'Policies', icon: ICON.shield },
  ]},
  { group: 'Conversation AI', items: [
    { id: 'brand', label: 'Brand Voice & FAQ', icon: ICON.bot },
    { id: 'objections', label: 'Objection Map', icon: ICON.shield },
  ]},
  { group: 'Integrations', items: [
    { id: 'links', label: 'Onboarding Links', icon: ICON.link },
    { id: 'integrations', label: 'Integrations', icon: ICON.code },
  ]},
];

const NAV_BOTTOM = [
  { id: 'billing', label: 'FullControl Billing', icon: ICON.card },
  { id: 'appearance', label: 'Appearance', icon: ICON.sun },
];

/* ─── STRATEGY CHAT DATA ─── */
const STRATEGY_TOPICS = [
  { id: 'mission', label: 'Mission Statement', done: true },
  { id: 'values', label: 'Core Values', done: true },
  { id: 'origin', label: 'Origin Story', done: false },
  { id: 'problem', label: 'Problem You Solve', done: true },
  { id: 'customer', label: 'Target Customer', done: false },
  { id: 'selling', label: 'Selling Points', done: true },
];

const STRATEGY_MESSAGES = [
  { from: 'ai', text: "Let's define your academy's mission. Why does BAM Academy exist — beyond just basketball training?" },
  { from: 'user', text: "We want to develop the whole athlete. Not just skills, but discipline, confidence, and leadership." },
  { from: 'ai', text: "That's strong. Here's a refined version: \"BAM Academy develops complete athletes — building discipline, confidence, and leadership through elite basketball training.\" Does that capture it, or should we adjust?" },
  { from: 'user', text: "Yeah that's good. Maybe add something about the community aspect." },
  { from: 'ai', text: "How about: \"BAM Academy builds complete athletes and a tight-knit community — developing discipline, confidence, and leadership through elite basketball training.\" ✓ Saved. Let's move to Core Values — what 3-5 values define how you operate?" },
  { from: 'user', text: "Player development over winning, positive coaching, accountability, and family atmosphere." },
  { from: 'ai', text: "Those are clear and authentic. I'll format them:\n\n1. Player development over winning\n2. Positive, encouraging coaching\n3. Personal accountability\n4. Family atmosphere\n\n✓ Saved. Now let's work on your Origin Story — how and why did you start BAM?" },
];

/* ─── DEFAULT OBJECTIONS ─── */
const DEFAULT_OBJECTIONS = [
  { id: 'obj1', category: 'Price', objection: 'Too expensive', response: 'Acknowledge the concern, reframe as investment in development. Mention coaching quality, small groups, individual attention. Do NOT offer a discount immediately.', active: true },
  { id: 'obj2', category: 'Price', objection: "Can't afford it right now", response: 'Empathize with timing. Mention flexible start dates. Offer to send a reminder when ready. Keep the door open.', active: true },
  { id: 'obj3', category: 'Price', objection: 'Cheaper options elsewhere', response: 'Differentiate on coaching credentials, small group sizes, development tracking. Never trash competitors.', active: true },
  { id: 'obj4', category: 'Schedule', objection: "Schedule doesn't work", response: 'Ask what times DO work. Check alternative sessions. Mention makeup sessions and open gym flexibility.', active: true },
  { id: 'obj5', category: 'Schedule', objection: 'Too much time commitment', response: 'Suggest starting with lower frequency plan. Sessions are only 60-90 min. Consistency matters more than volume.', active: true },
  { id: 'obj6', category: 'Schedule', objection: 'Too far to drive', response: 'Acknowledge the commute. Mention what parents do during sessions. If multi-location, suggest the closer one.', active: true },
  { id: 'obj7', category: 'Child', objection: 'My kid is shy / not confident', response: 'Normalize it — many kids feel this way. Small groups, supportive coaches. Building confidence IS the outcome. Trial is low-pressure.', active: true },
  { id: 'obj8', category: 'Child', objection: 'Too young / not ready', response: 'Explain age-appropriate programming. Fundamentals programs for younger kids. Starting early builds habits.', active: true },
  { id: 'obj9', category: 'Child', objection: 'Not sure my kid will like it', response: "That's exactly what the free trial is for. No commitment, just come try. Many unsure kids end up loving it.", active: true },
  { id: 'obj10', category: 'Child', objection: 'Bad experience at another program', response: 'Take it seriously. Ask what happened. Explain how this program is different. Offer coach to personally welcome them.', active: true },
  { id: 'obj11', category: 'Trust', objection: 'Never heard of you', response: 'Share proof points: years in business, athletes trained, locations. Offer the trial to experience it firsthand.', active: true },
  { id: 'obj12', category: 'Trust', objection: 'What are the coaches\' qualifications?', response: 'Share credentials, playing experience, certifications. Personalize to the specific coach they would train with.', active: true },
  { id: 'obj13', category: 'Commitment', objection: "Don't want to sign a contract", response: 'Clarify actual terms — month-to-month if applicable. Mention cancellation policy. No long-term lock-in.', active: true },
  { id: 'obj14', category: 'Commitment', objection: 'What if we need to pause?', response: 'Explain pause policy: up to 30 days, 2 per year. Flexibility is a feature. We want you here because you love it.', active: true },
  { id: 'obj15', category: 'Timing', objection: 'Need to talk to my spouse', response: 'Completely respect this. Offer to send an info summary to share. Ask when to follow up.', active: true },
  { id: 'obj16', category: 'Timing', objection: 'Let me think about it', response: 'Respect it. Ask if there\'s a specific concern. Offer to answer questions. Follow up in 2-3 days.', active: true },
  { id: 'obj17', category: 'Timing', objection: 'Maybe next season', response: 'Note that starting earlier = more development. Offer to add to reminder list for preferred start date.', active: true },
];

/* ─── SAVE TOAST HELPER ─── */
function useSaveToast() {
  const [visible, setVisible] = useState(false);
  const show = () => { setVisible(true); setTimeout(() => setVisible(false), 2000); };
  return [visible, show];
}

/* ─── COACH FORM (STF-003 / STF-008) ─── */
function CoachForm({ coach, onSave, onClose }) {
  const [name, setName] = useState(coach?.name || '');
  const [role, setRole] = useState(coach?.role || '');
  const [email, setEmail] = useState(coach?.email || '');
  const [phone, setPhone] = useState(coach?.phone || '');
  const [locations, setLocations] = useState(coach?.locations || []);
  const [bio, setBio] = useState(coach?.bio || '');
  const [permission, setPermission] = useState(coach?.permission || 'Coach');
  const [availability, setAvailability] = useState(coach?.availability || '');
  const ALL_LOCATIONS = ['Downtown', 'Westside'];
  const toggleLocation = (loc) => setLocations(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);

  const canSave = name.trim() && role.trim();

  return (
    <>
      <div className={s.formRow}>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Full Name</label>
          <input className={s.formInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Coach Marcus" />
        </div>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Role</label>
          <select className={s.formSelect} value={role} onChange={e => setRole(e.target.value)}>
            <option value="">Select role...</option>
            <option value="Head Coach">Head Coach</option>
            <option value="Assistant Coach">Assistant Coach</option>
            <option value="Youth Coach">Youth Coach</option>
            <option value="Skills Trainer">Skills Trainer</option>
            <option value="Evaluation Coach">Evaluation Coach</option>
          </select>
        </div>
      </div>
      <div className={s.formRow}>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Email</label>
          <input className={s.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="coach@bamacademy.com" />
        </div>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Phone</label>
          <input className={s.formInput} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(512) 555-0100" />
        </div>
      </div>
      <div className={s.formRow}>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Permission Tier</label>
          <select className={s.formSelect} value={permission} onChange={e => setPermission(e.target.value)}>
            <option value="Coach">Coach</option>
            <option value="Owner">Owner</option>
          </select>
        </div>
        <div className={s.formGroup}>
          <label className={s.formLabel}>Locations</label>
          <div className={s.locationToggleRow}>
            {ALL_LOCATIONS.map(loc => (
              <button key={loc} type="button" className={`${s.locationToggleBtn} ${locations.includes(loc) ? s.locationToggleActive : ''}`} onClick={() => toggleLocation(loc)}>
                {loc}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={s.formGroup}>
        <label className={s.formLabel}>Availability</label>
        <input className={s.formInput} value={availability} onChange={e => setAvailability(e.target.value)} placeholder="e.g. Mon-Fri 3pm-8pm, Sat 9am-2pm" />
      </div>
      <div className={s.formGroup}>
        <label className={s.formLabel}>Bio / Background</label>
        <textarea className={s.formTextarea} rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Playing experience, certifications, coaching philosophy..." />
      </div>
      <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>This bio is used in parent-facing communications — when the AI mentions a coach, it references their background. Keep it authentic.</span></div>
      <div className={s.modalFooter}>
        <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
        <button className={s.btnPrimary} disabled={!canSave} onClick={() => onSave({ name, role, email, phone, locations, bio, permission, availability })}>{coach ? 'Save Changes' : 'Add Coach'}</button>
      </div>
    </>
  );
}

/* ─── ADD OBJECTION FORM ─── */
function AddObjectionForm({ onSave, onClose }) {
  const [category, setCategory] = useState('');
  const [objection, setObjection] = useState('');
  const [response, setResponse] = useState('');

  const categories = ['Price', 'Schedule', 'Child', 'Trust', 'Commitment', 'Timing', 'Other'];
  const canSave = category && objection.trim() && response.trim();

  return (
    <>
      <div className={s.formGroup}>
        <label className={s.formLabel}>Category</label>
        <select className={s.formSelect} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Select category...</option>
          {categories.map(c => <option key={c} value={c}>{c === 'Child' ? 'Child Readiness' : c}</option>)}
        </select>
      </div>
      <div className={s.formGroup}>
        <label className={s.formLabel}>Objection</label>
        <input className={s.formInput} value={objection} onChange={e => setObjection(e.target.value)} placeholder='e.g. "We already have a coach"' />
      </div>
      <div className={s.formGroup}>
        <label className={s.formLabel}>AI Response Strategy</label>
        <textarea className={s.formTextarea} rows={4} value={response} onChange={e => setResponse(e.target.value)} placeholder="How should the AI handle this objection? Be specific about tone, what to say, and what NOT to say." />
      </div>
      <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>The AI will use this strategy when it detects this objection in a conversation. Be specific — "acknowledge, then redirect to trial" works better than "handle it."</span></div>
      <div className={s.modalFooter}>
        <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
        <button className={s.btnPrimary} disabled={!canSave} onClick={() => onSave({ category, objection, response })}>Add Objection</button>
      </div>
    </>
  );
}

/* ─── MAIN ─── */
export default function Settings() {
  const [tab, setTab] = useState('academy');
  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);

  // Brand voice
  const [tone, setTone] = useState('Friendly/Casual');
  const [sellingPoints, setSellingPoints] = useState('Small group sizes (max 8 athletes)\nFocused skill development, not just scrimmages\nSaturday sessions to fit busy family schedules');
  const [neverSay, setNeverSay] = useState('Never guarantee college scholarships\nNever trash-talk other programs');
  const [faqs, setFaqs] = useState(DEFAULT_FAQS);

  // Objections
  const [objections, setObjections] = useState(DEFAULT_OBJECTIONS);
  const [showAddObjection, setShowAddObjection] = useState(false);

  // Staff
  const [coaches, setCoaches] = useState([
    { id: 'c1', name: 'Coach Zoran', role: 'Head Coach', email: 'zoran@bamacademy.com', phone: '(512) 555-0101', locations: ['Downtown', 'Westside'], sessions: 8, members: 28, status: 'Active', bio: 'D1 point guard, 8 years coaching experience. Specializes in elite skill development and game strategy.', availability: 'Mon-Fri 3pm-8pm, Sat 9am-2pm', permission: 'Owner' },
    { id: 'c2', name: 'Coach Marcus', role: 'Assistant Coach', email: 'marcus@bamacademy.com', phone: '(512) 555-0102', locations: ['Downtown', 'Westside'], sessions: 5, members: 14, status: 'Active', bio: 'Former overseas pro. Focuses on fundamentals and building young athletes\' confidence.', availability: 'Mon-Thu 4pm-8pm', permission: 'Coach' },
    { id: 'c3', name: 'Coach Ava', role: 'Youth Coach', email: 'ava@bamacademy.com', phone: '(512) 555-0103', locations: ['Downtown'], sessions: 4, members: 18, status: 'Active', bio: 'Certified youth coach. Patient, energetic, great with beginners and shy kids.', availability: 'Tue-Sat 10am-6pm', permission: 'Coach' },
  ]);
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [editingCoach, setEditingCoach] = useState(null);

  // Offers
  const [offers] = useState(DEFAULT_OFFERS);
  const [showOfferWizard, setShowOfferWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const WIZARD_STEPS = ['Athletes', 'Sessions', 'Inclusions', 'Pricing', 'Commitment', 'Review'];

  // Policies
  const [pauseMax, setPauseMax] = useState('30');
  const [pausePerYear, setPausePerYear] = useState('2');
  const [cancelNotice, setCancelNotice] = useState('7');
  const [dunningRetries, setDunningRetries] = useState('3');

  // Appearance — persisted + applied to document
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('fc_theme') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('fc_theme', theme); } catch {}
  }, [theme]);

  // Checklist
  const [checklist, setChecklist] = useState(CHECKLIST_ITEMS);
  const doneCount = checklist.filter(c => c.done).length;

  // Save toast
  const [toastVisible, showToast] = useSaveToast();

  return (
    <main className={sh.main}>
      {/* ═══ COMMAND BAR HEADER ═══ */}
      <div className={s.cmdBarHeader}>
        <canvas ref={canvasRef} className={s.cmdBarCanvas} />
        <div className={s.cmdBarInner}>
          <div className={s.cmdLeft}>
            <h1 className={s.cmdGreeting}>Settings</h1>
            <span className={s.cmdSubGreeting}>Academy configuration &middot; {doneCount}/{checklist.length} setup complete</span>
          </div>
          <div className={s.cmdRight}>
            <div className={s.setupProgress}>
              <div className={s.setupBar}><div className={s.setupFill} style={{ width: `${(doneCount / checklist.length) * 100}%` }} /></div>
              <span className={s.setupLabel}>{doneCount}/{checklist.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ SIDEBAR + CONTENT LAYOUT ═══ */}
      <div className={s.settingsBody}>
        <nav className={s.settingsNav}>
          {NAV_SECTIONS.map(group => (
            <div key={group.group}>
              <div className={s.navGroupLabel}>{group.group}</div>
              {group.items.map(n => (
                <button key={n.id} className={`${s.navItem} ${tab === n.id ? s.navItemActive : ''}`} onClick={() => setTab(n.id)}>
                  <span className={s.navIcon}>{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </div>
          ))}
          <div className={s.navDivider} />
          {NAV_BOTTOM.map(n => (
            <button key={n.id} className={`${s.navItem} ${tab === n.id ? s.navItemActive : ''}`} onClick={() => setTab(n.id)}>
              <span className={s.navIcon}>{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className={s.navDivider} />
          <button className={`${s.navItem} ${tab === 'checklist' ? s.navItemActive : ''}`} onClick={() => setTab('checklist')}>
            <span className={s.navIcon}>{ICON.check}</span>
            Setup Checklist
            {doneCount < checklist.length && <span className={s.navBadge}>{checklist.length - doneCount}</span>}
          </button>
        </nav>

        <div className={s.settingsContent}>
          {/* ═══ ACADEMY PROFILE (SET-001) ═══ */}
          {tab === 'academy' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Academy Profile</h3>
                <span className={s.sectionRef}>SET-001</span>
              </div>
              <div className={s.formCard}>
                <div className={s.logoRow}>
                  <div className={s.logoPlaceholder}>
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  </div>
                  <div className={s.logoInfo}>
                    <div className={s.logoTitle}>Academy Logo</div>
                    <div className={s.logoSub}>Recommended: 512×512px, PNG or SVG</div>
                    <button className={s.uploadBtn}>Upload logo</button>
                  </div>
                </div>
                <div className={s.formRow}>
                  <div className={s.formGroup}><label className={s.formLabel}>Academy Name</label><input className={s.formInput} defaultValue="BAM Academy" /></div>
                  <div className={s.formGroup}><label className={s.formLabel}>Contact Email</label><input className={s.formInput} defaultValue="coach@bamacademy.com" /></div>
                </div>
                <div className={s.formRow}>
                  <div className={s.formGroup}><label className={s.formLabel}>Phone</label><input className={s.formInput} defaultValue="(512) 555-0147" /></div>
                  <div className={s.formGroup}><label className={s.formLabel}>Timezone</label>
                    <select className={s.formSelect} defaultValue="America/Chicago">
                      <option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option><option value="America/Los_Angeles">Pacific</option>
                    </select>
                  </div>
                </div>
                <div className={s.formGroup}><label className={s.formLabel}>Address</label><input className={s.formInput} defaultValue="1250 Court Ave, Austin, TX 78701" /></div>
                <div className={s.formGroup}><label className={s.formLabel}>Trial Booking Link</label><input className={s.formInput} defaultValue="https://bamacademy.bamos.app/trial" /></div>
              </div>
              <button className={s.saveBtn} onClick={showToast}>Save Profile</button>
            </>
          )}

          {/* ═══ LOCATIONS (SET-002) ═══ */}
          {tab === 'locations' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Locations</h3>
                <div className={s.sectionActions}><button className={s.addBtn}>+ Add Location</button><span className={s.sectionRef}>SET-002</span></div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Each location has its own address, timezone, coaches, and class schedule. Members are assigned to a location at signup.</span></div>
              {DEFAULT_LOCATIONS.map(loc => (
                <div key={loc.id} className={s.locationCard}>
                  <div className={s.locationLeft}>
                    <div className={s.locationIcon}>
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    </div>
                    <div>
                      <div className={s.locationName}>{loc.name}</div>
                      <div className={s.locationAddr}>{loc.address}</div>
                    </div>
                  </div>
                  <div className={s.locationRight}>
                    <div className={s.locationStat}><span className={s.locationStatVal}>{loc.coaches}</span><span className={s.locationStatLabel}>Coaches</span></div>
                    <div className={s.locationStat}><span className={s.locationStatVal}>{loc.members}</span><span className={s.locationStatLabel}>Members</span></div>
                    <span className={s.statusActive}>Active</span>
                    <button className={s.editBtn}>Edit</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ═══ PLANS & PRICING (SET-003) ═══ */}
          {tab === 'plans' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Membership Plans</h3>
                <div className={s.sectionActions}><button className={s.addBtn} onClick={() => { setShowOfferWizard(true); setWizardStep(0); }}>+ Create Plan</button><span className={s.sectionRef}>SET-003</span></div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Plans are synced with Stripe Products & Prices. Price is immutable after creation — archive the plan and create a new one to change pricing.</span></div>
              <div className={s.planGrid}>
                {DEFAULT_PLANS.map(p => (
                  <div key={p.id} className={s.planCard}>
                    <div className={s.planHeader}>
                      <div className={s.planName}>{p.name}</div>
                      <span className={p.active ? s.statusActive : s.statusInactive}>{p.active ? 'Active' : 'Archived'}</span>
                    </div>
                    <div className={s.planPrice}>{p.price ? `$${p.price}` : 'Free'}<span className={s.planInterval}>/{p.interval}</span></div>
                    <div className={s.planMeta}>{p.sessions}</div>
                    <div className={s.planStripe}>Stripe: {p.stripeId}</div>
                    <div className={s.planActions}>
                      <button className={s.editBtn}>Edit</button>
                      {p.price > 0 && <button className={s.archiveBtn}>Archive</button>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Product Builder — merged from Offer Builder */}
              <div className={s.sectionHead} style={{ marginTop: 32 }}>
                <h3 className={s.sectionTitle}>Products</h3>
                <span className={s.sectionRef}>SAL-014</span>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Products are injected into the AI sales agent context. When a lead asks about pricing or programs, the AI references these directly.</span></div>
              <div className={s.offerGrid}>
                {offers.map(o => (
                  <div key={o.id} className={s.offerCard}>
                    <div className={s.offerHeader}>
                      <div className={s.offerName}>{o.name}</div>
                      <span className={s.statusActive}>{o.status}</span>
                    </div>
                    <div className={s.offerDetails}>
                      <div className={s.offerRow}><span className={s.offerLabel}>Athletes</span><span>{o.athletes}</span></div>
                      <div className={s.offerRow}><span className={s.offerLabel}>Sessions</span><span>{o.sessions}</span></div>
                      <div className={s.offerRow}><span className={s.offerLabel}>Price</span><span className={s.offerPrice}>{o.price}</span></div>
                    </div>
                    <div className={s.offerActions}>
                      <button className={s.editBtn}>Edit</button>
                      <button className={s.archiveBtn}>Archive</button>
                    </div>
                  </div>
                ))}
              </div>
              <button className={s.addOfferBtn} onClick={() => { setShowOfferWizard(true); setWizardStep(0); }}>+ Create New Product</button>
            </>
          )}

          {/* ═══ POLICIES (SET-004) ═══ */}
          {tab === 'policies' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Membership Policies</h3>
                <span className={s.sectionRef}>SET-004</span>
              </div>
              <div className={s.formCard}>
                <div className={s.policySection}>
                  <div className={s.policySectionTitle}>Pause Rules</div>
                  <div className={s.formRow}>
                    <div className={s.formGroup}><label className={s.formLabel}>Max Pause Duration (days)</label><input className={s.formInput} type="number" value={pauseMax} onChange={e => setPauseMax(e.target.value)} /></div>
                    <div className={s.formGroup}><label className={s.formLabel}>Pauses Allowed Per Year</label><input className={s.formInput} type="number" value={pausePerYear} onChange={e => setPausePerYear(e.target.value)} /></div>
                  </div>
                </div>
                <div className={s.policySection}>
                  <div className={s.policySectionTitle}>Cancellation Rules</div>
                  <div className={s.formGroup}><label className={s.formLabel}>Notice Period (days)</label><input className={s.formInput} type="number" value={cancelNotice} onChange={e => setCancelNotice(e.target.value)} /></div>
                </div>
                <div className={s.policySection}>
                  <div className={s.policySectionTitle}>Dunning Behavior</div>
                  <div className={s.formGroup}><label className={s.formLabel}>Auto-retry Attempts Before Flagging</label><input className={s.formInput} type="number" value={dunningRetries} onChange={e => setDunningRetries(e.target.value)} /></div>
                </div>
              </div>
              <button className={s.saveBtn} onClick={showToast}>Save Policies</button>
            </>
          )}

          {/* ═══ AI BRAND VOICE (SAL-004c) ═══ */}
          {tab === 'brand' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>AI Brand Voice & FAQ</h3>
                <span className={s.sectionRef}>SAL-004c</span>
              </div>
              <div className={s.formCard}>
                <div className={s.formGroup}>
                  <label className={s.formLabel}>Tone of Voice</label>
                  <div className={s.toneGrid}>
                    {['Professional', 'Friendly/Casual', 'High-Energy/Hype', 'Motivational Coach'].map(t => (
                      <button key={t} className={`${s.toneBtn} ${tone === t ? s.toneActive : ''}`} onClick={() => setTone(t)}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className={s.formGroup}>
                  <label className={s.formLabel}>Top Selling Points</label>
                  <textarea className={s.formTextarea} rows={3} value={sellingPoints} onChange={e => setSellingPoints(e.target.value)} placeholder="One selling point per line" />
                </div>
                <div className={s.formGroup}>
                  <label className={s.formLabel}>Things the AI Should Never Say</label>
                  <textarea className={s.formTextarea} rows={2} value={neverSay} onChange={e => setNeverSay(e.target.value)} placeholder="One restriction per line" />
                </div>
              </div>

              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>FAQ Knowledge Base</h3>
                <button className={s.addBtn} onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>+ Add FAQ</button>
              </div>
              <div className={s.faqList}>
                {faqs.map((faq, i) => (
                  <div key={i} className={s.faqCard}>
                    <div className={s.faqBody}>
                      <div className={s.faqRow}>
                        <span className={s.faqLabel}>Q:</span>
                        <input className={s.faqInput} value={faq.q} onChange={e => { const next = [...faqs]; next[i] = { ...next[i], q: e.target.value }; setFaqs(next); }} placeholder="Question..." />
                      </div>
                      <div className={s.faqRow}>
                        <span className={s.faqLabel}>A:</span>
                        <input className={s.faqInput} value={faq.a} onChange={e => { const next = [...faqs]; next[i] = { ...next[i], a: e.target.value }; setFaqs(next); }} placeholder="Approved answer..." />
                      </div>
                    </div>
                    <button className={s.faqDelete} onClick={() => setFaqs(faqs.filter((_, j) => j !== i))} title="Remove FAQ">
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              <button className={s.saveBtn} onClick={showToast}>Save Brand Voice</button>
            </>
          )}

          {/* ═══ ONBOARDING LINKS (SET-005) ═══ */}
          {tab === 'links' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Onboarding Links</h3>
                <div className={s.sectionActions}><button className={s.addBtn}>+ Generate Link</button><span className={s.sectionRef}>SET-005</span></div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Share these links with prospective members. Each link routes to a specific plan and location with built-in tracking.</span></div>
              <div className={s.linkTable}>
                <div className={s.linkHeader}>
                  <span>Plan</span><span>Location</span><span>URL</span><span>Visits</span><span>Completions</span><span>Rate</span><span>Expires</span>
                </div>
                {DEFAULT_LINKS.map(lk => (
                  <div key={lk.id} className={s.linkRow}>
                    <span className={s.linkPlan}>{lk.plan}</span>
                    <span>{lk.location}</span>
                    <span className={s.linkUrl}>{lk.url}</span>
                    <span className={s.linkStat}>{lk.visits}</span>
                    <span className={s.linkStat}>{lk.completions}</span>
                    <span className={s.linkStat}>{lk.visits ? `${Math.round((lk.completions / lk.visits) * 100)}%` : '—'}</span>
                    <span>{lk.expires}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ═══ INTEGRATIONS (SET-006 + SET-010) ═══ */}
          {tab === 'integrations' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Integrations</h3>
              </div>
              <div className={s.intGrid}>
                <div className={s.intCard}>
                  <div className={s.intCardHead}>
                    <div className={s.intLogo}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#635BFF" strokeWidth="2"><path d="M13.73 3.51l5.76 3.32A2 2 0 0 1 20.5 8.6v6.8a2 2 0 0 1-1.01 1.74l-5.76 3.32a2 2 0 0 1-1.98 0L5.99 17.14A2 2 0 0 1 5 15.4V8.6a2 2 0 0 1 1.01-1.74l5.76-3.32a2 2 0 0 1 1.98 0z"/></svg>
                    </div>
                    <div>
                      <div className={s.intName}>Stripe</div>
                      <div className={s.intDesc}>Payments, subscriptions, and billing</div>
                    </div>
                    <span className={s.intConnected}>Connected</span>
                  </div>
                  <div className={s.intMeta}>
                    <span>Account: acct_1NxBAM...</span>
                    <span>Connected Jan 5, 2026</span>
                  </div>
                  <div className={s.intRef}>SET-006</div>
                </div>

                <div className={s.intCard}>
                  <div className={s.intCardHead}>
                    <div className={s.intLogo}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1877F2" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                    </div>
                    <div>
                      <div className={s.intName}>Meta Conversions API</div>
                      <div className={s.intDesc}>Ad attribution and conversion tracking</div>
                    </div>
                    <span className={s.intDisconnected}>Not connected</span>
                  </div>
                  <button className={s.intConnectBtn}>Connect Meta Account</button>
                  <div className={s.intRef}>SET-010</div>
                </div>

                <div className={s.intCard}>
                  <div className={s.intCardHead}>
                    <div className={s.intLogo}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                    </div>
                    <div>
                      <div className={s.intName}>GoHighLevel</div>
                      <div className={s.intDesc}>SMS, email, and marketing automation</div>
                    </div>
                    <span className={s.intConnected}>Connected</span>
                  </div>
                  <div className={s.intMeta}>
                    <span>Sub-account: BAM Academy</span>
                    <span>Connected Dec 20, 2025</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ FullControl BILLING (SET-008) ═══ */}
          {tab === 'billing' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>FullControl Subscription</h3>
                <span className={s.sectionRef}>SET-008</span>
              </div>
              <div className={s.billingCard}>
                <div className={s.billingPlan}>
                  <div className={s.billingPlanName}>FullControl Pro</div>
                  <div className={s.billingPlanPrice}>$49<span>/mo</span></div>
                </div>
                <div className={s.billingMeta}>
                  <div className={s.billingRow}><span>Next billing date</span><span>Apr 1, 2026</span></div>
                  <div className={s.billingRow}><span>Payment method</span><span>Visa ending 4242</span></div>
                  <div className={s.billingRow}><span>Seats</span><span>2 of 5 used</span></div>
                </div>
                <div className={s.billingActions}>
                  <button className={s.editBtn}>Change Plan</button>
                  <button className={s.editBtn}>Update Payment</button>
                  <button className={s.editBtn}>View Invoices</button>
                </div>
              </div>
            </>
          )}

          {/* ═══ APPEARANCE (PRF-010) ═══ */}
          {tab === 'appearance' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Appearance</h3>
                <span className={s.sectionRef}>PRF-010</span>
              </div>
              <div className={s.formCard}>
                <div className={s.formGroup}>
                  <label className={s.formLabel}>Theme</label>
                  <div className={s.themeGrid}>
                    <button className={`${s.themeBtn} ${theme === 'light' ? s.themeBtnActive : ''}`} onClick={() => setTheme('light')}>
                      <div className={s.themePreviewLight}><div className={s.themePreviewSidebar} /><div className={s.themePreviewContent} /></div>
                      <span>Light</span>
                    </button>
                    <button className={`${s.themeBtn} ${theme === 'dark' ? s.themeBtnActive : ''}`} onClick={() => setTheme('dark')}>
                      <div className={s.themePreviewDark}><div className={s.themePreviewSidebar} /><div className={s.themePreviewContent} /></div>
                      <span>Dark</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Theme preference is saved per user and persists across sessions. Dark mode uses an alternate design token set.</span></div>
            </>
          )}

          {/* ═══ STRATEGY CHAT (PROTO-002) ═══ */}
          {tab === 'strategy' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Strategy & Positioning</h3>
                <span className={s.sectionRef}>PROTO-002</span>
              </div>
              <div className={s.strategyLayout}>
                <div className={s.strategyTopics}>
                  <div className={s.strategyTopicsTitle}>Topics</div>
                  {STRATEGY_TOPICS.map(t => (
                    <div key={t.id} className={`${s.strategyTopic} ${t.done ? s.strategyTopicDone : ''}`}>
                      <div className={`${s.strategyTopicCheck} ${t.done ? s.strategyTopicCheckDone : ''}`}>
                        {t.done && <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <span>{t.label}</span>
                    </div>
                  ))}
                  <div className={s.strategyProgress}>
                    {STRATEGY_TOPICS.filter(t => t.done).length} / {STRATEGY_TOPICS.length} complete
                  </div>
                </div>
                <div className={s.strategyChat}>
                  <div className={s.strategyChatMessages}>
                    {STRATEGY_MESSAGES.map((msg, i) => (
                      <div key={i} className={`${s.strategyChatMsg} ${msg.from === 'ai' ? s.strategyChatMsgAi : s.strategyChatMsgUser}`}>
                        {msg.from === 'ai' && <div className={s.strategyChatAvatar}>S</div>}
                        <div className={s.strategyChatBubble}>{msg.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className={s.strategyChatInput}>
                    <input type="text" placeholder="Type your response..." className={s.strategyChatField} />
                    <button className={s.strategyChatSend}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ STAFF & COACHES (STF-003 / STF-008) ═══ */}
          {tab === 'staff' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Staff & Coaches</h3>
                <div className={s.sectionActions}><button className={s.addBtn} onClick={() => { setEditingCoach(null); setShowCoachModal(true); }}>+ Add Coach</button><span className={s.sectionRef}>STF-003</span></div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Staff profiles power coach assignment on the schedule, trial report attribution, and parent-facing coach bios. Permissions control what each coach can access.</span></div>
              <div className={s.staffGrid}>
                {coaches.map(c => (
                  <div key={c.id} className={s.staffCard}>
                    <div className={s.staffCardHead}>
                      <div className={s.staffAvatar}>
                        {c.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      <div className={s.staffInfo}>
                        <div className={s.staffName}>{c.name} <span className={s.staffRoleBadge}>{c.role}</span></div>
                        <div className={s.staffEmail}>{c.email}</div>
                      </div>
                      <span className={c.permission === 'Owner' ? s.permBadgeOwner : s.permBadgeCoach}>{c.permission}</span>
                    </div>
                    <div className={s.staffDetails}>
                      <div className={s.staffDetailRow}>
                        <span className={s.staffDetailLabel}>Availability</span>
                        <span className={s.staffDetailValue}>{c.availability || '—'}</span>
                      </div>
                      <div className={s.staffDetailRow}>
                        <span className={s.staffDetailLabel}>Sessions this week</span>
                        <span className={s.staffDetailValue}>{c.sessions}</span>
                      </div>
                      <div className={s.staffDetailRow}>
                        <span className={s.staffDetailLabel}>Locations</span>
                        <span className={s.staffDetailValue}>
                          {c.locations?.map(loc => (
                            <span key={loc} className={s.coachLocPill}>{loc}</span>
                          ))}
                        </span>
                      </div>
                    </div>
                    <div className={s.staffCardActions}>
                      <button className={s.editBtn} onClick={() => { setEditingCoach(c); setShowCoachModal(true); }}>Edit</button>
                      <button className={s.archiveBtn} onClick={() => setCoaches(prev => prev.filter(x => x.id !== c.id))}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ═══ OBJECTION MAP (PROTO-015) ═══ */}
          {tab === 'objections' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Objection Map</h3>
                <div className={s.sectionActions}><button className={s.addBtn} onClick={() => setShowAddObjection(true)}>+ Add Objection</button><span className={s.sectionRef}>PROTO-015</span></div>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>When a parent raises one of these objections, the AI references your approved response strategy. Toggle off to skip, or edit to customize.</span></div>
              {['Price', 'Schedule', 'Child', 'Trust', 'Commitment', 'Timing'].map(cat => {
                const items = objections.filter(o => o.category === cat);
                if (!items.length) return null;
                return (
                  <div key={cat} className={s.objCategory}>
                    <div className={s.objCategoryTitle}>{cat === 'Child' ? 'Child Readiness' : cat} Objections</div>
                    {items.map(obj => (
                      <div key={obj.id} className={s.objCard}>
                        <div className={s.objHeader}>
                          <div className={s.objToggle} onClick={() => setObjections(prev => prev.map(o => o.id === obj.id ? { ...o, active: !o.active } : o))}>
                            <div className={`${s.objToggleTrack} ${obj.active ? s.objToggleActive : ''}`}>
                              <div className={s.objToggleThumb} />
                            </div>
                          </div>
                          <div className={s.objTitle}>"{obj.objection}"</div>
                        </div>
                        <div className={s.objResponse}>
                          <span className={s.objResponseLabel}>AI Response Strategy:</span>
                          <span>{obj.response}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {/* ═══ SETUP CHECKLIST (SET-009) ═══ */}
          {tab === 'checklist' && (
            <>
              <div className={s.sectionHead}>
                <h3 className={s.sectionTitle}>Academy Setup Checklist</h3>
                <span className={s.sectionRef}>SET-009</span>
              </div>
              <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>Complete all steps before going live. Each item links to the relevant settings section.</span></div>
              <div className={s.checklistCard}>
                {checklist.map(ck => (
                  <div
                    key={ck.id}
                    className={`${s.checklistItem} ${ck.done ? s.checklistDone : ''}`}
                    onClick={() => {
                      if (!ck.done) { setChecklist(prev => prev.map(c => c.id === ck.id ? { ...c, done: true } : c)); }
                    }}
                  >
                    <div className={`${s.checklistCheck} ${ck.done ? s.checklistCheckDone : ''}`}>
                      {ck.done && <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <span className={s.checklistLabel}>{ck.label}</span>
                    <span className={s.checklistRef}>{ck.ref}</span>
                  </div>
                ))}
              </div>
              <div className={s.checklistProgress}>
                <div className={s.checklistProgressBar}><div className={s.checklistProgressFill} style={{ width: `${(doneCount / checklist.length) * 100}%` }} /></div>
                <span className={s.checklistProgressLabel}>{doneCount} of {checklist.length} complete</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ OFFER WIZARD MODAL ═══ */}
      {showOfferWizard && (
        <div className={s.wizardOverlay} onClick={() => setShowOfferWizard(false)}>
          <div className={s.wizardModal} onClick={e => e.stopPropagation()}>
            <button className={s.wizardClose} onClick={() => setShowOfferWizard(false)}>✕</button>
            <div className={s.wizardTitle}>Create New Offer</div>
            <div className={s.wizardStepper}>
              {WIZARD_STEPS.map((step, i) => (
                <div key={step} className={`${s.wizardStep} ${i === wizardStep ? s.wizardStepActive : i < wizardStep ? s.wizardStepDone : ''}`}>
                  <div className={s.wizardStepNum}>{i + 1}</div>
                  <span className={s.wizardStepLabel}>{step}</span>
                </div>
              ))}
            </div>
            <div className={s.wizardBody}>
              {wizardStep === 0 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Target Age Group</label>
                  <input className={s.formInput} placeholder="e.g. Ages 8-12" />
                  <label className={s.formLabel}>Skill Level</label>
                  <select className={s.formSelect}><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>All Levels</option></select>
                  <label className={s.formLabel}>Format</label>
                  <select className={s.formSelect}><option>Group Training</option><option>Private</option><option>Semi-Private</option><option>Camp</option></select>
                </div>
              )}
              {wizardStep === 1 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Session Duration</label>
                  <select className={s.formSelect}><option>45 minutes</option><option>60 minutes</option><option>90 minutes</option><option>120 minutes</option></select>
                  <label className={s.formLabel}>Sessions Per Week</label>
                  <select className={s.formSelect}><option>1x/week</option><option>2x/week</option><option>3x/week</option><option>4x/week</option><option>5x/week</option></select>
                  <label className={s.formLabel}>Location</label>
                  <input className={s.formInput} defaultValue="BAM Academy — Main Court" />
                </div>
              )}
              {wizardStep === 2 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>What is included?</label>
                  <textarea className={s.formTextarea} rows={4} placeholder={"One inclusion per line, e.g.\nSkills training\nGame film review\nAccess to open gym"} />
                </div>
              )}
              {wizardStep === 3 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Pricing Model</label>
                  <select className={s.formSelect}><option>Monthly subscription</option><option>Per session</option><option>Package (multi-session)</option><option>Seasonal flat fee</option></select>
                  <label className={s.formLabel}>Price</label>
                  <input className={s.formInput} placeholder="e.g. $125" />
                </div>
              )}
              {wizardStep === 4 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Minimum Commitment</label>
                  <select className={s.formSelect}><option>Month-to-month</option><option>3 months</option><option>6 months</option><option>12 months</option><option>Season-based</option></select>
                </div>
              )}
              {wizardStep === 5 && (
                <div className={s.wizardContent}>
                  <div className={s.wizardReview}>
                    <div className={s.wizardReviewLabel}>Review your offer details above, then save.</div>
                    <div className={s.sageTip}><span className={s.sageTipLabel}>Sage</span><span>I will generate a name and description for this offer once you save. The offer will be automatically injected into the AI sales agent context.</span></div>
                  </div>
                </div>
              )}
            </div>
            <div className={s.wizardFooter}>
              {wizardStep > 0 && <button className={s.wizardBack} onClick={() => setWizardStep(wizardStep - 1)}>Back</button>}
              <div className={s.wizardSpacer} />
              {wizardStep < 5 ? (
                <button className={s.wizardNext} onClick={() => setWizardStep(wizardStep + 1)}>Next</button>
              ) : (
                <button className={s.wizardSave} onClick={() => setShowOfferWizard(false)}>Save Offer</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ COACH MODAL ═══ */}
      {showCoachModal && (
        <div className={s.wizardOverlay} onClick={() => setShowCoachModal(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h3>{editingCoach ? 'Edit Coach' : 'Add Coach'}</h3>
              <button className={s.modalClose} onClick={() => setShowCoachModal(false)}>✕</button>
            </div>
            <CoachForm
              coach={editingCoach}
              onSave={(data) => {
                if (editingCoach) {
                  setCoaches(prev => prev.map(c => c.id === editingCoach.id ? { ...c, ...data } : c));
                } else {
                  setCoaches(prev => [...prev, { ...data, id: `c${Date.now()}`, sessions: 0, members: 0, status: 'Active' }]);
                }
                setShowCoachModal(false);
                showToast();
              }}
              onClose={() => setShowCoachModal(false)}
            />
          </div>
        </div>
      )}

      {/* ═══ ADD OBJECTION MODAL ═══ */}
      {showAddObjection && (
        <div className={s.wizardOverlay} onClick={() => setShowAddObjection(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h3>Add Objection</h3>
              <button className={s.modalClose} onClick={() => setShowAddObjection(false)}>✕</button>
            </div>
            <AddObjectionForm onSave={(obj) => {
              setObjections(prev => [...prev, { ...obj, id: `obj${Date.now()}`, active: true }]);
              setShowAddObjection(false);
              showToast();
            }} onClose={() => setShowAddObjection(false)} />
          </div>
        </div>
      )}

      {/* ═══ SAVE TOAST ═══ */}
      <div className={`${s.toast} ${toastVisible ? s.toastShow : ''}`}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Changes saved
      </div>
    </main>
  );
}
