import { useState, useRef, useEffect } from 'react'
import s from '../styles/SageFloat.module.css'

const SAGE_PROMPTS = [
  "How's my business doing today?",
  "Show me this week's schedule...",
  "Who should I follow up with?",
  "What's my revenue this month?",
  "Any members at risk of churning?",
  "Write a post about today's session...",
]

export default function SageFloat() {
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [placeholder, setPlaceholder] = useState(SAGE_PROMPTS[0])
  const inputRef = useRef(null)
  const idx = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      idx.current = (idx.current + 1) % SAGE_PROMPTS.length
      setPlaceholder(SAGE_PROMPTS[idx.current])
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSend = () => {
    if (!input.trim()) return
    setMessages(prev => [...prev, { role: 'user', text: input }])
    const q = input
    setInput('')
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'sage', text: `Got it. Let me look into "${q}" for you...` }])
    }, 800)
  }

  const handleMic = () => {
    setListening(true)
    setTimeout(() => {
      setListening(false)
      setInput(SAGE_PROMPTS[Math.floor(Math.random() * SAGE_PROMPTS.length)])
    }, 2000)
  }

  return (
    <>
      {/* Floating button */}
      <button className={`${s.fab} ${open ? s.fabOpen : ''}`} onClick={() => { setOpen(!open); if (!open) setTimeout(() => inputRef.current?.focus(), 200) }}
        aria-label="Talk to Sage">
        <div className={s.fabIcon}>S</div>
        {!open && <div className={s.fabPulse} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className={s.panel}>
          <div className={s.header}>
            <div className={s.headerIcon}>S</div>
            <div>
              <div className={s.headerName}>Sage</div>
              <div className={s.headerSub}>AI Command Center</div>
            </div>
            <button className={s.closeBtn} onClick={() => setOpen(false)} aria-label="Close Sage">&times;</button>
          </div>
          <div className={s.messages}>
            {messages.length === 0 && (
              <div className={s.empty}>
                <div className={s.emptyIcon}>S</div>
                <div className={s.emptyText}>Hey, what do you need? Just ask.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`${s.msg} ${m.role === 'sage' ? s.msgSage : s.msgUser}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div className={s.inputRow}>
            <button className={`${s.micBtn} ${listening ? s.micActive : ''}`} onClick={handleMic} aria-label="Voice input">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            </button>
            <input ref={inputRef} className={s.input} placeholder={placeholder} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend() }} />
            <button className={s.sendBtn} onClick={handleSend} aria-label="Send">&#8593;</button>
          </div>
        </div>
      )}

      {/* Floating mic shortcut (visible when panel closed) */}
      {!open && (
        <button className={`${s.micFab} ${listening ? s.micFabActive : ''}`} onClick={() => { setOpen(true); handleMic() }}
          aria-label="Voice command">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
        </button>
      )}
    </>
  )
}
