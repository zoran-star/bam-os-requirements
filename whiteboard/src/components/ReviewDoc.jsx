import { useState, useCallback } from 'react'
import s from '../styles/ReviewDoc.module.css'

function getPhaseClass(phase) {
  if (phase === 'Onboarding') return s.pillGreen
  if (phase === 'First Week') return s.pillGold
  return s.pillGray
}

function getSourceClass(source) {
  if (source === 'AI-Suggested') return s.pillGold
  if (source === 'Auto-Detected' || source === 'Stripe Import') return s.pillBlue
  return s.pillOutline
}

export default function ReviewDoc({ sectionData, sessionId, state, onStateChange }) {
  const handleCheck = useCallback((itemId, checked) => {
    onStateChange(prev => ({ ...prev, [itemId]: { ...prev[itemId], checked } }))
  }, [onStateChange])

  const handleFeedback = useCallback((itemId, feedback) => {
    onStateChange(prev => ({ ...prev, [itemId]: { ...prev[itemId], feedback } }))
  }, [onStateChange])

  const handleSectionFeedback = useCallback((value) => {
    onStateChange(prev => ({ ...prev, _sectionFeedback: value }))
  }, [onStateChange])

  const hasTypes = sectionData.subsections.some(sub => sub.items.some(i => i.type))

  return (
    <div>
      <div className={s.intro}>
        <div className={s.introTitle}>{sectionData.title || sectionData.id}</div>
        <div className={s.introDesc}>{sectionData.desc}</div>
      </div>

      {hasTypes && (
        <div className={s.legend}>
          <strong>Legend:</strong> <span className={s.pillData} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Data Point</span> = collected during onboarding. <span className={s.pillFeature} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Feature</span> = product spec.
        </div>
      )}

      {sectionData.subsections.map(sub => (
        <div key={sub.id} className={s.subsection}>
          <div className={s.subTitle}>{sub.id}: {sub.title}</div>
          {sub.items.map(item => {
            const checked = state[item.id]?.checked || false
            const feedback = state[item.id]?.feedback || ''
            return (
              <div key={item.id} className={`${s.row} ${checked ? s.rowApproved : ''}`}>
                <div className={s.check}>
                  <input type="checkbox" checked={checked} onChange={e => handleCheck(item.id, e.target.checked)} />
                </div>
                <div className={s.content}>
                  <div className={s.top}>
                    <span className={s.id}>{item.id}</span>
                    <span className={s.itemTitle}>{item.title}</span>
                    {item.required && <span className={`${s.pill} ${s.pillGreen}`} style={{ fontSize: 9 }}>Required</span>}
                    {item.type === 'data' && <span className={`${s.pill} ${s.pillData}`} style={{ fontSize: 9 }}>Data Point</span>}
                    {item.type === 'feature' && <span className={`${s.pill} ${s.pillFeature}`} style={{ fontSize: 9 }}>Feature</span>}
                  </div>
                  <div className={s.desc}>{item.desc}</div>
                  <div className={s.tags}>
                    <span className={`${s.pill} ${getPhaseClass(item.phase)}`}>{item.phase}</span>
                    <span className={`${s.pill} ${getSourceClass(item.source)}`}>{item.source}</span>
                  </div>
                </div>
                <div className={s.feedback}>
                  <input
                    type="text"
                    placeholder="Feedback..."
                    value={feedback}
                    className={feedback ? s.hasText : ''}
                    onChange={e => handleFeedback(item.id, e.target.value)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <div className={s.sectionFeedback}>
        <label>Overall feedback on this section</label>
        <textarea
          placeholder="Anything missing, unclear, or that should be reorganized?"
          value={state._sectionFeedback || ''}
          onChange={e => handleSectionFeedback(e.target.value)}
        />
      </div>
    </div>
  )
}
