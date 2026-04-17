import { useState } from 'react';
import { STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #5: Onboarding Flow
// Staff texts onboarding link to parent
// Parent completes: parent info, child info, plan selection, Stripe payment
// Stripe checkout built into FC

const ONBOARDING_LINKS = [
  { id: 'ol1', label: 'General Signup', url: 'https://bamgta.com/join', visits: 24, completions: 8, lastUsed: '2h ago' },
  { id: 'ol2', label: 'Trial Convert', url: 'https://bamgta.com/join?ref=trial', visits: 12, completions: 5, lastUsed: '1d ago' },
];

const RECENT_ONBOARDINGS = [
  { id: 'ro1', parentName: 'Carlos Martinez', childName: 'Ana Martinez', plan: 'Steady', status: 'completed', completedDate: '2026-01-15', sentBy: 's2' },
  { id: 'ro2', parentName: 'Wei Chen', childName: 'Ava Chen', plan: 'Steady', status: 'completed', completedDate: '2026-01-08', sentBy: 's3' },
  { id: 'ro3', parentName: 'Susan Kim', childName: 'Noah Kim', plan: 'Pending', status: 'link_sent', sentDate: '2026-04-13', sentBy: 's1' },
];

const ONBOARDING_STEPS = [
  { step: 1, title: 'Parent Info', desc: 'Name, phone, email, emergency contact' },
  { step: 2, title: 'Child Info', desc: 'Name, age, any medical notes' },
  { step: 3, title: 'Plan Selection', desc: 'Choose membership tier and billing cycle' },
  { step: 4, title: 'Payment', desc: 'Stripe checkout - card details' },
  { step: 5, title: 'Confirmation', desc: 'Welcome message + first session booking prompt' },
];

export default function Onboarding() {
  const [showSendModal, setShowSendModal] = useState(false);
  const staff = (id) => STAFF.find(s => s.id === id);

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div className={s.flexBetween}>
          <div>
            <h1 className={s.pageTitle}>Onboarding</h1>
            <p className={s.pageDesc}>Send signup links and track new member onboarding</p>
          </div>
          <button className={`${s.btn} ${s.btnGold}`} onClick={() => setShowSendModal(true)}>
            Send Onboarding Link
          </button>
        </div>
      </div>

      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statValue}>{RECENT_ONBOARDINGS.filter(r => r.status === 'completed').length}</div>
          <div className={s.statLabel}>Completed</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{RECENT_ONBOARDINGS.filter(r => r.status === 'link_sent').length}</div>
          <div className={s.statLabel}>Pending</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{ONBOARDING_LINKS.reduce((a, l) => a + l.completions, 0)}</div>
          <div className={s.statLabel}>Total Signups</div>
        </div>
      </div>

      {/* Onboarding Flow Steps */}
      <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
        <h2 className={s.cardTitle}>Onboarding Flow</h2>
        <div style={{ display: 'flex', gap: 'var(--sp-md)', overflowX: 'auto' }}>
          {ONBOARDING_STEPS.map((step, i) => (
            <div key={step.step} style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(200,168,78,0.1)', border: '2px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
                {step.step}
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{step.title}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ts)', marginTop: 4 }}>{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
        <h2 className={s.cardTitle}>Onboarding Links</h2>
        {ONBOARDING_LINKS.map(link => (
          <div key={link.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-md) 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{link.label}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', fontFamily: 'var(--fm)' }}>{link.url}</div>
            </div>
            <div className={s.flexGap} style={{ gap: 'var(--sp-xl)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>{link.visits}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Visits</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontFamily: 'var(--fm)', color: 'var(--green)' }}>{link.completions}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Signups</div>
              </div>
              <button className={s.btn}>Copy Link</button>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Onboardings */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Recent Onboardings</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Parent</th>
              <th>Child</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Sent By</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_ONBOARDINGS.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.parentName}</td>
                <td>{r.childName}</td>
                <td>{r.plan}</td>
                <td>
                  <span className={`${s.statusBadge} ${r.status === 'completed' ? s.statusActive : s.statusTrial}`}>
                    {r.status === 'completed' ? 'Completed' : 'Link Sent'}
                  </span>
                </td>
                <td>{staff(r.sentBy)?.name}</td>
                <td>{r.completedDate || r.sentDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Send Modal */}
      {showSendModal && (
        <div className={s.drawerOverlay} onClick={() => setShowSendModal(false)}>
          <div className={s.drawer} style={{ width: 400 }} onClick={e => e.stopPropagation()}>
            <div className={s.drawerHeader}>
              <h2 className={s.drawerTitle}>Send Onboarding Link</h2>
              <button className={s.drawerClose} onClick={() => setShowSendModal(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className={s.flexCol} style={{ gap: 'var(--sp-lg)' }}>
              <div>
                <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Parent Phone Number</label>
                <input style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }} placeholder="416-555-0000" />
              </div>
              <div>
                <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Link Type</label>
                <select style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', background: 'var(--surf)', color: 'var(--tp)' }}>
                  {ONBOARDING_LINKS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <button className={`${s.btn} ${s.btnGold}`} style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowSendModal(false)}>
                Send via SMS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
