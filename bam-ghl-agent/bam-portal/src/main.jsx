import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import BAMPortal from './App'
import { TicketIntake, TicketStatus, ContentPortal } from './PublicTicket'

const TrainingApp = lazy(() => import('./training/TrainingApp'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/content" element={<ContentPortal />} />
        <Route path="/ticket" element={<TicketIntake />} />
        <Route path="/ticket/:token" element={<TicketStatus />} />
        <Route path="/training/*" element={
          <Suspense fallback={<div style={{ background: "#08080A", minHeight: "100vh" }} />}>
            <TrainingApp />
          </Suspense>
        } />
        <Route path="*" element={<BAMPortal />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)