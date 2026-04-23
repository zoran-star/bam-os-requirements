import { useState } from 'react';
import { LEADS } from '../data/leads';
import { STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #2: Trial Management
// View all booked trials, today's trials, upcoming trials
// Trial check-in, no-show tracking, reschedule

export default function Trials() {
  const bookedTrials = LEADS.filter(l => l.stage === 'booked_trial');
  const today = bookedTrials.filter(l => l.trialDate === '2026-04-13');
  const upcoming = bookedTrials.filter(l => l.trialDate !== '2026-04-13');
  const [checkedIn, setCheckedIn] = useState({});

  const staff = (id) => STAFF.find(s => s.id === id);

  const toggleCheckIn = (leadId) => {
    setCheckedIn(prev => ({ ...prev, [leadId]: !prev[leadId] }));
  };

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Trial Management</h1>
        <p className={s.pageDesc}>Manage free trial sessions and check-ins</p>
      </div>

      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statValue}>{today.length}</div>
          <div className={s.statLabel}>Today's Trials</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{upcoming.length}</div>
          <div className={s.statLabel}>Upcoming</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{bookedTrials.length}</div>
          <div className={s.statLabel}>Total Booked</div>
        </div>
      </div>

      {/* Today's Trials */}
      {today.length > 0 && (
        <div className={s.card} style={{ marginBottom: 'var(--sp-xl)' }}>
          <h2 className={s.cardTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            Today's Trials
          </h2>
          {today.map(trial => (
            <div key={trial.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-md) 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{trial.childName}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                  Parent: {trial.parentName} | {trial.trialTime} - {trial.trialSession}
                </div>
                {staff(trial.leadSalesPerson) && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Assigned to {staff(trial.leadSalesPerson).name}</div>
                )}
              </div>
              <div className={s.flexGap}>
                <button
                  className={`${s.btn} ${checkedIn[trial.id] ? s.btnGold : ''}`}
                  onClick={() => toggleCheckIn(trial.id)}
                >
                  {checkedIn[trial.id] ? 'Checked In' : 'Check In'}
                </button>
                <button className={`${s.btn} ${s.btnDanger}`}>Missed Trial</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming Trials */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Upcoming Trials</h2>
        {upcoming.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyText}>No upcoming trials scheduled</div>
          </div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Parent</th>
                <th>Date</th>
                <th>Time</th>
                <th>Session</th>
                <th>Staff</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(trial => (
                <tr key={trial.id}>
                  <td style={{ fontWeight: 600 }}>{trial.childName}</td>
                  <td>{trial.parentName}</td>
                  <td>{trial.trialDate}</td>
                  <td>{trial.trialTime}</td>
                  <td>{trial.trialSession}</td>
                  <td>{staff(trial.leadSalesPerson)?.name}</td>
                  <td>
                    <button className={s.btn} style={{ fontSize: 'var(--fs-xs)' }}>Reschedule</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
