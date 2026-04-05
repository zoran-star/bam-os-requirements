import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateSession } from '../lib/api'
import s from '../styles/Card.module.css'

const OWNERS = ['Zoran', 'Cole', 'Mike', 'Anyone']

export default function Card({ session, onUpdate }) {
  const navigate = useNavigate()
  const [owner, setOwner] = useState((session.assignedTo || [])[0] || '')

  useEffect(() => {
    setOwner((session.assignedTo || [])[0] || '')
  }, [session.assignedTo])

  const statusClass = session.status === 'Complete' ? s.cardComplete
    : session.status === 'In Progress' ? s.cardInProgress : ''

  const handleOwnerChange = async (e) => {
    e.stopPropagation()
    const val = e.target.value
    setOwner(val)
    const next = val ? [val] : []
    try {
      await updateSession(session.sessionId, { assignedTo: next })
      if (onUpdate) onUpdate()
    } catch (err) {
      console.error('Failed to update owner:', err)
      setOwner((session.assignedTo || [])[0] || '')
    }
  }

  return (
    <div className={`${s.card} ${statusClass}`} onClick={() => navigate(`/session/${session.sessionId}`)}>
      <div className={s.top}>
        <span className={s.id}>{session.sessionId}</span>
      </div>
      <div className={s.title}>{session.title}</div>
      <div className={s.desc}>{session.description}</div>
      {session.status === 'Complete' && session.completedDate && (
        <div className={s.dates}>
          <span className={s.dateCompleted}>Completed {session.completedDate}</span>
        </div>
      )}
      <div className={s.bottom}>
        <span className={`${s.pill} ${s.pillType}`}>{session.sessionType}</span>
        <select
          className={s.ownerSelect}
          value={owner}
          onClick={(e) => e.stopPropagation()}
          onChange={handleOwnerChange}
        >
          <option value="">Unassigned</option>
          {OWNERS.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
