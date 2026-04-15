import { useState } from 'react';
import { LEADS, PIPELINE_STAGES } from '../data/leads';
import { STAFF } from '../data/members';
import s from '../styles/shared.module.css';

// PRD #1: Lead Pipeline
// Kanban only. Stages: Interested -> Booked Trial -> Done Trial
// Leads that finished trial but haven't had their form filled = "Needs Form" column (red, before Booked Trial)

const COLUMNS = [
  { id: 'interested', label: 'Interested', color: 'var(--blue)' },
  { id: 'responded', label: 'Responded', color: 'var(--gold)' },
  { id: 'booked_trial', label: 'Booked Trial', color: 'var(--warn)' },
  { id: 'done_trial', label: 'Done Trial', color: 'var(--green)' },
];

// Stage-specific actions (no manual stage moves)
const STAGE_ACTIONS = {
  interested: [
    { label: 'Abandoned', action: 'abandoned', style: 'danger' },
    { label: 'Lost', action: 'lost', style: 'danger' },
  ],
  responded: [
    { label: 'Abandoned', action: 'abandoned', style: 'danger' },
    { label: 'Lost', action: 'lost', style: 'danger' },
    { label: 'Ghosted', action: 'ghosted', style: 'warn' },
  ],
  booked_trial: [
    { label: 'Abandoned', action: 'abandoned', style: 'danger' },
  ],
  done_trial: [
    { label: 'Won', action: 'won', style: 'gold' },
    { label: 'Lost', action: 'lost', style: 'danger' },
    { label: 'Abandoned', action: 'abandoned', style: 'danger' },
  ],
};

