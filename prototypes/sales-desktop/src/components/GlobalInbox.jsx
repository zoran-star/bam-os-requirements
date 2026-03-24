import { useState } from 'react';
import s from '../styles/GlobalInbox.module.css';

const CONVERSATIONS = [
  // Leads (from Sales)
  { id: 'c1', type: 'lead', initials: 'MJ', name: 'Marcus Johnson', time: '4h ago', preview: 'Hey, I saw your academy on Instagram. What age groups do you have?', channel: 'Instagram DM', unread: true },
  { id: 'c2', type: 'lead', initials: 'EW', name: 'Emily Watson', time: '6h ago', preview: 'Can we reschedule the trial to Saturday morning instead?', channel: 'SMS', unread: true },
  { id: 'c3', type: 'lead', initials: 'AM', name: 'Ava Martinez', time: '1d ago', preview: 'My son loved the trial class! What are the membership options?', channel: 'Email', unread: true },
  { id: 'c4', type: 'lead', initials: 'NK', name: 'Noah Kim', time: '2d ago', preview: 'Just signed up! When is the next beginner class?', channel: 'Instagram DM', unread: false },
  { id: 'c5', type: 'lead', initials: 'JR', name: 'Jake Rivera', time: '2d ago', preview: 'AI: Hi Jake! Following up — would you like to book a trial this week?', channel: 'SMS', unread: false },
  // Members
  { id: 'c6', type: 'member', initials: 'MT', name: 'Mia Thompson', time: '1d ago', preview: 'Sounds great, see you Saturday!', channel: 'In-App', unread: true },
  { id: 'c7', type: 'member', initials: 'CM', name: 'Carlos Martinez', time: '2d ago', preview: 'Can I switch to the Thursday 5pm session?', channel: 'In-App', unread: false },
  { id: 'c8', type: 'member', initials: 'JB', name: 'Jaylen Brooks', time: '3d ago', preview: 'Thanks for the makeup credit, Coach!', channel: 'SMS', unread: false },
  { id: 'c9', type: 'member', initials: 'MD', name: 'Marcus Davis', time: '4d ago', preview: 'My card was updated, can you retry the payment?', channel: 'In-App', unread: true },
];

export const UNREAD_COUNT = 5; // expose for sidebar

export default function GlobalInbox({ isOpen, onToggle }) {
  const [open, setOpen] = useState(false);
  const actualOpen = isOpen !== undefined ? isOpen : open;
  const toggle = onToggle || (() => setOpen(p => !p));
  const close = () => { if (onToggle) onToggle(); else setOpen(false); };
  const [filter, setFilter] = useState('All');
  const [sortBy, setSortBy] = useState('recent');
  const [conversations, setConversations] = useState(CONVERSATIONS);

  const unreadCount = conversations.filter(c => c.unread).length;

  const filtered = conversations.filter(c => {
    if (filter === 'All') return true;
    if (filter === 'Leads') return c.type === 'lead';
    if (filter === 'Members') return c.type === 'member';
    return c.channel === filter;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'unread') {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return 0; // 'recent' keeps original order (already sorted by time)
  });

  return (
    <>
      {/* Overlay */}
      {actualOpen && <div className={s.overlay} onClick={close} />}

      {/* Panel */}
      <div className={`${s.panel} ${actualOpen ? s.panelOpen : ''}`}>
        <div className={s.head}>
          <span className={s.title}>Messages</span>
          <button className={s.closeBtn} onClick={close}>&times;</button>
        </div>

        <div className={s.controls}>
          <div className={s.filters}>
            {['All', 'Leads', 'Members', 'SMS', 'Email', 'Instagram DM', 'In-App'].map(f => (
              <button
                key={f}
                className={`${s.filterBtn} ${filter === f ? s.filterActive : ''}`}
                onClick={() => setFilter(f)}
              >{f}</button>
            ))}
          </div>
          <div className={s.controlRow}>
            <div className={s.sortWrap}>
              <span className={s.sortLabel}>Sort:</span>
              <select className={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="recent">Most recent</option>
                <option value="unread">Unread first</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
            <button
              className={s.markAllRead}
              onClick={() => setConversations(prev => prev.map(c => ({ ...c, unread: false })))}
            >
              Mark all read
            </button>
          </div>
        </div>

        <div className={s.list}>
          {sorted.map(c => (
            <div key={c.id} className={`${s.thread} ${c.unread ? s.threadUnread : ''}`}>
              <div className={s.avatar}>{c.initials}</div>
              <div className={s.content}>
                <div className={s.top}>
                  <span className={s.name}>{c.name}</span>
                  <span className={s.time}>{c.time}</span>
                </div>
                <div className={s.preview}>{c.preview}</div>
                <div className={s.meta}>
                  <span className={`${s.typeBadge} ${c.type === 'lead' ? s.typeLead : s.typeMember}`}>
                    {c.type === 'lead' ? 'Lead' : 'Member'}
                  </span>
                  <span className={s.channel}>{c.channel}</span>
                  {c.unread && <div className={s.dot} />}
                </div>
                <div className={s.actions}>
                  <button className={s.actionBtn}>Reply</button>
                  {c.type === 'lead' && <button className={s.actionBtn}>View lead</button>}
                  {c.type === 'member' && <button className={s.actionBtn}>View profile</button>}
                </div>
              </div>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className={s.empty}>No conversations matching this filter.</div>
          )}
        </div>
      </div>
    </>
  );
}
