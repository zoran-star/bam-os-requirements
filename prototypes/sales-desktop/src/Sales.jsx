import { useState, useEffect, useRef, useCallback } from 'react';
import s from './Sales.module.css';

/* ─── DATA ─── */
const INITIAL_LEADS = [
  { id: 'l1', name: 'Marcus Johnson', src: 'Instagram', days: '1d', daysClass: '', badge: 'active', lastContact: '4h ago', initials: 'ZS', initClass: 'initG', stage: 'interested' },
  { id: 'l2', name: 'Sarah Chen', src: 'Web Form', days: '3d', daysClass: '', badge: 'active', lastContact: '1d ago', initials: 'MR', initClass: 'initS', stage: 'interested' },
  { id: 'l3', name: 'David Ortiz', src: 'Facebook', days: '8d', daysClass: 'daysWarn', badge: 'paused', lastContact: '3d ago', initials: 'ZS', initClass: 'initG', stage: 'interested' },
  { id: 'l4', name: 'Emily Watson', src: 'SMS', days: '2d', daysClass: '', badge: 'human', lastContact: '6h ago', initials: 'JT', initClass: 'initD', stage: 'interested' },
  { id: 'l5', name: 'Jake Rivera', src: 'Phone', days: '5d', daysClass: '', badge: 'active', lastContact: '2d ago', initials: 'ZS', initClass: 'initG', stage: 'interested' },
  { id: 'l6', name: 'Mia Thompson', src: 'Instagram', days: '1d', daysClass: '', badge: 'active', lastContact: 'Tomorrow 4pm', initials: 'MR', initClass: 'initS', stage: 'bookedTrial' },
  { id: 'l7', name: 'Liam Park', src: 'Web Form', days: '4d', daysClass: '', badge: 'human', lastContact: 'Fri 5:30pm', initials: 'JT', initClass: 'initD', stage: 'bookedTrial' },
  { id: 'l8', name: 'Ava Martinez', src: 'Email', days: '2d', daysClass: '', badge: 'human', lastContact: '1d ago', initials: 'ZS', initClass: 'initG', stage: 'doneTrial' },
  { id: 'l9', name: 'Noah Kim', src: 'Instagram', days: 'Today', daysClass: 'daysGold', badge: 'conv', lastContact: 'Today', initials: 'MR', initClass: 'initS', stage: 'doneTrial' },
  { id: 'l10', name: 'Chloe Davis', src: 'Facebook', days: '2d ago', daysClass: 'daysGold', badge: 'conv', lastContact: '2d ago', initials: 'ZS', initClass: 'initG', stage: 'doneTrial' },
];

const STAGES = [
  { id: 'interested', name: 'Interested' },
  { id: 'bookedTrial', name: 'Booked Trial' },
  { id: 'doneTrial', name: 'Done Trial' },
];

const THREADS = [
  { initials: 'MJ', name: 'Marcus Johnson', time: '4h ago', preview: 'Hey, I saw your academy on Instagram. What age groups do you have?', channel: 'Instagram DM', unread: true },
  { initials: 'EW', name: 'Emily Watson', time: '6h ago', preview: 'Can we reschedule the trial to Saturday morning instead?', channel: 'SMS', unread: true },
  { initials: 'AM', name: 'Ava Martinez', time: '1d ago', preview: 'My son loved the trial class! What are the membership options?', channel: 'Email', unread: true },
  { initials: 'NK', name: 'Noah Kim', time: '2d ago', preview: 'Just signed up! When is the next beginner class?', channel: 'Instagram DM', unread: false },
  { initials: 'JR', name: 'Jake Rivera', time: '2d ago', preview: 'AI: Hi Jake! Following up — would you like to book a trial this week?', channel: 'SMS', unread: false },
];

const TYPEWRITER_PROMPTS = [
  "How should I follow up with Ava?",
  "Which lead is most likely to close today?",
  "Draft a re-engagement message for David Ortiz...",
  "What\u2019s my biggest revenue risk right now?",
];

const BADGE_MAP = {
  active: { cls: s.badgeActive, label: 'AI Active' },
  paused: { cls: s.badgePaused, label: 'AI Paused' },
  human: { cls: s.badgeHuman, label: 'Human' },
  conv: { cls: s.badgeConv, label: 'Converted' },
};

