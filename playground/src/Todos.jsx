import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

const TABLE = 'playground_todos'
const INDENT = 26 // px per nesting level
const SLIDE_THRESHOLD = 45 // px slide before it indents/outdents

export default function Todos({ title = 'TODO', onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState({})
  const [newSection, setNewSection] = useState('')

  // Horizontal slide-to-indent state.
  const drag = useRef(null)
  const suppressClick = useRef(false)
  const [slide, setSlide] = useState({ id: null, dx: 0 })

  useEffect(() => {
    load()
    const ch = supabase
      .channel('pg_todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('section_position', { ascending: true })
      .order('position', { ascending: true })
    if (!error) setItems(data || [])
    setLoading(false)
  }

  const sections = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!map.has(it.section)) map.set(it.section, { name: it.section, pos: it.section_position, items: [] })
      map.get(it.section).items.push(it)
    }
    return [...map.values()].sort((a, b) => a.pos - b.pos)
  }, [items])

  // Max depth an item may have = depth of the item directly above it, + 1.
  function maxDepthFor(item) {
    const sec = sections.find((s) => s.name === item.section)
    const idx = sec.items.findIndex((i) => i.id === item.id)
    return idx <= 0 ? 0 : sec.items[idx - 1].depth + 1
  }

  async function changeDepth(item, dir) {
    let next = Math.max(0, item.depth + dir)
    if (dir > 0) next = Math.min(next, maxDepthFor(item))
    if (next === item.depth) return
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, depth: next } : i)))
    await supabase.from(TABLE).update({ depth: next, updated_at: new Date().toISOString() }).eq('id', item.id)
  }

  async function toggle(item) {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
    await supabase.from(TABLE).update({ done: !item.done, updated_at: new Date().toISOString() }).eq('id', item.id)
  }

  async function remove(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await supabase.from(TABLE).delete().eq('id', item.id)
  }

  async function addItem(section, sectionPosition) {
    const label = (adding[section] || '').trim()
    if (!label) return
    const position = items.filter((i) => i.section === section).length
    setAdding((a) => ({ ...a, [section]: '' }))
    await supabase.from(TABLE).insert({ section, section_position: sectionPosition, label, position })
    load()
  }

  async function addSection() {
    const name = newSection.trim()
    if (!name) return
    const nextPos = sections.length ? Math.max(...sections.map((s) => s.pos)) + 1 : 0
    setNewSection('')
    await supabase.from(TABLE).insert({ section: name, section_position: nextPos, label: 'new item', position: 0 })
    load()
  }

  // ---- slide gesture ----
  function rowDown(e, item) {
    drag.current = { id: item.id, item, startX: e.clientX, startY: e.clientY, mode: null }
  }
  function rowMove(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.mode === null) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        d.mode = 'horiz'
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } else if (Math.abs(dy) > 10) {
        d.mode = 'vert' // let the list scroll
      }
    }
    if (d.mode === 'horiz') setSlide({ id: d.id, dx: Math.max(-90, Math.min(90, dx)) })
  }
  function rowUp(e) {
    const d = drag.current
    drag.current = null
    if (d && d.mode === 'horiz') {
      const dx = e.clientX - d.startX
      if (dx > SLIDE_THRESHOLD) changeDepth(d.item, +1)
      else if (dx < -SLIDE_THRESHOLD) changeDepth(d.item, -1)
      suppressClick.current = true // don't also toggle
    }
    setSlide({ id: null, dx: 0 })
  }

  if (loading) return <div className="loading">loading…</div>

  return (
    <div className="board">
      <header className="board-head">
        <button className="back" onClick={onClose} aria-label="back">‹</button>
        <h1 className="board-title">{title}</h1>
      </header>

      <p className="slide-hint">slide a task right → to nest it · left ← to un-nest</p>

      {sections.map((sec) => (
        <section key={sec.name} className="todo-section">
          <h2 className="section-label">{sec.name}</h2>
          <ul>
            {sec.items.map((item) => (
              <li
                key={item.id}
                className={`${item.done ? 'done' : ''} ${item.depth > 0 ? 'child' : ''}`}
                style={{
                  marginLeft: item.depth * INDENT,
                  transform: slide.id === item.id ? `translateX(${slide.dx}px)` : undefined,
                }}
                onPointerDown={(e) => rowDown(e, item)}
                onPointerMove={rowMove}
                onPointerUp={rowUp}
                onPointerCancel={rowUp}
              >
                <button
                  className="circle"
                  aria-label="toggle"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggle(item)}
                />
                <span className="label" onClick={() => toggle(item)}>
                  {item.label}
                </span>
                <button
                  className="del"
                  aria-label="delete"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => remove(item)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <input
            className="add-input"
            placeholder="+ add"
            value={adding[sec.name] || ''}
            onChange={(e) => setAdding((a) => ({ ...a, [sec.name]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && addItem(sec.name, sec.pos)}
          />
        </section>
      ))}

      <div className="new-section">
        <input
          placeholder="+ new section"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSection()}
        />
      </div>
    </div>
  )
}
