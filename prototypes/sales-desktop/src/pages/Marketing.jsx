import { useState } from 'react';
import PageBanner from '../components/PageBanner';
import useTypewriter from '../hooks/useTypewriter';
import s from '../styles/Marketing.module.css';
import sh from '../styles/shared.module.css';

const SAGE_PROMPTS = [
  'Increase Saturday ad budget by $50...',
  'Create a new Instagram Reel ad for summer camp...',
  'Pause the Free Trial story ad — it has zero conversions...',
  'Show me cost per lead by channel this month...',
  'Generate a parent testimonial ad from Maria R...',
  'Set up a referral campaign with $25 credit reward...',
];

const QUICK_ACTIONS = [
  { label: 'Create new ad', icon: '🎬' },
  { label: 'Adjust budget', icon: '💰' },
  { label: 'Pause an ad', icon: '⏸️' },
  { label: 'Generate content brief', icon: '✍️' },
  { label: 'Lead source report', icon: '📊' },
  { label: 'Refresh stale ads', icon: '🔄' },
];

const CHANNELS = [
  {
    name: 'Instagram', leads: 14, cpl: '$12.40', trend: '+22%', trendUp: true, icon: '📸',
    campaigns: [
      { name: 'Youth Basketball Reel — Saturday Energy', spend: '$89', impressions: '4,210', cpm: '$21.14', reach: '3,680', frequency: '1.1', clicks: 187, ctr: '4.2%', cpc: '$0.48', lpv: 142, lpvRate: '75.9%', formFills: 4, trialBookings: 2, cpl: '$14.83', convRate: '4.2%', demo: { age: '28-42', gender: '62% F', geo: 'Within 15mi', onTarget: true } },
      { name: 'Summer Skills Camp Promo', spend: '$134', impressions: '6,820', cpm: '$19.65', reach: '5,100', frequency: '1.3', clicks: 245, ctr: '3.6%', cpc: '$0.55', lpv: 189, lpvRate: '77.1%', formFills: 5, trialBookings: 3, cpl: '$16.75', convRate: '4.2%', demo: { age: '25-38', gender: '71% F', geo: 'Within 10mi', onTarget: true } },
    ],
  },
  {
    name: 'Facebook', leads: 8, cpl: '$18.60', trend: '+5%', trendUp: true, icon: '📘',
    campaigns: [
      { name: 'Parent Testimonial — Maria R.', spend: '$134', impressions: '5,430', cpm: '$24.68', reach: '4,200', frequency: '1.3', clicks: 206, ctr: '3.8%', cpc: '$0.65', lpv: 158, lpvRate: '76.7%', formFills: 3, trialBookings: 2, cpl: '$26.80', convRate: '3.2%', demo: { age: '30-45', gender: '58% F', geo: 'Within 20mi', onTarget: true } },
      { name: 'Back-to-School Registration', spend: '$67', impressions: '3,150', cpm: '$21.27', reach: '2,800', frequency: '1.1', clicks: 98, ctr: '3.1%', cpc: '$0.68', lpv: 74, lpvRate: '75.5%', formFills: 2, trialBookings: 1, cpl: '$22.33', convRate: '4.1%', demo: { age: '22-35', gender: '65% F', geo: 'Within 25mi', onTarget: false, flag: 'Geo reaching beyond 20mi target radius' } },
    ],
  },
  {
    name: 'Google', leads: 6, cpl: '$24.10', trend: '-8%', trendUp: false, icon: '🔍',
    campaigns: [
      { name: 'Search — Basketball Training Near Me', spend: '$145', impressions: '2,300', cpm: '$63.04', reach: '2,100', frequency: '1.1', clicks: 89, ctr: '3.9%', cpc: '$1.63', lpv: 67, lpvRate: '75.3%', formFills: 4, trialBookings: 2, cpl: '$24.17', convRate: '9.0%', demo: { age: '28-50', gender: '52% M', geo: 'Within 12mi', onTarget: true } },
    ],
  },
  {
    name: 'Referral', leads: 4, cpl: '$0', trend: '+50%', trendUp: true, icon: '🤝',
    campaigns: [
      { name: 'Member Referral Links', spend: '$0', impressions: '—', cpm: '—', reach: '—', frequency: '—', clicks: 28, ctr: '—', cpc: '$0', lpv: 22, lpvRate: '78.6%', formFills: 2, trialBookings: 2, cpl: '$0', convRate: '18.2%', demo: { age: '30-42', gender: '55% F', geo: 'Within 8mi', onTarget: true } },
    ],
  },
];

