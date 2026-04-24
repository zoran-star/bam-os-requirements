import { useState, useEffect, useRef } from 'react'
import { T } from '../../tokens/tokens'
import { supabase } from '../../lib/supabase'
import VoiceMicButton from '../components/VoiceMicButton'
import { useVoiceInput } from '../hooks/useVoiceInput'
import ScenarioFeedback from '../components/ScenarioFeedback'
import { useMobile } from '../hooks/useMobile'

const calAnimKeyframes = `
@keyframes calSlideIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes calPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes calCheck { from { transform: scale(0) rotate(-45deg); opacity: 0; } to { transform: scale(1) rotate(0deg); opacity: 1; } }
@keyframes calCountUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`

function useSyncNotion() {
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  async function sync() {
    setSyncing(true); setSyncResult(null)
    try {
      const res = await fetch('/api/training', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-notion' }),
      })
      const data = await res.json()
      setSyncResult(data.synced > 0 ? `${data.synced} synced!` : 'All up to date')
    } catch { setSyncResult('Sync failed') }
    setSyncing(false)
  }
  return { syncing, syncResult, sync }
}

export default function CalibrationMode({ role, userId }) {
  const [units, setUnits] = useState([])
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [calibrations, setCalibrations] = useState({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('select')
  const [justSaved, setJustSaved] = useState(false)
  // Gamification
  const [todayCount, setTodayCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [calStreak, setCalStreak] = useState(0)
  const [sessionStart, setSessionStart] = useState(null)
  const [sessionCount, setSessionCount] = useState(0)
  const styleRef = useRef(false)
  const { syncing, syncResult, sync: syncNotion } = useSyncNotion()

  const tk = T.dark
  const mob = useMobile()

  useEffect(() => {
    if (!styleRef.current) {
      const s = document.createElement('style')
      s.textContent = calAnimKeyframes
      document.head.appendChild(s)
      styleRef.current = true
    }
  }, [])

  // Voice input
  const { isListening, transcript, startListening, stopListening, resetTranscript, supported } = useVoiceInput({
    onResult: (text) => setResponse(prev => prev ? prev + ' ' + text : text),
    autoSubmitDelay: 2500,
  })

  useEffect(() => { loadUnits(); loadStats() }, [])

  async function loadStats() {
    const today = new Date().toISOString().split('T')[0]
    const { count: todayC } = await supabase
      .from('sm_calibrations').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', today + 'T00:00:00')
    const { count: totalC } = await supabase
      .from('sm_calibrations').select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { data: calDays } = await supabase
      .from('sm_calibrations').select('created_at').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(200)

    let streak = 0
    if (calDays && calDays.length > 0) {
      const uniqueDays = [...new Set(calDays.map(c => c.created_at.split('T')[0]))]
      const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)
      for (let i = 0; i < uniqueDays.length; i++) {
        const expected = new Date(todayDate)
        expected.setDate(expected.getDate() - i)
        if (uniqueDays[i] === expected.toISOString().split('T')[0]) streak++
        else break
      }
    }
    setTodayCount(todayC || 0)
    setTotalCount(totalC || 0)
    setCalStreak(streak)
  }

  async function loadUnits() {
    const { data } = await supabase.from('sm_units').select('*').eq('is_active', true).order('order_index')
    const { data: allCals } = await supabase
      .from('sm_calibrations').select('scenario_id, scenario:sm_scenarios(unit_id)').eq('user_id', userId)
    const unitCalCounts = {}
    for (const c of (allCals || [])) { const uid = c.scenario?.unit_id; if (uid) unitCalCounts[uid] = (unitCalCounts[uid] || 0) + 1 }
    const { data: scenarioCounts } = await supabase.from('sm_scenarios').select('unit_id').eq('is_active', true)
    const unitScenarioCounts = {}
    for (const s of (scenarioCounts || [])) unitScenarioCounts[s.unit_id] = (unitScenarioCounts[s.unit_id] || 0) + 1
    setUnits((data || []).map(u => ({ ...u, calibrated: unitCalCounts[u.id] || 0, scenarioCount: unitScenarioCounts[u.id] || 0 })))
    setLoading(false)
  }

  async function selectUnit(unit) {
    setSelectedUnit(unit); setLoading(true); setSessionStart(Date.now()); setSessionCount(0)
    const { data: scenarioData } = await supabase.from('sm_scenarios').select('*')
      .eq('unit_id', unit.id).eq('is_active', true).order('type').order('difficulty')
    const { data: calData } = await supabase.from('sm_calibrations').select('scenario_id').eq('user_id', userId)
    const calMap = {}; for (const c of (calData || [])) calMap[c.scenario_id] = true
    setScenarios(scenarioData || []); setCalibrations(calMap)
    const firstUncal = (scenarioData || []).findIndex(s => !calMap[s.id])
    setCurrentIdx(firstUncal >= 0 ? firstUncal : 0)
    setView('train'); setLoading(false)
  }

  async function submitCalibration() {
    if (!response.trim()) return
    setSubmitting(true)
    const scenario = scenarios[currentIdx]
    const { error } = await supabase.from('sm_calibrations').insert({
      scenario_id: scenario.id, user_id: userId, response_text: response.trim(), score: 10, notes: null,
    })
    if (!error) {
      setCalibrations(prev => ({ ...prev, [scenario.id]: true }))
      setJustSaved(true)
      setSessionCount(prev => prev + 1)
      setTodayCount(prev => prev + 1)
      setTotalCount(prev => prev + 1)
      setTimeout(() => {
        setJustSaved(false)
        setResponse(''); resetTranscript()
        let nextIdx = -1
        for (let i = currentIdx + 1; i < scenarios.length; i++) {
          if (!calibrations[scenarios[i].id]) { nextIdx = i; break }
        }
        if (nextIdx >= 0) setCurrentIdx(nextIdx)
        else setView('done')
      }, 800)
    }
    setSubmitting(false)
  }

  function skipScenario() {
    let nextIdx = -1
    for (let i = currentIdx + 1; i < scenarios.length; i++) {
      if (!calibrations[scenarios[i].id]) { nextIdx = i; break }
    }
    if (nextIdx >= 0) { setCurrentIdx(nextIdx); setResponse(''); resetTranscript() }
    else setView('done')
  }

  const calibratedInUnit = Object.keys(calibrations).filter(id => scenarios.some(s => s.id === id)).length
  const scenariosInUnit = scenarios.length
  const sessionMinutes = sessionStart ? Math.floor((Date.now() - sessionStart) / 60000) : 0
  const pctComplete = scenariosInUnit ? Math.round((calibratedInUnit / scenariosInUnit) * 100) : 0

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
        <div style={{ color: tk.textSub, fontSize: 14 }}>Calibration Mode is only available to Lead SMs and Admins.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: tk.textSub, fontSize: 14, animation: 'calPulse 1.5s infinite' }}>Loading calibration data...</div>
      </div>
    )
  }

  // ─── UNIT SELECTION ───
  if (view === 'select') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', padding: mob ? '24px 12px' : '32px 16px' }}>
          {/* Back link */}
          <div onClick={() => window.history.back()}
            style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            ← Back to Training
          </div>

          <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Calibration Mode
          </div>
          <h1 style={{ color: tk.text, fontSize: mob ? 24 : 28, fontWeight: 700, margin: '0 0 8px' }}>
            Train the AI Evaluator
          </h1>
          <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            Answer scenarios the way you want SMs to answer them. Your responses become the <strong style={{ color: tk.accent }}>gold standard</strong> the AI evaluates against.
          </p>

          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
            {calStreak > 0 && (
              <StatPill icon="🔥" label={`${calStreak} day streak`} color={tk.amber} bg={tk.amberSoft} border="rgba(251,191,36,0.2)" />
            )}
            <StatPill icon="📝" label={`${todayCount} today`} color={tk.text} bg={tk.surfaceEl} border={tk.borderMed} />
            <StatPill icon="🧠" label={`${totalCount} total`} color={tk.text} bg={tk.surfaceEl} border={tk.borderMed} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {units.map((unit, i) => {
              const pct = unit.scenarioCount ? Math.round((unit.calibrated / unit.scenarioCount) * 100) : 0
              const isDone = pct === 100

              return (
                <div key={unit.id} onClick={() => selectUnit(unit)}
                  style={{
                    background: tk.surface, borderRadius: 14, padding: '18px 20px',
                    border: `1px solid ${isDone ? tk.green + '40' : tk.borderMed}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16,
                    transition: 'all 0.2s ease', boxShadow: tk.cardShadow,
                    animation: `calSlideIn 0.3s ease ${i * 0.05}s both`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = tk.accent; e.currentTarget.style.boxShadow = tk.cardHover }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = isDone ? tk.green + '40' : tk.borderMed; e.currentTarget.style.boxShadow = tk.cardShadow }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isDone ? tk.greenSoft : tk.accentGhost, fontSize: 24, flexShrink: 0,
                  }}>
                    {isDone ? '✅' : unit.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: tk.text, fontWeight: 600, fontSize: 15 }}>{unit.title}</div>
                    <div style={{ color: tk.textSub, fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {unit.description}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: tk.surfaceEl, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
                          background: isDone ? tk.green : `linear-gradient(90deg, ${tk.accent}, ${tk.accent}cc)`,
                          width: `${pct}%`,
                        }} />
                      </div>
                      <span style={{
                        color: isDone ? tk.green : tk.textSub, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                        minWidth: 40, textAlign: 'right',
                      }}>
                        {unit.calibrated}/{unit.scenarioCount}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ─── COMPLETION ───
  if (view === 'done') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 440, padding: 24, animation: 'calSlideIn 0.4s ease' }}>
          <div style={{ fontSize: 56, marginBottom: 16, animation: 'calPulse 2s ease infinite' }}>🎯</div>
          <h2 style={{ color: tk.text, fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
            Session Complete
          </h2>

          {/* Session stats */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: mob ? 14 : 24, margin: '20px 0',
            background: tk.surface, borderRadius: 14, padding: mob ? '16px 12px' : '20px 16px',
            border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: tk.accent, fontSize: 32, fontWeight: 800, animation: 'calCountUp 0.4s ease' }}>{sessionCount}</div>
              <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>This Session</div>
            </div>
            <div style={{ width: 1, background: tk.border }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: tk.green, fontSize: 32, fontWeight: 800, animation: 'calCountUp 0.5s ease' }}>{calibratedInUnit}</div>
              <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unit Total</div>
            </div>
            <div style={{ width: 1, background: tk.border }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: tk.amber, fontSize: 32, fontWeight: 800, animation: 'calCountUp 0.6s ease' }}>{sessionMinutes}m</div>
              <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time Spent</div>
            </div>
          </div>

          <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            <strong style={{ color: tk.text }}>{selectedUnit?.title}</strong> — {calibratedInUnit} of {scenariosInUnit} scenarios
            now have your gold-standard response. The AI is sharper.
          </p>

          {/* Notion sync */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={syncNotion} disabled={syncing}
              style={{
                padding: '10px 20px', borderRadius: 10, border: `1px solid ${tk.blue}30`,
                background: 'rgba(96,165,250,0.08)', color: tk.blue,
                cursor: syncing ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                opacity: syncing ? 0.6 : 1, transition: 'all 0.15s',
              }}
            >
              {syncing ? 'Syncing...' : '📋 Sync to Notion'}
            </button>
            {syncResult && (
              <div style={{ color: tk.textSub, fontSize: 12, marginTop: 6 }}>{syncResult}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => { setView('select'); setScenarios([]); setCalibrations({}); loadUnits(); loadStats() }}
              style={{
                padding: '12px 24px', borderRadius: 10, border: `1px solid ${tk.borderStr}`,
                background: 'transparent', color: tk.text, cursor: 'pointer', fontWeight: 600, fontSize: 14, transition: 'all 0.15s',
              }}
            >
              Pick Another Unit
            </button>
            <button onClick={() => window.history.back()}
              style={{
                padding: '12px 24px', borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                color: tk.bg, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                boxShadow: tk.accentGlow, transition: 'all 0.15s',
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── TRAINING VIEW ───
  const scenario = scenarios[currentIdx]
  if (!scenario) return null

  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: mob ? '16px 12px' : '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Calibration — {selectedUnit?.title}
            </div>
            <div style={{ color: tk.textSub, fontSize: 12, marginTop: 2 }}>
              {calibratedInUnit} of {scenariosInUnit} calibrated ({pctComplete}%)
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              padding: '6px 12px', borderRadius: 8, background: tk.accentGhost,
              border: `1px solid ${tk.accentBorder}`, color: tk.accent, fontSize: 13, fontWeight: 700,
            }}>
              {sessionCount} this session
            </div>
            <button onClick={() => setView('done')}
              style={{
                padding: '6px 14px', borderRadius: 8, border: `1px solid ${tk.borderStr}`,
                background: 'transparent', color: tk.textSub, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              Finish
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 5, borderRadius: 3, background: tk.surfaceEl, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3, transition: 'width 0.4s ease',
            background: `linear-gradient(90deg, ${tk.accent}, ${tk.accent}cc)`,
            width: `${pctComplete}%`,
          }} />
        </div>

        {/* Saved flash */}
        {justSaved && (
          <div style={{
            padding: '12px 18px', borderRadius: 10, marginBottom: 16, textAlign: 'center',
            background: tk.greenSoft, border: `1px solid ${tk.green}30`,
            color: tk.green, fontSize: 14, fontWeight: 700, animation: 'calCheck 0.3s ease',
          }}>
            ✓ Gold standard saved! Moving to next...
          </div>
        )}

        {/* Scenario card */}
        <div style={{
          background: tk.surface, borderRadius: 14, padding: 24,
          border: `1px solid ${tk.borderMed}`, marginBottom: 16,
          boxShadow: tk.cardShadow, animation: 'calSlideIn 0.3s ease',
        }}>
          {scenario.tags && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {scenario.tags.map(tag => (
                <span key={tag} style={{
                  padding: '3px 10px', borderRadius: 6, background: tk.surfaceEl,
                  color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{tag.replace(/_/g, ' ')}</span>
              ))}
              <span style={{
                padding: '3px 10px', borderRadius: 6,
                background: scenario.type === 'deep_situation' ? 'rgba(124,58,237,0.12)' : tk.accentGhost,
                color: scenario.type === 'deep_situation' ? '#A78BFA' : tk.accent,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              }}>
                {scenario.type === 'deep_situation' ? 'DEEP' : 'QUICK-FIRE'} · D{scenario.difficulty}
              </span>
            </div>
          )}

          <div style={{ color: tk.text, fontSize: 16, lineHeight: 1.7, fontWeight: 500 }}>
            {scenario.prompt}
          </div>

          {scenario.context && (
            <div style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 8,
              background: tk.surfaceEl, borderLeft: `3px solid ${tk.accent}`,
              color: tk.textSub, fontSize: 13, lineHeight: 1.5,
            }}>
              {scenario.context}
            </div>
          )}
        </div>

        {/* Scenario feedback — rate the question quality */}
        <ScenarioFeedback scenarioId={scenario.id} userId={userId} tk={tk} />

        {calibrations[scenario.id] && (
          <div style={{
            padding: '10px 16px', borderRadius: 10, marginBottom: 12,
            background: tk.greenSoft, border: `1px solid ${tk.green}30`,
            color: tk.green, fontSize: 13, fontWeight: 600,
          }}>
            ✓ Already calibrated — you can recalibrate or skip
          </div>
        )}

        {/* Response input */}
        <div style={{
          background: tk.surface, borderRadius: 14, padding: 22,
          border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
        }}>
          <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Your Gold-Standard Response
          </div>
          <textarea
            value={response}
            onChange={e => setResponse(e.target.value)}
            placeholder="Type or speak your answer — this is what a 10/10 looks like..."
            style={{
              width: '100%', minHeight: mob ? 90 : 130, padding: mob ? 12 : 14,
              borderRadius: 10, border: `1px solid ${tk.borderMed}`,
              background: tk.bg, color: tk.text, fontSize: 14,
              resize: 'vertical', fontFamily: 'inherit',
              lineHeight: 1.6, boxSizing: 'border-box',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = tk.accent; e.target.style.boxShadow = tk.inputGlow }}
            onBlur={e => { e.target.style.borderColor = tk.borderMed; e.target.style.boxShadow = 'none' }}
          />

          {isListening && transcript && (
            <div style={{
              color: tk.accent, fontSize: 12, marginTop: 8, fontStyle: 'italic', opacity: 0.8,
              padding: '4px 8px', borderRadius: 6, background: tk.accentGhost,
            }}>
              Hearing: {transcript}...
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {supported && (
                <VoiceMicButton isListening={isListening} onToggle={isListening ? stopListening : startListening} tk={tk} size={44} />
              )}
              <button onClick={skipScenario}
                style={{
                  padding: '10px 18px', borderRadius: 10, border: `1px solid ${tk.borderStr}`,
                  background: 'transparent', color: tk.textSub, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                Skip →
              </button>
            </div>
            <button onClick={submitCalibration} disabled={!response.trim() || submitting}
              style={{
                padding: '12px 28px', borderRadius: 10, border: 'none',
                background: (!response.trim() || submitting) ? tk.surfaceEl : `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                color: (!response.trim() || submitting) ? tk.textMute : tk.bg,
                cursor: (!response.trim() || submitting) ? 'default' : 'pointer',
                fontWeight: 700, fontSize: 14,
                opacity: (!response.trim() || submitting) ? 0.5 : 1,
                boxShadow: (!response.trim() || submitting) ? 'none' : tk.accentGlow,
                transition: 'all 0.2s ease',
              }}
            >
              {submitting ? 'Saving...' : '✓ Save Gold Standard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatPill({ icon, label, color, bg, border }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 10,
      background: bg, border: `1px solid ${border}`,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <span style={{ color, fontSize: 13, fontWeight: 700 }}>{label}</span>
    </div>
  )
}
