import { useState, useRef, useEffect } from 'react'
import s from '../styles/SageBar.module.css'

const PROMPTS = [
  "How's my business doing today?",
  "Show me this week's schedule...",
  "Who should I follow up with?",
  "What's my revenue this month?",
  "Any members at risk of churning?",
  "Write a post about today's session...",
]

export default function SageBar() {
  const [expanded, setExpanded] = useState(false)
  const [listening, setListening] = useState(false)
  const [input, setInput] = useState('')
  const [placeholder, setPlaceholder] = useState(PROMPTS[0])
  const inputRef = useRef(null)
  const idx = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      idx.current = (idx.current + 1) % PROMPTS.length
      setPlaceholder(PROMPTS[idx.current])
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  const handleExpand = () => {
    setExpanded(true)
    setTimeout(() => inputRef.current?.focus(), 150)
  }

  const handleSend = () => {
    if (!input.trim()) return
    setInput('')
    // Mock response - in real app this would trigger Sage
  }

  const handleMic = () => {
    setListening(true)
    setTimeout(() => {
      setListening(false)
      setInput(PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
    }, 2000)
  }

  return (
    <div className={s.wrap} onMouseLeave={() => { if (!input && !listening) setExpanded(false) }}>
      {/* Ambient glow (always visible) */}
      <div className={`${s.glow} ${expanded ? s.glowExpanded : ''}`} onMouseEnter={handleExpand} onClick={handleExpand} />

      {/* Expanded input bar */}
      {expanded && (
        <div className={s.bar}>
          <div className={s.sageIcon}>S</div>
          <input
            ref={inputRef}
            className={s.input}
            placeholder={placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          />
          <button className={`${s.micBtn} ${listening ? s.micActive : ''}`} onClick={handleMic} aria-label="Voice input">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          </button>
          {input && (
            <button className={s.sendBtn} onClick={handleSend} aria-label="Send">&#8593;</button>
          )}
        </div>
      )}

      {/* Hint text when not expanded */}
      {!expanded && (
        <div className={s.hint} onMouseEnter={handleExpand} onClick={handleExpand}>
          Ask Sage anything...
        </div>
      )}
    </div>
  )
}
