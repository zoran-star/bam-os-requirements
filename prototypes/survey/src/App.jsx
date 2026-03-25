import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import PrototypeMockup from './PrototypeMockup'
import { supabase } from './supabase'

const PROTO_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5173'
  : 'https://fullcontrol-prototype.vercel.app'

function PrototypeIframe({ page, onNavigate, persistent }) {
  const iframeRef = useRef(null)
  const src = page ? PROTO_URL + '/#/' + page : PROTO_URL

  // Listen for route change messages from the prototype
  useEffect(() => {
    if (!onNavigate) return
    const handler = (e) => {
      if (e.data?.type === 'fc-route-change' && e.data.page) {
        onNavigate(e.data.page)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onNavigate])

  return (
    <iframe
      ref={iframeRef}
      key={persistent ? 'persistent' : page}
      src={src}
      style={{ width: '100%', height: 560, border: 'none', borderRadius: 16, display: 'block' }}
      allow="autoplay"
    />
  )
}

function PinMarker({ pin, onUpdate, onDelete }) {
  const isNote = pin.mode === 'note'
  const [showInput, setShowInput] = useState(isNote)
  const [text, setText] = useState(pin.text || '')
  const icon = pin.mode === 'like' ? '★' : pin.mode === 'confused' ? '?' : '✎'
  const color = pin.mode === 'like' ? '#C8A84E' : pin.mode === 'confused' ? '#F87171' : '#F0EDE6'
  const save = () => { onUpdate({ ...pin, text: text.trim() }); setShowInput(false) }

  return (
    <motion.div
      data-pin
      initial={{ scale: 0 }} animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      style={{ position: 'absolute', left: pin.x - 12, top: pin.y - 12, zIndex: 20 }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: color,
        border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: pin.mode === 'like' ? '#0E0D0B' : '#fff',
        fontWeight: 700, cursor: 'pointer',
      }} onClick={() => setShowInput(!showInput)}>
        {icon}
      </div>
      {showInput && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          style={{ position: 'absolute', top: 30, left: -4, background: '#262420', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 8, width: 210, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {!isNote && <div style={{ fontSize: 10, color: '#5E5A50', marginBottom: 4 }}>Add a note (optional)</div>}
          <input autoFocus value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setShowInput(false) }}
            placeholder={isNote ? 'Leave a note...' : 'Why? (optional)'}
            style={{ width: '100%', background: '#2E2C27', border: 'none', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#F0EDE6', outline: 'none', fontFamily: 'var(--font)' }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => onDelete(pin.id)} style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 600, color: '#5E5A50', cursor: 'pointer', padding: '2px 6px', fontFamily: 'var(--font)' }}>Remove</button>
            <button onClick={save} style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 600, color: '#C8A84E', cursor: 'pointer', padding: '2px 6px', fontFamily: 'var(--font)' }}>Save</button>
          </div>
        </motion.div>
      )}
      {!showInput && pin.text && (
        <div style={{ position: 'absolute', top: 30, left: -4, background: '#262420', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '5px 8px', fontSize: 11, color: '#9C9889', maxWidth: 180, lineHeight: 1.4, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', cursor: 'pointer' }}
          onClick={() => setShowInput(true)}>
          {pin.text}
        </div>
      )}
    </motion.div>
  )
}

/* ─── Sound design ─────────────────────────────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext
let audioCtx = null
function getCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx }

function playClick() {
  try {
    const ctx = getCtx()
    // Mouse click — short noise snap with low thud
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.012, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3)
    const src = ctx.createBufferSource(); src.buffer = buf
    const g = ctx.createGain(); g.gain.value = 0.15
    src.connect(g); g.connect(ctx.destination); src.start()
  } catch(e) {}
}

function playSwoosh() {
  try {
    const ctx = getCtx()
    // Soft double-click for transitions
    const o1 = ctx.createOscillator(); const g1 = ctx.createGain()
    o1.connect(g1); g1.connect(ctx.destination)
    o1.frequency.value = 1400; o1.type = 'sine'
    g1.gain.setValueAtTime(0.08, ctx.currentTime)
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
    o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.04)
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain()
    o2.connect(g2); g2.connect(ctx.destination)
    o2.frequency.value = 2000; o2.type = 'sine'
    g2.gain.setValueAtTime(0.06, ctx.currentTime + 0.06)
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    o2.start(ctx.currentTime + 0.06); o2.stop(ctx.currentTime + 0.1)
  } catch(e) {}
}

function playDing() {
  try {
    const ctx = getCtx(); const o = ctx.createOscillator(); const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; o.type = 'sine'
    g.gain.setValueAtTime(0.05, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.3)
  } catch(e) {}
}

function playComplete() {
  try {
    const ctx = getCtx()
    ;[880, 1100, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination); o.frequency.value = freq; o.type = 'sine'
      g.gain.setValueAtTime(0.04, ctx.currentTime + i * 0.1); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.35)
      o.start(ctx.currentTime + i * 0.1); o.stop(ctx.currentTime + i * 0.1 + 0.35)
    })
  } catch(e) {}
}

/* ─── Typewriter ───────────────────────────────────────────────── */
function useTypewriter(text, speed = 25, delay = 250) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    setDisplayed(''); setDone(false)
    const timer = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => { i++; setDisplayed(text.slice(0, i)); if (i >= text.length) { clearInterval(interval); setDone(true) } }, speed)
      return () => clearInterval(interval)
    }, delay)
    return () => clearTimeout(timer)
  }, [text, speed, delay])
  return [displayed, done]
}

/* ─── Mic ──────────────────────────────────────────────────────── */
const MicIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>)

function VoiceTextarea({ value, onChange, placeholder, style, hiddenWhenBubbles, onKeyDown }) {
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef(null)
  const toggleRecording = () => {
    if (recording) { recognitionRef.current?.stop(); setRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; onChange(value ? value + ' ' + t : t) }
    r.onerror = () => setRecording(false); r.onend = () => setRecording(false)
    recognitionRef.current = r; r.start(); setRecording(true)
  }
  return (
    <div className="voice-textarea-wrap">
      <textarea placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} style={{ ...style, ...(hiddenWhenBubbles ? { minHeight: 60 } : {}) }} />
      <button className={`mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording}><MicIcon /></button>
      {!recording && !value && <div className="mic-invite" />}
      <div className="voice-hint">{recording ? 'Listening...' : 'type or talk'}</div>
    </div>
  )
}

/* ─── Bubble Input (chips inside the text box) ────────────────── */
function BubbleInput({ bubbles, onRemove, inputValue, onInputChange, onKeyDown, placeholder }) {
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef(null)
  const inputRef = useRef(null)

  const toggleRecording = () => {
    if (recording) { recognitionRef.current?.stop(); setRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; onInputChange(inputValue ? inputValue + ' ' + t : t) }
    r.onerror = () => setRecording(false); r.onend = () => setRecording(false)
    recognitionRef.current = r; r.start(); setRecording(true)
  }

  return (
    <div className="voice-textarea-wrap">
      <div className="bubble-input-box" onClick={() => inputRef.current?.focus()}>
        {bubbles.map(label => (
          <span key={label} className="bubble-tag" onClick={e => { e.stopPropagation(); onRemove(label) }}>{label} <span className="remove">&times;</span></span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="bubble-inline-input"
          placeholder={bubbles.length === 0 ? placeholder : (inputValue ? '' : 'Add more...')}
          value={inputValue}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <button className={`mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording} style={{ top: 14, right: 14 }}><MicIcon /></button>
      {!recording && !inputValue && bubbles.length === 0 && <div className="mic-invite" />}
      <div className="voice-hint">{recording ? 'Listening...' : 'type or talk'}</div>
    </div>
  )
}

