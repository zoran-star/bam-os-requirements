import { useState } from 'react';
import { LEADS, LOST_TRIALS } from '../data/leads';
import { STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #3: Post-Trial & Closing
// Post-trial form (attended, good fit, lead sales person, notes)
// Done Trial stage only if Attended + Good Fit
// Red alert if form not filled within 5 min of session end
// Lost Trials view

export default function PostTrial() {
  const [tab, setTab] = useState('pending');
  const doneTrials = LEADS.filter(l => l.stage === 'done_trial');
  const withForm = doneTrials.filter(l => l.postTrialForm);
  const withoutForm = doneTrials.filter(l => !l.postTrialForm);

  const staff = (id) => STAFF.find(s => s.id === id);

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Post-Trial & Closing</h1>
        <p className={s.pageDesc}>Follow up after trials and close new members</p>
      </div>

      <div className={s.tabs}>
        <button className={`${s.tab} ${tab === 'pending' ? s.tabActive : ''}`} onClick={() => setTab('pending')}>
          Ready to Close ({withForm.length})
        </button>
        <button className={`${s.tab} ${tab === 'needs_form' ? s.tabActive : ''}`} onClick={() => setTab('needs_form')}>
          Needs Form ({withoutForm.length})
        </button>
        <button className={`${s.tab} ${tab === 'lost' ? s.tabActive : ''}`} onClick={() => setTab('lost')}>
          Lost Trials ({LOST_TRIALS.length})
        </button>
      </div>

      {tab === 'pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
          {withForm.map(lead => (
            <div key={lead.id} className={s.card}>
              <div className={s.flexBetween}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{lead.childName}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>
                    Parent: {lead.parentName} | Trial: {lead.trialDate}
                  </div>
                </div>
                <div className={s.flexGap}>
                  <span className={`${s.statusBadge} ${s.statusActive}`}>Good Fit</span>
                </div>
              </div>
              <div style={{ marginTop: 'var(--sp-md)', padding: 'var(--sp-md)', background: 'var(--surf2)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
                <div><strong>Sales Person:</strong> {staff(lead.postTrialForm.leadSalesPerson)?.name}</div>
                <div style={{ marginTop: 4 }}><strong>Notes:</strong> {lead.postTrialForm.notes}</div>
              </div>
              <div style={{ marginTop: 'var(--sp-md)' }}>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 'var(--sp-sm)' }}>
                  Last message: "{lead.messages[lead.messages.length - 1]?.text}" - {lead.lastActivity}
                </div>
                <div className={s.flexGap}>
                  <button className={`${s.btn} ${s.btnGold}`}>Send Onboarding Link</button>
                  <button className={s.btn}>Message Parent</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'needs_form' && (
        <div>
          {withoutForm.length === 0 ? (
            <div className={s.empty}><div className={s.emptyText}>All post-trial forms are complete</div></div>
          ) : (
            withoutForm.map(lead => (
              <div key={lead.id} className={s.card} style={{ marginBottom: 'var(--sp-md)', borderLeft: '3px solid var(--red)' }}>
                <div className={s.flexBetween}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{lead.childName}</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>Trial: {lead.trialDate}</div>
                  </div>
                  <button className={`${s.btn} ${s.btnDanger}`}>Fill Form Now</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'lost' && (
        <div>
          {LOST_TRIALS.length === 0 ? (
            <div className={s.empty}><div className={s.emptyText}>No lost trials</div></div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Child</th>
                  <th>Parent</th>
                  <th>Trial Date</th>
                  <th>Reason</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {LOST_TRIALS.map(lt => (
                  <tr key={lt.id}>
                    <td style={{ fontWeight: 600 }}>{lt.childName}</td>
                    <td>{lt.parentName}</td>
                    <td>{lt.trialDate}</td>
                    <td><span className={`${s.statusBadge} ${s.statusCancelled}`}>{lt.reason}</span></td>
                    <td style={{ color: 'var(--ts)', fontSize: 'var(--fs-sm)' }}>{lt.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
