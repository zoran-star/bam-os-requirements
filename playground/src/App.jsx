import { useState } from 'react'
import Gate, { isUnlocked } from './Gate.jsx'
import Todos from './Todos.jsx'

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked())

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app">
      <Todos />
    </div>
  )
}
