import { useState } from 'react';
import PageBanner from '../components/PageBanner';
import s from '../styles/Members.module.css';
import sh from '../styles/shared.module.css';

const MEMBERS = [
  { id: 1, name: 'Carlos Martinez', status: 'Active', plan: 'Elite ($175/mo)', lastSession: 'Mar 14', joined: 'Sep 2025', health: 'green', photo: 'CM', payStatus: 'Current' },
  { id: 2, name: 'Mia Thompson', status: 'Active', plan: 'Intermediate ($125/mo)', lastSession: 'Mar 15', joined: 'Nov 2025', health: 'green', photo: 'MT', payStatus: 'Current' },
  { id: 3, name: 'Jaylen Brooks', status: 'Active', plan: 'Elite ($175/mo)', lastSession: 'Mar 12', joined: 'Jun 2025', health: 'yellow', photo: 'JB', payStatus: 'Current' },
  { id: 4, name: 'Sofia Reyes', status: 'Trial', plan: 'Free Trial', lastSession: 'Mar 16', joined: 'Mar 2026', health: 'green', photo: 'SR', payStatus: '—' },
  { id: 5, name: 'Ethan Nguyen', status: 'Paused', plan: 'Beginner ($95/mo)', lastSession: 'Feb 22', joined: 'Aug 2025', health: 'yellow', photo: 'EN', payStatus: 'Paused' },
  { id: 6, name: 'Ava Chen', status: 'Active', plan: 'Beginner ($95/mo)', lastSession: 'Mar 13', joined: 'Jan 2026', health: 'green', photo: 'AC', payStatus: 'Current' },
  { id: 7, name: 'Marcus Davis', status: 'Active', plan: 'Intermediate ($125/mo)', lastSession: 'Mar 11', joined: 'Apr 2025', health: 'red', photo: 'MD', payStatus: 'Failed' },
  { id: 8, name: 'Lily Park', status: 'Cancelled', plan: '—', lastSession: 'Feb 10', joined: 'Oct 2025', health: 'red', photo: 'LP', payStatus: '—' },
];

const PAUSES = [
  { name: 'Ethan Nguyen', player: 'Ethan Jr.', start: 'Feb 23', resume: 'Mar 23', reason: 'Family vacation', daysLeft: 7 },
  { name: 'Zara Okafor', player: 'Zara', start: 'Mar 1', resume: 'Apr 1', reason: 'Injury recovery', daysLeft: 16 },
];

const ACTIVITY = [
  { type: 'payment', icon: '💳', text: 'Payment received — Carlos Martinez ($175)', time: '2h ago' },
  { type: 'signup', icon: '🎉', text: 'New trial booked — Sofia Reyes (Saturday 10am)', time: '4h ago' },
  { type: 'alert', icon: '⚠️', text: 'Payment failed — Marcus Davis ($125)', time: '6h ago' },
  { type: 'pause', icon: '⏸️', text: 'Membership paused — Ethan Nguyen (vacation)', time: '1d ago' },
  { type: 'message', icon: '💬', text: 'New reply — Mia Thompson: "Sounds great, see you Saturday!"', time: '1d ago' },
  { type: 'cancel', icon: '🚪', text: 'Cancellation confirmed — Lily Park', time: '3d ago' },
];

const KPIS = [
  { label: 'Active Members', value: '42', trend: '+3', trendUp: true, ref: 'MEM-003a' },
  { label: 'New This Month', value: '6', trend: '+2 vs last', trendUp: true, ref: 'MEM-003b' },
  { label: 'Churned', value: '1', trend: '-1 vs last', trendUp: true, ref: 'MEM-003c' },
  { label: 'Churn Rate', value: '2.4%', trend: 'Healthy', trendUp: true, ref: 'MEM-003g' },
  { label: 'Avg Attendance', value: '8.2', trend: 'per class', trendUp: true, ref: 'MEM-003f' },
  { label: 'Avg Duration', value: '7.4mo', trend: '+0.6 vs last', trendUp: true, ref: 'MEM-003h' },
];

