import { useState } from 'react';
import { GHOSTED_LEADS } from '../data/leads';
import s from '../styles/shared.module.css';

// PRD #4: Lead Nurture Automations
// SMS sequences: Trial Reminder, Ghosted, Post-Trial follow-up
// Circuit breaker: any inbound message stops the sequence
// STOP opt-out on all sequences

const SEQUENCES = [
  {
    id: 'seq1', name: 'Trial Reminder', trigger: 'Trial booked', steps: [
      { delay: 'Immediately', message: 'Hi {first_name}! {child_name} is booked for a free trial at BAM GTA on {trial_date} at {trial_time}. See you there!' },
      { delay: '24h before trial', message: 'Reminder: {child_name}\'s free trial at BAM GTA is tomorrow at {trial_time}. Just bring comfortable clothes and sneakers!' },
      { delay: '1h before trial', message: 'Almost time! {child_name}\'s trial starts in 1 hour at BAM GTA. Parking is free in the lot behind the building.' },
    ],
    active: true, sent7d: 8, delivered: '97%',
  },
  {
    id: 'seq2', name: 'Ghosted SMS', trigger: 'No reply for 48h', steps: [
      { delay: '48h no reply', message: 'Hey {first_name}! Just checking in - still interested in getting {child_name} into basketball training? We have spots available this week.' },
      { delay: '4 days no reply', message: 'Hi {first_name} - wanted to make sure you saw my last message. We\'d love to have {child_name} try a free session. Want me to hold a spot?' },
      { delay: '7 days no reply', message: 'Last check-in {first_name} - no pressure at all. If {child_name} ever wants to try basketball training, we\'re here. Just reply anytime!' },
    ],
    active: true, sent7d: 4, delivered: '95%',
  },
  {
    id: 'seq3', name: 'Post-Trial Follow-up', trigger: 'Trial completed + no signup after 24h', steps: [
      { delay: '24h after trial', message: 'Hi {first_name}! Hope {child_name} had a great time at the trial. Would you like to get them signed up for regular sessions?' },
      { delay: '3 days after trial', message: 'Hey {first_name} - just wanted to follow up on {child_name}\'s trial. Any questions about our plans? Happy to help!' },
    ],
    active: true, sent7d: 3, delivered: '100%',
  },
  {
    id: 'seq4', name: 'No-Show Recovery', trigger: 'Missed trial', steps: [
      { delay: '1h after missed trial', message: 'Hi {first_name} - we missed {child_name} at today\'s trial session. No worries! Want to reschedule for another day this week?' },
      { delay: '2 days after miss', message: 'Hey {first_name} - just checking if you\'d like to rebook {child_name}\'s free trial. We have openings this Saturday!' },
    ],
    active: true, sent7d: 1, delivered: '100%',
  },
];

export default function Automations() {
  const [selectedSeq, setSelectedSeq] = useState(null);

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <h1 className={s.pageTitle}>Lead Nurture Automations</h1>
        <p className={s.pageDesc}>SMS sequences with circuit breaker - any inbound message stops the sequence</p>
      </div>

      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statValue}>{SEQUENCES.filter(s => s.active).length}</div>
          <div className={s.statLabel}>Active Sequences</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{SEQUENCES.reduce((a, s) => a + s.sent7d, 0)}</div>
          <div className={s.statLabel}>Sent (7 days)</div>
        </div>
        <div className={s.stat}>
          <div className={s.statValue}>{GHOSTED_LEADS.length}</div>
          <div className={s.statLabel}>In Ghosted Sequence</div>
        </div>
      </div>

      {/* Sequences */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
        {SEQUENCES.map(seq => (
          <div key={seq.id} className={s.card} style={{ cursor: 'pointer' }} onClick={() => setSelectedSeq(selectedSeq?.id === seq.id ? null : seq)}>
            <div className={s.flexBetween}>
              <div className={s.flexGap}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: seq.active ? 'var(--green)' : 'var(--tm)' }} />
                <div>
                  <div style={{ fontWeight: 700 }}>{seq.name}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>Trigger: {seq.trigger}</div>
                </div>
              </div>
              <div className={s.flexGap} style={{ gap: 'var(--sp-lg)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>{seq.sent7d}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Sent 7d</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>{seq.delivered}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Delivered</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--fm)' }}>{seq.steps.length}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>Steps</div>
                </div>
              </div>
            </div>

            {selectedSeq?.id === seq.id && (
              <div style={{ marginTop: 'var(--sp-xl)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-lg)' }}>
                <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-md)' }}>
                  Sequence Steps
                </div>
                {seq.steps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 'var(--sp-md)', marginBottom: 'var(--sp-md)', paddingLeft: 'var(--sp-md)', borderLeft: '2px solid var(--gold)' }}>
                    <div style={{ minWidth: 140 }}>
                      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--gold)' }}>Step {i + 1}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{step.delay}</div>
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', background: 'var(--surf2)', padding: 'var(--sp-md)', borderRadius: 'var(--r-sm)', flex: 1 }}>
                      {step.message}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 'var(--sp-md)', padding: 'var(--sp-md)', background: 'var(--warnl)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)' }}>
                  <strong>Circuit Breaker:</strong> Any inbound message from the lead immediately stops this sequence. All messages include STOP opt-out.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Ghosted Leads */}
      {GHOSTED_LEADS.length > 0 && (
        <div className={s.card} style={{ marginTop: 'var(--sp-xl)' }}>
          <h2 className={s.cardTitle}>Currently in Ghosted Sequence</h2>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Parent</th>
                <th>Child</th>
                <th>Last Contact</th>
                <th>Step</th>
                <th>Next Message</th>
              </tr>
            </thead>
            <tbody>
              {GHOSTED_LEADS.map(g => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 600 }}>{g.parentName}</td>
                  <td>{g.childName}</td>
                  <td>{g.lastContact}</td>
                  <td>{g.sequenceStep} of 3</td>
                  <td style={{ color: 'var(--gold)' }}>{g.nextMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
