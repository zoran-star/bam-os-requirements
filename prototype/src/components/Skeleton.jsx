export function SkeletonLine({ width = '100%', height = 14, style }) {
  return (
    <div style={{
      width, height, borderRadius: 6,
      background: 'linear-gradient(90deg, var(--surf3) 25%, var(--surf2) 50%, var(--surf3) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      ...style,
    }} />
  )
}

export function SkeletonCard({ style }) {
  return (
    <div style={{
      padding: 20, borderRadius: 16, background: 'var(--surf)',
      border: '1px solid var(--border)', ...style,
    }}>
      <SkeletonLine width="60%" height={16} style={{ marginBottom: 12 }} />
      <SkeletonLine width="90%" style={{ marginBottom: 8 }} />
      <SkeletonLine width="40%" />
    </div>
  )
}

// Add shimmer keyframe to document if not present
if (typeof document !== 'undefined' && !document.getElementById('skeleton-style')) {
  const style = document.createElement('style')
  style.id = 'skeleton-style'
  style.textContent = `@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`
  document.head.appendChild(style)
}