export default function Members() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [drawerMember, setDrawerMember] = useState(null);
  const [tab, setTab] = useState('directory');

  const activeCount = MEMBERS.filter(m => m.status === 'Active').length;
  const pausedCount = MEMBERS.filter(m => m.status === 'Paused').length;

  const filtered = MEMBERS.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const healthColor = h => h === 'green' ? s.healthGreen : h === 'yellow' ? s.healthYellow : s.healthRed;
  const statusClass = st =>
    st === 'Active' ? s.statusActive :
    st === 'Paused' ? s.statusPaused :
    st === 'Trial' ? s.statusTrial : s.statusCancelled;

  return (
    <main className={sh.main}>
      <PageBanner
        title="Members"
        stats={[
          { value: `${activeCount} Active`, explanation: 'Active members' },
          { value: `${pausedCount} Paused`, explanation: 'Paused members' },
          { value: '2.4% Churn', explanation: 'Monthly churn rate' },
        ]}
      />

      <div className={sh.scroll}>
        {/* Tab nav */}
        <div className={s.tabBar}>
          {['directory', 'metrics', 'pauses', 'activity'].map(t => (
            <button
              key={t}
              className={`${s.tabBtn} ${tab === t ? s.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'directory' ? 'Directory' : t === 'metrics' ? 'Business Metrics' : t === 'pauses' ? 'Pauses' : 'Activity Feed'}
            </button>
          ))}
        </div>

        {/* Directory */}
        {tab === 'directory' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Member Directory</h3>
              <span className={s.sectionRef}>MEM-011</span>
            </div>

            <div className={s.filterRow}>
              <input
                className={s.searchInput}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name..."
              />
              <select
                className={s.filterSelect}
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option>All</option>
                <option>Active</option>
                <option>Paused</option>
                <option>Trial</option>
                <option>Cancelled</option>
              </select>
            </div>

            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Last Session</th>
                    <th>Payment</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} className={s.tableRow} onClick={() => setDrawerMember(m)}>
                      <td>
                        <div className={s.memberCell}>
                          <div className={s.avatar}>{m.photo}</div>
                          <div>
                            <div className={s.memberName}>{m.name}</div>
                            <div className={s.memberJoined}>Joined {m.joined}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className={statusClass(m.status)}>{m.status}</span></td>
                      <td className={s.planCell}>{m.plan}</td>
                      <td className={s.sessionCell}>{m.lastSession}</td>
                      <td><span className={m.payStatus === 'Failed' ? s.payFailed : s.payNormal}>{m.payStatus}</span></td>
                      <td><span className={`${s.healthDot} ${healthColor(m.health)}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className={s.emptyState}>No members match your search.</div>}
            </div>
          </>
        )}

        {/* Business Metrics */}
        {tab === 'metrics' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Business Metrics</h3>
              <span className={s.sectionRef}>MEM-003</span>
            </div>
            <div className={s.kpiGrid}>
              {KPIS.map(k => (
                <div key={k.label} className={s.kpiCard}>
                  <div className={s.kpiLabel}>{k.label}</div>
                  <div className={s.kpiValue}>{k.value}</div>
                  <div className={s.kpiTrend}>
                    <span className={k.trendUp ? s.trendUp : s.trendDown}>{k.trend}</span>
                    <span className={s.kpiRef}>{k.ref}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>Your churn rate dropped below 3% this month — the Saturday trial pipeline is converting into long-term members. Keep the Saturday energy going.</span>
            </div>
          </>
        )}

        {/* Pauses */}
        {tab === 'pauses' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Active Pauses</h3>
              <span className={s.sectionRef}>MEM-012</span>
            </div>
            {PAUSES.map(p => (
              <div key={p.name} className={s.pauseCard}>
                <div className={s.pauseLeft}>
                  <div className={s.pauseName}>{p.name}</div>
                  <div className={s.pauseMeta}>
                    <span>{p.start} → {p.resume}</span>
                    <span>•</span>
                    <span>{p.reason}</span>
                  </div>
                </div>
                <div className={s.pauseRight}>
                  <span className={s.pauseDays}>{p.daysLeft}d left</span>
                  <button className={s.pauseAction}>Resume early</button>
                  <button className={s.pauseAction}>Extend</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Activity Feed */}
        {tab === 'activity' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Activity Feed</h3>
              <span className={s.sectionRef}>MEM-013</span>
            </div>
            <div className={s.feedList}>
              {ACTIVITY.map((a, i) => (
                <div key={i} className={s.feedCard}>
                  <div className={s.feedIcon}>{a.icon}</div>
                  <div className={s.feedBody}>
                    <div className={s.feedText}>{a.text}</div>
                    <div className={s.feedTime}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 360 Drawer */}
      {drawerMember && (
        <div className={s.drawerOverlay} onClick={() => setDrawerMember(null)}>
          <div className={s.drawer} onClick={e => e.stopPropagation()}>
            <button className={s.drawerClose} onClick={() => setDrawerMember(null)}>✕</button>
            <div className={s.drawerHeader}>
              <div className={s.drawerAvatar}>{drawerMember.photo}</div>
              <div>
                <div className={s.drawerName}>{drawerMember.name}</div>
                <span className={statusClass(drawerMember.status)}>{drawerMember.status}</span>
              </div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Membership</div>
              <div className={s.drawerRow}><span>Plan</span><span>{drawerMember.plan}</span></div>
              <div className={s.drawerRow}><span>Joined</span><span>{drawerMember.joined}</span></div>
              <div className={s.drawerRow}><span>Payment</span><span>{drawerMember.payStatus}</span></div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Attendance</div>
              <div className={s.drawerRow}><span>Last session</span><span>{drawerMember.lastSession}</span></div>
              <div className={s.drawerRow}><span>Total sessions</span><span>24</span></div>
              <div className={s.drawerRow}><span>Current streak</span><span>3 weeks</span></div>
            </div>

            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Internal Notes</div>
              <div className={s.drawerNote}>Interested in upgrading to Elite next month. Dad asked about sibling discount. — Coach Z, Mar 10</div>
              <input className={s.drawerNoteInput} placeholder="Add a note..." />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
