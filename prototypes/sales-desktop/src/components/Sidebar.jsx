import { useState, useEffect, useRef } from 'react';
import { Link, useLocation as useRouterLocation } from 'react-router-dom';
import s from '../styles/Sidebar.module.css';
import MemberApp from '../pages/member-app/MemberApp';

const UNREAD_PREVIEWS = [
  { name: 'Marcus Johnson', text: 'Hey, I saw your academy on Instagram...' },
  { name: 'Emily Watson', text: 'Can we reschedule to Saturday morning?' },
  { name: 'Ava Martinez', text: 'My son loved the trial class!' },
  { name: 'Mia Thompson', text: 'Sounds great, see you Saturday!' },
  { name: 'Marcus Davis', text: 'My card was updated, can you retry?' },
];

export default function Sidebar({ onInboxToggle }) {
  const routerLocation = useRouterLocation();
  const isActive = (path) => routerLocation.pathname === path;
  const [showMemberApp, setShowMemberApp] = useState(false);

  return (
    <>
      <aside className={s.sidebar}>
        <div className={s.logoWrap}>
          <div className={s.logoMark}>FC</div>
          <div className={s.logoText}>
            <div className={s.logoName}>FullControl</div>
            <div className={s.logoSub}>Command Center</div>
          </div>
        </div>
        <nav className={s.nav}>
          <span className={s.navLabel}>Main</span>
          <Link to="/home" className={`${s.navItem} ${isActive('/home') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
            <span>Home</span>
          </Link>
          <Link to="/schedule" className={`${s.navItem} ${isActive('/schedule') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <span>Schedule</span>
          </Link>
          <Link to="/marketing" className={`${s.navItem} ${isActive('/marketing') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
            <span>Marketing</span>
          </Link>
          <Link to="/content" className={`${s.navItem} ${isActive('/content') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
            <span>Content</span>
          </Link>
          <Link to="/sales" className={`${s.navItem} ${isActive('/sales') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
            <span>Sales</span>
          </Link>
          <Link to="/members" className={`${s.navItem} ${isActive('/members') ? s.active : ''}`}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <span>Members</span>
          </Link>

          <span className={s.navLabel} style={{ marginTop: 20 }}>Preview</span>
          <div className={`${s.navItem} ${s.previewItem}`} onClick={() => setShowMemberApp(true)}>
            <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg></div>
            <span>Member App</span>
            <span className={s.previewBadge}>Preview</span>
          </div>
          {/* Inbox card */}
          <InboxCard onClick={onInboxToggle} />
        </nav>
        <div className={s.sidebarFooter}>
          <div className={s.av}>ZS</div>
          <div>
            <div className={s.coachName}>Zoran Savic</div>
            <div className={s.coachRole}>Owner</div>
          </div>
          <Link to="/settings" className={s.settingsBtn}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </Link>
        </div>
      </aside>

      {showMemberApp && <MemberApp onClose={() => setShowMemberApp(false)} />}
    </>
  );
}

function InboxCard({ onClick }) {
  const [previewIdx, setPreviewIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const charRef = useRef(0);

  useEffect(() => {
    const msg = UNREAD_PREVIEWS[previewIdx];
    const full = `${msg.name}: ${msg.text}`;
    charRef.current = 0;
    setTyped('');
    const interval = setInterval(() => {
      charRef.current++;
      setTyped(full.slice(0, charRef.current));
      if (charRef.current >= full.length) {
        clearInterval(interval);
        setTimeout(() => {
          setPreviewIdx(i => (i + 1) % UNREAD_PREVIEWS.length);
        }, 2000);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [previewIdx]);

  return (
    <div className={s.inboxCard} onClick={onClick}>
      <div className={s.inboxTop}>
        <div className={s.inboxIcon}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span className={s.inboxDot} />
        </div>
        <div className={s.inboxText}>
          <span className={s.inboxLabel}>Messages</span>
          <span className={s.inboxCount}>5 unread</span>
        </div>
      </div>
      <div className={s.inboxPreview}>{typed}<span className={s.inboxCursor}>|</span></div>
    </div>
  );
}