/* ─── Tooltip ──────────────────────────────────────────────────── */
function Tooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span className="tooltip-wrap" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="tooltip-icon">?</span>
      {show && <div className="tooltip-content">{text}</div>}
    </span>
  )
}

/* ─── Walkthrough data ─────────────────────────────────────────── */
const WALKTHROUGH_STEPS = [
  { page: 'home', text: 'Your command center. Everything happening in your business, at a glance.', example: '"How\'s this month looking compared to last?" → Sage pulls the numbers instantly.' },
  { page: 'schedule', text: 'Say it, and it happens.', example: '"Send a message to everyone booked on Wednesday. Session starts 15 minutes late." → Done. Texts go out automatically.' },
  { page: 'marketing', text: 'Your ads, your leads, your spend. All managed.', example: '"Pause the Instagram ad that\'s not converting and put that budget on the one that is." → Sage handles it.' },
  { page: 'sales', text: 'Every lead gets followed up with. Automatically.', example: '"Follow up with Marcus, he visited yesterday but didn\'t book a trial." → Sage drafts the message in your voice and sends it.' },
  { page: 'members', text: 'You know every client. The AI watches for risk.', example: '"Cancel Ethan\'s membership and issue a prorated refund." → Done. Confirmation sent to Ethan automatically.' },
  { page: 'content', text: 'Content that writes itself, in your voice.', example: '"Write a post about Saturday\'s session and schedule it for Monday morning." → Sage writes it, you approve, it goes live.' },
]

/* ─── constants ────────────────────────────────────────────────── */
const CORE_SUGGESTIONS = [
  'AI that talks to every lead and locks them in',
  'Clients book themselves, zero back-and-forth',
  'See exactly how much money is coming in next month',
  'Auto follow-ups that close deals while you sleep',
  'One inbox for every message across every platform',
  'AI creates and posts your content for you',
  'Know instantly which clients are about to leave',
  'Staff schedules that manage themselves',
]

const EXTRA_SUGGESTIONS = [
  'Auto-generate highlight reels from session footage',
  'Clients earn rewards for referrals automatically',
  'AI tells you exactly what to charge and when to raise prices',
  'One dashboard across all your locations',
  'Automated billing, never chase a payment again',
  'AI writes your emails, texts, and DMs in your voice',
  'See which marketing is actually bringing in money',
  'A branded app your clients download and love',
]

const FAVORITE_SECTIONS = [
  { key: 'home', label: 'Dashboard & KPIs' },
  { key: 'schedule', label: 'Scheduling' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales Pipeline' },
  { key: 'members', label: 'Member Management' },
  { key: 'content', label: 'Content Engine' },
  { key: 'sage', label: 'Sage AI Advisor' },
]

const TOTAL_SLIDES = 12 // 0-11: Welcome, NDA, About, Dream, Blind, Walkthrough, Favorites, Smart, Wishlist, Final Price, Submit, Thank You

const SERVICES_OPTIONS = [
  { key: 'individual-training', label: 'Individual Training' },
  { key: 'group-training', label: 'Group Training' },
  { key: 'gym-rentals', label: 'Gym / Equipment Rentals' },
  { key: 'team-competition', label: 'Team Competition' },
  { key: 'house-league', label: 'Internal House League' },
  { key: 'other', label: 'Other' },
]

const CLIENT_COUNT_OPTIONS = ['1-10', '11-25', '26-50', '51-100', '100+']

const REVENUE_OPTIONS = ['Under $5K', '$5K–$10K', '$10K–$25K', '$25K–$50K', '$50K+']

const BUSINESS_STAGES = [
  { key: 'early', label: 'Just getting started', desc: 'Less than 2 years', icon: '🌱' },
  { key: 'growing', label: 'Building momentum', desc: '2–5 years', icon: '🔥' },
  { key: 'established', label: 'Well established', desc: '5+ years', icon: '🏛' },
]

const CHALLENGE_OPTIONS = [
  { key: 'growth', label: 'Growing my business', desc: 'More clients, more revenue, more reach', icon: '📈' },
  { key: 'time', label: 'Getting my time back', desc: 'Less admin, more coaching, more life', icon: '⏳' },
  { key: 'both', label: 'Both equally', desc: 'I need growth AND freedom', icon: '⚡' },
]

/* ─── Rating Dial (1-5) ───────────────────────────────────────── */
function RatingDial({ value, onChange, page }) {
  const labels = ['', 'Not useful', 'Slightly useful', 'Useful', 'Very useful', 'Essential']
  return (
    <motion.div className="rating-dial-wrap" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <div className="rating-dial-label">How useful would <strong>{page}</strong> be for your business?</div>
      <div className="rating-dial">
        {[1,2,3,4,5].map(n => (
          <button key={n} className={`rating-dot ${value >= n ? 'active' : ''} ${value === n ? 'current' : ''}`}
            onClick={() => onChange(n)}>
            <span className="rating-dot-num">{n}</span>
          </button>
        ))}
        <div className="rating-track">
          <div className="rating-fill" style={{ width: `${((value || 0) - 1) / 4 * 100}%` }} />
        </div>
      </div>
      {value > 0 && <div className="rating-label">{labels[value]}</div>}
    </motion.div>
  )
}

/* ─── Note Input (optional comment per page) ──────────────────── */
function PageNoteInput({ value, onChange, page }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} style={{ width: '100%', maxWidth: 500, margin: '0 auto' }}>
      <input type="text" className="page-note-input" placeholder="Anything specific about this section? (optional)"
        value={value || ''} onChange={e => onChange(e.target.value)} />
    </motion.div>
  )
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } }
const fadeSlideUp = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } } }

/* ─── Signature Canvas ─────────────────────────────────────────── */
function SignatureCanvas({ onSignatureChange }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.strokeStyle = '#F0EDE6'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasDrawn(true)
  }

  const endDraw = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const canvas = canvasRef.current
    const data = canvas.toDataURL('image/png')
    onSignatureChange(data)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
    onSignatureChange('')
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Set internal resolution
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    const ctx = canvas.getContext('2d')
    ctx.scale(2, 2)
  }, [])

  return (
    <div className="nda-canvas-wrap">
      <label>Your Signature</label>
      <canvas
        ref={canvasRef}
        className={`nda-canvas ${hasDrawn ? 'has-signature' : ''}`}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      {hasDrawn && <button className="nda-clear-sig" onClick={clear}>Clear</button>}
    </div>
  )
}

