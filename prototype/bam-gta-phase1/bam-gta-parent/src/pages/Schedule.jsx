import { useState } from 'react';
import { CHILDREN } from '../data/parent';
import s from '../styles/app.module.css';

// PRD #15 (booking cancellation) + PRD #17 (past sessions on profile)
// Upcoming bookings separated by child
// Cancel per-kid, cancel >= 1hr returns credit
// Late cancel < 1hr still returns credit but coaches notified

export default function Schedule() {
  const [activeChild, setActiveChild] = useState(CHILDREN[0].id);
  const [tab, setTab] = useState('upcoming');
  const [cancelConfirm, setCancelConfirm] = useState(null);

  const child = CHILDREN.find(c => c.id === activeChild);

  return (
    <div>
      <div className={s.header}>
        <div className={s.headerTitle}>Schedule</div>
        <div className={s.headerSub}>Your upcoming and past sessions</div>
      </div>

      <div className={s.childSwitcher}>
        {CHILDREN.map(c => (
          <button
            key={c.id}
            className={`${s.childTab} ${activeChild === c.id ? s.childTabActive : ''}`}
            onClick={() => setActiveChild(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
        <button
          onClick={() => setTab('upcoming')}
          style={{ flex: 1, padding: '12px 0', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: tab === 'upcoming' ? '2px solid var(--gold)' : '2px solid transparent', background: 'none', color: tab === 'upcoming' ? 'var(--gold)' : 'var(--ts)', cursor: 'pointer' }}
        >
          Upcoming ({child?.upcomingBookings.length})
        </button>
        <button
          onClick={() => setTab('past')}
          style={{ flex: 1, padding: '12px 0', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: tab === 'past' ? '2px solid var(--gold)' : '2px solid transparent', background: 'none', color: tab === 'past' ? 'var(--gold)' : 'var(--ts)', cursor: 'pointer' }}
        >
          Past Sessions
        </button>
      </div>

      {tab === 'upcoming' && (
        <div className={s.section} style={{ paddingTop: 4 }}>
          {child?.upcomingBookings.length === 0 ? (
            <div className={s.empty}>No upcoming bookings</div>
          ) : (
            child?.upcomingBookings.map(booking => (
              <div key={booking.id} className={s.sessionCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className={s.sessionName}>{booking.sessionName}</div>
                    <div className={s.sessionMeta}>{booking.date} | {booking.time}</div>
                  </div>
                  <button
                    className={`${s.btnSmall} ${s.btn}`}
                    style={{ color: 'var(--red)', borderColor: 'rgba(224,90,66,0.3)' }}
                    onClick={() => setCancelConfirm(booking)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'past' && (
        <div className={s.section} style={{ paddingTop: 4 }}>
          {child?.pastSessions.map((session, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{session.sessionName}</div>
                <div style={{ fontSize: 12, color: 'var(--ts)' }}>{session.date}</div>
              </div>
              <span className={`${s.badge} ${session.status === 'attended' ? s.badgeGreen : s.badgeRed}`}>
                {session.status === 'attended' ? 'Attended' : 'No-Show'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelConfirm && (
        <div className={s.modal} onClick={() => setCancelConfirm(null)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHandle} />
            <div className={s.modalTitle}>Cancel Booking?</div>
            <div style={{ fontSize: 14, color: 'var(--ts)', marginBottom: 16 }}>
              Are you sure you want to cancel <strong>{child?.name}</strong>'s booking for <strong>{cancelConfirm.sessionName}</strong> on {cancelConfirm.date}?
            </div>
            <div style={{ fontSize: 13, color: 'var(--ts)', marginBottom: 16, padding: 12, background: 'var(--surf2)', borderRadius: 'var(--r-sm)' }}>
              Your credit will be returned.
            </div>
            <button className={`${s.btn} ${s.btnDanger}`} onClick={() => setCancelConfirm(null)}>
              Yes, Cancel Booking
            </button>
            <button className={s.btn} style={{ marginTop: 8 }} onClick={() => setCancelConfirm(null)}>
              Keep Booking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
