import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { pointInRect, distToSegment, resolveRect, routeEdge } from './mm-geometry'

const COLORS = ['#FFFFFF', '#FFE49B', '#FFC2BD', '#C3E8B6', '#B7D6FF', '#E2C2FF']
const FONT_MIN = 10
const FONT_MAX = 72
const uid = () => crypto.randomUUID()

export default function MindMap({ onClose }) {
  const [doc, setDoc] = useState({ nodes: [], edges: [] })
  const [view, setView] = useState({ x: 200, y: 160, scale: 1 })
  const [tool, setTool] = useState('select') // select | box | text | connector
  const [sel, setSel] = useState(null) // { type:'node'|'edge', id }
  const [editing, setEditing] = useState(null) // node id being text-edited
  const [pending, setPending] = useState(null) // live connector being drawn

  const vpRef = useRef(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const viewRef = useRef(view)
  viewRef.current = view
  const drag = useRef(null)
  const pointers = useRef(new Map())
  const saveTimer = useRef(null)
  const loaded = useRef(false)

  const nodeMap = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes])

  // ---- load + autosave ----
  useEffect(() => {
    supabase
      .from('playground_scenes')
      .select('doc')
      .eq('key', 'mindmap')
      .single()
      .then(({ data }) => {
        if (data?.doc) setDoc({ nodes: data.doc.nodes || [], edges: data.doc.edges || [] })
        loaded.current = true
      })
  }, [])

  useEffect(() => {
    if (!loaded.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      supabase
        .from('playground_scenes')
        .update({ doc, updated_at: new Date().toISOString() })
        .eq('key', 'mindmap')
        .then(() => {})
    }, 500)
  }, [doc])

  // ---- coordinate transforms ----
  function toWorld(clientX, clientY) {
    const r = vpRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale }
  }
  function toScreen(p) {
    const v = viewRef.current
    return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y }
  }

  // ---- doc mutations ----
  const update = (fn) => setDoc((d) => fn(structuredClone(d)))
  function patchNode(id, patch) {
    update((d) => {
      const n = d.nodes.find((n) => n.id === id)
      if (n) Object.assign(n, patch)
      return d
    })
  }
  function patchEdge(id, patch) {
    update((d) => {
      const e = d.edges.find((e) => e.id === id)
      if (e) Object.assign(e, patch)
      return d
    })
  }
  function addNode(type, world) {
    const id = uid()
    const node =
      type === 'text'
        ? { id, type, x: world.x, y: world.y, w: 160, h: 44, text: 'Text', fontSize: 20, fill: 'none', color: '#1a1a1a' }
        : { id, type: 'box', x: world.x - 80, y: world.y - 40, w: 160, h: 80, text: '', fontSize: 16, fill: '#FFE49B', color: '#1a1a1a' }
    update((d) => {
      d.nodes.push(node)
      return d
    })
    setSel({ type: 'node', id })
    setEditing(id)
    setTool('select')
  }
  function deleteSel() {
    if (!sel) return
    update((d) => {
      if (sel.type === 'node') {
        d.nodes = d.nodes.filter((n) => n.id !== sel.id)
        d.edges = d.edges.filter((e) => e.from?.node !== sel.id && e.to?.node !== sel.id)
      } else {
        d.edges = d.edges.filter((e) => e.id !== sel.id)
      }
      return d
    })
    setSel(null)
  }

  // ---- hit testing ----
  function hitNode(world) {
    const ns = docRef.current.nodes
    for (let i = ns.length - 1; i >= 0; i--) if (pointInRect(world, ns[i])) return ns[i]
    return null
  }
  function hitEdge(clientX, clientY) {
    const sp = { x: clientX - vpRef.current.getBoundingClientRect().left, y: clientY - vpRef.current.getBoundingClientRect().top }
    for (const e of docRef.current.edges) {
      const a = resolveRect(e.from, nodeMap)
      const b = resolveRect(e.to, nodeMap)
      if (!a || !b) continue
      const { pts } = routeEdge(a, b, e)
      const screen = pts.map(toScreen)
      for (let i = 0; i < screen.length - 1; i++) if (distToSegment(sp, screen[i], screen[i + 1]) < 9) return e
    }
    return null
  }

  // ---- zoom ----
  function zoomAround(px, py, factor) {
    setView((v) => {
      const scale = Math.min(2.5, Math.max(0.25, v.scale * factor))
      const k = scale / v.scale
      const r = vpRef.current.getBoundingClientRect()
      const ox = px - r.left
      const oy = py - r.top
      return { scale, x: ox - (ox - v.x) * k, y: oy - (oy - v.y) * k }
    })
  }
  function onWheel(e) {
    e.preventDefault()
    zoomAround(e.clientX, e.clientY, 1 - e.deltaY * 0.0015)
  }

  // ---- pointer interaction (all routed through the viewport) ----
  function onPointerDown(e) {
    if (editing) return
    vpRef.current.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      drag.current = { mode: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y), startScale: viewRef.current.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      return
    }
    const world = toWorld(e.clientX, e.clientY)

    if (tool === 'box' || tool === 'text') {
      addNode(tool, world)
      return
    }
    if (tool === 'connector') {
      const n = hitNode(world)
      const from = n ? { node: n.id } : { x: world.x, y: world.y }
      drag.current = { mode: 'connect', from }
      setPending({ from, x: world.x, y: world.y })
      return
    }

    // select tool
    if (sel?.type === 'node') {
      const n = nodeMap.get(sel.id)
      if (n) {
        const br = { x: n.x + n.w, y: n.y + n.h }
        if (Math.hypot(world.x - br.x, world.y - br.y) * viewRef.current.scale < 14) {
          drag.current = { mode: 'resize', id: n.id, ox: n.x, oy: n.y }
          return
        }
      }
    }
    if (sel?.type === 'edge') {
      const e2 = docRef.current.edges.find((e) => e.id === sel.id)
      const a = resolveRect(e2?.from, nodeMap)
      const b = resolveRect(e2?.to, nodeMap)
      if (a && b) {
        const { elbow, axis } = routeEdge(a, b, e2)
        const es = toScreen(elbow)
        const r = vpRef.current.getBoundingClientRect()
        if (Math.hypot(e.clientX - r.left - es.x, e.clientY - r.top - es.y) < 14) {
          drag.current = { mode: 'elbow', id: e2.id, axis }
          return
        }
      }
    }

    const n = hitNode(world)
    if (n) {
      setSel({ type: 'node', id: n.id })
      drag.current = { mode: 'move', id: n.id, dx: world.x - n.x, dy: world.y - n.y, moved: false }
      return
    }
    const edge = hitEdge(e.clientX, e.clientY)
    if (edge) {
      setSel({ type: 'edge', id: edge.id })
      drag.current = null
      return
    }
    // empty → deselect + pan
    setSel(null)
    drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y }
  }

  function onPointerMove(e) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = drag.current
    if (!g) return
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAround(g.cx, g.cy, (dist / g.startDist) / (viewRef.current.scale / g.startScale))
      return
    }
    if (g.mode === 'pan') {
      setView((v) => ({ ...v, x: g.ox + (e.clientX - g.sx), y: g.oy + (e.clientY - g.sy) }))
      return
    }
    const world = toWorld(e.clientX, e.clientY)
    if (g.mode === 'move') {
      g.moved = true
      patchNode(g.id, { x: world.x - g.dx, y: world.y - g.dy })
    } else if (g.mode === 'resize') {
      const n = nodeMap.get(g.id)
      patchNode(g.id, { w: Math.max(40, world.x - g.ox), h: Math.max(28, world.y - g.oy) })
    } else if (g.mode === 'connect') {
      setPending((p) => ({ ...p, x: world.x, y: world.y }))
    } else if (g.mode === 'elbow') {
      patchEdge(g.id, { axis: g.axis, split: g.axis === 'x' ? world.x : world.y })
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    const g = drag.current
    if (g?.mode === 'connect') {
      const world = toWorld(e.clientX, e.clientY)
      const n = hitNode(world)
      const to = n ? { node: n.id } : { x: world.x, y: world.y }
      const sameNode = n && g.from.node === n.id
      if (!sameNode) update((d) => (d.edges.push({ id: uid(), from: g.from, to }), d))
      setPending(null)
    }
    if (pointers.current.size === 0) drag.current = null
  }

  function onDoubleClick(e) {
    const n = hitNode(toWorld(e.clientX, e.clientY))
    if (n) {
      setSel({ type: 'node', id: n.id })
      setEditing(n.id)
    }
  }

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e) {
      if (editing) {
        if (e.key === 'Escape') setEditing(null)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        deleteSel()
      } else if (e.key === 'v') setTool('select')
      else if (e.key === 'b') setTool('box')
      else if (e.key === 't') setTool('text')
      else if (e.key === 'c') setTool('connector')
      else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, sel])

  const selNode = sel?.type === 'node' ? nodeMap.get(sel.id) : null

  // ---- render edges (screen space) ----
  const edgeEls = doc.edges.map((edge) => {
    const a = resolveRect(edge.from, nodeMap)
    const b = resolveRect(edge.to, nodeMap)
    if (!a || !b) return null
    const { pts, elbow } = routeEdge(a, b, edge)
    const sp = pts.map(toScreen)
    const d = sp.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
    const selected = sel?.type === 'edge' && sel.id === edge.id
    const es = toScreen(elbow)
    return (
      <g key={edge.id}>
        <path d={d} className="mm-edge-hit" />
        <path d={d} className={`mm-edge${selected ? ' sel' : ''}`} markerEnd="url(#mm-arrow)" />
        {selected && <circle cx={es.x} cy={es.y} r="6" className="mm-elbow" />}
      </g>
    )
  })

  let pendingEl = null
  if (pending) {
    const a = resolveRect(pending.from, nodeMap)
    const b = { x: pending.x, y: pending.y, w: 0, h: 0 }
    if (a) {
      const { pts } = routeEdge(a, b, null)
      const d = pts.map(toScreen).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
      pendingEl = <path d={d} className="mm-edge pending" markerEnd="url(#mm-arrow)" />
    }
  }

  return (
    <div className={`mm-root tool-${tool}`}>
      <div
        ref={vpRef}
        className="mm-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <svg className="mm-edges">
          <defs>
            <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#2b2b2b" />
            </marker>
          </defs>
          {edgeEls}
          {pendingEl}
        </svg>

        <div
          className="mm-canvas"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {doc.nodes.map((n) => {
            const selected = sel?.type === 'node' && sel.id === n.id
            return (
              <div
                key={n.id}
                className={`mm-node ${n.type}${selected ? ' sel' : ''}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h, background: n.type === 'text' ? 'transparent' : n.fill, fontSize: n.fontSize, color: n.color }}
              >
                {editing === n.id ? (
                  <textarea
                    autoFocus
                    defaultValue={n.text}
                    style={{ fontSize: n.fontSize }}
                    onBlur={(e) => {
                      patchNode(n.id, { text: e.target.value })
                      setEditing(null)
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="mm-node-text">{n.text || (n.type === 'box' ? '' : '')}</span>
                )}
                {selected && tool === 'select' && <span className="mm-resize" />}
              </div>
            )
          })}
        </div>
      </div>

      <button className="mm-back" onClick={onClose} aria-label="back">‹</button>

      {/* main tool pill */}
      <div className="mm-toolbar">
        {[
          ['select', '⌖', 'Select'],
          ['box', '▢', 'Box'],
          ['text', 'T', 'Text'],
          ['connector', '↳', 'Arrow'],
        ].map(([t, icon, label]) => (
          <button key={t} className={`mm-tool${tool === t ? ' active' : ''}`} title={label} onClick={() => setTool(t)}>
            {icon}
          </button>
        ))}
      </div>

      {/* contextual controls for the selected node */}
      {selNode && (
        <div className="mm-context">
          <button className="mm-ctl" title="Smaller text" onClick={() => patchNode(selNode.id, { fontSize: Math.max(FONT_MIN, selNode.fontSize - 2) })}>A−</button>
          <span className="mm-fs">{selNode.fontSize}</span>
          <button className="mm-ctl" title="Bigger text" onClick={() => patchNode(selNode.id, { fontSize: Math.min(FONT_MAX, selNode.fontSize + 2) })}>A+</button>
          {selNode.type === 'box' && (
            <span className="mm-swatches">
              {COLORS.map((c) => (
                <button key={c} className={`mm-swatch${selNode.fill === c ? ' on' : ''}`} style={{ background: c }} onClick={() => patchNode(selNode.id, { fill: c })} />
              ))}
            </span>
          )}
          <button className="mm-ctl danger" title="Delete" onClick={deleteSel}>🗑</button>
        </div>
      )}
      {sel?.type === 'edge' && (
        <div className="mm-context">
          <span className="mm-hint-text">drag the dot to bend · </span>
          <button className="mm-ctl danger" onClick={deleteSel}>🗑 delete arrow</button>
        </div>
      )}
    </div>
  )
}