/* ─── TOOLTIP ─── */
function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={s.tooltipWrap}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && <div className={s.tooltip}>{text}</div>}
    </div>
  );
}

/* ─── CUSTOM HOOKS ─── */

function useCountUp(target, duration = 920) {
  const [value, setValue] = useState(0);
  const animRef = useRef(null);

  useEffect(() => {
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [target, duration]);

  return value;
}

function useBannerCanvas(canvasRef) {
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, t = 0;
    const barCount = 28, barW = 10, barGap = 14, barBaseH = 0.55;

    function resize() {
      const r = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * r; canvas.height = h * r;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(r, 0, 0, r, 0, 0);
    }
    function getBarX(i) {
      const totalW = barCount * barW + (barCount - 1) * barGap;
      return (w - totalW) / 2 + i * (barW + barGap);
    }
    function getBarH(i) {
      const base = h * barBaseH, variance = h * 0.08;
      return base + Math.sin(i * 0.45 + t * 0.017) * variance + Math.sin(i * 0.8 + t * 0.011) * variance * 0.5;
    }
    function genCurvePts(seed, amp, yOff) {
      const pts = [], n = barCount - 1;
      for (let i = 0; i <= n; i++) {
        const x = getBarX(i) + barW / 2;
        const bh = getBarH(i);
        const y = (h - bh) + yOff + Math.sin(i * 0.6 + t * 0.014 + seed) * amp;
        pts.push({ x, y });
      }
      return pts;
    }
    function drawCurve(pts, color, lw) {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cx = (pts[i].x + pts[i + 1].x) / 2;
        const cy = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    function draw() {
      const r = window.devicePixelRatio || 1;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Dot grid
      const dotSpacing = 24;
      ctx.fillStyle = 'rgba(200,168,78,0.07)';
      for (let x = dotSpacing / 2; x < w; x += dotSpacing) {
        for (let y = dotSpacing / 2; y < h; y += dotSpacing) {
          ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Bars
      for (let i = 0; i < barCount; i++) {
        const x = getBarX(i), bh = getBarH(i), y = h - bh;
        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, 'rgba(212,182,92,0.11)');
        grad.addColorStop(1, 'rgba(200,168,78,0.33)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(x, y, barW, bh, 3); ctx.fill();
      }
      // Curves
      const mainPts = genCurvePts(0, 6, -8);
      const shadowPts = genCurvePts(1.5, 5, -2);
      drawCurve(shadowPts, 'rgba(200,168,78,0.12)', 1);
      drawCurve(mainPts, 'rgba(200,168,78,0.42)', 2);
      // Glowing dots
      const dotIndices = [2, 6, 10, 14, 17];
      ctx.save();
      for (const di of dotIndices) {
        if (di < mainPts.length) {
          const p = mainPts[di];
          ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(200,168,78,0.42)';
          ctx.fillStyle = 'rgba(200,168,78,0.54)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      t++;
      animRef.current = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [canvasRef]);
}

function useTypewriter(prompts) {
  const [text, setText] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    let pi = 0, ci = 0, deleting = false;
    function type() {
      const txt = prompts[pi];
      if (!deleting) {
        setText(txt.slice(0, ci + 1));
        ci++;
        if (ci >= txt.length) { timerRef.current = setTimeout(() => { deleting = true; type(); }, 2200); return; }
        timerRef.current = setTimeout(type, 55 + Math.random() * 40);
      } else {
        setText(txt.slice(0, ci));
        ci--;
        if (ci <= 0) { deleting = false; pi = (pi + 1) % prompts.length; timerRef.current = setTimeout(type, 400); return; }
        timerRef.current = setTimeout(type, 25);
      }
    }
    timerRef.current = setTimeout(type, 800);
    return () => clearTimeout(timerRef.current);
  }, [prompts]);

  return text;
}

/* ─── LEAD CARD ─── */
function LeadCard({ lead, onDragStart, onDragEnd, draggingId, droppedId }) {
  let cardCls = s.card;
  if (draggingId === lead.id) cardCls += ` ${s.cardDragging}`;
  if (droppedId === lead.id) cardCls += ` ${s.cardDropped}`;

  return (
    <div
      className={cardCls}
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
    >
      <div className={s.cardTop}>
        <div className={s.leadName}>{lead.name}</div>
        <div className={`${s.badge} ${BADGE_MAP[lead.badge].cls}`}>
          <span className={s.badgeDot}></span>
          {BADGE_MAP[lead.badge].label}
        </div>
      </div>
      <div className={s.cardMeta}>
        <span className={s.src}>{lead.src}</span>
        <span className={`${s.days} ${lead.daysClass ? s[lead.daysClass] : ''}`}>{lead.days}</span>
      </div>
      <div className={s.cardFoot}>
        <span className={s.last}>{lead.lastContact}</span>
        <span className={`${s.init} ${s[lead.initClass]}`}>{lead.initials}</span>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function Sales() {
  // Leads state — stage property is mutable via drag-and-drop
  const [leads, setLeads] = useState(INITIAL_LEADS);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [droppedId, setDroppedId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [flipped, setFlipped] = useState({ trials: false, closed: false });

  // Refs
  const canvasRef = useRef(null);
  const dragSrcStage = useRef(null);
  const toastTimer = useRef(null);
  const droppedTimer = useRef(null);

  // Derived: group leads by stage
  const leadsByStage = {};
  STAGES.forEach(st => { leadsByStage[st.id] = leads.filter(l => l.stage === st.id); });

  /* ─── BANNER CANVAS (custom hook) ─── */
  useBannerCanvas(canvasRef);

  /* ─── COUNT-UP (custom hook) ─── */
  const heroVal = useCountUp(57);
  const subVal1 = useCountUp(8);
  const subVal2 = useCountUp(2);

  /* ─── TYPEWRITER (custom hook) ─── */
  const typewriterText = useTypewriter(TYPEWRITER_PROMPTS);

  /* ─── DRAG & DROP ─── */
  const handleDragStart = useCallback((e, leadId) => {
    setDraggingId(leadId);
    const lead = leads.find(l => l.id === leadId);
    if (lead) dragSrcStage.current = lead.stage;
    e.dataTransfer.effectAllowed = 'move';
  }, [leads]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverCol(null);
    dragSrcStage.current = null;
  }, []);

  const handleDragOver = useCallback((e, colId) => {
    e.preventDefault();
    setDragOverCol(colId);
  }, []);

  const handleDragLeave = useCallback((e) => {
    const col = e.currentTarget;
    if (!col.contains(e.relatedTarget)) setDragOverCol(null);
  }, []);

  const handleDrop = useCallback((e, targetStage) => {
    e.preventDefault();
    setDragOverCol(null);
    if (!draggingId || targetStage === dragSrcStage.current) return;

    // Update the lead's stage property
    setLeads(prev => prev.map(l =>
      l.id === draggingId ? { ...l, stage: targetStage } : l
    ));

    // Dropped animation
    setDroppedId(draggingId);
    clearTimeout(droppedTimer.current);
    droppedTimer.current = setTimeout(() => setDroppedId(null), 380);

    // Toast
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 1600);

    // Sound
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.frequency.value = 300; o.type = 'sine';
      g.gain.setValueAtTime(0.055, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.11);
      o.start(); o.stop(a.currentTime + 0.11);
    } catch (_) {}
  }, [draggingId]);

  /* ─── FLIP CARD HOVER ─── */
  const handleFlipEnter = useCallback((key) => {
    setFlipped(prev => ({ ...prev, [key]: true }));
  }, []);
  const handleFlipLeave = useCallback((key) => {
    setFlipped(prev => ({ ...prev, [key]: false }));
  }, []);

  /* ─── RENDER ─── */
  return (
    <div className={s.body}>
      {/* SVG noise filter */}
      <svg className={s.noiseFilter} xmlns="http://www.w3.org/2000/svg">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise" />
          <feColorMatrix type="saturate" values="0" in="noise" />
        </filter>
      </svg>

      {/* SIDEBAR */}
      <aside className={s.sidebar}>
        <div className={s.logoWrap}>
          <div className={s.logoMark}>B</div>
          <div className={s.logoText}>
            <div className={s.logoName}>BAM OS</div>
            <div className={s.logoSub}>Command Center</div>
          </div>
        </div>
        <nav className={s.nav}>
          <span className={s.navLabel}>Main</span>
          <div className={s.navItem}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
            <span>Home</span>
          </div>
          <div className={s.navItem}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
            <span>Marketing</span>
          </div>
          <div className={`${s.navItem} ${s.active}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
            <span>Sales</span>
          </div>
          <div className={s.navItem}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <span>Management</span>
          </div>
        </nav>
        <div className={s.sidebarFooter}>
          <div className={s.av}>ZS</div>
          <div>
            <div className={s.coachName}>Zoran Savic</div>
            <div className={s.coachRole}>Owner</div>
          </div>
          <div className={s.settingsBtn}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className={s.main}>
        {/* BANNER */}
        <div className={s.banner}>
          <div className={s.bannerCanvasWrap}>
            <canvas className={s.bannerCanvas} ref={canvasRef}></canvas>
          </div>
          <div className={s.bannerTop}>
            <h1 className={s.pageTitle}>Sales</h1>
            <div className={s.bannerStats}>
              <Tooltip text="Month-to-date revenue growth vs same period last month"><div className={s.statPill}>+12.4% MTD</div></Tooltip>
              <Tooltip text="Total active leads currently in your pipeline"><div className={s.statPill}>34 Leads</div></Tooltip>
              <Tooltip text="Close rate for leads who complete a trial session"><div className={s.statPill}>82% Close</div></Tooltip>
            </div>
          </div>
          <div className={s.bannerBottom}>
            <div></div>
            <a className={s.dashLink} href="#">
              Full dashboard
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        </div>

        <div className={s.scroll}>
          {/* HERO */}
          <div className={s.hero}>
            {/* KPI CARD */}
            <div className={s.kpiCard}>
              <div className={s.kpiCardTitle}>Your sales this month...</div>
              <div className={s.kpiHero}>
                <div className={s.kpiHeroLeft}>
                  <div className={s.kpiHeroLabel}>Qualified Trial Close Rate</div>
                  <Tooltip text="Your close rate this month: % of qualified trials that became members"><div className={s.kpiHeroVal}>{heroVal}<span>%</span></div></Tooltip>
                </div>
                <div className={s.kpiHeroRight}>
                  <Tooltip text="Up 8 percentage points vs last month's close rate of 49%">
                    <div className={s.kpiHeroTrend}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
                      +8pts
                    </div>
                  </Tooltip>
                </div>
              </div>
              <div className={s.kpiSubRow}>
                {/* Flip card: Trials */}
                <Tooltip text="Prospects who attended or confirmed a trial session this month">
                  <div
                    className={`${s.kpiSub} ${s.kpiFlipCard} ${flipped.trials ? s.flipped : ''}`}
                    onMouseEnter={() => handleFlipEnter('trials')}
                    onMouseLeave={() => handleFlipLeave('trials')}
                  >
                    <div className={s.kpiSubLabel}>Qualified Trials</div>
                    <div className={s.kpiFlipInner}>
                      <div className={s.kpiFlipFront}>
                        <div className={s.kpiSubVal}>{subVal1}</div>
                        <div className={s.kpiSubFoot}>
                          <span className={s.kpiSubTrend}>
                            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
                            +3
                          </span>
                          <span className={s.kpiSubPeriod}>vs last mo</span>
                        </div>
                      </div>
                      <div className={`${s.kpiFlipBack} ${s.kpiFlipUp}`}>
                        <div className={s.kpiFlipComparison}>+3 from last month</div>
                        <div className={s.kpiFlipPrev}>5 last month</div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
                {/* Flip card: Closed */}
                <Tooltip text="New members who signed up after completing a trial">
                  <div
                    className={`${s.kpiSub} ${s.kpiFlipCard} ${flipped.closed ? s.flipped : ''}`}
                    onMouseEnter={() => handleFlipEnter('closed')}
                    onMouseLeave={() => handleFlipLeave('closed')}
                  >
                    <div className={s.kpiSubLabel}>Sales Closed</div>
                    <div className={s.kpiFlipInner}>
                      <div className={s.kpiFlipFront}>
                        <div className={s.kpiSubVal}>{subVal2}</div>
                        <div className={s.kpiSubFoot}>
                          <span className={s.kpiSubTrend}>
                            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
                            +2
                          </span>
                          <span className={s.kpiSubPeriod}>vs last mo</span>
                        </div>
                      </div>
                      <div className={`${s.kpiFlipBack} ${s.kpiFlipUp}`}>
                        <div className={s.kpiFlipComparison}>+2 from last month</div>
                        <div className={s.kpiFlipPrev}>0 last month</div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </div>
              <div className={s.kpiProgress}>
                <div className={s.kpiProgressLabel}>
                  <span className={s.kpiProgressText}>Month progress</span>
                  <span className={s.kpiProgressPct}>Day 15 of 31</span>
                </div>
                <Tooltip text="You're on Day 15 of 31 — halfway through the month">
                  <div className={s.kpiBar}>
                    <div className={s.kpiBarFill} style={{ '--bar-pct': '48%' }}></div>
                  </div>
                </Tooltip>
              </div>
            </div>

            {/* SAGE CARD */}
            <div className={s.sageCard}>
              <div className={s.sageBody}>
                <div className={s.sageBodyContent}>
                  <Tooltip text="AI-generated insight based on pipeline activity and timing signals"><div className={s.sagePriorityBadge}>Priority Insight</div></Tooltip>
                  <div className={s.sageInsight}>
                    <div className={s.sageInsightText}>🔥 Ava Martinez completed a trial 1 day ago — highest close probability in pipeline. Follow up now before momentum fades.</div>
                  </div>
                </div>
                <div className={s.sageMicWrap}>
                  <div className={s.sageMic}>
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                  </div>
                  <div className={s.sageMicLabel}>Tap to speak</div>
                </div>
              </div>
              <div className={s.sageDivider}></div>
              <div className={s.sageInput}>
                <div className={s.sageInputText}>
                  <span>{typewriterText}</span>
                  <span className={s.sageInputCursor}></span>
                </div>
                <div className={s.sageInputSend}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </div>
              </div>
            </div>
          </div>

          {/* PIPELINE */}
          <div className={s.pipelineSection}>
            <div className={s.pipelineTopbar}>
              <h2 className={s.pipelineTitle}>Pipeline</h2>
              <div className={s.pipelineArrows} aria-hidden="true">
                {Array.from({ length: 5 }, (_, i) => (
                  <div className={s.pipelineArrow} key={i}>
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                  </div>
                ))}
              </div>
            </div>
            <div className={s.pipelineDivider}></div>
            <div className={s.board}>
              {STAGES.map(stage => {
                const stageLeads = leadsByStage[stage.id];
                return (
                  <div
                    key={stage.id}
                    className={`${s.col} ${dragOverCol === stage.id ? s.colDragOver : ''}`}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className={s.colHead}>
                      <span className={s.colName}>{stage.name}</span>
                      <span className={s.colCt}>{stageLeads.length}</span>
                    </div>
                    <div className={s.cards}>
                      {stageLeads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          draggingId={draggingId}
                          droppedId={droppedId}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* INBOX BUTTON */}
      <button className={s.inboxBtn} onClick={() => setPanelOpen(p => !p)}>
        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <div className={s.inboxCt}>3</div>
      </button>

      {/* TOAST */}
      <div className={`${s.toast} ${toastVisible ? s.toastShow : ''}`}>
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        Card moved
      </div>

      {/* OVERLAY */}
      <div
        className={`${s.overlay} ${panelOpen ? s.overlayOpen : ''}`}
        onClick={() => setPanelOpen(false)}
      ></div>

      {/* PANEL */}
      <div className={`${s.panel} ${panelOpen ? s.panelOpen : ''}`}>
        <div className={s.panelHead}>
          <span className={s.panelTitle}>Lead Inbox</span>
          <button className={s.closeBtn} onClick={() => setPanelOpen(false)}>&times;</button>
        </div>
        <div className={s.threads}>
          {THREADS.map((t, i) => (
            <div key={i} className={`${s.thread} ${t.unread ? s.threadUnread : ''}`}>
              <div className={s.tav}>{t.initials}</div>
              <div className={s.tcontent}>
                <div className={s.ttop}>
                  <span className={s.tname}>{t.name}</span>
                  <span className={s.ttime}>{t.time}</span>
                </div>
                <div className={s.tprev}>{t.preview}</div>
                <div className={s.tmeta}>
                  <span className={s.tch}>{t.channel}</span>
                  {t.unread && <div className={s.udot}></div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
