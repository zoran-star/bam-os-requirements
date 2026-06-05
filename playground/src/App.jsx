import { useState } from 'react'
import Gate, { isUnlocked } from './Gate.jsx'
import Whiteboard from './Whiteboard.jsx'
import Todos from './Todos.jsx'
import SlackDigest from './SlackDigest.jsx'

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked())
  // Which widget is open full-screen (null = show the whiteboard).
  const [openWidget, setOpenWidget] = useState(null)

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app">
      <Whiteboard onOpen={setOpenWidget} />
      {openWidget && (
        <div className="zoom-layer">
          {openWidget.type === 'todo' && (
            <Todos title={openWidget.title} board={openWidget.board} onClose={() => setOpenWidget(null)} />
          )}
          {openWidget.type === 'slack' && (
            <SlackDigest title={openWidget.title} onClose={() => setOpenWidget(null)} />
          )}
        </div>
      )}
    </div>
  )
}
