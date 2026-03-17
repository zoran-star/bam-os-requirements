import { useState, useEffect, useRef, useCallback } from 'react';
import PageBanner from '../components/PageBanner';
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
const ALL_KPIS = [
  { id: 'new_members', label: 'New Members', current: 6, target: 10, unit: '', color: '#3EAF5C', icon: '👥', desc: 'New subscriptions this month' },
  { id: 'mrr_growth', label: 'MRR Growth', current: 8.2, target: 10, unit: '%', color: '#C8A84E', icon: '💰', desc: 'Monthly recurring revenue growth' },
  { id: 'classes_filled', label: 'Classes Filled', current: 18, target: 24, unit: '', color: '#6366f1', icon: '📅', desc: 'Sessions at 80%+ capacity' },
  { id: 'trials_booked', label: 'Trials Booked', current: 4, target: 6, unit: '', color: '#E09D24', icon: '🎯', desc: 'Free trial signups this month' },
  { id: 'churn_rate', label: 'Churn Rate', current: 2.4, target: 5, unit: '%', color: '#E05A42', icon: '📉', desc: 'Member cancellation rate (lower is better)' },
  { id: 'avg_attendance', label: 'Avg Attendance', current: 8.2, target: 12, unit: '', color: '#3EAF5C', icon: '🏀', desc: 'Average athletes per session' },
  { id: 'trial_conversion', label: 'Trial Conversion', current: 67, target: 80, unit: '%', color: '#C8A84E', icon: '🔄', desc: 'Trials converting to paid members' },
  { id: 'revenue_per_member', label: 'Revenue / Member', current: 126, target: 150, unit: '$', color: '#6366f1', icon: '💵', desc: 'Average monthly revenue per member' },
  { id: 'referral_rate', label: 'Referral Rate', current: 12, target: 20, unit: '%', color: '#E09D24', icon: '🤝', desc: 'Members who referred someone' },
  { id: 'session_fill_rate', label: 'Fill Rate', current: 75, target: 90, unit: '%', color: '#3EAF5C', icon: '📊', desc: 'Average class capacity utilization' },
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
  icon: '🏆',
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
    if (picks.includes(id)) setPicks(picks.filter(p => p !== id));
    else if (picks.length < 6) setPicks([...picks, id]);
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
                    <span className={s.pickerDragHandle}>⠿</span>
                    <span className={s.pickerDragIcon}>{kpi.icon}</span>
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
                  <span className={s.pickerKpiIcon}>{kpi.icon}</span>
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
            <span className={s.pickerSageChevron}>{showSage ? '▲' : '▼'}</span>
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
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [milestonePhase, setMilestonePhase] = useState('ring');
  const [challengeDismissed, setChallengeDismissed] = useState(false);
  const [sageExpanded, setSageExpanded] = useState(false);
  const [sageInput, setSageInput] = useState('');
  const [sageResponse, setSageResponse] = useState(null);
  const [selectedKpis, setSelectedKpis] = useState(DEFAULT_SELECTED);
  const [pickerOpen, setPickerOpen] = useState(false);
  const typewriterText = useTypewriter(ADVISOR_PROMPTS);
  const actionCount = useCountUp(7);
  const sageInputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 1500);
    return () => clearTimeout(t);
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
        <div className={s.welcome}>
          <div className={s.welcomeGlow} />
          <div className={s.welcomeContent}>
            <div className={s.welcomeLogo}>B</div>
            <div className={s.welcomeGreeting}>{GREETING}, Zoran</div>
            <div className={s.welcomeData}>Your MRR is up 8% this month</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={sh.main}>
      <PageBanner
        title="Home"
        stats={[
          { value: TODAY, explanation: 'Current date' },
          { value: '7 Actions', explanation: 'Completed today' },
          { value: '$8.2k MRR', explanation: 'Monthly recurring revenue' },
        ]}
      />

      <div className={sh.scroll}>
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

        {/* ═══ SAGE — expanding greeting pill ═══ */}
        <div className={`${s.sageWrap} ${sageExpanded ? s.sageWrapExpanded : ''}`}>
          <div className={s.sageBorderGlow} />

          {!sageExpanded ? (
            <div className={s.sagePill} onClick={() => setSageExpanded(true)}>
              <div className={s.sagePillOrb}>
                <span className={s.sagePillOrbLetter}>S</span>
                <div className={s.sagePillOrbPulse} />
              </div>
              <div className={s.sagePillText}>
                <span className={s.sagePillGreeting}>Hey Zoran</span>
                <span className={s.sagePillPrompt}> — ask me anything</span>
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
                  <div className={s.sageExpandedName}>{GREETING}, Zoran</div>
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

              {/* Quick suggestions */}
              <div className={s.sageSuggestions}>
                {['What should I focus on today?', 'Follow up with cold leads', 'Show revenue breakdown', 'Which KPIs need attention?'].map(q => (
                  <button key={q} className={s.sageSugChip} onClick={() => { setSageInput(q); handleSageSubmit(); }}>
                    {q}
                  </button>
                ))}
              </div>

              {/* Sage response */}
              {sageResponse && (
                <div className={s.sageResponseCard}>
                  <div className={s.sageResponseQ}>You asked: &ldquo;{sageResponse.q}&rdquo;</div>
                  <div className={s.sageResponseA}>{sageResponse.a}</div>
                </div>
              )}
            </div>
          )}
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
                <div key={r.id} className={s.ringCard}>
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
          </div>
        </div>

        {/* ═══ SAGE CHALLENGE ═══ */}
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

        {/* Two column row */}
        <div className={s.twoCol}>
          <div className={s.taskCard}>
            <div className={s.taskHeader}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span className={s.taskLabel}>Get started</span>
            </div>
            <div className={s.taskTitle}>Follow up with Ava Martinez</div>
            <div className={s.taskDesc}>She finished her trial yesterday and asked about membership options. Highest close probability in your pipeline right now.</div>
            <button className={s.taskCta}>Open conversation →</button>
          </div>
          <div className={s.actionCard}>
            <div className={s.actionLabel}>Actions completed today</div>
            <div className={s.actionValue}>{actionCount}</div>
            <div className={s.actionCompare}>
              <span className={s.actionUp}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                +3 vs yesterday
              </span>
            </div>
            <div className={s.actionAvg}>Your daily average: 5.2</div>
          </div>
        </div>

        {/* Notification cards */}
        <div className={s.notifSection}>
          <div className={s.sectionTitle}>Notifications</div>
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
              <span className={s.milestoneTrophyIcon}>{MILESTONE.icon}</span>
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
          <span>{MILESTONE.icon}</span>
          <span className={s.milestoneBadgeText}>{MILESTONE.label}</span>
        </div>
      )}
    </main>
  );
}
