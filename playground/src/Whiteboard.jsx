import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import TodoPreview from './TodoPreview.jsx'

const VIEW_KEY = 'pg_view'
const MIN_SCALE = 0.4
const MAX_SCALE = 2.5
const TAP_SLOP = 6 // px of movement still counts as a tap, not a drag

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY)) || { x: 0, y: 0, scale: 1 }
  } catch {
    return { x: 0, y: 0, scale: 1 }
  }
}

export default function Whiteboard({ onOpen }) {
  const [widgets, setWidgets] = useState([])
  const [view, setView] = useState(loadView)
  const viewRef = useRef(view)
  viewRef.current = view
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets

  const pointers = useRef(new Map()) // pointerId -> {x, y}
  const gesture = useRef(null) // active pan / card / pinch gesture

  useEffect(() => {
    load()
    const ch = supabase
      .channel('pg_widgets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playground_widgets' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view))
  }, [view])

  async function load() {
    const { data } = await supabase.from('playground_widgets').select('*')
    if (data) setWidgets(data)
  }

  // ---- zoom helpers ----
  function zoomAround(px, py, factor) {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  function onWheel(e) {
    e.preventDefault()
    zoomAround(e.clientX, e.clientY, 1 - e.deltaY * 0.0015)
  }

  // ---- pointer gestures (pan / pinch / card move+tap) ----
  function onPointerDown(e, widget) {
    e.target.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        type: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: viewRef.current.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      }
      return
    }

    if (widget) {
      gesture.current = {
        type: 'card',
        id: widget.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: widget.x,
        origY: widget.y,
        moved: false,
        widget,
      }
    } else {
      gesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, origX: viewRef.current.x, origY: viewRef.current.y }
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return

    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAround(g.cx, g.cy, (dist / g.startDist) / (viewRef.current.scale / g.startScale))
      return
    }

    if (g.type === 'pan') {
      setView((v) => ({ ...v, x: g.origX + (e.clientX - g.startX), y: g.origY + (e.clientY - g.startY) }))
    } else if (g.type === 'card') {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true
      const s = viewRef.current.scale
      const nx = g.origX + dx / s
      const ny = g.origY + dy / s
      setWidgets((ws) => ws.map((w) => (w.id === g.id ? { ...w, x: nx, y: ny } : w)))
    }
  }

  async function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return

    if (g.type === 'card') {
      if (!g.moved) {
        onOpen(g.widget) // tap → zoom in
      } else {
        const moved = widgetsRef.current.find((w) => w.id === g.id)
        if (moved) {
          await supabase
            .from('playground_widgets')
            .update({ x: moved.x, y: moved.y, updated_at: new Date().toISOString() })
            .eq('id', g.id)
        }
      }
    }
    if (pointers.current.size === 0) gesture.current = null
  }

  const { x, y, scale } = view

  return (
    <div
      className="wb-viewport"
      onWheel={onWheel}
      onPointerDown={(e) => onPointerDown(e, null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="wb-canvas" style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
        {widgets.map((w) => (
          <div
            key={w.id}
            className="wb-card"
            style={{ left: w.x, top: w.y, width: w.w, height: w.h, background: w.color }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onPointerDown(e, w)
            }}
          >
            {w.type === 'todo' ? (
              <TodoPreview title={w.title} />
            ) : w.type === 'slack' ? (
              <div className="slack-preview">
                <div className="sp-mark">#</div>
                <div className="sp-title">{w.title}</div>
                <div className="sp-sub">summarize your Slack since a time</div>
              </div>
            ) : (
              <div className="wb-card-title">{w.title}</div>
            )}
          </div>
        ))}
      </div>

      <div className="wb-hint">drag to pan · pinch / scroll to zoom · tap a card to open</div>
    </div>
  )
}
