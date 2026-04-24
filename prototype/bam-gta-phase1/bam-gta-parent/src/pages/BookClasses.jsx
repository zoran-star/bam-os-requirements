import { useState } from 'react';
import { AVAILABLE_SESSIONS, CHILDREN } from '../data/parent';
import s from '../styles/app.module.css';

// PRD #15: Class Booking
// Weekly calendar -> tap day -> see classes for that day -> tap to book

const WEEK = [
  { key: 'Monday', short: 'M', date: '14', label: 'Mon' },
  { key: 'Tuesday', short: 'T', date: '15', label: 'Tue' },
  { key: 'Wednesday', short: 'W', date: '16', label: 'Wed' },
  { key: 'Thursday', short: 'T', date: '17', label: 'Thu' },
  { key: 'Friday', short: 'F', date: '18', label: 'Fri' },
  { key: 'Saturday', short: 'S', date: '19', label: 'Sat' },
  { key: 'Sunday', short: 'S', date: '20', label: 'Sun' },
];

export default function BookClasses() {
  const [selectedDay, setSelectedDay] = useState('Monday');
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedChild, setSelectedChild] = useState(null);
  const [booked, setBooked] = useState(false);

  const daySessions = AVAILABLE_SESSIONS.filter(s => s.day === selectedDay);
  const selectedDayInfo = WEEK.find(d => d.key === selectedDay);

  const handleBook = () => {
    setBooked(true);
  };

  return (
    <div>
      <div className={s.header}>
        <div className={s.headerTitle}>Classes</div>
        <div className={s.headerSub}>April 14 - 20, 2026</div>
      </div>

      {/* Weekly day selector */}
      <div style={{ display: 'flex', padding: '12px 16px', gap: 6, background: 'var(--surf)', borderBottom: '1px solid var(--border)' }}>
        {WEEK.map(day => {
          const hasSessions = AVAILABLE_SESSIONS.some(s => s.day === day.key);
          const isSelected = selectedDay === day.key;
          return (
            <button
              key={day.key}
              onClick={() => setSelectedDay(day.key)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '8px 0', borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
                background: isSelected ? 'var(--gold)' : 'transparent',
                fontFamily: 'var(--ff)',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--tm)' }}>{day.label}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: isSelected ? '#fff' : 'var(--tp)' }}>{day.date}</span>
              {hasSessions && !isSelected && (
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--gold)' }} />
              )}
              {hasSessions && isSelected && (
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.6)' }} />
              )}
              {!hasSessions && <span style={{ width: 4, height: 4 }} />}
            </button>
          );
        })}
      </div>

      {/* Day's sessions */}
      <div className={s.sectionTitle}>{selectedDay}, April {selectedDayInfo?.date}</div>
      <div className={s.section}>
        {daySessions.length === 0 ? (
          <div className={s.empty}>No classes on {selectedDay}</div>
        ) : (
          daySessions.map(session => (
            <div
              key={session.id}
              className={s.sessionCard}
              onClick={() => { if (session.spotsLeft > 0) setSelectedSession(session); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className={s.sessionName}>{session.name}</div>
                  <div className={s.sessionMeta}>{session.time}</div>
                </div>
                <span className={s.archBadge}>{session.archetype}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ts)', marginTop: 6 }}>{session.description}</div>
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>📍 {session.location || '1079 Linbrook Rd, ON L6J 2L2'}</div>
              <div className={`${s.sessionSpots} ${session.spotsLeft === 0 ? s.spotsFull : session.spotsLeft <= 2 ? s.spotsFew : s.spotsOk}`}>
                {session.spotsLeft === 0 ? 'Full - Join Waitlist' : `${session.spotsLeft} spots left`}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Booking Confirmation Modal */}
      {selectedSession && (
        <div className={s.modal} onClick={() => { setSelectedSession(null); setSelectedChild(null); }}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHandle} />

            {booked ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <svg width="48" height="48" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 12 }}>Booked!</div>
                <div style={{ fontSize: 14, color: 'var(--ts)', marginTop: 4 }}>
                  {selectedChild?.name} is booked for {selectedSession.name}
                </div>
                <button className={`${s.btn} ${s.btnGold}`} style={{ marginTop: 16 }} onClick={() => {
                  setBooked(false);
                  setSelectedSession(null);
                  setSelectedChild(null);
                }}>
                  Book Another Class
                </button>
              </div>
            ) : (
              <>
                <div className={s.modalTitle}>Confirm Booking</div>

                <div className={s.card} style={{ margin: '0 0 16px' }}>
                  <div style={{ fontWeight: 700 }}>{selectedSession.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--ts)', marginTop: 4 }}>{selectedSession.date} | {selectedSession.time}</div>
                  <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>📍 {selectedSession.location}</div>
                  <div style={{ fontSize: 12, color: 'var(--ts)', marginTop: 4 }}>{selectedSession.spotsLeft} spots remaining</div>
                </div>

                {/* Child Picker */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Book for:</div>
                  <div className={s.childSwitcher} style={{ padding: 0 }}>
                    {CHILDREN.filter(c => c.status === 'active').map(child => (
                      <button
                        key={child.id}
                        className={`${s.childTab} ${selectedChild?.id === child.id ? s.childTabActive : ''}`}
                        onClick={() => setSelectedChild(child)}
                      >
                        {child.name}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedChild && (
                  selectedChild.creditsRemaining === 0 ? (
                    <div style={{ padding: 12, background: 'var(--redl)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--red)', fontWeight: 600, marginBottom: 16 }}>
                      {selectedChild.name} has no credits remaining. Upgrade your plan to book more sessions.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--ts)', marginBottom: 16 }}>
                        1 credit will be used for {selectedChild.name}
                        {selectedChild.creditsRemaining !== 'unlimited' && ` (${selectedChild.creditsRemaining} remaining)`}
                      </div>
                      <button className={`${s.btn} ${s.btnGold}`} onClick={handleBook}>
                        Book Session
                      </button>
                    </>
                  )
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
