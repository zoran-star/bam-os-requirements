import { Routes, Route } from 'react-router-dom'
import BoardPage from './pages/BoardPage'
import SessionPage from './pages/SessionPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/session/:sessionId" element={<SessionPage />} />
    </Routes>
  )
}
