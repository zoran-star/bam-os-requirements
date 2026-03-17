import { useState, useEffect, useRef, useCallback } from 'react';
import s from '../styles/Sales.module.css';
import sh from '../styles/shared.module.css';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useCountUp from '../hooks/useCountUp';
import useTypewriter from '../hooks/useTypewriter';

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

const COMPILED_INBOX = [
  { id: 'i1', domain: 'Sales', icon: '💬', title: 'Marcus Johnson replied', preview: 'That works! What age groups do you have?', channel: 'Instagram DM', time: '4h ago', unread: true },
  { id: 'i2', domain: 'Sales', icon: '🔥', title: 'Ava Martinez — follow up recommended', preview: 'Trial 1d ago, highest close probability. Momentum fading.', channel: 'AI Insight', time: '1h ago', unread: true },
  { id: 'i3', domain: 'Marketing', icon: '⚠️', title: 'Free Trial Story — 0 conversions', preview: '62 days active, $158 spent. Consider pausing.', channel: 'Ad Alert', time: '3h ago', unread: true },
  { id: 'i4', domain: 'Sales', icon: '📞', title: 'Jake Rivera went cold', preview: 'No response in 3 days. AI re-engagement queued.', channel: 'AI Insight', time: '5h ago', unread: false },
  { id: 'i5', domain: 'Members', icon: '🔄', title: 'Sarah Chen — renewal in 3 days', preview: 'Monthly membership auto-renews Friday. No issues flagged.', channel: 'System', time: '6h ago', unread: false },
  { id: 'i6', domain: 'Sales', icon: '📊', title: 'Weekly sales report ready', preview: '8 trials, 5 closes, 62.5% rate. +8% vs last month.', channel: 'Report', time: '1d ago', unread: false },
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

/* Hooks and StatPill extracted to src/hooks/ and src/components/ */

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
              <span className={s.cardReminderSent}>
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Reminder sent
              </span>
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
  const [feedback, setFeedback] = useState({});
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
                  <div className={s.chatMeta}>
                    <div className={s.chatTime}>{m.time}</div>
                    {m.from === 'ai' && !m.pending && (
                      <div className={s.chatFeedback}>
                        <button
                          className={`${s.chatFeedbackBtn} ${feedback[i] === 'up' ? s.chatFeedbackActive : ''}`}
                          onClick={() => setFeedback(prev => ({ ...prev, [i]: prev[i] === 'up' ? null : 'up' }))}
                          title="Good response"
                        >
                          <svg width="12" height="12" fill={feedback[i] === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                        </button>
                        <button
                          className={`${s.chatFeedbackBtn} ${feedback[i] === 'down' ? s.chatFeedbackDown : ''}`}
                          onClick={() => setFeedback(prev => ({ ...prev, [i]: prev[i] === 'down' ? null : 'down' }))}
                          title="Needs improvement"
                        >
                          <svg width="12" height="12" fill={feedback[i] === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
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
  const [sageFocused, setSageFocused] = useState(false);
  const [cmdInput, setCmdInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState(COMPILED_INBOX);

  // Refs
  const dragSrcStage = useRef(null);
  const toastTimer = useRef(null);
  const droppedTimer = useRef(null);
  const canvasRef = useRef(null);
  const cmdInputRef = useRef(null);

  // Banner canvas
  useBannerCanvas(canvasRef);

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

  /* ─── COUNT-UP (custom hook) ─── */
  const heroVal = useCountUp(57);
  const subVal1 = useCountUp(8);
  const subVal2 = useCountUp(2);

  /* ─── TYPEWRITER (custom hook) ─── */
  const typewriterText = useTypewriter(TYPEWRITER_PROMPTS);

  /* ─── COMMAND BAR HANDLERS ─── */
  const toggleListening = () => setIsListening(p => !p);
  const handleCommand = () => {
    if (!cmdInput.trim()) return;
    setCmdInput('');
  };
  const unreadCount = inboxItems.filter(it => it.unread).length;

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
    <>
      {/* SVG noise filter */}
      <svg className={s.noiseFilter} xmlns="http://www.w3.org/2000/svg">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise" />
          <feColorMatrix type="saturate" values="0" in="noise" />
        </filter>
      </svg>

      <main className={sh.main}>
        {/* ═══ COMMAND BAR ═══ */}
        <div className={s.cmdBar}>
          <div className={s.cmdBarCanvas}>
            <canvas ref={canvasRef} />
          </div>
          <div className={s.cmdLeft}>
            <div className={s.cmdTitle}>Sales</div>
            <div className={s.cmdSub}>Pipeline, leads, and conversions</div>
          </div>

          <div className={`${s.cmdSage} ${sageFocused ? s.cmdSageFocused : ''}`}>
            <div className={s.cmdSageGlow} />
            <div className={s.cmdSageOrb}>
              <span className={s.cmdSageOrbLetter}>S</span>
              <div className={s.cmdSageOrbPulse} />
            </div>
            <div className={s.cmdSageInputWrap}>
              <input
                ref={cmdInputRef}
                className={s.cmdSageInput}
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                placeholder={typewriterText}
                onFocus={() => setSageFocused(true)}
                onBlur={() => !cmdInput && setSageFocused(false)}
                onKeyDown={e => e.key === 'Enter' && handleCommand()}
              />
              {isListening && <span className={s.cmdSageListening}>Listening...</span>}
            </div>
            <div className={`${s.cmdSageMic} ${isListening ? s.cmdSageMicActive : ''}`} onClick={toggleListening}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              {isListening && <div className={s.cmdSageMicPulse} />}
            </div>
            <button className={s.cmdSageSend} onClick={handleCommand} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
            <div className={s.cmdSageWave}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={s.cmdSageWaveBar} style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          </div>

          <div className={s.cmdRight}>
            <Tooltip text="Active leads in pipeline">
              <div className={s.cmdChip}>
                <span className={s.cmdChipDot} style={{ background: 'var(--green)' }} />
                <span className={s.cmdChipValue}>34</span>
                <span className={s.cmdChipLabel}>leads</span>
              </div>
            </Tooltip>
            <Tooltip text="Trial-to-member close rate">
              <div className={s.cmdChip}>
                <span className={s.cmdChipDot} style={{ background: 'var(--gold)' }} />
                <span className={s.cmdChipValue}>62%</span>
                <span className={s.cmdChipLabel}>close</span>
              </div>
            </Tooltip>
            <Tooltip text="Open full sales dashboard">
              <div className={s.cmdChip} onClick={() => setDashOpen(true)} style={{ cursor: 'pointer' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                <span className={s.cmdChipLabel}>Dashboard</span>
              </div>
            </Tooltip>
            <button className={s.cmdBell} onClick={() => setBellOpen(p => !p)}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {unreadCount > 0 && <span className={s.cmdBellBadge}>{unreadCount}</span>}
            </button>
          </div>
        </div>

        <div className={s.scroll}>
          {/* SAGE INSIGHT STRIP */}
          <div className={s.insightStrip}>
            <div className={s.insightStripIcon}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </div>
            <div className={s.insightStripText}>
              <strong>Ava Martinez</strong> completed a trial 1 day ago — highest close probability. Follow up now before momentum fades.
            </div>
            <button className={s.insightStripAction}>Follow up</button>
          </div>

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

      {/* LEAD INBOX BUTTON */}
      <button className={s.inboxBtn} onClick={() => setPanelOpen(p => !p)}>
        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <div className={s.inboxCt}>3</div>
      </button>

      {/* TOAST */}
      <div className={`${s.toast} ${toastVisible ? s.toastShow : ''}`}>
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        Card moved
      </div>

      {/* LEAD INBOX OVERLAY */}
      <div
        className={`${s.overlay} ${panelOpen ? s.overlayOpen : ''}`}
        onClick={() => setPanelOpen(false)}
      ></div>

      {/* LEAD INBOX PANEL */}
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

      {/* COMPILED INBOX OVERLAY */}
      {bellOpen && <div className={s.bellOverlay} onClick={() => setBellOpen(false)} />}

      {/* COMPILED INBOX DRAWER */}
      <div className={`${s.bellPanel} ${bellOpen ? s.bellPanelOpen : ''}`}>
        <div className={s.bellPanelHead}>
          <span className={s.bellPanelTitle}>Inbox</span>
          <button className={s.closeBtn} onClick={() => setBellOpen(false)}>&times;</button>
        </div>
        <div className={s.bellPanelFilters}>
          {['All', 'Sales', 'Marketing', 'Members'].map(f => (
            <button key={f}
              className={`${s.inboxFilterBtn} ${inboxFilter === f ? s.inboxFilterActive : ''}`}
              onClick={() => setInboxFilter(f)}
            >{f}</button>
          ))}
        </div>
        <div className={s.bellPanelItems}>
          {inboxItems
            .filter(it => inboxFilter === 'All' || it.domain === inboxFilter)
            .map(it => (
            <div key={it.id} className={`${s.bellItem} ${it.unread ? s.bellItemUnread : ''}`}>
              <div className={s.bellItemIcon}>{it.icon}</div>
              <div className={s.bellItemContent}>
                <div className={s.bellItemTop}>
                  <span className={s.bellItemTitle}>{it.title}</span>
                  <span className={s.bellItemTime}>{it.time}</span>
                </div>
                <div className={s.bellItemPreview}>{it.preview}</div>
                <div className={s.bellItemMeta}>
                  <span className={s.bellItemDomain}>{it.domain}</span>
                  <span className={s.bellItemChannel}>{it.channel}</span>
                  {it.unread && <div className={s.udot} />}
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
    </>
  );
}
