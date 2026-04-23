import { useState } from 'react';
import { SESSION_TEMPLATES } from '../data/sessions';
import { MEMBERS } from '../data/members';
import MemberDrawer from '../components/MemberDrawer';
import s from '../styles/shared.module.css';

// PRD #14: Staff Inbox (Business Number Inbox)
// Open assignment model (anyone can respond)
// Separate threads per channel per contact (SMS, in-app, Instagram)
// Read/unread tracking per staff, internal notes (yellow)
// Announcements = Admin only, targeted by class/session
// Instagram DM outbound = P0, inbound feed = P1
// Lead automation messages appear in threads in real time
// Lead-to-member conversation carryover

const CHANNELS = ['all', 'sms', 'in-app', 'instagram', 'email'];

const CONVERSATIONS = [
  {
    id: 'c1', contactName: 'Carlos Martinez', contactType: 'member', channel: 'sms',
    unread: true, lastMessage: 'Thanks for the update about Saturday!', lastTime: '10m ago',
    memberStatus: 'Active', plan: 'Elevate',
    messages: [
      { from: 'parent', text: 'Hey, will there be a session this Saturday?', time: '2h ago' },
      { from: 'staff', text: 'Yes! Saturday All Levels at 10am and Competitive at 12pm. Carlos Jr. is booked for the 10am.', time: '1h ago', sender: 'Filip' },
      { from: 'parent', text: 'Thanks for the update about Saturday!', time: '10m ago' },
    ],
  },
  {
    id: 'c2', contactName: 'Marcus Davis Sr.', contactType: 'member', channel: 'sms',
    unread: true, lastMessage: 'My card was updated, can you retry the payment?', lastTime: '30m ago',
    memberStatus: 'Active - Payment Failed', plan: 'Accelerate',
    messages: [
      { from: 'system', text: 'Auto SMS: Hi Marcus - your payment with BAM GTA has failed.', time: '9d ago', isAutomation: true },
      { from: 'parent', text: 'Sorry about that, I got a new card. How do I update it?', time: '2d ago' },
      { from: 'staff', text: "No worries! Here's the link to update your payment method: [Stripe link]", time: '2d ago', sender: 'Sergio' },
      { from: 'parent', text: 'My card was updated, can you retry the payment?', time: '30m ago' },
    ],
  },
  {
    id: 'c3', contactName: 'Emily Watson', contactType: 'lead', channel: 'sms',
    unread: false, lastMessage: '10:30 would be perfect, thank you!', lastTime: '6h ago',
    pipelineStage: 'Booked Trial',
    messages: [
      { from: 'system', text: 'Auto SMS: Trial reminder - Lily\'s trial at BAM GTA is tomorrow at 4:30 PM!', time: '1d ago', isAutomation: true },
      { from: 'parent', text: 'Can we reschedule to Saturday morning instead?', time: '6h ago' },
      { from: 'staff', text: 'Of course! I have 9am or 10:30am available this Saturday.', time: '6h ago', sender: 'Adrian' },
      { from: 'parent', text: '10:30 would be perfect, thank you!', time: '6h ago' },
    ],
  },
  {
    id: 'c4', contactName: 'Rachel Thompson', contactType: 'lead', channel: 'sms',
    unread: true, lastMessage: 'Perfect, see you soon!', lastTime: '1h ago',
    pipelineStage: 'Booked Trial',
    messages: [
      { from: 'parent', text: "We're so excited for today! What should Mia bring?", time: '3h ago' },
      { from: 'staff', text: 'Just comfortable athletic clothes and sneakers! Water provided.', time: '2h ago', sender: 'Filip' },
      { from: 'parent', text: 'Perfect, see you soon!', time: '1h ago' },
    ],
  },
  {
    id: 'c5', contactName: 'Sarah Mitchell', contactType: 'member', channel: 'in-app',
    unread: false, lastMessage: 'Jake had an amazing time today!', lastTime: '1d ago',
    memberStatus: 'Active', plan: 'Dominate',
    messages: [
      { from: 'parent', text: 'Jake had an amazing time today! He wants to come every day now haha', time: '1d ago' },
      { from: 'staff', text: "That's what we love to hear! He's really improving. See you tomorrow!", time: '1d ago', sender: 'Zoran' },
    ],
  },
  {
    id: 'c6', contactName: 'bam_gta_basketball', contactType: 'lead', channel: 'instagram',
    unread: true, lastMessage: 'DM from @hoop_dad_gta: My kid wants to try basketball', lastTime: '4h ago',
    pipelineStage: 'New DM',
    messages: [
      { from: 'parent', text: 'My kid wants to try basketball, do you guys do free trials?', time: '4h ago' },
    ],
  },
];