export default function Pipeline() {
  const [leads, setLeads] = useState(LEADS);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showLostReason, setShowLostReason] = useState(false);
  const getColumnLeads = (colId) => leads.filter(l => l.stage === colId);

  // Booked Trial leads whose trial already happened but form not filled = red card, sorted to top
  const needsForm = (lead) => lead.stage === 'booked_trial' && lead.trialCompleted && !lead.postTrialForm;
  const isToday = (lead) => lead.trialDate === '2026-04-13';
  const sortedColumnLeads = (colId) => {
    const col = getColumnLeads(colId);
    if (colId === 'booked_trial') {
      return [...col].sort((a, b) => {
        // Needs form first
        if (needsForm(a) !== needsForm(b)) return needsForm(b) ? 1 : -1;
        // Then today's trials
        if (isToday(a) !== isToday(b)) return isToday(b) ? 1 : -1;
        // Then by trial date soonest first
        if (a.trialDate && b.trialDate) return a.trialDate.localeCompare(b.trialDate);
        return 0;
      });
    }
    return col;
  };

  const staff = (id) => STAFF.find(s => s.id === id);

  const needsFormCount = leads.filter(needsForm).length;

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div className={s.flexBetween}>
          <div>
            <h1 className={s.pageTitle}>Lead Pipeline</h1>
            <p className={s.pageDesc}>Track leads from first contact to signup</p>
          </div>
          <div className={s.flexGap}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)' }}>{leads.length} leads</span>
            {needsFormCount > 0 && (
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)', background: 'var(--redl)', padding: '3px 10px', borderRadius: 'var(--r-full)' }}>
                {needsFormCount} need form
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className={s.kanban}>
        {COLUMNS.map(col => {
          const colLeads = sortedColumnLeads(col.id);
          return (
            <div
              key={col.id}
              className={s.kanbanCol}
            >
              <div className={s.kanbanColHeader}>
                <div className={s.flexGap}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                  <span className={s.kanbanColTitle}>{col.label}</span>
                  <span className={s.kanbanCount}>{colLeads.length}</span>
                </div>
              </div>
              {colLeads.map(lead => {
                const isRedCard = needsForm(lead);
                return (
                  <div
                    key={lead.id}
                    className={`${s.kanbanCard} ${lead.needsAttention && !isRedCard ? s.kanbanCardAlert : ''}`}
                    style={isRedCard ? { borderLeft: '3px solid var(--red)', background: 'rgba(224,90,66,0.04)' } : undefined}
                    onClick={() => setSelectedLead(lead)}
                  >
                    <div className={s.kanbanCardName} style={isRedCard ? { color: 'var(--red)' } : undefined}>{lead.childName}</div>
                    <div className={s.kanbanCardMeta}>{lead.parentName}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)' }}>{lead.lastActivity}</span>
                      {isRedCard ? (
                        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)' }}>Fill form</span>
                      ) : (
                        <>
                          {lead.trialDate && (
                            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--gold)' }}>
                              Trial: {lead.trialDate === '2026-04-13' ? 'Today' : lead.trialDate}
                            </span>
                          )}
                          {lead.needsAttention && (
                            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--gold)' }}>!</span>
                          )}
                        </>
                      )}
                    </div>
                    {/* Staff name only on Done Trial cards with completed form */}
                    {lead.stage === 'done_trial' && lead.postTrialForm && staff(lead.postTrialForm.leadSalesPerson) && (
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 4 }}>
                        {staff(lead.postTrialForm.leadSalesPerson).name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Lead Drawer */}
      {selectedLead && (
        <div className={s.drawerOverlay} onClick={() => setSelectedLead(null)}>
          <div className={s.drawer} onClick={e => e.stopPropagation()}>
            <div className={s.drawerHeader}>
              <h2 className={s.drawerTitle}>{selectedLead.childName}</h2>
              <button className={s.drawerClose} onClick={() => setSelectedLead(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* POST-TRIAL FORM - top of drawer, most prominent, for booked_trial leads whose trial happened */}
            {needsForm(selectedLead) && (
              <div style={{ marginBottom: 'var(--sp-xl)', padding: 'var(--sp-lg)', background: 'var(--redl)', borderRadius: 'var(--r-md)', border: '2px solid rgba(224,90,66,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <svg width="20" height="20" fill="none" stroke="var(--red)" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <div style={{ fontWeight: 800, color: 'var(--red)', fontSize: 'var(--fs-lg)' }}>Post-Trial Form</div>
                </div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ts)', marginBottom: 16 }}>
                  {selectedLead.childName} finished their trial. Fill this form to move them forward.
                </div>
                <PostTrialForm lead={selectedLead} staff={STAFF} onSubmit={(form) => {
                  const moveToDone = form.attended && form.goodFit;
                  setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, postTrialForm: form, stage: moveToDone ? 'done_trial' : l.stage } : l));
                  setSelectedLead(prev => ({ ...prev, postTrialForm: form, stage: moveToDone ? 'done_trial' : prev.stage }));
                }} />
              </div>
            )}

            {/* Completed post-trial form display */}
            {selectedLead.postTrialForm && (
              <div style={{ marginBottom: 'var(--sp-xl)', padding: 'var(--sp-md)', background: 'var(--greenl)', borderRadius: 'var(--r-sm)', border: '1px solid rgba(62,175,92,0.2)' }}>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 'var(--fs-sm)' }}>Post-Trial Form</div>
                <div style={{ fontSize: 'var(--fs-sm)' }}>Attended: {selectedLead.postTrialForm.attended ? 'Yes' : 'No'} | Good Fit: {selectedLead.postTrialForm.goodFit ? 'Yes' : 'No'}</div>
                <div style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}><strong>Lead Sales Person:</strong> {staff(selectedLead.postTrialForm.leadSalesPerson)?.name}</div>
                {selectedLead.postTrialForm.notes && <div style={{ fontSize: 'var(--fs-sm)', marginTop: 4, color: 'var(--ts)' }}>{selectedLead.postTrialForm.notes}</div>}
              </div>
            )}

            {/* Lead Info */}
            <div style={{ marginBottom: 'var(--sp-xl)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-md)', fontSize: 'var(--fs-sm)' }}>
                <div><span style={{ color: 'var(--tm)' }}>Parent:</span> <strong>{selectedLead.parentName}</strong></div>
                <div><span style={{ color: 'var(--tm)' }}>Age:</span> <strong>{selectedLead.childAge}</strong></div>
                <div><span style={{ color: 'var(--tm)' }}>Skill Level:</span> <strong>{selectedLead.skillLevel || '-'}</strong></div>
                <div><span style={{ color: 'var(--tm)' }}>Near Oakville:</span> <strong>{selectedLead.nearOakville ? 'Yes' : 'No'}</strong></div>
                <div><span style={{ color: 'var(--tm)' }}>Days Available:</span> <strong>{selectedLead.daysAvailable || '-'}</strong></div>
                <div><span style={{ color: 'var(--tm)' }}>Can Start:</span> <strong>{selectedLead.startTimeline || '-'}</strong></div>
                {selectedLead.trialDate && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--tm)' }}>Trial:</span>{' '}
                    <strong style={{ color: 'var(--gold)' }}>{selectedLead.trialDate} at {selectedLead.trialTime}</strong>
                    {selectedLead.trialSession && <span style={{ color: 'var(--ts)' }}> - {selectedLead.trialSession}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 'var(--sp-xl)' }}>
              <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, display: 'block', marginBottom: 6 }}>Notes</label>
              <textarea
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', minHeight: 70, resize: 'vertical', fontFamily: 'var(--ff)' }}
                defaultValue={selectedLead.notes || ''}
                placeholder="Add notes about this lead..."
                onChange={e => {
                  setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, notes: e.target.value } : l));
                }}
              />
            </div>

            {/* Conversation */}
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-md)' }}>Conversation</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
              {selectedLead.messages.map((msg, i) => (
                <div key={i} style={{
                  alignSelf: msg.from === 'parent' ? 'flex-start' : 'flex-end',
                  maxWidth: '80%',
                  padding: 'var(--sp-md)',
                  borderRadius: 'var(--r-sm)',
                  background: msg.from === 'parent' ? 'var(--surf2)' : 'rgba(200,168,78,0.08)',
                  border: msg.from === 'parent' ? '1px solid var(--border)' : '1px solid rgba(200,168,78,0.15)',
                  fontSize: 'var(--fs-sm)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-xs)', color: msg.from === 'parent' ? 'var(--ts)' : 'var(--gold)', marginBottom: 4 }}>
                    {msg.from === 'parent' ? selectedLead.parentName : (msg.sender || 'BAM GTA')}
                  </div>
                  <div>{msg.text}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tm)', marginTop: 4 }}>{msg.time}</div>
                </div>
              ))}
            </div>

            {/* Quick reply */}
            <div style={{ marginTop: 'var(--sp-xl)', display: 'flex', gap: 'var(--sp-sm)' }}>
              <input
                style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf)', color: 'var(--tp)' }}
                placeholder="Type a reply..."
              />
              <button className={`${s.btn} ${s.btnGold}`}>Send</button>
            </div>

            {/* Stage-specific actions */}
            <div style={{ marginTop: 'var(--sp-xl)', display: 'flex', gap: 'var(--sp-sm)', flexWrap: 'wrap' }}>
              {(STAGE_ACTIONS[selectedLead.stage] || []).map(action => (
                <button
                  key={action.action}
                  className={`${s.btn} ${action.style === 'gold' ? s.btnGold : action.style === 'danger' ? s.btnDanger : ''}`}
                  style={action.style === 'warn' ? { color: 'var(--warn)', borderColor: 'rgba(224,157,36,0.3)' } : undefined}
                  onClick={() => {
                    if (action.action === 'lost' && selectedLead.stage === 'done_trial') {
                      setShowLostReason(true);
                    } else {
                      setLeads(prev => prev.filter(l => l.id !== selectedLead.id));
                      setSelectedLead(null);
                    }
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Lost Reason Modal (Done Trial only) */}
            {showLostReason && (
              <LostReasonModal onSubmit={() => {
                setLeads(prev => prev.filter(l => l.id !== selectedLead.id));
                setSelectedLead(null);
                setShowLostReason(false);
              }} onClose={() => setShowLostReason(false)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Post-Trial Form inline component
function LostReasonModal({ onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0 && reason !== 'other';
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf2)', color: 'var(--tp)', fontFamily: 'var(--ff)' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surf)', borderRadius: 'var(--r-lg)', width: 400, maxWidth: '90vw', padding: 'var(--sp-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--red)', marginBottom: 'var(--sp-lg)' }}>Mark as Lost</h2>
        <div style={{ marginBottom: 'var(--sp-lg)' }}>
          <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason *</label>
          <select style={inputStyle} value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">Select a reason...</option>
            <option value="Too expensive">Too expensive</option>
            <option value="Not enough time">Not enough time</option>
            <option value="Started other programs">Started other programs</option>
            <option value="Not locked in">Not locked in</option>
            <option value="Bad fit">Bad fit</option>
            <option value="other">Other</option>
          </select>
          {reason === 'other' && <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Enter reason..." onChange={e => setReason(e.target.value || 'other')} />}
        </div>
        <button onClick={valid ? onSubmit : undefined} style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none', background: valid ? 'var(--red)' : 'var(--surf3)', color: valid ? '#fff' : 'var(--tm)', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--ff)' }}>
          Confirm Lost
        </button>
      </div>
    </div>
  );
}

function PostTrialForm({ lead, staff, onSubmit }) {
  const [attended, setAttended] = useState(true);
  const [goodFit, setGoodFit] = useState(true);
  const [salesPerson, setSalesPerson] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!salesPerson) return;
    onSubmit({ attended, goodFit, leadSalesPerson: salesPerson, notes });
  };

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--borderm)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', background: 'var(--surf)', color: 'var(--tp)' };
  const labelStyle = { fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--tp)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-xl)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={attended} onChange={() => setAttended(!attended)} style={{ width: 18, height: 18, accentColor: 'var(--green)' }} /> Attended
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={goodFit} onChange={() => setGoodFit(!goodFit)} style={{ width: 18, height: 18, accentColor: 'var(--green)' }} /> Good Fit
        </label>
      </div>
      <div>
        <label style={labelStyle}>Lead Sales Person *</label>
        <select style={inputStyle} value={salesPerson} onChange={e => setSalesPerson(e.target.value)}>
          <option value="">Select staff member...</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Notes</label>
        <textarea
          style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="How did the trial go?"
        />
      </div>
      <button
        onClick={handleSubmit}
        style={{ padding: '12px 16px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-md)', fontWeight: 700, border: 'none', background: salesPerson ? 'var(--green)' : 'var(--surf3)', color: salesPerson ? '#fff' : 'var(--tm)', cursor: salesPerson ? 'pointer' : 'default', transition: 'all 120ms' }}
      >
        Submit Post-Trial Form
      </button>
    </div>
  );
}
