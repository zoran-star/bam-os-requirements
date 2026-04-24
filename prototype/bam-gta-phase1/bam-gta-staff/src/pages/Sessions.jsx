import { useState } from 'react';
import { SESSION_TEMPLATES, SESSION_INSTANCES } from '../data/sessions';
import { MEMBERS, STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #6: Session Publishing & Management
// Weekly calendar view like the prototype

const DAYS = [
  { key: 'Monday', short: 'MON', date: '14' },
  { key: 'Tuesday', short: 'TUE', date: '15' },
  { key: 'Wednesday', short: 'WED', date: '16' },
  { key: 'Thursday', short: 'THU', date: '17' },
  { key: 'Friday', short: 'FRI', date: '18' },
  { key: 'Saturday', short: 'SAT', date: '19' },
  { key: 'Sunday', short: 'SUN', date: '20' },
];

// Apr 14 = Monday for the week display
const DAY_DATES = { Monday: '14', Tuesday: '15', Wednesday: '16', Thursday: '17', Friday: '18', Saturday: '19', Sunday: '20' };

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // 8 AM - 9 PM (covers all sessions)

const ARCHETYPE_COLORS = {
  'Younger Group': { bg: 'rgba(59,111,160,0.12)', border: 'rgba(59,111,160,0.3)', text: '#3B6FA0' },
  'Older Group': { bg: 'rgba(62,175,92,0.12)', border: 'rgba(62,175,92,0.3)', text: '#3EAF5C' },
  'Shooting': { bg: 'rgba(200,168,78,0.12)', border: 'rgba(200,168,78,0.3)', text: '#C8A84E' },
};

// Parse time like "4:30 PM" to fractional hour (16.5)
function parseTime(timeStr) {
  const [time, period] = timeStr.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h + m / 60;
}

export default function Sessions() {
  const [selectedSession, setSelectedSession] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [showNewClass, setShowNewClass] = useState(false);
  const [showClassAnnounce, setShowClassAnnounce] = useState(false);

  const staffName = (id) => STAFF.find(s => s.id === id)?.name || '';
  const staffInitials = (id) => STAFF.find(s => s.id === id)?.initials || '';

  const getSessionsByDay = (day) => SESSION_TEMPLATES.filter(t => t.day === day);

  // Calendar grid starts at 8 AM (hour 8), each hour = 60px
  const startHour = 8;
  const hourHeight = 60;
  const totalHeight = HOURS.length * hourHeight;

  const getSessionStyle = (session) => {
    const start = parseTime(session.startTime);
    const end = parseTime(session.endTime);
    const top = (start - startHour) * hourHeight;
    const height = (end - start) * hourHeight;
    const colors = ARCHETYPE_COLORS[session.archetype] || ARCHETYPE_COLORS['All Levels'];
    return {
      position: 'absolute',
      top, height: height - 2,
      left: 2, right: 2,
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '8px 10px',
      cursor: 'pointer',
      overflow: 'hidden',
      transition: 'box-shadow 140ms',
      fontSize: 'var(--fs-xs)',
    };
  };

  return (
    <div className={s.page} style={{ padding: 'var(--sp-lg) var(--sp-xl)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-md)' }}>
          <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', cursor: 'pointer', color: 'var(--ts)' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button style={{ background: 'rgba(200,168,78,0.1)', border: '1px solid rgba(200,168,78,0.2)', borderRadius: 'var(--r-full)', padding: '6px 16px', cursor: 'pointer', color: 'var(--gold)', fontWeight: 600, fontSize: 'var(--fs-sm)', fontFamily: 'var(--ff)' }}>
            Today
          </button>
          <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', cursor: 'pointer', color: 'var(--ts)' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginLeft: 'var(--sp-sm)' }}>Apr 14 - 20, 2026</h1>
        </div>
        <button className={`${s.btn} ${s.btnGold}`} onClick={() => setShowNewClass(true)}>+ New Class</button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 'var(--sp-xl)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-xs)' }}>
        {Object.entries(ARCHETYPE_COLORS).map(([name, colors]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.text }} />
            <span style={{ color: 'var(--ts)', fontWeight: 500 }}>{name}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        {/* Day Headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
          <div />
          {DAYS.map(day => (
            <div key={day.key} style={{ textAlign: 'center', padding: '12px 0', borderLeft: '1px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--ts)', letterSpacing: '0.06em' }}>{day.short}</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--tp)' }}>{day.date}</div>
            </div>
          ))}
        </div>

        {/* Time Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', position: 'relative' }}>
          {/* Time labels */}
          <div style={{ position: 'relative', height: totalHeight }}>
            {HOURS.map((h, i) => (
              <div key={h} style={{ position: 'absolute', top: i * hourHeight, height: hourHeight, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--tm)', fontWeight: 500 }}>
                {h > 12 ? `${h - 12} PM` : h === 12 ? '12 PM' : `${h} AM`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {DAYS.map(day => {
            const sessions = getSessionsByDay(day.key);
            return (
              <div key={day.key} style={{ position: 'relative', height: totalHeight, borderLeft: '1px solid var(--border)' }}>
                {/* Hour lines */}
                {HOURS.map((_, i) => (
                  <div key={i} style={{ position: 'absolute', top: i * hourHeight, left: 0, right: 0, borderTop: '1px solid var(--border)' }} />
                ))}
                {/* Sessions */}
                {sessions.map(session => {
                  const instance = SESSION_INSTANCES.find(si => si.templateId === session.id);
                  const colors = ARCHETYPE_COLORS[session.archetype] || ARCHETYPE_COLORS['All Levels'];
                  return (
                    <div
                      key={session.id}
                      style={getSessionStyle(session)}
                      onClick={() => setSelectedSession(session)}
                    >
                      <div style={{ fontWeight: 700, color: colors.text, fontSize: 12, lineHeight: 1.2 }}>{session.name.replace(session.day + ' ', '')}</div>
                      <div style={{ color: 'var(--ts)', marginTop: 2, fontSize: 10 }}>{session.startTime}</div>
                      <div style={{ position: 'absolute', bottom: 6, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span />
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: colors.border, color: '#fff' }}>
                          {instance ? `${instance.booked}/${session.capacity}` : `0/${session.capacity}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* New Class Modal */}
      {showNewClass && <NewClassModal onClose={() => setShowNewClass(false)} />}

      {/* Session Drawer */}
      {selectedSession && (
        <div className={s.drawerOverlay} onClick={() => setSelectedSession(null)}>
          <div className={s.drawer} onClick={e => e.stopPropagation()}>
            <div className={s.drawerHeader}>
              <h2 className={s.drawerTitle}>{selectedSession.name}</h2>
              <button className={s.drawerClose} onClick={() => setSelectedSession(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-xl)' }}>
              <div><span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Date</span><br /><strong>{selectedSession.day}, April {DAYS.find(d => d.key === selectedSession.day)?.date || ''}th, 2026</strong></div>
              <EditField label="Time" defaultValue={`${selectedSession.startTime} - ${selectedSession.endTime}`} />
              <EditField label="Capacity" defaultValue={String(selectedSession.capacity)} />
              <EditField label="Location" defaultValue={selectedSession.location} />
            </div>
            <div style={{ marginBottom: 'var(--sp-xl)' }}>
              <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>Description</span>
              <textarea
                defaultValue={selectedSession.description}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)', minHeight: 60, resize: 'vertical', marginTop: 4 }}
              />
            </div>

            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-md)' }}>Roster</h3>
            {MEMBERS.filter(m => m.status === 'active').slice(0, selectedSession.capacity).map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 'var(--fs-sm)' }}>{m.childName}</span>
                <button
                  className={`${s.btn} ${attendance[m.id] ? s.btnGold : ''}`}
                  style={{ fontSize: 'var(--fs-xs)', padding: '4px 12px' }}
                  onClick={() => setAttendance(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                >
                  {attendance[m.id] ? 'Present' : 'Mark Present'}
                </button>
              </div>
            ))}
            <WalkInAdder attendance={attendance} setAttendance={setAttendance} />
            <button className={`${s.btn} ${s.btnGold}`} style={{ marginTop: 'var(--sp-lg)', width: '100%', justifyContent: 'center' }}>
              Mark All Present
            </button>
            <button className={s.btn} style={{ marginTop: 'var(--sp-sm)', width: '100%', justifyContent: 'center', background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' }}
              onClick={() => { setSelectedSession(null); setAttendance({}); }}
            >
              Submit Attendance
            </button>

            <button className={s.btn} style={{ marginTop: 'var(--sp-sm)', width: '100%', justifyContent: 'center' }}
              onClick={() => setShowClassAnnounce(true)}
            >
              Announce to This Class
            </button>

            <button className={`${s.btn} ${s.btnDanger}`} style={{ marginTop: 'var(--sp-sm)', width: '100%', justifyContent: 'center' }}
              onClick={() => { setSelectedSession(null); }}
            >
              Remove This Class
            </button>

            {/* Class Announcement Modal */}
            {showClassAnnounce && (
              <ClassAnnounceModal session={selectedSession} onClose={() => setShowClassAnnounce(false)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({ label, defaultValue }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(defaultValue);

  if (editing) {
    return (
      <div>
        <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
        <input
          autoFocus
          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--gold)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 600 }}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }}
        />
      </div>
    );
  }

  return (
    <div style={{ cursor: 'pointer' }} onClick={() => setEditing(true)}>
      <span style={{ color: 'var(--tm)', fontSize: 'var(--fs-xs)' }}>{label}</span><br />
      <strong style={{ borderBottom: '1px dashed var(--border)' }}>{value}</strong>
    </div>
  );
}

function WalkInAdder({ attendance, setAttendance }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState([]);

  const allMembers = MEMBERS.filter(m => m.status === 'active' || m.status === 'paused');
  const filtered = search.trim()
    ? allMembers.filter(m => m.childName.toLowerCase().includes(search.toLowerCase()) || m.parentName.toLowerCase().includes(search.toLowerCase()))
    : allMembers;
  const available = filtered.filter(m => !added.includes(m.id));

  if (!open) {
    return (
      <div style={{ marginTop: 'var(--sp-md)' }}>
        {added.length > 0 && (
          <div style={{ marginBottom: 'var(--sp-sm)' }}>
            {added.map(id => {
              const m = MEMBERS.find(mm => mm.id === id);
              return m ? (
                <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.childName}
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)', fontWeight: 600, background: 'rgba(224,157,36,0.08)', padding: '1px 6px', borderRadius: 'var(--r-full)' }}>walk-in</span>
                  </span>
                  <button
                    className={`${s.btn} ${attendance[m.id] ? s.btnGold : ''}`}
                    style={{ fontSize: 'var(--fs-xs)', padding: '4px 12px' }}
                    onClick={() => setAttendance(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                  >
                    {attendance[m.id] ? 'Present' : 'Mark Present'}
                  </button>
                </div>
              ) : null;
            })}
          </div>
        )}
        <button
          className={s.btn}
          style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}
          onClick={() => setOpen(true)}
        >
          + Add Walk-in (didn't book)
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-md)', padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-sm)' }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Add Walk-in</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>Done</button>
      </div>
      <input
        autoFocus
        placeholder="Search member..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf)', color: 'var(--tp)', fontFamily: 'var(--ff)', marginBottom: 'var(--sp-sm)' }}
      />
      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {available.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', padding: '8px 0', textAlign: 'center' }}>No members found</div>
        ) : (
          available.slice(0, 8).map(m => (
            <div
              key={m.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => { setAdded(prev => [...prev, m.id]); setAttendance(prev => ({ ...prev, [m.id]: true })); setSearch(''); setOpen(false); }}
            >
              <div>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{m.childName}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginLeft: 6 }}>({m.parentName})</span>
              </div>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--green)', fontWeight: 600 }}>+ Add</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ClassAnnounceModal({ session, onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const valid = title.trim().length > 0 && body.trim().length > 0;
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (sent) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
        <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 400, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <svg width="40" height="40" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, margin: '12px 0 8px' }}>Sent!</h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>
            Announcement sent to all members in {session.name}.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 460, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>Announce to Class</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: 'var(--sp-md)', background: 'rgba(200,168,78,0.06)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)', border: '1px solid rgba(200,168,78,0.15)' }}>
          Sending to all members booked in <strong>{session.name}</strong> ({session.day} {session.startTime}) via SMS + in-app.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Class time change this week" />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Message</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message..." />
          </div>
          <button
            onClick={valid ? () => setSent(true) : undefined}
            style={{
              width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
              background: valid ? 'var(--gold)' : 'var(--surf3)',
              color: valid ? '#fff' : 'var(--tm)',
              fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--ff)',
            }}
          >
            Send to Class
          </button>
        </div>
      </div>
    </div>
  );
}

function NewClassModal({ onClose }) {
  const [scheduleType, setScheduleType] = useState('single');
  const [recurringDays, setRecurringDays] = useState({});
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };
  const labelStyle = { fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--tp)' };

  const toggleDay = (day) => setRecurringDays(prev => ({ ...prev, [day]: !prev[day] }));

  return (
    <div className="drawerOverlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 500, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>New Class</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          {/* Class Name */}
          <div>
            <label style={labelStyle}>Class Name</label>
            <input style={inputStyle} placeholder="e.g. Tuesday Competitive" />
          </div>

          {/* Schedule Type Toggle */}
          <div>
            <label style={labelStyle}>Schedule</label>
            <div style={{ display: 'flex', gap: 4, background: 'var(--surf3)', borderRadius: 'var(--r-sm)', padding: 3 }}>
              <button
                onClick={() => setScheduleType('single')}
                style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: 'none', fontWeight: 600, fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'var(--ff)',
                  background: scheduleType === 'single' ? 'var(--surf)' : 'transparent',
                  color: scheduleType === 'single' ? 'var(--tp)' : 'var(--tm)',
                  boxShadow: scheduleType === 'single' ? 'var(--shadow-sm)' : 'none',
                }}
              >
                Single Class
              </button>
              <button
                onClick={() => setScheduleType('recurring')}
                style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: 'none', fontWeight: 600, fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'var(--ff)',
                  background: scheduleType === 'recurring' ? 'var(--surf)' : 'transparent',
                  color: scheduleType === 'recurring' ? 'var(--tp)' : 'var(--tm)',
                  boxShadow: scheduleType === 'recurring' ? 'var(--shadow-sm)' : 'none',
                }}
              >
                Recurring
              </button>
            </div>
          </div>

          {/* Single: Date picker */}
          {scheduleType === 'single' && (
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" style={inputStyle} />
            </div>
          )}

          {/* Recurring: Day selector */}
          {scheduleType === 'recurring' && (
            <div>
              <label style={labelStyle}>Repeat on</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
                      background: recurringDays[day] ? 'var(--gold)' : 'var(--surf)',
                      color: recurringDays[day] ? '#fff' : 'var(--ts)',
                      borderColor: recurringDays[day] ? 'var(--gold)' : 'var(--border)',
                    }}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)' }}>
            <div>
              <label style={labelStyle}>Start Time</label>
              <input type="time" style={inputStyle} defaultValue="17:00" />
            </div>
            <div>
              <label style={labelStyle}>End Time</label>
              <input type="time" style={inputStyle} defaultValue="18:30" />
            </div>
          </div>

          {/* Capacity + Location */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)' }}>
            <div>
              <label style={labelStyle}>Capacity</label>
              <input type="number" style={inputStyle} placeholder="12" />
            </div>
            <div>
              <label style={labelStyle}>Location</label>
              <input style={inputStyle} placeholder="123 Lakeshore Rd E, Oakville" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder="What will this class cover?" />
          </div>

          {/* Submit */}
          <button
            onClick={onClose}
            style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'var(--ff)' }}
          >
            {scheduleType === 'recurring' ? 'Create Recurring Classes' : 'Create Class'}
          </button>
        </div>
      </div>
    </div>
  );
}
