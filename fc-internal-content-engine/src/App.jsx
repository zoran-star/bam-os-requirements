import { useState } from 'react'
import ContentEngineView from './views/ContentEngineView'

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

export default function App() {
  const [dark, setDark] = useState(true)
  const tokens = dark ? DARK_TOKENS : LIGHT_TOKENS

  return (
    <div style={{
      minHeight: '100vh',
      background: tokens.bg,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      color: tokens.text,
      transition: 'background 0.3s, color 0.3s',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', borderBottom: `1px solid ${tokens.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: tokens.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#0E0D0B',
          }}>FC</div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Content Engine</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Internal</span>
        </div>
        <button
          onClick={() => setDark(!dark)}
          style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
            border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
            color: tokens.textSub, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {dark ? '☀ Light' : '● Dark'}
        </button>
      </div>

      {/* Engine */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <ContentEngineView tokens={tokens} dark={dark} />
      </div>
    </div>
  )
}
