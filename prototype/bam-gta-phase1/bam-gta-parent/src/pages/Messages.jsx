import { useState } from 'react';
import { MESSAGES } from '../data/parent';
import s from '../styles/app.module.css';

// PRD #21: In-App Messaging
// Single conversation thread per parent (not per-child)
// All staff messages show as "BAM GTA"
// Announcements inline in the same thread

export default function Messages() {
  const [reply, setReply] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className={s.header}>
        <div className={s.headerTitle}>Messages</div>
        <div className={s.headerSub}>Chat with BAM GTA</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MESSAGES.map(msg => (
          <div
            key={msg.id}
            className={`${s.msgBubble} ${msg.type === 'announcement' ? s.msgAnnouncement : msg.from === 'You' ? s.msgOut : s.msgIn}`}
          >
            {msg.type === 'announcement' && (
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Announcement
              </div>
            )}
            <div className={s.msgSender}>{msg.from}</div>
            <div>{msg.text}</div>
            <div className={s.msgTime}>{msg.time}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surf)', display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-full)', fontSize: 14, background: 'var(--surf2)', color: 'var(--tp)' }}
          placeholder="Type a message..."
          value={reply}
          onChange={e => setReply(e.target.value)}
        />
        <button style={{ padding: '10px 16px', borderRadius: 'var(--r-full)', background: 'var(--gold)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </div>
  );
}
