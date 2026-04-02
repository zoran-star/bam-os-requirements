import { useNavigate } from 'react-router-dom'
import { updateSession } from '../lib/api'
import s from '../styles/Card.module.css'

const OWNERS = ['Zoran', 'Cole']

export default function Card({ session, onUpdate }) {
  const navigate = useNavigate()
  const statusClass = session.status === 'Complete' ? s.cardComplete
    : session.status === 'In Progress' ? s.cardInProgress : ''

  const handleOwnerClick = async (e, name) => {
    e.stopPropagation()
    const current = session.assignedTo || []
    const next = current.includes(name)
      ? current.filter(n => n !== name)
      : [...current, name]
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
      <div className={s.bottom}>
        <span className={`${s.pill} ${s.pillType}`}>{session.sessionType}</span>
        {OWNERS.map(name => {
          const active = (session.assignedTo || []).includes(name)
          return (
            <button
              key={name}
              className={`${s.ownerBtn} ${active ? s.ownerActive : ''}`}
              onClick={(e) => handleOwnerClick(e, name)}
              title={active ? `Remove ${name}` : `Assign ${name}`}
            >
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
