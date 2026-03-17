import { useState, useEffect, useRef } from 'react';
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
];

const GREETING = (() => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
})();

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/* ─── Progress ring data ─── */
const RINGS = [
  { label: 'New Members', current: 6, target: 10, unit: '', color: '#3EAF5C', icon: '👥' },
  { label: 'MRR Growth', current: 8.2, target: 10, unit: '%', color: '#C8A84E', icon: '💰' },
  { label: 'Classes Filled', current: 18, target: 24, unit: '', color: '#6366f1', icon: '📅' },
  { label: 'Trials Booked', current: 4, target: 6, unit: '', color: '#E09D24', icon: '🎯' },
];

/* ─── Sage challenge ─── */
const SAGE_CHALLENGE = {
  text: "You're 2 members away from your best month ever.",
  action: 'Draft a follow-up to your 3 unconverted trials?',
  metric: 'New Members',
  currentStreak: 12,
};

/* ─── Milestone (simulated — one fires on load for demo) ─── */
const MILESTONE = {
  label: 'MRR crossed $8k',
  detail: 'First time hitting this level — up 18% from 3 months ago',
  icon: '🏆',
};

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

export default function Home() {
  const [loaded, setLoaded] = useState(false);
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [milestonePhase, setMilestonePhase] = useState('ring'); // ring → trophy → badge
  const [challengeDismissed, setChallengeDismissed] = useState(false);
  const typewriterText = useTypewriter(ADVISOR_PROMPTS);
  const actionCount = useCountUp(7);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 1500);
    return () => clearTimeout(t);
  }, []);

  /* Fire milestone celebration 2s after load */
  useEffect(() => {
    if (!loaded) return;
    const t1 = setTimeout(() => setMilestoneVisible(true), 2000);
    const t2 = setTimeout(() => setMilestonePhase('trophy'), 3200);
    const t3 = setTimeout(() => setMilestonePhase('badge'), 4400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loaded]);

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

        {/* ═══ PROGRESS RINGS ═══ */}
        <div className={s.ringsSection}>
          <div className={s.ringsSectionHead}>
            <div className={s.ringsSectionTitle}>Monthly Progress</div>
            <div className={s.ringsSectionSub}>vs. last month as baseline</div>
          </div>
          <div className={s.ringsGrid}>
            {RINGS.map(r => {
              const pct = Math.round((r.current / r.target) * 100);
              return (
                <div key={r.label} className={s.ringCard}>
                  <div className={s.ringVisual}>
                    <ProgressRing current={r.current} target={r.target} color={r.color} />
                    <div className={s.ringCenter}>
                      <span className={s.ringPct}>{pct}%</span>
                    </div>
                  </div>
                  <div className={s.ringInfo}>
                    <div className={s.ringLabel}>{r.label}</div>
                    <div className={s.ringFraction}>
                      <span className={s.ringCurrent}>{r.current}{r.unit}</span>
                      <span className={s.ringDivider}>/</span>
                      <span className={s.ringTarget}>{r.target}{r.unit}</span>
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
          {/* Get started task */}
          <div className={s.taskCard}>
            <div className={s.taskHeader}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span className={s.taskLabel}>Get started</span>
            </div>
            <div className={s.taskTitle}>Follow up with Ava Martinez</div>
            <div className={s.taskDesc}>She finished her trial yesterday and asked about membership options. Highest close probability in your pipeline right now.</div>
            <button className={s.taskCta}>Open conversation →</button>
          </div>

          {/* Action counter */}
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

        {/* AI Advisor input */}
        <div className={s.advisorBar}>
          <div className={s.advisorInput}>
            <div className={s.advisorText}>
              <span>{typewriterText}</span>
              <span className={s.advisorCursor} />
            </div>
            <div className={s.advisorMic}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </div>
            <div className={s.advisorSend}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </div>
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

      {/* ═══ MILESTONE CELEBRATION ═══ */}
      {milestoneVisible && milestonePhase !== 'badge' && (
        <div className={s.milestoneOverlay}>
          <div className={s.milestoneCard}>
            {/* Ring pulse phase */}
            <div className={`${s.milestoneRing} ${milestonePhase === 'ring' ? s.milestoneRingActive : s.milestoneRingDone}`}>
              <svg width="120" height="120" className={s.milestoneRingSvg}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surf3)" strokeWidth="6" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="var(--gold)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 52}
                  strokeDashoffset={milestonePhase === 'ring' ? 0 : 0}
                  transform="rotate(-90 60 60)"
                  className={s.milestoneRingStroke}
                />
              </svg>
              {/* Ripples */}
              <div className={s.milestoneRipple1} />
              <div className={s.milestoneRipple2} />
              <div className={s.milestoneRipple3} />
            </div>

            {/* Trophy rises */}
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

      {/* Milestone badge (persists after dismissal) */}
      {milestonePhase === 'badge' && (
        <div className={s.milestoneBadge}>
          <span>{MILESTONE.icon}</span>
          <span className={s.milestoneBadgeText}>{MILESTONE.label}</span>
        </div>
      )}
    </main>
  );
}
