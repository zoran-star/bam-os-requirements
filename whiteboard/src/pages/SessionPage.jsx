import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSession from '../hooks/useSession'
import ReviewDoc from '../components/ReviewDoc'
import { buildExport } from '../lib/exportBuilder'
import s from '../styles/SessionView.module.css'

export default function SessionPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { session, loading, error } = useSession(sessionId)
  const [toast, setToast] = useState(false)

  const storageKey = `bamos_wb_${sessionId}`
  const [state, setState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {} }
    catch { return {} }
  })

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state, storageKey])

  const allItems = useMemo(() => {
    if (!session?.sectionData) return []
    const items = []
    session.sectionData.subsections.forEach(sub => sub.items.forEach(item => items.push(item)))
    return items
  }, [session])

  const reviewed = useMemo(() => {
    return allItems.filter(item => {
      const s = state[item.id]
      return s && (s.checked || (s.feedback && s.feedback.trim()))
    }).length
  }, [allItems, state])

  const pct = allItems.length ? Math.round((reviewed / allItems.length) * 100) : 0

  const handleExport = useCallback(() => {
    if (!session) return
    const md = buildExport(session, allItems, state)
    navigator.clipboard.writeText(md).then(() => {
      setToast(true)
      setTimeout(() => setToast(false), 2500)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = md
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setToast(true)
      setTimeout(() => setToast(false), 2500)
    })
  }, [session, allItems, state])

  const [guideOpen, setGuideOpen] = useState(() => {
    try { return !localStorage.getItem('bamos_wb_guide_dismissed') }
    catch { return true }
  })

  const dismissGuide = useCallback(() => {
    setGuideOpen(false)
    localStorage.setItem('bamos_wb_guide_dismissed', '1')
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--tm)' }}>Loading session...</div>
  if (error || !session) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--red)' }}>Session not found</div>

  const statusClass = session.status === 'Complete' ? s.statusComplete
    : session.status === 'In Progress' ? s.statusProgress : s.statusTodo

  return (
    <div>
      <div className={s.header}>
        <div className={s.left}>
          <button className={s.back} onClick={() => navigate('/')}>&larr;</button>
          <span className={s.title}>{session.title}</span>
          <span className={s.id}>{session.sessionId}</span>
          <span className={`${s.status} ${statusClass}`}>{session.status === 'To Do' ? 'Not Ready' : session.status === 'In Progress' ? 'Ready' : session.status}</span>
        </div>
        <div className={s.right}>
          <div className={s.progress}>
            <div className={s.track}><div className={s.fill} style={{ width: `${pct}%` }} /></div>
            <span className={s.label}>{reviewed} / {allItems.length}</span>
          </div>
          <button className={s.btn} onClick={handleExport}>Export for AI</button>
        </div>
      </div>

      <div className={s.container}>
        {guideOpen && (
          <div className={s.guide}>
            <button className={s.guideClose} onClick={dismissGuide}>&times;</button>
            <div className={s.guideTitle}>How to review this session</div>
            <div className={s.guideSteps}>
              <div className={s.guideStep}>
                <span className={s.guideNum}>1</span>
                <div>
                  <strong>Review each item.</strong> Approve items you agree with by clicking the <span className={s.guideCheck}>✓</span> button. For items you want to change, type your feedback in the input field on the right.
                </div>
              </div>
              <div className={s.guideStep}>
                <span className={s.guideNum}>2</span>
                <div>
                  <strong>Already decided items</strong> are collapsed in a green bar at the top of each section. Expand to review past decisions. Pending items are always visible below.
                </div>
              </div>
              <div className={s.guideStep}>
                <span className={s.guideNum}>3</span>
                <div>
                  <strong>When you're done,</strong> click <strong>Export for AI</strong> in the top right. This copies your decisions to the clipboard.
                </div>
              </div>
              <div className={s.guideStep}>
                <span className={s.guideNum}>4</span>
                <div>
                  <strong>Paste into Claude Code</strong> (in the <code>bam-os-requirements</code> repo). Claude will walk through your feedback with you, confirm what actions to take, then update Notion, the prototype, and create any follow-up sessions.
                </div>
              </div>
            </div>
          </div>
        )}
        {!guideOpen && (
          <button className={s.guideReopen} onClick={() => setGuideOpen(true)}>? How to review</button>
        )}

        <ReviewDoc
          sectionData={session.sectionData}
          sessionId={sessionId}
          sessionDescription={session.description}
          state={state}
          onStateChange={setState}
        />
      </div>

      <div className={`${s.toast} ${toast ? s.toastShow : ''}`}>Copied to clipboard</div>
    </div>
  )
}