const ANNOUNCEMENTS = [
  { id: 'a1', title: 'Saturday Schedule Change', body: 'All Saturday sessions moved to 11am this week only (April 19). Normal schedule resumes April 26.', target: 'All members', sentDate: '2026-04-12', sentBy: 'Zoran' },
  { id: 'a2', title: 'Spring Break Camp', body: 'Spring break camp April 21-25! Full day 9am-3pm. $50/day or $200/week. DM to register.', target: 'All members + leads', sentDate: '2026-04-10', sentBy: 'Zoran' },
];

export default function Inbox() {
  const [channel, setChannel] = useState('all');
  const [selectedConvo, setSelectedConvo] = useState(null);
  const [reply, setReply] = useState('');
  const [replyChannel, setReplyChannel] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showProfile, setShowProfile] = useState(null);

  const filtered = CONVERSATIONS.filter(c => channel === 'all' || c.channel === channel);
  const unreadCount = CONVERSATIONS.filter(c => c.unread).length;

  return (
    <div className={s.page} style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className={s.pageHeader} style={{ flexShrink: 0 }}>
        <div className={s.flexBetween}>
          <div>
            <h1 className={s.pageTitle}>Staff Inbox</h1>
            <p className={s.pageDesc}>{unreadCount} unread conversations</p>
          </div>
          <button className={`${s.btn} ${s.btnGold}`} onClick={() => setShowAnnouncement(true)}>+ New Announcement</button>
        </div>
      </div>


      <div style={{ display: 'flex', flex: 1, gap: 0, minHeight: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {/* Conversation List */}
          <div style={{ width: 340, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surf)' }}>
            {/* Channel Filter */}
            <div style={{ padding: 'var(--sp-md)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
              {CHANNELS.map(ch => (
                <button key={ch} onClick={() => setChannel(ch)} style={{
                  padding: '4px 10px', borderRadius: 'var(--r-full)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer',
                  background: channel === ch ? 'var(--gold)' : 'var(--surf)', color: channel === ch ? '#fff' : 'var(--ts)',
                }}>
                  {ch === 'all' ? 'All' : ch.toUpperCase()}
                </button>
              ))}
            </div>
            {filtered.map(convo => (
              <div
                key={convo.id}
                onClick={() => setSelectedConvo(convo)}
                style={{
                  padding: 'var(--sp-md)', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: selectedConvo?.id === convo.id ? 'rgba(200,168,78,0.06)' : convo.unread ? 'var(--surf2)' : 'transparent',
                }}
              >
                <div className={s.flexBetween}>
                  <div style={{ fontWeight: convo.unread ? 700 : 500, fontSize: 'var(--fs-sm)' }}>{convo.contactName}</div>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{convo.lastTime}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ts)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {convo.lastMessage}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--surf3)', color: 'var(--tm)', fontWeight: 600, textTransform: 'uppercase' }}>
                    {convo.channel}
                  </span>
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: convo.contactType === 'member' ? 'var(--greenl)' : 'var(--bluel)', color: convo.contactType === 'member' ? 'var(--green)' : 'var(--blue)', fontWeight: 600 }}>
                    {convo.contactType}
                  </span>
                  {convo.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', marginTop: 3 }} />}
                </div>
              </div>
            ))}
          </div>

          {/* Conversation Detail */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
            {selectedConvo ? (
              <>
                {/* Header */}
                <div style={{ padding: 'var(--sp-lg)', borderBottom: '1px solid var(--border)', background: 'var(--surf)' }}>
                  <div className={s.flexBetween}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{selectedConvo.contactName}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--ts)' }}>
                        {selectedConvo.channel.toUpperCase()} | {selectedConvo.contactType === 'member' ? `${selectedConvo.memberStatus} - ${selectedConvo.plan}` : `Lead - ${selectedConvo.pipelineStage}`}
                      </div>
                    </div>
                    <button className={s.btn} style={{ fontSize: 'var(--fs-xs)' }} onClick={() => {
                      const member = MEMBERS.find(m => m.parentName === selectedConvo.contactName || m.childName === selectedConvo.contactName);
                      if (member) setShowProfile(member);
                    }}>View Profile</button>
                  </div>
                </div>
                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
                  {selectedConvo.messages.map((msg, i) => (
                    <div key={i} style={{
                      alignSelf: msg.from === 'parent' ? 'flex-start' : 'flex-end',
                      maxWidth: '75%',
                      padding: 'var(--sp-md)',
                      borderRadius: 'var(--r-sm)',
                      background: msg.isAutomation ? 'var(--warnl)' : msg.from === 'parent' ? 'var(--surf)' : 'rgba(200,168,78,0.08)',
                      border: msg.isAutomation ? '1px solid rgba(224,157,36,0.2)' : msg.from === 'parent' ? '1px solid var(--border)' : '1px solid rgba(200,168,78,0.15)',
                      fontSize: 'var(--fs-sm)',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-xs)', color: msg.isAutomation ? 'var(--warn)' : msg.from === 'parent' ? 'var(--ts)' : 'var(--gold)', marginBottom: 4 }}>
                        {msg.isAutomation ? 'Automation' : msg.from === 'parent' ? selectedConvo.contactName : (msg.sender || 'BAM GTA')}
                      </div>
                      <div>{msg.text}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 4 }}>{msg.time}</div>
                    </div>
                  ))}
                </div>
                {/* Reply */}
                <div style={{ padding: 'var(--sp-md)', borderTop: '1px solid var(--border)', background: 'var(--surf)' }}>
                  {(replyChannel || selectedConvo.channel) === 'email' && (
                    <input
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', marginBottom: 'var(--sp-sm)' }}
                      placeholder="Subject..."
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                    />
                  )}
                  <div style={{ display: 'flex', gap: 'var(--sp-sm)' }}>
                    <select
                      value={replyChannel || selectedConvo.channel}
                      onChange={e => setReplyChannel(e.target.value)}
                      style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)', fontWeight: 600, cursor: 'pointer' }}
                    >
                      <option value="sms">SMS</option>
                      <option value="in-app">In-App</option>
                      <option value="instagram">Instagram</option>
                      <option value="email">Email</option>
                    </select>
                    <input
                      style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)' }}
                      placeholder={(replyChannel || selectedConvo.channel) === 'email' ? 'Email body...' : `Reply via ${replyChannel || selectedConvo.channel}...`}
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                    />
                    <button className={`${s.btn} ${s.btnGold}`}>Send</button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm)' }}>
                Select a conversation
              </div>
            )}
          </div>
        </div>
      {/* Member Profile Drawer */}
      {showProfile && <MemberDrawer member={showProfile} onClose={() => setShowProfile(null)} />}

      {/* Announcement Modal */}
      {showAnnouncement && <AnnouncementModal onClose={() => setShowAnnouncement(false)} />}
    </div>
  );
}

