import { useState, useCallback, useMemo } from 'react'
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

function DecidedItem({ item }) {
  const isApproved = item.status === 'approved'
  return (
    <div className={`${s.decidedRow} ${isApproved ? s.decidedApproved : s.decidedFeedback}`}>
      <div className={s.decidedIcon}>
        {isApproved ? '✓' : '✎'}
      </div>
      <div className={s.decidedContent}>
        <div className={s.decidedTop}>
          <span className={s.id}>{item.id}</span>
          <span className={s.itemTitle}>{item.title}</span>
          <span className={`${s.pill} ${isApproved ? s.pillApproved : s.pillFeedbackBadge}`}>
            {isApproved ? 'Approved' : 'Feedback Given'}
          </span>
        </div>
        <div className={s.decidedDesc}>{item.description || item.desc}</div>
        {item.feedback && (
          <div className={s.ownerFeedback}>
            <span className={s.ownerFeedbackLabel}>Your decision:</span>
            <span className={s.ownerFeedbackText}>{item.feedback}</span>
          </div>
        )}
        {isApproved && !item.feedback && (
          <div className={s.ownerFeedbackApproved}>
            <span className={s.ownerFeedbackLabel}>Your decision:</span>
            <span className={s.ownerFeedbackText}>Approved as-is</span>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingItem({ item, checked, feedback, onCheck, onFeedback }) {
  return (
    <div className={`${s.row} ${checked ? s.rowChecked : ''}`}>
      <div className={s.pendingActions}>
        <button
          className={`${s.actionBtn} ${s.approveBtn} ${checked ? s.activatedBtn : ''}`}
          onClick={() => onCheck(item.id, !checked)}
          title="Approve"
        >
          ✓
        </button>
      </div>
      <div className={s.content}>
        <div className={s.top}>
          <span className={s.id}>{item.id}</span>
          <span className={s.itemTitle}>{item.title}</span>
          {item.required && <span className={`${s.pill} ${s.pillGreen}`} style={{ fontSize: 9 }}>Required</span>}
          {item.type === 'data' && <span className={`${s.pill} ${s.pillData}`} style={{ fontSize: 9 }}>Data Point</span>}
          {item.type === 'feature' && <span className={`${s.pill} ${s.pillFeature}`} style={{ fontSize: 9 }}>Feature</span>}
        </div>
        <div className={s.desc}>{item.description || item.desc}</div>
        <div className={s.tags}>
          <span className={`${s.pill} ${getPhaseClass(item.phase)}`}>{item.phase}</span>
          <span className={`${s.pill} ${getSourceClass(item.source)}`}>{item.source}</span>
        </div>
      </div>
      <div className={s.feedback}>
        <input
          type="text"
          placeholder="Give feedback..."
          value={feedback}
          className={feedback ? s.hasText : ''}
          onChange={e => onFeedback(item.id, e.target.value)}
        />
      </div>
    </div>
  )
}

export default function ReviewDoc({ sectionData, sessionId, sessionDescription, state, onStateChange }) {
  const [collapsedSections, setCollapsedSections] = useState({})

  const handleCheck = useCallback((itemId, checked) => {
    onStateChange(prev => ({ ...prev, [itemId]: { ...prev[itemId], checked } }))
  }, [onStateChange])

  const handleFeedback = useCallback((itemId, feedback) => {
    onStateChange(prev => ({ ...prev, [itemId]: { ...prev[itemId], feedback } }))
  }, [onStateChange])

  const handleSectionFeedback = useCallback((value) => {
    onStateChange(prev => ({ ...prev, _sectionFeedback: value }))
  }, [onStateChange])

  const toggleCollapse = useCallback((key) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const hasTypes = sectionData.subsections?.some(sub => sub.items?.some(i => i.type))

  // Separate decided vs pending across all items
  const allItems = useMemo(() => {
    return (sectionData.subsections || []).flatMap(sub => sub.items || [])
  }, [sectionData])

  const decidedCount = allItems.filter(i => i.status === 'approved' || i.status === 'feedback').length
  const pendingCount = allItems.filter(i => !i.status || i.status === 'pending').length

  return (
    <div>
      {sessionDescription && (
        <div className={s.intro}>
          <div className={s.introTitle}>Why this session matters</div>
          <div className={s.introDesc}>{sessionDescription}</div>
          {allItems.length > 0 && (
            <div className={s.statusSummary}>
              <span className={s.summaryTotal}>{allItems.length} items</span>
              {decidedCount > 0 && <span className={s.summaryDecided}>{decidedCount} decided</span>}
            </div>
          )}
        </div>
      )}

      {hasTypes && (
        <div className={s.legend}>
          <strong>Legend:</strong>{' '}
          <span className={s.pillData} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Data Point</span> = collected during onboarding.{' '}
          <span className={s.pillFeature} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, display: 'inline' }}>Feature</span> = product spec.
        </div>
      )}

      {(sectionData.subsections || []).map(sub => {
        const subItems = sub.items || []
        const decided = subItems.filter(i => i.status === 'approved' || i.status === 'feedback')
        const pending = subItems.filter(i => !i.status || i.status === 'pending')
        const decidedKey = `decided_${sub.title}`
        const decidedCollapsed = collapsedSections[decidedKey] !== false && decided.length > 0 // collapsed by default if has decided items

        return (
          <div key={sub.title || sub.id} className={s.subsection}>
            <div className={s.subTitle}>{sub.title || `${sub.id}: ${sub.title}`}</div>

            {/* Decided items — collapsible */}
            {decided.length > 0 && (
              <div className={s.decidedSection}>
                <button
                  className={s.decidedToggle}
                  onClick={() => toggleCollapse(decidedKey)}
                >
                  <span className={s.decidedToggleIcon}>{decidedCollapsed ? '▸' : '▾'}</span>
                  <span className={s.decidedToggleLabel}>
                    {decided.length} decided
                    <span className={s.decidedToggleSub}>
                      {decided.filter(i => i.status === 'approved').length} approved, {decided.filter(i => i.status === 'feedback').length} with feedback
                    </span>
                  </span>
                </button>
                {!decidedCollapsed && (
                  <div className={s.decidedList}>
                    {decided.map(item => (
                      <DecidedItem key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending items — always visible */}
            {pending.length > 0 && (
              <div className={s.pendingSection}>
                {pending.map(item => {
                  const checked = state[item.id]?.checked || false
                  const fb = state[item.id]?.feedback || ''
                  return (
                    <PendingItem
                      key={item.id}
                      item={item}
                      checked={checked}
                      feedback={fb}
                      onCheck={handleCheck}
                      onFeedback={handleFeedback}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

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
