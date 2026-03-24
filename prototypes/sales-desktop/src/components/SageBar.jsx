import { useState, useRef, useEffect, useCallback } from 'react'
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
  const [voiceMode, setVoiceMode] = useState(false)
  const [listening, setListening] = useState(false)
  const [input, setInput] = useState('')
  const [placeholder, setPlaceholder] = useState(PROMPTS[0])
  const [showTypeBox, setShowTypeBox] = useState(false)
  const inputRef = useRef(null)
  const voiceInputRef = useRef(null)
  const idx = useRef(0)

  // Rotate placeholder prompts
  useEffect(() => {
    const interval = setInterval(() => {
      idx.current = (idx.current + 1) % PROMPTS.length
      setPlaceholder(PROMPTS[idx.current])
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  // Control key → voice mode overlay
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'Control' && !e.repeat && !voiceMode && !expanded) {
        e.preventDefault()
        setVoiceMode(true)
        setListening(true)
        // Simulate voice listening for 3s
        setTimeout(() => {
          setListening(false)
          setInput(PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
        }, 3000)
      }
      // Escape closes everything
      if (e.key === 'Escape') {
        setVoiceMode(false)
        setExpanded(false)
        setListening(false)
        setShowTypeBox(false)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [voiceMode, expanded])

  const handleExpand = () => {
    setExpanded(true)
    setTimeout(() => inputRef.current?.focus(), 150)
  }

  const handleSend = () => {
    if (!input.trim()) return
    setInput('')
    setVoiceMode(false)
    setShowTypeBox(false)
  }

  const handleMic = () => {
    setListening(true)
    setTimeout(() => {
      setListening(false)
      setInput(PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
    }, 2000)
  }

  const handleTypeInstead = () => {
    setShowTypeBox(true)
    setListening(false)
    setTimeout(() => voiceInputRef.current?.focus(), 100)
  }

  return (
    <>
      {/* Horizon line + inline bubble */}
      <div className={s.wrap} onMouseLeave={() => { if (!input && !listening) setExpanded(false) }}>
        <div className={s.glowLine} onMouseEnter={handleExpand} onClick={handleExpand} />
        {expanded && (
          <div className={s.bubble}>
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
      </div>

      {/* Voice mode fullscreen overlay (Control key) */}
      {voiceMode && (
        <div className={s.voiceOverlay} onClick={() => { setVoiceMode(false); setListening(false); setShowTypeBox(false) }}>
          <div className={s.voiceContent} onClick={e => e.stopPropagation()}>
            {/* Glowing mic icon */}
            <div className={`${s.voiceMic} ${listening ? s.voiceMicActive : ''}`}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </div>

            {listening && (
              <div className={s.voiceLabel}>Listening...</div>
            )}
            {!listening && input && (
              <div className={s.voiceTranscript}>"{input}"</div>
            )}
            {!listening && !input && !showTypeBox && (
              <div className={s.voiceLabel}>Talk to Sage</div>
            )}

            {/* Sound wave animation */}
            {listening && (
              <div className={s.voiceWaves}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className={s.voiceBar} style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            )}

            {/* Type instead */}
            {showTypeBox ? (
              <div className={s.voiceTypeWrap}>
                <input
                  ref={voiceInputRef}
                  className={s.voiceTypeInput}
                  placeholder="Type your question..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
                />
                {input && (
                  <button className={s.voiceTypeSend} onClick={handleSend}>Send →</button>
                )}
              </div>
            ) : (
              <button className={s.voiceTypeBtn} onClick={handleTypeInstead}>
                Type instead
              </button>
            )}

            <div className={s.voiceHint}>Press <kbd>Esc</kbd> to close</div>
          </div>
        </div>
      )}
    </>
  )
}
