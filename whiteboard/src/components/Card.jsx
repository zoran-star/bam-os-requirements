import { useNavigate } from 'react-router-dom'
import { updateSession } from '../lib/api'
import s from '../styles/Card.module.css'

const OWNERS = ['Zoran', 'Cole', 'Mike', 'Anyone']

export default function Card({ session, onUpdate }) {
  const navigate = useNavigate()
  const statusClass = session.status === 'Complete' ? s.cardComplete
    : session.status === 'In Progress' ? s.cardInProgress : ''

  const handleOwnerChange = async (e) => {
    e.stopPropagation()
    const val = e.target.value
    const next = val ? [val] : []
    try {
      await updateSession(session.sessionId, { assignedTo: next })
      if (onUpdate) onUpdate()
    } catch (err) {
      console.error('Failed to update owner:', err)
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
          value={(session.assignedTo || [])[0] || ''}
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
