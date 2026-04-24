import { useState, useEffect } from 'react'
import { T } from '../../tokens/tokens'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../hooks/useMobile'
import VoiceMicButton from '../components/VoiceMicButton'
import { useVoiceInput } from '../hooks/useVoiceInput'

export default function ReviewFeed({ role, userId }) {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewScore, setReviewScore] = useState(null)
  const [userNames, setUserNames] = useState({})
  const [reviewedCount, setReviewedCount] = useState(0)

  const tk = T.dark
  const mob = useMobile()

  const { isListening, transcript, startListening, stopListening, resetTranscript, supported } = useVoiceInput({
    onResult: (text) => setReviewNote(prev => prev ? prev + ' ' + text : text),
    autoSubmitDelay: 2500,
  })

  useEffect(() => { loadResponses(); loadUserNames() }, [filter])

  async function loadUserNames() {
    const { data } = await supabase.from('sm_user_roles').select('user_id, display_name, role')
    const map = {}
    for (const u of (data || [])) map[u.user_id] = u.display_name || 'SM'
    setUserNames(map)
  }

  async function loadResponses() {
    setLoading(true)
    let query = supabase
      .from('sm_responses')
      .select(`*, scenario:sm_scenarios(id, title, prompt, tags, type, unit_id, unit:sm_units(title, slug))`)
      .order('created_at', { ascending: false })
      .limit(50)

    if (filter === 'low') query = query.lte('ai_score', 4)
    if (filter === 'flagged') query = query.eq('flagged', true)
    if (filter === 'unreviewed') query = query.is('reviewed_at', null)

    const { data, error } = await query
    if (!error) {
      setResponses(data || [])
      setReviewedCount((data || []).filter(r => r.reviewed_at).length)
    }
    setLoading(false)
  }

  async function submitReview(responseId) {
    const updates = {}
    if (reviewScore !== null) updates.lead_score = reviewScore
    if (reviewNote.trim()) updates.lead_feedback = reviewNote.trim()
    updates.reviewed_by = userId
    updates.reviewed_at = new Date().toISOString()

    const { error } = await supabase.from('sm_responses').update(updates).eq('id', responseId)
    if (!error) {
      setExpandedId(null); setReviewNote(''); setReviewScore(null); loadResponses()
    }
  }

  async function toggleFlag(responseId, currentFlag) {
    await supabase.from('sm_responses').update({ flagged: !currentFlag }).eq('id', responseId)
    loadResponses()
  }

  const scoreColor = (score) => {
    if (score >= 7) return tk.green
    if (score >= 4) return tk.amber
    return tk.red
  }

  const scoreEmoji = (score) => {
    if (score >= 8) return '🔥'
    if (score >= 6) return '👍'
    if (score >= 4) return '😐'
    return '⚠️'
  }

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
        <div style={{ color: tk.textSub, fontSize: 14 }}>The Review Feed is only available to Lead SMs and Admins.</div>
      </div>
    )
  }

  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 16px' }}>
        {/* Header */}
        <div onClick={() => window.history.back()}
          style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Training
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', flexDirection: mob ? 'column' : 'row', justifyContent: 'space-between', alignItems: mob ? 'stretch' : 'flex-start', gap: mob ? 12 : 0 }}>
            <div>
              <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                Lead Review
              </div>
              <h1 style={{ color: tk.text, fontSize: mob ? 24 : 28, fontWeight: 700, margin: 0 }}>
                Review Feed
              </h1>
              <p style={{ color: tk.textSub, margin: '4px 0 0', fontSize: 14 }}>
                Review SM responses, add your feedback, and override AI scores.
              </p>
            </div>
            {/* Stats */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                padding: '8px 14px', borderRadius: 10, background: tk.surfaceEl,
                border: `1px solid ${tk.borderMed}`, textAlign: 'center',
              }}>
                <div style={{ color: tk.text, fontSize: 20, fontWeight: 800 }}>{responses.length}</div>
                <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Responses</div>
              </div>
              <div style={{
                padding: '8px 14px', borderRadius: 10, background: tk.greenSoft,
                border: `1px solid ${tk.green}20`, textAlign: 'center',
              }}>
                <div style={{ color: tk.green, fontSize: 20, fontWeight: 800 }}>{reviewedCount}</div>
                <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Reviewed</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: mob ? 6 : 8, marginTop: 20, flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All' },
              { key: 'unreviewed', label: '📬 Unreviewed' },
              { key: 'low', label: '🔴 Low (≤4)' },
              { key: 'flagged', label: '🚩 Flagged' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  padding: '8px 16px', borderRadius: 10, border: 'none',
                  background: filter === f.key ? `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)` : tk.surface,
                  color: filter === f.key ? tk.bg : tk.textSub,
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  boxShadow: filter === f.key ? tk.accentGlow : tk.cardShadow,
                  transition: 'all 0.15s ease',
                  border: filter === f.key ? 'none' : `1px solid ${tk.borderMed}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ color: tk.textSub, textAlign: 'center', padding: 80, fontSize: 14 }}>Loading responses...</div>
        ) : responses.length === 0 ? (
          <div style={{
            color: tk.textSub, textAlign: 'center', padding: 80,
            background: tk.surface, borderRadius: 14, border: `1px solid ${tk.borderMed}`,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: tk.text, marginBottom: 4 }}>No responses yet</div>
            <div style={{ fontSize: 13 }}>SMs need to complete some training first.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {responses.map(r => {
              const isExpanded = expandedId === r.id
              const scenario = r.scenario || {}
              const unit = scenario.unit || {}
              const isReviewed = !!r.reviewed_at

              return (
                <div key={r.id} style={{
                  background: tk.surface, borderRadius: 14,
                  border: `1px solid ${isReviewed ? tk.green + '20' : tk.borderMed}`,
                  overflow: 'hidden', boxShadow: tk.cardShadow,
                  transition: 'all 0.15s ease',
                }}>
                  {/* Header row */}
                  <div onClick={() => { setExpandedId(isExpanded ? null : r.id); if (!isExpanded) { setReviewNote(''); setReviewScore(null) } }}
                    style={{ padding: mob ? '12px 12px' : '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: mob ? 8 : 12 }}>
                    {/* AI Score badge */}
                    <div style={{
                      width: 48, height: 48, borderRadius: 12,
                      background: scoreColor(r.ai_score) + '15',
                      border: `1px solid ${scoreColor(r.ai_score)}30`,
                      color: scoreColor(r.ai_score),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 18, flexShrink: 0,
                    }}>
                      {r.ai_score}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: tk.text, fontWeight: 600, fontSize: 14 }}>
                        {scoreEmoji(r.ai_score)} {scenario.title || 'Unknown Scenario'}
                      </div>
                      <div style={{ color: tk.textSub, fontSize: 12, marginTop: 3 }}>
                        {unit.title || ''} · {new Date(r.created_at).toLocaleDateString()} · {userNames[r.user_id] || 'Unknown SM'}
                      </div>
                    </div>

                    {/* Review status */}
                    {!mob && (isReviewed ? (
                      <div style={{
                        padding: '4px 10px', borderRadius: 8,
                        background: tk.greenSoft, color: tk.green,
                        fontSize: 11, fontWeight: 700,
                      }}>
                        ✓ Reviewed {r.lead_score ? `(${r.lead_score}/10)` : ''}
                      </div>
                    ) : (
                      <div style={{
                        padding: '4px 10px', borderRadius: 8,
                        background: tk.amberSoft, color: tk.amber,
                        fontSize: 11, fontWeight: 700,
                      }}>
                        Needs Review
                      </div>
                    ))}

                    {/* Flag */}
                    <button onClick={(e) => { e.stopPropagation(); toggleFlag(r.id, r.flagged) }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 18, padding: 4, opacity: r.flagged ? 1 : 0.25,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      🚩
                    </button>

                    <span style={{ color: tk.textMute, fontSize: 16, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                      ▼
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ padding: mob ? '0 12px 16px' : '0 18px 20px', borderTop: `1px solid ${tk.border}` }}>
                      {/* Scenario */}
                      <Section label="Scenario" tk={tk}>
                        <div style={{ color: tk.text, fontSize: 14, lineHeight: 1.6 }}>{scenario.prompt}</div>
                        {scenario.tags && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                            {scenario.tags.map(tag => (
                              <span key={tag} style={{
                                padding: '2px 8px', borderRadius: 6, background: tk.surfaceEl,
                                color: tk.textSub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                              }}>{tag.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                        )}
                      </Section>

                      {/* SM's Response */}
                      <Section label="SM's Response" tk={tk}>
                        <div style={{
                          color: tk.text, fontSize: 14, lineHeight: 1.7,
                          background: tk.bg, padding: 16, borderRadius: 10,
                          whiteSpace: 'pre-wrap', border: `1px solid ${tk.border}`,
                        }}>
                          {r.response_text}
                        </div>
                      </Section>

                      {/* AI Evaluation */}
                      <Section label={`AI Evaluation — ${r.ai_score}/10`} tk={tk}>
                        {r.ai_tldr && (
                          <div style={{
                            color: scoreColor(r.ai_score), fontWeight: 600,
                            fontSize: 15, marginBottom: 10, fontStyle: 'italic',
                          }}>
                            "{r.ai_tldr}"
                          </div>
                        )}
                        <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                          {r.ai_feedback}
                        </div>

                        {/* Strengths / Gaps */}
                        <div style={{ display: 'flex', flexDirection: mob ? 'column' : 'row', gap: mob ? 8 : 16, marginTop: 14 }}>
                          {r.ai_strengths && r.ai_strengths.length > 0 && (
                            <div style={{ flex: 1, padding: 12, borderRadius: 10, background: tk.greenSoft }}>
                              <div style={{ fontSize: 10, color: tk.green, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strengths</div>
                              {r.ai_strengths.map((s, i) => (
                                <div key={i} style={{ color: tk.text, fontSize: 12, marginBottom: 3 }}>✓ {s}</div>
                              ))}
                            </div>
                          )}
                          {r.ai_gaps && r.ai_gaps.length > 0 && (
                            <div style={{ flex: 1, padding: 12, borderRadius: 10, background: tk.redSoft }}>
                              <div style={{ fontSize: 10, color: tk.red, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gaps</div>
                              {r.ai_gaps.map((g, i) => (
                                <div key={i} style={{ color: tk.text, fontSize: 12, marginBottom: 3 }}>✗ {g}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </Section>

                      {/* Previous lead review */}
                      {r.lead_feedback && (
                        <div style={{
                          margin: '16px 0', padding: 16, borderRadius: 12,
                          background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
                        }}>
                          <div style={{ color: tk.accent, fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Lead Review {r.lead_score != null ? `— ${r.lead_score}/10` : ''}
                          </div>
                          <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.6 }}>{r.lead_feedback}</div>
                        </div>
                      )}

                      {/* Review form */}
                      <div style={{
                        margin: '16px 0 0', padding: 18, borderRadius: 12,
                        background: tk.surfaceEl, border: `1px solid ${tk.borderMed}`,
                      }}>
                        <div style={{ color: tk.text, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                          Your Review
                        </div>

                        {/* Score override */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
                            Score Override (optional)
                          </div>
                          <div style={{ display: 'flex', gap: mob ? 4 : 5, flexWrap: 'wrap' }}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n => (
                              <button key={n} onClick={() => setReviewScore(reviewScore === n ? null : n)}
                                style={{
                                  width: mob ? 30 : 34, height: mob ? 30 : 34, borderRadius: 8,
                                  border: `1px solid ${reviewScore === n ? scoreColor(n) : tk.border}`,
                                  cursor: 'pointer',
                                  background: reviewScore === n ? scoreColor(n) + '20' : tk.surface,
                                  color: reviewScore === n ? scoreColor(n) : tk.textMute,
                                  fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
                                }}
                              >{n}</button>
                            ))}
                          </div>
                        </div>

                        {/* Feedback */}
                        <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                          placeholder="Add your feedback for this SM..."
                          style={{
                            width: '100%', minHeight: 80, padding: 12,
                            borderRadius: 10, border: `1px solid ${tk.borderMed}`,
                            background: tk.surface, color: tk.text, fontSize: 13,
                            resize: 'vertical', fontFamily: 'inherit',
                            boxSizing: 'border-box', outline: 'none',
                            transition: 'border-color 0.15s, box-shadow 0.15s',
                          }}
                          onFocus={e => { e.target.style.borderColor = tk.accent; e.target.style.boxShadow = tk.inputGlow }}
                          onBlur={e => { e.target.style.borderColor = tk.borderMed; e.target.style.boxShadow = 'none' }}
                        />

                        {/* Voice + actions */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {supported && (
                              <VoiceMicButton isListening={isListening} onToggle={isListening ? stopListening : startListening} tk={tk} size={38} />
                            )}
                            {isListening && transcript && (
                              <span style={{ color: tk.accent, fontSize: 11, fontStyle: 'italic', opacity: 0.7 }}>
                                {transcript}...
                              </span>
                            )}
                          </div>

                          <button onClick={() => { submitReview(r.id); resetTranscript() }}
                            disabled={!reviewNote.trim() && reviewScore === null}
                            style={{
                              padding: '10px 22px', borderRadius: 10, border: 'none',
                              background: (!reviewNote.trim() && reviewScore === null) ? tk.border : `linear-gradient(135deg, ${tk.accent}, ${tk.accent}cc)`,
                              color: (!reviewNote.trim() && reviewScore === null) ? tk.textMute : tk.bg,
                              fontWeight: 700, fontSize: 13,
                              cursor: (!reviewNote.trim() && reviewScore === null) ? 'default' : 'pointer',
                              opacity: (!reviewNote.trim() && reviewScore === null) ? 0.5 : 1,
                              boxShadow: (!reviewNote.trim() && reviewScore === null) ? 'none' : tk.accentGlow,
                              transition: 'all 0.2s ease',
                            }}
                          >
                            Submit Review
                          </button>
                        </div>
                      </div>
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

function Section({ label, tk, children }) {
  return (
    <div style={{ margin: '16px 0' }}>
      <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
