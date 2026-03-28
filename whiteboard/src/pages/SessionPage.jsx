import { useState, useEffect, useMemo, useCallback } from 'react'
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
          <span className={`${s.status} ${statusClass}`}>{session.status}</span>
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
        <ReviewDoc
          sectionData={session.sectionData}
          sessionId={sessionId}
          state={state}
          onStateChange={setState}
        />
      </div>

      <div className={`${s.toast} ${toast ? s.toastShow : ''}`}>Copied to clipboard</div>
    </div>
  )
}
