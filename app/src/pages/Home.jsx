import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocation } from '../context/LocationContext';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useTypewriter from '../hooks/useTypewriter';
import useCountUp from '../hooks/useCountUp';
import s from '../styles/Home.module.css';
import sh from '../styles/shared.module.css';

const ADVISOR_PROMPTS = [
  "What's on your mind?",
  "Ask Sage anything about your business…",
  "How should I follow up with cold leads?",
  "What's my biggest growth opportunity?",
  "Which KPIs should I focus on this month?",
];

const GREETING = (() => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
})();

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/* ─── All available KPIs for the picker ─── */
/* SVG icon helpers for KPIs */
const KPI_ICONS = {
  new_members: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  mrr_growth: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  classes_filled: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  trials_booked: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>,
  churn_rate: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  avg_attendance: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  trial_conversion: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  revenue_per_member: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  referral_rate: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>,
  session_fill_rate: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
};

const ALL_KPIS = [
  { id: 'new_members', label: 'New Members', current: 6, target: 10, unit: '', color: '#3EAF5C', desc: 'New subscriptions this month', link: '/members' },
  { id: 'mrr_growth', label: 'MRR Growth', current: 8.2, target: 10, unit: '%', color: '#C8A84E', desc: 'Monthly recurring revenue growth', link: '/members' },
  { id: 'classes_filled', label: 'Classes Filled', current: 18, target: 24, unit: '', color: '#6366f1', desc: 'Sessions at 80%+ capacity', link: '/members' },
  { id: 'trials_booked', label: 'Trials Booked', current: 4, target: 6, unit: '', color: '#E09D24', desc: 'Free trial signups this month', link: '/sales' },
  { id: 'churn_rate', label: 'Churn Rate', current: 2.4, target: 5, unit: '%', color: '#E05A42', desc: 'Member cancellation rate (lower is better)', link: '/members' },
  { id: 'avg_attendance', label: 'Avg Attendance', current: 8.2, target: 12, unit: '', color: '#3EAF5C', desc: 'Average athletes per session', link: '/members' },
  { id: 'trial_conversion', label: 'Trial Conversion', current: 67, target: 80, unit: '%', color: '#C8A84E', desc: 'Trials converting to paid members', link: '/sales' },
  { id: 'revenue_per_member', label: 'Revenue / Member', current: 126, target: 150, unit: '$', color: '#6366f1', desc: 'Average monthly revenue per member', link: '/members' },
  { id: 'referral_rate', label: 'Referral Rate', current: 12, target: 20, unit: '%', color: '#E09D24', desc: 'Members who referred someone', link: '/marketing' },
  { id: 'session_fill_rate', label: 'Fill Rate', current: 75, target: 90, unit: '%', color: '#3EAF5C', desc: 'Average class capacity utilization', link: '/members' },
];

const DEFAULT_SELECTED = ['new_members', 'mrr_growth', 'classes_filled', 'trials_booked'];

/* ─── Sage challenge ─── */
const SAGE_CHALLENGE = {
  text: "You're 2 members away from your best month ever.",
  action: 'Draft a follow-up to your 3 unconverted trials?',
};

/* ─── Milestone ─── */
const MILESTONE = {
  label: 'MRR crossed $8k',
  detail: 'First time hitting this level — up 18% from 3 months ago',
};

/* ─── Sage KPI advice (simulated responses) ─── */
const SAGE_KPI_ADVICE = [
  { q: 'Which KPIs matter most for my stage?', a: "You're in growth mode with 42 members. Focus on **New Members** and **Trial Conversion** — those are your growth levers. Churn rate matters but yours is healthy at 2.4%, so don't over-index on retention yet." },
  { q: 'What should I track to reduce churn?', a: "Add **Avg Attendance** and **Churn Rate** to your dashboard. Members who attend less than 2x/week are 4x more likely to cancel. Your attendance is solid at 8.2/class — keep watching it." },
  { q: 'How do I grow revenue without more members?', a: "Track **Revenue/Member** and **Fill Rate**. You can increase revenue by filling existing classes (75% → 90%) and upselling plans. Your ARPM of $126 has room to grow toward $150." },
];

