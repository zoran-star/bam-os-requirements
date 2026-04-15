import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import s from '../styles/Sidebar.module.css';

const NAV = [
  { to: '/home', name: 'Home', icon: 'home' },
  { to: '/inbox', name: 'Inbox', icon: 'inbox', badge: 5 },
  { to: '/pipeline', name: 'Leads', icon: 'pipeline' },
  { to: '/members', name: 'Members', icon: 'members' },
  { to: '/sessions', name: 'Classes', icon: 'sessions' },
  { name: 'Admin', icon: 'admin', children: [
    { to: '/admin', name: 'Approvals' },
    { to: '/analysis', name: 'Analysis' },
  ]},
];

const ICONS = {
  admin: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  home: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  analysis: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  pipeline: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  trials: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  posttrial: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  automations: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  onboarding: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  sessions: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="13" width="3" height="3" rx="0.5"/><rect x="14" y="13" width="3" height="3" rx="0.5"/></svg>,
  members: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  actions: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  payments: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  inbox: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
};

export default function Sidebar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('bam_theme') === 'dark'; } catch { return false; }
  });

  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    setDark(!dark);
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('bam_theme', next); } catch {}
  };

  return (
    <aside className={s.sidebar}>
      <div className={s.logoWrap}>
        <div className={s.logoMark}>BAM</div>
        <div className={s.logoText}>
          <div className={s.logoName}>BAM GTA</div>
          <div className={s.logoSub}>Staff Dashboard</div>
        </div>
      </div>
      <nav className={s.nav}>
        {NAV.map(item => item.children ? (
          <AdminNav key={item.name} item={item} isActive={isActive} />
        ) : (
          <Link
            key={item.to}
            to={item.to}
            className={`${s.navItem} ${isActive(item.to) ? s.active : ''}`}
          >
            <div className={s.navIcon}>{ICONS[item.icon]}</div>
            <span>{item.name}</span>
            {item.badge && <span className={s.inboxBadge}>{item.badge}</span>}
          </Link>
        ))}
      </nav>
      <div className={s.sidebarFooter}>
        <div className={s.av}>ZS</div>
        <div>
          <div className={s.userName}>Zoran Savic</div>
          <div className={s.userRole}>Owner</div>
        </div>
        <button className={s.themeBtn} onClick={toggleTheme} title="Toggle theme">
          {dark ? (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </div>
    </aside>
  );
}

function AdminNav({ item, isActive }) {
  const location = useLocation();
  const isChildActive = item.children.some(c => location.pathname === c.to);
  const [open, setOpen] = useState(isChildActive);

  return (
    <div>
      <div
        className={`${s.navItem} ${isChildActive ? s.active : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <div className={s.navIcon}>{ICONS[item.icon]}</div>
        <span>{item.name}</span>
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 'auto', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 140ms', opacity: 0.4 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {open && item.children.map(child => (
        <Link
          key={child.to}
          to={child.to}
          className={`${s.navItem} ${isActive(child.to) ? s.active : ''}`}
          style={{ paddingLeft: 44, fontSize: 'var(--fs-sm)' }}
        >
          <span>{child.name}</span>
        </Link>
      ))}
    </div>
  );
}
