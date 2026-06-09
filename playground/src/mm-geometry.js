// Geometry helpers for the mind-map canvas.

export function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

// Resolve an edge endpoint ({node:id} or {x,y}) to a rect.
export function resolveRect(end, nodeMap) {
  if (!end) return null
  if (end.node) {
    const n = nodeMap.get(end.node)
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null
  }
  return { x: end.x, y: end.y, w: 0, h: 0 }
}

const cx = (r) => r.x + r.w / 2
const cy = (r) => r.y + r.h / 2

// Orthogonal (right-angle) route between two rects, with one draggable bend.
// `edge.split` + `edge.axis` store where the user dragged the middle segment.
export function routeEdge(a, b, edge) {
  const acx = cx(a), acy = cy(a), bcx = cx(b), bcy = cy(b)
  const dx = bcx - acx
  const dy = bcy - acy
  const horizontal = Math.abs(dx) >= Math.abs(dy)

  let pts, elbow, axis
  if (horizontal) {
    axis = 'x'
    const sa = { x: dx >= 0 ? a.x + a.w : a.x, y: acy }
    const ta = { x: dx >= 0 ? b.x : b.x + b.w, y: bcy }
    const mid = edge?.axis === 'x' && edge?.split != null ? edge.split : (sa.x + ta.x) / 2
    pts = [sa, { x: mid, y: sa.y }, { x: mid, y: ta.y }, ta]
    elbow = { x: mid, y: (sa.y + ta.y) / 2 }
  } else {
    axis = 'y'
    const sa = { x: acx, y: dy >= 0 ? a.y + a.h : a.y }
    const ta = { x: bcx, y: dy >= 0 ? b.y : b.y + b.h }
    const mid = edge?.axis === 'y' && edge?.split != null ? edge.split : (sa.y + ta.y) / 2
    pts = [sa, { x: sa.x, y: mid }, { x: ta.x, y: mid }, ta]
    elbow = { x: (sa.x + ta.x) / 2, y: mid }
  }
  return { pts, elbow, axis }
}
