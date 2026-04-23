import { useState, useEffect } from 'react'
import { T } from '../../tokens/tokens'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../hooks/useMobile'

const animKf = `@keyframes sfSlideIn { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`

export default function ScenarioFeedbackView({ role, navigate }) {
  const tk = T.dark
  const mob = useMobile()
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'bad' | 'okay' | 'good'

  useEffect(() => {
    const s = document.createElement('style')
    s.textContent = animKf
    document.head.appendChild(s)
    loadFeedback()
  }, [])

  async function loadFeedback() {
    const { data } = await supabase
      .from('sm_scenario_feedback')
      .select('*, scenario:sm_scenarios(id, title, prompt, type, difficulty, tags, unit:sm_units(title, icon)), user:sm_user_roles!sm_scenario_feedback_user_id_fkey(display_name)')
      .order('created_at', { ascending: false })
      .limit(200)
    setFeedback(data || [])
    setLoading(false)
  }

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
      </div>
    )
  }

  const filtered = filter === 'all' ? feedback : feedback.filter(f => f.rating === filter)

  const counts = {
    all: feedback.length,
    bad: feedback.filter(f => f.rating === 'bad').length,
    okay: feedback.filter(f => f.rating === 'okay').length,
    good: feedback.filter(f => f.rating === 'good').length,
  }

  const ratingMeta = {
    good: { emoji: '👍', color: tk.green, bg: tk.greenSoft },
    okay: { emoji: '🤷', color: tk.amber, bg: tk.amberSoft },
    bad: { emoji: '👎', color: tk.red, bg: tk.redSoft },
  }

  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 16px' }}>
        <div onClick={() => navigate('/training/admin')}
          style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Admin
        </div>

        <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Question Quality
        </div>
        <h1 style={{ color: tk.text, fontSize: mob ? 24 : 28, fontWeight: 700, margin: '0 0 8px' }}>
          Scenario Feedback
        </h1>
        <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
          See which questions need improvement. Focus on the 👎 rated ones first.
        </p>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: mob ? 6 : 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'All', color: tk.accent },
            { key: 'bad', label: '👎 Needs Work', color: tk.red },
            { key: 'okay', label: '🤷 Okay', color: tk.amber },
            { key: 'good', label: '👍 Good', color: tk.green },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
                border: `1.5px solid ${filter === f.key ? f.color : tk.borderMed}`,
                background: filter === f.key ? f.color + '15' : 'transparent',
                color: filter === f.key ? f.color : tk.textSub,
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ color: tk.textSub, fontSize: 14, textAlign: 'center', padding: 40 }}>Loading feedback...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ color: tk.textSub, fontSize: 14 }}>
              {filter === 'all' ? 'No feedback yet. Feedback will appear as scenarios are rated during training.' : `No ${filter}-rated scenarios.`}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((fb, i) => {
              const scenario = fb.scenario || {}
              const unit = scenario.unit || {}
              const meta = ratingMeta[fb.rating] || ratingMeta.okay
              const userName = fb.user?.display_name || 'Unknown'

              return (
                <div key={fb.id} style={{
                  background: tk.surface, borderRadius: 14, padding: '18px 20px',
                  border: `1px solid ${meta.color}25`, boxShadow: tk.cardShadow,
                  animation: `sfSlideIn 0.25s ease ${i * 0.03}s both`,
                }}>
                  {/* Header: rating + unit + type */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: meta.bg, border: `1px solid ${meta.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18,
                    }}>
                      {meta.emoji}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: tk.text, fontSize: 14, fontWeight: 600 }}>
                        {scenario.title || 'Untitled Scenario'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                        {unit.title && (
                          <span style={{ fontSize: 10, color: tk.accent, background: tk.accentGhost, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {unit.icon} {unit.title}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: tk.textMute, background: tk.surfaceEl, padding: '2px 8px', borderRadius: 4 }}>
                          {scenario.type === 'deep_situation' ? 'DEEP' : 'QUICK-FIRE'}
                        </span>
                        <span style={{ fontSize: 10, color: tk.textMute }}>by {userName}</span>
                      </div>
                    </div>
                  </div>

                  {/* Scenario prompt preview */}
                  <div style={{
                    color: tk.textSub, fontSize: 13, lineHeight: 1.5, marginBottom: 10,
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {scenario.prompt}
                  </div>

                  {/* Comment */}
                  {fb.comment && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: tk.surfaceEl, borderLeft: `3px solid ${meta.color}`,
                      color: tk.text, fontSize: 13, lineHeight: 1.5,
                    }}>
                      <span style={{ color: tk.textMute, fontSize: 11, fontWeight: 600 }}>FEEDBACK: </span>
                      {fb.comment}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
