import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Small read-only preview of the TODO board, shown on the whiteboard card.
export default function TodoPreview({ title }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    let alive = true
    supabase
      .from('playground_todos')
      .select('label, done, section, section_position, position')
      .order('section_position', { ascending: true })
      .order('position', { ascending: true })
      .then(({ data }) => alive && setItems(data || []))
    return () => {
      alive = false
    }
  }, [])

  const done = items.filter((i) => i.done).length

  return (
    <div className="todo-preview">
      <div className="tp-head">
        <span className="tp-title">{title || 'TODO'}</span>
        <span className="tp-count">{items.length ? `${done}/${items.length}` : ''}</span>
      </div>
      <ul>
        {items.slice(0, 7).map((it, i) => (
          <li key={i} className={it.done ? 'done' : ''}>
            <span className="tp-dot" />
            <span className="tp-label">{it.label}</span>
          </li>
        ))}
        {items.length > 7 && <li className="tp-more">+{items.length - 7} more</li>}
      </ul>
    </div>
  )
}