function AnnouncementModal({ onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [selectedSession, setSelectedSession] = useState('');
  const [sent, setSent] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };

  if (sent) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
        <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 420, padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 32, marginBottom: 'var(--sp-md)' }}>
            <svg width="40" height="40" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginBottom: 'var(--sp-sm)' }}>Announcement Sent!</h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-xl)' }}>
            "{title}" has been sent via SMS and in-app to {audience === 'all' ? 'all active members' : `members in ${selectedSession}`}.
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--gold)', color: '#fff', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 500, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-xl)' }}>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>New Announcement</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer' }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: 'var(--sp-md)', background: 'rgba(200,168,78,0.06)', borderRadius: 'var(--r-sm)', marginBottom: 'var(--sp-lg)', fontSize: 'var(--fs-sm)', border: '1px solid rgba(200,168,78,0.15)' }}>
          <strong>Admin only.</strong> This will send via both SMS and in-app notification from the BAM GTA business number.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-lg)' }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Title</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Saturday Schedule Change" />
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Message</label>
            <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={body} onChange={e => setBody(e.target.value)} placeholder="Write your announcement..." />
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 4 }}>{body.length} characters</div>
          </div>

          {/* Audience */}
          <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
            <strong>Audience:</strong> All active members
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 4 }}>To announce to a specific class, use the Announce button on the session in the Sessions tab.</div>
          </div>

          {/* Delivery channels */}
          <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Delivery</div>
            <div style={{ display: 'flex', gap: 'var(--sp-lg)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                SMS
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" fill="none" stroke="var(--green)" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                In-App Notification
              </span>
            </div>
          </div>

          {/* Preview */}
          {title && body && (
            <div style={{ padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Preview</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{title}</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginTop: 4 }}>{body}</div>
            </div>
          )}

          <button
            onClick={valid ? () => setSent(true) : undefined}
            style={{
              width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
              background: valid ? 'var(--gold)' : 'var(--surf3)',
              color: valid ? '#fff' : 'var(--tm)',
              fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default',
              fontFamily: 'var(--ff)',
            }}
          >
            Send Announcement
          </button>
        </div>
      </div>
    </div>
  );
}