/* ─── App ──────────────────────────────────────────────────────── */
export default function App() {
  const [slide, setSlide] = useState(0)
  const [dir, setDir] = useState(1)

  const [businessStage, setBusinessStage] = useState('')
  const [biggestChallenge, setBiggestChallenge] = useState('')
  const [services, setServices] = useState([])
  const [servicesOther, setServicesOther] = useState('')
  const [clientCount, setClientCount] = useState('')
  // npsScore removed per request
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userPhone, setUserPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessWebsite, setBusinessWebsite] = useState('')
  const [revenueRange, setRevenueRange] = useState('')
  const [location, setLocation] = useState('')
  const [adminHours, setAdminHours] = useState('')
  const [earlyAccess, setEarlyAccess] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Drop-off & completion tracking
  const sessionStartRef = useRef(Date.now())
  const lastSlideRef = useRef(0)
  const completedRef = useRef(false)

  // Voice transcript state (speech-to-text, no audio upload)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceRecording, setVoiceRecording] = useState(false)
  const voiceRecognitionRef = useRef(null)

  // NDA state
  const [ndaName, setNdaName] = useState('')
  const [ndaSignature, setNdaSignature] = useState('')
  const [ndaAgreed, setNdaAgreed] = useState(false)
  const [ndaTimestamp, setNdaTimestamp] = useState('')

  const [dreamText, setDreamText] = useState('')
  const [selectedChips, setSelectedChips] = useState([])
  const [customFeatures, setCustomFeatures] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [extraChips, setExtraChips] = useState([])
  const [blindPrice, setBlindPrice] = useState('')
  const [feedbackMode, setFeedbackMode] = useState('like')
  const [pinMode, setPinMode] = useState(false)
  const [showRatingPrompt, setShowRatingPrompt] = useState(false)
  const [ratingStep, setRatingStep] = useState(0)
  const [showFeedbackBank, setShowFeedbackBank] = useState(false)
  const [favorites, setFavorites] = useState([])
  const [hoursSaved, setHoursSaved] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [smartPrice, setSmartPrice] = useState('')
  const [smartPriceTouched, setSmartPriceTouched] = useState(false)
  const [addedFeatures, setAddedFeatures] = useState('')
  const [finalPrice, setFinalPrice] = useState('')

  // Walkthrough: 'intro1' → 'walkthrough' (view-only tour) → 'review' (explore+rate per page) → 'explore' (free)
  const [walkthroughPhase, setWalkthroughPhase] = useState('intro1')
  const [walkthroughStep, setWalkthroughStep] = useState(0)
  const [reviewStep, setReviewStep] = useState(0)

  // Per-page ratings (1-5 dial) + optional notes
  const [pageRatings, setPageRatings] = useState({})
  const [pageNotes, setPageNotes] = useState({})

  // Engagement tracking
  const [pageTimestamps, setPageTimestamps] = useState({})
  const [engagementData, setEngagementData] = useState({})
  const stepStartRef = useRef(null)

  // Legacy pin state (kept minimal for PrototypeMockup compatibility)
  const [pins, setPins] = useState([])
  const [showBank, setShowBank] = useState(false)
  const [undoStack, setUndoStack] = useState([])

  const allSelectedFeatures = [...selectedChips, ...customFeatures, ...extraChips]

  const go = useCallback((target) => { setDir(target > slide ? 1 : -1); setSlide(target); lastSlideRef.current = Math.max(lastSlideRef.current, target); playSwoosh(); document.getElementById('root')?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }) }, [slide])
  const next = useCallback(() => { if (slide < TOTAL_SLIDES - 1) go(slide + 1) }, [slide, go])
  const prev = useCallback(() => { if (slide > 0) go(slide - 1) }, [slide, go])

  // Drop-off beacon — fires when user closes tab without submitting
  useEffect(() => {
    const handleUnload = () => {
      if (completedRef.current) return // already submitted, no drop-off
      const payload = JSON.stringify({
        drop_off_slide: lastSlideRef.current,
        drop_off_time: Math.round((Date.now() - sessionStartRef.current) / 1000),
        completed: false,
        user_name: userName || null,
        user_phone: userPhone || null,
      })
      fetch('https://raedfefzjudzlodtcxop.supabase.co/rest/v1/survey_dropoffs', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZWRmZWZ6anVkemxvZHRjeG9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMjM5MDQsImV4cCI6MjA4OTg5OTkwNH0.hZ_C-57ddIALKGkPThyEyayZAS1i2Sg_zBvnYCm1xuc',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZWRmZWZ6anVkemxvZHRjeG9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMjM5MDQsImV4cCI6MjA4OTg5OTkwNH0.hZ_C-57ddIALKGkPThyEyayZAS1i2Sg_zBvnYCm1xuc',
        },
        body: payload,
      })
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [userName, userPhone])

  const toggleChip = (label, isExtra) => {
    if (isExtra) {
      setExtraChips(prev => prev.includes(label) ? prev.filter(c => c !== label) : [...prev, label])
    } else {
      // Core chips: add to selected (shown as bubble), or remove if already there
      setSelectedChips(prev => prev.includes(label) ? prev.filter(c => c !== label) : [...prev, label])
    }
    playClick()
  }

  // Voice-to-text helpers (speech recognition → editable transcript)
  const startVoiceRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return }
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    let finalTranscript = voiceTranscript
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + e.results[i][0].transcript
        } else {
          interim += e.results[i][0].transcript
        }
      }
      setVoiceTranscript(finalTranscript + (interim ? ' ' + interim : ''))
    }
    r.onerror = () => setVoiceRecording(false)
    r.onend = () => setVoiceRecording(false)
    voiceRecognitionRef.current = r
    r.start()
    setVoiceRecording(true)
  }

  const stopVoiceRecording = () => {
    voiceRecognitionRef.current?.stop()
    setVoiceRecording(false)
  }

  const deleteVoiceRecording = () => {
    setVoiceTranscript('')
  }

  const addCustomFeature = (text) => {
    const trimmed = text.trim().replace(/,+$/, '').trim()
    if (!trimmed) return
    if (selectedChips.includes(trimmed) || customFeatures.includes(trimmed)) return
    setCustomFeatures(prev => [...prev, trimmed])
    setDreamText('')
    playClick()
  }

  const removeFeature = (label) => {
    setSelectedChips(prev => prev.filter(c => c !== label))
    setCustomFeatures(prev => prev.filter(c => c !== label))
    setExtraChips(prev => prev.filter(c => c !== label))
    playClick()
  }

  const handleDreamKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addCustomFeature(dreamText)
    }
  }

  const calcSuggested = () => { const h = parseFloat(hoursSaved) || 0; const r = parseFloat(hourlyRate) || 0; return Math.round(h * r * 4.33) }

  useEffect(() => { if (slide === 7 && !smartPriceTouched && calcSuggested() > 0) setSmartPrice(String(calcSuggested())) }, [slide])

  // #11 — Reset smartPriceTouched when inputs change so suggested price updates on revisit
  useEffect(() => { setSmartPriceTouched(false) }, [hoursSaved, hourlyRate])

  // No auto-timer — user clicks "Show me" to start walkthrough

  // Track time spent on each walkthrough page
  useEffect(() => {
    if (walkthroughPhase === 'walkthrough') {
      stepStartRef.current = Date.now()
    }
  }, [walkthroughStep, walkthroughPhase])

  const recordTimeSpent = () => {
    if (stepStartRef.current) {
      const page = WALKTHROUGH_STEPS[walkthroughStep]?.page
      const elapsed = Math.round((Date.now() - stepStartRef.current) / 1000)
      setPageTimestamps(prev => ({ ...prev, [page]: (prev[page] || 0) + elapsed }))
      stepStartRef.current = Date.now()
    }
  }

  const setRating = (page, value) => {
    setPageRatings(prev => ({ ...prev, [page]: value }))
    playClick()
  }

  const setNote = (page, text) => {
    setPageNotes(prev => ({ ...prev, [page]: text }))
  }

  // Phase 1: Walkthrough (view-only tour)
  const handleWalkthroughNext = () => {
    recordTimeSpent()
    if (walkthroughStep < WALKTHROUGH_STEPS.length - 1) {
      setWalkthroughStep(s => s + 1); playSwoosh()
    } else {
      // Tour done → enter review phase (explore + rate per page)
      setWalkthroughPhase('review'); setReviewStep(0); playDing()
    }
    document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Phase 2: Review — detect when user navigates away from current page in iframe
  const reviewPageRef = useRef('home')
  const pendingNavRef = useRef(null)

  const handleProtoNavigate = useCallback((newPage) => {
    if (walkthroughPhase !== 'review') return
    if (showRatingPrompt) return // already showing modal
    const currentPage = reviewPageRef.current
    if (newPage !== currentPage && currentPage) {
      // They navigated away — show rating for the page they just left
      pendingNavRef.current = newPage
      setShowRatingPrompt(true)
      playDing()
    }
  }, [walkthroughPhase, showRatingPrompt])

  // Track which pages have been visited
  const [visitedPages, setVisitedPages] = useState(new Set(['home']))

  const submitRatingAndAdvance = () => {
    const page = reviewPageRef.current
    if (!pageRatings[page]) return
    playClick()
    recordTimeSpent()
    setShowRatingPrompt(false)

    // Mark as visited
    const newVisited = new Set(visitedPages)
    newVisited.add(page)
    if (pendingNavRef.current) newVisited.add(pendingNavRef.current)
    setVisitedPages(newVisited)

    // Update current review page to where they navigated
    if (pendingNavRef.current) {
      reviewPageRef.current = pendingNavRef.current
      pendingNavRef.current = null
    }

    // Check if all pages are rated
    const allRated = WALKTHROUGH_STEPS.every(s => pageRatings[s.page])
    if (allRated) {
      setWalkthroughPhase('explore'); playDing()
      document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // Pin management (lifted up)
  const addPin = (pin) => { setPins(prev => [...prev, pin]); setUndoStack(prev => [...prev, { action: 'add', pin }]) }
  const updatePin = (updated) => setPins(prev => prev.map(p => p.id === updated.id ? updated : p))
  const deletePin = (id) => {
    const pin = pins.find(p => p.id === id)
    setPins(prev => prev.filter(p => p.id !== id))
    if (pin) setUndoStack(prev => [...prev, { action: 'delete', pin }])
  }
  const undo = () => {
    if (undoStack.length === 0) return
    const last = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    if (last.action === 'add') setPins(prev => prev.filter(p => p.id !== last.pin.id))
    if (last.action === 'delete') setPins(prev => [...prev, last.pin])
    playClick()
  }

  const progress = ((slide) / (TOTAL_SLIDES - 1)) * 100
  const handleDreamNext = () => { setShowModal(true); playDing() }
  const handleModalDone = () => { setShowModal(false); next() }
  const handleSubmit = async () => {
    playComplete()
    setSubmitError('')
    completedRef.current = true
    const sessionDuration = Math.round((Date.now() - sessionStartRef.current) / 1000)

    // Voice transcript (no audio upload needed)

    // Submit to Supabase
    try {
      const { error } = await supabase.from('survey_responses').insert({
        // NDA
        nda_name: ndaName,
        nda_signature: ndaSignature,
        nda_agreed: ndaAgreed,
        nda_timestamp: ndaTimestamp,
        // Contact info
        user_name: userName,
        user_email: userEmail,
        user_phone: userPhone || null,
        business_name: businessName || null,
        business_website: businessWebsite || null,
        // Demographics
        business_stage: businessStage,
        biggest_challenge: biggestChallenge,
        services: services,
        services_other: servicesOther || null,
        client_count: clientCount,
        revenue_range: revenueRange || null,
        location: location || null,
        admin_hours: adminHours ? parseInt(adminHours) : null,
        // Features (#7 — removed dream_features_text since dreamText is always cleared)
        selected_chips: [...selectedChips, ...extraChips, ...customFeatures],
        custom_features: customFeatures,
        // Walkthrough
        page_ratings: pageRatings,
        page_notes: pageNotes,
        pins: pins,
        favorites: favorites,
        // Engagement
        page_timestamps: pageTimestamps,
        engagement_data: engagementData,
        // Pricing (#10 — clamp negatives)
        hours_saved: hoursSaved ? Math.max(0, parseInt(hoursSaved)) : null,
        hourly_rate: hourlyRate ? Math.max(0, parseInt(hourlyRate)) : null,
        blind_price: blindPrice ? Math.max(0, parseInt(blindPrice)) : null,
        smart_price: smartPrice ? Math.max(0, parseInt(smartPrice)) : null,
        final_price: finalPrice ? Math.max(0, parseInt(finalPrice)) : null,
        added_features: addedFeatures,
        // PMF signals (#5 — removed sean_ellis, nps_score)
        early_access: earlyAccess,
        // Completion & drop-off tracking
        completed: true,
        session_duration: sessionDuration,
        drop_off_slide: null,
        drop_off_time: null,
        // Voice transcript
        voice_transcript: voiceTranscript || null,
      })
      // #9 — Check for insert errors
      if (error) {
        console.error('Survey submit error:', error)
        setSubmitError('Something went wrong submitting your response. Please try again.')
        completedRef.current = false
        return
      }
    } catch (e) {
      console.error('Survey submit error:', e)
      setSubmitError('Something went wrong submitting your response. Please try again.')
      completedRef.current = false
      return
    }
    next()
  }

  const headlines = {
    0: "Let's do a quick thought exercise.",
    1: '', // NDA slide handles its own header
    2: 'First, tell us a little about you.',
    3: 'If you could dream up an all-in-one command center for your business...',
    4: 'If you could pay monthly for that magical command center...',
    5: '', // walkthrough handles its own text
    6: 'What were your favorite parts?',
    7: 'How much would you pay monthly for FullControl?',
    8: 'What would you add to FullControl?',
    9: 'If all of that were included...',
    10: 'One last thing.',
  }
  const [typedHeadline, headlineDone] = useTypewriter(headlines[slide] || '', 25, 200)
  const cursor = <span style={{ opacity: headlineDone ? 0 : 0.4 }}>|</span>

  return (
    <>
      <div className="ambient-glow" />
      <div className="progress-bar" style={{ width: `${progress}%` }} />
      {slide > 1 && slide < TOTAL_SLIDES - 1 && <div className="step-indicator">{slide - 1} / {TOTAL_SLIDES - 2}</div>}

      <AnimatePresence mode="wait">
        <motion.div key={slide} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className={`slide-container ${slide === 5 ? 'wide' : ''}`}>

          {/* ──── SLIDE 0 — Welcome ──── */}
          {slide === 0 && (
            <motion.div style={{ textAlign: 'center' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><div className="brand brand-pulse" style={{ fontSize: 15, marginBottom: 36, textTransform: 'uppercase' }}>FullControl</div></motion.div>
              <motion.div variants={fadeSlideUp}>
                <h1 style={{ fontSize: 'clamp(30px, 5.5vw, 48px)', marginBottom: 16, minHeight: '2.4em' }}>
                  {typedHeadline.split('thought exercise').map((part, i, arr) =>
                    i < arr.length - 1 ? <span key={i}>{part}<span style={{ color: 'var(--gold)' }}>thought exercise</span></span> : <span key={i}>{part}</span>
                  )}{cursor}
                </h1>
              </motion.div>
              <motion.div variants={fadeSlideUp}><p className="subtitle" style={{ fontSize: 17, maxWidth: 480 }}>This takes 10 minutes and could help your business immensely, so give it some thought.</p></motion.div>
              <motion.div variants={fadeSlideUp}><button className="btn btn-primary" onClick={next} style={{ padding: '18px 48px', fontSize: 17, borderRadius: 16 }}>Let's go <span style={{ fontSize: 20 }}>&#8594;</span></button></motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 1 — NDA ──── */}
          {slide === 1 && (
            <motion.div className="nda-slide" variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp} className="nda-header-text">
                <div className="nda-pre-title">BAM Academy</div>
                <h2>Non-Disclosure Agreement</h2>
                <p className="subtitle" style={{ maxWidth: 520 }}>Before you see the product, please read and sign below.</p>
                <div className="nda-conf">Confidential &mdash; Please read before proceeding</div>
              </motion.div>

              <motion.div variants={fadeSlideUp} className="nda-scroll-container">
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 20 }}>
                  Thank you for participating in this review. Before you begin, you must read and agree to this Non-Disclosure Agreement (&ldquo;Agreement&rdquo;). By continuing, you confirm that you have read, understood, and agree to be legally bound by the terms below.
                </div>

                {/* Section 1 */}
                <div className="nda-section">
                  <div className="nda-section-title">1. Parties</div>
                  <div className="nda-section-text">
                    This Agreement is entered into between:<br/>
                    <strong>Disclosing Party:</strong> By Any Means Business, LLC (&ldquo;Company&rdquo;)<br/>
                    <strong>Receiving Party:</strong> You, the reviewer / survey participant (&ldquo;Recipient&rdquo;)
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">This is between BAM Academy&apos;s company and you.</div></div>
                  </div>
                </div>

                {/* Section 2 */}
                <div className="nda-section">
                  <div className="nda-section-title">2. What is Confidential</div>
                  <div className="nda-section-text">
                    You are being given access to non-public information including, but not limited to:
                    <ul>
                      <li>Product designs, prototypes, wireframes, and user interfaces</li>
                      <li>Business concepts, strategies, and operational workflows</li>
                      <li>Pricing models, feature sets, and product roadmaps</li>
                      <li>Survey questions, internal processes, and any materials shared during this session</li>
                    </ul>
                    All of the above &mdash; in any format (visual, written, verbal, or digital) &mdash; is considered Confidential Information under this Agreement.
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">Everything you see today &mdash; the product, the designs, the strategy &mdash; is private.</div></div>
                  </div>
                </div>

                {/* Section 3 */}
                <div className="nda-section">
                  <div className="nda-section-title">3. Your Obligations</div>
                  <div className="nda-section-text">
                    By proceeding, you agree to:
                    <ul>
                      <li>Keep all Confidential Information strictly private</li>
                      <li>Not share, discuss, post, publish, or disclose any details with any third party &mdash; including friends, family, competitors, or on social media</li>
                      <li>Not use any information you see for personal or competitive advantage</li>
                      <li>Not take screenshots, photos, recordings, or copies of any materials unless explicitly authorized</li>
                    </ul>
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">Don&apos;t share, screenshot, or talk about what you see. With anyone.</div></div>
                  </div>
                </div>

                {/* Section 4 */}
                <div className="nda-section">
                  <div className="nda-section-title">4. Exceptions</div>
                  <div className="nda-section-text">
                    These obligations do not apply to information that:
                    <ul>
                      <li>Is or becomes publicly available through no fault of yours</li>
                      <li>You can prove you already knew before this session</li>
                      <li>Is required to be disclosed by law (you must notify us promptly if this occurs)</li>
                    </ul>
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">If it&apos;s already public or you knew it before, you&apos;re fine.</div></div>
                  </div>
                </div>

                {/* Section 5 */}
                <div className="nda-section">
                  <div className="nda-section-title">5. Duration</div>
                  <div className="nda-section-text">
                    This Agreement remains in effect for three (3) years from the date you sign below, or until BAM Academy publicly releases the product &mdash; whichever comes first.
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">This lasts 3 years, or until we publicly launch &mdash; whichever is sooner.</div></div>
                  </div>
                </div>

                {/* Section 6 */}
                <div className="nda-section">
                  <div className="nda-section-title">6. Consequences of Breach</div>
                  <div className="nda-section-text">
                    You acknowledge that unauthorized disclosure could cause serious and irreparable harm to BAM Academy. In the event of a breach, BAM Academy reserves the right to seek all available legal remedies, including injunctive relief and monetary damages.
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">If you break this, we can take legal action.</div></div>
                  </div>
                </div>

                {/* Section 7 */}
                <div className="nda-section">
                  <div className="nda-section-title">7. General</div>
                  <div className="nda-section-text">
                    <ul>
                      <li>This Agreement constitutes the entire agreement between the parties regarding confidentiality.</li>
                      <li>If any provision is found unenforceable, the remaining provisions remain in full effect.</li>
                      <li>This Agreement is governed by the laws of the State of Florida, without regard to its conflict of law provisions.</li>
                    </ul>
                  </div>
                  <div className="nda-callout">
                    <div className="nda-callout-icon">&#128161;</div>
                    <div><div className="nda-callout-label">TL;DR</div><div className="nda-callout-text">Florida law governs this. Standard legal stuff.</div></div>
                  </div>
                </div>
              </motion.div>

              {/* Signature area */}
              <motion.div variants={fadeSlideUp} className="nda-sign-area">
                <div className="nda-sign-row">
                  <div className="nda-sign-field">
                    <label>Full Name *</label>
                    <input type="text" placeholder="Your full legal name" value={ndaName} onChange={e => setNdaName(e.target.value)} />
                  </div>
                  <div className="nda-sign-field">
                    <label>Date</label>
                    <div className="date-display">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  </div>
                </div>

                <SignatureCanvas onSignatureChange={(data) => setNdaSignature(data)} />

                <div className="nda-checkbox-row" onClick={() => { setNdaAgreed(!ndaAgreed); playClick() }}>
                  <div className={`nda-checkbox ${ndaAgreed ? 'checked' : ''}`}>
                    {ndaAgreed && <span style={{ color: '#0E0D0B', fontSize: 14, fontWeight: 700 }}>&#10003;</span>}
                  </div>
                  <span className="nda-checkbox-label">I have read and agree to this Non-Disclosure Agreement</span>
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={prev}>Back</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setNdaTimestamp(new Date().toISOString())
                      next()
                    }}
                    style={{ opacity: (ndaName.trim() && ndaSignature && ndaAgreed) ? 1 : 0.4, pointerEvents: (ndaName.trim() && ndaSignature && ndaAgreed) ? 'auto' : 'none' }}
                  >
                    Continue <span style={{ fontSize: 18 }}>&#8594;</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 2 — Contact Info + About You ──── */}
          {/* // TODO: Consider splitting this slide */}
          {slide === 2 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2 style={{ minHeight: '1.4em' }}>{typedHeadline}{cursor}</h2><p className="subtitle">This helps us understand what matters most to you.</p></motion.div>

              {/* Contact info */}
              <motion.div variants={fadeSlideUp} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380, margin: '0 auto 20px' }}>
                <input type="text" placeholder="Your name *" value={userName} onChange={e => setUserName(e.target.value)} style={{ textAlign: 'center' }} />
                <input type="tel" inputMode="tel" pattern="[0-9+\-\s]{7,}" placeholder="Phone number *" value={userPhone} onChange={e => setUserPhone(e.target.value)} style={{ textAlign: 'center' }} />
                <input type="url" placeholder="Business website (optional)" value={businessWebsite} onChange={e => setBusinessWebsite(e.target.value)} style={{ textAlign: 'center' }} />
              </motion.div>

              {/* Business stage */}
              <motion.div variants={fadeSlideUp}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>How long have you been running your business?</p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 520, margin: '0 auto' }}>
                  {BUSINESS_STAGES.map(s => (
                    <div key={s.key} className={`option-card ${businessStage === s.key ? 'selected' : ''}`}
                      onClick={() => { setBusinessStage(s.key); playClick() }}
                      style={{ flex: '1 1 140px', maxWidth: 165, padding: '14px 12px', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 }}>{s.icon} {s.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.desc}</div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Services offered (multi-select) */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>What services do you offer? (select all that apply)</p>
                <div className="chips-wrap">
                  {SERVICES_OPTIONS.map(s => (
                    <span key={s.key} className={`chip ${services.includes(s.key) ? 'selected' : ''}`}
                      onClick={() => { setServices(prev => prev.includes(s.key) ? prev.filter(x => x !== s.key) : [...prev, s.key]); playClick() }}>{s.label}</span>
                  ))}
                </div>
                {services.includes('other') && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ marginTop: 8 }}>
                    <input type="text" placeholder="Merchandise, consultation, etc." value={servicesOther} onChange={e => setServicesOther(e.target.value)}
                      style={{ maxWidth: 320, margin: '0 auto', display: 'block', textAlign: 'center' }} />
                  </motion.div>
                )}
              </motion.div>

              {/* Client count */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>How many active clients do you have?</p>
                <div className="chips-wrap">
                  {CLIENT_COUNT_OPTIONS.map(c => (
                    <span key={c} className={`chip ${clientCount === c ? 'selected' : ''}`}
                      onClick={() => { setClientCount(c); playClick() }}>{c}</span>
                  ))}
                </div>
              </motion.div>

              {/* Revenue range */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>What's your approximate monthly revenue?</p>
                <div className="chips-wrap">
                  {REVENUE_OPTIONS.map(r => (
                    <span key={r} className={`chip ${revenueRange === r ? 'selected' : ''}`}
                      onClick={() => { setRevenueRange(r); playClick() }}>{r}</span>
                  ))}
                </div>
              </motion.div>

              {/* Location */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Where are you located?</p>
                <input type="text" placeholder="e.g. Toronto, ON, Canada" value={location} onChange={e => setLocation(e.target.value)}
                  style={{ maxWidth: 320, margin: '0 auto', display: 'block', textAlign: 'center' }} />
              </motion.div>

              {/* Hours on admin */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>How many hours per week do you spend on non-coaching tasks?</p>
                <input type="number" placeholder="e.g. 15" value={adminHours} onChange={e => setAdminHours(e.target.value)} min="0"
                  style={{ maxWidth: 160, margin: '0 auto', display: 'block', textAlign: 'center' }} />
              </motion.div>

              {/* Biggest challenge */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 22 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>What's your biggest challenge right now?</p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 520, margin: '0 auto' }}>
                  {CHALLENGE_OPTIONS.map(c => (
                    <div key={c.key} className={`option-card ${biggestChallenge === c.key ? 'selected' : ''}`}
                      onClick={() => { setBiggestChallenge(c.key); playClick() }}
                      style={{ flex: '1 1 140px', maxWidth: 165, padding: '14px 12px', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 }}>{c.icon} {c.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.desc}</div>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={fadeSlideUp} style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={next} style={{ opacity: (userName && userPhone && businessStage && biggestChallenge && services.length > 0 && clientCount) ? 1 : 0.4, pointerEvents: (userName && userPhone && businessStage && biggestChallenge && services.length > 0 && clientCount) ? 'auto' : 'none' }}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 3 — Dream Features ──── */}
          {slide === 3 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2 style={{ minHeight: '1.4em' }}>{typedHeadline}{cursor}</h2><p className="subtitle">It could do <em>anything</em>. Which features would you include?</p></motion.div>
              <motion.div variants={fadeSlideUp}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tap the ones you'd want</p>
                <div className="chips-wrap">
                  {CORE_SUGGESTIONS.filter(s => !selectedChips.includes(s)).map(s => (<span key={s} className="chip" onClick={() => toggleChip(s, false)}>{s}</span>))}
                </div>
              </motion.div>
              <motion.div variants={fadeSlideUp}>
                <BubbleInput
                  bubbles={[...selectedChips, ...customFeatures]}
                  onRemove={removeFeature}
                  inputValue={dreamText}
                  onInputChange={setDreamText}
                  onKeyDown={handleDreamKeyDown}
                  placeholder={selectedChips.length > 0 || customFeatures.length > 0 ? "Type another and hit enter or comma..." : "Add anything else you'd want this tool to do..."}
                />
              </motion.div>
              <motion.div variants={fadeSlideUp} style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={handleDreamNext}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 4 — Blind Price ──── */}
          {slide === 4 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2 style={{ minHeight: '1.4em' }}>{typedHeadline}{cursor}</h2><p className="subtitle">No strings attached. Just a number that feels right for everything you described.</p></motion.div>
              <motion.div variants={fadeSlideUp} style={{ display: 'flex', justifyContent: 'center' }}><div className="price-input-wrap"><span className="dollar">$</span><input type="number" className="price-input" placeholder="0" value={blindPrice} onChange={e => setBlindPrice(e.target.value)} min="0" /></div></motion.div>
              <motion.div variants={fadeSlideUp}><p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>per month</p></motion.div>
              <motion.div variants={fadeSlideUp} style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={next} style={{ opacity: blindPrice > 0 ? 1 : 0.4, pointerEvents: blindPrice > 0 ? 'auto' : 'none' }}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 5 — Prototype (intro → walkthrough → explore) ──── */}
          {slide === 5 && (
            <motion.div style={{ width: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>

              {/* Intro — single screen */}
              {walkthroughPhase === 'intro1' && (
                <motion.div style={{ textAlign: 'center', padding: '60px 0' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}>
                  <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', lineHeight: 1.15, marginBottom: 16 }}>
                    That's what we've built to be<br /><span style={{ color: 'var(--gold)' }}>this command center.</span>
                  </h1>
                  <p className="subtitle" style={{ fontSize: 15, maxWidth: 500, marginBottom: 8 }}>Our mission is to help operators in sports and fitness use AI in the best, most effortless way possible, so you can shift your focus to making a real impact while your business works in the background.</p>
                  <p className="subtitle" style={{ fontSize: 15, maxWidth: 460 }}>See what we've built, and leave some feedback.</p>
                  <button className="btn btn-primary" onClick={() => { setWalkthroughPhase('walkthrough'); setWalkthroughStep(0); playSwoosh(); document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{ marginTop: 8 }}>
                    Show me <span style={{ fontSize: 18 }}>&#8594;</span>
                  </button>
                </motion.div>
              )}

              {/* Walkthrough */}
              {/* Phase 1: Walkthrough (guided tour, view-only) */}
              {walkthroughPhase === 'walkthrough' && (
                <>
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <AnimatePresence mode="wait">
                      <motion.div key={walkthroughStep} style={{ marginBottom: 10 }}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                        <div style={{ display: 'inline-block', background: 'rgba(200,168,78,0.12)', border: '1px solid rgba(200,168,78,0.25)', borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                          {WALKTHROUGH_STEPS[walkthroughStep]?.page}
                        </div>
                        <p className="subtitle" style={{ fontSize: 15, maxWidth: 520, marginBottom: 8 }}>
                          {WALKTHROUGH_STEPS[walkthroughStep]?.text}
                        </p>
                        {WALKTHROUGH_STEPS[walkthroughStep]?.example && (
                          <div style={{
                            display: 'inline-block', background: 'var(--surface-2)', border: '1px solid var(--border)',
                            borderRadius: 12, padding: '8px 16px', fontSize: 13, color: 'var(--text-2)',
                            fontStyle: 'italic', maxWidth: 500, lineHeight: 1.5, margin: '0 auto',
                          }}>
                            {WALKTHROUGH_STEPS[walkthroughStep].example}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, fontWeight: 600 }}>
                          All of this works by talking to <span style={{ color: 'var(--gold)' }}>Sage</span> from the Home page.
                        </div>
                      </motion.div>
                    </AnimatePresence>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{walkthroughStep + 1} / {WALKTHROUGH_STEPS.length}</span>
                      <button className="btn btn-primary" onClick={handleWalkthroughNext} style={{ padding: '10px 28px', fontSize: 14 }}>
                        Next →
                      </button>
                    </div>
                  </div>
                  <div className="walkthrough-proto-wrap">
                    <PrototypeIframe page={WALKTHROUGH_STEPS[walkthroughStep]?.page} />
                    <div className="walkthrough-dim-overlay" />
                    <div className="walkthrough-page-label">
                      {WALKTHROUGH_STEPS[walkthroughStep]?.page}
                    </div>
                    <div className="walkthrough-nav-pointer" style={{ top: [155, 200, 245, 290, 335, 380][walkthroughStep] || 155 }}>
                      <div className="walkthrough-nav-arrow" />
                    </div>
                  </div>
                </>
              )}

              {/* Phase 2: Review (pill tracker + click to rate) */}
              {walkthroughPhase === 'review' && (
                <>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', marginBottom: 12 }}>
                    <h2 style={{ fontSize: 'clamp(18px, 3vw, 24px)', marginBottom: 4 }}>Explore and rate each section.</h2>
                    <p className="subtitle" style={{ fontSize: 13, marginBottom: 10 }}>
                      Tap a section below to explore it, then rate it. Complete all 6 to continue.
                    </p>
                    {/* Pill tracker */}
                    <div className="review-pills">
                      {WALKTHROUGH_STEPS.map((step, i) => {
                        const rated = !!pageRatings[step.page]
                        const active = reviewPageRef.current === step.page && !showRatingPrompt
                        return (
                          <button key={step.page}
                            className={`review-pill ${rated ? 'rated' : ''} ${active ? 'active' : ''}`}
                            onClick={() => { reviewPageRef.current = step.page; setReviewStep(i); setShowRatingPrompt(false); document.getElementById('review-iframe')?.setAttribute('src', PROTO_URL + '/#/' + step.page) }}
                          >
                            {rated && <span className="review-pill-check">&#10003;</span>}
                            <span style={{ textTransform: 'capitalize' }}>{step.page}</span>
                          </button>
                        )
                      })}
                    </div>
                  </motion.div>

                  <div style={{ borderRadius: 20, padding: 2, background: 'linear-gradient(135deg, rgba(200,168,78,0.25), transparent 40%, transparent 60%, rgba(200,168,78,0.15))', boxShadow: '0 0 60px rgba(200,168,78,0.08)', position: 'relative' }}>
                    <iframe id="review-iframe" src={PROTO_URL + '/#/home'} style={{ width: '100%', height: 560, border: 'none', borderRadius: 16, display: 'block' }} allow="autoplay" />
                  </div>

                  {/* Rate button below prototype */}
                  {!showRatingPrompt && (
                    <div style={{ textAlign: 'center', marginTop: 16 }}>
                      <button className="btn btn-primary" onClick={() => { setShowRatingPrompt(true); playDing() }} style={{ padding: '12px 32px', fontSize: 14 }}>
                        Rate {reviewPageRef.current}
                      </button>
                    </div>
                  )}

                  {/* Continue button (only when all rated) */}
                  {WALKTHROUGH_STEPS.every(s => pageRatings[s.page]) && !showRatingPrompt && (
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <button className="btn btn-primary" onClick={() => { setWalkthroughPhase('explore'); playComplete(); next() }} style={{ padding: '14px 40px', fontSize: 15 }}>
                        All rated, continue &#8594;
                      </button>
                    </div>
                  )}

                  {/* Rating modal */}
                  <AnimatePresence>
                    {showRatingPrompt && (
                      <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                        <motion.div className="modal" initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                          <h2 style={{ marginBottom: 4 }}>Rate this section</h2>
                          <RatingDial
                            value={pageRatings[reviewPageRef.current] || 0}
                            onChange={v => setRating(reviewPageRef.current, v)}
                            page={reviewPageRef.current}
                          />
                          <PageNoteInput
                            value={pageNotes[reviewPageRef.current]}
                            onChange={v => setNote(reviewPageRef.current, v)}
                          />
                          <button
                            className="btn btn-primary"
                            onClick={() => { if (!pageRatings[reviewPageRef.current]) return; setShowRatingPrompt(false); playClick(); recordTimeSpent() }}
                            style={{ marginTop: 16, padding: '12px 32px', fontSize: 14, opacity: pageRatings[reviewPageRef.current] ? 1 : 0.4 }}
                          >
                            Done
                          </button>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {/* Explore mode */}
              {walkthroughPhase === 'explore' && (
                <>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', marginBottom: 12 }}>
                    <h2 style={{ fontSize: 'clamp(18px, 3vw, 24px)', marginBottom: 4 }}>Take a closer look.</h2>
                    <p className="subtitle" style={{ fontSize: 13, marginBottom: 8 }}>Click around freely. Your ratings are saved in the bubble below.</p>
                  </motion.div>
                  <div style={{ borderRadius: 20, padding: 2, background: 'linear-gradient(135deg, rgba(200,168,78,0.25), transparent 40%, transparent 60%, rgba(200,168,78,0.15))', boxShadow: '0 0 60px rgba(200,168,78,0.08)' }}>
                    <PrototypeIframe />
                  </div>
                  <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button className="btn btn-ghost" onClick={prev}>Back</button>
                    <button className="btn btn-primary" onClick={next}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
                  </div>
                  {/* Feedback bank bubble */}
                  {Object.keys(pageRatings).length > 0 && (
                    <button className="feedback-bubble" onClick={() => setShowFeedbackBank(!showFeedbackBank)}>
                      <span className="feedback-bubble-count">{Object.keys(pageRatings).length}</span>
                      <span className="feedback-bubble-label">rated</span>
                    </button>
                  )}
                  <AnimatePresence>
                    {showFeedbackBank && (
                      <motion.div className="feedback-bank" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                        <div className="feedback-bank-header">Your ratings (tap to edit)</div>
                        {WALKTHROUGH_STEPS.filter(s => pageRatings[s.page]).map(step => (
                          <div key={step.page} className="feedback-bank-item">
                            <span style={{ fontWeight: 600, color: 'var(--text-2)', textTransform: 'capitalize', fontSize: 13 }}>{step.page}</span>
                            <div className="rating-summary-dots" style={{ gap: 4 }}>
                              {[1,2,3,4,5].map(n => (
                                <button key={n} className={`rating-mini-dot ${(pageRatings[step.page] || 0) >= n ? 'active' : ''}`}
                                  onClick={() => setRating(step.page, n)} style={{ width: 26, height: 26, fontSize: 11 }}>{n}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </motion.div>
          )}

          {/* ──── SLIDE 6 — Favorites + Time/Rate ──── */}
          {slide === 6 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2>{typedHeadline}{cursor}</h2><p className="subtitle">Select all that stood out to you.</p></motion.div>
              <motion.div variants={fadeSlideUp}>
                <div className="option-grid">
                  {FAVORITE_SECTIONS.map(sec => (
                    <div key={sec.key} className={`option-card ${favorites.includes(sec.key) ? 'selected' : ''}`}
                      onClick={() => { setFavorites(prev => prev.includes(sec.key) ? prev.filter(f => f !== sec.key) : [...prev, sec.key]); playClick() }}>{sec.label}</div>
                  ))}
                </div>
              </motion.div>
              <motion.div variants={fadeSlideUp}>
                <h2 style={{ fontSize: 20, marginTop: 8 }}>A couple quick numbers...</h2>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 12 }}>
                  <div className="field-stack"><label className="field-label-full">How many hours would this save you per week?</label><input type="number" placeholder="e.g. 10" value={hoursSaved} onChange={e => setHoursSaved(e.target.value)} min="0" style={{ maxWidth: 200, textAlign: 'center' }} /></div>
                  <div className="field-stack"><label className="field-label-full">What is an hour worth to you? ($)</label><input type="number" placeholder="e.g. 75" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} min="0" style={{ maxWidth: 200, textAlign: 'center' }} /></div>
                </div>
              </motion.div>
              <motion.div variants={fadeSlideUp} style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={next}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 7 — Smart Price ──── */}
          {slide === 7 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2>{typedHeadline}{cursor}<Tooltip text="We pre-filled this based on your hourly rate and hours saved, but change it to whatever feels right." /></h2></motion.div>
              <motion.div variants={fadeSlideUp} style={{ display: 'flex', justifyContent: 'center' }}><div className="price-input-wrap"><span className="dollar">$</span><input type="number" className="price-input" placeholder="0" value={smartPrice} onChange={e => { setSmartPrice(e.target.value); setSmartPriceTouched(true) }} min="0" /></div></motion.div>
              {(parseFloat(hoursSaved) > 0 && parseFloat(hourlyRate) > 0) && (
                <motion.div variants={fadeSlideUp}><div className="calc-display"><div className="calc-formula">{hoursSaved} hrs/week &times; ${hourlyRate}/hr &times; 4.33 = <strong style={{ color: 'var(--gold)' }}>${calcSuggested().toLocaleString()}/mo</strong> in time saved</div></div></motion.div>
              )}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={next}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 8 — Feature Wishlist ──── */}
          {slide === 8 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2>{typedHeadline}{cursor}</h2><p className="subtitle">Dream big. If there's a feature that would make this a must-have, tell us.</p></motion.div>
              <motion.div variants={fadeSlideUp}><VoiceTextarea placeholder="I wish it could..." value={addedFeatures} onChange={setAddedFeatures} style={{ minHeight: 140 }} /></motion.div>
              <motion.div variants={fadeSlideUp} style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={next}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 9 — Final Price ──── */}
          {slide === 9 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2>{typedHeadline}{cursor}</h2><p className="subtitle">Everything you just saw, plus every feature you just asked for. One platform. How much would you pay monthly?</p></motion.div>
              <motion.div variants={fadeSlideUp} style={{ display: 'flex', justifyContent: 'center' }}><div className="price-input-wrap"><span className="dollar">$</span><input type="number" className="price-input" placeholder="0" value={finalPrice} onChange={e => setFinalPrice(e.target.value)} min="0" /></div></motion.div>
              <motion.div variants={fadeSlideUp}><p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>per month</p></motion.div>
              <motion.div variants={fadeSlideUp} style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={() => { playComplete(); next() }} style={{ opacity: finalPrice > 0 ? 1 : 0.4, pointerEvents: finalPrice > 0 ? 'auto' : 'none' }}>Next <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 10 — Final Thoughts + Early Access + Submit ──── */}
          {slide === 10 && (
            <motion.div style={{ textAlign: 'center', width: '100%' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><h2 style={{ minHeight: '1.4em' }}>{typedHeadline}{cursor}</h2><p className="subtitle">Anything else you want to share? Speak or type below. (optional)</p></motion.div>

              {/* Voice-to-text note */}
              <motion.div variants={fadeSlideUp} style={{ maxWidth: 500, margin: '16px auto 0' }}>
                <div style={{ position: 'relative' }}>
                  <textarea
                    placeholder="Tap the mic and speak, or just type here..."
                    value={voiceTranscript}
                    onChange={e => setVoiceTranscript(e.target.value)}
                    style={{ minHeight: 100, width: '100%', paddingRight: 50 }}
                  />
                  <button
                    className={`mic-btn ${voiceRecording ? 'recording' : ''}`}
                    onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording}
                    style={{ position: 'absolute', top: 12, right: 12 }}
                  >
                    <MicIcon />
                  </button>
                  {voiceRecording && (
                    <div style={{ position: 'absolute', bottom: 8, right: 12, fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>
                      Listening...
                    </div>
                  )}
                </div>
                {voiceTranscript && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    <button className="btn btn-ghost" onClick={deleteVoiceRecording} style={{ fontSize: 11, padding: '3px 8px' }}>Clear</button>
                  </div>
                )}
              </motion.div>

              {/* Early access opt-in — before submit */}
              <motion.div variants={fadeSlideUp} style={{ marginTop: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', fontSize: 15, color: 'var(--text-1)' }}
                  onClick={() => { setEarlyAccess(!earlyAccess); playClick() }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, border: earlyAccess ? '2px solid var(--gold)' : '2px solid var(--text-3)', background: earlyAccess ? 'var(--gold)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0 }}>
                    {earlyAccess && <span style={{ color: '#0E0D0B', fontSize: 16, fontWeight: 700 }}>&#10003;</span>}
                  </div>
                  I want early access to Full Control
                </label>
              </motion.div>

              {/* Show submit error */}
              {submitError && <div style={{ color: '#e74c3c', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{submitError}</div>}

              <motion.div variants={fadeSlideUp} style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={prev}>Back</button>
                <button className="btn btn-primary" onClick={handleSubmit}>Submit <span style={{ fontSize: 18 }}>&#10003;</span></button>
              </motion.div>
            </motion.div>
          )}

          {/* ──── SLIDE 11 — Thank You ──── */}
          {slide === 11 && (
            <motion.div style={{ textAlign: 'center' }} variants={stagger} initial="hidden" animate="show">
              <motion.div variants={fadeSlideUp}><div className="gold-ring" style={{ margin: '0 auto 28px' }}>&#10003;</div></motion.div>
              <motion.div variants={fadeSlideUp}><h1>Thank you{userName ? `, ${userName.split(' ')[0]}` : ''}.</h1></motion.div>
              <motion.div variants={fadeSlideUp}><p className="subtitle">Your input is shaping the future of FullControl. We'll keep you in the loop as we build exactly what you asked for.</p></motion.div>
              <motion.div variants={fadeSlideUp}><div className="brand brand-pulse" style={{ fontSize: 16, marginTop: 32, textTransform: 'uppercase' }}>FullControl</div></motion.div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ──── Modal ──── */}
      <AnimatePresence>
        {showModal && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <motion.div className="modal" initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
              <h2>Wait, are you sure there's <em>nothing</em> else?</h2>
              <p className="subtitle">Here are a few more ideas. Anything catch your eye?</p>
              <div className="chips-wrap">{EXTRA_SUGGESTIONS.map(s => (<span key={s} className={`chip ${extraChips.includes(s) ? 'selected' : ''}`} onClick={() => toggleChip(s, true)}>{s}</span>))}</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleModalDone}>I'm done, let's move on <span style={{ fontSize: 18 }}>&#8594;</span></button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
