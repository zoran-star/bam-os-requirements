import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const TABLE = 'playground_todos'

export default function Todos() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState({}) // { [section]: draftText }
  const [newSection, setNewSection] = useState('')

  // Initial load + live sync across devices via Supabase realtime.
  useEffect(() => {
    load()
    const channel = supabase
      .channel('playground_todos_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
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

  // Group items into ordered sections.
  const sections = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!map.has(it.section)) {
        map.set(it.section, { name: it.section, pos: it.section_position, items: [] })
      }
      map.get(it.section).items.push(it)
    }
    return [...map.values()].sort((a, b) => a.pos - b.pos)
  }, [items])

  async function toggle(item) {
    // Optimistic flip, then persist.
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
    await supabase
      .from(TABLE)
      .update({ done: !item.done, updated_at: new Date().toISOString() })
      .eq('id', item.id)
  }

  async function remove(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await supabase.from(TABLE).delete().eq('id', item.id)
  }

  async function addItem(section, sectionPosition) {
    const label = (adding[section] || '').trim()
    if (!label) return
    const siblings = items.filter((i) => i.section === section)
    const position = siblings.length
    setAdding((a) => ({ ...a, [section]: '' }))
    await supabase
      .from(TABLE)
      .insert({ section, section_position: sectionPosition, label, position })
    load()
  }

  async function addSection() {
    const name = newSection.trim()
    if (!name) return
    const nextPos = sections.length ? Math.max(...sections.map((s) => s.pos)) + 1 : 0
    setNewSection('')
    // A section is created by inserting its first placeholder-free row request:
    // we just open an empty group by adding a starter item the user can edit/remove.
    await supabase
      .from(TABLE)
      .insert({ section: name, section_position: nextPos, label: 'new item', position: 0 })
    load()
  }

  if (loading) return <div className="loading">loading…</div>

  return (
    <div className="board">
      <h1 className="board-title">TODO</h1>

      {sections.map((sec) => (
        <section key={sec.name} className="todo-section">
          <h2 className="section-label">{sec.name}</h2>
          <ul>
            {sec.items.map((item) => (
              <li key={item.id} className={item.done ? 'done' : ''}>
                <button
                  className="circle"
                  aria-label="toggle"
                  onClick={() => toggle(item)}
                />
                <span className="label" onClick={() => toggle(item)}>
                  {item.label}
                </span>
                <button className="del" aria-label="delete" onClick={() => remove(item)}>
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
