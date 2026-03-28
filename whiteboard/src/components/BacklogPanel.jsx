import useBacklog from '../hooks/useBacklog'
import s from '../styles/Backlog.module.css'

const statusClass = {
  'Proposed': s.pillProposed,
  'Approved': s.pillApproved,
  'Done': s.pillDone,
}

export default function BacklogPanel({ onClose }) {
  const { backlog, loading } = useBacklog()

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} onClick={e => e.stopPropagation()}>
        <div className={s.header}>
          <div className={s.title}>Backlog</div>
          <button className={s.close} onClick={onClose}>&times;</button>
        </div>

        {loading && <div className={s.empty}>Loading...</div>}
        {!loading && backlog.length === 0 && <div className={s.empty}>No backlog items yet</div>}

        {backlog.map(item => (
          <div key={item.id} className={s.item}>
            <div className={s.itemTitle}>{item.title}</div>
            <div className={s.itemDesc}>{item.description}</div>
            <div className={s.itemMeta}>
              <span className={`${s.pill} ${statusClass[item.status] || s.pillType}`}>{item.status}</span>
              <span className={`${s.pill} ${s.pillType}`}>{item.changeType}</span>
              {item.target && <span className={`${s.pill} ${s.pillType}`}>{item.target}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
