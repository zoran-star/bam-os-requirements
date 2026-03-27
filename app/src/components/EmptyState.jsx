export default function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 24px', textAlign: 'center', minHeight: 240,
    }}>
      {icon && <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>{icon}</div>}
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tp)', marginBottom: 6 }}>{title}</div>
      {description && <div style={{ fontSize: 13, color: 'var(--ts)', maxWidth: 320, lineHeight: 1.5 }}>{description}</div>}
      {action && onAction && (
        <button onClick={onAction} style={{
          marginTop: 16, padding: '10px 24px', background: 'var(--gold)', color: '#fff',
          border: 'none', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'var(--ff)',
        }}>{action}</button>
      )}
    </div>
  )
}
