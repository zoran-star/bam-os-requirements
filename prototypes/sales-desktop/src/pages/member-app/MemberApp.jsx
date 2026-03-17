import { useState } from 'react';
import s from '../../styles/member-app/MemberApp.module.css';

/* ═══════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════ */

const ANNOUNCEMENTS = [
  { title: 'Spring Break Schedule Changes', body: 'All Saturday sessions moved to 11am during March 22–29. Normal schedule resumes March 31.' },
  { title: 'Summer Camp Registration Open', body: 'Early bird pricing through April 15. Limited spots — register now!' },
];

const SHORTCUTS = [
  { icon: '📅', label: 'Book a Class' },
  { icon: '🗓️', label: 'My Schedule' },
  { icon: '🎟️', label: 'My Credits' },
  { icon: '💬', label: 'Messages' },
  { icon: '👤', label: 'Profile' },
  { icon: '⚙️', label: 'Settings' },
];

const CLASSES = [
  { id: 1, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', duration: '90 min', location: 'Main Court', color: '#C8A84E', capacity: '8/12', day: 'Today', booked: false, desc: 'Advanced ball-handling, finishing, and decision-making for competitive players.', credits: 2 },
  { id: 2, name: 'Youth Development', coach: 'Coach Marcus', time: '10:30 AM', duration: '60 min', location: 'Court B', color: '#3EAF5C', capacity: '10/15', day: 'Today', booked: true, desc: 'Fundamentals and game concepts for developing players ages 8–12.', credits: 1 },
  { id: 3, name: 'Shooting Lab', coach: 'Coach Zoran', time: '4:00 PM', duration: '60 min', location: 'Main Court', color: '#6366f1', capacity: '6/10', day: 'Today', booked: false, desc: 'Form shooting, catch-and-shoot, off-screen work. All levels.', credits: 1 },
  { id: 4, name: 'Open Gym', coach: 'Coach Marcus', time: '6:00 PM', duration: '120 min', location: 'Main Court', color: '#E09D24', capacity: '15/20', day: 'Today', booked: false, desc: 'Unstructured play and pickup games. All members welcome.', credits: 1 },
  { id: 5, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', duration: '90 min', location: 'Main Court', color: '#C8A84E', capacity: '4/12', day: 'Tomorrow', booked: false, desc: 'Advanced ball-handling, finishing, and decision-making for competitive players.', credits: 2 },
  { id: 6, name: 'Beginner Fundamentals', coach: 'Coach Ava', time: '11:00 AM', duration: '60 min', location: 'Court B', color: '#E05A42', capacity: '12/12', day: 'Tomorrow', booked: false, desc: 'First steps on the court. Dribbling, passing, and basic shooting.', credits: 1, full: true },
  { id: 7, name: 'Team Tactics', coach: 'Coach Zoran', time: '2:00 PM', duration: '75 min', location: 'Main Court', color: '#3EAF5C', capacity: '7/10', day: 'Wed, Mar 18', booked: false, desc: 'Pick-and-roll, off-ball movement, defensive rotations.', credits: 1 },
  { id: 8, name: 'Shooting Lab', coach: 'Coach Zoran', time: '4:00 PM', duration: '60 min', location: 'Main Court', color: '#6366f1', capacity: '5/10', day: 'Wed, Mar 18', booked: false, desc: 'Form shooting, catch-and-shoot, off-screen work. All levels.', credits: 1 },
];

const MY_UPCOMING = [
  { id: 2, name: 'Youth Development', coach: 'Coach Marcus', time: '10:30 AM', day: 'Today', color: '#3EAF5C' },
  { id: 5, name: 'Elite Skills Training', coach: 'Coach Zoran', time: '9:00 AM', day: 'Tomorrow', color: '#C8A84E' },
];

const MY_PAST = [
  { name: 'Elite Skills Training', time: '9:00 AM', day: 'Mar 14', attended: true },
  { name: 'Shooting Lab', time: '4:00 PM', day: 'Mar 13', attended: true },
  { name: 'Open Gym', time: '6:00 PM', day: 'Mar 11', attended: false },
];

const NOTIF_TYPES = [
  { label: 'Session reminders', key: 'session', locked: false },
  { label: 'Payment reminders', key: 'payment', locked: true },
  { label: 'Coach messages', key: 'messages', locked: false },
  { label: 'Report published', key: 'reports', locked: false },
  { label: 'Announcements', key: 'announce', locked: false },
];

const CAL_DAYS_WITH_CLASSES = [16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31];

/* ═══════════════════════════════════════════
   MEMBER APP (all screens in one component)
   ═══════════════════════════════════════════ */

export default function MemberApp({ onClose }) {
  const [tab, setTab] = useState('home');
  const [announceIdx, setAnnounceIdx] = useState(0);
  const [browseView, setBrowseView] = useState('list');
  const [selectedClass, setSelectedClass] = useState(null);
  const [bookingConfirm, setBookingConfirm] = useState(null);
  const [accountView, setAccountView] = useState('main');
  const [pauseDuration, setPauseDuration] = useState('2');
  const [calSelected, setCalSelected] = useState(16);
  const [notifs, setNotifs] = useState({ session: true, payment: true, messages: true, reports: true, announce: false });

  const toggleNotif = (key, locked) => {
    if (locked) return;
    setNotifs(n => ({ ...n, [key]: !n[key] }));
  };

  const handleBook = (cls) => {
    setBookingConfirm(cls);
    setSelectedClass(null);
  };

  const navTo = (t) => { setTab(t); setSelectedClass(null); setBookingConfirm(null); setAccountView('main'); };

  /* ─── Bottom Nav ─── */
  const BottomNav = () => (
    <nav className={s.bottomNav}>
      {[
        { id: 'home', label: 'Home', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
        { id: 'browse', label: 'Classes', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> },
        { id: 'schedule', label: 'Schedule', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> },
        { id: 'account', label: 'Account', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
      ].map(n => (
        <div key={n.id} className={`${s.navItem} ${tab === n.id ? s.navActive : ''}`} onClick={() => navTo(n.id)}>
          <div className={s.navIcon}>{n.icon}</div>
          <span className={s.navLabel}>{n.label}</span>
        </div>
      ))}
    </nav>
  );

  /* ─── HOME ─── */
  const HomePage = () => (
    <div className={s.pageScroll}>
      <div className={s.homeGreeting}>
        <div className={s.greetingText}>Good morning</div>
        <div className={s.greetingName}>Carlos 👋</div>
      </div>

      {/* Announcement Carousel — APP-006 / MEM-016 */}
      <div className={s.announceCarousel}>
        <div className={s.announceSlide}>
          <div className={s.announceSlideTitle}>{ANNOUNCEMENTS[announceIdx].title}</div>
          <div className={s.announceSlideBody}>{ANNOUNCEMENTS[announceIdx].body}</div>
        </div>
        <div className={s.announceDots}>
          {ANNOUNCEMENTS.map((_, i) => (
            <div key={i} className={`${s.announceDot} ${i === announceIdx ? s.announceDotActive : ''}`} onClick={() => setAnnounceIdx(i)} />
          ))}
        </div>
      </div>

      {/* Quick Actions — APP-006 */}
      <div className={s.shortcuts}>
        {SHORTCUTS.map(sc => (
          <div key={sc.label} className={s.shortcutBtn} onClick={() => {
            if (sc.label === 'Book a Class') navTo('browse');
            else if (sc.label === 'My Schedule') navTo('schedule');
            else if (sc.label === 'My Credits') navTo('schedule');
            else if (sc.label === 'Profile' || sc.label === 'Settings') navTo('account');
          }}>
            <div className={s.shortcutIcon}>{sc.icon}</div>
            <div className={s.shortcutLabel}>{sc.label}</div>
          </div>
        ))}
      </div>

      {/* Upcoming Sessions — APP-006 */}
      <div className={s.sectionHead}>
        <div className={s.sectionTitle}>Up Next</div>
        <div className={s.sectionLink} onClick={() => navTo('schedule')}>See all</div>
      </div>
      {MY_UPCOMING.slice(0, 2).map(u => (
        <div key={u.id} className={s.upcomingCard}>
          <div className={s.upcomingColor} style={{ background: u.color }} />
          <div className={s.upcomingInfo}>
            <div className={s.upcomingClass}>{u.name}</div>
            <div className={s.upcomingMeta}>{u.coach} · {u.day}</div>
          </div>
          <div className={s.upcomingTime}>{u.time}</div>
        </div>
      ))}

      {/* Streak Widget — MEM-035 / APP-006 */}
      <div className={s.streakWidget}>
        <div className={s.streakFire}>🔥</div>
        <div className={s.streakInfo}>
          <div className={s.streakCount}>4 Week Streak!</div>
          <div className={s.streakSub}>Keep it going — you're in the top 10%</div>
        </div>
      </div>

      {/* Credit Balance — APP-021 */}
      <div className={s.creditWidget}>
        <div className={s.creditLeft}>
          <div className={s.creditLabel}>Session Credits</div>
          <div className={s.creditValue}>6</div>
        </div>
        <div className={s.creditReset}>Resets Apr 1 · 1 make-up</div>
      </div>
    </div>
  );

  /* ─── BROWSE CLASSES ─── */
  const BrowsePage = () => {
    const days = [...new Set(CLASSES.map(c => c.day))];

    return (
      <div className={s.pageScroll}>
        <div className={s.browseToggle}>
          <button className={`${s.browseToggleBtn} ${browseView === 'list' ? s.browseToggleActive : ''}`} onClick={() => setBrowseView('list')}>List</button>
          <button className={`${s.browseToggleBtn} ${browseView === 'calendar' ? s.browseToggleActive : ''}`} onClick={() => setBrowseView('calendar')}>Calendar</button>
        </div>

        {browseView === 'list' ? (
          days.map(day => (
            <div key={day} className={s.dayGroup}>
              <div className={s.dayLabel}>{day}</div>
              {CLASSES.filter(c => c.day === day).map(cls => (
                <div key={cls.id} className={s.classCard} onClick={() => setSelectedClass(cls)}>
                  <div className={s.classColor} style={{ background: cls.color }} />
                  <div className={s.classInfo}>
                    <div className={s.className}>{cls.name}</div>
                    <div className={s.classMeta}>{cls.coach} · {cls.location}</div>
                  </div>
                  <div className={s.classRight}>
                    <div className={s.classTime}>{cls.time}</div>
                    <div className={s.classCapacity}>{cls.capacity}</div>
                    {cls.booked ? (
                      <span className={s.classBookedBtn}>Booked ✓</span>
                    ) : cls.full ? (
                      <button className={s.classWaitlistBtn} onClick={e => e.stopPropagation()}>Waitlist</button>
                    ) : (
                      <button className={s.classBookBtn} onClick={e => { e.stopPropagation(); handleBook(cls); }}>Book</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          /* Calendar View — APP-015b */
          <div className={s.calGrid}>
            <div className={s.calHeader}>
              <div className={s.calMonth}>March 2026</div>
              <div className={s.calNav}>
                <button className={s.calNavBtn}>‹</button>
                <button className={s.calNavBtn}>›</button>
              </div>
            </div>
            <div className={s.calDayNames}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className={s.calDayName}>{d}</div>
              ))}
            </div>
            <div className={s.calDays}>
              {/* March 2026 starts on Sunday */}
              {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                const hasClasses = CAL_DAYS_WITH_CLASSES.includes(day);
                return (
                  <div
                    key={day}
                    className={`${s.calDay} ${day === 16 ? s.calDayToday : ''} ${day === calSelected ? s.calDaySelected : ''}`}
                    onClick={() => setCalSelected(day)}
                  >
                    <span className={s.calDayNum}>{day}</span>
                    {hasClasses && (
                      <div className={s.calDots}>
                        <div className={s.calDotColor} style={{ background: '#C8A84E' }} />
                        <div className={s.calDotColor} style={{ background: '#3EAF5C' }} />
                        {day % 3 === 0 && <div className={s.calDotColor} style={{ background: '#6366f1' }} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Sessions for selected day */}
            <div className={s.dayGroup}>
              <div className={s.dayLabel}>{calSelected === 16 ? 'Today' : `Mar ${calSelected}`}</div>
              {CLASSES.filter(c => c.day === 'Today').slice(0, 3).map(cls => (
                <div key={cls.id} className={s.classCard} onClick={() => setSelectedClass(cls)}>
                  <div className={s.classColor} style={{ background: cls.color }} />
                  <div className={s.classInfo}>
                    <div className={s.className}>{cls.name}</div>
                    <div className={s.classMeta}>{cls.coach} · {cls.time}</div>
                  </div>
                  <div className={s.classRight}>
                    {cls.booked ? (
                      <span className={s.classBookedBtn}>Booked ✓</span>
                    ) : (
                      <button className={s.classBookBtn} onClick={e => { e.stopPropagation(); handleBook(cls); }}>Book</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ─── MY SCHEDULE ─── */
  const SchedulePage = () => (
    <div className={s.pageScroll}>
      {/* Credit balance widget — APP-021 */}
      <div className={s.creditWidget}>
        <div className={s.creditLeft}>
          <div className={s.creditLabel}>Session Credits</div>
          <div className={s.creditValue}>6</div>
        </div>
        <div className={s.creditReset}>Resets Apr 1 · 1 make-up credit</div>
      </div>

      {/* Upcoming — APP-018 */}
      <div className={s.scheduleSection}>
        <div className={s.scheduleLabel}>Upcoming</div>
        {MY_UPCOMING.map(u => (
          <div key={u.id} className={s.scheduleCard}>
            <div className={s.classColor} style={{ background: u.color }} />
            <div className={s.classInfo}>
              <div className={s.className}>{u.name}</div>
              <div className={s.classMeta}>{u.day} · {u.time} · {u.coach}</div>
            </div>
            <button className={s.scheduleCancelBtn}>Cancel</button>
          </div>
        ))}
      </div>

      {/* Past 30 days — APP-018 */}
      <div className={s.scheduleSection}>
        <div className={s.scheduleLabel}>Past 30 Days</div>
        {MY_PAST.map((p, i) => (
          <div key={i} className={s.scheduleCard}>
            <div className={s.classColor} style={{ background: '#A5A19A' }} />
            <div className={s.classInfo}>
              <div className={s.className}>{p.name}</div>
              <div className={s.classMeta}>{p.day} · {p.time}</div>
            </div>
            {p.attended ? (
              <span className={s.attendedBadge}>Attended</span>
            ) : (
              <span className={s.missedBadge}>Missed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── ACCOUNT ─── */
  const AccountPage = () => {
    if (accountView === 'pause') return <PauseFlow />;
    if (accountView === 'notifications') return <NotificationsView />;
    if (accountView === 'password') return <PasswordChange />;

    return (
      <div className={s.pageScroll}>
        <div className={s.accountHeader}>
          <div className={s.accountAvatar}>CM</div>
          <div className={s.accountName}>Carlos Martinez</div>
          <div className={s.accountEmail}>carlos.m@email.com</div>
          <div className={s.accountPlan}>Elite Plan — $175/mo</div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Membership</div>
          <div className={s.accountRow} onClick={() => setAccountView('pause')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>⏸️</span><span className={s.accountRowLabel}>Pause Membership</span></div>
            <span className={s.accountRowChevron}>›</span>
          </div>
          <div className={s.accountRow}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>⬆️</span><span className={s.accountRowLabel}>Change Plan</span></div>
            <span className={s.accountRowChevron}>›</span>
          </div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Settings</div>
          <div className={s.accountRow} onClick={() => setAccountView('notifications')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>🔔</span><span className={s.accountRowLabel}>Notifications</span></div>
            <span className={s.accountRowChevron}>›</span>
          </div>
          <div className={s.accountRow} onClick={() => setAccountView('password')}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>🔒</span><span className={s.accountRowLabel}>Change Password</span></div>
            <span className={s.accountRowChevron}>›</span>
          </div>
        </div>

        <div className={s.accountSection}>
          <div className={s.accountSectionTitle}>Support</div>
          <div className={s.accountRow}>
            <div className={s.accountRowLeft}><span className={s.accountRowIcon}>💬</span><span className={s.accountRowLabel}>Contact Academy</span></div>
            <span className={s.accountRowChevron}>›</span>
          </div>
        </div>
      </div>
    );
  };

  /* ─── PAUSE FLOW — APP-009 / APP-009a / APP-009b ─── */
  const PauseFlow = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Pause Membership</div>
        <div className={s.pauseFlowSub}>
          Your billing will be suspended during the pause. You won't be able to book sessions until you resume. You can end the pause early at any time.
        </div>

        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Duration (weeks)</div>
          <select className={s.pauseFormInput} value={pauseDuration} onChange={e => setPauseDuration(e.target.value)}>
            <option value="1">1 week</option>
            <option value="2">2 weeks</option>
            <option value="3">3 weeks</option>
            <option value="4">4 weeks</option>
          </select>
        </div>

        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Start date</div>
          <input className={s.pauseFormInput} type="date" defaultValue="2026-03-17" />
        </div>

        <div className={s.pausePreview}>
          <div className={s.pausePreviewRow}><span>Pause starts</span><span>Mar 17, 2026</span></div>
          <div className={s.pausePreviewRow}><span>Auto-resume</span><span>{pauseDuration === '1' ? 'Mar 24' : pauseDuration === '2' ? 'Mar 31' : pauseDuration === '3' ? 'Apr 7' : 'Apr 14'}, 2026</span></div>
          <div className={s.pausePreviewRow}><span>Billing impact</span><span>No charge during pause</span></div>
          <div className={s.pausePreviewRow}><span>Remaining pauses</span><span>1 of 2 this year</span></div>
        </div>

        <button className={s.pauseSubmitBtn}>Confirm Pause</button>
      </div>
    </div>
  );

  /* ─── NOTIFICATIONS — APP-010 / APP-022a ─── */
  const NotificationsView = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.sectionHead}>
        <div className={s.sectionTitle}>Notification Preferences</div>
      </div>
      <div className={s.notifList}>
        {NOTIF_TYPES.map(n => (
          <div key={n.key} className={s.notifRow}>
            <div className={s.notifLabel}>
              {n.label}
              {n.locked && <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 6 }}>(required)</span>}
            </div>
            <button
              className={`${s.notifToggle} ${notifs[n.key] ? s.notifToggleOn : ''}`}
              onClick={() => toggleNotif(n.key, n.locked)}
              style={n.locked ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <div className={s.notifToggleDot} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  /* ─── PASSWORD CHANGE — APP-023a ─── */
  const PasswordChange = () => (
    <div className={s.pageScroll}>
      <div style={{ padding: '0 20px' }}>
        <button className={s.detailBack} style={{ padding: '0 0 12px' }} onClick={() => setAccountView('main')}>← Back to Account</button>
      </div>
      <div className={s.pauseFlow}>
        <div className={s.pauseFlowTitle}>Change Password</div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Current password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Enter current password" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>New password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Enter new password" />
        </div>
        <div className={s.pauseFormGroup}>
          <div className={s.pauseFormLabel}>Confirm new password</div>
          <input className={s.pauseFormInput} type="password" placeholder="Confirm new password" />
        </div>
        <button className={s.pauseSubmitBtn}>Update Password</button>
      </div>
    </div>
  );

  /* ─── CLASS DETAIL — APP-017 ─── */
  const ClassDetail = () => (
    <div className={s.detailOverlay}>
      <button className={s.detailBack} onClick={() => setSelectedClass(null)}>← Back</button>
      <div className={s.detailContent}>
        <div className={s.detailHero} style={{ borderLeft: `4px solid ${selectedClass.color}` }}>
          <div className={s.detailClassName}>{selectedClass.name}</div>
          <div className={s.detailMeta}>{selectedClass.day} · {selectedClass.time} · {selectedClass.duration}</div>
        </div>

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Details</div>
          <div className={s.detailRow}><span>Location</span><span>{selectedClass.location}</span></div>
          <div className={s.detailRow}><span>Capacity</span><span>{selectedClass.capacity}</span></div>
          <div className={s.detailRow}><span>Credits</span><span>{selectedClass.credits} credit{selectedClass.credits > 1 ? 's' : ''}</span></div>
        </div>

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Coach</div>
          <div className={s.detailCoach}>
            <div className={s.detailCoachAvatar}>{selectedClass.coach.split(' ')[1]?.[0] || 'C'}</div>
            <div>
              <div className={s.detailCoachName}>{selectedClass.coach}</div>
              <div className={s.detailCoachRole}>Head Trainer</div>
            </div>
          </div>
        </div>

        <div className={s.detailSection}>
          <div className={s.detailSectionTitle}>Description</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ts)', lineHeight: 1.55 }}>{selectedClass.desc}</div>
        </div>

        {selectedClass.booked ? (
          <button className={s.detailBookBtn} style={{ background: 'var(--green)' }}>Booked ✓</button>
        ) : selectedClass.full ? (
          <button className={s.detailBookBtn} style={{ background: 'var(--warn)' }}>Join Waitlist</button>
        ) : (
          <button className={s.detailBookBtn} onClick={() => handleBook(selectedClass)}>
            Book — {selectedClass.credits} credit{selectedClass.credits > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );

  /* ─── BOOKING CONFIRMATION — APP-016a ─── */
  const BookingConfirm = () => (
    <div className={s.confirmOverlay}>
      <div className={s.confirmCheck}>✓</div>
      <div className={s.confirmTitle}>You're booked!</div>
      <div className={s.confirmSub}>
        {bookingConfirm.name}<br />
        {bookingConfirm.day} at {bookingConfirm.time}
      </div>
      <div className={s.confirmActions}>
        <button className={s.confirmPrimary} onClick={() => { setBookingConfirm(null); navTo('schedule'); }}>View My Schedule</button>
        <button className={s.confirmSecondary} onClick={() => setBookingConfirm(null)}>Back to Classes</button>
      </div>
    </div>
  );

  /* ─── RENDER ─── */
  const content = (
    <div className={s.appShell}>
      {/* Top bar */}
      <div className={s.topBar}>
        <div className={s.topBarTitle}>
          {tab === 'home' ? 'BAM' : tab === 'browse' ? 'Classes' : tab === 'schedule' ? 'My Schedule' : 'Account'}
        </div>
        <div className={s.topBarRight}>
          <button className={s.topBarBtn}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
          <div className={s.topBarAvatar}>CM</div>
        </div>
      </div>

      {/* Page body */}
      <div className={s.appBody} style={{ position: 'relative' }}>
        {tab === 'home' && <HomePage />}
        {tab === 'browse' && <BrowsePage />}
        {tab === 'schedule' && <SchedulePage />}
        {tab === 'account' && <AccountPage />}

        {/* Overlays */}
        {selectedClass && <ClassDetail />}
        {bookingConfirm && <BookingConfirm />}
      </div>

      <BottomNav />
    </div>
  );

  /* If onClose is provided, render inside phone frame */
  if (onClose) {
    return (
      <div className={s.phoneFrame} onClick={onClose}>
        <div className={s.phoneBezel} onClick={e => e.stopPropagation()}>
          <div className={s.phoneNotch}><div className={s.phoneNotchInner} /></div>
          <button className={s.phoneCloseBtn} onClick={onClose}>✕ Close preview</button>
          {content}
        </div>
      </div>
    );
  }

  return content;
}
