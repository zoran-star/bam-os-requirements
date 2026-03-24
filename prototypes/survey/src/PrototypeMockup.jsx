import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/* ─── Icons (simple SVG) ───────────────────────────────────────── */
const icons = {
  home: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2L2 9h2v8h4v-5h4v5h4V9h2L10 2z"/></svg>,
  schedule: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 2v2H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H8V2H6zm-2 6h12v8H4V8z"/></svg>,
  marketing: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M18 3l-7 3.5V3L4 7H2v6h2l7 4v-3.5l7 3.5V3zM4 11V9h1v2H4z"/></svg>,
  sales: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11l3-3 4 4 4-4 5 5v4H2v-6zm16-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>,
  members: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zm8 0a3 3 0 11-6 0 3 3 0 016 0zm-4.07 11c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>,
  content: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H4zm2 3h8v2H6V6zm0 4h8v2H6v-2zm0 4h5v1H6v-1z"/></svg>,
  sage: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm2 8H8v-1c0-1.1.9-2 2-2s2 .9 2 2v1z"/></svg>,
}

const NAV = [
  { key: 'home', label: 'Home', icon: icons.home },
  { key: 'schedule', label: 'Schedule', icon: icons.schedule },
  { key: 'marketing', label: 'Marketing', icon: icons.marketing },
  { key: 'sales', label: 'Sales', icon: icons.sales },
  { key: 'members', label: 'Members', icon: icons.members },
  { key: 'content', label: 'Content', icon: icons.content },
]

/* ─── Color constants ──────────────────────────────────────────── */
const C = {
  gold: '#C8A84E',
  green: '#4ADE80',
  blue: '#6B8AE0',
  purple: '#9B6BCC',
  orange: '#E09D24',
  red: '#F87171',
  pink: '#E1306C',
  fbBlue: '#1877F2',
  gBlue: '#4285F4',
  bg: '#131210',
  surface: '#1E1D1A',
  surface2: '#262420',
  surface3: '#2E2C27',
  border: 'rgba(255,255,255,0.07)',
  text1: '#F0EDE6',
  text2: '#9C9889',
  text3: '#5E5A50',
}

/* ─── Shared micro-components ──────────────────────────────────── */

function KpiRing({ value, target, color, label, icon }) {
  const pct = Math.min((value / target) * 100, 100)
  const r = 28, circ = 2 * Math.PI * r
  return (
    <div style={s.kpiCard}>
      <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke={C.surface3} strokeWidth="5" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={s.kpiValue}>{value}<span style={s.kpiTarget}>/{target}</span></div>
      <div style={s.kpiLabel}>{label}</div>
    </div>
  )
}

function StatCard({ label, value, trend, color }) {
  const isUp = trend?.startsWith('+')
  return (
    <div style={s.statCard}>
      <div style={s.statLabel}>{label}</div>
      <div style={{ ...s.statValue, color: color || C.text1 }}>{value}</div>
      {trend && <div style={{ ...s.statTrend, color: isUp ? C.green : C.red }}>{trend}</div>}
    </div>
  )
}

function MemberRow({ name, initials, status, plan, price, color }) {
  const statusColors = { Active: C.green, Trial: C.blue, Paused: C.orange, Cancelled: C.red }
  return (
    <div style={s.memberRow}>
      <div style={{ ...s.avatar, background: color || C.surface3 }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.memberName}>{name}</div>
        <div style={s.memberPlan}>{plan} {price && `· ${price}`}</div>
      </div>
      <div style={{ ...s.statusBadge, background: `${statusColors[status]}20`, color: statusColors[status] }}>
        {status}
      </div>
    </div>
  )
}

function LeadCard({ name, initials, time, preview, badge, urgent }) {
  return (
    <div style={s.leadCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...s.avatar, background: C.surface3, width: 30, height: 30, fontSize: 11 }}>{initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>{name} {urgent && '🔥'}</div>
          <div style={{ fontSize: 11, color: C.text3 }}>{time}</div>
        </div>
        {badge && <div style={{ ...s.statusBadge, background: `${C.blue}20`, color: C.blue, fontSize: 10, padding: '2px 8px' }}>{badge}</div>}
      </div>
      {preview && <div style={{ fontSize: 11, color: C.text3, marginTop: 6, lineHeight: 1.4 }}>{preview}</div>}
    </div>
  )
}

