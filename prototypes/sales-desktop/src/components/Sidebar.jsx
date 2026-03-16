import { Link, useLocation } from 'react-router-dom';
import s from '../styles/Sidebar.module.css';

export default function Sidebar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  return (
    <aside className={s.sidebar}>
      <div className={s.logoWrap}>
        <div className={s.logoMark}>B</div>
        <div className={s.logoText}>
          <div className={s.logoName}>BAM OS</div>
          <div className={s.logoSub}>Command Center</div>
        </div>
      </div>
      <nav className={s.nav}>
        <span className={s.navLabel}>Main</span>
        <Link to="/home" className={`${s.navItem} ${isActive('/home') ? s.active : ''}`}>
          <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <span>Home</span>
        </Link>
        <Link to="/marketing" className={`${s.navItem} ${isActive('/marketing') ? s.active : ''}`}>
          <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          <span>Marketing</span>
        </Link>
        <Link to="/sales" className={`${s.navItem} ${isActive('/sales') ? s.active : ''}`}>
          <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
          <span>Sales</span>
        </Link>
        <Link to="/members" className={`${s.navItem} ${isActive('/members') ? s.active : ''}`}>
          <div className={s.navIcon}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
          <span>Members</span>
        </Link>
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
  );
}
