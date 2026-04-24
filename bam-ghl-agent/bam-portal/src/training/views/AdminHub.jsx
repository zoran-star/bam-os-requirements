import { T } from '../../tokens/tokens'
import { useMobile } from '../hooks/useMobile'

const cards = [
  {
    icon: '⚡',
    title: 'SM Training',
    desc: 'Go through today\'s training scenarios as an SM.',
    path: '/training',
    color: '#60A5FA',
  },
  {
    icon: '👥',
    title: 'Team Dashboard',
    desc: 'View each SM\'s scores, progress, strengths, and response history.',
    path: '/training/team',
    color: '#F472B6',
  },
  {
    icon: '📋',
    title: 'Review Feed',
    desc: 'Review SM responses, override AI scores, and leave feedback.',
    path: '/training/review',
    color: '#D4CF8A',
  },
  {
    icon: '🧠',
    title: 'Calibrate AI',
    desc: 'Answer scenarios to set the gold standard the AI evaluates against.',
    path: '/training/calibrate',
    color: '#A78BFA',
  },
  {
    icon: '🎙️',
    title: 'Add Scenario',
    desc: 'Capture a real-world problem and your solution — becomes a training scenario.',
    path: '/training/add-scenario',
    color: '#34D399',
  },
  {
    icon: '📊',
    title: 'Question Feedback',
    desc: 'See which scenarios need improvement based on quality ratings.',
    path: '/training/scenario-feedback',
    color: '#F59E0B',
  },
]

export default function AdminHub({ role, navigate }) {
  const tk = T.dark
  const mob = useMobile()

  if (role !== 'lead_sm' && role !== 'admin') {
    return (
      <div style={{ background: tk.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <div style={{ color: tk.text, fontSize: 18, fontWeight: 600 }}>Access Restricted</div>
        <div style={{ color: tk.textSub, fontSize: 14 }}>Admin tools are only available to Lead SMs and Admins.</div>
      </div>
    )
  }

  return (
    <div style={{ background: tk.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: mob ? '24px 12px' : '32px 16px' }}>
        <div onClick={() => navigate('/training')}
          style={{ color: tk.textMute, fontSize: 12, cursor: 'pointer', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          ← Back to Training
        </div>

        <div style={{ color: tk.accent, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Admin Tools
        </div>
        <h1 style={{ color: tk.text, fontSize: mob ? 24 : 28, fontWeight: 700, margin: '0 0 8px' }}>
          Lead SM Hub
        </h1>
        <p style={{ color: tk.textSub, fontSize: 14, lineHeight: 1.6, margin: '0 0 28px' }}>
          Manage the training system — review responses, calibrate the AI, and add real-world scenarios.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.map((card, i) => (
            <div key={card.path} onClick={() => navigate(card.path)}
              style={{
                background: tk.surface, borderRadius: 14, padding: '20px 22px',
                border: `1px solid ${tk.borderMed}`, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 16,
                boxShadow: tk.cardShadow, transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = card.color + '60'; e.currentTarget.style.boxShadow = tk.cardHover }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = tk.borderMed; e.currentTarget.style.boxShadow = tk.cardShadow }}
            >
              <div style={{
                width: mob ? 44 : 52, height: mob ? 44 : 52, borderRadius: mob ? 12 : 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: card.color + '12', fontSize: mob ? 22 : 26, flexShrink: 0,
              }}>
                {card.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: tk.text, fontWeight: 600, fontSize: 16, marginBottom: 3 }}>{card.title}</div>
                <div style={{ color: tk.textSub, fontSize: 13, lineHeight: 1.4 }}>{card.desc}</div>
              </div>
              <span style={{ color: tk.textMute, fontSize: 18 }}>→</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