function ContentCard({ hook, type, status, color }) {
  return (
    <div style={s.contentCardItem}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: 'uppercase' }}>{type}</div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text1, lineHeight: 1.4 }}>{hook}</div>
      {status && <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{status}</div>}
    </div>
  )
}

function SessionBlock({ name, time, coach, spots, color, top, height }) {
  return (
    <div style={{
      position: 'absolute', top, left: 2, right: 2, height,
      background: `${color}18`, borderLeft: `3px solid ${color}`,
      borderRadius: 6, padding: '4px 8px', fontSize: 10, overflow: 'hidden',
      cursor: 'pointer', transition: 'all 0.2s',
    }}>
      <div style={{ fontWeight: 700, color, fontSize: 11 }}>{name}</div>
      <div style={{ color: C.text3, marginTop: 1 }}>{time} · {coach}</div>
      <div style={{ color: C.text3, marginTop: 1 }}>{spots}</div>
    </div>
  )
}

/* ─── Page renderers ───────────────────────────────────────────── */

function HomePage() {
  return (
    <div>
      {/* Sage greeting */}
      <div style={s.sageBar}>
        <div style={s.sageOrb}>S</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text1 }}>Good afternoon, Zoran</div>
          <div style={{ fontSize: 12, color: C.text3 }}>Monday, March 24</div>
        </div>
        <div style={s.locationChip}>All Locations</div>
      </div>

      {/* Sage AI input */}
      <div style={s.sageInput}>
        <div style={{ ...s.sageOrb, width: 28, height: 28, fontSize: 12 }}>S</div>
        <div style={{ flex: 1, fontSize: 13, color: C.text3, fontStyle: 'italic' }}>Ask Sage anything about your business...</div>
      </div>

      {/* Milestone */}
      <div style={s.milestoneCard}>
        <div style={{ fontSize: 22, marginRight: 12 }}>🏆</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>MRR crossed $8k</div>
          <div style={{ fontSize: 11, color: C.text3 }}>First time hitting this level — up 18% from 3 months ago</div>
        </div>
      </div>

      {/* KPIs */}
      <div style={s.kpiGrid}>
        <KpiRing value={6} target={10} color={C.green} label="New Members" />
        <KpiRing value={8.2} target={10} color={C.gold} label="MRR Growth %" />
        <KpiRing value={18} target={24} color={C.blue} label="Classes Filled" />
        <KpiRing value={4} target={6} color={C.orange} label="Trials Booked" />
      </div>

      {/* Sage challenge */}
      <div style={s.challengeCard}>
        <div style={{ ...s.sageOrb, width: 24, height: 24, fontSize: 10 }}>S</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>You're 2 members away from your best month ever.</div>
          <div style={{ fontSize: 12, color: C.gold, marginTop: 4, cursor: 'pointer' }}>Draft a follow-up to your 3 unconverted trials? →</div>
        </div>
      </div>
    </div>
  )
}

