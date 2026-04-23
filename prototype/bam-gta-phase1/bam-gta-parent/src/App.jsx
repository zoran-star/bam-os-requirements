import { useState } from 'react';
import s from './styles/app.module.css';
import BookClasses from './pages/BookClasses';
import Messages from './pages/Messages';
import Profile from './pages/Profile';

const TABS = [
  { id: 'book', label: 'Classes', icon: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  { id: 'messages', label: 'Messages', icon: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, badge: 2 },
  { id: 'profile', label: 'Profile', icon: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
];

export default function App() {
  const [tab, setTab] = useState('book');

  return (
    <div className={s.shell}>
      <div className={s.content}>
        {tab === 'book' && <BookClasses />}
        {tab === 'messages' && <Messages />}
        {tab === 'profile' && <Profile />}
      </div>
      <div className={s.tabBar}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${s.tabItem} ${tab === t.id ? s.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            <div className={s.tabIconWrap}>
              {t.icon}
              {t.badge && <span className={s.tabDot} />}
            </div>
            <span className={s.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
