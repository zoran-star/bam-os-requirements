import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Inline scenario feedback — lets Mike (or any admin) rate the quality of a scenario/question
 * and leave notes on how to improve it. Stored on sm_scenario_feedback table.
 *
 * Collapsed by default, expands on click. Shows existing feedback if already submitted.
 */
export default function ScenarioFeedback({ scenarioId, userId, tk }) {
  const [expanded, setExpanded] = useState(false)
  const [rating, setRating] = useState(null) // 'good' | 'okay' | 'bad'
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [existing, setExisting] = useState(null)

  useEffect(() => {
    setExpanded(false)
    setRating(null)
    setComment('')
    setSaved(false)
    setExisting(null)
    loadExisting()
  }, [scenarioId])

  async function loadExisting() {
    const { data } = await supabase
      .from('sm_scenario_feedback')
      .select('*')
      .eq('scenario_id', scenarioId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (data) {
      setExisting(data)
      setRating(data.rating)
      setComment(data.comment || '')
    }
  }

  async function handleSave() {
    if (!rating) return
    setSaving(true)
    const payload = {
      scenario_id: scenarioId,
      user_id: userId,
      rating,
      comment: comment.trim() || null,
    }

    if (existing) {
      await supabase
        .from('sm_scenario_feedback')
        .update({ rating, comment: comment.trim() || null })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('sm_scenario_feedback')
        .insert(payload)
    }

    setSaving(false)
    setSaved(true)
    setExisting({ ...existing, ...payload })
    setTimeout(() => setSaved(false), 2000)
  }

  const ratingOptions = [
    { key: 'good', emoji: '👍', label: 'Good question', color: tk.green },
    { key: 'okay', emoji: '🤷', label: 'Okay', color: tk.amber },
    { key: 'bad', emoji: '👎', label: 'Needs work', color: tk.red },
  ]

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Collapsed trigger */}
      {!expanded && (
        <div
          onClick={() => setExpanded(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: existing ? (existing.rating === 'good' ? tk.greenSoft : existing.rating === 'bad' ? tk.redSoft : tk.amberSoft) : tk.surfaceEl,
            border: `1px solid ${existing ? (existing.rating === 'good' ? tk.green + '30' : existing.rating === 'bad' ? tk.red + '30' : tk.amber + '30') : tk.borderMed}`,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: existing ? (existing.rating === 'good' ? tk.green : existing.rating === 'bad' ? tk.red : tk.amber) : tk.textMute,
            transition: 'all 0.15s',
          }}
        >
          {existing ? (
            <>
              {ratingOptions.find(r => r.key === existing.rating)?.emoji} Feedback submitted
              {existing.comment && <span style={{ opacity: 0.6 }}> · has notes</span>}
            </>
          ) : (
            <>💬 Rate this question</>
          )}
        </div>
      )}

      {/* Expanded feedback form */}
      {expanded && (
        <div style={{
          background: tk.surface, borderRadius: 12, padding: 16,
          border: `1px solid ${tk.borderMed}`, boxShadow: tk.cardShadow,
          animation: 'calSlideIn 0.2s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ color: tk.textSub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Question Quality Feedback
            </div>
            <div
              onClick={() => setExpanded(false)}
              style={{ color: tk.textMute, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
            >
              ×
            </div>
          </div>

          {/* Rating buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {ratingOptions.map(opt => (
              <button key={opt.key}
                onClick={() => setRating(opt.key)}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${rating === opt.key ? opt.color : tk.borderMed}`,
                  background: rating === opt.key ? opt.color + '15' : 'transparent',
                  color: rating === opt.key ? opt.color : tk.textSub,
                  fontSize: 12, fontWeight: 600, textAlign: 'center',
                  transition: 'all 0.15s',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ fontSize: 20 }}>{opt.emoji}</span>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Comment textarea */}
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Optional: How could this question be improved? Is it confusing, too vague, not realistic enough?"
            style={{
              width: '100%', minHeight: 60, padding: 10, borderRadius: 8,
              border: `1px solid ${tk.borderMed}`, background: tk.bg,
              color: tk.text, fontSize: 13, fontFamily: 'inherit',
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              lineHeight: 1.5,
            }}
            onFocus={e => { e.target.style.borderColor = tk.accent }}
            onBlur={e => { e.target.style.borderColor = tk.borderMed }}
          />

          {/* Save button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 10 }}>
            {saved && (
              <span style={{ color: tk.green, fontSize: 12, fontWeight: 600 }}>✓ Saved</span>
            )}
            <button onClick={handleSave} disabled={!rating || saving}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: rating && !saving ? tk.accent : tk.surfaceEl,
                color: rating && !saving ? tk.bg : tk.textMute,
                cursor: rating && !saving ? 'pointer' : 'default',
                fontSize: 13, fontWeight: 700,
                opacity: rating && !saving ? 1 : 0.5,
                transition: 'all 0.15s',
              }}
            >
              {saving ? 'Saving...' : existing ? 'Update Feedback' : 'Save Feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