function SchedulePage() {
  const days = ['Mon 17', 'Tue 18', 'Wed 19', 'Thu 20', 'Fri 21', 'Sat 22', 'Sun 23']
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Sessions This Week" value="18" />
        <StatCard label="Total Bookings" value="142" />
        <StatCard label="Avg Fill Rate" value="78%" />
        <StatCard label="Cancellations" value="2" />
      </div>

      {/* Calendar header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>← Week of Mar 17–23 →</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={s.viewToggle}>Week</div>
          <div style={{ ...s.viewToggle, background: 'transparent', color: C.text3 }}>Month</div>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={s.calendarGrid}>
        {/* Time column */}
        <div style={s.timeCol}>
          {['6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM'].map(t => (
            <div key={t} style={s.timeSlot}>{t}</div>
          ))}
        </div>
        {/* Day columns */}
        {days.map((day, di) => (
          <div key={day} style={s.dayCol}>
            <div style={s.dayHeader}>{day}</div>
            <div style={{ position: 'relative', flex: 1 }}>
              {di === 0 && <SessionBlock name="Elite Training" time="4:00 PM" coach="ZS" spots="8/10" color={C.gold} top="50%" height={48} />}
              {di === 1 && <SessionBlock name="Group Training" time="5:30 PM" coach="MJ" spots="12/15" color={C.green} top="58%" height={40} />}
              {di === 2 && <>
                <SessionBlock name="Beginner" time="3:00 PM" coach="AK" spots="6/8" color={C.blue} top="42%" height={36} />
                <SessionBlock name="Elite Training" time="6:00 PM" coach="ZS" spots="10/10" color={C.gold} top="68%" height={48} />
              </>}
              {di === 3 && <SessionBlock name="Individual" time="4:30 PM" coach="ZS" spots="1/1" color={C.purple} top="52%" height={32} />}
              {di === 4 && <>
                <SessionBlock name="Group Training" time="4:00 PM" coach="MJ" spots="11/15" color={C.green} top="50%" height={40} />
                <SessionBlock name="Evaluation" time="6:30 PM" coach="ZS" spots="1/1" color={C.orange} top="72%" height={28} />
              </>}
              {di === 5 && <>
                <SessionBlock name="Elite Training" time="9:00 AM" coach="ZS" spots="9/10" color={C.gold} top="12%" height={48} />
                <SessionBlock name="Beginner" time="11:00 AM" coach="AK" spots="5/8" color={C.blue} top="28%" height={36} />
              </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MarketingPage() {
  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total Spend" value="$435" />
        <StatCard label="Avg CPL" value="$14.80" />
        <StatCard label="Total Conversions" value="25" trend="+12%" />
        <StatCard label="Avg CTR" value="3.7%" trend="+0.8%" />
      </div>

      {/* Channel breakdown */}
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 10 }}>Channel Breakdown</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {[
          { name: 'Instagram', icon: '📸', leads: 14, cpl: '$12.40', trend: '+22%', color: C.pink },
          { name: 'Facebook', icon: '📘', leads: 8, cpl: '$18.60', trend: '+5%', color: C.fbBlue },
          { name: 'Google', icon: '🔍', leads: 6, cpl: '$24.10', trend: '-8%', color: C.gBlue },
          { name: 'Referral', icon: '🤝', leads: 4, cpl: '$0', trend: '+50%', color: C.green },
        ].map(ch => (
          <div key={ch.name} style={s.channelRow}>
            <span style={{ fontSize: 16 }}>{ch.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text1 }}>{ch.name}</div>
              <div style={{ fontSize: 11, color: C.text3 }}>{ch.leads} leads · CPL {ch.cpl}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: ch.trend.startsWith('+') ? C.green : C.red }}>{ch.trend}</div>
          </div>
        ))}
      </div>

      {/* Top performing ads */}
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 10 }}>Top Performing Ads</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { name: 'Youth Basketball Reel — Saturday Energy', spend: '$89', conv: 6, ctr: '4.2%' },
          { name: 'Parent Testimonial — Maria R.', spend: '$134', conv: 5, ctr: '3.8%' },
          { name: 'Back-to-School Registration', spend: '$67', conv: 3, ctr: '3.1%' },
        ].map(ad => (
          <div key={ad.name} style={s.adCard}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>{ad.name}</div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>
              {ad.spend} spend · {ad.conv} conversions · {ad.ctr} CTR
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SalesPage() {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total Leads" value="29" trend="+8" />
        <StatCard label="Booked Trials" value="12" />
        <StatCard label="Conversion Rate" value="41%" trend="+6%" color={C.green} />
      </div>

      {/* Pipeline kanban */}
      <div style={s.kanban}>
        <div style={s.kanbanCol}>
          <div style={s.kanbanHeader}>Interested <span style={s.kanbanCount}>8</span></div>
          <LeadCard name="Marcus Johnson" initials="MJ" time="4h ago" preview="Hey, I saw your academy on Instagram..." badge="DM" urgent />
          <LeadCard name="Ava Williams" initials="AW" time="1d ago" preview="What ages do you accept?" badge="SMS" />
          <LeadCard name="David Kim" initials="DK" time="2d ago" preview="Is there a free trial available?" badge="Web" />
        </div>
        <div style={s.kanbanCol}>
          <div style={{ ...s.kanbanHeader, color: C.green }}>Booked Trial <span style={s.kanbanCount}>4</span></div>
          <LeadCard name="Sofia Reyes" initials="SR" time="Today 10am" preview="Trial confirmed for Saturday" badge="Today" />
          <LeadCard name="James Chen" initials="JC" time="Fri Mar 21" preview="Looking forward to it!" />
        </div>
        <div style={s.kanbanCol}>
          <div style={{ ...s.kanbanHeader, color: C.orange }}>Done Trial <span style={s.kanbanCount}>3</span></div>
          <LeadCard name="Emily Watson" initials="EW" time="1d ago" preview="Can we do the elite plan?" urgent />
          <LeadCard name="Tyler Brooks" initials="TB" time="3d ago" preview="Thinking about it, will let you know" />
        </div>
      </div>
    </div>
  )
}

function MembersPage() {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Active Members" value="42" trend="+3" />
        <StatCard label="New This Month" value="6" trend="+2" />
        <StatCard label="Churn Rate (30d)" value="2.4%" color={C.green} />
        <StatCard label="Avg Duration" value="7.4 mo" />
      </div>

      {/* Member table */}
      <div style={s.table}>
        <div style={s.tableHeader}>
          <div style={{ flex: 2 }}>Name</div>
          <div style={{ flex: 1 }}>Status</div>
          <div style={{ flex: 1 }}>Plan</div>
          <div style={{ flex: 1, textAlign: 'right' }}>Price</div>
        </div>
        <MemberRow name="Carlos Martinez" initials="CM" status="Active" plan="Elite" price="$175/mo" color={C.gold} />
        <MemberRow name="Mia Thompson" initials="MT" status="Active" plan="Intermediate" price="$125/mo" color={C.green} />
        <MemberRow name="Jaylen Brooks" initials="JB" status="Active" plan="Elite" price="$175/mo" color={C.gold} />
        <MemberRow name="Sofia Reyes" initials="SR" status="Trial" plan="Free Trial" price="$0" color={C.blue} />
        <MemberRow name="Ethan Nguyen" initials="EN" status="Paused" plan="Beginner" price="$95/mo" color={C.orange} />
        <MemberRow name="Ava Chen" initials="AC" status="Active" plan="Beginner" price="$95/mo" color={C.green} />
        <MemberRow name="Marcus Davis" initials="MD" status="Active" plan="Intermediate" price="$125/mo" color={C.red} />
      </div>
    </div>
  )
}