/* ─── ProgressRing SVG ─── */
function ProgressRing({ current, target, color, size = 72, stroke = 6 }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.min(current / target, 1);
  const [animPct, setAnimPct] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimPct(pct), 100);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <svg width={size} height={size} className={s.ringSvg}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surf3)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - animPct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={s.ringProgress}
      />
    </svg>
  );
}

/* ─── KPI Picker Modal ─── */
function KpiPicker({ selected, onSave, onClose }) {
  const [picks, setPicks] = useState(selected);
  const [dragIdx, setDragIdx] = useState(null);
  const [sageChat, setSageChat] = useState([]);
  const [sageInput, setSageInput] = useState('');
  const [showSage, setShowSage] = useState(false);

  const toggle = (id) => {
    if (picks.includes(id)) {
      if (picks.length > 3) setPicks(picks.filter(p => p !== id));
    } else if (picks.length < 6) setPicks([...picks, id]);
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newPicks = [...picks];
    const [moved] = newPicks.splice(dragIdx, 1);
    newPicks.splice(idx, 0, moved);
    setPicks(newPicks);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const askSage = (question) => {
    const advice = SAGE_KPI_ADVICE.find(a => a.q === question);
    setSageChat(prev => [...prev, { q: question, a: advice?.a || "I'd recommend focusing on the metrics most tied to your current goal — growth, retention, or revenue. What matters most to you right now?" }]);
    setSageInput('');
  };

  return (
    <div className={s.pickerOverlay} onClick={onClose}>
      <div className={s.pickerModal} onClick={e => e.stopPropagation()}>
        <div className={s.pickerHead}>
          <div>
            <h3 className={s.pickerTitle}>Choose Your KPIs</h3>
            <p className={s.pickerSub}>Select up to 6 metrics. Drag to reorder.</p>
          </div>
          <button className={s.pickerClose} onClick={onClose}>✕</button>
        </div>

        {/* Selected KPIs — draggable */}
        {picks.length > 0 && (
          <div className={s.pickerSelected}>
            <div className={s.pickerSectionLabel}>Your dashboard ({picks.length}/6)</div>
            <div className={s.pickerDragList}>
              {picks.map((id, idx) => {
                const kpi = ALL_KPIS.find(k => k.id === id);
                return (
                  <div
                    key={id}
                    className={`${s.pickerDragItem} ${dragIdx === idx ? s.pickerDragActive : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                  >
                    <span className={s.pickerDragHandle}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                    </span>
                    <span className={s.pickerDragIcon}>{KPI_ICONS[kpi.id]}</span>
                    <span className={s.pickerDragLabel}>{kpi.label}</span>
                    <button className={s.pickerRemove} onClick={() => toggle(id)}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All KPIs grid */}
        <div className={s.pickerSectionLabel}>Available metrics</div>
        <div className={s.pickerGrid}>
          {ALL_KPIS.map(kpi => {
            const isSelected = picks.includes(kpi.id);
            return (
              <div
                key={kpi.id}
                className={`${s.pickerKpiCard} ${isSelected ? s.pickerKpiSelected : ''}`}
                onClick={() => toggle(kpi.id)}
              >
                <div className={s.pickerKpiTop}>
                  <span className={s.pickerKpiIcon}>{KPI_ICONS[kpi.id]}</span>
                  {isSelected && <span className={s.pickerKpiCheck}>✓</span>}
                </div>
                <div className={s.pickerKpiLabel}>{kpi.label}</div>
                <div className={s.pickerKpiDesc}>{kpi.desc}</div>
              </div>
            );
          })}
        </div>

        {/* Sage consultation */}
        <div className={s.pickerSage}>
          <button className={s.pickerSageToggle} onClick={() => setShowSage(!showSage)}>
            <span className={s.pickerSageIcon}>S</span>
            <span>Not sure which to pick? Ask Sage</span>
            <span className={s.pickerSageChevron}>
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">{showSage ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}</svg>
            </span>
          </button>

          {showSage && (
            <div className={s.pickerSagePanel}>
              {/* Quick questions */}
              <div className={s.pickerSageQuickRow}>
                {SAGE_KPI_ADVICE.map(a => (
                  <button key={a.q} className={s.pickerSageQuick} onClick={() => askSage(a.q)}>{a.q}</button>
                ))}
              </div>

              {/* Chat history */}
              {sageChat.map((msg, i) => (
                <div key={i} className={s.pickerSageMsg}>
                  <div className={s.pickerSageMsgQ}>{msg.q}</div>
                  <div className={s.pickerSageMsgA}>{msg.a}</div>
                </div>
              ))}

              {/* Free-form input */}
              <div className={s.pickerSageInputRow}>
                <input
                  className={s.pickerSageInput}
                  value={sageInput}
                  onChange={e => setSageInput(e.target.value)}
                  placeholder="Ask Sage about your metrics..."
                  onKeyDown={e => e.key === 'Enter' && sageInput.trim() && askSage(sageInput)}
                />
                <button className={s.pickerSageSend} onClick={() => sageInput.trim() && askSage(sageInput)} disabled={!sageInput.trim()}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={s.pickerFooter}>
          <button className={s.pickerCancel} onClick={onClose}>Cancel</button>
          <button className={s.pickerSave} onClick={() => { onSave(picks); onClose(); }}>Save dashboard</button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export default function Home() {
  const [loaded, setLoaded] = useState(false);
  const [introText, setIntroText] = useState('');
  const [introFading, setIntroFading] = useState(false);
  const [milestoneVisible, setMilestoneVisible] = useState(true);
  const [milestonePhase, setMilestonePhase] = useState('ring');
  const [challengeDismissed, setChallengeDismissed] = useState(false);
  const [sageExpanded, setSageExpanded] = useState(false);
  const [sageInput, setSageInput] = useState('');
  const [sageResponse, setSageResponse] = useState(null);
  const [selectedKpis, setSelectedKpis] = useState(() => {
    try { const saved = localStorage.getItem('fc_kpis'); return saved ? JSON.parse(saved) : DEFAULT_SELECTED; } catch { return DEFAULT_SELECTED; }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();

  // Persist KPI selection
  useEffect(() => {
    try { localStorage.setItem('fc_kpis', JSON.stringify(selectedKpis)); } catch {}
  }, [selectedKpis]);
  const { location: activeLocation, setLocation: setActiveLocation } = useLocation();
  const locationLabel = activeLocation === 'all' ? '' : ` · ${activeLocation.charAt(0).toUpperCase() + activeLocation.slice(1)}`;
  const typewriterText = useTypewriter(ADVISOR_PROMPTS);
  const actionCount = useCountUp(7);
  const aiActionCount = useCountUp(47);
  const streakCount = 12;
  const avgActions = 5.2;
  const sageInputRef = useRef(null);
  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);

  /* Sage pill typing animation */
  const PILL_PROMPTS = [
    "what do you need? I'll figure it out",
    "what should I work on next?",
    "got a question? just ask",
    "give me a task — I'm on it",
  ];
  const [pillText, setPillText] = useState('');
  const pillRef = useRef({ idx: 0, charIdx: 0, deleting: false, timeout: null });

  useEffect(() => {
    if (sageExpanded || !loaded) return;
    const r = pillRef.current;
    const tick = () => {
      const full = PILL_PROMPTS[r.idx];
      if (!r.deleting) {
        r.charIdx++;
        setPillText(full.slice(0, r.charIdx));
        if (r.charIdx >= full.length) {
          r.timeout = setTimeout(() => { r.deleting = true; tick(); }, 2200);
          return;
        }
        r.timeout = setTimeout(tick, 45 + Math.random() * 35);
      } else {
        r.charIdx--;
        setPillText(full.slice(0, r.charIdx));
        if (r.charIdx <= 0) {
          r.deleting = false;
          r.idx = (r.idx + 1) % PILL_PROMPTS.length;
          r.timeout = setTimeout(tick, 400);
          return;
        }
        r.timeout = setTimeout(tick, 25);
      }
    };
    r.timeout = setTimeout(tick, 800);
    return () => clearTimeout(r.timeout);
  }, [loaded, sageExpanded]);

  useEffect(() => {
    const greeting = `${GREETING}, Coleman`;
    let i = 0;
    const typeTimer = setInterval(() => {
      i++;
      setIntroText(greeting.slice(0, i));
      if (i >= greeting.length) {
        clearInterval(typeTimer);
        setTimeout(() => setIntroFading(true), 900);
        setTimeout(() => setLoaded(true), 1600);
      }
    }, 55);
    return () => clearInterval(typeTimer);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t1 = setTimeout(() => setMilestoneVisible(true), 2000);
    const t2 = setTimeout(() => setMilestonePhase('trophy'), 3200);
    const t3 = setTimeout(() => setMilestonePhase('badge'), 4400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loaded]);

  useEffect(() => {
    if (sageExpanded && sageInputRef.current) {
      setTimeout(() => sageInputRef.current?.focus(), 300);
    }
  }, [sageExpanded]);

  const handleSageSubmit = () => {
    if (!sageInput.trim()) return;
    setSageResponse({
      q: sageInput,
      a: `Great question. Let me look into "${sageInput.toLowerCase()}" for you — I'll pull the latest data and have a recommendation ready in a moment.`,
    });
    setSageInput('');
  };

  const rings = selectedKpis.map(id => ALL_KPIS.find(k => k.id === id)).filter(Boolean);

  if (!loaded) {
    return (
      <main className={sh.main}>
        <div className={`${s.welcome} ${introFading ? s.welcomeFading : ''}`}>
          <div className={s.welcomeGlow} />
          <div className={s.welcomeGlow2} />
          <div className={s.welcomeContent}>
            <div className={s.welcomeOrb}>
              <span className={s.welcomeOrbLetter}>S</span>
              <div className={s.welcomeOrbRing} />
              <div className={s.welcomeOrbRing2} />
            </div>
            <div className={s.welcomeGreeting}>
              {introText}
              <span className={s.welcomeCursor} />
            </div>
          </div>
          <div className={s.welcomeParticles}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={s.welcomeParticle} style={{ '--i': i }} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={sh.main}>
      {/* ═══ COMMAND BAR — replaces old PageBanner ═══ */}
      <div className={s.cmdBar}>
        <div className={s.cmdBarCanvas}>
          <canvas ref={canvasRef} />
        </div>
        <div className={s.cmdLeft}>
          <div className={s.cmdGreeting}>{GREETING}, Coleman</div>
          <div className={s.cmdDate}>{TODAY}{locationLabel}</div>
        </div>
        <div className={s.cmdCenter}>
          <div className={s.cmdSearch} style={{ position: 'relative' }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className={s.cmdInput} placeholder="Search members, classes, or ask Sage..."
              value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchOpen(!!e.target.value) }}
              onFocus={() => searchQuery && setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 200)} />
            <kbd className={s.cmdKbd}>⌘K</kbd>
            {searchOpen && searchQuery && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 4, boxShadow: '0 8px 28px rgba(0,0,0,0.1)', zIndex: 50, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                {[
                  { type: 'Member', name: 'Ava Chen', detail: 'Active · Elite Plan' },
                  { type: 'Member', name: 'Carlos Martinez', detail: 'Active · Elite Plan' },
                  { type: 'Member', name: 'Mia Thompson', detail: 'Active · Youth Plan' },
                  { type: 'Lead', name: 'Marcus Johnson', detail: 'New inquiry · Instagram' },
                  { type: 'Lead', name: 'Emily Watson', detail: 'Trial scheduled' },
                  { type: 'Class', name: 'Elite Skills Training', detail: 'Today 9:00 AM · Coach Zoran' },
                  { type: 'Class', name: 'Youth Development', detail: 'Today 10:30 AM · Coach Marcus' },
                  { type: 'Class', name: 'Shooting Lab', detail: 'Today 4:00 PM' },
                ].filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()) || r.type.toLowerCase().includes(searchQuery.toLowerCase()))
                .slice(0, 5).map((r, i) => (
                  <div key={i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}
                    onMouseDown={() => { setSearchQuery(''); setSearchOpen(false); if (r.type === 'Member') navigate('/members'); else if (r.type === 'Lead') navigate('/sales'); else navigate('/schedule'); }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 48 }}>{r.type}</span>
                    <span style={{ fontWeight: 600, color: 'var(--tp)' }}>{r.name}</span>
                    <span style={{ color: 'var(--ts)', marginLeft: 'auto', fontSize: 11 }}>{r.detail}</span>
                  </div>
                ))}
                {[].length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--ts)', fontSize: 13 }}>No results</div>}
              </div>
            )}
          </div>
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
          <div className={s.cmdChip} onClick={() => setSageExpanded(true)}>
            <span className={s.cmdChipDot} style={{ background: actionCount >= avgActions ? 'var(--green)' : 'var(--warn)' }} />
            <span className={s.cmdChipValue}>{actionCount}</span>
            <span className={s.cmdChipLabel}>actions <span style={{ color: 'var(--tm)', fontWeight: 400 }}>vs {avgActions} avg</span></span>
          </div>
          <div className={s.cmdChip}>
            <span className={s.cmdChipDot} style={{ background: 'var(--blue)' }} />
            <span className={s.cmdChipValue}>{aiActionCount}</span>
            <span className={s.cmdChipLabel}>AI actions</span>
          </div>
          <div className={s.cmdChip}>
            <span className={s.cmdChipDot} style={{ background: '#f59e0b' }} />
            <span className={s.cmdChipValue}>{streakCount}d</span>
            <span className={s.cmdChipLabel}>streak</span>
          </div>
          <div className={s.cmdChip}>
            <span className={s.cmdChipDot} style={{ background: 'var(--gold)' }} />
            <span className={s.cmdChipValue}>$8.2k</span>
            <span className={s.cmdChipLabel}>MRR</span>
          </div>
          <div className={s.cmdChip}>
            <span className={s.cmdChipDot} style={{ background: '#6366f1' }} />
            <span className={s.cmdChipValue}>42</span>
            <span className={s.cmdChipLabel}>members</span>
          </div>
          <button className={s.cmdBell}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span className={s.cmdBellBadge}>3</span>
          </button>
        </div>
      </div>

      <div className={sh.scroll}>
        {/* ═══ HERO ROW: highlight + Sage side by side ═══ */}
        <div className={s.heroRow}>
          {/* Best thing highlight */}
          <div className={s.highlight}>
            <div className={s.highlightIcon}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div className={s.highlightBody}>
              <div className={s.highlightLabel}>Best thing since your last open</div>
              <div className={s.highlightValue}>+2 trials booked today</div>
              <div className={s.highlightContext}>Mia Thompson and Sofia Reyes both confirmed — your Saturday pipeline is strongest it's been in 3 weeks.</div>
            </div>
          </div>

          {/* Priority task — dominant CTA */}
          <div className={s.taskCard}>
            <div className={s.taskHeader}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span className={s.taskLabel}>Your #1 priority</span>
            </div>
            <div className={s.taskTitle}>Follow up with Ava Martinez</div>
            <div className={s.taskDesc}>She finished her trial yesterday and asked about membership options. Highest close probability in your pipeline.</div>
            <button className={s.taskCta}>Open conversation →</button>
          </div>
        </div>

        {/* ═══ SAGE — expanding greeting pill ═══ */}
        <div className={`${s.sageWrap} ${sageExpanded ? s.sageWrapExpanded : ''}`}>
          <div className={s.sageBorderGlow} />

          {!sageExpanded ? (
            <div className={s.sagePill} onClick={() => setSageExpanded(true)} data-sage-tooltip>
              <div className={s.sagePillOrb}>
                <span className={s.sagePillOrbLetter}>S</span>
                <div className={s.sagePillOrbPulse} />
              </div>
              <div className={s.sagePillText}>
                <span className={s.sagePillGreeting}>Hey Coleman</span>
                <span className={s.sagePillPrompt}> — {pillText}<span className={s.sagePillCursor} /></span>
              </div>
              <div className={s.sagePillWaveform}>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={s.sagePillBar} style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className={s.sageExpanded}>
              <div className={s.sageExpandedTop}>
                <div className={s.sageExpandedOrb}>
                  <span className={s.sagePillOrbLetter}>S</span>
                </div>
                <div className={s.sageExpandedGreeting}>
                  <div className={s.sageExpandedName}>{GREETING}, Coleman</div>
                  <div className={s.sageExpandedSub}>What can I help you with?</div>
                </div>
                <button className={s.sageCollapse} onClick={() => setSageExpanded(false)}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
              </div>

              <div className={s.sageInputRow}>
                <input
                  ref={sageInputRef}
                  className={s.sageInputField}
                  value={sageInput}
                  onChange={e => setSageInput(e.target.value)}
                  placeholder={typewriterText}
                  onKeyDown={e => e.key === 'Enter' && handleSageSubmit()}
                />
                <div className={s.sageMic}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </div>
                <button className={s.sageSend} onClick={handleSageSubmit} disabled={!sageInput.trim()}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </button>
              </div>

              <div className={s.sageSuggestions}>
                {['What should I focus on today?', 'Follow up with cold leads', 'Show revenue breakdown', 'Which KPIs need attention?'].map(q => (
                  <button key={q} className={s.sageSugChip} onClick={() => { setSageInput(q); handleSageSubmit(); }}>
                    {q}
                  </button>
                ))}
              </div>

              {sageResponse && (
                <div className={s.sageResponseCard}>
                  <div className={s.sageResponseQ}>You asked: &ldquo;{sageResponse.q}&rdquo;</div>
                  <div className={s.sageResponseA}>{sageResponse.a}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ ACTION ITEMS + TODAY'S SCHEDULE ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* Action Items */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tp)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" fill="none" stroke="var(--gold)" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Action Items
            </div>
            {[
              { label: '2 content pieces pending review', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, color: '#6366f1', link: '/content' },
              { label: '1 failed payment (Jake Rivera)', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, color: '#E05A42', link: '/members' },
              { label: '3 leads need follow-up', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>, color: '#C8A84E', link: '/sales' },
              { label: '4pm Intermediate — 3/12 spots filled', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, color: '#3EAF5C', link: '/schedule' },
            ].map((item, i) => (
              <div key={i} onClick={() => navigate(item.link)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', cursor: 'pointer', fontSize: 13, color: 'var(--tp)' }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                <span>{item.label}</span>
                <svg width="12" height="12" fill="none" stroke="var(--ts)" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 'auto' }}><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            ))}
          </div>

          {/* Today's Schedule */}
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tp)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" fill="none" stroke="var(--gold)" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Today's Schedule
            </div>
            {[
              { name: 'Elite Training', time: '9:00 AM', fill: '13/15', color: '#C8A84E' },
              { name: 'Group Training', time: '11:00 AM', fill: '11/15', color: '#3EAF5C' },
              { name: 'Beginner', time: '4:00 PM', fill: '8/12', color: '#6B8AE0' },
              { name: 'Individual Session', time: '5:00 PM', fill: '1/1', color: '#9B6BCC' },
            ].map((session, i) => (
              <div key={i} onClick={() => navigate('/schedule')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', cursor: 'pointer', fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: session.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: 'var(--tp)' }}>{session.name}</span>
                <span style={{ color: 'var(--ts)' }}>{session.time}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--tp)', background: 'var(--surf2)', padding: '2px 8px', borderRadius: 6 }}>{session.fill}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ PROGRESS RINGS ═══ */}
        <div className={s.ringsSection}>
          <div className={s.ringsSectionHead}>
            <div className={s.ringsSectionTitle}>Monthly Progress</div>
            <div className={s.ringsSectionSub}>vs. last month as baseline</div>
            <button className={s.ringsCustomize} onClick={() => setPickerOpen(true)}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              Customize
            </button>
          </div>
          <div className={s.ringsGrid}>
            {rings.map(r => {
              const pct = Math.round((r.current / r.target) * 100);
              return (
                <div key={r.id} className={s.ringCard} onClick={() => navigate(r.link)} style={{ cursor: 'pointer' }}>
                  <div className={s.ringVisual}>
                    <ProgressRing current={r.current} target={r.target} color={r.color} />
                    <div className={s.ringCenter}>
                      <span className={s.ringPct}>{pct}%</span>
                    </div>
                  </div>
                  <div className={s.ringInfo}>
                    <div className={s.ringLabel}>{r.label}</div>
                    <div className={s.ringFraction}>
                      <span className={s.ringCurrent}>{r.unit === '$' ? '$' : ''}{r.current}{r.unit === '%' ? '%' : ''}</span>
                      <span className={s.ringDivider}>/</span>
                      <span className={s.ringTarget}>{r.unit === '$' ? '$' : ''}{r.target}{r.unit === '%' ? '%' : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {rings.length < 3 && (
              <div className={s.ringCardEmpty} onClick={() => setPickerOpen(true)}>
                <div className={s.ringCardEmptyIcon}>
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                </div>
                <div className={s.ringCardEmptyText}>Add a KPI</div>
                <div className={s.ringCardEmptySub}>Track what matters most to your academy</div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ SAGE CHALLENGE + ACTIVITY ═══ */}
        <div className={s.sectionLabel}>Activity</div>

        {!challengeDismissed && (
          <div className={s.challenge}>
            <div className={s.challengeLeft}>
              <div className={s.challengeIcon}>
                <div className={s.challengeSageIcon}>S</div>
              </div>
              <div className={s.challengeBody}>
                <div className={s.challengeLabel}>Weekly Challenge</div>
                <div className={s.challengeText}>{SAGE_CHALLENGE.text}</div>
                <div className={s.challengeAction}>{SAGE_CHALLENGE.action}</div>
              </div>
            </div>
            <div className={s.challengeRight}>
              <button className={s.challengeBtn}>Let's do it</button>
              <button className={s.challengeDismiss} onClick={() => setChallengeDismissed(true)}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Notifications */}
        <div className={s.notifList}>
          <div className={s.notifCard}>
            <div className={s.notifDot} />
            <div className={s.notifBody}>
              <div className={s.notifText}><strong>New lead:</strong> James Park inquired via Instagram DM about the teen competitive program.</div>
              <div className={s.notifTime}>2h ago</div>
            </div>
          </div>
          <div className={s.notifCard}>
            <div className={s.notifDot} />
            <div className={s.notifBody}>
              <div className={s.notifText}><strong>Payment received:</strong> Carlos Martinez — $175/mo membership started.</div>
              <div className={s.notifTime}>5h ago</div>
            </div>
          </div>
          <div className={`${s.notifCard} ${s.notifRead}`}>
            <div className={s.notifBody}>
              <div className={s.notifText}><strong>Session reminder:</strong> 3 athletes expected for the 4pm Intermediate group.</div>
              <div className={s.notifTime}>Today, 3:30pm</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ KPI PICKER ═══ */}
      {pickerOpen && (
        <KpiPicker
          selected={selectedKpis}
          onSave={setSelectedKpis}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* ═══ MILESTONE CELEBRATION ═══ */}
      {milestoneVisible && milestonePhase !== 'badge' && (
        <div className={s.milestoneOverlay}>
          <div className={s.milestoneCard}>
            <div className={`${s.milestoneRing} ${milestonePhase === 'ring' ? s.milestoneRingActive : s.milestoneRingDone}`}>
              <svg width="120" height="120" className={s.milestoneRingSvg}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surf3)" strokeWidth="6" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--gold)" strokeWidth="6" strokeLinecap="round" strokeDasharray={2 * Math.PI * 52} strokeDashoffset={0} transform="rotate(-90 60 60)" className={s.milestoneRingStroke} />
              </svg>
              <div className={s.milestoneRipple1} />
              <div className={s.milestoneRipple2} />
              <div className={s.milestoneRipple3} />
            </div>
            <div className={`${s.milestoneTrophy} ${milestonePhase === 'trophy' ? s.milestoneTrophyVisible : ''}`}>
              <span className={s.milestoneTrophyIcon}>
                <svg width="48" height="48" fill="none" stroke="var(--gold)" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10l-1 8a4 4 0 0 1-8 0L7 4z"/><path d="M7 4H4a1 1 0 0 0-1 1v1a3 3 0 0 0 3 3"/><path d="M17 4h3a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3"/></svg>
              </span>
            </div>
            <div className={s.milestoneText}>
              <div className={s.milestoneLabel}>Milestone Reached</div>
              <div className={s.milestoneTitle}>{MILESTONE.label}</div>
              <div className={s.milestoneDetail}>{MILESTONE.detail}</div>
            </div>
            <button className={s.milestoneDismiss} onClick={() => setMilestonePhase('badge')}>Nice!</button>
          </div>
        </div>
      )}

      {milestonePhase === 'badge' && (
        <div className={s.milestoneBadge}>
          <svg width="16" height="16" fill="none" stroke="var(--gold)" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10l-1 8a4 4 0 0 1-8 0L7 4z"/><path d="M7 4H4a1 1 0 0 0-1 1v1a3 3 0 0 0 3 3"/><path d="M17 4h3a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3"/></svg>
          <span className={s.milestoneBadgeText}>{MILESTONE.label}</span>
        </div>
      )}
    </main>
  );
}
