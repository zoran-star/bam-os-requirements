import { useState, useEffect, useRef, useCallback } from 'react';
import s from '../styles/Sales.module.css';

/* ─── DATA ─── */
const INITIAL_LEADS = [
  { id: 'l1', name: 'Marcus Johnson', lastActivity: '4h ago', needsAttention: false, stage: 'interested',
    parentName: 'Marcus Johnson Sr.', athleteName: 'Marcus Johnson Jr.',
    salesNotes: { childAge: '9', goal: 'Build confidence and discipline', source: 'Instagram', budget: '$150/mo', availability: 'Weekends', notes: 'Dad coaches little league, very motivated' },
    messages: [
      { from: 'parent', text: 'Hi! I saw your ad on Instagram.', time: '2d ago' },
      { from: 'ai', text: "Hi Marcus! We'd love to have your son try a class. We have spots this Saturday at 10am — would that work?", time: '2d ago' },
      { from: 'parent', text: 'That works! What age groups do you have?', time: '1d ago' },
      { from: 'ai', text: 'We have groups for ages 6-8, 9-12, and 13+. Your son would be in our 9-12 group with Coach Rivera.', time: '4h ago' },
    ] },
  { id: 'l2', name: 'Sarah Chen', lastActivity: '1d ago', needsAttention: false, stage: 'interested',
    parentName: 'Wei Chen', athleteName: 'Sarah Chen',
    salesNotes: { childAge: '7', goal: 'Social skills and teamwork', source: 'Referral', budget: '$130/mo', availability: 'Sat & Sun mornings', notes: 'Friend of Emily Watson family' },
    messages: [
      { from: 'parent', text: 'Emily Watson recommended your program. Do you have openings for 7-year-olds?', time: '2d ago' },
      { from: 'ai', text: 'Absolutely! Our 6-8 group has a few spots. Would you like to schedule a free trial?', time: '2d ago' },
      { from: 'parent', text: 'Yes please! Weekends work best for us.', time: '1d ago' },
    ] },
  { id: 'l3', name: 'David Ortiz', lastActivity: '3d ago', needsAttention: true, stage: 'interested',
    parentName: 'Carmen Ortiz', athleteName: 'David Ortiz Jr.',
    salesNotes: { childAge: '11', goal: 'Compete at regional level', source: 'Facebook', budget: '$200/mo', availability: 'Weekdays after 4pm', notes: 'Has prior soccer experience' },
    messages: [
      { from: 'parent', text: 'My son wants to get serious about basketball. Do you do competitive training?', time: '5d ago' },
      { from: 'ai', text: 'Yes! Our 9-12 competitive track focuses on skill development and game strategy. Coach Rivera leads that group.', time: '5d ago' },
      { from: 'parent', text: 'Sounds great, what are the rates?', time: '4d ago' },
      { from: 'ai', text: "Our competitive program is $200/mo for 3x/week sessions. Want to book a trial this week?", time: '3d ago' },
    ] },
  { id: 'l4', name: 'Emily Watson', lastActivity: '6h ago', needsAttention: false, stage: 'interested',
    parentName: 'Emily Watson', athleteName: 'Lily Watson',
    salesNotes: { childAge: '8', goal: 'After-school activity', source: 'Google', budget: '$140/mo', availability: 'Weekdays 3:30-5pm', notes: 'Looking for something close to school' },
    messages: [
      { from: 'parent', text: 'Can we reschedule the trial to Saturday morning instead?', time: '6h ago' },
      { from: 'ai', text: 'Of course! I have 9am or 10:30am available this Saturday. Which works better?', time: '6h ago' },
      { from: 'parent', text: "10:30 would be perfect, thank you!", time: '6h ago' },
    ] },
  { id: 'l5', name: 'Jake Rivera', lastActivity: '2d ago', needsAttention: true, stage: 'interested',
    parentName: 'Mike Rivera', athleteName: 'Jake Rivera',
    salesNotes: { childAge: '13', goal: 'Make the school team', source: 'SMS outbound', budget: '$180/mo', availability: 'Flexible', notes: 'Tryouts in 6 weeks, needs intensive prep' },
    messages: [
      { from: 'ai', text: 'Hi Jake! Following up — would you like to book a trial this week?', time: '4d ago' },
      { from: 'parent', text: "Yeah maybe. When do you have openings?", time: '3d ago' },
      { from: 'ai', text: 'We have Tuesday at 4pm or Thursday at 5pm. Both are with our teen competitive group.', time: '2d ago' },
    ] },
  { id: 'l6', name: 'Mia Thompson', lastActivity: '1h ago', trialDate: 'today', trialTime: '10:00am', needsAttention: false, stage: 'bookedTrial',
    parentName: 'Rachel Thompson', athleteName: 'Mia Thompson',
    salesNotes: { childAge: '8', goal: 'Fun and fitness', source: 'Instagram', budget: '$120/mo', availability: 'Saturday mornings', notes: 'Trial booked for today 10am' },
    messages: [
      { from: 'parent', text: "We're so excited for today! What should Mia bring?", time: '3h ago' },
      { from: 'ai', text: 'Just comfortable athletic clothes and sneakers! Water bottles provided. See you at 10am! 🏀', time: '2h ago' },
      { from: 'parent', text: 'Perfect, see you soon!', time: '1h ago' },
    ] },
  { id: 'l7', name: 'Liam Park', lastActivity: '4h ago', trialDate: 'Fri Mar 21', trialTime: '5:30pm', needsAttention: false, stage: 'bookedTrial',
    parentName: 'James Park', athleteName: 'Liam Park',
    salesNotes: { childAge: '10', goal: 'Build skills and have fun', source: 'Website', budget: '$160/mo', availability: 'Weekday evenings', notes: 'Plays rec league, wants more structured training' },
    messages: [
      { from: 'parent', text: 'Confirming Liam for Friday at 5:30. Is parking available?', time: '1d ago' },
      { from: 'ai', text: 'Confirmed! Yes, free parking in the lot behind the building. Enter through the side entrance.', time: '1d ago' },
      { from: 'parent', text: 'Great, thanks!', time: '4h ago' },
    ] },
  { id: 'l11', name: 'Sofia Reyes', lastActivity: '30m ago', trialDate: 'today', trialTime: '3:00pm', needsAttention: false, stage: 'bookedTrial',
    parentName: 'Maria Reyes', athleteName: 'Sofia Reyes',
    salesNotes: { childAge: '9', goal: 'Confidence and coordination', source: 'Referral', budget: '$150/mo', availability: 'Weekends & Wed afternoons', notes: 'Referred by Mia Thompson family' },
    messages: [
      { from: 'parent', text: "Our friend Mia's mom told us about the academy. Sofia would love to try!", time: '2d ago' },
      { from: 'ai', text: "We'd love to have Sofia! How about a trial this Saturday at 3pm?", time: '2d ago' },
      { from: 'parent', text: "Today works! We'll be there at 3.", time: '30m ago' },
    ] },
  { id: 'l8', name: 'Ava Martinez', lastActivity: '1d ago', daysSinceTrial: '1d', needsAttention: true, stage: 'doneTrial',
    parentName: 'Carlos Martinez', athleteName: 'Ava Martinez',
    salesNotes: { childAge: '10', goal: 'Competitive development', source: 'Instagram', budget: '$175/mo', availability: 'Tue/Thu/Sat', notes: 'Loved the trial, asking about membership options' },
    messages: [
      { from: 'parent', text: 'My son loved the trial class! What are the membership options?', time: '1d ago' },
      { from: 'ai', text: "So glad to hear that! We have 2x/week at $150/mo or 3x/week at $175/mo. Both include access to open gym on Saturdays.", time: '1d ago' },
      { from: 'parent', text: "The 3x sounds good. Can we start next week?", time: '1d ago' },
    ] },
  { id: 'l9', name: 'Noah Kim', lastActivity: 'Today', daysSinceTrial: '0d', needsAttention: false, stage: 'doneTrial',
    parentName: 'Susan Kim', athleteName: 'Noah Kim',
    salesNotes: { childAge: '12', goal: 'Pre-season conditioning', source: 'Google', budget: '$200/mo', availability: 'Mon/Wed/Fri after school', notes: 'Just finished trial today, very enthusiastic' },
    messages: [
      { from: 'parent', text: 'Just signed up! When is the next beginner class?', time: '2h ago' },
      { from: 'ai', text: "Welcome Noah! Next beginner session is Monday at 4pm. We'll send a welcome packet tonight.", time: '1h ago' },
      { from: 'parent', text: "Can't wait!", time: '30m ago' },
    ] },
  { id: 'l10', name: 'Chloe Davis', lastActivity: '2d ago', daysSinceTrial: '2d', needsAttention: false, stage: 'doneTrial',
    parentName: 'Tom Davis', athleteName: 'Chloe Davis',
    salesNotes: { childAge: '11', goal: 'Stay active year-round', source: 'Facebook', budget: '$140/mo', availability: 'Weekends only', notes: 'Also does swimming, looking for weekend-only option' },
    messages: [
      { from: 'parent', text: 'Chloe had a great time at the trial. Do you have a weekend-only plan?', time: '2d ago' },
      { from: 'ai', text: 'Yes! Our weekend plan is $140/mo for Saturday and Sunday sessions. Perfect for multi-sport athletes.', time: '2d ago' },
      { from: 'parent', text: "That's exactly what we need. Let me talk to my wife and get back to you.", time: '2d ago' },
    ] },
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

/* ─── STAT PILL ─── */
function StatPill({ value, explanation }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`${s.statPill} ${hovered ? s.statPillExpanded : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={s.statPillValue}
        style={{ opacity: hovered ? 0 : 1,
                 position: hovered ? 'absolute' : 'relative',
                 pointerEvents: 'none' }}>
        {value}
      </span>
      <span className={s.statPillExplain}
        style={{ opacity: hovered ? 1 : 0,
                 position: hovered ? 'relative' : 'absolute',
                 pointerEvents: 'none' }}>
        {explanation}
      </span>
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
function LeadCard({ lead, onDragStart, onDragEnd, draggingId, droppedId, onSelect }) {
  const isToday = lead.trialDate === 'today';
  const needsAttention = lead.needsAttention === true;
  let cardCls = s.card;
  if (draggingId === lead.id) cardCls += ` ${s.cardDragging}`;
  if (droppedId === lead.id) cardCls += ` ${s.cardDropped}`;
  if (isToday) cardCls += ` ${s.cardToday}`;
  if (needsAttention) cardCls += ` ${s.cardUrgent}`;

  return (
    <div className={cardCls} draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(lead)}
    >
      <div className={s.cardInner}>
        <div className={s.cardMain}>
          <div className={s.cardName}>{lead.name}</div>
          <div className={s.cardActivity}>
            <span className={s.cardActivityLabel}>Last activity</span>
            {lead.lastActivity}
          </div>
          {lead.stage === 'bookedTrial' && lead.trialDate && !isToday && (
            <div className={s.cardTrialDate}>
              {lead.trialDate}{lead.trialTime && `, ${lead.trialTime}`}
            </div>
          )}
          {lead.stage === 'doneTrial' && lead.daysSinceTrial && (
            <div className={s.cardDaysSince}>{lead.daysSinceTrial} since trial</div>
          )}
        </div>
        <div className={s.cardRight}>
          {needsAttention && (
            <div className={s.cardAttentionIcon} title="Needs attention">
              <svg width="16" height="16" fill="none" stroke="currentColor"
                strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
          )}
          {isToday && lead.trialTime && (
            <div className={s.cardTodayClockTime}>{lead.trialTime}</div>
          )}
        </div>
      </div>
      {isToday && (
        <div className={s.cardTodayBadge}>⚡ Today</div>
      )}
    </div>
  );
}

/* ─── LEAD DRAWER ─── */
function LeadDrawer({ lead, onClose, onUpdateLead }) {
  const [messages, setMessages] = useState(lead?.messages || []);
  const [inputVal, setInputVal] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    setMessages(lead?.messages || []);
    setInputVal('');
  }, [lead?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!lead) return null;
  const isBooked = lead.stage === 'bookedTrial';
  const isDone = lead.stage === 'doneTrial';

  function handleSend() {
    const txt = inputVal.trim();
    if (!txt) return;
    const newMsg = { from: 'human', text: txt, time: 'just now' };
    setMessages(prev => [...prev, newMsg]);
    onUpdateLead(lead.id, { messages: [...messages, newMsg] });
    setInputVal('');
    setSending(true);
    setTimeout(() => {
      const aiMsg = { from: 'ai', text: '\u2726 AI is drafting a response...', time: 'just now', pending: true };
      setMessages(prev => [...prev, aiMsg]);
      setSending(false);
    }, 1200);
  }

  return (
    <>
      <div className={s.drawerOverlay} onClick={onClose} />
      <div className={s.drawer}>
        <div className={s.drawerHead}>
          <div>
            <div className={s.drawerTitle}>{lead.name}</div>
            <div className={s.drawerSubtitle}>{lead.stage === 'interested' ? 'Interested' : lead.stage === 'bookedTrial' ? 'Booked Trial' : 'Done Trial'}</div>
          </div>
          <button className={s.drawerClose} onClick={onClose}>&times;</button>
        </div>
        <div className={s.drawerBody}>
          <div className={s.drawerSection}>
            <div className={s.drawerRow}>
              <span className={s.drawerLabel}>Parent</span>
              <span className={s.drawerVal}>{lead.parentName}</span>
            </div>
            <div className={s.drawerRow}>
              <span className={s.drawerLabel}>Athlete</span>
              <span className={s.drawerVal}>{lead.athleteName}</span>
            </div>
            {isBooked && (
              <div className={s.drawerRow}>
                <span className={s.drawerLabel}>Trial date</span>
                <span className={`${s.drawerVal} ${s.drawerValGold}`}>
                  {lead.trialDate === 'today' ? `Today at ${lead.trialTime}` : `${lead.trialDate}${lead.trialTime ? `, ${lead.trialTime}` : ''}`}
                </span>
              </div>
            )}
            {isDone && (
              <div className={s.drawerRow}>
                <span className={s.drawerLabel}>Days since trial</span>
                <span className={s.drawerVal}>{lead.daysSinceTrial}</span>
              </div>
            )}
          </div>

          <div className={s.drawerSectionTitle}>Conversation</div>
          <div className={s.drawerChatWrap}>
            <div className={s.drawerChat}>
              {messages.map((m, i) => (
                <div key={i} className={`${s.chatMsg} ${
                  m.from === 'parent' ? s.chatMsgParent
                  : m.from === 'human' ? s.chatMsgHuman
                  : s.chatMsgAi
                }`}>
                  {m.from === 'human' && (
                    <div className={s.chatFromLabel}>You (manual)</div>
                  )}
                  <div className={`${s.chatBubble} ${m.pending ? s.chatBubblePending : ''}`}>
                    {m.text}
                  </div>
                  <div className={s.chatTime}>{m.time}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className={s.chatInputRow}>
              <input
                className={s.chatInput}
                placeholder="Type a message or override AI..."
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <button
                className={s.chatSendBtn}
                onClick={handleSend}
                disabled={!inputVal.trim() || sending}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>

          <div className={s.drawerSectionTitle}>Sales Notes</div>
          <div className={s.drawerNotes}>
            {lead.salesNotes && Object.entries(lead.salesNotes).map(([k, v]) => (
              <div key={k} className={s.drawerRow}>
                <span className={s.drawerLabel}>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                <span className={s.drawerVal}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── SPARKLINE CHART ─── */
function Sparkline({ data, color = '#C8A84E', compData, compColor = '#A5A19A', height = 48, width = '100%' }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const r = window.devicePixelRatio || 1;
    const rect = c.parentElement.getBoundingClientRect();
    const w = rect.width, h = height;
    c.width = w * r; c.height = h * r;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const allVals = [...data, ...(compData || [])];
    const max = Math.max(...allVals, 1), min = Math.min(...allVals, 0);
    const pad = 4;
    function drawLine(pts, col, lw, dashed) {
      if (pts.length < 2) return;
      ctx.beginPath();
      if (dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
      pts.forEach((v, i) => {
        const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
        const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.setLineDash([]);
    }
    function drawFill(pts, col) {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((v, i) => {
        const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
        const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(pad + (w - pad * 2), h); ctx.lineTo(pad, h); ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, col + '18'); grad.addColorStop(1, col + '02');
      ctx.fillStyle = grad; ctx.fill();
    }
    if (compData) { drawLine(compData, compColor, 1.5, true); }
    drawFill(data, color);
    drawLine(data, color, 2, false);
    // end dot
    const lastX = pad + (w - pad * 2), lastY = pad + (1 - (data[data.length - 1] - min) / (max - min || 1)) * (h - pad * 2);
    ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }, [data, compData, color, compColor, height]);
  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />;
}

/* ─── BAR CHART ─── */
function BarChart({ items, height = 140 }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className={s.barChart} style={{ height }}>
      {items.map((item, i) => (
        <div key={i} className={s.barChartCol}>
          <div className={s.barChartBar} style={{ height: `${(item.value / max) * 100}%`, background: item.color || 'var(--gold)', animationDelay: `${i * 60}ms` }} />
          <div className={s.barChartLabel}>{item.label}</div>
          <div className={s.barChartVal}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── SAMPLE DATA GENERATOR ─── */
const PERIODS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: 'mtd', label: 'Month to date', days: new Date().getDate() },
  { id: '3m', label: 'Last 3 months', days: 90 },
  { id: '12m', label: 'Last 12 months', days: 365 },
];
const COMPARES = [
  { id: 'none', label: 'No comparison' },
  { id: 'prev', label: 'Previous period' },
  { id: 'yoy', label: 'Same period last year' },
];
function genSampleData(periodDays) {
  const pts = Math.min(periodDays, 30);
  const rand = (base, variance) => Array.from({ length: pts }, (_, i) =>
    Math.round(base + Math.sin(i * 0.5) * variance + (Math.random() - 0.3) * variance * 0.8 + i * (base * 0.01))
  );
  const compRand = (base, variance) => Array.from({ length: pts }, (_, i) =>
    Math.round(base * 0.82 + Math.sin(i * 0.4 + 1) * variance + (Math.random() - 0.3) * variance * 0.8 + i * (base * 0.008))
  );
  const scale = periodDays / 30;
  return {
    total_leads: Math.round(34 * scale), qualified_trials: Math.round(8 * scale),
    unqualified_trials: Math.round(3 * scale), no_shows: Math.round(2 * scale),
    sales_won: Math.round(5 * scale), close_rate: '62.5%',
    ai_engaged_bookings: Math.round(6 * scale), ai_conversion_rate: '42%',
    post_trial_time_to_close: '3.2 days', avg_time_to_booking: '1.8 days',
    lead_source_attribution: [
      { source: 'Instagram', leads: Math.round(14 * scale), trials: Math.round(4 * scale), sales: Math.round(2 * scale) },
      { source: 'Google', leads: Math.round(8 * scale), trials: Math.round(2 * scale), sales: Math.round(1 * scale) },
      { source: 'Facebook', leads: Math.round(5 * scale), trials: Math.round(1 * scale), sales: Math.round(1 * scale) },
      { source: 'Referral', leads: Math.round(4 * scale), trials: Math.round(1 * scale), sales: Math.round(1 * scale) },
      { source: 'Walk-in', leads: Math.round(2 * scale), trials: 0, sales: 0 },
      { source: 'Other', leads: Math.round(1 * scale), trials: 0, sales: 0 },
    ],
    notes: 'AI conversion rate outperforming direct bookings by 14pts. Post-trial close time trending down — 2 closings pending from this week\u2019s trials.',
    // Time series
    leadsOverTime: rand(3, 2), trialsOverTime: rand(1.5, 1), salesOverTime: rand(0.8, 0.6),
    closeRateOverTime: rand(55, 12), aiRateOverTime: rand(40, 8),
    // Comparison series
    leadsComp: compRand(3, 2), trialsComp: compRand(1.5, 1), salesComp: compRand(0.8, 0.6),
    closeRateComp: compRand(48, 10), aiRateComp: compRand(32, 7),
  };
}

/* ─── FULL DASHBOARD ─── */
function FullDashboard({ onClose }) {
  const [period, setPeriod] = useState('mtd');
  const [compare, setCompare] = useState('none');
  const showComp = compare !== 'none';
  const periodObj = PERIODS.find(p => p.id === period);
  const data = genSampleData(periodObj.days);

  const pipelineMetrics = [
    { label: 'Total Leads', value: data.total_leads, sub: 'All leads this period', spark: data.leadsOverTime, comp: data.leadsComp },
    { label: 'Qualified Trials', value: data.qualified_trials, sub: 'Met qualification criteria', spark: data.trialsOverTime, comp: data.trialsComp },
    { label: 'No-Shows', value: data.no_shows, sub: 'Booked but did not attend' },
    { label: 'Sales (Won)', value: data.sales_won, sub: 'Closed members this period', spark: data.salesOverTime, comp: data.salesComp },
    { label: 'Close Rate', value: data.close_rate, sub: 'Won \u00F7 qualified trials', spark: data.closeRateOverTime, comp: data.closeRateComp },
    { label: 'Unqualified Trials', value: data.unqualified_trials, sub: 'Did not meet criteria' },
  ];
  const aiMetrics = [
    { label: 'AI-Engaged Bookings', value: data.ai_engaged_bookings, sub: 'AI-engaged leads that booked' },
    { label: 'AI Conversion Rate', value: data.ai_conversion_rate, sub: 'AI bookings \u00F7 AI-engaged leads', spark: data.aiRateOverTime, comp: data.aiRateComp },
    { label: 'Post-Trial Time to Close', value: data.post_trial_time_to_close, sub: 'Trial attended → membership signed' },
    { label: 'Avg Time to Booking', value: data.avg_time_to_booking, sub: 'First AI contact \u2192 trial booked' },
  ];

  return (
    <div className={s.dashFull}>
      {/* Header */}
      <div className={s.dashFullHead}>
        <div className={s.dashFullHeadLeft}>
          <button className={s.dashBackBtn} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div className={s.dashTitle}>Sales Dashboard</div>
            <div className={s.dashSubtitle}>{periodObj.label}{showComp ? ` vs ${COMPARES.find(c => c.id === compare).label.toLowerCase()}` : ''}</div>
          </div>
        </div>
        <div className={s.dashControls}>
          <div className={s.dashPeriodGroup}>
            {PERIODS.map(p => (
              <button key={p.id}
                className={`${s.dashPeriodBtn} ${period === p.id ? s.dashPeriodActive : ''}`}
                onClick={() => setPeriod(p.id)}
              >{p.label}</button>
            ))}
          </div>
          <select className={s.dashCompareSelect} value={compare} onChange={e => setCompare(e.target.value)}>
            {COMPARES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Body */}
      <div className={s.dashFullBody}>
        {/* Sage summary */}
        <div className={s.dashNotes}>
          <span className={s.dashNotesLabel}>Sage</span>
          <span>{data.notes}</span>
        </div>

        {/* Pipeline */}
        <div className={s.dashSectionLabel}>Pipeline Performance <span className={s.dashRef}>SAL-002</span></div>
        <div className={s.dashGrid}>
          {pipelineMetrics.map((m, i) => (
            <div key={i} className={s.dashMetric}>
              <div className={s.dashMetricLabel}>{m.label}</div>
              <div className={s.dashMetricValue}>{m.value ?? '\u2014'}</div>
              <div className={s.dashMetricSub}>{m.sub}</div>
              {m.spark && (
                <div className={s.dashMetricSpark}>
                  <Sparkline data={m.spark} compData={showComp ? m.comp : null} height={36} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* AI metrics */}
        <div className={s.dashSectionLabel}>AI Conversion Metrics <span className={s.dashRef}>SAL-004</span></div>
        <div className={s.dashGrid}>
          {aiMetrics.map((m, i) => (
            <div key={i} className={s.dashMetric}>
              <div className={s.dashMetricLabel}>{m.label}</div>
              <div className={s.dashMetricValue}>{m.value ?? '\u2014'}</div>
              <div className={s.dashMetricSub}>{m.sub}</div>
              {m.spark && (
                <div className={s.dashMetricSpark}>
                  <Sparkline data={m.spark} compData={showComp ? m.comp : null} height={36} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className={s.dashChartsRow}>
          <div className={s.dashChartCard}>
            <div className={s.dashChartTitle}>Close rate trend</div>
            <Sparkline data={data.closeRateOverTime} compData={showComp ? data.closeRateComp : null} color="#3EAF5C" compColor="#A5A19A" height={120} />
            {showComp && <div className={s.dashChartLegend}><span className={s.dashLegendCurrent} style={{ background: '#3EAF5C' }} />{periodObj.label}<span className={s.dashLegendComp} />Previous</div>}
          </div>
          <div className={s.dashChartCard}>
            <div className={s.dashChartTitle}>Sales won over time</div>
            <Sparkline data={data.salesOverTime} compData={showComp ? data.salesComp : null} height={120} />
            {showComp && <div className={s.dashChartLegend}><span className={s.dashLegendCurrent} />{periodObj.label}<span className={s.dashLegendComp} />Previous</div>}
          </div>
        </div>
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
  const [inboxFilter, setInboxFilter] = useState('All');
  const [threads, setThreads] = useState(THREADS);
  const [selectedLead, setSelectedLead] = useState(null);
  const [pipelineExpanded, setPipelineExpanded] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const dragSrcStage = useRef(null);
  const toastTimer = useRef(null);
  const droppedTimer = useRef(null);

  // Derived: group leads by stage (today trials sorted first)
  const leadsByStage = {};
  STAGES.forEach(st => {
    let stageLeads = leads.filter(l => l.stage === st.id);
    if (st.id === 'bookedTrial') {
      stageLeads = [
        ...stageLeads.filter(l => l.trialDate === 'today'),
        ...stageLeads.filter(l => l.trialDate !== 'today'),
      ];
    }
    stageLeads = [
      ...stageLeads.filter(l => l.needsAttention),
      ...stageLeads.filter(l => !l.needsAttention),
    ];
    leadsByStage[st.id] = stageLeads;
  });

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

  /* ─── UPDATE LEAD ─── */
  function handleUpdateLead(id, patch) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  /* ─── MONTH PROGRESS ─── */
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);

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
              <StatPill value="+12.4% MTD" explanation="Revenue growth vs last month" />
              <StatPill value="34 Leads" explanation="Active in pipeline" />
              <StatPill value="82% Close" explanation="Trial-to-member rate" />
            </div>
          </div>
          <div className={s.bannerBottom}>
            <div></div>
            <button className={s.dashLink} onClick={() => setDashOpen(true)}>
              Full dashboard
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>

        <div className={s.scroll}>
          {/* HERO */}
          <div className={s.hero}>
            {/* KPI CARD */}
            <div className={s.kpiCard}>
              <div className={s.kpiCardTitle}>This month at a glance</div>
              <div className={s.kpiHero}>
                <div className={s.kpiHeroLeft}>
                  <div className={s.kpiHeroLabel}>Qualified Trial Close Rate</div>
                  <Tooltip text="Your close rate this month: % of qualified trials that became members"><div className={s.kpiHeroVal}>{heroVal}<span>%</span></div></Tooltip>
                </div>
                <div className={s.kpiHeroRight}>
                  <div className={s.kpiHeroTrend}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
                    +8%
                    <span className={s.kpiHeroTrendSub}>from last month</span>
                  </div>
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
                  <span className={s.kpiProgressPct}>Day {dayOfMonth} of {daysInMonth}</span>
                </div>
                <div className={s.kpiBar}>
                  <div className={s.kpiBarFill} style={{ '--bar-pct': `${monthPct}%` }} />
                </div>
              </div>
            </div>

            {/* SAGE CARD */}
            <div className={s.sageCard}>
              <div className={s.sageBody}>
                <div className={s.sageBodyContent}>
                  <Tooltip text="AI-generated insight based on pipeline activity and timing signals"><div className={s.sagePriorityBadge}>For You To Know</div></Tooltip>
                  <div className={s.sageInsight}>
                    <div className={s.sageInsightText}>🔥 <strong>Ava Martinez</strong> completed a trial 1 day ago — highest close probability in your pipeline. Follow up now before momentum fades.</div>
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
          <div className={`${s.pipelineSection} ${pipelineExpanded ? s.pipelineSectionExpanded : ''}`}>
            <div className={s.pipelineTopbar}>
              <h2 className={s.pipelineTitle}>Pipeline</h2>
              <div className={s.pipelineTopbarRight}>
                <div className={`${s.pipelineArrows} ${pipelineExpanded ? s.pipelineArrowsHidden : ''}`} aria-hidden="true">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div className={s.pipelineArrow} key={i}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                  ))}
                </div>
                <button
                  className={`${s.pipelineExpandBtn} ${pipelineExpanded ? s.pipelineExpandBtnActive : ''}`}
                  onClick={() => setPipelineExpanded(p => !p)}
                  title={pipelineExpanded ? 'Collapse pipeline' : 'Expand pipeline'}
                >
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    {pipelineExpanded
                      ? <><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></>
                      : <><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></>
                    }
                  </svg>
                </button>
              </div>
            </div>
            <div className={s.pipelineLegend}>
              <div className={s.legendItem}>
                <span className={s.legendDotRed}></span>
                <span className={s.legendText}>Needs attention</span>
              </div>
              <div className={s.legendItem}>
                <span className={s.legendDotGold}></span>
                <span className={s.legendText}>Trial today</span>
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
                    <div className={s.cardsWrap}>
                      <div className={s.cards}>
                        {stageLeads.map(lead => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            draggingId={draggingId}
                            droppedId={droppedId}
                            onSelect={setSelectedLead}
                          />
                        ))}
                      </div>
                      {stageLeads.length > 3 && (
                        <div className={s.cardsMoreFade}>
                          <span className={s.cardsMoreLabel}>
                            +{stageLeads.length - 3} more
                          </span>
                        </div>
                      )}
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
        <div className={s.panelControls}>
          <div className={s.inboxFilters}>
            {['All', 'Instagram DM', 'SMS', 'Email'].map(f => (
              <button key={f}
                className={`${s.inboxFilterBtn} ${inboxFilter === f ? s.inboxFilterActive : ''}`}
                onClick={() => setInboxFilter(f)}
              >{f}</button>
            ))}
          </div>
          <button className={s.markAllRead}
            onClick={() => setThreads(prev => prev.map(t => ({ ...t, unread: false })))}>
            Mark all read
          </button>
        </div>
        <div className={s.threads}>
          {(inboxFilter === 'All' ? threads : threads.filter(t => t.channel === inboxFilter)).map((t, i) => (
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
                <div className={s.threadActions}>
                  <button className={s.threadActionBtn}>Reply</button>
                  <button className={s.threadActionBtn}>Move to Booked</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LEAD DRAWER */}
      <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdateLead={handleUpdateLead} />

      {/* FULL DASHBOARD */}
      {dashOpen && <FullDashboard onClose={() => setDashOpen(false)} />}
    </div>
  );
}
