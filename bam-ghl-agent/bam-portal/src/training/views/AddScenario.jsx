import { useState, useEffect, useRef } from 'react'
import { T } from '../../tokens/tokens'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../hooks/useMobile'
import VoiceMicButton from '../components/VoiceMicButton'
import { useVoiceInput } from '../hooks/useVoiceInput'

const addAnimKeyframes = `
@keyframes addFadeIn { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes addSuccess { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`

export default function AddScenario({ role, userId }) {
  const [step, setStep] = useState('problem') // problem | solution | review | saved
  const [problem, setProblem] = useState('')
  const [solution, setSolution] = useState('')
  const [units, setUnits] = useState([])
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const styleRef = useRef(false)

  const tk = T.dark
  const mob = useMobile()

  useEffect(() => {
    if (!styleRef.current) {
      const s = document.createElement('style')
      s.textContent = addAnimKeyframes
      document.head.appendChild(s)
      styleRef.current = true
    }
    loadUnits()
    loadSavedCount()
  }, [])

  // Voice for problem step
  const problemVoice = useVoiceInput({
    onResult: (text) => setProblem(prev => prev ? prev + ' ' + text : text),
    autoSubmitDelay: 3000,
  })

  // Voice for solution step
  const solutionVoice = useVoiceInput({
    onResult: (text) => setSolution(prev => prev ? prev + ' ' + text : text),
    autoSubmitDelay: 3000,
  })

  async function loadUnits() {
    const { data } = await supabase.from('sm_units').select('*').eq('is_active', true).order('order_index')
    setUnits(data || [])
    if (data && data.length > 0) setSelectedUnit(data[0])
  }

  async function loadSavedCount() {
    const { count } = await supabase
      .from('sm_scenarios')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', userId)
    setSavedCount(count || 0)
  }

  async function saveScenario() {
    if (!problem.trim() || !solution.trim() || !selectedUnit) return
    setSaving(true)

    // Create scenario
    const { data: scenario, error: scenarioErr } = await supabase.from('sm_scenarios').insert({
      unit_id: selectedUnit.id,
      title: problem.trim().slice(0, 80) + (problem.trim().length > 80 ? '...' : ''),
      prompt: problem.trim(),
      type: 'quick_fire',
      difficulty: 3,
      tags: ['real_world', 'lead_added'],
      is_active: true,
      created_by: userId,
    }).select().single()

    if (scenarioErr) {
      console.error('Failed to save scenario:', scenarioErr)
      setSaving(false)
      return
    }

    // Create calibration (gold standard answer)
    const { error: calErr } = await supabase.from('sm_calibrations').insert({
      scenario_id: scenario.id,
      user_id: userId,
      response_text: solution.trim(),
      score: 10,
      notes: 'Added via real-time scenario creator',
    })

    if (!calErr) {
      setSavedCount(prev => prev + 1)
      setStep('saved')
      // Sync to Notion in background
      fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-notion', scenarioId: scenario.id }),
      }).catch(() => {}) // silent fail — Notion sync is best-effort
    }
    setSaving(false)
  }

  function resetForm() {
    setProblem('')
    setSolution('')
    setStep('problem')
    problemVoice.resetTranscript()
    solutionVoice.resetTranscript()
  }

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
        <div style={{ color: tk.textSub, fontSize: 14 }}>Only Lead SMs and Admins can add scenarios.</div>
      </div>
    )
  }

  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 650, margin: '0 auto', padding: mob ? '24px 12px' : '32px 16px' }}>
        {/* Back link */}
        <div onClick={() => window.history.back()}
          style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Training
        </div>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Real-Time Knowledge Capture
          </div>
          <h1 style={{ color: tk.text, fontSize: mob ? 24 : 28, fontWeight: 700, margin: '0 0 8px' }}>
            Add a Scenario
          </h1>
          <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Just solved a real client problem? Speak or type it here — it becomes a training scenario with your gold-standard answer.
          </p>
          {savedCount > 0 && (
            <div style={{
              marginTop: 12, padding: '6px 12px', borderRadius: 8,
              background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
              color: tk.accent, fontSize: 12, fontWeight: 600, display: 'inline-block',
            }}>
              🎯 {savedCount} scenarios added by you
            </div>
          )}
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: mob ? 6 : 8, marginBottom: 24, alignItems: 'center' }}>
          {['problem', 'solution', 'review'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: mob ? 4 : 8 }}>
              <div style={{
                width: mob ? 24 : 28, height: mob ? 24 : 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: mob ? 11 : 12, fontWeight: 700,
                background: step === s ? tk.accent : (i < ['problem', 'solution', 'review'].indexOf(step) ? tk.green : tk.surfaceEl),
                color: step === s ? tk.bg : (i < ['problem', 'solution', 'review'].indexOf(step) ? '#fff' : tk.textMute),
                transition: 'all 0.2s',
              }}>
                {i < ['problem', 'solution', 'review'].indexOf(step) ? '✓' : i + 1}
              </div>
              <span style={{
                color: step === s ? tk.text : tk.textMute, fontSize: 12, fontWeight: 600,
                textTransform: 'capitalize',
              }}>{s}</span>
              {i < 2 && <div style={{ width: 24, height: 1, background: tk.border }} />}
            </div>
          ))}
        </div>

        {/* STEP: Problem */}
        {step === 'problem' && (
          <div style={{ animation: 'addFadeIn 0.3s ease' }}>
            <div style={{
              background: tk.surface, borderRadius: 14, padding: 24,
              border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🎙️</div>
              <div style={{ color: tk.text, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                What was the problem?
              </div>
              <div style={{ color: tk.textSub, fontSize: 13, marginBottom: 16 }}>
                Describe the client situation or challenge. Speak naturally — you can edit after.
              </div>

              {/* Unit selector */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                  Unit Category
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {units.map(u => (
                    <button key={u.id} onClick={() => setSelectedUnit(u)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: selectedUnit?.id === u.id ? tk.accentGhost : tk.surfaceEl,
                        color: selectedUnit?.id === u.id ? tk.accent : tk.textSub,
                        fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                        border: `1px solid ${selectedUnit?.id === u.id ? tk.accentBorder : tk.border}`,
                      }}
                    >
                      {u.icon} {u.title}
                    </button>
                  ))}
                </div>
              </div>

              <textarea value={problem} onChange={e => setProblem(e.target.value)}
                placeholder="e.g. 'A client called saying their retention rate dropped to 60% after raising prices by $30/month. They have 200 members and are panicking about losing more...'"
                style={{
                  width: '100%', minHeight: mob ? 100 : 140, padding: mob ? 12 : 14, borderRadius: 10,
                  border: `1px solid ${tk.borderMed}`, background: tk.bg, color: tk.text,
                  fontSize: 14, resize: 'vertical', fontFamily: 'inherit',
                  lineHeight: 1.6, boxSizing: 'border-box', outline: 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = tk.accent; e.target.style.boxShadow = tk.inputGlow }}
                onBlur={e => { e.target.style.borderColor = tk.borderMed; e.target.style.boxShadow = 'none' }}
              />

              {problemVoice.isListening && problemVoice.transcript && (
                <div style={{
                  color: tk.accent, fontSize: 12, marginTop: 6, padding: '4px 8px',
                  borderRadius: 6, background: tk.accentGhost, fontStyle: 'italic',
                }}>
                  Hearing: {problemVoice.transcript}...
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                {problemVoice.supported && (
                  <VoiceMicButton isListening={problemVoice.isListening}
                    onToggle={problemVoice.isListening ? problemVoice.stopListening : problemVoice.startListening}
                    tk={tk} size={44} />
                )}
                <button onClick={() => setStep('solution')} disabled={!problem.trim()}
                  style={{
                    padding: '12px 28px', borderRadius: 10, border: 'none',
                    background: !problem.trim() ? tk.surfaceEl : `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                    color: !problem.trim() ? tk.textMute : tk.bg,
                    cursor: !problem.trim() ? 'default' : 'pointer',
                    fontWeight: 700, fontSize: 14, opacity: !problem.trim() ? 0.5 : 1,
                    boxShadow: !problem.trim() ? 'none' : tk.accentGlow,
                    transition: 'all 0.2s',
                  }}
                >
                  Next: Your Solution →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP: Solution */}
        {step === 'solution' && (
          <div style={{ animation: 'addFadeIn 0.3s ease' }}>
            {/* Problem preview */}
            <div style={{
              background: tk.surfaceEl, borderRadius: 10, padding: '12px 16px', marginBottom: 16,
              borderLeft: `3px solid ${tk.accent}`,
            }}>
              <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>The Problem</div>
              <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.5 }}>{problem}</div>
            </div>

            <div style={{
              background: tk.surface, borderRadius: 14, padding: 24,
              border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>💡</div>
              <div style={{ color: tk.text, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                How did you solve it?
              </div>
              <div style={{ color: tk.textSub, fontSize: 13, marginBottom: 16 }}>
                This becomes the gold-standard answer. Explain what you did and why — be specific about your approach.
              </div>

              <textarea value={solution} onChange={e => setSolution(e.target.value)}
                placeholder="e.g. 'First, I'd pull their actual numbers — 200 members × $30 = $6K/mo in new revenue. Even if 10% leave (20 members), they lose $2K but gain $5.4K net. I'd walk them through...'"
                style={{
                  width: '100%', minHeight: mob ? 110 : 160, padding: mob ? 12 : 14, borderRadius: 10,
                  border: `1px solid ${tk.borderMed}`, background: tk.bg, color: tk.text,
                  fontSize: 14, resize: 'vertical', fontFamily: 'inherit',
                  lineHeight: 1.6, boxSizing: 'border-box', outline: 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = tk.accent; e.target.style.boxShadow = tk.inputGlow }}
                onBlur={e => { e.target.style.borderColor = tk.borderMed; e.target.style.boxShadow = 'none' }}
              />

              {solutionVoice.isListening && solutionVoice.transcript && (
                <div style={{
                  color: tk.accent, fontSize: 12, marginTop: 6, padding: '4px 8px',
                  borderRadius: 6, background: tk.accentGhost, fontStyle: 'italic',
                }}>
                  Hearing: {solutionVoice.transcript}...
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {solutionVoice.supported && (
                    <VoiceMicButton isListening={solutionVoice.isListening}
                      onToggle={solutionVoice.isListening ? solutionVoice.stopListening : solutionVoice.startListening}
                      tk={tk} size={44} />
                  )}
                  <button onClick={() => setStep('problem')}
                    style={{
                      padding: '10px 18px', borderRadius: 10, border: `1px solid ${tk.borderStr}`,
                      background: 'transparent', color: tk.textSub, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    }}
                  >
                    ← Back
                  </button>
                </div>
                <button onClick={() => setStep('review')} disabled={!solution.trim()}
                  style={{
                    padding: '12px 28px', borderRadius: 10, border: 'none',
                    background: !solution.trim() ? tk.surfaceEl : `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                    color: !solution.trim() ? tk.textMute : tk.bg,
                    cursor: !solution.trim() ? 'default' : 'pointer',
                    fontWeight: 700, fontSize: 14, opacity: !solution.trim() ? 0.5 : 1,
                    boxShadow: !solution.trim() ? 'none' : tk.accentGlow,
                  }}
                >
                  Review & Save →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP: Review */}
        {step === 'review' && (
          <div style={{ animation: 'addFadeIn 0.3s ease' }}>
            <div style={{
              background: tk.surface, borderRadius: 14, padding: 24,
              border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
              <div style={{ color: tk.text, fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                Review Before Saving
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Unit: {selectedUnit?.icon} {selectedUnit?.title}
                </div>
              </div>

              <div style={{
                padding: 16, borderRadius: 10, background: tk.bg, marginBottom: 12,
                border: `1px solid ${tk.border}`,
              }}>
                <div style={{ color: tk.red, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
                  The Problem (Scenario Prompt)
                </div>
                <div style={{ color: tk.text, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{problem}</div>
              </div>

              <div style={{
                padding: 16, borderRadius: 10, background: tk.bg, marginBottom: 16,
                border: `1px solid ${tk.border}`,
              }}>
                <div style={{ color: tk.green, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
                  Your Solution (Gold Standard)
                </div>
                <div style={{ color: tk.text, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{solution}</div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep('solution')}
                  style={{
                    padding: '12px 24px', borderRadius: 10, border: `1px solid ${tk.borderStr}`,
                    background: 'transparent', color: tk.text, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  }}
                >
                  ← Edit
                </button>
                <button onClick={saveScenario} disabled={saving}
                  style={{
                    flex: 1, padding: '12px 24px', borderRadius: 10, border: 'none',
                    background: saving ? tk.surfaceEl : `linear-gradient(135deg, ${tk.green}, ${tk.green}cc)`,
                    color: '#fff', cursor: saving ? 'default' : 'pointer',
                    fontWeight: 700, fontSize: 14, opacity: saving ? 0.6 : 1,
                    boxShadow: saving ? 'none' : tk.greenGlow,
                    transition: 'all 0.2s',
                  }}
                >
                  {saving ? 'Saving...' : '✓ Save Scenario + Gold Standard'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP: Saved */}
        {step === 'saved' && (
          <div style={{ animation: 'addSuccess 0.4s ease', textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
            <h2 style={{ color: tk.text, fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
              Scenario Added!
            </h2>
            <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: '0 0 8px' }}>
              Your real-world problem is now a training scenario with your gold-standard answer.
              SMs will see this in their next session.
            </p>
            <div style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 8,
              background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
              color: tk.accent, fontSize: 13, fontWeight: 700, margin: '8px 0 24px',
            }}>
              🎯 {savedCount} total scenarios added
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={resetForm}
                style={{
                  padding: '12px 28px', borderRadius: 10, border: 'none',
                  background: `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                  color: tk.bg, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                  boxShadow: tk.accentGlow,
                }}
              >
                + Add Another
              </button>
              <button onClick={() => window.history.back()}
                style={{
                  padding: '12px 28px', borderRadius: 10, border: `1px solid ${tk.borderStr}`,
                  background: 'transparent', color: tk.text, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