const ADS_NEEDING_REFRESH = [
  { name: 'Summer Skills Camp Promo', days: 47, status: 'Stale', spend: '$312', conversions: 2, trend: 'declining' },
  { name: 'Free Trial — Instagram Story', days: 62, status: 'Stop-loss', spend: '$158', conversions: 0, trend: 'zero' },
];

const TOP_ADS = [
  { name: 'Youth Basketball Reel — Saturday Energy', spend: '$89', conversions: 6, ctr: '4.2%', days: 12, status: 'healthy' },
  { name: 'Parent Testimonial — Maria R.', spend: '$134', conversions: 5, ctr: '3.8%', days: 21, status: 'healthy' },
  { name: 'Back-to-School Registration', spend: '$67', conversions: 3, ctr: '3.1%', days: 8, status: 'new' },
];

const BUDGET = { monthly: 500, spent: 312, daysLeft: 15, pacing: 'on-pace' };

const CAMPAIGN_BUDGETS = [
  { name: 'Youth Basketball Reel — Saturday Energy', daily: '$8.50', monthly: '$255', status: 'Active' },
  { name: 'Parent Testimonial — Maria R.', daily: '$5.00', monthly: '$150', status: 'Active' },
  { name: 'Back-to-School Registration', daily: '$3.20', monthly: '$95', status: 'Active' },
  { name: 'Free Trial — Instagram Story', daily: '$0', monthly: '$0', status: 'Paused' },
];

const MORE_TOOLS = [
  { name: 'Meta Ads', icon: '📘', enabled: true, ref: 'MKT-001' },
  { name: 'Email & SMS Campaigns', icon: '📧', enabled: false, ref: 'MKT-008' },
  { name: 'Referral Campaigns', icon: '🤝', enabled: false, ref: 'MKT-009' },
  { name: 'Google Business Profile', icon: '📍', enabled: false, ref: 'MKT-011' },
  { name: 'Testimonial Collection', icon: '⭐', enabled: false, ref: 'MKT-012' },
];

const PERIODS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: 'mtd', label: 'Month to date', days: 16 },
  { id: '3m', label: 'Last 3 months', days: 90 },
];