function ContentPage() {
  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {['Pipeline', 'Calendar', 'Analytics'].map((t, i) => (
          <div key={t} style={{ ...s.viewToggle, ...(i === 0 ? {} : { background: 'transparent', color: C.text3 }) }}>{t}</div>
        ))}
      </div>

      {/* Content pipeline */}
      <div style={s.kanban}>
        <div style={s.kanbanCol}>
          <div style={s.kanbanHeader}>Pending Review <span style={s.kanbanCount}>3</span></div>
          <ContentCard hook="3 things I wish I knew before starting my fitness journey" type="Reel" color={C.gold} />
          <ContentCard hook="Why most kids quit sports (and how to prevent it)" type="Carousel" color="#6366f1" />
        </div>
        <div style={s.kanbanCol}>
          <div style={{ ...s.kanbanHeader, color: C.green }}>Approved <span style={s.kanbanCount}>2</span></div>
          <ContentCard hook="POV: You finally find a gym where the coach knows your name" type="Reel" status="Scheduled Mar 24" color={C.gold} />
          <ContentCard hook="5 drills every young baller needs" type="Thread" status="Scheduled Mar 26" color={C.blue} />
        </div>
        <div style={s.kanbanCol}>
          <div style={{ ...s.kanbanHeader, color: C.gold }}>Posted <span style={s.kanbanCount}>4</span></div>
          <ContentCard hook="Member transformation: Sarah went from 'I hate mornings' to 5 AM warrior" type="Carousel" status="Posted Mar 18" color="#6366f1" />
          <ContentCard hook="Day in the life of a BAM coach" type="Reel" status="Posted Mar 16" color={C.gold} />
        </div>
      </div>
    </div>
  )
}

const PAGES = { home: HomePage, schedule: SchedulePage, marketing: MarketingPage, sales: SalesPage, members: MembersPage, content: ContentPage }

/* ─── Main Mockup Component ────────────────────────────────────── */

/* ─── Comment Pin ───────────────────────────────────────────────── */

