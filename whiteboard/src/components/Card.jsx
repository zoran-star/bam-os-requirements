import { useNavigate } from 'react-router-dom'
import s from '../styles/Card.module.css'

export default function Card({ session }) {
  const navigate = useNavigate()
  const statusClass = session.status === 'Complete' ? s.cardComplete
    : session.status === 'In Progress' ? s.cardInProgress : ''

  return (
    <div className={`${s.card} ${statusClass}`} onClick={() => navigate(`/session/${session.sessionId}`)}>
      <div className={s.top}>
        <span className={s.id}>{session.sessionId}</span>
      </div>
      <div className={s.title}>{session.title}</div>
      <div className={s.desc}>{session.description}</div>
      <div className={s.bottom}>
        <span className={`${s.pill} ${s.pillType}`}>{session.sessionType}</span>
        {session.assignedTo?.map(name => (
          <span key={name} className={`${s.pill} ${s.pillAssigned}`}>{name}</span>
        ))}
      </div>
    </div>
  )
}
