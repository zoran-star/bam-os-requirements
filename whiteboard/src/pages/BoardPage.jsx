import { useState } from 'react'
import Header from '../components/Header'
import Board from '../components/Board'
import BacklogPanel from '../components/BacklogPanel'
import useSessions from '../hooks/useSessions'

export default function BoardPage() {
  const { sessions, loading, error, refresh } = useSessions()
  const [showBacklog, setShowBacklog] = useState(false)

  return (
    <div>
      <Header sessions={sessions} onBacklogClick={() => setShowBacklog(true)} />
      {loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--tm)' }}>Loading sessions...</div>}
      {error && <div style={{ textAlign: 'center', padding: 60, color: 'var(--red)' }}>Failed to load sessions</div>}
      {!loading && !error && <Board sessions={sessions} onRefresh={refresh} />}
      {showBacklog && <BacklogPanel onClose={() => setShowBacklog(false)} />}
    </div>
  )
}
