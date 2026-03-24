import { useState, useMemo, useRef } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useTypewriter from '../hooks/useTypewriter';
import { useLocation } from '../context/LocationContext';
import s from '../styles/Schedule.module.css';
import sh from '../styles/shared.module.css';

/* ─── DATA ─── */
const SAGE_PROMPTS = [
  'Create a Saturday Elite class at 10am...',
  'Cancel tomorrow\'s Beginner session...',
  'Show me next week\'s schedule...',
  'Assign Coach Z to Thursday\'s group class...',
  'Move Friday\'s evaluation to 4pm...',
  'How many open spots are there this week...',
];

const QA_ICONS = {
  create: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  cancel: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  roster: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  assign: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
};

const QUICK_ACTIONS = [
  { label: 'Create session', icon: 'create', action: 'create' },
  { label: 'Cancel a class', icon: 'cancel', action: 'cancel' },
  { label: 'View roster', icon: 'roster', action: 'roster' },
  { label: 'Assign coach', icon: 'assign', action: 'assign' },
];

const CLASS_TYPES = [
  { key: 'elite', label: 'Elite Training', color: '#C8A84E' },
  { key: 'group', label: 'Group Training', color: '#3EAF5C' },
  { key: 'beginner', label: 'Beginner', color: '#6B8AE0' },
  { key: 'individual', label: 'Individual', color: '#9B6BCC' },
  { key: 'evaluation', label: 'Evaluation', color: '#E09D24' },
];

const typeColor = (type) => {
  const t = CLASS_TYPES.find(c => c.label === type);
  return t ? t.color : '#C8A84E';
};

const typeClass = (type) => {
  if (type === 'Elite Training') return s.sessionElite;
  if (type === 'Group Training') return s.sessionGroup;
  if (type === 'Beginner') return s.sessionBeginner;
  if (type === 'Individual') return s.sessionIndividual;
  if (type === 'Evaluation') return s.sessionEvaluation;
  return s.sessionElite;
};

/* Week of Mar 16–22, 2026 */
const WEEK_START = new Date(2026, 2, 16); // Mon Mar 16
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_DATES = DAYS.map((_, i) => {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + i);
  return d;
});

const SESSIONS = [
  { id: 1, day: 0, hour: 18, minutes: 0, duration: 60, type: 'Elite Training', coach: 'Coach Rivera', coachInitials: 'CR', booked: 12, capacity: 15, location: 'Downtown', notes: 'Focus on agility drills this week.' },
  { id: 2, day: 1, hour: 16, minutes: 0, duration: 60, type: 'Beginner', coach: 'Coach Z', coachInitials: 'CZ', booked: 8, capacity: 12, location: 'Westside', notes: '' },
  { id: 3, day: 1, hour: 18, minutes: 0, duration: 60, type: 'Group Training', coach: 'Coach Rivera', coachInitials: 'CR', booked: 14, capacity: 15, location: 'Downtown', notes: 'Last group session before spring break adjustments.' },
  { id: 4, day: 2, hour: 17, minutes: 0, duration: 60, type: 'Individual', coach: 'Coach Z', coachInitials: 'CZ', booked: 1, capacity: 1, location: 'Downtown', notes: 'One-on-one with Carlos.' },
  { id: 5, day: 2, hour: 18, minutes: 30, duration: 60, type: 'Elite Training', coach: 'Coach Rivera', coachInitials: 'CR', booked: 10, capacity: 15, location: 'Downtown', notes: '' },
  { id: 6, day: 3, hour: 16, minutes: 0, duration: 60, type: 'Beginner', coach: 'Coach Z', coachInitials: 'CZ', booked: 6, capacity: 12, location: 'Westside', notes: '' },
  { id: 7, day: 3, hour: 18, minutes: 0, duration: 60, type: 'Group Training', coach: 'Coach Rivera', coachInitials: 'CR', booked: 15, capacity: 15, location: 'Downtown', notes: 'Session is full. Waitlist enabled.' },
  { id: 8, day: 4, hour: 17, minutes: 0, duration: 60, type: 'Evaluation', coach: 'Coach Rivera', coachInitials: 'CR', booked: 2, capacity: 4, location: 'Downtown', notes: 'New athlete evaluations.' },
  { id: 9, day: 5, hour: 9, minutes: 0, duration: 90, type: 'Elite Training', coach: 'Coach Rivera', coachInitials: 'CR', booked: 13, capacity: 15, location: 'Downtown', notes: 'Extended Saturday session.' },
  { id: 10, day: 5, hour: 11, minutes: 0, duration: 60, type: 'Group Training', coach: 'Coach Z', coachInitials: 'CZ', booked: 11, capacity: 15, location: 'Downtown', notes: '' },
  { id: 11, day: 5, hour: 13, minutes: 0, duration: 60, type: 'Beginner', coach: 'Coach Z', coachInitials: 'CZ', booked: 9, capacity: 12, location: 'Westside', notes: '' },
];

