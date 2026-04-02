import Card from './Card'
import s from '../styles/Board.module.css'

const COLUMNS = [
  { key: 'To Do', label: 'Not Ready' },
  { key: 'In Progress', label: 'Ready' },
  { key: 'Complete', label: 'Complete' },
]

export default function Board({ sessions, onRefresh }) {
  return (
    <div className={s.board}>
      {COLUMNS.map(col => {
        const cards = sessions
          .filter(ses => ses.status === col.key)
          .sort((a, b) => a.sectionNumber - b.sectionNumber)
        return (
          <div key={col.key} className={s.column}>
            <div className={s.columnHeader}>
              <span className={s.columnTitle}>{col.label}</span>
              <span className={s.columnCount}>{cards.length}</span>
            </div>
            <div className={s.cards}>
              {cards.length === 0 && <div className={s.empty}>No sessions</div>}
              {cards.map(ses => <Card key={ses.sessionId} session={ses} onUpdate={onRefresh} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
