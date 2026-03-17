import { useState } from 'react';
import PageBanner from '../components/PageBanner';
import s from '../styles/Settings.module.css';
import sh from '../styles/shared.module.css';

const DEFAULT_FAQS = [
  { q: 'What ages do you train?', a: 'We train athletes ages 6-18, grouped by age and skill level.' },
  { q: 'How much does it cost?', a: 'Plans start at $95/mo for Beginner, $125/mo for Intermediate, and $175/mo for Elite.' },
  { q: 'Do you offer free trials?', a: 'Yes! Every new athlete gets a free trial session. Book at our website or reply here to schedule.' },
];

const DEFAULT_OFFERS = [
  { name: 'Elite Training', athletes: 'Ages 13-18, competitive', sessions: '3x/week, 90min', price: '$175/mo', status: 'Active' },
  { name: 'Intermediate Development', athletes: 'Ages 10-14, rec+travel', sessions: '2x/week, 60min', price: '$125/mo', status: 'Active' },
  { name: 'Beginner Fundamentals', athletes: 'Ages 6-10, all levels', sessions: '1x/week, 45min', price: '$95/mo', status: 'Active' },
];

export default function Settings() {
  const [tab, setTab] = useState('brand');
  const [tone, setTone] = useState('Friendly/Casual');
  const [sellingPoints, setSellingPoints] = useState('Small group sizes (max 8 athletes)\nFocused skill development, not just scrimmages\nSaturday sessions to fit busy family schedules');
  const [neverSay, setNeverSay] = useState('Never guarantee college scholarships\nNever trash-talk other programs');
  const [faqs, setFaqs] = useState(DEFAULT_FAQS);
  const [offers] = useState(DEFAULT_OFFERS);
  const [showOfferWizard, setShowOfferWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);

  const WIZARD_STEPS = ['Athletes', 'Sessions', 'Inclusions', 'Pricing', 'Commitment', 'Review'];

  return (
    <main className={sh.main}>
      <PageBanner
        title="Settings"
        stats={[
          { value: '3 Offers', explanation: 'Active training offers' },
          { value: `${faqs.length} FAQs`, explanation: 'Knowledge base entries' },
          { value: tone, explanation: 'AI brand voice tone' },
        ]}
      />

      <div className={sh.scroll}>
        {/* Tab nav */}
        <div className={s.tabBar}>
          {['brand', 'offers', 'academy'].map(t => (
            <button
              key={t}
              className={`${s.tabBtn} ${tab === t ? s.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'brand' ? 'AI Brand Voice' : t === 'offers' ? 'Offer Builder' : 'Academy Profile'}
            </button>
          ))}
        </div>

        {/* Brand Voice + FAQ */}
        {tab === 'brand' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Brand Voice & FAQ</h3>
              <span className={s.sectionRef}>SAL-004c</span>
            </div>

            <div className={s.formCard}>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Tone of Voice</label>
                <div className={s.toneGrid}>
                  {['Professional', 'Friendly/Casual', 'High-Energy/Hype', 'Motivational Coach'].map(t => (
                    <button
                      key={t}
                      className={`${s.toneBtn} ${tone === t ? s.toneActive : ''}`}
                      onClick={() => setTone(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className={s.formGroup}>
                <label className={s.formLabel}>Top Selling Points</label>
                <textarea
                  className={s.formTextarea}
                  rows={3}
                  value={sellingPoints}
                  onChange={e => setSellingPoints(e.target.value)}
                  placeholder="One selling point per line"
                />
              </div>

              <div className={s.formGroup}>
                <label className={s.formLabel}>Things the AI Should Never Say</label>
                <textarea
                  className={s.formTextarea}
                  rows={2}
                  value={neverSay}
                  onChange={e => setNeverSay(e.target.value)}
                  placeholder="One restriction per line"
                />
              </div>
            </div>

            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>FAQ Knowledge Base</h3>
              <button className={s.addBtn} onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>+ Add FAQ</button>
            </div>

            <div className={s.faqList}>
              {faqs.map((faq, i) => (
                <div key={i} className={s.faqCard}>
                  <div className={s.faqRow}>
                    <span className={s.faqLabel}>Q:</span>
                    <input
                      className={s.faqInput}
                      value={faq.q}
                      onChange={e => {
                        const next = [...faqs];
                        next[i] = { ...next[i], q: e.target.value };
                        setFaqs(next);
                      }}
                      placeholder="Question..."
                    />
                  </div>
                  <div className={s.faqRow}>
                    <span className={s.faqLabel}>A:</span>
                    <input
                      className={s.faqInput}
                      value={faq.a}
                      onChange={e => {
                        const next = [...faqs];
                        next[i] = { ...next[i], a: e.target.value };
                        setFaqs(next);
                      }}
                      placeholder="Approved answer..."
                    />
                  </div>
                </div>
              ))}
            </div>

            <button className={s.saveBtn}>Save Brand Voice</button>
          </>
        )}

        {/* Offer Builder */}
        {tab === 'offers' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Training Offers</h3>
              <span className={s.sectionRef}>SAL-014</span>
            </div>

            <div className={s.sageTip}>
              <span className={s.sageTipLabel}>Sage</span>
              <span>These offers are injected into the AI sales agent context. When a lead asks about pricing or programs, the AI references these directly.</span>
            </div>

            <div className={s.offerGrid}>
              {offers.map(o => (
                <div key={o.name} className={s.offerCard}>
                  <div className={s.offerHeader}>
                    <div className={s.offerName}>{o.name}</div>
                    <span className={s.offerStatus}>{o.status}</span>
                  </div>
                  <div className={s.offerDetails}>
                    <div className={s.offerRow}><span className={s.offerLabel}>Athletes</span><span>{o.athletes}</span></div>
                    <div className={s.offerRow}><span className={s.offerLabel}>Sessions</span><span>{o.sessions}</span></div>
                    <div className={s.offerRow}><span className={s.offerLabel}>Price</span><span className={s.offerPrice}>{o.price}</span></div>
                  </div>
                  <button className={s.offerEdit}>Edit offer</button>
                </div>
              ))}
            </div>

            <button className={s.addOfferBtn} onClick={() => { setShowOfferWizard(true); setWizardStep(0); }}>
              + Create New Offer
            </button>
          </>
        )}

        {/* Academy Profile */}
        {tab === 'academy' && (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>Academy Profile</h3>
              <span className={s.sectionRef}>SET-001</span>
            </div>

            <div className={s.formCard}>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Academy Name</label>
                <input className={s.formInput} defaultValue="BAM Academy" />
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Location</label>
                <input className={s.formInput} defaultValue="1250 Court Ave, Austin, TX 78701" />
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Phone</label>
                <input className={s.formInput} defaultValue="(512) 555-0147" />
              </div>
              <div className={s.formGroup}>
                <label className={s.formLabel}>Trial Booking Link</label>
                <input className={s.formInput} defaultValue="https://bamacademy.bamos.app/trial" />
              </div>
            </div>

            <button className={s.saveBtn}>Save Profile</button>
          </>
        )}
      </div>

      {/* Offer Builder Wizard Modal */}
      {showOfferWizard && (
        <div className={s.wizardOverlay} onClick={() => setShowOfferWizard(false)}>
          <div className={s.wizardModal} onClick={e => e.stopPropagation()}>
            <button className={s.wizardClose} onClick={() => setShowOfferWizard(false)}>✕</button>
            <div className={s.wizardTitle}>Create New Offer</div>

            <div className={s.wizardStepper}>
              {WIZARD_STEPS.map((step, i) => (
                <div key={step} className={`${s.wizardStep} ${i === wizardStep ? s.wizardStepActive : i < wizardStep ? s.wizardStepDone : ''}`}>
                  <div className={s.wizardStepNum}>{i + 1}</div>
                  <span className={s.wizardStepLabel}>{step}</span>
                </div>
              ))}
            </div>

            <div className={s.wizardBody}>
              {wizardStep === 0 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Target Age Group</label>
                  <input className={s.formInput} placeholder="e.g. Ages 8-12" />
                  <label className={s.formLabel}>Skill Level</label>
                  <select className={s.formSelect}><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>All Levels</option></select>
                  <label className={s.formLabel}>Format</label>
                  <select className={s.formSelect}><option>Group Training</option><option>Private</option><option>Semi-Private</option><option>Camp</option></select>
                </div>
              )}
              {wizardStep === 1 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Session Duration</label>
                  <select className={s.formSelect}><option>45 minutes</option><option>60 minutes</option><option>90 minutes</option><option>120 minutes</option></select>
                  <label className={s.formLabel}>Sessions Per Week</label>
                  <select className={s.formSelect}><option>1x/week</option><option>2x/week</option><option>3x/week</option><option>4x/week</option><option>5x/week</option></select>
                  <label className={s.formLabel}>Location</label>
                  <input className={s.formInput} defaultValue="BAM Academy — Main Court" />
                </div>
              )}
              {wizardStep === 2 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>What is included?</label>
                  <textarea className={s.formTextarea} rows={4} placeholder="One inclusion per line, e.g.&#10;Skills training&#10;Game film review&#10;Access to open gym" />
                </div>
              )}
              {wizardStep === 3 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Pricing Model</label>
                  <select className={s.formSelect}><option>Monthly subscription</option><option>Per session</option><option>Package (multi-session)</option><option>Seasonal flat fee</option></select>
                  <label className={s.formLabel}>Price</label>
                  <input className={s.formInput} placeholder="e.g. $125" />
                </div>
              )}
              {wizardStep === 4 && (
                <div className={s.wizardContent}>
                  <label className={s.formLabel}>Minimum Commitment</label>
                  <select className={s.formSelect}><option>Month-to-month</option><option>3 months</option><option>6 months</option><option>12 months</option><option>Season-based</option></select>
                </div>
              )}
              {wizardStep === 5 && (
                <div className={s.wizardContent}>
                  <div className={s.wizardReview}>
                    <div className={s.wizardReviewLabel}>Review your offer details above, then save.</div>
                    <div className={s.sageTip}>
                      <span className={s.sageTipLabel}>Sage</span>
                      <span>I will generate a name and description for this offer once you save. The offer will be automatically injected into the AI sales agent context.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={s.wizardFooter}>
              {wizardStep > 0 && (
                <button className={s.wizardBack} onClick={() => setWizardStep(wizardStep - 1)}>Back</button>
              )}
              <div className={s.wizardSpacer} />
              {wizardStep < 5 ? (
                <button className={s.wizardNext} onClick={() => setWizardStep(wizardStep + 1)}>Next</button>
              ) : (
                <button className={s.wizardSave} onClick={() => setShowOfferWizard(false)}>Save Offer</button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