const SAMPLE_ROSTER = [
  { id: 1, name: 'Carlos Martinez', initials: 'CM', checkedIn: true },
  { id: 2, name: 'Mia Thompson', initials: 'MT', checkedIn: true },
  { id: 3, name: 'Jaylen Brooks', initials: 'JB', checkedIn: false },
  { id: 4, name: 'Ava Chen', initials: 'AC', checkedIn: false },
  { id: 5, name: 'Sofia Reyes', initials: 'SR', checkedIn: false },
];

const CANCEL_REASONS = ['Weather', 'Coach unavailable', 'Facility issue', 'Holiday', 'Other'];

const HOUR_START = 6;
const HOUR_END = 21;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

const formatHour = (h) => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hr} ${ampm}`;
};

const formatTime = (h, m) => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return m > 0 ? `${hr}:${String(m).padStart(2, '0')} ${ampm}` : `${hr}:00 ${ampm}`;
};

const formatDateShort = (d) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

const formatWeekRange = (start) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (start.getMonth() === end.getMonth()) {
    return `${months[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${months[start.getMonth()]} ${start.getDate()} \u2013 ${months[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`;
};

/* ─── SUB-COMPONENTS ─── */

/* Session Detail Drawer */
function SessionDrawer({ session, onClose }) {
  const [roster, setRoster] = useState(SAMPLE_ROSTER);
  const [notes, setNotes] = useState(session.notes);
  const [cancelOpen, setCancelOpen] = useState(false);

  const sessionDate = DAY_DATES[session.day];
  const fillPct = Math.round((session.booked / session.capacity) * 100);
  const capClass = session.booked >= session.capacity ? s.capRed : fillPct > 50 ? s.capGreen : s.capYellow;

  const toggleCheck = (id) => {
    setRoster(prev => prev.map(r => r.id === id ? { ...r, checkedIn: !r.checkedIn } : r));
  };

  const markAllPresent = () => {
    setRoster(prev => prev.map(r => ({ ...r, checkedIn: true })));
  };

  return (
    <div className={s.drawerOverlay} onClick={onClose}>
      <div className={s.drawer} onClick={e => e.stopPropagation()}>
        <button className={s.drawerClose} onClick={onClose}>&#10005;</button>

        {/* Header */}
        <div className={s.drawerHeader}>
          <div className={s.drawerTitle}>{session.type}</div>
          <div className={s.drawerDatetime}>
            {DAYS[session.day]}, {formatDateShort(sessionDate)} &middot; {formatTime(session.hour, session.minutes)}
          </div>
          <div className={s.drawerType}>
            <span className={s.drawerTypeDot} style={{ background: typeColor(session.type) }} />
            <span className={s.drawerTypeLabel}>{session.type}</span>
          </div>
        </div>

        {/* Details */}
        <div className={s.drawerSection}>
          <div className={s.drawerSectionTitle}>Details</div>
          <div className={s.drawerCoachRow}>
            <div className={s.drawerCoachAvatar}>{session.coachInitials}</div>
            <div className={s.drawerCoachName}>{session.coach}</div>
          </div>
          <div className={s.drawerRow}><span>Location</span><span>{session.location}</span></div>
          <div className={s.drawerRow}><span>Duration</span><span>{session.duration} min</span></div>
        </div>

        {/* Capacity */}
        <div className={s.drawerSection}>
          <div className={s.drawerSectionTitle}>Capacity</div>
          <div className={s.capacityWrap}>
            <div className={s.capacityLabel}>
              <span>{session.booked >= session.capacity ? 'FULL' : `${fillPct}% filled`}</span>
              <span className={s.capacityCount}>{session.booked}/{session.capacity}</span>
            </div>
            <div className={s.capacityBarTrack}>
              <div className={`${s.capacityBarFill} ${capClass}`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className={s.drawerSection}>
          <div className={s.drawerSectionTitle}>Session Notes</div>
          <textarea
            className={s.drawerNotes}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add session notes..."
            rows={3}
          />
        </div>

        {/* Roster */}
        <div className={s.drawerSection}>
          <div className={s.drawerSectionTitle}>Roster ({roster.length})</div>
          <div className={s.rosterList}>
            {roster.map(r => (
              <div key={r.id} className={s.rosterRow}>
                <div className={s.rosterAvatar}>{r.initials}</div>
                <div className={s.rosterName}>{r.name}</div>
                <button
                  className={`${s.rosterCheckBtn} ${r.checkedIn ? s.rosterChecked : ''}`}
                  onClick={() => toggleCheck(r.id)}
                >
                  {r.checkedIn ? '\u2713' : ''}
                </button>
              </div>
            ))}
          </div>
          <div className={s.rosterActions}>
            <button className={s.rosterActionBtn} onClick={markAllPresent}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Mark All Present
            </button>
            <button className={s.rosterActionBtn}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Athlete
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className={s.drawerFooter}>
          <button className={s.btnPrimary}>Edit Session</button>
          <button className={s.btnDanger} onClick={() => setCancelOpen(true)}>Cancel Session</button>
        </div>
      </div>

      {/* Cancel session modal */}
      {cancelOpen && (
        <CancelSessionModal
          session={session}
          onClose={() => setCancelOpen(false)}
          onParentClose={onClose}
        />
      )}
    </div>
  );
}

/* Create Session Modal */
function CreateSessionModal({ onClose }) {
  const [classType, setClassType] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [coach, setCoach] = useState('');
  const [capacity, setCapacity] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [recurrence, setRecurrence] = useState('None');

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Create Session</h3>
          <button className={s.modalClose} onClick={onClose}>&#10005;</button>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Class Type</label>
          <select className={s.formSelect} value={classType} onChange={e => setClassType(e.target.value)}>
            <option value="">Select class type...</option>
            {CLASS_TYPES.map(ct => (
              <option key={ct.key} value={ct.label}>{ct.label}</option>
            ))}
          </select>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Date</label>
          <input className={s.formInput} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div className={s.formRow}>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Start Time</label>
            <input className={s.formInput} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>End Time</label>
            <input className={s.formInput} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>

        <div className={s.formRow}>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Location</label>
            <select className={s.formSelect} value={location} onChange={e => setLocation(e.target.value)}>
              <option value="">Select location...</option>
              <option value="Downtown">Downtown</option>
              <option value="Westside">Westside</option>
            </select>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Coach</label>
            <select className={s.formSelect} value={coach} onChange={e => setCoach(e.target.value)}>
              <option value="">Select coach...</option>
              <option value="Coach Rivera">Coach Rivera</option>
              <option value="Coach Z">Coach Z</option>
            </select>
          </div>
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Capacity</label>
          <input className={s.formInput} type="number" min="1" max="30" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="e.g. 15" />
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Session Notes</label>
          <textarea className={s.formTextarea} rows={3} value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} placeholder="Optional notes for this session..." />
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Recurrence</label>
          <select className={s.formSelect} value={recurrence} onChange={e => setRecurrence(e.target.value)}>
            <option value="None">None</option>
            <option value="Weekly">Weekly</option>
            <option value="Biweekly">Biweekly</option>
          </select>
        </div>

        {(!classType || !date || !startTime || !endTime || !location || !coach || !capacity) && (
          <div style={{ fontSize: 12, color: 'var(--warn)', textAlign: 'center', marginBottom: 8 }}>
            Fill in all fields to create a session
          </div>
        )}
        <div className={s.modalFooter}>
          <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
          <button
            className={s.btnPrimary}
            disabled={!classType || !date || !startTime || !endTime || !location || !coach || !capacity}
            onClick={onClose}
          >
            Create Session
          </button>
        </div>
      </div>
    </div>
  );
}

/* Cancel Session Modal */
function CancelSessionModal({ session, onClose, onParentClose }) {
  const [reason, setReason] = useState('');
  const [makeupCredits, setMakeupCredits] = useState(true);

  const handleCancel = () => {
    onClose();
    if (onParentClose) onParentClose();
  };

  return (
    <div className={s.modalOverlay} onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h3>Cancel Session</h3>
          <button className={s.modalClose} onClick={onClose}>&#10005;</button>
        </div>

        <div className={s.cancelWarning}>
          This will notify all {session.booked} booked athletes that "{session.type}" on {DAYS[session.day]} at {formatTime(session.hour, session.minutes)} has been cancelled.
        </div>

        <div className={s.formGroup}>
          <label className={s.formLabel}>Cancellation Reason</label>
          <select className={s.formSelect} value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select reason...</option>
            {CANCEL_REASONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <label className={s.checkboxRow}>
          <input type="checkbox" checked={makeupCredits} onChange={e => setMakeupCredits(e.target.checked)} />
          Issue make-up credits to all booked athletes
        </label>

        <div className={s.modalFooter}>
          <button className={s.btnSecondary} onClick={onClose}>Keep Session</button>
          <button className={s.btnDanger} onClick={handleCancel} disabled={!reason}>
            Cancel Session
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function Schedule() {
  const [cmdInput, setCmdInput] = useState('');
  const [cmdResponse, setCmdResponse] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [calView, setCalView] = useState('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedSession, setSelectedSession] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { location: activeLocation, setLocation: setActiveLocation } = useLocation();
  const filteredSessions = activeLocation === 'all' ? SESSIONS : SESSIONS.filter(se => se.location.toLowerCase() === activeLocation);

  const typewriterText = useTypewriter(SAGE_PROMPTS);
  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);

  const currentWeekStart = useMemo(() => {
    const d = new Date(WEEK_START);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const currentDayDates = useMemo(() => {
    return DAYS.map((_, i) => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentWeekStart]);

  /* Stats */
  const totalBookings = filteredSessions.reduce((sum, se) => sum + se.booked, 0);
  const avgFill = filteredSessions.length > 0 ? Math.round(filteredSessions.reduce((sum, se) => sum + (se.booked / se.capacity) * 100, 0) / filteredSessions.length) : 0;

  const handleCommand = (text) => {
    const cmd = text || cmdInput;
    if (!cmd.trim()) return;
    setCmdResponse({
      input: cmd,
      reply: `Got it \u2014 I'll ${cmd.toLowerCase().startsWith('show') || cmd.toLowerCase().startsWith('how') ? 'pull that up' : 'take care of that'} for you. Processing "${cmd}"...`,
      actions: cmd.toLowerCase().includes('cancel') ? ['Confirm cancellation', 'Cancel']
        : cmd.toLowerCase().includes('create') ? ['Confirm', 'Edit details', 'Cancel']
        : ['Confirm', 'Cancel'],
    });
    setCmdInput('');
  };

  const toggleListening = () => {
    setIsListening(!isListening);
    if (!isListening) {
      setTimeout(() => {
        setIsListening(false);
        setCmdInput('Create a Saturday Elite class at 10am');
      }, 2500);
    }
  };

  const handleQuickAction = (action) => {
    if (action === 'create') return setCreateOpen(true);
    if (action === 'cancel') return handleCommand('Cancel a class');
    if (action === 'roster') return handleCommand('View roster for upcoming sessions');
    if (action === 'assign') return handleCommand('Assign coach to a session');
  };

  return (
    <main className={sh.main}>
      {/* ═══ COMMAND BAR HEADER ═══ */}
      <div className={s.cmdBarHeader}>
        <canvas ref={canvasRef} className={s.cmdBarCanvas} />
        <div className={s.cmdBarInner}>
          <div className={s.cmdLeft}>
            <h1 className={s.cmdGreeting}>Schedule</h1>
            <span className={s.cmdSubGreeting}>{filteredSessions.length} sessions this week</span>
          </div>
          <div className={s.cmdCenter}>
            <div className={s.cmdSageOrb}>S</div>
            <input
              className={s.cmdSageInput}
              value={cmdInput}
              onChange={e => setCmdInput(e.target.value)}
              placeholder={typewriterText}
              onKeyDown={e => e.key === 'Enter' && handleCommand()}
            />
            {isListening && <span className={s.cmdListenBadge}>Listening...</span>}
            <button className={`${s.cmdMicBtn} ${isListening ? s.cmdMicBtnActive : ''}`} onClick={toggleListening}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button className={s.cmdSendBtn} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div className={sh.locationFilter}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <select className={sh.locationSelect} value={activeLocation} onChange={e => setActiveLocation(e.target.value)}>
              <option value="all">All Locations</option>
              <option value="downtown">Downtown</option>
              <option value="westside">Westside</option>
            </select>
          </div>
        </div>
      </div>

      <div className={sh.scroll}>
        {/* Sage response */}
        {cmdResponse && (
          <div className={s.cmdResponse}>
            <div className={s.cmdResponseQ}>You said: &ldquo;{cmdResponse.input}&rdquo;</div>
            <div className={s.cmdResponseA}>{cmdResponse.reply}</div>
            <div className={s.cmdResponseActions}>
              {cmdResponse.actions.map(a => (
                <button
                  key={a}
                  className={a === 'Cancel' ? s.cmdActionCancel : s.cmdActionConfirm}
                  onClick={() => setCmdResponse(null)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick action chips */}
        <div className={s.cmdChips}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} className={s.cmdChip} onClick={() => handleQuickAction(a.action)}>
              <span className={s.cmdChipIcon}>{QA_ICONS[a.icon]}</span> {a.label}
            </button>
          ))}
        </div>

        {/* Stats bar */}
        <div className={s.statsBar}>
          <div className={s.statCard}>
            <div className={s.statLabel}>Sessions This Week</div>
            <div className={s.statValue}>{filteredSessions.length}</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Total Bookings</div>
            <div className={s.statValue}>{totalBookings}</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Avg Fill Rate</div>
            <div className={s.statValue}>{avgFill}%</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Cancellations</div>
            <div className={s.statValue}>0</div>
          </div>
        </div>

        {/* Calendar toolbar */}
        <div className={s.calToolbar}>
          <div className={s.weekNav}>
            <button className={s.weekNavBtn} onClick={() => setWeekOffset(w => w - 1)}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className={s.weekLabel}>{formatWeekRange(currentWeekStart)}</span>
            <button className={s.weekNavBtn} onClick={() => setWeekOffset(w => w + 1)}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            {weekOffset !== 0 && (
              <button className={s.todayBtn} onClick={() => setWeekOffset(0)}>Today</button>
            )}
          </div>
          <div className={s.viewToggle}>
            <button className={`${s.viewBtn} ${calView === 'week' ? s.viewBtnActive : ''}`} onClick={() => setCalView('week')}>Week</button>
            <button className={`${s.viewBtn} ${calView === 'month' ? s.viewBtnActive : ''}`} onClick={() => setCalView('month')}>Month</button>
          </div>
        </div>

        {/* Calendar */}
        {calView === 'week' ? (
          <div className={s.calendarWrap}>
            {/* Day headers */}
            <div className={s.calendarHeader}>
              <div className={s.calendarCorner} />
              {DAYS.map((day, i) => {
                const d = currentDayDates[i];
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <div key={day} className={`${s.calendarDayHeader} ${isToday ? s.calDayToday : ''}`}>
                    <span className={s.calDayName}>{day}</span>
                    <span className={s.calDayNum}>{d.getDate()}</span>
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <div className={s.calendarBody}>
              {/* Time column */}
              <div className={s.timeCol}>
                {HOURS.map(h => (
                  <div key={h} className={s.timeSlot}>{formatHour(h)}</div>
                ))}
              </div>

              {/* Day columns */}
              {DAYS.map((_, dayIdx) => (
                <div key={dayIdx} className={s.dayCol}>
                  {/* Empty hour slots for grid lines */}
                  {HOURS.map(h => (
                    <div key={h} className={s.daySlot} onClick={() => setCreateOpen(true)} />
                  ))}

                  {/* Session blocks (only show for current week offset 0) */}
                  {weekOffset === 0 && filteredSessions.filter(se => se.day === dayIdx).map(se => {
                    const topPx = ((se.hour - HOUR_START) + se.minutes / 60) * 60;
                    const heightPx = (se.duration / 60) * 60;
                    const isFull = se.booked >= se.capacity;
                    return (
                      <div
                        key={se.id}
                        className={`${s.sessionBlock} ${typeClass(se.type)}`}
                        style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                        onClick={e => { e.stopPropagation(); setSelectedSession(se); }}
                      >
                        <span className={s.sessionName}>{se.type}</span>
                        <span className={s.sessionTime}>{formatTime(se.hour, se.minutes)}</span>
                        <div className={s.sessionMeta}>
                          <span className={s.sessionCoach}>{se.coachInitials}</span>
                          <span className={`${s.sessionCount} ${isFull ? s.sessionFull : ''}`}>{se.booked}/{se.capacity}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={s.monthPlaceholder}>Month view coming soon</div>
        )}
      </div>

      {/* Session detail drawer */}
      {selectedSession && (
        <SessionDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}

      {/* Create session modal */}
      {createOpen && (
        <CreateSessionModal onClose={() => setCreateOpen(false)} />
      )}
    </main>
  );
}
