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

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px'
    }
  }, [inputValue])

  const toggleRecording = () => {
    if (recording) { recognitionRef.current?.stop(); setRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; onInputChange(inputValue ? inputValue + ' ' + t : t) }
    r.onerror = () => setRecording(false); r.onend = () => setRecording(false)
    recognitionRef.current = r; r.start(); setRecording(true)
  }

  const handleTextareaKeyDown = (e) => {
    // Let enter/comma trigger the chip creation, prevent newline
    if (e.key === 'Enter') e.preventDefault()
    onKeyDown(e)
  }

  return (
    <div className="voice-textarea-wrap">
      <div className="bubble-input-box" onClick={() => inputRef.current?.focus()}>
        {bubbles.map(label => (
          <span key={label} className="bubble-tag" onClick={e => { e.stopPropagation(); onRemove(label) }}>{label} <span className="remove">&times;</span></span>
        ))}
        <textarea
          ref={inputRef}
          className="bubble-inline-input"
          placeholder={bubbles.length === 0 ? placeholder : (inputValue ? '' : 'Add more...')}
          value={inputValue}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          rows={1}
          style={{ resize: 'none', overflow: 'hidden' }}
        />
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, opacity: 0.7, textAlign: 'center' }}>Press <strong>Enter</strong> or <strong>comma</strong> to add each answer — one at a time</p>
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

/* ─── Voice Feedback (per-section mandatory voice note) ───────── */
function VoiceFeedback({ value, onChange, page }) {
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef(null)
  const [pulse, setPulse] = useState(false)

  const toggleRecording = () => {
    if (recording) { recognitionRef.current?.stop(); setRecording(false); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    let finalTranscript = value || ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + e.results[i][0].transcript
        } else {
          interim += e.results[i][0].transcript
        }
      }
      onChange(finalTranscript + (interim ? ' ' + interim : ''))
    }
    r.onerror = () => setRecording(false)
    r.onend = () => setRecording(false)
    recognitionRef.current = r; r.start(); setRecording(true)
  }

  // Pulse animation to draw attention to mic
  useEffect(() => {
    if (!value && !recording) {
      const t = setTimeout(() => setPulse(true), 800)
      return () => clearTimeout(t)
    }
    setPulse(false)
  }, [value, recording])

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ width: '100%', maxWidth: 460, margin: '0 auto' }}>
      <div style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
        What do you think about <strong style={{ color: 'var(--gold)' }}>{page}</strong>? Love it, hate it, confused by it — just say what comes to mind.
      </div>

      {/* Big mic button */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={toggleRecording}
          className={`voice-feedback-mic ${recording ? 'recording' : ''} ${pulse && !value ? 'pulse' : ''}`}
          style={{
            width: 80, height: 80, borderRadius: '50%',
            background: recording ? '#e74c3c' : value ? 'rgba(200,168,78,0.15)' : 'rgba(200,168,78,0.25)',
            border: recording ? '3px solid #e74c3c' : value ? '3px solid var(--gold)' : '3px solid rgba(200,168,78,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.3s ease',
            boxShadow: recording ? '0 0 30px rgba(231,76,60,0.4)' : pulse && !value ? '0 0 20px rgba(200,168,78,0.3)' : 'none',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke={recording ? '#fff' : 'var(--gold)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 32, height: 32 }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <div style={{ fontSize: 13, color: recording ? '#e74c3c' : 'var(--text-3)', fontWeight: 600 }}>
          {recording ? 'Listening... tap to stop' : value ? 'Tap to add more' : 'Tap to speak'}
        </div>
      </div>

      {/* Transcript display / edit */}
      {value && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Or type your feedback here..."
            style={{ width: '100%', minHeight: 80, fontSize: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 14px', color: 'var(--text-1)', resize: 'vertical', fontFamily: 'var(--font)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'var(--font)' }}>Clear</button>
          </div>
        </motion.div>
      )}

      {/* Type fallback if no voice */}
      {!value && !recording && (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>or </span>
          <textarea
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder="type your thoughts here..."
            style={{ width: '100%', minHeight: 60, fontSize: 13, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 12px', color: 'var(--text-1)', resize: 'vertical', fontFamily: 'var(--font)', marginTop: 6 }}
          />
        </div>
      )}
    </motion.div>
  )
}
      x: clientX - rect.left,
      y: clientY - rect.top,const fadeSlideUp = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } } }

/* ─── Signature Canvas ─────────────────────────────────────────── */
function SignatureCanvas({ onSignatureChange }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const lastPos = useRef(null)
  const initDone = useRef(false)

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return // not visible yet
    const dpr = window.devicePixelRatio || 2
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    initDone.current = true
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    if (!initDone.current) initCanvas()
    const pos = getPos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    const prev = lastPos.current
    // Quadratic curve to midpoint for smooth strokes
    const mid = { x: (prev.x + pos.x) / 2, y: (prev.y + pos.y) / 2 }
    ctx.strokeStyle = '#F0EDE6'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(mid.x, mid.y)
    lastPos.current = pos
    setHasDrawn(true)
  }

  const endDraw = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    lastPos.current = null
    const canvas = canvasRef.current
    const data = canvas.toDataURL('image/png')
    onSignatureChange(data)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const cdiff3: invalid print range
tx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
    lastPos.current = null
    onSignatureChange('')
  }

  useEffect(() => {
    // Delay init slightly so motion animation has finished and canvas is sized
    const t = setTimeout(initCanvas, 300)
    return () => clearTimeout(t)
  }, [initCanvas])

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
