import { useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'

const ContentEngineView = lazy(() => import('./views/ContentEngineView'))
const ChessboardView = lazy(() => import('./views/ChessboardView'))

const LIGHT_TOKENS = {
  bg: '#F8F7F5', surface: '#FFFFFF', surfaceEl: '#FAFAF8', surfaceHov: '#F0EFEC',
  surfaceAlt: '#F5F4F1', border: 'rgba(0,0,0,0.07)', borderMed: 'rgba(0,0,0,0.12)',
  borderStr: 'rgba(0,0,0,0.18)', text: '#1C1B18', textSub: '#6E6B63', textMute: '#A5A19A',
  accent: '#C8A84E', accentGhost: 'rgba(200,168,78,0.08)', accentBorder: 'rgba(200,168,78,0.25)',
  green: '#3EAF5C', greenSoft: 'rgba(62,175,92,0.10)', amber: '#E09D24', amberSoft: 'rgba(224,157,36,0.10)',
  blue: '#6366f1', red: '#E05A42', redSoft: 'rgba(224,90,66,0.10)',
  cardHover: 'rgba(200,168,78,0.04)', inputGlow: 'rgba(200,168,78,0.15)',
}

const DARK_TOKENS = {
  bg: '#0E0D0B', surface: '#1A1916', surfaceEl: '#222119', surfaceHov: '#2A2923',
  surfaceAlt: '#1E1D18', border: 'rgba(255,255,255,0.08)', borderMed: 'rgba(255,255,255,0.12)',
  borderStr: 'rgba(255,255,255,0.18)', text: '#F0EDE6', textSub: '#9C9889', textMute: '#5E5A50',
  accent: '#C8A84E', accentGhost: 'rgba(200,168,78,0.12)', accentBorder: 'rgba(200,168,78,0.3)',
  green: '#4ade80', greenSoft: 'rgba(74,222,128,0.12)', amber: '#fbbf24', amberSoft: 'rgba(251,191,36,0.12)',
  blue: '#818cf8', red: '#f87171', redSoft: 'rgba(248,113,113,0.12)',
  cardHover: 'rgba(200,168,78,0.06)', inputGlow: 'rgba(200,168,78,0.2)',
}

const NAV_ITEMS = [
  { path: '/', label: 'Chessboard', icon: '♟', active: true },
  { path: '/content', label: 'Content', icon: '🎬', active: true },
  { path: '/launch', label: 'Launch', icon: '🚀', active: false },
  { path: '/decisions', label: 'Decisions', icon: '📋', active: false },
]

function Sidebar({ tokens, collapsed, onToggle }) {
  return (
    <div style={{
      width: collapsed ? 56 : 200,
      minHeight: '100vh',
      background: tokens.surface,
      borderRight: `1px solid ${tokens.border}`,
      transition: 'width 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100,
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '16px 12px' : '16px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${tokens.border}`,
        cursor: 'pointer',
        minHeight: 56,
      }} onClick={onToggle}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: tokens.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#0E0D0B', flexShrink: 0,
        }}>FC</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text }}>FC Portal</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: tokens.textMute, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Internal</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <div style={{ padding: '12px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.active ? item.path : '#'}
            onClick={e => !item.active && e.preventDefault()}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: collapsed ? '10px 12px' : '10px 12px',
              borderRadius: 10,
              background: isActive && item.active ? tokens.accentGhost : 'transparent',
              color: !item.active ? tokens.textMute : isActive ? tokens.accent : tokens.textSub,
              textDecoration: 'none',
              fontSize: 13, fontWeight: 600,
              cursor: item.active ? 'pointer' : 'default',
              opacity: item.active ? 1 : 0.45,
              transition: 'background 0.15s, color 0.15s',
            })}
          >
            <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && (
              <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.label}</span>
            )}
            {!collapsed && !item.active && (
              <span style={{ fontSize: 9, fontWeight: 700, color: tokens.textMute, marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Soon</span>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function Loading({ tokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: tokens.textMute }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${tokens.border}`, borderTopColor: tokens.accent, borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 13 }}>Loading...</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function AppShell() {
  const [dark, setDark] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const tokens = dark ? DARK_TOKENS : LIGHT_TOKENS
  const sidebarWidth = sidebarCollapsed ? 56 : 200

  return (
    <div style={{
      minHeight: '100vh', background: tokens.bg,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      color: tokens.text, transition: 'background 0.3s, color 0.3s',
    }}>
      <Sidebar tokens={tokens} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {/* Main content area */}
      <div style={{
        marginLeft: sidebarWidth,
        transition: 'margin-left 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        minHeight: '100vh',
      }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '12px 24px', borderBottom: `1px solid ${tokens.border}`,
        }}>
          <button onClick={() => setDark(!dark)} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
            border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
            color: tokens.textSub, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {dark ? '☀ Light' : '● Dark'}
          </button>
        </div>

        {/* Routes */}
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
          <Suspense fallback={<Loading tokens={tokens} />}>
            <Routes>
              <Route path="/" element={<ChessboardView tokens={tokens} dark={dark} />} />
              <Route path="/content" element={<ContentEngineView tokens={tokens} dark={dark} />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
