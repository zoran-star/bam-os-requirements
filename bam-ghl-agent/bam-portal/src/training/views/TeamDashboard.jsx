import { useState, useEffect, useRef } from 'react'
import { T } from '../../tokens/tokens'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../hooks/useMobile'

const dashKeyframes = `
@keyframes dashSlideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes dashFadeIn { from { opacity: 0; } to { opacity: 1; } }
`

export default function TeamDashboard({ role, userId, navigate }) {
  const [members, setMembers] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [memberResponses, setMemberResponses] = useState([])
  const [memberStats, setMemberStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const styleRef = useRef(false)

  const tk = T.dark
  const mob = useMobile()

  useEffect(() => {
    if (!styleRef.current) {
      const s = document.createElement('style')
      s.textContent = dashKeyframes
      document.head.appendChild(s)
      styleRef.current = true
    }
    loadTeam()
  }, [])

  async function loadTeam() {
    // Get all SMs
    const { data: users } = await supabase
      .from('sm_user_roles')
      .select('user_id, display_name, role')
      .order('display_name')

    if (!users || users.length === 0) {
      setMembers([])
      setLoading(false)
      return
    }

    // Get all responses for stats
    const { data: allResponses } = await supabase
      .from('sm_responses')
      .select('user_id, ai_score, created_at, reviewed_at')
      .order('created_at', { ascending: false })

    // Get all sessions for streaks
    const { data: allSessions } = await supabase
      .from('sm_sessions')
      .select('user_id, date, is_complete, quick_fire_completed, deep_situation_completed')
      .order('date', { ascending: false })

    // Build per-user stats
    const enriched = users.map(u => {
      const responses = (allResponses || []).filter(r => r.user_id === u.user_id)
      const sessions = (allSessions || []).filter(s => s.user_id === u.user_id)
      const scores = responses.map(r => r.ai_score).filter(Boolean)
      const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null
      const totalCompleted = responses.length
      const reviewed = responses.filter(r => r.reviewed_at).length
      const last7 = responses.filter(r => {
        const d = new Date(r.created_at)
        const week = new Date(); week.setDate(week.getDate() - 7)
        return d >= week
      })
      const weekScores = last7.map(r => r.ai_score).filter(Boolean)
      const weekAvg = weekScores.length > 0 ? (weekScores.reduce((a, b) => a + b, 0) / weekScores.length) : null

      // Streak
      let streak = 0
      const completeSessions = sessions.filter(s => s.is_complete)
      if (completeSessions.length > 0) {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        for (let i = 0; i < completeSessions.length; i++) {
          const d = new Date(completeSessions[i].date); d.setHours(0, 0, 0, 0)
          const expected = new Date(today); expected.setDate(expected.getDate() - i)
          if (d.getTime() === expected.getTime()) streak++
          else break
        }
      }

      // Last active
      const lastResponse = responses[0]
      const lastActive = lastResponse ? new Date(lastResponse.created_at) : null

      return {
        ...u,
        avgScore,
        weekAvg,
        totalCompleted,
        reviewed,
        streak,
        lastActive,
        thisWeek: last7.length,
        highScores: scores.filter(s => s >= 7).length,
        lowScores: scores.filter(s => s <= 4).length,
      }
    })

    setMembers(enriched)
    setLoading(false)
  }

  async function selectMember(member) {
    setSelectedMember(member)
    setDetailLoading(true)

    // Load their responses with scenario info
    const { data: responses } = await supabase
      .from('sm_responses')
      .select('*, scenario:sm_scenarios(title, prompt, tags, type, unit_id, unit:sm_units(title, slug))')
      .eq('user_id', member.user_id)
      .order('created_at', { ascending: false })
      .limit(30)

    // Load their progress
    const { data: progress } = await supabase
      .from('sm_progress')
      .select('*, unit:sm_units(title, icon, slug)')
      .eq('user_id', member.user_id)

    // Build tag performance
    const tagScores = {}
    for (const r of (responses || [])) {
      const tags = r.scenario?.tags || []
      for (const tag of tags) {
        if (!tagScores[tag]) tagScores[tag] = []
        if (r.ai_score) tagScores[tag].push(r.ai_score)
      }
    }
    const tagPerformance = Object.entries(tagScores)
      .map(([tag, scores]) => ({
        tag,
        avg: scores.reduce((a, b) => a + b, 0) / scores.length,
        count: scores.length,
      }))
      .sort((a, b) => a.avg - b.avg)

    // Score trend (last 10 responses, oldest first)
    const recent10 = (responses || []).slice(0, 10).reverse()

    setMemberStats({ progress: progress || [], tagPerformance, scoreTrend: recent10 })
    setMemberResponses(responses || [])
    setDetailLoading(false)
  }

  const scoreColor = (score) => {
    if (score >= 7) return tk.green
    if (score >= 4) return tk.amber
    return tk.red
  }

  const timeAgo = (date) => {
    if (!date) return 'Never'
    const diff = Date.now() - date.getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    return `${Math.floor(days / 7)}w ago`
  }

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: tk.textSub, fontSize: 14 }}>Loading team data...</div>
      </div>
    )
  }

  // ─── MEMBER DETAIL VIEW ───
  if (selectedMember) {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '28px 16px' }}>
          {/* Back */}
          <div onClick={() => { setSelectedMember(null); setMemberResponses([]); setMemberStats(null) }}
            style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            ← Back to Team
          </div>

          {/* Member header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28,
            animation: 'dashSlideUp 0.3s ease',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${tk.accent}30, ${tk.accent}10)`,
              color: tk.accent, fontSize: 22, fontWeight: 800,
              border: `2px solid ${tk.accentBorder}`,
            }}>
              {selectedMember.display_name?.[0] || '?'}
            </div>
            <div>
              <h1 style={{ color: tk.text, fontSize: mob ? 20 : 24, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                {selectedMember.display_name}
              </h1>
              <div style={{ color: tk.textSub, fontSize: mob ? 12 : 13, marginTop: 2 }}>
                {selectedMember.role === 'lead_sm' ? 'Lead SM' : selectedMember.role === 'admin' ? 'Admin' : 'SM'}
                {' · '}{selectedMember.totalCompleted} responses{mob ? '' : ` · Last active ${timeAgo(selectedMember.lastActive)}`}
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div style={{ color: tk.textSub, textAlign: 'center', padding: 60 }}>Loading performance data...</div>
          ) : (
            <>
              {/* Stats grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: mob ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: mob ? 8 : 10,
                marginBottom: mob ? 20 : 28, animation: 'dashSlideUp 0.35s ease',
              }}>
                <MiniStat label="Avg Score" value={selectedMember.avgScore ? selectedMember.avgScore.toFixed(1) : '--'} color={scoreColor(selectedMember.avgScore || 0)} tk={tk} />
                <MiniStat label="This Week" value={selectedMember.thisWeek} color={tk.blue} tk={tk} />
                <MiniStat label="Streak" value={`${selectedMember.streak}d`} color={tk.amber} tk={tk} />
                <MiniStat label="High Scores" value={selectedMember.highScores} suffix={`/${selectedMember.totalCompleted}`} color={tk.green} tk={tk} />
              </div>

              {/* Score trend */}
              {memberStats.scoreTrend.length > 1 && (
                <div style={{
                  background: tk.surface, borderRadius: 14, padding: '20px 22px', marginBottom: 16,
                  boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
                  animation: 'dashSlideUp 0.4s ease',
                }}>
                  <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                    Score Trend (Last 10)
                  </div>
                  <ScoreTrendChart scores={memberStats.scoreTrend} tk={tk} />
                </div>
              )}

              {/* Two columns: Tag performance + Unit progress */}
              <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: mob ? 10 : 12, marginBottom: mob ? 20 : 24, animation: 'dashSlideUp 0.45s ease' }}>
                {/* Strengths & Weaknesses */}
                <div style={{
                  background: tk.surface, borderRadius: 14, padding: '20px 22px',
                  boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
                }}>
                  <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                    Skills Breakdown
                  </div>
                  {memberStats.tagPerformance.length === 0 ? (
                    <div style={{ color: tk.textMute, fontSize: 12 }}>No data yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {memberStats.tagPerformance.slice(0, 8).map(tp => (
                        <div key={tp.tag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              color: tk.text, fontSize: 11, fontWeight: 600, marginBottom: 3,
                              textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {tp.tag.replace(/_/g, ' ')}
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: tk.surfaceEl, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 2, width: `${tp.avg * 10}%`,
                                background: `linear-gradient(90deg, ${scoreColor(tp.avg)}, ${scoreColor(tp.avg)}cc)`,
                              }} />
                            </div>
                          </div>
                          <span style={{ color: scoreColor(tp.avg), fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
                            {tp.avg.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Unit progress */}
                <div style={{
                  background: tk.surface, borderRadius: 14, padding: '20px 22px',
                  boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
                }}>
                  <div style={{ color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                    Unit Progress
                  </div>
                  {(memberStats.progress || []).length === 0 ? (
                    <div style={{ color: tk.textMute, fontSize: 12 }}>No progress yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {memberStats.progress.map(p => {
                        const unit = p.unit || {}
                        const statusColor = p.status === 'completed' || p.status === 'certified' ? tk.green : p.status === 'in_progress' ? tk.accent : tk.textMute
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16 }}>{unit.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: tk.text, fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {unit.title}
                              </div>
                            </div>
                            <span style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 9, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: statusColor + '15', color: statusColor,
                            }}>
                              {p.status?.replace('_', ' ')}
                            </span>
                            {p.ai_competency_score > 0 && (
                              <span style={{ color: tk.textSub, fontSize: 11, fontWeight: 600 }}>{Math.round(p.ai_competency_score)}%</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent responses */}
              <div style={{ animation: 'dashSlideUp 0.5s ease' }}>
                <div style={{
                  color: tk.textSub, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  Recent Responses
                  <div style={{ flex: 1, height: 1, background: tk.border }} />
                </div>

                {memberResponses.length === 0 ? (
                  <div style={{
                    background: tk.surface, borderRadius: 14, padding: 40, textAlign: 'center',
                    boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
                  }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                    <div style={{ color: tk.textSub, fontSize: 13 }}>No responses yet</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {memberResponses.map(r => {
                      const scenario = r.scenario || {}
                      const unit = scenario.unit || {}
                      return (
                        <ResponseRow key={r.id} r={r} scenario={scenario} unit={unit} tk={tk} scoreColor={scoreColor} />
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── TEAM LIST VIEW ───
  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '28px 16px' }}>
        <div onClick={() => navigate('/training/admin')}
          style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Admin
        </div>

        <div style={{ color: tk.accent, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
          Team Performance
        </div>
        <h1 style={{ color: tk.text, fontSize: 28, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          SM Dashboard
        </h1>
        <p style={{ color: tk.textSub, fontSize: 14, margin: '0 0 28px' }}>
          Track each SM's training progress, scores, and areas for improvement.
        </p>

        {/* Team summary row */}
        {members.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: mob ? 6 : 10,
            marginBottom: mob ? 20 : 28, animation: 'dashSlideUp 0.3s ease',
          }}>
            <MiniStat
              label="Team Avg"
              value={(() => {
                const withScores = members.filter(m => m.avgScore)
                return withScores.length ? (withScores.reduce((a, m) => a + m.avgScore, 0) / withScores.length).toFixed(1) : '--'
              })()}
              color={tk.accent} tk={tk}
            />
            <MiniStat
              label="Active This Week"
              value={members.filter(m => m.thisWeek > 0).length}
              suffix={`/${members.length}`}
              color={tk.green} tk={tk}
            />
            <MiniStat
              label="Total Responses"
              value={members.reduce((a, m) => a + m.totalCompleted, 0)}
              color={tk.blue} tk={tk}
            />
          </div>
        )}

        {/* Member cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.length === 0 ? (
            <div style={{
              background: tk.surface, borderRadius: 14, padding: 48, textAlign: 'center',
              boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
            }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>👥</div>
              <div style={{ color: tk.text, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No SMs registered yet</div>
              <div style={{ color: tk.textSub, fontSize: 13 }}>Add users to sm_user_roles to get started.</div>
            </div>
          ) : (
            members.map((m, i) => (
              <div key={m.user_id} onClick={() => selectMember(m)}
                style={{
                  background: tk.surface, borderRadius: 14, padding: mob ? '14px 12px' : '18px 20px',
                  boxShadow: `0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px ${tk.borderMed}`,
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', gap: mob ? 10 : 14,
                  animation: `dashSlideUp 0.3s ease ${i * 0.04}s both`,
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px ${tk.accent}30`; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 2px 12px rgba(0,0,0,0.12), 0 0 0 1px ${tk.borderMed}`; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `linear-gradient(135deg, ${tk.accent}25, ${tk.accent}08)`,
                  color: tk.accent, fontSize: 17, fontWeight: 800, flexShrink: 0,
                  border: `1.5px solid ${tk.accentBorder}`,
                }}>
                  {m.display_name?.[0] || '?'}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: tk.text, fontSize: 15, fontWeight: 600 }}>{m.display_name}</span>
                    {m.role === 'lead_sm' && (
                      <span style={{ padding: '1px 7px', borderRadius: 6, background: tk.accentGhost, color: tk.accent, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Lead</span>
                    )}
                    {m.streak > 0 && (
                      <span style={{ fontSize: 12 }}>{'\u{1F525}'}{m.streak}</span>
                    )}
                  </div>
                  <div style={{ color: tk.textMute, fontSize: 11, marginTop: 2 }}>
                    {m.totalCompleted} responses · Last active {timeAgo(m.lastActive)}
                  </div>
                </div>

                {/* Score + week activity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: mob ? 8 : 12, flexShrink: 0 }}>
                  {/* Week activity dots — hide on mobile */}
                  <div style={{ display: mob ? 'none' : 'flex', gap: 2 }}>
                    {[6, 5, 4, 3, 2, 1, 0].map(daysAgo => {
                      const d = new Date(); d.setDate(d.getDate() - daysAgo)
                      const dateStr = d.toISOString().split('T')[0]
                      // Simple check: was there activity this day?
                      const hasActivity = m.lastActive && daysAgo === 0 && m.thisWeek > 0
                      return (
                        <div key={daysAgo} style={{
                          width: 6, height: 20, borderRadius: 2,
                          background: hasActivity || (m.thisWeek > daysAgo) ? tk.green + '60' : tk.surfaceEl,
                        }} />
                      )
                    })}
                  </div>

                  {/* Avg score */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: m.avgScore ? scoreColor(m.avgScore) + '15' : tk.surfaceEl,
                    border: `1px solid ${m.avgScore ? scoreColor(m.avgScore) + '25' : tk.border}`,
                    color: m.avgScore ? scoreColor(m.avgScore) : tk.textMute,
                    fontSize: 16, fontWeight: 800,
                  }}>
                    {m.avgScore ? m.avgScore.toFixed(1) : '--'}
                  </div>
                </div>

                <span style={{ color: tk.textMute, fontSize: 14 }}>→</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────

function MiniStat({ label, value, suffix, color, tk }) {
  return (
    <div style={{
      background: tk.surface, borderRadius: 12, padding: '14px 16px',
      boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px ${tk.borderMed}`,
    }}>
      <div style={{ color: tk.textMute, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ color, fontSize: 22, fontWeight: 800 }}>{value}</span>
        {suffix && <span style={{ color: tk.textMute, fontSize: 11, fontWeight: 600 }}>{suffix}</span>}
      </div>
    </div>
  )
}

function ScoreTrendChart({ scores, tk }) {
  const values = scores.map(r => r.ai_score || 0)
  const max = 10
  const height = 80
  const width = '100%'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {values.map((v, i) => {
        const pct = (v / max) * 100
        const color = v >= 7 ? tk.green : v >= 4 ? tk.amber : tk.red
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ color: tk.textSub, fontSize: 10, fontWeight: 600 }}>{v}</span>
            <div style={{
              width: '100%', borderRadius: 4, height: `${pct}%`, minHeight: 4,
              background: `linear-gradient(180deg, ${color}, ${color}80)`,
              transition: 'height 0.4s ease',
            }} />
          </div>
        )
      })}
    </div>
  )
}

function ResponseRow({ r, scenario, unit, tk, scoreColor }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: tk.surface, borderRadius: 12, overflow: 'hidden',
      boxShadow: `0 1px 6px rgba(0,0,0,0.1), 0 0 0 1px ${tk.borderMed}`,
    }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ padding: '14px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: scoreColor(r.ai_score) + '15',
          border: `1px solid ${scoreColor(r.ai_score)}25`,
          color: scoreColor(r.ai_score),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 15, flexShrink: 0,
        }}>
          {r.ai_score}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: tk.text, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scenario.title || 'Scenario'}
          </div>
          <div style={{ color: tk.textMute, fontSize: 11, marginTop: 2 }}>
            {unit.title || ''} · {scenario.type === 'quick_fire' ? '⚡' : '🎭'} · {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
        {r.reviewed_at && (
          <span style={{ padding: '2px 8px', borderRadius: 8, background: tk.greenSoft, color: tk.green, fontSize: 10, fontWeight: 700 }}>
            Reviewed
          </span>
        )}
        <span style={{
          color: tk.textMute, fontSize: 12, transition: 'transform 0.2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▼</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 18px 16px', borderTop: `1px solid ${tk.border}` }}>
          <div style={{ margin: '12px 0' }}>
            <div style={{ color: tk.textMute, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Scenario</div>
            <div style={{ color: tk.textSub, fontSize: 13, lineHeight: 1.5 }}>{scenario.prompt}</div>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ color: tk.textMute, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Their Response</div>
            <div style={{
              color: tk.text, fontSize: 13, lineHeight: 1.6, padding: 14, borderRadius: 10,
              background: tk.bg, border: `1px solid ${tk.border}`, whiteSpace: 'pre-wrap',
            }}>
              {r.response_text}
            </div>
          </div>
          {r.ai_feedback && (
            <div style={{ margin: '12px 0' }}>
              <div style={{ color: tk.textMute, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>AI Feedback</div>
              {r.ai_tldr && <div style={{ color: scoreColor(r.ai_score), fontSize: 13, fontWeight: 600, marginBottom: 6, fontStyle: 'italic' }}>"{r.ai_tldr}"</div>}
              <div style={{ color: tk.textSub, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r.ai_feedback}</div>
            </div>
          )}
          {r.lead_feedback && (
            <div style={{
              margin: '12px 0', padding: 14, borderRadius: 10,
              background: tk.accentGhost, border: `1px solid ${tk.accentBorder}`,
            }}>
              <div style={{ color: tk.accent, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                Lead Review {r.lead_score ? `— ${r.lead_score}/10` : ''}
              </div>
              <div style={{ color: tk.text, fontSize: 13, lineHeight: 1.5 }}>{r.lead_feedback}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