/* ─── FULL DASHBOARD ─── */
function FullDashboard({ onClose }) {
  const [period, setPeriod] = useState('mtd');

  const allCampaigns = CHANNELS.flatMap(ch => ch.campaigns.map(c => ({ ...c, channel: ch.name, channelIcon: ch.icon })));
  const totalSpend = '$435';
  const totalImpressions = '21,910';
  const avgCPL = '$14.80';
  const totalConversions = 25;
  const avgCTR = '3.7%';
  const overallConvRate = '5.1%';

  const topMetrics = [
    { label: 'Total Spend', value: totalSpend, sub: 'Across all channels' },
    { label: 'Total Impressions', value: totalImpressions, sub: 'Ads served this period' },
    { label: 'Avg CPL', value: avgCPL, sub: 'Cost per lead (form + booking)' },
    { label: 'Total Conversions', value: String(totalConversions), sub: 'Form fills + trial bookings' },
    { label: 'Avg CTR', value: avgCTR, sub: 'Click-through rate' },
    { label: 'Conversion Rate', value: overallConvRate, sub: 'Conversions / landing page views' },
  ];

  const channelBreakdown = CHANNELS.map(ch => {
    const totalSpend = ch.campaigns.reduce((s, c) => s + parseFloat(c.spend.replace('$', '')), 0);
    const totalLeads = ch.campaigns.reduce((s, c) => s + c.formFills + c.trialBookings, 0);
    return { name: ch.name, icon: ch.icon, spend: `$${totalSpend.toFixed(0)}`, leads: totalLeads, cpl: ch.cpl, trend: ch.trend, trendUp: ch.trendUp };
  });

  return (
    <div className={s.dashFull}>
      <div className={s.dashHead}>
        <div className={s.dashHeadLeft}>
          <button className={s.dashBackBtn} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div className={s.dashTitle}>Marketing Dashboard</div>
            <div className={s.dashSubtitle}>{PERIODS.find(p => p.id === period).label}</div>
          </div>
        </div>
        <div className={s.dashControls}>
          <div className={s.dashPeriodGroup}>
            {PERIODS.map(p => (
              <button key={p.id} className={`${s.dashPeriodBtn} ${period === p.id ? s.dashPeriodActive : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className={s.dashBody}>
        <div className={s.dashNotes}>
          <span className={s.dashNotesLabel}>Sage</span>
          <span>Instagram is your most efficient channel at $12.40 CPL — 3x better than Google. Your Saturday Reel is driving 42% of all conversions. Consider reallocating $50 from the stale Summer Camp ad to the Saturday slot.</span>
        </div>

        <div className={s.dashSectionLabel}>Top-Level KPIs <span className={s.dashRef}>MKT-001</span></div>
        <div className={s.dashGrid}>
          {topMetrics.map((m, i) => (
            <div key={i} className={s.dashMetric}>
              <div className={s.dashMetricLabel}>{m.label}</div>
              <div className={s.dashMetricValue}>{m.value}</div>
              <div className={s.dashMetricSub}>{m.sub}</div>
            </div>
          ))}
        </div>

        <div className={s.dashSectionLabel}>Channel Breakdown <span className={s.dashRef}>MKT-001a</span></div>
        <div className={s.dashChannelRow}>
          {channelBreakdown.map(ch => (
            <div key={ch.name} className={s.dashChannelCard}>
              <div className={s.dashChannelTop}><span>{ch.icon}</span> {ch.name}</div>
              <div className={s.dashChannelLeads}>{ch.leads} leads</div>
              <div className={s.dashChannelMeta}>
                <span>Spend: {ch.spend}</span>
                <span>CPL: {ch.cpl}</span>
                <span className={ch.trendUp ? s.dashTrendUp : s.dashTrendDown}>{ch.trend}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={s.dashSectionLabel}>Campaign-Level Detail <span className={s.dashRef}>MKT-001a</span></div>
        <div className={s.dashTableWrap}>
          <table className={s.dashTable}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Ch</th>
                <th>Spend</th>
                <th>Impr.</th>
                <th>Reach</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>LPV</th>
                <th>Fills</th>
                <th>Bookings</th>
                <th>CPL</th>
                <th>Conv %</th>
                <th>Demo</th>
              </tr>
            </thead>
            <tbody>
              {allCampaigns.map((c, i) => (
                <tr key={i}>
                  <td className={s.dashCampaignName}>{c.name}</td>
                  <td>{c.channelIcon}</td>
                  <td className={s.dashMono}>{c.spend}</td>
                  <td className={s.dashMono}>{c.impressions}</td>
                  <td className={s.dashMono}>{c.reach}</td>
                  <td className={s.dashMono}>{c.clicks}</td>
                  <td className={s.dashMono}>{c.ctr}</td>
                  <td className={s.dashMono}>{c.cpc}</td>
                  <td className={s.dashMono}>{c.lpv}</td>
                  <td className={s.dashMono}>{c.formFills}</td>
                  <td className={s.dashMono}>{c.trialBookings}</td>
                  <td className={s.dashMono}>{c.cpl}</td>
                  <td className={s.dashMono}>{c.convRate}</td>
                  <td>{c.demo.onTarget ? <span className={s.demoBadgeGreen}>On target</span> : <span className={s.demoBadgeYellow}>{c.demo.flag}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={s.dashSectionLabel}>Demographics <span className={s.dashRef}>MKT-001b</span></div>
        <div className={s.dashDemoGrid}>
          {allCampaigns.map((c, i) => (
            <div key={i} className={`${s.dashDemoCard} ${!c.demo.onTarget ? s.dashDemoWarn : ''}`}>
              <div className={s.dashDemoName}>{c.name}</div>
              <div className={s.dashDemoRow}><span>Age</span><span>{c.demo.age}</span></div>
              <div className={s.dashDemoRow}><span>Gender</span><span>{c.demo.gender}</span></div>
              <div className={s.dashDemoRow}><span>Geo</span><span>{c.demo.geo}</span></div>
              {!c.demo.onTarget && <div className={s.dashDemoFlag}>{c.demo.flag}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── CHANNEL DETAIL MODAL ─── */
function ChannelDetail({ channel, onClose }) {
  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>{channel.icon} {channel.name} — Campaign Detail</div>
        <div className={s.modalRef}>MKT-001a</div>

        {channel.campaigns.map((c, i) => (
          <div key={i} className={s.campaignDetailCard}>
            <div className={s.campaignDetailName}>{c.name}</div>
            <div className={s.campaignDetailGrid}>
              <div className={s.campaignDetailStat}><span>Spend</span><span>{c.spend}</span></div>
              <div className={s.campaignDetailStat}><span>Impressions</span><span>{c.impressions}</span></div>
              <div className={s.campaignDetailStat}><span>CPM</span><span>{c.cpm}</span></div>
              <div className={s.campaignDetailStat}><span>Reach</span><span>{c.reach}</span></div>
              <div className={s.campaignDetailStat}><span>Frequency</span><span>{c.frequency}</span></div>
              <div className={s.campaignDetailStat}><span>Clicks</span><span>{c.clicks}</span></div>
              <div className={s.campaignDetailStat}><span>CTR</span><span>{c.ctr}</span></div>
              <div className={s.campaignDetailStat}><span>CPC</span><span>{c.cpc}</span></div>
              <div className={s.campaignDetailStat}><span>LPV</span><span>{c.lpv}</span></div>
              <div className={s.campaignDetailStat}><span>LPV Rate</span><span>{c.lpvRate}</span></div>
              <div className={s.campaignDetailStat}><span>Form Fills</span><span>{c.formFills}</span></div>
              <div className={s.campaignDetailStat}><span>Bookings</span><span>{c.trialBookings}</span></div>
              <div className={s.campaignDetailStat}><span>CPL</span><span>{c.cpl}</span></div>
              <div className={s.campaignDetailStat}><span>Conv. Rate</span><span>{c.convRate}</span></div>
            </div>
            <div className={`${s.campaignDemoBanner} ${!c.demo.onTarget ? s.campaignDemoWarn : ''}`}>
              <span>Demo: {c.demo.age} · {c.demo.gender} · {c.demo.geo}</span>
              {c.demo.onTarget
                ? <span className={s.demoBadgeGreen}>On target</span>
                : <span className={s.demoBadgeYellow}>{c.demo.flag}</span>
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── BUDGET EDIT MODAL ─── */
function BudgetEditor({ onClose }) {
  const [selected, setSelected] = useState(CAMPAIGN_BUDGETS[0].name);
  const camp = CAMPAIGN_BUDGETS.find(c => c.name === selected);
  const [newDaily, setNewDaily] = useState(camp.daily.replace('$', ''));

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>Adjust Campaign Budget</div>
        <div className={s.modalRef}>MKT-006a</div>

        <div className={s.budgetFormGroup}>
          <label className={s.budgetFormLabel}>Select campaign</label>
          <select className={s.budgetFormSelect} value={selected} onChange={e => { setSelected(e.target.value); const c = CAMPAIGN_BUDGETS.find(cb => cb.name === e.target.value); setNewDaily(c.daily.replace('$', '')); }}>
            {CAMPAIGN_BUDGETS.map(c => (
              <option key={c.name} value={c.name}>{c.name} ({c.status})</option>
            ))}
          </select>
        </div>

        <div className={s.budgetCurrentCard}>
          <div className={s.budgetCurrentRow}><span>Current daily budget</span><span>{camp.daily}</span></div>
          <div className={s.budgetCurrentRow}><span>Current monthly estimate</span><span>{camp.monthly}</span></div>
          <div className={s.budgetCurrentRow}><span>Status</span><span>{camp.status}</span></div>
        </div>

        <div className={s.budgetFormGroup}>
          <label className={s.budgetFormLabel}>New daily budget</label>
          <div className={s.budgetInputWrap}>
            <span className={s.budgetInputPrefix}>$</span>
            <input className={s.budgetFormInput} type="number" step="0.50" value={newDaily} onChange={e => setNewDaily(e.target.value)} />
            <span className={s.budgetInputSuffix}>/ day</span>
          </div>
          <div className={s.budgetEstimate}>Estimated monthly: ${(parseFloat(newDaily || 0) * 30).toFixed(0)}</div>
        </div>

        <div className={s.budgetFormActions}>
          <button className={s.budgetCancelBtn} onClick={onClose}>Cancel</button>
          <button className={s.budgetSaveBtn} onClick={onClose}>Apply Budget Change</button>
        </div>
      </div>
    </div>
  );
}

/* ─── CREATE AD MODAL ─── */
function CreateAdModal({ onClose }) {
  const [step, setStep] = useState(0);
  const STEPS = ['Objective', 'Creative', 'Copy & CTA', 'Audience', 'Budget', 'Review'];

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>Create New Ad</div>
        <div className={s.modalRef}>MKT-005</div>

        <div className={s.wizardStepper}>
          {STEPS.map((st, i) => (
            <div key={st} className={`${s.wizardStep} ${i === step ? s.wizardStepActive : i < step ? s.wizardStepDone : ''}`}>
              <div className={s.wizardStepNum}>{i + 1}</div>
              <span className={s.wizardStepLabel}>{st}</span>
            </div>
          ))}
        </div>

        <div className={s.wizardBody}>
          {step === 0 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Campaign objective</label>
              <div className={s.objectiveGrid}>
                {['Trial Bookings', 'Form Fills (Leads)', 'Brand Awareness', 'Website Traffic'].map(o => (
                  <button key={o} className={s.objectiveBtn}>{o}</button>
                ))}
              </div>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> For youth sports academies, Trial Bookings drives the highest ROI. I'd recommend starting there.</div>
            </div>
          )}
          {step === 1 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Upload 3-5 ad creatives</label>
              <div className={s.uploadZone}>Drag images or video here, or click to browse</div>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Your best performers are Reels under 30 seconds with upbeat music. Parent testimonials convert 2x better than training footage.</div>
            </div>
          )}
          {step === 2 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Primary text</label>
              <textarea className={s.wizardTextarea} rows={3} placeholder="Sage will suggest copy based on your brand voice..." />
              <label className={s.budgetFormLabel}>Headline</label>
              <input className={s.budgetFormInput} placeholder="e.g. Free Trial This Saturday" />
              <label className={s.budgetFormLabel}>CTA button</label>
              <select className={s.budgetFormSelect}><option>Book Now</option><option>Learn More</option><option>Sign Up</option><option>Get Offer</option></select>
            </div>
          )}
          {step === 3 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Targeting</label>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Advantage+ audience is enabled — Meta's algorithm will find the best parents near your academy. Your existing members will be automatically excluded.</div>
              <div className={s.budgetCurrentCard}>
                <div className={s.budgetCurrentRow}><span>Location</span><span>Within 15mi of BAM Academy</span></div>
                <div className={s.budgetCurrentRow}><span>Targeting</span><span>Advantage+ (broad)</span></div>
                <div className={s.budgetCurrentRow}><span>Member exclusion</span><span>Enabled</span></div>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Daily budget</label>
              <div className={s.budgetInputWrap}>
                <span className={s.budgetInputPrefix}>$</span>
                <input className={s.budgetFormInput} type="number" defaultValue="10" />
                <span className={s.budgetInputSuffix}>/ day</span>
              </div>
              <label className={s.budgetFormLabel}>Schedule</label>
              <select className={s.budgetFormSelect}><option>Start immediately, run continuously</option><option>Set start and end date</option></select>
            </div>
          )}
          {step === 5 && (
            <div className={s.wizardContent}>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Everything looks good. Your campaign will go live once Meta reviews your ad (usually within 24 hours).</div>
              <div className={s.budgetCurrentCard}>
                <div className={s.budgetCurrentRow}><span>Objective</span><span>Trial Bookings</span></div>
                <div className={s.budgetCurrentRow}><span>Creatives</span><span>3 uploaded</span></div>
                <div className={s.budgetCurrentRow}><span>Daily budget</span><span>$10/day</span></div>
                <div className={s.budgetCurrentRow}><span>Schedule</span><span>Starts immediately</span></div>
              </div>
            </div>
          )}
        </div>

        <div className={s.wizardFooter}>
          {step > 0 && <button className={s.wizardBack} onClick={() => setStep(step - 1)}>Back</button>}
          <div className={s.wizardSpacer} />
          {step < 5
            ? <button className={s.wizardNext} onClick={() => setStep(step + 1)}>Next</button>
            : <button className={s.wizardSave} onClick={onClose}>Launch Campaign</button>
          }
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function Marketing() {
  const [briefInput, setBriefInput] = useState('');
  const [lastBrief, setLastBrief] = useState(null);
  const [cmdInput, setCmdInput] = useState('');
  const [cmdResponse, setCmdResponse] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [channelDetail, setChannelDetail] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [createAdOpen, setCreateAdOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const typewriterText = useTypewriter(SAGE_PROMPTS);

  const totalLeads = CHANNELS.reduce((sum, c) => sum + c.leads, 0);
  const avgCpl = '$14.80';
  const topChannel = CHANNELS[0].name;

  const handleCommand = (text) => {
    const cmd = text || cmdInput;
    if (!cmd.trim()) return;
    const lowCmd = cmd.toLowerCase();
    if (lowCmd.includes('create') && lowCmd.includes('ad')) { setCmdInput(''); setCreateAdOpen(true); return; }
    if (lowCmd.includes('budget') || lowCmd.includes('adjust')) { setCmdInput(''); setBudgetOpen(true); return; }
    setCmdResponse({
      input: cmd,
      reply: lowCmd.includes('generate')
        ? `I'll draft that for you now. Based on your best-performing content, I'd suggest a high-energy format with a clear trial CTA.`
        : lowCmd.includes('pause') || lowCmd.includes('stop')
        ? `I'll pause that ad and reallocate the daily budget across your remaining active campaigns.`
        : `On it — pulling that data for you now. Here's what I found for "${cmd}"...`,
      actions: lowCmd.includes('generate')
        ? ['Generate draft', 'Set audience first', 'Cancel']
        : lowCmd.includes('pause')
        ? ['Confirm pause', 'Reallocate budget', 'Cancel']
        : ['View details', 'Export', 'Cancel'],
    });
    setCmdInput('');
  };

  const toggleListening = () => {
    setIsListening(!isListening);
    if (!isListening) {
      setTimeout(() => {
        setIsListening(false);
        setCmdInput('Increase Saturday ad budget by $50 this week');
      }, 2500);
    }
  };

  const handleGenerateBrief = () => {
    if (!briefInput.trim()) return;
    setLastBrief({
      audience: briefInput,
      brief: `Content Brief: Target parents of ${briefInput}. Create a 30-second Instagram Reel showing high-energy training with upbeat music. Hook: "Your kid deserves better than rec league." Include a clear CTA to book a free trial. Tone: motivational, authentic. Post on Saturday morning for peak parent engagement.`,
    });
    setBriefInput('');
  };

  const pacingPct = Math.round((BUDGET.spent / BUDGET.monthly) * 100);

  return (
    <>
      <main className={sh.main}>
        <PageBanner
          title="Marketing"
          stats={[
            { value: `${totalLeads} Leads MTD`, explanation: 'Total leads this month' },
            { value: avgCpl, explanation: 'Avg cost per lead' },
            { value: topChannel, explanation: 'Top lead source' },
          ]}
          onDashboardClick={() => setDashOpen(true)}
        />

        <div className={sh.scroll}>
          {/* Sage Command Bar */}
          <div className={s.cmdBar}>
            <div className={s.cmdHeader}>
              <div className={s.cmdSageIcon}>S</div>
              <div className={s.cmdHeaderText}>
                <div className={s.cmdTitle}>Manage your marketing</div>
                <div className={s.cmdSubtitle}>Tell Sage what you need — create ads, adjust budgets, pull reports</div>
              </div>
            </div>

            <div className={s.cmdInputWrap}>
              <div className={`${s.cmdMic} ${isListening ? s.cmdMicActive : ''}`} onClick={toggleListening}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                {isListening && <div className={s.cmdMicPulse} />}
              </div>
              <div className={s.cmdInputInner}>
                <input
                  className={s.cmdInput}
                  value={cmdInput}
                  onChange={e => setCmdInput(e.target.value)}
                  placeholder={typewriterText}
                  onKeyDown={e => e.key === 'Enter' && handleCommand()}
                />
                {isListening && <span className={s.cmdListeningBadge}>Listening...</span>}
              </div>
              <button className={s.cmdSend} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              </button>
            </div>

            <div className={s.cmdChips}>
              {QUICK_ACTIONS.map(a => (
                <button key={a.label} className={s.cmdChip} onClick={() => {
                  if (a.label === 'Create new ad') setCreateAdOpen(true);
                  else if (a.label === 'Adjust budget') setBudgetOpen(true);
                  else handleCommand(a.label);
                }}>
                  <span>{a.icon}</span> {a.label}
                </button>
              ))}
            </div>

            {cmdResponse && (
              <div className={s.cmdResponse}>
                <div className={s.cmdResponseQ}>You said: &ldquo;{cmdResponse.input}&rdquo;</div>
                <div className={s.cmdResponseA}>{cmdResponse.reply}</div>
                <div className={s.cmdResponseActions}>
                  {cmdResponse.actions.map(a => (
                    <button key={a} className={a === 'Cancel' ? s.cmdActionCancel : s.cmdActionConfirm} onClick={() => setCmdResponse(null)}>{a}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sage tip */}
          <div className={s.sageTip}>
            <span className={s.sageTipLabel}>Sage</span>
            <span>Your Saturday ad is outperforming everything else by 3x — worth putting more budget there this week.</span>
          </div>

          {/* Lead Sources + More Tools dropdown */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Lead Sources</h3>
            <div className={s.toolsWrap}>
              <button className={s.toolsBtn} onClick={() => setToolsOpen(!toolsOpen)}>
                More tools
                <svg width="10" height="6" fill="none" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              {toolsOpen && (
                <div className={s.toolsDropdown}>
                  {MORE_TOOLS.map(t => (
                    <button key={t.name} className={`${s.toolsItem} ${!t.enabled ? s.toolsDisabled : ''}`} onClick={() => { if (t.enabled) setToolsOpen(false); }}>
                      <span className={s.toolsItemIcon}>{t.icon}</span>
                      <div className={s.toolsItemText}>
                        <span className={s.toolsItemName}>{t.name}</span>
                        <span className={s.toolsItemRef}>{t.ref}</span>
                      </div>
                      {!t.enabled && <span className={s.toolsComingSoon}>Coming soon</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={s.channelGrid}>
            {CHANNELS.map(ch => (
              <div key={ch.name} className={s.channelCard} onClick={() => setChannelDetail(ch)}>
                <div className={s.channelTop}>
                  <span className={s.channelIcon}>{ch.icon}</span>
                  <span className={s.channelName}>{ch.name}</span>
                  <span className={s.channelExpand}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                </div>
                <div className={s.channelLeads}>{ch.leads}</div>
                <div className={s.channelMeta}>
                  <span className={s.channelCpl}>CPL {ch.cpl}</span>
                  <span className={ch.trendUp ? s.channelTrendUp : s.channelTrendDown}>{ch.trend}</span>
                </div>
                {ch.campaigns.some(c => !c.demo.onTarget) && (
                  <div className={s.channelDemoFlag}>Demo off-target</div>
                )}
              </div>
            ))}
          </div>

          {/* Budget Pacing */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Budget Pacing</h3>
            <div className={s.sectionActions}>
              <button className={s.editBudgetBtn} onClick={() => setBudgetOpen(true)}>Edit budget</button>
              <span className={s.sectionRef}>MKT-006</span>
            </div>
          </div>
          <div className={s.budgetCard}>
            <div className={s.budgetRow}>
              <span className={s.budgetLabel}>Monthly budget</span>
              <span className={s.budgetValue}>${BUDGET.monthly}</span>
            </div>
            <div className={s.budgetRow}>
              <span className={s.budgetLabel}>Spent to date</span>
              <span className={s.budgetValue}>${BUDGET.spent}</span>
            </div>
            <div className={s.budgetBar}>
              <div className={s.budgetBarFill} style={{ width: `${pacingPct}%` }} />
            </div>
            <div className={s.budgetRow}>
              <span className={s.budgetPacing}>
                <span className={s.pacingDot} />
                On pace
              </span>
              <span className={s.budgetDays}>{BUDGET.daysLeft} days left</span>
            </div>
          </div>

          {/* Ad Health */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Ads Needing Refresh</h3>
            <span className={s.sectionRef}>MKT-002</span>
          </div>
          {ADS_NEEDING_REFRESH.map(ad => (
            <div key={ad.name} className={s.alertCard}>
              <div className={s.alertLeft}>
                <div className={s.alertName}>{ad.name}</div>
                <div className={s.alertMeta}>
                  <span>{ad.days} days running</span>
                  <span>•</span>
                  <span>{ad.spend} spent</span>
                  <span>•</span>
                  <span>{ad.conversions} conversions</span>
                </div>
              </div>
              <div className={s.alertRight}>
                <span className={ad.status === 'Stop-loss' ? s.alertBadgeRed : s.alertBadgeYellow}>{ad.status}</span>
                <button className={s.alertCta}>See Sage suggestion</button>
              </div>
            </div>
          ))}

          {/* Best Performing */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Best Performing Ads</h3>
            <span className={s.sectionRef}>MKT-004</span>
          </div>
          <div className={s.adsGrid}>
            {TOP_ADS.map(ad => (
              <div key={ad.name} className={s.adCard}>
                <div className={s.adName}>{ad.name}</div>
                <div className={s.adStats}>
                  <div className={s.adStat}><span className={s.adStatLabel}>Spend</span><span className={s.adStatVal}>{ad.spend}</span></div>
                  <div className={s.adStat}><span className={s.adStatLabel}>Conv.</span><span className={s.adStatVal}>{ad.conversions}</span></div>
                  <div className={s.adStat}><span className={s.adStatLabel}>CTR</span><span className={s.adStatVal}>{ad.ctr}</span></div>
                </div>
                <div className={s.adFooter}>
                  <span className={s.adDays}>{ad.days}d active</span>
                  <span className={ad.status === 'new' ? s.adBadgeNew : s.adBadgeHealthy}>{ad.status}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Create Ad CTA */}
          <button className={s.createAdBtn} onClick={() => setCreateAdOpen(true)}>
            + Create New Ad Campaign
          </button>

          {/* Content Briefs */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Content Briefs</h3>
            <span className={s.sectionRef}>CNT-001</span>
          </div>
          <div className={s.briefCard}>
            <div className={s.briefLabel}>Describe your target audience and content goal</div>
            <div className={s.briefInputRow}>
              <input
                className={s.briefInput}
                value={briefInput}
                onChange={e => setBriefInput(e.target.value)}
                placeholder="e.g. Parents of kids ages 8-12 who want competitive training"
                onKeyDown={e => e.key === 'Enter' && handleGenerateBrief()}
              />
              <button className={s.briefBtn} onClick={handleGenerateBrief} disabled={!briefInput.trim()}>
                Generate brief
              </button>
            </div>
            {lastBrief && (
              <div className={s.briefResult}>
                <div className={s.briefResultLabel}>Generated brief</div>
                <div className={s.briefResultText}>{lastBrief.brief}</div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Overlays */}
      {dashOpen && <FullDashboard onClose={() => setDashOpen(false)} />}
      {channelDetail && <ChannelDetail channel={channelDetail} onClose={() => setChannelDetail(null)} />}
      {budgetOpen && <BudgetEditor onClose={() => setBudgetOpen(false)} />}
      {createAdOpen && <CreateAdModal onClose={() => setCreateAdOpen(false)} />}
    </>
  );
}