function CommentPin({ pin, onUpdate, onDelete }) {
  const isNote = pin.mode === 'note'
  const [showInput, setShowInput] = useState(isNote) // notes auto-open, star/confused show on click
  const [text, setText] = useState(pin.text || '')

  const save = () => {
    onUpdate({ ...pin, text: text.trim() })
    setShowInput(false)
  }

  const icon = pin.mode === 'like' ? '★' : pin.mode === 'confused' ? '?' : '✎'
  const color = pin.mode === 'like' ? C.gold : pin.mode === 'confused' ? C.red : C.text1

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      style={{ position: 'absolute', left: pin.x - 12, top: pin.y - 12, zIndex: 20 }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: color, border: '2px solid #fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: pin.mode === 'like' ? '#0E0D0B' : '#fff',
        fontWeight: 700, cursor: 'pointer',
      }} onClick={() => setShowInput(!showInput)}>
        {icon}
      </div>

      {/* Input — always available, optional for star/confused */}
      {showInput && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          style={{ position: 'absolute', top: 30, left: -4, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, width: 210, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {!isNote && <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Add a note (optional)</div>}
          <input autoFocus value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setShowInput(false) }}
            placeholder={isNote ? 'Leave a note...' : 'Why? (optional)'}
            style={{ width: '100%', background: C.surface3, border: 'none', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: C.text1, outline: 'none', fontFamily: 'var(--font)' }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onDelete(pin.id)} style={{ ...s.pinBtn, color: C.text3 }}>Remove</button>
            <button onClick={save} style={{ ...s.pinBtn, color: C.gold }}>Save</button>
          </div>
        </motion.div>
      )}

      {/* Show saved note text */}
      {!showInput && pin.text && (
        <div style={{ position: 'absolute', top: 30, left: -4, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 11, color: C.text2, maxWidth: 180, lineHeight: 1.4, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', cursor: 'pointer' }}
          onClick={() => setShowInput(true)}>
          {pin.text}
        </div>
      )}
    </motion.div>
  )
}

/* ─── Main Mockup Component ────────────────────────────────────── */

export default function PrototypeMockup({ feedbackMode, pins = [], onAddPin, onUpdatePin, onDeletePin, walkthroughPage }) {
  const [activeNav, setActiveNav] = useState('home')
  const PageComponent = PAGES[activeNav]

  useEffect(() => {
    if (walkthroughPage) setActiveNav(walkthroughPage)
  }, [walkthroughPage])

  const handleMainClick = (e) => {
    if (walkthroughPage) return
    if (e.target.closest('[data-pin]') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = Date.now()
    const number = pins.filter(p => p.page === activeNav).length + 1
    onAddPin?.({ id, x, y, page: activeNav, mode: feedbackMode, text: '', number })
  }

  const pagePins = pins.filter(p => p.page === activeNav)

  return (
    <div style={s.wrap}>
      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarLogo}>
          <div style={s.logoMark}>FC</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text1 }}>FullControl</div>
            <div style={{ fontSize: 9, color: C.text3, letterSpacing: '0.04em' }}>Command Center</div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(item => {
            const pinCount = pins.filter(p => p.page === item.key).length
            return (
              <motion.div
                key={item.key}
                style={{ ...s.navItem, ...(activeNav === item.key ? s.navItemActive : {}) }}
                onClick={() => setActiveNav(item.key)}
                whileHover={{ x: 3 }}
              >
                <div style={{ width: 18, height: 18, opacity: activeNav === item.key ? 1 : 0.4 }}>{item.icon}</div>
                {item.label}
                {pinCount > 0 && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 9, fontWeight: 700,
                    background: C.gold, color: C.bg, borderRadius: 10,
                    padding: '1px 6px', minWidth: 16, textAlign: 'center',
                  }}>{pinCount}</span>
                )}
              </motion.div>
            )
          })}
        </div>

        {/* Hint */}
        <div style={{ padding: '8px 10px', fontSize: 10, color: C.text3, lineHeight: 1.4, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
          Click anywhere to drop a pin and leave a note
        </div>

        {/* User */}
        <div style={s.sidebarUser}>
          <div style={{ ...s.avatar, width: 32, height: 32, fontSize: 12, background: C.surface3 }}>ZS</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>Zoran Savic</div>
            <div style={{ fontSize: 10, color: C.text3 }}>Owner</div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ ...s.main, position: 'relative', cursor: 'crosshair' }} onClick={handleMainClick}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeNav}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{ minHeight: 400 }}
          >
            <PageComponent />
          </motion.div>
        </AnimatePresence>

        {/* Pins overlay */}
        {pagePins.map(pin => (
          <CommentPin key={pin.id} pin={pin} onUpdate={onUpdatePin} onDelete={onDeletePin} />
        ))}
      </div>
    </div>
  )
}

/* ─── Styles object ────────────────────────────────────────────── */

