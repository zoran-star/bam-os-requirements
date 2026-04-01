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

  // Count statuses for summary
  const allItems = sectionData.subsections.flatMap(sub => sub.items)
  const approved = allItems.filter(i => i.status === 'approved').length
  const withFeedback = allItems.filter(i => i.status === 'feedback').length
  const pending = allItems.filter(i => i.status === 'pending' || !i.status).length

  return (
    <div>
      {(sectionData.title || sectionData.desc || allItems.length > 0) && (
        <div className={s.intro}>
          {sectionData.title && <div className={s.introTitle}>{sectionData.title}</div>}
          {sectionData.desc && <div className={s.introDesc}>{sectionData.desc}</div>}
          {allItems.length > 0 && (
            <div className={s.statusSummary}>
              <span className={s.summaryTotal}>{allItems.length} items</span>
              {approved > 0 && <span className={s.summaryApproved}>{approved} approved</span>}
              {withFeedback > 0 && <span className={s.summaryFeedback}>{withFeedback} with feedback</span>}
              {pending > 0 && <span className={s.summaryPending}>{pending} pending</span>}
            </div>
          )}
        </div>
      )}

      {hasTypes && (
        <div className={s.legend}>
          <strong>Legend:</strong> <span className={s.pillData} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Data Point</span> = collected during onboarding. <span className={s.pillFeature} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Feature</span> = product spec.
        </div>
      )}

      {sectionData.subsections.map(sub => (
        <div key={sub.title || sub.id} className={s.subsection}>
          <div className={s.subTitle}>{sub.title || `${sub.id}: ${sub.title}`}</div>
          {sub.items.map(item => {
            const checked = state[item.id]?.checked || false
            const userFeedback = state[item.id]?.feedback || ''
            const statusClass = item.status === 'approved' ? s.rowApproved
              : item.status === 'feedback' ? s.rowFeedback
              : ''
            return (
              <div key={item.id} className={`${s.row} ${statusClass} ${checked ? s.rowChecked : ''}`}>
                <div className={s.check}>
                  <input type="checkbox" checked={checked} onChange={e => handleCheck(item.id, e.target.checked)} />
                </div>
                <div className={s.content}>
                  <div className={s.top}>
                    <span className={s.id}>{item.id}</span>
                    <span className={s.itemTitle}>{item.title}</span>
                    {item.status === 'approved' && <span className={`${s.pill} ${s.pillApproved}`} style={{ fontSize: 9 }}>Approved</span>}
                    {item.status === 'feedback' && <span className={`${s.pill} ${s.pillFeedbackBadge}`} style={{ fontSize: 9 }}>Has Feedback</span>}
                    {item.status === 'pending' && <span className={`${s.pill} ${s.pillPending}`} style={{ fontSize: 9 }}>Pending</span>}
                    {item.required && <span className={`${s.pill} ${s.pillGreen}`} style={{ fontSize: 9 }}>Required</span>}
                    {item.type === 'data' && <span className={`${s.pill} ${s.pillData}`} style={{ fontSize: 9 }}>Data Point</span>}
                    {item.type === 'feature' && <span className={`${s.pill} ${s.pillFeature}`} style={{ fontSize: 9 }}>Feature</span>}
                  </div>
                  <div className={s.desc}>{item.description || item.desc}</div>
                  <div className={s.tags}>
                    <span className={`${s.pill} ${getPhaseClass(item.phase)}`}>{item.phase}</span>
                    <span className={`${s.pill} ${getSourceClass(item.source)}`}>{item.source}</span>
                  </div>
                  {item.feedback && (
                    <div className={s.ownerFeedback}>
                      <span className={s.ownerFeedbackLabel}>Zoran's feedback:</span>
                      <span className={s.ownerFeedbackText}>{item.feedback}</span>
                    </div>
                  )}
                </div>
                <div className={s.feedback}>
                  <input
                    type="text"
                    placeholder="Add note..."
                    value={userFeedback}
                    className={userFeedback ? s.hasText : ''}
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