const s = {
  wrap: {
    width: '100%',
    background: C.surface,
    borderRadius: 16,
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    display: 'flex',
    minHeight: 520,
    border: `1px solid ${C.border}`,
  },
  sidebar: {
    width: 190,
    background: C.bg,
    borderRight: `1px solid ${C.border}`,
    padding: '16px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flexShrink: 0,
  },
  sidebarLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px 16px',
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: `linear-gradient(135deg, ${C.gold}, #A08030)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    color: '#0E0D0B',
    flexShrink: 0,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: C.text3,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  navItemActive: {
    background: `${C.gold}15`,
    color: C.gold,
  },
  sidebarUser: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 8px 4px',
    borderTop: `1px solid ${C.border}`,
    marginTop: 8,
  },
  main: {
    flex: 1,
    padding: '20px 22px',
    overflowY: 'auto',
    maxHeight: 520,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    color: C.text1,
    flexShrink: 0,
  },

  // Sage
  sageBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sageOrb: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: `linear-gradient(135deg, ${C.gold}30, ${C.gold}10)`,
    border: `1px solid ${C.gold}40`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 800,
    color: C.gold,
    flexShrink: 0,
  },
  sageInput: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: C.surface2,
    borderRadius: 12,
    border: `1px solid ${C.border}`,
    marginBottom: 14,
  },
  locationChip: {
    fontSize: 11,
    fontWeight: 600,
    color: C.text3,
    background: C.surface2,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '4px 10px',
  },

  // KPI
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    background: C.surface2,
    borderRadius: 12,
    padding: '14px 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: `1px solid ${C.border}`,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: 800,
    color: C.text1,
    marginTop: 4,
  },
  kpiTarget: {
    fontSize: 12,
    fontWeight: 500,
    color: C.text3,
  },
  kpiLabel: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
    textAlign: 'center',
  },

  // Milestone
  milestoneCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    background: `${C.gold}10`,
    borderRadius: 12,
    border: `1px solid ${C.gold}25`,
    marginBottom: 14,
  },

  // Challenge
  challengeCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '14px 16px',
    background: C.surface2,
    borderRadius: 12,
    border: `1px solid ${C.border}`,
  },

  // Stats
  statCard: {
    flex: 1,
    minWidth: 90,
    background: C.surface2,
    borderRadius: 10,
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
  },
  statLabel: { fontSize: 10, color: C.text3, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: 800, color: C.text1 },
  statTrend: { fontSize: 11, fontWeight: 600, marginTop: 2 },

  // Calendar
  calendarGrid: {
    display: 'flex',
    gap: 0,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 260,
  },
  timeCol: {
    width: 44,
    background: C.surface2,
    borderRight: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 28,
  },
  timeSlot: {
    height: 30,
    fontSize: 9,
    color: C.text3,
    textAlign: 'right',
    paddingRight: 6,
  },
  dayCol: {
    flex: 1,
    borderRight: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  dayHeader: {
    fontSize: 10,
    fontWeight: 700,
    color: C.text2,
    textAlign: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface2,
  },
  viewToggle: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    borderRadius: 6,
    background: C.surface2,
    color: C.text1,
    cursor: 'pointer',
  },

  // Kanban
  kanban: {
    display: 'flex',
    gap: 10,
  },
  kanbanCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  kanbanHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: C.text2,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  kanbanCount: {
    fontSize: 10,
    background: C.surface3,
    borderRadius: 10,
    padding: '1px 7px',
    color: C.text3,
  },
  leadCard: {
    background: C.surface2,
    borderRadius: 10,
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  contentCardItem: {
    background: C.surface2,
    borderRadius: 10,
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
  },

  // Channel
  channelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: C.surface2,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
  },
  adCard: {
    padding: '10px 12px',
    background: C.surface2,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
  },

  // Members table
  table: {
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '8px 14px',
    fontSize: 10,
    fontWeight: 700,
    color: C.text3,
    textTransform: 'uppercase',
    background: C.surface2,
    borderBottom: `1px solid ${C.border}`,
    letterSpacing: '0.04em',
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderBottom: `1px solid ${C.border}`,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  memberName: { fontSize: 13, fontWeight: 600, color: C.text1 },
  memberPlan: { fontSize: 11, color: C.text3 },
  statusBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 20,
  },
  pinBtn: {
    background: 'none',
    border: 'none',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
    fontFamily: 'var(--font)',
  },
}
